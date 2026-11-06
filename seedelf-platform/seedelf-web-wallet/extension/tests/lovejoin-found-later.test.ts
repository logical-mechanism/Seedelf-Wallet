// Lovejoin's 5 ₳ pool, found later (1.8.0's release review: O1, O2 and O4, critic#0 and critic#1). The owner's call of
// 2026-11-06: "We need it to work since that if no 5 ada pool exists, or really any pool, then no mix happens. Then when
// it exists it uses it." The pool is launched from the wallet, before or after the release, so a device may know of
// none: its head start, bundled at the release, never held it. Where a return, a swap's review or a funding's
// collateral asks for the pool and none is kept, discovery looks: the data layer's list where it answers (mainnet), and
// Koios's holder, as Lovejoin's page reads it, where it doesn't (preprod, Koios-only, the data layer down), at most every
// REFRESH_MS a network (lovejoin-pools.ts lookSoon). Until a pool is found, a return comes back directly, and the reason
// it keeps says what the wallet knew when it read, which stays true once a pool exists.
//
// Discovery is wired as sw.ts wires it (serviceDeps, lookForPools: discovery.look), its data layer behind
// privateIndexClient's own gate, from a head start that holds no pool on v2's scripts: the release's bundles preprod's,
// which a return then finds quietly, so a test reading the bundle would change meaning at each refresh (o-design §5,
// E9). Koios's holder is a counting fake, each network's its own; the pool's boxes come from the chain's fake.
import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import { DataParts } from "../src/background/data-layer";
import { Koios, type KoiosLaunch, type KoiosUtxo } from "../src/background/koios";
import { LovejoinService } from "../src/background/lovejoin";
import { HOLDER, PoolDiscovery, REFRESH_MS, SETTLE_MS, serviceDeps, type Kept } from "../src/background/lovejoin-pools";
import { Minswap } from "../src/background/minswap";
import { privateIndexClient } from "../src/background/private-index";
import { SessionService } from "../src/background/sessions";
import { i18n, t as tr } from "../src/i18n/core";
import bundled from "../src/lovejoin-pools.json";
import { NETWORKS, type NetworkName } from "../src/networks";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { SessionOutSummary, SwapQuote } from "../src/shared/rpc";
import { LovejoinNote, LovejoinSkipped } from "../src/ui/components/LovejoinReturn";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { StopDialog, SwapApproval } from "../src/ui/screens/Swaps";
import { withoutStop } from "../src/ui/sentence";
import { account, AGREES, atSession, PASSWORD, POOL } from "./chain-fixtures";
import { fakeIndex, indexRowOf } from "./fake-index";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { epochParams, loadTestWasm, memoryArea, minswapEstimate, ownedUtxos, testBalances } from "./fakes";
import { ADA, ADA_ROWS, ADA_VIEW, adaBox, adaStrangers, madeByAdaMix, ownDatum, retiredAlready } from "./v2-pools";

const SLOW = { timeout: 300_000 };
const wasm = loadTestWasm();
const HOUR = 3_600_000;
/** The test clock's start (fakes.ts testWallet). */
const START = 1_800_000_000_000;
type T = ReturnType<typeof testBalances>;

const floors = { preprod: NETWORKS.preprod.lovejoin!.poolFloor, mainnet: NETWORKS.mainnet.lovejoin!.poolFloor };
afterEach(async () => {
  NETWORKS.preprod.lovejoin!.poolFloor = floors.preprod;
  NETWORKS.mainnet.lovejoin!.poolFloor = floors.mainnet;
  await i18n.changeLanguage("en");
});

/** Lovejoin v2's 5 ₳ pool's launch (a WebAssembly fixture, never on chain): ADA's pool here, launched after the head start. */
const FOUND = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/lovejoin-v2-ada-pool-preprod.json", import.meta.url), "utf8")) as {
  seed: { txHash: string; txIndex: number };
  reference: KoiosUtxo;
  scripts: KoiosUtxo[];
};

/** The release's head start, less every pool on v2's scripts: the retired pools a device keeps, and the height read to. */
const HEAD = Object.fromEntries(
  (["preprod", "mainnet"] as const).map((n) => {
    const kept = (bundled as unknown as Record<NetworkName, Kept>)[n];
    return [n, { ...kept, pools: kept.pools.filter((p) => p.version !== "v2") }];
  }),
) as Record<NetworkName, Kept>;

/** The holder's address on `network`: on mainnet the fixture's rows are re-addressed, as the e2e's fiveAt does. */
const holderAt = (network: NetworkName) =>
  network === "mainnet" ? bech32("addr", Uint8Array.from([0x71, ...Buffer.from(HOLDER, "hex")])) : FOUND.reference.address;

/** The launch's outputs at the holder, in the block after `network`'s head start, made at `blockTime` (s). */
const launchRows = (network: NetworkName, blockTime: number): KoiosUtxo[] =>
  [FOUND.reference, ...FOUND.scripts].map((r) => ({ ...r, address: holderAt(network), block_height: HEAD[network].height + 1, block_time: blockTime }));

/** L's reward account on `network`, which a standard launch registers. */
const stakeOf = (network: NetworkName) =>
  (
    JSON.parse(
      wasm.lovejoinLaunchCheck(
        JSON.stringify({ network, reference: launchRows(network, 1)[0], inputs: [FOUND.seed], scripts: launchRows(network, 1).slice(1) }),
      ),
    ) as { mixLogicStake: string }
  ).mixLogicStake;

/** The launch as tx_info gives it: its seed among the inputs, L registered. */
const launchOf = (network: NetworkName, blockTime: number): KoiosLaunch => ({
  tx_hash: FOUND.reference.tx_hash,
  block_height: HEAD[network].height + 1,
  tx_block_index: 0,
  tx_timestamp: blockTime,
  inputs: [{ tx_hash: FOUND.seed.txHash, tx_index: FOUND.seed.txIndex }],
  certificates: [{ type: "stake_registration", info: { stake_address: stakeOf(network) } }],
});

/** An hour before the test clock starts: settled. */
const SETTLED = Math.floor(START / 1000) - 3600;

/**
 * Koios as discovery reads it on `network`, each request counted by its path: the holder's outputs above `gt.`, the
 * launch's tx_info. `holder`: what's at the holder (the launch, or nothing). `fail`: every request is answered so.
 */
