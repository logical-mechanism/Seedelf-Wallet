// 1.6.0's branch review, the sessions' fixes: a session's funding in parts (10a) and its parts that wait for the one
// before to be in a block (10b), as Stop, a return, a failure, a site and the runner's clock meet them. Session 0 of
// the 12-word phrase, the real WebAssembly, and the fakes of swap-session.ts and site-funding-parts.test.ts.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import { DappService, type DappSession } from "../src/background/dapp";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, type PoolRef } from "../src/background/lovejoin";
import { builtOutputs } from "../src/background/minswap";
import { LOOK_EVERY_MS, PartsService, SESSION_WAITING_PREFIX, type OnStopped, type Waiting } from "../src/background/parts";
import { partKey } from "../src/background/script-spend";
import { SESSION_BACK, SESSION_OUT, type SessionService } from "../src/background/sessions";
import { reservedSet } from "../src/background/spent";
import { TransferService } from "../src/background/transfer";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, ownedUtxos, sessionSwap, testBalances, transferPreprod, vectors } from "./fakes";
import { ASK, atSession, bookOf, busy, PASSWORD, signing, type T } from "./swap-session";

const SLOW = { timeout: 300_000 };
const PHRASE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase;
const ORIGIN = "https://app.example.com";
const SHORT = "Only part of the private session's funding reached the chain.";
const NOT_ALL_THERE = "The private session's funding isn't all on chain yet.";

const ids = (t: T) => t.koios.submitted.map((b) => txIdOf(b));
const ticks = async (n = 50) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
let pages = 0;
const page = (): DappSession => ({ id: `fixes${++pages}`, origin: ORIGIN, title: "Example" });

/** A session's transactions as its sealed record holds them. */
type Recorded = { kind: string; txHash: string; at: number; unsent?: boolean; missed?: boolean; confirmed?: boolean };
const recordOf = async (t: T, index = 0) => {
  const s = (await bookOf(t)).sessions.find((r) => r.index === index)!;
  return { ...s, txs: s.txs as unknown as Recorded[] };
};

async function waitFor(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 400 && !(await check()); i++) await new Promise((r) => setTimeout(r, 0));
  expect(await check()).toBe(true);
}

/** Signing stood in for: the one-time key's and the Seedelf key's signatures. */
function signed() {
  const wasm = loadTestWasm();
  return {
    ...wasm,
    signScriptSpend: (_key: unknown, request: string) => {
      const { txCbor } = JSON.parse(request) as { txCbor: string };
      return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
    },
  } as typeof wasm;
}

/**
 * As sw.ts wires them: the sessions, the parts that wait (`pumps`: told when they won't all go, and asked before each
 * goes), and the connector. `stopped`: what the parts tell the sessions, in place of partsStopped.
 */
function services(t: T, { stopped }: { stopped?: OnStopped } = {}) {
  const sessions = signing(t);
  const spends = {
    ...t.deps,
    wasm: signed(),
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
  };
  const pumps = new PartsService({
    ...spends,
    stopped: stopped ?? ((n, w) => sessions.partsStopped(n, w)),
    mayGo: (n, w) => sessions.partsMayGo(n, w),
  });
  const dapp = new DappService({
    ...spends,
    preferences: t.preferences,
    sessions,
    fundingPollMs: 1,
    network: () => "preprod",
    window: t.dappWindow,
    changed: () => undefined,
  });
  return { sessions, pumps, dapp };
}

/** The wallet with only `n` private UTxOs of ADA alone, `lovelace` each: more than one transaction spends. */
async function spread(n = 40, lovelace = "700000"): Promise<T> {
  const t = testBalances({ owned: false });
  await t.wallet.create(PHRASE, PASSWORD);
  await t.preferences.set({ dappConnector: true, spendRewards: false });
  const base = ownedUtxos[0]!;
  t.koios.added.push(...Array.from({ length: n }, (_, i) => ({ ...base, value: lovelace, tx_hash: (i + 1).toString(16).padStart(64, "0") })));
  return t;
}

/** What transaction `id` (submitted) paid session 0's account, as Koios lists it there once it lands. */
function paidTheAccount(t: T, id: string): KoiosUtxo[] {
  const bytes = t.koios.submitted.find((b) => txIdOf(b) === id);
  if (!bytes) throw new Error(`not submitted: ${id}`);
  return builtOutputs(bytes).flatMap((o, i) => (o.address.slice(2, 58) === sessionSwap.keyHash ? [atSession(id, i, o.lovelace.toString())] : []));
}

/** Transaction `id` lands: tx_status shows it, and what it paid session 0's account is listed there. */
function land(t: T, id: string): void {
  t.koios.confirmations = 1;
  t.koios.missing.delete(id);
  t.koios.addedToAccounts.push(...paidTheAccount(t, id));
}

