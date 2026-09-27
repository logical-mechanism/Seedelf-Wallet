// The dApp connector (CIP-30) in the worker, for the public account. The
// content scripts (shared/dapp.ts) bring each site's calls here, with the
// site's origin as Chrome reports it.
//
// Connecting  A site calls `enable()`; the connector's window asks the user
//             (unlocking first if need be). Connected sites are a sealed
//             private record (`dapps`), per network: which sites you use
//             says something about you. Settings lists them, to disconnect.
// Networks    Each call is on the network the wallet is on as it's made
//             (Settings switches it): `getNetworkId` says which, and a site
//             connected on one isn't on the other. What sites were asking
//             on the network the wallet left is declined (`networkChanged`).
// Locked      Everything but `isEnabled()` (false while locked) opens the
//             window to unlock first. Closing it without unlocking refuses
//             the calls, and that site's reads are refused without asking
//             for a minute, so a dApp that polls doesn't keep opening it.
// Reading     The account as `readAccountUtxos` finds it (two Koios
//             requests), kept 30 s: less what the user locked and the
//             collateral (`getCollateral` gives that one), plus what the
//             account gets back from dApp transactions it sent that aren't
//             on chain yet, less what they spent.
// Signing     `signTx` reads what the transaction does in WebAssembly
//             (`inspectDappTx`) and shows it; only an approval signs, with
//             the account's keys that it needs. With `dappPassword` on (the
//             default), Sign needs the password too, even while unlocked
//             and even right after an unlock: a wrong one leaves the request
//             waiting and counts towards the unlock back-off. WebAssembly
//             won't have a payment key sign over an input nobody can find,
//             so the outputs of every transaction it signs are kept (the
//             account's for the last 32, every one for 20 minutes), and the
//             wallet's own sends' on that network (sent-txs.ts): a dApp can
//             build its next transaction on them before they're on chain.
//             What the user locked, and the collateral, stay out of a site's
//             transaction as out of the wallet's own: one that uses them is
//             refused (`keptApart`), and so is one that uses what a Lovejoin
//             chain still being sent needs (`heldForLovejoin`), on the public
//             account and in a session. `signData` is CIP-8, with the address's key.
// Sending     `submitTx` goes through Koios, as the wallet's own sends do,
//             and what it spends is remembered (spent.ts).
// Limits      What a site asks for without the user costs the wallet little:
//             calls at the same time share one reading of the account; a
//             site gets a few fresh readings, UTxO lookups and submits a
//             minute (`PER_MINUTE`) and 32 calls running at once; and a
//             transaction or data over 64 KiB is refused unread.
// Private     A site can connect to a private session instead (chunk 15c,
//             private CIP-30): a one-time account funded from the private
//             balance (sessions.ts), chosen in the window. The funding is
//             built and sent from the window, and `enable()` answers once
//             Koios sees the money. Every call then reads and signs that
//             account, with the session's keys (its stake key `2/i` too):
//             the site sees an ordinary wallet, and never the public account.
//
// What sites wait for is kept in memory: a restarted worker has dropped the
// sites' ports too, so there's nothing to answer. The bridge's pings keep the
// worker running while the user reads a prompt.

import type { NetworkName } from "../networks";
import {
  APIError,
  DataSignError,
  TxSendError,
  TxSignError,
  type DappFailure,
  type DappMethod,
} from "../shared/dapp";
import type { DappApproval, DappAsk, DappSite, DappTxSummary, SessionOutSummary, TokenQuantity } from "../shared/rpc";
import { readAccountUtxos, type AccountDeps, type KeyPath, type PathedUtxo } from "./account";
import { bodyOutpoints, nestsWithin, txId } from "./cbor";
import type { CoinControlService } from "./coin-control";
import { SpentInputError, type KoiosUtxo } from "./koios";
import type { PreferencesService } from "./preferences";
import type { PrivateStore } from "./private-store";
import { recentlySent, SENT_KEEP_MS } from "./sent-txs";
import { SESSION_COLLATERAL, type SessionService } from "./sessions";
import { outpoint, rememberSpent, reservedSet, spentSet } from "./spent";
import { SESSION_BALANCES_PREFIX } from "./wallet";

/** chrome.storage.session, per network: the account as the connector last read it. */
export const SESSION_DAPP_VIEW = "seedelf.dapp.view.";
/** chrome.storage.session, per network: the account's outputs of the transactions it signed for sites. */
export const SESSION_DAPP_SIGNED = "seedelf.dapp.signed.";

/** How long a reading of the account answers sites. */
const VIEW_MS = 30_000;
/** How many signed transactions' outputs are kept for chaining (Lace keeps 32). */
const KEEP_SIGNED = 32;
/** A submitted transaction's outputs count in the balance until they're on chain, or this long. */
const INFLIGHT_MS = 10 * 60_000;
/** A signed transaction's outputs can be spent by the site's next one for this long, as the wallet's own sends' (sent-txs.ts). */
const CHAIN_MS = SENT_KEEP_MS;
/** Of a signed transaction's outputs, this many are kept for that. */
const MAX_CHAINED = 64;
/** After the window is closed while locked, a site's reads are refused for this long. */
const REFUSE_MS = 60_000;
/** At most this many calls from sites wait for the user at once. */
const MAX_WAITING = 20;
/** How often a private session's funding is looked for, once it's sent. */
const FUNDING_POLL_MS = 10_000;
/** A funding Koios hasn't seen after this long never reached the chain. */
const FUNDING_WAIT_MS = 20 * 60_000;
/** CIP-30 caps collateral at 5 ₳. */
const MAX_COLLATERAL = 5_000_000n;
/**
 * The most of a site's bytes the wallet reads: a transaction to sign or send,
 * or data to sign. Four times Cardano's 16 KiB transaction limit, room for a
 * raise, as the WebAssembly's own check.
 */
const MAX_SITE_BYTES = 65_536;
/** At most this many of one site's calls run at once, all its pages together; more are refused. */
const MAX_SITE_CALLS = 32;
/**
 * What one site may make the worker ask Koios for, per minute, with nobody
 * asked: a fresh reading of the account (a transaction spends a UTxO the kept
 * one hasn't got), a lookup of UTxOs the account doesn't hold, a submit. A
 * site asking for more would use up the wallet's own share of Koios.
 */
const PER_MINUTE = { fresh: 4, lookup: 6, submit: 10 } as const;

/** A CIP-30 error, as the site sees it. */
export class DappError extends Error {
  constructor(readonly failure: DappFailure) {
    super("info" in failure ? failure.info : `page out of range (${failure.maxSize})`);
  }
}

const refused = (info: string) => new DappError({ code: APIError.Refused, info });
const invalid = (info: string) => new DappError({ code: APIError.InvalidRequest, info });

/** A site's page, as its port reached the worker. */
export interface DappSession {
  id: string;
  origin: string;
  title?: string;
}

/** The connector's window: shown when a site needs the user. */
export interface ApprovalWindow {
  show(): Promise<void>;
  /** Whether it's still open. */
  isOpen(): Promise<boolean>;
  /** Closes it, if it's open. */
  close(): Promise<void>;
}

