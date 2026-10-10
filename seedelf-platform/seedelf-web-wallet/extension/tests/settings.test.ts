// Settings' sections, rendered as the page renders them: the network switch
// of a build with both networks, the preprod strip every screen shows,
// Lovejoin's, on each network it's on, with what a mix costs there and that
// it has had no third-party audit, and Connected sites' Disconnect, which
// waits while a site's private session has something on its way.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { DappSite, SessionView, Status } from "../src/shared/rpc";
import { NetworkBadge, TestNetworkStrip } from "../src/ui/components/NetworkBadge";
import { PreferencesContext } from "../src/ui/preferences";

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
    expect(render(status("preprod", ["mainnet", "preprod"]))).toContain("ADA here has no value");
    expect(Settings.MOVE_TO.preprod).toContain("Preprod ADA has no value, and real ADA sent to a preprod address is lost.");
    expect(Settings.MOVE_TO.mainnet).toContain("Mainnet ADA is real money");
  });

  it("says before moving to preprod to test with a phrase not used on mainnet (privacy review §6)", () => {
    expect(Settings.MOVE_TO.preprod).toContain("Anyone can link one phrase's wallets on both networks, so test with another phrase.");
  });
});

describe("Settings' dApp connector", () => {
  const html = (blocked?: "storage") => renderToStaticMarkup(createElement(Settings.DappConnector, { blocked, onSites: () => undefined }));
  const connectorSwitch = (h: string) => /<button[^>]*aria-labelledby="dapp-connector-label"[^>]*>/.exec(h)![0];

  it("says why it stays off where Chrome won't protect the wallet's storage, and can't be turned on", () => {
    const blocked = html("storage");
    expect(text(blocked)).toContain("Off in this version of Chrome, which can't keep sites away from your encrypted wallet's storage.");
    expect(connectorSwitch(blocked)).toContain('aria-checked="false"');
    expect(connectorSwitch(blocked)).toContain("disabled");
  });

  it("is off, and says what turning it on does, elsewhere", () => {
    const off = html();
    expect(text(off)).toContain("Off: sites can't see Seedelf Wallet.");
    expect(text(off)).not.toContain("this version of Chrome");
  });

  it("says that once it's on, every https site can see the wallet is there, connected or not (privacy review §2.20)", () => {
    const off = text(html());
    expect(off).toContain(
      "Once on, every https site and its scripts can tell you use it, pages already open too, but not your addresses until you connect.",
    );
    expect(off).not.toContain("That's all it adds");
  });
});

describe("the network on every screen", () => {
  it("marks preprod with a strip that test ADA has no value, and mainnet with its badge alone", () => {
    expect(text(renderToStaticMarkup(createElement(TestNetworkStrip, { network: "preprod" })))).toContain(
      "Test network: ADA here has no value.",
    );
    expect(renderToStaticMarkup(createElement(TestNetworkStrip, { network: "mainnet" }))).toBe("");
    expect(text(renderToStaticMarkup(createElement(NetworkBadge, { network: "preprod" })))).toContain("PREPROD");
  });
});

describe("Settings' Lovejoin section", () => {
  it("prices each depth as the Lovejoin page and its reviews do, on either network (chunk 23's second review, LJ-3)", () => {
    for (const network of ["preprod", "mainnet"] as const) {
      expect([1, 2, 3].map((d) => Settings.depthCost(network, d as 1 | 2 | 3))).toEqual([
        "1 mix, about 0.95\u00a0₳",
        "4 mixes, about 3.8\u00a0₳",
        "13 mixes, about 12.35\u00a0₳",
      ]);
    }
  });

  it("says on both networks that Lovejoin has had no third-party audit, and on mainnet that it waits for its pool's floor", () => {
    const mainnet = text(renderToStaticMarkup(createElement(Settings.LovejoinSettings, { network: "mainnet" })));
    const preprod = text(renderToStaticMarkup(createElement(Settings.LovejoinSettings, { network: "preprod" })));
    for (const shown of [mainnet, preprod]) {
      expect(shown).toContain("Lovejoin has had no third-party audit");
      expect(shown).not.toMatch(/\baudited\b/);
    }
    expect(mainnet).toContain("The wallet mixes only once the pool holds 30 boxes not yours");
    expect(mainnet).toContain("about 3.8 ₳");
    expect(preprod).not.toContain("pool holds");
    expect(preprod).toContain("about 3.8 ₳");
  });
});

