// Chunk 34's 34d in the worker: the tile's flows into a token pool (from the
// public account and from the private balance), Bootstrap in place of the
// seed, a pool's start from either side and every check before it, the
// escape hatch for a pool whose boxes can't pay their own way back, and
// Activity naming what the public account did. With the real WebAssembly,
// the classic pool's recorded preprod boxes, and PR #163's preprod token pool
// (2 ₳ and LJTEST a box) standing in for any token pool.
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { describe as describeTxs } from "../src/background/activity";
import { CONTRACT_V1 } from "../src/background/balances";
import { bodyOutpoints, txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosTxInfo, KoiosTxOut, KoiosUtxo } from "../src/background/koios";
import { CLASSIC, LovejoinService, STUCK_WAIT_MS, type PoolRef } from "../src/background/lovejoin";
import { LovejoinLaunchService, SESSION_LOVEJOIN_LAUNCH } from "../src/background/lovejoin-launch";
import { HOLDER, LOVEJOIN_NFT, type FoundPool } from "../src/background/lovejoin-pools";
import { PendingService } from "../src/background/pending";
import { SessionService } from "../src/background/sessions";
import { builtOutputs, Minswap } from "../src/background/minswap";
import { SESSION_BALANCES_PREFIX, SESSION_UNLOCKED_AT } from "../src/background/wallet";
import { t as tr } from "../src/i18n";
import tokenList from "../src/tokens/list.json";
import { NETWORKS } from "../src/networks";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { epochParams, koiosPreprod, loadTestWasm, madeByMix, ownedUtxos, sessionSwap, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
const PHRASE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
)!.phrase;

/** Real chains are built and measured in WebAssembly: seconds each, more on CI. */
const SLOW = { timeout: 120_000 };

/** 20 boxes from Lovejoin's preprod pool, as Koios lists them (2026-09-25). */
const POOL = (JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }).pool;

/** PR #163's token pool on preprod, as Koios lists it (wasm/tests/fixtures). */
const FOUND = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/lovejoin-token-pool-preprod.json", import.meta.url), "utf8")) as {
  seed: { txHash: string; txIndex: number };
  reference: KoiosUtxo;
  scripts: KoiosUtxo[];
};
const TOKEN_POOL: PoolRef = { reference: FOUND.reference, seed: FOUND.seed, scripts: FOUND.scripts };
const VIEW = JSON.parse(loadTestWasm().lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: TOKEN_POOL }))) as {
  id: string;
  mixBoxHash: string;
  token: { policyId: string; assetName: string; quantity: string };
};
const TOKEN = VIEW.id;
const Q = BigInt(VIEW.token.quantity);
const TOKEN_ADDRESS = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(VIEW.mixBoxHash, "hex")]));

/** Ogmios's answer when the network measures no more than a transaction declares. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

/** MIN, on preprod's token list: a token that may have a pool. */
const MIN = tokenList.preprod.find((x) => x.ticker === "MIN")!;

type T = ReturnType<typeof testBalances>;

/** Lovejoin reading the classic pool and the token pool, giveme.my's witness stood in for. */
function pooled(t: T): LovejoinService {
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return new LovejoinService({
    ...t.deps,
    wasm: {
      ...wasm,
      finishLovejoinWithdraw: (request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    pools: async () => [TOKEN_POOL],
    random: () => 0.5,
  });
}

async function wallet(): Promise<T> {
  const t = testBalances();
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.evaluation = AGREES;
  // A slot in preprod's Shelley era: a transaction the account signs is valid until a while after it, and the wallet
  // measures its scripts with that in it.
  t.koios.tip = 110_000_000;
  return t;
}

/** One of the recorded account's UTxOs, made again as `tx`'s with `value` and `assets`. */
function atAccount(tx: string, value: string, assets: Array<{ policy_id: string; asset_name: string; quantity: string }> = []): KoiosUtxo {
  const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
  return {
    ...first!,
    tx_hash: tx.repeat(32),
    tx_index: 0,
    value,
    asset_list: assets.map((a) => ({ ...a, decimals: 0, fingerprint: "asset1test" })) as never,
  };
}

const ljtest = (quantity: bigint) => ({ policy_id: VIEW.token.policyId, asset_name: VIEW.token.assetName, quantity: quantity.toString() });

/** A register datum: the wallet's, or a stranger's. */
async function datum(t: T, ours: boolean): Promise<string> {
  const wasm = loadTestWasm();
  if (ours) return t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
  const stranger = wasm.SeedelfKey.fromHex("01".repeat(32));
  const bytes = Buffer.from(wasm.registerToDatum(wasm.rerandomize(stranger.baseRegister()))).toString("hex");
  stranger.free();
  return bytes;
}

/** A box in the token pool, the wallet's or a stranger's, a mix having moved it `hours` ago. */
async function tokenBox(t: T, tx: string, ours = true, hours = 5): Promise<KoiosUtxo> {
  t.koios.txSpends.set(tx.repeat(32), [{ payment_addr: { bech32: TOKEN_ADDRESS, cred: VIEW.mixBoxHash } }]);
  return {
    ...POOL[0]!,
    tx_hash: tx.repeat(32),
    tx_index: 0,
    address: TOKEN_ADDRESS,
    payment_cred: VIEW.mixBoxHash,
    value: "2000000",
    block_time: Math.floor(t.clock.now / 1000) - hours * 3600,
    datum_hash: null,
    inline_datum: { bytes: await datum(t, ours), value: {} },
    asset_list: [{ ...ljtest(Q), decimals: 0, fingerprint: "asset1ljtest" } as never],
  } as KoiosUtxo;
}

/** Twelve strangers' boxes in the token pool: enough for one box two waves deep. */
const strangers = (t: T) => Promise.all(Array.from({ length: 12 }, (_, i) => tokenBox(t, (0x60 + i).toString(16), false)));

type Sealed = {
  due: number[];
  pools?: Record<string, { due: number[] }>;
  chains: Array<{ id: string; pools?: Record<string, number>; leaves: Array<{ pool?: string }>; bootstrap?: true; seed?: true }>;
  mixes?: Array<{ id: string; bootstrap?: true; shares: Array<{ pool?: string; boxes: number }> }>;
  withdrawing?: { paid?: true; box?: { txHash: string }; pool?: string };
  launches?: Array<{ id: string; txHash: string; from: string }>;
};
const sealed = async (t: T) => (await t.store.get<Sealed>("lovejoin.preprod"))!;

describe("a mix from the public account into a token pool (chunk 34's 34d)", SLOW, () => {
  it("deposits the pool's token from the account, mixes in that pool alone, and records every leaf there", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(atAccount("e1", "3000000", [ljtest(2n * Q)]), atAccount("e5", "5000000"), ...POOL, ...(await strangers(t)));
    const summary = await lj.publicBuild("preprod", 1, { pool: TOKEN });
    expect(summary).toMatchObject({ pool: TOKEN, boxes: 1, token: { policyId: VIEW.token.policyId, quantity: Q.toString() } });
    expect(summary.bootstrap).toBeUndefined();
    await lj.publicSubmit("preprod", summary.txHash);
    t.koios.confirmations = 1;
    while (await lj.pumpPublic("preprod")) {
      /* sends the rest a window at a time */
    }
    // The deposit spends the account's LJTEST, and each box holds it.
    const deposit = t.koios.submitted.find((tx) => txInputs(tx).some((o) => o.startsWith("e1".repeat(32))))!;
    expect(deposit).toBeDefined();
    expect(Buffer.from(deposit).toString("hex")).toContain(VIEW.mixBoxHash);
    // Every mix draws from the token pool alone: none spends a classic box.
    const classic = new Set(POOL.map((u) => `${u.tx_hash}#${u.tx_index}`));
    expect(t.koios.submitted.flatMap((tx) => txInputs(tx)).filter((o) => classic.has(o))).toEqual([]);
    const s = await sealed(t);
    const chain = s.chains.at(-1)!;
    expect(chain.pools).toEqual({ [TOKEN]: 1 });
    expect(chain.leaves.map((l) => l.pool)).toEqual([TOKEN]);
    // Its boxes' due time is the token pool's, never the classic pool's.
    expect(s.due).toHaveLength(0);
    expect(s.pools![TOKEN]!.due).toHaveLength(1);
    expect(s.mixes!.at(-1)!.shares).toEqual([{ pool: TOKEN, boxes: 1 }]);
  });

  it("refuses a pool the wallet doesn't read, and an account without enough of the token", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(atAccount("e1", "3000000", [ljtest(Q / 2n)]), atAccount("e5", "5000000"), ...POOL, ...(await strangers(t)));
    await expect(lj.publicBuild("preprod", 1, { pool: "ab".repeat(28) })).rejects.toThrow("isn't one the wallet reads");
    await expect(lj.publicBuild("preprod", 1, { pool: TOKEN })).rejects.toThrow("enough of this pool's token");
  });
});

