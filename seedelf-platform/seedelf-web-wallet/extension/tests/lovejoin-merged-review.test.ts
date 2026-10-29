// 1.6.0's fix round two, in the worker: the merged fixes' review (MERGED-1, MERGED-5) and the preprod rehearsal's R10.
// A pool discovery hands over that the shown-pool rule leaves out, as an earlier launch of its values turned up after
// the device read it, is a copy: read for the boxes already in it, taking no new box, for good, and listed only where
// the wallet has something in it (decision 30). A restore reads every copy discovery keeps once, and hands over one
// where it finds the wallet's boxes. A look for pools says whether what the wallet reads changed (R10). A Bootstrap
// whose deposit a watch saw land keeps its hold (MERGED-5). With the real WebAssembly, the classic pool's recorded
// preprod boxes, and PR #163's preprod token pool (2 ₳ and LJTEST a box).
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import { DataParts } from "../src/background/data-layer";
import { handle, type Context } from "../src/background/handlers";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, type CopyRef, type PoolRef } from "../src/background/lovejoin";
import { LovejoinLaunchService } from "../src/background/lovejoin-launch";
import { HOLDER, PoolDiscovery, serviceDeps, type FoundPool, type Kept } from "../src/background/lovejoin-pools";
import { builtOutputs, Minswap } from "../src/background/minswap";
import { PendingService } from "../src/background/pending";
import { privateIndexClient } from "../src/background/private-index";
import { PRIVATE_PREFIX } from "../src/background/private-store";
import { SessionService } from "../src/background/sessions";
import { SESSION_UNLOCKED_AT } from "../src/background/wallet";
import { boxFrom, merged, UNKNOWN, type HistoryClass } from "../src/shared/histories";
import { t as tr } from "../src/i18n";
import { NETWORKS } from "../src/networks";
import type { Message } from "../src/shared/rpc";
import { poolsOf } from "../src/ui/lovejoin-pools";
import { anywayBox } from "../src/ui/screens/Lovejoin";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { fakeIndex, indexRowOf } from "./fake-index";
import { koiosPreprod, loadTestWasm, madeByMix, memoryArea, ownedUtxos, sessionSwap, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
const PHRASE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
)!.phrase;

/** Real chains are built and measured in WebAssembly: seconds each, more on CI. */
const SLOW = { timeout: 180_000 };

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
  boxLovelace: string;
  token: { policyId: string; assetName: string; quantity: string };
};
const TOKEN = VIEW.id;
const Q = BigInt(VIEW.token.quantity);
const LJTEST = VIEW.token.policyId + VIEW.token.assetName;
const TOKEN_ADDRESS = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(VIEW.mixBoxHash, "hex")]));
const BLOCK = FOUND.reference.block_height!;
const KEY = "seedelf.lovejoinPools.preprod";

/** The token pool handed over as a copy. */
const COPY: CopyRef = { copy: TOKEN_POOL };

/** Ogmios's answer when the network measures no more than a transaction declares. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

type T = ReturnType<typeof testBalances>;
type Deps = ConstructorParameters<typeof LovejoinService>[0];

/** Lovejoin reading the classic pool and `pools`, giveme.my's witness stood in for; `extra`, deps beside them. */
function pooled(t: T, pools: Array<PoolRef | CopyRef>, extra: Partial<Deps> = {}): LovejoinService {
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
    pools: async () => pools,
    random: () => 0.5,
    ...extra,
  });
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

async function wallet(): Promise<T> {
  const t = testBalances();
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.evaluation = AGREES;
  // A slot in preprod's Shelley era, for what the account signs (lovejoin-flows.test.ts).
  t.koios.tip = 110_000_000;
  return t;
}

/** One of the recorded account's UTxOs, made again as `tx`'s with `value` and `assets`. */
function atAccount(tx: string, value: string, assets: Array<{ policy_id: string; asset_name: string; quantity: string }> = []): KoiosUtxo {
  const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
  return { ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, asset_list: assets.map((a) => ({ ...a, decimals: 0, fingerprint: "asset1test" })) as never };
}

/** A UTxO at session 0's account, as Koios lists it. */
function atSession(tx_hash: string, tx_index: number, value: string, assets: Array<{ policy_id: string; asset_name: string; quantity: string }> = []): KoiosUtxo {
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
    asset_list: assets.map((a) => ({ ...a, decimals: 0, fingerprint: "asset1test" })) as never,
  } as KoiosUtxo;
}

const ljtest = (quantity: bigint) => ({ policy_id: VIEW.token.policyId, asset_name: VIEW.token.assetName, quantity: quantity.toString() });

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

/** A box of the wallet's in the classic pool that someone else's mix made, `hours` ago. */
async function classicBox(t: T, tx: string, hours = 7): Promise<KoiosUtxo> {
  madeByMix(t.koios, tx.repeat(32));
  return {
    ...POOL[0]!,
    tx_hash: tx.repeat(32),
    tx_index: 0,
    block_time: Math.floor(t.clock.now / 1000) - hours * 3600,
    inline_datum: { bytes: await datum(t, true), value: {} },
  } as KoiosUtxo;
}

/** Every input of what giveme.my was asked to witness: a box's withdraw among them. */
const spentBy = (t: T) => t.collateral.asked.flatMap((tx) => txInputs(Uint8Array.from(Buffer.from(tx, "hex"))));

/** Twelve strangers' boxes in the token pool: enough for one box two waves deep. */
const strangers = (t: T) => Promise.all(Array.from({ length: 12 }, (_, i) => tokenBox(t, (0x60 + i).toString(16), false)));

type Sealed = {
  due: number[];
  pools?: Record<string, { due: number[] }>;
  chains: Array<{ id: string; bootstrap?: true; session?: number }>;
  mixes?: Array<{ id: string; bootstrap?: true; found?: true; shares: Array<{ pool?: string; boxes: number; back?: number }> }>;
};
const sealed = async (t: T) => (await t.store.get<Sealed>("lovejoin.preprod"))!;

/** The wallet unlocked an hour ago, that unlock's draws made: a run then reads the pool as the alarm's does. */
async function unlockedAnHourAgo(t: T): Promise<void> {
  const at = t.clock.now - HOUR;
  await t.wallet.withKeys(() => t.session.set(SESSION_UNLOCKED_AT, at));
  const kept = await t.store.get<object>("lovejoin.preprod");
  if (kept) await t.store.set("lovejoin.preprod", { ...kept, unlock: at });
}

/** The classic pool's `mix_box` on preprod. */
const CLASSIC_BOX = NETWORKS.preprod.lovejoin!.mixBox;

/** The pool reads Koios was asked since `from`: each one's credentials. */
const poolReads = (t: T, from = 0) =>
  t.koios.calls
    .slice(from)
    .filter((c) => c.path === "credential_utxos")
    .map((c) => c.body._payment_credentials as string[])
    .filter((creds) => creds.includes(CLASSIC_BOX) || creds.includes(VIEW.mixBoxHash));

/** The token pool as discovery keeps it, its launch where the fixture's is. */
const REAL: FoundPool = {
  id: TOKEN,
  boxLovelace: VIEW.boxLovelace,
  token: VIEW.token,
  ref: TOKEN_POOL,
  launch: { block: BLOCK, index: 3, tx: FOUND.reference.tx_hash },
};
/**
 * An earlier launch of the token pool's values, at `block`, named by `tx`: a pool WebAssembly won't verify (its seed
 * isn't the one its NFT's policy comes from), so the service reads the real pool beside it, as it would a copy of a
 * real earlier pool.
 */
const earlier = (tx: string, block = BLOCK - 10): FoundPool => ({
  ...REAL,
  id: tx.repeat(28),
  ref: { reference: { ...FOUND.reference, tx_hash: tx.repeat(32) }, seed: { txHash: tx.repeat(32), txIndex: 0 } },
  launch: { block, index: 0, tx: tx.repeat(32) },
});

/** Discovery over `local`, no data layer unless `index` is given, the bundled head start empty. */
function discoveryOf(t: T, local = memoryArea(), index?: Parameters<typeof privateIndexClient>[0]["fetch"]) {
  const parts = new DataParts(memoryArea(), () => t.clock.now);
  return new PoolDiscovery({
    local,
    wasm: loadTestWasm(),
    koios: t.deps.koios,
    ...(index ? { index: privateIndexClient({ koiosOnly: async () => false, parts, fetch: index, limits: {} }, () => "https://data.test") } : {}),
    wallet: t.wallet,
    now: () => t.clock.now,
    listed: () => new Set([LJTEST]),
    headStart: () => ({ height: 0, pools: [] }),
  });
}

