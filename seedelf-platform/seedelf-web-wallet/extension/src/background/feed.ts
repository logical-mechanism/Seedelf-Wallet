// Private watches on the private index's feed (chunk 26b, Step 6). A watch
// asked tx_status about the one transaction it waited for, every 15 s, and so
// told the server which transaction this wallet had just sent. A transaction
// that spends or pays the contract or Lovejoin's pool shows in the private
// index's feed instead: `since` a cursor from before it went out lists every
// row made and spent after it, everyone's, with the transaction that did
// each. That answer is the same for every wallet that holds the cursor, and
// kept for a block, so the server learns only that someone is watching.
// Lovejoin's token pools have a feed of their own (`lovejoin/tokens/since`,
// chunk 34): the classic pool's lists none of their boxes, so a chain step in
// a token pool is looked for there, never named to tx_status while it can
// say (1.6.0's release review, DATA-1).
//
// What touches only key addresses (account sends, staking and DRep
// transactions, collateral, swap legs, a session's funding, a public mix's
// deposit) still asks tx_status, on the public side. So does a private one
// while the private part is down, or with no cursor old enough kept: as
// before.
//
// The cursors the index hands out are kept here, in chrome.storage.session
// (wiped on lock), one every few minutes for six hours, with the sealed
// record's from before a lock (contract-scan.ts): a watch reads from the
// newest one the wallet had before its transaction was first tried. A cursor
// is a stable point, at least 200 slots behind the tip it was handed out at,
// so one in hand before the first try is before anything the send put on
// chain. Both times are this device's clock's, so its error cancels; each
// watch keeps its first try apart from its own resend timing.

import { NETWORKS, type NetworkName } from "../networks";
import { CONTRACT_V1 } from "./balances";
import type { Koios } from "./koios";
import { builtOutputs } from "./minswap";
import { CursorRefused, IndexDown, type IndexSince, type PrivateIndex } from "./private-index";
import type { PrivateStore, RecordName } from "./private-store";
import type { Area } from "./storage";

/**
 * The feeds: the Seedelf contract's, Lovejoin's classic pool's, and every
 * shown token pool's (`lovejoin/tokens/since`), which the classic pool's
 * never lists (chunk 34; 1.6.0's release review, DATA-1).
 */
export type Feed = "contract" | "lovejoin" | "tokens";

/** Every feed, in the order a watch reads them. */
const FEEDS: readonly Feed[] = ["contract", "lovejoin", "tokens"];

/** chrome.storage.session, per network: the cursors the private index handed out lately, by feed (`seedelf.feed.mainnet`). */
export const SESSION_FEED_PREFIX = "seedelf.feed.";

/** A cursor kept: as the index wrote it, and when the wallet had it, by this device's clock (ms). */
export interface KeptCursor {
  cursor: string;
  got: number;
}

type Kept = Partial<Record<Feed, KeptCursor[]>>;

/** Kept cursors are this far apart at least: a newer one inside it replaces the newest. */
export const CURSOR_SPACING_MS = 5 * 60_000;
/** And kept this long: longer than a watch waits for anything (pending.ts HELD_IN_MEMPOOL_MS). */
export const CURSORS_FOR_MS = 6 * 60 * 60_000;

/** The notes, one after another: both feeds' share one key, and a note read beside another's write would lose it. */
let noting: Promise<unknown> = Promise.resolve();

/**
 * Keeps a cursor the private index handed out for `feed`, and when the wallet
 * had it (`got`), in that order, one every CURSOR_SPACING_MS (the newest
 * always), for CURSORS_FOR_MS. Call it while unlocked. A write session storage
 * refuses (its quota full) never fails the reading that noted it: a watch with
 * no cursor in hand asks `tx_status` instead (the release review).
 */
export function noteCursor(
  session: Area,
  network: NetworkName,
  feed: Feed,
  cursor: string,
  got: number,
  now = got,
): Promise<void> {
  const note = async () => {
    const key = SESSION_FEED_PREFIX + network;
    const kept = (await session.get<Kept>(key)) ?? {};
    const was = (kept[feed] ?? []).find((c) => c.cursor === cursor);
    const all = [...(kept[feed] ?? []).filter((c) => c.cursor !== cursor), { cursor, got: Math.min(got, was?.got ?? got) }]
      .filter((c) => typeof c.got === "number" && now - c.got < CURSORS_FOR_MS)
      .sort((a, b) => a.got - b.got);
    const list: KeptCursor[] = [];
    for (const [i, c] of all.entries()) {
      const last = list.at(-1);
      if (!last || c.got - last.got >= CURSOR_SPACING_MS || i === all.length - 1) list.push(c);
    }
    await session.set(key, { ...kept, [feed]: list });
  };
  return inTurn(note).catch(() => undefined);
}