describe("no pool read names the pool a mix goes into (chunk 34's §3, 34d's review 1)", SLOW, () => {
  it("lists every pool the wallet reads in each read, whichever pool a flow takes", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(atAccount("e1", "3000000", [ljtest(2n * Q)]), atAccount("e5", "5000000"), ...POOL, ...(await strangers(t)));
    const boxes = [NETWORKS.preprod.lovejoin!.mixBox, VIEW.mixBoxHash].sort();
    const reads = () =>
      t.koios.calls.filter((c) => c.path === "credential_utxos" && boxes.some((b) => (c.body._payment_credentials as string[]).includes(b)));
    // A private mix's check of the token pool, and of the classic pool (short of its floor here: read all the same).
    await lj.fits("preprod", 1, TOKEN);
    await lj.fits("preprod", 1).catch(() => undefined);
    // A swap's review, and a mix from the public account into the token pool.
    await lj.room("preprod");
    await lj.publicBuild("preprod", 1, { pool: TOKEN });
    expect(reads().length).toBeGreaterThanOrEqual(4);
    for (const c of reads()) expect([...(c.body._payment_credentials as string[])].sort()).toEqual(boxes);
  });
});

describe("Bootstrap, in place of the seed (chunk 34's 34d)", SLOW, () => {
  it("puts a token pool's boxes in with no mixes, holds them, and caps a deposit at a token box's size", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(atAccount("e1", "3000000", [ljtest(3n * Q)]), atAccount("e5", "5000000"), ...POOL);
    // Nothing in the token pool at all: a Bootstrap needs no other boxes.
    await expect(lj.publicBuild("preprod", 65, { pool: TOKEN, bootstrap: true })).rejects.toThrow("Bootstrap 1 to 64 boxes at a time.");
    const summary = await lj.publicBuild("preprod", 3, { pool: TOKEN, bootstrap: true });
    expect(summary).toMatchObject({ bootstrap: true, pool: TOKEN, boxes: 3, depth: 0, mixes: 0, txs: 1 });
    await lj.publicSubmit("preprod", summary.txHash);
    t.koios.confirmations = 1;
    await lj.pumpPublic("preprod");
    const s = await sealed(t);
    expect(s.chains.at(-1)).toMatchObject({ bootstrap: true, pools: { [TOKEN]: 3 } });
    expect(s.chains.at(-1)!.seed).toBeUndefined();
    // No due time: a Bootstrap's boxes stay until the user brings them back.
    expect(s.pools?.[TOKEN]?.due ?? []).toHaveLength(0);
    expect(s.mixes!.at(-1)).toMatchObject({ bootstrap: true, shares: [{ pool: TOKEN, boxes: 3 }] });
  });

  it("is named a Bootstrap in Home's watch, sent and once its deposit is in, where a mix isn't (1.6.0's release review, 318-worker#0)", async () => {
    const t = await wallet();
    const lj = pooled(t);
    // Home's watch, as sw.ts wires it.
    const pending = new PendingService({ ...t.deps, depositLanded: (n, h) => lj.landedDeposit(n, h) });
    t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"), ...POOL);
    const summary = await lj.publicBuild("preprod", 2, { bootstrap: true });
    // What Send hands Home's banner (Lovejoin.tsx onPending): boxes held in the pool, never on their way back.
    expect(await lj.publicSubmit("preprod", summary.txHash)).toMatchObject({ kind: "lovejoin-mix", bootstrap: true });
    t.koios.confirmations = 1;
    await lj.pumpPublic("preprod");
    // And what Home's watch answers once the deposit is in.
    expect(await pending.pending("preprod")).toMatchObject({ kind: "lovejoin-mix", bootstrap: true, confirmations: 1 });

    // A mix from the account is no Bootstrap: its boxes come back by themselves.
    const u = await wallet();
    const mixing = pooled(u);
    u.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"), ...POOL);
    const mix = await mixing.publicBuild("preprod", 1);
    expect(mix.bootstrap).toBeUndefined();
    expect((await mixing.publicSubmit("preprod", mix.txHash)).bootstrap).toBeUndefined();
  });

  it("tells Home's watch how many boxes went, so its banner names one box as one (1.6.0's review of the fixes)", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const pending = new PendingService({ ...t.deps, depositLanded: (n, h) => lj.landedDeposit(n, h) });
    t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"), ...POOL);
    const one = await lj.publicBuild("preprod", 1, { bootstrap: true });
    expect(await lj.publicSubmit("preprod", one.txHash)).toMatchObject({ kind: "lovejoin-mix", bootstrap: true, boxes: 1 });
    t.koios.confirmations = 1;
    await lj.pumpPublic("preprod");
    expect(await pending.pending("preprod")).toMatchObject({ bootstrap: true, boxes: 1, confirmations: 1 });

    // A mix's count too: its boxes come back by themselves, one or several.
    const u = await wallet();
    const mixing = pooled(u);
    u.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"), ...POOL);
    const mix = await mixing.publicBuild("preprod", 1);
    expect(await mixing.publicSubmit("preprod", mix.txHash)).toMatchObject({ kind: "lovejoin-mix", boxes: 1 });
  });

  it("goes through a one-time account from the private balance, its boxes held as the public account's are", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const wasm = loadTestWasm();
    const sessions = new SessionService({
      ...t.deps,
      wasm: {
        ...wasm,
        signScriptSpend: (_key: unknown, request: string) => {
          const { txCbor } = JSON.parse(request) as { txCbor: string };
          return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
        },
      } as typeof wasm,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      store: t.store,
      minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
      lovejoin: lj,
      sleep: async () => undefined,
    });
    const out = await sessions.mixOutBuild("preprod", 1, { bootstrap: true });
    expect(out.mix).toMatchObject({ bootstrap: true, depth: 0, boxes: 1, mixes: 0 });
    expect(out.mix.seed).toBeUndefined();
    const { index } = await sessions.mixOutSubmit("preprod", out.txHash);
    const book = (await t.store.get<{ sessions: Array<{ index: number; mix?: { bootstrap?: boolean; seed?: boolean } }> }>("sessions.preprod"))!;
    expect(book.sessions.find((s) => s.index === index)!.mix).toMatchObject({ boxes: 1, bootstrap: true });

    // Its funding lands as it paid the account, with no 5 ₳ (1.6.0's release review, x-compat#0), and the session runs
    // (34d's review 6): its chain is recorded a Bootstrap's, held as the public account's is, never a seed's.
    const paid = landed(t, out.txHash);
    t.koios.addedToAccounts.push(...paid);
    t.koios.confirmations = 1;
    const before = t.koios.submitted.length;
    await sessions.advance("preprod", index, true);
    // The deposit: what spends the funding and pays a box at mix_box, never a return straight back that spends it.
    const deposit = t.koios.submitted
      .slice(before)
      .find(
        (tx) =>
          txInputs(tx).includes(`${out.txHash}#${paid[0]!.tx_index}`) &&
          builtOutputs(tx).some((o) => o.address.slice(2, 58) === NETWORKS.preprod.lovejoin!.mixBox),
      );
    expect(deposit).toBeDefined();
    const s = await sealed(t);
    const chain = s.chains.at(-1)!;
    expect(chain).toMatchObject({ bootstrap: true, session: index });
    expect(chain.seed).toBeUndefined();
    expect(s.due).toHaveLength(0);
    expect(s.mixes!.at(-1)).toMatchObject({ id: chain.id, bootstrap: true, session: index, shares: [{ boxes: 1 }] });

    // A session's chain ends with its return, so its id is the return's, not the deposit's (34g's rehearsal: a private
    // Bootstrap's 40 boxes were each given a due time at the next pool read, the hold matching none of them). Its box is
    // listed, and held through an unlock's read, and once the chain's record has gone.
    const depositHash = txIdOf(deposit!);
    if (chain.id === depositHash) {
      const record = (await t.store.get<Sealed & Record<string, unknown>>("lovejoin.preprod"))!;
      record.chains.at(-1)!.id = record.mixes!.at(-1)!.id = "be".repeat(32);
      await t.store.set("lovejoin.preprod", record);
    }
    const box = {
      ...POOL[0]!,
      tx_hash: depositHash,
      tx_index: 0,
      block_time: Math.floor(t.clock.now / 1000) - 60,
      inline_datum: { bytes: await datum(t, true), value: {} },
    } as KoiosUtxo;
    t.koios.addedToAccounts.push(box);
    const heldAfterRead = async () => {
      await t.wallet.withKeys(() => t.session.set(SESSION_UNLOCKED_AT, t.clock.now - HOUR));
      await lj.withdrawDue("preprod", true);
      return { due: (await sealed(t)).due, held: (await lj.status("preprod")).bootstrap };
    };
    expect(await heldAfterRead()).toEqual({ due: [], held: [{ txHash: depositHash, txIndex: 0 }] });
    t.clock.now += 3 * 24 * HOUR;
    box.block_time = Math.floor(t.clock.now / 1000) - 60;
    await t.wallet.unlock(PASSWORD);
    expect(await heldAfterRead()).toEqual({ due: [], held: [{ txHash: depositHash, txIndex: 0 }] });
    expect((await sealed(t)).chains.find((c) => c.bootstrap)).toBeUndefined();
  });

  // 1.6.0's release review, 318-rust#0 (323-rust#0, x-scenarios-lj#0): since 62162483 a private Bootstrap puts up no
  // collateral, so its return sweeps the deposit's change alone into the private balance, and the 1.5 ₳ beside its
  // boxes left too little for that sweep's Seedelf output. Every one was funded, then came straight back with no box
  // in and a second fee. Its funding lands here exactly as it paid the account, never a 5 ₳ a fixture supposes.
  it("funds a private Bootstrap with its way back, deposits, then sweeps the change back with nothing put up (1.6.0's release review, 318-rust#0)", async () => {
    const reserve = BigInt(loadTestWasm().lovejoinBootstrapReserve(JSON.stringify(epochParams[0])));
    const cases: Array<{ boxes: number | "most"; pool?: string }> = [{ boxes: 1 }, { boxes: "most" }, { boxes: 2, pool: TOKEN }];
    for (const { boxes: asked, pool } of cases) {
      const t = await wallet();
      const lj = pooled(t);
      const boxes = asked === "most" ? await lj.privateBootstrapMost("preprod") : asked;
      // The private balance holds enough for the boxes, and a token pool's token, two boxes' worth.
      t.koios.added.push({
        ...ownedUtxos[0]!,
        tx_hash: "d1".repeat(32),
        tx_index: 0,
        value: (BigInt(boxes) * 10_000_000n + 10_000_000n).toString(),
        inline_datum: { bytes: await datum(t, true), value: {} },
        asset_list: pool ? [{ ...ljtest(2n * Q), decimals: 0, fingerprint: "asset1ljtest" } as never] : [],
      } as KoiosUtxo);
      const sessions = runner(t, lj);
      const out = await sessions.mixOutBuild("preprod", boxes, { bootstrap: true, ...(pool ? { pool } : {}) });
      const { index } = await sessions.mixOutSubmit("preprod", out.txHash);
      // Its funding lands as it paid the account, and the session runs.
      const paid = landed(t, out.txHash, pool ? ljtest(BigInt(boxes) * Q) : undefined);
      t.koios.addedToAccounts.push(...paid);
      t.koios.confirmations = 1;
      const before = t.koios.submitted.length;
      await sessions.advance("preprod", index, true);
      const book = (await t.store.get<{ sessions: Array<{ index: number; txs: Array<{ kind: string }>; mix?: Record<string, unknown> }> }>("sessions.preprod"))!;
      const record = book.sessions.find((s) => s.index === index)!;
      // Its chain, the deposit then the return, never back directly.
      const what = `${boxes} boxes of the ${pool ? "token" : "classic"} pool, ${String(record.mix?.skipped ?? "nothing skipped")}`;
      expect(record.txs.map((x) => x.kind), what).toEqual(["out", "deposit", "back"]);
      expect(record.mix?.skipped).toBeUndefined();
      // One payment: the boxes and the deposit's reserve, as 1.5.0's funding has them, and the way back's beside them.
      // No 5 ₳: a deposit alone runs no script (the owner, 2026-10-23).
      const funding = await lj.funding("preprod", boxes, false, 0, pool);
      expect(out.payments.map((p) => p.lovelace)).toEqual([(BigInt(funding.lovelace) + reserve).toString()]);
      expect(out.mix.lovelace).toBe(funding.lovelace);
      expect(out.bootstrapReserve).toBe(reserve.toString());
      expect(out.collateralReserve).toBeUndefined();
      expect(paid).toHaveLength(1);
      // Marked as funded with no collateral: its return never takes one (323-worker#4).
      expect(record.mix).toMatchObject({ boxes, bootstrap: true, noCollateral: true });
      // The deposit spends the funding and pays every box into the pool.
      const [deposit, back] = t.koios.submitted.slice(before) as [Uint8Array, Uint8Array];
      expect(txInputs(deposit)).toEqual([`${out.txHash}#${paid[0]!.tx_index}`]);
      const into = pool ? VIEW.mixBoxHash : NETWORKS.preprod.lovejoin!.mixBox;
      expect(builtOutputs(deposit).filter((o) => o.address.slice(2, 58) === into)).toHaveLength(boxes);
      // The return sweeps the deposit's change alone into the wallet contract: nothing put up, and no script.
      const change = builtOutputs(deposit).findIndex((o) => o.address.slice(2, 58) === sessionSwap.keyHash);
      expect(txInputs(back)).toEqual([`${txIdOf(deposit)}#${change}`]);
      expect(bodyOutpoints(back, 13) ?? []).toEqual([]);
      const swept = builtOutputs(back);
      expect(swept.length).toBeGreaterThanOrEqual(1);
      for (const o of swept) expect(o.address.slice(2, 58)).toBe(CONTRACT_V1.walletContractHash);
      expect(swept.some((o) => o.tokens)).toBe(false);
    }
  });

  /** A private Bootstrap of `boxes` classic boxes, built and sent, its session runnable; nothing landed yet. */
  const bootstrapSent = async (boxes: number) => {
    const t = await wallet();
    const lj = pooled(t);
    const sessions = runner(t, lj);
    const out = await sessions.mixOutBuild("preprod", boxes, { bootstrap: true });
    const { index } = await sessions.mixOutSubmit("preprod", out.txHash);
    t.koios.confirmations = 1;
    type Book = { sessions: Array<{ index: number; txs: Array<{ kind: string }>; mix?: Record<string, unknown> }> };
    const record = async () => (await t.store.get<Book>("sessions.preprod"))!.sessions.find((s) => s.index === index)!;
    // Its record as a build before 1.6.0's release review kept it: no mark of a funding with no collateral.
    const unmarked = async () => {
      const book = (await t.store.get<Book>("sessions.preprod"))!;
      delete book.sessions.find((s) => s.index === index)!.mix!.noCollateral;
      await t.store.set("sessions.preprod", book);
    };
    return { t, lj, sessions, out, index, record, unmarked, chain: vi.spyOn(lj, "chain") };
  };

  // 1.6.0's release review, 323-worker#4: the return took any 5 ₳ of ADA alone at the account for its collateral, a
  // Bootstrap's too, whose own funding was that in a pool whose boxes made it so: set apart from the coins, it paid for
  // no box, and the session came back without going in. Marked as funded with none, it never puts one up.
  it("puts up no collateral for a Bootstrap funded with none, whatever 5 ₳ of ADA alone its account holds (1.6.0's release review, 323-worker#4)", async () => {
    const { t, sessions, out, index, record, chain } = await bootstrapSent(1);
    // Its funding lands, and someone pays its account 5 ₳ of ADA alone.
    const stranger = atSession("5e".repeat(32), 0, "5000000");
    t.koios.addedToAccounts.push(...landed(t, out.txHash), stranger);
    const before = t.koios.submitted.length;
    await sessions.advance("preprod", index, true);
    expect(chain).toHaveBeenCalled();
    expect(chain.mock.calls.map((c) => c[3])).toEqual(chain.mock.calls.map(() => undefined));
    expect((await record()).txs.map((x) => x.kind)).toEqual(["out", "deposit", "back"]);
    const sent = t.koios.submitted.slice(before);
    for (const tx of sent) expect(bodyOutpoints(tx, 13) ?? []).toEqual([]);
    // The 5 ₳ is a coin like any other there, and comes back through the chain.
    expect(sent.flatMap((tx) => txInputs(tx))).toContain(`${stranger.tx_hash}#0`);
  });

  // A Bootstrap funded before 62162483 paid 5 ₳ beside its boxes and the deposit's reserve: its record has no mark, and
  // its return still puts that 5 ₳ up and brings it back with the rest, its box in (1.6.0's release review).
  it("still puts up the 5 ₳ a Bootstrap funded before 62162483 paid, and goes in (1.6.0's release review)", async () => {
    const { t, sessions, out, index, record, unmarked, chain } = await bootstrapSent(1);
    await unmarked();
    t.koios.addedToAccounts.push(atSession(out.txHash, 0, out.mix.lovelace), atSession(out.txHash, 1, "5000000"));
    const before = t.koios.submitted.length;
    await sessions.advance("preprod", index, true);
    expect(chain.mock.calls[0]![3]).toMatchObject({ tx_hash: out.txHash, tx_index: 1, value: "5000000" });
    expect((await record()).txs.map((x) => x.kind)).toEqual(["out", "deposit", "back"]);
    expect((await record()).mix?.skipped).toBeUndefined();
    const [deposit, back] = t.koios.submitted.slice(before) as [Uint8Array, Uint8Array];
    expect(builtOutputs(deposit).filter((o) => o.address.slice(2, 58) === NETWORKS.preprod.lovejoin!.mixBox)).toHaveLength(1);
    // The 5 ₳ comes back in the return, with the deposit's change.
    expect(txInputs(back)).toContain(`${out.txHash}#1`);
  });

  // A Bootstrap funded between 62162483 and 1.6.0's release review paid neither a collateral nor its way back's reserve:
  // its deposit's change can't pay its sweep back. It comes back as well as it can: one box fewer goes in, that box's
  // ADA paying the way back, and a one-box Bootstrap comes back directly, saying its ADA pays for no box.
  it("brings a Bootstrap funded with neither a collateral nor its way back back as well as it can (1.6.0's release review)", async () => {
    const two = await bootstrapSent(2);
    await two.unmarked();
    two.t.koios.addedToAccounts.push(atSession(two.out.txHash, 0, two.out.mix.lovelace));
    let before = two.t.koios.submitted.length;
    await two.sessions.advance("preprod", two.index, true);
    expect((await two.record()).txs.map((x) => x.kind)).toEqual(["out", "deposit", "back"]);
    expect((await two.record()).mix?.skipped).toBeUndefined();
    const [deposit] = two.t.koios.submitted.slice(before) as [Uint8Array];
    expect(builtOutputs(deposit).filter((o) => o.address.slice(2, 58) === NETWORKS.preprod.lovejoin!.mixBox)).toHaveLength(1);

    const one = await bootstrapSent(1);
    await one.unmarked();
    one.t.koios.addedToAccounts.push(atSession(one.out.txHash, 0, one.out.mix.lovelace));
    before = one.t.koios.submitted.length;
    await one.sessions.advance("preprod", one.index, true);
    expect((await one.record()).txs.map((x) => x.kind)).toEqual(["out", "back"]);
    expect((await one.record()).mix?.skipped).toBe(tr("sess.skip.warn.mixCannotPay"));
    // Nothing stays: the whole funding comes back, less the return's fee.
    const [back] = one.t.koios.submitted.slice(before) as [Uint8Array];
    expect(txInputs(back)).toEqual([`${one.out.txHash}#0`]);
  });

  it("caps a Bootstrap from the private balance at what its funding pays the deposit and its way back for, its way back priced from the parameters (34d's review 3; 1.6.0's release review, 318-rust#0, bootstrap's call 1)", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const sessions = runner(t, lj);
    // Measured by building the deposit and its sweep back: under today's parameters the deposit's reserve and the way
    // back's pay for one deposit's most, in the classic pool and in a token pool, whose boxes are longer. The form's
    // bounds carry the way back's reserve as the funding prices it: 1.5 ₳ today.
    expect(await lj.privateBootstrapMost("preprod")).toBe(96);
    expect(await lj.privateBootstrapMost("preprod", TOKEN)).toBe(64);
    expect(await lj.privateBootstrapBounds("preprod")).toEqual({ most: 96, back: "1500000" });
    // At half as dear again a byte, the way back's Seedelf output needs more than a large deposit's change leaves with
    // 1.5 ₳ beside it, which held a Bootstrap to 68 classic boxes. Priced from the parameters, the reserve is 1.8 ₳, and
    // one deposit's most still goes (1.7.0; core's test has a token pool's too: this fixture's token box is below the
    // network's least at that price, so it takes no new box at all).
    t.koios.params = { coins_per_utxo_size: "6465", epoch_no: 291 };
    expect(await lj.privateBootstrapBounds("preprod")).toEqual({ most: 96, back: "1800000" });
    // Its funding carries that reserve, as its review says: one box of 10 ₳, the deposit's 1.5 ₳ and the way back's.
    const funded = await sessions.mixOutBuild("preprod", 1, { bootstrap: true });
    expect(funded.bootstrapReserve).toBe("1800000");
    expect(funded.payments.map((p) => p.lovelace)).toEqual(["13300000"]);
    // Past one deposit's most, refused before anything is built: never a session funded, then come back without a box.
    const asked = t.collateral.asked.length;
    await expect(sessions.mixOutBuild("preprod", 97, { bootstrap: true })).rejects.toThrow("Bootstrap 1 to 96 boxes at a time.");
    expect(t.collateral.asked.length).toBe(asked);
    expect(t.koios.submitted).toHaveLength(0);
  });

  it("still brings a 1.5.0 seed's box back by itself once someone else's mix moved it, as a Bootstrap's never does (34d's review 6)", async () => {
    /** A public Bootstrap of one classic box, its deposit in; then its record as 1.5.0 kept it, a seed's, when `old`. */
    const putIn = async (old: boolean) => {
      const t = await wallet();
      const lj = pooled(t);
      t.koios.addedToAccounts.push(atAccount("e1", "30000000"), atAccount("e5", "5000000"), ...POOL);
      const summary = await lj.publicBuild("preprod", 1, { bootstrap: true });
      await lj.publicSubmit("preprod", summary.txHash);
      t.koios.confirmations = 1;
      await lj.pumpPublic("preprod");
      // Home's watch saw its deposit on chain (pending.ts depositLanded): no read lists a box there before it's moved,
      // and only a deposit known to be in has boxes for a mix to move (1.6.0's release review, 316#0).
      await lj.landedDeposit("preprod", summary.entry);
      if (old) {
        // 1.5.0's record: the chain a seed's, and no list of mixes (its entries are made from the chains).
        const record = (await t.store.get<Sealed & Record<string, unknown>>("lovejoin.preprod"))!;
        const chain = record.chains.at(-1)!;
        delete chain.bootstrap;
        chain.seed = true;
        delete record.mixes;
        await t.store.set("lovejoin.preprod", record);
      }
      // Someone else's mix moved its box, hours ago.
      const moved = { ...(await tokenBox(t, "f9", true, 7)), address: POOL[0]!.address, payment_cred: POOL[0]!.payment_cred, value: POOL[0]!.value, asset_list: [] };
      madeByMix(t.koios, moved.tx_hash);
      t.koios.addedToAccounts.push(moved as KoiosUtxo);
      // The wallet unlocked an hour ago; this run reads the pool as an unlock's does, and a box that may come back
      // gets its due time.
      await t.wallet.withKeys(() => t.session.set(SESSION_UNLOCKED_AT, t.clock.now - HOUR));
      await lj.withdrawDue("preprod", true);
      const record = await sealed(t);
      const due = [...record.due];
      // Its time comes, drawn at this unlock, the deposit's send long enough ago (QUIET_AFTER_SEND_MS): the alarm's run.
      t.clock.now += 6 * 60_000;
      const at = t.clock.now - 60_000;
      await t.store.set("lovejoin.preprod", { ...record, due: due.map(() => at), marks: { [at]: { unlock: true } } });
      const before = t.koios.submitted.length;
      const sent = await lj.withdrawDue("preprod", false, t.clock.now - 1);
      return { due, sent, spent: t.koios.submitted.slice(before).flatMap((tx) => txInputs(tx)), box: `${moved.tx_hash}#0` };
    };
    const seed = await putIn(true);
    expect(seed.due).toHaveLength(1);
    expect(seed.sent).toHaveLength(1);
    expect(seed.spent).toContain(seed.box);
    const bootstrap = await putIn(false);
    expect(bootstrap.due).toHaveLength(0);
    expect(bootstrap.sent).toEqual([]);
    expect(bootstrap.spent).not.toContain(bootstrap.box);
  });
});

