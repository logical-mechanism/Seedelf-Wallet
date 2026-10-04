// The worker speaks the user's language (sw.ts). Nothing in it used to start
// the language, so every message it sends a page or a site, about 300 of
// them, reached a Spanish or Japanese wallet in English. This runs the real
// worker against a fake Chrome whose read of the stored language is held
// back: an answer that went out before the read ends would be English, so
// a worker that stops waiting for its language fails here, not in a review.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { i18n } from "../src/i18n/core";
import { APIError, DAPP_PORT } from "../src/shared/dapp";
import { LOCAL_LANGUAGE } from "../src/shared/preferences";
import { UI_PORT } from "../src/shared/rpc";
import { loadTestWasm } from "./fakes";

// The worker loads its WebAssembly from the build's file; here it's the module the other tests load.
const held = vi.hoisted(() => ({ wasm: undefined as unknown }));
vi.mock("../src/background/wasm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/background/wasm")>()),
  loadWasm: async () => held.wasm,
}));

const ID = "seedelfwalletid";
type Changes = Record<string, chrome.storage.StorageChange>;

/** A storage area as Chrome's: values are copies, and a read of `gated` waits for `gate`. */
function area(data: Map<string, unknown>, gated?: string, gate?: Promise<void>) {
  const asked = (keys: unknown): string[] =>
    keys == null ? [...data.keys()] : typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
  return {
    async get(keys?: unknown) {
      if (gated && asked(keys).includes(gated)) await gate;
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

/** One end of a port, the worker's: what the page or site posts is `deliver`ed, and what the worker answers is in `posted`. */
function port(name: string, sender: chrome.runtime.MessageSender) {
  const heard: Array<(m: unknown) => void> = [];
  const end = {
    name,
    sender,
    posted: [] as unknown[],
    postMessage: (m: unknown) => void end.posted.push(structuredClone(m)),
    disconnect: () => undefined,
    onMessage: { addListener: (l: (m: unknown) => void) => void heard.push(l) },
    onDisconnect: { addListener: () => undefined },
    deliver: (m: unknown) => heard.forEach((l) => l(m)),
  };
  return end;
}

const local = new Map<string, unknown>([[LOCAL_LANGUAGE, "es"]]);
const heard = { connect: [] as Array<(p: unknown) => void>, local: [] as Array<(changes: Changes) => void> };
let open!: () => void;

/** A page of the wallet's asks the worker `message`, on a port of its own. */
function ask(message: object) {
  const page = port(UI_PORT, { id: ID, url: `chrome-extension://${ID}/index.html` });
  for (const l of heard.connect) l(page);
  page.deliver(message);
  return page;
}

beforeAll(async () => {
  const gate = new Promise<void>((r) => (open = r));
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
    },
    storage: {
      local: { ...area(local, LOCAL_LANGUAGE, gate), onChanged: { addListener: (l: (c: Changes) => void) => void heard.local.push(l) } },
      session: area(new Map()),
    },
    alarms: { create: async () => undefined, clear: async () => true, get: async () => undefined, onAlarm: ignored },
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

describe("the worker's language", () => {
  it("is the one stored, and nothing the worker says goes out before it has it", async () => {
    const page = ask({ type: "account" });
    // A site's call the wallet doesn't know is answered before the worker starts anything else: it waits too.
    const site = port(DAPP_PORT, {
      id: ID,
      url: "https://app.example/",
      origin: "https://app.example",
      frameId: 0,
      tab: { title: "App" } as chrome.tabs.Tab,
    });
    for (const l of heard.connect) l(site);
    site.deliver({ id: "1", method: "notAMethod", args: [] });

    // The stored language is still being read: neither has its answer.
    await new Promise((r) => setTimeout(r, 50));
    expect(page.posted).toEqual([]);
    expect(site.posted).toEqual([]);

    open();
    await vi.waitFor(() => expect(page.posted).toHaveLength(1));
    await vi.waitFor(() => expect(site.posted).toHaveLength(1));
    // No wallet here: the account is refused as locked, in Spanish.
    expect(page.posted[0]).toEqual({ ok: false, error: "La billetera está bloqueada." });
    expect(site.posted[0]).toEqual({ id: "1", error: { code: APIError.InvalidRequest, info: i18n.t("dapp.unknownMethod", { lng: "es" }) } });
    expect(i18n.t("dapp.unknownMethod", { lng: "es" })).not.toBe(i18n.t("dapp.unknownMethod", { lng: "en" }));
  });

  it("follows the one a page chooses after", async () => {
    // Settings' picker writes the choice; Chrome tells the worker.
    local.set(LOCAL_LANGUAGE, "ja");
    for (const l of heard.local) l({ [LOCAL_LANGUAGE]: { oldValue: "es", newValue: "ja" } });
    await vi.waitFor(() => expect(i18n.language).toBe("ja"));
    const page = ask({ type: "account" });
    await vi.waitFor(() => expect(page.posted).toHaveLength(1));
    expect(page.posted[0]).toEqual({ ok: false, error: "ウォレットはロックされています。" });
  });
});