describe("a copy, as discovery hands it over (the merged fixes' review, MERGED-1)", () => {
  it("names a pool it read before an earlier launch of its values turned up a copy, and the earlier one not", async () => {
    const t = await wallet();
    const local = memoryArea();
    const found = discoveryOf(t, local);
    await local.set(KEY, { height: 0, pools: [REAL] });
    expect((await found.known("preprod")).map((p) => [p.id, p.copy])).toEqual([[TOKEN, undefined]]);
    const was = (await local.get<Kept>(KEY))!;
    await local.set(KEY, { ...was, pools: [...was.pools, earlier("aa")] });
    expect((await found.known("preprod")).map((p) => [p.id, p.copy])).toEqual([
      ["aa".repeat(28), undefined],
      [TOKEN, true],
    ]);
  });

  it("names every copy it keeps that this device hasn't read yet, the same for every device, until it's read once", async () => {
    const t = await wallet();
    const local = memoryArea();
    const found = discoveryOf(t, local);
    // As a restore's look keeps them: the rule's pool, and two later launches of its values, none handed over yet.
    const copies = [REAL, earlier("bb", BLOCK + 10)];
    await local.set(KEY, { height: 0, pools: [earlier("aa"), ...copies] });
    expect((await found.known("preprod")).map((p) => p.id)).toEqual(["aa".repeat(28)]);
    expect((await found.copiesUnread("preprod")).map((p) => p.id)).toEqual([TOKEN, "bb".repeat(28)]);
    // A pool read read both. Which holds the wallet's boxes is kept sealed, the service's (round two's review, R2-4):
    // here both are read, and neither is handed over.
    await found.copiesRead("preprod", copies.map((p) => `${p.ref.reference.tx_hash}#${p.ref.reference.tx_index}`));
    expect(await found.copiesUnread("preprod")).toEqual([]);
    expect((await found.known("preprod")).map((p) => p.id)).toEqual(["aa".repeat(28)]);
    // A look's write keeps what was read.
    await found.scan("preprod");
    expect(await found.copiesUnread("preprod")).toEqual([]);
    expect((await found.known("preprod")).map((p) => p.id)).toEqual(["aa".repeat(28)]);
    // Remove wallet deletes it with the rest of the record: a restore reads them again.
    await local.remove(KEY);
    await local.set(KEY, { height: 0, pools: [earlier("aa"), ...copies] });
    expect((await found.copiesUnread("preprod")).map((p) => p.id)).toEqual([TOKEN, "bb".repeat(28)]);
  });
});

describe("a copy in the worker (the merged fixes' review, MERGED-1)", SLOW, () => {
  it("takes no new box, from any flow, in words, before anything is built or giveme.my asked", async () => {
    const t = await wallet();
    t.koios.addedToAccounts.push(
      atAccount("e1", "40000000", [ljtest(3n * Q)]),
      atAccount("e2", "30000000"),
      atAccount("e5", "5000000"),
      ...POOL,
      ...(await strangers(t)),
    );
    const lj = pooled(t, [COPY]);
    const sessions = runner(t, lj);
    const words = tr("lj.unusable.warn.superseded");
    await expect(lj.fits("preprod", 1, TOKEN)).rejects.toThrow(words);
    await expect(sessions.mixOutBuild("preprod", 1, { pool: TOKEN })).rejects.toThrow(words);
    await expect(sessions.mixOutBuild("preprod", 3, { pool: TOKEN, bootstrap: true })).rejects.toThrow(words);
    await expect(lj.privateBootstrapMost("preprod", TOKEN)).rejects.toThrow(words);
    await expect(lj.publicBuild("preprod", 1, { pool: TOKEN })).rejects.toThrow(words);
    await expect(lj.publicBuild("preprod", 3, { pool: TOKEN, bootstrap: true })).rejects.toThrow(words);
    // Mixing again the boxes already there puts none in: round two's review, R2-2, below.
    expect(t.koios.submitted).toHaveLength(0);
    expect(t.collateral.asked).toHaveLength(0);
    // No token's pool for a swap's review or a return's first look, quiet or not; and it takes none at Review.
    expect(await lj.poolsOf("preprod", LJTEST)).toEqual([]);
    expect(await lj.poolsOf("preprod", LJTEST, true)).toEqual([]);
    const read = await lj.poolNamed("preprod", TOKEN);
    expect(read.copy).toBe(true);
    expect(await lj.usable("preprod", [read])).toEqual([]);
    // The same pool handed over as the rule's takes a box, as before.
    await pooled(t, [TOKEN_POOL]).fits("preprod", 1, TOKEN);
  });

  it("is no pool a return's token goes into: the token comes back directly, and the ADA goes in as before", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    const lj = pooled(t, [COPY]);
    const sessions = runner(t, lj);
    const OUT = "ab".repeat(32);
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [{ index: 0, ownStake: true, createdAt: t.clock.now, txs: [{ kind: "out", txHash: OUT, at: t.clock.now, confirmed: true }], site: { origin: "https://example.org" } }],
    });
    t.koios.addedToAccounts.push(
      atSession(OUT, 0, "3000000", [ljtest(2n * Q)]),
      atSession(OUT, 1, "40000000"),
      atSession(OUT, 2, "5000000"),
      ...POOL,
      ...(await strangers(t)),
    );
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin?.parts).toBeUndefined();
    expect(review.lovejoin?.ways).toEqual([
      { policyId: VIEW.token.policyId, assetName: VIEW.token.assetName, boxes: 0, pools: [], skipped: tr("lj.tokens.skip.warn.noPool") },
    ]);
    expect(review.lovejoin!.boxes).toBeGreaterThanOrEqual(1);
  });

  it("is listed only where the wallet has something in it, flagged, and its boxes come back as any pool's", async () => {
    // Nothing of the wallet's in it: read, as the read set is the same, and never offered.
    const none = await wallet();
    none.koios.addedToAccounts.push(...POOL, ...(await strangers(none)));
    const empty = await pooled(none, [COPY]).status("preprod");
    expect(empty.pools ?? []).toEqual([]);
    expect(poolReads(none).flat()).toContain(VIEW.mixBoxHash);

    // The wallet's box in it, made by someone else's mix: listed, its why said, and it comes back by itself.
    const t = await wallet();
    const lj = pooled(t, [COPY]);
    const f1 = await tokenBox(t, "f1", true, 7);
    t.koios.addedToAccounts.push(atAccount("e5", "5000000"), ...POOL, f1, ...(await strangers(t)));
    const status = await lj.status("preprod");
    expect(status.pools).toHaveLength(1);
    expect(status.pools![0]).toMatchObject({ id: TOKEN, unusable: { why: "superseded" }, boxes: [{ txHash: f1.tx_hash, txIndex: 0, pool: TOKEN }] });
    for (const h of [4, 8, 24, 48]) {
      t.clock.now += h * HOUR;
      await t.wallet.unlock(PASSWORD);
      await unlockedAnHourAgo(t);
      await lj.status("preprod");
      await lj.withdrawDue("preprod");
    }
    expect(t.collateral.asked.flatMap((tx) => txInputs(Uint8Array.from(Buffer.from(tx, "hex"))))).toContain(`${f1.tx_hash}#0`);
  });

  it("isn't offered to join on the launch form, and a launch of its values is still refused", async () => {
    const t = await wallet();
    const min = { policyId: VIEW.token.policyId, assetName: VIEW.token.assetName };
    const launch = new LovejoinLaunchService({
      ...t.deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      lovejoin: t.lovejoin,
      discovery: { known: async () => [earlier("aa"), { ...REAL, copy: true as const }], look: async () => undefined },
      listed: () => true,
    });
    const terms = await launch.terms("preprod", min, Q.toString());
    expect(terms.pools.map((p) => p.id)).toEqual(["aa".repeat(28)]);
    t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"));
    await expect(launch.build("preprod", { from: "public", token: min, quantity: Q.toString(), boxLovelace: VIEW.boxLovelace })).rejects.toThrow(
      tr("lj.launch.copy"),
    );
  });
});

