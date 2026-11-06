// 1.8.0's release review, the 5 ₳ pool that returns, mixes and the collateral share (fixer `share`):
// - P1 (adapool#0): a mix session's collateral's mix, in the pool the session mixes in, left fewer than its two draws
//   under a review that said it was mixed. Mix my boxes again now leaves them; the tile's Mix keeps the user's count and
//   says so, its review and its form; and Stop's dialog says so at a return's one box (p1-trace's second question).
// - P2 (cross#5): a return that comes back directly, its collateral mixed, reserves that mix's draws as it's built.
// - P4 (tests-unit#2, tests-unit#3, adapool#5's 4 to 8): rules no test held.
// Session 0 of the 12-word phrase, the real WebAssembly, and Lovejoin v2's 5 ₳ pool (v2-pools.ts), which every ADA mix,
// return and collateral goes into since chunk 44, sized past mainnet's floor of 30 others, at Settings' defaults (two
// waves, three a mix, the collateral on), where a test doesn't say otherwise.
import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { chainOwner, LovejoinService, STALE_POOL_TRIES, type PoolRef } from "../src/background/lovejoin";
import { LovejoinLaunchService } from "../src/background/lovejoin-launch";
import { HOLDER, LOVEJOIN_NFT } from "../src/background/lovejoin-pools";
import { Minswap } from "../src/background/minswap";
import { SESSION_BACK, SESSION_CLAIM, SessionService } from "../src/background/sessions";
import { SESSION_RESERVED_PREFIX, type Reservation } from "../src/background/spent";
import { t as tr } from "../src/i18n";
import bundled from "../src/lovejoin-pools.json";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { formRoom, mixOffer, poolRoom, PoolPage, PrivateReview, reviewHint } from "../src/ui/screens/Lovejoin";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { koiosPreprod, loadTestWasm, minswapEstimate, ownedUtxos, sessionSwap, testBalances, vectors } from "./fakes";
import { ADA, ADA_POOL, adaBox, adaStrangers, madeByAdaMix, ownDatum, strangerDatum } from "./v2-pools";

/**
 * The Mix form's wiring (screens-wiring-review-fixes.test.ts's seam, cut to what it needs): the effects of the components
 * named in `effects` run during renderToStaticMarkup, each again only when its dependencies change, and the worker
 * answers at once (`call` hands back a synchronous thenable), so what an effect asks lands in the page's state in the
 * same render. Every other component renders as on any server render, its effects not run.
 */
const seam = vi.hoisted(() => {
  interface Answer {
    then(ok?: ((value: unknown) => unknown) | null): Answer;
    catch(no: (error: unknown) => unknown): Answer;
    finally(done: () => void): Answer;
  }
  const lift = (v: unknown): Answer => (v && typeof (v as Answer).then === "function" ? (v as Answer) : settled(v));
  const settled = (value: unknown): Answer => ({
    then: (ok) => (ok ? lift(ok(value)) : settled(value)),
    catch: () => settled(value),
    finally: (done) => {
      done();
      return settled(value);
    },
  });
  /** A request the test leaves unanswered. */
  const pending: Answer = { then: () => pending, catch: () => pending, finally: () => pending };
  const state = {
    effects: new Set<string>(),
    answers: new Map<string, unknown>(),
    call: (type: string): Answer => (state.answers.has(type) ? settled(state.answers.get(type)) : pending),
    reset() {
      state.effects.clear();
      state.answers.clear();
    },
  };
  return state;
});
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  /** The component or hook that called the effect: the frame after the seam's own. */
  const caller = () => {
    const frames = (new Error().stack ?? "").split("\n");
    const at = frames.findIndex((f) => f.includes("seamEffect"));
    return /at (?:[\w$]+\.)*([\w$]+)/.exec(frames[at + 1] ?? "")?.[1] ?? "";
  };
  function seamEffect(run: () => void | (() => void), deps?: readonly unknown[]) {
    const last = react.useRef<readonly unknown[] | null>(null);
    if (!seam.effects.has(caller())) return;
    const was = last.current;
    if (was && deps && deps.length === was.length && deps.every((d, i) => Object.is(d, was[i]))) return;
    last.current = deps ?? [];
    run();
  }
  return { ...react, useEffect: seamEffect, useLayoutEffect: seamEffect };
});
vi.mock("../src/ui/background", async (original) => ({
  ...(await original<typeof import("../src/ui/background")>()),
  call: (type: string) => seam.call(type),
}));

/** Real chains and fundings are built and measured in WebAssembly: seconds each, more on CI. */
const SLOW = { timeout: 600_000 };
const PASSWORD = "correct horse battery";
const PHRASE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
)!.phrase;
/** Ogmios's answer when the network measures no more than a transaction declares. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };
const ADA_1 = 1_000_000n;
type T = ReturnType<typeof testBalances>;
type Wasm = ReturnType<typeof loadTestWasm>;
/** What WebAssembly was asked to build a chain from, and what it answered. */
type Built = { request: { collateralBoxes?: KoiosUtxo[]; legs?: unknown[] }; result: { collateralTail?: unknown } };

/** 20 boxes from Lovejoin's classic preprod pool, as Koios lists them (2026-09-25): rows every box below is made of. */
const POOL = (JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }).pool;

