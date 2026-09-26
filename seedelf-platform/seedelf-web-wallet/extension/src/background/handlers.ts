// Request handlers for the service worker. The WebAssembly module and the
// wallet are passed in, so the same code runs under Vitest (Node) and in Chrome.

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import type { Message, Requests, Status } from "../shared/rpc";
import type { ActivityService } from "./activity";
import type { BalanceService } from "./balances";
import type { CoinControlService } from "./coin-control";
import type { ContactsService } from "./contacts";
import type { DappService } from "./dapp";
import type { MintService } from "./mint";
import type { MoveInService } from "./move-in";
import type { PendingService } from "./pending";
import type { PreferencesService } from "./preferences";
import type { PriceService } from "./prices";
import type { SendService } from "./send";
import type { LovejoinService } from "./lovejoin";
import type { SessionService } from "./sessions";
import type { StakingService } from "./staking";
import type { TransferService } from "./transfer";
import type { WithdrawService } from "./withdraw";
import type { Wallet } from "./wallet";

export interface Context {
  wasm: typeof Wasm;
  wallet: Wallet;
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
  version: string;
  network: NetworkName;
  networks: NetworkName[];
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
      await wallet.create(message.phrase, message.password);
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
      return ctx.moveIn.build(ctx.network, message.lovelace, message.tokens);
    case "move-in-submit":
      return ctx.moveIn.submit(ctx.network, message.txHash);
    case "mint-build":
      return ctx.mint.build(ctx.network, message.label, message.from);
    case "mint-submit":
      return ctx.mint.submit(ctx.network, message.txHash);
    case "seedelf-lookup":
      return ctx.transfer.lookup(ctx.network, message.to);
    case "transfer-build":
      return ctx.transfer.build(ctx.network, message.payments);
    case "transfer-submit":
      return ctx.transfer.submit(ctx.network, message.txHash);
    case "resolve-destination":
      return ctx.withdraw.resolve(ctx.network, message.to);
    case "withdraw-build":
      return ctx.withdraw.build(ctx.network, message.payments);
    case "withdraw-submit":
      return ctx.withdraw.submit(ctx.network, message.txHash);
    case "remove-build":
      return ctx.withdraw.buildRemove(ctx.network, message.name, message.to);
    case "remove-submit":
      return ctx.withdraw.submitRemove(ctx.network, message.txHash);
    case "send-build":
      return ctx.send.build(ctx.network, message.payments, message.note);
    case "send-submit":
      return ctx.send.submit(ctx.network, message.txHash);
    case "pending-tx":
      return ctx.pending.pending();
    case "reset-wallet":
      await wallet.reset();
      // The settings went with it: sites can't connect to a wallet that isn't there.
      await ctx.connector(false).catch(() => false);
      return status(ctx);
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
        // Turned on without Chrome's access to sites (the switch asks first), it stays off.
        const working = await ctx.connector(prefs.dappConnector);
        if (prefs.dappConnector && !working) return ctx.preferences.set({ dappConnector: false });
      }
      return prefs;
    }
    case "price":
      return ctx.prices.get(ctx.network);
    case "dapp-approvals":
      return ctx.dapp.approvals();
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
      return ctx.sessions.outSubmit(ctx.network, message.txHash);
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
      return ctx.sessions.stop(ctx.network, message.index);
    case "session-resume":
      return ctx.sessions.resume(ctx.network, message.index);
    case "lovejoin-status":
      return ctx.lovejoin.status(ctx.network);
    case "lovejoin-held":
      return ctx.lovejoin.held(ctx.network);
    case "lovejoin-funding":
      return ctx.lovejoin.funding(ctx.network, message.boxes);
    case "lovejoin-mix-private-build":
      return ctx.sessions.mixOutBuild(ctx.network, message.boxes);
    case "lovejoin-again-build":
      return ctx.sessions.againBuild(ctx.network);
    case "lovejoin-mix-private-submit":
      return ctx.sessions.mixOutSubmit(ctx.network, message.txHash);
    case "lovejoin-mix-public-build":
      return ctx.lovejoin.publicBuild(ctx.network, message.boxes);
    case "lovejoin-mix-public-submit":
      return ctx.lovejoin.publicSubmit(ctx.network, message.txHash);
    case "lovejoin-mix-public-progress":
      return ctx.lovejoin.progress(ctx.network, message.advance ?? false);
    case "lovejoin-withdraw-now":
      return ctx.lovejoin.withdrawNow(ctx.network, message.box);
  }
}

async function status({ wallet, version, network, networks }: Context): Promise<Status> {
  const state = await wallet.state();
  const retryAfterMs = state === "locked" ? await wallet.retryAfterMs() : 0;
  return { state, version, network, networks, retryAfterMs };
}
