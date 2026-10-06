// A site's signing prompt names every token as the rest of the wallet does
// (launch review #18): a stranger's token called "₳" or "tUSDM" is shown by
// its fingerprint, marked, and warned about, never as ADA or the listed
// token. The address a message is signed for is shown whole.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { DappTxSummary, KnownAccount } from "../src/shared/rpc";
import { AccountsContext } from "../src/ui/accounts";
import { PreferencesContext } from "../src/ui/preferences";
import {
  ConnectRequest,
  FundingWayBack,
  fundingPrivacy,
  PRIVATE_SESSION_PRIVACY,
  PUBLIC_PRIVACY,
  SignData,
  SignTx,
  Site,
} from "../src/ui/screens/DappApprovals";
import { DeclinedSites, Disconnected, SiteRows } from "../src/ui/screens/ConnectedSites";
import { assetFingerprint } from "../src/ui/tokens";

const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");
const STRANGER = "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9";
const TUSDM = { policyId: "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde", assetName: "0014df10745553444d" };
const ADDRESS = "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp";

const summary = (over: Partial<DappTxSummary>): DappTxSummary => ({
  txHash: "ab".repeat(32),
  fee: "180000",
  netLovelace: "-500000000",
  netTokens: [],
  spentLovelace: "500180000",
  returnedLovelace: "0",
  stakingLovelace: "0",
  ownInputs: 1,
  paid: [],
  ownOutputs: [],
  mint: [],
  certificates: [],
  withdrawals: [],
  collateral: null,
  scripts: false,
  referenceInputs: 0,
  votes: 0,
  proposals: 0,
  donation: null,
  note: null,
  metadata: false,
  validFrom: null,
  validUntil: null,
  signs: ["0/0"],
  unknownInputs: [],
  othersSign: 0,
  complete: true,
  ...over,
});

const render = (s: DappTxSummary) =>
  renderToStaticMarkup(createElement(SignTx, { summary: s, partial: false, session: false, collateralSpent: false }));

