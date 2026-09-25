// The dApp connector (CIP-30) in the worker, for the public account. The
// content scripts (shared/dapp.ts) bring each site's calls here, with the
// site's origin as Chrome reports it.
//
// Connecting  A site calls `enable()`; the connector's window asks the user
//             (unlocking first if need be). Connected sites are a sealed
//             private record (`dapps`), per network: which sites you use
//             says something about you. Settings lists them, to disconnect.
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
//             waiting and counts towards the unlock back-off. The account's
//             own outputs of every transaction it signs are kept (the last
//             32), so a dApp can build its next transaction on them before
//             they're on chain. `signData` is CIP-8, with the address's key.
// Sending     `submitTx` goes through Koios, as the wallet's own sends do,
//             and what it spends is remembered (spent.ts).
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
import { bodyOutpoints, txId } from "./cbor";
import type { CoinControlService } from "./coin-control";
import { SpentInputError, type KoiosUtxo } from "./koios";
import type { PreferencesService } from "./preferences";
import type { PrivateStore } from "./private-store";
import { SESSION_COLLATERAL, type SessionService } from "./sessions";
import { outpoint, rememberSpent, spentSet } from "./spent";
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
}

export interface DappDeps extends AccountDeps {
  coins: CoinControlService;
  preferences: PreferencesService;
  store: PrivateStore;
  /** Private sessions: a site connected to one reads and signs its account. */
  sessions: SessionService;
  /** How often a private session's funding is looked for (tests: at once). */
  fundingPollMs?: number;
  network: NetworkName;
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

/** A signed transaction's outputs to the account, for chaining. */
interface Signed {
  txHash: string;
  outputs: PathedUtxo[];
  /** When a site sent it through the wallet. */
  submittedAt?: number;
}

interface Waiting {
  approval: DappApproval;
  session: DappSession;
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

export class DappService {
  private readonly waiting: Waiting[] = [];
  private readonly unlocking: Unlocking[] = [];
  /** Sites whose reads are refused until then, after the user closed the window instead of unlocking. */
  private readonly refusedUntil = new Map<string, number>();
  private next = 0;

  constructor(private readonly deps: DappDeps) {}