/** Lovejoin v2's LJTEST pool on preprod: 2 ₳ and 10^16 LJTEST a box (wasm/tests/fixtures), never on chain. */
const TOKEN_FOUND = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/lovejoin-v2-token-pool-preprod.json", import.meta.url), "utf8")) as {
  seed: { txHash: string; txIndex: number };
  reference: KoiosUtxo;
  scripts: KoiosUtxo[];
};
const TOKEN_POOL: PoolRef = { reference: TOKEN_FOUND.reference, seed: TOKEN_FOUND.seed, scripts: TOKEN_FOUND.scripts };
const TOKEN_VIEW = JSON.parse(loadTestWasm().lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: TOKEN_POOL }))) as {
  id: string;
  mixBoxHash: string;
  token: { policyId: string; assetName: string; quantity: string };
};
const TOKEN = TOKEN_VIEW.id;
const TOKEN_ADDRESS = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(TOKEN_VIEW.mixBoxHash, "hex")]));
/** One box's worth of LJTEST. */
const Q = BigInt(TOKEN_VIEW.token.quantity);
const ljtest = (quantity: bigint) => ({ policy_id: TOKEN_VIEW.token.policyId, asset_name: TOKEN_VIEW.token.assetName, quantity: quantity.toString() });

/** Preprod's 5 ₳ ADA pool as 1.7 bundled it, on 8131b1d's scripts: retired. */
const OLD_FIVE = (bundled.preprod.pools.find((p) => p.boxLovelace === "5000000" && !("version" in p)) as unknown as { ref: PoolRef }).ref;

/** A wallet whose private balance is one UTxO of `lovelace`: enough for a few 5 ₳ boxes and their mixes. */
async function wallet(lovelace = 200n * ADA_1): Promise<T> {
  const t = testBalances({ owned: false });
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.evaluation = AGREES;
  t.koios.tip = 110_000_000;
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "d1".repeat(32), tx_index: 0, value: lovelace.toString() } as KoiosUtxo);
  return t;
}

/** WebAssembly with giveme.my's witness stood in for, every chain it builds kept in `built`. */
function recording(built: Built[] = []): { wasm: Wasm; built: Built[] } {
  const wasm = loadTestWasm();
  return {
    built,
    wasm: {
      ...wasm,
      finishLovejoinWithdraw: (request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
      buildLovejoinChain: (...args: Parameters<Wasm["buildLovejoinChain"]>) => {
        const out = wasm.buildLovejoinChain(...args);
        built.push({ request: JSON.parse(args[2]) as Built["request"], result: JSON.parse(out) as Built["result"] });
        return out;
      },
    } as Wasm,
  };
}

/** Lovejoin reading `pools` beside the classic pool, its WebAssembly `wasm`. */
function pooled(t: T, pools: PoolRef[] = [ADA_POOL], wasm = recording().wasm): LovejoinService {
  return new LovejoinService({
    ...t.deps,
    wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    pools: async () => pools,
    random: () => 0.5,
  });
}

/** The sessions' WebAssembly, the one-time key's signature stood in for, each return it builds asked of it kept in `asked`. */
function signing(asked: Array<{ collateralBoxes?: KoiosUtxo[] }> = []): Wasm {
  const wasm = loadTestWasm();
  return {
    ...wasm,
    signScriptSpend: (_key: unknown, request: string) => {
      const { txCbor } = JSON.parse(request) as { txCbor: string };
      return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
    },
    buildSessionReturn: (...args: Parameters<Wasm["buildSessionReturn"]>) => {
      asked.push(JSON.parse(args[2]) as (typeof asked)[number]);
      return wasm.buildSessionReturn(...args);
    },
  } as Wasm;
}

/** The sessions, the one-time key's signature stood in for. */
function runner(t: T, lj: LovejoinService, extra: Partial<ConstructorParameters<typeof SessionService>[0]> = {}): SessionService {
  return new SessionService({
    ...t.deps,
    wasm: signing(),
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
    lovejoin: lj,
    sleep: async () => undefined,
    alarm: { start: async () => undefined },
    ...extra,
  });
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
    asset_list: assets.map((a) => ({ ...a, decimals: 0, fingerprint: "asset1test" })),
  } as KoiosUtxo;
}

/** `mine` of the wallet's own boxes in the 5 ₳ pool, each made by a mix there, so Mix my boxes again takes it. */
async function ownBoxes(t: T, mine: number): Promise<KoiosUtxo[]> {
  const own: KoiosUtxo[] = [];
  for (let i = 0; i < mine; i++) {
    const tx = (0xa0 + i).toString(16).padStart(2, "0");
    madeByAdaMix(t.koios, tx.repeat(32));
    own.push(adaBox(tx, await ownDatum(t.wallet), t.clock.now, 5));
  }
  return own;
}

/** A box of the LJTEST pool, a stranger's or the wallet's, a mix there having made it. */
async function tokenBox(t: T, tx: string, ours: boolean): Promise<KoiosUtxo> {
  t.koios.txSpends.set(tx.repeat(32), [{ payment_addr: { bech32: TOKEN_ADDRESS, cred: TOKEN_VIEW.mixBoxHash } }]);
  return {
    ...POOL[0]!,
    tx_hash: tx.repeat(32),
    tx_index: 0,
    address: TOKEN_ADDRESS,
    payment_cred: TOKEN_VIEW.mixBoxHash,
    value: "2000000",
    block_time: Math.floor(t.clock.now / 1000) - 5 * 3600,
    datum_hash: null,
    inline_datum: { bytes: ours ? await ownDatum(t.wallet) : strangerDatum(), value: {} },
    asset_list: [{ ...ljtest(Q), decimals: 0, fingerprint: "asset1ljtest" } as never],
  } as KoiosUtxo;
}

