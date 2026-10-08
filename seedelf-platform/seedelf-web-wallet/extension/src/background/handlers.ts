// Request handlers for the service worker. The WebAssembly module and the
// wallet are passed in, so the same code runs under Vitest (Node) and in Chrome.

import { t } from "../i18n";
import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import type { AccountsService } from "./accounts";
import type { AtStake, BuildStage, Message, Requests, Status } from "../shared/rpc";
import type { ActivityService } from "./activity";
import type { BalanceService } from "./balances";
import type { CoinControlService } from "./coin-control";
import type { ContactsService } from "./contacts";
import type { DappService } from "./dapp";
import type { MintService } from "./mint";
import type { MoveInService } from "./move-in";
import type { NftImageService } from "./nft-image";
import type { PendingService } from "./pending";
import type { NetworkChoice, PreferencesService } from "./preferences";
import type { PriceService } from "./prices";
import type { SendService } from "./send";
import type { LovejoinService } from "./lovejoin";
import type { SessionService } from "./sessions";
import type { StakingService } from "./staking";
import type { Area } from "./storage";
import type { TransferService } from "./transfer";
import { txView } from "./tx-view";
import type { WithdrawService } from "./withdraw";
import { SESSION_RESTORED, WalletLocked, type Wallet } from "./wallet";

export interface Context {
  wasm: typeof Wasm;
  wallet: Wallet;
  /** Session storage, where every built transaction waits for Send (tx-view.ts reads it). */
  session: Area;
  balances: BalanceService;
  moveIn: MoveInService;
  mint: MintService;
  transfer: TransferService;
  withdraw: WithdrawService;
  send: SendService;
  pending: PendingService;
  contacts: ContactsService;
  activity: ActivityService;
  coins: CoinControlService;
  staking: StakingService;
  preferences: PreferencesService;
  prices: PriceService;
  /** An NFT's image, when the user asks to see it (nft-image.ts). */
  nftImages: NftImageService;
  dapp: DappService;
  /** Private sessions: swaps from one-time accounts (sessions.ts). */
  sessions: SessionService;
  /** Lovejoin, the mixer: a session's spare ADA on its way back, and the boxes' withdraws (lovejoin.ts). */
  lovejoin: LovejoinService;
  /** Registers or removes the dApp connector's content scripts (connector.ts). */
  connector: (on: boolean) => Promise<boolean>;
  /** Why the connector can't be turned on, when it can't (storage-access.ts). */
  connectorBlocked?: Status["connectorBlocked"];
  /**
   * Puts the connector's scripts in the https pages open now, as it's turned
   * on (connector.ts `reachOpenPages`; blind test §9.2, T15). Undefined
   * outside the worker, in tests.
   */
  reachOpenPages?: () => Promise<number>;
  version: string;
  /** The network this request is on: the user's choice as the request came in (sw.ts reads it for each one). */
  network: NetworkName;
  /** The build's networks, its default first. */
  networks: NetworkName[];
  /** The user's choice of network, which `network-set` changes. */
  networkChoice: NetworkChoice;
  /** The phrase's public accounts, and which one the wallet works on (accounts.ts). */
  accounts: AccountsService;
  /**
   * Says what a build is doing, on this request's own port (ui-port.ts): the
   * screen shows it instead of only greying out its button. Undefined outside
   * the worker, in tests.
   */
  progress?: (stage: BuildStage) => void;
}

