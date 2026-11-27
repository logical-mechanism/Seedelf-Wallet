// Seedelf Messaging as the real worker wires it (sw.ts, the 1.10.0 gate's round 5): the kept contract view's read takes
// Messages' admit check into the wallet's queue, and a page's poll is answered with how long until the worker's one grid's
// next tick. The worker runs against a fake Chrome, as worker-guards.test.ts has it; the service it builds is kept here.
// And 1.10.0's second review: the alarm's run says it's the alarm's (F1), an unlock's doesn't. The fake Chrome tells the
// worker's `storage.local.onChanged` listeners of each write, as Chrome does, and every `fetch` is the test's own:
// nothing here reaches a server.
//
// And the worker is never kept alive (the same review's F0, taken out again: the owner's call, 2026-11-24). For a while
// a timer called an extension API every 20 seconds while the wallet was unlocked with Messages on, so that every read
// of the relay came from a running worker. Chrome's guide to extension service workers ("Keep a service worker alive
// continuously") allows that on managed enterprise or education devices only: "It is not allowed in other cases and the
// Chrome extension team reserves the right to take action against those extensions in the future." So Chrome stops
// this worker about 30 seconds after its last activity, the minute's alarm or a page starts it again, and the last
// tests here fail if a call that exists to reset Chrome's idle timer comes back on a timer.
import { readdirSync, readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { i18n } from "../src/i18n/core";
import { MESSAGING_SYNC_EVERY_MS, UI_PORT } from "../src/shared/rpc";
import { NotAdmitted } from "../src/background/wallet";
import type { MessagingDeps } from "../src/background/messaging";
import { loadTestWasm, vectors } from "./fakes";

const held = vi.hoisted(() => ({
  wasm: undefined as unknown,
  deps: undefined as unknown,
  /** What each run of `syncAll` was told of itself. */
  runs: [] as Array<{ alarm?: boolean }>,
  /** How many times the worker made the one trivial call to an extension API it has (`getPlatformInfo`). */
  pings: 0,
  alarms: [] as Array<(alarm: { name: string }) => void>,
  session: new Map<string, unknown>(),
  local: new Map<string, unknown>(),
  /** The worker's listeners for chrome.storage.local's changes. */
  changed: [] as Array<(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) => void>,
  /** Every `fetch` the worker made: answered here, as a server that can't be reached. */
  fetched: [] as string[],
}));
vi.mock("../src/background/wasm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/background/wasm")>()),
  loadWasm: async () => held.wasm,
}));
vi.mock("../src/background/runs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/background/runs")>()),
  runNetworks: async () => undefined,
}));
// The service the worker builds, with what it was given.
vi.mock("../src/background/messaging", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/background/messaging")>();
  class Kept extends real.MessagingService {
    constructor(deps: MessagingDeps) {
      super(deps);
      held.deps = deps;
    }
    override syncAll(networks: Parameters<InstanceType<typeof real.MessagingService>["syncAll"]>[0], from?: { alarm?: boolean }) {
      held.runs.push(from ?? {});
      return super.syncAll(networks, from);
    }
  }
  return { ...real, MessagingService: Kept };
});
const ID = "seedelfwalletid";
const PASSWORD = "correct horse battery";

/** A storage area as Chrome's: values are copies, and `changed`'s listeners are told of each write that changes one. */
function area(data: Map<string, unknown>, changed: typeof held.changed = []) {
  const tell = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) => {
    if (Object.keys(changes).length) for (const l of [...changed]) l(changes);
  };
  const asked = (keys: unknown): string[] =>
    keys == null ? [...data.keys()] : typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
  return {
    async get(keys?: unknown) {
      return Object.fromEntries(asked(keys).filter((k) => data.has(k)).map((k) => [k, structuredClone(data.get(k))]));
    },
    async set(items: Record<string, unknown>) {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [k, v] of Object.entries(items)) {
        const old = data.get(k);
        if (JSON.stringify(old) !== JSON.stringify(v)) changes[k] = { ...(data.has(k) ? { oldValue: old } : {}), newValue: structuredClone(v) };
        data.set(k, structuredClone(v));
      }
      tell(changes);
    },
    async remove(keys: string | string[]) {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const k of [keys].flat()) {
        if (data.has(k)) changes[k] = { oldValue: data.get(k) };
        data.delete(k);
      }
      tell(changes);
    },
    async clear() {
      data.clear();
    },
    async setAccessLevel() {},
    async getBytesInUse() {
      return 0;
    },
  };
}

const heard = { connect: [] as Array<(p: unknown) => void> };