export interface DappDeps extends AccountDeps {
  coins: CoinControlService;
  preferences: PreferencesService;
  store: PrivateStore;
  /** Private sessions: a site connected to one reads and signs its account. */
  sessions: SessionService;
  /** How often a private session's funding is looked for (tests: at once). */
  fundingPollMs?: number;
  /** The network the wallet is on now: the user's choice (Settings), read for each call. */
  network: () => NetworkName | Promise<NetworkName>;
  now: () => number;
  window: ApprovalWindow;
  /** Tells the connector's window that what's waiting changed. */
  changed: () => void;
}

/** A site's private session: its one-time account, instead of the public account. */
interface SessionAccount {
  index: number;
  address: string;
  reward: string;
  keyHash: string;
}

/** Who a connected site talks to: the public account (none), or its private session. */
type Holder = SessionAccount | undefined;

/** A connected site, as the sealed record keeps it. */
type Connected = DappSite & { network: NetworkName };

/** The account as the connector read it. */
interface View {
  keys: KeyPath[];
  utxos: PathedUtxo[];
  usedAddresses: string[];
  stake: string;
  readAt: number;
}

/** A signed transaction's outputs, for chaining. */
interface Signed {
  txHash: string;
  /** Its outputs to the account: what the site may spend (`getUtxos`) until they're on chain. */
  outputs: PathedUtxo[];
  /** Every output, to the account or not, to read a transaction built on it while `signedAt` is recent. */
  every?: KoiosUtxo[];
  signedAt?: number;
  /** When a site sent it through the wallet. */
  submittedAt?: number;
}

interface Waiting {
  approval: DappApproval;
  session: DappSession;
  /** The network it was asked on: declined once the wallet moves to another (`networkChanged`). */
  network: NetworkName;
  approve: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: DappError) => void;
  /** What the site hears when the user says no. */
  declined: DappFailure;
}

interface Unlocking {
  session: DappSession;
  resolve: () => void;
  reject: (error: DappError) => void;
}

type SignedTx = { witnessSet: string; summary: DappTxSummary };

const ALREADY_CONNECTED = "This site was connected meanwhile, by another of its requests. Disconnect it in Settings to give it a private session.";
/** What a site asking on the network the wallet left hears, and the window says. */
const NETWORK_LEFT = "Seedelf Wallet moved to another network in its settings, so this request was declined. Ask again.";

export class DappService {
  private readonly waiting: Waiting[] = [];
  private readonly unlocking: Unlocking[] = [];
  /** Sites whose reads are refused until then, after the user closed the window instead of unlocking. */
  private readonly refusedUntil = new Map<string, number>();
  /** How many of each site's calls are running. */
  private readonly running = new Map<string, number>();
  /** When each site made the worker ask Koios, by what for (`PER_MINUTE`): the last minute's. */
  private readonly asked = new Map<string, number[]>();
  /** Readings of an account under way, by its storage key: calls at the same time share one. */
  private readonly reading = new Map<string, Promise<View>>();
  /** The last change to the `dapps` record, which the next waits for (`changeSites`). */
  private sitesQueue: Promise<unknown> = Promise.resolve();
  /** The worker is closing the connector's window (`closeWindow`), not the user. */
  private closing = false;

  constructor(private readonly deps: DappDeps) {}

  /** A site's call. Throws a `DappError` for the site. */
  async call(session: DappSession, method: DappMethod, args: unknown[]): Promise<unknown> {
    const { origin } = session;
    const running = this.running.get(origin) ?? 0;
    if (running >= MAX_SITE_CALLS) throw refused("Seedelf Wallet is busy with this site's other requests.");
    this.running.set(origin, running + 1);
    try {
      return await this.run(session, method, args);
    } finally {
      const left = (this.running.get(origin) ?? 1) - 1;
      if (left > 0) this.running.set(origin, left);
      else this.running.delete(origin);
    }
  }

  private async run(session: DappSession, method: DappMethod, args: unknown[]): Promise<unknown> {
    const on = (await this.deps.preferences.get()).dappConnector;
    const { origin } = session;
    if (method === "isEnabled" && !on) return false;
    if (!on) throw refused("Connecting sites is off in Seedelf Wallet's settings.");
    if (method === "isEnabled") {
      return (await this.deps.wallet.state()) === "unlocked" && (await this.connected(await this.deps.network(), origin));
    }
    await this.unlocked(session, method);
    // The network the wallet is on as this call goes on: a site connected on
    // one isn't on the other, and what it asks is answered, and signed, there.
    const network = await this.deps.network();
    if (method === "enable") {
      if (!(await this.connected(network, origin))) {
        await this.ask(session, network, { kind: "connect", password: await this.needsPassword() }, APIError.Refused, () =>
          this.connect(network, origin),
        );
      }
      return true;
    }
    const site = await this.site(network, origin);
    if (!site) throw refused("This site isn't connected to Seedelf Wallet. Call enable() first.");
    const holder = await this.holder(network, site);
    switch (method) {
      case "getNetworkId":
        return network === "mainnet" ? 1 : 0;
      case "getExtensions":
        return [];
      case "getBalance":
        return this.balance(network, holder);
      case "getUtxos":
        return this.utxos(network, holder, args[0], args[1]);
      case "getCollateral":
        return this.collateral(network, holder, args[0]);
      case "getUsedAddresses":
        return paginate(await this.usedAddresses(network, holder), args[0]);
      case "getUnusedAddresses":
        return holder ? [] : this.unusedAddresses(network);
      case "getChangeAddress":
        return this.hexAddress(holder ? holder.address : await this.receiveAddress(network, 0));
      case "getRewardAddresses":
        return [this.hexAddress(holder ? holder.reward : (await this.view(network, undefined)).stake)];
      case "signTx":
        return this.signTx(session, network, holder, args[0], args[1] === true, await this.needsPassword());
      case "signData":
        return this.signData(session, network, holder, args[0], args[1], await this.needsPassword());
      case "submitTx":
        return this.submitTx(origin, network, holder, args[0]);
    }
    throw invalid("Seedelf Wallet doesn't know that method.");
  }

  // --- The user --------------------------------------------------------------

  /** What sites wait for, oldest first. */
  approvals(): DappApproval[] {
    return this.waiting.map((w) => w.approval);
  }

