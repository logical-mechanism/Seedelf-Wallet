// Chunk 34's gate (backward compatibility 3, 4, 5 and 8): what 1.5.0 did, and
// what this tree does from the same start. Token pools must leave the classic
// pool exactly as 1.5.0 has it.
//
// The fixture, tests/fixtures/lovejoin-1.5.0.json, is 1.5.0's own record,
// written by this very file in a worktree at 1.5.0's release (63f87b8), with
// that commit's WebAssembly built:
//
//   RECORD_1_5_0=1 npx vitest run tests/lovejoin-1-5-0.test.ts
//
// It holds:
// - **plans**: what Lovejoin planned for a grid of returns and mixes (the
//   boxes, the deposit's and the mixes' fees and outputs, what each review
//   showed), to be met exactly;
// - **a vault mid-flight**: a 1.5.0 wallet's local storage, with a return's
//   chain four transactions in, a withdraw in its write-ahead slot, and boxes
//   due, and the chain those left behind;
// - **what 1.5.0 did after an update** (session storage wiped, the wallet
//   locked), from that vault: each run's sends and the sealed schedule after
//   it, to be met exactly;
// - **a restore** of the same phrase on that chain: what it found.
//
// Every draw a delay takes is pinned (a seeded generator), so the same calls
// in the same order give the same due times. What WebAssembly draws for
// itself (a withdraw's fresh register) gives each withdraw a hash of its own
// on each run, so those are named in the order they appear.
//
// Both are met again with the token pools every preprod wallet is handed
// from its first read shown (the bundled head start), the classic pool's
// plans, transactions and Koios requests against the same record, but what a
// shown pool asks of its own: nothing is recorded for it (1.6.0's release
// review, x-compat#2; its review of the fixes, R3-17).
import { readFileSync, writeFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, type PoolRef } from "../src/background/lovejoin";
import { Minswap } from "../src/background/minswap";
import { SESSION_BACK, SessionService } from "../src/background/sessions";
import { NETWORKS, type NetworkName } from "../src/networks";
import { txIdOf } from "./fixtures/cbor";
import { busyFor, koiosPreprod, loadTestWasm, minswapEstimate, sessionSwap, testBalances, vectors, withdrawPreprod } from "./fakes";

const RECORD = process.env.RECORD_1_5_0 === "1";
const FIXTURE = new URL("./fixtures/lovejoin-1.5.0.json", import.meta.url);

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
const MINUTE = 60_000;
const PHRASE = (
  vectors("cardano_account.json") as Array<{ account: number; phrase: string }>
).find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase;

/** 20 boxes from Lovejoin's preprod pool, as Koios lists them (2026-09-25). */
const POOL = (
  JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }
).pool;
const MIX_BOX = NETWORKS.preprod.lovejoin!.mixBox;
const POOL_ADDRESS = POOL[0]!.address;

/** Ogmios's answer when the network measures no more than a transaction declares. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

/**
 * Keeps `Date.now()` on the test's clock: some of the worker reads it rather
 * than its `now` (a session's send remembers what it spent by it), and in
 * the worker the two are one clock.
 */
function onClock(t: { clock: { now: number } }): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(t.clock.now);
}

/** Real transactions are built and measured in WebAssembly: seconds each, and more on CI. */
const SLOW = { timeout: 300_000 };

/** A seeded draw in [0, 1) (mulberry32): the same calls in the same order draw the same delays. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A UTxO at session 0's account, as Koios lists it. */
function atSession(tx_hash: string, tx_index: number, value: string, block_time = 1_800_000_000): KoiosUtxo {
  return {
    tx_hash,
    tx_index,
    address: sessionSwap.address,
    value,
    stake_address: null,
    payment_cred: sessionSwap.keyHash,
    epoch_no: 315,
    block_height: 5_000_000,
    block_time,
    datum_hash: null,
    inline_datum: null,
    reference_script: null,
    is_spent: false,
    asset_list: [],
  } as KoiosUtxo;
}

type Env = ReturnType<typeof testBalances> & { lovejoin: LovejoinService; sessions: SessionService };

/** The pools discovery hands the wallet on a network, as sw.ts wires it: none, the classic pool alone, as 1.5.0 read. */
type Handed = (network: NetworkName) => Array<PoolRef | { copy: PoolRef }>;

/**
 * Lovejoin and the sessions over the fakes, with every delay drawn from
 * `random`, and giveme.my's witness stood in for (its recorded answer is
 * another transaction's). `handed`: the pools discovery hands it, pool reads
 * and what it last kept alike.
 */
