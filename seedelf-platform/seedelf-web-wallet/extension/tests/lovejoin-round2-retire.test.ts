// 1.8.0's review of its fixes, the retire lane. The first unlock's retired run, stopped partway (Settings' Stop, or by
// itself after BRING_FAILED_RUNS runs that sent nothing), left the boxes it hadn't taken with no due time and no count:
// critic#3 dropped 1.7's counts of them not mixed yet, a 1.7 Bootstrap's boxes let go have none, and Stop put the read
// two hours on. Home left them out until then, and a run that stopped having sent nothing never read them at all. The
// read retireOnce owes comes at the next run now, never put later by a Stop, and comes again two hours on while one of
// the run's withdraws is still listed and held as spent, so the box a node dropped one for still gets its due time
// (r2-critic#0). And two things the look's comments say: with the 5 ₳ pool kept, an ask asks nobody, so a token pool
// launched later on Koios paths is found as Lovejoin's page opens, at a pool's start or at Settings' press, never by a
// return (r2-critic#1); and the look's five minutes are a worker's, its throttle in memory, so a worker Chrome started
// again looks at its first ask (r2-critic#2).
//
// With the real WebAssembly, the classic pool's recorded preprod boxes, and v2's pools (v2-pools.ts, and PR #163's
// token pool on v2's scripts). Discovery is wired as sw.ts wires it (serviceDeps, lookForPools: discovery.look), from a
// head start that holds no pool on v2's scripts, as lovejoin-found-later's is.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import { DataParts } from "../src/background/data-layer";
import { Koios, type KoiosLaunch, type KoiosUtxo } from "../src/background/koios";
import { BRING_LATE_MS, LovejoinService, type LovejoinDeps, type PoolRef } from "../src/background/lovejoin";
import { HOLDER, PoolDiscovery, REFRESH_MS, serviceDeps, type Kept } from "../src/background/lovejoin-pools";
import { Minswap } from "../src/background/minswap";
import { privateIndexClient } from "../src/background/private-index";
import { SessionService } from "../src/background/sessions";
import { SPENT_KEEP_MS } from "../src/background/spent";
import bundled from "../src/lovejoin-pools.json";
import { NETWORKS, type NetworkName } from "../src/networks";
import { inLovejoinShown } from "../src/ui/screens/Home";
import { account, AGREES, atSession, PASSWORD, POOL } from "./chain-fixtures";
import { fakeIndex, indexRowOf } from "./fake-index";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { busyFor, loadTestWasm, memoryArea, testBalances } from "./fakes";
import { ADA, ADA_POOL, ADA_ROWS, adaStrangers, ownDatum, strangerDatum } from "./v2-pools";

/** Real withdraws and chains are built and measured in WebAssembly: seconds each, more on CI. */
const SLOW = { timeout: 300_000 };
const wasm = loadTestWasm();
const HOUR = 3_600_000;
/** The test clock's start (fakes.ts testWallet). */
const START = 1_800_000_000_000;
const CLASSIC_BOX = NETWORKS.preprod.lovejoin!.mixBox;
type T = ReturnType<typeof testBalances>;

// ---------------------------------------------------------------------------
// r2-critic#0: the first unlock's retired run, stopped partway
// ---------------------------------------------------------------------------

