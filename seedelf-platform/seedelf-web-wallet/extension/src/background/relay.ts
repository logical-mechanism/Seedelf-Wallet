// Seedelf Messaging's relay (chunk 54's 54c): the pages every reader
// downloads and the envelopes a writer posts, byte for byte as protocol.md
// §17 fixes them. The relay sits on the data layer's server, behind the same
// edge, with buckets of its own, and answers the wallet's origin with CORS
// headers, so it needs no host permission (networks.ts `relayOrigin`).
//
// Only the worker calls it, and only for a network whose Messages switch is
// on (messaging.ts), but a withdrawal of the wallet's own certificate, which
// turning Messages off posts. Nothing here knows a key: a page is what everyone
// downloads, and a post is an envelope with its proof of work. Beside the
// envelopes, each pool keeps a list of certificates (chunk 55, protocol.md
// §21.7): read whole by every wallet in pages behind a cursor, never by name,
// posted one certificate at a time, with a stamp of its own label, and
// withdrawn one at a time, a proof of the messaging key's beside it.
//
// What the relay sends is held to §17's bounds: a page's body is read through
// its stream and given up past the most a page can be, and a post's answer
// past a few words (the 1.10.0 gate's W5). A price is said as the relay names
// it: whether it's paid is the worker's (messaging.ts `postOne`, under the
// bindings' ceiling, W17). What a later relay may send is read so it holds no
// more than it says (W15, W16): a 410 is the relay's off switch, an envelope
// of a size this version doesn't know is stepped over, an answer it doesn't
// know is said as one, and a 429 holds what its words name. What a status
// says is kept with it (`RelayDown.status`): the worker's off switch ends only
// on an answer of the relay's own (the 1.10.0 gate's round 5, the freeze's fix
// A), and a 5xx but 503 is none (fix C).

import type { NetworkName } from "../networks";
import { type FetchLike, RateLimit, SERVICE_FETCH } from "./koios";

/** How long the relay has to answer a request, up to its answer's head. */
export const RELAY_TIMEOUT_MS = 30_000;

/**
 * How long a page's body may then take (worker-net#11): the wallet's own bound, two minutes. The server's is shorter:
 * its proxy gives an answer 60 s to be written (Caddy's `write 60s`), so a full page, 264,208 bytes, needs a link of
 * about 35 kbit/s down, and a slower one never gets the whole page. A post's body has 10 s at the proxy and the edge,
 * about 26 kbit/s up for a 32 KiB message: a slower link's post is cut off, which is no answer, and the posting run
 * goes on past it (the freeze's fix C). Both are the owner's calls (the 1.10.0 gate's freeze calls 5 and 6).
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
 * own making: about 16 full pages, 4 MiB, every 30 s. One for every origin a build reaches, shared by both pools. On
 * the monotonic clock (W14; the freeze's fix E): a device clock set back after a sync's pages holds no request.
 */
const LIMITS = new Map<string, RateLimit>();
const limitFor = (origin: string) => {
  let limit = LIMITS.get(origin);
  if (!limit) LIMITS.set(origin, (limit = new RateLimit(280, 30_000, () => performance.now())));
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

/**
 * The relay didn't answer, or answered something that isn't §17's. `status`: the HTTP status it answered with, where it
 * answered at all (none for a request that failed, timed out or wasn't made, or a body that didn't arrive).
 */
export class RelayDown extends Error {
  constructor(
    message?: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * Whether `e` is an answer of the relay's own (the freeze's fix A): a status but a 410, and none of the 5xx but 503,
 * which a proxy in front of it gives for a relay it can't reach (fix C). A failed fetch, a time-out, a body that didn't
 * arrive, and a request not made are none. What ends the off switch.
 */
export function relayAnswered(e: unknown): boolean {
  if (!(e instanceof RelayDown) || e.status === undefined) return false;
  const status = e.status;
  return status !== 410 && !(status >= 500 && status <= 599 && status !== 503);
}

/** Not asked: what the caller said must still hold, right before the request, didn't. */
export class RelayNotAsked extends RelayDown {}

/**
 * The relay's off switch (W15, versions-upgrade#2): a 410 Gone on a page or a post, whatever its body. Messages are
 * stopped on purpose there, so the worker asks again only now and then, and posts nothing meanwhile.
 */
export class RelayStopped extends RelayDown {
  constructor(message?: string) {
    super(message, 410);
  }
}

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
    super("the relay says this address has read its share of the pool for the day", 429);
  }
}

