// A Splash order filled in parts, on mainnet (chunk 24; release review C02,
// C18): the order a session's swap placed is spent, and what the fill left of
// it waits at the same address, a new order. The runner follows it (the
// session's list of orders, Stop's own cancel, the close) only when a fill of
// the session's own order left it: anyone can pay that address an output whose
// datum names the session, one no cancel could ever spend. The worker's tests
// run on mainnet here: the fakes serve any network, and the book is a store
// key per network.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bodyOutpoints } from "../src/background/cbor";
import type { KoiosUtxo } from "../src/background/koios";
import { bech32 } from "./fixtures/bech32";
import { bytes, SESSION_ADDRESS } from "./fixtures/swap-tx";
import { sessionSwap } from "./fakes";
import { ASK, atSession, busy, MIN, signing, unlocked, type T } from "./swap-session";

const PAYMENT = sessionSwap.keyHash;
const STAKE = SESSION_ADDRESS.slice(58);
/** Splash's limit order script on mainnet (seedelf-core's orders.json). */
const SPLASH = "464eeee89f05aff787d40045af2a40a83fd96c513197d32fbc54ff02";
/** Where the session's Splash orders sit: Splash's script, under the session's own stake key. */
const ORDER_AT = bech32("addr", bytes(`11${SPLASH}${STAKE}`));
/** Session 0's own account on mainnet. */
const ACCOUNT = bech32("addr", bytes(`01${SESSION_ADDRESS.slice(2)}`));

/** The real mainnet Splash order seedelf-core's cancel tests read (tests/fixtures/order_cancels.json). */
const SPLASH_ORDER = (
  JSON.parse(readFileSync(new URL("../../../seedelf-core/tests/fixtures/order_cancels.json", import.meta.url), "utf8")) as Array<{
    protocol: string;
    network: string;
    datum: string;
    reference: Partial<KoiosUtxo> & { tx_hash: string; tx_index: number };
  }>
).find((f) => f.protocol === "Splash" && f.network === "mainnet")!;
/** Its datum: someone else's order, cancelled by their key and paying their address. */
const STRANGERS = SPLASH_ORDER.datum;
/** The same made out to session 0: cancelled by its payment key, paying its address. */
const OURS = STRANGERS.replaceAll("50ec3917ae68eaa31341050a5385636131cb59a9f43f536eb2eb2207", PAYMENT).replaceAll(
  "066311bb73a4336f7e433e255bd9f193a2d943d4fbfa1c712e909c05",
  STAKE,
);
/** Session 0's, its `fee` (field 8) bytes: it reads as the session's, but Splash's script can't decode it, so nothing ever spends it. */
const BROKEN = OURS.replace("1a001e8480d87982d87981", "4100d87982d87981");

const FUNDING_H = "01".repeat(32);
const SWAP_H = "a1".repeat(32);
const FILL_H = "b2".repeat(32);
const FILL2_H = "b3".repeat(32);
const OTHER_H = "c3".repeat(32);
const PLANT_H = "d4".repeat(32);
const PLANT2_H = "d5".repeat(32);

/** A UTxO at the session's Splash order address, as Koios lists it: output `index` of `txHash`, `datum` inline. */
function atOrders(txHash: string, datum = OURS, index = 0, extra: Partial<KoiosUtxo> = {}): KoiosUtxo {
  return { ...atSession(txHash, index, "4500000"), address: ORDER_AT, payment_cred: SPLASH, inline_datum: { bytes: datum, value: null }, ...extra } as KoiosUtxo;
}

/** A UTxO at session 0's account on mainnet. */
function atAccount(txHash: string, index: number, value: string, tokens: Array<[string, string]> = []): KoiosUtxo {
  return { ...atSession(txHash, index, value, tokens), address: ACCOUNT } as KoiosUtxo;
}

/** Koios's `tx_info` says `txHash` spent `inputs` (`txhash#index`), each of them sitting at `at`. */
function spends(t: T, txHash: string, inputs: string[], at = ORDER_AT) {
  t.koios.txSpends.set(
    txHash,
    inputs.map((ref) => ({ tx_hash: ref.split("#")[0]!, tx_index: Number(ref.split("#")[1]), payment_addr: { bech32: at, cred: null } })),
  );
}

