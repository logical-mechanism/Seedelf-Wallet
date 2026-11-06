// 1.8.0's release review, its screens: what they say and do in the states 1.8.0 makes, as a person reads them. A
// swap's boxes are the 5 ₳ pool's (W1). The retired reason says what a retired pool is, and nothing of when its boxes
// come back (W3 with W4). A 1.7 chain stopped partway in a retired pool says why alone (W8), and a retired pool's page
// sends nobody to another account to mix again (W9). The hub searches only while its search shows (S1), keeps a pool's
// page once its run of Bring every box back emptied the pool (S2), names tokens in its aside only where a token pool
// takes boxes, and says there's no pool to mix in yet where none listed takes them (O6; screens#10, words#10). A retired
// pool's page and row hold to withdraw-only (screens#8; tests-e2e#2's unit half), and a return's switch says the 5 ₳
// pool's boxes mix spare ADA (screens#9).
//
// Its review of its fixes (round two): a pool below the network's minimum takes no box on the hub either (r2-screens#3),
// whose aside says "in 5 ₳ boxes" only where the ADA pools that take boxes all hold 5 ₳ (r2-screens#4). A chain
// stopped partway in a pool the read set lacks stays undecided where discovery's record can't be read (r2-tests#3).
// Bring every box back's question names what its press asks (r2-tests#1, r2-screens#0), and a v2 pool's page says the
// retired pools' run goes, never another pool's (r2-screens#5).
//
// No DOM: each screen is rendered once, as the house's screen tests render them. The hub's read, and a pool's page open
// on it, are states only a read or a press reaches, so they're seeded: each the useState right after a run of states
// starting as `after` (screens-wiring-review-fixes' `seed`), its setter kept to change it inside the render as the read
// after it would. An element's props are taken as it's made (`on`), to press what it's handed. No effect runs, and no
// request answers.
import { readFileSync } from "node:fs";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PoolRef } from "../src/background/lovejoin";
import type { LovejoinChainView, LovejoinPoolStatus, LovejoinStatus } from "../src/shared/rpc";
import type { ShownPool } from "../src/ui/lovejoin-pools";

const seam = vi.hoisted(() => {
  /** A useState seeded: right after a run of states starting as `after`, or the first starting as `initial`. */
  type Seed = { after: unknown[]; initial?: unknown; value: unknown; used?: true; set?: (value: unknown) => void };
  const state = {
    seeds: [] as Seed[],
    /** Every useState's initial value, in the order called. */
    initials: [] as unknown[],
    /** Done once, inside the render that makes the first element of component `name`: with its props. */
    ons: [] as Array<{ name: string; act: (props: Record<string, unknown>) => void; done?: true }>,

    /** The seed a useState starting as `initial` is, if it's one. */
    seeded(initial: unknown): Seed | undefined {
      const before = state.initials;
      state.initials = [...before, initial];
      for (const seed of state.seeds) {
        if (seed.used || before.length < seed.after.length) continue;
        const run = before.slice(before.length - seed.after.length);
        if (!seed.after.every((want, i) => Object.is(run[i], want))) continue;
        if ("initial" in seed) {
          if (!Object.is(initial, seed.initial)) continue;
        } else if (initial !== undefined) {
          // A seed after a run lands on a state that starts empty: anything else is a state added or moved, said loudly.
          throw new Error(`a seed after ${JSON.stringify(seed.after)} met a state starting ${JSON.stringify(initial)}`);
        }
        seed.used = true;
        return seed;
      }
      return undefined;
    },

    /** The JSX runtime's element factories, with `on` in them. */
    runtime<R extends Record<string, unknown>>(runtime: R): R {
      const wrap =
        (create: (...args: unknown[]) => unknown) =>
        (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
          const name = typeof type === "function" ? type.name : "";
          for (const on of state.ons) {
            if (on.done || on.name !== name) continue;
            on.done = true;
            on.act(props ?? {});
          }
          return create(type, props, ...rest);
        };
      const out: Record<string, unknown> = { ...runtime };
      for (const key of ["jsx", "jsxs", "jsxDEV"]) if (typeof runtime[key] === "function") out[key] = wrap(runtime[key] as (...args: unknown[]) => unknown);
      return out as R;
    },

    reset() {
      state.seeds = [];
      state.initials = [];
      state.ons = [];
    },
  };
  return state;
});

vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useState: (initial?: unknown) => {
      const seed = seam.seeded(initial);
      const pair = react.useState(seed ? seed.value : initial);
      if (seed) seed.set = pair[1] as (value: unknown) => void;
      return pair;
    },
  };
});
vi.mock("react/jsx-runtime", async (original) => seam.runtime(await original<Record<string, unknown>>()));
vi.mock("react/jsx-dev-runtime", async (original) => seam.runtime(await original<Record<string, unknown>>()));
vi.mock("../src/ui/background", async (original) => ({
  ...(await original<typeof import("../src/ui/background")>()),
  call: () => new Promise(() => undefined),
}));

