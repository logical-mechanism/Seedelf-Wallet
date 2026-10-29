// 1.6.0's review of the fixes, R3-20 (and the rest of R3-1): screen fixes proven only through the rules they were
// extracted into. Each rule had its test, but the line that makes the screen use it had none, since Vitest has no DOM:
// each could be reverted with every test green. Here the screens run for real, their wiring with them, over the house's
// `vi.mock("react")` seam, with no new dependency:
// - the effects of the component under test run during renderToStaticMarkup, as React would run them after its render,
//   each again only when its dependencies change; a child's, or a hook's, never do;
// - the worker answers at once (`call` hands back a synchronous thenable), so what an effect asks lands in the page's
//   state in the same render, as React's render-phase updates take it;
// - what a person does on the open page (a press, a timer's tick, a late answer) runs inside the render of the
//   component that holds its state, when the element it acts on is made (`on`);
// - a state only an awaited answer reaches (a review built) starts from a seed in its useState (`seed`).
// What a press does after an await doesn't run here: it's the rules' tests' (widthTurned, bringFollower, lookAgain).
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => {
  /** A thenable that answers at once, as `call` does here: an effect's `.then` lands in the same render. */
  interface Answer {
    then(ok?: ((value: unknown) => unknown) | null, no?: ((error: unknown) => unknown) | null): Answer;
    catch(no: (error: unknown) => unknown): Answer;
    finally(done: () => void): Answer;
  }
  const isAnswer = (v: unknown): v is Answer => !!v && typeof (v as Answer).then === "function";
  const lift = (v: unknown): Answer => (isAnswer(v) ? v : settled(v));
  function settled(value: unknown): Answer {
    return {
      then: (ok) => {
        try {
          return ok ? lift(ok(value)) : settled(value);
        } catch (e) {
          return failed(e);
        }
      },
      catch: () => settled(value),
      finally: (done) => {
        done();
        return settled(value);
      },
    };
  }
  function failed(error: unknown): Answer {
    return {
      then: (_ok, no) => {
        try {
          return no ? lift(no(error)) : failed(error);
        } catch (e) {
          return failed(e);
        }
      },
      catch: (no) => {
        try {
          return lift(no(error));
        } catch (e) {
          return failed(e);
        }
      },
      finally: (done) => {
        done();
        return failed(error);
      },
    };
  }
  /** Never answers: a request the page makes that the test leaves unanswered. */
  const pending: Answer = { then: () => pending, catch: () => pending, finally: () => pending };
  /** Answers when the test says (`resolve`), inside the render it's said in: a read that comes back late. */
  function late() {
    const waiting: Array<(value: unknown) => unknown> = [];
    const answer: Answer = {
      then: (ok) => {
        if (ok) waiting.push(ok);
        return pending;
      },
      catch: () => pending,
      finally: () => pending,
    };
    return { answer, resolve: (value: unknown) => waiting.splice(0).forEach((ok) => ok(value)) };
  }

  /** Whether a useState's initial value is `want`: a predicate, an empty object for `{}`, or the same value. */
  const matches = (initial: unknown, want: unknown) =>
    typeof want === "function"
      ? (want as (v: unknown) => boolean)(initial)
      : want && typeof want === "object" && !Object.keys(want).length
        ? !!initial && typeof initial === "object" && !Array.isArray(initial) && !Object.keys(initial).length
        : Object.is(initial, want);

  const state = {
    /** The components whose effects run, by name: theirs alone, never a child's or a custom hook's. */
    effects: new Set<string>(),
    /** What the worker answers, by request: a function of the payload, its value or an Answer. */
    answers: new Map<string, (payload: unknown) => unknown>(),
    /** Every request made, in order. */
    asked: [] as Array<{ type: string; payload: unknown }>,
    /**
     * A useState seeded: the call right after a run of calls whose initial values match `after`, in order, and whose
     * own initial value matches `initial` (or starts empty, where none is given).
     */
    seeds: [] as Array<{ after: unknown[]; initial?: unknown; value: unknown; used?: true }>,
    /** Every useState's initial value, in the order called. */
    initials: [] as unknown[],
    /** Done once, inside the render that makes the first element `match` takes: a press, a tick, a late answer. */
    ons: [] as Array<{
      match: (name: string, props: Record<string, unknown>) => boolean;
      act: (props: Record<string, unknown>, key?: unknown) => void;
      done?: true;
    }>,
    /** Components made as nothing, by name: a review's body, where only its wiring is under test. */
    stubbed: new Set<string>(),
    late,

    /** The worker's answer to `type`, as `call` hands it back. */
    call(type: string, payload: unknown): Answer {
      state.asked.push({ type, payload });
      const answer = state.answers.get(type);
      return answer ? lift(answer(payload)) : pending;
    },

    /** What useState starts with: `initial`, or the seed whose run of initial values precedes this call. */
    seeded(initial: unknown): unknown {
      const before = state.initials;
      state.initials = [...before, initial];
      for (const seed of state.seeds) {
        if (seed.used || before.length < seed.after.length) continue;
        const run = before.slice(before.length - seed.after.length);
        if (!seed.after.every((want, i) => matches(run[i], want))) continue;
        if ("initial" in seed) {
          if (!matches(initial, seed.initial)) continue;
        } else if (initial !== undefined) {
          // A seed after a run lands on a state that starts empty: anything else is a state added or moved, said loudly.
          throw new Error(`a seed after ${JSON.stringify(seed.after)} met a state starting ${JSON.stringify(initial)}`);
        }
        seed.used = true;
        return seed.value;
      }
      return initial;
    },

    /** The JSX runtime's element factories, with `on` and `stubbed` in them. */
    runtime<R extends Record<string, unknown>>(runtime: R): R {
      const named = (type: unknown) => (typeof type === "string" ? type : typeof type === "function" ? type.name : "");
      const Stub = () => null;
      const wrap =
        (create: (...args: unknown[]) => unknown) =>
        (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
          const name = named(type);
          for (const on of state.ons) {
            if (on.done || !on.match(name, props ?? {})) continue;
            on.done = true;
            // With the element's key, where it has one: jsx, jsxs and jsxDEV each take it third.
            on.act(props ?? {}, rest[0]);
          }
          return create(state.stubbed.has(name) ? Stub : type, props, ...rest);
        };
      const out: Record<string, unknown> = { ...runtime };
      for (const key of ["jsx", "jsxs", "jsxDEV"]) if (typeof runtime[key] === "function") out[key] = wrap(runtime[key] as (...args: unknown[]) => unknown);
      return out as R;
    },

    reset() {
      state.effects.clear();
      state.answers.clear();
      state.asked = [];
      state.seeds = [];
      state.initials = [];
      state.ons = [];
      state.stubbed.clear();
    },
  };
  return state;
});

vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  /** Who called the effect: the frame after the seam's own, a component's name, or a hook's. */
  const caller = () => {
    const frames = (new Error().stack ?? "").split("\n");
    const at = frames.findIndex((f) => f.includes("seamEffect"));
    return /at (?:[\w$]+\.)*([\w$]+)/.exec(frames[at + 1] ?? "")?.[1] ?? "";
  };
  /**
   * useEffect and useLayoutEffect, run during the render for the components under test: again only when a dependency
   * changes, the run before cleaned up first, as React does; none on a server render otherwise.
   */
  function seamEffect(run: () => void | (() => void), deps?: readonly unknown[]) {
    const last = react.useRef<readonly unknown[] | null>(null);
    const cleanup = react.useRef<void | (() => void)>(undefined);
    if (!seam.effects.has(caller())) return;
    const was = last.current;
    if (was && (!deps || (deps.length === was.length && deps.every((d, i) => Object.is(d, was[i]))))) return;
    last.current = deps ?? [];
    cleanup.current?.();
    cleanup.current = run();
  }
  return {
    ...react,
    useEffect: seamEffect,
    useLayoutEffect: seamEffect,
    useState: (initial?: unknown) => react.useState(seam.seeded(initial)),
  };
});
vi.mock("react/jsx-runtime", async (original) => seam.runtime(await original<Record<string, unknown>>()));
vi.mock("react/jsx-dev-runtime", async (original) => seam.runtime(await original<Record<string, unknown>>()));
vi.mock("../src/ui/background", async (original) => ({
  ...(await original<typeof import("../src/ui/background")>()),
  call: (type: string, payload: unknown) => seam.call(type, payload),
}));