function wire(t: ReturnType<typeof testBalances>, random: () => number, handed?: Handed): Env {
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  const collateral = () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch);
  const lovejoin = new LovejoinService({
    ...t.deps,
    wasm: {
      ...wasm,
      finishLovejoinWithdraw: (request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral,
    store: t.store,
    random,
    ...(handed ? { pools: async (n: NetworkName) => handed(n), known: async (n: NetworkName) => handed(n) } : {}),
  });
  const sessions = new SessionService({
    ...t.deps,
    collateral,
    store: t.store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
    lovejoin,
    random,
    sleep: async () => undefined,
  });
  return Object.assign(t, { lovejoin, sessions });
}

/** Session 0, a site's, holding `lovelace` and its 5 ₳ collateral. */
async function withSession(t: ReturnType<typeof testBalances>, lovelace: string): Promise<void> {
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: t.clock.now,
        txs: [{ kind: "out", txHash: "ab".repeat(32), at: t.clock.now, confirmed: true }],
        site: { origin: "https://example.org" },
      },
    ],
  });
  t.koios.addedToAccounts.push(atSession("c1".repeat(32), 0, lovelace), atSession("c2".repeat(32), 1, "5000000"));
}

/** A box of the wallet's in the pool, made by someone else's mix `blockTime` (s) ago: Koios says so (M14). */
async function ownedBox(t: Env, tx: string, blockTime: number): Promise<KoiosUtxo> {
  const wasm = loadTestWasm();
  const datum = await t.wallet.withKeys((keys) => wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister())));
  t.koios.txSpends.set(tx.repeat(32), [{ payment_addr: { bech32: POOL_ADDRESS, cred: MIX_BOX } }]);
  return {
    ...POOL[0]!,
    tx_hash: tx.repeat(32),
    tx_index: 0,
    block_time: blockTime,
    inline_datum: { bytes: Buffer.from(datum).toString("hex"), value: {} },
  } as KoiosUtxo;
}

/**
 * Transaction `bytes` lands: what it spends goes, and its outputs at the pool
 * and at session 0's account show, as Koios would list them.
 */
function land(t: ReturnType<typeof testBalances>, bytes: Uint8Array, blockTime: number): void {
  const wasm = loadTestWasm();
  // What it spent, as tx_info lists its inputs: what a restore asks of a box no record accounts for (M14).
  const rows = new Map([...POOL, ...t.koios.addedToAccounts].map((u) => [`${u.tx_hash}#${u.tx_index}`, u]));
  const inputs = txInputs(bytes).flatMap((o) => {
    const row = rows.get(o);
    return row ? [{ payment_addr: { bech32: row.address, cred: row.payment_cred ?? null } }] : [];
  });
  t.koios.txSpends.set(txIdOf(bytes), inputs);
  for (const o of txInputs(bytes)) t.koios.spent.add(o);
  const outs = JSON.parse(wasm.ogmiosUtxos(Buffer.from(bytes).toString("hex"))) as Array<{
    transaction: { id: string };
    index: number;
    address: string;
    value: { ada: { lovelace: number } } & Record<string, Record<string, number>>;
    datum?: string;
  }>;
  for (const o of outs) {
    const lovelace = String(o.value.ada.lovelace);
    if (o.address === POOL_ADDRESS) {
      t.koios.addedToAccounts.push({
        ...POOL[0]!,
        tx_hash: o.transaction.id,
        tx_index: o.index,
        value: lovelace,
        block_time: blockTime,
        datum_hash: null,
        inline_datum: { bytes: o.datum!, value: {} },
      } as KoiosUtxo);
    } else if (o.address === sessionSwap.address) {
      t.koios.addedToAccounts.push(atSession(o.transaction.id, o.index, lovelace, blockTime));
    }
  }
}

/**
 * What's measured rather than planned: a return's chain, its fees and what
 * they leave (`returns`, its review's and its chain's). Each mix draws its
 * pool boxes at random, and their order moves its scripts' budgets a little
 * (lovejoin-mix-width.md), so two builds of one plan differ by a few hundred
 * lovelace. Every key named here is compared within MEASURED_SLACK there;
 * everything else exactly, the funding grid's planned lovelace too: a name
 * alone gave it the slack, so a classic plan could drift 0.5% (1.6.0's review
 * of the fixes, R3-18).
 */
const MEASURED = new Set(["fee", "fees", "lovelace", "measured"]);
const MEASURED_IN = ".returns[";
const MEASURED_SLACK = 0.005;

/** `actual` against `expected`: equal, but for MEASURED's numbers in a return, within MEASURED_SLACK of each other. */
function nearly(actual: unknown, expected: unknown, path = "", key = ""): string[] {
  if (
    MEASURED.has(key) &&
    path.startsWith(MEASURED_IN) &&
    typeof expected === "string" &&
    /^\d+$/.test(expected) &&
    typeof actual === "string" &&
    /^\d+$/.test(actual)
  ) {
    const [a, e] = [Number(actual), Number(expected)];
    return Math.abs(a - e) <= Math.max(1, e * MEASURED_SLACK) ? [] : [`${path}: ${actual}, against 1.5.0's ${expected}`];
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return [`${path}: ${JSON.stringify(actual)}, against 1.5.0's ${JSON.stringify(expected)}`];
    return expected.flatMap((e, i) => nearly(actual[i], e, `${path}[${i}]`, key));
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return [`${path}: ${JSON.stringify(actual)}, against 1.5.0's ${JSON.stringify(expected)}`];
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    return [...keys].flatMap((k) => nearly((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k], `${path}.${k}`, k));
  }
  return Object.is(actual, expected) ? [] : [`${path}: ${JSON.stringify(actual)}, against 1.5.0's ${JSON.stringify(expected)}`];
}