  /**
   * The user's answer to one; an approved one that fails says why, to the site
   * too. A signature that needs the password is checked first: a wrong or
   * missing one leaves it waiting, and the site hears nothing.
   */
  async answer(
    id: string,
    approve: boolean,
    password?: string,
    fund?: { txHash: string },
  ): Promise<{ error?: string }> {
    const asked = this.waiting.find((w) => w.approval.id === id);
    if (!asked) return { error: "The site stopped waiting for this." };
    const { approval } = asked;
    if (approval.kind === "connect" && approval.funding) return { error: "Its private session is funded already." };
    // Asked on the network the wallet has left: never signed or connected on the one it's on.
    if (asked.network !== (await this.deps.network())) {
      await this.networkChanged();
      return { error: NETWORK_LEFT };
    }
    // A signature, or a private session's funding, needs the password when the setting says so.
    const guarded = approval.kind === "connect" ? !!fund : true;
    if (approve && guarded && approval.password) {
      if (!password) return { error: approval.kind === "connect" ? "Type your password to send." : "Type your password to sign." };
      try {
        await this.deps.wallet.checkPassword(password);
      } catch (e) {
        return { error: (e as Error).message };
      }
    }
    if (approve && fund && approval.kind === "connect") return this.fundPrivate(asked, fund.txHash);
    // The site may have gone while the password was checked.
    const i = this.waiting.indexOf(asked);
    if (i < 0) return { error: "The site stopped waiting for this." };
    const [w] = this.waiting.splice(i, 1);
    this.deps.changed();
    if (!approve) {
      w!.reject(new DappError(w!.declined));
      return {};
    }
    try {
      w!.resolve(await w!.approve());
      return {};
    } catch (e) {
      const error = e instanceof DappError ? e : failed(w!.approval, e);
      w!.reject(error);
      return { error: error.message };
    }
  }

  /** The wallet's state changed: an unlock lets the waiting calls on. */
  async stateChanged(): Promise<void> {
    if (!this.unlocking.length || (await this.deps.wallet.state()) !== "unlocked") return;
    for (const u of this.unlocking.splice(0)) u.resolve();
    this.deps.changed();
  }

  /**
   * The connector's window has nothing left to show: the worker closes it,
   * unless something came in since it looked (false: it shows that). The
   * worker decides, as only it knows what's waiting this moment.
   */
  async closeWindow(): Promise<boolean> {
    if (this.waiting.length || this.unlocking.length) return false;
    this.closing = true;
    try {
      await this.deps.window.close();
    } catch (e) {
      this.closing = false;
      throw e;
    }
    return true;
  }

  /**
   * A window closed. If the user closed the connector's, everything waiting
   * is declined. If the worker did (`closeWindow`), what came in as it
   * closed is shown in a new one: a request is never declined unseen.
   */
  async windowClosed(): Promise<void> {
    if (!this.waiting.length && !this.unlocking.length) {
      if (this.closing && !(await this.deps.window.isOpen())) this.closing = false;
      return;
    }
    if (await this.deps.window.isOpen()) return;
    if (this.closing) {
      this.closing = false;
      try {
        await this.deps.window.show();
        return;
      } catch {
        // No window to show them in: they're declined, as if closed.
      }
    }
    const until = this.deps.now() + REFUSE_MS;
    for (const u of this.unlocking.splice(0)) {
      this.refusedUntil.set(u.session.origin, until);
      u.reject(refused("Seedelf Wallet is locked."));
    }
    // A private session's funding is sent: it isn't undone, and the site connects once it arrives.
    for (const w of this.waiting.filter((x) => !funding(x))) {
      remove(this.waiting, (x) => x === w);
      w.reject(new DappError(w.declined));
    }
  }

  /**
   * The wallet moved to another network (Settings): what sites asked on the
   * network it left is declined, as if the user had said no. A private
   * session's funding that's sent isn't undone: its site connects on the
   * network it was sent on, once it arrives, as when the window closes.
   */
  async networkChanged(): Promise<void> {
    const network = await this.deps.network();
    const left = this.waiting.filter((w) => w.network !== network && !funding(w));
    if (!left.length) return;
    for (const w of left) {
      remove(this.waiting, (x) => x === w);
      w.reject(new DappError({ ...w.declined, info: NETWORK_LEFT }));
    }
    this.deps.changed();
  }

  /** A site's page went away: nothing it asked for waits any more. */
  gone(session: DappSession): void {
    const before = this.waiting.length + this.unlocking.length;
    remove(this.waiting, (w) => w.session.id === session.id);
    remove(this.unlocking, (u) => u.session.id === session.id);
    if (this.waiting.length + this.unlocking.length !== before) this.deps.changed();
  }

  /** The sites connected on the network the wallet is on, each with its private session if it has one. Throws if locked. */
  async sites(): Promise<DappSite[]> {
    return this.sitesOn(await this.deps.network());
  }

  /** The sites connected on `network`. */
  private async sitesOn(network: NetworkName): Promise<DappSite[]> {
    const all = (await this.deps.store.get<Connected[]>("dapps")) ?? [];
    return all
      .filter((s) => s.network === network)
      .map(({ origin, connectedAt, session }) => ({ origin, connectedAt, ...(session === undefined ? {} : { session }) }))
      .sort((a, b) => a.origin.localeCompare(b.origin));
  }

  /**
   * Disconnects a site: its calls are refused until it connects again. A
   * site's private session ends with it, and only once its account is empty.
   */
  async forget(origin: string): Promise<DappSite[]> {
    const network = await this.deps.network();
    const site = await this.site(network, origin);
    if (site?.session !== undefined) await this.deps.sessions.disconnect(network, site.session);
    await this.changeSites((all) => all.filter((s) => !(s.origin === origin && s.network === network)));
    return this.sitesOn(network);
  }

  /**
   * Ends a site's private session, once its account is empty, and disconnects
   * whichever site has it. From the dApps page: a session whose funding never
   * reached the chain has no connected site to disconnect.
   */
  async disconnectSession(index: number): Promise<void> {
    const network = await this.deps.network();
    await this.deps.sessions.disconnect(network, index);
    await this.changeSites((all) => all.filter((s) => !(s.session === index && s.network === network)));
  }

  /**
   * Builds the funding of a private session for the site a waiting connect is
   * from: `lovelace` and `tokens` for it, and its collateral. `answer` with
   * the funding's hash sends it.
   */
  async privateBuild(id: string, lovelace: string, tokens: TokenQuantity[]): Promise<SessionOutSummary> {
    const w = this.waiting.find((x) => x.approval.id === id);
    if (!w || w.approval.kind !== "connect") throw new Error("The site stopped waiting for this.");
    if (w.approval.funding) throw new Error("Its private session is funded already.");
    if (w.network !== (await this.deps.network())) throw new Error(NETWORK_LEFT);
    if (await this.connected(w.network, w.session.origin)) throw new Error(ALREADY_CONNECTED);
    return this.deps.sessions.siteOutBuild(w.network, w.session.origin, lovelace, tokens);
  }

  private async site(network: NetworkName, origin: string): Promise<DappSite | undefined> {
    return (await this.sitesOn(network)).find((s) => s.origin === origin);
  }

  private async connected(network: NetworkName, origin: string): Promise<boolean> {
    return (await this.site(network, origin)) !== undefined;
  }

  /** Records a site as connected on `network`, to `session` if given; false when it's connected already. */
  private async connect(network: NetworkName, origin: string, session?: number): Promise<boolean> {
    let added = false;
    await this.changeSites((all) => {
      if (all.some((s) => s.origin === origin && s.network === network)) return all;
      added = true;
      const site: Connected = { origin, network, connectedAt: this.deps.now() };
      return [...all, session === undefined ? site : { ...site, session }];
    });
    return added;
  }