/** Session 0's swap, its funding built in parts (and kept for Send): the build. */
async function swapBuiltInParts(sessions: SessionService) {
  const out = await sessions.outBuild("preprod", await sessions.quote("preprod", ASK));
  expect(out.parts!.length).toBeGreaterThanOrEqual(2);
  return { out, parts: out.parts!.map((p) => p.txHash) };
}

// --- A funding that chains: holders of token T, each beside 19 other tokens at exactly the least ADA they need, so a
// part of them has no ADA of its own to pay its fee with (payment-parts-chain.test.ts's shape, as a session's).

type Tok = { policy_id: string; asset_name: string; quantity: string; decimals: number; fingerprint: string };
let made = 0;
const tok = (quantity: string): Tok => ({
  policy_id: (0xabc000000000 + ++made).toString(16).padStart(56, "0"),
  asset_name: (0x1000 + made).toString(16).padStart(64, "0"),
  quantity,
  decimals: 0,
  fingerprint: "",
});
let rows = 0x300;
const row = (lovelace: string, assets: Tok[] = []): KoiosUtxo => ({
  ...ownedUtxos[0]!,
  tx_hash: (rows++).toString(16).padStart(64, "0"),
  value: lovelace,
  asset_list: assets,
});
const quantities = (assets: Tok[]) => assets.map((a) => ({ policyId: a.policy_id, assetName: a.asset_name, quantity: a.quantity }));

/** The least ADA a Seedelf UTxO of `assets` carries, as a payment of them says. */
async function seedelfLeast(assets: Tok[]): Promise<bigint> {
  const t = testBalances({ owned: false });
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.added.push(row("409000000"), row("300000000", assets));
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  const transfer = new TransferService({
    ...t.deps,
    wasm: signed(),
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
  });
  return BigInt((await transfer.build("preprod", [{ to: transferPreprod.to, lovelace: "0", tokens: quantities(assets) }])).payments[0]!.minimum!);
}

/** 12 holders of T (1000 each) beside 19 other tokens, at their least, and 100 ₳ in one UTxO: all of T goes in 2 parts, chained. */
async function keepers() {
  const T = tok("0");
  const sets = Array.from({ length: 12 }, () => [{ ...T, quantity: "1000" }, ...Array.from({ length: 19 }, () => tok("5"))]);
  const least = await seedelfLeast(sets[0]!);
  const t = testBalances({ owned: false });
  // One clock, as in the worker: what a return spends is stamped with Date.now(), and a part's send reads deps.now().
  t.clock.now = Date.now();
  await t.wallet.create(PHRASE, PASSWORD);
  await t.preferences.set({ dappConnector: true, spendRewards: false });
  const big = row("100000000");
  t.koios.added.push(...sets.map((s) => row(least.toString(), s)), big);
  return { t, T, big: big.tx_hash, all: [{ policyId: T.policy_id, assetName: T.asset_name, quantity: "12000" }] };
}

/** Session 0's swap of all of T, funded in 2 parts, the second waiting for the first (parts.ts): the parts' hashes. */
async function chainedSwap(options: Parameters<typeof services>[1] = {}) {
  const { t, T } = await keepers();
  const s = services(t, options);
  const quote = await s.sessions.quote("preprod", { amount: "12000", tokenIn: T.policy_id + T.asset_name, tokenOut: "lovelace", slippage: 0.5 } as never);
  const out = await s.sessions.outBuild("preprod", quote);
  expect(out.parts!.map((p) => !!p.waits)).toEqual([false, true]);
  const parts = out.parts!.map((p) => p.txHash);
  expect((await s.sessions.outSubmit("preprod", out.txHash)).parts).toEqual({ sent: 1, total: 2 });
  expect(ids(t)).toEqual([parts[0]]);
  t.koios.missing.add(parts[1]!);
  return { t, ...s, parts };
}

/** A site's private session 0 of all of T, funded in 2 parts, the second waiting: the parts' hashes, and how enable() ended. */
async function chainedSite() {
  const { t, all } = await keepers();
  const s = services(t);
  const asking = page();
  const settled: { value?: unknown; error?: Error } = {};
  void s.dapp.call(asking, "enable", []).then(
    (value) => void (settled.value = value),
    (error: Error) => void (settled.error = error),
  );
  await waitFor(() => s.dapp.approvals().length === 1);
  const id = s.dapp.approvals()[0]!.id;
  const out = await s.dapp.privateBuild(id, "0", all);
  expect(out.parts!.map((p) => !!p.waits)).toEqual([false, true]);
  expect(await s.dapp.answer(id, true, PASSWORD, { txHash: out.txHash })).toEqual({});
  const parts = out.parts!.map((p) => p.txHash);
  expect(ids(t)).toEqual([parts[0]]);
  t.koios.missing.add(parts[1]!);
  return { t, ...s, parts, asking, settled };
}

