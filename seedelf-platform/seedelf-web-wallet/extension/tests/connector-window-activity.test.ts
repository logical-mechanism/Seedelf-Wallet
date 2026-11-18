// The connector's window and auto-lock (chunk 51, e4b#1). A site's `enable()` opens the connector's window (dapp.ts
// `ask` → dapp-window.ts `show`: a new focused popup when none is open), and that window is App at `?view=dapp`, which
// told the worker the user was active the moment it mounted unlocked, before anything was pressed. The site then
// reloads: its request ends with no refusal (`gone`), the empty window closes itself after 0.8 s, and the next
// `enable()` opens a new window, which reported again. Done every 14 minutes, the 15-minute auto-lock never came. The
// connector's window counts only input (a click or a key) as activity, never its own opening, which a site can cause.
//
// Vitest has no DOM, so App runs over the house's seam (tests/screens-wiring-review-fixes.test.ts): App's own effects
// run during renderToStaticMarkup, again only when their dependencies change; `call` answers at once, so the status
// lands in the same render; what App draws under it is made as nothing. What the page sends the worker through
// ui/background.ts's own `call` (reportActivity's) is read off chrome's port.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => {
  type Ok = ((value: unknown) => unknown) | null | undefined;
  type No = ((error: unknown) => unknown) | null | undefined;
  /** A thenable that answers at once, as `call` does here: an effect's `.then` lands in the same render. */
  interface Answer {
    then(ok?: Ok, no?: No): Answer;
    catch(no: No): Answer;
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
      then: (_ok, no) => (no ? lift(no(error)) : failed(error)),
      catch: (no) => (no ? lift(no(error)) : failed(error)),
      finally: (done) => {
        done();
        return failed(error);
      },
    };
  }
  /** Never answers: a request the test leaves unanswered. */
  const pending: Answer = { then: () => pending, catch: () => pending, finally: () => pending };

  const state = {
    /** The components whose own effects run: App's alone, never a child's or a custom hook's. */
    effects: new Set<string>(["App"]),
    /** Components made as nothing: everything App draws sits under AccountsProvider. */
    stubbed: new Set<string>(["AccountsProvider"]),
    /** What the worker answers, by request. */
    answers: new Map<string, unknown>(),
    /** App's own requests, through the `call` it imports, in order. */
    asked: [] as string[],
    /** What went out on chrome's ports: ui/background.ts's own `call`, which reportActivity uses. */
    posted: [] as string[],
    /** The page's window listeners, by event. */
    listeners: new Map<string, Array<() => void>>(),

    call(type: string): Answer {
      state.asked.push(type);
      return state.answers.has(type) ? lift(state.answers.get(type)) : pending;
    },

    /** The JSX runtime's element factories, with `stubbed` in them. */
    runtime<R extends Record<string, unknown>>(runtime: R): R {
      const named = (type: unknown) => (typeof type === "string" ? type : typeof type === "function" ? type.name : "");
      const Stub = () => null;
      const wrap =
        (create: (...args: unknown[]) => unknown) =>
        (type: unknown, ...rest: unknown[]) =>
          create(state.stubbed.has(named(type)) ? Stub : type, ...rest);
      const out: Record<string, unknown> = { ...runtime };
      for (const key of ["jsx", "jsxs", "jsxDEV"]) if (typeof runtime[key] === "function") out[key] = wrap(runtime[key] as (...args: unknown[]) => unknown);
      return out as R;
    },
  };
  return state;
});

vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  /** Who called the effect: the frame after the seam's own, a component's name or a hook's. */
  const caller = () => {
    const frames = (new Error().stack ?? "").split("\n");
    const at = frames.findIndex((f) => f.includes("seamEffect"));
    return /at (?:[\w$]+\.)*([\w$]+)/.exec(frames[at + 1] ?? "")?.[1] ?? "";
  };
  /** useEffect and useLayoutEffect, run during the render for the components under test, again only when a dependency changes. */
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
  return { ...react, useEffect: seamEffect, useLayoutEffect: seamEffect };
});
vi.mock("react/jsx-runtime", async (original) => seam.runtime(await original<Record<string, unknown>>()));
vi.mock("react/jsx-dev-runtime", async (original) => seam.runtime(await original<Record<string, unknown>>()));
// App's own requests answer at once; reportActivity keeps ui/background.ts's own `call`, which goes out on chrome's port.
vi.mock("../src/ui/background", async (original) => ({
  ...(await original<typeof import("../src/ui/background")>()),
  call: (type: string) => seam.call(type),
}));

const noop = () => undefined;
const event = { addListener: noop, removeListener: noop };

// The connector's window, as dapp-window.ts opens it: ui/view.ts reads the URL as it loads.
vi.stubGlobal("location", { search: "?view=dapp", hash: "", pathname: "/index.html", href: "chrome-extension://seedelf/index.html?view=dapp" });
vi.stubGlobal("history", { state: null, replaceState: noop });
vi.stubGlobal("window", {
  addEventListener: (type: string, listener: () => void) => seam.listeners.set(type, [...(seam.listeners.get(type) ?? []), listener]),
  removeEventListener: (type: string, listener: () => void) =>
    seam.listeners.set(type, (seam.listeners.get(type) ?? []).filter((l) => l !== listener)),
});
vi.stubGlobal("chrome", {
  runtime: {
    id: "seedelf",
    lastError: undefined,
    getURL: (path: string) => `chrome-extension://seedelf/${path}`,
    connect: () => ({
      onMessage: event,
      onDisconnect: event,
      postMessage: (message: { type?: unknown }) => void seam.posted.push(String(message?.type)),
      disconnect: noop,
    }),
    onMessage: event,
  },
  permissions: { contains: async () => true, onAdded: event, onRemoved: event },
});

const { App } = await import("../src/ui/App");
const { connectorWindow } = await import("../src/ui/view");

/** The test's clock. */
const NOW = Date.UTC(2026, 10, 17, 12);
/** The wallet unlocked, as the worker's `status` says it. */
const UNLOCKED = { state: "unlocked", version: "1.9.1", network: "preprod", networks: ["mainnet", "preprod"], retryAfterMs: 0 };

/** Every `activity` the page sent the worker, by either road. */
const activity = () => [...seam.asked, ...seam.posted].filter((type) => type === "activity");

/** The connector's window opening, as a site's `enable()` opens it while the wallet is unlocked. */
function open(at: number) {
  vi.useFakeTimers({ toFake: ["Date"], now: at });
  seam.asked = [];
  seam.posted = [];
  seam.listeners.clear();
  seam.answers.set("status", UNLOCKED);
  renderToStaticMarkup(createElement(App));
}

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("the connector's window and auto-lock (chunk 51, e4b#1)", () => {
  it("doesn't count its own opening, which any site's enable() causes, as the user's activity", () => {
    open(NOW);
    // The page is the connector's window, and its effects ran: it asked for the status, which says unlocked.
    expect(connectorWindow).toBe(true);
    expect(seam.asked).toContain("status");
    // Nothing was pressed in it: nothing may tell the worker the user is there, or a site that opens the window
    // every 14 minutes keeps a 15-minute lock from ever coming.
    expect(activity()).toEqual([]);
  });

  it("still counts a click in it as activity, as on every page", () => {
    // Ten minutes on: what the first opening did is past reportActivity's 30 s throttle.
    open(NOW + 10 * 60_000);
    const before = activity().length;
    const presses = seam.listeners.get("pointerdown") ?? [];
    expect(presses.length).toBeGreaterThan(0);
    // A click, past the throttle of anything sent as the window opened.
    vi.setSystemTime(NOW + 10 * 60_000 + 31_000);
    for (const press of presses) press();
    expect(activity().length - before).toBe(1);
  });
});