const { t } = await import("../src/i18n");
const { DEFAULT_PREFERENCES } = await import("../src/shared/preferences");
const { NetworkContext } = await import("../src/ui/network");
const { PreferencesContext } = await import("../src/ui/preferences");
const { AccountsContext } = await import("../src/ui/accounts");
const { Collateral } = await import("../src/ui/screens/Collateral");
const { LockCountdown } = await import("../src/ui/components/LockCountdown");
const { PoolPage } = await import("../src/ui/screens/Lovejoin");
const { BringAllBack } = await import("../src/ui/components/BringAllBack");
const { NewSwap, Session } = await import("../src/ui/screens/Swaps");
const { ConnectRequest } = await import("../src/ui/screens/DappApprovals");
const { SiteSession } = await import("../src/ui/screens/SiteSessions");
const { COLLATERAL_MIX_COST } = await import("../src/ui/components/LovejoinReturn");
const { adaText, formatAda } = await import("../src/ui/format");
const { SESSION_FEE_ESTIMATE, toCents } = await import("../src/ui/swap");
const { TxDetailButton, TxDetailModal } = await import("../src/ui/components/TxDetail");
const { Transfer } = await import("../src/ui/screens/Transfer");
const { Withdraw } = await import("../src/ui/screens/Withdraw");

/** The test's clock, as the fake timers keep it. */
const NOW = Date.UTC(2026, 9, 25, 12);
const TX = "ab".repeat(32);
const noop = () => undefined;

/** The worker answers `type` with `value`, or with what `value` makes of the payload. */
function answer(type: string, value: unknown) {
  seam.answers.set(type, typeof value === "function" ? (value as (payload: unknown) => unknown) : () => value);
}
/** The worker answers `type` with each of `values` in turn, the last again after. */
function answers(type: string, ...values: unknown[]) {
  let i = 0;
  seam.answers.set(type, () => values[Math.min(i++, values.length - 1)]);
}
/** Once, inside the render that makes the first element `match` takes: `act` with its props, and its key. */
function on(
  match: string | ((name: string, props: Record<string, unknown>) => boolean),
  act: (props: Record<string, unknown>, key?: unknown) => void,
) {
  seam.ons.push({ match: typeof match === "string" ? (name) => name === match : match, act });
}
/** The requests made, by name. */
const asked = () => seam.asked.map((a) => a.type);
/** The payloads of the requests made of `type`. */
const payloads = (type: string) => seam.asked.filter((a) => a.type === type).map((a) => a.payload);
/** The useState right after a run of states starting as `after` starts as `value`: a state only an await reaches. */
function seed(after: unknown[], value: unknown) {
  seam.seeds.push({ after, value });
}
/** The first useState starting as `initial` starts as `value` instead: a choice made on the page. */
function seedInitial(initial: unknown, value: unknown) {
  seam.seeds.push({ after: [], initial, value });
}

/** A review's rows (ReviewRows `testId`), as a person reads them: label and value. */
function rows(markup: string, testId: string): Array<[string, string]> {
  const at = markup.indexOf(`data-testid="${testId}"`);
  if (at < 0) return [];
  const list = markup.slice(at, markup.indexOf("</dl>", at));
  return [...list.matchAll(/<dt>(.*?)<\/dt><dd[^>]*>(.*?)<\/dd>/g)].map((m) => [words(m[1]!), words(m[2]!)]);
}
/** Whether markup has an element with `testId`. */
const has = (markup: string, testId: string) => markup.includes(`data-testid="${testId}"`);
/** A row's value by its label, of the rows `testId`. */
const row = (markup: string, testId: string, label: string) => rows(markup, testId).find(([l]) => l === words(label))?.[1];
/** An amount as a row says it. */
const ada = (lovelace: string) => words(adaText(lovelace));

/** `element` rendered on preprod, its preferences read: the markup. */
function render(element: ReactElement, prefs: Partial<typeof DEFAULT_PREFERENCES> = {}): string {
  return renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(PreferencesContext.Provider, { value: { prefs: { ...DEFAULT_PREFERENCES, ...prefs }, loaded: true, set: async () => undefined } }, element),
    ),
  );
}

/** What a person reads of markup. */
const words = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replace(/\s+/g, " ")
    .trim();

