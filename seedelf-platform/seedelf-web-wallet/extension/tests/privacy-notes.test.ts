// What the screens say where a click or a file tells someone what's the
// user's: the private Activity's CSV (privacy review §2.21).
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExportNote } from "../src/ui/screens/Activity";

/** What a person reads. */
const text = (element: ReactElement) =>
  renderToStaticMarkup(element)
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();

describe("the Activity CSV's note", () => {
  it("says, on the private side, what the file ties together for whoever has it", () => {
    const shown = text(createElement(ExportNote, { of: "seedelf", listed: 3, more: false }));
    expect(shown).toContain("The file isn't encrypted.");
    expect(shown).toContain("Each row has its transaction's ID, so whoever has it can find every one on the chain.");
    expect(shown).toContain(
      "It ties your private payments, your private sessions and your Lovejoin boxes to each other and to your public account",
    );
    expect(shown).toContain("shows which Seedelf each payment went to");
    expect(shown).toContain("Give it only to someone you'd show all of that.");
  });

  it("says the public side's is on the chain anyway, and what Load more adds", () => {
    const shown = text(createElement(ExportNote, { of: "cardano", listed: 20, more: true }));
    expect(shown).toContain("It has the 20 transactions read so far: Load more first to include older ones.");
    expect(shown).toContain("The file isn't encrypted, though everything in it is on the chain anyway.");
    expect(shown).not.toContain("Lovejoin");
  });
});