function holderKoios(network: NetworkName, blockTime = SETTLED) {
  const fake = { calls: [] as string[], holder: launchRows(network, blockTime), launch: launchOf(network, blockTime), fail: undefined as Response | undefined };
  const koios = new Koios(
    network === "mainnet" ? "https://api.koios.rest/api/v1" : "https://preprod.koios.rest/api/v1",
    async (url: string, init: RequestInit) => {
      const u = new URL(url);
      const path = u.pathname.split("/").pop()!;
      fake.calls.push(path);
      if (fake.fail) return fake.fail.clone();
      const body = JSON.parse(String(init.body)) as Record<string, string[]>;
      if (path === "credential_utxos") {
        const after = /^gt\.(\d+)$/.exec(u.searchParams.get("block_height") ?? "");
        return Response.json(
          fake.holder.filter((r) => body._payment_credentials!.includes(r.payment_cred!) && (!after || (r.block_height ?? 0) > Number(after[1]))),
        );
      }
      if (path === "tx_info") return Response.json(fake.holder.length ? [fake.launch].filter((l) => body._tx_hashes!.includes(l.tx_hash)) : []);
      return Response.json([]);
    },
    async () => undefined,
  );
  return { fake, koios };
}
type Holder = ReturnType<typeof holderKoios>;

/** What `k` was asked, by path: Koios's requests of discovery's, as the public tier counts them. */
const asked = (k: Holder) => ({
  credential_utxos: k.fake.calls.filter((c) => c === "credential_utxos").length,
  tx_info: k.fake.calls.filter((c) => c === "tx_info").length,
  other: k.fake.calls.filter((c) => c !== "credential_utxos" && c !== "tx_info").length,
});

/** The data layer's lovejoin/pools on `network`, listing the pool. */
function listing(network: NetworkName) {
  const slot = 100_000_000;
  return {
    network,
    cursor: `${slot}.${"0".repeat(64)}`,
    classic: { crowd: { boxes: 0, deposits: 0, mixed: 0 } },
    pools: [
      {
        id: ADA,
        seed: `${FOUND.seed.txHash}#${FOUND.seed.txIndex}`,
        reference: indexRowOf(launchRows(network, SETTLED)[0]!, slot),
        scripts: launchRows(network, SETTLED)
          .slice(1)
          .map((s) => ({ ...indexRowOf(s, slot), script: true, script_hash: s.reference_script!.hash })),
        launch: { tx: FOUND.reference.tx_hash, block: HEAD[network].height + 1, index: 0, slot, time: slot + 1_591_566_291 },
        crowd: { boxes: 20, deposits: 0, mixed: 20 },
      },
    ],
  };
}

/** How mainnet's data layer is read, as Settings and the data layer's parts have it. Preprod has no data layer. */
type Mode = "koios only" | "data layer down" | "data layer up" | "not listed";

interface DeviceOptions {
  mode?: Mode;
  /** The pool is at each network's holder. */
  launched?: boolean;
  /** When the launch's block was made (s). */
  blockTime?: number;
  /** The pool's boxes that aren't the wallet's. */
  strangers?: KoiosUtxo[];
  /** The wallet's private balance, for a swap's funding. */
  privateLovelace?: bigint;
  /** WebAssembly as discovery calls it (a trap's test). */
  discoveryWasm?: ConstructorParameters<typeof PoolDiscovery>[0]["wasm"];
}

/** A device as sw.ts wires it, with nothing kept of v2's 5 ₳ pool: each network's Koios holder, and mainnet's data layer. */
async function device(o: DeviceOptions = {}) {
  const t = testBalances({ owned: false });
  await t.wallet.create(account(12).phrase, PASSWORD);
  t.koios.evaluation = AGREES;
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  if (o.privateLovelace !== undefined) {
    t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "d1".repeat(32), tx_index: 0, value: o.privateLovelace.toString() } as KoiosUtxo);
  }
  t.koios.addedToAccounts.push(...(o.strangers ?? ADA_ROWS));
  const holders = { preprod: holderKoios("preprod", o.blockTime), mainnet: holderKoios("mainnet", o.blockTime) } as Record<NetworkName, Holder>;
  if (o.launched === false) for (const k of Object.values(holders)) k.fake.holder = [];
  const idx = fakeIndex();
  if (o.mode === "data layer up" || o.mode === undefined) idx.poolList = listing("mainnet");
  const parts = new DataParts(memoryArea(), () => t.clock.now);
  if (o.mode === "data layer down") await parts.down("private", HOUR);
  // The data layer's origin as dataOrigin has it: mainnet's alone.
  const index = privateIndexClient(
    { koiosOnly: async () => o.mode === "koios only", parts, fetch: idx.fetch, limits: {} },
    (n) => (n === "mainnet" ? "https://data.test" : undefined),
  );
  const discovery = new PoolDiscovery({
    local: memoryArea(),
    wasm: o.discoveryWasm ?? wasm,
    koios: (n) => holders[n].koios,
    index,
    now: () => t.clock.now,
    headStart: (n) => HEAD[n],
  });
  const lovejoin = new LovejoinService({
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
    ...serviceDeps(discovery),
    lookForPools: (n) => discovery.look(n),
    facts: async (n) => ({ launches: await discovery.launches(n), crowds: discovery.crowdsOf(n) }),
    random: () => 0.5,
  });
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
    lovejoin,
    sleep: async () => undefined,
    alarm: { start: async () => undefined },
  });
  const listAsked = () => idx.calls.filter((c) => c === "lovejoin/pools").length;
  return { t, holders, idx, parts, discovery, lovejoin, sessions, listAsked };
}
type Device = Awaited<ReturnType<typeof device>>;

/** A site's private session 0 holding `lovelace` and, unless `collateral` is false, its 5 ₳ collateral. */
async function siteSession(t: T, lovelace = "40000000", collateral = true, site = true) {
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: t.clock.now,
        txs: [{ kind: "out", txHash: "ab".repeat(32), at: t.clock.now, confirmed: true }],
        ...(site ? { site: { origin: "https://example.org" } } : {}),
      },
    ],
  });
  t.koios.addedToAccounts.push(atSession("c1".repeat(32), 0, lovelace), ...(collateral ? [atSession("c2".repeat(32), 1, "5000000")] : []));
}

const plain = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&").replace(/\s+/g, " ").trim();
/** What a person reads of `element`, balances shown. */
const read = (element: ReactElement) =>
  plain(
    renderToStaticMarkup(
      createElement(
        NetworkContext.Provider,
        { value: "preprod" },
        createElement(
          PreferencesContext.Provider,
          { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances: false }, loaded: true, set: async () => undefined } },
          element,
        ),
      ),
    ),
  );

const MIN_UNIT = minswapEstimate.ask.tokenOut;
const MIN500 = [{ policy_id: MIN_UNIT.slice(0, 56), asset_name: MIN_UNIT.slice(56), quantity: "500", decimals: 0, fingerprint: "asset1min" }];
/** 500 MIN sold for ADA. */
const SELL = { ...minswapEstimate.ask, tokenIn: MIN_UNIT, tokenOut: "lovelace", amount: "500" };