  /** A site's call. Throws a `DappError` for the site. */
  async call(session: DappSession, method: DappMethod, args: unknown[]): Promise<unknown> {
    const on = (await this.deps.preferences.get()).dappConnector;
    const { origin } = session;
    if (method === "isEnabled" && !on) return false;
    if (!on) throw refused("Connecting sites is off in Seedelf Wallet's settings.");
    if (method === "isEnabled") {
      return (await this.deps.wallet.state()) === "unlocked" && (await this.connected(origin));
    }
    await this.unlocked(session, method);
    if (method === "enable") {
      if (!(await this.connected(origin))) {
        await this.ask(session, { kind: "connect", password: await this.needsPassword() }, APIError.Refused, () =>
          this.connect(origin),
        );
      }
      return true;
    }
    const site = await this.site(origin);
    if (!site) throw refused("This site isn't connected to Seedelf Wallet. Call enable() first.");
    const network = this.deps.network;
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
        return this.submitTx(network, holder, args[0]);
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

  /** A window closed: if it was the connector's, everything waiting is declined. */
  async windowClosed(): Promise<void> {
    if (!this.waiting.length && !this.unlocking.length) return;
    if (await this.deps.window.isOpen()) return;
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

  /** A site's page went away: nothing it asked for waits any more. */
  gone(session: DappSession): void {
    const before = this.waiting.length + this.unlocking.length;
    remove(this.waiting, (w) => w.session.id === session.id);
    remove(this.unlocking, (u) => u.session.id === session.id);
    if (this.waiting.length + this.unlocking.length !== before) this.deps.changed();
  }

  /** The sites connected on this network, each with its private session if it has one. Throws if locked. */
  async sites(): Promise<DappSite[]> {
    const all = (await this.deps.store.get<Connected[]>("dapps")) ?? [];
    return all
      .filter((s) => s.network === this.deps.network)
      .map(({ origin, connectedAt, session }) => ({ origin, connectedAt, ...(session === undefined ? {} : { session }) }))
      .sort((a, b) => a.origin.localeCompare(b.origin));
  }

  /**
   * Disconnects a site: its calls are refused until it connects again. A
   * site's private session ends with it, and only once its account is empty.
   */
  async forget(origin: string): Promise<DappSite[]> {
    const site = await this.site(origin);
    if (site?.session !== undefined) await this.deps.sessions.disconnect(this.deps.network, site.session);
    const all = (await this.deps.store.get<Connected[]>("dapps")) ?? [];
    await this.deps.store.set(
      "dapps",
      all.filter((s) => !(s.origin === origin && s.network === this.deps.network)),
    );
    return this.sites();
  }

  /**
   * Ends a site's private session, once its account is empty, and disconnects
   * whichever site has it. From the dApps page: a session whose funding never
   * reached the chain has no connected site to disconnect.
   */
  async disconnectSession(index: number): Promise<void> {
    await this.deps.sessions.disconnect(this.deps.network, index);
    const all = (await this.deps.store.get<Connected[]>("dapps")) ?? [];
    await this.deps.store.set(
      "dapps",
      all.filter((s) => !(s.session === index && s.network === this.deps.network)),
    );
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
    return this.deps.sessions.siteOutBuild(this.deps.network, w.session.origin, lovelace, tokens);
  }

  private async site(origin: string): Promise<DappSite | undefined> {
    return (await this.sites()).find((s) => s.origin === origin);
  }

  private async connected(origin: string): Promise<boolean> {
    return (await this.site(origin)) !== undefined;
  }

  private async connect(origin: string, session?: number): Promise<true> {
    const all = (await this.deps.store.get<Connected[]>("dapps")) ?? [];
    if (!all.some((s) => s.origin === origin && s.network === this.deps.network)) {
      const site: Connected = { origin, network: this.deps.network, connectedAt: this.deps.now() };
      await this.deps.store.set("dapps", [...all, session === undefined ? site : { ...site, session }]);
    }
    return true;
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
    const network = this.deps.network;
    let index: number;
    try {
      ({ index } = await this.deps.sessions.siteOutSubmit(network, txHash, w.session.origin));
    } catch (e) {
      return { error: (e as Error).message };
    }
    await this.connect(w.session.origin, index);
    w.approval = { ...w.approval, funding: { index, txHash } } as DappApproval;
    this.deps.changed();
    void this.watchFunding(w, index);
    return {};
  }

  /** Looks for a private session's funding every 10 s; once it's there, the site's `enable()` answers. */
  private async watchFunding(w: Waiting, index: number): Promise<void> {
    const { sessions, now, network } = this.deps;
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
  private ask<T>(session: DappSession, request: DappAsk, declined: number, approve: () => Promise<T>): Promise<T> {
    if (this.waiting.length >= MAX_WAITING) throw refused("Seedelf Wallet is busy with this site's other requests.");
    const approval = { ...request, id: `${++this.next}`, origin: session.origin, title: session.title } as DappApproval;
    const failure: DappFailure = { code: declined, info: "The user declined." };
    const answered = new Promise<T>((resolve, reject) => {
      this.waiting.push({
        approval,
        session,
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

  /** The account, read at most every 30 s (or now, with `fresh`), less what this wallet has spent since. */
  private async view(network: NetworkName, holder: Holder, fresh = false): Promise<View> {
    const { wallet, session, now } = this.deps;
    const key = SESSION_DAPP_VIEW + network + suffix(holder);
    const [kept, spent] = await wallet.withKeys(async () => [await session.get<View>(key), await spentSet(session)] as const);
    if (kept && !fresh && now() - kept.readAt < VIEW_MS) {
      return { ...kept, utxos: kept.utxos.filter((p) => !spent.has(outpoint(p.utxo))) };
    }
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
   * account's (read again if one is missing), its signed transactions'
   * outputs, then Koios for the rest (one request).
   */
  private async resolve(network: NetworkName, holder: Holder, refs: string[]): Promise<{ view: View; rows: KoiosUtxo[] }> {
    const signed = (await this.signed(network, holder)).flatMap((s) => s.outputs);
    const find = (view: View) => {
      const known = new Map([...view.utxos, ...signed].map((p) => [outpoint(p.utxo), p.utxo]));
      return { found: refs.flatMap((r) => known.get(r) ?? []), missing: refs.filter((r) => !known.has(r)) };
    };
    let view = await this.view(network, holder);
    let { found, missing } = find(view);
    if (missing.length) {
      view = await this.view(network, holder, true);
      ({ found, missing } = find(view));
    }
    const others = missing.length ? await this.deps.koios(network).utxoInfo(missing) : [];
    return { view, rows: [...found, ...others] };
  }

  private async signTx(
    session: DappSession,
    network: NetworkName,
    holder: Holder,
    tx: unknown,
    partialSign: boolean,
    password: boolean,
  ): Promise<string> {
    const bytes = hexOf(tx, "The transaction isn't hex.");
    let refs: string[];
    try {
      refs = [...(bodyOutpoints(bytes, 0) ?? []), ...(bodyOutpoints(bytes, 13) ?? [])];
    } catch {
      throw invalid("The wallet can't read this transaction.");
    }
    const { view, rows } = await this.resolve(network, holder, [...new Set(refs)]);
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
    const ask: DappAsk = { kind: "sign-tx", partial: partialSign, summary, password, ...sessionOf(holder) };
    return this.ask(session, ask, TxSignError.UserDeclined, async () => {
      const signed = await wallet.withKeys(
        ({ cardano, oneTime }) =>
          JSON.parse(holder ? wasm.signSessionTx(oneTime, request) : wasm.signDappTx(cardano, request)) as SignedTx,
      );
      await this.remember(network, holder, signed.summary);
      return signed.witnessSet;
    });
  }

  /** Keeps a signed transaction's outputs to the account, for the site's next transaction. */
  private async remember(network: NetworkName, holder: Holder, summary: DappTxSummary): Promise<void> {
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
    const { wallet, session } = this.deps;
    await wallet.withKeys(async () => {
      const key = SESSION_DAPP_SIGNED + network + suffix(holder);
      const kept = (await session.get<Signed[]>(key)) ?? [];
      const next = [...kept.filter((s) => s.txHash !== summary.txHash), { txHash: summary.txHash, outputs }];
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

  private async submitTx(network: NetworkName, holder: Holder, tx: unknown): Promise<string> {
    const bytes = hexOf(tx, "The transaction isn't hex.");
    let id: string;
    try {
      id = txId(bytes);
    } catch {
      throw invalid("The wallet can't read this transaction.");
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
      await rememberSpent(session, bytes);
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

function hexOf(value: unknown, problem: string): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || !/^([0-9a-fA-F]{2})+$/.test(value.trim())) throw invalid(problem);
  return Uint8Array.from(value.trim().match(/../g)!, (h) => Number.parseInt(h, 16));
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
