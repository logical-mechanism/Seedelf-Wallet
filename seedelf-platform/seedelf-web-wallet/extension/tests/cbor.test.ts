// The worker's small CBOR reader (src/background/cbor.ts) reads bytes a dApp
// chose (submitTx, signTx): whatever they are, it answers or throws, and never
// reads past the end.

import { describe, expect, it } from "vitest";

import { txId, txInputs } from "../src/background/cbor";

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
  });
});
