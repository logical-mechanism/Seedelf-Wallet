// The contract from the data layer's private index (chunk 26b, Step 4): a
// restore reads a snapshot, an unlock only what changed since the sealed
// cursor, and only new rows are checked for ours. Entries above the answer's
// cursor are never folded in; a rollback starts again from a snapshot; and
// Koios's scan, the fallback, never moves the cursor.
import type * as Wasm from "@seedelf/wasm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OWNED_BATCH, readContractView, SESSION_CONTRACT_PREFIX } from "../src/background/contract-scan";
import { DataParts, DOWN_MS } from "../src/background/data-layer";
import { privateIndexClient, utxoOf, type IndexRow } from "../src/background/private-index";
import { outpoint, SESSION_SPENT } from "../src/background/spent";
import { WalletLocked } from "../src/background/wallet";
import { assetFingerprint } from "../src/shared/fingerprint";
import { NETWORKS } from "../src/networks";
import { fakeIndex, indexRowOf, SLOT_TIME, stableSlot } from "./fake-index";
import { bech32Bytes, preprodAddress } from "./fixtures/bech32";
import { koiosPreprod, loadTestWasm, ownedUtxos, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const CONTRACT = koiosPreprod.wallet_contract;
const OURS = ownedUtxos.map(outpoint).sort();

/** The 12-word wallet unlocked, on mainnet's private index, its rows and others' made long before the tip. */
async function onIndex() {
  const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
  const t = testBalances();
  await t.wallet.create(v.phrase, PASSWORD);
  const index = fakeIndex();
  const base = index.tip - 100_000;
  index.contract = [...koiosPreprod.contract_utxos, ...ownedUtxos].map((u) => ({ row: indexRowOf(u, base) }));
  const prefs = { koiosOnly: false };
  const parts = new DataParts(t.session, () => t.clock.now);
  // Every ownership check, counted: each builds a Register.
  const checks = { n: 0 };
  const real = loadTestWasm();
  const Register = new Proxy(real.Register, {
    construct(target, args) {
      checks.n++;
      return new target(...(args as [string, string]));
    },
  });
  const deps = {
    ...t.deps,
    wasm: { ...real, Register } as typeof Wasm,
    index: privateIndexClient(
      { koiosOnly: async () => prefs.koiosOnly, parts, fetch: index.fetch, limits: {} },
      (n) => (n === "mainnet" ? "https://data.test" : undefined),
    ),
  };
  const record = () => t.deps.store.get<{ cursor: string; rows: IndexRow[]; checked: Record<string, boolean> }>("contract.mainnet");
  const contractReads = () => t.koios.calls.filter((c) => c.path === "credential_utxos").length;
  return { t, index, deps, prefs, checks, record, contractReads };
}

describe("the private index", () => {
  it("reads a restore from a snapshot, then what changed since it, and never scans Koios", async () => {
    const { t, index, deps, record, contractReads } = await onIndex();
    const view = await readContractView(deps, "mainnet");
    expect(view.owned.map(outpoint).sort()).toEqual(OURS);
    const cursor = `${stableSlot(index.tip)}.${stableSlot(index.tip).toString(16).padStart(64, "0")}`;
    expect(index.calls.sort()).toEqual(["contract/since/" + cursor, "contract/snapshot", "names"].sort());
    expect(contractReads()).toBe(0);
    // Sealed: the cursor, and only this wallet's rows.
    const kept = await record();
    expect(kept?.cursor).toBe(cursor);
    expect(kept?.rows.map((r) => r.ref).sort()).toEqual(OURS);
    expect(kept?.checked).toEqual({});
    // What reads the view without reading has it too.
    expect(await t.session.get(SESSION_CONTRACT_PREFIX + "mainnet")).toBeDefined();
  });

  it("asks only what changed since the sealed cursor after a lock: one since, nothing checked again", async () => {
    const { t, index, deps, checks } = await onIndex();
    await readContractView(deps, "mainnet");
    await t.wallet.lock();
    // Locked: the session's view is gone, the sealed record isn't.
    expect(await t.session.get(SESSION_CONTRACT_PREFIX + "mainnet")).toBeUndefined();
    await t.wallet.unlock(PASSWORD);
    index.calls.length = 0;
    checks.n = 0;
    const view = await readContractView(deps, "mainnet");
    expect(view.owned.map(outpoint).sort()).toEqual(OURS);
    expect(index.calls.filter((c) => c !== "names")).toEqual([expect.stringMatching(/^contract\/since\//)]);
    expect(checks.n).toBe(0);
  });

  it("checks a new row once, and folds it in only once the cursor passes it", async () => {
    const { index, deps, checks, record } = await onIndex();
    await readContractView(deps, "mainnet");
    // A payment to this wallet in the last few blocks: above any stable cursor.
    const paid = { ...indexRowOf(ownedUtxos[0]!, index.tip - 50), ref: `${"b1".repeat(32)}#0` };
    index.contract.push({ row: paid });
    checks.n = 0;
    const view = await readContractView(deps, "mainnet");
    expect(view.owned.map(outpoint)).toContain(paid.ref);
    expect(checks.n).toBe(1);
    expect((await record())?.checked).toEqual({ [paid.ref]: true });
    expect((await record())?.rows.map((r) => r.ref)).not.toContain(paid.ref);

    // Asked again, it comes again above the cursor, and isn't checked again.
    checks.n = 0;
    expect((await readContractView(deps, "mainnet")).owned.map(outpoint)).toContain(paid.ref);
    expect(checks.n).toBe(0);

    // The cursor passes it: it's settled, and nothing's left to remember as checked.
    index.advance(400);
    await readContractView(deps, "mainnet");
    expect((await record())?.rows.map((r) => r.ref)).toContain(paid.ref);
    expect((await record())?.checked).toEqual({});
  });

  it("drops a spend made on another device at once, and a removed Seedelf with it", async () => {
    const { index, deps, record } = await onIndex();
    const first = await readContractView(deps, "mainnet");
    const own = Object.entries(first.seedelfs).find(([, u]) => OURS.includes(outpoint(u)))!;
    const theirs = Object.entries(first.seedelfs).find(([, u]) => !OURS.includes(outpoint(u)))!;
    for (const ref of [outpoint(own[1]), outpoint(theirs[1])]) {
      index.contract.find((r) => r.row.ref === ref)!.spent = { slot: index.tip - 10, by: "cd".repeat(32) };
    }
    const view = await readContractView(deps, "mainnet");
    expect(view.owned.map(outpoint)).not.toContain(outpoint(own[1]));
    expect(view.seedelfs[own[0]]).toBeUndefined();
    expect(view.seedelfs[theirs[0]]).toBeUndefined();
    // Spent above the cursor: still settled, and gone from the record once the cursor passes the spend.
    expect((await record())?.rows.map((r) => r.ref)).toContain(outpoint(own[1]));
    index.advance(400);
    await readContractView(deps, "mainnet");
    expect((await record())?.rows.map((r) => r.ref)).not.toContain(outpoint(own[1]));
  });

  it("leaves out what this wallet spent itself, before the chain has it", async () => {
    const { t, deps } = await onIndex();
    await t.session.set(SESSION_SPENT, [OURS[0]!]);
    const view = await readContractView(deps, "mainnet");
    expect(view.owned.map(outpoint)).not.toContain(OURS[0]);
  });

  it("seals nothing from a read the WebAssembly trapped in, and checks the row again next time", async () => {
    const { t, index, deps, record } = await onIndex();
    await readContractView(deps, "mainnet");
    const paid = { ...indexRowOf(ownedUtxos[0]!, index.tip - 50), ref: `${"b2".repeat(32)}#0` };
    index.contract.push({ row: paid });
    // The next ownership check traps.
    await t.wallet.withKeys(async (keys) => {
      const real = keys.seedelf.isOwned.bind(keys.seedelf);
      let trap = true;
      keys.seedelf.isOwned = (register) => {
        if (!trap) return real(register);
        trap = false;
        throw new WebAssembly.RuntimeError("unreachable");
      };
    });
    // The wallet locks (wallet.ts), and the row isn't sealed as someone else's.
    await expect(readContractView(deps, "mainnet")).rejects.toBeInstanceOf(WalletLocked);
    await t.wallet.unlock(PASSWORD);
    expect((await record())?.checked).toEqual({});
    expect((await readContractView(deps, "mainnet")).owned.map(outpoint)).toContain(paid.ref);
    expect((await record())?.checked).toEqual({ [paid.ref]: true });
  });

  it("starts again from a snapshot when the cursor's block was rolled back", async () => {
    const { index, deps, record } = await onIndex();
    await readContractView(deps, "mainnet");
    const kept = await record();
    index.forked.add(Number(kept!.cursor.split(".")[0]));
    index.advance(400);
    index.calls.length = 0;
    const view = await readContractView(deps, "mainnet");
    expect(view.owned.map(outpoint).sort()).toEqual(OURS);
    expect(index.calls).toContain("contract/snapshot");
    expect((await record())?.cursor).not.toBe(kept!.cursor);
  });

  it("starts again from a snapshot when the index refuses the sealed cursor, the part left up", async () => {
    const { index, deps, record, contractReads } = await onIndex();
    await readContractView(deps, "mainnet");
    const kept = await record();
    index.refused.add(Number(kept!.cursor.split(".")[0]));
    index.advance(400);
    index.calls.length = 0;
    const view = await readContractView(deps, "mainnet");
    expect(view.owned.map(outpoint).sort()).toEqual(OURS);
    expect(index.calls).toContain("contract/snapshot");
    expect((await record())?.cursor).not.toBe(kept!.cursor);
    expect(contractReads()).toBe(0);
    // And the next reading reads on from the new cursor.
    index.calls.length = 0;
    await readContractView(deps, "mainnet");
    expect(index.calls.filter((c) => c !== "names")).toEqual([expect.stringMatching(/^contract\/since\//)]);
  });

  it("reads Koios's scan while the index is down, never moving the sealed cursor, and the index again after 5 minutes", async () => {
    const { t, index, deps, record, contractReads } = await onIndex();
    await readContractView(deps, "mainnet");
    const cursor = (await record())!.cursor;
    index.fail = Response.json({ error: "unavailable" }, { status: 503 });
    index.advance(400);
    const view = await readContractView(deps, "mainnet");
    expect(view.owned.map(outpoint).sort()).toEqual(OURS);
    expect(contractReads()).toBe(1);
    expect((await record())!.cursor).toBe(cursor);
    // Down: Koios without asking the index first.
    index.calls.length = 0;
    await readContractView(deps, "mainnet");
    expect(index.calls).toEqual([]);
    // Back: it catches up from the cursor it kept.
    index.fail = undefined;
    t.clock.now += DOWN_MS;
    await readContractView(deps, "mainnet");
    expect(index.calls.filter((c) => c !== "names")).toEqual([`contract/since/${cursor}`]);
  });

  it("reads Koios's scan alone with the Koios-only switch on", async () => {
    const { index, deps, prefs, contractReads } = await onIndex();
    prefs.koiosOnly = true;
    const view = await readContractView(deps, "mainnet");
    expect(view.owned.map(outpoint).sort()).toEqual(OURS);
    expect(index.calls).toEqual([]);
    expect(contractReads()).toBe(1);
  });

  it("never takes another wallet's record for this one's", async () => {
    const { t, index, deps } = await onIndex();
    await readContractView(deps, "mainnet");
    const kept = (await t.deps.store.get<Record<string, unknown>>("contract.mainnet"))!;
    await t.deps.store.set("contract.mainnet", { ...kept, owner: "someone else", rows: [] });
    index.calls.length = 0;
    const view = await readContractView(deps, "mainnet");
    expect(index.calls).toContain("contract/snapshot");
    expect(view.owned.map(outpoint).sort()).toEqual(OURS);
  });

  it("reads on when the sealed record can't be written (local storage full), as a refused session write does (launch review H5)", async () => {
    const { t, index, deps, contractReads } = await onIndex();
    const set = t.deps.store.set.bind(t.deps.store);
    t.deps.store.set = async () => {
      throw new Error("Resource::kQuotaBytes quota exceeded");
    };
    // A restore: its snapshot's record refused, then a reading after it, whose record is refused again.
    expect((await readContractView(deps, "mainnet")).owned.map(outpoint).sort()).toEqual(OURS);
    index.advance(400);
    expect((await readContractView(deps, "mainnet")).owned.map(outpoint).sort()).toEqual(OURS);
    expect(contractReads()).toBe(0);
    // A lock as the record is sealed still stops it.
    t.deps.store.set = async () => {
      throw new WalletLocked("locked");
    };
    index.advance(400);
    await expect(readContractView(deps, "mainnet")).rejects.toBeInstanceOf(WalletLocked);
    t.deps.store.set = set;
  });

  it("finds every Seedelf by name from the names route, this wallet's as its whole row", async () => {
    const { deps } = await onIndex();
    const view = await readContractView(deps, "mainnet");
    const named = [...koiosPreprod.contract_utxos, ...ownedUtxos].filter((u) =>
      u.asset_list?.some((a) => a.policy_id === "84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255" && a.asset_name.startsWith("5eed0e1f")),
    );
    expect(Object.keys(view.seedelfs).length).toBe(new Set(named.map((u) => u.asset_list!.find((a) => a.asset_name.startsWith("5eed0e1f"))!.asset_name)).size);
    const own = Object.values(view.seedelfs).find((u) => OURS.includes(outpoint(u)))!;
    expect(BigInt(own.value)).toBeGreaterThan(0n);
  });

  it("keeps this wallet's Seedelf its own when it moved between the names and the feed (26b's review)", async () => {
    const { t, index, deps } = await onIndex();
    const first = await readContractView(deps, "mainnet");
    const [name, at] = Object.entries(first.seedelfs).find(([, u]) => OURS.includes(outpoint(u)))!;
    // `names` answers from a block before the move; the feed after it, where the Seedelf sits in a new row of ours.
    const stale = await index.fetch("https://data.test/seedelf/v1/mainnet/names");
    const old = index.contract.find((r) => r.row.ref === outpoint(at))!;
    old.spent = { slot: index.tip - 10, by: "e7".repeat(32) };
    const moved = { ...old.row, ref: `${"e7".repeat(32)}#0`, created: { slot: index.tip - 10, time: index.tip - 10 + SLOT_TIME } };
    index.contract.push({ row: moved });
    const fetch = async (url: string) => (url.endsWith("/names") ? stale.clone() : index.fetch(url));
    const view = await readContractView(
      {
        ...deps,
        index: privateIndexClient(
          { koiosOnly: async () => false, parts: new DataParts(t.session, () => t.clock.now), fetch, limits: {} },
          (n) => (n === "mainnet" ? "https://data.test" : undefined),
        ),
      },
      "mainnet",
    );
    expect(view.owned.map(outpoint)).toContain(moved.ref);
    // Its whole row, ours, as Remove builds from: never another's, with nothing but its register.
    expect(outpoint(view.seedelfs[name]!)).toBe(moved.ref);
    expect(view.seedelfs[name]!.value).toBe(old.row.lovelace);
  });
});

describe("a private index row as Koios's", () => {
  it("parses as WebAssembly's UtxoResponse, every required field there", async () => {
    const { t } = await onIndex();
    const wasm = loadTestWasm();
    const mixBox = NETWORKS.mainnet.lovejoin!.mixBox;
    const rows = [...koiosPreprod.contract_utxos, ...ownedUtxos].map((u) => utxoOf(indexRowOf(u, 150_000_000), mixBox));
    const answer = await t.wallet.withKeys((keys) => wasm.lovejoinOwned(keys.seedelf, JSON.stringify({ network: "mainnet", pool: rows })));
    expect(JSON.parse(answer)).toHaveProperty("boxes");
  });

  it("fills what the index leaves out: the credential, the epoch, the time, fingerprints and a script", () => {
    const token = ["c0".repeat(28), "745553444d", "15", 6] as [string, string, string, number];
    const row: IndexRow = {
      ref: `${"ab".repeat(32)}#3`,
      address: "addr1w…",
      lovelace: "2000000",
      assets: [token],
      datum: "d87980",
      script: true,
      // Shelley's first mainnet epoch, 208, starts at slot 4,492,800.
      created: { slot: 4_492_800 + 432_000, time: 4_492_800 + 432_000 + 1_591_566_291 },
    };
    const u = utxoOf(row, CONTRACT);
    expect(u).toMatchObject({
      tx_hash: "ab".repeat(32),
      tx_index: 3,
      value: "2000000",
      payment_cred: CONTRACT,
      block_height: 0,
      block_time: row.created.time,
      epoch_no: 209,
      is_spent: false,
      inline_datum: { bytes: "d87980" },
      asset_list: [
        { policy_id: token[0], asset_name: token[1], quantity: "15", decimals: 6, fingerprint: assetFingerprint({ policyId: token[0], assetName: token[1] }) },
      ],
    });
    // A script it carries, unknown: the wallet never prices spending one.
    expect(u.reference_script).toEqual({ hash: null, size: null, type: null, bytes: null });
    expect(utxoOf({ ...row, script: undefined, datum: undefined, assets: undefined }, CONTRACT)).toMatchObject({
      reference_script: null,
      inline_datum: null,
      asset_list: [],
    });
  });
});

// Chunk 51, x2#2, on the private index: its rows are matched by the contract's 28 bytes too, and a row at the KEY
// address with them, under one of the user's registers, is nobody's to spend. It's neither owned nor any Seedelf's
// place (balances.ts `atContract`), on this path as on Koios's.
describe("the private index's row at a KEY address with the contract's hash", () => {
  // A restore's snapshot judged through the real WebAssembly: 0.2 to 0.6 s alone, but 3 to 6 s after this file's first
  // describe, here, and CI's runner is slower than this machine. Vitest's 5 s timed it out with nothing wrong, and hid
  // what it guards behind that timeout (r2tests#7): sized so only what it checks fails it.
  it("is neither the wallet's nor a Seedelf's place", { timeout: 30_000 }, async () => {
    const { index, deps } = await onIndex();
    const ours = ownedUtxos.find((u) => u.inline_datum?.bytes)!;
    const scriptAddress = Buffer.from(bech32Bytes(ours.address)).toString("hex");
    expect(scriptAddress).toBe(`70${CONTRACT}`);
    // The same 28 bytes as a key's, enterprise, on preprod as the fixture's rows are: header 0x60.
    const keyAddress = preprodAddress(CONTRACT);
    const name = `5eed0e1f${"66".repeat(8)}`;
    const planted = {
      ...ours,
      tx_hash: "c4".repeat(32),
      tx_index: 0,
      address: keyAddress,
      asset_list: [{ policy_id: "84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255", asset_name: name, quantity: "1", decimals: 0, fingerprint: "" }],
    };
    index.contract.push({ row: indexRowOf(planted, index.tip - 100_000) });
    const view = await readContractView(deps, "mainnet");
    expect(view.owned.map(outpoint).sort()).toEqual(OURS);
    expect(view.seedelfs[name]).toBeUndefined();
  });

  // Chunk 51, gap-g6#1: the sealed record keeps the index's verdicts, and settled rows are never checked again. One
  // sealed by 1.9.1 holding such a row as ours kept it for good after the update (nobody can spend it, so it never goes
  // through a spend): the balance counted it and Max failed. A record sealed under an older rule is read again from a
  // snapshot, and every verdict in it made again by today's: a row kept as ours, and one checked as not.
  it("sealed as ours by an older release, is judged again by today's rule after the update", async () => {
    const { t, index, deps, record } = await onIndex();
    await readContractView(deps, "mainnet");
    const sealed = (await t.deps.store.get<Record<string, unknown> & { rows: IndexRow[] }>("contract.mainnet"))!;
    const ours = ownedUtxos.find((u) => u.inline_datum?.bytes)!;
    // The stranger's row of x2#2, long settled: at the KEY address with the contract's 28 bytes, under the user's
    // register, and listed by the index as unspent for good.
    const planted = indexRowOf({ ...ours, tx_hash: "c5".repeat(32), tx_index: 0, address: preprodAddress(CONTRACT) }, index.tip - 100_000);
    index.contract.push({ row: planted });
    // A payment of the user's in the last few blocks, above the cursor: kept as checked, not ours.
    const paid = { ...indexRowOf(ownedUtxos[0]!, index.tip - 50), ref: `${"b1".repeat(32)}#0` };
    index.contract.push({ row: paid });
    // As 1.9.1 sealed them, under the rule it had then (v 1): the first among its rows as ours, the second as not.
    await t.deps.store.set("contract.mainnet", { ...sealed, v: 1, rows: [...sealed.rows, planted], checked: { [paid.ref]: false } });

    index.calls.length = 0;
    const view = await readContractView(deps, "mainnet");
    expect(view.owned.map(outpoint), "the planted row, after the update").not.toContain(planted.ref);
    expect(view.owned.map(outpoint), "the user's payment, after the update").toContain(paid.ref);
    // One snapshot, as at a restore, and a record sealed again under today's rule, without the planted row.
    expect(index.calls).toContain("contract/snapshot");
    const again = await t.deps.store.get<{ v: number; rows: IndexRow[] }>("contract.mainnet");
    expect(again?.v).not.toBe(1);
    expect((await record())?.rows.map((r) => r.ref)).not.toContain(planted.ref);
  });
});

// Chunk 51's T1k lens: the names loop's checks and the batches' keys, which no test failed without.
describe("the private index's names and batches: the guards no test pinned (chunk 51, T1k)", () => {
  afterEach(() => vi.restoreAllMocks());

  /** The index's names answer, as the route gives it, changed by `change` before the wallet reads it. */
  async function namesChanged(ix: Awaited<ReturnType<typeof onIndex>>, change: (names: Array<{ name: string; row: IndexRow }>) => void) {
    const answer = (await (await ix.index.fetch("https://data.test/seedelf/v1/mainnet/names")).json()) as { names: Array<{ name: string; row: IndexRow }> };
    change(answer.names);
    const fetch = async (url: string) => (url.endsWith("/names") ? Response.json(answer) : ix.index.fetch(url));
    return {
      ...ix.deps,
      index: privateIndexClient(
        { koiosOnly: async () => false, parts: new DataParts(ix.t.session, () => ix.t.clock.now), fetch, limits: {} },
        (n) => (n === "mainnet" ? "https://data.test" : undefined),
      ),
    };
  }

  // t1k#2: a name is located only at a row holding its token. One the answer pairs with another row was paid there:
  // Send rebuilds the row with the name in it (seedelfRow), so WebAssembly's check that it holds the token passed.
  it("locates a name only at a row holding it", async () => {
    const ix = await onIndex();
    let moved = "";
    const deps = await namesChanged(ix, (names) => {
      const entry = names[0]!;
      moved = `5eed0e1f${"99".repeat(8)}`;
      names.push({ name: moved, row: entry.row });
    });
    const view = await readContractView(deps, "mainnet");
    expect(view.seedelfs[moved]).toBeUndefined();
  });

  // t1k#2: and never at one this wallet has spent, which the index's names answer still lists until it catches up: a
  // Seedelf removed here kept its place, and paying its name paid the removed row's register.
  it("never locates a name at a row this wallet has spent, which the index still lists", async () => {
    const ix = await onIndex();
    const first = await readContractView(ix.deps, "mainnet");
    const [name, at] = Object.entries(first.seedelfs).find(([, u]) => OURS.includes(outpoint(u)))!;
    await ix.t.session.set(SESSION_SPENT, [outpoint(at)]);
    const view = await readContractView(ix.deps, "mainnet");
    expect(view.seedelfs[name]).toBeUndefined();
  });

  // t1k#3, on the index path: a lock and an unlock between two batches of its ownership checks give the next batch
  // other keys, as Remove wallet and a restore of another phrase do. The read ends, nothing of it sealed.
  it("ends cleanly when the keys change between its batches: nothing of it sealed", async () => {
    const ix = await onIndex();
    const theirs = koiosPreprod.contract_utxos.find((u) => u.inline_datum?.bytes && !OURS.includes(outpoint(u)))!;
    for (let i = 0; i < 3 * OWNED_BATCH; i++) {
      ix.index.contract.push({ row: indexRowOf({ ...theirs, tx_hash: (i + 1).toString(16).padStart(64, "c"), tx_index: 0 }, ix.index.tip - 100_000) });
    }
    const wasm = loadTestWasm();
    const isOwned = wasm.SeedelfKey.prototype.isOwned;
    vi.spyOn(wasm.SeedelfKey.prototype, "isOwned").mockImplementationOnce(function (this: Wasm.SeedelfKey, register) {
      void ix.t.wallet.lock();
      void ix.t.wallet.unlock(PASSWORD);
      return isOwned.call(this, register);
    });
    await expect(readContractView(ix.deps, "mainnet")).rejects.toBeInstanceOf(WalletLocked);
    expect(await ix.t.wallet.state()).toBe("unlocked");
    expect(await ix.record()).toBeUndefined();
  });
});