/** `n` strangers' boxes in the LJTEST pool, their transactions' hashes from `first`. */
const tokenStrangers = (t: T, n: number, first = 0x40) =>
  Promise.all(Array.from({ length: n }, (_, i) => tokenBox(t, (first + i).toString(16).padStart(2, "0"), false)));

type Sealed = { chains: Array<{ id: string; session?: number; tail?: unknown; boxes: number }> };

/** Funds and runs mix session `out` (its funding landed), and reads back its chain's record. */
async function run(t: T, sessions: SessionService, out: { txHash: string; payments: Array<{ lovelace: string }> }) {
  const { index } = await sessions.mixOutSubmit("preprod", out.txHash);
  t.koios.addedToAccounts.push(atSession(out.txHash, 0, out.payments[0]!.lovelace), atSession(out.txHash, 1, "5000000"));
  t.koios.confirmations = 1;
  await sessions.advance("preprod", index, true);
  return (await t.store.get<Sealed>("lovejoin.preprod"))!.chains.find((c) => c.session === index);
}

/** A mix's review as its page renders it, balances shown. */
function rendered(out: unknown): string {
  return renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances: false }, loaded: true, set: async () => undefined } },
        createElement(PrivateReview, { summary: out as never, box: { lovelace: "5000000" } }),
      ),
    ),
  ).replaceAll("&#x27;", "'");
}

/** The line by a private mix's review's title. */
const hintOf = (out: unknown) => reviewHint({ source: "private", summary: out } as never);

/** Mix my boxes again's review, the 5 ₳ pool holding `strangers` boxes not the wallet's and `mine` of its own. */
async function again(strangers: number, mine: number, prefs: Parameters<T["deps"]["preferences"]["set"]>[0] = {}) {
  const t = await wallet();
  await t.deps.preferences.set(prefs);
  const sessions = runner(t, pooled(t));
  t.koios.addedToAccounts.push(...adaStrangers(strangers, 0x100, t.clock.now), ...(await ownBoxes(t, mine)));
  const out = await sessions.againBuild("preprod", false, ADA);
  return { t, sessions, out };
}

/** The tile's Mix of `boxes` boxes into the 5 ₳ pool, holding `strangers` boxes not the wallet's. */
async function tile(strangers: number, boxes: number, depth?: 1 | 2) {
  const t = await wallet();
  if (depth) await t.deps.preferences.set({ lovejoinDepth: depth });
  const sessions = runner(t, pooled(t));
  t.koios.addedToAccounts.push(...adaStrangers(strangers, 0x100, t.clock.now));
  const out = await sessions.mixOutBuild("preprod", boxes, { pool: ADA });
  return { t, sessions, out };
}

describe("Mix my boxes again leaves its collateral's mix its two draws in the pool it mixes in (P1)", SLOW, () => {
  it("takes as many of the wallet's boxes as leave that mix two, and its chain builds it: 3 of 5, with 33 strangers' boxes", async () => {
    const { t, sessions, out } = await again(33, 5);
    // Four would draw 32 of the 33, leaving that mix one: three go, the wallet's other two wait for the next press, and
    // the 5 ₳ its review says is mixed is.
    expect(out.mix.boxes).toBe(3);
    expect(out.collateralMix).toBe("mixed");
    expect(hintOf(out)).toBe(tr("lovejoin.review.againNoteMixed"));
    const chain = await run(t, sessions, out);
    expect(chain?.boxes).toBe(3);
    expect(chain?.tail).toBeDefined();
  });

  it("one wave deep, where every press the room binds left it none: 14 of 20, with 31 strangers' boxes", async () => {
    const { t, sessions, out } = await again(31, 20, { lovejoinDepth: 1 });
    expect(out.mix.boxes).toBe(14);
    expect(out.collateralMix).toBe("mixed");
    expect((await run(t, sessions, out))?.tail).toBeDefined();
  });

  it("keeps the one box that fits, saying its collateral is mixed only if enough is left: 1 of 1, with 9 strangers' boxes", async () => {
    // Preprod's floor is none: one box two waves deep draws 8, leaving one. Refusing it would refuse a mix the contracts take.
    const { out } = await again(9, 1);
    expect(out.mix.boxes).toBe(1);
    expect(out.collateralMix).toBe("ifLeft");
    expect(out.collateralReserve).toBe("1500000");
    expect(hintOf(out)).toBe(tr("lovejoin.review.againNote"));
    expect(rendered(out)).toContain(tr("lovejoin.collateralMix.privacy.ifLeft"));
  });

  it("holds those draws at its build too, the pool smaller by then: reviewed at 34 strangers' boxes for 4, built at 33 for 3 and that mix", async () => {
    const { t, sessions, out } = await again(34, 5);
    expect(out.mix.boxes).toBe(4);
    expect(out.collateralMix).toBe("mixed");
    // One of them spent before the funding lands: 4 boxes would leave one.
    t.koios.addedToAccounts.splice(
      t.koios.addedToAccounts.findIndex((u) => u.tx_hash.startsWith("5a5e")),
      1,
    );
    const chain = await run(t, sessions, out);
    expect(chain?.boxes).toBe(3);
    expect(chain?.tail).toBeDefined();
  });

  it("holds nothing with Settings' collateral off, the control that turns it down: all 4 that fit go", async () => {
    const { out } = await again(33, 5, { lovejoinCollateral: false });
    expect(out.mix.boxes).toBe(4);
    expect(out.collateralMix).toBeUndefined();
  });

  it("holds nothing in a pool its collateral doesn't go into: Mix my boxes again in the LJTEST pool takes both that fit", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const sessions = runner(t, pooled(t, [TOKEN_POOL, ADA_POOL]));
    // Four strangers' boxes there, one wave deep: room for two, both the wallet's. Holding two draws would leave one.
    t.koios.addedToAccounts.push(...(await tokenStrangers(t, 4)), await tokenBox(t, "b1", true), await tokenBox(t, "b2", true));
    t.koios.addedToAccounts.push(...adaStrangers(33, 0x100, t.clock.now));
    const out = await sessions.againBuild("preprod", false, TOKEN);
    expect(out.mix.boxes).toBe(2);
    expect(out.collateralMix).toBe("mixed");
  });
});