/** What a built chain is, apart from its proofs and fresh registers: each transaction's kind, fee and outputs' values. */
function chainShape(txs: Array<{ kind: string; txCbor: string; fee: string }>) {
  const wasm = loadTestWasm();
  return txs.map((tx) => {
    const outs = JSON.parse(wasm.ogmiosUtxos(tx.txCbor)) as Array<{ address: string; value: { ada: { lovelace: number } } }>;
    return {
      kind: tx.kind,
      fee: tx.fee,
      // A box holds exactly its value; what else a transaction pays is what its fees leave.
      outputs: outs.map((o) =>
        o.address === POOL_ADDRESS
          ? { to: "pool", box: String(o.value.ada.lovelace) }
          : { to: o.address === sessionSwap.address ? "session" : "seedelf", measured: String(o.value.ada.lovelace) },
      ),
    };
  });
}

/** Names each hash first seen on this run, in order: what's built afresh (a withdraw) has a hash of its own each run. */
function namer(known: Set<string>) {
  const names = new Map<string, string>();
  return (hash: string) => {
    if (known.has(hash)) return hash;
    if (!names.has(hash)) names.set(hash, `new${names.size + 1}`);
    return names.get(hash)!;
  };
}

/** The sealed schedule, its new hashes named, its signed bytes left out. */
function normalized(value: unknown, name: (h: string) => string): unknown {
  if (Array.isArray(value)) return value.map((v) => normalized(v, name));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => k !== "txCbor")
        .map(([k, v]) => [k.replace(/[0-9a-f]{64}/g, (h) => name(h)), normalized(v, name)]),
    );
  }
  if (typeof value === "string") return value.replace(/[0-9a-f]{64}/g, (h) => name(h));
  return value;
}

// ---------------------------------------------------------------------------
// The plans (backward compatibility 3)
// ---------------------------------------------------------------------------

/** `handed`: the pools discovery hands the wallet (wire); none, the classic pool alone, as 1.5.0 planned. */
async function plans(handed?: Handed): Promise<unknown> {
  const out: Record<string, unknown> = {};
  // What mixing a number of boxes takes, as the tile and the reviews read it, on both networks.
  const funding: unknown[] = [];
  {
    const t = wire(testBalances(), seeded(1), handed);
    await t.wallet.create(PHRASE, PASSWORD);
    for (const network of ["preprod", "mainnet"] as const) {
      for (const depth of [0, 1, 2, 3] as const) {
        for (const again of [false, true]) {
          for (const boxes of [1, 2, 3, 5, 10, 40]) {
            if (again && depth === 0) continue;
            funding.push({ network, depth, again, boxes, funding: await t.lovejoin.funding(network, boxes, again, depth) });
          }
        }
      }
    }
  }
  out.funding = funding;

  // What a session's spare ADA pays for, at each depth, a return's and mixing again's.
  const planned: unknown[] = [];
  for (const lovelace of ["12000000", "25000000", "40000000", "105000000", "300000000"]) {
    const t = wire(testBalances(), seeded(2), handed);
    await t.wallet.create(PHRASE, PASSWORD);
    const rows = [atSession("c1".repeat(32), 0, lovelace), atSession("c3".repeat(32), 2, "3000000"), atSession("c2".repeat(32), 1, "5000000")];
    for (const depth of [0, 1, 2, 3] as const) {
      for (const again of [false, true]) {
        // Mixing again at no depth is no mix at all, and nothing asks for it (WebAssembly traps on it).
        if (again && depth === 0) continue;
        planned.push({ lovelace, depth, again, plan: await t.lovejoin.plan("preprod", 0, rows, rows[2]!, again, depth) });
      }
    }
  }
  out.plans = planned;

  // A return's review, and the chain it built: kinds, fees and every output's value, at each depth.
  const returns: unknown[] = [];
  for (const lovelace of ["25000000", "40000000", "105000000"]) {
    for (const depth of [1, 2, 3] as const) {
      const t = wire(testBalances(), seeded(3), handed);
      await t.wallet.create(PHRASE, PASSWORD);
      await t.deps.preferences.set({ lovejoinDepth: depth });
      await withSession(t, lovelace);
      t.koios.addedToAccounts.push(...POOL);
      t.koios.evaluation = AGREES;
      const review = await t.sessions.backBuild("preprod", 0);
      const kept = await t.wallet.withKeys(() => t.session.get<{ chain?: Array<{ kind: string; txCbor: string; fee: string }> }>(SESSION_BACK));
      const { txHash: _hash, builtAt: _at, ...shown } = review as typeof review & { builtAt?: number };
      returns.push({ lovelace, depth, review: normalized(shown, (h) => (h === "c1".repeat(32) || h === "c2".repeat(32) ? h : "built")), chain: kept?.chain ? chainShape(kept.chain) : null });
    }
  }
  out.returns = returns;

  // A swap's review and Stop's, as the pool's room has them.
  {
    const ASK = minswapEstimate.ask;
    const t = wire(testBalances(), seeded(4), handed);
    await t.wallet.create(PHRASE, PASSWORD);
    const spend = withdrawPreprod.amount.evaluation as { result: unknown[] };
    t.koios.evaluation = (body: { params: { additionalUtxo?: unknown[] } }) =>
      body.params.additionalUtxo ? AGREES : { ...spend, result: spend.result.slice(0, 1) };
    t.koios.addedToAccounts.push(...POOL);
    const quote = await t.sessions.quote("preprod", ASK);
    const outBuilt = await t.sessions.outBuild("preprod", quote);
    out.swap = { quote: quote.lovejoin, review: outBuilt.lovejoin };
  }
  {
    const t = wire(testBalances(), seeded(5), handed);
    await t.wallet.create(PHRASE, PASSWORD);
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: t.clock.now,
          txs: [{ kind: "out", txHash: "ab".repeat(32), at: t.clock.now, confirmed: true }],
          swap: { ...minswapEstimate.ask, amountOut: "906594100", minAmountOut: "902083681" },
          auto: { approved: { minAmountOut: "902083681", fund: { lovelace: "40000000", tokens: [] } }, direct: false },
        },
      ],
    });
    t.koios.addedToAccounts.push(atSession("c1".repeat(32), 0, "40000000"), atSession("c2".repeat(32), 1, "5000000"), ...POOL);
    t.koios.evaluation = AGREES;
    t.koios.confirmations = 1;
    await t.sessions.list("preprod", true);
    out.stop = await t.sessions.stopCost("preprod", 0);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The vault mid-flight (backward compatibility 4 and 5)