/** A site's private session 0 funded in parts that each pay their own way (40 UTxOs of 0.7 ₳): the asking page, and how enable() ended. */
async function siteInParts() {
  const t = await spread();
  const s = services(t);
  const asking = page();
  const settled: { value?: unknown; error?: Error } = {};
  void s.dapp.call(asking, "enable", []).then(
    (value) => void (settled.value = value),
    (error: Error) => void (settled.error = error),
  );
  await waitFor(() => s.dapp.approvals().length === 1);
  const id = s.dapp.approvals()[0]!.id;
  const out = await s.dapp.privateBuild(id, "15000000", []);
  expect(out.parts!.length).toBeGreaterThanOrEqual(2);
  await s.dapp.answer(id, true, PASSWORD, { txHash: out.txHash });
  const parts = out.parts!.map((p) => p.txHash);
  expect(ids(t)).toEqual(parts);
  return { t, ...s, parts, asking, settled };
}

describe("Stop on a funding in parts (1.6.0's review: stop-before-short-pause-stuck)", SLOW, () => {
  it("brings back what came, though the funding reads short only after Stop", async () => {
    // Small enough for three parts; the second, signed, is refused when it's submitted.
    const t = await spread(70, "400000");
    let signs = 0;
    const wasm = signed();
    const sessions = signing(t, {
      wasm: {
        ...wasm,
        signScriptSpend: (key: unknown, request: string) => {
          if (++signs === 2) t.koios.rejectSubmit = "Transaction Fails Validation";
          return wasm.signScriptSpend(key as never, request);
        },
      } as typeof wasm,
    });
    const { out, parts } = await swapBuiltInParts(sessions);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    await expect(sessions.outSubmit("preprod", out.txHash)).rejects.toThrow(/transactions of its funding went/);
    t.koios.rejectSubmit = undefined;
    // The card says Stop brings back what came: the user presses it while it reads "funding".
    await sessions.stop("preprod", 0, true);
    // The first part is on chain, but Koios doesn't list it at the account yet when the rest are found missed.
    t.koios.confirmations = 1;
    for (const p of parts.slice(1)) t.koios.missing.add(p);
    await busy(t, 3 * 60_000);
    await sessions.advance("preprod", 0, true);
    expect((await recordOf(t)).auto!.paused).toBeUndefined();
    // Listed now: the runs bring it back, as Stop said.
    t.koios.addedToAccounts.push(...paidTheAccount(t, parts[0]!));
    const before = t.koios.submitted.length;
    for (let i = 0; i < 3; i++) {
      await busy(t, 60_000);
      await sessions.runAll("preprod");
    }
    expect(t.koios.submitted.length).toBe(before + 1);
    expect((await recordOf(t)).txs.map((x) => x.kind)).toEqual([...parts.map(() => "out"), "back"]);
  });
});