/** Splash's reference script on mainnet, where Koios's `utxo_info` finds it (the fake knows preprod's alone). */
function splashReference(t: T) {
  t.koios.addedToAccounts.push({
    stake_address: null,
    payment_cred: "00".repeat(28),
    epoch_no: 300,
    block_height: 4_000_000,
    block_time: 1_700_000_000,
    inline_datum: null,
    datum_hash: null,
    asset_list: [],
    ...SPLASH_ORDER.reference,
  } as KoiosUtxo);
}

/**
 * Session 0 on mainnet, its swap landed with one Splash order (SWAP_H#0), now spent: filled in part, or in
 * whole. `back`: its return is in too. `stopping`: the user pressed Stop. Its account holds its 5 ₳ collateral
 * and the swap's change, unless its return took them.
 */
async function mainnetSession(t: T, { back = false, stopping = false }: { back?: boolean; stopping?: boolean } = {}) {
  const now = t.clock.now;
  const done = (kind: string, txHash: string, extra: Record<string, unknown> = {}) => ({ kind, txHash, at: now, confirmed: true, ...extra });
  await t.store.set("sessions.mainnet", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: now,
        txs: [
          done("out", FUNDING_H),
          done("swap", SWAP_H, { orders: [`${SWAP_H}#0`] }),
          ...(back ? [done("back", "05".repeat(32))] : []),
        ],
        swap: { ...ASK, amountOut: "906594100", minAmountOut: "902083681" },
        auto: {
          approved: { minAmountOut: "902083681", fund: { lovelace: "16000000", tokens: [] } },
          ...(back ? { filled: now } : {}),
          ...(stopping ? { stopping: now } : {}),
        },
      },
    ],
  });
  t.koios.confirmations = 1;
  t.koios.addedToAccounts.push(atOrders(SWAP_H));
  t.koios.spent.add(`${SWAP_H}#0`);
  if (!back) t.koios.addedToAccounts.push(atAccount(FUNDING_H, 1, "5000000"), atAccount(SWAP_H, 1, "10000000"));
}

/** The session's sealed record on mainnet. */
async function recordOf(t: T) {
  return (await t.store.get<{ sessions: Array<{ remnants?: { from: string[]; not: string[] }; auto?: Record<string, unknown> }> }>(
    "sessions.mainnet",
  ))!.sessions[0]!;
}

/** The transactions Koios's `tx_info` was asked about, in turn. */
const asked = (t: T) => t.koios.calls.filter((c) => c.path === "tx_info").map((c) => c.body._tx_hashes as string[]);

