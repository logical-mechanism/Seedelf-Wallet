// Seedelf Messaging's relay (chunk 54's 54c): the pages every reader
// downloads and the envelopes a writer posts, byte for byte as protocol.md
// §17 fixes them. The relay sits on the data layer's server, behind the same
// edge, with buckets of its own, and answers the wallet's origin with CORS
// headers, so it needs no host permission (networks.ts `relayOrigin`).
//
// Only the worker calls it, and only for a network whose Messages switch is
// on (messaging.ts). Nothing here knows a key: a page is what everyone
// downloads, and a post is an envelope with its proof of work.
//
// What the relay sends is held to §17's bounds: a page's body is read through
// its stream and given up past the most a page can be, and a post's answer
// past a few words (the 1.10.0 gate's W5). A price is said as the relay names
// it: whether it's paid is the worker's (messaging.ts `postOne`, under the
// bindings' ceiling, W17). What a later relay may send is read so it holds no
// more than it says (W15, W16): a 410 is the relay's off switch, an envelope
// of a size this version doesn't know is stepped over, an answer it doesn't
// know is said as one, and a 429 holds what its words name.

import type { NetworkName } from "../networks";
import { type FetchLike, RateLimit, SERVICE_FETCH } from "./koios";

/** How long the relay has to answer a request, up to its answer's head. */
export const RELAY_TIMEOUT_MS = 30_000;

/**
 * How long a page's body may then take (worker-net#11): a full page, 264,208 bytes, arrives over a link of about
 * 18 kbit/s. A link slower than that never catches up, as before; one between that and the old 30 s's 70 kbit/s does.
 */
export const RELAY_BODY_TIMEOUT_MS = 120_000;

/** The most envelopes a page holds (§17.5), and so what a page is charged before its size is known. */
export const PAGE_MAX_BYTES = 256 * 1024;

/** The smallest envelope (§9, §16.1). */
const SMALLEST = 512;

/**
 * The most a page's body can be (§17.5): its header, 16 bytes (version 1, flags 1, cursor 8, prices 4, count 2), then
 * at most PAGE_MAX_BYTES of envelopes, each behind its 4-byte length, and the most lengths a page carries are a full
 * page of the smallest, 512. So 16 + 4 × 512 + 262,144 = 264,208 bytes.
 */
export const PAGE_BODY_MAX_BYTES = 16 + 4 * (PAGE_MAX_BYTES / SMALLEST) + PAGE_MAX_BYTES;

/** The most a post's answer is read to (§17.2): a few words of JSON. */
const ANSWER_MAX_BYTES = 4096;

/** What each pool holds at most (§17.1). */
export const POOL_MAX_BYTES: Record<NetworkName, number> = { mainnet: 64 * 1024 * 1024, preprod: 8 * 1024 * 1024 };

/** How long the relay keeps an envelope (§10): a fresh post's `expires` is the relay's now and this. */
export const RELAY_HOLD_MS = 36 * 3600_000;

/** The longest the day's reading holds a pool's pages (W16): a day and the hour its oldest bucket spans. */
export const DAY_READ_MAX_MS = 25 * 3600_000;

/**
 * What a request costs at the edge's messaging bucket (§17.2): a post 4, a page 1 and 1 for every 16 KiB it sends.
 * A page is charged as if full: its size is known only once it's read.
 */
export const POST_UNITS = 4;
export const PAGE_UNITS = 1 + PAGE_MAX_BYTES / (16 * 1024);

/**
 * The most pages one sync reads (the 1.10.0 gate's W10): what the client's own limit lets through without a wait,
 * floor(280 / 17), whatever the pages hold. With `more` still set, the rest is read at the next tick.
 */
export const PAGES_A_SYNC = Math.floor(280 / PAGE_UNITS);

/**
 * The edge's messaging bucket holds 300 units and refills 10 a second. 280 in any 30 s stays inside it however the
 * windows fall (280 + 280·T/30 ≤ 300 + 10·T for every T), so a fresh sync's pages never meet a 429 of the wallet's
 * own making: about 16 full pages, 4 MiB, every 30 s. One for every origin a build reaches, shared by both pools.
 */
const LIMITS = new Map<string, RateLimit>();
const limitFor = (origin: string) => {
  let limit = LIMITS.get(origin);
  if (!limit) LIMITS.set(origin, (limit = new RateLimit(280, 30_000)));
  return limit;
};

/** One page of a pool (§17.5). */
export interface RelayPage {
  /** Another page follows now. */
  more: boolean;
  /** Something after the cursor asked from is gone, or the cursor isn't one this pool gave out. */
  gap: boolean;
  /** What to ask from next: a decimal u64. */
  cursor: string;
  /** The bits a post from this address would be asked now, for 512, 2,048, 8,192 and 32,768 bytes; 0, refused. */
  prices: [number, number, number, number];
  /** The envelopes, hex, in the order they came. */
  envelopes: string[];
}

