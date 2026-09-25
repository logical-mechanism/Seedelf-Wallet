// The user's settings, and what each may be. The worker keeps them
// (background/preferences.ts); the UI reads and changes them through it, and
// follows changes other pages make.

/** chrome.storage.local: the user's settings. */
export const LOCAL_PREFERENCES = "seedelf.preferences";

/** How long without activity before the wallet locks, in minutes: Lace's choices, less "never". */
export const LOCK_AFTER_MINUTES = [1, 5, 15, 30, 60] as const;
export type LockAfterMinutes = (typeof LOCK_AFTER_MINUTES)[number];

/** What ADA's value can be shown in (CoinGecko's `vs_currencies`), or "off" to ask no one. */
export const CURRENCIES = ["usd", "eur", "gbp", "jpy", "cad", "aud", "chf", "brl"] as const;
export type Currency = (typeof CURRENCIES)[number] | "off";

export interface Preferences {
  /** Spend staking rewards whenever the Cardano account pays (a send, a move-in, a mint). */
  spendRewards: boolean;
  /** Amounts are hidden on the screens that show what the wallet holds; the forms and reviews still show them. */
  hideBalances: boolean;
  /** Lock after this many minutes without activity. */
  lockAfterMinutes: LockAfterMinutes;
  /** What ADA's value is shown in, on mainnet. */
  currency: Currency;
  /**
   * The dApp connector (CIP-30), with the public account: off until the
   * user turns it on, which asks Chrome for access to sites first.
   */
  dappConnector: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  spendRewards: true,
  hideBalances: false,
  lockAfterMinutes: 15,
  currency: "usd",
  dappConnector: false,
};

export const isLockAfter = (value: unknown): value is LockAfterMinutes =>
  (LOCK_AFTER_MINUTES as readonly unknown[]).includes(value);

export const isCurrency = (value: unknown): value is Currency =>
  value === "off" || (CURRENCIES as readonly unknown[]).includes(value);