/** The page's text, without its tags. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("a site's signing prompt", () => {
  it("never shows a stranger's token called ₳ or tUSDM as ADA or the listed tUSDM", () => {
    const fakeAda = { policyId: STRANGER, assetName: hex("₳"), quantity: "1000000000" };
    const fakeUsdm = { policyId: STRANGER, assetName: TUSDM.assetName, quantity: "500" };
    const html = render(
      summary({
        netTokens: [fakeAda, fakeUsdm],
        paid: [{ address: ADDRESS, lovelace: "500000000", tokens: [], datum: null, script: false, seedelf: null, ownPaymentKey: false }],
      }),
    );
    const page = text(html);
    expect(page).not.toMatch(/Gets\s+1,000,000,000 ₳/);
    expect(page).not.toMatch(/Gets\s+500 tUSDM/);
    const ada = assetFingerprint(fakeAda);
    expect(page).toContain(`1,000,000,000 ${ada.slice(0, 10)}…${ada.slice(-6)}`);
    expect(page).toContain("it calls itself ₳, but it isn't ADA");
    expect(page).toContain("it calls itself tUSDM, but it isn't the listed tUSDM");
    expect(html).toContain('data-testid="dapp-lookalike"');
    expect(page).toContain("Tokens here are named like ADA and tUSDM, but aren't");
  });

  it("names a listed token by its ticker in its units, and marks any other in the Pays and Mints rows", () => {
    const foo = { policyId: STRANGER, assetName: hex("FOO"), quantity: "7" };
    const html = render(
      summary({
        netTokens: [{ ...TUSDM, quantity: "2500000" }],
        paid: [
          { address: ADDRESS, lovelace: "2000000", tokens: [foo], datum: null, script: false, seedelf: null, ownPaymentKey: false },
        ],
        mint: [{ ...foo, quantity: "-7" }],
      }),
    );
    const page = text(html);
    expect(page).toMatch(/Gets\s+2.5 tUSDM/);
    expect(page).toMatch(/7 FOO Not on the wallet's list, asset1\w{4}…\w{6}\./);
    expect(page).toMatch(/Burns\s+7 FOO/);
    expect(html).not.toContain('data-testid="dapp-lookalike"');
  });

  it("shows the whole address a message is signed for, on a line of its own", () => {
    const html = renderToStaticMarkup(createElement(SignData, { address: ADDRESS, signer: "payment", payload: "00", text: "Sign in" }));
    expect(html).toContain(`<span class="dapp-address" data-testid="dapp-data-address" data-value="${ADDRESS}">${ADDRESS}</span>`);
  });

  it("says what leaves the account in total, in the wallet's own reviews' words (chunk 23's second review, CW-7)", () => {
    const page = text(render(summary({})));
    expect(page).toMatch(/Total leaving your public account\s+500 ₳/);
    expect(page).toMatch(/fee\s+0.18 ₳, counted in the total/);
    expect(page).not.toMatch(/, net|the net/);
    const gets = text(render(summary({ netLovelace: "2000000", spentLovelace: "0", returnedLovelace: "2000000", ownInputs: 0 })));
    expect(gets).toMatch(/Total coming into your public account\s+2 ₳/);
  });

  it("names the account that signs when the wallet has more than one, and only then (chunk 23's second review, CW-5)", () => {
    const tx = (account?: string) =>
      text(renderToStaticMarkup(createElement(SignTx, { summary: summary({}), partial: false, session: false, collateralSpent: false, account })));
    expect(tx("Account 3 · Savings")).toMatch(/Total leaving Account 3 · Savings\s+500 ₳/);
    expect(tx()).toMatch(/Total leaving your public account\s+500 ₳/);

    const data = (signer: "payment" | "stake" | "drep", account?: string) =>
      text(renderToStaticMarkup(createElement(SignData, { address: ADDRESS, signer, payload: "00", text: "Sign in", account })));
    expect(data("payment", "Account 3 · Savings")).toContain("Signs with The address of Account 3 · Savings");
    expect(data("stake", "Account 2")).toContain("Signs with The stake address of Account 2");
    expect(data("drep", "Account 2")).toContain("Signs with The DRep of Account 2");
    // One account: nothing to tell apart.
    expect(data("payment")).toContain("Signs with Your address");
  });
});

describe("who's asking", () => {
  const site = (props: Parameters<typeof Site>[0]) => text(renderToStaticMarkup(createElement(Site, props)));

  it("names the public account a connected site uses, or its private session (chunk 23)", () => {
    expect(site({ origin: "https://app.example", account: "Account 3 · Savings" })).toContain("Connected to Account 3 · Savings");
    expect(site({ origin: "https://app.example", session: 1 })).toContain("Connected to private session 2");
    // A session's request never names the public account, which isn't in it.
    expect(site({ origin: "https://app.example", session: 1, account: "Account 3" })).not.toContain("Account 3");
    expect(site({ origin: "https://app.example" })).not.toContain("Connected to");
  });
});

describe("a private session's way back, on its funding's review (blind test §9.8, T16)", () => {
  const wayBack = (lovejoin: boolean) =>
    text(renderToStaticMarkup(createElement(FundingWayBack, { fee: "233208", lovejoin, perBox: "4.1" })));

  it("gives the return's fee as an estimate, and both ways' together with this one's exact", () => {
    const direct = wayBack(false);
    // 0.233208 + about 0.25: about 0.48 ₳.
    expect(direct).toContain("Its network fee, about 0.25 ₳ Network fees both ways, about 0.48 ₳");
    expect(direct).toContain("everything there comes straight back into your private balance, the 5 ₳ kept aside with it");
    expect(direct).not.toContain("Lovejoin");
  });

  it("says in plain words what coming back through Lovejoin is, and what a box of it costs", () => {
    const through = wayBack(true);
    expect(through).toContain("Through Lovejoin first, about 4.1 ₳ a 10 ₳ box");
    // Through Lovejoin the way back is a deposit, the mixes and the return (sessions.ts backBuild): two network fees
    // besides the mixes', so both ways are 0.233208 + 2 × about 0.25, about 0.73 ₳, as swapCosts and mixCosts count it.
    expect(through).toContain("Its network fees, about 0.5 ₳: Lovejoin's deposit and the return");
    expect(through).toContain("Network fees both ways, about 0.73 ₳");
    expect(through).not.toContain("Its network fee, about 0.25 ₳");
    expect(through).toContain("goes through Lovejoin first, a mixer: in 10 ₳ boxes mixed with other people's, so it's harder to tie");
    expect(through).toContain("Settings, Lovejoin turns that off.");
    expect(through).not.toContain("as Settings has it");
  });
});

describe("a site's connect window", () => {
  const render = () =>
    renderToStaticMarkup(
      createElement(ConnectRequest, {
        approval: { kind: "connect", id: "a", origin: "https://app.example", title: "App", password: true },
        busy: false,
        held: false,
        onError: () => undefined,
        onAnswer: async () => true,
      }),
    );

  it("chooses nothing for the user: Connect waits for a choice, and each says what it costs (privacy review §3.3)", () => {
    const html = render();
    // Neither the public account nor a private session is checked: two radio cards, each saying what it costs
    // inside it (chunk 23's review, CW-3).
    expect([...html.matchAll(/role="radio" aria-checked="(true|false)"/g)].map((m) => m[1])).toEqual(["false", "false"]);
    expect(/<button[^>]*>Connect<\/button>/.exec(html)![0]).toContain("disabled");
    const page = text(html);
    expect(page).toContain("Choose what the site sees");
    expect(page).toContain("Nothing happens until you choose, and press Connect or Review");
    expect(page).toContain("Your public account The site sees its addresses, its balance and its UTxOs, and keeps what it saw. No fee.");
    // The more private choice isn't the harder one to read (chunk 23's second review, CW-7): what it costs in one
    // line, the 5 ₳ said for what it's for rather than as "collateral" (CW-8), the fee each way with a figure, and
    // what the wallet gives the site, not "sees only", which the note on what anyone can follow qualifies (blind test
    // §9.8, §7, T16).
    expect(page).toContain(
      "A private session The wallet gives the site only a new one-time account, funded from your private balance. A network fee each way, about 0.25 ₳ each, 5 ₳ kept aside that comes back, and about a minute.",
    );
    expect(page).not.toContain("The site sees only");
    // What each shows once chosen isn't said yet.
    expect(html).not.toContain('data-testid="dapp-connect-privacy"');
    expect(html).not.toContain('data-testid="dapp-private-points"');
  });

  // Sites always use the account Settings → Sites chooses, whichever is on
  // screen, so with several the window says which, by number and name (chunk 23).
  const withAccounts = (accounts: KnownAccount[], dappAccount: number) => {
    const several = accounts.length > 1;
    const element = createElement(ConnectRequest, {
      approval: { kind: "connect", id: "a", origin: "https://app.example", title: "App", password: true },
      busy: false,
      held: false,
      onError: () => undefined,
      onAnswer: async () => true,
    });
    return text(
      renderToStaticMarkup(
        createElement(
          AccountsContext.Provider,
          { value: { accounts, active: 0, loaded: true, name: "Account 1", several, reload: async () => undefined } },
          createElement(
            PreferencesContext.Provider,
            { value: { prefs: { ...DEFAULT_PREFERENCES, dappAccount }, loaded: true, set: async () => undefined } },
            element,
          ),
        ),
      ),
    );
  };

  // Blind test §9.2 (T17, T17r): Cancel refused the site and started its wait, and said neither.
  it("says Decline, and how long it turns the site away, before either Decline or closing the window", () => {
    const html = renderToStaticMarkup(
      createElement(ConnectRequest, {
        approval: { kind: "connect", id: "a", origin: "https://app.example", title: "App", password: true, declineWaitMs: 10_000 },
        busy: false,
        held: false,
        onError: () => undefined,
        onAnswer: async () => true,
      }),
    );
    expect(/<button[^>]*>Decline<\/button>/.test(html)).toBe(true);
    expect(html).not.toContain(">Cancel<");
    expect(text(html)).toContain("Decline, or closing this window, turns app.example away: it can ask again in 10 s.");
    // A minute and five are said in minutes; no wait known, nothing is said.
    const wait = (declineWaitMs?: number) =>
      text(
        renderToStaticMarkup(
          createElement(ConnectRequest, {
            approval: { kind: "connect", id: "a", origin: "https://app.example", password: true, ...(declineWaitMs ? { declineWaitMs } : {}) },
            busy: false,
            held: false,
            onError: () => undefined,
            onAnswer: async () => true,
          }),
        ),
      );
    expect(wait(300_000)).toContain("it can ask again in 5 min.");
    expect(wait()).not.toContain("turns app.example away");
  });

  it("says which account the public account is before it's chosen, with several (blind test T15)", () => {
    expect(withAccounts([{ index: 0 }, { index: 2, name: "Savings" }], 2)).toContain(
      "With your public account, the site gets Account 3 · Savings: sites always use the account Settings → Sites chooses",
    );
    expect(withAccounts([{ index: 0 }], 0)).not.toContain("the site gets");
  });

  it("names the account a site would get, by number and name, when there's more than one", () => {
    expect(withAccounts([{ index: 0 }, { index: 2, name: "Savings" }], 2)).toContain(
      "Your public account, Account 3 · Savings The site sees its addresses",
    );
    expect(withAccounts([{ index: 0 }, { index: 2, name: "Savings" }], 0)).toContain("Your public account, Account 1 The site sees");
    // One account: nothing to tell apart, and the window reads as it always did.
    expect(withAccounts([{ index: 0 }], 0)).toContain("Your public account The site sees");
  });

  it("says what a site can still find out: the browser, the funding on chain, and its change (privacy review §2.12)", () => {
    expect(PUBLIC_PRIVACY()).toContain("it can recognize this browser later, even if you connect it to a private session then");
    expect(PRIVATE_SESSION_PRIVACY()).toContain("Your public account isn't in these transactions, but anyone, the site included, can follow the money back");
    expect(PRIVATE_SESSION_PRIVACY()).toContain("if it has seen your public account here, it can tell the session is yours");
    expect(PRIVATE_SESSION_PRIVACY()).not.toContain("never appears");
    expect(fundingPrivacy("12300000")).toBe(
      "This payment links the private UTxOs it spends to the one-time account, as any payment from your private balance to an address does, and so does the 12.3\u00a0₳ it leaves in your private balance as change. The wallet gives the site only that account, but anyone, the site included, can read this payment on chain and follow that change.",
    );
    expect(fundingPrivacy("0")).toBe(
      "This payment links the private UTxOs it spends to the one-time account, as any payment from your private balance to an address does. The wallet gives the site only that account, but anyone, the site included, can read this payment on chain.",
    );
  });
});

// Blind test §9.2, E03: the lists name a site by its address, then its page's
// title; a site on the public account by its account when there are several;
// and say, once one is disconnected, that its open page may still look
// connected. T17r: the sites declined just now are listed, with the wait left.
describe("the lists of sites", () => {
  const sites = [
    { origin: "https://dapp.example", connectedAt: 0, title: "Example Market (test site)" },
    { origin: "https://same.example", connectedAt: 0, title: "same.example" },
  ];

  it("name a site by its address, then its own title, and the account it gets when there are several", () => {
    const one = text(renderToStaticMarkup(createElement(SiteRows, { sites, busy: false, onDisconnect: () => undefined })));
    expect(one).toContain("dapp.example Example Market (test site) Your public account");
    // A title that only repeats the address isn't said twice.
    expect(one).toContain("same.example Your public account");
    const several = text(
      renderToStaticMarkup(createElement(SiteRows, { sites, account: "Account 2 · Savings", busy: false, onDisconnect: () => undefined })),
    );
    expect(several).toContain("Your public account, Account 2 · Savings");
  });

  it("say a disconnected site's open page may still look connected, though it can't use the wallet", () => {
    expect(text(renderToStaticMarkup(createElement(Disconnected, { host: "dapp.example" }))).trim()).toBe(
      "dapp.example is disconnected: it can't use Seedelf Wallet until it asks again and you choose. A page of it that's still open may show itself connected, with what it read, until it's reloaded.",
    );
    expect(renderToStaticMarkup(createElement(Disconnected, {}))).toBe("");
  });

  it("list a declined site with the wait it has left, whether it asked again, and Let it ask now", () => {
    const now = 1_000_000;
    const shown = renderToStaticMarkup(
      createElement(DeclinedSites, {
        declined: [
          { origin: "https://dapp.example", until: now + 8_200, title: "Example Market" },
          { origin: "https://pushy.example", until: now + 240_000, retried: true },
        ],
        now,
        onLetAsk: () => undefined,
      }),
    );
    expect(text(shown)).toContain("dapp.example Example Market You declined it: it can ask again in 9 s.");
    expect(text(shown)).toContain("pushy.example You declined it, and it asked again: it can ask again in 4 min.");
    expect([...shown.matchAll(/>Let it ask now</g)]).toHaveLength(2);
    expect(renderToStaticMarkup(createElement(DeclinedSites, { declined: [], now, onLetAsk: () => undefined }))).toBe("");
  });
});

// Blind test §7, T16: "the site sees only a new one-time account" read as a
// promise that the site can't tie the session to the user, which the privacy
// note under it says it can. What the wallet does is give the site only that
// account; what the site can find out is the note's to say. The cross-area
// review found the dApps page's hint still promising it.
describe("what a private session is said to give a site", () => {
  const SEES_ONLY: Record<string, RegExp> = {
    en: /\b(sees? only|only sees?|will only see|see only)\b/i,
    // Accented letters aren't word characters to \b: a letter-free edge instead.
    es: /(?<!\p{L})(solo|solamente) (ve|verá|vea|ven|verán)(?!\p{L})|(?<!\p{L})(ve|verá|vea|ven|verán) (solo|solamente)(?!\p{L})/iu,
    ja: /だけが?見え|しか見え/,
  };

  it("is that the wallet gives it only a one-time account, never that it sees only one, in every language", () => {
    for (const [code, said] of Object.entries(SEES_ONLY)) {
      const strings: Record<string, string> = JSON.parse(
        readFileSync(new URL(`../src/i18n/translations/${code}.json`, import.meta.url), "utf8"),
      );
      const promising = Object.entries(strings)
        .filter(([, value]) => said.test(value))
        .map(([key]) => key);
      expect(promising, `${code}.json`).toEqual([]);
    }
  });
});