beforeEach(() => {
  seam.reset();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"], now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the Collateral page's watch of its payment, wired (1.6.0's review of the fixes, R3-20: 309#0)", () => {
  it("opened in place, from Home or a pool's page, asks only for the status: Home's watch asks about the payment", () => {
    seam.effects.add("Collateral");
    answer("collateral", { state: "waiting", txHash: TX });
    answer("balances", { cardano: { utxos: 2 } });
    answer("pending-tx", { txHash: TX, confirmations: null, submittedAt: NOW - 60_000 });
    render(createElement(Collateral, { onBack: noop, onSent: noop }));
    expect(asked()).toEqual(["collateral", "balances", "collateral"]);
  });

  it("from Settings, which replaces Home, asks about its payment itself, as Home would", () => {
    seam.effects.add("Collateral");
    answer("collateral", { state: "waiting", txHash: TX });
    answer("balances", { cardano: { utxos: 2 } });
    answer("pending-tx", { txHash: TX, confirmations: null, submittedAt: NOW - 60_000 });
    render(createElement(Collateral, { onBack: noop }));
    expect(asked()).toEqual(["collateral", "balances", "pending-tx"]);
  });

  it("pays again from its late payment's button as Set collateral pays, never going back instead (309#1's leftover)", () => {
    seam.effects.add("Collateral");
    answer("collateral", { state: "waiting", txHash: TX, late: true });
    answer("balances", { cardano: { utxos: 2 } });
    const onBack = vi.fn();
    on("WaitingFoot", (props) => (props.onAgain as () => void)());
    const page = render(createElement(Collateral, { onBack, onSent: noop }));
    expect(asked()).toContain("collateral-build");
    expect(onBack).not.toHaveBeenCalled();
    // Building: its button says so, and waits.
    expect(words(page)).toContain(t("common.building"));
  });
});

describe("the lock countdown's line for a payment's parts, wired (1.6.0's review of the fixes, R3-20: gap-3#6)", () => {
  /** What the countdown's effects listen on, with nothing to say. */
  const quiet = () => ({ addEventListener: noop, removeEventListener: noop });

  it("asks whether a payment's parts wait while it shows, and says that locking stops them", () => {
    seam.effects.add("LockCountdown");
    vi.stubGlobal("window", quiet());
    vi.stubGlobal("document", { ...quiet(), visibilityState: "visible", documentElement: { style: { setProperty: noop, removeProperty: noop } } });
    answer("lock-deadline", { at: NOW + 60_000, lockAfterMs: 15 * 60_000 });
    answer("chains-sending", false);
    answer("parts-waiting", true);
    const page = render(createElement(LockCountdown));
    // Asked once the countdown shows, beside whether a chain is being sent: the deadline twice, as its pace changes.
    expect(asked()).toEqual(["lock-deadline", "lock-deadline", "chains-sending", "parts-waiting"]);
    expect(page).toContain('data-parts-waiting="true"');
    expect(page).toContain('data-chain-sending="false"');
    expect(words(page)).toContain(t("lock.warn.partsWaiting"));
    expect(words(page)).not.toContain(t("lock.warn.chainSending"));
  });
});

describe("a pool's Mix form, its collateral's mix and its public side wired (1.6.0's review of the fixes, R3-20)", () => {
  /** The classic pool, as a read has it: room for a box at any depth, none of the wallet's in it. */
  const classic = { box: { lovelace: "10000000" }, others: 41, free: 41, floor: 30, boxes: [], lovelace: "0", due: [], notMixed: [], fromPublic: [] };
  /** The pool of 5 ₳ boxes a collateral's mix goes into, at its floor of other people's boxes, two of them free. */
  const five = { ...classic, id: "18c4df7733af269d30354df99544697dae3311cebacd48d751b89fed", box: { lovelace: "5000000" }, others: 3, free: 3, floor: 2 };
  /** One box two waves deep, as WebAssembly prices it: its 10 ₳, 3.8 ₳ of mixes and the 1.5 ₳ reserve; and the 5 ₳ pool's mix. */
  const funding = { lovelace: "15300000", mixes: 4, mixFees: "3800000", boxes: 1, depth: 2, delay: "1-6", collateralReserve: "1500000", collateralPool: five.id };
  const seedelf = (lovelace: string) => ({ lovelace, tokens: [], utxos: 3, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 } });
  /** The page, opened on the classic pool with every pool its read holds. */
  const pageOf = (props: Record<string, unknown> = {}) =>
    createElement(PoolPage, {
      pool: classic,
      pools: [classic, five],
      seedelf: seedelf("25000000"),
      reading: false,
      readFailed: false,
      mixingAgain: false,
      sending: null,
      onSendingPublic: noop,
      onSending: noop,
      onRefresh: async () => undefined,
      onBack: noop,
      onPending: noop,
      ...props,
    } as never);
  const page = (props: Record<string, unknown> = {}) => render(pageOf(props));

  it("counts its collateral's reserve in the form's figures where this many boxes leave room for it, as the review does (320-screens#2, 323-worker#0, R3-7)", () => {
    seam.effects.add("PoolPage");
    answer("lovejoin-funding", funding);
    const form = page();
    expect(payloads("lovejoin-funding")).toEqual([{ boxes: 1, width: 3 }]);
    // Into the one-time account: the 15.3 ₳ and its 1.5 ₳ reserve; then the 5 ₳ kept aside and the payment's fee.
    expect(row(form, "lovejoin-mix-moves", t("lovejoin.mix.intoOneTime"))).toBe(ada("16800000"));
    expect(row(form, "lovejoin-mix-moves", t("lovejoin.collateralReserve.label"))).toBe(words(t("lovejoin.collateralReserve.value", { ada: formatAda("1500000") })));
    expect(row(form, "lovejoin-mix-moves", t("lovejoin.mix.totalPrivate"))).toBe(ada(toCents(22_050_000n)));
    expect(row(form, "lovejoin-mix-cost", t("lovejoin.collateralMix.label"))).toBeDefined();
    expect(has(form, "lovejoin-collateral-if-left")).toBe(false);
  });

  it("offers the box the balance pays without it, its figures without it and one line saying so, never a refusal (R3-7)", () => {
    seam.effects.add("PoolPage");
    answer("lovejoin-funding", funding);
    // 23 ₳: a box, its 5 ₳ kept aside and the fee's room, but not the reserve too.
    const form = page({ seedelf: seedelf("23000000") });
    expect(row(form, "lovejoin-mix-moves", t("lovejoin.mix.intoOneTime"))).toBe(ada("15300000"));
    expect(row(form, "lovejoin-mix-moves", t("lovejoin.collateralReserve.label"))).toBeUndefined();
    expect(row(form, "lovejoin-mix-moves", t("lovejoin.mix.totalPrivate"))).toBe(ada(toCents(20_550_000n)));
    expect(row(form, "lovejoin-mix-cost", t("lovejoin.collateralMix.label"))).toBeUndefined();
    expect(words(form)).toContain(t("lovejoin.mix.privacy.collateralIfLeft").replace(/\s+/g, " "));
    expect(form).toContain('data-testid="lovejoin-boxes">1 ');
    expect(has(form, "lovejoin-boxes-none")).toBe(false);
  });

  it("holds the Bootstrap form from the private balance to the way back's reserve the worker priced, never the 1.5 ₳ that stands in (1.7.0's release review, pr333#1)", () => {
    /** The page below the pool's floor, its Bootstrap form leading at the 27 boxes that start it, the worker's `back`. */
    const formOf = (back: string) => {
      seam.reset();
      seam.effects.add("PoolPage");
      answer("lovejoin-funding", funding);
      answer("lovejoin-bootstrap-most", { most: 96, back });
      return page({ pool: { ...classic, others: 3, free: 3 }, seedelf: seedelf("275000000") });
    };
    const bootstrapOff = /<button[^>]*disabled=""[^>]*data-testid="lovejoin-bootstrap"/;
    // 275 ₳: 27 boxes, the deposit's 1.5 ₳ and the fee's room, beside today's 1.5 ₳ for the way back.
    const today = formOf("1500000");
    expect(payloads("lovejoin-bootstrap-most")).toEqual([{}]);
    expect(has(today, "lovejoin-bootstrap-why")).toBe(false);
    expect(today).not.toMatch(bootstrapOff);
    // Not the 1.8 ₳ a dearer byte asks: the form says so, and Bootstrap waits.
    const dear = formOf("1800000");
    expect(has(dear, "lovejoin-bootstrap-why")).toBe(true);
    expect(dear).toMatch(bootstrapOff);
  });

  it("says its collateral's mix one of three ways: its reserve counted, mixed only if enough is left, or nothing where no 5 ₳ pool takes it (1.6.0's review of the fixes, fx-promise)", () => {
    const formOf = (answered: object, props: Record<string, unknown> = {}) => {
      seam.reset();
      seam.effects.add("PoolPage");
      answer("lovejoin-funding", answered);
      return page(props);
    };
    const { collateralReserve: _reserve, collateralPool: _pool, ...plain } = funding;
    for (const [what, form, counted, ifLeft] of [
      // This many boxes leave room for its reserve: the funding pays it, and the chain keeps it for that mix.
      ["counted", formOf(funding), true, false],
      // They don't: funded without it, the 5 ₳ mixed only if enough is left when it comes back.
      ["short", formOf(funding, { seedelf: seedelf("23000000") }), false, true],
      // No 5 ₳ pool asked for (none shown, or Settings' switch off), or the page's read has it short of its floor.
      ["no pool", formOf(plain, { seedelf: seedelf("23000000") }), false, false],
      ["under its floor", formOf(funding, { seedelf: seedelf("23000000"), pools: [classic, { ...five, others: 1 }] }), false, false],
    ] as const) {
      expect(!!row(form, "lovejoin-mix-moves", t("lovejoin.collateralReserve.label")), what).toBe(counted);
      expect(!!row(form, "lovejoin-mix-moves", t("lovejoin.collateralBox.label")), what).toBe(counted);
      expect(!!row(form, "lovejoin-mix-cost", t("lovejoin.collateralMix.label")), what).toBe(counted);
      expect(has(form, "lovejoin-collateral-if-left"), what).toBe(ifLeft);
    }
  });

  describe("from the public account (321-lj-screens#1, R3-14, R3-26, R3-27)", () => {
    /** Another token the account holds beside ADA, in a UTxO of its own. */
    const other = { policyId: "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72", assetName: "4d494e", quantity: "5000000", decimals: 6, fingerprint: "" };
    const utxo = (txHash: string, lovelace: string, extra: Record<string, unknown> = {}) => ({ txHash: txHash.repeat(32), index: 0, lovelace, tokens: [], locked: false, ...extra });
    const collateral = utxo("c3", "5000000", { locked: true, collateral: true });
    /** Home's figure for the account: every UTxO's ADA but its collateral's. */
    const cardano = { lovelace: "110000000", tokens: [other], utxos: 3, addressesUsed: 1, locked: { lovelace: "5000000", tokens: [], utxos: 1 } };
    /** The account's UTxOs, as the page reads them: `alone` of ADA alone, 50 ₳ beside the other token, and the collateral. */
    function account(alone: string) {
      seedInitial("private", "public");
      seam.effects.add("PoolPage");
      answer("lovejoin-funding", funding);
      answer("collateral", { state: "set", utxo: collateral, by: "you" });
      answer("utxos", { seedelf: [], cardano: [utxo("c1", alone), utxo("c2", "50000000", { tokens: [other] }), collateral] });
    }
    /** What the held amounts `testId` names say: where they are, for a screen reader, then the amounts. */
    const held = (markup: string, testId: string) =>
      words(markup.match(new RegExp(`data-testid="${testId}"[^>]*>(.*?<span class="sr-only">[^<]*</span>[^<]*)</span>`))?.[1] ?? "");

    it("shows what a mix can spend once the account's UTxOs answer, its ADA alone, in words that say so", () => {
      account("60000000");
      const form = page({ cardano });
      expect(asked()).toContain("utxos");
      expect(held(form, "lovejoin-held-balance")).toBe(`${t("lovejoin.mix.inPublicSpendable")} ${words(adaText("60000000"))}`);
    });

    it("says what a mix can spend where it can't pay for a box, never what the account holds", () => {
      account("3000000");
      const form = page({ cardano });
      expect(words(form.match(/data-testid="lovejoin-mix-why">(.*?)<\/p>/)?.[1] ?? "")).toBe(
        words(t("lovejoin.mix.cantAffordPublic", { first: formatAda("15300000"), held: formatAda("3000000") })),
      );
    });

    it("on the Bootstrap form too, which leads below the floor", () => {
      account("60000000");
      const form = page({ cardano, pool: { ...classic, others: 3, free: 3 } });
      expect(held(form, "lovejoin-bootstrap-held-balance")).toBe(`${t("lovejoin.mix.inPublicSpendable")} ${words(adaText("60000000"))}`);
    });

    it("in a token pool, shows what a mix of the most boxes the stepper offers can spend, whatever the count stands at (the last look, LW-4)", () => {
      /** A pool of 2 ₳ and 100 of a token a box, its name six bytes, as PR #163's LJTEST pool names its own. */
      const TOK = { policyId: "cc".repeat(28), assetName: "4c4a54455354", quantity: "100" };
      const tok = (quantity: string) => ({ ...TOK, quantity, fingerprint: "asset1tok", decimals: 0 });
      const pool = { ...classic, id: "ee".repeat(28), box: { lovelace: "2000000", token: TOK } };
      seedInitial("private", "public");
      seam.effects.add("PoolPage");
      // One box one wave deep: its 2 ₳, its one mix at 0.95 ₳, and the deposit's 1.5 ₳.
      answer("lovejoin-funding", { lovelace: "4450000", mixes: 1, mixFees: "950000", boxes: 1, depth: 1, delay: "1-6", pool: pool.id });
      answer("collateral", { state: "set", utxo: collateral, by: "you" });
      // 6.2 ₳ of ADA alone; two boxes' worth of the token beside 1.2 ₳, picked first; one box's beside 10 ₳, picked for a
      // third (R3-14's account that goes on to three).
      answer("utxos", {
        seedelf: [],
        cardano: [utxo("d1", "6200000"), utxo("d2", "1200000", { tokens: [tok("200")] }), utxo("d3", "10000000", { tokens: [tok("100")] }), collateral],
      });
      const form = page({ cardano: { ...cardano, tokens: [tok("300")] }, pool, pools: [classic, five, pool] });
      // At one box, the stepper offering three, whose funding is 10.35 ₳: the figure is what three can spend, 17.4 ₳,
      // never one box's pick, 6.24061 ₳, which grew as + was pressed and sat below what the count offered costs.
      expect(form).toContain('data-testid="lovejoin-boxes">1 ');
      expect(form).toMatch(new RegExp(`aria-label="${t("lovejoin.mix.more")}"(?![^>]*disabled)`));
      expect(held(form, "lovejoin-held-balance")).toContain(`${t("lovejoin.mix.inPublicSpendable")} ${words(adaText("17400000"))}`);
      expect(held(form, "lovejoin-held-balance")).not.toContain(words(adaText("6240610")));
    });
  });

  describe("Mix my boxes again's switch on its review (320-screens#4, 320-screens#3)", () => {
    /** The page's states, in order, up to its review: the side chosen, the count, a Bootstrap's count, the funding asked. */
    const beforeReview = ["private", 1, undefined, undefined];
    const turned = (review: Record<string, unknown>) => {
      seam.effects.add("PoolPage");
      answer("lovejoin-funding", funding);
      seed(beforeReview, review);
      seam.stubbed.add("PrivateReview");
      seam.stubbed.add("PublicReview");
      on("AgainSwitch", (props) => (props.onFour as (four: boolean) => void)(true));
      return page();
    };

    it("builds the review again at four, the page's width taken only once that review is in, and says it's building", () => {
      const form = turned({ source: "private", summary: { txHash: TX, index: 0, mix: { again: true, width: 3, boxes: 2, depth: 2, mixes: 8 } }, again: noop });
      expect(payloads("lovejoin-again-build")).toEqual([{ width: 4 }]);
      // The page's funding is still asked at three: nothing took four before the rebuild.
      expect(payloads("lovejoin-funding")).toEqual([{ boxes: 1, width: 3 }]);
      expect(words(form)).toContain(t("common.building"));
    });

    it("from the public account's review the same", () => {
      const form = turned({ source: "public", summary: { txHash: TX, entry: TX, txs: 3, again: true, width: 3, boxes: 2 } });
      expect(payloads("lovejoin-again-public-build")).toEqual([{ width: 4 }]);
      expect(payloads("lovejoin-funding")).toEqual([{ boxes: 1, width: 3 }]);
      expect(words(form)).toContain(t("common.building"));
    });
  });

  it("names, in the escape hatch's question, the account whose box it takes where every box it can take is another's (R3-3)", () => {
    // The pool's one box, a box of account 1's mix, the wallet on account 2 of three; the question open (the page's
    // first state, after its words').
    const box = { txHash: "d1".repeat(32), txIndex: 0 };
    seed([0], { paid: true });
    const accounts = { accounts: [{ index: 0 }, { index: 1 }, { index: 2 }], active: 1, loaded: true, name: "", several: true, reload: async () => undefined };
    const pool = { ...classic, boxes: [box], otherAccounts: [{ ...box, account: 0 }] };
    const said = words(render(createElement(AccountsContext.Provider, { value: accounts }, pageOf({ pool }))));
    const account = (number: number) => t("accounts.numbered", { number });
    expect(said).toContain(words(t("lovejoin.stuck.privacy.publicNamed", { account: account(1), active: account(2) })));
    expect(said).toContain(words(t("lovejoin.stuck.privacy.privateNamed")));
  });
});