export async function handle(message: Message, ctx: Context): Promise<Requests[Message["type"]]["result"]> {
  const { wasm, wallet } = ctx;
  switch (message.type) {
    case "status":
      return status(ctx);
    case "generate-phrase":
      return { phrase: wasm.generatePhrase() };
    case "validate-phrase":
      wasm.validatePhrase(message.phrase);
      return null;
    case "create-wallet":
    case "restore-wallet":
      // The network it's made on (the welcome screen's choice) is kept first,
      // so the new wallet is never taken for one from before the switch.
      await ctx.networkChoice.keep(ctx.network);
      // Before the keys are derived: the account choice outlives a Remove
      // wallet, as the network does, so a new phrase starts on account 0
      // rather than wherever the last one was left (accounts.ts `useFirst`).
      await ctx.accounts.useFirst();
      // A restore is confirmed by the Home that opens next, in whichever page that is (`restored`, blind test T20a,
      // T20b): marked before the wallet exists, since its state change opens Home in every open page at once. The
      // fact alone. A create is never marked: Get started is its welcome.
      if (message.type === "restore-wallet") await ctx.session.set(SESSION_RESTORED, true);
      else await ctx.session.remove(SESSION_RESTORED);
      try {
        await wallet.create(message.phrase, message.password);
      } catch (e) {
        await ctx.session.remove(SESSION_RESTORED).catch(() => undefined);
        throw e;
      }
      // What Remove wallet kept of a payment that may still go through: this phrase's is watched again, another's goes.
      await ctx.pending.adoptKept(ctx.networks).catch(() => undefined);
      // So does a mix from the public account that may have gone through (final review F1).
      await ctx.lovejoin.adoptKept(ctx.networks).catch(() => undefined);
      // Account 0 is the one account known from here.
      await ctx.accounts.recordFirst().catch(() => undefined);
      // A restored phrase may hold funds past account 0, so look for them —
      // in the background, since it is one Koios request per account probed
      // and nothing waits on the answer. A new phrase has nothing anywhere.
      if (message.type === "restore-wallet") {
        void ctx.accounts.discover(ctx.network).catch(() => undefined);
      }
      return status(ctx);
    case "restored":
      // Whether Home is still to say a restore made this wallet; `seen` once it has, with a reading, or was dismissed.
      if (message.seen) {
        await ctx.session.remove(SESSION_RESTORED);
        return false;
      }
      return (await ctx.session.get<boolean>(SESSION_RESTORED)) === true;
    case "unlock":
      return wallet.unlock(message.password);
    case "lock":
      await wallet.lock();
      return status(ctx);
    case "activity":
      await wallet.touch();
      return null;
    case "lock-deadline":
      return wallet.lockDeadline();
    // Asked by the lock countdown while it shows (privacy review §6): a chain is sent only while the wallet is
    // unlocked. From what the device keeps, on every network the wallet has; locked, there's none to stop.
    case "chains-sending": {
      const sending = await Promise.all(ctx.networks.map((n) => ctx.lovejoin.chainsSending(n).catch(() => false)));
      return sending.some(Boolean);
    }
    case "account":
      return wallet.account(ctx.network);
    case "balances":
      return ctx.balances.get(ctx.network, message.refresh ?? false, { kept: message.kept ?? false });
    case "wordlist":
      return wasm.bip39Wordlist();
    case "move-in-build":
      return ctx.moveIn.build(ctx.network, message.lovelace, message.tokens, ctx.progress);
    case "move-in-submit":
      return ctx.moveIn.submit(ctx.network, message.txHash);
    case "mint-build":
      return ctx.mint.build(ctx.network, message.label, message.from, ctx.progress);
    case "mint-submit":
      return ctx.mint.submit(ctx.network, message.txHash);
    case "seedelf-lookup":
      return ctx.transfer.lookup(ctx.network, message.to);
    case "transfer-build":
      return ctx.transfer.build(ctx.network, message.payments, ctx.progress);
    case "transfer-submit":
      return ctx.transfer.submit(ctx.network, message.txHash);
    case "resolve-destination":
      return ctx.withdraw.resolve(ctx.network, message.to);
    case "withdraw-build":
      return ctx.withdraw.build(ctx.network, message.payments, ctx.progress);
    case "withdraw-submit":
      return ctx.withdraw.submit(ctx.network, message.txHash);
    case "remove-build":
      return ctx.withdraw.buildRemove(ctx.network, message.name, message.to, ctx.progress);
    case "remove-submit":
      return ctx.withdraw.submitRemove(ctx.network, message.txHash);
    case "send-build":
      return ctx.send.build(ctx.network, message.payments, message.note, ctx.progress);
    case "send-submit":
      return ctx.send.submit(ctx.network, message.txHash);
    case "pending-tx":
      return ctx.pending.pending(ctx.network);
    case "reset-check":
      return atStake(ctx);
    case "reset-wallet":
      // Unlocked (Remove wallet), what's still open is listed first, and
      // removing it anyway takes a second yes. Locked (Forgot password),
      // nothing can be read: a payment that may still go through is kept all
      // the same (wallet.ts reset, independent review M2, M5).
      if (message.force !== true && (await wallet.state()) === "unlocked" && (await atStake(ctx)).length) {
        throw new Error(RESET_AT_STAKE());
      }
      // A wallet from before the switch has no network kept, only worked out
      // from its vault: kept now, it outlives the vault, so the next restore
      // is on that network, never mainnet first (independent review L42).
      await ctx.networkChoice.keep(await ctx.networkChoice.get());
      // A mix from the public account that may have gone through is kept, sealed, as that payment is (final review F1).
      if ((await wallet.state()) === "unlocked") await ctx.lovejoin.keepOnReset(ctx.networks).catch(() => undefined);
      await wallet.reset();
      // The settings went with it: sites can't connect to a wallet that isn't there.
      await ctx.connector(false).catch(() => false);
      // Said as it now stands, not as the request came in.
      return status({ ...ctx, network: await ctx.networkChoice.get() });
    case "reveal-phrase":
      return { words: await wallet.revealPhrase(message.password) };
    case "check-phrase":
      return { matches: await wallet.checkPhrase(message.phrase) };
    case "phrase-words":
      return { words: await wallet.phraseWords() };
    case "change-password":
      await wallet.changePassword(message.current, message.next);
      return null;
    case "contacts":
      return ctx.contacts.list(ctx.network);
    case "contact-save":
      return ctx.contacts.save(ctx.network, message);
    case "contact-remove":
      return ctx.contacts.remove(ctx.network, message.id);
    case "history": {
      if (message.of === "seedelf") {
        // Arrivals are noted by a balance reading: Refresh makes one, and otherwise the history asks nothing.
        const updatedAt = message.refresh
          ? (await ctx.balances.get(ctx.network, true)).updatedAt
          : await ctx.balances.lastRead(ctx.network);
        return { entries: await ctx.activity.seedelf(ctx.network), more: false, updatedAt };
      }
      // The Cardano side asks Koios for what's newer on every call.
      return { ...(await ctx.activity.cardano(ctx.network, message.more ?? false)), updatedAt: Date.now() };
    }
    // Coin control reads the last balance reading, so there must be one.
    case "utxos":
      await ctx.balances.get(ctx.network, message.refresh ?? false);
      return ctx.coins.lists(ctx.network);
    case "utxo-lock":
      return ctx.coins.setLocked(ctx.network, message.of, message.utxo, message.locked);
    case "collateral":
      await ctx.balances.get(ctx.network);
      return ctx.coins.collateral(ctx.network);
    case "collateral-use":
      return ctx.coins.use(ctx.network, message.utxo);
    case "collateral-reclaim":
      return ctx.coins.reclaim(ctx.network);
    case "collateral-build":
      return ctx.send.buildCollateral(ctx.network);
    case "collateral-submit":
      return ctx.send.submitCollateral(ctx.network, message.txHash);
    case "pools":
      return ctx.staking.pools(ctx.network, message.refresh ?? false);
    case "pool":
      return ctx.staking.pool(ctx.network, message.id);
    case "drep":
      return ctx.staking.drep(ctx.network, message.id);
    case "drep-own":
      return ctx.staking.ownDrep(ctx.network);
    case "governance":
      return ctx.staking.governance(ctx.network, message.refresh ?? false);
    case "drep-profile":
      return ctx.staking.drepProfile(message.profile);
    case "stake-build":
      return ctx.staking.build(ctx.network, message.action);
    case "stake-submit":
      return ctx.staking.submit(ctx.network, message.txHash);
    case "preferences":
      return ctx.preferences.get();
    case "preferences-set": {
      const { type: _type, ...change } = message;
      const prefs = await ctx.preferences.set(change);
      // Another dApp account: a site's signature waiting was checked for the one it left (chunk 25).
      if (typeof change.dappAccount === "number") await ctx.dapp.dappAccountChanged();
      if (typeof change.dappConnector === "boolean") {
        // Off: nothing a site asked for waits on (independent review L33).
        if (!prefs.dappConnector) ctx.dapp.connectorOff();
        // Turned on without Chrome's access to sites (the switch asks first), it stays off.
        const working = await ctx.connector(prefs.dappConnector);
        if (prefs.dappConnector && !working) return ctx.preferences.set({ dappConnector: false });
        // On: the https pages open now see the wallet too, not only those loaded after (blind test §9.2, T15). Not
        // waited for: a page still loading is reached only once it has.
        if (prefs.dappConnector) void ctx.reachOpenPages?.().catch(() => 0);
      }
      return prefs;
    }
    case "accounts":
      return ctx.accounts.list();
    case "account-use": {
      // What's in flight belongs to the account that sent it: a payment Koios
      // didn't answer, or a mix still being sent. The same check Remove
      // wallet makes, and for the same reason — a watch must not lose its
      // account halfway through (accounts.ts `use`).
      const open = (await atStake(ctx)).filter((a) => a.maybeSent || a.mixMaybeSent || a.chainSending);
      if (open.length) throw new Error(SWITCH_AT_STAKE());
      await ctx.accounts.use(message.index, ctx.networks);
      // Sites keep talking to the account they connected to (dapp.ts), so
      // nothing is declined here, unlike a network switch.
      return ctx.accounts.list();
    }
    case "account-rename":
      return { accounts: await ctx.accounts.rename(message.index, message.name), active: await ctx.accounts.active() };
    case "account-discover": {
      const found = await ctx.accounts.discover(ctx.network, message.limit);
      return { ...(await ctx.accounts.list()), found: found.map((a) => a.index) };
    }
    case "account-check": {
      const { index, used } = await ctx.accounts.check(ctx.network, message.index);
      return { ...(await ctx.accounts.list()), index, used };
    }
    case "account-add":
      return { accounts: await ctx.accounts.add(message.index), active: await ctx.accounts.active() };
    case "account-addresses":
      return ctx.accounts.addresses(ctx.network);
    case "network-set": {
      // What's kept for Send stays tied to the network it was built on
      // (every submit checks it), so nothing built here goes out there.
      const network = await ctx.networkChoice.set(message.network);
      // Sites asking on the network the wallet left hear no.
      await ctx.dapp.networkChanged();
      return status({ ...ctx, network });
    }
    case "price":
      return ctx.prices.get(ctx.network);
    // Only for a wallet that's open: a locked one shows no tokens to ask about.
    case "nft-image":
      if ((await wallet.state()) !== "unlocked") throw new WalletLocked(t("worker.locked"));
      return ctx.nftImages.show(ctx.network, message.policyId, message.assetName);
    // The transaction the review or the site's prompt is about, decoded from
    // its own bytes (tx-view.ts): no Koios request, nothing kept. Which of its
    // outputs are the user's comes from the device's own record of accounts
    // and sessions (blind test §9.9).
    case "tx-detail":
      return txView(
        {
          ...ctx,
          knownAccounts: () => ctx.accounts.known().then((all) => all.map((a) => a.index)),
          sessionIndices: (network) => ctx.sessions.indices(network),
        },
        ctx.network,
        message.txHash,
        (hash) => ctx.dapp.waitingCbor(hash),
      );
    case "dapp-approvals":
      return ctx.dapp.approvals();
    case "dapp-unlocking":
      return ctx.dapp.unlockingSites();
    case "dapp-close":
      return ctx.dapp.closeWindow();
    case "dapp-answer":
      return ctx.dapp.answer(message.id, message.approve, message.password, message.fund, message.governance);
    case "dapp-private-build":
      return ctx.dapp.privateBuild(message.id, message.lovelace, message.tokens);
    case "dapp-disconnect-session":
      await ctx.dapp.disconnectSession(message.index);
      return null;
    case "dapp-sites":
      return ctx.dapp.sites();
    case "dapp-forget":
      return ctx.dapp.forget(message.origin);
    // Which sites the user turned away is as private as which are connected: only for a wallet that's open.
    case "dapp-declined":
      if ((await wallet.state()) !== "unlocked") throw new WalletLocked(t("worker.locked"));
      return ctx.dapp.declined();
    case "dapp-let-ask":
      if ((await wallet.state()) !== "unlocked") throw new WalletLocked(t("worker.locked"));
      return ctx.dapp.letAsk(message.origin);
    case "sessions":
      return ctx.sessions.list(ctx.network, message.refresh);
    case "swap-tokens":
      return ctx.sessions.tokens(ctx.network, message.query);
    case "swap-quote":
      return ctx.sessions.quote(ctx.network, {
        amount: message.amount,
        tokenIn: message.tokenIn,
        tokenOut: message.tokenOut,
        slippage: message.slippage,
      });
    case "session-out-build":
      return ctx.sessions.outBuild(ctx.network, message.quote, message.display);
    case "session-out-submit":
      return ctx.sessions.outSubmit(ctx.network, message.txHash, message.direct);
    case "session-swap-build":
      return ctx.sessions.swapBuild(ctx.network, message.index);
    case "session-swap-submit":
      return ctx.sessions.txSubmit(ctx.network, message.txHash, "swap");
    case "session-orders":
      return ctx.sessions.orders(ctx.network, message.index);
    case "session-cancel-build":
      return ctx.sessions.cancelBuild(ctx.network, message.index);
    case "session-cancel-submit":
      return ctx.sessions.txSubmit(ctx.network, message.txHash, "cancel");
    case "session-back-build":
      return ctx.sessions.backBuild(ctx.network, message.index, message.direct ?? false);
    case "session-back-submit":
      return ctx.sessions.backSubmit(ctx.network, message.txHash);
    case "session-forget":
      return ctx.sessions.forget(ctx.network, message.index);
    case "session-top-up-build":
      return ctx.sessions.topUpBuild(ctx.network, message.index, message.lovelace, message.tokens);
    case "session-top-up-submit":
      return ctx.sessions.topUpSubmit(ctx.network, message.txHash);
    case "session-claim-build":
      return ctx.sessions.claimBuild(ctx.network, message.indexes, message.direct ?? false);
    case "session-claim-submit":
      return ctx.sessions.claimSubmit(ctx.network, message.txHashes);
    case "session-advance":
      return ctx.sessions.advance(ctx.network, message.index, message.now ?? false);
    case "session-stop":
      return ctx.sessions.stop(ctx.network, message.index, message.direct ?? false);
    case "session-stop-cost":
      return ctx.sessions.stopCost(ctx.network, message.index);
    case "session-resume":
      return ctx.sessions.resume(ctx.network, message.index);
    case "lovejoin-status":
      return ctx.lovejoin.status(ctx.network);
    case "lovejoin-held":
      return ctx.lovejoin.held(ctx.network);
    case "lovejoin-funding":
      return ctx.lovejoin.funding(ctx.network, message.boxes);
    case "lovejoin-mix-private-build":
      return ctx.sessions.mixOutBuild(ctx.network, message.boxes, message.seed ?? false);
    case "lovejoin-again-build":
      return ctx.sessions.againBuild(ctx.network, message.anyway ?? false);
    case "lovejoin-again-public-build":
      return ctx.lovejoin.publicAgainBuild(ctx.network);
    case "lovejoin-mix-private-submit":
      return ctx.sessions.mixOutSubmit(ctx.network, message.txHash);
    case "lovejoin-mix-public-build":
      return ctx.lovejoin.publicBuild(ctx.network, message.boxes, message.seed ?? false);
    case "lovejoin-mix-public-submit":
      return ctx.lovejoin.publicSubmit(ctx.network, message.txHash);
    case "lovejoin-mix-public-progress":
      return ctx.lovejoin.progress(ctx.network, message.advance ?? false);
    case "lovejoin-withdraw-now":
      return ctx.lovejoin.withdrawNow(ctx.network, message.box, message.anyway ?? false);
  }
}

