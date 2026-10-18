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
import { SESSION_UNLOCKED_AT } from "../src/background/wallet";
import tokenList from "../src/tokens/list.json";
import { NETWORKS } from "../src/networks";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { koiosPreprod, loadTestWasm, ownedUtxos, sessionSwap, testBalances, vectors } from "./fakes";

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

describe("a pool's start (chunk 34's 34d)", SLOW, () => {
  /** The launch service, with these pools shown already. */
  const launching = (t: T, known: FoundPool[] = []) =>
    new LovejoinLaunchService({
      ...t.deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      lovejoin: t.lovejoin,
      discovery: { known: async () => known },
    });
  const min = { policyId: MIN.policy, assetName: MIN.name };

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
    t.koios.supplies.set(MIN.policy + MIN.name, "1000000000");
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
    // 30 boxes' worth must exist: 10^9 holds 30 of 3·10^7, not of 10^8.
    await expect(build({ token: min, quantity: "100000000", boxLovelace: "4500000" })).rejects.toThrow("Fewer than 30 boxes' worth");
    // Koios knowing no supply is no supply.
    t.koios.supplies.clear();
    await expect(build({ token: min, quantity: "1000", boxLovelace: "4500000" })).rejects.toThrow("doesn't know this token's supply");
    t.koios.supplies.set(MIN.policy + MIN.name, "1000000000");
    // A copy of a shown pool's values.
    await expect(build({ token: min, quantity: "1000", boxLovelace: "4500000" })).rejects.toThrow("exists already");
    // The classic pool's value, as an ADA pool.
    await expect(build({ boxLovelace: "10000000" })).rejects.toThrow("classic pool's value");
    // Too little to come back, too much for a token pool.
    await expect(build({ token: min, quantity: "1000", boxLovelace: "2000000" })).rejects.toThrow("at least");
    await expect(build({ token: min, quantity: "1000", boxLovelace: "9500000" })).rejects.toThrow("at most 9");
  });

  it("starts a pool from the public account, signed at review, and keeps that the wallet started it", async () => {
    const t = await wallet();
    t.koios.supplies.set(MIN.policy + MIN.name, "1000000000");
    t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"));
    const launch = launching(t);
    const summary = await launch.build("preprod", { from: "public", token: min, quantity: "1000", boxLovelace: "4500000" });
    expect(summary).toMatchObject({ from: "public", pool: { boxLovelace: "4500000", token: { ...min, quantity: "1000" } } });
    expect(BigInt(summary.locked.total)).toBeGreaterThan(23_000_000n);
    // Registered in the launch: nothing had registered its credential.
    expect(BigInt(summary.locked.deposit)).toBe(2_000_000n);
    expect(t.koios.calls.some((c) => c.path === "asset_info")).toBe(true);
    expect(t.koios.calls.some((c) => c.path === "account_info")).toBe(true);
    const pending = await launch.submit("preprod", summary.txHash);
    expect(pending).toMatchObject({ kind: "lovejoin-launch", txHash: summary.txHash });
    const sent = t.koios.submitted.at(-1)!;
    expect(txIdOf(sent)).toBe(summary.txHash);
    expect(Buffer.from(sent).toString("hex")).toContain(HOLDER);
    expect((await sealed(t)).launches).toEqual([{ id: summary.pool.id, txHash: summary.txHash, from: "public", account: 0, at: t.clock.now }]);
    // Kept for Send no more.
    expect(await t.wallet.withKeys(() => t.session.get(SESSION_LOVEJOIN_LAUNCH))).toBeUndefined();
  });

  it("builds without the certificate when something registered the credential already", async () => {
    const t = await wallet();
    t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"));
    // Every stake address Koios is asked about reads as registered.
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      if (!url.includes("/account_info")) return real(url, init);
      const body = JSON.parse(String(init.body)) as { _stake_addresses: string[] };
      return Response.json(body._stake_addresses.map((stake_address) => ({ stake_address, status: "registered" })));
    };
    const summary = await launching(t).build("preprod", { from: "public", boxLovelace: "25000000" });
    expect(summary.locked.deposit).toBe("0");
    expect(summary.pool.token).toBeUndefined();
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
    const pending = await lj.withdrawNow("preprod", { txHash: mine.tx_hash, txIndex: 0, pool: TOKEN }, false, true);
    expect(pending.kind).toBe("lovejoin-withdraw");
    expect(t.collateral.asked.length).toBe(before);
    const sent = t.koios.submitted.at(-1)!;
    const inputs = txInputs(sent);
    expect(inputs).toContain(`${mine.tx_hash}#0`);
    expect(inputs.some((o) => o.startsWith("e1".repeat(32)))).toBe(true);
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