/**
 * What funding `id` (submitted) paid session 0's account, as Koios lists it there once it lands: read from the
 * transaction, never what a test supposes it pays (1.6.0's release review, x-compat#0: a 5 ₳ the fixtures landed hid
 * a Bootstrap's funding that paid none). `token`: what the output carrying a token pool's token holds of it.
 */
function landed(t: T, id: string, token?: ReturnType<typeof ljtest>): KoiosUtxo[] {
  const bytes = t.koios.submitted.find((b) => txIdOf(b) === id);
  if (!bytes) throw new Error(`not submitted: ${id}`);
  return builtOutputs(bytes).flatMap((o, i) =>
    o.address.slice(2, 58) === sessionSwap.keyHash ? [atSession(id, i, o.lovelace.toString(), o.tokens && token ? [token] : [])] : [],
  );
}

/** A UTxO at session 0's account, as Koios lists it. */
function atSession(tx_hash: string, tx_index: number, value: string, assets: Array<ReturnType<typeof ljtest>> = []): KoiosUtxo {
  return {
    tx_hash,
    tx_index,
    address: sessionSwap.address,
    value,
    stake_address: null,
    payment_cred: sessionSwap.keyHash,
    epoch_no: 315,
    block_height: 5_000_000,
    block_time: 1_800_000_000,
    datum_hash: null,
    inline_datum: null,
    reference_script: null,
    is_spent: false,
    asset_list: assets.map((a) => ({ ...a, decimals: 0, fingerprint: "asset1ljtest" })) as never,
  } as KoiosUtxo;
}