  /**
   * Changes the `dapps` record after every change before it: a connect and a
   * disconnect at once would otherwise each write over the other's.
   */
  private changeSites(change: (all: Connected[]) => Connected[]): Promise<void> {
    const run = this.sitesQueue.then(async () => {
      const all = (await this.deps.store.get<Connected[]>("dapps")) ?? [];
      const next = change(all);
      if (next !== all) await this.deps.store.set("dapps", next);
    });
    this.sitesQueue = run.catch(() => undefined);
    return run;
  }

  /** Who a connected site talks to: its private session's account, or the public account. */
  private async holder(network: NetworkName, site: DappSite): Promise<Holder> {
    if (site.session === undefined) return undefined;
    try {
      return { index: site.session, ...(await this.deps.sessions.siteAccount(network, site.session)) };
    } catch {
      throw refused("This site's private session is over. Disconnect it in Seedelf Wallet's settings, then connect it again.");
    }
  }

  /**
   * Sends a private session's funding for a waiting connect, records the site
   * as connected to it, and waits for the money to arrive before the site's
   * `enable()` answers. The window shows it waiting.
   */
  private async fundPrivate(w: Waiting, txHash: string): Promise<{ error?: string }> {
    // The network it was asked on, which `answer` checked the wallet is still on.
    const network = w.network;
    // Another of its requests connected it meanwhile (two tabs, or enable() twice):
    // the session wouldn't be the one the site talks to, so it isn't funded.
    if (await this.connected(network, w.session.origin)) return { error: ALREADY_CONNECTED };
    let index: number;
    try {
      ({ index } = await this.deps.sessions.siteOutSubmit(network, txHash, w.session.origin));
    } catch (e) {
      return { error: (e as Error).message };
    }
    if (!(await this.connect(network, w.session.origin, index))) {
      // Connected while the funding was sent: the site talks to that, so its
      // enable() has its answer, and the session's money waits on the dApps page.
      remove(this.waiting, (x) => x === w);
      w.resolve(true);
      this.deps.changed();
      return {
        error: `Private session ${index + 1} is funded, but another of this site's requests connected it meanwhile, so the site won't use that session. Its money is on the dApps page, under Sites: bring it back from there.`,
      };
    }
    w.approval = { ...w.approval, funding: { index, txHash } } as DappApproval;
    this.deps.changed();
    void this.watchFunding(w, index);
    return {};
  }

  /** Looks for a private session's funding every 10 s; once it's there, the site's `enable()` answers. */
  private async watchFunding(w: Waiting, index: number): Promise<void> {
    const { sessions, now } = this.deps;
    const network = w.network;
    const started = now();
    const pause = this.deps.fundingPollMs ?? FUNDING_POLL_MS;
    const done = (settle: () => void) => {
      if (!this.waiting.includes(w)) return;
      remove(this.waiting, (x) => x === w);
      settle();
      this.deps.changed();
    };
    try {
      const { keyHash } = await sessions.siteAccount(network, index);
      // The site went away meanwhile: it finds itself connected next time.
      while (this.waiting.includes(w)) {
        const rows = await sessions.accountUtxos(network, keyHash).catch(() => []);
        if (rows.length) return done(() => w.resolve(true));
        if (now() - started > FUNDING_WAIT_MS) {
          return done(() => w.reject(refused("The private session's funding never reached the chain.")));
        }
        await new Promise((r) => setTimeout(r, pause));
      }
    } catch (e) {
      done(() => w.reject(new DappError({ code: APIError.InternalError, info: (e as Error).message })));
    }
  }

  /** Whether a site's signature asks for the password: the setting. */
  private async needsPassword(): Promise<boolean> {
    return (await this.deps.preferences.get()).dappPassword;
  }

  /** Waits for the wallet to be unlocked, in the connector's window. */
  private async unlocked(session: DappSession, method: DappMethod): Promise<void> {
    if ((await this.deps.wallet.state()) === "unlocked") return;
    const refusedUntil = this.refusedUntil.get(session.origin) ?? 0;
    if (method !== "enable" && this.deps.now() < refusedUntil) throw refused("Seedelf Wallet is locked.");
    if (this.unlocking.length + this.waiting.length >= MAX_WAITING) throw refused("Seedelf Wallet is busy with this site's other requests.");
    let waiter: Unlocking | undefined;
    const unlocked = new Promise<void>((resolve, reject) => this.unlocking.push((waiter = { session, resolve, reject })));
    try {
      await this.deps.window.show();
    } catch (e) {
      // No window to unlock in: nothing waits for one.
      remove(this.unlocking, (u) => u === waiter);
      throw e;
    }
    this.deps.changed();
    return unlocked;
  }

  /** Puts a request in front of the user; `approve` runs if they say yes. */
  private ask<T>(session: DappSession, network: NetworkName, request: DappAsk, declined: number, approve: () => Promise<T>): Promise<T> {
    if (this.waiting.length >= MAX_WAITING) throw refused("Seedelf Wallet is busy with this site's other requests.");
    // Random, not a count: a count starts again when the worker restarts, and a
    // window still showing an older request would then answer a new one.
    const approval = { ...request, id: crypto.randomUUID(), origin: session.origin, title: session.title } as DappApproval;
    const failure: DappFailure = { code: declined, info: "The user declined." };
    const answered = new Promise<T>((resolve, reject) => {
      this.waiting.push({
        approval,
        session,
        network,
        approve,
        resolve: resolve as (value: unknown) => void,
        reject,
        declined: failure,
      });
    });
    this.deps.changed();
    this.deps.window.show().catch((e: unknown) => {
      // No window to answer in: the site hears why, rather than waiting.
      const i = this.waiting.findIndex((w) => w.approval === approval);
      if (i >= 0) this.waiting.splice(i, 1)[0]!.reject(new DappError({ code: APIError.InternalError, info: String(e) }));
    });
    return answered;
  }

  // --- Reading ---------------------------------------------------------------

  /**
   * The account, read at most every 30 s (or now, with `fresh`), less what
   * this wallet has spent since. Calls while it's being read wait for that
   * reading, so a site asking many things at once costs one.
   */
  private async view(network: NetworkName, holder: Holder, fresh = false): Promise<View> {
    const { wallet, session, now } = this.deps;
    const key = SESSION_DAPP_VIEW + network + suffix(holder);
    const [kept, spent] = await wallet.withKeys(async () => [await session.get<View>(key), await spentSet(session)] as const);
    if (kept && !fresh && now() - kept.readAt < VIEW_MS) {
      return { ...kept, utxos: kept.utxos.filter((p) => !spent.has(outpoint(p.utxo))) };
    }
    let reading = this.reading.get(key);
    if (!reading) {
      reading = this.read(network, holder, key, spent).finally(() => this.reading.delete(key));
      this.reading.set(key, reading);
    }
    return reading;
  }

