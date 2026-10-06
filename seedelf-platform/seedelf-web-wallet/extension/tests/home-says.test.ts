// What Home and Activity say after the blind test's second fix round (the owner's calls, 2026-10-05): the actions
// name their side on the page, a disabled action's reason names the action, a restore is confirmed with what the
// phrase holds, and each Activity list has a row for the other side's. Rendered as the pages render them.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { t } from "../src/i18n";
import { i18n } from "../src/i18n/core";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { Balances, KnownAccount } from "../src/shared/rpc";
import { AccountsContext, nameOf } from "../src/ui/accounts";
import { ActionButton } from "../src/ui/components/ActionButton";
import { PreferencesContext } from "../src/ui/preferences";
import { OtherList, Who } from "../src/ui/screens/Activity";
import { privateWhy, RestoredNote } from "../src/ui/screens/Home";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

/** A page's text, as a person reads it. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** `element` as the pages have it: the settings read (balances shown unless `hidden`), and these accounts. */
const within = (element: ReactElement, { hidden = false, accounts = [{ index: 0 }] as KnownAccount[] } = {}) =>
  createElement(
    AccountsContext.Provider,
    {
      value: {
        accounts,
        active: 0,
        loaded: true,
        name: nameOf(accounts, 0),
        several: accounts.length > 1,
        reload: async () => undefined,
      },
    },
    createElement(
      PreferencesContext.Provider,
      { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances: hidden }, loaded: true, set: async () => undefined } },
      element,
    ),
  );

const none = { lovelace: "0", tokens: [], utxos: 0 };
const seedelf = { assetName: `5eed0e1f${"00".repeat(28)}`, lovelace: "1749860" };

/** A reading: each side's ADA and UTxO count, its Seedelfs, and what's on its way to it. */
function reading({
  privateAda = "0",
  privateUtxos = 0,
  publicAda = "0",
  publicUtxos = 0,
  rewards = "0",
  seedelfs = 0,
  publicIncoming = false,
}: {
  privateAda?: string;
  privateUtxos?: number;
  publicAda?: string;
  publicUtxos?: number;
  rewards?: string;
  seedelfs?: number;
  publicIncoming?: boolean;
} = {}): Balances {
  return {
    network: "preprod",
    updatedAt: 1,
    seedelf: {
      lovelace: privateAda,
      tokens: [],
      utxos: privateUtxos,
      seedelfs: Array.from({ length: seedelfs }, () => seedelf),
      locked: none,
    },
    cardano: {
      lovelace: publicAda,
      tokens: [],
      utxos: publicUtxos,
      addressesUsed: 0,
      locked: none,
      staking: { registered: false, pool: null, drep: null, rewards, deposit: "0" },
      ...(publicIncoming ? { incoming: { lovelace: "5000000", tokens: [], utxos: 1 } } : {}),
    },
  };
}

describe("Home's actions name their side (the owner's call on blind test T03, T20b, §5)", () => {
  it("shows the whole name, and has no second one for a screen reader to say", () => {
    for (const key of ["home.action.receivePrivately", "home.action.sendPrivately", "home.action.sendPublicly"] as const) {
      const html = renderToStaticMarkup(createElement(ActionButton, { icon: null, label: t(key), onClick: () => undefined }));
      expect(text(html)).toBe(t(key));
      expect(html).not.toContain("aria-label");
    }
    expect(t("home.action.receivePrivately")).toBe("Receive privately");
    expect(t("home.action.sendPublicly")).toBe("Send publicly");
  });

  it("breaks a Japanese name only where it's meant to, so two lines carry it", async () => {
    await i18n.changeLanguage("ja");
    // `word-break: keep-all` on the actions: a zero-width space is the one place a line may end.
    for (const key of ["home.action.receivePrivately", "home.action.sendPrivately"] as const) {
      expect(t(key).split("​")).toHaveLength(2);
      expect(t(key).startsWith("プライベート​")).toBe(true);
    }
    // Every action has exactly one, and its label is as narrow as its widest word, so each takes two lines and the
    // rows read evenly (the pass-two visual check).
    for (const key of ["home.action.makePublic", "home.action.receivePublicly", "home.action.sendPublicly", "home.action.makePrivate"] as const) {
      expect(t(key).split(String.fromCharCode(0x200b)), key).toHaveLength(2);
    }
  });
});

