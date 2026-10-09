// Private watches on the private index's feed (chunk 26b, Step 6). A watch
// asked tx_status about the one transaction it waited for, every 15 s, and so
// told the server which transaction this wallet had just sent. A transaction
// that spends or pays the contract or Lovejoin's pool shows in the private
// index's feed instead: `since` a cursor from before it went out lists every
// row made and spent after it, everyone's, with the transaction that did
// each. That answer is the same for every wallet that holds the cursor, and
// kept for a block, so the server learns only that someone is watching.
//
// What touches only key addresses (account sends, staking and DRep
// transactions, collateral, swap legs, a session's funding, a public mix's
// deposit) still asks tx_status, on the public side. So does a private one
// while the private part is down, or with no cursor old enough kept: as
// before.
//
// The cursors the index hands out are kept here, in chrome.storage.session
// (wiped on lock), one every few minutes for six hours: a watch reads from
// the newest one from before its transaction went out.

import { NETWORKS, type NetworkName } from "../networks";
import { CONTRACT_V1 } from "./balances";
import type { Koios } from "./koios";
import { builtOutputs } from "./minswap";
import { IndexDown, type IndexSince, type PrivateIndex } from "./private-index";
import type { Area } from "./storage";

/** The two feeds: the Seedelf contract's, and Lovejoin's pool's. */
export type Feed = "contract" | "lovejoin";

/** chrome.storage.session, per network: the cursors the private index handed out lately, by feed (`seedelf.feed.mainnet`). */
export const SESSION_FEED_PREFIX = "seedelf.feed.";

/** A cursor kept: as the index wrote it, and when its slot was (ms). */
interface KeptCursor {
  cursor: string;
  at: number;
}

type Kept = Partial<Record<Feed, KeptCursor[]>>;

/** Kept cursors are this far apart at least: a newer one inside it replaces the newest. */
export const CURSOR_SPACING_MS = 5 * 60_000;
/** And kept this long: longer than a watch waits for anything (pending.ts HELD_IN_MEMPOOL_MS). */
export const CURSORS_FOR_MS = 6 * 60 * 60_000;
/**
 * How long before a transaction's own send time its cursor is: one maybe
 * sent went out at its first try, which the watch may date later.
 */
const SENT_MARGIN_MS = 10 * 60_000;

/** Shelley on, a slot's time is the slot plus this (mainnet; seedelf-data's `slot_time`). */
const SLOT_TIME_S: Partial<Record<NetworkName, number>> = { mainnet: 1_591_566_291, preprod: 1_655_769_600 };

/** When `cursor`'s slot was (ms), on `network`. */
export function cursorTime(network: NetworkName, cursor: string): number {
  return (Number(cursor.slice(0, cursor.indexOf("."))) + (SLOT_TIME_S[network] ?? 0)) * 1000;
}

/**
 * Keeps a cursor the private index handed out for `feed`, in slot order, one
 * every CURSOR_SPACING_MS (the newest always), for CURSORS_FOR_MS. An older
 * one is kept too: the sealed record's from before a lock (contract-scan.ts),
 * which a watch from before the lock reads from. Call it while unlocked.
 */
export async function noteCursor(session: Area, network: NetworkName, feed: Feed, cursor: string, now: number): Promise<void> {
  const key = SESSION_FEED_PREFIX + network;
  const kept = (await session.get<Kept>(key)) ?? {};
  const all = [...(kept[feed] ?? []).filter((c) => c.cursor !== cursor), { cursor, at: cursorTime(network, cursor) }]
    .filter((c) => now - c.at < CURSORS_FOR_MS)
    .sort((a, b) => a.at - b.at);
  const list: KeptCursor[] = [];
  for (const [i, c] of all.entries()) {
    const last = list.at(-1);
    if (!last || c.at - last.at >= CURSOR_SPACING_MS || i === all.length - 1) list.push(c);
  }
  await session.set(key, { ...kept, [feed]: list });
}

/**
 * The newest cursor of `feed` from before `since` (ms): every transaction
 * sent after it shows in the feed since it. With no `since`, the oldest kept.
 */
async function cursorBefore(session: Area, network: NetworkName, feed: Feed, since?: number): Promise<string | undefined> {
  const list = (await session.get<Kept>(SESSION_FEED_PREFIX + network))?.[feed] ?? [];
  return since === undefined ? list[0]?.cursor : list.filter((c) => c.at < since).at(-1)?.cursor;
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
   * Lovejoin box. None: it touches only key addresses, and tx_status is asked.
   */
  feed?: Feed;
  /** When it went out; the oldest cursor kept stands in when it isn't known. */
  sentAt?: number;
}

export interface FeedDeps {
  session: Area;
  koios: (network: NetworkName) => Koios;
  index?: (network: NetworkName) => Promise<PrivateIndex | undefined>;
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
 * the newest cursor from before the oldest of them went out, and the rest
 * from tx_status. So are those on a feed while it can't answer (no index, its
 * part down, no cursor old enough kept, a rollback under the cursor). One a
 * feed shows is on chain with 1 confirmation: no watch reads more than
 * whether it's there.
 */
export async function chainStatus(deps: FeedDeps, network: NetworkName, txs: Watching[]): Promise<ChainStatus> {
  const statuses = new Map<string, number | null>();
  const ask = new Set(txs.filter((t) => !t.feed).map((t) => t.txHash));
  let tip: number | undefined;
  let fed = true;
  const index = txs.some((t) => t.feed) ? await deps.index?.(network) : undefined;
  for (const feed of ["contract", "lovejoin"] as const) {
    const on = txs.filter((t) => t.feed === feed);
    if (!on.length) continue;
    const read = index && (await fromFeed(deps.session, index, network, feed, on));
    if (!read) {
      fed = false;
      for (const t of on) ask.add(t.txHash);
      continue;
    }
    tip = Math.max(tip ?? 0, read.tip);
    for (const t of on) statuses.set(t.txHash, read.seen.has(t.txHash) ? 1 : null);
  }
  if (ask.size) for (const [h, n] of await deps.koios(network).txStatus([...ask])) statuses.set(h, n);
  return { statuses, fed, ...(tip !== undefined ? { tip } : {}) };
}

/** What `feed` shows of `txs`, since a cursor from before they went out; undefined when it can't say. */
async function fromFeed(
  session: Area,
  index: PrivateIndex,
  network: NetworkName,
  feed: Feed,
  txs: Watching[],
): Promise<{ seen: Set<string>; tip: number } | undefined> {
  const sent = txs.map((t) => t.sentAt);
  const since = sent.every((at) => at !== undefined) ? Math.min(...(sent as number[])) - SENT_MARGIN_MS : undefined;
  const cursor = await cursorBefore(session, network, feed, since);
  if (!cursor) return undefined;
  try {
    const answer = await (feed === "contract" ? index.since(cursor) : index.poolSince(cursor));
    // Rolled back under a kept cursor: tx_status this once; the next read keeps newer ones.
    if (answer.reset) return undefined;
    return { seen: seenIn(answer), tip: answer.tip.slot };
  } catch (e) {
    if (e instanceof IndexDown) return undefined;
    throw e;
  }
}