/** A swap's approval as the user sees it, from the summary the worker built. */
const approval = (summary: SessionOutSummary & { lovejoin?: SwapQuote["lovejoin"] }, quote: SwapQuote) =>
  read(
    createElement(SwapApproval, {
      summary,
      quote,
      lovejoin: summary.lovejoin,
      pay: quote.ask.tokenIn === "lovelace" ? { id: "lovelace", side: { label: "₳", decimals: 6 } } : { id: MIN_UNIT, side: { label: "MIN", decimals: 6 } },
      get: quote.ask.tokenOut === "lovelace" ? { id: "lovelace", side: { label: "₳", decimals: 6 } } : { id: MIN_UNIT, side: { label: "MIN", decimals: 6 } },
      through: true,
      onThrough: () => undefined,
      busy: false,
    } as never),
  );

/** 500 MIN sold for `out` lovelace, from a private balance that holds them: its quote's fakes. */
function selling(d: Device, out: bigint) {
  d.t.minswap.estimate = { ...minswapEstimate.estimate, amount_out: out.toString(), min_amount_out: ((out * 99n) / 100n).toString() };
  d.t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "d2".repeat(32), tx_index: 0, value: "2000000", asset_list: MIN500 as never } as KoiosUtxo);
}

// ---------------------------------------------------------------------------
// O1: the look at an ask, network and mode by network and mode (o-design §5, 1–4)
// ---------------------------------------------------------------------------

describe("a 5 ₳ pool launched after the head start, found where a return asks for it (O1)", SLOW, () => {
  it("preprod: a return's build looks at Koios's holder once, and mixes there, its collateral too; the next asks nobody", async () => {
    const d = await device();
    await siteSession(d.t);
    const review = await d.sessions.backBuild("preprod", 0);
    expect(review.lovejoinSkipped).toBeUndefined();
    expect(review.lovejoin).toMatchObject({ pool: ADA });
    expect(review.collateralTail).toMatchObject({ pool: ADA });
    // One holder read and the launch's tx_info, for the collateral's pick and the chain together; preprod has no list.
    expect(asked(d.holders.preprod)).toEqual({ credential_utxos: 1, tx_info: 1, other: 0 });
    expect(d.idx.calls).toEqual([]);
    expect((await d.sessions.backBuild("preprod", 0)).lovejoin).toMatchObject({ pool: ADA });
    expect(asked(d.holders.preprod)).toEqual({ credential_utxos: 1, tx_info: 1, other: 0 });
    // The other network's holder is its own.
    expect(asked(d.holders.mainnet)).toEqual({ credential_utxos: 0, tx_info: 0, other: 0 });
  });

  it("mainnet, Koios only: the ask and the collateral's pick find it at the holder, and the data layer is never asked", async () => {
    const d = await device({ mode: "koios only", strangers: adaStrangers(32) });
    expect((await d.lovejoin.adaPool("mainnet", true))?.id).toBe(ADA);
    expect(asked(d.holders.mainnet)).toEqual({ credential_utxos: 1, tx_info: 1, other: 0 });
    expect((await d.lovejoin.collateralPool("mainnet", epochParams[0]))?.pool.id).toBe(ADA);
    expect(asked(d.holders.mainnet)).toEqual({ credential_utxos: 1, tx_info: 1, other: 0 });
    expect(d.idx.calls).toEqual([]);
  });

  it("mainnet, the data layer marked down: found at the holder; but not while its last answer is under REFRESH_MS old", async () => {
    // Its list answered a minute ago, without the pool: a look then reads that answer, and Koios isn't asked.
    const d = await device({ mode: "not listed", strangers: adaStrangers(32) });
    expect(await d.lovejoin.adaPool("mainnet", true)).toBeUndefined();
    expect(d.listAsked()).toBe(1);
    d.t.clock.now += 60_000;
    await d.parts.down("private", HOUR);
    expect(await d.lovejoin.adaPool("mainnet", true)).toBeUndefined();
    expect(asked(d.holders.mainnet)).toEqual({ credential_utxos: 0, tx_info: 0, other: 0 });
    // REFRESH_MS on from that answer, the list can't answer: Koios's holder is read, once, and the pool found.
    d.t.clock.now += REFRESH_MS;
    expect((await d.lovejoin.adaPool("mainnet", true))?.id).toBe(ADA);
    expect((await d.lovejoin.collateralPool("mainnet", epochParams[0]))?.pool.id).toBe(ADA);
    expect(asked(d.holders.mainnet)).toEqual({ credential_utxos: 1, tx_info: 1, other: 0 });
    expect(d.listAsked()).toBe(1);
  });

  it("mainnet, the data layer down from the start: the same, from Koios", async () => {
    const d = await device({ mode: "data layer down", strangers: adaStrangers(32) });
    expect((await d.lovejoin.collateralPool("mainnet", epochParams[0]))?.pool.id).toBe(ADA);
    expect(asked(d.holders.mainnet)).toEqual({ credential_utxos: 1, tx_info: 1, other: 0 });
    expect(d.idx.calls).toEqual([]);
  });

  it("mainnet, the data layer up: listed, found on its list; not listed, none; Koios is never asked either way", async () => {
    const listed = await device({ mode: "data layer up", strangers: adaStrangers(32) });
    expect((await listed.lovejoin.adaPool("mainnet", true))?.id).toBe(ADA);
    expect((await listed.lovejoin.collateralPool("mainnet", epochParams[0]))?.pool.id).toBe(ADA);
    expect(listed.listAsked()).toBe(1);
    expect(asked(listed.holders.mainnet)).toEqual({ credential_utxos: 0, tx_info: 0, other: 0 });
    const not = await device({ mode: "not listed" });
    expect(await not.lovejoin.adaPool("mainnet", true)).toBeUndefined();
    expect(await not.lovejoin.adaPool("mainnet", true)).toBeUndefined();
    expect(not.listAsked()).toBe(1);
    expect(asked(not.holders.mainnet)).toEqual({ credential_utxos: 0, tx_info: 0, other: 0 });
  });

  it("asks nobody where it isn't asked: a quiet read finds what's kept, and the pool stays unknown until an ask looks", async () => {
    const d = await device();
    expect(await d.lovejoin.adaPool("preprod")).toBeUndefined();
    expect(await d.lovejoin.adaPool("mainnet")).toBeUndefined();
    expect(asked(d.holders.preprod)).toEqual({ credential_utxos: 0, tx_info: 0, other: 0 });
    expect(asked(d.holders.mainnet)).toEqual({ credential_utxos: 0, tx_info: 0, other: 0 });
    expect(d.idx.calls).toEqual([]);
    expect((await d.lovejoin.adaPool("preprod", true))?.id).toBe(ADA);
    expect((await d.lovejoin.adaPool("preprod"))?.id).toBe(ADA);
  });
});

