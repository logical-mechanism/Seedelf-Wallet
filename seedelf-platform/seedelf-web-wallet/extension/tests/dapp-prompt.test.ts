// A site's signing prompt names every token as the rest of the wallet does
// (launch review #18): a stranger's token called "₳" or "tUSDM" is shown by
// its fingerprint, marked, and warned about, never as ADA or the listed
// token. The address a message is signed for is shown whole.
import { readFileSync } from "node:fs";
import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { criticalKeys } from "../scripts/i18n-critical.mjs";
import { moreThanNote } from "../src/background/dapp";
import { i18n } from "../src/i18n/core";
import { epochStart, type NetworkName, slotStart } from "../src/networks";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { DappTxSummary, KnownAccount, TxDetail } from "../src/shared/rpc";
import { AccountsContext } from "../src/ui/accounts";
import { slotText } from "../src/ui/format";
import { NetworkContext } from "../src/ui/network";
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
import { releasesContractFunds, shownSiteText } from "../src/ui/dapp";
import { assetFingerprint } from "../src/ui/tokens";
import { koiosPreprod, loadTestWasm, testBalances, vectors } from "./fakes";

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
  proposals: [],
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

const render = (s: DappTxSummary, network: NetworkName = "preprod", props: Partial<Parameters<typeof SignTx>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: network },
      createElement(SignTx, { summary: s, partial: false, session: false, collateralSpent: false, ...props }),
    ),
  );

