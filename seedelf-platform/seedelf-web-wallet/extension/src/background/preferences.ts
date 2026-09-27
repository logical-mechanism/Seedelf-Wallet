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
// dappConnector     Sites can connect (CIP-30, dapp.ts), each to the public
//                   account or a private session, chosen when it asks. Off
//                   by default; turning it on registers the content
//                   scripts, which needs Chrome's access to sites.
// dappPassword      A site's signature needs the password, typed in the
//                   connector's window, even while unlocked (dapp.ts). On by
//                   default.
//
// Where the toolbar button opens the wallet isn't one of these: it's the
// browser's, not the wallet's (shared/open-in.ts). Nor is the network, which
// has a key of its own (`NetworkChoice`, below).

import { isNetworkName, NETWORKS, type NetworkName } from "../networks";
import {
  DEFAULT_PREFERENCES,
  isCurrency,
  isLockAfter,
  isLovejoinDelay,
  isLovejoinDepth,
  LOCAL_NETWORK,
  LOCAL_PREFERENCES,
  type Preferences,
} from "../shared/preferences";
import type { Area } from "./storage";

export { LOCAL_NETWORK, LOCAL_PREFERENCES };

/**
 * The network the wallet is on: the user's choice (`seedelf.network`), among
 * the ones this build has, else the build's first (mainnet in a mainnet
 * build). The worker reads it at every request, so a switch needs no restart,
 * and every service takes the network it's asked about: what's kept per
 * network stays apart (docs/architecture.md, Networks).
 */
export class NetworkChoice {
  constructor(
    private readonly local: Area,
    /** The build's networks, the default first (networks.ts `enabledNetworks`). */
    readonly networks: NetworkName[],
  ) {}

  async get(): Promise<NetworkName> {
    const kept = await this.local.get<unknown>(LOCAL_NETWORK);
    return isNetworkName(kept) && this.networks.includes(kept) ? kept : this.networks[0]!;
  }

  /** Puts the wallet on `network`; refused for a network this build doesn't have. */
  async set(network: unknown): Promise<NetworkName> {
    if (!isNetworkName(network) || !this.networks.includes(network)) {
      throw new Error(
        isNetworkName(network) ? `This build of Seedelf Wallet can't use ${NETWORKS[network].label}.` : "That isn't a network.",
      );
    }
    await this.local.set(LOCAL_NETWORK, network);
    return network;
  }
}

export class PreferencesService {
  constructor(private readonly local: Area) {}

  async get(): Promise<Preferences> {
    const kept = (await this.local.get<Partial<Preferences>>(LOCAL_PREFERENCES)) ?? {};
    return {
      spendRewards: typeof kept.spendRewards === "boolean" ? kept.spendRewards : DEFAULT_PREFERENCES.spendRewards,
      hideBalances: typeof kept.hideBalances === "boolean" ? kept.hideBalances : DEFAULT_PREFERENCES.hideBalances,
      lockAfterMinutes: isLockAfter(kept.lockAfterMinutes) ? kept.lockAfterMinutes : DEFAULT_PREFERENCES.lockAfterMinutes,
      currency: isCurrency(kept.currency) ? kept.currency : DEFAULT_PREFERENCES.currency,
      dappConnector: typeof kept.dappConnector === "boolean" ? kept.dappConnector : DEFAULT_PREFERENCES.dappConnector,
      dappPassword: typeof kept.dappPassword === "boolean" ? kept.dappPassword : DEFAULT_PREFERENCES.dappPassword,
      lovejoinDepth: isLovejoinDepth(kept.lovejoinDepth) ? kept.lovejoinDepth : DEFAULT_PREFERENCES.lovejoinDepth,
      lovejoinDelay: isLovejoinDelay(kept.lovejoinDelay) ? kept.lovejoinDelay : DEFAULT_PREFERENCES.lovejoinDelay,
    };
  }

  /** Changes the settings given; anything that isn't one, or isn't a value it may take, is ignored. */
  async set(change: Partial<Preferences>): Promise<Preferences> {
    const next = { ...(await this.get()) };
    if (typeof change.spendRewards === "boolean") next.spendRewards = change.spendRewards;
    if (typeof change.hideBalances === "boolean") next.hideBalances = change.hideBalances;
    if (isLockAfter(change.lockAfterMinutes)) next.lockAfterMinutes = change.lockAfterMinutes;
    if (isCurrency(change.currency)) next.currency = change.currency;
    if (typeof change.dappConnector === "boolean") next.dappConnector = change.dappConnector;
    if (typeof change.dappPassword === "boolean") next.dappPassword = change.dappPassword;
    if (isLovejoinDepth(change.lovejoinDepth)) next.lovejoinDepth = change.lovejoinDepth;
    if (isLovejoinDelay(change.lovejoinDelay)) next.lovejoinDelay = change.lovejoinDelay;
    await this.local.set(LOCAL_PREFERENCES, next);
    return next;
  }

  /** How long the wallet stays unlocked without activity. */
  async lockAfterMs(): Promise<number> {
    return (await this.get()).lockAfterMinutes * 60_000;
  }
}
