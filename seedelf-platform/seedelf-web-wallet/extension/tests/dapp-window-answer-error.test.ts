// Chunk 51, e3b#4: an approved request whose approval then fails is out of the worker's list by the time its error
// comes back (dapp.ts `answer`: taken out, the windows told, then `approve` refuses), and the connector's window kept
// that error, one state for every request, under the request after it: A's refusal sat in B's foot, role="alert", over
// B's Decline and Sign, and nothing said it was A's. The window's error now names the request it's about
// (DappApprovals.tsx's `error`), and shows on that one's screen alone. Once nothing's left, the window keeps it on
// purpose (its close timer waits on `!error`), which the last two cases pin.
//
// The worker is the real one (tests/fakes.ts): site X's transaction, then site Y's, wait, and the user locks the UTxO
// X's spends from the main window meanwhile (dapp-site-english.test.ts's case), then presses Sign on X's.
//
// Vitest has no DOM, and the house seam (screens-wiring-review-fixes.test.ts) can't carry a press past its await, so
// the window runs over a small hooks runtime of this test's own, behind `vi.mock("react")`: DappApprovals is called as
// the function it is, its hooks kept from one draw to the next, its effects run after each draw as React runs them
// (the last run's cleanup first, again only when a dependency changes), and state set by a press, an answer or a timer
// draws it again. React itself then renders what it drew, its children with React's own hooks, to read the error it
// shows. The worker's answer comes back on its own port and its "changed" on another, so either can land first: each
// order is run.
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DappSession } from "../src/background/dapp";
import type { Requests } from "../src/shared/rpc";

const hooks = vi.hoisted(() => {
  interface Slot {
    has?: boolean;
    value?: unknown;
    deps?: readonly unknown[];
    cleanup?: unknown;
  }
  const moved = (was: readonly unknown[] | undefined, now: readonly unknown[] | undefined) =>
    !was || !now || was.length !== now.length || now.some((d, i) => !Object.is(d, was[i]));
  const rt = {
    /** The test is drawing the window: its hooks are these then, React's own otherwise. */
    drawing: false,
    slots: [] as Slot[],
    at: 0,
    /** State was set since the last draw. */
    dirty: false,
    /** The draw's effects, run once it's made, as React runs them after it commits. */
    effects: [] as Array<() => void>,
    slot(): Slot {
      return (rt.slots[rt.at++] ??= {});
    },
    useReducer(reducer: (state: unknown, action: unknown) => unknown, arg: unknown, init?: (arg: unknown) => unknown) {
      const s = rt.slot();
      if (!s.has) {
        s.has = true;
        const dispatch = (action: unknown) => {
          const [was] = s.value as [unknown, unknown];
          const next = reducer(was, action);
          if (Object.is(next, was)) return;
          s.value = [next, dispatch];
          rt.dirty = true;
        };
        s.value = [init ? init(arg) : arg, dispatch];
      }
      return s.value;
    },
    useState(initial: unknown) {
      return rt.useReducer(
        (was, action) => (typeof action === "function" ? (action as (was: unknown) => unknown)(was) : action),
        initial,
        (arg) => (typeof arg === "function" ? (arg as () => unknown)() : arg),
      );
    },
    useRef(initial: unknown) {
      const s = rt.slot();
      if (!s.has) {
        s.has = true;
        s.value = { current: initial };
      }
      return s.value;
    },
    useMemo(make: () => unknown, deps?: readonly unknown[]) {
      const s = rt.slot();
      if (!s.has || moved(s.deps, deps)) {
        s.has = true;
        s.value = make();
        s.deps = deps;
      }
      return s.value;
    },
    useCallback(fn: unknown, deps?: readonly unknown[]) {
      return rt.useMemo(() => fn, deps);
    },
    useEffect(run: () => unknown, deps?: readonly unknown[]) {
      const s = rt.slot();
      if (s.has && !moved(s.deps, deps)) return;
      s.has = true;
      s.deps = deps;
      rt.effects.push(() => {
        if (typeof s.cleanup === "function") (s.cleanup as () => void)();
        s.cleanup = run();
      });
    },
    useContext(context: unknown) {
      return (context as { _currentValue: unknown })._currentValue;
    },
    useId() {
      const s = rt.slot();
      if (!s.has) {
        s.has = true;
        s.value = `:answer-error-${rt.at}:`;
      }
      return s.value;
    },
    useSyncExternalStore(_subscribe: unknown, snapshot: () => unknown) {
      return snapshot();
    },
    /** Runs every cleanup, as unmounting does, and forgets the window. */
    unmount() {
      for (const s of rt.slots) if (typeof s.cleanup === "function") (s.cleanup as () => void)();
      rt.slots = [];
      rt.effects = [];
      rt.dirty = false;
    },
  };
  return rt;
});

