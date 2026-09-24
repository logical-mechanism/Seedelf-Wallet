// The user's settings, in chrome.storage.local: none of them says anything
// about the user's money, so they aren't sealed. Removing the wallet deletes
// them, and a new wallet starts from the defaults.
//
// spendRewards  Staking rewards are withdrawn whenever the Cardano account
//               pays (a send, a move-in, an account-paid mint), as other
//               wallets do. Off, they wait for a withdrawal from the
//               Staking page.

import type { Preferences } from "../shared/rpc";
import type { Area } from "./storage";

/** chrome.storage.local: the user's settings. */
export const LOCAL_PREFERENCES = "seedelf.preferences";

const DEFAULTS: Preferences = { spendRewards: true };

export class PreferencesService {
  constructor(private readonly local: Area) {}

  async get(): Promise<Preferences> {
    const kept = await this.local.get<Partial<Preferences>>(LOCAL_PREFERENCES);
    return { ...DEFAULTS, ...kept };
  }

  /** Changes the settings given; anything that isn't one is ignored. */
  async set(change: Partial<Preferences>): Promise<Preferences> {
    const next = { ...(await this.get()) };
    if (typeof change.spendRewards === "boolean") next.spendRewards = change.spendRewards;
    await this.local.set(LOCAL_PREFERENCES, next);
    return next;
  }
}
