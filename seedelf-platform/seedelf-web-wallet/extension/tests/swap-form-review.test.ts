// The swap form's Review, driven through NewSwap's own handlers: when it can be pressed, and the approval it opens.
//
// The approval names the swap Start swap sends (chunk 51's e7a#1, from its trace verifier). Review swap builds the
// funding on the quote shown, and while it builds the form stays live: the token buttons, the picker and the round
// Switch have no busy check. The approval was drawn from the build's quote beside the form's picks as they were by
// then, so a pick changed while it built named another token over the funding Start swap sends, which the worker
// records with the pair it was built for (sessions.ts outBuild's `swap`, outSubmit's `swap: built.swap`). It's drawn
// from the build's own picks now, and the approval's switch, Change and Build again build that swap again, never the
// form's.
//
// Review is pressed only where the funding pays (chunk 51's t1k#9): never while the private balance can't pay the
// quote's funding and its collateral, the amount is more than is held, or the token isn't verified, nor on a quote
// asked again at Review that the balance can't pay.
//
// Vitest has no DOM, so a small hook runner calls NewSwap as React would: each change draws it again and runs its
// effects, and what a person does goes through the elements' own handlers, in order, with the worker's build answered
// late.
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionOutSummary, SwapAsk, SwapQuote, SwapSide } from "../src/shared/rpc";

/** One of NewSwap's hooks, by its place in the order it calls them: a state, an effect, a memo, a ref. */
interface Slot {
  value?: unknown;
  set?: (next: unknown) => void;
  deps?: readonly unknown[];
  ran?: boolean;
  cleanup?: void | (() => void);
  current?: unknown;
}

const run = vi.hoisted(() => {
  const same = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
    !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const r = {
    /** NewSwap is being drawn by the runner, so its hooks are the runner's. Anything else draws with React's own. */
    active: false,
    slots: [] as Slot[],
    at: 0,
    /** Effects due after the draw, in order. */
    due: [] as Array<() => void>,
    /** A state changed: it's drawn again. */
    dirty: false,
    contexts: new Map<unknown, unknown>(),
    asked: [] as Array<{ type: string; payload: unknown }>,
    answers: new Map<string, (payload: unknown) => unknown>(),
    slot(): Slot {
      const i = r.at++;
      return (r.slots[i] ??= {});
    },
    useState(initial: unknown): [unknown, (next: unknown) => void] {
      const s = r.slot();
      if (!s.set) {
        s.value = typeof initial === "function" ? (initial as () => unknown)() : initial;
        s.set = (next: unknown) => {
          const value = typeof next === "function" ? (next as (was: unknown) => unknown)(s.value) : next;
          if (Object.is(value, s.value)) return;
          s.value = value;
          r.dirty = true;
        };
      }
      return [s.value, s.set];
    },
    useEffect(make: () => void | (() => void), deps?: readonly unknown[]): void {
      const s = r.slot();
      if (s.ran && deps && same(deps, s.deps)) return;
      s.ran = true;
      s.deps = deps;
      r.due.push(() => {
        if (typeof s.cleanup === "function") s.cleanup();
        s.cleanup = make();
      });
    },
    useMemo(make: () => unknown, deps?: readonly unknown[]): unknown {
      const s = r.slot();
      if (s.ran && deps && same(deps, s.deps)) return s.value;
      s.ran = true;
      s.deps = deps;
      s.value = make();
      return s.value;
    },
    useCallback(fn: unknown, deps?: readonly unknown[]): unknown {
      return r.useMemo(() => fn, deps);
    },
    useRef(initial: unknown): Slot {
      const s = r.slot();
      if (!s.ran) {
        s.ran = true;
        s.current = initial;
      }
      return s;
    },
    useContext(context: { _currentValue?: unknown }): unknown {
      return r.contexts.has(context) ? r.contexts.get(context) : context._currentValue;
    },
    reset() {
      r.active = false;
      r.slots = [];
      r.at = 0;
      r.due = [];
      r.dirty = false;
      r.contexts.clear();
      r.asked = [];
      r.answers.clear();
    },
  };
  return r;
});

vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  const ours: Record<string, (...args: never[]) => unknown> = {
    useState: run.useState,
    useEffect: run.useEffect,
    useLayoutEffect: run.useEffect,
    useMemo: run.useMemo,
    useCallback: run.useCallback,
    useRef: run.useRef,
    useContext: run.useContext,
  };
  const theirs = react as unknown as Record<string, (...args: unknown[]) => unknown>;
  const either = Object.fromEntries(
    Object.keys(ours).map((name) => [
      name,
      (...args: unknown[]) => (run.active ? (ours[name] as (...a: unknown[]) => unknown)(...args) : theirs[name]!(...args)),
    ]),
  );
  return { ...react, ...either };
});
vi.mock("../src/ui/background", async (original) => ({
  ...(await original<typeof import("../src/ui/background")>()),
  call: (type: string, payload: unknown) => {
    run.asked.push({ type, payload });
    const answer = run.answers.get(type);
    // A request the test leaves unanswered never answers.
    if (!answer) return new Promise(() => undefined);
    try {
      return Promise.resolve(answer(payload));
    } catch (e) {
      return Promise.reject(e);
    }
  },
}));

const { DEFAULT_PREFERENCES } = await import("../src/shared/preferences");
const { NetworkContext } = await import("../src/ui/network");
const { PreferencesContext } = await import("../src/ui/preferences");
const { AmountField } = await import("../src/ui/components/AmountField");
const { SendButton } = await import("../src/ui/components/SendButton");
const { formatQuantity } = await import("../src/ui/format");
const { localMatches, NewSwap, SwapApproval, TokenSelect } = await import("../src/ui/screens/Swaps");

type El = ReactElement<Record<string, unknown>>;

const NOW = Date.UTC(2026, 10, 17, 12);
const MIN = "29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6" + "4d494e";
const SNEK = "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f" + "534e454b";
const TX = "ab".repeat(32);
const ADDRESS = "addr1" + "q".repeat(53);
/** The private balance: `lovelace` of ADA, and nothing else. */
const balance = (lovelace: string) => ({ lovelace, utxos: 1, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 }, tokens: [] });
const prefs = { prefs: { ...DEFAULT_PREFERENCES, hideBalances: false }, loaded: true, set: async () => undefined };

/**
 * Minswap's quote: 100 ₳ buys 906.5941 MIN (6 decimals) or 30,000 SNEK (none); an ADA swap's funding is its amount
 * and `costs` (4 ₳ unless the test raises them), beside the 5 ₳ collateral. `verified`: Minswap's word on the token.
 */
let costs = 4_000_000n;
let verified = true;
function quoteOf(ask: SwapAsk): SwapQuote {
  const amountOut = ask.tokenOut === MIN ? "906594100" : ask.tokenOut === SNEK ? "30000" : "11030000";
  const ada = ask.tokenIn === "lovelace";
  return {
    network: "mainnet",
    ask,
    amountIn: ask.amount,
    amountOut,
    minAmountOut: ((BigInt(amountOut) * 100n) / 101n).toString(),
    dexFee: "2000000",
    deposits: "2000000",
    aggregatorFee: "0",
    priceImpact: 0.3,
    route: ["MinswapV2"],
    fund: ada
      ? { lovelace: (BigInt(ask.amount) + costs).toString(), tokens: [] }
      : { lovelace: costs.toString(), tokens: [{ policyId: ask.tokenIn.slice(0, 56), assetName: ask.tokenIn.slice(56), quantity: ask.amount }] },
    collateral: "5000000",
    verified,
  };
}

/** The worker's build of the funding asked for: two payments to the session's account, the swap's and its 5 ₳. */
const built: SessionOutSummary = {
  network: "mainnet",
  txHash: TX,
  index: 2,
  address: ADDRESS,
  payments: [
    { address: ADDRESS, own: false, lovelace: "104000000", minimum: null, tokens: [] },
    { address: ADDRESS, own: false, lovelace: "5000000", minimum: null, tokens: [] },
  ],
  max: false,
  fee: { size: "0", compute: "0", scriptReference: "0", total: "400000" },
  changeLovelace: "90600000",
  changeTokens: 0,
  changeOutputs: 1,
  changeMinimum: "0",
  inputs: 1,
  left: 0,
};

const started: number[] = [];
let props: Parameters<typeof NewSwap>[0];
/** Answers the build when the test says: the user acts while it's out. */
let finishBuild: (() => void) | undefined;

