// Settings' sections, rendered as the page renders them: the network switch
// of a build with both networks, the preprod strip every screen shows,
// Lovejoin's, on each network it's on, with what a mix costs there and that
// it has had no third-party audit, and Connected sites' Disconnect, which
// waits while a site's private session has something on its way.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { i18n } from "../src/i18n/core";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { DappSite, DataHolds, SessionView, Status } from "../src/shared/rpc";
import { NetworkBadge, TestNetworkStrip } from "../src/ui/components/NetworkBadge";
import { PreferencesContext } from "../src/ui/preferences";

let Settings: typeof import("../src/ui/screens/Settings");
let Bring: typeof import("../src/ui/components/BringAllBack");

beforeAll(async () => {
  // The page's view (ui/view.ts) is read from its URL when the module loads.
  vi.stubGlobal("location", { search: "?view=tab", hash: "" });
  Settings = await import("../src/ui/screens/Settings");
  Bring = await import("../src/ui/components/BringAllBack");
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

describe("Settings' server status line", () => {
  const line = (koiosOnly: boolean, holds?: DataHolds) =>
    renderToStaticMarkup(createElement(Settings.ServerStatusLine, { koiosOnly, holds }));
  const at = new Date(2026, 9, 11, 17, 42).getTime();

  it("is green on Seedelf's data layer, with nothing held on Koios", () => {
    const html = line(false, {});
    expect(html).toContain("server-status--up");
    expect(text(html).trim()).toBe("Using Seedelf's data layer.");
  });

  it("is red with every part on Koios, and says until when: the latest of their times", () => {
    const html = line(false, { public: at, private: at + 60_000, submit: at });
    expect(html).toContain("server-status--down");
    expect(text(html).trim()).toBe("Using Koios until 17:43: Seedelf Wallet's own server didn't answer.");
  });

  it("never says a part is back on the server before it is (1.5.0's release review, C13)", () => {
    // Each part is held from its own failure: the reads at 17:37, a send at 17:40. Sending stays on Koios until 17:45,
    // and once the public account's hold ends, the line names sending alone.
    const html = line(false, { public: at, submit: at + 3 * 60_000 });
    expect(text(html).trim()).toBe(
      "Using Koios for your public account and sending until 17:45: Seedelf Wallet's own server didn't answer. The rest uses the server.",
    );
  });

  it("is amber with some on Koios, and names them", () => {
    const html = line(false, { private: at, submit: at });
    expect(html).toContain("server-status--partly");
    expect(text(html).trim()).toBe(
      "Using Koios for your private balance and sending until 17:42: Seedelf Wallet's own server didn't answer. The rest uses the server.",
    );
  });

  it("is grey with the Koios-only switch on, whatever was held", () => {
    const html = line(true, { public: at });
    expect(html).toContain("server-status--off");
    expect(text(html).trim()).toBe("Using Koios only.");
  });

  it("says nothing before the worker has answered", () => {
    expect(line(false)).toBe("");
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

  // The owner's calls (2026-10-22 and 2026-10-23): a returning session's 5 ₳ collateral mixed once in a pool of 5 ₳
  // boxes, with its own switch.
  it("has the collateral's own switch, on by default, off with the returns', saying what each way does", () => {
    const render = (prefs: Partial<typeof DEFAULT_PREFERENCES>) =>
      renderToStaticMarkup(
        createElement(
          PreferencesContext.Provider,
          { value: { prefs: { ...DEFAULT_PREFERENCES, ...prefs }, loaded: true, set: async () => undefined } },
          createElement(Settings.LovejoinSettings, { network: "mainnet" }),
        ),
      ).replaceAll("&#x27;", "'");
    const button = (html: string) => html.match(/<button[^>]*data-testid="lovejoin-collateral-switch"[^>]*>/)![0];
    expect(DEFAULT_PREFERENCES.lovejoinCollateral).toBe(true);
    const on = render({});
    expect(button(on)).toContain('aria-checked="true"');
    expect(button(on)).not.toContain("disabled");
    expect(text(on)).toContain("Mix a session's 5 ₳ collateral in Lovejoin as it's brought back");
    expect(text(on)).toContain("is mixed once with two other people's boxes, if that pool exists and holds enough of theirs");
    expect(text(on)).toContain("pays a little more for that mix, and what the mix doesn't use comes back");
    expect(text(on)).toContain("If not, the collateral comes back with the rest");
    expect(text(render({ lovejoinCollateral: false }))).toContain("anyone can tie it to the session, as they can that money");
    expect(button(render({ lovejoinReturns: false }))).toContain('disabled=""');
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

  it("says to bring everything back first, not to wait, once a lock or a refusal stopped its return's chain (cross-area review X10)", () => {
    // Nothing sends a stopped chain's rest: it waits at the account for Bring it back, whether what the chain sent
    // before the stop is on chain yet or not (the worker's own check waits for that).
    const stopped = "The wallet locked, or the browser closed, while its chain was being sent.";
    for (const confirmed of [0, 4]) {
      const chain = { total: 10, sent: 4, confirmed, cut: false, stopped };
      const shown = html([session({ chain, holding: { lovelace: "45000000", tokens: [], utxos: 2 } })]);
      expect(buttons(shown)[1]).toContain("disabled");
      expect(text(shown)).toContain("Bring everything back first.");
      expect(text(shown)).not.toContain("on its way");
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

describe("Settings' Bring every box back now (the owner's test of 1.6.0)", () => {
  const view = (props: Partial<Parameters<typeof Bring.BringAllBackView>[0]>, hideBalances = false) =>
    text(
      renderToStaticMarkup(
        createElement(
          PreferencesContext.Provider,
          { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances }, loaded: true, set: async () => undefined } },
          createElement(Bring.BringAllBackView, { bringing: undefined, busy: false, onAsk: () => undefined, onStop: () => undefined, ...props }),
        ),
      ),
    );

  it("is in Lovejoin's settings, on each network it's on, saying what it does", () => {
    for (const network of ["mainnet", "preprod"] as const) {
      const shown = text(renderToStaticMarkup(createElement(Settings.LovejoinSettings, { network })));
      expect(shown).toContain("Bring every box back now");
      expect(shown).toContain("Every box in every pool, without the waits.");
    }
  });

  it("asks first, saying what bringing them all back at once ties, what it costs, and to stay unlocked", () => {
    const shown = text(renderToStaticMarkup(createElement(Bring.BringAllBackQuestion, { onKeep: () => undefined, onConfirm: () => undefined })));
    expect(shown).toContain("Bring every box back now?");
    expect(shown).toContain("Sent back to back, they show they're one person's and are easier to match to their deposits.");
    expect(shown).toContain("A box not mixed since its deposit ties that deposit, and the public account if it paid, to your private balance.");
    // What it ties where a box can't pay its own way back, as Bring one back's question says it (call 36).
    expect(shown).toContain("Each box pays about 0.3 ₳ to come back. Where it can't, your private balance pays, tying the UTxO it pays with, and where it came from, to the box.");
    expect(shown).toContain("Keep Seedelf Wallet unlocked: if it locks, this pauses until you unlock.");
    expect(shown).toContain("Keep them in Lovejoin");
    // A confirm that fits one line (the owner, 2026-10-20).
    expect(shown).toContain("Bring them back");
  });

  it("says how it goes while it runs, with Stop in place of the button, its counts hidden with the balances", () => {
    const going = { bringing: { back: 3, left: 2, why: "giveme.my didn't answer." } };
    const shown = view(going);
    expect(shown).toContain("Bringing every box back: 3 boxes sent back so far. 2 boxes left.");
    expect(shown).toContain("The last box that didn't go: giveme.my didn't answer.");
    expect(shown).toContain("Stop");
    expect(shown).not.toContain("Bring every box back now Bring every box back now");
    const hidden = view(going, true);
    expect(hidden).not.toMatch(/\b[23] boxes/);
    // A bar, as Bootstrap's progress has: 3 of 5.
    const bar = renderToStaticMarkup(
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } },
        createElement(Bring.BringAllBackView, { ...going, busy: false, onAsk: () => undefined, onStop: () => undefined }),
      ),
    );
    expect(bar).toMatch(/data-testid="lovejoin-bring-meter"[^]*?width:60%/);
    // Before its first run it says nothing of what's left.
    expect(view({ bringing: { back: 0 } })).not.toContain("left.");
  });

  it("says why once it stopped by itself, offering it again; and once it's over, how many went", () => {
    const stopped = view({ bringing: { back: 1, left: 1, stopped: "giveme.my didn't answer." } });
    // Only what holds for every box left: a Bootstrap's, one not mixed yet and a stuck pool's never come back by themselves.
    expect(stopped).toContain("Stopped: several tries in a row sent nothing. giveme.my didn't answer. Press Try again to bring back the rest.");
    expect(stopped).not.toContain("by themselves");
    expect(stopped).toContain("Try again");
    expect(stopped).not.toContain("Stop ");
    expect(view({ done: 4 })).toContain("Done: 4 boxes back in your private balance.");
    expect(view({ done: 1 })).toContain("Done: 1 box back in your private balance.");
    // All sent, the chain not done with them yet: said so, with nothing to stop (the owner: "confirming on chain then the final done").
    const confirming = view({ bringing: { back: 8, left: 0, confirming: 8 } });
    expect(confirming).toContain("8 boxes sent. Waiting for the chain to confirm.");
    expect(confirming).not.toContain("0 boxes left");
    expect(confirming).not.toContain("Stop");
    expect(view({ done: 0 })).toContain("Nothing of yours was left in Lovejoin.");
  });

  it("says a mix built and not sent holds what's left, never an older run's reason, while it waits (1.6.0's review)", () => {
    const shown = view({ bringing: { back: 0, left: 2, held: true, why: "giveme.my didn't answer." } });
    expect(shown).toContain("2 boxes left.");
    expect(shown).toContain("A mix you built and haven't sent holds what's left, for 10 minutes at most.");
    expect(shown).not.toContain("The last box that didn't go");
    expect(shown).toContain("Stop");
  });

  it("says nothing was left only when nothing of the wallet's is there once it's over (1.6.0's review)", () => {
    const empty = { boxes: 0, lovelace: "0", next: null, notMixed: 0, stopped: 0 };
    expect(Bring.doneOf({ back: 3 }, { ...empty, boxes: 1 })).toBe(3);
    expect(Bring.doneOf({ back: 0 }, empty)).toBe(0);
    // A mix sent since it was asked: its boxes wait their turn, so it says nothing.
    expect(Bring.doneOf({ back: 0 }, { ...empty, boxes: 1 })).toBeUndefined();
    expect(Bring.doneOf({ back: 0 }, { ...empty, pools: [{ id: "a1", boxes: 0, lovelace: "0", next: null, notMixed: 0, bootstrap: 2 }] })).toBeUndefined();
    // A pool's run, by that pool's figures alone.
    const other = { ...empty, pools: [{ id: "a1", boxes: 1, lovelace: "0", next: null, notMixed: 0 }] };
    expect(Bring.doneOf({ back: 0, pool: "classic" }, other)).toBe(0);
    expect(Bring.doneOf({ back: 0, pool: "a1" }, other)).toBeUndefined();
    expect(Bring.doneOf({ back: 0, pool: "a1" }, { ...empty, boxes: 1 })).toBe(0);
  });

  it("ends the worker's reason with a full stop of its own before what follows, in any language (1.6.0's review)", async () => {
    // The node's words, as a withdraw refused passes them on: no full stop of their own.
    const raw = "The network rejected the transaction: BadInputsUTxO";
    expect(view({ bringing: { back: 1, left: 1, stopped: raw } })).toContain(`${raw}. Press Try again`);
    expect(view({ bringing: { back: 1, left: 1, why: raw } })).toContain(`The last box that didn't go: ${raw}.`);
    await i18n.changeLanguage("ja");
    try {
      // One that ends a sentence already, in Japanese's 。, keeps it alone.
      const ja = "giveme.my が応答しませんでした。";
      const shown = view({ bringing: { back: 1, left: 1, stopped: ja } });
      expect(shown).toContain(`${ja}残りのボックスを`);
      expect(shown).not.toContain("。.");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

describe("a pool's page's Bring every box in this pool back now (the owner's test of 1.6.0)", () => {
  const view = (props: Partial<Parameters<typeof Bring.BringAllBackView>[0]>) =>
    text(
      renderToStaticMarkup(
        createElement(
          PreferencesContext.Provider,
          { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } },
          createElement(Bring.BringAllBackView, { bringing: undefined, busy: false, onAsk: () => undefined, onStop: () => undefined, ...props }),
        ),
      ),
    );

  it("is a link on a pool's page, as Help start the pool is, and a button in Settings", () => {
    const markup = (pool: boolean) =>
      renderToStaticMarkup(
        createElement(
          PreferencesContext.Provider,
          { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } },
          createElement(Bring.BringAllBackView, { bringing: undefined, pool, busy: false, onAsk: () => undefined, onStop: () => undefined }),
        ),
      );
    expect(markup(true)).toMatch(/<button[^>]*class="link align-start"[^>]*data-testid="lovejoin-bring-ask"/);
    expect(markup(false)).toMatch(/<button[^>]*class="secondary"[^>]*data-testid="lovejoin-bring-ask"/);
    // The link alone on a pool's page; a button and one short line in Settings, no more (the owner: "the rest is text").
    expect(text(markup(true)).trim()).toBe("Bring every box in this pool back now");
    expect(text(markup(false)).trim()).toBe("Every box in every pool, without the waits. Bring every box back now");
  });

  it("speaks of this pool alone, and asks first with the same warning", () => {
    const shown = view({ pool: true });
    expect(shown).toContain("Bring every box in this pool back now");
    const question = text(renderToStaticMarkup(createElement(Bring.BringAllBackQuestion, { pool: true, onKeep: () => undefined, onConfirm: () => undefined })));
    expect(question).toContain("Bring this pool's boxes back now?");
    expect(question).toContain("Sent back to back, they show they're one person's");
    expect(question).toContain("Bring them back");
  });

  it("says how its own run goes, or every pool's, and that another pool's goes, which it can't join", () => {
    expect(view({ pool: true, bringing: { back: 2, pool: "abc", left: 1 } })).toContain("Bringing every box in this pool back: 2 boxes sent back so far. 1 box left.");
    expect(view({ pool: true, bringing: { back: 2, left: 1 } })).toContain("Bringing every box back: 2 boxes sent back so far.");
    const other = renderToStaticMarkup(
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } },
        createElement(Bring.BringAllBackView, { bringing: undefined, pool: true, other: true, busy: false, onAsk: () => undefined, onStop: () => undefined }),
      ),
    );
    expect(text(other)).toContain("Another pool's boxes are coming back now. Stop that first, or use Settings for every pool.");
    expect(other).toMatch(/data-testid="lovejoin-bring-ask"[^>]*disabled|disabled[^>]*data-testid="lovejoin-bring-ask"/);
    expect(view({ pool: true, done: 0 })).toContain("Nothing of yours was left in this pool.");
  });

  it("in Settings, says one pool's goes and keeps the button to make it every pool's; a pool's stop is its page's to say", () => {
    const one = view({ bringing: { back: 2, pool: "abc", left: 3 } });
    expect(one).toContain("Bringing every box in one pool back: 2 boxes sent back so far. 3 boxes left.");
    expect(one).toContain("Stop");
    expect(one.match(/Bring every box back now/g)?.length).toBe(1);
    expect(view({ bringing: { back: 0, pool: "abc", stopped: "giveme.my didn't answer." } })).not.toContain("giveme.my didn't answer.");
    expect(view({ pool: true, bringing: { back: 0, pool: "abc", stopped: "giveme.my didn't answer." } })).toContain("Stopped: several tries in a row sent nothing. giveme.my didn't answer.");
  });
});