  private async read(network: NetworkName, holder: Holder, key: string, spent: ReadonlySet<string>): Promise<View> {
    const { wallet, session, now } = this.deps;
    let view: View;
    if (holder) {
      // The session's one account: its one address, its key `0/i`, its own stake key.
      const rows = await this.deps.sessions.accountUtxos(network, holder.keyHash);
      view = {
        keys: [{ role: 0, index: holder.index }],
        utxos: rows.map((utxo) => ({ role: 0, index: holder.index, utxo })),
        usedAddresses: [holder.address],
        stake: holder.reward,
        readAt: now(),
      };
    } else {
      const { account, utxos } = await readAccountUtxos(this.deps, network, spent);
      view = {
        keys: [...account.paths.values()],
        utxos,
        usedAddresses: account.usedAddresses,
        stake: account.stake,
        readAt: now(),
      };
    }
    await wallet.withKeys(() => session.set(key, view));
    return view;
  }

  private async signed(network: NetworkName, holder: Holder): Promise<Signed[]> {
    const key = SESSION_DAPP_SIGNED + network + suffix(holder);
    return (await this.deps.wallet.withKeys(() => this.deps.session.get<Signed[]>(key))) ?? [];
  }

  /**
   * What a site may spend: the account less what's locked and the
   * collateral, plus what sent transactions return that isn't on chain yet.
   */
  private async available(network: NetworkName, holder: Holder): Promise<{ utxos: PathedUtxo[]; collateral?: PathedUtxo }> {
    const view = await this.view(network, holder);
    const { spendable, collateral } = holder ? sessionCollateral(view.utxos) : await this.deps.coins.account(network, view.utxos);
    const [signed, spent] = await Promise.all([
      this.signed(network, holder),
      this.deps.wallet.withKeys(() => spentSet(this.deps.session)),
    ]);
    const seen = new Set(view.utxos.map((p) => outpoint(p.utxo)));
    const since = this.deps.now() - INFLIGHT_MS;
    const inflight = signed
      .filter((s) => s.submittedAt !== undefined && s.submittedAt > since)
      .flatMap((s) => s.outputs)
      .filter((p) => !seen.has(outpoint(p.utxo)) && !spent.has(outpoint(p.utxo)));
    return { utxos: [...spendable, ...inflight], collateral };
  }

  private async balance(network: NetworkName, holder: Holder): Promise<string> {
    const { utxos } = await this.available(network, holder);
    let lovelace = 0n;
    const tokens = new Map<string, bigint>();
    for (const { utxo } of utxos) {
      lovelace += BigInt(utxo.value);
      for (const a of utxo.asset_list ?? []) {
        const key = `${a.policy_id}.${a.asset_name}`;
        tokens.set(key, (tokens.get(key) ?? 0n) + BigInt(a.quantity));
      }
    }
    const list = [...tokens].map(([key, quantity]) => {
      const [policyId, assetName] = key.split(".") as [string, string];
      return { policyId, assetName, quantity: quantity.toString() };
    });
    return this.deps.wasm.cip30Value(lovelace.toString(), JSON.stringify(list));
  }

  private encode(utxos: PathedUtxo[]): string[] {
    return this.deps.wasm.cip30Utxos(JSON.stringify(utxos.map((p) => p.utxo)));
  }

  private async utxos(network: NetworkName, holder: Holder, amount: unknown, page: unknown): Promise<string[] | null> {
    const { utxos } = await this.available(network, holder);
    if (amount === undefined || amount === null) return paginate(this.encode(largestFirst(utxos)), page);
    const wanted = this.readAmount(amount);
    const picked = cover(utxos, wanted);
    return picked ? paginate(this.encode(picked), page) : null;
  }

  private async collateral(network: NetworkName, holder: Holder, params: unknown): Promise<string[] | null> {
    const { collateral } = await this.available(network, holder);
    if (!collateral) return null;
    const amount = (params as { amount?: unknown } | null | undefined)?.amount;
    if (amount !== undefined && amount !== null) {
      const { lovelace } = this.readAmount(amount);
      if (lovelace > MAX_COLLATERAL || lovelace > BigInt(collateral.utxo.value)) return null;
    }
    return this.encode([collateral]);
  }

  private readAmount(amount: unknown): Wanted {
    // CIP-30 passes CBOR; some dApps pass a plain number of lovelace.
    const text = typeof amount === "number" || typeof amount === "bigint" ? cborUint(BigInt(amount)) : amount;
    if (typeof text !== "string") throw invalid("The amount isn't a CBOR value.");
    try {
      const read = JSON.parse(this.deps.wasm.cip30ReadValue(text)) as { lovelace: string; tokens: Wanted["tokens"] };
      return { lovelace: BigInt(read.lovelace), tokens: read.tokens };
    } catch (e) {
      throw invalid((e as Error).message);
    }
  }

  private hexAddress(bech32: string): string {
    return this.deps.wasm.cip30Address(bech32);
  }

  private async receiveAddress(network: NetworkName, index: number): Promise<string> {
    const net = network === "mainnet" ? this.deps.wasm.Network.Mainnet : this.deps.wasm.Network.Preprod;
    return this.deps.wallet.withKeys(({ cardano }) => cardano.receiveAddress(net, index));
  }

  /** The used addresses, `0/0` first: it's the one the wallet shows, and where every change goes. A session has one. */
  private async usedAddresses(network: NetworkName, holder: Holder): Promise<string[]> {
    if (holder) return [this.hexAddress(holder.address)];
    const first = await this.receiveAddress(network, 0);
    const view = await this.view(network, undefined);
    return [first, ...view.usedAddresses.filter((a) => a !== first)].map((a) => this.hexAddress(a));
  }

  /** The first receive address after `0/0` that's never been used. */
  private async unusedAddresses(network: NetworkName): Promise<string[]> {
    const used = new Set((await this.view(network, undefined)).usedAddresses);
    for (let i = 1; i < 20; i++) {
      const address = await this.receiveAddress(network, i);
      if (!used.has(address)) return [this.hexAddress(address)];
    }
    return [];
  }

  // --- Signing and sending ---------------------------------------------------

  /**
   * The UTxOs a transaction spends, as far as the wallet can find them: the
   * account's, the outputs of transactions it signed for the site, and of
   * those the wallet sent itself on this network in the last few minutes
   * (sent-txs.ts: a Send's change, a session's funding or top-up), none of
   * which Koios lists before they're on chain; then the account read again
   * if one is missing, and Koios for the rest (one request). The WebAssembly won't
   * have a payment key sign over one it can't find. A site gets a few fresh
   * readings and lookups a minute (`PER_MINUTE`): past them, the kept
   * reading does, and a lookup is refused.
   */
  private async resolve(
    network: NetworkName,
    holder: Holder,
    origin: string,
    refs: string[],
  ): Promise<{ view: View; rows: KoiosUtxo[] }> {
    const since = this.deps.now() - CHAIN_MS;
    const signed = (await this.signed(network, holder)).flatMap((s) => [
      ...(s.signedAt !== undefined && s.signedAt > since ? (s.every ?? []) : []),
      ...s.outputs.map((p) => p.utxo),
    ]);
    const sent = await this.sentOutputs(network, refs);
    const find = (view: View) => {
      // What Koios lists wins over what the wallet kept.
      const known = new Map([...sent, ...signed, ...view.utxos.map((p) => p.utxo)].map((u) => [outpoint(u), u]));
      return { found: refs.flatMap((r) => known.get(r) ?? []), missing: refs.filter((r) => !known.has(r)) };
    };
    let view = await this.view(network, holder);
    let { found, missing } = find(view);
    if (missing.length && this.allow(origin, "fresh")) {
      view = await this.view(network, holder, true);
      ({ found, missing } = find(view));
    }
    if (missing.length && !this.allow(origin, "lookup")) {
      throw refused("This site asks Seedelf Wallet to look up UTxOs too often. Try again in a minute.");
    }
    const others = missing.length ? await this.deps.koios(network).utxoInfo(missing) : [];
    return { view, rows: [...found, ...others] };
  }

