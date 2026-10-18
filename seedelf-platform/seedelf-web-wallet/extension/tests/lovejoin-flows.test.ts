// Chunk 34's 34d in the worker: the tile's flows into a token pool (from the
// public account and from the private balance), Bootstrap in place of the
// seed, a pool's start from either side and every check before it, the
// escape hatch for a pool whose boxes can't pay their own way back, and
// Activity naming what the public account did. With the real WebAssembly,
// the classic pool's recorded preprod boxes, and PR #163's preprod token pool
// (2 ₳ and LJTEST a box) standing in for any token pool.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { describe as describeTxs } from "../src/background/activity";
import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosTxInfo, KoiosTxOut, KoiosUtxo } from "../src/background/koios";
import { CLASSIC, LovejoinService, STUCK_WAIT_MS, type PoolRef } from "../src/background/lovejoin";
import { LovejoinLaunchService, SESSION_LOVEJOIN_LAUNCH } from "../src/background/lovejoin-launch";
import { HOLDER, LOVEJOIN_NFT, type FoundPool } from "../src/background/lovejoin-pools";
import { SessionService } from "../src/background/sessions";
import { Minswap } from "../src/background/minswap";
import { SESSION_BALANCES_PREFIX, SESSION_UNLOCKED_AT } from "../src/background/wallet";
import tokenList from "../src/tokens/list.json";
import { NETWORKS } from "../src/networks";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { koiosPreprod, loadTestWasm, madeByMix, ownedUtxos, sessionSwap, testBalances, vectors } from "./fakes";

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

    // Its funding lands, and the session runs (34d's review 6): its chain is recorded a Bootstrap's, held as the public
    // account's is, never a seed's.
    t.koios.addedToAccounts.push(atSession(out.txHash, 0, out.mix.lovelace), atSession(out.txHash, 1, "5000000"));
    t.koios.confirmations = 1;
    const before = t.koios.submitted.length;
    await sessions.advance("preprod", index, true);
    const deposit = t.koios.submitted.slice(before).find((tx) => txInputs(tx).includes(`${out.txHash}#0`));
    expect(deposit).toBeDefined();
    const s = await sealed(t);
    const chain = s.chains.at(-1)!;
    expect(chain).toMatchObject({ bootstrap: true, session: index });
    expect(chain.seed).toBeUndefined();
    expect(s.due).toHaveLength(0);
    expect(s.mixes!.at(-1)).toMatchObject({ id: chain.id, bootstrap: true, session: index, shares: [{ boxes: 1 }] });
  });

  it("caps a Bootstrap from the private balance at what its funding's reserve pays the deposit for (34d's review 3)", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const sessions = runner(t, lj);
    // Measured by building the deposit: fewer than one deposit's room, and fewer in a token pool, whose boxes are longer.
    const classic = await lj.privateBootstrapMost("preprod");
    const token = await lj.privateBootstrapMost("preprod", TOKEN);
    expect(classic).toBeGreaterThanOrEqual(40);
    expect(classic).toBeLessThan(96);
    expect(token).toBeLessThan(classic);
    // Refused before anything is built: never a session funded, then come back without a box, its fees spent.
    const asked = t.collateral.asked.length;
    await expect(sessions.mixOutBuild("preprod", classic + 1, { bootstrap: true })).rejects.toThrow(`Bootstrap 1 to ${classic} boxes at a time.`);
    await expect(sessions.mixOutBuild("preprod", token + 1, { pool: TOKEN, bootstrap: true })).rejects.toThrow(
      `Bootstrap 1 to ${token} boxes at a time.`,
    );
    expect(t.collateral.asked.length).toBe(asked);
    expect(t.koios.submitted).toHaveLength(0);
    // From the public account, whose deposit draws on whatever the account holds, one deposit's room stays the cap.
    t.koios.addedToAccounts.push(atAccount("e1", "900000000"), atAccount("e5", "5000000"), ...POOL);
    const summary = await lj.publicBuild("preprod", classic + 1, { bootstrap: true });
    expect(summary).toMatchObject({ bootstrap: true, boxes: classic + 1 });
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

  it("starts a pool from the public account, and names its token and pool to Koios only at Send (34d's review 7)", async () => {
    const t = await wallet();
    t.koios.supplies.set(MIN.policy + MIN.name, "1000000000");
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
    // Send asked, then sent: the token's supply, and whether something registered the credential.
    const sentAt = t.koios.calls.findIndex((c, i) => i >= before && c.path === "submittx");
    const supplyAt = t.koios.calls.findIndex((c, i) => i >= before && c.path === "asset_info");
    expect(supplyAt).toBeGreaterThanOrEqual(before);
    expect(supplyAt).toBeLessThan(sentAt);
    expect(askedOf(t, withCert.mixLogicStake)).toHaveLength(1);
    const sent = t.koios.submitted.at(-1)!;
    expect(txIdOf(sent)).toBe(summary.txHash);
    expect(Buffer.from(sent).toString("hex")).toContain(HOLDER);
    expect((await sealed(t)).launches).toEqual([{ id: summary.pool.id, txHash: summary.txHash, from: "public", account: 0, at: t.clock.now }]);
    // Kept for Send no more.
    expect(await t.wallet.withKeys(() => t.session.get(SESSION_LOVEJOIN_LAUNCH))).toBeUndefined();
  });

  it("checks the token's supply at Send, and sends nothing when 30 boxes' worth don't exist", async () => {
    const t = await wallet();
    t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"));
    const launch = launching(t);
    // 10^9 holds 30 boxes of 3·10^7, not of 10^8.
    t.koios.supplies.set(MIN.policy + MIN.name, "1000000000");
    const short = await launch.build("preprod", { from: "public", token: min, quantity: "100000000", boxLovelace: "4500000" });
    await expect(launch.submit("preprod", short.txHash)).rejects.toThrow("Fewer than 30 boxes' worth");
    // Koios knowing no supply is no supply.
    t.koios.supplies.clear();
    const unknown = await launch.build("preprod", { from: "public", token: min, quantity: "1000", boxLovelace: "4500000" });
    await expect(launch.submit("preprod", unknown.txHash)).rejects.toThrow("doesn't know this token's supply");
    expect(t.koios.submitted).toHaveLength(0);
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
