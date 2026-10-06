// Where each private UTxO's money came from (privacy review §2.3): how
// histories merge, what the UTxOs screen calls them, and the plain note a
// review shows when a spend merges them, with nothing to press.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  boxFrom,
  historiesNote,
  historyTags,
  isHistoryClass,
  madePrivate,
  merged,
  readClass,
  receivedIn,
  sessionClass,
  UNKNOWN,
} from "../src/shared/histories";
import type { KnownAccount, UtxoInfo } from "../src/shared/rpc";
import { AccountsContext, nameOf } from "../src/ui/accounts";
import { HistoriesNote } from "../src/ui/components/HistoriesNote";
import { historyOf, UtxoDetails } from "../src/ui/screens/Utxos";

const box = (n: number) => boxFrom(String(n).padStart(2, "0").repeat(32));
/** Money made private from the one public account a wallet had before chunk 18. */
const MADE_PRIVATE = madePrivate(0);
/** The id that wallet sealed it under. */
const LEGACY = { id: "public", origin: "own" } as const;

describe("merging histories", () => {
  it("names each history once, sorted, whatever order they're spent in", () => {
    const a = merged([sessionClass(1), MADE_PRIVATE]);
    expect(a).toEqual({ id: "public:0+session:1", origin: "session" });
    expect(merged([MADE_PRIVATE, sessionClass(1), MADE_PRIVATE])).toEqual(a);
    // Merged again, it stays one history.
    expect(merged([a, MADE_PRIVATE])).toEqual(a);
    expect(merged([MADE_PRIVATE])).toEqual(MADE_PRIVATE);
  });

  it("is named for the tie that reaches furthest, which selection ranks it by", () => {
    expect(merged([box(1), receivedIn("ab")]).origin).toBe("received");
    expect(merged([box(1), UNKNOWN]).origin).toBe("lovejoin");
    expect(merged([box(1), box(2)]).origin).toBe("lovejoin");
    expect(merged([UNKNOWN, MADE_PRIVATE]).origin).toBe("own");
    expect(merged([])).toEqual(UNKNOWN);
  });

  it("reads the bare public of a wallet from before several accounts as account 0's", () => {
    // Sealed history records written before chunk 18 hold "public", bare or
    // inside a merged id. Read as two classes, the wallet would say a spend
    // ties two accounts together when both are account 0 — a privacy note
    // that is simply false.
    expect(readClass(LEGACY)).toEqual(MADE_PRIVATE);
    expect(readClass({ id: "public+session:1", origin: "session" })).toEqual({ id: "public:0+session:1", origin: "session" });
    expect(merged([LEGACY, MADE_PRIVATE])).toEqual(MADE_PRIVATE);
    expect(merged([LEGACY, madePrivate(1)]).id).toBe("public:0+public:1");
    expect(historyTags(LEGACY)).toEqual(["Made private"]);
    expect(historiesNote([LEGACY, MADE_PRIVATE])).toBeUndefined();
    // A class canonical already comes back as it is, and anything that isn't one is still refused.
    expect(readClass(MADE_PRIVATE)).toBe(MADE_PRIVATE);
    expect(readClass({ id: "public", origin: "elsewhere" })).toBeUndefined();
    expect(readClass(undefined)).toBeUndefined();
  });

  it("reads only what it wrote", () => {
    expect(isHistoryClass(MADE_PRIVATE)).toBe(true);
    expect(isHistoryClass({ id: "public:0", origin: "elsewhere" })).toBe(false);
    expect(isHistoryClass({ id: "", origin: "own" })).toBe(false);
    expect(isHistoryClass(undefined)).toBe(false);
  });
});

