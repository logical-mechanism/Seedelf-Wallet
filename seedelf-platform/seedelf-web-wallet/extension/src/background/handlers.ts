// Request handlers for the service worker. The WebAssembly module and the
// wallet are passed in, so the same code runs under Vitest (Node) and in Chrome.

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import type { AtStake, BuildStage, Message, Requests, Status } from "../shared/rpc";
import type { ActivityService } from "./activity";
import type { BalanceService } from "./balances";
import type { CoinControlService } from "./coin-control";
import type { ContactsService } from "./contacts";
import type { DappService } from "./dapp";
import type { MintService } from "./mint";
import type { MoveInService } from "./move-in";
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
import type { Wallet } from "./wallet";

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
  dapp: DappService;
  /** Private sessions: swaps from one-time accounts (sessions.ts). */
  sessions: SessionService;
  /** Lovejoin, the mixer: a session's spare ADA on its way back, and the boxes' withdraws (lovejoin.ts). */
  lovejoin: LovejoinService;
  /** Registers or removes the dApp connector's content scripts (connector.ts). */
  connector: (on: boolean) => Promise<boolean>;
  /** Why the connector can't be turned on, when it can't (storage-access.ts). */
  connectorBlocked?: Status["connectorBlocked"];
  version: string;
  /** The network this request is on: the user's choice as the request came in (sw.ts reads it for each one). */
  network: NetworkName;
  /** The build's networks, its default first. */
  networks: NetworkName[];
  /** The user's choice of network, which `network-set` changes. */
  networkChoice: NetworkChoice;
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
      await wallet.create(message.phrase, message.password);
      // What Remove wallet kept of a payment that may still go through: this phrase's is watched again, another's goes.
      await ctx.pending.adoptKept(ctx.networks).catch(() => undefined);
      // So does a mix from the public account that may have gone through (final review F1).
      await ctx.lovejoin.adoptKept(ctx.networks).catch(() => undefined);
      return status(ctx);
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
    case "account":
      return wallet.account(ctx.network);
    case "balances":
      return ctx.balances.get(ctx.network, message.refresh ?? false);
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
        throw new Error(RESET_AT_STAKE);
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
    case "stake-build":
      return ctx.staking.build(ctx.network, message.action);
    case "stake-submit":
      return ctx.staking.submit(ctx.network, message.txHash);
    case "preferences":
      return ctx.preferences.get();
    case "preferences-set": {
      const { type: _type, ...change } = message;
      const prefs = await ctx.preferences.set(change);
      if (typeof change.dappConnector === "boolean") {
        // Off: nothing a site asked for waits on (independent review L33).
        if (!prefs.dappConnector) ctx.dapp.connectorOff();
        // Turned on without Chrome's access to sites (the switch asks first), it stays off.
        const working = await ctx.connector(prefs.dappConnector);
        if (prefs.dappConnector && !working) return ctx.preferences.set({ dappConnector: false });
      }
      return prefs;
    }
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
    // The transaction the review or the site's prompt is about, decoded from
    // its own bytes (tx-view.ts): no Koios request, nothing kept.
    case "tx-detail":
      return txView(ctx, ctx.network, message.txHash, (hash) => ctx.dapp.waitingCbor(hash));
    case "dapp-approvals":
      return ctx.dapp.approvals();
    case "dapp-unlocking":
      return ctx.dapp.unlockingSites();
    case "dapp-close":
      return ctx.dapp.closeWindow();
    case "dapp-answer":
      return ctx.dapp.answer(message.id, message.approve, message.password, message.fund);
    case "dapp-private-build":
      return ctx.dapp.privateBuild(message.id, message.lovelace, message.tokens);
    case "dapp-disconnect-session":
      await ctx.dapp.disconnectSession(message.index);
      return null;
    case "dapp-sites":
      return ctx.dapp.sites();
    case "dapp-forget":
      return ctx.dapp.forget(message.origin);
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
export const RESET_AT_STAKE =
  "Something is still open that removing the wallet would leave behind. Look at the list again before you remove it.";

/**
 * What removing the wallet would leave behind, each of the build's networks
 * with something (independent review M2, M5), from what the wallet keeps,
 * with no Koios request: a payment that may still go through, private
 * sessions whose accounts a restore doesn't find yet, a chain through
 * Lovejoin being sent, a mix from the public account that may have gone
 * through (final review F1). A network whose records won't read says so.
 * Throws if locked.
 */
async function atStake(ctx: Context): Promise<AtStake[]> {
  if ((await ctx.wallet.state()) !== "unlocked") throw new Error("The wallet is locked.");
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
