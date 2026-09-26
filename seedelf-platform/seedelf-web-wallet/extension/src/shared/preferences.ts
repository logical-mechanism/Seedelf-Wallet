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

/** How deep a session's spare ADA fans out through Lovejoin: 4 mixes a box at 2 (about 3.5 ₳). */
export const LOVEJOIN_DEPTHS = [1, 2, 3] as const;
export type LovejoinDepth = (typeof LOVEJOIN_DEPTHS)[number];

/** How long, in hours, a box waits in Lovejoin's pool before it comes back: a random time in the range. */
export const LOVEJOIN_DELAYS = ["1-6", "2-12", "6-24"] as const;
export type LovejoinDelay = (typeof LOVEJOIN_DELAYS)[number];

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
   * The dApp connector (CIP-30): each site gets the public account or a
   * private session, chosen when it connects. Off until the user turns it
   * on, which asks Chrome for access to sites first.
   */
  dappConnector: boolean;
  /**
   * A site's signature (a transaction or a message) needs the password,
   * typed in the connector's window, even while the wallet is unlocked.
   */
  dappPassword: boolean;
  /** Lovejoin's fan-out for a session's return: 1, 2 or 3 waves deep, three wide. */
  lovejoinDepth: LovejoinDepth;
  /** Lovejoin: the range each box's wait is drawn from. */
  lovejoinDelay: LovejoinDelay;
}

export const DEFAULT_PREFERENCES: Preferences = {
  spendRewards: true,
  hideBalances: false,
  lockAfterMinutes: 15,
  currency: "usd",
  dappConnector: false,
  dappPassword: true,
  lovejoinDepth: 2,
  lovejoinDelay: "1-6",
};

export const isLovejoinDepth = (value: unknown): value is LovejoinDepth =>
  (LOVEJOIN_DEPTHS as readonly unknown[]).includes(value);

export const isLovejoinDelay = (value: unknown): value is LovejoinDelay =>
  (LOVEJOIN_DELAYS as readonly unknown[]).includes(value);

export const isLockAfter = (value: unknown): value is LockAfterMinutes =>
  (LOCK_AFTER_MINUTES as readonly unknown[]).includes(value);

export const isCurrency = (value: unknown): value is Currency =>
  value === "off" || (CURRENCIES as readonly unknown[]).includes(value);
