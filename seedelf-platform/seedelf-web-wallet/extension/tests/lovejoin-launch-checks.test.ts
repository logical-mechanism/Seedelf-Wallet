// Start a pool's checks before Review (chunk 51, t1l#20): a token pool's quantity, a box under the least or over the
// most the worker gives, an ADA pool at the classic 10 ₳, a copy of a pool shown already, and a box left empty, each
// said under Review, which is off, before the build would say it. No test held any of them: with every check gone, the
// press reached the build, which checks them again, after it.
//
// The terms come from a request the form asks once typing pauses, so a static render never has them: a small hook
// runner calls LovejoinLaunch as React would, each change drawn again and its effects run, and what a person does goes
// through the elements' own handlers, as tests/swap-form-review.test.ts drives the swap form.
import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LovejoinLaunchTerms } from "../src/shared/rpc";

/** One of LovejoinLaunch's hooks, by its place in the order it calls them: a state, an effect, a memo, a ref. */
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
    active: false,
    slots: [] as Slot[],
    at: 0,
    due: [] as Array<() => void>,
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
    if (!answer) return new Promise(() => undefined);
    try {
      return Promise.resolve(answer(payload));
    } catch (e) {
      return Promise.reject(e);
    }
  },
}));

const { t } = await import("../src/i18n");
const { NetworkContext } = await import("../src/ui/network");
const { AdaInput } = await import("../src/ui/components/AdaInput");
const { AmountField } = await import("../src/ui/components/AmountField");
const { tokenKey } = await import("../src/ui/format");
const { listedTokens } = await import("../src/ui/tokens");
const { LovejoinLaunch } = await import("../src/ui/screens/LovejoinLaunch");

type El = ReactElement<Record<string, unknown>>;

const seedelf = { lovelace: "500000000", utxos: 3, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 }, tokens: [] };
/** A v2 ADA pool of 25 ₳ a box, shown already. */
const SHOWN = { id: "f5".repeat(28), version: "v2", box: { lovelace: "25000000" }, others: 40, free: 40, floor: 30, boxes: [], lovelace: "0", due: [], notMixed: [], fromPublic: [] };
let props: Parameters<typeof LovejoinLaunch>[0];

/**
 * What the worker answers of a box: 5 ₳ the least for ADA and 1.5 ₳ its network minimum, and for a token 2 ₳ the least,
 * 1.6 ₳ the minimum and 100 ₳ the most.
 */
const terms = (payload: unknown): LovejoinLaunchTerms =>
  (payload as { token?: unknown }).token
    ? { least: "2000000", minimum: "1600000", suggested: "2500000", most: "100000000", pools: [] }
    : { least: "5000000", minimum: "1500000", suggested: "6000000", pools: [] };

beforeEach(() => {
  run.reset();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  run.contexts.set(NetworkContext, "preprod");
  run.answers.set("lovejoin-launch-terms", terms);
  props = { seedelf, pools: [SHOWN as never], holdings: [], onBack: () => undefined, onOpenPool: () => undefined, onSent: () => undefined };
});

afterEach(() => {
  vi.useRealTimers();
});

function draw(): El {
  for (let pass = 0; pass < 30; pass++) {
    run.at = 0;
    run.dirty = false;
    run.active = true;
    let tree: El;
    try {
      tree = LovejoinLaunch(props) as El;
    } finally {
      run.active = false;
    }
    for (const effect of run.due.splice(0)) effect();
    if (!run.dirty) return tree;
  }
  throw new Error("LovejoinLaunch kept changing");
}

/** Typing pauses: the terms' timer goes off, the worker's answer lands, and it's drawn again. */
async function termsLand(): Promise<El> {
  vi.advanceTimersByTime(400);
  await new Promise<void>((resolve) => setImmediate(resolve));
  return draw();
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
const byTestId = (tree: El, id: string) => find(tree, (el) => el.props["data-testid"] === id);

/** What the form says under Review, and whether Review can be pressed; pressed where it can, whether it built. */
function review(tree: El): { why?: string; disabled: boolean; built: boolean } {
  const button = byTestId(tree, "lovejoin-launch-review-button")!;
  const why = byTestId(tree, "lovejoin-launch-why")?.props.children as string | undefined;
  const disabled = !!button.props.disabled;
  if (!disabled) (button.props.onClick as () => void)();
  return { why, disabled, built: run.asked.some((a) => a.type === "lovejoin-launch-build") };
}

/** The box's ADA typed, and the token's quantity where there's a field for it. */
async function typed(tree: El, box: string, quantity?: string): Promise<El> {
  if (quantity !== undefined) (find(tree, (el) => el.type === AmountField)!.props.onChange as (v: string) => void)(quantity);
  tree = draw();
  (find(tree, (el) => el.type === AdaInput)!.props.onChange as (v: string) => void)(box);
  tree = draw();
  return termsLand();
}

/** The form for an ADA pool, its terms in. */
const adaForm = async () => {
  draw();
  return termsLand();
};

/** The form for the first token the wallet lists on preprod, its terms in. */
async function tokenForm(): Promise<El> {
  const tree = await adaForm();
  const [token] = listedTokens("preprod");
  (byTestId(tree, "lovejoin-launch-token")!.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: tokenKey(token!) } });
  draw();
  return termsLand();
}

describe("Start a pool's checks before Review (chunk 51, t1l#20)", () => {
  it("control: a box at the least or above builds", async () => {
    expect(review(await typed(await adaForm(), "6"))).toEqual({ why: undefined, disabled: false, built: true });
  });

  it("an ADA pool at the classic pool's 10 ₳", async () => {
    expect(review(await typed(await adaForm(), "10"))).toEqual({ why: t("lj.launch.classicCopy"), disabled: true, built: false });
  });

  // Chunk 51, gap-g8#6 (the owner's B2): under S0d's least is a pool one_shot_mint takes, and its review says so; only a
  // box under the network's minimum, which no mix could make, is refused.
  it("a box under the least builds, and its review says so", async () => {
    expect(review(await typed(await adaForm(), "4"))).toEqual({ why: undefined, disabled: false, built: true });
  });

  it("a box under the network's minimum", async () => {
    expect(review(await typed(await adaForm(), "1.2"))).toEqual({ why: t("lj.launch.belowMinimum", { minimum: "1.5" }), disabled: true, built: false });
  });

  it("a copy of a pool shown already", async () => {
    expect(review(await typed(await adaForm(), "25"))).toEqual({ why: t("lj.launch.copy"), disabled: true, built: false });
  });

  it("a box left empty", async () => {
    expect(review(await typed(await adaForm(), ""))).toEqual({ why: t("lovejoin.launch.needBox"), disabled: true, built: false });
  });

  it("a token pool with no quantity, and a box over a token pool's most", async () => {
    let tree = await tokenForm();
    expect(review(tree)).toEqual({ why: t("lovejoin.launch.needQuantity"), disabled: true, built: false });
    tree = await typed(tree, "150", "100");
    expect(review(tree)).toEqual({ why: t("lj.launch.tooMuch", { most: "100" }), disabled: true, built: false });
  });
});