/** Lovejoin reading v2's 5 ₳ pool beside the classic pool, giveme.my asked at each withdraw (so a test can change it). */
function pooled(t: T, pools: PoolRef[] = [ADA_POOL], extra: Partial<LovejoinDeps> = {}): LovejoinService {
  return new LovejoinService({
    ...t.deps,
    wasm: {
      ...wasm,
      finishLovejoinWithdraw: (request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", (u, i) => t.collateral.fetch(u, i)),
    store: t.store,
    pools: async () => pools,
    random: () => 0.5,
    ...extra,
  });
}

async function wallet(): Promise<T> {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  t.koios.evaluation = AGREES;
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return t;
}

/** A box of the wallet's in the classic pool at `tx#index`, a mix there having made it `hours` ago. */
async function classicBox(t: T, tx: string, hours = 5, index = 0): Promise<KoiosUtxo> {
  const hash = tx.length === 64 ? tx : tx.repeat(32);
  t.koios.txSpends.set(hash, [{ payment_addr: { bech32: POOL[0]!.address, cred: CLASSIC_BOX } }]);
  return {
    ...POOL[0]!,
    tx_hash: hash,
    tx_index: index,
    block_time: Math.floor(t.clock.now / 1000) - hours * 3600,
    inline_datum: { bytes: await ownDatum(t.wallet), value: {} },
  } as KoiosUtxo;
}

/** What giveme.my was asked to witness: each withdraw's inputs, in order. */
const withdrawn = (t: T) => t.collateral.asked.flatMap((tx) => txInputs(Uint8Array.from(Buffer.from(tx, "hex"))));
const at = (u: KoiosUtxo) => `${u.tx_hash}#${u.tx_index}`;
/** The withdraws of `only`'s boxes are on chain: their pool no longer lists them. */
function landed(t: T, only: string[]): void {
  const gone = new Set(only);
  const kept = t.koios.addedToAccounts.filter((u) => !gone.has(at(u)));
  t.koios.addedToAccounts.splice(0, t.koios.addedToAccounts.length, ...kept);
}

/** giveme.my witnesses the first `ok` withdraws, then answers `then`; the returned function puts it back. */
function givemeTakes(t: T, ok: number, then: { status: number; body: unknown }): () => void {
  const yes = { status: 200, body: { witness: "a1008182" } };
  let calls = 0;
  const base = t.collateral.fetch;
  t.collateral.fetch = async (u, i) => {
    t.collateral.answer = calls++ < ok ? yes : then;
    return base(u, i);
  };
  return () => {
    t.collateral.fetch = base;
    t.collateral.answer = yes;
  };
}

/** critic#3's heldBy17: two classic boxes a deposit made, 1.7's count of them not mixed yet kept (a restore's). */
async function heldBy17(t: T): Promise<KoiosUtxo[]> {
  const boxes = [];
  for (const tx of ["c1", "c2"]) {
    const box = await classicBox(t, tx, 10);
    t.koios.txSpends.set(box.tx_hash, [{ payment_addr: { bech32: "addr_test1", cred: "ab".repeat(28) } }]);
    boxes.push(box);
  }
  await t.store.set("lovejoin.preprod", {
    due: [],
    chains: [],
    notMixed: 2,
    origins: Object.fromEntries(boxes.map((b) => [b.tx_hash, { mixed: false, seen: t.clock.now - HOUR }])),
  });
  t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, ...boxes);
  return boxes;
}

/** A 1.7 Bootstrap holding two classic boxes its deposit made: no due time, no count, as a Bootstrap's never have. */
async function bootstrapBy17(t: T): Promise<KoiosUtxo[]> {
  const deposit = "b0".repeat(32);
  const boxes = await Promise.all([0, 1].map((i) => classicBox(t, "b0", 6, i)));
  t.koios.txSpends.set(deposit, [{ payment_addr: { bech32: "addr_test1", cred: "ab".repeat(28) } }]);
  await t.store.set("lovejoin.preprod", {
    due: [],
    chains: [],
    mixes: [{ id: deposit, deposit, at: t.clock.now - HOUR, account: 0, bootstrap: true, found: true, shares: [{ boxes: 2 }] }],
  });
  t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, ...boxes);
  return boxes;
}

/** Runs a minute apart, the wallet in use: the first minute Home counts one box with its due time, `most` at most. */
async function minutesUntilShown(t: T, lj: LovejoinService, most: number): Promise<number | undefined> {
  for (let min = 1; min <= most; min++) {
    await busyFor(t, 60_000);
    await lj.withdrawDue("preprod");
    const held = await lj.held("preprod");
    if (inLovejoinShown(held) && held.boxes === 1 && held.next !== null) return min;
  }
  return undefined;
}

/** The wallet's listings of the pools: credential_utxos naming the classic pool's mix box, as every pool read does. */
const listings = (t: T) =>
  t.koios.calls.filter((c) => c.path === "credential_utxos" && JSON.stringify(c.body ?? "").includes(CLASSIC_BOX)).length;