describe("a restore and the copies discovery keeps (the merged fixes' review, MERGED-1)", SLOW, () => {
  /** A device whose record Remove wallet deleted, and whose look found an earlier launch and the token pool again. */
  async function restored(t: T) {
    const local = memoryArea();
    const discovery = discoveryOf(t, local);
    await local.set(KEY, { height: 0, pools: [earlier("aa"), REAL] });
    const lj = pooled(t, [], serviceDeps(discovery));
    return { discovery, lj, local };
  }

  it("reads a copy once at the first pool read, and hands it over where the wallet's boxes are, read-only", async () => {
    const t = await wallet();
    const { discovery, lj } = await restored(t);
    expect((await discovery.known("preprod")).map((p) => p.id)).toEqual(["aa".repeat(28)]);
    const f1 = await tokenBox(t, "f1", true, 7);
    t.koios.addedToAccounts.push(...POOL, f1, ...(await strangers(t)));
    const status = await lj.status("preprod");
    expect(poolReads(t).flat()).toContain(VIEW.mixBoxHash);
    expect(status.pools![0]).toMatchObject({ id: TOKEN, unusable: { why: "superseded" }, boxes: [{ txHash: f1.tx_hash, txIndex: 0, pool: TOKEN }] });
    // Read as a copy at every pool read from now on, and never offered a box. Which copy it was is kept sealed, not
    // in discovery's record (round two's review, R2-4).
    expect((await discovery.known("preprod")).map((p) => p.id)).toEqual(["aa".repeat(28)]);
    expect(await discovery.copiesUnread("preprod")).toEqual([]);
    const from = t.koios.calls.length;
    await lj.status("preprod");
    expect(poolReads(t, from).flat()).toContain(VIEW.mixBoxHash);
    await expect(lj.fits("preprod", 1, TOKEN)).rejects.toThrow(tr("lj.unusable.warn.superseded"));
  });

  it("reads a copy holding none of the wallet's boxes once, and never again", async () => {
    const t = await wallet();
    const { discovery, lj } = await restored(t);
    t.koios.addedToAccounts.push(...POOL, ...(await strangers(t)));
    const status = await lj.status("preprod");
    expect(poolReads(t).flat()).toContain(VIEW.mixBoxHash);
    expect(status.pools ?? []).toEqual([]);
    expect((await discovery.known("preprod")).map((p) => p.id)).toEqual(["aa".repeat(28)]);
    expect(await discovery.copiesUnread("preprod")).toEqual([]);
    const from = t.koios.calls.length;
    await lj.status("preprod");
    await t.wallet.withKeys(() => t.session.set(SESSION_UNLOCKED_AT, t.clock.now - HOUR));
    await lj.withdrawDue("preprod", true);
    expect(poolReads(t, from).length).toBeGreaterThan(0);
    expect(poolReads(t, from).flat()).not.toContain(VIEW.mixBoxHash);
  });

  it("asks a device with no copy nothing new: its pool reads are as they were", async () => {
    const t = await wallet();
    const local = memoryArea();
    const discovery = discoveryOf(t, local);
    await local.set(KEY, { height: 0, pools: [REAL] });
    t.koios.addedToAccounts.push(...POOL, ...(await strangers(t)));
    const lj = pooled(t, [], serviceDeps(discovery));
    await lj.status("preprod");
    await lj.status("preprod");
    expect(poolReads(t)).toEqual([
      [CLASSIC_BOX, VIEW.mixBoxHash],
      [CLASSIC_BOX, VIEW.mixBoxHash],
    ]);
  });
});

describe("a look for pools says whether what the wallet reads changed (1.6.0's rehearsal, R10)", SLOW, () => {
  /** The data layer's list: the token pool, its scripts at the holder. */
  function listed() {
    const slot = 100_000_000;
    const scripts = FOUND.scripts.map((s, i) => ({ ...s, tx_hash: FOUND.reference.tx_hash, tx_index: i + 1, address: FOUND.reference.address, payment_cred: HOLDER, stake_address: null, block_height: BLOCK }));
    return {
      network: "mainnet",
      cursor: `${slot}.${"0".repeat(64)}`,
      classic: { crowd: { boxes: 80, deposits: 12, mixed: 70 } },
      pools: [
        {
          id: TOKEN,
          seed: `${FOUND.seed.txHash}#${FOUND.seed.txIndex}`,
          reference: indexRowOf(FOUND.reference, slot),
          scripts: scripts.map((s, i) => ({ ...indexRowOf(s as KoiosUtxo, slot), script: true, script_hash: ["b51f7e0331d32c706c0657a9ae28e5900e651d569d922b7093b52ea4", "ada2c293ad286873fb2d265b4a8597edc5271e927e13dc0496e7b953"][i] })),
          launch: { tx: FOUND.reference.tx_hash, block: BLOCK, index: 3, slot, time: slot + 1_591_566_291 },
          crowd: { boxes: 30, deposits: 1, mixed: 0 },
        },
      ],
    };
  }

  it("answers grew when a look hands over a pool, and not when the next finds nothing new, through the handler too", async () => {
    const t = await wallet();
    const index = fakeIndex();
    const discovery = discoveryOf(t, memoryArea(), index.fetch);
    const lj = pooled(t, [], { ...serviceDeps(discovery), lookForPools: (n) => discovery.look(n) });
    const ctx = { lovejoin: lj, network: "preprod", wasm: loadTestWasm(), wallet: t.wallet } as unknown as Context;
    // Nothing listed yet: nothing found.
    expect(await handle({ type: "lovejoin-look-for-pools" } as Message, ctx)).toEqual({ grew: false });
    // The token pool is listed since: the look hands it over, and the hub reads again. Koios confirms its launch first,
    // the seed among its inputs and L registered (1.7.0).
    const scripts = listed().pools[0]!.scripts.map((r) => ({ ...FOUND.reference, tx_index: Number(r.ref.split("#")[1]), reference_script: { hash: r.script_hash } }));
    const l = (JSON.parse(loadTestWasm().lovejoinLaunchCheck(JSON.stringify({ network: "preprod", reference: FOUND.reference, inputs: [FOUND.seed], scripts }))) as { mixLogicStake: string }).mixLogicStake;
    t.koios.txRows.set(FOUND.reference.tx_hash, {
      tx_hash: FOUND.reference.tx_hash,
      block_height: BLOCK,
      tx_block_index: 3,
      tx_timestamp: FOUND.reference.block_time ?? 0,
      inputs: [{ tx_hash: FOUND.seed.txHash, tx_index: FOUND.seed.txIndex }],
      certificates: [{ type: "stake_registration", info: { stake_address: l } }],
    } as never);
    // And its outputs at the holder, as utxo_info gives them (1.7.0's release review, pr336#0): the fake answers that
    // with any UTxO it holds, these under no key of the wallet's.
    const at = { tx_hash: FOUND.reference.tx_hash, address: FOUND.reference.address, payment_cred: HOLDER, stake_address: null, block_height: BLOCK };
    t.koios.addedToAccounts.push(FOUND.reference, ...FOUND.scripts.map((s, i) => ({ ...s, ...at, tx_index: i + 1 })));
    index.poolList = listed();
    t.clock.now += 10 * 60_000;
    expect(await handle({ type: "lovejoin-look-for-pools" } as Message, ctx)).toEqual({ grew: true });
    expect((await discovery.known("preprod")).map((p) => p.id)).toEqual([TOKEN]);
    t.clock.now += 10 * 60_000;
    expect(await lj.lookForPools("preprod")).toEqual({ grew: false });
  });

  it("answers grew when a look keeps a copy a pool read hasn't read yet, so the hub reads it at once", async () => {
    const t = await wallet();
    const local = memoryArea();
    const discovery = discoveryOf(t, local);
    await local.set(KEY, { height: 0, pools: [earlier("aa")] });
    // The look keeps the token pool, a later launch of the same values: nothing more handed over, one more to read.
    const look = async () => {
      const was = (await local.get<Kept>(KEY))!;
      await local.set(KEY, { ...was, pools: [...was.pools, REAL] });
    };
    const lj = pooled(t, [], { ...serviceDeps(discovery), lookForPools: look });
    expect(await lj.lookForPools("preprod")).toEqual({ grew: true });
    expect(await lj.lookForPools("preprod")).toEqual({ grew: false });
  });
});