/** The page's text, without its tags. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

afterEach(async () => {
  await i18n.changeLanguage("en");
});

// A site can spend an order or a listing with the owner's key as a required signer and pay it anywhere, every row true
// of the account while the money leaves (a bounty report against 1.8.1).
describe("a contract UTxO the account's key releases", () => {
  const token = { policyId: STRANGER, assetName: hex("FOO"), quantity: "1" };
  const taken: Partial<DappTxSummary> = {
    netLovelace: "0",
    spentLovelace: "0",
    ownInputs: 0,
    paid: [{ address: ADDRESS, lovelace: "49800000", tokens: [token], datum: null, script: false, seedelf: null, ownPaymentKey: false }],
    scripts: true,
    contractInputs: 1,
    contractLovelace: "50000000",
    contractTokens: [token],
    releasedLovelace: "49800000",
    releasedTokens: [token],
    keyReleases: true,
    namesKey: true,
  };

  it("says what comes from a contract, not to the user, under the total, and that the contract names the key, before who it pays", () => {
    const html = render(summary(taken));
    const page = text(html);
    expect(page).toContain("Total coming into your public account 0 ₳");
    expect(page).toContain("From a contract, not to you 49.8 ₳");
    expect(page).toContain(
      "Your signature releases funds from a contract that names you. They may be yours, but they don't come back to you.",
    );
    // Only what's worked out: money that stays at the same contract counts, so a position's top-up or a listing's
    // reprice reads the same, and a key in the datum says nothing of whose it is (1.9.0's release review, M1).
    expect(page).not.toContain("Leaves a contract");
    expect(page).not.toContain("your own order or listing");
    expect(html.indexOf('data-testid="dapp-contract-release"')).toBeLessThan(html.indexOf('data-testid="dapp-paid"'));
    expect(releasesContractFunds(summary(taken))).toBe(true);
  });

  it("says less when no datum names the account's key", () => {
    const page = text(render(summary({ ...taken, namesKey: false })));
    expect(page).toContain("Your signature helps release funds from a contract. If any are yours, they don't come back to you.");
    expect(page).not.toContain("names you");
  });

  // Chunk 51, t1i#2: every case above releases a token beside the ADA, so a check of the tokens alone passed them all.
  // The 1.8.1 bounty report's shape is ADA alone: an order's 49.8 ₳ under the account's key, paid to someone else.
  it("warns of ADA alone taken from a contract the key releases, and waits for the user's yes", () => {
    const ada: Partial<DappTxSummary> = {
      ...taken,
      paid: [{ address: ADDRESS, lovelace: "49800000", tokens: [], datum: null, script: false, seedelf: null, ownPaymentKey: false }],
      contractTokens: [],
      releasedTokens: [],
    };
    expect(releasesContractFunds(summary(ada))).toBe(true);
    const html = render(summary(ada));
    expect(html).toContain('data-testid="dapp-contract-release"');
    expect(text(html)).toContain("From a contract, not to you 49.8 ₳");
  });

  it("warns of a token taken with the ADA paid back, and shows no empty ADA row", () => {
    const html = render(summary({ ...taken, releasedLovelace: "0" }));
    expect(html).toContain('data-testid="dapp-contract-release"');
    expect(html).not.toContain('data-testid="dapp-contract-released"');
    expect(releasesContractFunds(summary({ ...taken, releasedLovelace: "0" }))).toBe(true);
  });

  it("says nothing of it for an honest cancel, whose money reaches the account", () => {
    const honest = summary({ ...taken, netLovelace: "49800000", paid: [], releasedLovelace: "0", releasedTokens: [] });
    const html = render(honest);
    expect(html).not.toContain('data-testid="dapp-contract-release"');
    expect(releasesContractFunds(honest)).toBe(false);
    expect(text(html)).toContain("It spends 1 contract UTxO holding 50 ₳ and tokens.");
  });

  it("only notes a contract the account's key isn't asked for", () => {
    const pool = summary({ ...taken, keyReleases: false, namesKey: false, contractInputs: 2, contractTokens: [] });
    const html = render(pool);
    expect(html).not.toContain('data-testid="dapp-contract-release"');
    expect(releasesContractFunds(pool)).toBe(false);
    expect(text(html)).toContain("It spends 2 contract UTxOs holding 50 ₳.");
  });

  it("keeps each note's ₳ by its number, in every language (1.9.0's release review, i18n#5)", async () => {
    const honest = summary({ ...taken, netLovelace: "49800000", paid: [], releasedLovelace: "0", releasedTokens: [] });
    const pool = summary({ ...taken, keyReleases: false, namesKey: false, contractTokens: [] });
    for (const language of ["en", "es", "ja"]) {
      await i18n.changeLanguage(language);
      for (const s of [honest, pool]) {
        const notes = /data-testid="dapp-notes".*?<\/ul>/.exec(render(s))?.[0] ?? "";
        expect(notes, language).toContain("50 ₳");
        expect(notes, language).not.toContain("50 ₳");
      }
    }
    // Every plural form, not only the one a single contract UTxO renders (1.9.0's review of its fixes, r2-tests#1).
    for (const language of ["en", "es", "ja"]) {
      const values: Record<string, string> = JSON.parse(
        readFileSync(new URL(`../src/i18n/translations/${language}.json`, import.meta.url), "utf8"),
      );
      const forms = Object.keys(values).filter((k) => k.startsWith("dappUi.note.warn.contractInputs"));
      expect(forms.length, language).toBe(language === "es" ? 6 : language === "en" ? 4 : 2);
      for (const k of forms) expect(values[k], `${language} ${k}`).toContain("{{ada}}\u00a0₳");
    }
  });

  it("holds the notes, the row, the switch and both callouts to a back-translation (1.9.0's release review, L11)", () => {
    // The notes are all there is in the limits the docs name, so their words are checked as a warning's are.
    const en: Record<string, string> = JSON.parse(
      readFileSync(new URL("../src/i18n/translations/en.json", import.meta.url), "utf8"),
    );
    const critical = criticalKeys(Object.keys(en));
    for (const key of [
      "dappUi.note.warn.contractInputs",
      "dappUi.note.warn.contractInputsTokens",
      "dappUi.warn.contractRow",
      "dappUi.warn.contractAck",
      "dappUi.warn.contractYours",
      "dappUi.warn.contractMaybe",
      "dappUi.warn.unknownInputs",
      "dappUi.warn.unknownInputsKeyReleases",
    ]) {
      expect(critical, key).toContain(key);
    }
  });

  it("has nothing to say with no contract UTxO, and of a summary from before these fields", () => {
    const page = text(render(summary({})));
    expect(page).not.toContain("contract UTxO");
    expect(releasesContractFunds(summary({}))).toBe(false);
  });

  it("marks a lookalike token it releases, as every other row does", () => {
    const fake = { policyId: STRANGER, assetName: hex("₳"), quantity: "5" };
    const html = render(summary({ ...taken, paid: [], releasedTokens: [fake] }));
    expect(html).toContain('data-testid="dapp-lookalike"');
  });
});

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

  it("says whose stake key each proposal's deposit goes back to, and warns when it isn't the account's (chunk 39)", () => {
    // The bounty report's transaction (wasm/tests/fixtures/proposal-report-preprod.json): it read only "It makes 1
    // governance proposal", and its deposit went back to a stake key that wasn't the payer's.
    const theirs = "stake_test1upzpt4r85pf27gttzrvd4jxe7yuc8j5vmp537w0f6vmpceqq7cun8";
    const proposal = { action: "information", deposit: "1000000000", address: theirs, own: false, credential: "44".repeat(28), recipients: [] };
    const stranger = render(summary({ proposals: [proposal] }));
    expect(stranger).toContain('<div class="callout callout--warn" data-testid="dapp-staking">');
    expect(text(stranger)).toContain(
      `Proposes information, which changes nothing. Its 1,000 ₳ deposit goes to a stake key that isn't yours, ${theirs}, when the action ends.`,
    );
    expect(text(stranger)).not.toContain("governance proposal");
    // The account's own: said where it comes back, and nothing to warn of.
    const own = render(summary({ proposals: [{ ...proposal, own: true }] }));
    expect(own).toContain('<div class="callout callout--info" data-testid="dapp-staking">');
    expect(text(own)).toContain("Its 1,000 ₳ deposit comes back to your public account when the action ends.");
    // Two in one: each its own line, and a warning if either isn't the account's.
    const both = render(summary({ proposals: [{ ...proposal, own: true }, proposal] }));
    expect(both).toContain('<div class="callout callout--warn" data-testid="dapp-staking">');
    expect(text(both).match(/Proposes information/g)).toHaveLength(2);
  });

  it("warns that a proposal's deposit to a private session's stake key never comes back (1.7.2's release review, critic#0)", () => {
    // The wallet never reads or withdraws a session's rewards, so "comes back to your private session" was untrue of
    // the session's own key, and said in an info callout.
    const reward = "stake_test1upzpt4r85pf27gttzrvd4jxe7yuc8j5vmp537w0f6vmpceqq7cun8";
    const own = { action: "information", deposit: "1000000000", address: reward, own: true, credential: "44".repeat(28), recipients: [] };
    const session = render(summary({ proposals: [own] }), "preprod", { session: true });
    expect(session).toContain('<div class="callout callout--warn" data-testid="dapp-staking">');
    expect(text(session)).toContain(
      "Proposes information, which changes nothing. Its 1,000 ₳ deposit goes to the stake key of this private session when the action ends, and the wallet never brings it back.",
    );
    expect(text(session)).not.toContain("deposit comes back");
    // The public account's own still comes back to it, with nothing to warn of.
    const account = render(summary({ proposals: [own] }));
    expect(account).toContain('<div class="callout callout--info" data-testid="dapp-staking">');
    expect(text(account)).toContain("Its 1,000 ₳ deposit comes back to your public account when the action ends.");
    // Another session's, from the public account: by its number, and the same.
    const other = render(summary({ proposals: [{ ...own, own: false, yours: 1 }] }));
    expect(other).toContain('<div class="callout callout--warn" data-testid="dapp-staking">');
    expect(text(other)).toContain(
      "Proposes information, which changes nothing. Its 1,000 ₳ deposit goes to the stake key of your private session 2 when the action ends, and the wallet never brings it back.",
    );
  });

  it("says what it can't show of inputs it couldn't find, and that only the stake key signs, word for word (1.7.2's release review, i18n#0)", async () => {
    // #358 took "and it spends none of them" out of all three languages: the stake key spends any at its own
    // enterprise address. Exact values, so neither that clause nor Spanish's old order, which read as an order to
    // sign, can come back with every test passing.
    const signing = (n: number) =>
      render(
        summary({ signs: ["stake"], ownInputs: 0, unknownInputs: new Array<string>(n).fill(`${"cd".repeat(32)}#0`), complete: false }),
        "preprod",
        { partial: true },
      );
    const unknown = (n: number) =>
      /data-testid="dapp-unknown"[^>]*>.*?<div class="callout__body">(.*?)<\/div>/.exec(signing(n))?.[1]?.replace(/&#x27;/g, "'");
    expect(signing(0)).not.toContain('data-testid="dapp-unknown"');
    expect(unknown(1)).toBe("It spends 1 UTxO the wallet couldn't find, so what it holds can't be shown. Only your stake key signs here.");
    expect(unknown(2)).toBe("It spends 2 UTxOs the wallet couldn't find, so what they hold can't be shown. Only your stake key signs here.");
    await i18n.changeLanguage("es");
    expect(unknown(1)).toBe(
      "Gasta 1 UTxO que la billetera no pudo encontrar, así que no se puede mostrar lo que contiene. Solo tu clave de stake firma aquí.",
    );
    expect(unknown(2)).toBe(
      "Gasta 2 UTxOs que la billetera no pudo encontrar, así que no se puede mostrar lo que contienen. Solo tu clave de stake firma aquí.",
    );
    // A million is Spanish's "many".
    expect(unknown(1_000_000)).toBe(
      "Gasta 1000000 UTxOs que la billetera no pudo encontrar, así que no se puede mostrar lo que contienen. Solo tu clave de stake firma aquí.",
    );
    await i18n.changeLanguage("ja");
    expect(unknown(2)).toBe(
      "ウォレットが見つけられなかった UTxO を 2 件使用するため、その内容は表示できません。ここで署名するのはあなたのステーク鍵だけです。",
    );
  });

  it("never says only the stake key signs when that key is what a contract here may ask for (1.9.0's release review, L3)", async () => {
    // A contract input the wallet couldn't find, the stake key a required signer: "Only your stake key signs here" read
    // as reassurance, when that key is what releases it.
    const signing = (n: number, keyReleases?: boolean) =>
      render(
        summary({ signs: ["stake"], ownInputs: 0, unknownInputs: new Array<string>(n).fill(`${"cd".repeat(32)}#0`), complete: false, keyReleases }),
        "preprod",
        { partial: true },
      );
    const unknown = (n: number, keyReleases?: boolean) =>
      /data-testid="dapp-unknown"[^>]*>.*?<div class="callout__body">(.*?)<\/div>/.exec(signing(n, keyReleases))?.[1]?.replace(/&#x27;/g, "'");
    expect(unknown(1, true)).toBe("It spends 1 UTxO the wallet couldn't find, so what it holds can't be shown.");
    expect(unknown(2, true)).toBe("It spends 2 UTxOs the wallet couldn't find, so what they hold can't be shown.");
    // Without it, the sentence stays.
    expect(unknown(1, false)).toBe(
      "It spends 1 UTxO the wallet couldn't find, so what it holds can't be shown. Only your stake key signs here.",
    );
    // In every language, the same first sentence alone.
    for (const language of ["es", "ja"]) {
      await i18n.changeLanguage(language);
      for (const n of [1, 2, 1_000_000]) {
        const alone = unknown(n, true)!;
        expect(alone, `${language} ${n}`).toMatch(/[.。]$/);
        expect(unknown(n, false)!.startsWith(alone), `${language} ${n}`).toBe(true);
        expect(unknown(n, false)!.length, `${language} ${n}`).toBeGreaterThan(alone.length + 4);
      }
    }
    await i18n.changeLanguage("es");
    expect(unknown(1, true)).not.toContain("clave de stake");
    await i18n.changeLanguage("ja");
    expect(unknown(2, true)).not.toContain("ステーク鍵");
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

  it("says when the site may send it: when it expires, and when it starts while that's to come (a bounty report against 1.7.0)", () => {
    // The slots as seedelf-core's slot_config counts them, and the epochs' starts agree.
    expect(slotStart("mainnet", 4_492_800)).toBe(1_596_059_091_000);
    expect(new Date(slotStart("mainnet", 0)).toISOString()).toBe("2017-09-23T21:44:51.000Z");
    expect(slotStart("preprod", 135_302_400)).toBe(epochStart("preprod", 317));
    expect(slotStart("mainnet", 199_324_800)).toBe(epochStart("mainnet", 659));
    // The report's: a preprod payment that stayed valid for 173 days.
    expect(new Date(slotStart("preprod", 152_671_012)).toISOString()).toBe("2027-04-22T00:36:52.000Z");
    expect(slotText("preprod", 152_671_012)).toMatch(/^2[12] Apr 2027, \d{2}:\d{2}$/);

    const slotIn = (ms: number) => 86_400 + Math.round((Date.now() + ms - 1_655_769_600_000) / 1000);
    const until = slotIn(2 * 3_600_000);
    const page = text(render(summary({ validUntil: until })));
    expect(page).toContain(`Expires ${slotText("preprod", until, true)}`);
    expect(page).not.toContain("Valid from");
    // An end is rounded up to the minute, never shown before the slot it can't land in starts: one starting at :30
    // reads as the next minute's, on the window too, whatever the clock says (1.7.1's release review).
    const half = until - ((until - 86_400) % 60) + 30;
    expect(slotText("preprod", half, true)).toBe(slotText("preprod", half + 30));
    expect(slotText("preprod", half, true)).not.toBe(slotText("preprod", half));
    expect(text(render(summary({ validUntil: half })))).toContain(`Expires ${slotText("preprod", half + 30)}`);
    // The last slot a Date holds says its year; the next one never ends.
    const last = 86_400 + (8.64e15 - 1_655_769_600_000) / 1000;
    expect(slotText("preprod", last)).toMatch(/275760/);
    expect(slotText("preprod", last + 1)).toBeUndefined();
    // On mainnet, by the window's network: Shelley's start there, never preprod's. An end 10 s into its minute reads
    // as the next and a start 30 s into one as its own: no other rounding gives both.
    const mainnetIn = (ms: number) => 4_492_800 + Math.round((Date.now() + ms - 1_596_059_091_000) / 1000);
    const into = (slot: number, s: number) => slot - Math.round((slotStart("mainnet", slot) % 60_000) / 1000) + s;
    const end = into(mainnetIn(60 * 86_400_000), 10);
    const start = into(mainnetIn(30 * 86_400_000), 30);
    const onMainnet = text(render(summary({ validFrom: start, validUntil: end }), "mainnet"));
    expect(onMainnet).toContain(`Expires ${slotText("mainnet", end + 50)}`);
    expect(onMainnet).toContain(`Valid from ${slotText("mainnet", start - 30)}`);
    expect(text(render(summary({ validFrom: mainnetIn(-60_000), validUntil: end }), "mainnet"))).not.toContain("Valid from");
    // No end, or one past what a date can say, never ends.
    expect(text(render(summary({})))).toContain("Expires Never");
    expect(text(render(summary({ validUntil: 2 ** 63 })))).toContain("Expires Never");
    // A start already passed says nothing; one to come is said.
    expect(text(render(summary({ validFrom: slotIn(-60_000), validUntil: until })))).not.toContain("Valid from");
    const later = slotIn(30 * 86_400_000);
    expect(text(render(summary({ validFrom: later, validUntil: until })))).toContain(`Valid from ${slotText("preprod", later)}`);
  });
});

// Chunk 51, e3a#3 (with e3b#1): a site's CIP-8 message, and its transaction's CIP-20 note, were shown as they came, so
// a direction override or an invisible character still acted on the screen: "Pay U+202E 0001 U+202C ADA" read "Pay
// 1000 ADA" over bytes that say 0001, and a zero-width space made two messages read the same. Now they're shown as
// what's signed reads: each such character written as its code, as the transaction view writes the chain's text
// (WebAssembly's decode.rs `shown`), with one short line saying so.
describe("a site's own text in the window, as what's signed reads", () => {
  const [RLO, PDF, ZWSP, BOM] = [0x202e, 0x202c, 0x200b, 0xfeff].map((c) => String.fromCodePoint(c));
  /** What changes how text reads without showing (decode.rs hidden()'s set), but a tab and line breaks. */
  const HIDDEN = /[\p{Cf}\p{Default_Ignorable_Code_Point}\p{Cc}\p{Zl}\p{Zp}]/u;
  const raw = (html: string) => [...html].filter((c) => HIDDEN.test(c) && !"\t\n\r".includes(c));
  const shown = (html: string, testId: string) => new RegExp(`data-testid="${testId}">([\\s\\S]*?)</pre>`).exec(html)?.[1];
  const message = (text?: string) =>
    renderToStaticMarkup(createElement(SignData, { address: ADDRESS, signer: "payment", payload: "00", text }));

  it("writes a direction override or an invisible character in a message as its code, and says so in one line", () => {
    const html = message(`${BOM}Pay ${RLO}0001${PDF} ADA, nonce 4${ZWSP}2`);
    expect(raw(html)).toEqual([]);
    expect(shown(html, "dapp-data-message")).toBe(String.raw`\u{FEFF}Pay \u{202E}0001\u{202C} ADA, nonce 4\u{200B}2`);
    expect(text(html)).toContain(i18n.t("dappUi.warn.hiddenChars"));
    // Plain text, its lines, tabs and any script as they are, and hex where it isn't text: nothing to say.
    for (const plain of ["Sign in to app.example\nNonce:\t42", "שלום 日本語 🙂 1,000 ₳"]) {
      expect(shown(message(plain), "dapp-data-message")).toBe(plain);
      expect(message(plain)).not.toContain('data-testid="dapp-data-escaped"');
    }
    expect(shown(message(), "dapp-data-message")).toBe("00");
    expect(message()).not.toContain('data-testid="dapp-data-escaped"');
  });

  it("writes a transaction's note the same way", () => {
    const html = render(summary({ note: [`Pay ${RLO}0001${PDF} ADA`, `order 7${ZWSP}7`] }));
    expect(raw(html)).toEqual([]);
    expect(shown(html, "dapp-note")).toBe(`${String.raw`Pay \u{202E}0001\u{202C} ADA`}\n${String.raw`order 7\u{200B}7`}`);
    expect(text(html)).toContain(i18n.t("dappUi.warn.hiddenChars"));
    expect(render(summary({ note: ["Thanks for your order"] }))).not.toContain('data-testid="dapp-note-escaped"');
  });

  it("writes each such character as the transaction view writes the chain's text, and every other as it is", () => {
    const wasm = loadTestWasm();
    // decode_test.rs's every_invisible_character_is_escaped, and more of what its set holds: C1 controls, a soft
    // hyphen, a word joiner, an Arabic letter mark, a zero-width space.
    const hidden = [
      0x034f, 0x115f, 0x3164, 0xffa0, 0x180b, 0x17b4, 0x0890, 0xfff9, 0xe0041, 0xe0100, 0x200e, 0x202e, 0x2068, 0x2028, 0x2029,
      0xfeff, 0x1bca0, 0x13430, 0x1d173, 0x0085, 0x009f, 0x00ad, 0x2060, 0x061c, 0x200b,
    ];
    const lines = [...hidden.map((c) => `a${String.fromCodePoint(c)}b`), "שלום", "日本語", "émoji 🙂", "1,000 ₳"];
    // A transaction with them as its CIP-20 note's lines (label 674's "msg"), for the transaction view to read.
    const tstr = (s: string) => {
      const b = Buffer.from(s, "utf8");
      return `${b.length < 24 ? (0x60 + b.length).toString(16) : `78${b.length.toString(16).padStart(2, "0")}`}${b.toString("hex")}`;
    };
    const body = `a30081825820${"00".repeat(32)}000181825839${wasm.cip30Address(ADDRESS)}1a003d0900021a00029810`;
    expect(lines.length).toBeGreaterThanOrEqual(24);
    const note = `a11902a2a1636d736798${lines.length.toString(16).padStart(2, "0")}${lines.map(tstr).join("")}`;
    const viewed = (JSON.parse(wasm.decodeTx(wasm.Network.Preprod, `84${body}a0f5${note}`)) as TxDetail).note;
    expect(viewed).toHaveLength(lines.length);
    expect(lines.map((l) => shownSiteText(l).text)).toEqual(viewed);
    expect(lines.map((l) => shownSiteText(l).escaped)).toEqual(lines.map((_, i) => i < hidden.length));
    // But for what a message is laid out by, which the window keeps and the view's one-line values don't.
    expect(shownSiteText("a\tb\r\nc")).toEqual({ text: "a\tb\r\nc", escaped: false });
  });
});