describe("Bring every box back now's page, wired to what it follows and what it asks (1.6.0's review of the fixes, R3-20)", () => {
  const POOL = "dfa1f845875b627fff04fbd37b4545f3a07caf5214e03a3f4557911d";
  /** The worker's lovejoin-held with nothing of the wallet's left, beside `extra`. */
  const held = (extra: Record<string, unknown> = {}) => ({ boxes: 0, lovelace: "0", next: null, notMixed: 0, stopped: 0, ...extra });
  const pool = (id: string, boxes: number) => ({ id, boxes, lovelace: "0", next: null, notMixed: 0 });
  /** `n` boxes, as the page counts them. */
  const boxes = (n: number) => ({ count: n, boxes: t("amount.boxes", { count: n, n }) });
  /** The page's next read, two seconds on, inside its render. */
  const nextRead = () => on("BringAllBackView", () => vi.advanceTimersByTime(2_000));

  it("in Settings, says one pool's run that ended with nothing sent left nothing in that pool, never in Lovejoin (321-lj-screens#6)", () => {
    seam.effects.add("BringAllBack");
    answers("lovejoin-held", held({ bringing: { back: 0, pool: POOL }, pools: [pool(POOL, 1)] }), held({ pools: [pool(POOL, 0)] }));
    nextRead();
    const onOver = vi.fn();
    const said = words(render(createElement(BringAllBack, { network: "preprod", onOver })));
    expect(said).toContain(t("settings.lovejoin.bringNonePool"));
    expect(said).not.toContain(t("settings.lovejoin.bringNone"));
    expect(onOver).toHaveBeenCalledTimes(1);
  });

  it("says a run Stop stopped on another page is stopped, with the worker's count, never Done (L2)", () => {
    for (const where of [undefined, POOL]) {
      seam.reset();
      seam.effects.add("BringAllBack");
      answers("lovejoin-held", held({ bringing: { back: 2, left: 3 } }), held({ bringStopped: { back: 3 } }));
      nextRead();
      const said = words(render(createElement(BringAllBack, { network: "preprod", ...(where ? { pool: where } : {}) })));
      expect(said, where ?? "Settings").toContain(words(t("settings.lovejoin.bringStoppedSent", boxes(3))));
      expect(said, where ?? "Settings").not.toContain(words(t("settings.lovejoin.bringDone", boxes(3))));
    }
  });

  it("shows a run its page covers that's late on the chain: the line that says what comes of it, and Stop (321-lj-worker#4)", () => {
    for (const where of [undefined, POOL]) {
      seam.reset();
      seam.effects.add("BringAllBack");
      answer("lovejoin-held", held({ bringing: { back: 8, left: 0, confirming: 1, late: true, pool: POOL }, pools: [pool(POOL, 1)] }));
      const page = render(createElement(BringAllBack, { network: "preprod", ...(where ? { pool: where } : {}) }));
      expect(words(page), where ?? "Settings").toContain(words(t("settings.lovejoin.bringLate")));
      expect(words(page), where ?? "Settings").not.toContain(words(t("settings.lovejoin.bringUnlocked")));
      expect(has(page, "lovejoin-bring-stop"), where ?? "Settings").toBe(true);
    }
  });

  it("drops a read sent before Stop that answers after it, as every press does: it would speak for before the press (321-lj-screens#0)", () => {
    seam.effects.add("BringAllBack");
    const second = seam.late();
    answers("lovejoin-held", held({ bringing: { back: 1, left: 2 } }), second.answer);
    // The next read goes, Stop is pressed while it's out, and then it answers, the run as it was before Stop.
    on("BringAllBackView", (props) => {
      vi.advanceTimersByTime(2_000);
      (props.onStop as () => void)();
      second.resolve(held({ bringing: { back: 2, left: 1 } }));
    });
    const said = words(render(createElement(BringAllBack, { network: "preprod" })));
    expect(asked()).toEqual(["lovejoin-held", "lovejoin-held", "lovejoin-bring-all-back-stop"]);
    expect(said).toContain(words(t("settings.lovejoin.bringing", boxes(1))));
    expect(said).not.toContain(words(t("settings.lovejoin.bringing", boxes(2))));
  });
});