describe("a start of the values of a pool the data layer lists, before Koios confirms it (1.7.0's release review, x-merge#0)", SLOW, () => {
  it("is refused as a copy, though the pool isn't read or offered to join till Koios confirms it", async () => {
    const t = await wallet();
    // The data layer lists the token pool; Koios is down, refusing this IP, or behind, so it doesn't confirm it.
    const slot = 100_000_000;
    const scripts = FOUND.scripts.map((s, i) => ({ ...s, tx_hash: FOUND.reference.tx_hash, tx_index: i + 1, address: FOUND.reference.address, payment_cred: HOLDER, stake_address: null, block_height: BLOCK }));
    const index = fakeIndex();
    index.poolList = {
      network: "mainnet",
      cursor: `${slot}.${"0".repeat(64)}`,
      classic: { crowd: { boxes: 80, deposits: 12, mixed: 70 } },
      pools: [
        {
          id: TOKEN,
          seed: `${FOUND.seed.txHash}#${FOUND.seed.txIndex}`,
          reference: indexRowOf(FOUND.reference, slot),
          scripts: scripts.map((s, i) => ({ ...indexRowOf(s as KoiosUtxo, slot), script: true, script_hash: [VIEW.mixBoxHash, "ada2c293ad286873fb2d265b4a8597edc5271e927e13dc0496e7b953"][i] })),
          launch: { tx: FOUND.reference.tx_hash, block: BLOCK, index: 3, slot, time: slot + 1_591_566_291 },
          crowd: { boxes: 30, deposits: 1, mixed: 0 },
        },
      ],
    };
    const discovery = discoveryOf(t, memoryArea(), index.fetch);
    const min = { policyId: VIEW.token.policyId, assetName: VIEW.token.assetName };
    const launch = new LovejoinLaunchService({
      ...t.deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      lovejoin: t.lovejoin,
      discovery,
      listed: () => true,
    });
    t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"));
    // Its start would lock about 23 ₳ for good: a later launch of its values, which no wallet shows. No screen has it
    // to use yet, so the refusal says it shows once it's confirmed, never "Use that pool instead" (1.7.0's fixes'
    // review, screens#1).
    await expect(launch.build("preprod", { from: "public", token: min, quantity: Q.toString(), boxLovelace: VIEW.boxLovelace })).rejects.toThrow(
      tr("lj.launch.copyListed"),
    );
    // Never shown till Koios confirms it: no pool read hands it over, and the form's terms don't offer it.
    expect(await discovery.known("preprod")).toEqual([]);
    expect((await launch.terms("preprod", min, Q.toString())).pools).toEqual([]);
    // Other values aren't its copy: they go on to the checks after it.
    const other = await launch.build("preprod", { from: "public", token: min, quantity: (Q * 2n).toString(), boxLovelace: VIEW.boxLovelace }).then(
      () => undefined,
      (e: Error) => e.message,
    );
    expect([tr("lj.launch.copy"), tr("lj.launch.copyListed")]).not.toContain(other);
  });

  it("says to use the pool where it's shown and the list names it too: the form offers it to join (1.7.0's fixes' review, screens#1)", async () => {
    const t = await wallet();
    const min = { policyId: VIEW.token.policyId, assetName: VIEW.token.assetName };
    const launch = new LovejoinLaunchService({
      ...t.deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      lovejoin: t.lovejoin,
      discovery: { known: async () => [REAL], look: async () => undefined, lastListed: () => [REAL] },
      listed: () => true,
    });
    t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"));
    await expect(launch.build("preprod", { from: "public", token: min, quantity: Q.toString(), boxLovelace: VIEW.boxLovelace })).rejects.toThrow(
      tr("lj.launch.copy"),
    );
  });
});

describe("a Bootstrap whose deposit a watch saw land (the merged fixes' review, MERGED-5)", SLOW, () => {
  it("keeps holding from the public account once Home's watch saw it, though no read listed a box at its deposit", async () => {
    const t = await wallet();
    const lj = pooled(t, []);
    // Home's watch, as sw.ts wires it.
    const pending = new PendingService({ ...t.deps, depositLanded: (n, h) => lj.landedDeposit(n, h) });
    t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"), ...POOL);
    const summary = await lj.publicBuild("preprod", 2, { bootstrap: true });
    await lj.publicSubmit("preprod", summary.txHash);
    t.koios.confirmations = 1;
    await lj.pumpPublic("preprod");
    expect((await pending.pending("preprod"))?.confirmations).toBe(1);
    // Before any pool read, other people's mixes moved both its boxes: the wallet's, at their outputs.
    t.koios.addedToAccounts.push(await classicBox(t, "f1"), await classicBox(t, "f2"));
    for (const h of [4, 8, 24, 48]) {
      t.clock.now += h * HOUR;
      await t.wallet.unlock(PASSWORD);
      await unlockedAnHourAgo(t);
      await lj.status("preprod");
      await lj.withdrawDue("preprod");
    }
    expect((await sealed(t)).mixes!.find((e) => e.bootstrap)).toMatchObject({ found: true });
    expect((await lj.status("preprod")).bootstrap).toHaveLength(2);
    expect(spentBy(t)).not.toContain(`${"f1".repeat(32)}#0`);
    expect(spentBy(t)).not.toContain(`${"f2".repeat(32)}#0`);
  });

  it("keeps holding from the private balance once its session saw the deposit land", async () => {
    const t = await wallet();
    const lj = pooled(t, []);
    const sessions = runner(t, lj);
    const out = await sessions.mixOutBuild("preprod", 1, { bootstrap: true });
    const { index } = await sessions.mixOutSubmit("preprod", out.txHash);
    // Its funding lands as it paid the account, with no 5 ₳ (1.6.0's release review, x-compat#0).
    const paid = landed(t, out.txHash);
    t.koios.addedToAccounts.push(...POOL, ...paid);
    t.koios.confirmations = 1;
    const before = t.koios.submitted.length;
    await sessions.advance("preprod", index, true);
    expect(t.koios.submitted.slice(before).some((tx) => txInputs(tx).includes(`${out.txHash}#${paid[0]!.tx_index}`))).toBe(true);
    expect((await sealed(t)).chains.at(-1)).toMatchObject({ bootstrap: true, boxes: 1 });
    // The session's read sees its deposit and return on chain.
    await sessions.list("preprod", true);
    expect((await sealed(t)).mixes!.find((e) => e.bootstrap)).toMatchObject({ found: true });
    // Before any pool read, someone else's mix moved its box: the wallet's, at that mix's output.
    t.koios.addedToAccounts.push(await classicBox(t, "f1"));
    for (const h of [4, 8, 24, 48]) {
      t.clock.now += h * HOUR;
      await t.wallet.unlock(PASSWORD);
      await unlockedAnHourAgo(t);
      await lj.status("preprod");
      await lj.withdrawDue("preprod");
    }
    expect((await lj.status("preprod")).bootstrap).toEqual([{ txHash: "f1".repeat(32), txIndex: 0 }]);
    expect(spentBy(t)).not.toContain(`${"f1".repeat(32)}#0`);
  });

  // 34g's last review, WORKER-1: the older rule for a chain that stopped before any of it was known sent closed the
  // entry as its record went, `found` or not, so a deposit a watch saw land lost its hold when the record said `sent: 0`
  // (every send retry gave up, or a lock before chainSent wrote it), once other people's mixes had moved its boxes.
  it("keeps holding when its chain's record says nothing of it was sent (34g's last review, WORKER-1)", async () => {
    for (const sent of [1, 0]) {
      const t = await wallet();
      const lj = pooled(t, []);
      const [deposit, back] = ["d0".repeat(32), "b0".repeat(32)];
      const at = t.clock.now - HOUR;
      // A private Bootstrap of one classic box, [deposit, return], its send stopped.
      await t.store.set("lovejoin.preprod", {
        due: [],
        chains: [
          {
            id: back,
            session: 0,
            progress: "test.p",
            deposit,
            mixes: [],
            leaves: [{ txHash: deposit, txIndex: 0 }],
            boxes: 1,
            bootstrap: true,
            total: 2,
            sent,
            at,
            stopped: "stopped",
            ended: at,
          },
        ],
        mixes: [{ id: back, deposit, at, session: 0, bootstrap: true, shares: [{ boxes: 1 }] }],
      });
      // The session's watch saw the deposit land; before any pool read, someone else's mix moved its box.
      await lj.landedDeposit("preprod", deposit);
      t.koios.addedToAccounts.push(...POOL, await classicBox(t, "f1"));
      for (const h of [4, 8, 24, 48]) {
        t.clock.now += h * HOUR;
        await t.wallet.unlock(PASSWORD);
        await unlockedAnHourAgo(t);
        await lj.status("preprod");
        await lj.withdrawDue("preprod");
      }
      expect((await lj.status("preprod")).bootstrap, `sent ${sent}`).toEqual([{ txHash: "f1".repeat(32), txIndex: 0 }]);
      expect(spentBy(t), `sent ${sent}`).not.toContain(`${"f1".repeat(32)}#0`);
    }
  });
});

// 1.6.0's rehearsal, R12: a wallet restored on a fresh profile found its 8 boxes in a token pool at the hub's first pool
// read, after the unlock's run had found nothing on its way back and stopped the alarm. Each box got a due time, and
// none came back by itself in the next four hours: nothing started the alarm again. A read that gives a box its due
// time starts it, so the box comes back at that time, as the classic pool's always did while their reads ran in the
// alarm's own runs.
describe("a pool read that gives boxes their due times starts the alarm (the rehearsal, R12)", () => {
  /** The sessions alarm, as sw.ts's: how many times it was started. */
  const alarmOf = () => {
    const alarm = { starts: 0, start: async () => void alarm.starts++ };
    return alarm;
  };

  it("for a token pool's boxes a restore finds", SLOW, async () => {
    const t = await wallet();
    const alarm = alarmOf();
    const lj = pooled(t, [TOKEN_POOL], { alarm });
    t.koios.addedToAccounts.push(...POOL, await tokenBox(t, "f1", true, 7), ...(await strangers(t)));
    const status = await lj.status("preprod");
    expect(status.pools![0]!.due).toHaveLength(1);
    expect(alarm.starts).toBeGreaterThan(0);
  });

  it("for the classic pool's", SLOW, async () => {
    const t = await wallet();
    const alarm = alarmOf();
    const lj = pooled(t, [], { alarm });
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"));
    const status = await lj.status("preprod");
    expect(status.due).toHaveLength(1);
    expect(alarm.starts).toBeGreaterThan(0);
  });

  it("and not for a read that finds nothing to bring back", SLOW, async () => {
    const t = await wallet();
    const alarm = alarmOf();
    const lj = pooled(t, [TOKEN_POOL], { alarm });
    t.koios.addedToAccounts.push(...POOL, ...(await strangers(t)));
    await lj.status("preprod");
    expect(alarm.starts).toBe(0);
  });
});

