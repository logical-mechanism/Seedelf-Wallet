// A stuck pool's Bring one back names the public accounts it ties, 1.6.0's release review (round 2, lane S1, sc-lj-2;
// x-privacy#0, the page's half). A box another public account's deposit put in, a Bootstrap's held box or a mix's cut
// short, was said as "your public account"'s, which reads as the one on screen; paying for it from that one ties the
// two accounts, which nothing said. The worker's half (wlj-1) has the private balance skip money made private from
// another account where it can, which the question now says too. Each payer's note names the accounts in itself, rather
// than with a sentence after it (1.6.0's release review, R3-23); and the escape hatch, where it can take only another
// account's box, names that account too (R3-3).
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { t } from "../src/i18n";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import { AccountsContext } from "../src/ui/accounts";
import { PreferencesContext } from "../src/ui/preferences";
import { AnywayQuestion, HeldQuestion, PaidQuestion, anywayWarning, hatchAccountOf, heldAccountsOf } from "../src/ui/screens/Lovejoin";

const nothing = () => undefined;
const A = { txHash: "a1".repeat(32), txIndex: 0 };
const B = { txHash: "b2".repeat(32), txIndex: 0 };

/** `element`'s markup, on a wallet with public accounts 1 to 3 (`several`) on account `active` (from 0), or one. */
function markup(element: ReactElement, active = 1, several = true): string {
  const accounts = several ? [{ index: 0 }, { index: 1 }, { index: 2 }] : [{ index: 0 }];
  return renderToStaticMarkup(
    createElement(
      AccountsContext.Provider,
      { value: { accounts, active, loaded: true, name: "", several, reload: async () => undefined } },
      createElement(PreferencesContext.Provider, { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } }, element),
    ),
  );
}

/** Markup as a person reads it. */
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replace(/\s+/g, " ").trim();

/** `element` as a person reads it, on a wallet with public accounts 1 to 3 (`several`) on account `active` (from 0), or one. */
const read = (element: ReactElement, active = 1, several = true) => words(markup(element, active, several));

/** Each note of `element`, the payers' among them, as a person reads it. */
const notes = (element: ReactElement, active = 1) => [...markup(element, active).matchAll(/<p class="note">(.*?)<\/p>/g)].map((m) => words(m[1]!));

/** The private payer's note's last sentence, where the box is a public account's and the wallet has several. */
const AVOIDS = "Where it can, the wallet takes one that came back from Lovejoin, else one that ties no other account.";

/** The public payer's note, where the box is another account's: `account`'s, paid from `active`. */
const TIES = (active: string, account: string) =>
  `Paid from ${active}, one of its UTxOs goes into the box's own transaction, so anyone can tie ${active} to the box, to ${account}, whose box it is, and to the private UTxO it comes back into.`;

describe("Bring one back of a Bootstrap's box another public account paid for (1.6.0's release review, x-privacy#0)", () => {
  it("names the account that paid, never 'your public account', and says paying from this one ties the two", () => {
    // On account 2, a held box account 1's Bootstrap put in, in a pool whose boxes can't pay their own way back.
    const said = read(createElement(HeldQuestion, { all: false, stuck: true, fromAccount: false, others: [0], onKeep: nothing, onConfirm: nothing }));
    expect(said).toContain("Account 1 paid for that Bootstrap, so such a box ties that account to your private balance too.");
    expect(said).not.toContain("Your public account paid for that Bootstrap");
    expect(said).toContain(TIES("Account 2", "Account 1"));
    expect(said).toContain(AVOIDS);
    // Each payer's words stay with its own: what the private balance ties, then what the public account ties.
    expect(said.indexOf("Paid from your private balance")).toBeLessThan(said.indexOf(AVOIDS));
    expect(said.indexOf(AVOIDS)).toBeLessThan(said.indexOf("Paid from Account 2"));
  });

  it("says the one on screen's as its own, and only what the private balance's payer may tie beside it", () => {
    const said = read(createElement(HeldQuestion, { all: false, stuck: true, fromAccount: true, others: [], onKeep: nothing, onConfirm: nothing }));
    expect(said).toContain("Your public account paid for that Bootstrap, so such a box ties the account to your private balance too.");
    expect(said).not.toContain("whose box it is");
    expect(said).toContain(t("lovejoin.stuck.privacy.public"));
    expect(said).toContain(AVOIDS);
  });

  it("names each account whose Bootstrap put in a box it lets go, the one on screen as its own", () => {
    const said = read(createElement(HeldQuestion, { all: true, stuck: false, fromAccount: true, others: [0, 2], onKeep: nothing, onConfirm: nothing }));
    expect(said).toContain("Your public account paid for that Bootstrap");
    expect(said).toContain("Account 1 and Account 3 paid for those Bootstraps, so such a box ties those accounts to your private balance too.");
    // Nobody pays one back here: no payer's words.
    expect(said).not.toContain("whose box it is");
    expect(said).not.toContain(AVOIDS);
  });

  it("with one public account, reads as it did: nothing to tell apart", () => {
    const said = read(createElement(HeldQuestion, { all: false, stuck: true, fromAccount: true, onKeep: nothing, onConfirm: nothing }), 0, false);
    expect(said).toContain("Your public account paid for that Bootstrap");
    expect(said).not.toContain("Account 1");
    expect(said).not.toContain(AVOIDS);
    // A private Bootstrap's box: no account at all, on any wallet.
    const own = read(createElement(HeldQuestion, { all: false, stuck: true, fromAccount: false, onKeep: nothing, onConfirm: nothing }));
    expect(own).not.toContain("paid for that Bootstrap");
    expect(own).not.toContain(AVOIDS);
  });

  it("takes which accounts paid for the boxes it's asked of from the pool's read: the active one's apart, the others by index", () => {
    const pool = { otherAccounts: [{ ...A, account: 0 }, { ...B, account: 2 }] };
    const C = { txHash: "c3".repeat(32), txIndex: 1 };
    expect(heldAccountsOf(pool, [A])).toEqual({ fromAccount: false, others: [0] });
    expect(heldAccountsOf(pool, [C])).toEqual({ fromAccount: true, others: [] });
    expect(heldAccountsOf(pool, [B, C, A])).toEqual({ fromAccount: true, others: [0, 2] });
    expect(heldAccountsOf({}, [])).toEqual({ fromAccount: false, others: [] });
  });
});

