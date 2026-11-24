// Seedelf Messaging as the real worker wires it (sw.ts, the 1.10.0 gate's round 5): the kept contract view's read takes
// Messages' admit check into the wallet's queue, and a page's poll is answered with how long until the worker's one grid's
// next tick. The worker runs against a fake Chrome, as worker-guards.test.ts has it; the service it builds is kept here.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { i18n } from "../src/i18n/core";
import { MESSAGING_SYNC_EVERY_MS, UI_PORT } from "../src/shared/rpc";
import { NotAdmitted } from "../src/background/wallet";
import type { MessagingDeps } from "../src/background/messaging";
import { loadTestWasm, vectors } from "./fakes";

const held = vi.hoisted(() => ({ wasm: undefined as unknown, deps: undefined as unknown }));
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
  }
  return { ...real, MessagingService: Kept };
});

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
      onAlarm: ignored,
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
});