/** The runner for mixes from the private balance, giveme.my and the one-time key's signatures stood in for. */
function runner(t: T, lj: LovejoinService): SessionService {
  const wasm = loadTestWasm();
  return new SessionService({
    ...t.deps,
    wasm: {
      ...wasm,
      signScriptSpend: (_key: unknown, request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
    lovejoin: lj,
    sleep: async () => undefined,
  });
}

describe("a mix from the private balance into a token pool (chunk 34's 34d)", SLOW, () => {
  it("funds its one-time account with the token beside the ADA, deposits both, and mixes in that pool alone", async () => {
    const t = await wallet();
    const lj = pooled(t);
    // The private balance holds LJTEST, two boxes' worth, beside its ADA.
    t.koios.added.push({
      ...ownedUtxos[0]!,
      tx_hash: "d1".repeat(32),
      tx_index: 0,
      value: "30000000",
      inline_datum: { bytes: await datum(t, true), value: {} },
      asset_list: [{ ...ljtest(2n * Q), decimals: 0, fingerprint: "asset1ljtest" } as never],
    } as KoiosUtxo);
    t.koios.addedToAccounts.push(...POOL, ...(await strangers(t)));
    const sessions = runner(t, lj);
    const out = await sessions.mixOutBuild("preprod", 1, { pool: TOKEN });
    expect(out.mix).toMatchObject({ pool: TOKEN, boxes: 1, token: { policyId: VIEW.token.policyId, quantity: Q.toString() } });
    expect(out.payments[0]!.tokens).toEqual([{ policyId: VIEW.token.policyId, assetName: VIEW.token.assetName, quantity: Q.toString() }]);
    await sessions.mixOutSubmit("preprod", out.txHash);
    const book = (await t.store.get<{ sessions: Array<{ mix?: { pool?: string } }> }>("sessions.preprod"))!;
    expect(book.sessions[0]!.mix).toMatchObject({ boxes: 1, pool: TOKEN });

    // The funding lands: the boxes' ADA and their LJTEST in one UTxO, and the collateral.
    t.koios.addedToAccounts.push(atSession(out.txHash, 0, out.mix.lovelace, [ljtest(Q)]), atSession(out.txHash, 1, "5000000"));
    t.koios.confirmations = 1;
    const before = t.koios.submitted.length;
    await sessions.advance("preprod", 0, true);
    const chain = t.koios.submitted.slice(before);
    // The deposit, one box two waves deep, and the rest back.
    expect(chain).toHaveLength(6);
    expect(txInputs(chain[0]!)).toContain(`${out.txHash}#0`);
    expect(Buffer.from(chain[0]!).toString("hex")).toContain(VIEW.mixBoxHash);
    const classic = new Set(POOL.map((u) => `${u.tx_hash}#${u.tx_index}`));
    expect(chain.flatMap((tx) => txInputs(tx)).filter((o) => classic.has(o))).toEqual([]);
    const s = await sealed(t);
    expect(s.chains.at(-1)).toMatchObject({ pools: { [TOKEN]: 1 } });
    expect(s.chains.at(-1)!.leaves.map((l) => l.pool)).toEqual([TOKEN]);
    expect(s.pools![TOKEN]!.due).toHaveLength(1);
    expect(s.due).toHaveLength(0);
  });

  it("funds its one-time account with the boxes' ADA and their token together", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, ...(await strangers(t)));
    const sessions = new SessionService({
      ...t.deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      store: t.store,
      minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
      lovejoin: lj,
      sleep: async () => undefined,
    });
    const funding = await lj.funding("preprod", 1, false, undefined, TOKEN);
    expect(funding).toMatchObject({ pool: TOKEN, token: { policyId: VIEW.token.policyId, quantity: Q.toString() } });
    // The private balance holds no LJTEST: said as a shortfall, before anything is sent.
    await expect(sessions.mixOutBuild("preprod", 1, { pool: TOKEN })).rejects.toThrow();
  });

  it("reads the parameters once in its review, as a swap's does, whichever pool and whether a Bootstrap (1.6.0's release review, 318-worker#3)", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.added.push({
      ...ownedUtxos[0]!,
      tx_hash: "d1".repeat(32),
      tx_index: 0,
      value: "60000000",
      inline_datum: { bytes: await datum(t, true), value: {} },
      asset_list: [{ ...ljtest(2n * Q), decimals: 0, fingerprint: "asset1ljtest" } as never],
    } as KoiosUtxo);
    t.koios.addedToAccounts.push(...POOL, ...(await strangers(t)));
    const sessions = runner(t, lj);
    const read = () => t.koios.calls.filter((c) => c.path === "epoch_params").length;
    // Whether the token pool takes a box, what its collateral's mix adds, and the funding itself: one read for all three.
    // They could straddle an epoch's end, the least checked under one epoch's parameters and built under another's.
    for (const asked of [{ pool: TOKEN }, {}, { bootstrap: true }, { pool: TOKEN, bootstrap: true }]) {
      const before = read();
      await sessions.mixOutBuild("preprod", 1, asked);
      expect(read() - before, JSON.stringify(asked)).toBe(1);
    }
  });
});