describe("why the Private tab's actions can't be pressed (blind test T03)", () => {
  it("is one line on a new wallet, naming every action it holds back", () => {
    const why = privateWhy(reading(), false);
    expect([why.canSpend, why.canCreate]).toEqual([false, false]);
    expect(why.lines).toEqual(["home.busy.fundFirstAll"]);
    // Create by its Seedelf, Send privately and Make public by the names they show: a reason the tooltips alone carried.
    expect(t("home.busy.fundFirstAll")).toBe(
      "Fund your public account first: it pays for your Seedelf, and what Send privately and Make public spend comes from it too",
    );
  });

  it("with the account funded and no Seedelf, says to create it first, for Send and Make public", () => {
    const why = privateWhy(reading({ publicAda: "100000000", publicUtxos: 1 }), false);
    expect(why.canCreate).toBe(true);
    expect(why.lines).toEqual(["home.busy.createFirst"]);
  });

  it("with a Seedelf and no private money, names Send and Make public, not “these”", () => {
    const why = privateWhy(reading({ publicAda: "100000000", publicUtxos: 1, seedelfs: 1 }), false);
    expect(why.lines).toEqual(["home.busy.makePrivateFirst"]);
    expect(t("home.busy.makePrivateFirst")).toBe("Make some ADA private first: Send privately and Make public pay from your private balance");
  });

  it("gives Create its own line when its reason differs, and that line names the Seedelf", () => {
    const why = privateWhy(reading({ seedelfs: 1 }), false);
    expect(why.lines).toEqual(["home.busy.makePrivateFirst", "home.busy.fundFirst"]);
    expect(t("home.busy.fundFirst")).toContain("Seedelf");
  });

  it("names the actions as their labels read, in each language (the pass-two visual check)", async () => {
    for (const language of ["en", "es", "ja"] as const) {
      await i18n.changeLanguage(language);
      // The Japanese labels break at a zero-width space; the reason names them whole.
      const label = (key: Parameters<typeof t>[0]) => t(key).replace(/\u200b/g, "");
      for (const reason of ["home.busy.fundFirstAll", "home.busy.createFirst", "home.busy.makePrivateFirst"] as const) {
        expect(t(reason)).toContain(label("home.action.sendPrivately"));
        expect(t(reason)).toContain(label("home.action.makePublic"));
      }
      expect(t("home.busy.publicEmpty")).toContain(label("home.action.receivePublicly"));
    }
  });

  it("says the wait once for all of them while a transaction confirms", () => {
    expect(privateWhy(reading(), true).lines).toEqual(["busy"]);
    expect(privateWhy(reading({ privateAda: "5000000", privateUtxos: 1, seedelfs: 1 }), true).lines).toEqual(["busy"]);
  });

  it("says nothing when every action can be pressed, or before the first reading", () => {
    expect(privateWhy(reading({ privateAda: "5000000", privateUtxos: 1, publicAda: "1", publicUtxos: 1, seedelfs: 1 }), false).lines).toEqual(
      [],
    );
    expect(privateWhy(undefined, false).lines).toEqual([]);
  });
});