const harness = vi.hoisted(() => ({
  /** What the window's `call` asks the worker: `openWindow` sets it. */
  call: (() => new Promise<never>(() => undefined)) as (type: string, payload: unknown) => Promise<unknown>,
  /** The window's `onDappChanged` listeners. */
  heard: new Set<() => void>(),
  /** Every request the window made, by name. */
  asked: [] as string[],
}));

vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  const theirs = react as unknown as Record<string, (...args: unknown[]) => unknown>;
  const ours: Record<string, (...args: never[]) => unknown> = {
    useState: hooks.useState,
    useReducer: hooks.useReducer,
    useRef: hooks.useRef,
    useMemo: hooks.useMemo,
    useCallback: hooks.useCallback,
    useEffect: hooks.useEffect,
    useLayoutEffect: hooks.useEffect,
    useInsertionEffect: hooks.useEffect,
    useContext: hooks.useContext,
    useId: hooks.useId,
    useSyncExternalStore: hooks.useSyncExternalStore,
  };
  const swapped = Object.entries(ours).map(([name, mine]) => [
    name,
    (...args: unknown[]) => (hooks.drawing ? (mine as (...a: unknown[]) => unknown)(...args) : theirs[name]!(...args)),
  ]);
  return { ...react, ...Object.fromEntries(swapped) };
});

vi.mock("../src/ui/background", async (original) => ({
  ...(await original<typeof import("../src/ui/background")>()),
  call: (type: string, payload: unknown) => harness.call(type, payload),
  onDappChanged: (listener: () => void) => {
    harness.heard.add(listener);
    return () => void harness.heard.delete(listener);
  },
}));

const { DappApprovals } = await import("../src/ui/screens/DappApprovals");
const { NetworkContext } = await import("../src/ui/network");
const { i18n } = await import("../src/i18n/core");
const { TxSignError } = await import("../src/shared/dapp");
const { koiosPreprod, loadTestWasm, testBalances, vectors } = await import("./fakes");

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const OWN = account(12).preprod.receive_0 as string;
const THEIRS = account(15).preprod.receive_0 as string;

let pages = 0;
const site = (origin: string): DappSession => ({ id: `answer-error-${++pages}`, origin, title: "Example" });

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

const uint = (n: number) => (n < 24 ? n.toString(16).padStart(2, "0") : `18${n.toString(16).padStart(2, "0")}`);
const outpoints = (list: string[]) => `8${list.length}${list.map((o) => `825820${o.slice(0, 64)}${uint(Number(o.slice(65)))}`).join("")}`;

/** A site's transaction spending `inputs` and paying someone else 4 ₳. Nothing balances it: the wallet only reads it. */
function siteTx(inputs: string[]) {
  return `84a300${outpoints(inputs)}0181825839${loadTestWasm().cip30Address(THEIRS)}1a003d0900021a00029810a0f5f6`;
}

/** What the worker says of a transaction that spends a UTxO the user locked (dapp.ts keptApart), in English. */
const usesLocked = (utxo: string) =>
  i18n.t("dapp.usesLocked", { what: i18n.t("dapp.lockedOne", { first: utxo, lng: "en" }), them: i18n.t("dapp.it", { lng: "en" }), lng: "en" });

const decode = (html: string) =>
  html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** The page's text, without its tags. */
const text = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
/** The screen's error, where Screen shows it: in its foot, over its buttons, role="alert". */
const alertOf = (html: string) => {
  const found = /<p class="error" role="alert">([\s\S]*?)<\/p>/.exec(html)?.[1];
  return found === undefined ? undefined : decode(found);
};

