// The transactions this wallet sent in the last few minutes, whole. Until
// one is on chain, Koios can't say what its outputs hold, yet a site may
// already build on them: a public Send's change, a private session's funding
// or its top-up. The dApp connector (dapp.ts) reads a site's transaction
// that spends one of them from these, where it would otherwise refuse to
// sign over a UTxO it can't find. Kept beside what they spent (spent.ts),
// in chrome.storage.session, so a lock wipes them.
//
// A site is answered from here only with the outputs that pay its own
// account (the public account, or its private session). The rest, another
// account's or the private balance's, are looked for as a stranger's are:
// otherwise how the site is answered would tell it which transactions are
// the wallet's (privacy review §2.2). A site's own submits are kept for it
// with what it signed (dapp.ts's `SESSION_DAPP_SIGNED`).
//
// The balance counts what they pay back to it, and what they withdraw, for
// as long as what they spend is held back (spent.ts, two hours), not only
// the 20 minutes a site is answered from them: a payment still waiting at
// 21 minutes had its coin out of the balance and its change, and the rewards
// it took, counted nowhere, or the rewards counted again (blind test §9.1,
// the fix round's review). The wallet's own Sends are kept apart from what
// a chain sends (a Lovejoin chain, a session's steps), each under its own
// cap, so a chain's many steps never push out a payment on its way.
//
// Each network's are kept apart, and read only on it. The account's keys are
// the same on both, and a signature binds nothing to a network: a site on
// preprod that found a mainnet Send's change here would get the account's
// payment key to sign over real ADA, under the preprod prompt. What was kept
// under the one key for both networks, before, is never read.

import type { NetworkName } from "../networks";
import { txId } from "./cbor";
import type { Area } from "./storage";

/** chrome.storage.session, per network: the transactions this wallet sent there in the last few minutes. */
export const SESSION_SENT_PREFIX = "seedelf.sent.";

/** How long a sent transaction's outputs are read from it: past a block, and a Koios backend that's behind (spent.ts). */
export const SENT_KEEP_MS = 20 * 60_000;
/** How long one counts in the balance while what it spends is held back (spent.ts SPENT_KEEP_MS). */
export const SENT_HELD_MS = 2 * 60 * 60_000;
/** At most this many are kept of the wallet's own Sends, and as many of the rest, the newest. */
const KEEP = 16;
/** Nothing larger goes on chain (the ledger's `max_tx_size`). */
const MAX_TX_BYTES = 16_384;

export interface SentTx {
  txHash: string;
  txCbor: string;
  /** When it was sent (ms since the epoch). */
  sentAt: number;
  /**
   * The public account active when Send sent it (pending.ts `writeAhead`): one of that account's own flows, and no
   * other account's. None for what a chain sends.
   */
  account?: number;
}

/**
 * Keeps a transaction about to be sent on `network`, for a while: with the
 * public account Send sent it from (`account`), kept from before when it's
 * sent again. Call it while unlocked. One it can't read, or larger than any
 * on chain, isn't kept.
 */
export async function rememberSent(
  session: Area,
  network: NetworkName,
  tx: Uint8Array,
  now = Date.now(),
  account?: number,
): Promise<void> {
  if (tx.length > MAX_TX_BYTES) return;
  let txHash: string;
  try {
    txHash = txId(tx);
  } catch {
    return;
  }
  const txCbor = Array.from(tx, (b) => b.toString(16).padStart(2, "0")).join("");
  const held = await heldSent(session, network, now);
  const by = account ?? held.find((s) => s.txHash === txHash)?.account;
  const next = [...held.filter((s) => s.txHash !== txHash), { txHash, txCbor, sentAt: now, ...(by !== undefined ? { account: by } : {}) }];
  // Each under its own cap: a chain's steps never push out a payment of the wallet's on its way.
  const own = new Set(next.filter((s) => s.account !== undefined).slice(-KEEP));
  const chains = new Set(next.filter((s) => s.account === undefined).slice(-KEEP));
  await session.set(SESSION_SENT_PREFIX + network, next.filter((s) => own.has(s) || chains.has(s)));
}

/** Forgets `txHash`, kept as it was about to be sent, and refused: it never went out (pending.ts). Call it while unlocked. */
export async function forgetSent(session: Area, network: NetworkName, txHash: string): Promise<void> {
  const kept = (await session.get<SentTx[]>(SESSION_SENT_PREFIX + network)) ?? [];
  if (kept.some((s) => s.txHash === txHash)) await session.set(SESSION_SENT_PREFIX + network, kept.filter((s) => s.txHash !== txHash));
}

/** The transactions sent on `network` in the last 20 minutes, oldest first: what a site is answered from. Call it while unlocked. */
export async function recentlySent(session: Area, network: NetworkName, now = Date.now()): Promise<SentTx[]> {
  return ((await session.get<SentTx[]>(SESSION_SENT_PREFIX + network)) ?? []).filter((s) => now - s.sentAt < SENT_KEEP_MS);
}

/**
 * The transactions sent on `network` in the last two hours, oldest first: what the balance counts while what they
 * spend is held back (incoming.ts). Call it while unlocked.
 */
export async function heldSent(session: Area, network: NetworkName, now = Date.now()): Promise<SentTx[]> {
  return ((await session.get<SentTx[]>(SESSION_SENT_PREFIX + network)) ?? []).filter((s) => now - s.sentAt < SENT_HELD_MS);
}

/**
 * Whether `txHash` is among those kept for `network`, however long ago it was sent: one is only pruned when another
 * is sent. Send asks it of a review it has no transaction kept for (pending.ts `sentBefore`). Call it while unlocked.
 */
export async function keptAsSent(session: Area, network: NetworkName, txHash: string): Promise<boolean> {
  return ((await session.get<SentTx[]>(SESSION_SENT_PREFIX + network)) ?? []).some((s) => s.txHash === txHash);
}