/** A chain into the token pool that a restart cut after its deposit (CHAIN_CUT): its box at `deposit` not mixed yet. */
function cutInto(t: T, deposit: string, from: { account: number } | { session: number }) {
  const mix = "c9".repeat(32);
  return {
    id: mix,
    progress: "test.cut",
    deposit,
    mixes: [mix],
    leaves: [{ txHash: mix, txIndex: 0, pool: TOKEN }],
    boxes: 1,
    pools: { [TOKEN]: 1 },
    total: 2,
    sent: 1,
    at: t.clock.now - 2 * HOUR,
    scheduled: true,
    stopped: "cut",
    ended: t.clock.now - 2 * HOUR,
    ...from,
  };
}

// Round two's review of the merged fixes, R2-2: a copy refused mixing again too, so a box not mixed yet there (a mix
// cut after its deposit, or after a restore a box a deposit made) had no private way out, while the page said Mix my
// boxes again takes it first. Mixing again makes no deposit and puts no new box in the pool: a copy refuses only what
// does (the lead's call). The floor and the other reasons a pool takes no box still refuse it, as in any pool.
describe("mixing again in a copy (round two's review, R2-2)", SLOW, () => {
  it("mixes a box there not mixed yet again from the private balance, and still puts no new box in", async () => {
    const t = await wallet();
    const lj = pooled(t, [COPY]);
    const sessions = runner(t, lj);
    const box = await tokenBox(t, "d1", true, 3);
    t.koios.addedToAccounts.push(...POOL, box, ...(await strangers(t)));
    await t.store.set("lovejoin.preprod", { due: [], chains: [cutInto(t, box.tx_hash, { session: 0 })] });
    const status = await lj.status("preprod");
    expect(status.pools![0]).toMatchObject({ id: TOKEN, unusable: { why: "superseded" }, notMixed: [{ txHash: box.tx_hash, txIndex: 0, pool: TOKEN }] });
    const words = tr("lj.unusable.warn.superseded");
    await expect(lj.fits("preprod", 1, TOKEN)).rejects.toThrow(words);
    await expect(sessions.mixOutBuild("preprod", 3, { pool: TOKEN, bootstrap: true })).rejects.toThrow(words);
    expect(await lj.againBoxes("preprod", false, TOKEN)).toMatchObject({ boxes: 1, owned: 1 });
    const out = await sessions.againBuild("preprod", false, TOKEN);
    expect(out.mix).toMatchObject({ again: true, boxes: 1 });
  });

  it("mixes one again from the public account, and still puts no new box in from there", async () => {
    const t = await wallet();
    const lj = pooled(t, [COPY]);
    const box = await tokenBox(t, "d1", true, 3);
    t.koios.addedToAccounts.push(
      atAccount("e1", "40000000", [ljtest(3n * Q)]),
      atAccount("e2", "30000000"),
      atAccount("e5", "5000000"),
      ...POOL,
      box,
      ...(await strangers(t)),
    );
    await t.store.set("lovejoin.preprod", { due: [], chains: [cutInto(t, box.tx_hash, { account: 0 })] });
    const words = tr("lj.unusable.warn.superseded");
    await expect(lj.publicBuild("preprod", 1, { pool: TOKEN })).rejects.toThrow(words);
    await expect(lj.publicBuild("preprod", 3, { pool: TOKEN, bootstrap: true })).rejects.toThrow(words);
    expect(await lj.publicAgainBuild("preprod", TOKEN)).toMatchObject({ again: true, boxes: 1, pool: TOKEN });
  });

  it("still refuses it for any other reason the pool takes no box, as in any pool", async () => {
    const t = await wallet();
    // A byte three times preprod's: a 2 ₳ LJTEST box is less than the network asks of one.
    t.koios.params = { coins_per_utxo_size: "12930" };
    const lj = pooled(t, [COPY]);
    const box = await tokenBox(t, "d1", true, 3);
    t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"), ...POOL, box, ...(await strangers(t)));
    await t.store.set("lovejoin.preprod", { due: [], chains: [cutInto(t, box.tx_hash, { session: 0 })] });
    await expect(lj.againBoxes("preprod", false, TOKEN)).rejects.toThrow(tr("lj.unusable.warn.belowMinimum"));
    // The page still flags the pool a copy, and says why mixing again is refused there too (the last review, R3-2).
    expect((await lj.status("preprod")).pools![0]!.unusable).toEqual({ why: "superseded", again: "belowMinimum" });
  });
});

// Round two's review, R2-4: the one-time read wrote which copy holds the wallet's boxes into discovery's unsealed
// record, `shown` beside `checked`. It's kept in the sealed schedule now, `copies`, as everything else in Lovejoin that
// says what's the user's is; discovery's record keeps every copy read once alone, the same for every device.
describe("the copies holding the wallet's boxes, sealed (round two's review, R2-4)", SLOW, () => {
  const at = (p: FoundPool) => `${p.ref.reference.tx_hash}#${p.ref.reference.tx_index}`;
  type Stored = Kept & { shown?: string[]; checked?: string[] };

  it("never says in discovery's record which copy holds them, reads that copy at every read, and goes with Remove wallet", async () => {
    const t = await wallet();
    // Over the wallet's own storage, so Remove wallet deletes discovery's record as the worker's does.
    const discovery = discoveryOf(t, t.local);
    const other = earlier("bb", BLOCK + 10);
    await t.local.set(KEY, { height: 0, pools: [earlier("aa"), REAL, other] });
    const lj = pooled(t, [], serviceDeps(discovery));
    const f1 = await tokenBox(t, "f1", true, 7);
    t.koios.addedToAccounts.push(...POOL, f1, ...(await strangers(t)));
    const first = await lj.status("preprod");
    expect(first.pools![0]).toMatchObject({ id: TOKEN, boxes: [{ txHash: f1.tx_hash, txIndex: 0, pool: TOKEN }] });
    // Both copies read once, neither handed over: the record doesn't tell the one with the wallet's boxes apart.
    const stored = (await t.local.get<Stored>(KEY))!;
    expect(stored.shown ?? []).not.toContain(at(REAL));
    expect(stored.shown ?? []).not.toContain(at(other));
    expect(stored.checked).toEqual(expect.arrayContaining([at(REAL), at(other)]));
    expect((await discovery.known("preprod")).map((p) => p.id)).toEqual(["aa".repeat(28)]);
    // The sealed schedule names it.
    const kept = (await t.store.get<{ copies?: Array<{ reference: { tx_hash: string; tx_index: number } }> }>("lovejoin.preprod"))!;
    expect(kept.copies?.map((r) => `${r.reference.tx_hash}#${r.reference.tx_index}`)).toEqual([at(REAL)]);
    // Read at every read after, its box listed, as a copy; Activity names its box too.
    for (let i = 0; i < 2; i++) {
      const from = t.koios.calls.length;
      const status = await lj.status("preprod");
      expect(poolReads(t, from).flat()).toContain(VIEW.mixBoxHash);
      expect(status.pools![0]).toMatchObject({ id: TOKEN, unusable: { why: "superseded" }, boxes: [{ txHash: f1.tx_hash, txIndex: 0, pool: TOKEN }] });
    }
    expect(await lj.mixBoxes("preprod")).toContain(VIEW.mixBoxHash);
    await expect(lj.fits("preprod", 1, TOKEN)).rejects.toThrow(tr("lj.unusable.warn.superseded"));
    // Remove wallet deletes both records.
    await t.wallet.reset();
    expect(await t.local.get(KEY)).toBeUndefined();
    expect(await t.local.get(`${PRIVATE_PREFIX}lovejoin.preprod`)).toBeUndefined();
  });

  it("moves a copy this round's earlier code handed over into the sealed schedule, and keeps reading it", async () => {
    const t = await wallet();
    const discovery = discoveryOf(t, t.local);
    // As the earlier code wrote it: the copy holding the wallet's boxes both handed over and read.
    await t.local.set(KEY, { height: 0, pools: [earlier("aa"), REAL], shown: [at(earlier("aa")), at(REAL)], checked: [at(REAL)] });
    const lj = pooled(t, [], serviceDeps(discovery));
    const f1 = await tokenBox(t, "f1", true, 7);
    t.koios.addedToAccounts.push(...POOL, f1, ...(await strangers(t)));
    expect((await lj.status("preprod")).pools![0]).toMatchObject({ id: TOKEN, unusable: { why: "superseded" }, boxes: [{ txHash: f1.tx_hash, txIndex: 0, pool: TOKEN }] });
    const stored = (await t.local.get<Stored>(KEY))!;
    expect(stored.shown ?? []).not.toContain(at(REAL));
    expect(stored.checked).toContain(at(REAL));
    const kept = (await t.store.get<{ copies?: Array<{ reference: { tx_hash: string } }> }>("lovejoin.preprod"))!;
    expect(kept.copies?.map((r) => r.reference.tx_hash)).toEqual([REAL.ref.reference.tx_hash]);
    const from = t.koios.calls.length;
    await lj.status("preprod");
    expect(poolReads(t, from).flat()).toContain(VIEW.mixBoxHash);
  });

  it("leaves a copy STATE-2 handed over, while it was the rule's, as it was: handed over and read", async () => {
    const t = await wallet();
    const discovery = discoveryOf(t, t.local);
    await t.local.set(KEY, { height: 0, pools: [earlier("aa"), REAL], shown: [at(REAL)] });
    const lj = pooled(t, [], serviceDeps(discovery));
    t.koios.addedToAccounts.push(...POOL, ...(await strangers(t)));
    await lj.status("preprod");
    expect(poolReads(t).flat()).toContain(VIEW.mixBoxHash);
    expect((await discovery.known("preprod")).map((p) => [p.id, p.copy])).toEqual([
      ["aa".repeat(28), undefined],
      [TOKEN, true],
    ]);
    expect((await t.store.get<{ copies?: unknown[] }>("lovejoin.preprod"))?.copies).toBeUndefined();
  });
});