// ---------------------------------------------------------------------------
// O1: no pool, a look that fails, SETTLE_MS, a pool found short (o-design §5, 5–8)
// ---------------------------------------------------------------------------

describe("a return while no 5 ₳ pool can be found (O1)", SLOW, () => {
  it("with none anywhere: looks once a REFRESH_MS a network, and comes back directly saying what the wallet knew", async () => {
    const d = await device({ launched: false, mode: "koios only" });
    await siteSession(d.t);
    const first = await d.sessions.backBuild("preprod", 0);
    expect(first.lovejoin).toBeUndefined();
    expect(first.lovejoinSkipped).toBe(tr("sess.skip.warn.noAdaPool"));
    // The collateral's pick and the chain both asked: one holder read between them, and no launch to ask of.
    expect(asked(d.holders.preprod)).toEqual({ credential_utxos: 1, tx_info: 0, other: 0 });
    await d.sessions.backBuild("preprod", 0);
    expect(asked(d.holders.preprod).credential_utxos).toBe(1);
    // Mainnet's throttle is its own: its first ask looks there.
    expect(await d.lovejoin.adaPool("mainnet", true)).toBeUndefined();
    expect(asked(d.holders.mainnet).credential_utxos).toBe(1);
    d.t.clock.now += REFRESH_MS;
    await d.sessions.backBuild("preprod", 0);
    expect(asked(d.holders.preprod).credential_utxos).toBe(2);
    expect(asked(d.holders.mainnet).credential_utxos).toBe(1);
  });

  it("a look that fails: comes back directly, nothing thrown, nothing asked again within REFRESH_MS; the next look finds it", async () => {
    const d = await device();
    await siteSession(d.t);
    d.holders.preprod.fake.fail = new Response("down", { status: 500 });
    const review = await d.sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toBeUndefined();
    expect(review.lovejoinSkipped).toBe(tr("sess.skip.warn.noAdaPool"));
    const failing = d.holders.preprod.fake.calls.length;
    expect(failing).toBeGreaterThan(0);
    d.holders.preprod.fake.fail = undefined;
    await d.sessions.backBuild("preprod", 0);
    expect(d.holders.preprod.fake.calls.length).toBe(failing);
    d.t.clock.now += REFRESH_MS;
    expect((await d.sessions.backBuild("preprod", 0)).lovejoin).toMatchObject({ pool: ADA });
  });

  it("a trap in the look is handed on, never read as no pool", async () => {
    const trap = () => {
      throw new WebAssembly.RuntimeError("unreachable");
    };
    const d = await device({
      discoveryWasm: {
        lovejoinCandidate: trap,
        lovejoinLaunchCheck: (r: string) => wasm.lovejoinLaunchCheck(r),
        lovejoinVerifyPool: (r: string) => wasm.lovejoinVerifyPool(r),
      },
    });
    await siteSession(d.t);
    await expect(d.sessions.backBuild("preprod", 0)).rejects.toBeInstanceOf(WebAssembly.RuntimeError);
    // An ask of its own, once the throttle lets it look again.
    d.t.clock.now += REFRESH_MS;
    await expect(d.lovejoin.adaPool("preprod", true)).rejects.toBeInstanceOf(WebAssembly.RuntimeError);
  });

  it("SETTLE_MS: a launch three minutes old isn't taken, nor REFRESH_MS on; the first look after it settles takes it", async () => {
    const d = await device({ blockTime: Math.floor((START - 3 * 60_000) / 1000) });
    await siteSession(d.t);
    expect((await d.sessions.backBuild("preprod", 0)).lovejoinSkipped).toBe(tr("sess.skip.warn.noAdaPool"));
    d.t.clock.now += REFRESH_MS;
    expect((await d.sessions.backBuild("preprod", 0)).lovejoinSkipped).toBe(tr("sess.skip.warn.noAdaPool"));
    d.t.clock.now += REFRESH_MS;
    expect((await d.sessions.backBuild("preprod", 0)).lovejoin).toMatchObject({ pool: ADA });
    // Thirteen minutes after its block: three holder reads, one tx_info.
    expect(asked(d.holders.preprod)).toEqual({ credential_utxos: 3, tx_info: 1, other: 0 });
    expect(SETTLE_MS).toBeLessThan(2 * REFRESH_MS + 3 * 60_000);
  });

  it("found but under its floor: the floor's words, and the collateral comes back with the rest", async () => {
    NETWORKS.preprod.lovejoin!.poolFloor = 30;
    const d = await device();
    await siteSession(d.t);
    const review = await d.sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toBeUndefined();
    expect(review.lovejoinSkipped).toBe(tr("lj.skip.warn.floorShort", { count: 20, floor: 30 }));
    expect(review.collateralTail).toBeUndefined();
    expect(asked(d.holders.preprod)).toEqual({ credential_utxos: 1, tx_info: 1, other: 0 });
  });

  it("found but empty (preprod's floor of none): says it needs more boxes, never that there's no pool", async () => {
    const d = await device({ strangers: [] });
    await siteSession(d.t);
    const review = await d.sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toBeUndefined();
    expect(review.lovejoinSkipped).toBe(tr("lj.skip.warn.needsMore", { others: 0, needed: 8 }));
  });
});

// ---------------------------------------------------------------------------
// O1's hardening: the throttle is discovery's, the page's look counted; a refresh under way is shared (§5, 11)
// ---------------------------------------------------------------------------

