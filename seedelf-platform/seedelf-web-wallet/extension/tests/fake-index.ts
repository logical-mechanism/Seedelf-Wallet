// A fake of the data layer's private index (seedelf-data's /seedelf/v1/mainnet/…):
// a small chain of the contract's and the mix box's rows, each made at a slot
// and maybe spent at a later one, answered as the server does. Cursors are
// `<slot>.<hash>` on a 200-slot grid, at least 200 slots below the tip.
import type { IndexRow } from "../src/background/private-index";
import type { KoiosUtxo } from "../src/background/koios";

/** Shelley on: a slot's time is the slot plus this (seedelf-data constants.rs). */
export const SLOT_TIME = 1_591_566_291;

export interface ChainRow {
  row: IndexRow;
  spent?: { slot: number; by: string };
}

/** The stable cursor's slot for a tip at `tip`. */
export const stableSlot = (tip: number) => Math.floor(Math.max(tip - 200, 0) / 200) * 200;

export interface FakeIndex {
  /** The tip's slot. */
  tip: number;
  /** The contract's rows. */
  contract: ChainRow[];
  /** The mix box's. */
  pool: ChainRow[];
  /** Grid slots whose block was rolled back: a `since` from a cursor there answers `reset`. */
  forked: Set<number>;
  /** Each request's path under /seedelf/v1/mainnet/. */
  calls: string[];
  /** While set, every request is answered with it. */
  fail?: Response | "unreachable";
  fetch: (url: string) => Promise<Response>;
  /** Moves the tip on, a block's worth of slots at a time. */
  advance: (slots: number) => void;
}

const hashAt = (slot: number) => slot.toString(16).padStart(64, "0");
const cursorAt = (slot: number) => `${slot}.${hashAt(slot)}`;
const point = (slot: number) => ({ slot, time: slot + SLOT_TIME });

/** A Koios row as the index's row, made at `slot`. */
export function indexRowOf(u: KoiosUtxo, slot: number): IndexRow {
  const assets = (u.asset_list ?? []).map((a) => [a.policy_id, a.asset_name, a.quantity, a.decimals] as [string, string, string, number]);
  return {
    ref: `${u.tx_hash}#${u.tx_index}`,
    address: u.address,
    lovelace: u.value,
    ...(assets.length ? { assets } : {}),
    ...(u.inline_datum?.bytes ? { datum: u.inline_datum.bytes } : {}),
    created: point(slot),
  };
}

export function fakeIndex(tip = 200_000_000): FakeIndex {
  const unspentAsOf = (rows: ChainRow[], at: number) =>
    rows.filter((r) => r.row.created.slot <= at && !(r.spent && r.spent.slot <= at)).map((r) => r.row);
  const fake: FakeIndex = {
    tip,
    contract: [],
    pool: [],
    forked: new Set(),
    calls: [],
    advance: (slots) => void (fake.tip += slots),
    fetch: async (url) => {
      // Mainnet's, or another network's where a test points its client there.
      const path = new URL(url).pathname.replace(/^\/seedelf\/v1\/\w+\//, "");
      fake.calls.push(path);
      if (fake.fail === "unreachable") throw new TypeError("Failed to fetch");
      if (fake.fail) return fake.fail.clone();
      const tipView = { ...point(fake.tip), hash: hashAt(fake.tip) };
      const stable = stableSlot(fake.tip);
      const [kind, route, from] = path.split("/");
      const rows = kind === "lovejoin" ? fake.pool : fake.contract;
      if (path === "names") {
        const names = unspentAsOf(fake.contract, fake.tip).flatMap((row) => {
          const name = row.assets?.find(([p, n]) => p === SEEDELF_POLICY && n.startsWith("5eed0e1f"))?.[1];
          return name ? [{ name, row }] : [];
        });
        return Response.json({ network: "mainnet", tip: tipView, names });
      }
      if (route === "snapshot" || route === "pool") {
        return Response.json({ network: "mainnet", tip: tipView, cursor: cursorAt(stable), rows: unspentAsOf(rows, stable) });
      }
      if (route === "since" && from) {
        const slot = Number(from.split(".")[0]);
        if (fake.forked.has(slot)) return Response.json({ network: "mainnet", tip: tipView, reset: true });
        const created = rows
          .filter((r) => r.row.created.slot > slot && r.row.created.slot <= fake.tip)
          .map((r) => (r.spent && r.spent.slot <= fake.tip ? { ...r.row, spent: { ...point(r.spent.slot), by: r.spent.by } } : r.row));
        const spent = rows
          .filter((r) => r.row.created.slot <= slot && r.spent && r.spent.slot > slot && r.spent.slot <= fake.tip)
          .map((r) => ({ ref: r.row.ref, ...point(r.spent!.slot), by: r.spent!.by }));
        return Response.json({
          network: "mainnet",
          tip: tipView,
          from,
          cursor: cursorAt(Math.max(stable, slot)),
          created,
          spent,
        });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  };
  return fake;
}

const SEEDELF_POLICY = "84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255";
