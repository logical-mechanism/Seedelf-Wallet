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
    ons: [] as Array<{ match: (name: string, props: Record<string, unknown>) => boolean; act: (props: Record<string, unknown>) => void; done?: true }>,
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
            on.act(props ?? {});
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
/** Once, inside the render that makes the first element `match` takes: `act` with its props. */
function on(match: string | ((name: string, props: Record<string, unknown>) => boolean), act: (props: Record<string, unknown>) => void) {
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
    expect(words(form)).toContain(t("lovejoin.mix.privacy.collateralIfLeft"));
    expect(form).toContain('data-testid="lovejoin-boxes">1 ');
    expect(has(form, "lovejoin-boxes-none")).toBe(false);
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
  const form = () => render(createElement(NewSwap, { seedelf, onCancel: noop, onStarted: noop } as never));
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
    function maxThenQuote(typed?: string) {
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
      return form();
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
  });
});

describe("a site's funding review and its top-up's, counting what the summary they review says (1.6.0's review of the fixes, R3-1)", () => {
  /**
   * A site's session funded or topped up, built: 24 ₳ for the site, its payment carrying the collateral's mix reserve
   * too where the funding pays it (`collateralReserve`), the 5 ₳ collateral, and the fee. `collateralPool`: a 5 ₳ pool
   * takes the collateral, its reserve paid or not.
   */
  const built = (extra: { collateralReserve?: string; collateralPool?: true } = {}) => ({
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

    it("pays the reserve: the site's figure less it, its own row, the mix in the way back's fees, the 5 ₳ said mixed", () => {
      const page = funding(built({ collateralReserve: RESERVE, collateralPool: true }));
      expect(row(page, "dapp-funding-rows", t("dappUi.forTheSite"))).toBe(ada("24000000"));
      expect(row(page, "dapp-funding-rows", t("lovejoin.collateralReserve.label"))).toBe(words(t("lovejoin.collateralReserve.value", { ada: formatAda(RESERVE) })));
      expect(row(page, "dapp-funding-back", t("lovejoin.collateralMix.label"))).toBe(ada(toCents(COLLATERAL_MIX_COST)));
      expect(row(page, "dapp-funding-back", t("dappUi.back.bothWays"))).toBe(bothWays(COLLATERAL_MIX_COST));
      expect(words(page)).toContain(words(t("dappUi.back.privacy.noteLovejoinMixed")));
    });

    it("without it, counts no mix, and says the 5 ₳ is mixed where a pool takes it, back at once where none does", () => {
      for (const [summary, note] of [
        [built({ collateralPool: true }), "dappUi.back.privacy.noteLovejoinMixed"],
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

    it("pays the reserve: the top-up less it, its own row, the new 5 ₳ said mixed at the next return", () => {
      const page = topUp(built({ collateralReserve: RESERVE, collateralPool: true }));
      expect(row(page, "top-up-review", t("sites.topUp.amount"))).toBe(ada("24000000"));
      expect(row(page, "top-up-review", t("lovejoin.collateralReserve.label"))).toBe(words(t("lovejoin.collateralReserve.value", { ada: formatAda(RESERVE) })));
      expect(words(page)).toContain(words(t("sites.topUp.collateralMixed")));
    });

    it("without it, no reserve row, and its 5 ₳ said mixed where a pool takes it, back with the next return where none does", () => {
      for (const [summary, note] of [
        [built({ collateralPool: true }), "sites.topUp.collateralMixed"],
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
