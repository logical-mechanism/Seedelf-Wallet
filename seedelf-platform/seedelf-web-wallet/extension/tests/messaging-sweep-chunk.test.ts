// One sealed record's read and write at the requests' bound (the 1.10.0
// gate's round 5, ported from the verifiers' verify2-sweep-work-chunk): the
// one task of the wallet's queue a request can still meet, where it's off
// every grid (W10's residual). Since round 5 no lane reads a record this size,
// the runner's calls keep off the lanes and the ticks, and the conversions run
// at full speed (fix item 5.3). Logged for the residual's figures; asserted only
// far past what load moves.
import { describe, expect, it } from "vitest";

import { PrivateStore } from "../src/background/private-store";
import { fromBase64, toBase64 } from "../src/background/storage";
import { memoryArea, testWallet } from "./fakes";
import { PASSWORD, phrase } from "./messaging-harness";

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

describe("class B: one sealed inbox read and write at the requests' bound", () => {
  it("times one task of the wallet's queue", { timeout: 300_000 }, async () => {
    const t = testWallet({ local: memoryArea(), session: memoryArea(), clock: { now: 1_800_000_000_000 } });
    await t.wallet.create(phrase(12), PASSWORD);
    const store = new PrivateStore({ wallet: t.wallet, local: t.local });
    // An inbox as the worker stores it: the requests' record (the crate's bytes, base64) at 256 KiB and a little more.
    const requests = toBase64(Uint8Array.from({ length: 250_000 }, (_, i) => (i * 7919) & 0xff));
    const full = { v: 2, handles: {}, conversations: {}, requestsUnread: {}, requestsShown: { a: { t: 0, to: "", messages: 1, last: 0 } }, requests, cursor: "1" };
    const empty = { ...full, requests: undefined, requestsShown: {} };
    const time = async (value: unknown) => {
      await store.set("messaging.preprod", value);
      const reads: number[] = [];
      const writes: number[] = [];
      for (let i = 0; i < 9; i++) {
        let t0 = performance.now();
        await store.get("messaging.preprod");
        reads.push(performance.now() - t0);
        t0 = performance.now();
        await store.set("messaging.preprod", value);
        writes.push(performance.now() - t0);
      }
      return { read: median(reads), write: median(writes), stored: (JSON.parse(t.local.data.get("seedelf.private.messaging.preprod") as string) as { data: string }).data.length };
    };
    const atBound = await time(full);
    const none = await time(empty);
    // The two base64 conversions alone (storage.ts), on what the bound's inbox is sealed as.
    const sealed = (JSON.parse(t.local.data.get("seedelf.private.messaging.preprod") as string) as { data: string }).data;
    await store.set("messaging.preprod", full);
    const big = (JSON.parse(t.local.data.get("seedelf.private.messaging.preprod") as string) as { data: string }).data;
    let t0 = performance.now();
    const bytes = fromBase64(big);
    const decode = performance.now() - t0;
    t0 = performance.now();
    toBase64(bytes);
    const encode = performance.now() - t0;
    console.log(
      `sealed inbox read / write, median ms: at the bound (${atBound.stored} chars stored)`,
      atBound.read.toFixed(1),
      "/",
      atBound.write.toFixed(1),
      `; none (${none.stored} chars, ${sealed.length})`,
      none.read.toFixed(1),
      "/",
      none.write.toFixed(1),
      "; fromBase64 / toBase64 of the bound's sealed data alone:",
      decode.toFixed(1),
      "/",
      encode.toFixed(1),
    );
    // Under the old conversions this read took about 100 ms here: now a few.
    expect(atBound.read).toBeLessThan(100);
    expect(atBound.write).toBeLessThan(100);
  });
});