/** What the relay made of a post (§17.2). */
export type PostAnswer =
  /**
   * Kept, new or already held: the relay drops it at `expires` (ms since the epoch). `fresh`: new, so `expires` is the
   * relay's now and RELAY_HOLD_MS (W14); an envelope already held keeps its first post's.
   */
  | { kind: "kept"; expires: number; fresh: boolean }
  /**
   * Its stamp showed too little work: solved again, for the same bytes, at `bits`, where the worker pays that much (its
   * ceiling, W17). `retryAfterMs`: how long the 402 says to wait, where it says, for a price the worker won't pay.
   */
  | { kind: "price"; bits: number; retryAfterMs?: number }
  /**
   * Not now: again after `retryAfterMs`. `size`: posts of this one's size wait, the others go on (§17.4 prices and
   * refuses by size: its price past the ceiling, or the address's window). `network`: every post waits (the edge's
   * bucket, or the server's own 503s: its address tables or the pool full, messaging's traffic allowance spent).
   */
  | { kind: "wait"; scope: "size" | "network"; retryAfterMs: number }
  /** Never as it is: bytes the relay, or something on the way, won't take (a 400 or a 413). */
  | { kind: "refused"; status: number };

/** The relay didn't answer, or answered something that isn't §17's. */
export class RelayDown extends Error {}

/** Not asked: what the caller said must still hold, right before the request, didn't. */
export class RelayNotAsked extends RelayDown {}

/**
 * The relay's off switch (W15, versions-upgrade#2): a 410 Gone on a page or a post, whatever its body. Messages are
 * stopped on purpose there, so the worker asks again only now and then, and posts nothing meanwhile.
 */
export class RelayStopped extends RelayDown {}

/**
 * An answer to a post that this version doesn't know (W15, versions-upgrade#6): a status §17.2 doesn't give, or one
 * whose body doesn't read. Unlike a relay that didn't answer, it may be about this envelope alone.
 */
export class RelayUnknown extends RelayDown {}

/**
 * This address has read its share of the pool for the day (W16): only this pool's pages wait, `retryAfterMs` (at most
 * DAY_READ_MAX_MS). Posts go on.
 */
export class RelayDayRead extends RelayDown {
  constructor(readonly retryAfterMs: number) {
    super("the relay says this address has read its share of the pool for the day");
  }
}

/** The edge's "too many requests at once" (W16): a second's wait for every request to the relay, nothing more. */
export class RelayBusy extends RelayDown {}

/** Checked right before a request goes, after any wait for the rate limit: false, it doesn't. */
export type MayAsk = () => Promise<boolean>;

/** The envelope sizes this version reads (§16.1): one of any other size in a page is stepped over (W15). */
const SIZES = new Set([512, 2048, 8192, 32768]);

/**
 * Reads a page's bytes (§17.5); throws RelayDown for anything that isn't one, a page past its bound too. An envelope
 * whose length isn't one of the four sizes is stepped over, as long as it stays inside the page (versions-upgrade#3):
 * a later relay can add a size to a pool without a 1.10.0 wallet losing the pages it's in. It still counts toward the
 * page's 256 KiB.
 */
export function readPage(bytes: Uint8Array): RelayPage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (why: string) => new RelayDown(`the relay's page doesn't read: ${why}`);
  if (bytes.length < 16) throw fail("too short");
  if (bytes.length > PAGE_BODY_MAX_BYTES) throw fail(`${bytes.length} bytes, more than a page holds`);
  if (bytes[0] !== 1) throw fail(`version ${bytes[0]}`);
  const flags = bytes[1]!;
  const cursor = view.getBigUint64(2).toString();
  const prices = [bytes[10]!, bytes[11]!, bytes[12]!, bytes[13]!] as RelayPage["prices"];
  const count = view.getUint16(14);
  const envelopes: string[] = [];
  let at = 16;
  let held = 0;
  for (let i = 0; i < count; i++) {
    if (at + 4 > bytes.length) throw fail("an envelope's length runs past the end");
    const length = view.getUint32(at);
    at += 4;
    if (at + length > bytes.length) throw fail(`an envelope of ${length} bytes runs past the end`);
    held += length;
    if (held > PAGE_MAX_BYTES) throw fail(`more than ${PAGE_MAX_BYTES} bytes of envelopes`);
    if (SIZES.has(length)) envelopes.push(hex(bytes.subarray(at, at + length)));
    at += length;
  }
  if (at !== bytes.length) throw fail("bytes after the last envelope");
  return { more: (flags & 1) !== 0, gap: (flags & 2) !== 0, cursor, prices, envelopes };
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function hex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += HEX[b];
  return out;
}