describe("the look an ask makes, beside the page's (O1's hardening)", SLOW, () => {
  it("the page's look and a return's build at once: one holder read", async () => {
    const d = await device();
    await siteSession(d.t);
    const [looked, review] = await Promise.all([d.lovejoin.lookForPools("preprod"), d.sessions.backBuild("preprod", 0)]);
    expect(looked).toEqual({ grew: true });
    expect(review.lovejoin).toMatchObject({ pool: ADA });
    expect(asked(d.holders.preprod)).toEqual({ credential_utxos: 1, tx_info: 1, other: 0 });
  });

  it("an ask within REFRESH_MS of the page's look reads nothing more, whatever that look found; after, it looks", async () => {
    const d = await device({ launched: false });
    expect(await d.lovejoin.lookForPools("preprod")).toEqual({ grew: false });
    expect(asked(d.holders.preprod).credential_utxos).toBe(1);
    // The pool is launched; the ask a minute on still counts the page's look.
    d.holders.preprod.fake.holder = launchRows("preprod", SETTLED);
    d.t.clock.now += 60_000;
    expect(await d.lovejoin.adaPool("preprod", true)).toBeUndefined();
    expect(asked(d.holders.preprod).credential_utxos).toBe(1);
    d.t.clock.now += REFRESH_MS;
    expect((await d.lovejoin.adaPool("preprod", true))?.id).toBe(ADA);
    expect(asked(d.holders.preprod)).toEqual({ credential_utxos: 2, tx_info: 1, other: 0 });
  });

  it("asks at once, the holder answering, join its one look: each finds the pool, none returns before it", async () => {
    const d = await device();
    const [a, b] = await Promise.all([d.lovejoin.adaPool("preprod", true), d.lovejoin.adaPool("preprod", true)]);
    expect([a?.id, b?.id]).toEqual([ADA, ADA]);
    expect(asked(d.holders.preprod)).toEqual({ credential_utxos: 1, tx_info: 1, other: 0 });
  });

  it("asks at once join one look; a look that failed is the last for REFRESH_MS, counted from its start", async () => {
    const d = await device();
    d.holders.preprod.fake.fail = new Response("down", { status: 500 });
    expect(await Promise.all([d.lovejoin.adaPool("preprod", true), d.lovejoin.adaPool("preprod", true)])).toEqual([undefined, undefined]);
    const failing = d.holders.preprod.fake.calls.length;
    d.holders.preprod.fake.fail = undefined;
    d.t.clock.now += REFRESH_MS - 1;
    expect(await d.lovejoin.adaPool("preprod", true)).toBeUndefined();
    expect(d.holders.preprod.fake.calls.length).toBe(failing);
    d.t.clock.now += 1;
    expect((await d.lovejoin.adaPool("preprod", true))?.id).toBe(ADA);
  });

  it("two looks at once with the data layer up wait for its one list, and read no Koios", async () => {
    const d = await device({ mode: "not listed" });
    await Promise.all([d.discovery.look("mainnet"), d.discovery.look("mainnet")]);
    expect(d.listAsked()).toBe(1);
    expect(asked(d.holders.mainnet)).toEqual({ credential_utxos: 0, tx_info: 0, other: 0 });
  });

  it("is discovery's own, handed to the service as sw.ts hands it (serviceDeps)", () => {
    const discovery = new PoolDiscovery({ local: memoryArea(), wasm, koios: () => holderKoios("preprod").koios, now: () => START, headStart: (n) => HEAD[n] });
    const deps = serviceDeps(discovery);
    expect(typeof deps.lookSoon).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// O2: the reads that decided quietly
// ---------------------------------------------------------------------------

describe("a swap's review and Stop's dialog, with no 5 ₳ pool kept (O2)", SLOW, () => {
  it("prices its way back through the pool the same review reserves the collateral's mix in, asking nobody as the user types", async () => {
    const d = await device({ privateLovelace: 1_000_000_000n });
    await d.t.deps.preferences.set({ lovejoinDepth: 1 });
    const quote = await d.sessions.quote("preprod", minswapEstimate.ask);
    expect(quote.lovejoin?.skipped).toBe(tr("sess.skip.warn.noAdaPool"));
    expect(asked(d.holders.preprod)).toEqual({ credential_utxos: 0, tx_info: 0, other: 0 });
    const out = await d.sessions.outBuild("preprod", quote);
    expect(out.lovejoin?.skipped).toBeUndefined();
    expect(out.lovejoin?.ifStopped?.boxes ?? 0).toBeGreaterThan(0);
    expect(out.collateralReserve).toBe("1500000");
    expect(asked(d.holders.preprod)).toEqual({ credential_utxos: 1, tx_info: 1, other: 0 });
  });

  it("Stop's dialog finds the pool, and prices what Stop brings back through it", async () => {
    const d = await device();
    await d.t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: d.t.clock.now,
          txs: [{ kind: "out", txHash: "ab".repeat(32), at: d.t.clock.now, confirmed: true }],
          swap: { ...minswapEstimate.ask, amountOut: "906594100", minAmountOut: "902083681" },
          auto: { approved: { minAmountOut: "902083681", fund: { lovelace: "40000000", tokens: [] } }, direct: false },
        },
      ],
    });
    d.t.koios.addedToAccounts.push(atSession("c1".repeat(32), 0, "40000000"), atSession("c2".repeat(32), 1, "5000000"));
    d.t.koios.confirmations = 1;
    await d.sessions.list("preprod", true);
    expect(asked(d.holders.preprod).credential_utxos).toBe(0);
    const cost = await d.sessions.stopCost("preprod", 0);
    expect(cost?.skipped).toBeUndefined();
    expect(cost?.boxes ?? 0).toBeGreaterThan(0);
    expect(asked(d.holders.preprod)).toEqual({ credential_utxos: 1, tx_info: 1, other: 0 });
  });
});