// Fix round two's last review. R3-2: a copy's status said only `superseded`, so the page kept Mix again on where the
// worker refuses it for the pool's other reasons; it says that reason too now (`again`). R3-1, narrowed: the copy
// holding the wallet's boxes was read at every pool read for good, which names it to whoever answers; it's read no
// longer once a read finds nothing of the wallet's left there.
describe("a copy's status and its sealed read, at the end (fix round two's last review, R3-1, R3-2)", SLOW, () => {
  it("says why mixing again is refused in a copy too, and nothing more where it isn't (R3-2)", async () => {
    for (const [params, unusable] of [
      [{ coins_per_utxo_size: "12930" }, { why: "superseded", again: "belowMinimum" }],
      [undefined, { why: "superseded" }],
    ] as const) {
      const t = await wallet();
      if (params) t.koios.params = params;
      const lj = pooled(t, [COPY]);
      const box = await tokenBox(t, "d1", true, 3);
      t.koios.addedToAccounts.push(...POOL, box, ...(await strangers(t)));
      await t.store.set("lovejoin.preprod", { due: [], chains: [cutInto(t, box.tx_hash, { session: 0 })] });
      expect((await lj.status("preprod")).pools![0]!.unusable).toEqual(unusable);
    }
    // A pool that isn't a copy says its own reason alone, as before.
    const t = await wallet();
    t.koios.params = { coins_per_utxo_size: "12930" };
    t.koios.addedToAccounts.push(...POOL, ...(await strangers(t)));
    expect((await pooled(t, [TOKEN_POOL]).status("preprod")).pools![0]!.unusable).toEqual({ why: "belowMinimum" });
  });

  it("stops reading the copy once a read finds the wallet's last box there gone, never on a read that failed (R3-1)", async () => {
    const t = await wallet();
    const discovery = discoveryOf(t, t.local);
    await t.local.set(KEY, { height: 0, pools: [earlier("aa"), REAL] });
    const lj = pooled(t, [], serviceDeps(discovery));
    const f1 = await tokenBox(t, "f1", true, 7);
    t.koios.addedToAccounts.push(...POOL, f1, ...(await strangers(t)));
    const copies = async () =>
      ((await t.store.get<{ copies?: Array<{ reference: { tx_hash: string } }> }>("lovejoin.preprod"))?.copies ?? []).map((r) => r.reference.tx_hash);
    await lj.status("preprod");
    expect(await copies()).toEqual([REAL.ref.reference.tx_hash]);
    // Read while its box is there.
    let from = t.koios.calls.length;
    await lj.status("preprod");
    expect(poolReads(t, from).flat()).toContain(VIEW.mixBoxHash);
    // Brought back, and the withdraw landed: the box is gone from the pool.
    await lj.withdrawNow("preprod", { txHash: f1.tx_hash, txIndex: 0, pool: TOKEN });
    t.koios.spent.add(`${f1.tx_hash}#0`);
    t.koios.confirmations = 1;
    // A read that fails names nothing gone: the copy is kept.
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => (new URL(url).pathname.endsWith("/credential_utxos") ? new Response("down", { status: 503 }) : real(url, init));
    await expect(lj.status("preprod")).rejects.toThrow();
    expect(await copies()).toEqual([REAL.ref.reference.tx_hash]);
    t.koios.fetch = real;
    // The next read finds nothing of the wallet's there: the copy goes, and isn't read again.
    await lj.status("preprod");
    expect(await copies()).toEqual([]);
    from = t.koios.calls.length;
    const after = await lj.status("preprod");
    expect(poolReads(t, from).flat()).not.toContain(VIEW.mixBoxHash);
    expect(after.pools ?? []).toEqual([]);
  });

  it("keeps the copy while a withdraw from it may still have gone through (R3-1)", async () => {
    const t = await wallet();
    const discovery = discoveryOf(t, t.local);
    await t.local.set(KEY, { height: 0, pools: [earlier("aa"), REAL] });
    const lj = pooled(t, [], serviceDeps(discovery));
    const f1 = await tokenBox(t, "f1", true, 7);
    t.koios.addedToAccounts.push(...POOL, f1, ...(await strangers(t)));
    await lj.status("preprod");
    // A withdraw of its box in its write-ahead slot, and the box no longer listed: it may be on its way.
    const kept = (await t.store.get<Record<string, unknown>>("lovejoin.preprod"))!;
    await t.store.set("lovejoin.preprod", { ...kept, withdrawing: { txHash: "ee".repeat(32), txCbor: "", at: t.clock.now, pool: TOKEN, box: { txHash: f1.tx_hash, txIndex: 0 } } });
    t.koios.spent.add(`${f1.tx_hash}#0`);
    await lj.status("preprod");
    expect(((await t.store.get<{ copies?: unknown[] }>("lovejoin.preprod"))?.copies ?? []).length).toBe(1);
  });
});

// 34g's last review, SCREENS-1: in a token pool whose boxes can't pay their own way back, a box not mixed yet (a chain
// cut after its deposit) had no way out the page offered. The owner's calls 34 and 36 (2026-10-19) since: mixing again
// is allowed there, as any mix the ledger takes, and a box comes back paid from the private balance by default, or from
// the public account where the user picks it.
describe("a box not mixed yet in a pool whose boxes can't pay their own way back (34g's last review, SCREENS-1)", SLOW, () => {
  it("is mixed again, or comes back paid from the public account, as the page asks", async () => {
    const t = await wallet();
    // A byte dearer than preprod's: a 2 ₳ LJTEST box still meets its minimum, but can't pay its own way back.
    t.koios.params = { coins_per_utxo_size: "4800" };
    const lj = pooled(t, [TOKEN_POOL]);
    const box = await tokenBox(t, "d1", true, 3);
    t.koios.addedToAccounts.push(atAccount("e1", "20000000"), atAccount("e5", "5000000"), ...POOL, box, ...(await strangers(t)));
    await t.store.set("lovejoin.preprod", { due: [], chains: [cutInto(t, box.tx_hash, { session: 0 })] });
    const pool = poolsOf(await lj.status("preprod")).find((p) => p.id === TOKEN)!;
    expect(pool.unusable).toBeUndefined();
    expect(pool).toMatchObject({ notMixed: [{ txHash: box.tx_hash, txIndex: 0 }] });
    expect(pool.cantComeBack).toBeDefined();
    await t.balances.get("preprod");
    // Mixing it again is a mix the ledger takes: allowed (call 34).
    await expect(lj.againBoxes("preprod", false, TOKEN)).resolves.toMatchObject({ boxes: 1 });
    await expect(lj.withdrawNow("preprod", undefined, false, true, TOKEN)).rejects.toThrow(tr("lj.privacy.allUnmixed"));
    // The box as it is, which its own value can't bring back.
    await expect(lj.withdrawNow("preprod", anywayBox(pool), true, false)).rejects.toThrow();
    // The public account pays, where the user picks it.
    const pending = await lj.withdrawNow("preprod", anywayBox(pool), true, true);
    expect(pending.kind).toBe("lovejoin-withdraw");
  });
});

