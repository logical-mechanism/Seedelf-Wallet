// Seedelf Messaging's relay client (background/relay.ts): protocol.md §17's
// pages read byte for byte, and each answer to a post.
import { describe, expect, it, vi } from "vitest";

import { RateLimit } from "../src/background/koios";
import {
  DAY_READ_MAX_MS,
  PAGE_BODY_MAX_BYTES,
  PAGE_UNITS,
  PAGES_A_SYNC,
  readPage,
  RELAY_BODY_TIMEOUT_MS,
  RELAY_TIMEOUT_MS,
  RelayBusy,
  RelayClient,
  RelayDayRead,
  RelayDown,
  RelayNotAsked,
  RelayStopped,
  RelayUnknown,
} from "../src/background/relay";

function page({ flags = 0, cursor = 7n, prices = [18, 19, 21, 24], envelopes = [512] } = {}): Uint8Array {
  const size = 16 + envelopes.reduce((s, n) => s + 4 + n, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out[0] = 1;
  out[1] = flags;
  view.setBigUint64(2, cursor);
  out.set(prices, 10);
  view.setUint16(14, envelopes.length);
  let at = 16;
  envelopes.forEach((n, i) => {
    view.setUint32(at, n);
    out.fill(i + 1, at + 4, at + 4 + n);
    at += 4 + n;
  });
  return out;
}

const never = () => new RateLimit(1_000_000, 1000, () => 0, async () => undefined);

function client(answer: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const relay = new RelayClient({
    origin: "https://relay.test",
    pool: "mainnet",
    limit: never(),
    fetch: async (url, init) => {
      calls.push({ url, init });
      return answer(url, init);
    },
  });
  return { relay, calls };
}

describe("the relay's pages (§17.5)", { timeout: 20_000 }, () => {
  it("reads the flags, the cursor as a decimal u64, the prices and every envelope as hex", () => {
    const read = readPage(page({ flags: 3, cursor: 2n ** 63n + 5n, envelopes: [512, 2048] }));
    expect(read.more).toBe(true);
    expect(read.gap).toBe(true);
    expect(read.cursor).toBe("9223372036854775813");
    expect(read.prices).toEqual([18, 19, 21, 24]);
    expect(read.envelopes.map((e) => e.length / 2)).toEqual([512, 2048]);
    expect(read.envelopes[1]!.slice(0, 4)).toBe("0202");
    expect(readPage(page({ envelopes: [] })).envelopes).toEqual([]);
  });

  it("refuses a page that isn't one: another version, bytes cut or left over", () => {
    const other = page();
    other[0] = 2;
    expect(() => readPage(other)).toThrow(RelayDown);
    expect(() => readPage(page().subarray(0, 100))).toThrow(RelayDown);
    expect(() => readPage(new Uint8Array([...page(), 0]))).toThrow(RelayDown);
    expect(() => readPage(new Uint8Array(10))).toThrow(RelayDown);
  });

  it("steps over an envelope of a size this version doesn't know, inside the page, and reads the rest (W15, versions-upgrade#3)", () => {
    const read = readPage(page({ envelopes: [512, 1024, 512] }));
    expect(read.envelopes.map((e) => e.length / 2)).toEqual([512, 512]);
    expect(read.envelopes[1]!.slice(0, 2)).toBe("03");
    // One whose length runs past the page's end still isn't a page.
    const cut = page({ envelopes: [512, 600] });
    expect(() => readPage(cut.subarray(0, cut.length - 1))).toThrow(RelayDown);
    // Nor is one past §17.5's 256 KiB of envelopes, of whatever sizes.
    expect(() => readPage(page({ envelopes: [...Array<number>(8).fill(32768), 1024] }))).toThrow(RelayDown);
  });

  it("asks from the cursor, and with no cookie, no referrer and nothing cached", async () => {
    const { relay, calls } = client(() => new Response(page() as BodyInit, { status: 200 }));
    await relay.page();
    await relay.page("41");
    expect(calls.map((c) => c.url)).toEqual([
      "https://relay.test/messaging/v1/mainnet/envelopes",
      "https://relay.test/messaging/v1/mainnet/envelopes?after=41",
    ]);
    expect(calls[0]!.init).toMatchObject({ method: "GET", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
  });

  it("asks nothing when what must still hold, right before it goes, doesn't", async () => {
    const { relay, calls } = client(() => new Response(page() as BodyInit, { status: 200 }));
    await expect(relay.page(undefined, async () => false)).rejects.toThrow(RelayNotAsked);
    await expect(relay.post(new Uint8Array(1), async () => false)).rejects.toThrow(RelayNotAsked);
    expect(calls).toEqual([]);
    await relay.page(undefined, async () => true);
    expect(calls).toHaveLength(1);
  });

  it("says the relay is down for a page whose body doesn't arrive", async () => {
    const broken = new ReadableStream({
      start(controller) {
        controller.error(new Error("cut off"));
      },
    });
    await expect(client(() => new Response(broken, { status: 200 })).relay.page()).rejects.toThrow(RelayDown);
  });

  it("holds a page to §17.5: 256 KiB of envelopes, a length before each, and the header", () => {
    // The most a page is: its 16 bytes, then 512 of the smallest envelope, each behind its 4-byte length.
    expect(PAGE_BODY_MAX_BYTES).toBe(16 + 512 * 4 + 256 * 1024);
    expect(readPage(page({ envelopes: Array<number>(512).fill(512) })).envelopes).toHaveLength(512);
    expect(readPage(page({ envelopes: Array<number>(8).fill(32768) })).envelopes).toHaveLength(8);
    // More than 256 KiB of envelopes isn't a page, of the smallest or the largest.
    expect(() => readPage(page({ envelopes: Array<number>(513).fill(512) }))).toThrow(RelayDown);
    expect(() => readPage(page({ envelopes: Array<number>(9).fill(32768) }))).toThrow(RelayDown);
  });

  it("reads a page through its stream and gives up past the bound, whatever the relay sends", async () => {
    // A body with no end in sight (it stops at 16 MiB, so a reader with no bound still returns).
    const CHUNK = 64 * 1024;
    let sent = 0;
    let cancelled = false;
    const endless = () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= 16 * 1024 * 1024) return controller.close();
          sent += CHUNK;
          controller.enqueue(new Uint8Array(CHUNK));
        },
        cancel() {
          cancelled = true;
        },
      });
    await expect(client(() => new Response(endless(), { status: 200 })).relay.page()).rejects.toThrow(RelayDown);
    // No more than the bound was taken, but for the chunk that passed it and what the stream had ready.
    expect(sent).toBeLessThanOrEqual(PAGE_BODY_MAX_BYTES + 3 * CHUNK);
    expect(cancelled).toBe(true);

    // A length that says it's too long is refused before a byte is read.
    sent = 0;
    const long = () => new Response(endless(), { status: 200, headers: { "content-length": String(PAGE_BODY_MAX_BYTES + 1) } });
    await expect(client(long).relay.page()).rejects.toThrow(RelayDown);
    expect(sent).toBeLessThanOrEqual(2 * CHUNK);

    // The largest page there is still reads, in pieces.
    const whole = page({ envelopes: Array<number>(512).fill(512) });
    expect(whole.length).toBe(PAGE_BODY_MAX_BYTES);
    const pieces = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (let at = 0; at < whole.length; at += 10_000) controller.enqueue(whole.slice(at, at + 10_000));
          controller.close();
        },
      });
    expect((await client(() => new Response(pieces(), { status: 200 })).relay.page()).envelopes).toHaveLength(512);
  });

  it("gives an answer's head 30 seconds, and a page's body two minutes after it: a slow link still catches up", async () => {
    vi.useFakeTimers();
    try {
      // A head that never comes.
      const silent = new RelayClient({
        origin: "https://relay.test",
        pool: "mainnet",
        limit: never(),
        fetch: (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      });
      const lost = expect(silent.page()).rejects.toThrow(RelayDown);
      await vi.advanceTimersByTimeAsync(RELAY_TIMEOUT_MS);
      await lost;

      // The head at once, the body after `ms`.
      const slow = (ms: number) => () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              setTimeout(() => {
                controller.enqueue(page());
                controller.close();
              }, ms);
            },
          }),
          { status: 200 },
        );
      // 100 s: past the head's 30, inside the body's 120.
      const arrives = client(slow(100_000)).relay.page();
      await vi.advanceTimersByTimeAsync(100_000);
      expect((await arrives).envelopes).toHaveLength(1);
      // Past the body's two minutes, it's given up.
      const stalled = expect(client(slow(RELAY_BODY_TIMEOUT_MS + 60_000)).relay.page()).rejects.toThrow(RelayDown);
      await vi.advanceTimersByTimeAsync(RELAY_BODY_TIMEOUT_MS);
      await stalled;
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds the pages of one sync by what the client's own limit lets through without a wait (W10)", () => {
    // 280 units in any 30 s (relay.ts's limit), a page charged as full.
    expect(PAGE_UNITS).toBe(17);
    expect(PAGES_A_SYNC).toBe(16);
    expect(PAGES_A_SYNC * PAGE_UNITS).toBeLessThanOrEqual(280);
  });

  it("says the relay is stopped for a 410, on a page or a post: the off switch (W15, versions-upgrade#2)", async () => {
    const gone = () => new Response(JSON.stringify({ error: "messaging is stopped" }), { status: 410 });
    await expect(client(gone).relay.page()).rejects.toThrow(RelayStopped);
    await expect(client(gone).relay.post(new Uint8Array(1))).rejects.toThrow(RelayStopped);
    // A stop is a relay that won't answer, for everything that asks whether it does.
    await expect(client(gone).relay.page()).rejects.toThrow(RelayDown);
  });

  it("holds only that pool's pages for the day's reading, up to a day and an hour, and nothing else (W16)", async () => {
    let now = 0;
    const limit = new RateLimit(1_000_000, 1000, () => now, async (ms) => void (now += ms));
    const answer = (seconds: number) => () =>
      new Response(JSON.stringify({ error: "this address has read its share of the pool for the day" }), {
        status: 429,
        headers: { "retry-after": String(seconds) },
      });
    const relay = new RelayClient({ origin: "https://relay.test", pool: "mainnet", limit, fetch: async () => answer(7200)() });
    const refused = await relay.page().catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(RelayDayRead);
    expect((refused as RelayDayRead).retryAfterMs).toBe(7200_000);
    // Posts, and the other pool, go on: the limit the origin shares holds nothing.
    expect(limit.holding()).toBe(0);
    const long = new RelayClient({ origin: "https://relay.test", pool: "mainnet", limit: never(), fetch: async () => answer(48 * 3600)() });
    expect(((await long.page().catch((e: unknown) => e)) as RelayDayRead).retryAfterMs).toBe(DAY_READ_MAX_MS);
    expect(DAY_READ_MAX_MS).toBe(25 * 3600_000);
  });

  it("waits a second for the edge's 'too many requests at once', a page's and a post's alike (W16)", async () => {
    let now = 0;
    const limit = new RateLimit(1_000_000, 1000, () => now, async (ms) => void (now += ms));
    const busy = () => new Response(JSON.stringify({ error: "too many requests at once" }), { status: 429, headers: { "retry-after": "1" } });
    const relay = new RelayClient({ origin: "https://relay.test", pool: "mainnet", limit, fetch: async () => busy() });
    await expect(relay.page()).rejects.toThrow(RelayBusy);
    expect(limit.holding()).toBe(1000);
    now += 1000;
    expect(await relay.post(new Uint8Array(1))).toEqual({ kind: "wait", scope: "network", retryAfterMs: 1000 });
    expect(limit.holding()).toBe(1000);
  });

  it("says the relay is down for a failed fetch or an answer that isn't 200", async () => {
    await expect(client(() => new Response("", { status: 503 })).relay.page()).rejects.toThrow(RelayDown);
    const lost = new RelayClient({
      origin: "https://relay.test",
      pool: "preprod",
      limit: never(),
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await expect(lost.page()).rejects.toThrow(RelayDown);
  });
});

