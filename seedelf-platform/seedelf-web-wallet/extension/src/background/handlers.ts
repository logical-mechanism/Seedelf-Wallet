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
import type { DataParts } from "./data-layer";
import type { MintService } from "./mint";
import type { MoveInService } from "./move-in";
import type { NftImageService } from "./nft-image";
import type { PartsService } from "./parts";
import type { PendingService } from "./pending";
import type { NetworkChoice, PreferencesService } from "./preferences";
import type { PriceService } from "./prices";
import type { SendService } from "./send";
import { CLASSIC, poolChoice, type LovejoinService } from "./lovejoin";
import type { LovejoinLaunchService } from "./lovejoin-launch";
import type { SessionService } from "./sessions";
import type { StakingService } from "./staking";
import type { Area } from "./storage";
import type { TransferService } from "./transfer";
import { txView } from "./tx-view";
import type { WithdrawService } from "./withdraw";
import { SESSION_RESTORED, WalletLocked, type Wallet } from "./wallet";
import { isTrap } from "./wasm";
import { isLovejoinWidth, type LovejoinWidth } from "../shared/preferences";

/**
 * A mix's Four boxes a mix switch as a page sent it: three or four, nothing else; none, Settings' width (the owner's
 * test of 1.6.0).
 */
const widthOf = (width: unknown): LovejoinWidth | undefined => (isLovejoinWidth(width) ? width : undefined);

/**
 * A run a request starts and doesn't wait for: a restore's scan, the parts Home's poll pumps, Bring every box back
 * now's first run. Its failures are its own, said on its own pages, but WebAssembly that trapped under it is broken
 * for good: the wallet locks, as under a page's request (sw.ts answerUi) and the alarm's runs (runs.ts), rather than
 * stay unlocked on that instance until something else traps (1.6.0's release review, the docs check's finding 1).
 */