beforeEach(() => {
  run.reset();
  started.length = 0;
  finishBuild = undefined;
  costs = 4_000_000n;
  verified = true;
  props = { seedelf: balance("200000000"), onCancel: () => undefined, onStarted: (index: number) => void started.push(index) };
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: NOW });
  run.contexts.set(NetworkContext, "mainnet");
  run.contexts.set(PreferencesContext, prefs);
  run.answers.set("swap-quote", (ask) => quoteOf(ask as SwapAsk));
  run.answers.set("session-out-build", () => new Promise((resolve) => (finishBuild = () => resolve(built))));
  run.answers.set("session-out-submit", () => ({ kind: "session-out", network: "mainnet", txHash: TX, submittedAt: NOW, confirmations: null }));
});

afterEach(() => {
  vi.useRealTimers();
});

/** NewSwap drawn, its effects run, and drawn again until nothing changes: what's on the screen now. */
function draw(): El {
  for (let pass = 0; pass < 30; pass++) {
    run.at = 0;
    run.dirty = false;
    run.active = true;
    let tree: El;
    try {
      tree = NewSwap(props) as El;
    } finally {
      run.active = false;
    }
    for (const effect of run.due.splice(0)) effect();
    if (!run.dirty) return tree;
  }
  throw new Error("NewSwap kept changing");
}

/** What the worker's answers resolve lands, and NewSwap is drawn again. */
async function settle(): Promise<El> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  return draw();
}

/** Typing pauses: the quote's timer goes off and Minswap's answer lands. */
async function quoteLands(): Promise<El> {
  vi.advanceTimersByTime(600);
  return settle();
}

function* walk(node: unknown): Generator<El> {
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n);
    return;
  }
  if (!isValidElement(node)) return;
  const el = node as El;
  yield el;
  for (const value of Object.values(el.props ?? {})) yield* walk(value);
}
const find = (tree: unknown, match: (el: El) => boolean): El | undefined => [...walk(tree)].find(match);

const markup = (node: ReactNode) =>
  renderToStaticMarkup(
    createElement(NetworkContext.Provider, { value: "mainnet" }, createElement(PreferencesContext.Provider, { value: prefs }, node)),
  );
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();

/** A press, as a person makes it: never on a disabled button. */
function press(button: El | undefined): boolean {
  if (!button || button.props.disabled) return false;
  if (typeof button.type !== "string" && /^<button[^>]*\sdisabled=""/.test(markup(button))) return false;
  (button.props.onClick as () => void)();
  return true;
}

/** A card's token button: "swap-from" is You pay's, "swap-to" You receive's. */
const tokenButton = (tree: El, testId: string) => find(tree, (el) => el.props.testId === testId);
/** The round Switch between the cards. */
const switchButton = (tree: El) => find(tree, (el) => el.type === "button" && el.props.className === "swap-flip");

/** The open picker's row for `id`, pressed: what TokenSelect hands back for a token on the wallet's list. */
function pick(tree: El, id: string): boolean {
  const picker = find(tree, (el) => el.type === TokenSelect);
  if (!picker) return false;
  const row = localMatches("mainnet", [], "", picker.props.which as "pay" | "get").listed.find((p) => p.id === id);
  if (!row) throw new Error(`the picker doesn't list ${id}`);
  (picker.props.onPick as (p: unknown) => void)(row);
  return true;
}

/** Types `value` into You pay. */
function typeAmount(tree: El, value: string) {
  const field = find(tree, (el) => el.type === AmountField);
  (field!.props.onChange as (value: string, why?: string) => void)(value, undefined);
}

/** The form's foot button: Review swap, or what's missing. */
const footButton = (tree: El) => find(tree.props.foot, (el) => el.type === "button" && el.props.type === "submit");

/** Review swap, pressed as the form's submit: not while its button is off. */
function reviewSwap(tree: El): boolean {
  const button = footButton(tree);
  if (!button || button.props.disabled) return false;
  (tree.props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault: () => undefined });
  return true;
}

/** The approval's Start swap, pressed. */
function startSwap(tree: El): boolean {
  const send = find(tree.props.foot, (el) => el.type === SendButton);
  if (!send || send.props.busy) return false;
  (send.props.onClick as () => void)();
  return true;
}

/** What the approval says is paid and received, and the least it asks for, as a person reads them. */
function shown(tree: El): { pay: string; receive: string; least: string } {
  const approval = find(tree, (el) => el.type === SwapApproval);
  if (!approval) throw new Error("no approval on the screen");
  const html = markup(approval);
  const [pay, receive] = [...html.matchAll(/<span class="swap-summary__amount">(.*?)<\/span>/g)].map((m) => words(m[1]!));
  const least = /Asks for at least (.+?) ·/.exec(words(html))?.[1];
  return { pay: pay!, receive: receive!, least: least! };
}

