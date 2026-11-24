// The store's conversions at full speed (the 1.10.0 gate's round 5, fix item
// 5.3): every sealed record goes through base64 and the crate's records and
// envelopes through hex, at their full size, up to 0.7 MB. The new functions
// must give exactly what the old ones did, for every byte value and every
// length; their time is logged, and asserted only far past what load moves.
import { describe, expect, it } from "vitest";

import { bytesOf, hexOf } from "../src/background/messaging";
import { PrivateStore } from "../src/background/private-store";
import { fromBase64, toBase64 } from "../src/background/storage";
import { memoryArea, testWallet } from "./fakes";
import { PASSWORD, phrase } from "./messaging-harness";

// The functions as they were before round 5, to compare against.
const oldToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};
const oldFromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
const oldHexOf = (bytes: Uint8Array) => {
  let out = "";
  for (const b of bytes) out += HEX[b];
  return out;
};
const oldBytesOf = (hex: string) => {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
};

/** A deterministic stream of bytes, so a failure names the same input again. */
function bytes(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

const median = (xs: number[]) => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)]!;
const timed = (run: () => unknown) => {
  const ms: number[] = [];
  for (let i = 0; i < 9; i++) {
    const t = performance.now();
    run();
    ms.push(performance.now() - t);
  }
  return median(ms);
};

describe("the store's conversions (round 5, fix item 5.3)", { timeout: 300_000 }, () => {
  it("give what the old ones did: every byte value, and lengths 0 to 70,000, random and at the edges", () => {
    const every = Uint8Array.from({ length: 256 }, (_, i) => i);
    const lengths = new Set<number>([0, 1, 2, 3, 4, 5, 255, 256, 257, 32 * 1024 - 1, 32 * 1024, 32 * 1024 + 1, 65_535, 65_536, 65_537, 69_999, 70_000]);
    for (let i = 0; i < 60; i++) lengths.add(Math.floor(((i * 2654435761) >>> 0) % 70_001));
    const inputs = [every, ...[...lengths].map((n, i) => bytes(n, i + 1))];
    for (const input of inputs) {
      const base64 = oldToBase64(input);
      expect(toBase64(input)).toBe(base64);
      expect(fromBase64(base64)).toEqual(oldFromBase64(base64));
      const hex = oldHexOf(input);
      expect(hexOf(input)).toBe(hex);
      expect(bytesOf(hex)).toEqual(oldBytesOf(hex));
      // Upper-case hex reads the same.
      expect(bytesOf(hex.toUpperCase())).toEqual(oldBytesOf(hex.toUpperCase()));
    }
  });

  it("unseal a record at a conversation's share, 699,072 characters stored, in milliseconds: logged", async () => {
    const big = bytes(524_304, 7);
    const base64 = toBase64(big);
    expect(base64).toHaveLength(699_072);
    const hex = hexOf(big);
    const ms = {
      fromBase64: { new: timed(() => fromBase64(base64)), old: timed(() => oldFromBase64(base64)) },
      toBase64: { new: timed(() => toBase64(big)), old: timed(() => oldToBase64(big)) },
      hexOf: { new: timed(() => hexOf(big)), old: timed(() => oldHexOf(big)) },
      bytesOf: { new: timed(() => bytesOf(hex)), old: timed(() => oldBytesOf(hex)) },
    };
    // A whole sealed record's read, the store's own: its 512 KiB of JSON.
    const t = testWallet({ local: memoryArea(), session: memoryArea(), clock: { now: 1_800_000_000_000 } });
    await t.wallet.create(phrase(12), PASSWORD);
    const store = new PrivateStore({ wallet: t.wallet, local: t.local });
    await store.set("messaging.preprod", { v: 2, blob: "q".repeat(500_000) });
    const reads: number[] = [];
    for (let i = 0; i < 9; i++) {
      const at = performance.now();
      await store.get("messaging.preprod");
      reads.push(performance.now() - at);
    }
    const unseal = median(reads);
    console.log(`[conversions] medians of 9 at 524,304 bytes (ms): ${JSON.stringify(ms)}; a 699,072-character unseal ${unseal.toFixed(2)}`);
    // Far past what load moves: the old functions took tens of milliseconds each here.
    expect(ms.fromBase64.new).toBeLessThan(50);
    expect(unseal).toBeLessThan(100);
  });
});
