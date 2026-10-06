// The owner's calls on the 1.2.0 release review (2026-10-06): an ambiguous
// pasted amount in Spanish (C03), and Remove choosing nothing where another
// account paid (C08).
import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "../src/i18n/core";
import { sanitizeAmount } from "../src/ui/format";
import { removeNote } from "../src/ui/screens/RemoveSeedelf";

const ada = { decimals: 6, max: 10_000_000_000n, notANumber: "number", tooPrecise: "precise", tooMuch: "too much" };

describe("a pasted 1,125", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("changes nothing in Spanish, where it could be 1125 or 1.125, and names both", async () => {
    await i18n.changeLanguage("es");
    const pasted = sanitizeAmount("5", "1,125", ada);
    expect(pasted.value).toBe("5");
    expect(pasted.note).toContain("1125");
    expect(pasted.note).toContain("1.125");
    // A comma with two digits after it is still the decimal mark, and a token without decimals can't be one.
    expect(sanitizeAmount("", "1,12", ada).value).toBe("1.12");
    expect(sanitizeAmount("", "1,125", { ...ada, decimals: 0 }).value).toBe("1,125");
  });

  it("is still thousands in English", () => {
    expect(sanitizeAmount("5", "1,125", ada).value).toBe("1,125");
  });
});

describe("Remove a Seedelf that another account paid for", () => {
  it("warns that the public account ties the two, while nothing is chosen", () => {
    const accounts = { paidByAccount: 1, active: 0, several: true, known: [] };
    expect(removeNote(undefined, "account", accounts).tone).toBe("warn");
  });
});
