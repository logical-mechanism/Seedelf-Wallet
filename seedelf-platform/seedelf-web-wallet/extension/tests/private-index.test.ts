// The contract from the data layer's private index (chunk 26b, Step 4): a
// restore reads a snapshot, an unlock only what changed since the sealed
// cursor, and only new rows are checked for ours. Entries above the answer's
// cursor are never folded in; a rollback starts again from a snapshot; and
// Koios's scan, the fallback, never moves the cursor.
import type * as Wasm from "@seedelf/wasm";
import { describe, expect, it } from "vitest";

import { readContractView, SESSION_CONTRACT_PREFIX } from "../src/background/contract-scan";
import { DataParts, DOWN_MS } from "../src/background/data-layer";
import { privateIndexClient, utxoOf, type IndexRow } from "../src/background/private-index";
import { outpoint, SESSION_SPENT } from "../src/background/spent";
import { WalletLocked } from "../src/background/wallet";
import { assetFingerprint } from "../src/shared/fingerprint";
import { NETWORKS } from "../src/networks";
import { fakeIndex, indexRowOf, stableSlot } from "./fake-index";
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