/** The edge's "too many requests at once" (W16): a second's wait for every request to the relay, nothing more. */
export class RelayBusy extends RelayDown {
  constructor(message?: string) {
    super(message, 429);
  }
}

/** Checked right before a request goes, after any wait for the rate limit: false, it doesn't. */
export type MayAsk = () => Promise<boolean>;

/** The envelope sizes this version reads (§16.1): one of any other size in a page is stepped over (W15). */
const SIZES = new Set([512, 2048, 8192, 32768]);

/**
 * The most a page of the certificate list holds (protocol.md §21.7): 64 KiB of entries' bytes, and at least one entry
 * when any follows the cursor.
 */
export const LIST_PAGE_MAX_BYTES = 64 * 1024;

/** The most entries a list page's count can say (§21.7): a u16. */
const LIST_PAGE_MAX_COUNT = 0xffff;

/**
 * The most a list page's body can be (§21.7): its header, 13 bytes (version 1, flags 1, cursor 8, price 1, count 2),
 * then as many entries as its count can say, each behind its kind and length (3 bytes), with LIST_PAGE_MAX_BYTES of
 * entries' bytes at most. From the count and the byte bound alone, never an entry's least size (the review of 55e,
 * L5): a page of a kind this version doesn't know, however short its entries, is skipped as §21.7 says, never refused.
 * So 13 + 3 × 65,535 + 65,536 = 262,154 bytes.
 */
export const LIST_PAGE_BODY_MAX_BYTES = 13 + 3 * LIST_PAGE_MAX_COUNT + LIST_PAGE_MAX_BYTES;

/**
 * What a list page costs at the edge's messaging bucket: charged as an envelopes' page is (§17.2), 1 and 1 for every 16
 * KiB it can send, as if full.
 */
export const LIST_PAGE_UNITS = 1 + LIST_PAGE_MAX_BYTES / (16 * 1024);

/** A certificate's length (§21.4): 273 to 304 bytes. */
const CERTIFICATE_MIN = 273;
const CERTIFICATE_MAX = 304;

/** One page of a pool's certificate list (§21.7). */
export interface CertificatePage {
  /** Another page follows now. */
  more: boolean;
  /** Entries after the cursor asked from were lost, or the cursor isn't one the list gave out: the page starts from the oldest entry held. */
  gap: boolean;
  /** What to ask from next: a decimal u64. */
  cursor: string;
  /** The bits a certificate post from this address would be asked now; 0, refused. */
  price: number;
  /**
   * The entries, in the order the list took them: a certificate's bytes (hex, kind 0x01), or the listing digest of one
   * the list no longer holds (hex, kind 0x02). A kind this version doesn't know is stepped over.
   */
  entries: Array<{ certificate: string } | { removed: string }>;
}

/**
 * Reads a certificate page's bytes (§21.7); throws RelayDown for anything that isn't one, a page past its bound too. An
 * entry of a kind this version doesn't know is stepped over, as long as it stays inside the page; a certificate entry
 * whose length isn't a certificate's, or a removal that isn't 32 bytes, is stepped over the same way (W15).
 */
export function readCertificatePage(bytes: Uint8Array): CertificatePage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (why: string) => new RelayDown(`the relay's certificate page doesn't read: ${why}`);
  if (bytes.length < 13) throw fail("too short");
  if (bytes.length > LIST_PAGE_BODY_MAX_BYTES) throw fail(`${bytes.length} bytes, more than a page holds`);
  if (bytes[0] !== 1) throw fail(`version ${bytes[0]}`);
  const flags = bytes[1]!;
  const cursor = view.getBigUint64(2).toString();
  const price = bytes[10]!;
  const count = view.getUint16(11);
  const entries: CertificatePage["entries"] = [];
  let at = 13;
  let held = 0;
  for (let i = 0; i < count; i++) {
    if (at + 3 > bytes.length) throw fail("an entry's length runs past the end");
    const kind = bytes[at]!;
    const length = view.getUint16(at + 1);
    at += 3;
    if (at + length > bytes.length) throw fail(`an entry of ${length} bytes runs past the end`);
    held += length;
    if (held > LIST_PAGE_MAX_BYTES) throw fail(`more than ${LIST_PAGE_MAX_BYTES} bytes of entries`);
    const entry = bytes.subarray(at, at + length);
    if (kind === 0x01 && length >= CERTIFICATE_MIN && length <= CERTIFICATE_MAX) entries.push({ certificate: hex(entry) });
    else if (kind === 0x02 && length === 32) entries.push({ removed: hex(entry) });
    at += length;
  }
  if (at !== bytes.length) throw fail("bytes after the last entry");
  return { more: (flags & 1) !== 0, gap: (flags & 2) !== 0, cursor, price, entries };
}