/** Forgets a kept cursor the index refuses now (CursorRefused): every watch asking from it would be refused too. */
function forgetCursor(session: Area, network: NetworkName, feed: Feed, cursor: string): Promise<void> {
  return inTurn(async () => {
    const key = SESSION_FEED_PREFIX + network;
    const kept = await session.get<Kept>(key);
    const list = kept?.[feed];
    if (list?.some((c) => c.cursor === cursor)) await session.set(key, { ...kept, [feed]: list.filter((c) => c.cursor !== cursor) });
  });
}

function inTurn(task: () => Promise<void>): Promise<void> {
  const run = noting.then(task, task);
  noting = run.catch(() => undefined);
  return run;
}

/**
 * The cursors of `feed` in hand, oldest first: those kept this session, and
 * for the contract's, the sealed record's (contract-scan.ts), which a lock
 * keeps: a watch from before the lock reads from it, read before the unlock's
 * first reading notes it again.
 */
async function cursorsOf(deps: FeedDeps, network: NetworkName, feed: Feed): Promise<KeptCursor[]> {
  const list = [...((await deps.session.get<Kept>(SESSION_FEED_PREFIX + network))?.[feed] ?? [])];
  if (feed === "contract" && deps.store) {
    const sealed = await deps.store.get<Partial<KeptCursor>>(`contract.${network}` as RecordName).catch(() => undefined);
    const { cursor, got } = sealed ?? {};
    if (typeof cursor === "string" && typeof got === "number" && !list.some((c) => c.cursor === cursor)) list.push({ cursor, got });
  }
  return list.filter((c) => typeof c.got === "number").sort((a, b) => a.got - b.got);
}

/**
 * Which of `txs` one read of a feed answers, and from which cursor: the
 * newest in hand before the earliest of them went out. One sent before every
 * cursor in hand isn't among them, and asks tx_status alone, never holding
 * up the rest. One with no send time takes the oldest cursor, as a watch
 * that doesn't know it always has.
 */
export function cover(cursors: KeptCursor[], txs: Watching[]): { cursor?: string; covered: Watching[] } {
  const oldest = cursors[0];
  if (!oldest) return { covered: [] };
  const covered = txs.filter((t) => t.sentAt === undefined || t.sentAt >= oldest.got);
  if (!covered.length) return { covered };
  const first = Math.min(...covered.map((t) => t.sentAt ?? oldest.got));
  return { cursor: cursors.filter((c) => c.got <= first).at(-1)!.cursor, covered };
}

/** What a `since` answer says each transaction did: made or spent a row. */
function seenIn(since: Extract<IndexSince, { reset?: undefined }>): Set<string> {
  const seen = new Set<string>();
  for (const r of since.created) {
    seen.add(r.ref.slice(0, r.ref.lastIndexOf("#")));
    if (r.spent) seen.add(r.spent.by);
  }
  for (const s of since.spent) seen.add(s.by);
  return seen;
}

/**
 * The feed a signed transaction shows in by what it pays: the contract's
 * for one that pays a Seedelf (a move-in, an account-paid mint, a send to a
 * Seedelf), the pool's for one that pays a Lovejoin box; none for one that
 * pays only key addresses, or that can't be read. What it spends isn't in
 * its bytes: a Seedelf spend's watch says so itself (pending.ts `contract`).
 */
export function feedOfTx(tx: Uint8Array, network: NetworkName): Feed | undefined {
  let paid: string[];
  try {
    // An address's payment credential is its 28 bytes after the header.
    paid = builtOutputs(tx).map((o) => o.address.slice(2, 58));
  } catch {
    return undefined;
  }
  if (paid.includes(CONTRACT_V1.walletContractHash)) return "contract";
  const mixBox = NETWORKS[network].lovejoin?.mixBox;
  return mixBox && paid.includes(mixBox) ? "lovejoin" : undefined;
}

/** A transaction a watch waits for: its hash, the feed it surely shows in, and when it went out (ms). */
export interface Watching {
  txHash: string;
  /**
   * The feed it shows in once it's on chain: the contract's for one that
   * spends or pays a Seedelf, the pool's for one that spends or pays a
   * Lovejoin box, the token pools' for one in a token pool alone. None, and
   * no `pools`: it touches only key addresses, and tx_status is asked.
   */
  feed?: Feed;
  /**
   * The token pools it may spend or pay a box of, by their `mix_box` hashes:
   * it's looked for on the token pools' feed too (a chain across pools, on
   * the classic pool's as well), and seen on either, it's on chain. That feed
   * says it isn't only while its answer covers every one of them: a pool
   * shown after the cursor isn't, and tx_status is asked instead (1.6.0's
   * release review, DATA-1).
   */
  pools?: string[];
  /**
   * When it was first tried, stamped before its submit and never moved by a
   * retry or a resend; the oldest cursor kept stands in when it isn't known.
   */
  sentAt?: number;
}