/** SPENT_KEEP_MS in minutes: when a Stop's one read of the pools comes, and a read re-armed comes again. */
const KEEP = SPENT_KEEP_MS / 60_000;

/**
 * Runs a minute apart for `most` minutes, the wallet in use, `first` called as each minute starts: the minutes at which
 * the pools were listed.
 */
async function minutesRead(t: T, lj: LovejoinService, most: number, first: (minute: number) => void = () => undefined): Promise<number[]> {
  const read: number[] = [];
  for (let minute = 1; minute <= most; minute++) {
    first(minute);
    const before = listings(t);
    await busyFor(t, 60_000);
    await lj.withdrawDue("preprod");
    if (listings(t) > before) read.push(minute);
  }
  return read;
}

/**
 * Two classic boxes with their due times, the first unlock's run over long since, and Settings' Bring every box back
 * asked: a plain run.
 */
async function plainRun(t: T, lj: LovejoinService): Promise<void> {
  const boxes = [await classicBox(t, "e1", 10), await classicBox(t, "e2", 10)];
  t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, ...boxes);
  await t.store.set("lovejoin.preprod", { due: [t.clock.now + 5 * HOUR, t.clock.now + 6 * HOUR], chains: [], retired: t.clock.now - HOUR });
  await lj.bringAllBack("preprod");
}