/** A Retry-After in seconds, as the relay and the edge send it, at most `most`; a minute without one. */
function retryAfterMs(response: Response, most: number): number {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, most) * 1000 : 60_000;
}

const HOUR_S = 3600;
/**
 * The longest a post's wait can be (§17.4): an address's window, 36 hours and the hour its oldest bucket spans. Only
 * that size's posts, or the outbox, wait that long, so the countdown says the real time. A page's 429 that names no
 * longer wait holds every request to the origin through the rate limit, for at most a minute (koios.ts
 * MAX_BACK_OFF_MS, which `hold` keeps it within).
 */
const POST_WAIT_S = 37 * HOUR_S;

/**
 * The edge's words for its own 429, the address's messaging bucket empty (seedelf-data's api/src/edge.rs `refuse`):
 * every request waits, pages too. The relay's own 429s are one size's (§17.4), in other words.
 */
const EDGE_SLOW_DOWN = "slow down";

/** The edge's words for its 429 when this address has too many requests in flight (edge.rs `refuse`): a second's wait. */
const EDGE_BUSY = "too many requests at once";

/** What the edge's busy 429 holds every request to the relay for (W16): its own Retry-After, a second. */
const BUSY_WAIT_MS = 1000;

/** The relay's words for a page's 429 when this address has read its day's share of the pool (messaging/mod.rs). */
const DAY_READ = "this address has read its share of the pool for the day";

/** Lets go of an answer's body the wallet won't read. */
const drop = (response: Response) => void response.body?.cancel().catch(() => undefined);

export interface RelayDeps {
  origin: string;
  pool: NetworkName;
  fetch?: FetchLike;
  /** The rate limit, a test's own; the origin's shared one otherwise. */
  limit?: RateLimit;
}

export class RelayClient {
  constructor(private readonly deps: RelayDeps) {}

  private get base() {
    return `${this.deps.origin}/messaging/v1/${this.deps.pool}/envelopes`;
  }

  private get limit(): RateLimit {
    return this.deps.limit ?? limitFor(this.deps.origin);
  }