  /**
   * What the user keeps out of payments stays out of a site's too. On the
   * public account, a transaction that spends a UTxO the user locked, puts
   * one up as collateral, or spends the collateral as an ordinary input is
   * refused: the lock was put there on purpose, and a spend ties that UTxO's
   * history to the rest for good. Unlocking it, or reclaiming the
   * collateral, is how the user means it. A session has no locks, and
   * nothing in it is kept from its site: its collateral spent as an input is
   * named in the prompt instead (the answer).
   */
  private async keptApart(
    network: NetworkName,
    holder: Holder,
    view: View,
    inputs: string[],
    collateral: string[],
  ): Promise<boolean> {
    if (holder) {
      const kept = sessionCollateral(view.utxos).collateral;
      return !!kept && inputs.includes(outpoint(kept.utxo));
    }
    const [choices, { collateral: kept }] = await Promise.all([
      this.deps.coins.choices(network),
      this.deps.coins.account(network, view.utxos),
    ]);
    const locked = new Set(choices.cardano);
    const used = [...new Set([...inputs, ...collateral])].filter((o) => locked.has(o));
    if (used.length) {
      const [first] = used;
      const them = used.length === 1 ? "it" : "them";
      throw new DappError({
        code: TxSignError.ProofGeneration,
        info: `This transaction uses ${used.length === 1 ? `a UTxO you locked (${first})` : `${used.length} UTxOs you locked (${first} and ${used.length - 1} more)`}. A lock keeps a UTxO out of every payment, so the wallet won't sign it. Unlock ${them} on the Public UTxOs screen first if you mean to spend ${them}.`,
      });
    }
    if (kept && inputs.includes(outpoint(kept.utxo))) {
      throw new DappError({
        code: TxSignError.ProofGeneration,
        info: `This transaction spends your collateral (${outpoint(kept.utxo)}) as an ordinary payment, so the wallet won't sign it. Reclaim it in Settings, under Collateral, first if you mean to spend it.`,
      });
    }
    return false;
  }

  /**
   * What a Lovejoin chain still being sent needs stays out of a site's
   * transaction, on the public account and in a session alike (spent.ts's
   * reservations): its next step would be refused as a double spend, and the
   * chain would stop partway, its boxes less mixed. The view leaves those
   * UTxOs out already, but a site can still name one it read before, or found
   * elsewhere. The chain's collateral may still be put up as collateral
   * (`getCollateral` gives it on the public account), only never spent. A
   * chain built and kept for Send holds nothing here, and one that's done or
   * stopped lets go. Refused before anything is looked up.
   */
  private async heldForLovejoin(network: NetworkName, inputs: string[], collateral: string[]): Promise<void> {
    const { wallet, session } = this.deps;
    const held = await wallet.withKeys(() => reservedSet(session, network, { sending: true }));
    const used = [
      ...new Set([
        ...inputs.filter((o) => held.inputs.has(o) || held.collateral.has(o)),
        ...collateral.filter((o) => held.inputs.has(o)),
      ]),
    ];
    if (!used.length) return;
    const [first] = used;
    throw new DappError({
      code: TxSignError.ProofGeneration,
      info: `This transaction uses ${used.length === 1 ? `a UTxO (${first})` : `${used.length} UTxOs (${first} and ${used.length - 1} more)`} that a chain still being sent through Lovejoin needs, so the wallet won't sign it: the rest of that chain would be refused. Wait for it to finish, then try again.`,
    });
  }

  /**
   * The outputs among `refs` of transactions the wallet sent on `network` in
   * the last few minutes. Never the other network's: the account's keys are
   * the same on both, so its UTxO there would be signed for as the account's.
   */
  private async sentOutputs(network: NetworkName, refs: string[]): Promise<KoiosUtxo[]> {
    const { wallet, session, wasm } = this.deps;
    const hashes = new Set(refs.map((r) => r.slice(0, r.indexOf("#"))));
    const sent = (await wallet.withKeys(() => recentlySent(session, network))).filter((s) => hashes.has(s.txHash));
    // A site's own submit is kept there too: WebAssembly's decoder reads it only if it isn't nested too deep.
    return sent.flatMap((s) => (nestsWithin(hexBytes(s.txCbor)) ? outputsOf(wasm, s.txCbor) : []));
  }

  /** Whether a site may make the worker ask Koios for `what` now, and counts it if so. */
  private allow(origin: string, what: keyof typeof PER_MINUTE): boolean {
    const key = `${what} ${origin}`;
    const now = this.deps.now();
    const recent = (this.asked.get(key) ?? []).filter((t) => now - t < 60_000);
    const allowed = recent.length < PER_MINUTE[what];
    if (allowed) recent.push(now);
    this.asked.set(key, recent);
    return allowed;
  }

