// The worker's own guards in sw.ts, each pinned by a case that fails without it (chunk 51's T1j lens: t1j#1, #2, #6,
// #13). The real worker runs against a fake Chrome, as worker-language.test.ts has it; its background runs are counted
// rather than run (runs.ts has tests of its own), and its WebAssembly can be made to fail or trap on demand.
//
// The cases share one worker, as Chrome would: the first needs the worker's start to fail, so it goes first, and the
// trap's, which resets the WebAssembly instance, goes last.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { i18n } from "../src/i18n/core";
import { SITE_TRAPPED } from "../src/background/dapp";
import { APIError, DAPP_PORT } from "../src/shared/dapp";
import { UI_PORT } from "../src/shared/rpc";
import { loadTestWasm, vectors } from "./fakes";

/** The worker's WebAssembly: a failed load, or a trap in the address check, when asked for. */
const held = vi.hoisted(() => ({ wasm: undefined as unknown, fail: undefined as Error | undefined, trap: false }));
vi.mock("../src/background/wasm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/background/wasm")>()),
  loadWasm: async () => {
    if (held.fail) throw held.fail;
    return held.wasm;
  },
}));

/** The background runs, counted: how many began, how many go on at once, and a gate that holds them. */
const runs = vi.hoisted(() => ({ entries: 0, active: 0, most: 0, hold: undefined as Promise<void> | undefined }));
vi.mock("../src/background/runs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/background/runs")>()),
  runNetworks: async () => {
    runs.entries++;
    runs.active++;
    runs.most = Math.max(runs.most, runs.active);
    try {
      if (runs.hold) await runs.hold;
    } finally {
      runs.active--;
    }
  },
}));

const ID = "seedelfwalletid";
const PASSWORD = "correct horse battery";

/** A storage area as Chrome's: values are copies. */
function area(data: Map<string, unknown>) {
  const asked = (keys: unknown): string[] =>
    keys == null ? [...data.keys()] : typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
  return {
    async get(keys?: unknown) {
      return Object.fromEntries(asked(keys).filter((k) => data.has(k)).map((k) => [k, structuredClone(data.get(k))]));
    },
    async set(items: Record<string, unknown>) {
      for (const [k, v] of Object.entries(items)) data.set(k, structuredClone(v));
    },
    async remove(keys: string | string[]) {
      for (const k of [keys].flat()) data.delete(k);
    },
    async clear() {
      data.clear();
    },
    async setAccessLevel() {},
  };
}

/** The worker's end of a port: what the other end posts is `deliver`ed; what the worker answers is in `posted`. */
function port(name: string, sender: chrome.runtime.MessageSender) {
  const heard: Array<(m: unknown) => void> = [];
  const end = {
    name,
    sender,
    posted: [] as unknown[],
    disconnected: false,
    postMessage: (m: unknown) => void end.posted.push(structuredClone(m)),
    disconnect: () => void (end.disconnected = true),
    onMessage: { addListener: (l: (m: unknown) => void) => void heard.push(l) },
    onDisconnect: { addListener: () => undefined },
    deliver: (m: unknown) => heard.forEach((l) => l(m)),
  };
  return end;
}

const heard = { connect: [] as Array<(p: unknown) => void>, alarm: [] as Array<(a: { name: string }) => void> };

/** A page of the wallet's asks `message` on a port of its own, and gets its one answer. */
async function ask(message: object) {
  const page = port(UI_PORT, { id: ID, url: `chrome-extension://${ID}/index.html` });
  for (const l of heard.connect) l(page);
  page.deliver(message);
  await vi.waitFor(() => expect(page.posted).toHaveLength(1), { timeout: 30_000 });
  return page.posted[0] as { ok: boolean; value?: unknown; error?: string };
}

/** The connector's port from `sender`, as the bridge opens one, and a call on it. */
function site(sender: chrome.runtime.MessageSender, method = "notAMethod", id = "1") {
  const end = port(DAPP_PORT, sender);
  for (const l of heard.connect) l(end);
  end.deliver({ id, method, args: [] });
  return end;
}

/** The bridge's own content script, in a tab's top frame of `origin`. */
const tab = (origin: string): chrome.runtime.MessageSender => ({
  id: ID,
  url: `${origin}/`,
  origin,
  frameId: 0,
  tab: { title: "App" } as chrome.tabs.Tab,
});

