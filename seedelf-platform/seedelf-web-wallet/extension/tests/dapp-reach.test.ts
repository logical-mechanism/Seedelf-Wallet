// Blind test §9.2 (T15): with the connector just turned on, a site already
// open still found no wallet until it was reloaded, since registered content
// scripts reach only pages loaded after. Turning it on now puts the scripts
// in the pages open then, with the access Chrome already gave, and nothing
// more; a page that has them keeps one copy.
//
// The cross-area review: a page holding an earlier version's scripts, cut
// off by an update, would have got a second bridge, and every call would go
// on to the worker while the first bridge told the site to reload. A page
// whose own world has `window.cardano.seedelf` already is left alone.
import { afterEach, describe, expect, it, vi } from "vitest";

import { reachOpenPages } from "../src/background/connector";
import { handle, type Context } from "../src/background/handlers";
import { PreferencesService } from "../src/background/preferences";
import { CONTENT_SCRIPTS, DAPP_ORIGINS, PAGE_CHANNEL } from "../src/shared/dapp";
import { memoryArea, testWallet } from "./fakes";

const original = {
  chrome: (globalThis as { chrome?: unknown }).chrome,
  window: (globalThis as { window?: unknown }).window,
  location: (globalThis as { location?: unknown }).location,
};

afterEach(() => {
  Object.assign(globalThis, original);
  vi.resetModules();
});

describe("turning the connector on reaches the pages open then", () => {
  function fakeChrome(granted = true) {
    const injected: Array<{ tabId: number; file: string; world: string }> = [];
    const queried: unknown[] = [];
    const tabs = [
      { id: 1, url: "https://dapp.example/market" },
      { id: 2, url: "https://asleep.example/", discarded: true },
      { id: 3, url: "http://localhost:5173/" },
      { id: 4, url: "https://chromewebstore.google.com/detail/x" },
      { id: 5 },
      { id: 6, url: "http://plain.example/" },
      // Loaded while the connector was on, perhaps before an update: its entry is there already.
      { id: 7, url: "https://had-it.example/" },
    ];
    const probed: number[] = [];
    (globalThis as { chrome?: unknown }).chrome = {
      permissions: { contains: async ({ origins }: { origins: string[] }) => granted && origins === DAPP_ORIGINS },
      tabs: {
        query: async (q: unknown) => {
          queried.push(q);
          return tabs;
        },
      },
      scripting: {
        executeScript: async ({
          target,
          files,
          world,
          func,
        }: {
          target: { tabId: number };
          files?: string[];
          world: string;
          func?: () => boolean;
        }) => {
          if (target.tabId === 4) throw new Error("The extensions gallery cannot be scripted.");
          if (func) {
            // The probe runs in the page's own world, and touches nothing.
            expect(world).toBe("MAIN");
            probed.push(target.tabId);
            return [{ frameId: 0, result: target.tabId === 7 }];
          }
          injected.push({ tabId: target.tabId, file: files![0]!, world });
          return [];
        },
      },
    };
    return { injected, queried, probed };
  }

  it("puts both scripts in the top frame of each https or localhost page Chrome lets it into", async () => {
    const { injected, queried, probed } = fakeChrome();
    expect(await reachOpenPages()).toBe(2);
    expect(queried).toEqual([{ url: DAPP_ORIGINS }]);
    // Each page it could reach is asked first; the one that has the entry gets nothing more.
    expect(probed.sort()).toEqual([1, 3, 7]);
    const both = (tabId: number) => CONTENT_SCRIPTS.map((s) => ({ tabId, file: s.file, world: s.world }));
    // Not a sleeping tab (it loads the registered ones as it wakes), the Web Store, a tab it can't read, or plain http.
    // Tabs are reached side by side; each one's two scripts in turn.
    expect(injected.filter((x) => x.tabId === 1)).toEqual(both(1));
    expect(injected.filter((x) => x.tabId === 3)).toEqual(both(3));
    expect(injected).toHaveLength(4);
  });

  it("does nothing without Chrome's access to sites", async () => {
    const { injected, queried } = fakeChrome(false);
    expect(await reachOpenPages()).toBe(0);
    expect(queried).toEqual([]);
    expect(injected).toEqual([]);
  });

  it("is asked for once the switch is on and working, and never when it stays off", async () => {
    const reach = vi.fn(async () => 1);
    const { wallet } = testWallet();
    const ctx = {
      wallet,
      preferences: new PreferencesService(memoryArea()),
      connector: async (on: boolean) => on,
      reachOpenPages: reach,
      dapp: { connectorOff: () => undefined },
      version: "1.0.0",
      network: "preprod",
      networks: ["preprod"],
    } as unknown as Context;
    await handle({ type: "preferences-set", dappConnector: true }, ctx);
    expect(reach).toHaveBeenCalledTimes(1);
    await handle({ type: "preferences-set", dappConnector: false }, ctx);
    expect(reach).toHaveBeenCalledTimes(1);
    // Chrome's access missing: the switch goes back off, and no page is reached.
    await handle({ type: "preferences-set", dappConnector: true }, { ...ctx, connector: async () => false });
    expect(reach).toHaveBeenCalledTimes(1);
  });
});

describe("the bridge, put in a page twice", () => {
  it("relays each call once", async () => {
    const listeners: Array<(event: unknown) => void> = [];
    const sent: unknown[] = [];
    const page = {
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        if (type === "message") listeners.push(listener);
      },
      postMessage: () => undefined,
    };
    (globalThis as { window?: unknown }).window = page;
    (globalThis as { location?: unknown }).location = { origin: "https://dapp.example" };
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        connect: () => ({
          onMessage: { addListener: () => undefined },
          onDisconnect: { addListener: () => undefined },
          postMessage: (call: unknown) => sent.push(call),
        }),
      },
    };
    await import("../src/content/bridge");
    vi.resetModules();
    await import("../src/content/bridge");
    expect(listeners).toHaveLength(1);
    listeners[0]!({ source: page, origin: "https://dapp.example", data: { [PAGE_CHANNEL]: "request", id: "a", method: "getNetworkId", args: [] } });
    expect(sent).toEqual([{ id: "a", method: "getNetworkId", args: [] }]);
  });
});