describe("a funding's waiting part, asked before it goes (1.6.0's review: stop-doesnt-stop-waiting-parts)", SLOW, () => {
  it("goes while its session goes on, and its clock starts as it goes; a Send's parts always go", async () => {
    const { t, sessions, parts } = await chainedSwap();
    await busy(t, 5 * 60_000);
    const w: Waiting = { hashes: parts, after: [null, parts[0]!], sent: 1, at: t.clock.now, kind: "session-out", what: "payment", session: 0 };
    expect(await sessions.partsMayGo("preprod", w)).toBe(true);
    expect((await recordOf(t)).txs[1]!.at).toBe(t.clock.now);
    expect(await sessions.partsMayGo("preprod", { ...w, hashes: ["ab".repeat(32), "cd".repeat(32)], session: undefined })).toBe(true);
  });

  it("a Send's parts are asked nothing of the sessions: neither their queue nor their book (the merged fixes' review)", async () => {
    const t = await spread(1, "1000000");
    const sessions = signing(t);
    // The queue busy with a long step, and a book that won't open.
    let release!: () => void;
    void (sessions as unknown as { serial(task: () => Promise<void>): Promise<void> }).serial(() => new Promise<void>((r) => (release = r)));
    const get = t.store.get.bind(t.store);
    t.store.get = (async (key: Parameters<typeof get>[0]) => {
      if (key.startsWith("sessions.")) throw new Error("won't open");
      return get(key);
    }) as typeof t.store.get;
    const w: Waiting = { hashes: ["ab".repeat(32), "cd".repeat(32)], after: [null, "ab".repeat(32)], sent: 1, at: t.clock.now, kind: "transfer", what: "payment" };
    const answer = await Promise.race([sessions.partsMayGo("preprod", w), new Promise((r) => setTimeout(() => r("still asking"), 200))]);
    release();
    expect(answer).toBe(true);
  });

  it("doesn't go once the swap is stopped: what came comes back alone", async () => {
    const { t, sessions, pumps, parts } = await chainedSwap();
    land(t, parts[0]!);
    await sessions.stop("preprod", 0, true);
    const w: Waiting = { hashes: parts, after: [null, parts[0]!], sent: 1, at: t.clock.now, kind: "session-out", what: "payment", session: 0 };
    expect(await sessions.partsMayGo("preprod", w)).toBe(false);
    // The pump asks, and the rest never go: the session hears it, and brings back what came.
    t.clock.now += LOOK_EVERY_MS + 1;
    await pumps.pump("preprod");
    expect(ids(t)).toEqual([parts[0]]);
    expect(await pumps.of("preprod", parts[0]!)).toMatchObject({ sent: 1, total: 2, stopped: "cancelled" });
    expect((await recordOf(t)).txs.map((x) => !!x.unsent)).toEqual([false, true]);
    await busy(t, 3 * 60_000);
    const view = await sessions.advance("preprod", 0, true);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "out", "back"]);
    expect(t.minswap.calls.filter((c) => c.path === "build-tx")).toHaveLength(0);
  });

  it("doesn't go once a site's Bring it back is built, nor once its return is sent", async () => {
    const { t, sessions, parts } = await chainedSite();
    land(t, parts[0]!);
    const w: Waiting = { hashes: parts, after: [null, parts[0]!], sent: 1, at: t.clock.now, kind: "session-out", what: "payment", session: 0 };
    expect(await sessions.partsMayGo("preprod", w)).toBe(true);
    await sessions.backBuild("preprod", 0, true);
    expect(await sessions.partsMayGo("preprod", w)).toBe(false);
    // Built long ago, it can't be sent any more, and no longer says anything.
    await busy(t, 11 * 60_000);
    expect(await sessions.partsMayGo("preprod", w)).toBe(true);
    const again = await sessions.backBuild("preprod", 0, true);
    await sessions.backSubmit("preprod", again.txHash);
    await t.session.remove(SESSION_BACK);
    expect(await sessions.partsMayGo("preprod", w)).toBe(false);
  });

  it("doesn't go once the session failed or is over, nor for one the wallet no longer keeps", async () => {
    const { t, sessions, parts } = await chainedSwap();
    const w: Waiting = { hashes: parts, after: [null, parts[0]!], sent: 1, at: t.clock.now, kind: "session-out", what: "payment", session: 0 };
    const book = (await t.store.get<{ sessions: Array<Record<string, unknown> & { auto: Record<string, unknown> }> }>("sessions.preprod"))!;
    book.sessions[0]!.auto.failed = t.clock.now;
    await t.store.set("sessions.preprod", book);
    expect(await sessions.partsMayGo("preprod", w)).toBe(false);
    delete book.sessions[0]!.auto.failed;
    book.sessions[0]!.closedAt = t.clock.now;
    await t.store.set("sessions.preprod", book);
    expect(await sessions.partsMayGo("preprod", w)).toBe(false);
    await t.store.set("sessions.preprod", { ...book, sessions: [] });
    expect(await sessions.partsMayGo("preprod", w)).toBe(false);
  });
});

describe("a waiting part's clock (1.6.0's review: chained-funding-late-clock)", SLOW, () => {
  it("isn't missed while the parts' record has it still to go", async () => {
    const { t, sessions, parts } = await chainedSwap();
    // The first lands; the pump hasn't sent the second yet (giveme.my behind, say). 21 minutes from the record.
    land(t, parts[0]!);
    await busy(t, 21 * 60_000);
    const view = await sessions.advance("preprod", 0, true);
    expect(view.stage).toBe("funding");
    expect(view.auto!.paused).toBeUndefined();
    expect((await recordOf(t)).txs[1]!.missed).toBeUndefined();
  });

  it("starts as the part goes: one sent at +16 minutes isn't missed at +21", async () => {
    const { t, sessions, pumps, parts } = await chainedSwap();
    await busy(t, 12 * 60_000);
    land(t, parts[0]!);
    t.koios.missing.add(parts[1]!);
    await busy(t, 4 * 60_000);
    await pumps.pump("preprod");
    expect(ids(t)).toEqual(parts);
    await busy(t, 5 * 60_000);
    const view = await sessions.advance("preprod", 0, true);
    expect(view.stage).toBe("funding");
    expect(view.auto!.paused).toBeUndefined();
    expect((await recordOf(t)).txs[1]!.missed).toBeUndefined();
    // Not seen 20 minutes after it went: missed then.
    await busy(t, 16 * 60_000);
    expect((await sessions.advance("preprod", 0, true)).auto!.paused).toMatchObject({ why: "short", landed: 1, total: 2 });
  });

  it("is the record's for a part a lock wiped from the parts' record: it never goes, and the funding is short", async () => {
    const { t, sessions, parts } = await chainedSwap();
    land(t, parts[0]!);
    // A lock wipes session storage, and with it what waits (parts.ts).
    await t.session.remove(SESSION_WAITING_PREFIX + "preprod");
    await busy(t, 21 * 60_000);
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.paused).toMatchObject({ why: "short", landed: 1, total: 2 });
  });

  it("a site's: still funding while the part waits, rather than short by the page's own clock", async () => {
    const { t, sessions, parts } = await chainedSite();
    land(t, parts[0]!);
    await busy(t, 21 * 60_000);
    const [view] = await sessions.list("preprod", true);
    expect(view).toMatchObject({ stage: "funding", parts: { landed: 1, total: 2 } });
  });
});

