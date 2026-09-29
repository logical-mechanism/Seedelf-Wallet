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
  MADE_PRIVATE,
  merged,
  receivedIn,
  sessionClass,
  UNKNOWN,
} from "../src/shared/histories";
import type { UtxoInfo } from "../src/shared/rpc";
import { HistoriesNote } from "../src/ui/components/HistoriesNote";
import { historyOf } from "../src/ui/screens/Utxos";

const box = (n: number) => boxFrom(String(n).padStart(2, "0").repeat(32));

describe("merging histories", () => {
  it("names each history once, sorted, whatever order they're spent in", () => {
    const a = merged([sessionClass(1), MADE_PRIVATE]);
    expect(a).toEqual({ id: "public+session:1", origin: "session" });
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

  it("reads only what it wrote", () => {
    expect(isHistoryClass(MADE_PRIVATE)).toBe(true);
    expect(isHistoryClass({ id: "public", origin: "elsewhere" })).toBe(false);
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

  it("are on each private UTxO the worker listed with one", () => {
    const u: UtxoInfo = { txHash: "ab".repeat(32), index: 0, lovelace: "9710000", tokens: [], locked: false };
    expect(historyOf(u)).toBeUndefined();
    expect(historyOf({ ...u, history: merged([sessionClass(2), receivedIn("cd")]) })).toBe("Received, Private session 3");
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

  it("is a plain note, with nothing to press", () => {
    const html = renderToStaticMarkup(createElement(HistoriesNote, { histories: [box(1), box(2)] }));
    expect(html).toMatch(/^<p class="note" data-testid="histories-note">This spends/);
    expect(html).not.toContain("<button");
    expect(renderToStaticMarkup(createElement(HistoriesNote, { histories: [box(1)] }))).toBe("");
  });
});