describe("the first unlock's retired run stopped partway: the boxes it hadn't taken are read at the next run (r2-critic#0)", SLOW, () => {
  it("Settings' Stop after one withdraw: the box left has its due time, and Home counts it, from the next run", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const boxes = await heldBy17(t);
    // giveme.my takes the first withdraw and refuses the second: the run sends one box, and the user stops it.
    const restore = givemeTakes(t, 1, { status: 400, body: { detail: "Transaction Fails Validation" } });
    expect(await lj.withdrawDue("preprod", true)).toHaveLength(1);
    await lj.stopBringingAllBack("preprod");
    const took = txInputs(Uint8Array.from(Buffer.from(t.collateral.asked[0]!, "hex")));
    landed(t, took);
    restore();
    // Before, the read came two hours on: no due time and no count till then, the box still in the classic pool.
    expect(await minutesUntilShown(t, lj, 130)).toBe(1);
    const left = boxes.find((b) => !took.includes(at(b)))!;
    expect(t.koios.addedToAccounts.some((u) => at(u) === at(left))).toBe(true);
    expect((await lj.held("preprod")).notMixed).toBe(0);
  });

  it("the run's own stop after one withdraw, giveme.my busy three runs: the same", async () => {
    const t = await wallet();
    const lj = pooled(t);
    await heldBy17(t);
    givemeTakes(t, 1, { status: 503, body: { detail: "busy" } });
    expect(await lj.withdrawDue("preprod", true)).toHaveLength(1);
    landed(t, txInputs(Uint8Array.from(Buffer.from(t.collateral.asked[0]!, "hex"))));
    for (let run = 0; run < 3; run++) {
      await busyFor(t, 60_000);
      await lj.withdrawDue("preprod");
    }
    expect((await lj.held("preprod")).bringing).toMatchObject({ back: 1, stopped: expect.any(String) });
    expect(await minutesUntilShown(t, lj, 130)).toBe(1);
  });

  it("Stop once late, a node having dropped the last withdraw and nothing else left: the pools are read again once it's free, and its box comes back", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const boxes = await heldBy17(t);
    expect(await lj.withdrawDue("preprod", true)).toHaveLength(2);
    // The first lands; a node drops the second, its box listed and held as spent for SPENT_KEEP_MS.
    landed(t, [at(boxes[0]!)]);
    await busyFor(t, BRING_LATE_MS);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await lj.held("preprod")).bringing).toMatchObject({ late: true });
    await lj.stopBringingAllBack("preprod");
    // The read owed at once comes at the next run, the box still held as spent: it can't take its due time yet.
    for (let i = 0; i < 5; i++) {
      await busyFor(t, 60_000);
      await lj.withdrawDue("preprod");
    }
    // Once it's free, the read comes again: the box gets its due time, and comes back by itself.
    await busyFor(t, SPENT_KEEP_MS);
    for (let i = 0; i < 12 && withdrawn(t).filter((b) => b === at(boxes[1]!)).length < 2; i++) {
      await lj.withdrawDue("preprod");
      await busyFor(t, HOUR);
    }
    expect(withdrawn(t).filter((b) => b === at(boxes[1]!))).toHaveLength(2);
  });

  it("a read a Stop on 1.7 owed an hour on comes at once too: the run stopped after one withdraw, the box left shows from the next run", async () => {
    const t = await wallet();
    const lj = pooled(t);
    await heldBy17(t);
    // 1.7's Bring every box back, stopped before the update: the pools are to be read an hour on (Schedule `recheck`).
    const kept = await t.store.get<Record<string, unknown>>("lovejoin.preprod");
    await t.store.set("lovejoin.preprod", { ...kept, recheck: t.clock.now + HOUR, bringStopped: { back: 1 } });
    const restore = givemeTakes(t, 1, { status: 400, body: { detail: "Transaction Fails Validation" } });
    expect(await lj.withdrawDue("preprod", true)).toHaveLength(1);
    await lj.stopBringingAllBack("preprod");
    landed(t, txInputs(Uint8Array.from(Buffer.from(t.collateral.asked[0]!, "hex"))));
    restore();
    expect(await minutesUntilShown(t, lj, 130)).toBe(1);
  });

  it("a 1.7 Bootstrap's boxes the first run let go, Stop after one withdraw: the box left has its due time from the next run", async () => {
    const t = await wallet();
    const lj = pooled(t);
    await bootstrapBy17(t);
    const restore = givemeTakes(t, 1, { status: 400, body: { detail: "Transaction Fails Validation" } });
    expect(await lj.withdrawDue("preprod", true)).toHaveLength(1);
    await lj.stopBringingAllBack("preprod");
    landed(t, txInputs(Uint8Array.from(Buffer.from(t.collateral.asked[0]!, "hex"))));
    restore();
    expect(await minutesUntilShown(t, lj, 130)).toBe(1);
  });

  it("a 1.7 Bootstrap's, the run stopped by itself having sent nothing (Koios down three runs): they come back by themselves", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const boxes = await bootstrapBy17(t);
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) =>
      new URL(String(url)).pathname.endsWith("/credential_utxos") ? new Response("down", { status: 500 }) : real(url, init);
    await lj.withdrawDue("preprod", true);
    for (let run = 1; run < 3; run++) {
      await busyFor(t, 60_000);
      await lj.withdrawDue("preprod");
    }
    t.koios.fetch = real;
    expect((await lj.held("preprod")).bringing).toMatchObject({ back: 0, stopped: expect.any(String) });
    // Half a day of runs, an unlock among them: before, none read the pools, as nothing was open but the Bootstrap.
    for (let run = 0; run < 24 && withdrawn(t).length < 2; run++) {
      landed(t, withdrawn(t));
      await busyFor(t, 30 * 60_000);
      await lj.withdrawDue("preprod", run === 8);
    }
    expect(withdrawn(t).sort()).toEqual(boxes.map(at).sort());
  });

  // When the pools are read after a Stop, minute by minute till an hour past SPENT_KEEP_MS. The privacy policy's
  // 6 November entry says nothing of reads after a Stop, which holds only while these stay where they are (1.8.0's
  // release review, last-code#1). The retired run's read comes at the next run, as retireOnce owes it, and once more
  // SPENT_KEEP_MS on while its withdraw is still listed.
  it("Settings' Stop of the retired run after one withdraw that lands: the pools are read at the next run, and not again", async () => {
    const t = await wallet();
    const lj = pooled(t);
    await heldBy17(t);
    const restore = givemeTakes(t, 1, { status: 400, body: { detail: "Transaction Fails Validation" } });
    expect(await lj.withdrawDue("preprod", true)).toHaveLength(1);
    await lj.stopBringingAllBack("preprod");
    landed(t, txInputs(Uint8Array.from(Buffer.from(t.collateral.asked[0]!, "hex"))));
    restore();
    expect(await minutesRead(t, lj, KEEP + 60)).toEqual([1]);
  });

  it("the same, Koios still listing that withdraw's box for half an hour: read at the next run, and once more SPENT_KEEP_MS on", async () => {
    const t = await wallet();
    const lj = pooled(t);
    await heldBy17(t);
    const restore = givemeTakes(t, 1, { status: 400, body: { detail: "Transaction Fails Validation" } });
    expect(await lj.withdrawDue("preprod", true)).toHaveLength(1);
    await lj.stopBringingAllBack("preprod");
    restore();
    const took = txInputs(Uint8Array.from(Buffer.from(t.collateral.asked[0]!, "hex")));
    const read = await minutesRead(t, lj, KEEP + 60, (minute) => {
      if (minute === 30) landed(t, took);
    });
    expect(read).toEqual([1, KEEP + 1]);
  });

  // Every other Stop reads them as before: once, SPENT_KEEP_MS after it. A Stop puts no read owed sooner later
  // (`Math.min`), and with none owed, `?? Infinity` keeps that one read where it was: at the next minute, it would tie
  // a listing of every pool to the press.
  it("a plain Stop of Bring every box back after one withdraw: the pools are read once, SPENT_KEEP_MS after it", async () => {
    const t = await wallet();
    const lj = pooled(t);
    await plainRun(t, lj);
    const restore = givemeTakes(t, 1, { status: 400, body: { detail: "Transaction Fails Validation" } });
    await busyFor(t, 60_000);
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    await lj.stopBringingAllBack("preprod");
    landed(t, txInputs(Uint8Array.from(Buffer.from(t.collateral.asked[0]!, "hex"))));
    restore();
    expect(await minutesRead(t, lj, KEEP + 60)).toEqual([KEEP]);
  });

  it("the run's own stop of Bring every box back after one withdraw, giveme.my busy three runs: the same", async () => {
    const t = await wallet();
    const lj = pooled(t);
    await plainRun(t, lj);
    givemeTakes(t, 1, { status: 503, body: { detail: "busy" } });
    await busyFor(t, 60_000);
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    landed(t, txInputs(Uint8Array.from(Buffer.from(t.collateral.asked[0]!, "hex"))));
    for (let run = 0; run < 3; run++) {
      await busyFor(t, 60_000);
      await lj.withdrawDue("preprod");
    }
    expect((await lj.held("preprod")).bringing).toMatchObject({ back: 1, stopped: expect.any(String) });
    expect(await minutesRead(t, lj, KEEP + 60)).toEqual([KEEP]);
  });
});