/**
 * What the relay made of a certificate's post (§21.7). `kept`: new, or one it holds already for the same Seedelf,
 * register and m_S, `digest` the listing digest of the certificate it holds (F10: an `already`'s may be another
 * posting's bytes); none where the answer named none that reads. `refused`: never as it is, `status` the relay's (a 400
 * or a 413 for its bytes; a 409 for two certificates held for the Seedelf already, `two`, a register that isn't the
 * Seedelf's now, `moved`, these bytes withdrawn before, `withdrawn`, check 3′, or its Seedelf withdrawn too often at that
 * register, `tooOften`, check 3″). The rest as an envelope's post (`PostAnswer`): a price, or a wait, `network` for
 * every certificate post (the edge's bucket, the list full or another of the server's 503s).
 */
export type CertificateAnswer =
  | { kind: "kept"; fresh: boolean; digest?: string }
  | { kind: "price"; bits: number; retryAfterMs?: number }
  | { kind: "wait"; scope: "size" | "network"; retryAfterMs: number }
  | { kind: "refused"; status: number; conflict?: "two" | "moved" | "withdrawn" | "tooOften" };

/**
 * What the relay made of a withdrawal's post (§21.7): `withdrawn`, its certificate off the list, a removal in its place;
 * `gone`, no certificate held under its digest (a 404 whose words are exactly `no such certificate`), which the list
 * already shows: done either way. Any other 404 (a route this relay doesn't have, a proxy's) is `refused`, as a 400 or a
 * 413 is. The rest as a certificate's post.
 */
export type WithdrawalAnswer =
  | { kind: "withdrawn" }
  | { kind: "gone" }
  | { kind: "price"; bits: number; retryAfterMs?: number }
  | { kind: "wait"; scope: "size" | "network"; retryAfterMs: number }
  | { kind: "refused"; status: number };

/** The relay's words for its 409s (§21.7, check 3′, check 3″, check 6 and check 8). */
const TWO_HELD = "two certificates for this Seedelf already";
const TOO_OFTEN = "this Seedelf was withdrawn too often at this register: move it to list it again";
/** The relay's words for a withdrawal's 404 (§21.7's withdrawals, check 3): only these say the digest isn't held. */
const NO_SUCH_CERTIFICATE = "no such certificate";
const NOT_NOW = "not this Seedelf's register now";
const WITHDRAWN = "withdrawn";

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
export const POST_WAIT_MAX_MS = POST_WAIT_S * 1000;