// The owner's call 34 (2026-10-19): the release review's MONEY-3 refused every new box in a token pool whose boxes
// can't pay their own way back today, or where the check couldn't be made. Those transactions build and the network
// takes them; the boxes then wait for the fees, or come back by Bring one back. Only a box below the network's minimum
// (nothing can be built) and a copy still refuse, and where the wallet picks a pool itself it picks such a pool as any.
describe("a token pool whose boxes can't pay their own way back today (the owner's call 34)", SLOW, () => {
  const STUCK = { coins_per_utxo_size: "4800" };

  it("takes new boxes, from either side, and says on its status why they wait, whether or not the wallet has boxes there", async () => {
    const t = await wallet();
    t.koios.addedToAccounts.push(
      atAccount("e1", "40000000", [ljtest(3n * Q)]),
      atAccount("e2", "30000000"),
      atAccount("e5", "5000000"),
      ...POOL,
      ...(await strangers(t)),
    );
    t.koios.params = STUCK;
    const lj = pooled(t, [TOKEN_POOL]);
    const pool = poolsOf(await lj.status("preprod")).find((p) => p.id === TOKEN)!;
    expect(pool.boxes).toEqual([]);
    expect(pool.unusable).toBeUndefined();
    expect(pool.cantComeBack).toMatchObject({ has: expect.any(String), needs: expect.any(String) });
    await lj.fits("preprod", 1, TOKEN);
    await expect(lj.publicBuild("preprod", 1, { pool: TOKEN })).resolves.toMatchObject({ pool: TOKEN, boxes: 1 });
    await expect(lj.publicBuild("preprod", 3, { pool: TOKEN, bootstrap: true })).resolves.toMatchObject({ bootstrap: true, boxes: 3 });
    // A Bootstrap from the private balance asks the same gate first (session 5's review, L7).
    expect(await lj.privateBootstrapMost("preprod", TOKEN)).toBeGreaterThan(0);
    // A box below the network's minimum still refuses, before anything is built (MONEY-3's other half).
    t.koios.params = { coins_per_utxo_size: "12930" };
    const dear = pooled(t, [TOKEN_POOL]);
    await expect(dear.fits("preprod", 1, TOKEN)).rejects.toThrow(tr("lj.unusable.warn.belowMinimum"));
    expect(poolsOf(await dear.status("preprod")).find((p) => p.id === TOKEN)!.unusable).toEqual({ why: "belowMinimum" });
  });

  it("measures each token pool once an epoch at a pool read, for both what it takes and whether a box comes back (L4)", async () => {
    const t = await wallet();
    t.koios.addedToAccounts.push(...POOL, ...(await strangers(t)));
    t.koios.params = STUCK;
    const wasm = loadTestWasm();
    let measured = 0;
    const lj = pooled(t, [TOKEN_POOL], {
      wasm: {
        ...wasm,
        lovejoinUsable: (request: string) => {
          measured++;
          return wasm.lovejoinUsable(request);
        },
      } as typeof wasm,
    });
    const pool = poolsOf(await lj.status("preprod")).find((p) => p.id === TOKEN)!;
    expect(pool.cantComeBack).toMatchObject({ has: expect.any(String), needs: expect.any(String) });
    expect(measured).toBe(1);
    // And not again within the epoch.
    await lj.status("preprod");
    expect(measured).toBe(1);
  });

  it("refuses nothing where the check couldn't be made: the build says what's wrong, if anything is", async () => {
    const t = await wallet();
    t.koios.addedToAccounts.push(...POOL, ...(await strangers(t)));
    const wasm = loadTestWasm();
    const lj = pooled(t, [TOKEN_POOL], {
      wasm: {
        ...wasm,
        lovejoinUsable: () => {
          throw new Error("couldn't measure");
        },
      } as typeof wasm,
    });
    await lj.fits("preprod", 1, TOKEN);
    expect(poolsOf(await lj.status("preprod")).find((p) => p.id === TOKEN)!.unusable).toBeUndefined();
  });

  it("is picked for a return's token as any pool is, and the way says its boxes wait", async () => {
    const t = await wallet();
    t.koios.addedToAccounts.push(...POOL, ...(await strangers(t)));
    t.koios.params = STUCK;
    const lj = pooled(t, [TOKEN_POOL]);
    // What a swap's review asks of a token's pools: this one, whose boxes can't come back today, still takes a box.
    await lj.status("preprod");
    const pools = await lj.poolsOf("preprod", LJTEST);
    expect(pools.map((p) => p.id)).toEqual([TOKEN]);
    expect((await lj.usable("preprod", pools)).map((p) => p.id)).toEqual([TOKEN]);
    expect(await lj.stuck("preprod", pools[0]!)).toBe(true);
    t.koios.params = undefined;
    const fresh = pooled(t, [TOKEN_POOL]);
    await fresh.status("preprod");
    expect(await fresh.stuck("preprod", (await fresh.poolsOf("preprod", LJTEST))[0]!)).toBe(false);
  });
});