const { t } = await import("../src/i18n");
const { i18n } = await import("../src/i18n/core");
const { CHAIN_CUT } = await import("../src/background/lovejoin");
const { DEFAULT_PREFERENCES } = await import("../src/shared/preferences");
const { BringAllBack } = await import("../src/ui/components/BringAllBack");
const { LovejoinSwitch } = await import("../src/ui/components/LovejoinReturn");
const { formatAda } = await import("../src/ui/format");
const { groupPools } = await import("../src/ui/lovejoin-pools");
const { NetworkContext } = await import("../src/ui/network");
const { PreferencesContext } = await import("../src/ui/preferences");
const { AgainActions, Chains, keptPage, Lovejoin, PoolGroupList, PoolPage, unusableText } = await import("../src/ui/screens/Lovejoin");
const { withoutStop } = await import("../src/ui/sentence");
const { account, AGREES, HOUR, lovejoinOf, PASSWORD, POOL } = await import("./chain-fixtures");
const { loadTestWasm, testBalances } = await import("./fakes");
const { ADA, ADA_POOL, ADA_ROWS, adaBox, ownDatum } = await import("./v2-pools");

/** Real chains read with the real WebAssembly: seconds each, more on CI. */
const SLOW = { timeout: 180_000 };

afterEach(async () => {
  seam.reset();
  await i18n.changeLanguage("en");
});

/** The useState right after a run of states starting as `after` starts as `value`: a state only a read reaches. */
function seed(after: unknown[], value: unknown) {
  const s = { after, value } as (typeof seam.seeds)[number];
  seam.seeds.push(s);
  return s;
}
/** The first useState starting as `initial` starts as `value`: what was typed. */
function seedInitial(initial: unknown, value: unknown) {
  seam.seeds.push({ after: [], initial, value });
}
/** Once, inside the render that makes the first element of component `name`: `act` with its props. */
function on(name: string, act: (props: Record<string, unknown>) => void) {
  seam.ons.push({ name, act });
}

/** `element` rendered on preprod, its preferences read and the balances shown: the markup. Its states counted afresh. */
function render(element: ReactElement): string {
  seam.initials = [];
  return renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances: false }, loaded: true, set: async () => undefined } },
        element,
      ),
    ),
  );
}

/** What a person reads of markup. */
const words = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();

/** Whether markup has an element with `testId`. */
const has = (markup: string, testId: string) => markup.includes(`data-testid="${testId}"`);
/** Whether markup is the screen whose title is `titleId`: the hub's `lovejoin-title`, a pool page's `lovejoin-pool-title`. */
const screenOf = (markup: string, titleId: string) => markup.includes(`id="${titleId}"`);
/** Whether the button `testId` is there and can be pressed. */
const pressable = (markup: string, testId: string) => new RegExp(`<button(?![^>]*disabled)[^>]*data-testid="${testId}"`).test(markup);
/** Whether the button `testId` is there and off. */
const off = (markup: string, testId: string) => new RegExp(`<button[^>]*disabled=""[^>]*data-testid="${testId}"`).test(markup);
/** The text of the element `testId`. */
const textOf = (markup: string, testId: string) => words(markup.match(new RegExp(`data-testid="${testId}"[^>]*>(.*?)</`))?.[1] ?? "");

const nothing = () => undefined;
const seedelf = { lovelace: "500000000", tokens: [], utxos: 3, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 } };
const box = (i: number, pool?: string) => ({ txHash: `${i}`.padStart(64, "0"), txIndex: 0, ...(pool ? { pool } : {}) });

/** v2's 5 ₳ ADA pool, as status reads it: under its floor of 30, none of the wallet's in it. */
const FIVE = "f5".repeat(28);
const five: LovejoinPoolStatus = { id: FIVE, version: "v2", box: { lovelace: "5000000" }, others: 12, free: 12, floor: 30, boxes: [], lovelace: "0", due: [], notMixed: [], fromPublic: [] };

/** PR #163's token pool as status reads it, on 8131b1d's scripts: retired, under its floor, `boxes` of the wallet's in it. */
const OLD = "0e".repeat(28);
const LJTEST = { policyId: "cc".repeat(28), assetName: "4c4a54455354", quantity: "100" };
const old = (boxes: number, extra: Partial<LovejoinPoolStatus> = {}): LovejoinPoolStatus => ({
  id: OLD,
  box: { lovelace: "2000000", token: LJTEST },
  others: 3,
  free: 3,
  floor: 30,
  boxes: Array.from({ length: boxes }, (_, i) => box(10 + i, OLD)),
  lovelace: String(boxes * 2_000_000),
  ...(boxes ? { token: { ...LJTEST, quantity: String(boxes * 100) } } : {}),
  due: boxes ? [Date.now() + 3_600_000] : [],
  notMixed: [],
  fromPublic: [],
  unusable: { why: "retired" },
  launch: "ee".repeat(32),
  ...extra,
});

/** A v2 token pool of token `n`, 4.5 ₳ and 100 of it a box, past its floor: one that takes boxes. */
const tokenPool = (n: number): LovejoinPoolStatus => {
  const hex = (0xa0 + n).toString(16);
  return {
    id: hex.repeat(28),
    version: "v2",
    box: { lovelace: "4500000", token: { policyId: hex.repeat(28), assetName: "4d494e", quantity: "100" } },
    others: 40,
    free: 40,
    floor: 30,
    boxes: [],
    lovelace: "0",
    due: [],
    notMixed: [],
    fromPublic: [],
  };
};

/** Lovejoin's read as status gives it: the classic pool, retired for good (chunk 44), with `classic` of the wallet's boxes, and `pools`. */
const statusOf = (pools: LovejoinPoolStatus[], classic = 0): LovejoinStatus => ({
  available: true,
  others: 200,
  free: 200,
  floor: 30,
  boxes: Array.from({ length: classic }, (_, i) => box(i)),
  lovelace: String(classic * 10_000_000),
  due: classic ? [Date.now() + 3_600_000] : [],
  notMixed: [],
  fromPublic: [],
  chains: [],
  unusable: { why: "retired" },
  ...(pools.length ? { pools } : {}),
});

