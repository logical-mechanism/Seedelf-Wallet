// A stuck pool's Bring one back names the public accounts it ties, 1.6.0's release review (round 2, lane S1, sc-lj-2;
// x-privacy#0, the page's half). A box another public account's deposit put in, a Bootstrap's held box or a mix's cut
// short, was said as "your public account"'s, which reads as the one on screen; paying for it from that one ties the
// two accounts, which nothing said. The worker's half (wlj-1) has the private balance skip money made private from
// another account where it can, which the question now says too.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import { AccountsContext } from "../src/ui/accounts";
import { PreferencesContext } from "../src/ui/preferences";
import { AnywayQuestion, HeldQuestion, anywayWarning, heldAccountsOf } from "../src/ui/screens/Lovejoin";

const nothing = () => undefined;
const A = { txHash: "a1".repeat(32), txIndex: 0 };
const B = { txHash: "b2".repeat(32), txIndex: 0 };

/** `element` as a person reads it, on a wallet with public accounts 1 to 3 (`several`) on account `active` (from 0), or one. */
function read(element: ReactElement, active = 1, several = true): string {
  const accounts = several ? [{ index: 0 }, { index: 1 }, { index: 2 }] : [{ index: 0 }];
  return renderToStaticMarkup(
    createElement(
      AccountsContext.Provider,
      { value: { accounts, active, loaded: true, name: "", several, reload: async () => undefined } },
      createElement(PreferencesContext.Provider, { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } }, element),
    ),
  )
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();
}

const AVOIDS = "It avoids one made private from another public account where it can: that would tie the two accounts.";

describe("Bring one back of a Bootstrap's box another public account paid for (1.6.0's release review, x-privacy#0)", () => {
  it("names the account that paid, never 'your public account', and says paying from this one ties the two", () => {
    // On account 2, a held box account 1's Bootstrap put in, in a pool whose boxes can't pay their own way back.
    const said = read(createElement(HeldQuestion, { all: false, stuck: true, fromAccount: false, others: [0], onKeep: nothing, onConfirm: nothing }));
    expect(said).toContain("Account 1 paid for that Bootstrap, so such a box ties that account to your private balance too.");
    expect(said).not.toContain("Your public account paid for that Bootstrap");
    expect(said).toContain("That box is Account 1's, so paying from Account 2 ties the two accounts.");
    expect(said).toContain(AVOIDS);
    // Each payer's words stay with its own: what the private balance ties, then what the public account ties.
    expect(said.indexOf("Paid from your private balance")).toBeLessThan(said.indexOf(AVOIDS));
    expect(said.indexOf(AVOIDS)).toBeLessThan(said.indexOf("Paid from your public account"));
    expect(said.indexOf("Paid from your public account")).toBeLessThan(said.indexOf("That box is Account 1's"));
  });

  it("says the one on screen's as its own, and only what the private balance's payer may tie beside it", () => {
    const said = read(createElement(HeldQuestion, { all: false, stuck: true, fromAccount: true, others: [], onKeep: nothing, onConfirm: nothing }));
    expect(said).toContain("Your public account paid for that Bootstrap, so such a box ties the account to your private balance too.");
    expect(said).not.toContain("That box is");
    expect(said).toContain(AVOIDS);
  });

  it("names each account whose Bootstrap put in a box it lets go, the one on screen as its own", () => {
    const said = read(createElement(HeldQuestion, { all: true, stuck: false, fromAccount: true, others: [0, 2], onKeep: nothing, onConfirm: nothing }));
    expect(said).toContain("Your public account paid for that Bootstrap");
    expect(said).toContain("Account 1 and Account 3 paid for those Bootstraps, so such a box ties those accounts to your private balance too.");
    // Nobody pays one back here: no payer's words.
    expect(said).not.toContain("That box is");
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
    expect(said).toContain("That box is Account 1's, so paying from Account 2 ties the two accounts.");
    expect(said).toContain(AVOIDS);
  });

  it("reads as it did for the account on screen's own box", () => {
    const own = { notMixed: [A], fromPublic: [A], deposits: [A] };
    expect(anywayWarning(own)).toBe(
      "The server says your public account deposited it. Brought back now, anyone can tie your public account to your private balance. Mix again from my public account hides it first.",
    );
    const said = read(createElement(AnywayQuestion, { pool: own, stuck: true, onKeep: nothing, onConfirm: nothing }));
    expect(said).not.toContain("That box is");
    expect(said).toContain(AVOIDS);
  });
});