describe("the swap form and its approval, wired (1.6.0's review of the fixes, R3-20: 320-screens#3; R3-12)", () => {
  const MIN = "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed724d494e";
  /** What's received: MIN, picked on the form. */
  const get = { id: MIN, side: { label: "MIN", decimals: 6 } };
  /** The form's first state, ADA paid; the state after it is what's received. */
  const paysAda = (v: unknown) => (v as { id?: string } | undefined)?.id === "lovelace";
  const seedelf = { lovelace: "50000000", tokens: [], utxos: 2, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 } };
  const form = (held = seedelf) => render(createElement(NewSwap, { seedelf: held, onCancel: noop, onStarted: noop } as never));
  /** The amount the form holds, as its field shows it. */
  const amount = (markup: string) => markup.match(/<input[^>]*id="swap-amount"[^>]*value="([^"]*)"/)?.[1];

  it("says Building, not Sending, while the approval's switch builds the funding again (320-screens#3)", () => {
    seed([paysAda], get);
    // The approval, built: the state after ADA's price (null until read) holds it.
    seed([null], { summary: { txHash: TX, index: 0 }, quote: {} });
    seam.stubbed.add("SwapApproval");
    on("SwapApproval", (props) => (props.onThrough as (on: boolean) => void)(false));
    const said = words(form());
    expect(said).toContain(t("common.building"));
    expect(said).not.toContain(t("common.sending"));
  });

  it("says Building, not Sending, on a session's return while its switch builds it again, a swap's or a site's (320-screens#3)", () => {
    // The return, built. Its rows and notes are components of their own, made as nothing here: only its Send is tested.
    const back ={ network: "preprod", index: 0, txHash: TX, fee: "300000", lovelace: "20000000", tokens: [], depositOutputs: 0, inputs: 2 };
    const session = { index: 0, stage: "open", site: { origin: "https://example.org" }, txs: [], createdAt: NOW };
    const pages: Array<[string, () => ReactElement]> = [
      [
        "a swap's",
        () => {
          // Its page's states start with the session, then its orders and a step's review, then the return.
          seed([(v: unknown) => v === session, undefined, undefined], back);
          return createElement(Session, { session, reading: false, onRefresh: noop, onBack: noop, onChanged: noop } as never);
        },
      ],
      [
        "a site's",
        () => {
          // Its page's states start with which part of it shows, then the return.
          seed(["main"], back);
          return createElement(SiteSession, { session, seedelf, reading: false, onRefresh: noop, onBack: noop, onPending: noop, onDisconnected: noop } as never);
        },
      ],
    ];
    for (const [whose, page] of pages) {
      seam.reset();
      for (const name of ["LovejoinRows", "IntoRow", "CollateralTailRow", "TokenWays", "TxDetailButton", "ReturnLeftOut", "HandleWarning", "LovejoinNote", "CollateralTailNote", "ReturnLinks", "LovejoinSwitch"]) {
        seam.stubbed.add(name);
      }
      on("LovejoinSwitch", (props) => (props.onThrough as (through: boolean) => void)(false));
      const said = words(render(page()));
      expect(payloads("session-back-build"), whose).toEqual([{ index: 0, direct: true }]);
      expect(said, whose).toContain(t("common.building"));
      expect(said, whose).not.toContain(t("common.sending"));
    }
  });

  describe("Max pressed before any quote, which then names the collateral's mix reserve (R3-12)", () => {
    /** Minswap's quote, as the worker hands it on: 6 ₳ of costs, the 5 ₳ collateral and the 1.5 ₳ reserve. */
    const quote = (ask: { amount: string }) => ({
      network: "preprod",
      ask,
      amountIn: ask.amount,
      amountOut: "906594100",
      minAmountOut: "902083681",
      dexFee: "700000",
      deposits: "2000000",
      aggregatorFee: "0",
      priceImpact: 0.1,
      route: ["MinswapV2"],
      fund: { lovelace: (BigInt(ask.amount) + 6_000_000n).toString(), tokens: [] },
      collateral: "5000000",
      verified: true,
      collateralReserve: "1500000",
    });
    /** Max's button for ADA, and the amount field once it holds something: Max's, then the quote, once typing pauses. */
    function maxThenQuote(typed?: string, lovelace?: string) {
      seed([paysAda], get);
      seam.effects.add("NewSwap");
      answer("swap-quote", quote);
      on((name, props) => name === "button" && props.title === t("swaps.maxAda"), (props) => (props.onClick as () => void)());
      on(
        (name, props) => name === "AmountField" && props.value !== "",
        (props) => {
          if (typed) (props.onChange as (value: string) => void)(typed);
          vi.advanceTimersByTime(600);
        },
      );
      return form(lovelace ? { ...seedelf, lovelace } : seedelf);
    }

    it("follows the amount down to Max once the quote keeps the reserve aside: 50 ₳ less the usual costs, then the quote's", () => {
      const page = maxThenQuote();
      // Max before the quote: 50 ₳ less 6 ₳ of usual costs, the 5 ₳ collateral and 2 ₳ of room, 37 ₳; then less the 1.5 ₳ too.
      expect(payloads("swap-quote")).toEqual([expect.objectContaining({ amount: "37000000", tokenIn: "lovelace", tokenOut: MIN })]);
      expect(amount(page)).toBe("35");
    });

    it("leaves an amount typed after Max as typed: typing takes the amount from Max", () => {
      expect(amount(maxThenQuote("36"))).toBe("36");
    });

    it("never empties the amount where the quote's reserve takes Max to nothing: it stays, and goes without it (the last look, LM-2)", () => {
      // 14 ₳: Max before the quote is 1 ₳; the quote's 1.5 ₳ kept aside too leaves nothing.
      const page = maxThenQuote(undefined, "14000000");
      expect(payloads("swap-quote")).toEqual([expect.objectContaining({ amount: "1000000", tokenIn: "lovelace", tokenOut: MIN })]);
      expect(amount(page)).toBe("1");
    });

    it("says what Max keeps aside for the collateral's mix by the approval's rule: its mix, what it may take, or nothing (1.6.0's review of the fixes, fx-promise)", () => {
      for (const [extra, says] of [
        [{ collateralReserve: "1500000", collateralMix: "mixed" }, "network fee and its collateral's mix, or comes back"],
        [{ collateralReserve: "1500000", collateralMix: "ifLeft" }, "network fee and what its collateral's mix may take, or comes back"],
        [{}, "pays the swap's costs and network fee, or comes back"],
      ] as const) {
        seam.reset();
        seed([paysAda], get);
        seam.effects.add("NewSwap");
        answer("swap-quote", (ask: { amount: string }) => {
          const { collateralReserve: _kept, ...plain } = quote(ask);
          return { ...plain, ...extra };
        });
        on((name, props) => name === "button" && props.title === t("swaps.maxAda"), (props) => (props.onClick as () => void)());
        on(
          (name, props) => name === "AmountField" && props.value !== "",
          () => vi.advanceTimersByTime(600),
        );
        const note = words(form()).match(/Max is [^:]*:/)?.[0];
        expect(note, says).toContain(says);
      }
    });
  });
});