// Chunk 51, x1a#3: a site's transaction with a CIP-20 note and other metadata beside it. The body commits to all of it
// (its auxiliary data hash), so signing publishes all of it, under the account's signature, for good. The window said
// "It carries metadata, which anyone can read." only with no note: beside one, it showed the note's lines and named
// nothing else, though WebAssembly's summary says there's metadata. The worker reads the same bytes as Transaction
// details does and says when there's more than the note (`otherMetadata`), and the window says so. Through the real
// worker and WebAssembly, as the window gets the request.
describe("a site's transaction's metadata beside its note (chunk 51, x1a#3)", () => {
  const signer = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
  const OWN = signer.preprod.receive_0 as string;
  const SITE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 15)!.preprod
    .receive_0 as string;
  const INPUT = "11".repeat(32);
  /** A CBOR text string of fewer than 256 bytes. */
  const cborText = (s: string) => {
    const n = Buffer.byteLength(s, "utf8");
    return `${n < 24 ? (0x60 + n).toString(16) : `78${n.toString(16).padStart(2, "0")}`}${hex(s)}`;
  };
  const NOTE = "Thanks for order 77";
  /** CIP-20's message: 674 → {"msg": [NOTE]}. */
  const note = `1902a2a1${cborText("msg")}81${cborText(NOTE)}`;
  /** What else the site writes, under a label of its own: 1337 → {"email": "alice@example.com", "order": 77}. */
  const other = `190539a2${cborText("email")}${cborText("alice@example.com")}${cborText("order")}184d`;
  /** A site's transaction: the account's 10 ₳ pays it 4 ₳, with `metadata` (a CBOR map) and its hash in the body. */
  const withMetadata = (metadata: string) => {
    const wasm = loadTestWasm();
    const digest = bytesToHex(blake2b(Buffer.from(metadata, "hex"), { dkLen: 32 }));
    const body = `a40081825820${INPUT}00018182${`5839${wasm.cip30Address(SITE)}`}1a003d0900021a00029810075820${digest}`;
    return `84${body}a0f5${metadata}`;
  };
  const LINE = () => i18n.t("dappUi.note.privacy.otherMetadata");
  const METADATA = () => i18n.t("dappUi.note.metadata");

  async function until(check: () => boolean) {
    for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
    expect(check()).toBe(true);
  }

  /** The worker's request for a site's `txCbor`, spending `input` of the account's, and the window's words for it. */
  async function signWindow(txCbor: string, input: { tx_hash: string; tx_index: number; value: string }) {
    const t = testBalances();
    await t.wallet.create(signer.phrase, "correct horse battery");
    await t.preferences.set({ dappConnector: true, dappPassword: false, spendRewards: false });
    const template = Object.values(koiosPreprod.accounts)
      .flatMap((a) => a.account_utxos)
      .find((u) => u.address === OWN)!;
    t.koios.addedToAccounts.push({ ...template, ...input, asset_list: [], block_height: 1 });
    const s = { id: `x1a3-${input.tx_hash.slice(0, 6)}`, origin: "https://app.example", title: "App" };
    const enabling = t.dapp.call(s, "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    expect(await enabling).toBe(true);
    const signing = t.dapp.call(s, "signTx", [txCbor, false]).catch(() => undefined);
    await until(() => t.dapp.approvals().length === 1);
    const asked = t.dapp.approvals()[0]!;
    if (asked.kind !== "sign-tx") throw new Error(`a sign-tx approval, not ${asked.kind}`);
    await t.dapp.answer(asked.id, false);
    await signing;
    return { summary: asked.summary, page: text(render(asked.summary)) };
  }
  const ten = { tx_hash: INPUT, tx_index: 0, value: "10000000" };

  it("says it carries metadata when there's no note, as it did", async () => {
    const { summary, page } = await signWindow(withMetadata(`a1${other}`), ten);
    expect(summary).toMatchObject({ metadata: true, note: null });
    expect(page).toContain(METADATA());
    expect(page).not.toContain(LINE());
  }, 60_000);

  it("names the metadata a site writes under another label beside its note", async () => {
    const { summary, page } = await signWindow(withMetadata(`a2${note}${other}`), ten);
    expect(summary).toMatchObject({ metadata: true, note: [NOTE], otherMetadata: true });
    expect(page).toContain(`Its note, which anyone can read ${NOTE}`);
    expect(page).toContain(LINE());
  }, 60_000);

  it("names the data Minswap's real preprod swap writes beside its note: the sender's address and the order", async () => {
    const fixture = JSON.parse(
      readFileSync(new URL("../../wasm/tests/fixtures/minswap-swap-preprod.json", import.meta.url), "utf8"),
    ) as { cbor: string; input: { tx_hash: string; tx_index: number; value: string } };
    const { summary, page } = await signWindow(fixture.cbor, fixture.input);
    expect(summary).toMatchObject({ metadata: true, note: ["Minswap: Aggregator Market Order"], otherMetadata: true });
    expect(page).toContain(LINE());
  }, 60_000);

  // Chunk 51, r2sign#2: a metadatum map is a list of pairs on chain, so a second "msg" under 674 is kept (cardano-cli
  // 11.0.0.0's view lists both), and the body's hash commits to it: signing publishes it too. The note is the first.
  const SECOND = "I agree to pay 500 ADA";
  const secondMsg = `1902a2a2${cborText("msg")}81${cborText(NOTE)}${cborText("msg")}81${cborText(SECOND)}`;

  it("names a second msg beside the note, which signing publishes too", async () => {
    const tx = withMetadata(`a1${secondMsg}`);
    const wasm = loadTestWasm();
    const detail = JSON.parse(wasm.decodeTx(wasm.Network.Preprod, tx)) as TxDetail;
    expect(detail.metadataHashMatches).toBe(true);
    const entries = detail.metadata[0]?.value.type === "map" ? detail.metadata[0].value.entries : [];
    expect(entries.map((e) => (e.key.type === "text" ? e.key.text : e.key.type))).toEqual(["msg", "msg"]);
    expect(JSON.stringify(entries[1]?.value)).toContain(SECOND);

    const { summary, page } = await signWindow(tx, ten);
    expect(summary).toMatchObject({ metadata: true, note: [NOTE], otherMetadata: true });
    expect(page).toContain(`Its note, which anyone can read ${NOTE}`);
    expect(page).toContain(LINE());
  }, 60_000);

  it("reads a second 674 label as more than the note, though the ledger refuses one", () => {
    const wasm = loadTestWasm();
    const read = (metadata: string) =>
      (JSON.parse(wasm.decodeTx(wasm.Network.Preprod, withMetadata(metadata))) as TxDetail).metadata;
    const second = `1902a2a1${cborText("msg")}81${cborText(SECOND)}`;
    expect(read(`a2${note}${second}`).map((m) => m.label)).toEqual(["674", "674"]);
    expect(moreThanNote(read(`a2${note}${second}`))).toBe(true);
    expect(moreThanNote(read(`a1${secondMsg}`))).toBe(true);
    expect(moreThanNote(read(`a1${note}`))).toBe(false);
  });

  it("adds nothing beside a note that's all its metadata holds", async () => {
    const { summary, page } = await signWindow(withMetadata(`a1${note}`), ten);
    expect(summary).toMatchObject({ metadata: true, note: [NOTE] });
    expect(summary.otherMetadata).toBeUndefined();
    expect(page).not.toContain(LINE());
    expect(page).not.toContain(METADATA());
  }, 60_000);
});