// ---------------------------------------------------------------------------

interface Vault {
  /** The wallet's local storage, as 1.5.0 left it. */
  local: Record<string, string>;
  clock: number;
  /** The chain the fakes answer with: the pool, session 0's account, what's spent, and what made each box. */
  rows: KoiosUtxo[];
  spent: string[];
  txSpends: Record<string, unknown>;
  /** Every transaction 1.5.0 sent, in order (hex). */
  submitted: string[];
}

/**
 * Lands every transaction sent from now on as it's sent, a block's worth on,
 * as Koios lists it once it's in a block. Returns how to stop.
 */
function landing(t: ReturnType<typeof testBalances>): () => void {
  const fetch = t.koios.fetch;
  t.koios.fetch = async (url, init) => {
    const answer = await fetch(url, init);
    if (url.endsWith("/submittx") && answer.ok) land(t, new Uint8Array(init!.body as Uint8Array), t.clock.now / 1000);
    return answer;
  };
  return () => {
    t.koios.fetch = fetch;
  };
}

/**
 * A 1.5.0 wallet mid-flight. Six boxes someone else's mix moved, due back;
 * a mix from the public account, two boxes a wave deep, all sent half an
 * hour before, its record still kept; the first box due gone in a withdraw
 * Koios didn't answer (kept, sealed, in its write-ahead slot); and a
 * return's chain through Lovejoin four transactions in, its deposit's two
 * boxes due too. The due times of the boxes that can come back are set
 * where the runs after the update meet each rule: two due together, and
 * one due a run four minutes after the user's own send.
 */