describe("the tile's Mix keeps the user's count, and says where it leaves its collateral's mix short (P1)", SLOW, () => {
  it("at 4 boxes with 33 strangers' boxes, the most the form offers: its review says only if enough is left, and all 4 are built", async () => {
    const four = await tile(33, 4);
    expect(four.out.mix.boxes).toBe(4);
    expect(four.out.collateralMix).toBe("ifLeft");
    // Its reserve paid all the same: the form's figures stay the review's, and the pool may grow by then.
    expect(four.out.collateralReserve).toBe("1500000");
    expect(hintOf(four.out)).toBe(tr("lovejoin.review.privateNote"));
    const page = rendered(four.out);
    expect(page).toContain(tr("lovejoin.collateralMix.privacy.ifLeft"));
    expect(page).not.toContain(tr("swaps.review.privacy.collateralMix"));
    // Every box it paid for goes (tests-unit#3): its collateral comes back with the rest, as its review now says.
    const chain = await run(four.t, four.sessions, four.out);
    expect(chain?.boxes).toBe(4);
    expect(chain?.tail).toBeUndefined();
    // One box fewer leaves the two: mixed, and built so.
    const three = await tile(33, 3);
    expect(three.out.collateralMix).toBe("mixed");
    expect(hintOf(three.out)).toBe(tr("lovejoin.review.privateNoteMixed"));
    expect((await run(three.t, three.sessions, three.out))?.tail).toBeDefined();
  });

  it("one wave deep at one box: 2 and 3 strangers' boxes leave that mix short, 4 don't (p1-trace's rows)", async () => {
    for (const [strangers, mix] of [
      [2, "ifLeft"],
      [3, "ifLeft"],
      [4, "mixed"],
    ] as const) {
      const { out } = await tile(strangers, 1, 1);
      expect(out.collateralMix, `${strangers}`).toBe(mix);
    }
  });

  it("says so on its form too, at a count that leaves that mix fewer than two free in its own pool, its reserve still counted", () => {
    const side = { lovelace: (200n * ADA_1).toString(), tokens: [] };
    // One 5 ₳ box two waves deep, as WebAssembly prices it: 5 ₳ and 3.8 ₳ of mixes.
    const ONE = { boxes: 1, lovelace: "8800000", mixFees: "3800000" };
    const at = (boxes: number) => {
      const room = poolRoom({ others: 33, free: 33, floor: 30 }, boxes, 2);
      return mixOffer("private", side, undefined, ONE, 5_000_000n, formRoom(3, 2, room).most, boxes, 1_500_000n, undefined, room.have - room.need);
    };
    expect(at(4)).toMatchObject({ most: 4, tail: 1_500_000n, tailShort: true });
    expect(at(3)).toMatchObject({ most: 4, tail: 1_500_000n, tailShort: false });
    // Nothing asked for its mix, nothing said; and nothing where the pool isn't the one it goes into (`left` none).
    expect(mixOffer("private", side, undefined, ONE, 5_000_000n, 4, 4, 0n, undefined, 1).tailShort).toBe(false);
    expect(mixOffer("private", side, undefined, ONE, 5_000_000n, 4, 4, 1_500_000n).tailShort).toBe(false);
  });

  it("never caps the stepper for that mix: it still offers every box the pool has room for", () => {
    expect(formRoom(3, 2, poolRoom({ others: 33, free: 33, floor: 30 }, 1, 2)).most).toBe(4);
    expect(formRoom(3, 1, poolRoom({ others: 31, free: 31, floor: 30 }, 1, 1)).most).toBe(10);
  });
});

/**
 * A swap's session 0, its return through Lovejoin two waves deep as approved, funded with its collateral's reserve and
 * 30 ₳ of ADA beside it (three 5 ₳ boxes' worth), and `strangers` boxes not the wallet's in the 5 ₳ pool: Stop's
 * dialog, then its return built (p1-trace's swapReturn).
 */
async function stopped(strangers: number) {
  const t = await wallet();
  const sessions = runner(t, pooled(t));
  const reserve = BigInt(loadTestWasm().lovejoinCollateralReserve());
  const fund = 30n * ADA_1;
  const out = "ab".repeat(32);
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: t.clock.now,
        txs: [{ kind: "out", txHash: out, at: t.clock.now, confirmed: true }],
        swap: { ...minswapEstimate.ask, amountOut: "906594100", minAmountOut: "902083681" },
        auto: { approved: { minAmountOut: "902083681", fund: { lovelace: fund.toString(), tokens: [] } }, direct: false, lovejoin: { depth: 2, delay: "1-6" } },
        collateralReserve: true,
      },
    ],
  });
  t.koios.addedToAccounts.push(atSession(out, 0, (fund + reserve).toString()), atSession(out, 1, "5000000"), ...adaStrangers(strangers, 0x100, t.clock.now));
  await sessions.list("preprod", true);
  const cost = await sessions.stopCost("preprod", 0);
  const back = await sessions.backBuild("preprod", 0);
  return { cost, back };
}