describe("a site's funding review and its top-up's, counting what the summary they review says (1.6.0's review of the fixes, R3-1)", () => {
  /**
   * A site's session funded or topped up, built: 24 ₳ for the site, its payment carrying the collateral's mix reserve
   * too where the funding pays it (`collateralReserve`), the 5 ₳ collateral, and the fee. `collateralMix`: a 5 ₳ pool
   * may take the collateral, its reserve paid or not, so it's mixed only if enough is left (fx-promise).
   */
  const built = (extra: { collateralReserve?: string; collateralMix?: "mixed" | "ifLeft" } = {}) => ({
    network: "preprod",
    txHash: TX,
    index: 0,
    address: "addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz",
    payments: [
      { address: "addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz", lovelace: (24_000_000n + BigInt(extra.collateralReserve ?? "0")).toString(), tokens: [] },
      { address: "addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz", lovelace: "5000000", tokens: [] },
    ],
    max: false,
    fee: { size: "200000", compute: "30000", scriptReference: "0", total: "230000" },
    changeLovelace: "0",
    changeTokens: 0,
    changeOutputs: 0,
    changeMinimum: "0",
    inputs: 1,
    left: 0,
    ...extra,
  });
  /** The review's state starts after its amount's and its tokens', both empty. */
  const reviewing = (summary: unknown) => seed(["", {}], summary);
  const seedelf = { lovelace: "80000000", tokens: [], utxos: 2, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 } };
  const RESERVE = "1500000";
  /** The way back's both ways: the funding's fee, a deposit and the return's through Lovejoin, and the mix where it's paid. */
  const bothWays = (mix: bigint) => ada(toCents(230_000n + 2n * SESSION_FEE_ESTIMATE + mix));

  describe("a site's funding (323-worker#1, 323-worker#6, R3-9)", () => {
    const funding = (summary: unknown) => {
      reviewing(summary);
      return render(
        createElement(ConnectRequest, {
          approval: { kind: "connect", id: "a1", origin: "https://example.org", title: "Example" },
          busy: false,
          held: false,
          onError: noop,
          onAnswer: async () => false,
        } as never),
        { lovejoinReturns: true },
      );
    };

    it("pays the reserve: the site's figure less it, its own row, the mix in the way back's fees, the 5 ₳ said mixed only if enough is left", () => {
      const page = funding(built({ collateralReserve: RESERVE, collateralMix: "ifLeft" }));
      expect(row(page, "dapp-funding-rows", t("dappUi.forTheSite"))).toBe(ada("24000000"));
      expect(row(page, "dapp-funding-rows", t("lovejoin.collateralReserve.label"))).toBe(words(t("lovejoin.collateralReserve.value", { ada: formatAda(RESERVE) })));
      expect(row(page, "dapp-funding-back", t("lovejoin.collateralMix.label"))).toBe(ada(toCents(COLLATERAL_MIX_COST)));
      expect(row(page, "dapp-funding-back", t("dappUi.back.bothWays"))).toBe(bothWays(COLLATERAL_MIX_COST));
      expect(words(page)).toContain(words(t("dappUi.back.privacy.noteLovejoinMixed")));
    });

    it("without it, counts no mix, and says the 5 ₳ is mixed only if enough is left where a pool takes it, back at once where none does", () => {
      for (const [summary, note] of [
        [built({ collateralMix: "ifLeft" }), "dappUi.back.privacy.noteLovejoinMixed"],
        [built(), "dappUi.back.privacy.noteLovejoin"],
      ] as const) {
        seam.reset();
        const page = funding(summary);
        expect(row(page, "dapp-funding-rows", t("dappUi.forTheSite")), note).toBe(ada("24000000"));
        expect(row(page, "dapp-funding-rows", t("lovejoin.collateralReserve.label")), note).toBeUndefined();
        expect(row(page, "dapp-funding-back", t("lovejoin.collateralMix.label")), note).toBeUndefined();
        expect(row(page, "dapp-funding-back", t("dappUi.back.bothWays")), note).toBe(bothWays(0n));
        expect(words(page), note).toContain(words(t(note)));
      }
    });
  });

  describe("a site's top-up (323-worker#6, R3-9)", () => {
    const topUp = (summary: unknown) => {
      seedInitial("main", "top-up");
      reviewing(summary);
      return render(
        createElement(SiteSession, {
          session: { index: 0, stage: "open", site: { origin: "https://example.org" }, txs: [], createdAt: NOW },
          seedelf,
          reading: false,
          onRefresh: noop,
          onBack: noop,
          onPending: noop,
          onDisconnected: noop,
        } as never),
      );
    };

    it("pays the reserve: the top-up less it, its own row, the new 5 ₳ said mixed at the next return only if enough is left", () => {
      const page = topUp(built({ collateralReserve: RESERVE, collateralMix: "ifLeft" }));
      expect(row(page, "top-up-review", t("sites.topUp.amount"))).toBe(ada("24000000"));
      expect(row(page, "top-up-review", t("lovejoin.collateralReserve.label"))).toBe(words(t("lovejoin.collateralReserve.value", { ada: formatAda(RESERVE) })));
      expect(words(page)).toContain(words(t("sites.topUp.collateralMixed")));
    });

    it("without it, no reserve row, and its 5 ₳ said mixed only if enough is left where a pool takes it, back with the next return where none does", () => {
      for (const [summary, note] of [
        [built({ collateralMix: "ifLeft" }), "sites.topUp.collateralMixed"],
        [built(), "sites.topUp.collateral"],
      ] as const) {
        seam.reset();
        const page = topUp(summary);
        expect(row(page, "top-up-review", t("sites.topUp.amount")), note).toBe(ada("24000000"));
        expect(row(page, "top-up-review", t("lovejoin.collateralReserve.label")), note).toBeUndefined();
        expect(words(page), note).toContain(words(t(note)));
      }
    });
  });
});