const payloads = (type: string) => run.asked.filter((a) => a.type === type).map((a) => a.payload);
type BuildAsked = { quote: SwapQuote; display: { in: SwapSide; out: SwapSide }; through?: boolean };

/** An amount in the approval's words: "100 ₳", "906.5941 MIN". */
const amountText = (quantity: string, id: string, side: SwapSide) =>
  id === "lovelace" ? `${formatQuantity(quantity, 6)} ₳` : `${formatQuantity(quantity, side.decimals)} ${side.label}`;

/** Build `n` (from 0) of the funding, in the approval's words: the pair it was built for, and its quote's figures. */
function builtAs(n: number): { pay: string; receive: string; least: string } {
  const { quote, display } = payloads("session-out-build")[n] as BuildAsked;
  return {
    pay: amountText(quote.amountIn, quote.ask.tokenIn, display.in),
    receive: `≈ ${amountText(quote.amountOut, quote.ask.tokenOut, display.out)}`,
    least: amountText(quote.minAmountOut, quote.ask.tokenOut, display.out),
  };
}

/** The swap Start swap sent, in the same words: the build of the funding it submitted, with the pair it was built for. */
function sent(): { pay: string; receive: string; least: string } {
  const submitted = payloads("session-out-submit") as Array<{ txHash: string }>;
  expect(submitted.map((s) => s.txHash), "Start swap submits the one funding built").toEqual([TX]);
  return builtAs(payloads("session-out-build").length - 1);
}

/** The form set for `amount` ₳ → MIN, quoted. */
async function formForAdaToMin(amount = "100"): Promise<El> {
  let tree = draw();
  expect(tree.props.titleId).toBe("swap-title");
  expect(press(tokenButton(tree, "swap-to"))).toBe(true);
  tree = draw();
  expect(pick(tree, MIN)).toBe(true);
  tree = draw();
  typeAmount(tree, amount);
  tree = draw();
  return quoteLands();
}

/** The form set for 100 ₳ → MIN, quoted: Review swap's button is on. */
async function formFor100AdaToMin(): Promise<El> {
  const tree = await formForAdaToMin();
  const button = footButton(tree);
  expect(button?.props.disabled).toBe(false);
  expect(button?.props.children).toBe("Review swap");
  return tree;
}

/**
 * Review swap pressed, `during` done while its build is out, then the build lands. Once it's in, the screen names the
 * pair Start swap sends, or it's the form again with nothing sent. `before`: done once the approval is in, before Start
 * swap (a rebuild, say), which hands back the screen then.
 */
async function reviewWith(during: (tree: El) => Promise<El>, before?: (tree: El) => Promise<El>): Promise<void> {
  let tree = await formFor100AdaToMin();
  expect(reviewSwap(tree)).toBe(true);
  tree = await settle();
  // Building: the review's funding is out, and the form is still there.
  expect(payloads("session-out-build")).toHaveLength(1);
  expect(tree.props.titleId).toBe("swap-title");
  expect(footButton(tree)?.props.children).toBe("Building…");
  tree = await during(tree);
  finishBuild!();
  tree = await settle();
  if (tree.props.titleId !== "swap-fund-review") {
    // The build set aside: the form again, for its pair as it is now, and nothing sent.
    expect(tree.props.titleId).toBe("swap-title");
    expect(payloads("session-out-submit")).toEqual([]);
    return;
  }
  if (before) tree = await before(tree);
  const approval = shown(tree);
  expect(startSwap(tree)).toBe(true);
  await settle();
  expect(started, "Start swap started the session it funds").toEqual([2]);
  expect(approval, "the approval names the swap Start swap sends").toEqual(sent());
}

/** You receive changed to SNEK while the build is out, and SNEK's own quote lands on the form meanwhile. */
const toSnek = async (tree: El) => {
  press(tokenButton(tree, "swap-to"));
  tree = draw();
  pick(tree, SNEK);
  tree = draw();
  return quoteLands();
};

