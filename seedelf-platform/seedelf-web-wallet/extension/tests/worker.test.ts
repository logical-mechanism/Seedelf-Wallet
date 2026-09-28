// The worker's boundary with the wallet's pages and with Chrome: UI requests
// travel on a port only the worker listens for, never to other pages, and the
// dApp connector stays off where Chrome won't keep content scripts out of
// local storage.
import { afterEach, describe, expect, it, vi } from "vitest";

import { handle, type Context } from "../src/background/handlers";
import { PreferencesService } from "../src/background/preferences";
import { guardedConnector, keepStorageFromSites } from "../src/background/storage-access";
import { serveUi } from "../src/background/ui-port";
import { STATE_CHANGED, UI_PORT, type Message, type Status } from "../src/shared/rpc";
import { call, onStateChanged } from "../src/ui/background";
import { memoryArea, testWallet } from "./fakes";

const ID = "seedelfwalletid";
const ORIGIN = `chrome-extension://${ID}/`;
const PAGE: chrome.runtime.MessageSender = { id: ID, url: `${ORIGIN}index.html#tab` };

interface FakePort {
  name: string;
  sender?: chrome.runtime.MessageSender;
  other?: FakePort;
  posted: unknown[];
  disconnected: boolean;
  postMessage(m: unknown): void;
  disconnect(): void;
  onMessage: { addListener(l: (m: unknown) => void): void };
  onDisconnect: { addListener(l: () => void): void };
  /** What the other end posted, arriving. */
  deliver(m: unknown): void;
  /** The other end went away. */
  close(): void;
}

/** One end of a port: what the other end posts arrives here, in a later task, as Chrome delivers it. */
function end(name: string, sender?: chrome.runtime.MessageSender): FakePort {
  const heard: Array<(m: unknown) => void> = [];
  const closed: Array<() => void> = [];
  const port: FakePort = {
    name,
    sender,
    posted: [] as unknown[],
    disconnected: false,
    postMessage(m: unknown) {
      port.posted.push(m);
      const other = port.other;
      if (other) setTimeout(() => other.deliver(structuredClone(m)));
    },
    disconnect() {
      if (port.disconnected) return;
      port.disconnected = true;
      const other = port.other;
      if (other) setTimeout(() => other.close());
    },
    onMessage: { addListener: (l: (m: unknown) => void) => void heard.push(l) },
    onDisconnect: { addListener: (l: () => void) => void closed.push(l) },
    deliver: (m: unknown) => heard.forEach((l) => l(m)),
    close: () => closed.forEach((l) => l()),
  };
  return port;
}

/**
 * Chrome's runtime for a wallet page and the worker: `connect` reaches the
 * worker's onConnect only; `sendMessage` reaches every other page's onMessage.
 */