describe("Stop's dialog says where a return's one box leaves its collateral's mix short (P1, p1-trace's second question)", SLOW, () => {
  it("with 8 or 9 strangers' boxes two waves deep, its one box draws 8: mixed only if enough is left, as the return is built", async () => {
    for (const strangers of [8, 9]) {
      const { cost, back } = await stopped(strangers);
      expect(cost, `${strangers}`).toMatchObject({ boxes: 1, collateralMix: "ifLeft" });
      expect(back.lovejoin?.boxes, `${strangers}`).toBe(1);
      expect(back.collateralTail, `${strangers}`).toBeUndefined();
    }
  });

  it("with 10, and with 16, where the chain makes one box, as the dialog says, to leave that mix its draws: mixed, as built", async () => {
    for (const strangers of [10, 16]) {
      const { cost, back } = await stopped(strangers);
      expect(cost?.collateralMix, `${strangers}`).toBe("mixed");
      expect(back.lovejoin?.boxes, `${strangers}`).toBe(1);
      // The dialog counts the boxes the return makes: at 16 it said two, counting the room without that mix's two draws
      // held (1.8.0's review of its fixes, r2-worker#0; 1.8.0's release review, last-code#4).
      expect(cost?.boxes, `${strangers}`).toBe(back.lovejoin?.boxes);
      expect(back.collateralTail, `${strangers}`).toBeDefined();
    }
  });
});

/** Session `index`'s one-time account: its reward address, its address and its key's hash. */
function account(t: T, index: number) {
  const net = loadTestWasm().Network.Preprod;
  return t.wallet.withKeys((keys) => ({
    reward: keys.oneTime.rewardAddress(net, index),
    address: keys.oneTime.address(net, index),
    keyHash: keys.oneTime.keyHash(index),
  }));
}

/** `txs`' inputs among `refs`, `txhash#index`. */
const drawnFrom = (refs: Set<string>, txs: Array<{ txCbor: string }>) =>
  new Set(txs.flatMap((x) => txInputs(Uint8Array.from(Buffer.from(x.txCbor, "hex")))).filter((o) => refs.has(o)));

/** A row's outpoint, `txhash#index`. */
const ref = (u: Pick<KoiosUtxo, "tx_hash" | "tx_index">) => `${u.tx_hash}#${u.tx_index}`;

/** Reserves `inputs` as chain `owner`'s, being sent: a chain of the wallet's built meanwhile, a mix from the public account. */
async function heldBy(t: T, owner: string, inputs: string[]): Promise<void> {
  await t.wallet.withKeys(async () => {
    const kept = (await t.session.get<Record<string, Reservation>>(SESSION_RESERVED_PREFIX + "preprod")) ?? {};
    await t.session.set(SESSION_RESERVED_PREFIX + "preprod", { ...kept, [owner]: { inputs, collateral: [] } });
  });
}

/** Every chain's reservation on preprod. */
const reserved = (t: T) => t.wallet.withKeys(() => t.session.get<Record<string, Reservation>>(SESSION_RESERVED_PREFIX + "preprod"));

/**
 * A site's private session 0 holding `lovelace` of ADA and its 5 ₳ collateral, from its own funding, and `held` of
 * LJTEST beside them; `strangers` boxes not the wallet's in the 5 ₳ pool.
 */
async function site(t: T, lovelace: string, strangers: number, held = 0n): Promise<Set<string>> {
  const funding = "ab".repeat(32);
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [{ index: 0, ownStake: true, createdAt: t.clock.now, txs: [{ kind: "out", txHash: funding, at: t.clock.now, confirmed: true }], site: { origin: "https://example.org" } }],
  });
  const pool = adaStrangers(strangers, 0x100, t.clock.now);
  t.koios.addedToAccounts.push(
    ...(held ? [atSession(funding, 0, "3000000", [ljtest(held)])] : []),
    atSession(funding, 1, lovelace),
    atSession(funding, 2, "5000000"),
    ...pool,
  );
  return new Set(pool.map(ref));
}