describe("a pick changed while the swap's review builds (chunk 51, e7a#1)", () => {
  it("control: nothing changed while it builds, the approval names the swap that's sent (100 ₳ → 906.5941 MIN)", async () => {
    await reviewWith(async (tree) => tree);
    expect(sent()).toEqual({ pay: "100 ₳", receive: "≈ 906.5941 MIN", least: "897.61792 MIN" });
  });

  it("You receive changed to SNEK while it builds: the screen never names SNEK over the ADA → MIN funding Start swap sends", async () => {
    await reviewWith(toSnek);
  });

  it("the round Switch pressed while it builds: the screen never says it pays MIN over a funding of ADA", async () => {
    await reviewWith(async (tree) => {
      press(switchButton(tree));
      tree = draw();
      return quoteLands();
    });
  });

  it("the approval's switch, a minute on, builds the swap the approval shows again, never the form's SNEK", async () => {
    await reviewWith(toSnek, async (tree) => {
      expect(shown(tree)).toEqual({ pay: "100 ₳", receive: "≈ 906.5941 MIN", least: "897.61792 MIN" });
      // Past the quote's minute: the rebuild asks Minswap again, for the swap shown.
      vi.advanceTimersByTime(61_000);
      const quotes = payloads("swap-quote").length;
      const approval = find(tree, (el) => el.type === SwapApproval)!;
      (approval.props.onThrough as (on: boolean) => void)(false);
      tree = await settle();
      expect(payloads("swap-quote").slice(quotes).map((a) => (a as SwapAsk).tokenOut)).toEqual([MIN]);
      expect(payloads("session-out-build")).toHaveLength(2);
      const again = payloads("session-out-build")[1] as BuildAsked;
      expect(again.quote.ask.tokenOut).toBe(MIN);
      expect(again.display.out.label).toBe("MIN");
      expect(again.through).toBe(false);
      finishBuild!();
      tree = await settle();
      expect(tree.props.titleId).toBe("swap-fund-review");
      expect(shown(tree)).toEqual(builtAs(1));
      return tree;
    });
    expect(sent()).toEqual({ pay: "100 ₳", receive: "≈ 906.5941 MIN", least: "897.61792 MIN" });
  });
});

describe("Review swap is pressed only where the funding pays (chunk 51, t1k#9)", () => {
  /** The form's foot button, as a person sees it: what it says, and whether it can be pressed. */
  const foot = (tree: El) => ({ label: footButton(tree)?.props.children, disabled: footButton(tree)?.props.disabled });

  it("is off, saying ADA is short, while the private balance can't pay the quote's funding and its 5 ₳ collateral", async () => {
    // 100 ₳ swapped asks 104 ₳ of funding beside the 5 ₳ collateral: 109 ₳, where 105 ₳ is held.
    props = { ...props, seedelf: balance("105000000") };
    const tree = await formForAdaToMin();
    expect(foot(tree)).toEqual({ label: "Not enough ADA", disabled: true });
    expect(reviewSwap(tree)).toBe(false);
    // 109 ₳ held pays it: on.
    props = { ...props, seedelf: balance("109000000") };
    expect(foot(draw())).toEqual({ label: "Review swap", disabled: false });
  });

  it("is off while the amount is more than the private balance holds", async () => {
    const tree = await formForAdaToMin("300");
    expect(payloads("swap-quote").map((a) => (a as SwapAsk).amount)).toContain("300000000");
    expect(foot(tree)).toEqual({ label: "Not enough ADA", disabled: true });
  });

  it("is off while Minswap doesn't verify the token", async () => {
    verified = false;
    const tree = await formForAdaToMin();
    expect(foot(tree)).toEqual({ label: "Not verified by Minswap", disabled: true });
  });

  it("builds nothing on a quote asked again at Review that the balance can't pay, and says so", async () => {
    // 112 ₳ held pays the quote shown (109 ₳ in all); a minute later Minswap's costs are up 4 ₳, to 113 ₳ in all.
    props = { ...props, seedelf: balance("112000000") };
    let tree = await formFor100AdaToMin();
    vi.advanceTimersByTime(61_000);
    costs = 8_000_000n;
    expect(reviewSwap(tree)).toBe(true);
    tree = await settle();
    expect(payloads("swap-quote")).toHaveLength(2);
    expect(payloads("session-out-build")).toEqual([]);
    expect(tree.props.titleId).toBe("swap-title");
    expect(foot(tree)).toEqual({ label: "Not enough ADA", disabled: true });
  });
});