/** The classic pool as a page reads it (poolsOf), retired, `boxes` of the wallet's in it. */
const classicPool = (boxes: number, extra: Partial<ShownPool> = {}): ShownPool => {
  const { chains: _chains, available: _available, pools: _pools, ...pool } = statusOf([], boxes);
  return { ...pool, free: 200, box: { lovelace: "10000000" }, ...extra };
};

/** The hub's states before its view (Lovejoin.tsx): reading, updatedAt, busy, error and readFailed, as each starts. */
const BEFORE_VIEW = [false, undefined, false, undefined, false];

/**
 * The hub on preprod with its read `status` in (the state right after its words', useT's 0), what was typed in its
 * search (`query`), and a page open on it (`view`). The read's seed, to change it inside the render as the next read
 * would.
 */
function hubOf(status: LovejoinStatus, { query, view }: { query?: string; view?: object } = {}) {
  const read = seed([0], status);
  if (query !== undefined) seedInitial("", query);
  if (view !== undefined) seed(BEFORE_VIEW, view);
  return { read, markup: () => render(createElement(Lovejoin, { seedelf, onBack: nothing, onPending: nothing })) };
}

/** A pool's page, open on `pool` with every pool its read holds. */
const pageOf = (pool: ShownPool, props: Record<string, unknown> = {}) =>
  createElement(PoolPage, {
    pool,
    pools: [pool],
    seedelf,
    reading: false,
    readFailed: false,
    mixingAgain: false,
    sending: null,
    onSendingPublic: nothing,
    onSending: nothing,
    onRefresh: async () => undefined,
    onBack: nothing,
    onPending: nothing,
    ...props,
  } as never);

// ---------------------------------------------------------------------------
// W1: a swap's boxes are the 5 ₳ pool's
// ---------------------------------------------------------------------------