describe("Transaction details' stepper, through a payment's parts (1.7.0's release review: pr335#0, pr335#3, x-mut-ts#6)", () => {
  const [first, second] = ["a1".repeat(32), "b2".repeat(32)];
  /** What the worker hands back for transaction `txHash`: its body is made as nothing here, so only its id is read. */
  const viewOf = (txHash: string) => ({ detail: { txHash }, cbor: "84a0a0f5f6" });
  /** The view of a payment in two transactions, opened on the first. */
  const modal = () => render(createElement(TxDetailModal, { txHash: first, parts: [first, second], testId: "tx", onClose: noop }));
  /** The id the view shows. */
  const idOf = (markup: string) => /data-testid="tx-hash" data-value="([^"]*)"/.exec(markup)?.[1];
  /** Where the stepper stands, in its own words. */
  const partOf = (n: number) => t("tx.partOf", { n, total: 2 });
  const off = (label: string) => new RegExp(`aria-label="${label}" disabled=""`);
  /** The step the view had reached (from 0), as React keeps it while its review is built again in place. */
  const stepped = (step: number) => seam.seeds.push({ after: ["transaction"], initial: 0, value: step });
  const press = (testId: string) => on((name, props) => name === "button" && props["data-testid"] === testId, (props) => (props.onClick as () => void)());

  beforeEach(() => seam.stubbed.add("TxDetailBody"));

  it("never stands past its last part: a review built again in fewer leaves its view on the last, never 'Transaction 3 of 2' (pr335#0)", () => {
    // Open on the third of three when the review was built again, in two.
    stepped(2);
    const page = modal();
    expect(words(page)).toContain(partOf(2));
    expect(idOf(page)).toBe(second);
    expect(page).toMatch(off(t("tx.partNext")));
    expect(page).not.toMatch(off(t("tx.partPrevious")));
  });

  it("steps back from there to the one before it, so no press goes for nothing (pr335#0)", () => {
    stepped(2);
    press("tx-part-previous");
    const page = modal();
    expect(words(page)).toContain(partOf(1));
    expect(idOf(page)).toBe(first);
  });

  it("opens a review built again on its first transaction: its view is the review's, by the first's hash (pr335#0)", () => {
    // Open: the button's own state.
    seam.seeds.push({ after: [], initial: false, value: true });
    const handed: { key?: unknown; parts?: unknown } = {};
    on("TxDetailModal", (props, key) => Object.assign(handed, { key, parts: props.parts }));
    render(createElement(TxDetailButton, { txHash: first, parts: [{ txHash: first }, { txHash: second }], testId: "tx" }));
    // Each build signs with a new one-time key, so a review built again in place has a new first: its view starts afresh.
    expect(handed).toEqual({ key: first, parts: [first, second] });
  });

  it("asks for the next as it steps, and shows nothing of the last one's under it meanwhile, not for one render (pr335#3, x-mut-ts#6)", () => {
    seam.effects.add("TxDetailModal");
    // The first's read answers; the second's never does here.
    const never = seam.late();
    answer("tx-detail", (payload: unknown) => ((payload as { txHash: string }).txHash === first ? viewOf(first) : never.answer));
    // Every render's label, and the id and the body under it: each is what React puts on screen in turn.
    const renders: Array<{ label: unknown; id?: unknown; body?: unknown }> = [];
    on((name, props) => {
      if (name === "output" && props["data-testid"] === "tx-part") renders.push({ label: props.children });
      if (name === "code" && props["data-testid"] === "tx-hash") renders.at(-1)!.id = props["data-value"];
      if (name === "TxDetailBody") renders.at(-1)!.body = (props.detail as { txHash: string }).txHash;
      return false;
    }, noop);
    // Next, pressed once the first's view is in: its tabs show only then.
    let next: (() => void) | undefined;
    on((name, props) => {
      if (name === "button" && props["data-testid"] === "tx-part-next") next = props.onClick as () => void;
      return false;
    }, noop);
    on("Tabs", () => next!());
    const page = modal();
    expect(payloads("tx-detail")).toEqual([{ txHash: first }, { txHash: second }]);
    // The second's place and id while it's asked for, and Next off on the last.
    expect(words(page)).toContain(partOf(2));
    expect(idOf(page)).toBe(second);
    expect(has(page, "tx-loading")).toBe(true);
    expect(page).toMatch(off(t("tx.partNext")));
    // The first's view showed under its own label, and nothing of it under the second's.
    expect(renders).toContainEqual({ label: partOf(1), id: first, body: first });
    const later = renders.filter((r) => r.label === partOf(2));
    expect(later.length).toBeGreaterThan(0);
    for (const r of later) expect({ id: r.id, body: r.body }).toEqual({ id: second, body: undefined });
  });
});

