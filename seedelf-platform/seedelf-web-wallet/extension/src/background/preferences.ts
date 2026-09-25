// The user's settings, in chrome.storage.local: none of them says anything
// about the user's money, so they aren't sealed. Removing the wallet deletes
// them, and a new wallet starts from the defaults.
//
// spendRewards      Staking rewards are withdrawn whenever the Cardano
//                   account pays (a send, a move-in, an account-paid mint),
//                   as other wallets do. Off, they wait for a withdrawal
//                   from the Staking page.
// hideBalances      Amounts are hidden where the wallet shows what it
//                   holds, as Eternl's eye does.
// lockAfterMinutes  Auto-lock, after this long without activity.
// currency          What ADA's value is shown in, on mainnet (prices.ts);
//                   "off" asks no one.
//
// Where the toolbar button opens the wallet isn't one of these: it's the
// browser's, not the wallet's (shared/open-in.ts).

import { DEFAULT_PREFERENCES, isCurrency, isLockAfter, LOCAL_PREFERENCES, type Preferences } from "../shared/preferences";
import type { Area } from "./storage";

export { LOCAL_PREFERENCES };

export class PreferencesService {
  constructor(private readonly local: Area) {}

  async get(): Promise<Preferences> {
    const kept = (await this.local.get<Partial<Preferences>>(LOCAL_PREFERENCES)) ?? {};
    return {
      spendRewards: typeof kept.spendRewards === "boolean" ? kept.spendRewards : DEFAULT_PREFERENCES.spendRewards,
      hideBalances: typeof kept.hideBalances === "boolean" ? kept.hideBalances : DEFAULT_PREFERENCES.hideBalances,
      lockAfterMinutes: isLockAfter(kept.lockAfterMinutes) ? kept.lockAfterMinutes : DEFAULT_PREFERENCES.lockAfterMinutes,
      currency: isCurrency(kept.currency) ? kept.currency : DEFAULT_PREFERENCES.currency,
    };
  }

  /** Changes the settings given; anything that isn't one, or isn't a value it may take, is ignored. */
  async set(change: Partial<Preferences>): Promise<Preferences> {
    const next = { ...(await this.get()) };
    if (typeof change.spendRewards === "boolean") next.spendRewards = change.spendRewards;
    if (typeof change.hideBalances === "boolean") next.hideBalances = change.hideBalances;
    if (isLockAfter(change.lockAfterMinutes)) next.lockAfterMinutes = change.lockAfterMinutes;
    if (isCurrency(change.currency)) next.currency = change.currency;
    await this.local.set(LOCAL_PREFERENCES, next);
    return next;
  }

  /** How long the wallet stays unlocked without activity. */
  async lockAfterMs(): Promise<number> {
    return (await this.get()).lockAfterMinutes * 60_000;
  }
}
