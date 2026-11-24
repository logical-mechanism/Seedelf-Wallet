// What 1.10.0's page reader (relay.ts `readPage`) takes and refuses, past the sizes it knows: more than 512 entries,
// entries of lengths it doesn't know, one that runs past the page's end or past its 256 KiB, the two byte bounds
// against each other, and the flag bits; then what the worker does with a pool that keeps serving a page it can't read.
// The bounds protocol.md §20 freezes, ported from the verifiers' verify2-freeze-page-bounds.test.ts (the freeze review,
// item 10), with relay2's reserve page beside them: a lone long envelope, 32,788 bytes.
import { describe, expect, it } from "vitest";

import { PAGE_BODY_MAX_BYTES, PAGE_MAX_BYTES, readPage, RelayDown } from "../src/background/relay";
import { cursorOf, pair, synced, talking, texts } from "./messaging-harness";

/** A page's bytes: `lengths` entries, each its length then that many bytes; `count` the header's, `cut` bytes off the end. */
function rawPage({
  flags = 0,
  version = 1,
  lengths = [512],
  count,
  cut = 0,
  tail = 0,
}: { flags?: number; version?: number; lengths?: number[]; count?: number; cut?: number; tail?: number } = {}): Uint8Array {
  const size = 16 + lengths.reduce((s, n) => s + 4 + n, 0) + tail;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out[0] = version;
  out[1] = flags;
  view.setBigUint64(2, 7n);
  out.set([18, 19, 21, 24], 10);
  view.setUint16(14, count ?? lengths.length);
  let at = 16;
  for (const n of lengths) {
    view.setUint32(at, n);
    out.fill(1, at + 4, at + 4 + n);
    at += 4 + n;
  }
  return out.subarray(0, size - cut);
}

const refusal = (bytes: Uint8Array) => {
  try {
    readPage(bytes);
    return "read";
  } catch (e) {
    expect(e).toBeInstanceOf(RelayDown);
    return (e as Error).message;
  }
};

describe("the page reader's bounds (freeze item 10)", { timeout: 60_000 }, () => {
  it("takes the reserve's page of one long envelope (relay2's item 9): 32,788 bytes, inside both bounds", () => {
    const one = rawPage({ lengths: [32_768] });
    expect(one.length).toBe(32_788);
    expect(readPage(one).envelopes.map((e) => e.length / 2)).toEqual([32_768]);
  });

  it("takes more than 512 entries when they're small: a u16 count, bounded only by the bytes", () => {
    const zeros = rawPage({ lengths: Array<number>(513).fill(0) });
    expect(zeros.length).toBe(16 + 513 * 4);
    expect(readPage(zeros).envelopes).toEqual([]);
    const most = rawPage({ lengths: Array<number>(65_535).fill(0) });
    expect(readPage(most).envelopes).toEqual([]);
    // 600 entries of 436 bytes: 261,600 of envelopes, 264,016 in all; both bounds hold.
    expect(readPage(rawPage({ lengths: Array<number>(600).fill(436) })).envelopes).toEqual([]);
  });

  it("refuses a page past 264,208 bytes in all whose envelopes are inside 256 KiB: past 512 entries only", () => {
    // 601 × 436: 262,036 bytes of envelopes (≤ 262,144), 264,456 in all.
    const many = rawPage({ lengths: Array<number>(601).fill(436) });
    expect(refusal(many)).toMatch(/more than a page holds/);
    // 513 × 511: 262,143 of envelopes, 264,211 in all.
    const close = rawPage({ lengths: Array<number>(513).fill(511) });
    expect(close.length).toBe(264_211);
    expect(refusal(close)).toMatch(/more than a page holds/);
    // At 512 entries or fewer the 256 KiB binds first: 4·n ≤ 2,048, the room the total keeps for lengths.
    expect(PAGE_BODY_MAX_BYTES - 16 - PAGE_MAX_BYTES).toBe(4 * 512);
  });

  it("steps over a complete entry of a length it doesn't know, up to the 256 KiB, and ignores flag bits 2 to 7", () => {
    const read = readPage(rawPage({ lengths: [512, 100_000, 2048], flags: 0xfc }));
    expect(read.envelopes.map((e) => e.length / 2)).toEqual([512, 2048]);
    expect(read).toMatchObject({ more: false, gap: false });
    expect(readPage(rawPage({ flags: 0xff }))).toMatchObject({ more: true, gap: true });
  });

  it("refuses the whole page for one entry it can't place: past the end, past 256 KiB, a count that's off, bytes after", () => {
    const cases: Record<string, Uint8Array> = {
      "a length running past the end": rawPage({ lengths: [512, 1000], cut: 1 }),
      "a length of 2^31 with nothing after it": (() => {
        const p = rawPage({ lengths: [512], count: 2, tail: 4 });
        new DataView(p.buffer, p.byteOffset).setUint32(16 + 516, 0x8000_0000);
        return p;
      })(),
      "one complete entry of 262,145 bytes": rawPage({ lengths: [262_145] }),
      "a count above the entries": rawPage({ lengths: [512], count: 2 }),
      "a count below the entries": rawPage({ lengths: [512, 512], count: 1 }),
      "a byte after the last entry": rawPage({ lengths: [512], tail: 1 }),
      "version 2": rawPage({ version: 2 }),
    };
    const out = Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, refusal(v)]));
    for (const why of Object.values(out)) expect(why).not.toBe("read");
  });

  it("a pool that keeps serving a page with one entry it can't place stops the reader at that cursor, said as offline", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await synced(bob);
    const cursor = await cursorOf(bob);
    for (const text of ["two", "three"]) {
      await alice.messaging.send("preprod", cid, text);
      await alice.messaging.whenIdle();
    }
    // Ahead of the page's envelopes, an entry whose length runs past the end: every page from Bob's cursor has it.
    const real = relay.fetch;
    relay.fetch = async (url, init) => {
      const answer = await real(url, init);
      if (init.method !== "GET") return answer;
      const body = new Uint8Array(await answer.arrayBuffer());
      const count = new DataView(body.buffer).getUint16(14);
      if (count === 0) return new Response(body, { status: 200 });
      const out = new Uint8Array(body.length + 4);
      out.set(body.subarray(0, 16));
      new DataView(out.buffer).setUint16(14, count + 1);
      new DataView(out.buffer).setUint32(16, 1_000_000);
      out.set(body.subarray(16), 20);
      return new Response(out, { status: 200 });
    };
    for (let i = 0; i < 3; i++) await synced(bob);
    const stuck = await cursorOf(bob);
    const overview = await bob.messaging.overview("preprod");
    expect(stuck).toBe(cursor);
    expect(overview.offline).toBe(true);
    expect(await texts(bob, cid)).not.toContain("in:two");
    // Once the pool no longer holds it (its 36 hours), the reader goes on.
    relay.fetch = real;
    await synced(bob);
    expect((await texts(bob, cid)).slice(-2)).toEqual(["in:two", "in:three"]);
  });
});