describe("a chained funding's review (1.6.0's review: carry-has-no-history, a session's funding)", SLOW, () => {
  it("names no money of unknown history, the ties between its parts, and seals each part's change with what paid it", async () => {
    const { t, T, big } = await keepers();
    // The holders came in from the public account; the 100 ₳ is what private session 6 left.
    const of = (u: KoiosUtxo) => (u.tx_hash === big ? { id: "session:5", origin: "session" } : { id: "public:0", origin: "own" });
    const sessions = signing(t, {
      activity: { classes: async (_n: string, utxos: KoiosUtxo[]) => new Map(utxos.map((u) => [`${u.tx_hash}#${u.tx_index}`, of(u)])) },
    } as never);
    const quote = await sessions.quote("preprod", { amount: "12000", tokenIn: T.policy_id + T.asset_name, tokenOut: "lovelace", slippage: 0.5 } as never);
    const out = await sessions.outBuild("preprod", quote);
    expect(out.parts!.map((p) => !!p.waits)).toEqual([false, true]);
    expect(out.histories?.map((c) => c.id).sort()).toEqual(["public:0", "session:5"]);
    const kept = await Promise.all([0, 1].map((i) => t.session.get<{ origin?: { id: string } }>(partKey(SESSION_OUT, i))));
    expect(kept.map((k) => k?.origin?.id.includes("unknown"))).toEqual([false, false]);
  });
});

describe("a Bootstrap's funding (1.6.0's review: bootstrap-cap-vs-funding-parts)", SLOW, () => {
  const FOUND = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/lovejoin-token-pool-preprod.json", import.meta.url), "utf8")) as {
    seed: { txHash: string; txIndex: number };
    reference: KoiosUtxo;
    scripts: KoiosUtxo[];
  };
  const TOKEN_POOL: PoolRef = { reference: FOUND.reference, seed: FOUND.seed, scripts: FOUND.scripts };

  function withLovejoin(t: T) {
    t.koios.evaluation = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };
    t.koios.tip = 110_000_000;
    const lovejoin = new LovejoinService({
      ...t.deps,
      wasm: loadTestWasm(),
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      store: t.store,
      pools: async () => [TOKEN_POOL],
      random: () => 0.5,
    });
    return signing(t, { lovejoin, sleep: async () => undefined });
  }

  it("stays one transaction, as its cap's deposit has it: never parts its deposit then can't pay", async () => {
    // Before 1.6.0's review it went in parts here, and a deposit of every part's output near the cap couldn't pay. Its
    // one payment, 13 ₳ for a box with its way back (1.6.0's release review, 318-rust#0), takes 33 of these 40 UTxOs of
    // 0.5 ₳ (as parts would spend them), well past what one transaction spends (about 22), and 20 ₳ pays for it: the
    // refusal is for its inputs, never for its ADA, whatever the reserve or the fees move by.
    const t = await spread(40, "500000");
    const sessions = withLovejoin(t);
    const asked = t.collateral.asked.length;
    await expect(sessions.mixOutBuild("preprod", 1, { bootstrap: true })).rejects.toThrow(
      "That Bootstrap needs more UTxOs than one transaction can spend. Bootstrap fewer boxes.",
    );
    expect(t.koios.submitted).toHaveLength(0);
    expect(t.collateral.asked.length).toBe(asked);
    // What one transaction can spend funds it, as one.
    const fewer = await spread(3, "40000000");
    const out = await withLovejoin(fewer).mixOutBuild("preprod", 1, { bootstrap: true });
    expect(out.parts).toBeUndefined();
  });
});