describe("Bring one back anyway of a box another public account's deposit put in (1.6.0's release review, x-privacy#0)", () => {
  // Account 1's mix stopped at its deposit, or the server says account 1 deposited it: on account 2.
  const pool = (deposits: boolean) => ({
    notMixed: [A],
    fromPublic: [A],
    otherAccounts: [{ ...A, account: 0 }],
    ...(deposits ? { deposits: [A] } : {}),
  });

  it("names the account, and where it's mixed again from, never 'your public account'", () => {
    const found = read(createElement(AnywayQuestion, { pool: pool(true), stuck: false, onKeep: nothing, onConfirm: nothing }));
    expect(found).toContain("The server says Account 1 deposited it. Brought back now, anyone can tie that account to your private balance.");
    expect(found).toContain("On Account 1, Mix again from my public account hides it first.");
    expect(found).not.toContain("your public account");
    const stopped = read(createElement(AnywayQuestion, { pool: pool(false), stuck: false, onKeep: nothing, onConfirm: nothing }));
    expect(stopped).toContain("Its mix from Account 1 stopped before mixing it. Brought back now, anyone can tie that account to your private balance.");
    // Mixing again refused in the pool: no button named.
    const off = read(createElement(AnywayQuestion, { pool: pool(false), stuck: false, againOff: true, onKeep: nothing, onConfirm: nothing }));
    expect(off).not.toContain("Mix again from my public account");
  });

  it("in a stuck pool, says paying from this account ties it to that one", () => {
    const said = read(createElement(AnywayQuestion, { pool: pool(false), stuck: true, onKeep: nothing, onConfirm: nothing }));
    expect(said).toContain(TIES("Account 2", "Account 1"));
    expect(said).toContain(AVOIDS);
  });

  it("reads as it did for the account on screen's own box", () => {
    const own = { notMixed: [A], fromPublic: [A], deposits: [A] };
    expect(anywayWarning(own)).toBe(
      "The server says your public account deposited it. Brought back now, anyone can tie your public account to your private balance. Mix again from my public account hides it first.",
    );
    const said = read(createElement(AnywayQuestion, { pool: own, stuck: true, onKeep: nothing, onConfirm: nothing }));
    expect(said).not.toContain("whose box it is");
    expect(said).toContain(AVOIDS);
  });

  it("names the accounts in each payer's own note, never in a sentence after it (R3-23)", () => {
    const [warning, ...payers] = notes(createElement(AnywayQuestion, { pool: pool(false), stuck: true, onKeep: nothing, onConfirm: nothing }));
    expect(warning).toBe(anywayWarning(pool(false), false, "Account 1"));
    expect(payers).toEqual([t("lovejoin.stuck.privacy.privateNamed"), TIES("Account 2", "Account 1")]);
    // Six sentences in all, as before the accounts were named: two each.
    expect([warning, ...payers].join(" ").split(/[.!?](?:\s|$)/).filter(Boolean)).toHaveLength(6);
  });
});

describe("the escape hatch, where the only box it can take is another public account's (1.6.0's release review, R3-3)", () => {
  const C = { txHash: "c3".repeat(32), txIndex: 1 };
  const pool = (boxes: Array<typeof A>, otherAccounts: Array<typeof A & { account: number }>, notMixed: Array<typeof A> = []) => ({
    boxes,
    notMixed,
    otherAccounts,
  });

  it("names that account, the lowest of several, as the worker takes them, and none while it may take another", () => {
    expect(hatchAccountOf(pool([A, B], [{ ...A, account: 2 }, { ...B, account: 0 }]))).toBe(0);
    // The account on screen's own, or one no public account put in: the worker takes that first, naming nobody.
    expect(hatchAccountOf(pool([A, C], [{ ...A, account: 2 }]))).toBeUndefined();
    // A box it never takes, one not mixed yet, leaves another account's alone.
    expect(hatchAccountOf(pool([A, C], [{ ...A, account: 2 }], [C]))).toBe(2);
    expect(hatchAccountOf(pool([], []))).toBeUndefined();
  });

  it("says paying from this account ties it to that one, and what the private balance avoids", () => {
    const said = read(createElement(PaidQuestion, { account: 0, onKeep: nothing, onConfirm: nothing }));
    expect(said).toContain(TIES("Account 2", "Account 1"));
    expect(said).toContain(AVOIDS);
    // Naming none, as it was.
    const plain = read(createElement(PaidQuestion, { account: undefined, onKeep: nothing, onConfirm: nothing }));
    expect(plain).toContain(t("lovejoin.stuck.privacy.private"));
    expect(plain).toContain(t("lovejoin.stuck.privacy.public"));
    expect(plain).not.toContain(AVOIDS);
  });
});