  private async signTx(
    session: DappSession,
    network: NetworkName,
    holder: Holder,
    tx: unknown,
    partialSign: boolean,
    password: boolean,
  ): Promise<string> {
    const bytes = txBytes(tx);
    let inputs: string[];
    let collateral: string[];
    try {
      inputs = bodyOutpoints(bytes, 0) ?? [];
      collateral = bodyOutpoints(bytes, 13) ?? [];
    } catch {
      throw invalid("The wallet can't read this transaction.");
    }
    await this.heldForLovejoin(network, inputs, collateral);
    const { view, rows } = await this.resolve(network, holder, session.origin, [...new Set([...inputs, ...collateral])]);
    const collateralSpent = await this.keptApart(network, holder, view, inputs, collateral);
    const request = JSON.stringify({
      network,
      txCbor: tx,
      keys: view.keys,
      inputs: rows,
      partialSign,
      stakeIndex: holder?.index ?? 0,
    });
    const { wasm, wallet } = this.deps;
    const whose = holder ? "this private session's" : "the public account's";
    let summary: DappTxSummary;
    try {
      summary = await wallet.withKeys(
        ({ cardano, oneTime }) =>
          JSON.parse(holder ? wasm.inspectSessionTx(oneTime, request) : wasm.inspectDappTx(cardano, request)) as DappTxSummary,
      );
    } catch (e) {
      const info = (e as Error).message;
      throw new DappError(
        info.startsWith("The wallet can't read") || info.startsWith("bad request")
          ? { code: APIError.InvalidRequest, info }
          : { code: TxSignError.ProofGeneration, info },
      );
    }
    if (!summary.signs.length) {
      throw new DappError({ code: TxSignError.ProofGeneration, info: `Nothing in this transaction is ${whose} to sign.` });
    }
    if (!partialSign && !summary.complete) {
      throw new DappError({
        code: TxSignError.ProofGeneration,
        info: `This transaction needs signatures the wallet can't give: it spends or is signed for by keys that aren't ${whose}.`,
      });
    }
    // A session's stake key is never registered (privacy.md): its return and
    // Disconnect read UTxOs only, so a deposit or rewards under it would be
    // left behind for good. Stopping it stays possible.
    if (holder && summary.certificates.some((c) => c.own && c.kind !== "unregister")) {
      throw new DappError({
        code: TxSignError.ProofGeneration,
        info: "This transaction registers or delegates this private session's stake key, which stays unregistered: its deposit and any rewards would be left behind when the session ends, so the wallet won't sign it. Stake, or delegate your vote, from your public account instead.",
      });
    }
    const ask: DappAsk = {
      kind: "sign-tx",
      partial: partialSign,
      summary,
      password,
      ...sessionOf(holder),
      ...(collateralSpent ? { collateralSpent } : {}),
    };
    return this.ask(session, network, ask, TxSignError.UserDeclined, async () => {
      const signed = await wallet.withKeys(
        ({ cardano, oneTime }) =>
          JSON.parse(holder ? wasm.signSessionTx(oneTime, request) : wasm.signDappTx(cardano, request)) as SignedTx,
      );
      await this.remember(network, holder, signed.summary, (tx as string).trim());
      return signed.witnessSet;
    });
  }

  /**
   * Keeps a signed transaction's outputs for the site's next transaction:
   * those to the account for it to spend, and every one (the first 64) for a
   * while, so one built on it can be read before it's on chain.
   */
  private async remember(network: NetworkName, holder: Holder, summary: DappTxSummary, txCbor: string): Promise<void> {
    const outputs: PathedUtxo[] = summary.ownOutputs.map((o) => ({
      role: o.role as 0 | 1,
      index: o.index,
      utxo: {
        tx_hash: summary.txHash,
        tx_index: o.txIndex,
        address: o.address,
        value: o.lovelace,
        stake_address: null,
        payment_cred: null,
        block_height: null,
        inline_datum: o.inlineDatum ? { bytes: o.inlineDatum, value: null } : null,
        datum_hash: o.datumHash,
        asset_list: o.tokens.map((t) => ({
          policy_id: t.policyId,
          asset_name: t.assetName,
          quantity: t.quantity,
          decimals: 0,
          fingerprint: "",
        })),
      },
    }));
    const { wallet, session, wasm, now } = this.deps;
    // WebAssembly has read it already, so it isn't nested too deep.
    const every = outputsOf(wasm, txCbor).slice(0, MAX_CHAINED);
    await wallet.withKeys(async () => {
      const key = SESSION_DAPP_SIGNED + network + suffix(holder);
      const kept = (await session.get<Signed[]>(key)) ?? [];
      const since = now() - CHAIN_MS;
      const next: Signed[] = [
        // Older ones' outputs to others go once they can't be chained on.
        ...kept
          .filter((s) => s.txHash !== summary.txHash)
          .map(({ every: all, ...s }) => (s.signedAt !== undefined && s.signedAt > since ? { ...s, every: all } : s)),
        { txHash: summary.txHash, outputs, every, signedAt: now() },
      ];
      await session.set(key, next.slice(-KEEP_SIGNED));
    });
  }

  private async signData(
    session: DappSession,
    network: NetworkName,
    holder: Holder,
    address: unknown,
    payload: unknown,
    password: boolean,
  ): Promise<unknown> {
    if (typeof address !== "string") throw invalid("The address to sign with isn't a string.");
    if (typeof payload === "string" && payload.length > 2 * MAX_SITE_BYTES) {
      throw invalid("The data to sign is too long: Seedelf Wallet signs at most 64 KiB.");
    }
    const hex = typeof payload === "string" ? payload.trim() : "";
    if (!/^([0-9a-fA-F]{2})*$/.test(hex)) throw invalid("The data to sign isn't hex.");
    const { wasm, wallet } = this.deps;
    const view = await this.view(network, holder);
    const request = JSON.stringify({ network, keys: view.keys, address, payload: hex, stakeIndex: holder?.index ?? 0 });
    let signer: { address: string; key: "payment" | "stake" } | null;
    try {
      signer = await wallet.withKeys(
        ({ cardano, oneTime }) =>
          JSON.parse(holder ? wasm.sessionDataSigner(oneTime, request) : wasm.dataSigner(cardano, request)) as typeof signer,
      );
    } catch (e) {
      throw new DappError({ code: DataSignError.AddressNotPK, info: (e as Error).message });
    }
    if (!signer) {
      const whose = holder ? "this private session's" : "the public account's";
      throw new DappError({ code: DataSignError.ProofGeneration, info: `That address isn't ${whose}.` });
    }
    const text = readableText(hex);
    return this.ask(
      session,
      network,
      {
        kind: "sign-data",
        address: signer.address,
        key: signer.key,
        payload: hex,
        ...(text === undefined ? {} : { text }),
        password,
        ...sessionOf(holder),
      },
      DataSignError.UserDeclined,
      () =>
        wallet.withKeys(
          ({ cardano, oneTime }) =>
            JSON.parse(holder ? wasm.signSessionData(oneTime, request) : wasm.signDappData(cardano, request)) as unknown,
        ),
    );
  }

  private async submitTx(origin: string, network: NetworkName, holder: Holder, tx: unknown): Promise<string> {
    const bytes = txBytes(tx);
    let id: string;
    try {
      id = txId(bytes);
    } catch {
      throw invalid("The wallet can't read this transaction.");
    }
    if (!this.allow(origin, "submit")) {
      throw new DappError({
        code: TxSendError.Refused,
        info: "This site sends transactions through Seedelf Wallet too often. Try again in a minute.",
      });
    }
    const koios = this.deps.koios(network);
    try {
      await koios.submitTx(bytes);
    } catch (e) {
      // Sent already, by the site itself or an earlier call: that's a success.
      const status = e instanceof SpentInputError ? await koios.txStatus([id]).catch(() => undefined) : undefined;
      if (status?.get(id) == null) {
        throw new DappError({ code: TxSendError.Failure, info: (e as Error).message });
      }
    }
    const { wallet, session, now } = this.deps;
    await wallet.withKeys(async () => {
      await rememberSpent(session, network, bytes);
      const key = SESSION_DAPP_SIGNED + network + suffix(holder);
      const kept = (await session.get<Signed[]>(key)) ?? [];
      await session.set(
        key,
        kept.map((s) => (s.txHash === id ? { ...s, submittedAt: now() } : s)),
      );
      // Home reads the account again, to show what the site did.
      await session.remove(SESSION_BALANCES_PREFIX + network);
    });
    return id;
  }
}