/** A launch as WebAssembly builds it: what the tests read of it. */
type LaunchBuilt = { txHash: string; pool: { id: string }; locked: { deposit: string }; mixLogicStake: string };

describe("a pool's start (chunk 34's 34d)", SLOW, () => {
  /**
   * The launch service, with these pools shown already (and those a look finds), and every launch WebAssembly built
   * from the public account, by whether it registers mix_logic's credential: `alter` may change what one says.
   */
  const launching = (
    t: T,
    known: FoundPool[] = [],
    { look, alter }: { look?: () => Promise<void>; alter?: (built: LaunchBuilt, register: boolean) => LaunchBuilt } = {},
  ) => {
    const wasm = loadTestWasm();
    const builds: Array<{ register: boolean; built: LaunchBuilt }> = [];
    const kept = (request: string, made: string) => {
      const { register } = JSON.parse(request) as { register: boolean };
      const built = alter ? alter(JSON.parse(made) as LaunchBuilt, register) : (JSON.parse(made) as LaunchBuilt);
      builds.push({ register, built });
      return JSON.stringify(built);
    };
    const service = new LovejoinLaunchService({
      ...t.deps,
      wasm: {
        ...wasm,
        buildLovejoinLaunchFromAccount: (key: Parameters<typeof wasm.buildLovejoinLaunchFromAccount>[0], request: string) =>
          kept(request, wasm.buildLovejoinLaunchFromAccount(key, request)),
        buildLovejoinLaunch: (key: Parameters<typeof wasm.buildLovejoinLaunch>[0], request: string) => kept(request, wasm.buildLovejoinLaunch(key, request)),
        // giveme.my's witness stood in for: the one-time key's signature is checked by hash alone.
        signScriptSpend: (_key: unknown, request: string) => {
          const { txCbor } = JSON.parse(request) as { txCbor: string };
          return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
        },
      } as typeof wasm,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      lovejoin: t.lovejoin,
      discovery: { known: async () => known, look: look ?? (async () => undefined) },
    });
    return Object.assign(service, { builds });
  };
  const min = { policyId: MIN.policy, assetName: MIN.name };
  /** Koios's calls naming `stake` in an account_info. */
  const askedOf = (t: T, stake: string) => t.koios.calls.filter((c) => c.path === "account_info" && (c.body._stake_addresses as string[]).includes(stake));
  /** `stake` registered, as Koios's account_info says. */
  const registered = (t: T, stake: string) => t.koios.stakes.set(stake, { stake_address: stake, status: "registered" } as never);

  it("says what a box may hold, and the token's pools there are to join", async () => {
    const t = await wallet();
    const shown: FoundPool = {
      id: "cd".repeat(28),
      boxLovelace: "4500000",
      token: { ...min, quantity: "100000000" },
      ref: TOKEN_POOL,
      launch: { block: 1, index: 0, tx: "aa".repeat(32) },
    };
    const terms = await launching(t, [shown]).terms("preprod", min, "100000000");
    expect(BigInt(terms.least)).toBeGreaterThan(3_000_000n);
    expect(terms.suggested).toBe("4500000");
    expect(terms.most).toBe("9000000");
    expect(terms.pools).toEqual([{ id: shown.id, boxLovelace: "4500000", token: shown.token }]);
    // An ADA pool has no most, and none of the token's pools.
    const ada = await launching(t, [shown]).terms("preprod");
    expect(ada.most).toBeUndefined();
    expect(ada.pools).toEqual([]);
  });

  it("says what a box of one token may hold, and refuses none before WebAssembly (1.6.0's release review, MONEY-2)", async () => {
    const t = await wallet();
    // "1" as the creator types it (SNEK and HOSKY have no decimals): it trapped, which locked the wallet.
    const one = await launching(t).terms("preprod", min, "1");
    expect(BigInt(one.least)).toBeLessThan(3_830_000n);
    expect(one.suggested).toBe("4000000");
    await expect(launching(t).terms("preprod", min, "0")).rejects.toThrow("whole number above zero");
  });

  it("refuses what isn't a pool to start, before anything is built", async () => {
    const t = await wallet();
    const shown: FoundPool = {
      id: "cd".repeat(28),
      boxLovelace: "4500000",
      token: { ...min, quantity: "1000" },
      ref: TOKEN_POOL,
      launch: { block: 1, index: 0, tx: "aa".repeat(32) },
    };
    const launch = launching(t, [shown]);
    const build = (payload: { token?: typeof min; quantity?: string; boxLovelace: string }) => launch.build("preprod", { from: "public", ...payload });
    // A token off the list: LJTEST.
    await expect(build({ token: { policyId: VIEW.token.policyId, assetName: VIEW.token.assetName }, quantity: "1", boxLovelace: "4500000" })).rejects.toThrow(
      "token list",
    );
    await expect(build({ token: min, quantity: "0", boxLovelace: "4500000" })).rejects.toThrow("whole number above zero");
    // A copy of a shown pool's values.
    await expect(build({ token: min, quantity: "1000", boxLovelace: "4500000" })).rejects.toThrow("exists already");
    // The classic pool's value, as an ADA pool.
    await expect(build({ boxLovelace: "10000000" })).rejects.toThrow("classic pool's value");
    // Too little to come back, too much for a token pool.
    await expect(build({ token: min, quantity: "1000", boxLovelace: "2000000" })).rejects.toThrow("at least");
    await expect(build({ token: min, quantity: "1000", boxLovelace: "9500000" })).rejects.toThrow("at most 9");
    expect(launch.builds).toEqual([]);
  });

  it("never pays from the public account unless asked to (34d's review 8)", async () => {
    const t = await wallet();
    t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"));
    const launch = launching(t);
    const asked = t.koios.calls.length;
    for (const from of [undefined, "", "account", "Public"]) {
      await expect(launch.build("preprod", { from: from as never, boxLovelace: "25000000" })).rejects.toThrow(
        "Choose what pays for the pool's start",
      );
    }
    // Nothing read, nothing built.
    expect(t.koios.calls.length).toBe(asked);
    expect(launch.builds).toEqual([]);
  });

  it("looks for pools launched since before it calls a start a copy (34d's review 5)", async () => {
    const t = await wallet();
    t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"));
    const shown: FoundPool[] = [];
    let looked = 0;
    // A pool of the same values, launched since discovery last looked: the look finds it.
    const look = async () => {
      looked++;
      shown.push({ id: "cd".repeat(28), boxLovelace: "25000000", ref: TOKEN_POOL, launch: { block: 2, index: 0, tx: "bb".repeat(32) } });
    };
    const launch = launching(t, shown, { look });
    await expect(launch.build("preprod", { from: "public", boxLovelace: "25000000" })).rejects.toThrow("exists already");
    expect(looked).toBe(1);
    expect(launch.builds).toEqual([]);
  });

  it("starts a pool from the public account, and names its pool to Koios only at Send (34d's review 7)", async () => {
    const t = await wallet();
    t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"));
    const launch = launching(t);
    const summary = await launch.build("preprod", { from: "public", token: min, quantity: "1000", boxLovelace: "4500000" });
    expect(summary).toMatchObject({ from: "public", pool: { boxLovelace: "4500000", token: { ...min, quantity: "1000" } } });
    expect(BigInt(summary.locked.total)).toBeGreaterThan(23_000_000n);
    // Built twice, the same pool: registering its credential, which the review shows, and without the certificate.
    expect(launch.builds.map((b) => b.register)).toEqual([true, false]);
    const [withCert, bare] = launch.builds.map((b) => b.built) as [LaunchBuilt, LaunchBuilt];
    expect(bare.pool.id).toBe(withCert.pool.id);
    expect(summary.txHash).toBe(withCert.txHash);
    expect(BigInt(summary.locked.deposit)).toBe(2_000_000n);
    // The review asked Koios nothing that names the token or the pool.
    expect(t.koios.calls.some((c) => c.path === "asset_info")).toBe(false);
    expect(askedOf(t, withCert.mixLogicStake)).toEqual([]);

    const before = t.koios.calls.length;
    const pending = await launch.submit("preprod", summary.txHash);
    expect(pending).toMatchObject({ kind: "lovejoin-launch", txHash: summary.txHash });
    // Send asked, then sent: whether something registered the credential, and nothing of the token (call 35).
    const sentAt = t.koios.calls.findIndex((c, i) => i >= before && c.path === "submittx");
    const askedAt = t.koios.calls.findIndex((c, i) => i >= before && c.path === "account_info");
    expect(askedAt).toBeGreaterThanOrEqual(before);
    expect(askedAt).toBeLessThan(sentAt);
    expect(askedOf(t, withCert.mixLogicStake)).toHaveLength(1);
    expect(t.koios.calls.some((c) => c.path === "asset_info")).toBe(false);
    const sent = t.koios.submitted.at(-1)!;
    expect(txIdOf(sent)).toBe(summary.txHash);
    expect(Buffer.from(sent).toString("hex")).toContain(HOLDER);
    // With its values, so a start of the same ones before a look finds it says so (1.6.0's release review, 318-worker#1).
    expect((await sealed(t)).launches).toEqual([
      { id: summary.pool.id, txHash: summary.txHash, from: "public", account: 0, at: t.clock.now, box: { lovelace: "4500000", token: { ...min, quantity: "1000" } } },
    ]);
    // Kept for Send no more.
    expect(await t.wallet.withKeys(() => t.session.get(SESSION_LOVEJOIN_LAUNCH))).toBeUndefined();
  });

  it("starts a pool whatever its token's supply, and asks no one about it (the owner, 2026-10-19, call 35)", async () => {
    // Decision 14's 30 boxes' worth within the token's supply was a guard against a typo, nothing the contracts need,
    // and a request naming the token: gone. A box of 2^63 is more than any token's supply holds 30 of, and more than
    // one output holds 30 of: it's the creator's to read on the review.
    const t = await wallet();
    t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"));
    const launch = launching(t);
    const quantity = (2n ** 63n).toString();
    const summary = await launch.build("preprod", { from: "public", token: min, quantity, boxLovelace: "4500000" });
    expect(summary.pool.token).toEqual({ ...min, quantity });
    const pending = await launch.submit("preprod", summary.txHash);
    expect(pending.txHash).toBe(summary.txHash);
    expect(txIdOf(t.koios.submitted.at(-1)!)).toBe(summary.txHash);
    // Neither Koios nor anyone else was asked of the token's supply, at review or at Send.
    expect(t.koios.calls.some((c) => c.path === "asset_info")).toBe(false);
  });

  it("sends the start without the certificate when something registered the credential already", async () => {
    const t = await wallet();
    t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"));
    const launch = launching(t);
    const summary = await launch.build("preprod", { from: "public", boxLovelace: "25000000" });
    expect(summary.pool.token).toBeUndefined();
    const [withCert, bare] = launch.builds.map((b) => b.built) as [LaunchBuilt, LaunchBuilt];
    expect(withCert.locked.deposit).toBe("2000000");
    expect(bare.locked.deposit).toBe("0");
    // Registered between the review and Send: the same pool goes, without the certificate.
    registered(t, withCert.mixLogicStake);
    const pending = await launch.submit("preprod", summary.txHash);
    expect(pending.txHash).toBe(bare.txHash);
    expect(txIdOf(t.koios.submitted.at(-1)!)).toBe(bare.txHash);
    expect((await sealed(t)).launches).toMatchObject([{ id: summary.pool.id, txHash: bare.txHash, from: "public" }]);
  });

  it("starts a pool from the private balance, and sends the build Send chose with its own one-time key", async () => {
    const t = await wallet();
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    t.koios.added.push({
      ...ownedUtxos[0]!,
      tx_hash: "d2".repeat(32),
      tx_index: 0,
      value: "60000000",
      inline_datum: { bytes: await datum(t, true), value: {} },
      asset_list: [],
    } as KoiosUtxo);
    const launch = launching(t);
    const summary = await launch.build("preprod", { from: "private", boxLovelace: "25000000" });
    expect(summary).toMatchObject({ from: "private", locked: { deposit: "2000000" } });
    const [withCert, bare] = launch.builds.map((b) => b.built) as [LaunchBuilt, LaunchBuilt];
    expect(bare.pool.id).toBe(withCert.pool.id);
    // Nothing was asked of giveme.my at review, and nothing names the pool to Koios.
    expect(t.collateral.asked).toHaveLength(0);
    expect(askedOf(t, withCert.mixLogicStake)).toEqual([]);
    registered(t, withCert.mixLogicStake);
    const pending = await launch.submit("preprod", summary.txHash);
    expect(pending).toMatchObject({ kind: "lovejoin-launch", txHash: bare.txHash });
    expect(txIdOf(t.koios.submitted.at(-1)!)).toBe(bare.txHash);
    expect(t.collateral.asked).toHaveLength(1);
    expect((await sealed(t)).launches).toMatchObject([{ id: summary.pool.id, txHash: bare.txHash, from: "private" }]);
  });

  it("never sends another pool than the one reviewed, unless its credential is registered too (34d's review 4)", async () => {
    // Built without the deposit, the start spends another seed: another pool, with a credential of its own.
    const other = (built: LaunchBuilt, register: boolean): LaunchBuilt =>
      register ? built : { ...built, pool: { ...built.pool, id: "ef".repeat(28) }, mixLogicStake: "stake_test17otherpoolscredential" };
    const t = await wallet();
    t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"));
    const launch = launching(t, [], { alter: other });
    const summary = await launch.build("preprod", { from: "public", boxLovelace: "25000000" });
    const [withCert, bare] = launch.builds.map((b) => b.built) as [LaunchBuilt, LaunchBuilt];
    registered(t, withCert.mixLogicStake);
    // Another pool nothing registered: no wallet would show it, and its ADA would be locked for good.
    await expect(launch.submit("preprod", summary.txHash)).rejects.toThrow("make a different pool");
    expect(askedOf(t, bare.mixLogicStake)).toHaveLength(1);
    expect(t.koios.submitted).toHaveLength(0);
    expect((await sealed(t))?.launches).toBeUndefined();
    // Registered too, it's as standard as the one reviewed, and it's sent, as Send was asked for the review's hash.
    registered(t, bare.mixLogicStake);
    const pending = await launch.submit("preprod", summary.txHash);
    expect(pending.txHash).toBe(bare.txHash);
    expect((await sealed(t)).launches).toMatchObject([{ id: "ef".repeat(28), txHash: bare.txHash }]);
  });

  it("says on the review that the wallet started a pool of these values no look has found yet, and refuses nothing (1.6.0's release review, 318-worker#1)", async () => {
    const t = await wallet();
    t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e2", "40000000"), atAccount("e5", "5000000"));
    const launch = launching(t);
    const first = await launch.build("preprod", { from: "public", token: min, quantity: "1000", boxLovelace: "4500000" });
    expect(first.startedBefore).toBeUndefined();
    await launch.submit("preprod", first.txHash);
    const sentAt = t.clock.now;
    // Five minutes on, no look has found it: a look takes a launch only once it's settled, about ten minutes after its
    // block. Started again, one of the two lands after the other, a copy no wallet shows, its ADA locked for good: the
    // chain takes it, so the review says so, and nothing is refused.
    t.clock.now += 5 * 60_000;
    const again = await launch.build("preprod", { from: "public", token: min, quantity: "1000", boxLovelace: "4500000" });
    expect(again.startedBefore).toEqual({ txHash: first.txHash, at: sentAt });
    // Other values are another pool: a box's ADA, or its token's quantity.
    expect((await launch.build("preprod", { from: "public", token: min, quantity: "1000", boxLovelace: "5000000" })).startedBefore).toBeUndefined();
    expect((await launch.build("preprod", { from: "public", token: min, quantity: "2000", boxLovelace: "4500000" })).startedBefore).toBeUndefined();
    expect((await launch.build("preprod", { from: "public", boxLovelace: "4500000" })).startedBefore).toBeUndefined();
    // A day on, a start no look found never will be (a copy that lost the race, a rollback): nothing to say of it.
    t.clock.now = sentAt + 24 * HOUR;
    await t.wallet.unlock(PASSWORD);
    expect((await launch.build("preprod", { from: "public", token: min, quantity: "1000", boxLovelace: "4500000" })).startedBefore).toBeUndefined();
  });

  it("reads the parameters once in its review, from either side (1.6.0's release review, 318-worker#3)", async () => {
    const t = await wallet();
    t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"));
    t.koios.added.push({
      ...ownedUtxos[0]!,
      tx_hash: "d2".repeat(32),
      tx_index: 0,
      value: "60000000",
      inline_datum: { bytes: await datum(t, true), value: {} },
      asset_list: [],
    } as KoiosUtxo);
    const launch = launching(t);
    const read = () => t.koios.calls.filter((c) => c.path === "epoch_params").length;
    // A box's least and most, and the start built from the private balance or the public account, under one epoch's.
    for (const from of ["private", "public"] as const) {
      const before = read();
      await launch.build("preprod", { from, token: min, quantity: "1000", boxLovelace: "4500000" });
      expect(read() - before, from).toBe(1);
    }
  });

  it("says a start Send sent in its review's place went already, never to review it again (1.6.0's release review, 318-worker#1)", async () => {
    const t = await wallet();
    t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"));
    const launch = launching(t);
    const summary = await launch.build("preprod", { from: "public", boxLovelace: "25000000" });
    const [withCert, bare] = launch.builds.map((b) => b.built) as [LaunchBuilt, LaunchBuilt];
    registered(t, withCert.mixLogicStake);
    expect((await launch.submit("preprod", summary.txHash)).txHash).toBe(bare.txHash);
    // Send pressed again on the review, from a page that missed the answer: its kept copy is gone, and the hash asked
    // for is the review's. A review built again would make a copy of the pool sent.
    await expect(launch.submit("preprod", summary.txHash)).rejects.toThrow(tr("worker.spend.sentAlready"));
    expect(t.koios.submitted).toHaveLength(1);
  });
});

