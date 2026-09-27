// The worker's small CBOR reader (src/background/cbor.ts) reads bytes a dApp
// chose (submitTx, signTx): whatever they are, it answers or throws, and never
// reads past the end.

import { describe, expect, it } from "vitest";

import { MAX_DEPTH, nestsWithin, txId, txInputs } from "../src/background/cbor";

const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, (h) => Number.parseInt(h, 16));

describe("reading a dApp's transaction", () => {
  it("throws on bytes that end too soon, rather than read past them or loop", () => {
    const cut = [
      "84", // no body
      "84bf", // an indefinite map with no break: looped forever before
      "84a1", // a key missing
      "84a100", // its value missing
      "84a10081", // a list of one, with nothing in it
      "84a1009f", // an indefinite list with no break
      "845b00000000000000", // a length whose bytes run out
      "84a1005bffffffffffffffff", // a length far past the end
      "84a1009bffffffffffffffff", // a count far past the end
      "84bc", // a reserved length
    ];
    for (const hex of cut) {
      expect(() => txId(bytes(hex)), hex).toThrow();
      expect(() => txInputs(bytes(hex)), hex).toThrow();
    }
  });

  it("still reads a whole one", () => {
    const hash = "ab".repeat(32);
    const tx = bytes(`84a10081825820${hash}01a0f5f6`);
    expect(txInputs(tx)).toEqual([`${hash}#1`]);
    expect(txId(tx)).toMatch(/^[0-9a-f]{64}$/);
    expect(nestsWithin(tx)).toBe(true);
  });

  it("refuses CBOR nested deeper than 128 levels, rather than run the worker's stack out", () => {
    // A body whose one field is a list in a list in a list…: 100,000 of them ran the stack out before.
    const deep = (levels: number) => bytes(`84a101${"81".repeat(levels)}00a0f5f6`);
    expect(() => txId(deep(100_000))).toThrow(`nested more than ${MAX_DEPTH} levels deep`);
    expect(() => txInputs(deep(100_000))).toThrow(`nested more than ${MAX_DEPTH} levels deep`);
    // The transaction and its body are two levels: 126 more fit, 127 don't.
    expect(txId(deep(126))).toMatch(/^[0-9a-f]{64}$/);
    expect(() => txId(deep(127))).toThrow("nested more than");
    expect(nestsWithin(deep(126))).toBe(true);
    expect(nestsWithin(deep(127))).toBe(false);
  });

  it("counts the CBOR a tag 24 wraps, an inline datum's, when asked to", () => {
    const byteString = (hex: string) => {
      const n = hex.length / 2;
      const length = n < 24 ? (0x40 + n).toString(16) : `59${n.toString(16).padStart(4, "0")}`;
      return `${length}${hex}`;
    };
    // One output `{0: address, 1: 1 ₳, 2: [1, 24(datum)]}`.
    const withDatum = (datum: string) =>
      bytes(`84a10181a3005839${"00".repeat(57)}011a000f4240028201d818${byteString(datum)}a0f5f6`);
    // A datum of 200 nested lists: the id reads past it, as bytes; the check reads into it.
    const deep = withDatum(`${"81".repeat(200)}00`);
    expect(txId(deep)).toMatch(/^[0-9a-f]{64}$/);
    expect(nestsWithin(deep)).toBe(false);
    // A register's shape is fine.
    expect(nestsWithin(withDatum(`d8799f${byteString("00".repeat(48))}${byteString("00".repeat(48))}ff`))).toBe(true);
    // Bytes after the transaction aren't one.
    expect(nestsWithin(bytes("84a0a0f5f600"))).toBe(false);
  });
});