/** What an approved request that failed tells the site. */
function failed(approval: DappApproval, e: unknown): DappError {
  const info = e instanceof Error ? e.message : String(e);
  const code =
    approval.kind === "sign-tx"
      ? TxSignError.ProofGeneration
      : approval.kind === "sign-data"
        ? DataSignError.ProofGeneration
        : APIError.InternalError;
  return new DappError({ code, info });
}

/** A private session's funding, sent and waiting for Koios to see it. */
const funding = (w: Waiting) => w.approval.kind === "connect" && !!w.approval.funding;

/** The session-storage key's ending for whose reading or signed outputs it is. */
const suffix = (holder: Holder) => (holder ? `:${holder.index}` : "");

/** A request's `session`, for a site connected to one. */
const sessionOf = (holder: Holder) => (holder ? { session: holder.index } : {});

/**
 * A private session's collateral: the funding's 5 ₳ of pure ADA, kept out of
 * what a site may spend, as the public account's is.
 */
function sessionCollateral(utxos: PathedUtxo[]): { spendable: PathedUtxo[]; collateral?: PathedUtxo } {
  const collateral = utxos.find((p) => BigInt(p.utxo.value) === SESSION_COLLATERAL && !p.utxo.asset_list?.length);
  return { spendable: utxos.filter((p) => p !== collateral), ...(collateral ? { collateral } : {}) };
}

function remove<T>(list: T[], drop: (item: T) => boolean): void {
  for (let i = list.length - 1; i >= 0; i--) if (drop(list[i]!)) list.splice(i, 1);
}

/** A transaction's output, as WebAssembly's `ogmiosUtxos` gives it (Ogmios v6). */
interface OgmiosUtxo {
  transaction: { id: string };
  index: number;
  address: string;
  /** `ada.lovelace`, and each policy's tokens by name. */
  value: Record<string, Record<string, number | string>>;
  datum?: string;
  datumHash?: string;
}

/** A transaction's outputs, as Koios lists UTxOs; none if it can't be read. */
function outputsOf(wasm: AccountDeps["wasm"], txCbor: string): KoiosUtxo[] {
  let rows: OgmiosUtxo[];
  try {
    // Amounts past 2^53 would lose digits as JSON numbers: read as text.
    rows = JSON.parse(wasm.ogmiosUtxos(txCbor).replace(/:(\d{16,})([,}])/g, ':"$1"$2')) as OgmiosUtxo[];
  } catch {
    return [];
  }
  return rows.map(({ transaction, index, address, value, datum, datumHash }) => ({
    tx_hash: transaction.id,
    tx_index: index,
    address,
    value: String(value.ada?.lovelace ?? 0),
    stake_address: null,
    payment_cred: null,
    block_height: null,
    inline_datum: datum ? { bytes: datum, value: null } : null,
    datum_hash: datumHash ?? null,
    asset_list: Object.entries(value)
      .filter(([policy]) => policy !== "ada")
      .flatMap(([policy, names]) =>
        Object.entries(names).map(([name, quantity]) => ({
          policy_id: policy,
          asset_name: name,
          quantity: String(quantity),
          decimals: 0,
          fingerprint: "",
        })),
      ),
  }));
}

const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

function hexOf(value: unknown, problem: string): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || !/^([0-9a-fA-F]{2})+$/.test(value.trim())) throw invalid(problem);
  return Uint8Array.from(value.trim().match(/../g)!, (h) => Number.parseInt(h, 16));
}

/**
 * A site's transaction, refused by its length before any of it is read: one
 * over 64 KiB is nothing Cardano would take, and reading it would only cost
 * the worker time and memory.
 */
function txBytes(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value === "string" && value.length > 2 * MAX_SITE_BYTES) {
    throw invalid("The wallet can't read this transaction: it's far larger than Cardano allows.");
  }
  return hexOf(value, "The transaction isn't hex.");
}

/** A whole number as CBOR, hex. */
function cborUint(n: bigint): string {
  if (n < 0n) throw invalid("The amount is negative.");
  const hex = (width: number) => n.toString(16).padStart(width, "0");
  if (n < 24n) return hex(2);
  if (n < 0x100n) return `18${hex(2)}`;
  if (n < 0x10000n) return `19${hex(4)}`;
  if (n < 0x100000000n) return `1a${hex(8)}`;
  return `1b${hex(16)}`;
}

/** The payload as text, when it's UTF-8 with nothing unprintable but line breaks and tabs. */
function readableText(hex: string): string | undefined {
  const bytes = Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ? undefined : text;
  } catch {
    return undefined;
  }
}

/** What a site asked `getUtxos` to cover. */
interface Wanted {
  lovelace: bigint;
  tokens: Array<{ policyId: string; assetName: string; quantity: string }>;
}

const largestFirst = (utxos: PathedUtxo[]) => [...utxos].sort((a, b) => Number(BigInt(b.utxo.value) - BigInt(a.utxo.value)));

/**
 * Enough UTxOs to cover `wanted`, or null: those holding each token first
 * (the most of it first), then ADA, largest first.
 */
export function cover(utxos: PathedUtxo[], wanted: Wanted): PathedUtxo[] | null {
  const picked = new Set<PathedUtxo>();
  const held = (p: PathedUtxo, t: Wanted["tokens"][number]) =>
    BigInt(p.utxo.asset_list?.find((a) => a.policy_id === t.policyId && a.asset_name === t.assetName)?.quantity ?? "0");
  for (const t of wanted.tokens) {
    let need = BigInt(t.quantity);
    for (const p of [...picked]) need -= held(p, t);
    const holders = utxos.filter((p) => !picked.has(p) && held(p, t) > 0n).sort((a, b) => Number(held(b, t) - held(a, t)));
    for (const p of holders) {
      if (need <= 0n) break;
      picked.add(p);
      need -= held(p, t);
    }
    if (need > 0n) return null;
  }
  let lovelace = wanted.lovelace;
  for (const p of picked) lovelace -= BigInt(p.utxo.value);
  for (const p of largestFirst(utxos.filter((u) => !picked.has(u)))) {
    if (lovelace <= 0n) break;
    picked.add(p);
    lovelace -= BigInt(p.utxo.value);
  }
  return lovelace > 0n ? null : [...picked];
}

/** CIP-30's `paginate`: `{ page, limit }`, pages from 0; past the end, a paginate error with how many there are. */
export function paginate<T>(items: T[], page: unknown): T[] {
  if (page === undefined || page === null) return items;
  const { page: n, limit } = page as { page?: unknown; limit?: unknown };
  if (!Number.isInteger(n) || !Number.isInteger(limit) || (n as number) < 0 || (limit as number) < 1) {
    throw invalid("paginate needs a page from 0 and a limit from 1.");
  }
  const start = (n as number) * (limit as number);
  if (start > 0 && start >= items.length) throw new DappError({ maxSize: items.length });
  return items.slice(start, start + (limit as number));
}