describe("a restore is confirmed on Home (blind test T20a, T20b)", () => {
  const note = (balances?: Balances, options?: Parameters<typeof within>[1], failed = false) =>
    text(renderToStaticMarkup(within(createElement(RestoredNote, { balances, failed, onDismiss: () => undefined }), options)));

  it("says it's reading until the first reading is in", () => {
    expect(note()).toBe(
      "Wallet restored Reading what this phrase holds. A phrase you've used shows its balances once they're read. Dismiss",
    );
  });

  it("doesn't say it's reading once the reading has failed: Home's alert says that", () => {
    expect(note(undefined, undefined, true)).toBe(
      "Wallet restored A phrase you've used shows its balances once they're read. Dismiss",
    );
  });

  it("then says what the phrase holds on each side, as Home counts them: the rewards in the account's", () => {
    const found = note(reading({ privateAda: "28000000", privateUtxos: 2, publicAda: "10350538725", publicUtxos: 5, rewards: "57475311" }));
    expect(found).toBe(
      "Wallet restored This phrase holds 10,408.014036 ₳ in its public account and 28 ₳ in its private balance. Dismiss",
    );
  });

  it("hides the amounts with the eye", () => {
    expect(note(reading({ privateAda: "28000000", privateUtxos: 2 }), { hidden: true })).toContain(
      "holds •••• ₳ in its public account and •••• ₳ in its private balance",
    );
  });

  it("says an empty phrase is what a phrase never used holds, on this network", () => {
    expect(note(reading())).toBe(
      "Wallet restored This phrase holds nothing on Preprod yet. That's expected for a phrase never used: one you've used would show its balances here. Dismiss",
    );
  });

  it("counts a Seedelf as found, though nothing else is", () => {
    expect(note(reading({ seedelfs: 1 }))).toContain("This phrase holds 0 ₳ in its public account");
  });

  it("with the money in another account, says what the one shown holds and that more were found, never “nothing”", () => {
    // Account 0 empty, account 2 used: the look after the restore found it (the pass-two review: the note said "holds
    // nothing… never used", then that the phrase had used two accounts).
    const said = note(reading(), { accounts: [{ index: 0 }, { index: 1, foundAt: 5 }] });
    expect(said).toBe(
      "Wallet restored Account 1 holds 0 ₳, and the private balance holds 0 ₳. This phrase has used 1 more public account: the picker at the top switches to it. Dismiss",
    );
    expect(said).not.toContain("never used");
    expect(note(reading({ publicAda: "5000000", publicUtxos: 1 }), { accounts: [{ index: 0 }, { index: 1, foundAt: 5 }, { index: 2, foundAt: 5 }] })).toContain(
      "Account 1 holds 5 ₳, and the private balance holds 0 ₳. This phrase has used 2 more public accounts: the picker at the top switches to them.",
    );
  });

  it("counts only the accounts the look found used: one added by hand isn't one", () => {
    expect(note(reading(), { accounts: [{ index: 0 }, { index: 1337 }] })).toBe(
      "Wallet restored This phrase holds nothing on Preprod yet. That's expected for a phrase never used: one you've used would show its balances here. Dismiss",
    );
  });

  it("sets its sentences the Japanese way, with nothing between them", async () => {
    await i18n.changeLanguage("ja");
    expect(note(reading(), { accounts: [{ index: 0 }, { index: 1, foundAt: 5 }, { index: 2, foundAt: 5 }] })).toMatch(
      /あります。このフレーズは、ほかに公開アカウントを 2 個/,
    );
  });
});

describe("each Activity list has a row for the other side's (blind test E01)", () => {
  const row = (of: "seedelf" | "cardano") => text(renderToStaticMarkup(createElement(OtherList, { of, onOpen: () => undefined })));

  it("on Private activity: the public account's list", () => {
    expect(row("seedelf")).toBe("Public activity Payments to and from your public account");
  });

  it("on Public activity: the private balance's list", () => {
    expect(row("cardano")).toBe("Private activity Payments to and from your private balance");
  });
});

describe("an Activity entry's “and 2 more” (the pass-two visual check)", () => {
  const address = `addr_test1${"q".repeat(40)}ckpvw`;
  const html = (more?: number) => renderToStaticMarkup(createElement(Who, { name: address, more }));

  it("is a part of its own after the name, its space kept, so the name's tail can't run over it", () => {
    expect(html(1)).toMatch(/<\/span><\/span><span class="activity__more"> and 1 more<\/span>$/);
    expect(html(2)).toContain('<span class="activity__more"> and 2 more</span>');
    expect(html()).not.toContain("activity__more");
  });

  it("follows the language's order", async () => {
    await i18n.changeLanguage("ja");
    expect(html(2)).toContain('<span class="activity__more"> ほか 2 件</span>');
  });
});