describe("a return that comes back directly reserves its collateral's mix as it's built (P2)", SLOW, () => {
  /**
   * Bring everything back over two sessions a restore found (lows-a's claimOf): session 0's 3 ₳ pays for no box, so it
   * comes back directly, its collateral mixed into the 5 ₳ pool; session 1's 40 ₳ goes into the same pool in a chain,
   * built after it. One wave deep, 14 strangers' boxes there.
   */
  async function claimed() {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const sessions = runner(t, pooled(t));
    for (const [i, value] of [
      [0, "3000000"],
      [1, "40000000"],
    ] as const) {
      const a = await account(t, i);
      const funding = `f${i}`.repeat(32);
      t.koios.usedStakes.add(a.reward);
      t.koios.accountTxs.set(a.reward, [{ tx_hash: funding, block_height: 5_000_000 + i, block_time: 1_705_000_000 + i }]);
      const at = (n: number, v: string): KoiosUtxo => ({ ...atSession(funding, n, v), address: a.address, payment_cred: a.keyHash });
      t.koios.addedToAccounts.push(at(1, value), at(2, "5000000"));
    }
    const pool = adaStrangers(14, 0x100, t.clock.now);
    t.koios.addedToAccounts.push(...pool);
    expect(await sessions.scan("preprod")).toEqual({ used: 2, found: [0, 1] });
    const { returns } = await sessions.claimBuild("preprod", [0, 1]);
    const kept = (await t.wallet.withKeys(() => t.session.get<Array<{ index: number; chain?: Array<{ txCbor: string }> }>>(SESSION_CLAIM)))!;
    const drawn = (index: number) => drawnFrom(new Set(pool.map(ref)), kept.find((k) => k.index === index)?.chain ?? []);
    return { sessions, returns, drawn };
  }

  it("Bring everything back draws no box twice, the direct return built first, and both are sent", async () => {
    const { sessions, returns, drawn } = await claimed();
    expect(returns.map((r) => [r.index, !!r.collateralTail, !!r.lovejoin])).toEqual([
      [0, true, false],
      [1, true, true],
    ]);
    // Session 0's collateral's mix drew two; session 1's chain the twelve left, its own collateral's mix's two among them.
    expect(drawn(0).size).toBe(2);
    expect(drawn(1).size).toBe(12);
    expect([...drawn(0)].filter((o) => drawn(1).has(o))).toEqual([]);
    const sent = await sessions.claimSubmit("preprod", returns.map((r) => r.txHash));
    expect(sent.failed).toEqual([]);
    expect(sent.sent.map((s) => s.index)).toEqual([0, 1]);
  });

  it("is built again without a box another chain reserved since its pool read, and keeps its mix", async () => {
    const t = await wallet();
    const refs = await site(t, "3000000", 20);
    const lj = pooled(t);
    const real = lj.reserve.bind(lj);
    let taken: string | undefined;
    lj.reserve = async (network, owner, txs, until, held) => {
      // A mix from the public account, built as this return was, took one of the two its collateral's mix drew.
      if (owner === chainOwner(0) && !taken) {
        taken = [...drawnFrom(refs, txs)][0];
        if (taken) await heldBy(t, chainOwner(), [taken]);
      }
      return real(network, owner, txs, until, held);
    };
    const asked: Array<{ collateralBoxes?: KoiosUtxo[] }> = [];
    const back = await runner(t, lj, { wasm: signing(asked) }).backBuild("preprod", 0);
    expect(back.lovejoin).toBeUndefined();
    expect(back.collateralTail).toBeDefined();
    // Built twice: the second from the rows the first drew from, less the box taken.
    expect(taken).toBeDefined();
    expect(asked).toHaveLength(2);
    expect(asked[0]!.collateralBoxes!.map(ref)).toContain(taken);
    expect(asked[1]!.collateralBoxes!.map(ref)).toEqual(asked[0]!.collateralBoxes!.map(ref).filter((o) => o !== taken));
    const chain = (await t.wallet.withKeys(() => t.session.get<{ chain?: Array<{ txCbor: string }> }>(SESSION_BACK)))!.chain!;
    const drew = drawnFrom(refs, chain);
    expect(drew.size).toBe(2);
    expect(drew.has(taken!)).toBe(false);
    // Kept for Send: those two are the session's, no other chain's to draw.
    expect((await reserved(t))?.[chainOwner(0)]?.inputs).toEqual(expect.arrayContaining([...drew]));
  });

  it("past STALE_POOL_TRIES such tries, comes back with its collateral and nothing reserved, its review saying no mix", async () => {
    const t = await wallet();
    const refs = await site(t, "3000000", 20);
    const lj = pooled(t);
    const real = lj.reserve.bind(lj);
    let tries = 0;
    lj.reserve = async (network, owner, txs, until, held) => {
      // Every box of the pool taken by another chain as each build is reserved.
      if (owner === chainOwner(0)) {
        tries++;
        await heldBy(t, chainOwner(), [...refs]);
      }
      return real(network, owner, txs, until, held);
    };
    const back = await runner(t, lj).backBuild("preprod", 0);
    expect(tries).toBe(STALE_POOL_TRIES + 1);
    expect(back.collateralTail).toBeUndefined();
    expect(back.txHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await reserved(t))?.[chainOwner(0)]).toBeUndefined();
  });
});