describe("Settings' Lovejoin switch (privacy review §4.1)", () => {
  const section = (lovejoinReturns: boolean) =>
    renderToStaticMarkup(
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: { ...DEFAULT_PREFERENCES, lovejoinReturns }, loaded: true, set: async () => undefined } },
        createElement(Settings.LovejoinSettings, { network: "mainnet" }),
      ),
    );

  it("is on by default, with depth and wait to choose, and says how far a box hides", () => {
    expect(DEFAULT_PREFERENCES.lovejoinReturns).toBe(true);
    const html = section(true);
    expect(html).toMatch(/role="switch"[^>]*aria-checked="true"/);
    expect(html).not.toMatch(/<select[^>]*disabled/);
    const shown = text(html);
    expect(shown).toContain("Bring private sessions back through Lovejoin");
    expect(shown).toContain("Each swap and return can still come back directly, if you choose.");
    expect(shown).toContain("mixed in 10 ₳ boxes so it's harder to tie to them");
    expect(shown).not.toContain("isn't tied");
    // What counts as spare, what bringing a box back costs, and that a lock stops a chain (privacy review §6).
    expect(shown).toContain("a token→ADA swap's proceeds included");
    expect(shown).toContain("plus about 0.3 ₳ a box to bring it back");
    expect(shown).toContain("Mixes and returns run only while the wallet is unlocked.");
    // What a lock partway does is the wait's ⓘ, whose text is its icon's title until opened (copy-trim pass).
    expect(html.replaceAll("&#x27;", "'")).toContain("Locked partway, a swap or a mix returns the rest directly");
    // Not from the services that carry both ends (privacy review §2.4).
    expect(shown).toContain("Lovejoin hides your boxes from people reading the chain, not from the server or giveme.my");
    // Each depth's option is short enough for the side panel; how far it hides is the note's (chunk 23's review, SET-2).
    expect(shown).toContain("2 waves deep: 4 mixes, about 3.8 ₳");
    expect(shown).not.toContain("(up to 1 in 9)");
    expect(shown).toContain("Yours is one of up to 9 boxes at 2 waves deep, fewer while few people use Lovejoin");
  });

  it("off, disables depth and wait, and says what's lost and what's saved", () => {
    const html = section(false);
    expect(html).toMatch(/role="switch"[^>]*aria-checked="false"/);
    expect(html.match(/<select[^>]*disabled=""/g)).toHaveLength(2);
    const shown = text(html);
    expect(shown).toContain("Off, a session's ADA comes back directly: anyone can tie it to the session");
    expect(shown).toContain("It saves each box's mixes (4 mixes, about 3.8 ₳)");
    expect(shown).toContain("A mix from the Lovejoin tile still mixes");
  });
});

describe("Settings' Connected sites (launch review H7)", () => {
  const publicSite: DappSite = { origin: "https://pay.example", connectedAt: 0 };
  const sessionSite: DappSite = { origin: "https://app.example", connectedAt: 0, session: 4 };
  /** A site's private session, funded, holding nothing, as the device's record has it (not read from Koios). */
  const session = (over: Partial<SessionView> = {}): SessionView => ({
    index: 4,
    network: "mainnet",
    address: "addr1" + "s".repeat(50),
    createdAt: 0,
    stage: "open",
    txs: [{ kind: "out", txHash: "ef".repeat(32), at: 0, confirmed: true }],
    holding: null,
    site: { origin: "https://app.example" },
    ...over,
  });
  const html = (sessions?: SessionView[]) =>
    renderToStaticMarkup(
      createElement(Settings.SiteRows, { sites: [publicSite, sessionSite], sessions, busy: false, onDisconnect: () => undefined }),
    );
  /** Each row's Disconnect, in the rows' order. */
  const buttons = (h: string) => [...h.matchAll(/<button[^>]*data-testid="sites-disconnect"[^>]*>/g)].map((m) => m[0]);

  it("keeps a site's Disconnect off while its session's funding, return or chain is on its way, and says why", () => {
    const chain = { total: 5, sent: 5, confirmed: 3, cut: false };
    for (const [over, why] of [
      [{ stage: "funding" }, "Its funding is on its way: wait for it to land."],
      [{ stage: "returning" }, "Its return is on its way: wait for it to land."],
      [{ chain }, "Its return is on its way: wait for it to land."],
    ] as const) {
      const shown = html([session(over)]);
      const [pub, priv] = buttons(shown);
      expect(priv).toContain("disabled");
      expect(text(shown)).toContain(why);
      // A site on the public account has nothing on its way.
      expect(pub).not.toContain("disabled");
    }
  });

  it("leaves an account it hasn't read to the worker's check, and waits for the sessions to be read", () => {
    // No Refresh here: an unread account doesn't hold Disconnect off.
    const [, unread] = buttons(html([session()]));
    expect(unread).not.toContain("disabled");
    expect(html([session()])).not.toContain('data-testid="site-wait"');
    // What it held when last read does.
    const holding = html([session({ holding: { lovelace: "3000000", tokens: [], utxos: 1 } })]);
    expect(buttons(holding)[1]).toContain("disabled");
    expect(text(holding)).toContain("Bring everything back first.");
    // Before the sessions are read, only the public account's site can go.
    const [pub, priv] = buttons(html(undefined));
    expect(pub).not.toContain("disabled");
    expect(priv).toContain("disabled");
  });

  it("says, before disconnecting, whether a private session ends with it, and that the site keeps what it saw", () => {
    expect(Settings.disconnectText("pay.example")).toBe("pay.example keeps what it saw, and must ask again to see more.");
    const ending = Settings.disconnectText("app.example", 4);
    expect(ending).toContain("Private session 5 ends. app.example keeps what it saw, and must ask again to see more.");
    expect(ending).toContain("The wallet misses anything it pays or leaves on the account later.");
  });
});
