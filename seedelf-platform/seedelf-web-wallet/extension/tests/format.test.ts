import { describe, expect, it } from "vitest";

import { formatAda, formatQuantity, shortHex, timeAgo, tokenName } from "../src/ui/format";

describe("formatting", () => {
  it("formats lovelace as ADA exactly", () => {
    expect(formatAda("0")).toBe("0");
    expect(formatAda("1500000")).toBe("1.5");
    expect(formatAda("28000000")).toBe("28");
    expect(formatAda("10350538725")).toBe("10,350.538725");
    expect(formatAda("45000000000000001")).toBe("45,000,000,000.000001");
  });

  it("formats token quantities with their decimals", () => {
    expect(formatQuantity("1234560000", 6)).toBe("1,234.56");
    expect(formatQuantity("2500000000", 0)).toBe("2,500,000,000");
    expect(formatQuantity("5", 2)).toBe("0.05");
    expect(formatQuantity("-5", 2)).toBe("-0.05");
  });

  it("names tokens, dropping CIP-67 labels", () => {
    expect(tokenName("5349524955532d42")).toBe("SIRIUS-B");
    expect(tokenName("0014df104c494e4b")).toBe("LINK");
    expect(tokenName("000de140" + Buffer.from("elf #1").toString("hex"))).toBe("elf #1");
    expect(tokenName(Buffer.from("🌱 seed").toString("hex"))).toBe("🌱 seed");
    expect(tokenName("5eed0e1f0272b6c6cde1a5652ecf4480d4f70b3a0601b4a40b3ed3fd096d7b8a")).toBe("5eed0e1f…7b8a");
    expect(tokenName("00ff")).toBe("00ff");
    expect(tokenName("")).toBe("(no name)");
  });

  it("shortens hex and times", () => {
    expect(shortHex("abcdef")).toBe("abcdef");
    expect(timeAgo(0, 2000)).toBe("just now");
    expect(timeAgo(0, 42_000)).toBe("42 s ago");
    expect(timeAgo(0, 3 * 60_000)).toBe("3 min ago");
    expect(timeAgo(0, 2 * 3_600_000)).toBe("2 h ago");
  });
});

describe("parseAda", () => {
  it("reads typed ADA amounts exactly", async () => {
    const { parseAda, explorerUrl } = await import("../src/ui/format");
    expect(parseAda("25")).toBe("25000000");
    expect(parseAda(" 1,234.5 ")).toBe("1234500000");
    expect(parseAda("0.000001")).toBe("1");
    expect(parseAda("10.")).toBe("10000000");
    expect(parseAda("90071992547.409931")).toBe("90071992547409931");
    for (const bad of ["", "-1", "1.2345678", "abc", "1e6", ".5"]) expect(parseAda(bad)).toBeUndefined();
    expect(explorerUrl("preprod", "ab")).toBe("https://preprod.cardanoscan.io/transaction/ab");
    expect(explorerUrl("mainnet", "ab")).toBe("https://cardanoscan.io/transaction/ab");
  });
});

describe("parseQuantity", () => {
  it("reads token amounts with the token's decimals", async () => {
    const { parseQuantity } = await import("../src/ui/format");
    expect(parseQuantity("1", 6)).toBe("1000000");
    expect(parseQuantity("1,234.56", 6)).toBe("1234560000");
    expect(parseQuantity("42", 0)).toBe("42");
    expect(parseQuantity("42.", 0)).toBe("42");
    for (const bad of ["", "1.5", "-3", "x"]) expect(parseQuantity(bad, 0)).toBeUndefined();
    expect(parseQuantity("0.1234567", 6)).toBeUndefined();
  });
});

describe("sanitizeAda", () => {
  it("keeps at most 6 decimals, dropping the rest rather than rounding", async () => {
    const { sanitizeAda } = await import("../src/ui/format");
    expect(sanitizeAda("", "10.1234567890")).toEqual({
      value: "10.123456",
      note: "ADA has at most 6 decimal places (0.000001 ₳ is one lovelace), so the extra digits were dropped.",
    });
    expect(sanitizeAda("", "0.9999999")).toMatchObject({ value: "0.999999" });
    expect(sanitizeAda("", "10.123456")).toEqual({ value: "10.123456" });
    expect(sanitizeAda("", "1,234.5")).toEqual({ value: "1,234.5" });
    expect(sanitizeAda("", "10.")).toEqual({ value: "10." });
    expect(sanitizeAda("", ".5")).toEqual({ value: "0.5" });
    expect(sanitizeAda("12", "")).toEqual({ value: "" });
  });

  it("refuses what isn't a number and keeps the previous value", async () => {
    const { sanitizeAda } = await import("../src/ui/format");
    for (const bad of ["12a", "-5", "1e6", "1.2.3", ",", "₳5"]) {
      expect(sanitizeAda("12", bad)).toEqual({ value: "12", note: "Enter an amount in ADA, like 25 or 12.5." });
    }
  });
});