describe("partsStopped in the sessions' queue (1.6.0's review: partsStopped-outside-queue)", SLOW, () => {
  it("loses neither its own write nor one queued beside it", async () => {
    const H = (n: number) => n.toString(16).padStart(64, "0");
    const lost: number[] = [];
    for (let offset = 0; offset < 12; offset++) {
      const t = testBalances({ owned: false });
      await t.wallet.create(PHRASE, PASSWORD);
      const sessions = signing(t);
      const at = t.clock.now;
      const approved = { minAmountOut: "0", fund: { lovelace: "1", tokens: [] } };
      // Session 0: a mix whose funding went in three parts, the last two waiting; session 1, a swap, funded.
      await t.store.set("sessions.preprod", {
        next: 2,
        sessions: [
          { index: 0, ownStake: true, createdAt: at, parts: 3, txs: [1, 2, 3].map((i) => ({ kind: "out", txHash: H(i), at })), mix: { boxes: 2 }, auto: { approved } },
          { index: 1, ownStake: true, createdAt: at, txs: [{ kind: "out", txHash: H(9), at, confirmed: true }], auto: { approved } },
        ],
      });
      const w: Waiting = { hashes: [H(1), H(2), H(3)], after: [null, H(1), H(2)], sent: 1, at, kind: "session-out", what: "mix", stopped: "refused", session: 0 };
      // A write in the queue, as Stop's on session 1.
      const queued = sessions.stop("preprod", 1).catch(() => undefined);
      for (let i = 0; i < offset; i++) await Promise.resolve();
      await Promise.all([queued, sessions.partsStopped("preprod", w)]);
      const s = await recordOf(t, 0);
      const s1 = await recordOf(t, 1);
      if (!s.txs.slice(1).every((x) => x.unsent) || !s1.auto!.stopping) lost.push(offset);
    }
    expect(lost).toEqual([]);
  });
});

describe("a failed funding in parts (1.6.0's review: failed-funding-part-lands-late, try-again-never-refails)", SLOW, () => {
  it("a part that lands late lifts the failure: it reads short, and Stop brings back what came", async () => {
    const t = await spread();
    const sessions = signing(t);
    const { out, parts } = await swapBuiltInParts(sessions);
    await sessions.outSubmit("preprod", out.txHash);
    for (const p of parts) t.koios.missing.add(p);
    await busy(t, 21 * 60_000);
    expect((await sessions.advance("preprod", 0, true)).stage).toBe("failed");
    // The first shows after all, a backend behind; the rest never do.
    land(t, parts[0]!);
    for (const p of parts.slice(1)) t.koios.missing.add(p);
    const [view] = await sessions.list("preprod", true);
    expect(view).toMatchObject({ stage: "open", parts: { landed: 1, total: parts.length, short: true } });
    expect((await recordOf(t)).auto!.failed).toBeUndefined();
    expect((await recordOf(t)).auto!.paused).toMatchObject({ why: "short" });
    const before = t.koios.submitted.length;
    await sessions.stop("preprod", 0, true);
    for (let i = 0; i < 3 && t.koios.submitted.length === before; i++) {
      await busy(t, 60_000);
      await sessions.runAll("preprod");
    }
    expect(t.koios.submitted.length).toBe(before + 1);
    expect((await recordOf(t)).txs.map((x) => x.kind)).toEqual([...parts.map(() => "out"), "back"]);
  });

  it("Try again on one that never landed fails again, and nothing runs on", async () => {
    const t = await spread();
    const sessions = signing(t);
    const { out, parts } = await swapBuiltInParts(sessions);
    await sessions.outSubmit("preprod", out.txHash);
    for (const p of parts) t.koios.missing.add(p);
    await busy(t, 21 * 60_000);
    expect((await sessions.advance("preprod", 0, true)).stage).toBe("failed");
    const view = await sessions.resume("preprod", 0);
    expect(view.stage).toBe("failed");
    expect((await recordOf(t)).auto!.failed).toBeDefined();
    expect(await sessions.runAll("preprod")).toBe(false);
  });
});

