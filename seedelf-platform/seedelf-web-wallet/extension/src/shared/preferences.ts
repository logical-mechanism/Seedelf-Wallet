// The user's settings, and what each may be. The worker keeps them
// (background/preferences.ts); the UI reads and changes them through it, and
// follows changes other pages make.

/** chrome.storage.local: the user's settings. */
export const LOCAL_PREFERENCES = "seedelf.preferences";

/**
 * chrome.storage.local: the network the wallet is on, in a build that has
 * more than one (a mainnet build: mainnet, or preprod for testing). Kept on
 * its own, not with the settings: the worker reads it for every request,
 * locked or not, and removing the wallet keeps it, as it keeps where the
 * wallet opens. Anything else there, or nothing, is the build's first network.
 */
export const LOCAL_NETWORK = "seedelf.network";

/**
 * chrome.storage.local: which public account the wallet works on (chunk 18),
 * as an index from 0. Kept beside the network and for the same reason — the
 * worker reads it while deriving the keys, before anything is unlocked, so it
 * can't live in a sealed record. One integer for the wallet, not one per
 * network: the account's keys are the same on both.
 *
 * **What this leaks, said where it's chosen:** anyone reading the profile's
 * local storage sees which account is active. They already see that a vault
 * exists, which network it is on, every setting, and that sealed records
 * exist. *How many* accounts the phrase has, and what they are called, stay
 * sealed (background/accounts.ts). Anything else here, or nothing, is
 * account 0.
 */
export const LOCAL_ACCOUNT = "seedelf.account";

/**
 * chrome.storage.local: the sealed record of the phrase's public accounts (background/private-store.ts's
 * `PRIVATE_PREFIX` and "accounts", written out here so the pages don't import the cipher). The pages follow its
 * name, never its sealed value: a restore's look writes only this, in the background (ui/accounts.tsx).
 */
export const LOCAL_ACCOUNTS_RECORD = "seedelf.private.accounts";

/**
 * chrome.storage.local: which language the wallet is in (chunk 19), as a code
 * one of the bundled locales declares ("en", "es", "ja"). Kept beside the
 * network and the account, and for the same reason: onboarding, Unlock and
 * Reset are all read before anything is unlocked, so the worker can't be
 * asked for it, and `PreferencesProvider` only reads the settings once the
 * wallet is open.
 *
 * **What this leaks, said where it's chosen:** anyone reading the profile's
 * local storage sees which language the wallet is in. They already see that a
 * vault exists, which network it's on, which account is active and every
 * setting. Removing the wallet keeps it, as it keeps the network: a user who
 * starts again shouldn't find the wallet back in English. Anything else here,
 * or nothing, is the system's language when we ship it and English otherwise
 * (i18n/core.ts).
 */
export const LOCAL_LANGUAGE = "seedelf.language";

/**
 * The CIP-1852 account private sessions' one-time accounts live under
 * (`cardano::ONE_TIME_ACCOUNT` in seedelf-crypto, `24301'`). Never a public
 * account, whatever number is typed: its `0/i` and `2/0` keys are session
 * `i`'s and session 0's, so as a public account it would read, and spend,
 * private sessions' money (privacy.md, rule 6).
 */
export const ONE_TIME_ACCOUNT = 0x5eed;

/** Whether `value` is a public account index a preference may hold (background/accounts.ts bounds it). */
export const isAccountIndex = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 0x7fff_ffff &&
  value !== ONE_TIME_ACCOUNT;

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
  /**
   * Which public account connected sites use (chunk 18), as an index from 0.
   *
   * **One account is the dApp account, chosen on purpose, and it does not
   * follow the picker** — Eternl's model (the owner, 2026-10-02). A site
   * always talks to this one whichever account the wallet is working on, so
   * switching accounts never hands a site a second account's addresses, and
   * a site is never refused for being on the "wrong" one. Changing it is a
   * deliberate act in Settings.
   *
   * Account 0 by default, which is the only account every wallet from before
   * several accounts had — so nothing a site already sees changes.
   */
  dappAccount: number;
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
  /**
   * A private session's spare ADA goes through Lovejoin on its way back.
   * Off, it comes back directly, tied on chain to the session and its
   * funding; a swap's approval sets its own from this, and a mix from the
   * Lovejoin tile mixes whatever it says (privacy review §4.1).
   */
  lovejoinReturns: boolean;
  /** Lovejoin's fan-out for a session's return: 1, 2 or 3 waves deep, three wide. */
  lovejoinDepth: LovejoinDepth;
  /** Lovejoin: the range each box's wait is drawn from. */
  lovejoinDelay: LovejoinDelay;
  /**
   * Read and send everything through Koios, never Seedelf Wallet's own data
   * layer (chunk 26b). Off by default: where the build has a data layer
   * (mainnet, networks.ts `dataOrigin`), the wallet reads it first, and Koios
   * only for a part that's down. The switch shows only where there's a data
   * layer to turn off.
   */
  koiosOnly: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  spendRewards: true,
  hideBalances: false,
  lockAfterMinutes: 15,
  currency: "usd",
  dappConnector: false,
  dappPassword: true,
  dappAccount: 0,
  lovejoinReturns: true,
  lovejoinDepth: 2,
  lovejoinDelay: "1-6",
  koiosOnly: false,
};

export const isLovejoinDepth = (value: unknown): value is LovejoinDepth =>
  (LOVEJOIN_DEPTHS as readonly unknown[]).includes(value);

export const isLovejoinDelay = (value: unknown): value is LovejoinDelay =>
  (LOVEJOIN_DELAYS as readonly unknown[]).includes(value);

export const isLockAfter = (value: unknown): value is LockAfterMinutes =>
  (LOCK_AFTER_MINUTES as readonly unknown[]).includes(value);

export const isCurrency = (value: unknown): value is Currency =>
  value === "off" || (CURRENCIES as readonly unknown[]).includes(value);