describe("Transaction details for every part, handed on by each review in parts (1.7.0's release review: pr335#2, x-mut-ts#5)", () => {
  /** Two transactions: the second spends what the first carried forward. */
  const parts = [
    { txHash: TX, fee: "300000", inputs: 20 },
    { txHash: "cd".repeat(32), fee: "250000", inputs: 3, waits: true as const },
  ];
  const fee = { size: "500000", compute: "50000", scriptReference: "0", total: "550000" };
  /** A private payment's figures, as Send privately, Make public and a session's funding share them. */
  const figures = {
    network: "preprod",
    txHash: TX,
    max: false,
    fee,
    changeLovelace: "0",
    changeTokens: 0,
    changeOutputs: 0,
    changeMinimum: "0",
    inputs: 23,
    left: 0,
    parts,
  };
  const address = "addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz";
  const seedelf = { lovelace: "800000000", tokens: [], utxos: 23, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 } };
  /** What the review with Transaction details `testId` hands it: its transaction, and the parts the review holds. */
  function handedBy(testId: string) {
    const handed: { txHash?: unknown; parts?: unknown } = {};
    on((name, props) => name === "TxDetailButton" && props.testId === testId, (props) => Object.assign(handed, { txHash: props.txHash, parts: props.parts }));
    return handed;
  }

  it("Send privately", () => {
    const handed = handedBy("transfer-tx");
    // The review's state starts after the form's lookups' and its Max's.
    seed([{}, false], { ...figures, payments: [{ to: "53656564656c66", lovelace: "600000000", minimum: null, tokens: [], toSelf: false }] });
    render(createElement(Transfer, { seedelf, onCancel: noop, onSent: noop }));
    expect(handed).toEqual({ txHash: TX, parts });
  });

  it("Make public", () => {
    const handed = handedBy("withdraw-tx");
    // The review's state starts after the form's reads' and its Max's.
    seed([{}, false], { ...figures, payments: [{ address, own: false, lovelace: "600000000", minimum: null, tokens: [] }] });
    render(createElement(Withdraw, { seedelf, onCancel: noop, onSent: noop }));
    expect(handed).toEqual({ txHash: TX, parts });
  });

  it("a swap's funding", () => {
    const handed = handedBy("swap-out-tx");
    seed([(v: unknown) => (v as { id?: string } | undefined)?.id === "lovelace"], {
      id: "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed724d494e",
      side: { label: "MIN", decimals: 6 },
    });
    // The approval, built: the state after ADA's price (null until read) holds it; its body is made as nothing here.
    seed([null], { summary: { ...figures, index: 0, address, payments: [] }, quote: {} });
    seam.stubbed.add("SwapApproval");
    render(createElement(NewSwap, { seedelf, onCancel: noop, onStarted: noop } as never));
    expect(handed).toEqual({ txHash: TX, parts });
  });

  it("a mix into Lovejoin from the private balance", () => {
    const handed = handedBy("lovejoin-tx");
    const classic = { box: { lovelace: "10000000" }, others: 41, free: 41, floor: 30, boxes: [], lovelace: "0", due: [], notMixed: [], fromPublic: [] };
    // The page's states, in order, up to its review: the side chosen, the count, a Bootstrap's count, the funding asked.
    seed(["private", 1, undefined, undefined], {
      source: "private",
      summary: { ...figures, index: 0, address, payments: [], mix: { again: false, width: 3, boxes: 10, depth: 2, mixes: 40 } },
    });
    seam.stubbed.add("PrivateReview");
    render(
      createElement(PoolPage, {
        pool: classic,
        pools: [classic],
        seedelf,
        reading: false,
        readFailed: false,
        mixingAgain: false,
        sending: null,
        onSendingPublic: noop,
        onSending: noop,
        onRefresh: async () => undefined,
        onBack: noop,
        onPending: noop,
      } as never),
    );
    expect(handed).toEqual({ txHash: TX, parts });
  });

  it("a site's funding", () => {
    const handed = handedBy("dapp-funding-tx");
    // The review's state starts after its amount's and its tokens', both empty.
    seed(["", {}], {
      ...figures,
      index: 0,
      address,
      payments: [
        { address, own: false, lovelace: "24000000", minimum: null, tokens: [] },
        { address, own: false, lovelace: "5000000", minimum: null, tokens: [] },
      ],
    });
    render(
      createElement(ConnectRequest, {
        approval: { kind: "connect", id: "a1", origin: "https://example.org", title: "Example" },
        busy: false,
        held: false,
        onError: noop,
        onAnswer: async () => false,
      } as never),
      { lovejoinReturns: true },
    );
    expect(handed).toEqual({ txHash: TX, parts });
  });
});

// 1.7.0's release review: #337's way out, each page that shows it pressed (x-mut-ts#3, x-scen#6). A page brought back by
// hand then opens its return's review, as Bring it back does: nothing brings its rest back by itself (pr337#1). What the
// press does after its first answer runs past the render, once the answers waiting are in (`settled`).
describe("the way out of a return held at its collateral's mix, wired (1.7.0's release review)", () => {
  /** A swap's session past its hour at the collateral's mix, its account read holding the rest. */
  const held = {
    index: 0,
    network: "preprod",
    address: "addr_test1",
    createdAt: NOW,
    stage: "open",
    txs: [{ kind: "out", txHash: TX, at: NOW, confirmed: true }],
    holding: { lovelace: "9000000", tokens: [], utxos: 1 },
    collateralHeld: { offerAt: NOW - 1 },
  };
  const auto = { step: "returning", stopping: false, filled: true, approvedMinOut: "0" };
  const back = { network: "preprod", index: 0, txHash: TX, fee: "300000", lovelace: "9000000", tokens: [], depositOutputs: 0, inputs: 1 };
  const seedelf = { lovelace: "50000000", tokens: [], utxos: 2, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 } };
  /** Bring the rest back now, pressed as the page makes it. */
  const press = () => on((name, props) => name === "button" && props["data-testid"] === "collateral-held-skip", (props) => (props.onClick as () => void)());
  /** Every answer the press waits on in. */
  const settled = () => new Promise((done) => setImmediate(done));

  it("on a swap brought back by hand: the press, then its return's review", async () => {
    answer("session-skip-collateral-mix", { ...held, collateralHeld: undefined });
    answer("session-back-build", back);
    press();
    render(createElement(Session, { session: held, reading: false, onRefresh: noop, onBack: noop, onChanged: noop } as never));
    expect(payloads("session-skip-collateral-mix")).toEqual([{ index: 0 }]);
    await settled();
    expect(payloads("session-back-build")).toEqual([{ index: 0 }]);
  });

  it("on a swap that runs itself: the press alone, its return sent in the press's own request", async () => {
    answer("session-skip-collateral-mix", { ...held, auto, collateralHeld: undefined });
    press();
    render(createElement(Session, { session: { ...held, auto }, reading: false, onRefresh: noop, onBack: noop, onChanged: noop } as never));
    expect(payloads("session-skip-collateral-mix")).toEqual([{ index: 0 }]);
    await settled();
    expect(asked()).not.toContain("session-back-build");
  });

  it("on a site's session: the press, the page read again, then its return's review", async () => {
    const site = { ...held, site: { origin: "https://example.org" } };
    answer("session-skip-collateral-mix", { ...site, collateralHeld: undefined });
    answer("session-back-build", back);
    const onRefresh = vi.fn();
    press();
    render(createElement(SiteSession, { session: site, seedelf, reading: false, onRefresh, onBack: noop, onPending: noop, onDisconnected: noop } as never));
    expect(payloads("session-skip-collateral-mix")).toEqual([{ index: 0 }]);
    await settled();
    expect(onRefresh).toHaveBeenCalled();
    expect(payloads("session-back-build")).toEqual([{ index: 0 }]);
  });

  it("opens no review where the press's answer still holds it, or leaves nothing at the account", async () => {
    for (const answered of [held, { ...held, collateralHeld: undefined, holding: { lovelace: "0", tokens: [], utxos: 0 } }]) {
      seam.reset();
      answer("session-skip-collateral-mix", answered);
      answer("session-back-build", back);
      press();
      render(createElement(Session, { session: held, reading: false, onRefresh: noop, onBack: noop, onChanged: noop } as never));
      await settled();
      expect(asked()).toEqual(["session-skip-collateral-mix"]);
    }
  });

  it("on a mix's card: its session's index, for the Lovejoin page to press with", async () => {
    const { MixList } = await import("../src/ui/screens/Lovejoin");
    const onSkipCollateral = vi.fn();
    press();
    render(
      createElement(MixList, {
        entries: [],
        sessions: [{ ...held, index: 3, mix: { boxes: 1 }, auto: { ...auto, filled: false }, chain: { total: 5, sent: 3, confirmed: 3, cut: false } }],
        chains: [],
        pools: [],
        busy: false,
        onRetry: noop,
        onStop: noop,
        onSkipCollateral,
      } as never),
    );
    expect(onSkipCollateral).toHaveBeenCalledWith(3);
  });
});