export interface FeedDeps {
  session: Area;
  koios: (network: NetworkName) => Koios;
  index?: (network: NetworkName) => Promise<PrivateIndex | undefined>;
  /** Where the contract's sealed record is, with its cursor from before a lock. */
  store?: PrivateStore;
}

/** Which are on chain, as tx_status says it (a number, or null), and the chain's tip slot when a feed gave it. */
export interface ChainStatus {
  statuses: Map<string, number | null>;
  /** The feed's tip: the slot an expiry is checked against, with no request of its own. */
  tip?: number;
  /** Every one on a feed was answered from it. */
  fed: boolean;
}

/**
 * Whether each of `txs` is on chain: those on a feed from that feed, since
 * the newest cursor in hand before the oldest of them went out, and the rest
 * from tx_status. So are those on a feed while it can't answer (no index, its
 * part down, no cursor from before it went out, a rollback under the cursor).
 * One a feed shows is on chain with 1 confirmation: no watch reads more than
 * whether it's there. Never call it inside `wallet.withKeys`: it reads the
 * sealed record, which waits its turn there.
 */
export async function chainStatus(deps: FeedDeps, network: NetworkName, txs: Watching[]): Promise<ChainStatus> {
  const statuses = new Map<string, number | null>();
  let tip: number | undefined;
  // What a feed showed on chain, and what one of its feeds couldn't say of: one seen on any is on chain.
  const seen = new Set<string>();
  const unsaid = new Set<string>();
  const index = txs.some((t) => feedsOf(t).length) ? await deps.index?.(network) : undefined;
  for (const feed of FEEDS) {
    const on = txs.filter((t) => feedsOf(t).includes(feed));
    if (!on.length) continue;
    const { cursor, covered } = index ? cover(await cursorsOf(deps, network, feed), on) : { covered: [] };
    const read = index && cursor && (await fromFeed(deps.session, network, index, feed, cursor));
    if (read) tip = Math.max(tip ?? 0, read.tip);
    for (const t of on) {
      if (read && covered.includes(t) && read.seen.has(t.txHash)) seen.add(t.txHash);
      // The token pools' feed says one isn't there only for one whose every pool it covers (DATA-1).
      else if (!read || !covered.includes(t) || (read.pools && !(t.pools?.length && t.pools.every((p) => read.pools!.has(p))))) {
        unsaid.add(t.txHash);
      }
    }
  }
  // Seen on a feed: on chain. Not, where each of its feeds could say: not yet. Otherwise tx_status, as with no feed.
  const ask = txs.filter((t) => !seen.has(t.txHash) && (!feedsOf(t).length || unsaid.has(t.txHash))).map((t) => t.txHash);
  const fed = !txs.some((t) => feedsOf(t).length && ask.includes(t.txHash));
  for (const t of txs) if (!ask.includes(t.txHash)) statuses.set(t.txHash, seen.has(t.txHash) ? 1 : null);
  if (ask.length) for (const [h, n] of await deps.koios(network).txStatus([...new Set(ask)])) statuses.set(h, n);
  return { statuses, fed, ...(tip !== undefined ? { tip } : {}) };
}

/** The feeds `t` shows in: its `feed`, and the token pools' with any `pools`. */
function feedsOf(t: Watching): Feed[] {
  const feeds = t.feed ? [t.feed] : [];
  return t.pools?.length && t.feed !== "tokens" ? [...feeds, "tokens"] : feeds;
}

/** What `feed` shows since `cursor`, and for the token pools', the pools it covers; undefined when it can't say. */
async function fromFeed(
  session: Area,
  network: NetworkName,
  index: PrivateIndex,
  feed: Feed,
  cursor: string,
): Promise<{ seen: Set<string>; tip: number; pools?: Set<string> } | undefined> {
  try {
    // A kept cursor the index refuses now is IndexDown too (CursorRefused), leaving the part up; the token
    // pools' routes failing are TokensDown, which leaves it up too.
    const kept = { kept: true };
    if (feed === "tokens") {
      const answer = await index.tokensSince(cursor, kept);
      // Rolled back under a kept cursor: tx_status this once; the next read keeps newer ones.
      if (answer.reset) return undefined;
      return { seen: seenIn(answer), tip: answer.tip.slot, pools: new Set(answer.pools) };
    }
    const answer = await (feed === "contract" ? index.since(cursor, kept) : index.poolSince(cursor, kept));
    if (answer.reset) return undefined;
    return { seen: seenIn(answer), tip: answer.tip.slot };
  } catch (e) {
    // Refused: no watch reads from it again. The sealed record's own is replaced at the next reading (contract-scan.ts).
    if (e instanceof CursorRefused) await forgetCursor(session, network, feed, cursor).catch(() => undefined);
    if (e instanceof IndexDown) return undefined;
    throw e;
  }
}
