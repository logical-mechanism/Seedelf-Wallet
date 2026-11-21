// Seedelf Messaging's relay (chunk 54's 54c): the pages every reader
// downloads and the envelopes a writer posts, byte for byte as protocol.md
// §17 fixes them. The relay sits on the data layer's server, behind the same
// edge, with buckets of its own, and answers the wallet's origin with CORS
// headers, so it needs no host permission (networks.ts `relayOrigin`).
//
// Only the worker calls it, and only for a network whose Messages switch is
// on (messaging.ts). Nothing here knows a key: a page is what everyone
// downloads, and a post is an envelope with its proof of work.

import type { NetworkName } from "../networks";
import { type FetchLike, RateLimit, SERVICE_FETCH } from "./koios";

/** A page's or a post's wait on the relay: it answers in milliseconds, but a full page is 256 KiB. */
export const RELAY_TIMEOUT_MS = 30_000;

/** The most a page holds (§17.5), and so what a page is charged before its size is known. */
export const PAGE_MAX_BYTES = 256 * 1024;

/**
 * What a request costs at the edge's messaging bucket (§17.2): a post 4, a page 1 and 1 for every 16 KiB it sends.
 * A page is charged as if full: its size is known only once it's read.
 */
export const POST_UNITS = 4;
export const PAGE_UNITS = 1 + PAGE_MAX_BYTES / (16 * 1024);

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
  /** Kept, new or already held: the relay drops it at `expires` (ms since the epoch). */
  | { kind: "kept"; expires: number }
  /** Its stamp showed too little work: solved again, for the same bytes, at `bits`. */
  | { kind: "price"; bits: number }
  /** Not now: past the price's ceiling, the pool full, the edge's bucket or allowance spent. Again after `retryAfterMs`. */
  | { kind: "wait"; retryAfterMs: number }
  /** Never: bytes the relay won't take (a 400 or a 413). */
  | { kind: "refused"; status: number };

/** The relay didn't answer, or answered something that isn't §17's. */
export class RelayDown extends Error {}

/** Not asked: what the caller said must still hold, right before the request, didn't. */
export class RelayNotAsked extends RelayDown {}

/** Checked right before a request goes, after any wait for the rate limit: false, it doesn't. */
export type MayAsk = () => Promise<boolean>;

/** The envelope sizes a page may hold (§16.1): anything else in one is a relay that isn't §17's. */
const SIZES = new Set([512, 2048, 8192, 32768]);

/** Reads a page's bytes (§17.5); throws RelayDown for anything that isn't one. */
export function readPage(bytes: Uint8Array): RelayPage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (why: string) => new RelayDown(`the relay's page doesn't read: ${why}`);
  if (bytes.length < 16) throw fail("too short");
  if (bytes[0] !== 1) throw fail(`version ${bytes[0]}`);
  const flags = bytes[1]!;
  const cursor = view.getBigUint64(2).toString();
  const prices = [bytes[10]!, bytes[11]!, bytes[12]!, bytes[13]!] as RelayPage["prices"];
  const count = view.getUint16(14);
  const envelopes: string[] = [];
  let at = 16;
  for (let i = 0; i < count; i++) {
    if (at + 4 > bytes.length) throw fail("an envelope's length runs past the end");
    const length = view.getUint32(at);
    at += 4;
    if (!SIZES.has(length) || at + length > bytes.length) throw fail(`an envelope of ${length} bytes`);
    envelopes.push(hex(bytes.subarray(at, at + length)));
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

/** A Retry-After in seconds, as the relay and the edge send it; a minute without one. */
function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) * 1000 : 60_000;
}

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

  private async call(url: string, init: RequestInit, units: number, mayAsk?: MayAsk): Promise<Response> {
    const limit = this.deps.limit ?? limitFor(this.deps.origin);
    await limit.take(units);
    // The wait can be long (a 429's hold, up to an hour): whether to ask at all is decided after it.
    if (mayAsk && !(await mayAsk())) throw new RelayNotAsked("not asked");
    const fetcher = this.deps.fetch ?? ((u, i) => fetch(u, i));
    let response: Response;
    try {
      response = await fetcher(url, { ...SERVICE_FETCH, ...init, signal: AbortSignal.timeout(RELAY_TIMEOUT_MS) });
    } catch (e) {
      throw new RelayDown(`the relay didn't answer: ${(e as Error).message}`);
    }
    return response;
  }

  /** The page after `after`, or the pool's first page without one. Throws RelayDown when there's none to read. */
  async page(after?: string, mayAsk?: MayAsk): Promise<RelayPage> {
    const url = after === undefined ? this.base : `${this.base}?after=${after}`;
    const response = await this.call(url, { method: "GET" }, PAGE_UNITS, mayAsk);
    // A page's 429 is the edge's bucket: every call waits as long as it asks (koios.ts RateLimit's hold).
    if (response.status === 429) (this.deps.limit ?? limitFor(this.deps.origin)).hold(retryAfterMs(response));
    if (!response.ok) throw new RelayDown(`the relay answered ${response.status}`);
    let body: ArrayBuffer;
    try {
      body = await response.arrayBuffer();
    } catch (e) {
      // The body cut off, or the timeout reached while it came.
      throw new RelayDown(`the relay's page didn't arrive: ${(e as Error).message}`);
    }
    return readPage(new Uint8Array(body));
  }

  /** Posts `body`, a nonce and its envelope (`messagingPostBody`). Throws RelayDown when the relay didn't answer. */
  async post(body: Uint8Array, mayAsk?: MayAsk): Promise<PostAnswer> {
    const response = await this.call(
      this.base,
      { method: "POST", headers: { "content-type": "application/octet-stream" }, body: body as BodyInit },
      POST_UNITS,
      mayAsk,
    );
    switch (response.status) {
      case 200: {
        const answer = (await response.json().catch(() => undefined)) as { expires?: unknown } | undefined;
        const expires = answer?.expires;
        if (typeof expires !== "number" || !Number.isFinite(expires)) throw new RelayDown("the relay's answer doesn't read");
        return { kind: "kept", expires: expires * 1000 };
      }
      case 402: {
        const answer = (await response.json().catch(() => undefined)) as { price?: unknown } | undefined;
        const bits = answer?.price;
        if (typeof bits !== "number" || !Number.isInteger(bits) || bits < 0 || bits > 32) {
          throw new RelayDown("the relay's price doesn't read");
        }
        return { kind: "price", bits };
      }
      case 429:
      case 503:
        return { kind: "wait", retryAfterMs: retryAfterMs(response) };
      case 400:
      case 413:
        return { kind: "refused", status: response.status };
      default:
        throw new RelayDown(`the relay answered ${response.status}`);
    }
  }
}
