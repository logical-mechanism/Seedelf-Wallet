// What 1.10.0's relay client (relay.ts) reads from each answer, a post's and a page's: statuses, JSON bodies, error
// words, Retry-After forms, the answer's size, and what each holds. The parse protocol.md §20 freezes, ported from the
// verifiers' verify2-freeze-answers.test.ts (the 1.10.0 gate's freeze review, items 12-14), with round 5's fix C in it:
// a 408 is a size's wait of a minute, and a 5xx but 503 is no answer at all.
import { describe, expect, it } from "vitest";

import { RateLimit } from "../src/background/koios";
import { RelayBusy, RelayClient, RelayDayRead, RelayDown, RelayStopped, RelayUnknown } from "../src/background/relay";

const never = () => new RateLimit(1_000_000, 1000, () => 0, async () => undefined);

/** A client answered by `answer`, its rate limit `limit` (a clock that stands still unless the test moves it). */
function client(answer: () => Response, limit: RateLimit = never()) {
  return new RelayClient({ origin: "https://relay.test", pool: "mainnet", limit, fetch: async () => answer() });
}
const json = (status: number, value: unknown, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const text = (status: number, body: string, headers: Record<string, string> = {}) => () => new Response(body, { status, headers });
const post = (answer: () => Response, limit?: RateLimit) => client(answer, limit).post(new Uint8Array(1));
/** What a post's answer comes to: the answer, or the class of what was thrown. */
async function outcome(answer: () => Response, limit?: RateLimit): Promise<unknown> {
  try {
    return await post(answer, limit);
  } catch (e) {
    return e instanceof RelayStopped ? "RelayStopped" : e instanceof RelayUnknown ? "RelayUnknown" : e instanceof RelayDown ? "RelayDown" : String(e);
  }
}
async function pageOutcome(answer: () => Response, limit?: RateLimit): Promise<string> {
  try {
    await client(answer, limit).page();
    return "page";
  } catch (e) {
    if (e instanceof RelayDayRead) return `RelayDayRead ${e.retryAfterMs}`;
    if (e instanceof RelayBusy) return "RelayBusy";
    if (e instanceof RelayStopped) return "RelayStopped";
    if (e instanceof RelayDown) return `RelayDown: ${e.message}`;
    return String(e);
  }
}
/** A limit on a clock of its own, to read what a hold set. */
function clocked() {
  let now = 0;
  return new RateLimit(1_000_000, 1000, () => now, async (ms) => void (now += ms));
}
const emptyPage = () => {
  const out = new Uint8Array(16);
  out[0] = 1;
  return out;
};

describe("a post's answers (freeze items 12-14)", { timeout: 30_000 }, () => {
  it("200: only a finite JSON number `expires` is read, in seconds; `kept` is fresh only when exactly \"new\"", async () => {
    const results = {
      new: await outcome(json(200, { kept: "new", expires: 1_900_000_000 })),
      already: await outcome(json(200, { kept: "already", expires: 5 })),
      NEW: await outcome(json(200, { kept: "NEW", expires: 5 })),
      noKept: await outcome(json(200, { expires: 5 })),
      millis: await outcome(json(200, { kept: "new", expires: 1_900_000_000_000 })),
      negative: await outcome(json(200, { kept: "new", expires: -1 })),
      fraction: await outcome(json(200, { kept: "new", expires: 1.5 })),
      stringExpires: await outcome(json(200, { kept: "new", expires: "1900000000" })),
      noExpires: await outcome(json(200, { kept: "new" })),
      plainText: await outcome(text(200, "ok")),
      over4096: await outcome(json(200, { kept: "new", expires: 5, pad: "x".repeat(5000) })),
      created201: await outcome(json(201, { kept: "new", expires: 5 })),
      noContent204: await outcome(() => new Response(null, { status: 204 })),
    };
    expect(results.new).toEqual({ kind: "kept", expires: 1_900_000_000_000, fresh: true });
    expect(results.already).toEqual({ kind: "kept", expires: 5000, fresh: false });
    expect(results.NEW).toEqual({ kind: "kept", expires: 5000, fresh: false });
    expect(results.noKept).toEqual({ kind: "kept", expires: 5000, fresh: false });
    expect(results.millis).toEqual({ kind: "kept", expires: 1_900_000_000_000_000, fresh: true });
    expect(results.negative).toEqual({ kind: "kept", expires: -1000, fresh: true });
    expect(results.fraction).toEqual({ kind: "kept", expires: 1500, fresh: true });
    expect(results.stringExpires).toBe("RelayUnknown");
    expect(results.noExpires).toBe("RelayUnknown");
    expect(results.plainText).toBe("RelayUnknown");
    // Past 4,096 bytes it's no answer at all, not an unknown one: never counted toward setting it aside.
    expect(results.over4096).toBe("RelayDown");
    expect(results.created201).toBe("RelayUnknown");
    expect(results.noContent204).toBe("RelayUnknown");
  });

  it("402: a non-negative integer `price`; any Retry-After it names; past 4,096 bytes no answer", async () => {
    const results = {
      zero: await outcome(json(402, { price: 0 })),
      named: await outcome(json(402, { error: "more proof of work", price: 21 })),
      withWait: await outcome(json(402, { price: 30 }, { "retry-after": "120" })),
      httpDate: await outcome(json(402, { price: 30 }, { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" })),
      noPrice: await outcome(json(402, { error: "more proof of work" })),
      over4096: await outcome(json(402, { price: 21, pad: "x".repeat(5000) })),
    };
    expect(results.zero).toEqual({ kind: "price", bits: 0 });
    expect(results.named).toEqual({ kind: "price", bits: 21 });
    expect(results.withWait).toEqual({ kind: "price", bits: 30, retryAfterMs: 120_000 });
    expect(results.httpDate).toEqual({ kind: "price", bits: 30, retryAfterMs: 60_000 });
    expect(results.noPrice).toBe("RelayUnknown");
    expect(results.over4096).toBe("RelayDown");
  });

  it("429: the edge's exact JSON words hold the network; any other words, or a body that isn't JSON, one size", async () => {
    const slow = clocked();
    const slowLong = clocked();
    const busy = clocked();
    const results = {
      slowDown: await outcome(json(429, { error: "slow down" }, { "retry-after": "20" }), slow),
      slowDownHour: await outcome(json(429, { error: "slow down" }, { "retry-after": "3600" }), slowLong),
      busy: await outcome(json(429, { error: "too many requests at once" }, { "retry-after": "30" }), busy),
      capital: await outcome(json(429, { error: "Slow down" }, { "retry-after": "20" })),
      plainWords: await outcome(text(429, "slow down", { "retry-after": "20" })),
      window: await outcome(json(429, { error: "this address's share of the pool is full for now" }, { "retry-after": "133200" })),
      overLongest: await outcome(json(429, { error: "x" }, { "retry-after": String(200 * 3600) })),
    };
    expect(results.slowDown).toEqual({ kind: "wait", scope: "network", retryAfterMs: 20_000 });
    expect(slow.holding()).toBe(20_000);
    // The post's wait is the hour; every request to the origin (both pools, pages too) waits at most a minute.
    expect(results.slowDownHour).toEqual({ kind: "wait", scope: "network", retryAfterMs: 3_600_000 });
    expect(slowLong.holding()).toBe(60_000);
    // The edge's busy answer: a second, whatever its Retry-After says.
    expect(results.busy).toEqual({ kind: "wait", scope: "network", retryAfterMs: 1000 });
    expect(busy.holding()).toBe(1000);
    expect(results.capital).toEqual({ kind: "wait", scope: "size", retryAfterMs: 20_000 });
    expect(results.plainWords).toEqual({ kind: "wait", scope: "size", retryAfterMs: 20_000 });
    expect(results.window).toEqual({ kind: "wait", scope: "size", retryAfterMs: 133_200_000 });
    expect(results.overLongest).toEqual({ kind: "wait", scope: "size", retryAfterMs: 37 * 3600_000 });
  });

  it("Retry-After is read as Number(header) seconds: absent, 0, negative, a date or Infinity is a minute", async () => {
    const forms: Record<string, string | undefined> = {
      absent: undefined,
      empty: "",
      zero: "0",
      negative: "-5",
      fraction: "1.5",
      spaced: " 20 ",
      exponent: "1e2",
      hex: "0x10",
      httpDate: "Wed, 21 Oct 2026 07:28:00 GMT",
      infinity: "Infinity",
    };
    const read: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(forms)) {
      const answer = await post(json(429, { error: "x" }, value === undefined ? {} : { "retry-after": value }));
      read[name] = (answer as { retryAfterMs: number }).retryAfterMs;
    }
    expect(read).toEqual({
      absent: 60_000,
      empty: 60_000,
      zero: 60_000,
      negative: 60_000,
      fraction: 1500,
      spaced: 20_000,
      exponent: 100_000,
      hex: 16_000,
      httpDate: 60_000,
      infinity: 60_000,
    });
  });

  it("503 holds every post of the network, its body unread; 400 and 413 refuse; 410 stops; 408 waits; a 5xx is none; any other status is unknown", async () => {
    const results = {
      s503: await outcome(json(503, { error: "the pool is full" }, { "retry-after": "30" })),
      s503bare: await outcome(text(503, "")),
      s400: await outcome(json(400, { error: "a post is a nonce, then an envelope" })),
      s413: await outcome(text(413, "length limit exceeded")),
      s410: await outcome(json(410, { error: "messaging is stopped" })),
      s401: await outcome(text(401, "")),
      s403: await outcome(json(403, { error: "only Seedelf Wallet reads this" })),
      s404: await outcome(json(404, { error: "no such pool: mainnet or preprod" })),
      s408: await outcome(json(408, { error: "the request's body didn't arrive in time" })),
      s500: await outcome(text(500, "internal error")),
      s502: await outcome(text(502, "bad gateway")),
    };
    expect(results.s503).toEqual({ kind: "wait", scope: "network", retryAfterMs: 30_000 });
    expect(results.s503bare).toEqual({ kind: "wait", scope: "network", retryAfterMs: 60_000 });
    expect(results.s400).toEqual({ kind: "refused", status: 400 });
    expect(results.s413).toEqual({ kind: "refused", status: 413 });
    expect(results.s410).toBe("RelayStopped");
    for (const s of ["s401", "s403", "s404"] as const) expect(results[s]).toBe("RelayUnknown");
    // Fix C: the edge's 408 for a body that broke off or came slowly is a minute's wait of that size; Caddy's 502 and a
    // 500 are no answer, never a strike against the envelope.
    expect(results.s408).toEqual({ kind: "wait", scope: "size", retryAfterMs: 60_000 });
    expect(results.s500).toBe("RelayDown");
    expect(results.s502).toBe("RelayDown");
  });
});

describe("a page's answers (freeze item 14)", { timeout: 30_000 }, () => {
  it("429 by its words: the day's reading (25 h at most, a minute without a Retry-After), busy, or a shared hold of a minute at most", async () => {
    const other = clocked();
    const otherBare = clocked();
    const busy = clocked();
    const results = {
      dayRead: await pageOutcome(json(429, { error: "this address has read its share of the pool for the day" }, { "retry-after": "7200" })),
      dayReadBare: await pageOutcome(json(429, { error: "this address has read its share of the pool for the day" })),
      dayReadLong: await pageOutcome(json(429, { error: "this address has read its share of the pool for the day" }, { "retry-after": String(48 * 3600) })),
      busy: await pageOutcome(json(429, { error: "too many requests at once" }, { "retry-after": "30" }), busy),
      other: await pageOutcome(json(429, { error: "slow down" }, { "retry-after": "3600" }), other),
      otherBare: await pageOutcome(text(429, ""), otherBare),
    };
    expect(results.dayRead).toBe("RelayDayRead 7200000");
    expect(results.dayReadBare).toBe("RelayDayRead 60000");
    expect(results.dayReadLong).toBe(`RelayDayRead ${25 * 3600_000}`);
    expect(results.busy).toBe("RelayBusy");
    expect(busy.holding()).toBe(1000);
    expect(results.other).toMatch(/^RelayDown: the relay answered 429/);
    expect(other.holding()).toBe(60_000);
    expect(otherBare.holding()).toBe(60_000);
  });

  it("503 is the relay down, its Retry-After unused; 410 stops; any 2xx is read as a page", async () => {
    const held = clocked();
    const results = {
      s503: await pageOutcome(json(503, { error: "messaging is near its traffic allowance: short pages only for now" }, { "retry-after": "3600" }), held),
      s410: await pageOutcome(json(410, { error: "messaging is stopped" })),
      s404: await pageOutcome(json(404, { error: "no such pool: mainnet or preprod" })),
      s206: await pageOutcome(() => new Response(emptyPage(), { status: 206 })),
      s204: await pageOutcome(() => new Response(null, { status: 204 })),
    };
    expect(results.s503).toMatch(/^RelayDown: the relay answered 503/);
    expect(held.holding()).toBe(0);
    expect(results.s410).toBe("RelayStopped");
    expect(results.s404).toMatch(/^RelayDown/);
    expect(results.s206).toBe("page");
    expect(results.s204).toMatch(/^RelayDown: .*too short/);
  });
});