describe("the escape hatch (chunk 34's §2, as built in 34d)", SLOW, () => {
  it("holds a stuck pool's due box, says so, and brings one back with the public account paying", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const mine = await tokenBox(t, "f1", true, 7);
    t.koios.addedToAccounts.push(atAccount("e1", "20000000"), atAccount("e5", "5000000"), ...POOL, mine, ...(await strangers(t)));
    // Its box came due a minute ago, the wallet unlocked an hour ago with that unlock's draws made.
    await t.wallet.withKeys(() => t.session.set(SESSION_UNLOCKED_AT, t.clock.now - HOUR));
    await t.store.set("lovejoin.preprod", { due: [], chains: [], pools: { [TOKEN]: { due: [t.clock.now - 60_000] } }, unlock: t.clock.now - HOUR });
    // A byte now costs three times as much: a 2 ₳ box can't pay its own way back.
    t.koios.params = { coins_per_utxo_size: "12930" };
    const before = t.collateral.asked.length;
    expect(await lj.withdrawDue("preprod", false, t.clock.now - 1)).toEqual([]);
    // Nothing built for giveme.my, and its due time put off for hours.
    expect(t.collateral.asked.length).toBe(before);
    const due = (await sealed(t)).pools![TOKEN]!.due;
    expect(due).toHaveLength(1);
    expect(due[0]!).toBeGreaterThanOrEqual(t.clock.now + STUCK_WAIT_MS);
    // The page is told why.
    const status = await lj.status("preprod");
    expect(status.pools![0]!.cantComeBack).toMatchObject({ has: expect.any(String), needs: expect.any(String) });
    // The public account pays to bring it back: its UTxO beside the box, no giveme.my.
    await t.balances.get("preprod");
    const pending = await lj.withdrawNow("preprod", { txHash: mine.tx_hash, txIndex: 0, pool: TOKEN }, false, true);
    expect(pending.kind).toBe("lovejoin-withdraw");
    expect(t.collateral.asked.length).toBe(before);
    const sent = t.koios.submitted.at(-1)!;
    const inputs = txInputs(sent);
    expect(inputs).toContain(`${mine.tx_hash}#0`);
    expect(inputs.some((o) => o.startsWith("e1".repeat(32)))).toBe(true);
    // It spent the account too: the next reading reads both sides, as it sends and as it lands (34d's review 9).
    expect(await t.session.get(SESSION_BALANCES_PREFIX + "preprod")).toBeUndefined();
    await t.balances.get("preprod");
    t.koios.confirmations = 1;
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: pending.txHash, confirmations: 1 });
    expect(await t.session.get(SESSION_BALANCES_PREFIX + "preprod")).toBeUndefined();
  });
});