async function makeVault(): Promise<Vault> {
  const t = wire(testBalances(), seeded(10));
  await t.wallet.create(PHRASE, PASSWORD);
  // An hour's auto-lock: the unlock's waits then run to their 20 minutes.
  await t.deps.preferences.set({ lockAfterMinutes: 60 });
  const start = t.clock.now;
  t.koios.evaluation = AGREES;
  t.koios.addedToAccounts.push(...POOL);
  // Six boxes of the wallet's, someone else's mix having moved them five hours ago, due back 1 to 6 hours from now.
  for (const tx of ["d1", "d2", "d3", "d4", "d5", "d6"]) t.koios.addedToAccounts.push(await ownedBox(t, tx, start / 1000 - 5 * 3600));
  await t.lovejoin.schedule("preprod", 6);
  await withSession(t, "40000000");
  // The public account: its 5 ₳ collateral and 60 ₳.
  const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
  const keyHash = await t.wallet.withKeys((keys) => keys.cardano.paymentKeyHash(0, 0));
  const atAccount = (tx: string, value: string) => ({ ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, payment_cred: keyHash, asset_list: [] });
  t.koios.addedToAccounts.push(atAccount("e5", "5000000"), atAccount("e6", "60000000"));

  // Six hours on, the wallet unlocked: the unlock's run draws each box due a fresh wait. Then a mix from the public
  // account, a wave deep, sent whole, each transaction in a block as it goes.
  t.clock.now = start + 6 * HOUR;
  await t.wallet.unlock(PASSWORD);
  expect(await t.lovejoin.withdrawDue("preprod", true)).toEqual([]);
  await t.deps.preferences.set({ lovejoinDepth: 1 });
  const stop = landing(t);
  t.koios.confirmations = 1;
  const mix = await t.lovejoin.publicBuild("preprod", 2);
  await t.lovejoin.publicSubmit("preprod", mix.txHash);
  while (await t.lovejoin.pumpPublic("preprod", 0)) await busyFor(t, MINUTE);
  stop();
  t.koios.confirmations = null;
  await t.deps.preferences.set({ lovejoinDepth: 2 });
  expect((await t.store.get<{ chains: Array<{ done?: boolean }> }>("lovejoin.preprod"))!.chains).toMatchObject([{ done: true }]);

  // Twenty-five minutes on, the alarm's run sends a box back: Koios doesn't answer its submit, but it reached a mempool.
  await busyFor(t, 25 * MINUTE);
  const fetch = t.koios.fetch;
  let refusedOnce = false;
  const submittedBefore = t.koios.submitted.length;
  t.koios.fetch = async (url, init) => {
    if (url.endsWith("/submittx") && !refusedOnce) {
      refusedOnce = true;
      await fetch(url, init);
      return new Response("", { status: 504 });
    }
    return fetch(url, init);
  };
  expect(await t.lovejoin.withdrawDue("preprod")).toEqual([]);
  t.koios.fetch = fetch;
  expect(t.koios.submitted).toHaveLength(submittedBefore + 1);
  const withdraw = t.koios.submitted.at(-1)!;
  // What it spends, the chain has as spent: it's in a mempool.
  for (const o of txInputs(withdraw)) t.koios.spent.add(o);
  const kept = (await t.store.get<{ due: number[]; withdrawing?: unknown; marks?: unknown }>("lovejoin.preprod"))!;
  expect(kept.withdrawing).toBeDefined();

  // Ten minutes on: the due times as the runs after the update will meet them (the update comes a minute after this).
  await busyFor(t, 10 * MINUTE);
  const at = t.clock.now;
  expect(kept.due).toHaveLength(7);
  const due = [6, 6, 13, 34.5, 120, 180, 300].map((m) => at + m * MINUTE);
  const { marks: _marks, ...rest } = kept;
  await t.store.set("lovejoin.preprod", { ...rest, due });

  // The session comes back through Lovejoin: Send sends the deposit and three mixes, and then the update comes.
  const review = await t.sessions.backBuild("preprod", 0);
  expect(review.lovejoin).toMatchObject({ boxes: 2, depth: 2 });
  await t.sessions.backSubmit("preprod", review.txHash);
  const chain = t.koios.submitted.slice(submittedBefore + 1);
  expect(chain).toHaveLength(4);

  return {
    local: Object.fromEntries([...t.local.data].map(([k, v]) => [k, v as string])),
    clock: t.clock.now,
    rows: t.koios.addedToAccounts,
    spent: [...t.koios.spent],
    txSpends: Object.fromEntries(t.koios.txSpends),
    submitted: [withdraw, ...chain].map((b) => Buffer.from(b).toString("hex")),
  };
}

/** The Koios requests since call `from`, each as its path and what it named. */
function callsSince(t: ReturnType<typeof testBalances>, from: number, name: (h: string) => string): string[] {
  return t.koios.calls.slice(from).map((c) => {
    const b = (c.body ?? {}) as Record<string, unknown>;
    const named = [b._payment_credentials, b._tx_hashes, b._utxo_refs, b._stake_addresses, b._addresses]
      .filter((v): v is string[] => Array.isArray(v))
      .flat()
      .map((v) => String(normalized(v, name)));
    return [c.path, c.query, ...named].filter(Boolean).join(" ");
  });
}

/**
 * The extension updated while `vault` was mid-flight: session storage gone,
 * the wallet locked. A minute on, the chain's four transactions land, and
 * the user unlocks; the withdraw Koios didn't answer stays unseen for ten
 * minutes more, then lands. Then the worker's runs, a minute apart, for nine
 * hours, the wallet kept open: each run's sends, its Koios requests and
 * giveme.my's, and the sealed schedule after any run that changed it. Half
 * an hour in, the user brings session 0 back.
 *
 * The schedule is compared whole but for `mixes`, which 1.5.0 never wrote:
 * chunk 34's list of every mix, followed until its boxes are back.
 * `handed`: the pools discovery hands the wallet, and the restore's (wire).
 */