describe("a collateral's mix draws from what the try building it read (P4: tests-unit#2, adapool#5's 5)", SLOW, () => {
  /** Lovejoin whose collateralPool read has one of its boxes reserved by another chain the moment it's read. */
  function takenAfterRead(t: T, lj: LovejoinService, refs: Set<string>): { taken: () => string | undefined } {
    const read = lj.collateralPool.bind(lj);
    let taken: string | undefined;
    lj.collateralPool = async (...args: Parameters<LovejoinService["collateralPool"]>) => {
      const found = await read(...args);
      const first = found?.rows.map(ref).find((o) => refs.has(o));
      if (first && !taken) {
        taken = first;
        await heldBy(t, chainOwner(), [first]);
      }
      return found;
    };
    return { taken: () => taken };
  }

  it("a return into the 5 ₳ pool hands that mix this try's own read of the pool, never the rows read before", async () => {
    const t = await wallet();
    const refs = await site(t, "40000000", 20);
    const { wasm, built } = recording();
    const lj = pooled(t, [ADA_POOL], wasm);
    const { taken } = takenAfterRead(t, lj, refs);
    const back = await runner(t, lj).backBuild("preprod", 0);
    expect(back.lovejoin?.boxes).toBeGreaterThan(0);
    expect(back.collateralTail).toBeDefined();
    expect(taken()).toBeDefined();
    expect(built.length).toBeGreaterThan(0);
    for (const b of built) expect(b.request.collateralBoxes!.map(ref)).not.toContain(taken());
  });

  it("a return across pools does too, its collateral's in the 5 ₳ pool's leg's read", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const refs = await site(t, "40000000", 20, Q);
    t.koios.addedToAccounts.push(...(await tokenStrangers(t, 8)));
    const { wasm, built } = recording();
    const lj = pooled(t, [TOKEN_POOL, ADA_POOL], wasm);
    const { taken } = takenAfterRead(t, lj, refs);
    const back = await runner(t, lj).backBuild("preprod", 0);
    expect(back.lovejoin?.ways?.[0]).toMatchObject({ pool: TOKEN, boxes: 1 });
    expect(back.collateralTail).toBeDefined();
    const across = built.filter((b) => b.request.legs);
    expect(across.length).toBeGreaterThan(0);
    for (const b of across) expect(b.request.collateralBoxes!.map(ref)).not.toContain(taken());
  });

  it("a private mix into the LJTEST pool, refused a box its collateral's mix drew, draws again without it", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const funding = "f0".repeat(32);
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: t.clock.now,
          txs: [{ kind: "out", txHash: funding, at: t.clock.now, confirmed: true }],
          mix: { boxes: 1, pool: TOKEN },
          auto: { approved: { minAmountOut: "0", fund: { lovelace: "20000000", tokens: [] } } },
          collateralReserve: true,
        },
      ],
    });
    const pool = adaStrangers(4, 0x100, t.clock.now);
    t.koios.addedToAccounts.push(atSession(funding, 0, "20000000", [ljtest(Q)]), atSession(funding, 1, "5000000"), ...(await tokenStrangers(t, 8)), ...pool);
    const refs = new Set(pool.map(ref));
    const { wasm, built } = recording();
    const lj = pooled(t, [TOKEN_POOL, ADA_POOL], wasm);
    const real = lj.reserve.bind(lj);
    let taken: string | undefined;
    lj.reserve = async (network, owner, txs, until, held) => {
      // Another chain of the wallet's reserved one of the two its collateral's mix drew, after collateralPool read them.
      if (owner === chainOwner(0) && !taken) {
        taken = [...drawnFrom(refs, txs)][0];
        if (taken) await heldBy(t, chainOwner(), [taken]);
      }
      return real(network, owner, txs, until, held);
    };
    const back = await runner(t, lj).backBuild("preprod", 0);
    expect(back.lovejoin).toMatchObject({ boxes: 1, pool: TOKEN });
    expect(back.collateralTail).toBeDefined();
    expect(built).toHaveLength(2);
    expect(built[0]!.request.collateralBoxes!.map(ref)).toContain(taken);
    expect(built[1]!.request.collateralBoxes!.map(ref)).not.toContain(taken);
  });
});

describe("a return's room across pools leaves its collateral's mix its draws in the 5 ₳ pool alone (P4: tests-unit#3, adapool#5's 4)", SLOW, () => {
  it("2 boxes of LJTEST in a pool with room for 2, and 3 of the 5 ₳ pool's 4 that 8 strangers' boxes have room for: that mix keeps two", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    await site(t, "60000000", 8, 2n * Q);
    t.koios.addedToAccounts.push(...(await tokenStrangers(t, 4)));
    const back = await runner(t, pooled(t, [TOKEN_POOL, ADA_POOL])).backBuild("preprod", 0);
    // The token's pool keeps the room it has: no collateral goes there.
    expect(back.lovejoin?.ways?.[0]).toMatchObject({ pool: TOKEN, boxes: 2 });
    expect(back.lovejoin?.parts).toEqual([
      { pool: TOKEN, boxes: 2 },
      { pool: ADA, boxes: 3 },
    ]);
    expect(back.collateralTail).toBeDefined();
  });
});

/**
 * A pool of `token` (none: an ADA pool) with `boxLovelace` a box, as the wallet's own start from the public account
 * makes it (collateral-reserve-review-fixes.test.ts launched): its reference UTxO and its two scripts at the holder,
 * and its seed. On v2's scripts, as every launch since chunk 44's 44a.
 */