beforeAll(async () => {
  const ignored = { addListener: () => undefined };
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
    },
    storage: { local: { ...area(new Map()), onChanged: ignored }, session: area(new Map()) },
    alarms: {
      create: async () => undefined,
      clear: async () => true,
      get: async () => undefined,
      onAlarm: { addListener: (l: (a: { name: string }) => void) => void heard.alarm.push(l) },
    },
    action: { onClicked: ignored },
    permissions: { onRemoved: ignored, contains: async () => true },
    windows: { onRemoved: ignored },
    i18n: { getUILanguage: () => "en-US" },
  });
  // The address check traps once when asked to (`held.trap`): a WebAssembly call outside the wallet's queue.
  const real = loadTestWasm();
  held.wasm = {
    ...real,
    checkPayableAddress: (...args: Parameters<typeof real.checkPayableAddress>) => {
      if (held.trap) {
        held.trap = false;
        throw new WebAssembly.RuntimeError("unreachable");
      }
      return real.checkPayableAddress(...args);
    },
  };
  await import("../src/background/sw");
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

describe("the worker's own guards (chunk 51, T1j)", () => {
  // t1j#2: whatever isn't a DappError may say anything, in the user's language (Koios's words, the lock's): a site
  // hears only that it wasn't answered, in English, or it learns the wallet's language and more.
  it("tells a site only that it wasn't answered, in English, when something other than the connector fails", async () => {
    held.fail = new Error("Koios no responde: inténtalo más tarde.");
    try {
      const end = site(tab("https://app.example"), "getBalance", "7");
      await vi.waitFor(() => expect(end.posted).toHaveLength(1), { timeout: 30_000 });
      expect(end.posted[0]).toEqual({ id: "7", error: { code: APIError.InternalError, info: SITE_TRAPPED("en") } });
    } finally {
      held.fail = undefined;
    }
  });

  // t1j#1: Chrome's registration keeps the bridge out of frames and plain-http pages; this is the second layer.
  it("serves the connector's port only to its own content script, in a tab's top frame, on https or a local page", () => {
    const refused = {
      "an iframe": { ...tab("https://app.example"), frameId: 1 },
      "another extension": { ...tab("https://app.example"), id: "anotherextension" },
      "no tab": { ...tab("https://app.example"), tab: undefined },
      "a plain-http page": tab("http://app.example"),
    };
    for (const [what, sender] of Object.entries(refused)) {
      const end = site(sender);
      expect(end.disconnected, what).toBe(true);
      expect(end.posted, what).toEqual([]);
    }
    const unknown = { code: APIError.InvalidRequest, info: i18n.t("dapp.unknownMethod", { lng: "en" }) };
    for (const origin of ["https://app.example", "http://localhost:5173", "http://127.0.0.1:8080"]) {
      const end = site(tab(origin));
      expect(end.disconnected, origin).toBe(false);
      expect(end.posted, origin).toEqual([{ id: "1", error: unknown }]);
    }
  });

  // t1j#13: two runs at once sent two withdraws seconds apart (launch review #37). One at a time, and one asked for
  // meanwhile (the unlock's, the alarm's) goes once the first is done.
  it("lets one background run go at a time, and runs once more if one was asked for meanwhile", async () => {
    let release!: () => void;
    runs.hold = new Promise<void>((r) => (release = r));
    runs.entries = 0;
    runs.most = 0;
    const alarm = (name: string) => heard.alarm.forEach((l) => l({ name }));
    alarm("seedelf.sessions");
    await vi.waitFor(() => expect(runs.active).toBe(1), { timeout: 30_000 });
    // Asked again while the first is held: it waits its turn.
    alarm("seedelf.sessions");
    alarm("seedelf.sessions");
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
    expect(runs.most).toBe(1);
    runs.hold = undefined;
    release();
    // The one asked for meanwhile, once, after the first.
    await vi.waitFor(() => expect(runs.entries).toBe(2), { timeout: 30_000 });
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
    expect(runs.entries).toBe(2);
    expect(runs.most).toBe(1);
  });

  // t1j#6: a trap leaves the WebAssembly instance broken for good. One under a page's request, outside the wallet's
  // queue (the address check), locks the wallet as one inside it does: unlocked on the broken instance, the keys
  // would stay in its memory (launch review #17's class).
  it("locks the wallet when WebAssembly traps under a page's request outside the wallet's queue", async () => {
    const phrase = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase as string;
    expect(await ask({ type: "create-wallet", phrase, password: PASSWORD })).toMatchObject({ ok: true, value: { state: "unlocked" } });
    held.trap = true;
    // The worker is on the build's first network, as a wallet with no network kept starts (mainnet, or preprod in a
    // preprod-only build): an address on it reaches the address check.
    const start = __MAINNET_ENABLED__ ? "mainnet" : "preprod";
    const resolved = await ask({ type: "resolve-destination", to: vectors("cardano_account.json")[0]![start].receive_0 });
    expect(resolved).toEqual({ ok: false, error: i18n.t("worker.wallet.trapped") });
    expect(await ask({ type: "status" })).toMatchObject({ ok: true, value: { state: "locked", lockedBy: "trap" } });
  });
});