/** A page of the wallet's asks `message` on a port of its own, and gets its one answer. */
async function ask(message: object) {
  const posted: unknown[] = [];
  const listeners: Array<(m: unknown) => void> = [];
  const page = {
    name: UI_PORT,
    sender: { id: ID, url: `chrome-extension://${ID}/index.html` },
    postMessage: (m: unknown) => void posted.push(structuredClone(m)),
    disconnect: () => undefined,
    onMessage: { addListener: (l: (m: unknown) => void) => void listeners.push(l) },
    onDisconnect: { addListener: () => undefined },
  };
  for (const l of heard.connect) l(page);
  for (const l of listeners) l(message);
  await vi.waitFor(() => expect(posted).toHaveLength(1), { timeout: 30_000 });
  return posted[0] as { ok: boolean; value?: unknown; error?: string };
}

beforeAll(async () => {
  const ignored = { addListener: () => undefined };
  // No request leaves the test: the relay the worker reads once a Messages switch is on can't be reached.
  vi.stubGlobal("fetch", async (input: unknown) => {
    held.fetched.push(String(input instanceof Request ? input.url : input));
    throw new TypeError("Failed to fetch");
  });
  vi.stubGlobal("chrome", {
    runtime: {
      id: ID,
      lastError: undefined,
      getURL: (path: string) => `chrome-extension://${ID}/${path}`,
      onConnect: { addListener: (l: (p: unknown) => void) => void heard.connect.push(l) },
      onInstalled: ignored,
      onStartup: ignored,
      sendMessage: async () => undefined,
      reload: () => undefined,
      // The one trivial call the worker has: a post's solve's, between its slices (messaging.ts `solve`). Never here.
      getPlatformInfo: async () => {
        held.pings++;
        return { os: "linux" };
      },
    },
    storage: {
      local: {
        ...area(held.local, held.changed),
        onChanged: { addListener: (l: (typeof held.changed)[number]) => void held.changed.push(l) },
      },
      session: area(held.session),
    },
    alarms: {
      create: async () => undefined,
      clear: async () => true,
      get: async () => undefined,
      onAlarm: { addListener: (l: (alarm: { name: string }) => void) => void held.alarms.push(l) },
    },
    action: { onClicked: ignored },
    permissions: { onRemoved: ignored, contains: async () => true },
    windows: { onRemoved: ignored },
    i18n: { getUILanguage: () => "en-US" },
  });
  held.wasm = loadTestWasm();
  await import("../src/background/sw");
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

describe("Messages as the worker wires it (round 5)", () => {
  it("the kept contract view's read takes Messages' admit check: turned away, it doesn't run", async () => {
    const phrase = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase as string;
    expect(await ask({ type: "create-wallet", phrase, password: PASSWORD })).toMatchObject({ ok: true, value: { state: "unlocked" } });
    const deps = held.deps as MessagingDeps;
    expect(deps).toBeDefined();
    await expect(deps.ownSeedelfs("preprod", false, () => false)).rejects.toBeInstanceOf(NotAdmitted);
    // Let through: the view as kept, here none.
    await expect(deps.ownSeedelfs("preprod", false, () => true)).resolves.toBeUndefined();
    await expect(deps.ownSeedelfs("preprod", false)).resolves.toBeUndefined();
  });

  it("a page's poll is answered with how long until the grid's next tick", async () => {
    const first = await ask({ type: "messaging-sync", page: "page-1", kind: "view" });
    expect(first.ok).toBe(true);
    const { nextIn } = first.value as { nextIn: number };
    expect(nextIn).toBeGreaterThan(0);
    expect(nextIn).toBeLessThanOrEqual(MESSAGING_SYNC_EVERY_MS);
    // A second page is on the first one's grid: the same tick, so no further off.
    const second = (await ask({ type: "messaging-sync", page: "page-2", kind: "view" })).value as { nextIn: number };
    expect(second.nextIn).toBeLessThanOrEqual(nextIn);
    expect(nextIn - second.nextIn).toBeLessThan(5000);
  });

  it("the alarm's run says it's the alarm's, and the unlock's doesn't (1.10.0's second review, F1)", async () => {
    // The unlock's run, as the wallet was made: told nothing of itself.
    expect(held.runs.length).toBeGreaterThan(0);
    expect(held.runs.every((from) => from.alarm !== true)).toBe(true);
    const before = held.runs.length;
    for (const l of held.alarms) l({ name: "seedelf.messaging" });
    await vi.waitFor(() => expect(held.runs.length).toBe(before + 1), { timeout: 30_000 });
    expect(held.runs.at(-1)).toEqual({ alarm: true });
    // Another alarm's minute is no run of Messages'.
    for (const l of held.alarms) l({ name: "seedelf.auto-lock" });
    await new Promise((r) => setTimeout(r, 50));
    expect(held.runs.length).toBe(before + 1);
  });

  it("a switch on, an alarm and a page's requests: only the relay is asked, and no call is made to keep the worker alive", async () => {
    expect((await ask({ type: "messaging-switch", on: true, network: "preprod" })).ok).toBe(true);
    expect((await ask({ type: "messaging" })).ok).toBe(true);
    const before = held.runs.length;
    for (const l of held.alarms) l({ name: "seedelf.messaging" });
    await vi.waitFor(() => expect(held.runs.length).toBe(before + 1), { timeout: 30_000 });
    await vi.waitFor(() => expect(held.fetched.length).toBeGreaterThan(0), { timeout: 30_000 });
    expect((await ask({ type: "lock" })).ok).toBe(true);
    // Nothing in this file reached a server: every request was the relay's, answered here: its pool's pages, and the
    // certificate list read at the switch with the wallet's own certificate posted (chunk 55's 55e).
    for (const url of held.fetched) expect(url).toMatch(/\/messaging\/v1\/preprod\/(envelopes|certificates)/);
    // Unlocked with a Messages switch on, through an alarm and a lock: the trivial call was never made.
    expect(held.pings).toBe(0);
  });
});

describe("the worker is never kept alive (Chrome's rule; the owner's call, 2026-11-24)", () => {
  const dir = new URL("../src/background/", import.meta.url);
  /** The worker's sources, their comments taken out: what runs. */
  const sources = readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name, code: readFileSync(new URL(name, dir), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "") }));
  const code = (name: string) => sources.find((s) => s.name === name)!.code;
  const using = (pattern: RegExp) => sources.filter((s) => pattern.test(s.code)).map((s) => s.name);

  it("no file of the worker's sets an interval, opens a port to stay up, or is a keep-alive's", () => {
    expect(sources.length).toBeGreaterThan(40);
    expect(sources.map((s) => s.name).filter((name) => /keep.?(warm|alive)/i.test(name))).toEqual([]);
    expect(using(/\bsetInterval\s*\(/)).toEqual([]);
    expect(using(/chrome\.runtime\.connect\s*\(/)).toEqual([]);
    // sw.ts, where Chrome's events are heard and its APIs handed out, sets no timer at all.
    expect(code("sw.ts")).not.toMatch(/\bset(Timeout|Interval)\s*\(/);
  });

  it("the one trivial call to an extension API is `keepAlive`, a solve's own, made by its loop between slices and nothing else", () => {
    // Allowed by name, and nothing else: `getPlatformInfo` asks no server and does nothing but reset Chrome's idle
    // timer. It's in the worker once, handed to Messages as `keepAlive`, which only `solve` calls: between the slices
    // of a post's or a first message's work, at most every 10 seconds, after asking whether the work is still wanted.
    // That is the guide's pattern for a bounded task ("Keep a service worker alive until a long-running operation is
    // finished"), not the continuous keep-alive it forbids: no timer makes the call, so it ends with the solve
    // (messaging-solve-keep-alive.test.ts holds when it's made and what ends it).
    expect(using(/getPlatformInfo/)).toEqual(["sw.ts"]);
    expect(code("sw.ts").match(/getPlatformInfo/g)).toHaveLength(1);
    expect(code("sw.ts")).toMatch(/keepAlive: \(\) => chrome\.runtime\.getPlatformInfo\(\)/);
    expect(using(/\bkeepAlive\b/).sort()).toEqual(["messaging.ts", "sw.ts"]);
    const messaging = code("messaging.ts");
    // Called in one place, inside `solve`, after the look at whether the work is still wanted, and on no timer.
    const uses = [...messaging.matchAll(/deps\.keepAlive\b/g)].map((m) => m.index);
    expect(uses).toHaveLength(1);
    const from = messaging.indexOf("private async solve(");
    const to = messaging.indexOf("\n  }\n", from);
    expect(from).toBeGreaterThan(0);
    const solve = messaging.slice(from, to);
    expect(uses[0]! > from && uses[0]! < to).toBe(true);
    expect(solve).not.toMatch(/\bset(Timeout|Interval)\s*\(/);
    expect(solve.indexOf("await wanted()")).toBeGreaterThan(0);
    expect(solve.indexOf("await wanted()")).toBeLessThan(solve.indexOf("deps.keepAlive"));
  });

  it("the files that set a timer at all are the ones known: a new one is read against Chrome's rule before it's added here", () => {
    // Each of these waits (a request's timeout, a pause between two requests, a turn of the event loop): none calls an
    // extension API from a timer to stay alive. The keep-alive that was taken out lived in a file of its own, its timer
    // there and its call in sw.ts: a new file with a timer fails here first.
    expect(using(/\bsetTimeout\s*\(/).sort()).toEqual(["dapp.ts", "koios.ts", "lovejoin.ts", "messaging.ts", "relay.ts", "sessions.ts", "spent.ts"]);
  });
});