describe("a return whose 5 ₳ collateral is gone, brought back by hand (O2, critic#1)", SLOW, () => {
  /** A session brought back by hand (no site, swap or mix): 40 ₳ at its account, and no 5 ₳ of ADA alone. */
  async function byHand(o: DeviceOptions = {}) {
    const d = await device(o);
    await siteSession(d.t, "40000000", false, false);
    return d;
  }

  it("with no pool anywhere: no pool's the reason, never that its spare ADA is too little, and no 5 ₳ is offered", async () => {
    const d = await byHand({ launched: false });
    const review = await d.sessions.backBuild("preprod", 0);
    expect(review.lovejoinSkipped).toBe(tr("sess.skip.warn.noAdaPool"));
    const [view] = await d.sessions.list("preprod", true);
    expect(view!.backCollateral).toBeUndefined();
  });

  it("with the pool at the holder, not kept: the build looks first, and says its collateral is what's missing", async () => {
    const d = await byHand();
    // The session list's view reads the device alone: it asks no one, and with no pool kept offers nothing.
    const [before] = await d.sessions.list("preprod", true);
    expect(before!.backCollateral).toBeUndefined();
    expect(asked(d.holders.preprod).credential_utxos).toBe(0);
    const review = await d.sessions.backBuild("preprod", 0);
    expect(review.lovejoinSkipped).toBe(tr("sess.skip.warn.noCollateral"));
    expect(asked(d.holders.preprod)).toEqual({ credential_utxos: 1, tx_info: 1, other: 0 });
    const [after] = await d.sessions.list("preprod", true);
    expect(after!.backCollateral).toBe("missing");
    expect(asked(d.holders.preprod).credential_utxos).toBe(1);
  });

  it("its offer of 5 ₳ looks too: Put in 5 ₳ finds the pool and builds the top-up", async () => {
    const d = await byHand({ privateLovelace: 100_000_000n });
    const summary = await d.sessions.backCollateralBuild("preprod", 0);
    expect(summary.payments).toEqual([expect.objectContaining({ lovelace: "5000000" })]);
    expect(asked(d.holders.preprod)).toEqual({ credential_utxos: 1, tx_info: 1, other: 0 });
  });

  it("under the pool's floor: the floor's the reason, no 5 ₳ is offered, and Put in 5 ₳ is refused", async () => {
    // The pool kept already (Lovejoin's page found it), holding 20 boxes not the wallet's under a floor of 30: once the
    // 5 ₳ is in, the return comes back directly for the floor all the same (critic#1).
    NETWORKS.preprod.lovejoin!.poolFloor = 30;
    const d = await byHand({ privateLovelace: 100_000_000n });
    expect(await d.lovejoin.lookForPools("preprod")).toEqual({ grew: true });
    const review = await d.sessions.backBuild("preprod", 0);
    expect(review.lovejoinSkipped).toBe(tr("lj.skip.warn.floorShort", { count: 20, floor: 30 }));
    const [view] = await d.sessions.list("preprod", true);
    expect(view!.backCollateral).toBeUndefined();
    await expect(d.sessions.backCollateralBuild("preprod", 0)).rejects.toThrow(tr("sess.backCollateral.notNeeded"));
    // Its spare ADA paying for no box, under the floor too, it says that.
    const small = await device({ privateLovelace: 100_000_000n });
    await siteSession(small.t, "3000000", false, false);
    await small.lovejoin.lookForPools("preprod");
    expect((await small.sessions.backBuild("preprod", 0)).lovejoinSkipped).toBe(tr("sess.skip.warn.noBox"));
  });

  /** The wallet's own reads of the pools' boxes: a Koios listing that names the 5 ₳ pool's mix_box (discovery's holder apart). */
  const poolReads = (t: T) =>
    t.koios.calls.filter((c) => c.path === "credential_utxos" && JSON.stringify(c.body ?? "").includes(ADA_VIEW.mixBoxHash)).length;

  // The list's view reads the pool's room only as last read (room's `quiet`), which no test held: every list read came
  // right after a build, whose kept read makes the two agree. Made loud, a list read past POOL_ROOM_MS, which Home makes
  // every 20 s while it shows, read every pool's boxes unasked (1.8.0's review of its fixes, r2-tests#2).
  it("the session list reads nothing of the pool, its room unread lately: under the floor, it offers 5 ₳ as its last read allows", async () => {
    NETWORKS.preprod.lovejoin!.poolFloor = 30;
    const d = await byHand();
    expect(await d.lovejoin.lookForPools("preprod")).toEqual({ grew: true });
    const [view] = await d.sessions.list("preprod", true);
    expect(poolReads(d.t)).toBe(0);
    expect(view!.backCollateral).toBe("missing");
  });

  it("on mainnet, its own floor, the data layer up or Koios only: the list asks nothing of the pool either", async () => {
    for (const mode of ["data layer up", "koios only"] as const) {
      const d = await device({ mode });
      const now = d.t.clock.now;
      await d.t.store.set("sessions.mainnet", {
        next: 1,
        sessions: [{ index: 0, ownStake: true, createdAt: now, txs: [{ kind: "out", txHash: "ab".repeat(32), at: now, confirmed: true }] }],
      });
      d.t.koios.addedToAccounts.push(atSession("c1".repeat(32), 0, "40000000"));
      expect(await d.lovejoin.lookForPools("mainnet"), mode).toEqual({ grew: true });
      const [view] = await d.sessions.list("mainnet", true);
      expect(poolReads(d.t), mode).toBe(0);
      expect(view!.backCollateral, mode).toBe("missing");
    }
  });

  // Put in 5 ₳ reads the pool's room at the press, as a return's build does (collateralWanted's `ask`): under the floor
  // it's refused there, saying the return needs no 5 ₳, and the list offers it no more. The list stays quiet, so it may
  // offer what the press then refuses (the lead's call on r2-critic#5). Read quietly, the press topped up a session the
  // floor brings back directly (1.8.0's review of its fixes, r2-critic#3).
  it("Put in 5 ₳ reads the pool at the press: under the floor it's refused there, and the list then offers it no more", async () => {
    NETWORKS.preprod.lovejoin!.poolFloor = 30;
    const d = await byHand({ privateLovelace: 100_000_000n });
    expect(await d.lovejoin.lookForPools("preprod")).toEqual({ grew: true });
    const [offered] = await d.sessions.list("preprod", true);
    expect(offered!.backCollateral).toBe("missing");
    await expect(d.sessions.backCollateralBuild("preprod", 0)).rejects.toThrow(tr("sess.backCollateral.notNeeded"));
    expect(poolReads(d.t)).toBe(1);
    const [after] = await d.sessions.list("preprod", true);
    expect(after!.backCollateral).toBeUndefined();
    expect(poolReads(d.t)).toBe(1);
  });
});

describe("a swap's approval with no pool to take its ADA (O2's approval, narrowed)", SLOW, () => {
  it("keeps its Lovejoin choice where the ADA would pay for a box, saying why it comes back directly as things are", async () => {
    for (const sell of [true, false]) {
      const d = await device({ launched: false, privateLovelace: 40_000_000n });
      if (sell) selling(d, 50_000_000n);
      const quote = await d.sessions.quote("preprod", sell ? SELL : minswapEstimate.ask);
      const review = await d.sessions.outBuild("preprod", quote);
      expect(review.lovejoin?.skipped).toBe(tr("sess.skip.warn.noAdaPool"));
      const said = approval(review, quote);
      expect(said, sell ? "sell" : "buy").not.toContain("Too little spare ADA");
      expect(said).toContain("Bring it back through Lovejoin");
      expect(said).toContain(tr("swaps.lovejoin.privacy.onPoolShort"));
      expect(said).toContain("The wallet knew of no Lovejoin pool of 5 ₳ boxes to take it, so as things are, this swap's ADA comes back directly");
    }
  });

  it("with no pool shown, counts what the ADA would pay for at a 5 ₳ box's own price, as the pool's own review would", async () => {
    const none = await device({ launched: false, privateLovelace: 40_000_000n });
    selling(none, 50_000_000n);
    const unpooled = await none.sessions.outBuild("preprod", await none.sessions.quote("preprod", SELL));
    // The same swap, the pool kept (Lovejoin's page found it) and with room for two boxes two waves deep: it pays for five.
    const kept = await device({ privateLovelace: 40_000_000n });
    await kept.lovejoin.lookForPools("preprod");
    selling(kept, 50_000_000n);
    const pooled = await kept.sessions.outBuild("preprod", await kept.sessions.quote("preprod", SELL));
    expect(pooled.lovejoin).toMatchObject({ boxes: 2, of: 5 });
    expect(unpooled.lovejoin).toMatchObject({ boxes: 0, of: pooled.lovejoin!.of });
  });

  it("says the spare ADA is too little where it pays for no box: no pool, or one under its floor (o2-trace's corner)", async () => {
    // No pool, 1 ₳ for the MIN.
    const none = await device({ launched: false, privateLovelace: 40_000_000n });
    selling(none, 1_000_000n);
    const q1 = await none.sessions.quote("preprod", SELL);
    const r1 = await none.sessions.outBuild("preprod", q1);
    expect(r1.lovejoin?.of).toBeUndefined();
    expect(approval(r1, q1)).toContain("Too little spare ADA for a Lovejoin box");
    // The pool kept, under a floor of 25 with 20 others.
    NETWORKS.preprod.lovejoin!.poolFloor = 25;
    const short = await device({ privateLovelace: 40_000_000n });
    await short.lovejoin.lookForPools("preprod");
    selling(short, 1_000_000n);
    const q2 = await short.sessions.quote("preprod", SELL);
    const r2 = await short.sessions.outBuild("preprod", q2);
    expect(r2.lovejoin?.skipped).toBeDefined();
    expect(r2.lovejoin?.of).toBeUndefined();
    expect(r2.lovejoin?.ifStopped).toBeUndefined();
    expect(approval(r2, q2)).toContain("Too little spare ADA for a Lovejoin box");
  });
});