describe("a site's session funded in parts (1.6.0's review: site-gets-funding-or-short-session)", SLOW, () => {
  it("another page's enable() waits while it's funding, and has it once every part lands", async () => {
    const { t, dapp, parts, asking } = await siteInParts();
    land(t, parts[0]!);
    // The asking page goes away: its wait for the funding ends with it.
    dapp.gone(asking);
    const other: { value?: unknown; error?: Error } = {};
    void dapp.call(page(), "enable", []).then(
      (value) => void (other.value = value),
      (error: Error) => void (other.error = error),
    );
    await ticks(100);
    expect(other).toEqual({});
    for (const p of parts.slice(1)) land(t, p);
    await waitFor(() => other.value !== undefined || other.error !== undefined);
    expect(other).toEqual({ value: true });
  });

  it("short of a part, with the asking page gone, refuses the next page and its reads, and unlinks it", async () => {
    const { t, dapp, sessions, parts, asking } = await siteInParts();
    for (const p of parts.slice(0, -1)) land(t, p);
    t.koios.missing.add(parts.at(-1)!);
    dapp.gone(asking);
    await busy(t, 20 * 60_000 + 1);
    await expect(dapp.call(page(), "getUtxos", [])).rejects.toThrow(SHORT);
    expect((await dapp.sites()).filter((s) => s.session === 0)).toEqual([]);
    const [view] = await sessions.list("preprod", true);
    expect(view).toMatchObject({ stage: "open", parts: { landed: parts.length - 1, total: parts.length, short: true } });
  });

  it("short of a part, its next enable() is refused and unlinked", async () => {
    const { t, dapp, parts, asking } = await siteInParts();
    for (const p of parts.slice(0, -1)) land(t, p);
    t.koios.missing.add(parts.at(-1)!);
    dapp.gone(asking);
    await busy(t, 20 * 60_000 + 1);
    await expect(dapp.call(page(), "enable", [])).rejects.toThrow(SHORT);
    expect((await dapp.sites()).filter((s) => s.session === 0)).toEqual([]);
  });

  it("with the wallet locked mid-funding, a page waiting on it isn't told its funding never reached the chain (the merged fixes' review)", async () => {
    const { t, dapp, parts, settled } = await siteInParts();
    land(t, parts[0]!);
    // The asking page sees the first part at the account.
    await ticks(100);
    expect(settled).toEqual({});
    const other: { value?: unknown; error?: Error } = {};
    void dapp.call(page(), "enable", []).then(
      (value) => void (other.value = value),
      (error: Error) => void (other.error = error),
    );
    await ticks(100);
    expect(other).toEqual({});
    // Locked, nothing can be read; 20 minutes on, both waits end.
    await t.wallet.lock();
    t.clock.now += 21 * 60_000;
    await waitFor(() => settled.error !== undefined && other.error !== undefined);
    expect(settled.error!.message).toBe(NOT_ALL_THERE);
    expect(other.error!.message).toBe(NOT_ALL_THERE);
  });

  it("a session funded in one transaction is the site's as it always was", async () => {
    const t = await spread(3, "40000000");
    const { dapp } = services(t);
    const asking = page();
    void dapp.call(asking, "enable", []).catch(() => undefined);
    await waitFor(() => dapp.approvals().length === 1);
    const id = dapp.approvals()[0]!.id;
    const out = await dapp.privateBuild(id, "15000000", []);
    expect(out.parts).toBeUndefined();
    await dapp.answer(id, true, PASSWORD, { txHash: out.txHash });
    dapp.gone(asking);
    // Nothing at the account yet: a linked site has it at once, as before 1.6.0.
    expect(await dapp.call(page(), "enable", [])).toBe(true);
  });
});

describe("a funding's later parts and the review's age (1.6.0's review: later-part-rechecks-review-age)", SLOW, () => {
  it("checks the age once for the whole funding at Send", async () => {
    const t = await spread();
    let signs = 0;
    const wasm = signed();
    const sessions = signing(t, {
      wasm: {
        ...wasm,
        signScriptSpend: (key: unknown, request: string) => {
          // The first part's send is slow: giveme.my, Koios.
          if (++signs === 1) t.clock.now += 2 * 60_000;
          return wasm.signScriptSpend(key as never, request);
        },
      } as typeof wasm,
    });
    const { out, parts } = await swapBuiltInParts(sessions);
    await busy(t, 9 * 60_000 + 50_000);
    await sessions.outSubmit("preprod", out.txHash);
    expect(ids(t)).toEqual(parts);
    expect((await recordOf(t)).txs.map((x) => !!x.unsent)).toEqual(parts.map(() => false));
  });
});