describe("the UTxOs screen's tags", () => {
  it("say where the money came from, as a person counts sessions", () => {
    expect(historyTags(box(1))).toEqual(["Back from Lovejoin"]);
    expect(historyTags(receivedIn("ab"))).toEqual(["Received"]);
    expect(historyTags(MADE_PRIVATE)).toEqual(["Made private"]);
    expect(historyTags(sessionClass(0))).toEqual(["Private session 1"]);
    expect(historyTags(UNKNOWN)).toEqual(["Unknown"]);
    expect(historyTags(merged([box(1), box(2), MADE_PRIVATE]))).toEqual(["Back from Lovejoin", "Made private"]);
  });

  it("name which public account money was made private from, once there is more than one", () => {
    expect(historyTags(MADE_PRIVATE, 2)).toEqual(["Made private (account 1)"]);
    expect(historyTags(madePrivate(1), 2)).toEqual(["Made private (account 2)"]);
    expect(historyTags(merged([MADE_PRIVATE, madePrivate(1)]), 2)).toEqual(["Made private (account 1)", "Made private (account 2)"]);
    // With one account there is nothing to tell apart, so the tag stays as it was.
    expect(historyTags(MADE_PRIVATE, 1)).toEqual(["Made private"]);
    expect(historyTags(box(1), 3)).toEqual(["Back from Lovejoin"]);
  });

  it("are on each private UTxO the worker listed with one", () => {
    const u: UtxoInfo = { txHash: "ab".repeat(32), index: 0, lovelace: "9710000", tokens: [], locked: false };
    expect(historyOf(u)).toBeUndefined();
    expect(historyOf({ ...u, history: merged([sessionClass(2), receivedIn("cd")]) })).toBe("Received, Private session 3");
  });

  it("name the account in a UTxO's details too, where Lock is (release review C26)", () => {
    const utxo: UtxoInfo = { txHash: "ab".repeat(32), index: 0, lovelace: "9710000", tokens: [], locked: false };
    const noop = () => undefined;
    /** The details' "Came from" note, in a wallet that knows `accounts`. */
    const note = (history: UtxoInfo["history"], accounts: KnownAccount[]) => {
      const several = accounts.length > 1;
      const value = { accounts, active: 0, loaded: true, name: nameOf(accounts, 0), several, reload: async () => {} };
      const props = { of: "seedelf" as const, utxo: { ...utxo, history }, busy: false, onLock: noop, onClose: noop };
      const html = renderToStaticMarkup(createElement(AccountsContext.Provider, { value }, createElement(UtxoDetails, props)));
      return html.match(/data-testid="utxo-history-note">([^<]*)</)?.[1];
    };
    const two = [{ index: 0 }, { index: 1 }];
    expect(note(merged([MADE_PRIVATE, madePrivate(1)]), two)).toMatch(
      /^Came from: Made private \(account 1\), Made private \(account 2\)\./,
    );
    expect(note(madePrivate(1), two)).toMatch(/^Came from: Made private \(account 2\)\./);
    // With one account there is nothing to tell apart.
    expect(note(madePrivate(0), [{ index: 0 }])).toMatch(/^Came from: Made private\./);
  });
});

describe("a review's note", () => {
  it("says nothing when the money spent shares one history, or none is known", () => {
    expect(historiesNote(undefined)).toBeUndefined();
    expect(historiesNote([MADE_PRIVATE])).toBeUndefined();
    expect(historiesNote([merged([MADE_PRIVATE, sessionClass(1)])])).toBeUndefined();
  });

  it("says what spending boxes back from Lovejoin together ties", () => {
    expect(historiesNote([box(1), box(2), box(3)])).toBe(
      "This spends 3 boxes back from Lovejoin together. Anyone can see they're one owner's, which ties them to each other, and undoes some of what Lovejoin did for the boxes.",
    );
  });

  it("names every history merged, and says Max takes them all", () => {
    expect(historiesNote([box(1), MADE_PRIVATE, receivedIn("ab"), sessionClass(0), sessionClass(2), UNKNOWN], { max: true })).toBe(
      "Sending everything spends a box back from Lovejoin, a payment you received, money you made private, money the wallet has no history for, and money from Private sessions 1 and 3 together. Anyone can see they're one owner's, which ties them to each other, and undoes some of what Lovejoin did for the box.",
    );
  });

  it("names money another session left in a funding, but not the session's own", () => {
    expect(historiesNote([merged([MADE_PRIVATE, sessionClass(1)])], { session: 4 })).toBe(
      "It spends money that Private session 2 left, so anyone can tie that session to this one.",
    );
    expect(historiesNote([sessionClass(4)], { session: 4 })).toBeUndefined();
  });

  it("names the public accounts a spend ties to each other", () => {
    // What stealth addressing does not cover: the registers hid who the money
    // went to, not where an input came from, so spending two accounts' move-ins
    // together ties those accounts to one owner in the open.
    expect(historiesNote([MADE_PRIVATE, madePrivate(1)])).toBe(
      "This spends money you made private from accounts 1 and 2 together. Anyone can see they're one owner's, which ties them to each other. " +
        "It spends money you made private from accounts 1 and 2, so anyone can tie those accounts to each other.",
    );
    // One account alone: account 0's reads as it always has, and another's says which.
    expect(historiesNote([MADE_PRIVATE, receivedIn("ab")])).toContain("and money you made private together");
    expect(historiesNote([madePrivate(2), receivedIn("ab")])).toContain("and money you made private from account 3 together");
    expect(historiesNote([madePrivate(1)])).toBeUndefined();
  });

  it("is a plain note, with nothing to press", () => {
    const html = renderToStaticMarkup(createElement(HistoriesNote, { histories: [box(1), box(2)] }));
    expect(html).toMatch(/^<p class="note" data-testid="histories-note">This spends/);
    expect(html).not.toContain("<button");
    expect(renderToStaticMarkup(createElement(HistoriesNote, { histories: [box(1)] }))).toBe("");
  });
});