// ---------------------------------------------------------------------------
// O4 and critic#0: the reasons a session keeps, in every frame they're shown in, now and later
// ---------------------------------------------------------------------------

describe("the reasons a return keeps, read again once a pool exists (O4, critic#0)", SLOW, () => {
  it("no pool: what the wallet knew, true in the review, on the session's page once the pool is found, and in Bring everything back", async () => {
    const d = await device({ launched: false });
    await siteSession(d.t);
    const review = await d.sessions.backBuild("preprod", 0);
    const why = review.lovejoinSkipped!;
    expect(why).toBe("the wallet knew of no Lovejoin pool of 5 ₳ boxes to take it");
    expect(read(createElement(LovejoinNote, { back: review }))).toBe(
      "Lovejoin is left out of this return: the wallet knew of no Lovejoin pool of 5 ₳ boxes to take it. Everything comes back directly, unmixed.",
    );
    await d.sessions.backSubmit("preprod", review.txHash);
    // The pool is launched, and found.
    d.holders.preprod.fake.holder = launchRows("preprod", SETTLED);
    d.t.clock.now += REFRESH_MS;
    expect((await d.lovejoin.adaPool("preprod", true))?.id).toBe(ADA);
    const [view] = await d.sessions.list("preprod", true);
    expect(view!.lovejoinSkipped).toBe(why);
    expect(read(createElement(LovejoinSkipped, { reason: view!.lovejoinSkipped }))).toBe(
      "Lovejoin was left out of its return: the wallet knew of no Lovejoin pool of 5 ₳ boxes to take it. So it comes back directly, tied to the session on chain.",
    );
    expect(tr("claim.warn.skippedItem", { name: "Session 1", why: withoutStop(why) })).toBe(
      "Session 1: the wallet knew of no Lovejoin pool of 5 ₳ boxes to take it.",
    );
  });

  it("no pool: a swap's approval and Stop's dialog open their sentence with it, a capital first", async () => {
    const d = await device({ launched: false, privateLovelace: 40_000_000n });
    selling(d, 50_000_000n);
    const quote = await d.sessions.quote("preprod", SELL);
    const review = await d.sessions.outBuild("preprod", quote);
    expect(approval(review, quote)).toContain(
      "The wallet knew of no Lovejoin pool of 5 ₳ boxes to take it, so as things are, this swap's ADA comes back directly, tied to this session on chain.",
    );
    const stop = read(
      createElement(StopDialog, { placed: false, cost: review.lovejoin, through: true, onThrough: () => undefined, busy: false, onStop: () => undefined, onClose: () => undefined }),
    );
    expect(stop).toContain("The wallet knew of no Lovejoin pool of 5 ₳ boxes to take it, so its ADA would come back directly, tied to this session on chain.");
    // Spanish opens its sentence with a capital the same way, the worker speaking it too; Japanese has none to give.
    await i18n.changeLanguage("es");
    const es = { ...review, lovejoin: { ...review.lovejoin!, skipped: tr("sess.skip.warn.noAdaPool") } };
    expect(tr("sess.skip.warn.noAdaPool")).toMatch(/^la billetera/);
    expect(approval(es, quote)).toContain(plain(`${capital(tr("sess.skip.warn.noAdaPool"))}, así que, tal como están las cosas`));
  });

  it("under the floor: the count the wallet read, said as read, on the session's page once the pool holds 40", async () => {
    // The pool kept already (Lovejoin's page found it), holding 20 boxes not the wallet's under a floor of 30.
    NETWORKS.preprod.lovejoin!.poolFloor = 30;
    const d = await device();
    await siteSession(d.t);
    expect(await d.lovejoin.lookForPools("preprod")).toEqual({ grew: true });
    const review = await d.sessions.backBuild("preprod", 0);
    expect(review.lovejoinSkipped).toBe("Lovejoin's pool held 20 boxes not yours when the wallet read it, and the wallet mixes only from 30");
    await d.sessions.backSubmit("preprod", review.txHash);
    d.t.koios.addedToAccounts.push(...adaStrangers(20, 20, d.t.clock.now));
    d.t.clock.now += 6 * 60_000;
    expect((await d.lovejoin.room("preprod", ADA))?.others).toBe(40);
    const [view] = await d.sessions.list("preprod", true);
    expect(read(createElement(LovejoinSkipped, { reason: view!.lovejoinSkipped }))).toBe(
      "Lovejoin was left out of its return: Lovejoin's pool held 20 boxes not yours when the wallet read it, and the wallet mixes only from 30. So it comes back directly, tied to the session on chain.",
    );
    expect(tr("lj.skip.warn.floorShort", { count: 1, floor: 30 })).toBe(
      "Lovejoin's pool held 1 box not yours when the wallet read it, and the wallet mixes only from 30",
    );
  });

  it("says each in Spanish and Japanese as English does: past, and the wallet's", async () => {
    for (const [language, none, floor] of [
      ["es", "la billetera no conocía ningún pool de Lovejoin de cajas de 5 ₳ que lo recibiera", "el pool de Lovejoin tenía 20 cajas que no eran tuyas cuando la billetera lo leyó, y la billetera solo mezcla a partir de 30"],
      ["ja", "ウォレットは受け入れ先となる 5 ₳ ボックスの Lovejoin プールを把握していませんでした", "ウォレットが読んだ時点で、Lovejoin のプールにはあなたのものではないボックスが 20 件あり、ウォレットがミックスするのは 30 件からです"],
    ] as const) {
      await i18n.changeLanguage(language);
      expect(tr("sess.skip.warn.noAdaPool"), language).toBe(none);
      expect(tr("lj.skip.warn.floorShort", { count: 20, floor: 30 }), language).toBe(floor);
    }
    // Spanish's every form opens lowercase, as every reason after a frame's colon does there (clauseOf), and says the
    // boxes weren't yours as the wallet read them: its one box, and `_many`, a count the floor never lets it reach
    // (1.8.0's review of its fixes, r2-screens#1 and r2-critic#6).
    await i18n.changeLanguage("es");
    expect(tr("lj.skip.warn.floorShort", { count: 1, floor: 30 })).toBe(
      "el pool de Lovejoin tenía 1 caja que no era tuya cuando la billetera lo leyó, y la billetera solo mezcla a partir de 30",
    );
    expect(tr("lj.skip.warn.floorShort", { count: 1_000_000, floor: 30 })).toMatch(/^el pool de Lovejoin tenía \S+ cajas que no eran tuyas cuando la billetera lo leyó/);
  });
});