// ---------------------------------------------------------------------------
// r2-critic#1 and r2-critic#2: what the look's comments say
// ---------------------------------------------------------------------------

type Fixture = { seed: { txHash: string; txIndex: number }; reference: KoiosUtxo; scripts: KoiosUtxo[] };
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../wasm/tests/fixtures/${name}`, import.meta.url), "utf8")) as Fixture;
/** v2's 5 ₳ pool (a WebAssembly fixture, never on chain), and PR #163's token pool on v2's scripts (2 ₳ and LJTEST a box). */
const FIVE = fixture("lovejoin-v2-ada-pool-preprod.json");
const TOKEN = fixture("lovejoin-v2-token-pool-preprod.json");
const TOKEN_VIEW = JSON.parse(
  wasm.lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: { reference: TOKEN.reference, seed: TOKEN.seed, scripts: TOKEN.scripts } })),
) as { id: string; mixBoxHash: string; token: { policyId: string; assetName: string; quantity: string } };
const LJTEST = TOKEN_VIEW.token.policyId + TOKEN_VIEW.token.assetName;

/** The release's head start, less every pool on v2's scripts: a device that kept no v2 pool. */
const HEAD = Object.fromEntries(
  (["preprod", "mainnet"] as const).map((n) => {
    const kept = (bundled as unknown as Record<NetworkName, Kept>)[n];
    return [n, { ...kept, pools: kept.pools.filter((p) => p.version !== "v2") }];
  }),
) as Record<NetworkName, Kept>;

const holderAt = (network: NetworkName) =>
  network === "mainnet" ? bech32("addr", Uint8Array.from([0x71, ...Buffer.from(HOLDER, "hex")])) : FIVE.reference.address;
/** An hour before the test clock starts: settled. */
const SETTLED = Math.floor(START / 1000) - 3600;
/** A pool's launch rows at `network`'s holder, in block `height`. */
const rowsOf = (f: Fixture, network: NetworkName, height: number): KoiosUtxo[] =>
  [f.reference, ...f.scripts].map((r) => ({ ...r, address: holderAt(network), block_height: height, block_time: SETTLED }));

/** Its launch as tx_info gives it, L registered by it. */
function launchOf(f: Fixture, network: NetworkName, height: number): KoiosLaunch {
  const rows = rowsOf(f, network, height);
  const { mixLogicStake } = JSON.parse(
    wasm.lovejoinLaunchCheck(JSON.stringify({ network, reference: rows[0], inputs: [f.seed], scripts: rows.slice(1) })),
  ) as { mixLogicStake: string };
  return {
    tx_hash: f.reference.tx_hash,
    block_height: height,
    tx_block_index: 0,
    tx_timestamp: SETTLED,
    inputs: [{ tx_hash: f.seed.txHash, tx_index: f.seed.txIndex }],
    certificates: [{ type: "stake_registration", info: { stake_address: mixLogicStake } }],
  };
}

/** Koios's holder on `network`, nothing launched yet, each request counted by its path. */
function holderKoios(network: NetworkName) {
  const fake = { calls: [] as string[], holder: [] as KoiosUtxo[], launches: [] as KoiosLaunch[] };
  const koios = new Koios(
    network === "mainnet" ? "https://api.koios.rest/api/v1" : "https://preprod.koios.rest/api/v1",
    async (url: string, init: RequestInit) => {
      const u = new URL(url);
      const path = u.pathname.split("/").pop()!;
      fake.calls.push(path);
      const body = JSON.parse(String(init.body)) as Record<string, string[]>;
      if (path === "credential_utxos") {
        const after = /^gt\.(\d+)$/.exec(u.searchParams.get("block_height") ?? "");
        return Response.json(
          fake.holder.filter((r) => body._payment_credentials!.includes(r.payment_cred!) && (!after || (r.block_height ?? 0) > Number(after[1]))),
        );
      }
      if (path === "tx_info") return Response.json(fake.launches.filter((l) => body._tx_hashes!.includes(l.tx_hash)));
      return Response.json([]);
    },
    async () => undefined,
  );
  return { fake, koios };
}
type Holder = ReturnType<typeof holderKoios>;
const holderReads = (k: Holder) => k.fake.calls.filter((c) => c === "credential_utxos").length;

/** Launches `f` at `network`'s holder, in block `height`, settled. */
function launchAtHolder(k: Holder, f: Fixture, network: NetworkName, height: number) {
  k.fake.holder.push(...rowsOf(f, network, height));
  k.fake.launches.push(launchOf(f, network, height));
}

/** The data layer's lovejoin/pools on `network`, listing v2's 5 ₳ pool. */
function listing(network: NetworkName) {
  const slot = 100_000_000;
  const rows = rowsOf(FIVE, network, HEAD[network].height + 1);
  return {
    network,
    cursor: `${slot}.${"0".repeat(64)}`,
    classic: { crowd: { boxes: 0, deposits: 0, mixed: 0 } },
    pools: [
      {
        id: ADA,
        seed: `${FIVE.seed.txHash}#${FIVE.seed.txIndex}`,
        reference: indexRowOf(rows[0]!, slot),
        scripts: rows.slice(1).map((s) => ({ ...indexRowOf(s, slot), script: true, script_hash: s.reference_script!.hash })),
        launch: { tx: FIVE.reference.tx_hash, block: HEAD[network].height + 1, index: 0, slot, time: slot + 1_591_566_291 },
        crowd: { boxes: 40, deposits: 0, mixed: 40 },
      },
    ],
  };
}