// The owner's call 36 (2026-10-19): Bring one back was paid by the public account alone (Claude's §2 choice). Nothing
// stops the private balance paying: Lovejoin's withdraw counts only its own box inputs, and the Seedelf validator only
// its proof and the one-time key's signature. So a Seedelf UTxO of ADA alone goes in beside the box and comes back with
// it, under giveme.my's collateral, as any Seedelf spend; the page asks for it by default.
describe("a box brought back paid from the private balance (the owner's call 36)", SLOW, () => {
  /** A Seedelf UTxO of the wallet's at the contract: `value` lovelace, and `assets`. */
  async function privateUtxo(t: T, tx: string, value: string, assets: Array<ReturnType<typeof ljtest>> = []): Promise<KoiosUtxo> {
    return {
      ...ownedUtxos[0]!,
      tx_hash: tx.repeat(32),
      tx_index: 0,
      value,
      inline_datum: { bytes: await datum(t, true), value: {} },
      asset_list: assets.map((a) => ({ ...a, decimals: 0, fingerprint: "asset1ljtest" })) as never,
    } as KoiosUtxo;
  }

  /** The stuck pool, the wallet's mixed box in it, the private UTxOs; giveme.my and the one-time key's signing stood in for. */
  async function stuckWith(utxos: (t: T) => Promise<KoiosUtxo[]>, classes: Map<string, HistoryClass> = new Map()) {
    // None of the fixture's own contract UTxOs: the private balance holds what the test gives it, and nothing else.
    const t = testBalances({ owned: false });
    await t.wallet.create(PHRASE, PASSWORD);
    t.koios.evaluation = AGREES;
    t.koios.tip = 110_000_000;
    t.koios.params = { coins_per_utxo_size: "4800" };
    const box = await tokenBox(t, "f1", true, 7);
    t.koios.addedToAccounts.push(...POOL, box, ...(await strangers(t)));
    t.koios.added.push(...(await utxos(t)));
    const signed: Array<{ txCbor: string; seed: string; collateral: unknown }> = [];
    const written: Array<Record<string, unknown>> = [];
    const wasm = loadTestWasm();
    const lj = pooled(t, [TOKEN_POOL], {
      wasm: {
        ...wasm,
        signScriptSpend: (_key: unknown, request: string) => {
          const asked = JSON.parse(request) as { txCbor: string; seed: string; collateral: unknown };
          signed.push(asked);
          return JSON.stringify({ txCbor: asked.txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(asked.txCbor, "hex"))) });
        },
      } as typeof wasm,
      activity: {
        classes: async () => classes,
        sent: async (_n: unknown, _p: unknown, summary: Record<string, unknown>) => {
          written.push(summary);
        },
      } as unknown as Deps["activity"],
    });
    return { t, lj, box, signed, written };
  }

  it("spends the smallest UTxO of ADA alone that pays, beside the box, under giveme.my, signed with a one-time key", async () => {
    const { t, lj, box, signed, written } = await stuckWith(async (t) => [
      await privateUtxo(t, "d1", "50000000"),
      await privateUtxo(t, "d2", "3000000"),
      await privateUtxo(t, "d3", "2500000", [ljtest(Q)]),
    ]);
    const before = t.collateral.asked.length;
    const pending = await lj.withdrawNow("preprod", { txHash: box.tx_hash, txIndex: 0, pool: TOKEN }, false, "private");
    expect(pending.kind).toBe("lovejoin-withdraw");
    const sent = t.koios.submitted.at(-1)!;
    expect(txInputs(sent).sort()).toEqual([`${box.tx_hash}#0`, `${"d2".repeat(32)}#0`].sort());
    // giveme.my witnessed it, and the one-time key signed it after, as every Seedelf spend.
    expect(t.collateral.asked.length).toBe(before + 1);
    expect(signed).toHaveLength(1);
    expect(signed[0]!.seed).toMatch(/^[0-9a-f]{64}$/);
    // Its history: the box's ADA less the fee came in (the UTxO that paid was private already), with the fee, and the
    // box's way back merged with the UTxO's history (unknown here).
    expect(written).toHaveLength(1);
    const entry = written[0]! as { lovelace: string; fee: string; origin: HistoryClass; tokens: unknown[] };
    expect(BigInt(entry.lovelace) + BigInt(entry.fee)).toBe(2_000_000n);
    expect(entry.tokens).toEqual([{ policyId: VIEW.token.policyId, assetName: VIEW.token.assetName, quantity: Q.toString() }]);
    expect(entry.origin).toEqual(merged([boxFrom(pending.txHash), UNKNOWN]));
    // The public account wasn't asked to pay, nor read again.
    expect(txInputs(sent).some((o) => o.startsWith("e1"))).toBe(false);
  });

  it("takes a UTxO a box back from Lovejoin made first, which ties no account", async () => {
    const { t, lj, box, written } = await stuckWith(
      async (t) => [await privateUtxo(t, "d1", "50000000"), await privateUtxo(t, "d2", "3000000")],
      new Map([[`${"d1".repeat(32)}#0`, boxFrom("b0".repeat(32))]]),
    );
    const pending = await lj.withdrawNow("preprod", { txHash: box.tx_hash, txIndex: 0, pool: TOKEN }, false, "private");
    expect(txInputs(t.koios.submitted.at(-1)!)).toContain(`${"d1".repeat(32)}#0`);
    expect((written[0] as { origin: HistoryClass }).origin).toEqual(merged([boxFrom(pending.txHash), boxFrom("b0".repeat(32))]));
  });

  it("says so in words when no UTxO of the private balance pays, and sends nothing", async () => {
    const { t, lj, box } = await stuckWith(async (t) => [await privateUtxo(t, "d3", "2500000", [ljtest(Q)])]);
    await expect(lj.withdrawNow("preprod", { txHash: box.tx_hash, txIndex: 0, pool: TOKEN }, false, "private")).rejects.toThrow(
      tr("lj.privatePayNone"),
    );
    expect(t.koios.submitted).toHaveLength(0);
  });

  it("says what holds the private balance's UTxOs when none is free, rather than to make some ADA private (L3)", async () => {
    const { t, lj, box } = await stuckWith(async (t) => [await privateUtxo(t, "d2", "3000000")]);
    await t.balances.get("preprod");
    await t.coins.setLocked("preprod", "seedelf", `${"d2".repeat(32)}#0`, true);
    await expect(lj.withdrawNow("preprod", { txHash: box.tx_hash, txIndex: 0, pool: TOKEN }, false, "private")).rejects.toThrow(
      tr("worker.spend.allLocked"),
    );
    expect(t.koios.submitted).toHaveLength(0);
  });

  it("is asked for through the handler, which passes the private balance on and nothing else", async () => {
    const asked: unknown[] = [];
    const lj = { withdrawNow: async (...args: unknown[]) => asked.push(args.slice(1)) } as unknown as LovejoinService;
    const ctx = { lovejoin: lj, network: "preprod" } as unknown as Context;
    const box = { txHash: "f1".repeat(32), txIndex: 0 };
    await handle({ type: "lovejoin-withdraw-now", box, paid: "private" } as Message, ctx);
    await handle({ type: "lovejoin-withdraw-now", box, paid: true } as Message, ctx);
    await handle({ type: "lovejoin-withdraw-now", box, paid: "account" } as unknown as Message, ctx);
    await handle({ type: "lovejoin-withdraw-now", box } as Message, ctx);
    expect(asked.map((a) => (a as unknown[])[2])).toEqual(["private", true, false, false]);
  });

  it("writes the same history once it's seen, after Koios didn't answer its submit", async () => {
    const { t, lj, box, written } = await stuckWith(async (t) => [await privateUtxo(t, "d2", "3000000")]);
    // Koios takes the transaction and never answers.
    const answers = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      if (String(url).endsWith("/submittx")) {
        await answers(url, init);
        throw new TypeError("network error");
      }
      return answers(url, init);
    };
    await expect(lj.withdrawNow("preprod", { txHash: box.tx_hash, txIndex: 0, pool: TOKEN }, false, "private")).rejects.toThrow();
    t.koios.fetch = answers;
    type Kept = { withdrawing?: { txHash: string; box?: unknown; origin?: HistoryClass; paid?: unknown; lovelace: string; fee: string } };
    const kept = (await t.store.get<Kept>("lovejoin.preprod"))!.withdrawing!;
    expect(kept.box).toEqual({ txHash: box.tx_hash, txIndex: 0 });
    expect(kept.paid).toBeUndefined();
    expect(kept.origin).toEqual(merged([boxFrom(kept.txHash), UNKNOWN]));
    expect(BigInt(kept.lovelace) + BigInt(kept.fee)).toBe(2_000_000n);
    expect(written).toHaveLength(0);
    // Seen on chain at the next run: its history, as the send would have written it.
    t.koios.confirmations = 1;
    await lj.withdrawDue("preprod");
    expect(written).toEqual([expect.objectContaining({ lovelace: kept.lovelace, fee: kept.fee, origin: kept.origin })]);
    expect((await t.store.get<Kept>("lovejoin.preprod"))!.withdrawing).toBeUndefined();
  });
});

// 34g's last review, CROSS-1: a mix or a Bootstrap from the private balance is checked for its pool at review, and its
// chain is built once the funding lands, maybe at the next unlock. A pool that turned into a copy meanwhile (an earlier
// launch of its values found) still took the session's boxes: the chain's build never looked at the pool again.
describe("a mix session whose pool takes no new box by the time its chain is built (34g's last review, CROSS-1)", SLOW, () => {
  /** A mix session funded into the token pool from the private balance, its funding on chain, its chain not built. */
  async function funded(bootstrap: boolean) {
    const t = await wallet();
    const pools = { now: [TOKEN_POOL] as Array<PoolRef | CopyRef> };
    const lj = pooled(t, [], { pools: async () => pools.now });
    const sessions = runner(t, lj);
    const boxes = bootstrap ? 2 : 1;
    t.koios.added.push({
      ...ownedUtxos[0]!,
      tx_hash: "d1".repeat(32),
      tx_index: 0,
      value: "30000000",
      inline_datum: { bytes: await datum(t, true), value: {} },
      asset_list: [{ ...ljtest(4n * Q), decimals: 0, fingerprint: "asset1ljtest" } as never],
    } as KoiosUtxo);
    t.koios.addedToAccounts.push(...POOL, ...(await strangers(t)));
    const out = await sessions.mixOutBuild("preprod", boxes, { pool: TOKEN, ...(bootstrap ? { bootstrap: true } : {}) });
    await sessions.mixOutSubmit("preprod", out.txHash);
    // Its funding lands as it paid the account: a mix's 5 ₳ collateral too, never a Bootstrap's (1.6.0's release
    // review, x-compat#0).
    t.koios.addedToAccounts.push(...landed(t, out.txHash, ljtest(BigInt(boxes) * Q)));
    t.koios.confirmations = 1;
    return { t, sessions, pools };
  }
  const intoToken = async (t: T) =>
    ((await t.store.get<Sealed>("lovejoin.preprod"))?.chains ?? []).some((c) => (c as { pools?: Record<string, number> }).pools?.[TOKEN]);
  const skipped = async (t: T) => (await t.store.get<{ sessions: Array<{ mix?: { skipped?: string } }> }>("sessions.preprod"))?.sessions[0]?.mix?.skipped;

  for (const bootstrap of [false, true]) {
    it(`comes back directly, saying why, never into the copy (${bootstrap ? "a Bootstrap" : "a mix"})`, async () => {
      // The pool as it was: the chain goes into it.
      const stays = await funded(bootstrap);
      await stays.sessions.advance("preprod", 0, true);
      expect(await intoToken(stays.t)).toBe(true);
      // An earlier launch of the same values turns up before the chain is built: the pool is a copy now.
      const copied = await funded(bootstrap);
      copied.pools.now = [COPY];
      await copied.sessions.advance("preprod", 0, true);
      expect(await intoToken(copied.t)).toBe(false);
      expect(await skipped(copied.t)).toBe(tr("lj.unusable.warn.superseded"));
    });
  }

  it("refuses a public mix's Send into a pool that turned into a copy since its review", async () => {
    const t = await wallet();
    const pools = { now: [TOKEN_POOL] as Array<PoolRef | CopyRef> };
    const lj = pooled(t, [], { pools: async () => pools.now });
    t.koios.addedToAccounts.push(atAccount("e1", "40000000", [ljtest(3n * Q)]), atAccount("e2", "30000000"), atAccount("e5", "5000000"), ...POOL, ...(await strangers(t)));
    const summary = await lj.publicBuild("preprod", 1, { pool: TOKEN });
    pools.now = [COPY];
    await expect(lj.publicSubmit("preprod", summary.txHash)).rejects.toThrow(tr("lj.unusable.warn.superseded"));
    expect(t.koios.submitted).toHaveLength(0);
  });
});