describe("a Splash order filled in parts (release review C18)", () => {
  it("lists what a fill of the session's order left at its address as the session's order, and not a stranger's order there", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await mainnetSession(t);
    t.koios.addedToAccounts.push(atOrders(FILL_H), atOrders(OTHER_H, STRANGERS));
    spends(t, FILL_H, [`${SWAP_H}#0`]);
    expect(await sessions.orders("mainnet", 0)).toEqual([{ protocol: "Splash", txIn: `${FILL_H}#0`, createdAt: 1_800_000_000_000 }]);
    // Looked for at the order's own address, and asked where it came from: not the stranger's, which isn't the session's.
    expect(t.koios.calls.filter((c) => c.path === "address_utxos").map((c) => c.body._addresses)).toEqual([[ORDER_AT]]);
    expect(asked(t)).toEqual([[FILL_H]]);
  });

  it("isn't over, its return in, while what the fill left is open, and is once that's spent", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await mainnetSession(t, { back: true });
    t.koios.addedToAccounts.push(atOrders(FILL_H));
    spends(t, FILL_H, [`${SWAP_H}#0`]);
    let view = await sessions.advance("mainnet", 0, true);
    expect(view.auto!.retry).toBeUndefined();
    expect(view.stage).toBe("open");
    expect((await sessions.list("mainnet", true))[0]!.stage).toBe("open");
    // Filled the rest of the way.
    t.koios.spent.add(`${FILL_H}#0`);
    view = await sessions.advance("mainnet", 0, true);
    expect(view.auto!.retry).toBeUndefined();
    expect(view.stage).toBe("closed");
  });

  it("is cancelled by Stop with the wallet's own cancel, followed back through fills Koios showed none of, and never a stranger's", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await mainnetSession(t);
    splashReference(t);
    // Two fills between two reads: the first one's rest was filled again, and only the second one's is left.
    t.koios.addedToAccounts.push(atOrders(FILL_H), atOrders(FILL2_H), atOrders(OTHER_H, STRANGERS));
    t.koios.spent.add(`${FILL_H}#0`);
    spends(t, FILL_H, [`${SWAP_H}#0`]);
    spends(t, FILL2_H, [`${FILL_H}#0`]);
    const view = await sessions.stop("mainnet", 0);
    expect(view.auto!.paused).toBeUndefined();
    expect(view.auto!.retry).toBeUndefined();
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel"]);
    const cancelled = bodyOutpoints(t.koios.submitted.at(-1)!, 0)!;
    expect(cancelled).toContain(`${FILL2_H}#0`);
    expect(cancelled).not.toContain(`${OTHER_H}#0`);
    // Followed back one fill at a time, and kept with the session: never asked again.
    expect(asked(t)).toEqual([[FILL2_H], [FILL_H]]);
    expect((await recordOf(t)).remnants).toEqual({ from: [FILL2_H], not: [] });
  });
});

describe("what a stranger puts at a Splash order's address (release review C02)", () => {
  it("is never the session's order, however its datum reads, unless a fill of the session's order left it: the session ends", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await mainnetSession(t, { back: true });
    // A copy of the order's datum Splash's script can't decode, and an exact one, each paid there by a stranger.
    t.koios.addedToAccounts.push(atOrders(PLANT_H, BROKEN), atOrders(PLANT2_H));
    spends(t, PLANT_H, [`${"ee".repeat(32)}#3`], "addr1vstranger");
    spends(t, PLANT2_H, [`${"ef".repeat(32)}#0`], "addr1vstranger");
    expect(await sessions.orders("mainnet", 0)).toEqual([]);
    const view = await sessions.advance("mainnet", 0, true);
    expect(view.auto!.retry).toBeUndefined();
    expect(view.stage).toBe("closed");
    // The exact copy, which reads as the session's whatever WebAssembly checks of a datum, was found a stranger's
    // once, and kept so. (The broken one too, unless WebAssembly reads it as no order of the session's at all.)
    const { remnants } = await recordOf(t);
    expect(remnants!.from).toEqual([]);
    expect(remnants!.not).toContain(PLANT2_H);
    expect(remnants!.not.filter((h) => h !== PLANT_H && h !== PLANT2_H)).toEqual([]);
  });

  it("never holds Stop: what the swap's order filled comes back, and nothing at the order's address is cancelled", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await mainnetSession(t, { stopping: true });
    splashReference(t);
    // The order filled whole: its proceeds came. A stranger paid the order's address an order no cancel can spend.
    t.koios.addedToAccounts.push(atAccount("aa".repeat(32), 0, "2000000", [[MIN, "902083681"]]), atOrders(PLANT_H, BROKEN));
    spends(t, PLANT_H, [`${"ee".repeat(32)}#3`], "addr1vstranger");
    const view = await sessions.advance("mainnet", 0, true);
    expect(view.auto!.paused).toBeUndefined();
    expect(view.auto!.retry).toBeUndefined();
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "back"]);
    expect(bodyOutpoints(t.koios.submitted.at(-1)!, 0)).not.toContain(`${PLANT_H}#0`);
  });

  it("never takes one holding a reference script, though a fill of the order left it: no cancel the wallet builds could spend it", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await mainnetSession(t);
    const script = { hash: "cd".repeat(28), size: 4, type: "plutusV2", bytes: "4e4d0100" };
    t.koios.addedToAccounts.push(atOrders(FILL_H), atOrders(FILL_H, OURS, 1, { reference_script: script }));
    spends(t, FILL_H, [`${SWAP_H}#0`]);
    expect((await sessions.orders("mainnet", 0)).map((o) => o.txIn)).toEqual([`${FILL_H}#0`]);
  });

  it("waits, rather than call it a stranger's, while Koios doesn't know the transaction that left it, and asks once it does", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await mainnetSession(t, { back: true });
    // A backend behind the one that listed it: tx_info doesn't know what left it yet.
    t.koios.addedToAccounts.push(atOrders(FILL_H));
    let view = await sessions.advance("mainnet", 0, true);
    expect(view.auto!.retry).toMatchObject({ reason: "koios-silent", error: "The server hasn't caught up with this session yet. Try again in a minute." });
    expect(view.stage).toBe("open");
    expect((await recordOf(t)).remnants).toBeUndefined();
    // Nor while it knows the transaction but doesn't say which outputs it spent.
    t.koios.txSpends.set(FILL_H, [{ payment_addr: { bech32: ORDER_AT, cred: null } }]);
    await busy(t, 60_000);
    view = await sessions.advance("mainnet", 0, true);
    expect(view.auto!.retry).toMatchObject({ reason: "koios-silent" });
    expect((await recordOf(t)).remnants).toBeUndefined();

    // It knows it now: the fill's rest, open, so the session isn't over.
    spends(t, FILL_H, [`${SWAP_H}#0`]);
    await busy(t, 60_000);
    view = await sessions.advance("mainnet", 0, true);
    expect(view.auto!.retry).toBeUndefined();
    expect(view.stage).toBe("open");
    expect((await recordOf(t)).remnants).toEqual({ from: [FILL_H], not: [] });
    // Never asked again.
    const before = asked(t).length;
    await busy(t, 60_000);
    await sessions.advance("mainnet", 0, true);
    expect(asked(t)).toHaveLength(before);
  });
});