/** Remove wallet's refusal, when something opened since its list was read. */
export const RESET_AT_STAKE = () => t("worker.remove.stillOpen");

/**
 * What removing the wallet would leave behind, each of the build's networks
 * with something (independent review M2, M5), from what the wallet keeps,
 * with no Koios request: a payment that may still go through, private
 * sessions whose accounts a restore doesn't find yet, a chain through
 * Lovejoin being sent, a mix from the public account that may have gone
 * through (final review F1). A network whose records won't read says so.
 * Throws if locked.
 */
/** Why a switch between public accounts waits: something of this one's is still going out. */
export const SWITCH_AT_STAKE = () => t("worker.account.onItsWay");

async function atStake(ctx: Context): Promise<AtStake[]> {
  if ((await ctx.wallet.state()) !== "unlocked") throw new WalletLocked(t("worker.locked"));
  const found: AtStake[] = [];
  for (const network of ctx.networks) {
    try {
      const maybeSent = await ctx.pending.maybeSentOn(network);
      const sessions = await ctx.sessions.atStake(network);
      const chainSending = await ctx.lovejoin.chainsSending(network);
      const mixMaybeSent = await ctx.lovejoin.publicMaybe(network);
      if (maybeSent || sessions.length || chainSending || mixMaybeSent) {
        found.push({ network, ...(maybeSent ? { maybeSent } : {}), sessions, chainSending, ...(mixMaybeSent ? { mixMaybeSent } : {}) });
      }
    } catch {
      found.push({ network, sessions: [], chainSending: false, unreadable: true });
    }
  }
  return found;
}

async function status({ wallet, version, network, networks, connectorBlocked }: Context): Promise<Status> {
  const state = await wallet.state();
  const retryAfterMs = state === "locked" ? await wallet.retryAfterMs() : 0;
  const lockedBy = state === "locked" ? wallet.lockReason() : undefined;
  return { state, version, network, networks, retryAfterMs, ...(connectorBlocked ? { connectorBlocked } : {}), ...(lockedBy ? { lockedBy } : {}) };
}