function fakeRuntime(worker: (port: chrome.runtime.Port) => void) {
  const pages: Array<(m: unknown) => void> = [];
  const runtime = {
    id: ID,
    lastError: undefined,
    delivered: [] as unknown[],
    connect: vi.fn(({ name }: { name: string }) => {
      const page = end(name);
      const theirs = end(name, PAGE);
      page.other = theirs;
      theirs.other = page;
      worker(theirs as unknown as chrome.runtime.Port);
      return page;
    }),
    sendMessage: vi.fn(async (m: unknown) => {
      runtime.delivered.push(m);
      for (const l of pages) l(m);
    }),
    onMessage: {
      addListener: (l: (m: unknown) => void) => void pages.push(l),
      removeListener: (l: (m: unknown) => void) => void pages.splice(pages.indexOf(l), 1),
    },
  };
  vi.stubGlobal("chrome", { runtime });
  return runtime;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UI requests", () => {
  it("go on a port only the worker hears: no other page sees the password", async () => {
    const answered: Message[] = [];
    const runtime = fakeRuntime((port) =>
      serveUi(port, ORIGIN, async (m) => {
        answered.push(m);
        return { unlocked: true };
      }),
    );
    // Another open wallet page: everything its listener is handed, and its state-changed handler.
    const heard: unknown[] = [];
    chrome.runtime.onMessage.addListener((m: unknown) => void heard.push(m));
    const changed = vi.fn();
    onStateChanged(changed);

    expect(await call("unlock", { password: "correct horse battery" })).toEqual({ unlocked: true });
    expect(answered).toEqual([{ type: "unlock", password: "correct horse battery" }]);
    expect(runtime.connect).toHaveBeenCalledWith({ name: UI_PORT });
    expect(runtime.sendMessage).not.toHaveBeenCalled();
    expect(heard).toEqual([]);

    // The worker's broadcasts, which carry nothing, still reach every page.
    await runtime.sendMessage(STATE_CHANGED);
    expect(heard).toEqual([STATE_CHANGED]);
    expect(changed).toHaveBeenCalledOnce();
  });

  it("carry the worker's refusal, and say so when the worker never answers", async () => {
    fakeRuntime((port) =>
      serveUi(port, ORIGIN, async () => {
        throw new Error("The wallet is locked.");
      }),
    );
    await expect(call("account", {})).rejects.toThrow("The wallet is locked.");

    // A worker that drops the port unanswered (it stopped, say).
    fakeRuntime((port) => port.disconnect());
    await expect(call("status", {})).rejects.toThrow("didn't answer");
  });

  it("are served only to the extension's own pages, one reply each", async () => {
    vi.stubGlobal("chrome", { runtime: { id: ID } });
    const answer = vi.fn(async () => "fine");

    // Another port is left to its own listener.
    expect(serveUi(end("seedelf.cip30", PAGE) as unknown as chrome.runtime.Port, ORIGIN, answer)).toBe(false);

    // A content script (a site's page) and another extension are closed unanswered.
    for (const sender of [
      { id: ID, url: "https://evil.example/" },
      { id: "anotherextension", url: `chrome-extension://anotherextension/index.html` },
      undefined,
    ]) {
      const port = end(UI_PORT, sender);
      expect(serveUi(port as unknown as chrome.runtime.Port, ORIGIN, answer)).toBe(true);
      port.deliver({ type: "status" });
      expect(port.disconnected).toBe(true);
    }
    expect(answer).not.toHaveBeenCalled();

    const port = end(UI_PORT, PAGE);
    serveUi(port as unknown as chrome.runtime.Port, ORIGIN, answer);
    port.deliver({ type: "no-such-request" });
    port.deliver({ type: "status" });
    await vi.waitFor(() => expect(port.posted).toHaveLength(2));
    expect(port.posted).toEqual([
      { ok: false, error: "unknown request" },
      { ok: true, value: "fine" },
    ]);

    // A page that went away before its answer gets none.
    const gone = end(UI_PORT, PAGE);
    serveUi(gone as unknown as chrome.runtime.Port, ORIGIN, answer);
    gone.deliver({ type: "status" });
    gone.close();
    await new Promise((r) => setTimeout(r));
    expect(gone.posted).toEqual([]);
  });
});

describe("the dApp connector on a Chrome that leaves local storage open to content scripts", () => {
  const area = (answer: "yes" | "refuses" | "missing") => ({
    setAccessLevel:
      answer === "missing"
        ? undefined
        : vi.fn(async () => {
            if (answer === "refuses") throw new Error("This StorageArea is not available for setting access level");
          }),
  });

  it("is recorded when the worker starts", async () => {
    const yes = { local: area("yes"), session: area("yes") };
    expect(await keepStorageFromSites(yes as never)).toBe(true);
    expect(yes.local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
    expect(yes.session.setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });

    // Only local storage's answer matters: session storage is trusted-only already.
    const old = { local: area("refuses"), session: area("yes") };
    expect(await keepStorageFromSites(old as never)).toBe(false);
    expect(old.session.setAccessLevel).toHaveBeenCalled();
    expect(await keepStorageFromSites({ local: area("missing"), session: area("missing") } as never)).toBe(false);
    expect(await keepStorageFromSites({ local: area("yes"), session: area("refuses") } as never)).toBe(true);
  });

  it("keeps the connector off, and the status says why", async () => {
    const apply = vi.fn(async (on: boolean) => on);
    const { wallet } = testWallet();
    const preferences = new PreferencesService(memoryArea());
    const ctx = {
      wallet,
      preferences,
      connector: guardedConnector(Promise.resolve(false), apply),
      connectorBlocked: "storage",
      version: "1.0.0",
      network: "preprod",
      networks: ["preprod"],
    } as unknown as Context;

    // Turned on, its scripts are never registered, and the switch goes back off.
    expect(await handle({ type: "preferences-set", dappConnector: true }, ctx)).toMatchObject({ dappConnector: false });
    expect(apply).toHaveBeenCalledWith(false);
    expect(apply).not.toHaveBeenCalledWith(true);
    expect(((await handle({ type: "status" }, ctx)) as Status).connectorBlocked).toBe("storage");

    // Where Chrome did it, the switch works.
    const working = { ...ctx, connector: guardedConnector(Promise.resolve(true), apply), connectorBlocked: undefined } as Context;
    expect(await handle({ type: "preferences-set", dappConnector: true }, working)).toMatchObject({ dappConnector: true });
    expect(apply).toHaveBeenLastCalledWith(true);
    expect(await handle({ type: "status" }, working)).not.toHaveProperty("connectorBlocked");
  });
});