describe("a return beside a waiting part (1.6.0's review: return-merges-reserved-part-input)", SLOW, () => {
  it("never merges into what a waiting part has reserved", async () => {
    const { t, all } = await keepers();
    const { sessions, pumps } = services(t);
    const transfer = new TransferService({
      ...t.deps,
      wasm: signed(),
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      store: t.store,
    });
    // A Send of all of T to someone: its second part waits, and what it spends is reserved.
    const summary = await transfer.build("preprod", [{ to: transferPreprod.to, lovelace: "0", tokens: all }]);
    expect(summary.parts!.map((p) => !!p.waits)).toEqual([false, true]);
    await transfer.submit("preprod", summary.txHash);
    const reserved = await t.wallet.withKeys(() => reservedSet(t.session, "preprod", { sending: true }));
    const F = [...reserved.inputs].find((o) => !o.startsWith(`${summary.parts![0]!.txHash}#`))!;
    // Session 0, a site's, whose funding made F (its change); its account holds 12 ₳ and its 5 ₳ collateral.
    const now = t.clock.now;
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [{ index: 0, ownStake: true, createdAt: now, txs: [{ kind: "out", txHash: F.split("#")[0], at: now, confirmed: true }], site: { origin: ORIGIN } }],
    });
    t.koios.addedToAccounts.push(atSession("a0".repeat(32), 0, "12000000"), atSession("a1".repeat(32), 1, "5000000"));
    const back = await sessions.backBuild("preprod", 0, true);
    const kept = (await t.wallet.withKeys(() => t.session.get<{ txCbor: string }>(SESSION_BACK)))!;
    expect(txInputs(Uint8Array.from(Buffer.from(kept.txCbor, "hex")))).not.toContain(F);
    expect(back.merged ?? 0).toBe(0);
    // The return goes, then the payment's rest.
    await sessions.backSubmit("preprod", back.txHash);
    t.koios.confirmations = 1;
    t.clock.now += LOOK_EVERY_MS + 1;
    await pumps.pump("preprod");
    expect(ids(t)).toEqual([summary.parts![0]!.txHash, back.txHash, summary.parts![1]!.txHash]);
  });
});

describe("the guards no test exercised (1.6.0's review)", SLOW, () => {
  it("untested-fundingrecords-stale-part: a later kept part that isn't the reviewed one refuses Send, before anything goes or is recorded", async () => {
    const t = await spread();
    const sessions = signing(t);
    const { out } = await swapBuiltInParts(sessions);
    // A second review kept meanwhile wrote its own second part.
    const second = (await t.session.get<{ txHash: string }>(partKey(SESSION_OUT, 1)))!;
    await t.session.set(partKey(SESSION_OUT, 1), { ...second, txHash: "ee".repeat(32) });
    await expect(sessions.outSubmit("preprod", out.txHash)).rejects.toThrow("That payment isn't ready to send. Review it again.");
    expect(t.koios.submitted).toHaveLength(0);
    expect((await t.store.get<{ sessions: unknown[] }>("sessions.preprod"))?.sessions ?? []).toHaveLength(0);
  });

  it("untested-stopped-hook-notsent: a waiting part turned away tells its session at once, which reads short", async () => {
    const told: Waiting[] = [];
    let sessions!: SessionService;
    const chained = await chainedSwap({
      stopped: async (n, w) => {
        told.push(w);
        await sessions.partsStopped(n, w);
      },
    });
    const { t, pumps, parts } = chained;
    sessions = chained.sessions;
    land(t, parts[0]!);
    t.koios.rejectSubmit = "Transaction Fails Validation";
    t.clock.now += LOOK_EVERY_MS + 1;
    await pumps.pump("preprod");
    t.koios.rejectSubmit = undefined;
    expect(told.map((w) => [w.stopped, w.session, w.sent])).toEqual([["refused", 0, 1]]);
    expect((await recordOf(t)).txs.map((x) => !!x.unsent)).toEqual([false, true]);
    // Short at once, not 20 minutes on.
    await busy(t, 3 * 60_000);
    expect((await sessions.advance("preprod", 0, true)).auto!.paused).toMatchObject({ why: "short", landed: 1, total: 2 });
  });

  it("untested-stopped-hook-notsent: a part Koios didn't answer leaves every part after it unsent", async () => {
    const t = await spread(70, "400000");
    const sessions = signing(t);
    const { out, parts } = await swapBuiltInParts(sessions);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    // Koios takes the second, then doesn't answer: it may have gone.
    const real = t.koios.fetch;
    let submits = 0;
    t.koios.fetch = async (url, init) => {
      const answer = await real(url, init);
      return url.endsWith("/submittx") && ++submits === 2 ? new Response("upstream request timeout", { status: 504 }) : answer;
    };
    // "The server", on preprod too: on mainnet the wallet's own server takes a send first (1.6.0's release review,
    // x-i18n-ja#0).
    await expect(sessions.outSubmit("preprod", out.txHash)).rejects.toThrow(/the server didn't answer for the last one sent, so the rest didn't go/);
    t.koios.fetch = real;
    expect(ids(t)).toEqual(parts.slice(0, 2));
    expect((await recordOf(t)).txs.map((x) => !!x.unsent)).toEqual(parts.map((_, i) => i > 1));
  });
});