/**
 * One worker's life, as sw.ts's getContext makes it once a worker life: discovery and the services, over the device's
 * storage (`local`, the sealed store), which a worker Chrome starts again keeps, and the instances don't. Mainnet's
 * data layer answers, listing v2's 5 ₳ pool; discovery's token list names LJTEST, the only v2 token pool's fixture.
 */
function worker(t: T, local: ReturnType<typeof memoryArea>, holders: Record<NetworkName, Holder>) {
  const idx = fakeIndex();
  idx.poolList = listing("mainnet");
  const index = privateIndexClient(
    { koiosOnly: async () => false, parts: new DataParts(memoryArea(), () => t.clock.now), fetch: idx.fetch, limits: {} },
    (n) => (n === "mainnet" ? "https://data.test" : undefined),
  );
  const discovery = new PoolDiscovery({
    local,
    wasm,
    koios: (n) => holders[n].koios,
    index,
    now: () => t.clock.now,
    headStart: (n) => HEAD[n],
    listed: () => new Set([LJTEST]),
  });
  const signed = (request: string) => {
    const { txCbor } = JSON.parse(request) as { txCbor: string };
    return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
  };
  const lovejoin = new LovejoinService({
    ...t.deps,
    wasm: { ...wasm, finishLovejoinWithdraw: signed } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    ...serviceDeps(discovery),
    lookForPools: (n) => discovery.look(n),
    facts: async (n) => ({ launches: await discovery.launches(n), crowds: discovery.crowdsOf(n) }),
    random: () => 0.5,
  });
  const sessions = new SessionService({
    ...t.deps,
    wasm: { ...wasm, signScriptSpend: (_key: unknown, request: string) => signed(request) } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
    lovejoin,
    sleep: async () => undefined,
    alarm: { start: async () => undefined },
  });
  const listAsked = () => idx.calls.filter((c) => c === "lovejoin/pools").length;
  return { lovejoin, sessions, listAsked };
}