describe("a swap's boxes, the 5 ₳ pool's on its approval and in Stop's dialog (1.8.0's release review, W1)", () => {
  // Since chunk 44 a swap's spare ADA, and an ADA swap's proceeds, go into v2's 5 ₳ pool (sessions.ts priced, the
  // owner's call 4 of 2026-11-05): its review's row, its stop line and Stop's dialog said "boxes of 10 ₳", twice what
  // each holds. screens.test.ts holds the English as the frames render it; here, each language's every form.
  const KEYS = ["swaps.cost.boxesLabel", "swaps.boxes.atMost", "swaps.boxes.roomFor"];

  it.each(["en", "es", "ja"])("in %s, says 5 ₳ in every form of each, never 10 ₳", (language) => {
    const values = JSON.parse(readFileSync(new URL(`../src/i18n/translations/${language}.json`, import.meta.url), "utf8")) as Record<string, string>;
    for (const key of KEYS) {
      const forms = Object.keys(values).filter((k) => k === key || k.startsWith(`${key}_`));
      expect(forms.length, key).toBeGreaterThan(0);
      for (const form of forms) {
        expect(values[form], form).toContain("5 ₳");
        expect(values[form], form).not.toContain("10 ₳");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// W3 with W4: the retired reason, its last sentence left out
// ---------------------------------------------------------------------------

describe("the retired reason, which says what a retired pool is and nothing of when its boxes come back (1.8.0's release review, W3 with W4)", () => {
  // Its first sentence, word for word as 1.8.0 had it: true wherever it's shown, a pool's page and row, a 1.7 mix
  // session's card (W3), and a stuck retired token pool's page (W4). The second ("Your boxes in it come back by
  // themselves") named nothing on the card, and was false beside the stuck callout, whose boxes wait for the fees.
  const FIRST: Record<string, string> = {
    en: "This pool runs Lovejoin's retired scripts: the wallet puts no new box in it, and mixes none again.",
    es: "Este pool usa los scripts retirados de Lovejoin: la billetera no pone cajas nuevas en él ni vuelve a mezclar ninguna.",
    ja: "このプールは Lovejoin の廃止済みのスクリプトで動いています。ウォレットは新しいボックスを入れず、ここにあるボックスを再ミックスもしません。",
  };

  it.each(["en", "es", "ja"])("in %s, is its first sentence alone", async (language) => {
    await i18n.changeLanguage(language);
    expect(t("lj.unusable.warn.retired")).toBe(FIRST[language]);
  });

  it("on a stuck retired token pool's page and row, leaves the way back to the stuck callout", () => {
    const stuck = old(1, { cantComeBack: { has: "1589324", needs: "1723200" } });
    const page = words(render(pageOf(stuck)));
    expect(page).toContain(words(t("lovejoin.stuck.warn.lead", { has: formatAda("1589324"), needs: formatAda("1723200") })));
    expect(page).toContain(words(t("lj.unusable.warn.retired")));
    expect(page).not.toContain("Your boxes in it come back by themselves");
    const row = words(render(createElement(PoolGroupList, { group: groupPools([stuck], [])[0]!, onOpen: nothing })));
    expect(row).toContain(words(t("lovejoin.pools.warn.stuck")));
    expect(row).toContain(words(t("lj.unusable.warn.retired")));
    expect(row).not.toContain("come back by themselves");
  });
});

// ---------------------------------------------------------------------------
// W8: a 1.7 chain stopped partway in a retired pool
// ---------------------------------------------------------------------------

describe("a chain stopped partway in a retired pool, which nothing mixes again (1.8.0's release review, W8)", () => {
  const why = "The wallet locked, or the browser closed, while its chain was being sent.";
  const stopped: LovejoinChainView = { session: 0, boxes: 2, total: 3, sent: 1, at: 1, stopped: why };

  it("says why it stopped alone, never that Mix my boxes again mixes the boxes it didn't", () => {
    const row = words(render(createElement(Chains, { chains: [{ ...stopped, retired: true }] })));
    expect(row).toContain(words(t("lovejoin.detail.whyStopped", { why: withoutStop(why) })));
    expect(row).not.toContain("Mix my boxes again");
    // Anywhere else, as before: Mix my boxes again takes the boxes it didn't mix.
    expect(words(render(createElement(Chains, { chains: [stopped] })))).toContain(words(t("lovejoin.chains.whyStopped", { why: withoutStop(why) })));
  });

  it(
    "is marked by the worker where every pool the chain put boxes in is retired, never where one is v2's",
    SLOW,
    async () => {
      // PR #163's token pool, on 8131b1d's scripts: retired, read beside v2's 5 ₳ pool.
      const found = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/lovejoin-token-pool-preprod.json", import.meta.url), "utf8")) as {
        seed: PoolRef["seed"];
        reference: PoolRef["reference"];
        scripts: PoolRef["scripts"];
      };
      const oldPool: PoolRef = { reference: found.reference, seed: found.seed, scripts: found.scripts };
      const oldId = (JSON.parse(loadTestWasm().lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: oldPool }))) as { id: string }).id;
      for (const [what, pool, retired] of [
        ["the classic pool", undefined, true],
        ["an 8131b1d token pool", oldId, true],
        ["v2's 5 ₳ pool", ADA, undefined],
      ] as const) {
        const w = testBalances();
        await w.wallet.create(account(12).phrase, PASSWORD);
        w.koios.evaluation = AGREES;
        const lj = lovejoinOf(w, { pools: async () => [ADA_POOL, oldPool] });
        const at = w.clock.now - 2 * HOUR;
        const [D, A, B] = ["d1", "a1", "b1"].map((h) => h.repeat(32)) as [string, string, string];
        const leaf = (txHash: string) => ({ txHash, txIndex: 0, ...(pool ? { pool } : {}) });
        // As 1.7.2 recorded a chain the update cut after its deposit, its boxes the deposit's: in the classic pool, no
        // pool on its leaves and no `pools`; in a token pool, its own. In v2's 5 ₳ pool, as 1.8.0 records one there.
        const chain = {
          id: B,
          progress: "seedelf.lovejoin.sending.preprod",
          deposit: D,
          mixes: [A, B],
          leaves: [leaf(A), leaf(B)],
          boxes: 2,
          ...(pool ? { pools: { [pool]: 2 } } : {}),
          total: 3,
          sent: 1,
          at,
          scheduled: true,
          stopped: CHAIN_CUT(),
          cut: true,
          ended: at,
        };
        await w.store.set("lovejoin.preprod", { due: [], chains: [chain] });
        // The chains read again, from the device alone, as the page asks every few seconds while one is sent.
        expect((await lj.chains("preprod")).map((c) => c.retired), what).toEqual([retired]);
        // And the pool read: its boxes where the chain left them, in the classic pool or v2's.
        if (pool === oldId) continue;
        const mine = async (index: number) =>
          pool
            ? adaBox(D, await ownDatum(w.wallet), w.clock.now, 2, index)
            : { ...POOL[0]!, tx_hash: D, tx_index: index, block_time: Math.floor(at / 1000), inline_datum: { bytes: await ownDatum(w.wallet), value: {} } };
        w.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, await mine(0), await mine(1));
        expect((await lj.status("preprod")).chains.map((c) => c.retired), what).toEqual([retired]);
      }
    },
  );

  it(
    "leaves a chain in a pool the read set lacks undecided, said as before, where discovery's record can't be read (r2-tests#3)",
    SLOW,
    async () => {
      // As sw.ts wires discovery (serviceDeps), the quiet read set asks `known` and the loud one `pools`, and both read
      // its kept record: where that can't be read, both fail, and a worker that read no pool yet falls back to nothing
      // (readSet's `kept`). v2's 5 ₳ pool is then undecided, as retiredIds leaves it (R3), never counted retired. The
      // row's words, not a way out: Mix my boxes again is refused there until a read lists the pool (1.8.0's review of
      // its fixes, r2-tests#3).
      const w = testBalances();
      await w.wallet.create(account(12).phrase, PASSWORD);
      w.koios.evaluation = AGREES;
      const unread = async (): Promise<never> => {
        throw new Error("discovery's kept record can't be read");
      };
      const lj = lovejoinOf(w, { pools: unread, known: unread });
      const at = w.clock.now - 2 * HOUR;
      const [D, A, B] = ["d1", "a1", "b1"].map((h) => h.repeat(32)) as [string, string, string];
      const leaf = (txHash: string) => ({ txHash, txIndex: 0, pool: ADA });
      const chain = {
        id: B,
        progress: "seedelf.lovejoin.sending.preprod",
        deposit: D,
        mixes: [A, B],
        leaves: [leaf(A), leaf(B)],
        boxes: 2,
        pools: { [ADA]: 2 },
        total: 3,
        sent: 1,
        at,
        scheduled: true,
        stopped: CHAIN_CUT(),
        cut: true,
        ended: at,
      };
      await w.store.set("lovejoin.preprod", { due: [], chains: [chain] });
      // The page's poll of its chains, which reads the set quietly.
      expect((await lj.chains("preprod")).map((c) => c.retired)).toEqual([undefined]);
      // And its read, which lists no v2 pool then.
      w.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, adaBox(D, await ownDatum(w.wallet), w.clock.now, 2, 0), adaBox(D, await ownDatum(w.wallet), w.clock.now, 2, 1));
      const status = await lj.status("preprod");
      expect((status.pools ?? []).map((p) => p.id)).not.toContain(ADA);
      expect(status.chains.map((c) => c.retired)).toEqual([undefined]);
      await expect(lj.againBoxes("preprod", false, ADA)).rejects.toThrow(t("lj.poolUnknown"));
    },
  );
});