/** Sites X and Y connected to the public account, with the password off for sites, and a UTxO for each to spend. */
async function twoSites() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  await t.preferences.set({ dappConnector: true, dappPassword: false, spendRewards: false });
  const template = Object.values(koiosPreprod.accounts)
    .flatMap((a) => a.account_utxos)
    .find((u) => u.address === OWN)!;
  t.koios.addedToAccounts.push({ ...template, tx_hash: "c0".repeat(32), tx_index: 0, value: "5000000", asset_list: [], block_height: 1 });
  const connect = async (s: DappSession) => {
    const enabling = t.dapp.call(s, "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    expect(await enabling).toBe(true);
    return s;
  };
  const x = await connect(site("https://x.example"));
  const y = await connect(site("https://y.example"));
  await t.balances.get("preprod");
  const [forA, forB] = (await t.coins.lists("preprod")).cardano.filter((u) => !u.collateral).map((u) => `${u.txHash}#${u.index}`);
  return { t, x, y, forA: forA!, forB: forB! };
}

type Element = ReactElement<Record<string, unknown>>;

/** Every element drawn, its props' elements too (a Screen's foot, a fragment's children). */
function* elements(node: unknown): Generator<Element> {
  if (Array.isArray(node)) {
    for (const child of node) yield* elements(child);
    return;
  }
  if (!isValidElement(node)) return;
  yield node as Element;
  for (const value of Object.values(node.props as Record<string, unknown>)) yield* elements(value);
}

/** The connector's window over `t`'s worker, which answers its requests as handlers.ts hands them on. */
function openWindow(t: ReturnType<typeof testBalances>) {
  let deliver!: () => void;
  const delivered = new Promise<void>((resolve) => (deliver = resolve));
  const replies: Array<Promise<Requests["dapp-answer"]["result"]>> = [];
  harness.call = (type, payload) => {
    harness.asked.push(type);
    if (type === "dapp-approvals") return Promise.resolve(structuredClone(t.dapp.approvals()));
    if (type === "dapp-close") return t.dapp.closeWindow();
    if (type === "dapp-answer") {
      const { id, approve, password, fund, governance } = payload as Requests["dapp-answer"]["payload"];
      const reply = t.dapp.answer(id, approve, password, fund, governance);
      replies.push(reply);
      // Its reply reaches the window when the test says: before the list it changed is read again, or after.
      return reply.then(async (r) => {
        await delivered;
        return structuredClone(r);
      });
    }
    return new Promise(() => undefined);
  };
  let drawn: ReactElement | undefined;
  const draw = () => {
    hooks.at = 0;
    hooks.dirty = false;
    hooks.drawing = true;
    try {
      drawn = DappApprovals();
    } finally {
      hooks.drawing = false;
    }
    for (const run of hooks.effects.splice(0)) run();
  };
  draw();
  return {
    /** Lets what's on its way land, drawing again whenever state was set, until nothing moves. */
    async settle() {
      for (let i = 0; i < 200; i++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (!hooks.dirty) return;
        draw();
      }
      throw new Error("the window never settled");
    },
    /** The request on screen: each one's Screen is keyed by its id; the empty window's has none. */
    shown: () => drawn?.key ?? null,
    /** What the window hands the screen it drew: a connect request's `onError`, say. */
    props: () => (drawn?.props ?? {}) as Record<string, unknown>,
    /** Presses Sign. */
    sign() {
      const button = [...elements(drawn)].find((e) => e.type === "button" && e.props.className === "primary");
      (button!.props.onClick as () => void)();
    },
    /** What the worker answered the press, before the window has it. */
    reply: () => replies[0]!,
    /** The worker's answer reaches the window. */
    deliver,
    /** The worker's "changed" reaches the window (sw.ts `broadcast(DAPP_CHANGED)`). */
    tell() {
      for (const heard of [...harness.heard]) heard();
    },
    /** What the window shows, as React renders it. */
    html: () => renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, drawn)),
  };
}

afterEach(() => {
  hooks.unmount();
  harness.heard.clear();
  harness.asked = [];
  vi.useRealTimers();
});

const ORDERS = ["the list first", "the answer first"] as const;

/** The worker's "changed" and its answer reach the window in `order`. */
async function land(win: ReturnType<typeof openWindow>, order: (typeof ORDERS)[number]) {
  if (order === "the list first") {
    win.tell();
    await win.settle();
    win.deliver();
  } else {
    win.deliver();
    await win.settle();
    win.tell();
  }
  await win.settle();
  // A request that takes another's place holds its buttons a second (HOLD_MS); an empty window closes after 0.8 s.
  vi.advanceTimersByTime(5_000);
  await win.settle();
}