async function afterUpdate(vault: Vault, handed?: Handed): Promise<unknown> {
  const t = wire(testBalances(), seeded(20), handed);
  for (const [k, v] of Object.entries(vault.local)) t.local.data.set(k, v);
  t.koios.evaluation = AGREES;
  t.koios.addedToAccounts = vault.rows.map((r) => ({ ...r }));
  for (const o of vault.spent) t.koios.spent.add(o);
  for (const [tx, inputs] of Object.entries(vault.txSpends)) t.koios.txSpends.set(tx, inputs as never);
  t.clock.now = vault.clock + MINUTE;
  const before = vault.submitted.map((h) => Uint8Array.from(Buffer.from(h, "hex")));
  const known = new Set([...before.map((b) => txIdOf(b)), ...vault.rows.map((r) => r.tx_hash), "ab".repeat(32)]);
  const name = namer(known);
  // The chain 1.5.0 sent lands, in order, a block apart. Its withdraw, first, is unseen yet.
  const [withdraw, ...chain] = before;
  for (const [i, bytes] of chain.entries()) land(t, bytes, vault.clock / 1000 + 20 * (i + 1));
  t.koios.confirmations = 1;
  const unseen = txIdOf(withdraw!);
  t.koios.missing.add(unseen);

  const trace: unknown[] = [];
  const landed = new Set([...before.map((b) => txIdOf(b))].filter((h) => h !== unseen));
  let sentSoFar = 0;
  let callsSoFar = 0;
  let askedSoFar = 0;
  let lastSchedule = "";
  const step = async (label: string, run: () => Promise<unknown>) => {
    const result = await run().then(
      (r) => r,
      (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }),
    );
    const sends = t.koios.submitted.slice(sentSoFar).map((bytes) => {
      const hash = txIdOf(bytes);
      // What it sent lands at once, a block's worth on; the withdraw a mempool holds, once it's seen.
      if (!landed.has(hash) && !t.koios.missing.has(hash)) {
        landed.add(hash);
        land(t, bytes, t.clock.now / 1000);
      }
      return { tx: name(hash), spends: txInputs(bytes).map((o) => name(o.slice(0, 64)) + o.slice(64)).sort() };
    });
    sentSoFar = t.koios.submitted.length;
    const calls = callsSince(t, callsSoFar, name);
    callsSoFar = t.koios.calls.length;
    const asked = t.collateral.asked.length - askedSoFar;
    askedSoFar = t.collateral.asked.length;
    const { mixes: _mixes, ...sealed } = (await t.store.get<Record<string, unknown>>("lovejoin.preprod")) ?? {};
    const schedule = JSON.stringify(normalized(sealed, name));
    const changed = schedule !== lastSchedule;
    lastSchedule = schedule;
    if (sends.length || changed || calls.length || label !== "run") {
      trace.push({
        at: t.clock.now - vault.clock,
        label,
        ...(result !== undefined ? { result: normalized(result, name) } : {}),
        ...(sends.length ? { sends } : {}),
        ...(calls.length ? { calls } : {}),
        ...(asked ? { asked } : {}),
        ...(changed ? { schedule: JSON.parse(schedule) as unknown } : {}),
      });
    }
  };
  const run = async (unlock = false) => {
    onClock(t);
    const since = t.clock.now;
    await t.sessions.runAll("preprod", unlock).catch(() => false);
    await t.lovejoin.pumpPublic("preprod").catch(() => false);
    await t.lovejoin.withdrawDue("preprod", unlock, since).catch(() => undefined);
    await t.lovejoin.returning("preprod").catch(() => false);
  };

  await step("unlock", async () => {
    await t.wallet.unlock(PASSWORD);
    await run(true);
  });
  await step("held", () => t.lovejoin.held("preprod"));
  await step("chains", () => t.lovejoin.chains("preprod"));
  await step("sessions", async () => (await t.sessions.list("preprod")).map((s) => ({ index: s.index, chain: s.chain })));
  for (let minute = 1; minute <= 9 * 60; minute++) {
    await busyFor(t, MINUTE);
    if (minute === 10) {
      t.koios.missing.delete(unseen);
      landed.add(unseen);
      land(t, withdraw!, t.clock.now / 1000);
    }
    await step("run", () => run());
    if (minute === 30) {
      await step("bring session 0 back", async () => {
        onClock(t);
        const back = await t.sessions.backBuild("preprod", 0);
        await t.sessions.backSubmit("preprod", back.txHash);
        const { builtAt: _at, ...shown } = back as typeof back & { builtAt?: number };
        return shown;
      });
    }
    if (minute % 60 === 0) await step("held", () => t.lovejoin.held("preprod"));
  }
  await step("status", () => t.lovejoin.status("preprod"));
  await step("chains", () => t.lovejoin.chains("preprod"));
  await step("sessions", async () => (await t.sessions.list("preprod")).map((s) => ({ index: s.index, chain: s.chain })));

  // A restore of the same phrase, in another browser, on the chain as it now stands (backward compatibility 8).
  const r = wire(testBalances(), seeded(30), handed);
  r.clock.now = t.clock.now;
  await r.wallet.create(PHRASE, PASSWORD);
  r.koios.evaluation = AGREES;
  r.koios.addedToAccounts = t.koios.addedToAccounts.map((u) => ({ ...u }));
  for (const o of t.koios.spent) r.koios.spent.add(o);
  for (const [tx, inputs] of t.koios.txSpends) r.koios.txSpends.set(tx, inputs);
  const status = normalized(await r.lovejoin.status("preprod"), name);
  const restored = { status, held: await r.lovejoin.held("preprod"), calls: callsSince(r, 0, name) };
  return { trace, restored };
}