// ---------------------------------------------------------------------------
// W9: no other account to switch to where mixing again is refused
// ---------------------------------------------------------------------------

describe("a retired pool's page sends nobody to another account to mix their boxes again (1.8.0's release review, W9)", () => {
  // Account 2's mix put the boxes in: in a v2 pool its Mix again from my public account takes them, so the page names
  // it; in a retired pool that's refused too, and so is the advice.
  const theirs = [box(1), box(2)];
  const accountTwo = { boxes: theirs, fromPublic: theirs, otherAccounts: theirs.map((b) => ({ ...b, account: 1 })) };
  const again = (pool: ShownPool) =>
    render(
      createElement(AgainActions, {
        pool,
        busy: false,
        mixingAgain: false,
        publicSending: false,
        onAgain: nothing,
        onAgainPublic: nothing,
        onNow: nothing,
        onAnyway: nothing,
      }),
    );

  it("names the account only where Mix again isn't refused", () => {
    const retired = again(classicPool(0, accountTwo));
    expect(has(retired, "lovejoin-other-account")).toBe(false);
    // Its reason is said under the buttons, and Bring one back now stays.
    expect(textOf(retired, "lovejoin-again-why")).toBe(words(t("lj.unusable.warn.retired")));
    expect(pressable(retired, "lovejoin-now")).toBe(true);
    // Below the network's minimum, mixing again is refused there too.
    expect(has(again({ ...tokenPool(1), ...accountTwo, unusable: { why: "belowMinimum" } }), "lovejoin-other-account")).toBe(false);
    // In a v2 pool, as before.
    expect(has(again({ ...tokenPool(1), ...accountTwo }), "lovejoin-other-account")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S1, O6, screens#10 and words#10: the hub's list of pools
// ---------------------------------------------------------------------------

describe("the hub's search, only while its box shows (1.8.0's release review, S1)", () => {
  // Five token groups beside ADA's: enough for the search (SEARCH_FROM).
  const TOKENS = [1, 2, 3, 4, 5].map(tokenPool);

  it("lists every pool once its search went with the groups it searched, whatever was typed then", () => {
    // "MIN", typed while retired token pools' groups showed the search; the first unlock's bring-back emptied them, and
    // they left the hub with their boxes. One group is left, v2's 5 ₳ pool's.
    const page = hubOf(statusOf([five]), { query: "MIN" }).markup();
    expect(has(page, "lovejoin-pools-search")).toBe(false);
    expect(has(page, `lovejoin-pool-${FIVE}`)).toBe(true);
    expect(words(page)).not.toContain(words(t("lovejoin.pools.noneMatch", { query: "MIN" })));
  });

  it("searches while it shows, and says nothing matched in what was typed", () => {
    const page = hubOf(statusOf([five, ...TOKENS]), { query: "zzzz" }).markup();
    expect(has(page, "lovejoin-pools-search")).toBe(true);
    expect(has(page, "lovejoin-pool-grid")).toBe(false);
    expect(textOf(page, "lovejoin-pools-none")).toBe(words(t("lovejoin.pools.noneMatch", { query: "zzzz" })));
  });
});

describe("the hub's aside and its line for no pool to mix in, by the pools that take boxes (1.8.0's release review, O6)", () => {
  const aside = (markup: string) => words(markup.match(/<p class="screen__aside">(.*?)<\/p>/)?.[1] ?? "");

  it("names tokens in its aside only where a token pool takes boxes", () => {
    // v2's 5 ₳ pool alone: a mixer for ADA, in 5 ₳ boxes, which it is.
    expect(aside(hubOf(statusOf([five])).markup())).toBe(words(t("lovejoin.aside")));
    // A retired token pool, listed for the wallet's boxes in it, takes none.
    expect(aside(hubOf(statusOf([five, old(2)])).markup())).toBe(words(t("lovejoin.aside")));
    // A v2 token pool does.
    expect(aside(hubOf(statusOf([five, tokenPool(1)])).markup())).toBe(words(t("lovejoin.asideTokens")));
  });

  it("says there's no pool to mix in yet where every pool listed is retired, under the rows for the wallet's boxes", () => {
    for (const [what, status] of [
      ["the classic pool's boxes", statusOf([], 2)],
      ["and a retired token pool's", statusOf([old(2)], 2)],
    ] as const) {
      const page = hubOf(status).markup();
      expect(has(page, "lovejoin-pool-classic") || has(page, "lovejoin-pool-grid"), what).toBe(true);
      expect(textOf(page, "lovejoin-pools-none"), what).toBe(words(t("lovejoin.pools.noneYet")));
    }
    // A pool listed that takes boxes, even under its floor: none of it.
    expect(has(hubOf(statusOf([five], 2)).markup(), "lovejoin-pools-none")).toBe(false);
  });

  it("with nothing listed and nothing typed, says there's no pool to mix in yet, never that no token matched “” (screens#10, words#10)", () => {
    const page = hubOf(statusOf([])).markup();
    expect(textOf(page, "lovejoin-pools-none")).toBe(words(t("lovejoin.pools.noneYet")));
    expect(words(page)).not.toContain(words(t("lovejoin.pools.noneMatch", { query: "" })));
  });

  it("keeps Start a pool's note on what it costs to a wallet that reads no pool but the classic one, as before", () => {
    // The critical note's gate is any pool read with an id (o-design's step 7): not the aside's.
    expect(has(hubOf(statusOf([])).markup(), "lovejoin.start.warn.cost")).toBe(true);
    expect(has(hubOf(statusOf([five])).markup(), "lovejoin.start.warn.cost")).toBe(false);
  });

  it("counts a pool below the network's minimum as taking no box, as a retired pool or a copy (r2-screens#3)", () => {
    // A v2 token pool whose box holds less ADA than today's parameters ask: the wallet puts no new box there
    // (lj.unusable.warn.belowMinimum), so it names no tokens, and there's no pool to mix in yet, alone or beside the
    // classic pool's boxes (1.8.0's review of its fixes, r2-screens#3).
    const below: LovejoinPoolStatus = { ...tokenPool(1), unusable: { why: "belowMinimum" } };
    for (const [what, status] of [
      ["alone", statusOf([below])],
      ["beside the classic pool's boxes", statusOf([below], 2)],
    ] as const) {
      const page = hubOf(status).markup();
      expect(has(page, `lovejoin-pool-${below.id}`) || has(page, "lovejoin-pool-grid"), what).toBe(true);
      expect(aside(page), what).toBe(words(t("lovejoin.aside")));
      expect(textOf(page, "lovejoin-pools-none"), what).toBe(words(t("lovejoin.pools.noneYet")));
    }
  });

  it("says its ADA is mixed in 5 ₳ boxes only where every ADA pool that takes boxes holds 5 ₳, or none does (r2-screens#4)", () => {
    // Anyone can start a v2 ADA pool at any box value but 10 ₳, and the hub lists the earliest of each: one of 20 ₳,
    // alone or beside v2's 5 ₳ pool, makes it a mixer for ADA of no one box value (1.8.0's review of its fixes,
    // r2-screens#4).
    const twenty: LovejoinPoolStatus = { ...five, id: "20".repeat(28), box: { lovelace: "20000000" }, others: 40, free: 40 };
    expect(aside(hubOf(statusOf([twenty])).markup())).toBe(words(t("lovejoin.asideAda")));
    expect(aside(hubOf(statusOf([five, twenty])).markup())).toBe(words(t("lovejoin.asideAda")));
    // One that takes no box leaves v2's 5 ₳ pool's words: below the minimum, or a copy.
    expect(aside(hubOf(statusOf([five, { ...twenty, unusable: { why: "belowMinimum" } }])).markup())).toBe(words(t("lovejoin.aside")));
    expect(aside(hubOf(statusOf([five, { ...twenty, unusable: { why: "superseded" } }])).markup())).toBe(words(t("lovejoin.aside")));
    // None that takes boxes: as before, the retired pools' boxes listed or nothing.
    expect(aside(hubOf(statusOf([], 2)).markup())).toBe(words(t("lovejoin.aside")));
    expect(aside(hubOf(statusOf([])).markup())).toBe(words(t("lovejoin.aside")));
    // A token pool that takes boxes names tokens, whatever the ADA pools' boxes hold.
    expect(aside(hubOf(statusOf([twenty, tokenPool(1)])).markup())).toBe(words(t("lovejoin.asideTokens")));
  });
});

// ---------------------------------------------------------------------------
// S2: a pool's page kept once its run of Bring every box back emptied the pool
// ---------------------------------------------------------------------------

describe("a retired token pool's page, kept once its run of Bring every box back emptied it (1.8.0's release review, S2)", () => {
  // The worker lists a retired token pool only while the wallet has something there (lovejoin.ts listedHere): the
  // read after the run that emptied it no longer had it, and the hub replaced its page, "Done: 1 back in your private
  // balance." with it, after one read.
  const emptied = { boxes: [], lovelace: "0", due: [], notMixed: [], fromPublic: [] };

  it("keeps the pool as its page last read it, with nothing of the wallet's in it, where the read after the run lists it no more", () => {
    const last = old(1, { otherAccounts: [{ ...box(10, OLD), account: 1 }], bootstrap: [box(10, OLD)] });
    const kept = keptPage([classicPool(0)], { pool: OLD, ended: last })!;
    expect(kept).toMatchObject({ ...emptied, id: OLD, box: last.box, others: 3, unusable: { why: "retired" }, launch: last.launch });
    for (const field of ["token", "otherAccounts", "bootstrap", "unsure", "deposits"]) expect(kept, field).not.toHaveProperty(field);
    // Still listed: the read's, whatever its page last read.
    const listed = old(0);
    expect(keptPage([classicPool(0), listed], { pool: OLD, ended: last })).toBe(listed);
    // No run ended there, or another pool's did: the hub, as before.
    expect(keptPage([classicPool(0)], { pool: OLD })).toBeUndefined();
    expect(keptPage([classicPool(0)], { pool: OLD, ended: { ...last, id: "11".repeat(28) } })).toBeUndefined();
  });

  it("tells the hub when its run ended, and reads the pool again", () => {
    let over: (() => void) | undefined;
    on("BringAllBack", (props) => {
      over = props.onOver as () => void;
    });
    const onRunOver = vi.fn();
    const onRefresh = vi.fn(async () => undefined);
    render(pageOf(old(1), { onRunOver, onRefresh }));
    over!();
    expect(onRunOver).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("stays that pool's page on the hub, its Done with it, when the read after the run lists it no more", () => {
    const { read, markup } = hubOf(statusOf([five, old(1)]), { view: { pool: OLD } });
    // Its run ends on the page, and the read after it has the pool no more.
    on("PoolPage", (props) => {
      (props.onRunOver as (() => void) | undefined)?.();
      read.set!(statusOf([five]));
    });
    let bring: Record<string, unknown> | undefined;
    on("BringAllBack", (props) => (bring = props));
    const page = markup();
    expect(screenOf(page, "lovejoin-pool-title")).toBe(true);
    expect(screenOf(page, "lovejoin-title")).toBe(false);
    // Nothing of the wallet's is left there: no box to bring back now.
    expect(words(page)).toContain(`${words(t("lovejoin.row.yours"))} ${words(t("lovejoin.row.none"))}`);
    expect(has(page, "lovejoin-now")).toBe(false);
    // Its Bring every box back is still made, for that pool: what it holds (its Done) stays with it.
    expect(bring?.pool).toBe(OLD);
  });
});

// ---------------------------------------------------------------------------
// screens#8 and tests-e2e#2's unit half: a retired pool's page and row, withdraw-only
// ---------------------------------------------------------------------------

describe("a retired pool's page and row, withdraw-only (1.8.0's release review, screens#8; tests-e2e#2's unit half)", () => {
  // Every 1.7 wallet with boxes left lands on these (the owner's calls 1 and 2 of 2026-11-05): its boxes come back by
  // Bring one back now, Bring every box in this pool back now and their schedule; nothing deposits or mixes there.
  it("offers Bring one back now and Bring every box back, Mix and Mix again off with its reason, and no Bootstrap: the classic pool's page and a token pool's", () => {
    for (const [what, pool] of [
      ["the classic pool", classicPool(2)],
      ["a retired token pool under its floor", old(2)],
    ] as const) {
      const page = render(pageOf(pool));
      expect(pressable(page, "lovejoin-now"), what).toBe(true);
      expect(has(page, "lovejoin-bring-ask"), what).toBe(true);
      expect(off(page, "lovejoin-mix"), what).toBe(true);
      expect(textOf(page, "lovejoin-mix-why"), what).toBe(words(t("lj.unusable.warn.retired")));
      expect(off(page, "lovejoin-again"), what).toBe(true);
      expect(textOf(page, "lovejoin-again-why"), what).toBe(words(t("lj.unusable.warn.retired")));
      for (const bootstrap of ["lovejoin-bootstrap-lead", "lovejoin-bootstrap-open", "lovejoin-bootstrap-offer", "lovejoin-bootstrap"]) {
        expect(has(page, bootstrap), `${what}: ${bootstrap}`).toBe(false);
      }
    }
  });

  it("brings a box not mixed yet back anyway from its callout, beside Bring one back now for the rest", () => {
    const page = render(pageOf(old(2, { notMixed: [box(10, OLD)] })));
    expect(pressable(page, "lovejoin-anyway")).toBe(true);
    expect(pressable(page, "lovejoin-now")).toBe(true);
    expect(words(page)).not.toContain(words(t("lovejoin.warn.notMixed.takes.private", { count: 1 })));
  });

  it("keeps its launch link private, and its Bring every box back follows the retired pools' run", () => {
    const props: Record<string, Record<string, unknown>> = {};
    on("ExplorerLink", (p) => (props.link = p));
    on("BringAllBack", (p) => (props.bring = p));
    render(pageOf(old(2)));
    expect(props.link?.private).toBe(true);
    expect(props.bring?.retired).toBe(true);
    // A v2 pool's page follows its own run and every pool's, never the retired pools'.
    on("BringAllBack", (p) => (props.v2 = p));
    render(pageOf(tokenPool(1)));
    expect(props.v2?.retired).toBe(false);
  });

  it("lists it on the hub with its reason, never as being started", () => {
    const row = render(createElement(PoolGroupList, { group: groupPools([old(2)], [])[0]!, onOpen: nothing }));
    expect(textOf(row, "lovejoin-pool-unusable")).toBe(words(t("lj.unusable.warn.retired")));
    expect(words(row)).not.toContain(words(t("lovejoin.pools.starting", { have: 3, floor: 30 })));
    expect(row).not.toContain('class="meter"');
    expect(unusableText({ why: "retired" })).toBe(t("lj.unusable.warn.retired"));
  });
});

// ---------------------------------------------------------------------------
// r2-tests#1 with r2-screens#0, and r2-screens#5: Bring every box back, in Settings and on a v2 pool's page
// ---------------------------------------------------------------------------

describe("Bring every box back's question, which names what its press asks (1.8.0's review of its fixes, r2-tests#1, r2-screens#0)", () => {
  // Settings' Try again on the retired pools' run, stopped by itself, asks that run again (bringAsk), and its question
  // names the retired pools (the retire lane's For the lead, 3). Only a press opens it, so it's seeded: BringAllBack's
  // first state, the run as a read of lovejoin-held found it (LovejoinHeld's `bringing`, which has no `at`), and its
  // first starting false, the press's `asking`. Read off the run as shown, or off no run, the title names the wrong boxes.
  const why = "giveme.my refused to witness it";
  /** Its question, open in Settings (no `pool`) or on a retired pool's page: the title it asks. */
  const question = (bringing: unknown, pool?: string) => {
    seam.reset();
    seed([], bringing);
    seedInitial(false, true);
    const markup = render(createElement(BringAllBack, { network: "preprod", ...(pool ? { pool, retired: true } : {}) }));
    return words(/id="lovejoin-bring-title"[^>]*>(.*?)<\/h2>/.exec(markup)?.[1] ?? "(no question)");
  };

  it("names the retired pools on Try again of their stopped run, and every box wherever the press asks every pool's", () => {
    expect(question({ back: 2, retired: true, stopped: why })).toBe(words(t("settings.lovejoin.bringRetiredTitle")));
    // Every pool's stopped; the first press; and a press while the retired pools' run goes, which widens it to every
    // pool's (bringAsk gives {}), the v2 pools' boxes coming back too.
    expect(question({ back: 2, stopped: why })).toBe(words(t("settings.lovejoin.bringTitle")));
    expect(question(undefined)).toBe(words(t("settings.lovejoin.bringTitle")));
    expect(question({ back: 1, left: 3, retired: true })).toBe(words(t("settings.lovejoin.bringTitle")));
    // A retired pool's page asks of its own boxes, the retired pools' run stopped or not.
    expect(question({ back: 2, retired: true, stopped: why }, "classic")).toBe(words(t("lovejoin.bring.title")));
  });
});

describe("a v2 pool's page while the retired pools' run goes (1.8.0's review of its fixes, r2-screens#5)", () => {
  // The retired pools' run, asked at the first unlock or again from Settings, covers no v2 pool's page, which can't join
  // it: its line said "Another pool's boxes are coming back now. Stop that first…", of several pools, which the owner
  // wants back right away (call 3).
  /** Bring every box back on `pool`'s page, the wallet's boxes there, the run `bringing` as a read found it. */
  const page = (bringing: unknown, pool: string, retired = false) => {
    seam.reset();
    seed([], bringing);
    return render(createElement(BringAllBack, { network: "preprod", pool, retired, shown: true }));
  };

  it("says the retired pools' boxes are coming back, never another pool's, and asks nobody to stop them", () => {
    const v2 = page({ back: 1, left: 2, retired: true }, FIVE);
    expect(textOf(v2, "lovejoin-bring-other")).toBe(words(t("lovejoin.bring.otherRetired")));
    expect(words(v2)).not.toContain(words(t("lovejoin.bring.other")));
    // Its link stays off meanwhile, as the worker refuses its run then.
    expect(off(v2, "lovejoin-bring-ask")).toBe(true);
    // Another pool's run, as before.
    const other = page({ back: 1, left: 2, pool: OLD }, FIVE);
    expect(textOf(other, "lovejoin-bring-other")).toBe(words(t("lovejoin.bring.other")));
    expect(off(other, "lovejoin-bring-ask")).toBe(true);
    // A retired pool's page follows the retired pools' run itself (W2): no such line.
    const retired = page({ back: 1, left: 2, retired: true }, OLD, true);
    expect(has(retired, "lovejoin-bring-other")).toBe(false);
    expect(has(retired, "lovejoin-bringing")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// screens#9 (and adapool#5's third): a return's switch, its spare ADA through v2's 5 ₳ pool
// ---------------------------------------------------------------------------

describe("a return's switch, its spare ADA through v2's 5 ₳ pool (1.8.0's release review, screens#9; adapool#5, 3)", () => {
  // A return's ADA goes into the 5 ₳ pool, named by its id (chunk 44): its box, the summary's values say, holds no
  // token. A return whose boxes are all a token pool's mixes no spare ADA, and says its tokens go into their pools.
  const TOKEN = tokenPool(1);
  const values = { [FIVE]: { lovelace: "5000000" }, [TOKEN.id]: TOKEN.box };
  const said = (lovejoin: Record<string, unknown>) =>
    words(
      render(
        createElement(LovejoinSwitch, {
          back: { lovejoin: { boxes: 2, depth: 2, mixes: 8, fees: "8000000", txs: 10, delay: "1-6", entry: "ab".repeat(32), ...lovejoin } } as never,
          through: true,
          busy: false,
          onThrough: nothing,
        }),
      ),
    );

  it("says its spare ADA is mixed where the 5 ₳ pool takes boxes, alone or beside a token's pool", () => {
    expect(said({ pool: FIVE, values })).toContain(t("swaps.lovejoin.privacy.on"));
    expect(said({ parts: [{ pool: FIVE, boxes: 2 }, { pool: TOKEN.id, boxes: 1 }], values })).toContain(t("swaps.lovejoin.privacy.on"));
    // A 1.7 return's, into the classic pool, named by none: as it said.
    expect(said({})).toContain(t("swaps.lovejoin.privacy.on"));
  });

  it("says its tokens go into their pools where only a token's pool takes boxes", () => {
    expect(said({ parts: [{ pool: TOKEN.id, boxes: 1 }], values })).toContain(t("swaps.lovejoin.privacy.onTokens"));
    expect(said({ parts: [{ pool: FIVE, boxes: 0 }, { pool: TOKEN.id, boxes: 1 }], values })).toContain(t("swaps.lovejoin.privacy.onTokens"));
    expect(said({ parts: [{ pool: TOKEN.id, boxes: 1 }], values })).not.toContain(t("swaps.lovejoin.privacy.on"));
  });
});