function unawaited(ctx: Pick<Context, "wallet">, run: Promise<unknown>): void {
  void run.catch(async (e: unknown) => {
    if (isTrap(e)) await ctx.wallet.trapped().catch(() => undefined);
  });
}

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
  /** A payment's parts that wait for the part before to be in a block (parts.ts): Home's poll and the runs send them. */
  parts?: PartsService;
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
  /** Starting a Lovejoin pool, from either side (lovejoin-launch.ts, chunk 34's 34d). */
  launch: LovejoinLaunchService;
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
  /** Which of the data layer's parts are on Koios for now (data-layer.ts). */
  dataParts: DataParts;
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
      // Its scan counts as under way from here, before the wallet exists: the wallet's creation opens Home in every
      // open page at once, and a Home that asks before the scan below starts must hear it coming, not over
      // (restoringOn; the release PR's e2e). Released once it has started, or the restore failed.
      const restoring = message.type === "restore-wallet" ? ctx.sessions.restoringOn(ctx.network) : undefined;
      try {
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
        // What Remove wallet kept of a payment that may still go through: this phrase's is watched again, another's
        // goes.
        await ctx.pending.adoptKept(ctx.networks).catch(() => undefined);
        // So does a mix from the public account that may have gone through (final review F1).
        await ctx.lovejoin.adoptKept(ctx.networks).catch(() => undefined);
        // Account 0 is the one account known from here.
        await ctx.accounts.recordFirst().catch(() => undefined);
        // A restored phrase may hold funds past account 0, so look for them —
        // in the background, since it is one Koios request per account probed
        // and nothing waits on the answer — then for what its private sessions'
        // one-time accounts still hold (the restore scan, O5), on the network
        // it's restored on: one request for every 20 accounts, and more for
        // those used. One after the other, so the two never ask together; the
        // scan counts as under way from here. A new phrase has nothing anywhere.
        if (message.type === "restore-wallet") {
          const network = ctx.network;
          // Every network marked first, sealed: a scan that doesn't finish (a read that fails, a lock, a worker stop),
          // and the network a restore doesn't look at, say so until one finishes there (1.5.0's release review, C19).
          for (const n of ctx.networks) await ctx.sessions.markUnscanned(n).catch(() => undefined);
          unawaited(ctx, ctx.sessions.scan(network, ctx.accounts.discover(network)));
        }
        return status(ctx);
      } finally {
        restoring?.();
      }
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
    // And whether a payment's parts wait to go, which a lock wipes with session storage (parts.ts), a session's
    // funding's too: said in words of their own, not as a Lovejoin chain (1.6.0's release review). Locked, none.
    case "parts-waiting": {
      const waiting = await Promise.all(
        ctx.networks.map((n) => ctx.parts?.waiting(n).then((w) => w.length > 0, () => false)),
      );
      return waiting.some(Boolean);
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
    case "pending-tx": {
      // Parts waiting for the one before go as Home asks too, between the sessions alarm's runs; not waited for.
      if (ctx.parts) unawaited(ctx, ctx.parts.pump(ctx.network));
      const pending = await ctx.pending.pending(ctx.network);
      // The watch lets a part go once it's seen: what's still to go is said by the parts' own record.
      if (!pending) return (await ctx.parts?.shown(ctx.network).catch(() => undefined)) ?? null;
      const first = pending.chain?.first;
      const parts = first ? await ctx.parts?.of(ctx.network, first) : undefined;
      if (parts) return { ...pending, parts };
      // No record of its parts, though some were still to go after the part the watch holds as it went: a lock or a
      // closed browser took them with session storage, and they never go. Said as parts that stopped, never as a
      // payment confirmed or a session funded (1.6.0's release review).
      const cut = !!first && !!pending.parts && !pending.parts.stopped && pending.parts.sent < pending.parts.total;
      return cut ? { ...pending, parts: { ...pending.parts!, stopped: "locked" } } : pending;
    }
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
      // So is the Koios-only switch beside it in Settings, put back below: the
      // restore after this, its look for accounts and its scan of the one-time
      // accounts too, asks only the server the user chose, before Settings can
      // be opened (1.5.0's release review, C08). Like the network, it says
      // only which server this browser reads through.
      const { koiosOnly } = await ctx.preferences.get();
      // A mix from the public account that may have gone through is kept, sealed, as that payment is (final review F1).
      if ((await wallet.state()) === "unlocked") await ctx.lovejoin.keepOnReset(ctx.networks).catch(() => undefined);
      await wallet.reset();
      // A scan of this phrase's one-time accounts under way goes with it, and what the sessions' accounts held: the
      // next phrase's restore scans for itself (1.5.0's release review, C16).
      ctx.sessions.reset();
      // The settings went with it: sites can't connect to a wallet that isn't there.
      await ctx.connector(false).catch(() => false);
      if (koiosOnly) await ctx.preferences.set({ koiosOnly });
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
    case "pool-history":
      return ctx.staking.poolHistory(ctx.network, message.id);
    case "drep":
      return ctx.staking.drep(ctx.network, message.id);
    case "drep-own":
      return ctx.staking.ownDrep(ctx.network);
    case "reward-history":
      return ctx.staking.rewardHistory(ctx.network);
    case "delegation-history":
      return ctx.staking.delegationHistory(ctx.network);
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
      // Another dApp account: a site's signature waiting was checked for the one it left (chunk 25). Told once it's
      // written: a request's last look before its window then sees the new one, or it's waiting by now (dapp.ts
      // `sameAccount`; 1.3.0's release review, C27).
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
      // didn't answer, or a mix from it still being sent. Much the check
      // Remove wallet makes, and for the same reason — a watch must not lose
      // its account halfway through (accounts.ts `use`). Not a private
      // session's chain, which is no account's and goes on across a switch
      // (1.6.0's release review, gap-1#0).
      const open = (await atStake(ctx)).filter((a) => a.maybeSent || a.mixMaybeSent);
      const mixing = await Promise.all(ctx.networks.map((n) => ctx.lovejoin.publicChainsSending(n).catch(() => false)));
      if (open.length || mixing.some(Boolean)) throw new Error(SWITCH_AT_STAKE());
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
    case "data-layer":
      return ctx.dataParts.held();
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
          // A chain's transaction it no longer holds says its chain moved on (1.3.0's release review, C28).
          inChain: (network, txHash) => ctx.lovejoin.inChain(network, txHash),
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
      return ctx.sessions.outBuild(
        ctx.network,
        message.quote,
        message.display,
        poolChoice(message.pools),
        typeof message.through === "boolean" ? message.through : undefined,
      );
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
      return ctx.sessions.backBuild(ctx.network, message.index, message.direct ?? false, poolChoice(message.pools));
    case "session-back-submit":
      return ctx.sessions.backSubmit(ctx.network, message.txHash);
    case "session-forget":
      return ctx.sessions.forget(ctx.network, message.index);
    case "session-top-up-build":
      return ctx.sessions.topUpBuild(ctx.network, message.index, message.lovelace, message.tokens);
    case "session-top-up-submit":
      return ctx.sessions.topUpSubmit(ctx.network, message.txHash);
    case "session-cancel-collateral-build":
      return ctx.sessions.cancelCollateralBuild(ctx.network, message.index);
    case "session-back-collateral-build":
      return ctx.sessions.backCollateralBuild(ctx.network, message.index);
    case "session-claim-build":
      return ctx.sessions.claimBuild(ctx.network, message.indexes, message.direct ?? false);
    case "session-claim-submit":
      return ctx.sessions.claimSubmit(ctx.network, message.txHashes);
    case "session-scan":
      return ctx.sessions.scan(ctx.network);
    case "session-scan-due":
      return ctx.sessions.scanDue(ctx.network);
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
    // The Lovejoin page's chain rows, read again while one is sent: the device alone, no Koios (1.3.0's release
    // review, C28).
    case "lovejoin-chains":
      return ctx.lovejoin.chains(ctx.network);
    case "lovejoin-look-for-pools":
      // Whether what a pool read reads changed with the look: the hub, which read the pools meanwhile, reads them again
      // (1.6.0's rehearsal, R10).
      return ctx.lovejoin.lookForPools(ctx.network);
    case "lovejoin-funding":
      // A pool's id from the page, or none: never a pool object it made up (its fixes' review, 6).
      return ctx.lovejoin.funding(
        ctx.network,
        message.boxes,
        false,
        undefined,
        typeof message.pool === "string" ? message.pool : undefined,
        // The form's Four boxes a mix switch, either way (the owner's test of 1.6.0); none, Settings'.
        widthOf(message.width),
      );
    case "lovejoin-mix-private-build":
      return ctx.sessions.mixOutBuild(ctx.network, message.boxes, {
        pool: message.pool,
        bootstrap: message.bootstrap ?? false,
        width: widthOf(message.width),
      });
    case "lovejoin-again-build":
      return ctx.sessions.againBuild(ctx.network, message.anyway ?? false, message.pool, widthOf(message.width));
    case "lovejoin-again-public-build":
      return ctx.lovejoin.publicAgainBuild(ctx.network, message.pool, widthOf(message.width));
    case "lovejoin-mix-private-submit":
      return ctx.sessions.mixOutSubmit(ctx.network, message.txHash);
    case "lovejoin-mix-public-build":
      return ctx.lovejoin.publicBuild(ctx.network, message.boxes, {
        pool: message.pool,
        bootstrap: message.bootstrap ?? false,
        width: widthOf(message.width),
      });
    case "lovejoin-mix-public-submit":
      return ctx.lovejoin.publicSubmit(ctx.network, message.txHash);
    case "lovejoin-mix-public-progress":
      return ctx.lovejoin.progress(ctx.network, message.advance ?? false);
    case "lovejoin-withdraw-now":
      return ctx.lovejoin.withdrawNow(
        ctx.network,
        message.box,
        message.anyway ?? false,
        message.paid === "private" ? "private" : message.paid === true,
        typeof message.pool === "string" ? message.pool : undefined,
      );
    case "lovejoin-mixes":
      return ctx.lovejoin.mixes(ctx.network);
    // Your mixes' Clear and Clear all (the owner's test of 1.6.0): ids and indexes as the page sent them, nothing else.
    case "lovejoin-mixes-clear":
      await ctx.lovejoin.clearMixes(ctx.network, (message.entries ?? []).filter((e): e is string => typeof e === "string"));
      await ctx.sessions.clearMixes(ctx.network, (message.sessions ?? []).filter((i): i is number => Number.isInteger(i)));
      return {};
    case "lovejoin-bootstrap-release":
      return ctx.lovejoin.releaseBootstrap(ctx.network, message.pool ?? CLASSIC).then(() => ({}));
    // Bring every box back now (Settings): asked, then its first run started now, not at the alarm's next minute.
    case "lovejoin-bring-all-back":
      await ctx.lovejoin.bringAllBack(ctx.network, typeof message.pool === "string" ? message.pool : undefined);
      unawaited(ctx, ctx.lovejoin.withdrawDue(ctx.network));
      return {};
    case "lovejoin-bring-all-back-stop":
      return ctx.lovejoin.stopBringingAllBack(ctx.network).then(() => ({}));
    // The Bootstrap form's bounds from the private balance: the worker's own (1.6.0's release review, MONEY-6), the way
    // back's reserve priced as its funding prices it (1.7.0).
    case "lovejoin-bootstrap-most":
      return ctx.lovejoin.privateBootstrapBounds(ctx.network, typeof message.pool === "string" ? message.pool : undefined);
    case "lovejoin-launch-terms":
      return ctx.launch.terms(ctx.network, message.token, message.quantity);
    case "lovejoin-launch-build":
      return ctx.launch.build(ctx.network, message);
    case "lovejoin-launch-submit":
      return ctx.launch.submit(ctx.network, message.txHash);
  }
}