describe("the relay's answers to a post (§17.2)", { timeout: 20_000 }, () => {
  const json = (status: number, value: unknown, headers: Record<string, string> = {}) => () =>
    new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });

  it("posts the bytes as they are, as octets", async () => {
    const { relay, calls } = client(json(200, { kept: "new", expires: 1_900_000_000 }));
    const body = new Uint8Array([1, 2, 3]);
    expect(await relay.post(body)).toEqual({ kind: "kept", expires: 1_900_000_000_000, fresh: true });
    expect(calls[0]!.init).toMatchObject({ method: "POST", headers: { "content-type": "application/octet-stream" }, body });
  });

  it("takes already held as kept, names a 402's price, waits a 429's or 503's Retry-After, and refuses a 400 or 413", async () => {
    // Already held: its expiry is the first post's, which says nothing of the relay's clock now (W14).
    expect(await client(json(200, { kept: "already", expires: 5 })).relay.post(new Uint8Array(1))).toEqual({
      kind: "kept",
      expires: 5000,
      fresh: false,
    });
    expect(await client(json(402, { error: "more", price: 21 })).relay.post(new Uint8Array(1))).toEqual({ kind: "price", bits: 21 });
    // A 429 is that size's wait (the address's window and the price's ceiling are by size, §17.4); a 503 everyone's.
    expect(await client(json(429, { error: "x" }, { "retry-after": "45" })).relay.post(new Uint8Array(1))).toEqual({
      kind: "wait",
      scope: "size",
      retryAfterMs: 45_000,
    });
    expect(await client(json(503, { error: "x" })).relay.post(new Uint8Array(1))).toEqual({
      kind: "wait",
      scope: "network",
      retryAfterMs: 60_000,
    });
    // An address's window can ask up to 37 hours (§17.4): the outbox waits that long, and no longer.
    const wait = async (seconds: number) =>
      (await client(json(429, { error: "x" }, { "retry-after": String(seconds) })).relay.post(new Uint8Array(1))) as { retryAfterMs: number };
    expect((await wait(30 * 3600)).retryAfterMs).toBe(30 * 3600_000);
    expect((await wait(100 * 3600)).retryAfterMs).toBe(37 * 3600_000);
    expect(await client(json(400, { error: "x" })).relay.post(new Uint8Array(1))).toEqual({ kind: "refused", status: 400 });
    expect(await client(() => new Response("too big", { status: 413 })).relay.post(new Uint8Array(1))).toEqual({
      kind: "refused",
      status: 413,
    });
  });

  it("says the relay answered something this version doesn't know, apart from no answer at all (W15, versions-upgrade#6)", async () => {
    for (const answer of [json(200, { kept: "new" }), json(402, { price: -1 }), json(402, { price: 18.5 }), json(402, { price: "18" }), json(500, {}), json(404, {}), json(426, {})]) {
      await expect(client(answer).relay.post(new Uint8Array(1))).rejects.toThrow(RelayUnknown);
    }
    // Still a relay that didn't take it, for whatever asks only that.
    await expect(client(json(500, {})).relay.post(new Uint8Array(1))).rejects.toThrow(RelayDown);
    // An answer far longer than any the relay gives isn't read to its end.
    const long = () => new Response(JSON.stringify({ kept: "new", expires: 5, pad: "x".repeat(1024 * 1024) }), { status: 200 });
    await expect(client(long).relay.post(new Uint8Array(1))).rejects.toThrow(RelayDown);
    // A connection lost is no answer: not one this version doesn't know.
    const lost = new RelayClient({
      origin: "https://relay.test",
      pool: "preprod",
      limit: never(),
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const thrown = await lost.post(new Uint8Array(1)).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(RelayDown);
    expect(thrown).not.toBeInstanceOf(RelayUnknown);
  });

  it("holds every request for the edge's own 429, and only that size for the relay's (§17.2, §17.4)", async () => {
    let now = 0;
    const limit = new RateLimit(1_000_000, 1000, () => now, async (ms) => void (now += ms));
    const relay = new RelayClient({
      origin: "https://relay.test",
      pool: "mainnet",
      limit,
      fetch: async () => json(429, { error: "slow down" }, { "retry-after": "20" })(),
    });
    expect(await relay.post(new Uint8Array(1))).toEqual({ kind: "wait", scope: "network", retryAfterMs: 20_000 });
    // The bucket is the address's at the edge, pages' too: the next request waits it out.
    expect(limit.holding()).toBe(20_000);
    const words = new RelayClient({
      origin: "https://relay.test",
      pool: "mainnet",
      limit: never(),
      fetch: async () => json(429, { error: "this address's share of the pool is full for now" }, { "retry-after": "20" })(),
    });
    expect(await words.post(new Uint8Array(1))).toEqual({ kind: "wait", scope: "size", retryAfterMs: 20_000 });
  });

  it("says a 402's price as the relay names it, with the wait it names: the ceiling is the worker's, from the bindings (§17.4, W17)", async () => {
    const post = (price: number, headers: Record<string, string> = {}) => client(json(402, { error: "more", price }, headers)).relay.post(new Uint8Array(1));
    expect(await post(24)).toEqual({ kind: "price", bits: 24 });
    expect(await post(27)).toEqual({ kind: "price", bits: 27 });
    expect(await post(32, { "retry-after": "120" })).toEqual({ kind: "price", bits: 32, retryAfterMs: 120_000 });
    // A wait named past the longest any of §17.4's is, held to it; one that isn't a number, a minute.
    expect(await post(99, { "retry-after": String(40 * 3600) })).toEqual({ kind: "price", bits: 99, retryAfterMs: 37 * 3600_000 });
    expect(await post(30, { "retry-after": "soon" })).toEqual({ kind: "price", bits: 30, retryAfterMs: 60_000 });
  });
});