/** How long a post the server gave up reading waits (a 408, the freeze's fix C): that size, a minute. */
const SLOW_BODY_WAIT_MS = 60_000;

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

  /** The pool's certificate list (protocol.md §21.7), behind the same edge and off switch as its envelopes. */
  private get list() {
    return `${this.deps.origin}/messaging/v1/${this.deps.pool}/certificates`;
  }

  /** Where a certificate is withdrawn from the pool's list (protocol.md §21.7). */
  private get withdrawals() {
    return `${this.deps.origin}/messaging/v1/${this.deps.pool}/withdrawals`;
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
    await this.pageRefused(response, abort);
    return readPage(await this.bodyOf(response, abort, PAGE_BODY_MAX_BYTES, RELAY_BODY_TIMEOUT_MS));
  }

  /**
   * The page of the pool's certificate list after `after`, or its first page without one (protocol.md §21.7): read
   * whole by every wallet, never by name. Throws as `page` does: its answers are a page's, counted in the address's day
   * of reading.
   */
  async certificates(after?: string, mayAsk?: MayAsk): Promise<CertificatePage> {
    const url = after === undefined ? this.list : `${this.list}?after=${after}`;
    const { response, abort } = await this.call(url, { method: "GET" }, LIST_PAGE_UNITS, mayAsk);
    await this.pageRefused(response, abort);
    return readCertificatePage(await this.bodyOf(response, abort, LIST_PAGE_BODY_MAX_BYTES, RELAY_BODY_TIMEOUT_MS));
  }

  /** Throws for a page's answer that isn't a page (`page`, `certificates`): the off switch, a 429's holds, any other. */
  private async pageRefused(response: Response, abort: AbortController): Promise<void> {
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
      throw new RelayDown("the relay answered 429", 429);
    }
    if (!response.ok) {
      drop(response);
      throw new RelayDown(`the relay answered ${response.status}`, response.status);
    }
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
        if (typeof expires !== "number" || !Number.isFinite(expires)) throw new RelayUnknown("the relay's answer doesn't read", 200);
        return { kind: "kept", expires: expires * 1000, fresh: read?.kept === "new" };
      }
      case 402: {
        const bits = (await answer())?.price;
        if (typeof bits !== "number" || !Number.isInteger(bits) || bits < 0) throw new RelayUnknown("the relay's price doesn't read", 402);
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
        // The relay's own words, whichever (its window, its floor's "too many posts to this pool for now", a size's
        // price): that size waits as long as it says, never read as an answer this version doesn't know.
        return { kind: "wait", scope: "size", retryAfterMs: wait };
      }
      case 503:
        // A bound of the server's ("busy", 30 s), the pool full (600 s to an hour), its traffic allowance: every post.
        drop(response);
        return { kind: "wait", scope: "network", retryAfterMs: retryAfterMs(response, POST_WAIT_S) };
      case 408:
        // The server gave up reading the body (a slow link, or one that broke off, relay2's item 2): that size waits a
        // minute, whatever the answer says (the freeze's fix C). Never a strike against the envelope.
        drop(response);
        return { kind: "wait", scope: "size", retryAfterMs: SLOW_BODY_WAIT_MS };
      case 400:
      case 413:
        drop(response);
        return { kind: "refused", status: response.status };
      case 410:
        drop(response);
        throw new RelayStopped("the relay's Messages are stopped");
      default:
        drop(response);
        // A proxy's 502 or 504, or a 500: the relay wasn't reached, which is no answer (fix C). Any other status is one
        // this version doesn't know.
        if (response.status >= 500 && response.status <= 599) throw new RelayDown(`the relay answered ${response.status}`, response.status);
        throw new RelayUnknown(`the relay answered ${response.status}`, response.status);
    }
  }
  /**
   * Posts `body`, a nonce and a certificate (§21.7), to the pool's list. Throws RelayDown when the relay didn't answer: a
   * RelayStopped for its off switch, a RelayUnknown for an answer this version doesn't know. A certificate is priced and
   * counted as a 512-byte envelope from the same address, so its waits are a post's.
   */
  async postCertificate(body: Uint8Array, mayAsk?: MayAsk): Promise<CertificateAnswer> {
    const { response, abort } = await this.call(
      this.list,
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
        const kept = read?.kept;
        if (kept !== "new" && kept !== "already") throw new RelayUnknown("the relay's answer doesn't read", 200);
        // The held certificate's listing digest (F10): one that isn't 32 bytes of hex is none.
        const digest = typeof read?.digest === "string" && /^[0-9a-f]{64}$/.test(read.digest) ? read.digest : undefined;
        return { kind: "kept", fresh: kept === "new", ...(digest ? { digest } : {}) };
      }
      case 402: {
        const bits = (await answer())?.price;
        if (typeof bits !== "number" || !Number.isInteger(bits) || bits < 0) throw new RelayUnknown("the relay's price doesn't read", 402);
        return response.headers.get("retry-after") === null
          ? { kind: "price", bits }
          : { kind: "price", bits, retryAfterMs: retryAfterMs(response, POST_WAIT_S) };
      }
      case 409: {
        // Two certificates held for its Seedelf already, its register not the Seedelf's now, these very bytes withdrawn
        // (check 3′), or its Seedelf withdrawn too often at that register (check 3″): never as it is.
        const error = (await answer().catch(() => undefined))?.error;
        const conflict =
          error === TWO_HELD ? "two" : error === NOT_NOW ? "moved" : error === WITHDRAWN ? "withdrawn" : error === TOO_OFTEN ? "tooOften" : undefined;
        return conflict ? { kind: "refused", status: 409, conflict } : { kind: "refused", status: 409 };
      }
      case 429: {
        const wait = retryAfterMs(response, POST_WAIT_S);
        const error = (await answer().catch(() => undefined))?.error;
        if (error === EDGE_BUSY) {
          this.limit.hold(BUSY_WAIT_MS);
          return { kind: "wait", scope: "network", retryAfterMs: BUSY_WAIT_MS };
        }
        if (error === EDGE_SLOW_DOWN) {
          this.limit.hold(wait);
          return { kind: "wait", scope: "network", retryAfterMs: wait };
        }
        // The relay's own words (its window for this address): as a 512-byte envelope's post would wait.
        return { kind: "wait", scope: "size", retryAfterMs: wait };
      }
      case 503:
        // The list full, or one of the server's bounds: every certificate post waits.
        drop(response);
        return { kind: "wait", scope: "network", retryAfterMs: retryAfterMs(response, POST_WAIT_S) };
      case 408:
        drop(response);
        return { kind: "wait", scope: "size", retryAfterMs: SLOW_BODY_WAIT_MS };
      case 400:
      case 413:
        drop(response);
        return { kind: "refused", status: response.status };
      case 410:
        drop(response);
        throw new RelayStopped("the relay's Messages are stopped");
      default:
        drop(response);
        if (response.status >= 500 && response.status <= 599) throw new RelayDown(`the relay answered ${response.status}`, response.status);
        throw new RelayUnknown(`the relay answered ${response.status}`, response.status);
    }
  }
  /**
   * Posts `body`, a nonce and a withdrawal (§21.7), 106 bytes: one of the wallet's own certificates taken off the
   * pool's list. Throws RelayDown when the relay didn't answer: a RelayStopped for its off switch, a RelayUnknown for an
   * answer this version doesn't know. Priced and counted as a certificate's post.
   */
  async postWithdrawal(body: Uint8Array, mayAsk?: MayAsk): Promise<WithdrawalAnswer> {
    const { response, abort } = await this.call(
      this.withdrawals,
      { method: "POST", headers: { "content-type": "application/octet-stream" }, body: body as BodyInit },
      POST_UNITS,
      mayAsk,
    );
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
        if ((await answer())?.withdrawn !== true) throw new RelayUnknown("the relay's answer doesn't read", 200);
        return { kind: "withdrawn" };
      }
      case 404: {
        // No such certificate: the list holds none under its digest, as a removal there already says. Only in those
        // words (X-L6): a 404 of a route this relay doesn't have, or of a proxy's, says nothing of the certificate.
        const error = (await answer().catch(() => undefined))?.error;
        return error === NO_SUCH_CERTIFICATE ? { kind: "gone" } : { kind: "refused", status: 404 };
      }
      case 402: {
        const bits = (await answer())?.price;
        if (typeof bits !== "number" || !Number.isInteger(bits) || bits < 0) throw new RelayUnknown("the relay's price doesn't read", 402);
        return response.headers.get("retry-after") === null
          ? { kind: "price", bits }
          : { kind: "price", bits, retryAfterMs: retryAfterMs(response, POST_WAIT_S) };
      }
      case 429: {
        const wait = retryAfterMs(response, POST_WAIT_S);
        const error = (await answer().catch(() => undefined))?.error;
        if (error === EDGE_BUSY) {
          this.limit.hold(BUSY_WAIT_MS);
          return { kind: "wait", scope: "network", retryAfterMs: BUSY_WAIT_MS };
        }
        if (error === EDGE_SLOW_DOWN) {
          this.limit.hold(wait);
          return { kind: "wait", scope: "network", retryAfterMs: wait };
        }
        return { kind: "wait", scope: "size", retryAfterMs: wait };
      }
      case 503:
        drop(response);
        return { kind: "wait", scope: "network", retryAfterMs: retryAfterMs(response, POST_WAIT_S) };
      case 408:
        drop(response);
        return { kind: "wait", scope: "size", retryAfterMs: SLOW_BODY_WAIT_MS };
      case 400:
      case 413:
        drop(response);
        return { kind: "refused", status: response.status };
      case 410:
        drop(response);
        throw new RelayStopped("the relay's Messages are stopped");
      default:
        drop(response);
        if (response.status >= 500 && response.status <= 599) throw new RelayDown(`the relay answered ${response.status}`, response.status);
        throw new RelayUnknown(`the relay answered ${response.status}`, response.status);
    }
  }
}