  /**
   * One request: its turn under the rate limit, `mayAsk` after the wait, then its answer's head within
   * RELAY_TIMEOUT_MS. The body is the caller's to read (`bodyOf`), under the same abort.
   */
  private async call(url: string, init: RequestInit, units: number, mayAsk?: MayAsk): Promise<{ response: Response; abort: AbortController }> {
    await this.limit.take(units);
    // The wait can be long (a 429's hold): whether to ask at all is decided after it.
    if (mayAsk && !(await mayAsk())) throw new RelayNotAsked("not asked");
    const fetcher = this.deps.fetch ?? ((u, i) => fetch(u, i));
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new RelayDown(`the relay didn't answer in ${RELAY_TIMEOUT_MS / 1000} s`));
        abort.abort();
      }, RELAY_TIMEOUT_MS);
    });
    try {
      const response = await Promise.race([fetcher(url, { ...SERVICE_FETCH, ...init, signal: abort.signal }), late]);
      return { response, abort };
    } catch (e) {
      if (e instanceof RelayDown) throw e;
      throw new RelayDown(`the relay didn't answer: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * An answer's body, read through its stream with a running count: given up past `max` bytes (a length that says so
   * is refused before a byte is read) or past `ms`. RelayDown either way (worker-net#5).
   */
  private async bodyOf(response: Response, abort: AbortController, max: number, ms: number): Promise<Uint8Array> {
    const length = Number(response.headers.get("content-length") ?? Number.NaN);
    if (Number.isFinite(length) && length > max) {
      abort.abort();
      drop(response);
      throw new RelayDown(`the relay's answer is ${length} bytes, more than ${max}`);
    }
    const reader = response.body?.getReader();
    if (!reader) return new Uint8Array(0);
    const chunks: Uint8Array[] = [];
    let size = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new RelayDown(`the relay's answer didn't arrive in ${ms / 1000} s`)), ms);
    });
    try {
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), late]);
        if (done) break;
        size += value.byteLength;
        if (size > max) throw new RelayDown(`the relay's answer is more than ${max} bytes`);
        chunks.push(value);
      }
    } catch (e) {
      abort.abort();
      void reader.cancel().catch(() => undefined);
      // The body cut off, or the time given it ran out while it came.
      if (e instanceof RelayDown) throw e;
      throw new RelayDown(`the relay's answer didn't arrive: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.byteLength;
    }
    return out;
  }

  /** An answer's JSON, read to a few words at most: undefined when it isn't JSON, or its body doesn't arrive. */
  private async wordsOf(response: Response, abort: AbortController): Promise<Record<string, unknown> | undefined> {
    try {
      const bytes = await this.bodyOf(response, abort, ANSWER_MAX_BYTES, RELAY_TIMEOUT_MS);
      const read: unknown = JSON.parse(new TextDecoder().decode(bytes));
      return typeof read === "object" && read !== null ? (read as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * The page after `after`, or the pool's first page without one. Throws RelayDown when there's none to read: a
   * RelayStopped for the relay's off switch, a RelayDayRead for this address's day's share read, a RelayBusy for the
   * edge's busy answer.
   */
  async page(after?: string, mayAsk?: MayAsk): Promise<RelayPage> {
    const url = after === undefined ? this.base : `${this.base}?after=${after}`;
    const { response, abort } = await this.call(url, { method: "GET" }, PAGE_UNITS, mayAsk);
    if (response.status === 410) {
      drop(response);
      throw new RelayStopped("the relay's Messages are stopped");
    }
    if (response.status === 429) {
      const error = (await this.wordsOf(response, abort))?.error;
      // This pool's pages alone, as long as the relay says, up to a day and an hour: nothing else waits (W16).
      if (error === DAY_READ) throw new RelayDayRead(Math.min(retryAfterMs(response, DAY_READ_MAX_MS / 1000), DAY_READ_MAX_MS));
      // Too many of this address's requests in flight at the edge: every request waits a second, no more (W16).
      if (error === EDGE_BUSY) {
        this.limit.hold(BUSY_WAIT_MS);
        throw new RelayBusy("the relay's edge is busy with this address's requests");
      }
      // The edge's bucket: every call waits as long as it asks, at most a minute (koios.ts MAX_BACK_OFF_MS).
      this.limit.hold(retryAfterMs(response, HOUR_S));
      throw new RelayDown("the relay answered 429");
    }
    if (!response.ok) {
      drop(response);
      throw new RelayDown(`the relay answered ${response.status}`);
    }
    return readPage(await this.bodyOf(response, abort, PAGE_BODY_MAX_BYTES, RELAY_BODY_TIMEOUT_MS));
  }

  /**
   * Posts `body`, a nonce and its envelope (`messagingPostBody`). Throws RelayDown when the relay didn't answer: a
   * RelayStopped for its off switch, a RelayUnknown for an answer this version doesn't know.
   */
  async post(body: Uint8Array, mayAsk?: MayAsk): Promise<PostAnswer> {
    const { response, abort } = await this.call(
      this.base,
      { method: "POST", headers: { "content-type": "application/octet-stream" }, body: body as BodyInit },
      POST_UNITS,
      mayAsk,
    );
    /** The answer's JSON; a body cut off or past its bound is no answer at all. */
    const answer = async (): Promise<Record<string, unknown> | undefined> => {
      const bytes = await this.bodyOf(response, abort, ANSWER_MAX_BYTES, RELAY_TIMEOUT_MS);
      try {
        const read: unknown = JSON.parse(new TextDecoder().decode(bytes));
        return typeof read === "object" && read !== null ? (read as Record<string, unknown>) : undefined;
      } catch {
        return undefined;
      }
    };
    switch (response.status) {
      case 200: {
        const read = await answer();
        const expires = read?.expires;
        if (typeof expires !== "number" || !Number.isFinite(expires)) throw new RelayUnknown("the relay's answer doesn't read");
        return { kind: "kept", expires: expires * 1000, fresh: read?.kept === "new" };
      }
      case 402: {
        const bits = (await answer())?.price;
        if (typeof bits !== "number" || !Number.isInteger(bits) || bits < 0) throw new RelayUnknown("the relay's price doesn't read");
        // Said as it's named, with any wait it names: past the ceiling, the worker waits rather than works (W17).
        return response.headers.get("retry-after") === null
          ? { kind: "price", bits }
          : { kind: "price", bits, retryAfterMs: retryAfterMs(response, POST_WAIT_S) };
      }
      case 429: {
        const wait = retryAfterMs(response, POST_WAIT_S);
        const error = (await answer().catch(() => undefined))?.error;
        if (error === EDGE_BUSY) {
          // Too many of this address's requests in flight at the edge: every request waits a second (W16).
          this.limit.hold(BUSY_WAIT_MS);
          return { kind: "wait", scope: "network", retryAfterMs: BUSY_WAIT_MS };
        }
        if (error === EDGE_SLOW_DOWN) {
          // The edge's bucket: pages wait for it too.
          this.limit.hold(wait);
          return { kind: "wait", scope: "network", retryAfterMs: wait };
        }
        return { kind: "wait", scope: "size", retryAfterMs: wait };
      }
      case 503:
        drop(response);
        return { kind: "wait", scope: "network", retryAfterMs: retryAfterMs(response, POST_WAIT_S) };
      case 400:
      case 413:
        drop(response);
        return { kind: "refused", status: response.status };
      case 410:
        drop(response);
        throw new RelayStopped("the relay's Messages are stopped");
      default:
        drop(response);
        throw new RelayUnknown(`the relay answered ${response.status}`);
    }
  }
}