// Chunk 51, r2tests#1 and r2sign#1: what the window says of a payment into Seedelf Wallet's contract, by WebAssembly's
// reading of what's under it (cip30.rs `inspect`). A register only its key's holder can spend is a Seedelf payment: its
// privacy note, and signing's note never says the private balance is out of it, since it may be the user's own. None,
// or one anyone can prove, anyone can take; one no proof can meet is locked for good; and no Seedelf Wallet finds a
// payment that keeps its datum by hash, which the site may keep (never "anyone can take it", nor a register). The Pays
// list says "Seedelf Wallet's contract" for all four, so each callout is the window's one word of it, and none had a
// test: the dead one dropped, the whole suite passed (r2tests#1).
describe("a payment into Seedelf Wallet's contract, by what's under it (chunk 51, r2tests#1, r2sign#1)", () => {
  type Reading = "register" | "none" | "dead" | "hash";
  /** The contract's preprod address (tests/fixtures/owned-utxos.json). */
  const CONTRACT = "addr_test1wz2te2wqn85yllvs69grz6a5fsc60pczywg8dg9gp6j2g6g7mzn9f";
  const CALLOUTS: Record<Reading, { testId: string; tone: "warn" | "privacy"; words: (session: boolean) => string }> = {
    register: {
      testId: "dapp-seedelf-payment",
      tone: "privacy",
      words: (session) => i18n.t(session ? "dappUi.privacy.paysSeedelfSession" : "dappUi.privacy.paysSeedelfAccount"),
    },
    none: { testId: "dapp-seedelf-unsafe", tone: "warn", words: () => i18n.t("dappUi.warn.noRegister") },
    dead: { testId: "dapp-seedelf-dead", tone: "warn", words: () => i18n.t("dappUi.warn.deadRegister") },
    hash: { testId: "dapp-seedelf-hash", tone: "warn", words: () => i18n.t("dappUi.warn.datumByHash") },
  };
  const READINGS = Object.keys(CALLOUTS) as Reading[];
  /** A site's transaction paying 10 ₳ into the contract, read as `seedelf`: its datum inline, or kept by hash. */
  const paying = (seedelf: Reading) => {
    const datum = seedelf === "hash" ? "hash" : "inline";
    return summary({
      paid: [{ address: CONTRACT, lovelace: "10000000", tokens: [], datum, script: true, seedelf, ownPaymentKey: false }],
    });
  };

  it.each([false, true])("says each reading in its own callout and no other's, the session's too (%s)", (session) => {
    for (const reading of READINGS) {
      const html = render(paying(reading), "preprod", { session });
      const page = text(html);
      expect(page).toContain(i18n.t("dappUi.paid.withData", { what: i18n.t("dappUi.paid.seedelfContract") }));
      for (const other of READINGS) {
        const { testId, tone, words } = CALLOUTS[other];
        expect(html.includes(`<div class="callout callout--${tone}" data-testid="${testId}">`), `${testId} for "${reading}"`).toBe(
          other === reading,
        );
        expect(page.includes(words(session)), `${other}'s words for "${reading}"`).toBe(other === reading);
      }
    }
  });

  it("never calls a payment kept by hash anyone's or a register's", () => {
    const page = text(render(paying("hash")));
    expect(page).not.toMatch(/anyone can take|\bregister\b/i);
  });

  it("leaves the private balance out of signing's note only where nothing pays a Seedelf", () => {
    // The worker checked the wallet's other accounts and found none in it (`ties` []): the note says the private
    // balance isn't in it, but where a Seedelf is paid, which may be the user's own.
    const out = i18n.t("dappUi.privacy.notPrivate");
    for (const reading of READINGS) {
      expect(text(render(paying(reading), "preprod", { ties: [] })).includes(out), reading).toBe(reading !== "register");
    }
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
  // Where Review read v2's 5 ₳ pool taking a box of the spare ADA; with none, the note is hedged (1.8.0's release
  // review, O3: connector-lovejoin-review-fixes.test.ts).
  const wayBack = (lovejoin: boolean) =>
    text(renderToStaticMarkup(createElement(FundingWayBack, { fee: "233208", lovejoin, perBox: "4.1", summary: { lovejoinRoom: true } })));

  it("gives the return's fee as an estimate, and both ways' together with this one's exact", () => {
    const direct = wayBack(false);
    // 0.233208 + about 0.25: about 0.48 ₳.
    expect(direct).toContain("Its network fee, about 0.25 ₳ Network fees both ways, about 0.48 ₳");
    expect(direct).toContain("From the dApps page, straight into your private balance, the 5 ₳ kept aside too.");
    expect(direct).not.toContain("Lovejoin");
  });

  it("says in plain words what coming back through Lovejoin is, and what a box of it costs", () => {
    const through = wayBack(true);
    // A return's ADA goes into the 5 ₳ pool (chunk 44).
    expect(through).toContain("Through Lovejoin first, about 4.1 ₳ a 5 ₳ box");
    // Through Lovejoin the way back is a deposit, the mixes and the return (sessions.ts backBuild): two network fees
    // besides the mixes', so both ways are 0.233208 + 2 × about 0.25, about 0.73 ₳, as swapCosts and mixCosts count it.
    expect(through).toContain("Its network fees, about 0.5 ₳: Lovejoin's deposit and the return");
    expect(through).toContain("Network fees both ways, about 0.73 ₳");
    expect(through).not.toContain("Its network fee, about 0.25 ₳");
    expect(through).toContain("Lovejoin mixes the spare ADA so it's harder to tie to this session, back in 5 ₳ boxes hours later.");
    expect(through).toContain("Settings → Lovejoin turns that off.");
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
    expect(page).toContain("Nothing happens until you choose");
    expect(page).toContain("Your public account The site sees its addresses and balance, and keeps them. No fee.");
    // The more private choice isn't the harder one to read (chunk 23's second review, CW-7): what it costs in one
    // line, the fee each way with a figure, and what the site gets, not "sees only", which the note on what anyone can
    // follow qualifies (blind test §9.8, §7, T16). The 5 ₳ kept aside, which comes back, is said under its amount once
    // it's chosen (the copy-trim pass), for what it's for rather than as "collateral" (CW-8).
    expect(page).toContain(
      "A private session Only a new one-time account, funded from your private balance. A fee each way, about 0.25 ₳, and a minute.",
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
      "Sites always get Account 3 · Savings, whichever is on screen. Change it in Settings → Sites.",
    );
    expect(withAccounts([{ index: 0 }], 0)).not.toContain("Sites always get");
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
    expect(PUBLIC_PRIVACY()).toContain("The site never sees your private balance.");
    expect(PUBLIC_PRIVACY()).toContain("can recognize this browser later, even in a private session");
    expect(PRIVATE_SESSION_PRIVACY()).toContain("Anyone can follow this money, and money you made private leads back to your public account.");
    expect(PRIVATE_SESSION_PRIVACY()).toContain("If the site saw that account in this browser, it knows the session is yours.");
    expect(PRIVATE_SESSION_PRIVACY()).toContain("Another Chrome profile and a VPN avoid that.");
    expect(PRIVATE_SESSION_PRIVACY()).not.toContain("never appears");
    expect(fundingPrivacy("12300000")).toBe(
      "This payment ties the private UTxOs it spends, and its 12.3\u00a0₳ private change, to the one-time account. Anyone can see it on chain, the site too.",
    );
    expect(fundingPrivacy("0")).toBe(
      "This payment ties the private UTxOs it spends to the one-time account. Anyone can see it on chain, the site too.",
    );
  });

  // Chunk 51, e3b#5: a sent funding waits across a network switch (dapp.ts networkChanged), and the window, drawn again
  // on the other network, linked to that network's Cardanoscan, which hasn't the funding.
  it("links a sent funding on the network it went on, whichever network the window is on now", () => {
    const tx = "ab".repeat(32);
    const waiting = (network: NetworkName, sent?: NetworkName) =>
      renderToStaticMarkup(
        createElement(
          NetworkContext.Provider,
          { value: network },
          createElement(ConnectRequest, {
            approval: { kind: "connect", id: "a", origin: "https://app.example", password: false, funding: { index: 0, txHash: tx, ...(sent ? { network: sent } : {}) } },
            busy: false,
            held: false,
            onError: () => undefined,
            onAnswer: async () => true,
          }),
        ),
      );
    expect(waiting("preprod", "mainnet")).toContain(`href="https://cardanoscan.io/transaction/${tx}"`);
    expect(waiting("mainnet", "preprod")).toContain(`href="https://preprod.cardanoscan.io/transaction/${tx}"`);
    expect(waiting("preprod")).toContain(`href="https://preprod.cardanoscan.io/transaction/${tx}"`);
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
      "dapp.example is disconnected until it asks again and you agree. Its open pages may look connected until reloaded.",
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