describe("sanitizeAda: supply", () => {
  it("refuses more than the 45 billion ADA that exist", async () => {
    const { sanitizeAda, MAX_SUPPLY_LOVELACE } = await import("../src/ui/format");
    expect(MAX_SUPPLY_LOVELACE).toBe(45_000_000_000n * 1_000_000n);
    const refused = { value: "12", note: "That's more than all the ADA there is: 45 billion ₳." };
    expect(sanitizeAda("12", "99999999999999999999999999999999999999999")).toEqual(refused);
    expect(sanitizeAda("12", "45000000000.000001")).toEqual(refused);
    expect(sanitizeAda("12", "45,000,000,001")).toEqual(refused);
    expect(sanitizeAda("12", "45000000000")).toEqual({ value: "45,000,000,000" });
    expect(sanitizeAda("12", "44999999999.9999999")).toMatchObject({ value: "44,999,999,999.999999" });
  });
});

describe("sanitizeAmount: commas", () => {
  it("groups the thousands again wherever commas were typed or deleted", async () => {
    const { sanitizeAda } = await import("../src/ui/format");
    expect(sanitizeAda("", "3,000,000,00")).toEqual({ value: "300,000,000" });
    expect(sanitizeAda("", "1234567.5")).toEqual({ value: "1,234,567.5" });
    expect(sanitizeAda("", "1,2,3,4")).toEqual({ value: "1,234" });
    expect(sanitizeAda("", "0,000,5")).toEqual({ value: "5" });
    expect(sanitizeAda("", "1000.")).toEqual({ value: "1,000." });
    expect(sanitizeAda("", "999")).toEqual({ value: "999" });
  });
});

describe("sanitizeAmount: a token", () => {
  const rules = (decimals: number, held: bigint) => ({
    decimals,
    max: held,
    notANumber: "number",
    tooPrecise: "precise",
    tooMuch: "too much",
  });

  it("refuses more than the wallet holds, keeping the previous value", async () => {
    const { sanitizeAmount } = await import("../src/ui/format");
    // 1,234.56 held, 2 decimals.
    const held = rules(2, 123_456n);
    expect(sanitizeAmount("200", "2000", held)).toEqual({ value: "200", note: "too much" });
    expect(sanitizeAmount("", "1234.57", held)).toEqual({ value: "", note: "too much" });
    expect(sanitizeAmount("", "1234.56", held)).toEqual({ value: "1,234.56" });
    expect(sanitizeAmount("", "1234.567", held)).toEqual({ value: "1,234.56", note: "precise" });
  });

  it("takes whole units only when the token has no decimals", async () => {
    const { sanitizeAmount } = await import("../src/ui/format");
    const whole = rules(0, 3_000_000_000n);
    expect(sanitizeAmount("", "1000000", whole)).toEqual({ value: "1,000,000" });
    expect(sanitizeAmount("", "12.", whole)).toEqual({ value: "12" });
    expect(sanitizeAmount("", "12.5", whole)).toEqual({ value: "12", note: "precise" });
    expect(sanitizeAmount("", "3000000001", whole)).toEqual({ value: "", note: "too much" });
    expect(sanitizeAmount("5", "x", whole)).toEqual({ value: "5", note: "number" });
  });
});

describe("the caret among regrouped digits", () => {
  it("stays after the same digits however the commas moved", async () => {
    const { caretAfter } = await import("../src/ui/format");
    // Backspace at the end of 3,000,000,000: the end of 300,000,000.
    expect(caretAfter("3,000,000,00", 12, "300,000,000")).toBe(11);
    // A digit typed after "1,00" in "1,000": after the fifth digit of 10,000.
    expect(caretAfter("1,0000", 5, "10,000")).toBe(5);
    // Before everything stays before everything.
    expect(caretAfter("5,000", 0, "5,000")).toBe(0);
    // After "12" of a pasted "1234": after the 2 of "1,234".
    expect(caretAfter("1234", 2, "1,234")).toBe(3);
  });

  it("takes the digit beside a comma deleted on its own", async () => {
    const { deleteBesideComma } = await import("../src/ui/format");
    // Backspace just after the comma of "12,345": the 2 goes.
    expect(deleteBesideComma("12,345", "12345", 2, "deleteContentBackward")).toEqual({ text: "1345", caret: 1 });
    // Delete just before it: the 3 goes.
    expect(deleteBesideComma("12,345", "12345", 2, "deleteContentForward")).toEqual({ text: "1245", caret: 2 });
    // Anything else is left as it is.
    expect(deleteBesideComma("12,345", "12,34", 5, "deleteContentBackward")).toEqual({ text: "12,34", caret: 5 });
    expect(deleteBesideComma("1,234", "1,2345", 6, "insertText")).toEqual({ text: "1,2345", caret: 6 });
  });
});