describe("what Activity calls the public account's Lovejoin transactions (chunk 34's 34d)", () => {
  const me = (value: string, assets: KoiosTxOut["asset_list"] = []) =>
    ({ payment_addr: { bech32: "addr_test1me", cred: "aa".repeat(28) }, value, asset_list: assets }) as unknown as KoiosTxOut;
  const at = (cred: string, value: string, assets: KoiosTxOut["asset_list"] = []) =>
    ({ payment_addr: { bech32: "addr_test1wscript", cred }, value, asset_list: assets }) as unknown as KoiosTxOut;
  const tx = (n: number, inputs: KoiosTxOut[], outputs: KoiosTxOut[]) =>
    ({ tx_hash: n.toString(16).repeat(64).slice(0, 64), tx_timestamp: 1_800_000_000, fee: "200000", inputs, outputs }) as unknown as KoiosTxInfo;
  const ours = (o: KoiosTxOut) => (o as { payment_addr: { cred?: string } }).payment_addr.cred === "aa".repeat(28);
  const token = [{ policy_id: VIEW.token.policyId, asset_name: VIEW.token.assetName, quantity: Q.toString() }] as KoiosTxOut["asset_list"];
  const boxes = new Set([NETWORKS.preprod.lovejoin!.mixBox, VIEW.mixBoxHash]);

  it("names a token pool's deposit and mix as the classic pool's", () => {
    const deposit = tx(1, [me("20000000", token)], [at(VIEW.mixBoxHash, "2000000", token), me("17800000")]);
    const mix = tx(2, [at(VIEW.mixBoxHash, "2000000", token), me("5000000")], [at(VIEW.mixBoxHash, "2000000", token), me("4100000")]);
    const named = describeTxs([deposit, mix], ours, new Map(), undefined, undefined, boxes);
    expect(named.map((e) => e.kind)).toEqual(["lovejoin-deposit", "lovejoin-round"]);
    expect(named[0]!.assets).toEqual([{ policyId: VIEW.token.policyId, assetName: VIEW.token.assetName, quantity: (-Q).toString() }]);
  });

  it("names a pool's start, and a box the account paid to bring back", () => {
    const nft = [{ policy_id: "cd".repeat(28), asset_name: LOVEJOIN_NFT, quantity: "1" }] as KoiosTxOut["asset_list"];
    const launch = tx(3, [me("40000000")], [at(HOLDER, "1700000", nft), at(HOLDER, "3600000"), at(HOLDER, "15800000"), me("16300000")]);
    const back = tx(4, [at(VIEW.mixBoxHash, "2000000", token), me("10000000")], [at("bb".repeat(28), "2400000", token), me("9300000")]);
    const named = describeTxs([launch, back], ours, new Map(), undefined, undefined, boxes);
    expect(named.map((e) => e.kind)).toEqual(["lovejoin-launch", "lovejoin-back-paid"]);
  });

  it("reads every pool's mix box the wallet reads, from the device", async () => {
    const t = await wallet();
    expect(await pooled(t).mixBoxes("preprod")).toEqual([NETWORKS.preprod.lovejoin!.mixBox, VIEW.mixBoxHash]);
    expect(CLASSIC).toBe("classic");
  });
});