describe("an approved request whose approval fails once the worker took it out of the list (chunk 51, e3b#4)", () => {
  for (const order of ORDERS) {
    it(`leaves its refusal off the next request's screen, over that one's Sign (${order})`, async () => {
      const { t, x, y, forA, forB } = await twoSites();
      const signingA = t.dapp.call(x, "signTx", [siteTx([forA]), false]).catch((e: unknown) => e);
      await until(() => t.dapp.approvals().length === 1);
      void t.dapp.call(y, "signTx", [siteTx([forB]), false]).catch(() => undefined);
      await until(() => t.dapp.approvals().length === 2);
      const [a, b] = t.dapp.approvals();
      // From the main window, while A waits: the user locks the UTxO A spends. B spends another.
      await t.coins.setLocked("preprod", "cardano", forA, true);

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const win = openWindow(t);
      await win.settle();
      expect(win.shown()).toBe(a!.id);
      const changed = t.dappChanged();
      win.sign();
      // The worker took A out of its list and told the windows, then A's approval refused.
      expect(await win.reply()).toEqual({ error: usesLocked(forA) });
      expect(t.dappChanged()).toBeGreaterThan(changed);
      expect(t.dapp.approvals().map((w) => w.id)).toEqual([b!.id]);
      await land(win, order);

      // B's screen, said to be the next request, with its Decline and Sign live.
      expect(win.shown()).toBe(b!.id);
      const html = win.html();
      expect(text(html)).toContain(i18n.t("dappUi.nextRequest", { lng: "en" }));
      expect(text(html)).toContain("y.example");
      expect(alertOf(html), "A's refusal, shown in B's foot as B's own").not.toBe(usesLocked(forA));
      expect(await signingA).toMatchObject({ failure: { code: TxSignError.ProofGeneration } });
    }, 60_000);
  }

  for (const order of ORDERS) {
    it(`keeps its refusal once nothing's left, the window staying to say it (${order})`, async () => {
      const { t, x, forA } = await twoSites();
      const signingA = t.dapp.call(x, "signTx", [siteTx([forA]), false]).catch((e: unknown) => e);
      await until(() => t.dapp.approvals().length === 1);
      await t.coins.setLocked("preprod", "cardano", forA, true);

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const win = openWindow(t);
      await win.settle();
      win.sign();
      expect(await win.reply()).toEqual({ error: usesLocked(forA) });
      await land(win, order);

      expect(win.shown()).toBeNull();
      expect(alertOf(win.html())).toBe(usesLocked(forA));
      expect(harness.asked).not.toContain("dapp-close");
      expect(await signingA).toMatchObject({ failure: { code: TxSignError.ProofGeneration } });
    }, 60_000);
  }

  // The same for an error a connect request hits itself (its reading of the private balance, its build, a send): it's
  // that request's, and the one that takes its place when its page goes away doesn't show it.
  it("keeps a connect request's own error on that request: the one that takes its place shows none", async () => {
    const { t, y, forB } = await twoSites();
    const z = site("https://z.example");
    void t.dapp.call(z, "enable", []).catch(() => undefined);
    await until(() => t.dapp.approvals().length === 1);
    void t.dapp.call(y, "signTx", [siteTx([forB]), false]).catch(() => undefined);
    await until(() => t.dapp.approvals().length === 2);
    const [a, b] = t.dapp.approvals();
    expect(a!.kind).toBe("connect");

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const win = openWindow(t);
    await win.settle();
    expect(win.shown()).toBe(a!.id);
    const failed = "The private balance couldn't be read.";
    (win.props().onError as (error?: string) => void)(failed);
    await win.settle();
    expect(alertOf(win.html())).toBe(failed);

    // Z's page goes away: Y's request is shown, its buttons held a moment, without Z's error.
    t.dapp.gone(z);
    win.tell();
    await win.settle();
    vi.advanceTimersByTime(5_000);
    await win.settle();
    expect(win.shown()).toBe(b!.id);
    expect(alertOf(win.html())).toBeUndefined();
  }, 60_000);
});