/** Remove wallet's refusal, when something opened since its list was read. */
export const RESET_AT_STAKE = () => t("worker.remove.stillOpen");

/** Why a switch between public accounts waits: something of this one's is still going out. */
export const SWITCH_AT_STAKE = () => t("worker.account.onItsWay");

/**
 * What removing the wallet would leave behind, each of the build's networks
 * with something (independent review M2, M5), from what the wallet keeps,
 * with no Koios request: a payment that may still go through, private
 * sessions still open or with something no return takes left at their
 * accounts (a restore's scan finds what those hold, not what each was for),
 * a chain through Lovejoin being sent, a mix from the public account that
 * may have gone through (final review F1), a payment whose parts still wait
 * to go (1.6.0's release review: Koios answered its first, so nothing else
 * listed it, and the wallet went at the first yes, the rest with it). A
 * network whose records won't read says so. Throws if locked.
 */
async function atStake(ctx: Context): Promise<AtStake[]> {
  if ((await ctx.wallet.state()) !== "unlocked") throw new WalletLocked(t("worker.locked"));
  const found: AtStake[] = [];
  for (const network of ctx.networks) {
    try {
      const maybeSent = await ctx.pending.maybeSentOn(network);
      const sessions = await ctx.sessions.atStake(network);
      const chainSending = await ctx.lovejoin.chainsSending(network);
      const mixMaybeSent = await ctx.lovejoin.publicMaybe(network);
      // A session's funding in parts is its session's, listed above with what to do about it.
      const partsWaiting = ((await ctx.parts?.waiting(network)) ?? [])
        .filter((p) => p.session === undefined)
        .map(({ sent, total }) => ({ sent, total }));
      if (maybeSent || sessions.length || chainSending || mixMaybeSent || partsWaiting.length) {
        found.push({
          network,
          ...(maybeSent ? { maybeSent } : {}),
          sessions,
          chainSending,
          ...(mixMaybeSent ? { mixMaybeSent } : {}),
          ...(partsWaiting.length ? { partsWaiting } : {}),
        });
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
