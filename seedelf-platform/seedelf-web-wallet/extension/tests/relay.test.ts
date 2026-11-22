// Seedelf Messaging's relay client (background/relay.ts): protocol.md §17's
// pages read byte for byte, and each answer to a post.
import { describe, expect, it } from "vitest";

import { RateLimit } from "../src/background/koios";
import { readPage, RelayClient, RelayDown, RelayNotAsked } from "../src/background/relay";

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

describe("the relay's pages (§17.5)", () => {
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

  it("refuses a page that isn't one: another version, a size no envelope has, bytes cut or left over", () => {
    const other = page();
    other[0] = 2;
    expect(() => readPage(other)).toThrow(RelayDown);
    expect(() => readPage(page({ envelopes: [600] }))).toThrow(RelayDown);
    expect(() => readPage(page().subarray(0, 100))).toThrow(RelayDown);
    expect(() => readPage(new Uint8Array([...page(), 0]))).toThrow(RelayDown);
    expect(() => readPage(new Uint8Array(10))).toThrow(RelayDown);
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

describe("the relay's answers to a post (§17.2)", () => {
  const json = (status: number, value: unknown, headers: Record<string, string> = {}) => () =>
    new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });

  it("posts the bytes as they are, as octets", async () => {
    const { relay, calls } = client(json(200, { kept: "new", expires: 1_900_000_000 }));
    const body = new Uint8Array([1, 2, 3]);
    expect(await relay.post(body)).toEqual({ kind: "kept", expires: 1_900_000_000_000 });
    expect(calls[0]!.init).toMatchObject({ method: "POST", headers: { "content-type": "application/octet-stream" }, body });
  });

  it("takes already held as kept, names a 402's price, waits a 429's or 503's Retry-After, and refuses a 400 or 413", async () => {
    expect(await client(json(200, { kept: "already", expires: 5 })).relay.post(new Uint8Array(1))).toEqual({ kind: "kept", expires: 5000 });
    expect(await client(json(402, { error: "more", price: 21 })).relay.post(new Uint8Array(1))).toEqual({ kind: "price", bits: 21 });
    expect(await client(json(429, { error: "x" }, { "retry-after": "45" })).relay.post(new Uint8Array(1))).toEqual({
      kind: "wait",
      retryAfterMs: 45_000,
    });
    expect(await client(json(503, { error: "x" })).relay.post(new Uint8Array(1))).toEqual({ kind: "wait", retryAfterMs: 60_000 });
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

  it("says the relay is down for an answer it can't read", async () => {
    await expect(client(json(200, { kept: "new" })).relay.post(new Uint8Array(1))).rejects.toThrow(RelayDown);
    await expect(client(json(402, { price: 99 })).relay.post(new Uint8Array(1))).rejects.toThrow(RelayDown);
    await expect(client(json(500, {})).relay.post(new Uint8Array(1))).rejects.toThrow(RelayDown);
  });
});