async function launched(boxLovelace: string, account: [string, string], token?: { policyId: string; assetName: string; quantity: string }): Promise<{ id: string; ref: PoolRef }> {
  const t = testBalances();
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.evaluation = AGREES;
  t.koios.tip = 110_000_000;
  const wasm = loadTestWasm();
  const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
  const atAccount = (tx: string, value: string) => ({ ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, asset_list: [] }) as KoiosUtxo;
  t.koios.addedToAccounts.push(atAccount(account[0], "40000000"), atAccount(account[1], "5000000"));
  let made: { txCbor: string; pool: { id: string; mixBoxHash: string; mixLogicHash: string; seed: { txHash: string; txIndex: number } }; locked: { mixBox: string } } | undefined;
  const launch = new LovejoinLaunchService({
    ...t.deps,
    wasm: {
      ...wasm,
      buildLovejoinLaunchFromAccount: (key: Parameters<Wasm["buildLovejoinLaunchFromAccount"]>[0], request: string) => {
        const out = wasm.buildLovejoinLaunchFromAccount(key, request);
        if ((JSON.parse(request) as { register: boolean }).register) made = JSON.parse(out) as typeof made;
        return out;
      },
    } as Wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    lovejoin: t.lovejoin,
    discovery: { known: async () => [], look: async () => undefined },
  });
  await launch.build("preprod", { from: "public", ...(token ? { token: { policyId: token.policyId, assetName: token.assetName }, quantity: token.quantity } : {}), boxLovelace });
  const outs = JSON.parse(wasm.ogmiosUtxos(made!.txCbor)) as Array<{
    transaction: { id: string };
    index: number;
    address: string;
    value: { ada: { lovelace: number } } & Record<string, Record<string, number>>;
    datum?: string;
  }>;
  const row = (o: (typeof outs)[number], extra: Partial<KoiosUtxo>): KoiosUtxo =>
    ({
      ...POOL[0]!,
      tx_hash: o.transaction.id,
      tx_index: o.index,
      address: o.address,
      payment_cred: HOLDER,
      value: String(o.value.ada.lovelace),
      datum_hash: null,
      inline_datum: null,
      asset_list: [],
      ...extra,
    }) as KoiosUtxo;
  const atHolder = outs.filter((o) => o.address === outs.find((x) => x.value[made!.pool.id])!.address);
  const reference = atHolder.find((o) => o.value[made!.pool.id])!;
  // Its two scripts' outputs, told apart by what each holds.
  const scripts = atHolder
    .filter((o) => o !== reference)
    .map((o) =>
      row(o, {
        reference_script: { hash: String(o.value.ada.lovelace) === made!.locked.mixBox ? made!.pool.mixBoxHash : made!.pool.mixLogicHash, type: "plutusV3" } as never,
      }),
    );
  return {
    id: made!.pool.id,
    ref: {
      reference: row(reference, {
        inline_datum: { bytes: reference.datum!, value: {} } as never,
        asset_list: [{ policy_id: made!.pool.id, asset_name: LOVEJOIN_NFT, quantity: "1", decimals: 0, fingerprint: "" } as never],
      }),
      seed: made!.pool.seed,
      scripts,
    },
  };
}

describe("the 5 ₳ pool a return and its collateral go into is v2's ADA pool of 5 ₳ boxes (P4: adapool#5's 6 and 8)", SLOW, () => {
  it("never a token's pool whose box holds 5 ₳, launched before it", async () => {
    // MIN's, 5 ₳ and 100 MIN a box: a v2 pool, shown, the earlier in the read set.
    const MIN5 = await launched("5000000", ["e1", "e5"], { policyId: minswapEstimate.ask.tokenOut.slice(0, 56), assetName: minswapEstimate.ask.tokenOut.slice(56), quantity: "100000000" });
    const t = await wallet();
    const lj = pooled(t, [MIN5.ref, ADA_POOL]);
    expect((await lj.adaPool("preprod"))?.id).toBe(ADA);
    expect((await lj.funding("preprod", 1, false, undefined, MIN5.id)).collateralPool).toBe(ADA);
  });

  it("never 1.7's 5 ₳ pool, retired, which the Mix form would count the collateral's reserve for", async () => {
    const t = await wallet();
    expect((await pooled(t, [OLD_FIVE, ADA_POOL]).funding("preprod", 1, false, undefined, ADA)).collateralPool).toBe(ADA);
    const alone = await pooled(t, [OLD_FIVE, TOKEN_POOL]).funding("preprod", 1, false, undefined, TOKEN);
    expect(alone.collateralPool).toBeUndefined();
    expect(alone.collateralReserve).toBeUndefined();
  });
});

describe("the Mix form's line where its count leaves its collateral's mix short, wired (P1, the form's call)", () => {
  /** v2's pool of 5 ₳ boxes as the page's read has it: `others` boxes not the wallet's, all free, none of its own. */
  const fiveOf = (others: number) => ({ id: ADA, box: { lovelace: "5000000" }, others, free: others, floor: 0, boxes: [], lovelace: "0", due: [], notMixed: [], fromPublic: [] });
  /** One 5 ₳ box two waves deep, as WebAssembly prices it, with its collateral's reserve and the pool it goes into. */
  const funding = { lovelace: "8800000", mixes: 4, mixFees: "3800000", boxes: 1, depth: 2, delay: "1-6", pool: ADA, collateralReserve: "1500000", collateralPool: ADA };
  const seedelf = { lovelace: (200n * ADA_1).toString(), tokens: [], utxos: 3, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 } };
  const noop = () => undefined;
  /** The pool's page, its Mix form at its one box, the worker's funding answered. */
  function formOf(others: number): string {
    seam.reset();
    seam.effects.add("PoolPage");
    seam.answers.set("lovejoin-funding", funding);
    const five = fiveOf(others);
    const page = { pool: five, pools: [five], seedelf, reading: false, readFailed: false, mixingAgain: false, sending: null };
    const handlers = { onSendingPublic: noop, onSending: noop, onRefresh: async () => undefined, onBack: noop, onPending: noop };
    return renderToStaticMarkup(
      createElement(
        NetworkContext.Provider,
        { value: "preprod" },
        createElement(
          PreferencesContext.Provider,
          { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances: false }, loaded: true, set: async () => undefined } },
          createElement(PoolPage, { ...page, ...handlers } as never),
        ),
      ),
    );
  }

  it("says it where the one box leaves one of 9 strangers' boxes free, its reserve counted; never where it leaves 10's two", () => {
    const short = formOf(9);
    expect(short).toContain('data-testid="lovejoin-collateral-if-left"');
    expect(short).toContain(tr("lovejoin.mix.privacy.collateralIfLeft").replaceAll("'", "&#x27;"));
    expect(formOf(10)).not.toContain('data-testid="lovejoin-collateral-if-left"');
  });
});