// ---------------------------------------------------------------------------
// With the token pools shown (1.6.0's release review, x-compat#2)
// ---------------------------------------------------------------------------

/**
 * The pools discovery hands every wallet on `network` from its first read: the bundled head start's (preprod's MIN
 * pool of 4.5 ₳ and 100 MIN a box, and its 5 ₳ ADA pool; none on mainnet), as discovery's kept() merges them. Read
 * only when this case runs: 1.5.0's tree, where this file records, has no such file.
 */
const headStart: Handed = (network) => {
  const file = JSON.parse(readFileSync(new URL("../src/lovejoin-pools.json", import.meta.url), "utf8")) as Record<string, { pools: Array<{ ref: PoolRef; copy?: true }> }>;
  return file[network]!.pools.map((p) => (p.copy ? { copy: p.ref } : p.ref));
};

type Plans = {
  funding: Array<{ network: string; depth: number; funding: Record<string, unknown> }>;
  swap: { quote: Record<string, unknown>; review: Record<string, unknown> };
};

/**
 * `plans` but what a token pool shown adds by design, none of it the classic pool's: what the Mix form counts for a
 * collateral's mix where a 5 ₳ pool is shown (lovejoin-funding's collateralReserve and collateralPool), and a swap's
 * way for the token it gets, through a pool of it (ways, values). As the user types, the quote funds that token's boxes
 * beside the swap (fund), so a stop would bring their ADA back through the classic pool too (ifStopped): the quote's
 * other figures are compared. At Review the token's pool has no room, so the review's are all 1.5.0's but its way.
 */
function classicPlans(plans: unknown): unknown {
  const p = structuredClone(plans) as Plans;
  for (const f of p.funding) {
    delete f.funding.collateralReserve;
    delete f.funding.collateralPool;
  }
  for (const key of ["ways", "values", "fund", "ifStopped"]) delete p.swap.quote[key];
  for (const key of ["ways", "values"]) delete p.swap.review[key];
  return p;
}

type After = { trace: Array<{ label: string; result?: unknown; calls?: string[] }>; restored: Record<string, unknown> };

/**
 * The mix boxes of the pools the head start shows on preprod, each as WebAssembly derives it from the bundled templates
 * and the pool's seed, as the wallet verifies a pool: what every read of the shown pools names beside the classic
 * pool's. From the head start itself, so its refresh at each release (`npm run lovejoin-pools`) carries over.
 */
function shownMixBoxes(): string[] {
  const wasm = loadTestWasm();
  return headStart("preprod")
    .map((p) => {
      const pool = "copy" in p ? p.copy : p;
      return (JSON.parse(wasm.lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool }))) as { mixBoxHash: string }).mixBoxHash;
    })
    .filter((box) => box !== MIX_BOX);
}

/**
 * A step's Koios requests (or the restore's) as 1.5.0 asked them with the classic pool alone shown, but what a shown
 * pool asks of its own: the shown pools' mix boxes come out of each read naming them (a read of the pools names every
 * pool it reads); in the return's step (`back`), its read of the pools for its collateral's 5 ₳ pool goes; and in the
 * hub's read of the pools (`status`), the parameters a token pool's read asks go. What's left is compared exactly, and
 * so is every other request: the wallet's own credentials, transactions and UTxOs named, and a read of the shown pools
 * alone, which leaves one naming nothing (1.6.0's review of the fixes, R3-17).
 */
function classicCalls(calls: string[], shown: string[], { back = false, status = false } = {}): string[] {
  let pools = back;
  let params = status;
  return calls.flatMap((call) => {
    const [path, query, ...named] = call.split(" ");
    if (path === "credential_utxos" && named.some((c) => shown.includes(c))) {
      if (pools) {
        pools = false;
        return [];
      }
      return [[path, query, ...named.filter((c) => !shown.includes(c))].join(" ")];
    }
    if (path === "epoch_params" && params) {
      params = false;
      return [];
    }
    return [call];
  });
}

