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
import type { DappApproval, DappAsk, DappSite, DappTxSummary } from "../shared/rpc";
import { readAccountUtxos, type AccountDeps, type KeyPath, type PathedUtxo } from "./account";
import { bodyOutpoints, txId } from "./cbor";
import type { CoinControlService } from "./coin-control";
import { SpentInputError, type KoiosUtxo } from "./koios";
import type { PreferencesService } from "./preferences";
import type { PrivateStore } from "./private-store";
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
  network: NetworkName;
  now: () => number;
  window: ApprovalWindow;
  /** Tells the connector's window that what's waiting changed. */
  changed: () => void;
}

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
        await this.ask(session, { kind: "connect" }, APIError.Refused, () => this.connect(origin));
      }
      return true;
    }
    if (!(await this.connected(origin))) {
      throw refused("This site isn't connected to Seedelf Wallet. Call enable() first.");
    }
    const network = this.deps.network;
    switch (method) {
      case "getNetworkId":
        return network === "mainnet" ? 1 : 0;
      case "getExtensions":
        return [];
      case "getBalance":
        return this.balance(network);
      case "getUtxos":
        return this.utxos(network, args[0], args[1]);
      case "getCollateral":
        return this.collateral(network, args[0]);
      case "getUsedAddresses":
        return paginate(await this.usedAddresses(network), args[0]);
      case "getUnusedAddresses":
        return this.unusedAddresses(network);
      case "getChangeAddress":
        return this.hexAddress(await this.receiveAddress(network, 0));
      case "getRewardAddresses":
        return [this.hexAddress((await this.view(network)).stake)];
      case "signTx":
        return this.signTx(session, network, args[0], args[1] === true, await this.needsPassword());
      case "signData":
        return this.signData(session, network, args[0], args[1], await this.needsPassword());
      case "submitTx":
        return this.submitTx(network, args[0]);
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
  async answer(id: string, approve: boolean, password?: string): Promise<{ error?: string }> {
    const asked = this.waiting.find((w) => w.approval.id === id);
    if (!asked) return { error: "The site stopped waiting for this." };
    if (approve && asked.approval.kind !== "connect" && asked.approval.password) {
      if (!password) return { error: "Type your password to sign." };
      try {
        await this.deps.wallet.checkPassword(password);
      } catch (e) {
        return { error: (e as Error).message };
      }
    }
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
    for (const w of this.waiting.splice(0)) w.reject(new DappError(w.declined));
  }

  /** A site's page went away: nothing it asked for waits any more. */
  gone(session: DappSession): void {
    const before = this.waiting.length + this.unlocking.length;
    remove(this.waiting, (w) => w.session.id === session.id);
    remove(this.unlocking, (u) => u.session.id === session.id);
    if (this.waiting.length + this.unlocking.length !== before) this.deps.changed();
  }

  /** The sites connected on this network. Throws if locked. */
  async sites(): Promise<DappSite[]> {
    const all = (await this.deps.store.get<Array<DappSite & { network: NetworkName }>>("dapps")) ?? [];
    return all
      .filter((s) => s.network === this.deps.network)
      .map(({ origin, connectedAt }) => ({ origin, connectedAt }))
      .sort((a, b) => a.origin.localeCompare(b.origin));
  }

  /** Disconnects a site: its calls are refused until it connects again. */
  async forget(origin: string): Promise<DappSite[]> {
    const all = (await this.deps.store.get<Array<DappSite & { network: NetworkName }>>("dapps")) ?? [];
    await this.deps.store.set(
      "dapps",
      all.filter((s) => !(s.origin === origin && s.network === this.deps.network)),
    );
    return this.sites();
  }

  private async connected(origin: string): Promise<boolean> {
    return (await this.sites()).some((s) => s.origin === origin);
  }

  private async connect(origin: string): Promise<true> {
    const all = (await this.deps.store.get<Array<DappSite & { network: NetworkName }>>("dapps")) ?? [];
    if (!all.some((s) => s.origin === origin && s.network === this.deps.network)) {
      await this.deps.store.set("dapps", [...all, { origin, network: this.deps.network, connectedAt: this.deps.now() }]);
    }
    return true;
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
  private async view(network: NetworkName, fresh = false): Promise<View> {
    const { wallet, session, now } = this.deps;
    const [kept, spent] = await wallet.withKeys(async () => [
      await session.get<View>(SESSION_DAPP_VIEW + network),
      await spentSet(session),
    ] as const);
    if (kept && !fresh && now() - kept.readAt < VIEW_MS) {
      return { ...kept, utxos: kept.utxos.filter((p) => !spent.has(outpoint(p.utxo))) };
    }
    const { account, utxos } = await readAccountUtxos(this.deps, network, spent);
    const view: View = {
      keys: [...account.paths.values()],
      utxos,
      usedAddresses: account.usedAddresses,
      stake: account.stake,
      readAt: now(),
    };
    await wallet.withKeys(() => session.set(SESSION_DAPP_VIEW + network, view));
    return view;
  }

  private async signed(network: NetworkName): Promise<Signed[]> {
    return (await this.deps.wallet.withKeys(() => this.deps.session.get<Signed[]>(SESSION_DAPP_SIGNED + network))) ?? [];
  }

  /**
   * What a site may spend: the account less what's locked and the
   * collateral, plus what sent transactions return that isn't on chain yet.
   */
  private async available(network: NetworkName): Promise<{ utxos: PathedUtxo[]; collateral?: PathedUtxo }> {
    const view = await this.view(network);
    const { spendable, collateral } = await this.deps.coins.account(network, view.utxos);
    const [signed, spent] = await Promise.all([
      this.signed(network),
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

  private async balance(network: NetworkName): Promise<string> {
    const { utxos } = await this.available(network);
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

  private async utxos(network: NetworkName, amount: unknown, page: unknown): Promise<string[] | null> {
    const { utxos } = await this.available(network);
    if (amount === undefined || amount === null) return paginate(this.encode(largestFirst(utxos)), page);
    const wanted = this.readAmount(amount);
    const picked = cover(utxos, wanted);
    return picked ? paginate(this.encode(picked), page) : null;
  }

  private async collateral(network: NetworkName, params: unknown): Promise<string[] | null> {
    const { collateral } = await this.available(network);
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

  /** The used addresses, `0/0` first: it's the one the wallet shows, and where every change goes. */
  private async usedAddresses(network: NetworkName): Promise<string[]> {
    const first = await this.receiveAddress(network, 0);
    const view = await this.view(network);
    return [first, ...view.usedAddresses.filter((a) => a !== first)].map((a) => this.hexAddress(a));
  }

  /** The first receive address after `0/0` that's never been used. */
  private async unusedAddresses(network: NetworkName): Promise<string[]> {
    const used = new Set((await this.view(network)).usedAddresses);
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
  private async resolve(network: NetworkName, refs: string[]): Promise<{ view: View; rows: KoiosUtxo[] }> {
    const signed = (await this.signed(network)).flatMap((s) => s.outputs);
    const find = (view: View) => {
      const known = new Map([...view.utxos, ...signed].map((p) => [outpoint(p.utxo), p.utxo]));
      return { found: refs.flatMap((r) => known.get(r) ?? []), missing: refs.filter((r) => !known.has(r)) };
    };
    let view = await this.view(network);
    let { found, missing } = find(view);
    if (missing.length) {
      view = await this.view(network, true);
      ({ found, missing } = find(view));
    }
    const others = missing.length ? await this.deps.koios(network).utxoInfo(missing) : [];
    return { view, rows: [...found, ...others] };
  }

  private async signTx(
    session: DappSession,
    network: NetworkName,
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
    const { view, rows } = await this.resolve(network, [...new Set(refs)]);
    const request = JSON.stringify({ network, txCbor: tx, keys: view.keys, inputs: rows, partialSign });
    const { wasm, wallet } = this.deps;
    let summary: DappTxSummary;
    try {
      summary = await wallet.withKeys(({ cardano }) => JSON.parse(wasm.inspectDappTx(cardano, request)) as DappTxSummary);
    } catch (e) {
      const info = (e as Error).message;
      throw new DappError(
        info.startsWith("The wallet can't read") || info.startsWith("bad request")
          ? { code: APIError.InvalidRequest, info }
          : { code: TxSignError.ProofGeneration, info },
      );
    }
    if (!summary.signs.length) {
      throw new DappError({ code: TxSignError.ProofGeneration, info: "Nothing in this transaction is the public account's to sign." });
    }
    if (!partialSign && !summary.complete) {
      throw new DappError({
        code: TxSignError.ProofGeneration,
        info: "This transaction needs signatures the wallet can't give: it spends or is signed for by keys that aren't the public account's.",
      });
    }
    return this.ask(session, { kind: "sign-tx", partial: partialSign, summary, password }, TxSignError.UserDeclined, async () => {
      const signed = await wallet.withKeys(({ cardano }) => JSON.parse(wasm.signDappTx(cardano, request)) as SignedTx);
      await this.remember(network, signed.summary);
      return signed.witnessSet;
    });
  }

  /** Keeps a signed transaction's outputs to the account, for the site's next transaction. */
  private async remember(network: NetworkName, summary: DappTxSummary): Promise<void> {
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
      const kept = (await session.get<Signed[]>(SESSION_DAPP_SIGNED + network)) ?? [];
      const next = [...kept.filter((s) => s.txHash !== summary.txHash), { txHash: summary.txHash, outputs }];
      await session.set(SESSION_DAPP_SIGNED + network, next.slice(-KEEP_SIGNED));
    });
  }

  private async signData(
    session: DappSession,
    network: NetworkName,
    address: unknown,
    payload: unknown,
    password: boolean,
  ): Promise<unknown> {
    if (typeof address !== "string") throw invalid("The address to sign with isn't a string.");
    const hex = typeof payload === "string" ? payload.trim() : "";
    if (!/^([0-9a-fA-F]{2})*$/.test(hex)) throw invalid("The data to sign isn't hex.");
    const { wasm, wallet } = this.deps;
    const view = await this.view(network);
    const request = JSON.stringify({ network, keys: view.keys, address, payload: hex });
    let signer: { address: string; key: "payment" | "stake" } | null;
    try {
      signer = await wallet.withKeys(({ cardano }) => JSON.parse(wasm.dataSigner(cardano, request)) as typeof signer);
    } catch (e) {
      throw new DappError({ code: DataSignError.AddressNotPK, info: (e as Error).message });
    }
    if (!signer) throw new DappError({ code: DataSignError.ProofGeneration, info: "That address isn't the public account's." });
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
      },
      DataSignError.UserDeclined,
      () => wallet.withKeys(({ cardano }) => JSON.parse(wasm.signDappData(cardano, request)) as unknown),
    );
  }

  private async submitTx(network: NetworkName, tx: unknown): Promise<string> {
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
      const kept = (await session.get<Signed[]>(SESSION_DAPP_SIGNED + network)) ?? [];
      await session.set(
        SESSION_DAPP_SIGNED + network,
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
