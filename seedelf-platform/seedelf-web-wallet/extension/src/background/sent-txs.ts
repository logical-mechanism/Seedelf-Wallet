// The transactions this wallet sent in the last few minutes, whole. Until
// one is on chain, Koios can't say what its outputs hold, yet a site may
// already build on them: a public Send's change, a private session's funding
// or its top-up. The dApp connector (dapp.ts) reads a site's transaction
// that spends one of them from these, where it would otherwise refuse to
// sign over a UTxO it can't find. Kept beside what they spent (spent.ts),
// in chrome.storage.session, so a lock wipes them.
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
/** At most this many are kept, the newest. */
const KEEP = 16;
/** Nothing larger goes on chain (the ledger's `max_tx_size`). */
const MAX_TX_BYTES = 16_384;

export interface SentTx {
  txHash: string;
  txCbor: string;
  /** When it was sent (ms since the epoch). */
  sentAt: number;
}

/**
 * Keeps a transaction about to be sent on `network`, for a while. Call it
 * while unlocked. One it can't read, or larger than any on chain, isn't kept.
 */
export async function rememberSent(session: Area, network: NetworkName, tx: Uint8Array, now = Date.now()): Promise<void> {
  if (tx.length > MAX_TX_BYTES) return;
  let txHash: string;
  try {
    txHash = txId(tx);
  } catch {
    return;
  }
  const txCbor = Array.from(tx, (b) => b.toString(16).padStart(2, "0")).join("");
  const kept = (await recentlySent(session, network, now)).filter((s) => s.txHash !== txHash);
  await session.set(SESSION_SENT_PREFIX + network, [...kept, { txHash, txCbor, sentAt: now }].slice(-KEEP));
}

/** The transactions sent on `network` in the last 20 minutes, oldest first. Call it while unlocked. */
export async function recentlySent(session: Area, network: NetworkName, now = Date.now()): Promise<SentTx[]> {
  return ((await session.get<SentTx[]>(SESSION_SENT_PREFIX + network)) ?? []).filter((s) => now - s.sentAt < SENT_KEEP_MS);
}
