// Where one unseal of a record holding requests near the crate's bound spends its time: the same steps private-store.ts
// `get` and messaging.ts take, on a record of that size, each timed alone. Ported from the verifiers'
// verify2-sweep-posts-inbox-cost.test.ts (the 1.10.0 gate, class A), the companion of the inbox-size case: since round
// 5 the requests are a record of their own (`messagingRequests.<network>`), read only by a first message's take and
// the user's presses on a request, never in a lane and never before a sync's first page
// (messaging-sweep-posts-inbox-size.test.ts). Reported, and asserted no further than that a whole read costs more
// than the smallest record's.
import { performance } from "node:perf_hooks";

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";

import { fromBase64, toBase64 } from "../src/background/storage";

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
const hexOf = (bytes: Uint8Array) => {
  let out = "";
  for (const b of bytes) out += HEX[b];
  return out;
};

const time = (f: () => unknown, n = 7) => {
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    f();
    xs.push(performance.now() - t0);
  }
  xs.sort((a, b) => a - b);
  return Math.round(xs[Math.floor(n / 2)]! * 100) / 100;
};

describe("the cost of one unseal of a record holding requests near their bound (class A sweep)", { timeout: 60_000 }, () => {
  it("times each step", () => {
    // Requests of 240 KiB (the crate's bound is 256 KiB), base64 in the requests record's JSON, padded to 512 KiB as sealed.
    const requests = new Uint8Array(240 * 1024);
    for (let at = 0; at < requests.length; at += 65536) requests.set(randomBytes(Math.min(65536, requests.length - at)), at);
    const json = JSON.stringify({ v: 1, requests: toBase64(requests) });
    let size = 1024;
    while (size < json.length) size *= 2;
    const plain = new Uint8Array(size).fill(0x20);
    plain.set(new TextEncoder().encode(json));
    const key = randomBytes(32);
    const nonce = randomBytes(24);
    const sealed = toBase64(xchacha20poly1305(key, nonce, new Uint8Array(8)).encrypt(plain));
    const stored = JSON.stringify({ v: 1, nonce: toBase64(nonce), data: sealed });
    const facts = {
      jsonBytes: json.length,
      paddedBytes: size,
      storedChars: stored.length,
      msAreaJsonParse: time(() => JSON.parse(stored)),
      msFromBase64Sealed: time(() => fromBase64(sealed)),
      msDecrypt: time(() => xchacha20poly1305(key, nonce, new Uint8Array(8)).decrypt(fromBase64(sealed))),
      msTextDecodeAndParse: time(() => JSON.parse(new TextDecoder().decode(plain))),
      msHexOfBase64Requests: time(() => hexOf(fromBase64(toBase64(requests)))),
      msWholeRead: time(() => {
        const s = JSON.parse(stored) as { data: string };
        const p = xchacha20poly1305(key, nonce, new Uint8Array(8)).decrypt(fromBase64(s.data));
        const record = JSON.parse(new TextDecoder().decode(p)) as { requests: string };
        return hexOf(fromBase64(record.requests));
      }),
      msSmallRead: time(() => {
        const small = new Uint8Array(1024).fill(0x20);
        const c = toBase64(xchacha20poly1305(key, nonce, new Uint8Array(8)).encrypt(small));
        return JSON.parse(new TextDecoder().decode(xchacha20poly1305(key, nonce, new Uint8Array(8)).decrypt(fromBase64(c))).trim() || "{}");
      }),
    };
    console.log(`[requests record cost] ${JSON.stringify(facts)}`);
    expect(facts.msWholeRead).toBeGreaterThan(facts.msSmallRead);
  });
});
