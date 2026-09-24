// The one submitted transaction the wallet watches: a move-in or a seedelf
// mint. Home asks about it every 15 s; once the network confirms it, the
// cached balances are dropped so the next reading sees the new UTxOs. The
// watch stops after 10 minutes.

import type { NetworkName } from "../networks";
import type { PendingTx } from "../shared/rpc";
import type { Koios } from "./koios";
import type { Area } from "./storage";
import { SESSION_BALANCES_PREFIX, type Wallet } from "./wallet";

/** chrome.storage.session: the submitted transaction being watched. */
export const SESSION_PENDING = "seedelf.pendingTx";

/** Stop watching a submitted transaction after this long. */
const WATCH_MS = 10 * 60_000;

export interface PendingDeps {
  wallet: Wallet;
  session: Area;
  koios: (network: NetworkName) => Koios;
  now: () => number;
}

export class PendingService {
  constructor(private readonly deps: PendingDeps) {}

  /** The watched transaction with fresh confirmations, or null. Clears it once confirmed or stale. */
  async pending(): Promise<PendingTx | null> {
    const { wallet, session, now } = this.deps;
    const pending = await wallet.withKeys(() => session.get<PendingTx>(SESSION_PENDING));
    if (!pending) return null;
    const statuses = await this.deps.koios(pending.network).txStatus([pending.txHash]);
    const confirmations = statuses.get(pending.txHash) ?? null;
    const current: PendingTx = { ...pending, confirmations };
    if (confirmations !== null || now() - pending.submittedAt > WATCH_MS) {
      await wallet.withKeys(async () => {
        await session.remove(SESSION_PENDING);
        // The next balance reading should see the new UTxOs.
        if (confirmations !== null) await session.remove(SESSION_BALANCES_PREFIX + pending.network);
      });
    }
    return current;
  }
}