describe("a datum nested thousands of levels deep at a spent Splash order's address (release review C06)", () => {
  /** A stranger's UTxO there: its inline datum a list nested 6,000 deep, a few kilobytes on chain. */
  const DEEP_H = "e7".repeat(32);
  const DEEP = `${"81".repeat(6_000)}00`;

  it("is passed over unread, and the same WebAssembly still builds Stop's own cancel of what a fill left", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await mainnetSession(t);
    splashReference(t);
    t.koios.addedToAccounts.push(atOrders(FILL_H), atOrders(DEEP_H, DEEP));
    spends(t, FILL_H, [`${SWAP_H}#0`]);
    // What WebAssembly answers of it, as the worker asks (its own copy of the module's functions, swap-session.ts).
    const wasm = (sessions as unknown as { deps: { wasm: { readDexOrder(request: string): string } } }).deps.wasm;
    const read = wasm.readDexOrder;
    const deep: unknown[] = [];
    wasm.readDexOrder = (request) => {
      const answer = read(request);
      if (request.includes(DEEP)) deep.push(JSON.parse(answer));
      return answer;
    };
    // Pallas's decoder recurses a call a level: read unwalked, it overflowed WebAssembly's stack and trapped the
    // instance. Refused unread, it's no order of the session's: nothing throws, and where it came from isn't asked.
    expect((await sessions.orders("mainnet", 0)).map((o) => o.txIn)).toEqual([`${FILL_H}#0`]);
    expect(deep[0]).toMatchObject({ known: true, protocol: "Splash", ours: false, why: expect.stringContaining("details") });
    expect(asked(t)).toEqual([[FILL_H]]);
    // The same instance builds Stop's own cancel of what the fill left, and only that.
    const view = await sessions.stop("mainnet", 0);
    expect(view.auto!.paused).toBeUndefined();
    expect(view.auto!.retry).toBeUndefined();
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel"]);
    const cancelled = bodyOutpoints(t.koios.submitted.at(-1)!, 0)!;
    expect(cancelled).toContain(`${FILL_H}#0`);
    expect(cancelled).not.toContain(`${DEEP_H}#0`);
  });
});
