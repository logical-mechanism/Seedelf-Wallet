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
// dappAccount       Which public account connected sites use. One account is
//                   the dApp account, chosen on purpose, and it does not
//                   follow the account picker (chunk 18).
// lovejoinReturns   A private session's spare ADA goes through Lovejoin on
//                   its way back (sessions.ts). On by default; off, it comes
//                   back directly. A swap's approval records its own.
// lovejoinDepth,    How deep each box fans out, and the range its wait is
// lovejoinDelay     drawn from (lovejoin.ts).
// koiosOnly         Everything goes through Koios, never the wallet's own
//                   data layer (data-layer.ts). Off by default; read at each
//                   request, so turning it on needs no restart.
//
// Where the toolbar button opens the wallet isn't one of these: it's the
// browser's, not the wallet's (shared/open-in.ts). Nor is the network, which
// has a key of its own (`NetworkChoice`, below).

import { t } from "../i18n";
import { isNetworkName, NETWORKS, type NetworkName } from "../networks";
import {
  DEFAULT_PREFERENCES,
  isAccountIndex,
  isCurrency,
  isLockAfter,
  isLovejoinDelay,
  isLovejoinDepth,
  LOCAL_NETWORK,
  LOCAL_PREFERENCES,
  type Preferences,
} from "../shared/preferences";
import type { Area } from "./storage";
import { VAULT_KEY } from "./vault";

export { LOCAL_NETWORK, LOCAL_PREFERENCES };

/**
 * The network the wallet is on: the user's choice (`seedelf.network`), among
 * the ones this build has, else the build's first (mainnet in a mainnet
 * build). The worker reads it at every request, so a switch needs no restart,
 * and every service takes the network it's asked about: what's kept per
 * network stays apart (docs/architecture.md, Networks).
 *
 * A wallet with no choice kept predates the switch, when every build was
 * preprod only, so it stays on preprod: an update never moves a test wallet
 * to mainnet. A new wallet keeps the network it's made on (`keep`, before the
 * vault is written), so it's never taken for one of those.
 */
export class NetworkChoice {
  constructor(
    private readonly local: Area,
    /** The build's networks, the default first (networks.ts `enabledNetworks`). */
    readonly networks: NetworkName[],
  ) {}

  async get(): Promise<NetworkName> {
    const kept = await this.local.get<unknown>(LOCAL_NETWORK);
    if (isNetworkName(kept) && this.networks.includes(kept)) return kept;
    if (this.networks.includes("preprod") && (await this.local.get<unknown>(VAULT_KEY)) !== undefined) return "preprod";
    return this.networks[0]!;
  }

  /** Keeps `network` as the choice if none is kept: a new wallet stays on the network it's made on. */
  async keep(network: NetworkName): Promise<void> {
    const kept = await this.local.get<unknown>(LOCAL_NETWORK);
    if (!(isNetworkName(kept) && this.networks.includes(kept))) await this.set(network);
  }

  /** Puts the wallet on `network`; refused for a network this build doesn't have. */
  async set(network: unknown): Promise<NetworkName> {
    if (!isNetworkName(network) || !this.networks.includes(network)) {
      throw new Error(
        isNetworkName(network) ? t("worker.network.notInBuild", { network: NETWORKS[network].label }) : t("worker.network.notANetwork"),
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
      dappAccount: isAccountIndex(kept.dappAccount) ? kept.dappAccount : DEFAULT_PREFERENCES.dappAccount,
      lovejoinReturns: typeof kept.lovejoinReturns === "boolean" ? kept.lovejoinReturns : DEFAULT_PREFERENCES.lovejoinReturns,
      lovejoinDepth: isLovejoinDepth(kept.lovejoinDepth) ? kept.lovejoinDepth : DEFAULT_PREFERENCES.lovejoinDepth,
      lovejoinDelay: isLovejoinDelay(kept.lovejoinDelay) ? kept.lovejoinDelay : DEFAULT_PREFERENCES.lovejoinDelay,
      koiosOnly: typeof kept.koiosOnly === "boolean" ? kept.koiosOnly : DEFAULT_PREFERENCES.koiosOnly,
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
    if (isAccountIndex(change.dappAccount)) next.dappAccount = change.dappAccount;
    if (typeof change.lovejoinReturns === "boolean") next.lovejoinReturns = change.lovejoinReturns;
    if (isLovejoinDepth(change.lovejoinDepth)) next.lovejoinDepth = change.lovejoinDepth;
    if (isLovejoinDelay(change.lovejoinDelay)) next.lovejoinDelay = change.lovejoinDelay;
    if (typeof change.koiosOnly === "boolean") next.koiosOnly = change.koiosOnly;
    await this.local.set(LOCAL_PREFERENCES, next);
    return next;
  }

  /** How long the wallet stays unlocked without activity. */
  async lockAfterMs(): Promise<number> {
    return (await this.get()).lockAfterMinutes * 60_000;
  }
}
