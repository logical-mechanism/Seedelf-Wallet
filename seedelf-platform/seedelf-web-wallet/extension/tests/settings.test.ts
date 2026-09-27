// Settings' sections, rendered as the page renders them: the network switch
// of a build with both networks, the preprod strip every screen shows, and
// Lovejoin's, on each network it's on, with what a mix costs there and that
// it has had no third-party audit.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { Status } from "../src/shared/rpc";
import { NetworkBadge, TestNetworkStrip } from "../src/ui/components/NetworkBadge";

let Settings: typeof import("../src/ui/screens/Settings");

beforeAll(async () => {
  // The page's view (ui/view.ts) is read from its URL when the module loads.
  vi.stubGlobal("location", { search: "?view=tab", hash: "" });
  Settings = await import("../src/ui/screens/Settings");
});

/** The text a person reads, without the markup. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&#x27;/g, "'");

const status = (network: "mainnet" | "preprod", networks: Array<"mainnet" | "preprod">): Status => ({
  state: "unlocked",
  version: "1.0.0",
  network,
  networks,
  retryAfterMs: 0,
});

describe("Settings' network switch", () => {
  const render = (s: Status) => text(renderToStaticMarkup(createElement(Settings.NetworkSection, { status: s, onMoved: () => undefined })));

  it("is there only in a build with both networks, mainnet first", () => {
    expect(render(status("preprod", ["preprod"]))).toBe("");
    const shown = render(status("mainnet", ["mainnet", "preprod"]));
    expect(shown).toContain("Cardano network");
    expect(shown.indexOf("Mainnet")).toBeLessThan(shown.indexOf("Preprod"));
    expect(shown).toContain("ADA here is real money");
  });

  it("says on preprod, and before moving there, that its ADA has no value", () => {
    expect(render(status("preprod", ["mainnet", "preprod"]))).toContain("ADA here is test ADA, with no value");
    expect(Settings.MOVE_TO.preprod).toContain("Preprod is Cardano's test network. ADA there is test ADA, with no value");
    expect(Settings.MOVE_TO.mainnet).toContain("ADA there is real money");
  });
});

describe("Settings' dApp connector", () => {
  const html = (blocked?: "storage") => renderToStaticMarkup(createElement(Settings.DappConnector, { blocked, onSites: () => undefined }));
  const connectorSwitch = (h: string) => /<button[^>]*aria-labelledby="dapp-connector-label"[^>]*>/.exec(h)![0];

  it("says why it stays off where Chrome won't protect the wallet's storage, and can't be turned on", () => {
    const blocked = html("storage");
    expect(text(blocked)).toContain("it stays off in this version of Chrome: it can't keep websites away from the wallet's storage");
    expect(connectorSwitch(blocked)).toContain('aria-checked="false"');
    expect(connectorSwitch(blocked)).toContain("disabled");
  });

  it("is off, and says what turning it on does, elsewhere", () => {
    const off = html();
    expect(text(off)).toContain("Off: sites can't see Seedelf Wallet.");
    expect(text(off)).not.toContain("this version of Chrome");
  });
});

describe("the network on every screen", () => {
  it("marks preprod with a strip that test ADA has no value, and mainnet with its badge alone", () => {
    expect(text(renderToStaticMarkup(createElement(TestNetworkStrip, { network: "preprod" })))).toContain(
      "Preprod, Cardano's test network: ADA here is test ADA, with no value.",
    );
    expect(renderToStaticMarkup(createElement(TestNetworkStrip, { network: "mainnet" }))).toBe("");
    expect(text(renderToStaticMarkup(createElement(NetworkBadge, { network: "preprod" })))).toContain("PREPROD");
  });
});

describe("Settings' Lovejoin section", () => {
  it("prices each depth at what a mix measured on that network", () => {
    expect([1, 2, 3].map((d) => Settings.depthCost("preprod", d as 1 | 2 | 3))).toEqual([
      "1 mix, about 0.9 ₳",
      "4 mixes, about 3.5 ₳",
      "13 mixes, about 11.4 ₳",
    ]);
    expect([1, 2, 3].map((d) => Settings.depthCost("mainnet", d as 1 | 2 | 3))).toEqual([
      "1 mix, about 0.8 ₳",
      "4 mixes, about 3.3 ₳",
      "13 mixes, about 10.7 ₳",
    ]);
  });

  it("says on both networks that Lovejoin has had no third-party audit, and on mainnet that it waits for its pool's floor", () => {
    const mainnet = text(renderToStaticMarkup(createElement(Settings.LovejoinSettings, { network: "mainnet" })));
    const preprod = text(renderToStaticMarkup(createElement(Settings.LovejoinSettings, { network: "preprod" })));
    for (const shown of [mainnet, preprod]) {
      expect(shown).toContain("Lovejoin hasn't had a third-party audit");
      expect(shown).not.toMatch(/\baudited\b/);
    }
    expect(mainnet).toContain("The wallet mixes only once Lovejoin's pool holds 30 boxes that aren't yours");
    expect(mainnet).toContain("about 3.3 ₳");
    expect(preprod).not.toContain("pool holds");
    expect(preprod).toContain("about 3.5 ₳");
  });
});