async function device(strangers: KoiosUtxo[] = ADA_ROWS) {
  const t = testBalances({ owned: false });
  await t.wallet.create(account(12).phrase, PASSWORD);
  t.koios.evaluation = AGREES;
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  t.koios.addedToAccounts.push(...strangers);
  const holders = { preprod: holderKoios("preprod"), mainnet: holderKoios("mainnet") } as Record<NetworkName, Holder>;
  return { t, local: memoryArea(), holders };
}

/** 40 strangers' boxes in the token pool, so a return's LJTEST would go in, the pool once known. */
function tokenStrangers(t: T) {
  const address = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(TOKEN_VIEW.mixBoxHash, "hex")]));
  for (let i = 0; i < 40; i++) {
    const tx = (0x40 + i).toString(16).padStart(2, "0").repeat(32);
    t.koios.txSpends.set(tx, [{ payment_addr: { bech32: address, cred: TOKEN_VIEW.mixBoxHash } }]);
    t.koios.addedToAccounts.push({
      ...POOL[0]!,
      tx_hash: tx,
      tx_index: 0,
      address,
      payment_cred: TOKEN_VIEW.mixBoxHash,
      value: "2000000",
      datum_hash: null,
      inline_datum: { bytes: strangerDatum(), value: {} },
      asset_list: [{ policy_id: TOKEN_VIEW.token.policyId, asset_name: TOKEN_VIEW.token.assetName, quantity: TOKEN_VIEW.token.quantity, decimals: 0, fingerprint: "asset1test" } as never],
    } as KoiosUtxo);
  }
}

/** A site's private session 0 on preprod: 40 ₳, its 5 ₳ collateral, and two boxes' worth of LJTEST its funding left. */
async function siteSessionWithToken(t: T) {
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
  const two = (2n * BigInt(TOKEN_VIEW.token.quantity)).toString();
  t.koios.addedToAccounts.push(atSession("c1".repeat(32), 0, "40000000"), atSession("c2".repeat(32), 1, "5000000"), {
    ...atSession("ab".repeat(32), 0, "3000000"),
    asset_list: [{ policy_id: TOKEN_VIEW.token.policyId, asset_name: TOKEN_VIEW.token.assetName, quantity: two, decimals: 0, fingerprint: "asset1test" } as never],
  } as KoiosUtxo);
}