/** A reason as it opens a sentence: its first letter a capital, where its language has one. */
const capital = (why: string) => `${why.charAt(0).toUpperCase()}${why.slice(1)}`;

// ---------------------------------------------------------------------------
// critic#2, at the merge: Settings' Bring every box back looks first
// ---------------------------------------------------------------------------

describe("Settings' Bring every box back, on a device that never kept the pool its boxes are in (critic#2)", SLOW, () => {
  /**
   * One of the wallet's boxes in the pool, made by a mix there: mixed on another device, or before a restore. Past
   * 1.8.0's first run, so nothing of the retired pools' comes back first.
   */
  async function ownBox(d: Device) {
    madeByAdaMix(d.t.koios, "f1".repeat(32));
    d.t.koios.addedToAccounts.push(adaBox("f1", await ownDatum(d.t.wallet), d.t.clock.now, 5));
    await retiredAlready(d.t.store);
  }
  /** What giveme.my was asked to witness: each withdraw's inputs. */
  const withdrawn = (d: Device) => d.t.collateral.asked.flatMap((tx) => txInputs(Uint8Array.from(Buffer.from(tx, "hex"))));
  const bringing = async (d: Device) => (await d.t.store.get<{ bringing?: unknown }>("lovejoin.preprod"))?.bringing;

  it("looks first, as Lovejoin's page does as it opens, and its run brings back the box it finds there", async () => {
    const d = await device();
    await ownBox(d);
    // A restore's unlock and Home's read know of no such pool, and ask nobody of it.
    expect(await d.lovejoin.withdrawDue("preprod", true)).toEqual([]);
    expect((await d.lovejoin.held("preprod")).boxes).toBe(0);
    expect(asked(d.holders.preprod)).toEqual({ credential_utxos: 0, tx_info: 0, other: 0 });
    await d.lovejoin.bringAllBack("preprod");
    expect(asked(d.holders.preprod)).toEqual({ credential_utxos: 1, tx_info: 1, other: 0 });
    expect(await d.lovejoin.withdrawDue("preprod")).toHaveLength(1);
    expect(withdrawn(d)).toEqual([`${"f1".repeat(32)}#0`]);
  });

  it("mainnet: with Koios only, the same look at the holder, the data layer never asked; with the data layer up, its list alone", async () => {
    const only = await device({ mode: "koios only" });
    await only.lovejoin.bringAllBack("mainnet");
    expect(asked(only.holders.mainnet)).toEqual({ credential_utxos: 1, tx_info: 1, other: 0 });
    expect(only.listAsked()).toBe(0);
    expect((await only.lovejoin.adaPool("mainnet"))?.id).toBe(ADA);
    const up = await device({ mode: "not listed" });
    await up.lovejoin.bringAllBack("mainnet");
    expect(asked(up.holders.mainnet)).toEqual({ credential_utxos: 0, tx_info: 0, other: 0 });
    expect(up.listAsked()).toBe(1);
  });

  it("looks only where no pool is named, at most once a REFRESH_MS: a pool's page, which looked as it opened, asks nobody", async () => {
    const d = await device();
    await d.lovejoin.bringAllBack("preprod", ADA);
    expect(asked(d.holders.preprod)).toEqual({ credential_utxos: 0, tx_info: 0, other: 0 });
    await d.lovejoin.stopBringingAllBack("preprod");
    await d.lovejoin.bringAllBack("preprod");
    await d.lovejoin.stopBringingAllBack("preprod");
    // The retired pools' Try again names no pool either; within REFRESH_MS of the last look, it reads nothing more.
    await d.lovejoin.bringAllBack("preprod", undefined, true);
    expect(asked(d.holders.preprod)).toEqual({ credential_utxos: 1, tx_info: 1, other: 0 });
    await d.lovejoin.stopBringingAllBack("preprod");
    d.t.clock.now += REFRESH_MS;
    await d.lovejoin.bringAllBack("preprod", undefined, true);
    expect(asked(d.holders.preprod).credential_utxos).toBe(2);
  });

  it("a look that fails stops nothing: the run is asked over the pools the wallet knows", async () => {
    const d = await device();
    d.holders.preprod.fake.fail = new Response("Koios is down.", { status: 500 });
    await d.lovejoin.bringAllBack("preprod");
    expect(asked(d.holders.preprod).credential_utxos).toBeGreaterThan(0);
    expect(await bringing(d)).toEqual({ at: expect.any(Number), back: 0 });
  });

  it("hands a trap in the look on, and asks no run", async () => {
    const trap = () => {
      throw new WebAssembly.RuntimeError("unreachable");
    };
    const d = await device({
      discoveryWasm: {
        lovejoinCandidate: trap,
        lovejoinLaunchCheck: (r: string) => wasm.lovejoinLaunchCheck(r),
        lovejoinVerifyPool: (r: string) => wasm.lovejoinVerifyPool(r),
      },
    });
    await expect(d.lovejoin.bringAllBack("preprod")).rejects.toBeInstanceOf(WebAssembly.RuntimeError);
    expect(await bringing(d)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Kept by the release's own head start (o-design E9): no look at all
// ---------------------------------------------------------------------------

describe("what the fixtures stand on", () => {
  it("the injected head start holds no v2 pool, and the bundled pool fixture is a v2 5 ₳ ADA pool", () => {
    for (const n of ["preprod", "mainnet"] as const) expect(HEAD[n].pools.filter((p) => p.version === "v2")).toEqual([]);
    const view = JSON.parse(wasm.lovejoinVerifyPool(JSON.stringify({ network: "mainnet", pool: { reference: launchRows("mainnet", SETTLED)[0], seed: FOUND.seed, scripts: launchRows("mainnet", SETTLED).slice(1) } }))) as {
      id: string;
      version: string;
      boxLovelace: string;
    };
    expect(view).toMatchObject({ id: ADA, version: "v2", boxLovelace: "5000000" });
    expect(POOL.length).toBe(20);
  });
});