/**
 * `after` but what a token pool shown adds by design: what's asked of its own (classicCalls), and the token pools the
 * hub lists (status's and held's `pools`). Each run's sends, results, schedule and every other request are compared
 * whole: a request beside a pool read, such as one naming the wallet's boxes, isn't left out with what a shown pool
 * asks (R3-17).
 */
function classicAfter(after: unknown): unknown {
  const shown = shownMixBoxes();
  const a = structuredClone(after) as After;
  for (const step of a.trace) {
    if (step.calls) step.calls = classicCalls(step.calls, shown, { back: step.label === "bring session 0 back", status: step.label === "status" });
    if (step.result && typeof step.result === "object") delete (step.result as Record<string, unknown>).pools;
  }
  a.restored.calls = classicCalls(a.restored.calls as string[], shown, { status: true });
  for (const key of ["status", "held"]) delete (a.restored[key] as Record<string, unknown>).pools;
  return a;
}

// ---------------------------------------------------------------------------

describe("1.5.0's Lovejoin, through token pools (chunk 34's gate)", SLOW, () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  if (RECORD) {
    it("records 1.5.0", async () => {
      // Only 1.5.0's own tree records it: run on a later one, the fixture would hold that tree's behaviour under 1.5.0's
      // name, and the gate would hold every later tree to it (1.6.0's release review, x-compat#2).
      const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
      if (version !== "1.5.0") throw new Error(`RECORD_1_5_0 records 1.5.0 alone, in a worktree at 63f87b8: this tree is ${version}`);
      const vault = await makeVault();
      // The vault as JSON keeps it: what's replayed is what's stored.
      const stored = JSON.parse(JSON.stringify(vault)) as Vault;
      const record = { recorded: "1.5.0 (63f87b8)", plans: await plans(), vault: stored, after: await afterUpdate(stored) };
      writeFileSync(FIXTURE, JSON.stringify(record, null, 1) + "\n");
    });
    return;
  }

  const recorded = JSON.parse(readFileSync(FIXTURE, "utf8")) as { plans: unknown; vault: Vault; after: unknown };

  it("plans every return and mix with no tokens as 1.5.0 did: the same boxes, mixes and outputs, its fees as measured", async () => {
    expect(nearly(await plans(), recorded.plans)).toEqual([]);
  });

  it("finishes a 1.5.0 vault left mid-flight by an update as 1.5.0 did, and a restore finds what 1.5.0's found", async () => {
    expect(await afterUpdate(recorded.vault)).toEqual(recorded.after);
  });

  describe("with the token pools every preprod wallet is handed shown (1.6.0's release review, x-compat#2)", () => {
    const head = JSON.parse(readFileSync(new URL("../src/lovejoin-pools.json", import.meta.url), "utf8")) as Record<
      "preprod" | "mainnet",
      { pools: Array<{ id: string; boxLovelace: string; token?: unknown }> }
    >;
    const bundled = head.preprod.pools;
    const minPool = bundled.find((p) => p.token)!;
    // Each network's 5 ₳ pool its head start bundles: preprod's, and mainnet's since 1.7.0's head start, its first.
    const fivePoolOn = (network: "preprod" | "mainnet") => head[network].pools.find((p) => !p.token && p.boxLovelace === "5000000");

    it("plans every return and mix as 1.5.0 did, but what a shown pool adds of its own", async () => {
      const got = (await plans(headStart)) as Plans;
      expect(nearly(classicPlans(got), classicPlans(recorded.plans))).toEqual([]);
      // What's left out is the pools' own: the 5 ₳ pool's reserve wherever a mix makes mixes on a network whose head start
      // bundles one (preprod, and mainnet since 1.7.0's); the token's way into the MIN pool as the user types, and back
      // directly at Review, its pool empty.
      for (const f of got.funding) expect(f.funding.collateralPool, `${f.network} ${f.depth}`).toBe(f.depth > 0 ? fivePoolOn(f.network as "preprod" | "mainnet")?.id : undefined);
      expect(got.swap.quote.ways).toEqual([expect.objectContaining({ pool: minPool.id })]);
      expect(got.swap.review.ways).toEqual([expect.objectContaining({ boxes: 0, pools: [] })]);
    });

    it("finishes a 1.5.0 vault left mid-flight by an update as 1.5.0 did, its sends and schedules alike, and a restore finds what 1.5.0's found", async () => {
      const got = (await afterUpdate(recorded.vault, headStart)) as After;
      expect(classicAfter(got)).toEqual(classicAfter(recorded.after));
      // The hub lists every shown pool all along, as every preprod wallet's does: each the head start bundles, which
      // `npm run lovejoin-pools` rewrites at each release.
      const status = got.trace.find((s) => s.label === "status")!.result as { pools?: Array<{ id: string }> };
      expect(status.pools?.map((p) => p.id).sort()).toEqual(bundled.map((p) => p.id).sort());
    });
  });
});
