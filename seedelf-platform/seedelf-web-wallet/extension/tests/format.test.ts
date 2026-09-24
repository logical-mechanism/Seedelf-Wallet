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