const tokenWays = (b: { lovejoin?: { ways?: Array<{ pool?: string; boxes: number }> } }) =>
  (b.lovejoin?.ways ?? []).filter((w) => w.pool === TOKEN_VIEW.id && w.boxes > 0).map((w) => w.boxes);

describe("with the 5 ₳ pool kept, an ask asks nobody: a token pool launched later is found by the page or Settings' press (r2-critic#1)", SLOW, () => {
  it("preprod: past the throttle, a return holding the token reads no holder and brings it back directly; Settings' press looks, whatever is kept, and finds it", async () => {
    const { t, local, holders } = await device();
    const k = holders.preprod;
    const w = worker(t, local, holders);
    launchAtHolder(k, FIVE, "preprod", HEAD.preprod.height + 1);
    // Kept by the page's look, as on a device that opened Lovejoin's page once.
    await w.lovejoin.lookForPools("preprod");
    expect((await w.lovejoin.adaPool("preprod"))?.id).toBe(ADA);
    launchAtHolder(k, TOKEN, "preprod", HEAD.preprod.height + 5);
    tokenStrangers(t);
    await siteSessionWithToken(t);
    // Past lookSoon's throttle: a look an ask made now would read the holder, so none here is adaPool's `kept`.
    t.clock.now += REFRESH_MS + 1;
    const before = holderReads(k);
    const back = await w.sessions.backBuild("preprod", 0);
    expect(holderReads(k)).toBe(before);
    expect(back.lovejoin?.pool).toBe(ADA);
    expect(tokenWays(back)).toEqual([]);
    // Settings' Bring every box back, no pool named: the look, the 5 ₳ pool kept or not, and the token pool is known.
    await w.lovejoin.bringAllBack("preprod");
    expect(holderReads(k)).toBe(before + 1);
    expect((await w.lovejoin.poolsOf("preprod", LJTEST, true)).map((p) => p.id)).toEqual([TOKEN_VIEW.id]);
  });

  it("mainnet, the data layer up: once an ask found the pool, the next, past the list's five minutes, asks nobody, its list neither", async () => {
    const { t, local, holders } = await device(adaStrangers(32));
    const w = worker(t, local, holders);
    expect((await w.lovejoin.adaPool("mainnet", true))?.id).toBe(ADA);
    expect(w.listAsked()).toBe(1);
    // Where the list can't answer, an ask past adaPool's `kept` reads the pools it hands over, the kept one among them,
    // and returns before any look: only the list asked again tells it went past.
    t.clock.now += REFRESH_MS + 1;
    expect((await w.lovejoin.adaPool("mainnet", true))?.id).toBe(ADA);
    expect(w.listAsked()).toBe(1);
    expect(holderReads(holders.mainnet)).toBe(0);
  });
});

describe("the look's five minutes are a worker's: its throttle is in memory (r2-critic#2)", SLOW, () => {
  it("an ask within REFRESH_MS of a look reads nothing in the same worker, and a worker Chrome started again looks at its first", async () => {
    const { t, local, holders } = await device();
    const k = holders.preprod;
    const first = worker(t, local, holders);
    expect(await first.lovejoin.adaPool("preprod", true)).toBeUndefined();
    expect(holderReads(k)).toBe(1);
    t.clock.now += 60_000;
    expect(await first.lovejoin.adaPool("preprod", true)).toBeUndefined();
    expect(holderReads(k)).toBe(1);
    // The side panel closed, Chrome stopped the idle worker, and a new one started for the next ask, over the same storage.
    const next = worker(t, local, holders);
    t.clock.now += 60_000;
    expect(await next.lovejoin.adaPool("preprod", true)).toBeUndefined();
    expect(holderReads(k)).toBe(2);
    expect(t.clock.now - START).toBeLessThan(REFRESH_MS);
  });
});
