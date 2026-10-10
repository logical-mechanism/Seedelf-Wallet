// Seedelf Wallet's own data layer (seedelf-data/, chunk 26): where the build
// has one (mainnet, networks.ts `dataOrigin`), the wallet reads and submits
// there first, and through Koios for a part that can't answer. Preprod, a
// build with no origin, and the Koios-only switch read Koios alone, as
// before.
//
// The fallback is per part, and each part goes on its own:
//
//   public   Koios's own routes, which the data layer answers in Koios's JSON
//            (one user's UTxOs, transactions, staking, pools, DReps, actions).
//   private  The private index (private-index.ts): the contract and
//            Lovejoin's pool, the same for whoever asks.
//   submit   `submittx` and `ogmios`.
//
// A part that fails stays on Koios for 5 minutes (or a 429's Retry-After, if
// longer), remembered in chrome.storage.session as Koios's own hold is, then
// the data layer is tried again. A call that fails runs again from its start
// on Koios: a paged read never mixes pages from two servers. What the screens
// show is unchanged: a data-layer failure is never shown, only Koios's own.

import { t } from "../i18n";
import { dataOrigin, NETWORKS, type NetworkName } from "../networks";
import {
  type Backend,
  type Failure,
  type FetchLike,
  Koios,
  KOIOS_LIMIT,
  KoiosBusyError,
  KoiosError,
  type KoiosUtxo,
  RateLimit,
  SpentInputError,
  SpentMaybeSentError,
} from "./koios";
import type { Area } from "./storage";

export type Part = "public" | "private" | "submit";

/** How long a part that failed stays on Koios. */
export const DOWN_MS = 5 * 60_000;

/** chrome.storage.session: until when each part stays on Koios (ms), by part. */
export const SESSION_DATA_DOWN = "seedelf.data.down";

/** A read's wait on the data layer: it answers in milliseconds, or from a shared answer at once. Koios's is 45 s. */
export const DATA_READ_TIMEOUT_MS = 10_000;

/** A submit's: the API's own 504 comes at 30 s, so it arrives first. */
export const DATA_SUBMIT_TIMEOUT_MS = 35_000;

/** The answers every wallet shares, which the edge charges 1 unit (seedelf-data README, The edge). */
const SHARED = new Set(["tip", "epoch_params", "totals", "pool_list", "proposal_list"]);

/**
 * What a request costs at the data layer's edge: 1 for a shared answer and
 * the private index, 10 for a submit or an evaluation, 4 for one user's live
 * SQL. The edge also charges a unit for every 16 KB sent, after.
 */
export function dataCost(path: string): number {
  if (path === "submittx" || path === "ogmios") return 10;
  if (SHARED.has(path) || path.includes("/")) return 1;
  return 4;
}

/**
 * The edge's bucket is 300 units, refilled at 10 a second (100 every 10 s).
 * The wallet keeps to 80 a window, under the refill, so even two workers
 * either side of a stop (koios.ts RateLimit) stay inside a full bucket.
 */
export const DATA_LIMIT = new RateLimit(80, 10_000);

/**
 * The data layer's `Backend`: short waits, no retries, every failure said,
 * and a POST's cache mode `default`, so its preflight is reused for as long
 * as the API's CORS allows (up to Chrome's 2 hours, in memory, keyed by its
 * address, never its body). A POST's answer is never cached, and the API
 * marks every answer `no-store`; a GET stays `no-store` (koios.ts).
 */
export const DATA_BACKEND: Backend = {
  readTimeoutMs: DATA_READ_TIMEOUT_MS,
  submitTimeoutMs: DATA_SUBMIT_TIMEOUT_MS,
  retries: false,
  cost: dataCost,
  postCache: "default",
};

/** The data layer needs no host permission: it answers the wallet's origin with CORS headers (networks.ts). */
const NO_GRANT_NEEDED = async () => true;

/** What a failure of a call means for its part: `down`, it stays on Koios a while; otherwise only this call goes. */
interface Fallback {
  down: boolean;
  /** A 429's Retry-After, held if longer than DOWN_MS. */
  holdMs?: number;
}

/** The data layer's answer to a credential with tens of thousands of UTxOs: Koios for this call alone. */
const TOO_LARGE = "too large for this server";

/** The data layer's answer to a request koios.ts doesn't make: a bug between the two. */
const NOT_OURS = "not a request Seedelf Wallet makes";

/** The failure a call to the data layer ended in, if it's one Koios may answer instead. */
export function failureOf(e: unknown): Failure | undefined {
  return e instanceof KoiosError ? e.failure : undefined;
}

/**
 * Whether a read that threw `e` goes to Koios, and whether its part goes
 * with it. Any failure of a read does: no answer, a timeout, a 5xx, a 429, a
 * 403 (an origin the API doesn't know), a 400 for a request it doesn't take,
 * or an answer that couldn't be read. "Too large" goes for that call only.
 */
export function readFallback(e: unknown): Fallback {
  const failure = failureOf(e);
  if (failure?.status === 503 && failure.error === TOO_LARGE) return { down: false };
  if (failure?.status === 400 && failure.error === NOT_OURS && import.meta.env.DEV) {
    console.warn("The data layer refused a request koios.ts made: the two disagree.", e);
  }
  return { down: true, ...(failure?.status === 429 && failure.retryAfterMs ? { holdMs: failure.retryAfterMs } : {}) };
}

/** Refused before anything reached the node: an origin it doesn't know, a body it won't take, too many at once. */
const NOT_SENT = new Set([403, 413, 415, 429, 503]);

/**
 * What a submit that failed at the data layer means: `koios`, it can't have
 * reached the node, so Koios is asked at once; `maybe`, it might have, and
 * it's maybe sent (pending.ts), as Koios's own lost answers are. A lost
 * connection with no status is taken as never sent, but what Koios then says
 * was spent may be this very transaction (`DataLayerKoios.submitTx`).
 */
export function submitFallback(failure: Failure): "koios" | "maybe" {
  if (failure.timeout) return "maybe";
  if (failure.status === undefined) return "koios";
  if (NOT_SENT.has(failure.status) || failure.error === "TxSubmitConnectionError") return "koios";
  return "maybe";
}

/** Whether each part is up, kept where a worker Chrome restarted still reads it. */
export class DataParts {
  private until: Partial<Record<Part, number>> = {};
  private restored?: Promise<void>;

  constructor(
    private readonly session?: Area,
    private readonly now: () => number = Date.now,
  ) {}

  /** Whether `part` may be asked of the data layer now. */
  async up(part: Part): Promise<boolean> {
    await this.restore();
    return (this.until[part] ?? 0) <= this.now();
  }

  /** `part` goes to Koios for DOWN_MS, or `holdMs` if longer. */
  async down(part: Part, holdMs = 0): Promise<void> {
    await this.restore();
    this.until[part] = Math.max(this.until[part] ?? 0, this.now() + Math.max(DOWN_MS, holdMs));
    await this.session?.set(SESSION_DATA_DOWN, this.until).catch(() => undefined);
  }

  private restore(): Promise<void> {
    this.restored ??= (async () => {
      const kept = await this.session?.get<Partial<Record<Part, number>>>(SESSION_DATA_DOWN).catch(() => undefined);
      for (const part of ["public", "private", "submit"] as const) {
        const at = kept?.[part];
        if (typeof at === "number") this.until[part] = Math.max(this.until[part] ?? 0, at);
      }
    })();
    return this.restored;
  }
}

export interface DataDeps {
  /** The Koios-only switch, read at each request (preferences.ts). */
  koiosOnly: () => Promise<boolean>;
  parts: DataParts;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Each server's limit: the worker's own, KOIOS_LIMIT and DATA_LIMIT, unless given; tests give none. */
  limits?: { koios?: RateLimit; data?: RateLimit };
}

/**
 * Koios's client, whose every call goes to the data layer first. The class
 * is Koios's, so every service takes it as it takes Koios; a call this
 * doesn't route goes to Koios, never the data layer.
 */
export class DataLayerKoios extends Koios {
  /** The same client, at the data layer: the same requests, which the API checks are koios.ts's. */
  readonly data: Koios;

  constructor(
    network: NetworkName,
    origin: string,
    private readonly deps: DataDeps,
  ) {
    super(NETWORKS[network].koios, deps.fetch, deps.sleep, undefined, deps.limits ? deps.limits.koios : KOIOS_LIMIT);
    const limit = deps.limits ? deps.limits.data : DATA_LIMIT;
    this.data = new Koios(`${origin}/api/v1`, deps.fetch, deps.sleep, NO_GRANT_NEEDED, limit, DATA_BACKEND);
  }

  /** Whether `part` goes to the data layer now: the switch is off, and the part is up. */
  async uses(part: Part): Promise<boolean> {
    return !(await this.deps.koiosOnly()) && (await this.deps.parts.up(part));
  }

  /** A read: on the data layer, or from its start on Koios. */
  private async read<R>(onData: (k: Koios) => Promise<R>, onKoios: () => Promise<R>): Promise<R> {
    if (!(await this.uses("public"))) return onKoios();
    try {
      return await onData(this.data);
    } catch (e) {
      const fallback = readFallback(e);
      if (fallback.down) await this.deps.parts.down("public", fallback.holdMs);
      return onKoios();
    }
  }

  override credentialUtxos(credentials: string[], after?: number): Promise<KoiosUtxo[]> {
    return this.read(
      (k) => k.credentialUtxos(credentials, after),
      () => super.credentialUtxos(credentials, after),
    );
  }

  override utxoInfo(refs: string[]) {
    return this.read((k) => k.utxoInfo(refs), () => super.utxoInfo(refs));
  }

  override datumInfo(hashes: string[]) {
    return this.read((k) => k.datumInfo(hashes), () => super.datumInfo(hashes));
  }

  override addressUtxos(addresses: string[]) {
    return this.read((k) => k.addressUtxos(addresses), () => super.addressUtxos(addresses));
  }

  override accountAddresses(stakeAddress: string) {
    return this.read((k) => k.accountAddresses(stakeAddress), () => super.accountAddresses(stakeAddress));
  }

  override usedStakeAddresses(stakeAddresses: string[]) {
    return this.read((k) => k.usedStakeAddresses(stakeAddresses), () => super.usedStakeAddresses(stakeAddresses));
  }

  override accountTxs(stakeAddress: string, page: { after?: number; offset?: number; limit?: number }) {
    return this.read((k) => k.accountTxs(stakeAddress, page), () => super.accountTxs(stakeAddress, page));
  }

  override txInfo(txHashes: string[]) {
    return this.read((k) => k.txInfo(txHashes), () => super.txInfo(txHashes));
  }

  override txSpends(txHashes: string[]) {
    return this.read((k) => k.txSpends(txHashes), () => super.txSpends(txHashes));
  }

  override accountInfo(stakeAddress: string) {
    return this.read((k) => k.accountInfo(stakeAddress), () => super.accountInfo(stakeAddress));
  }

  override poolList() {
    return this.read((k) => k.poolList(), () => super.poolList());
  }

  override supply() {
    return this.read((k) => k.supply(), () => super.supply());
  }

  override poolInfo(poolIds: string[]) {
    return this.read((k) => k.poolInfo(poolIds), () => super.poolInfo(poolIds));
  }

  override drepInfo(drepIds: string[]) {
    return this.read((k) => k.drepInfo(drepIds), () => super.drepInfo(drepIds));
  }

  override drepStanding(drepId: string) {
    return this.read((k) => k.drepStanding(drepId), () => super.drepStanding(drepId));
  }

  override drepProfile(drepId: string) {
    return this.read((k) => k.drepProfile(drepId), () => super.drepProfile(drepId));
  }

  override proposalList() {
    return this.read((k) => k.proposalList(), () => super.proposalList());
  }

  override drepVotes(drepId: string, proposalIds: string[]) {
    return this.read((k) => k.drepVotes(drepId, proposalIds), () => super.drepVotes(drepId, proposalIds));
  }

  override drepNames(drepIds: string[]) {
    return this.read((k) => k.drepNames(drepIds), () => super.drepNames(drepIds));
  }

  override epochParams() {
    return this.read((k) => k.epochParams(), () => super.epochParams());
  }

  override assetNftAddress(policyId: string, assetName: string) {
    return this.read((k) => k.assetNftAddress(policyId, assetName), () => super.assetNftAddress(policyId, assetName));
  }

  override assetInfo(policyId: string, assetName: string) {
    return this.read((k) => k.assetInfo(policyId, assetName), () => super.assetInfo(policyId, assetName));
  }

  override tipSlot() {
    return this.read((k) => k.tipSlot(), () => super.tipSlot());
  }

  override txStatus(txHashes: string[]) {
    return this.read((k) => k.txStatus(txHashes), () => super.txStatus(txHashes));
  }

  /**
   * Ogmios only measures, so any failure goes to Koios: the submit part's,
   * as it's the same upstream. A 400 is Ogmios's own answer (a script that
   * fails) only when it's JSON-RPC: the data layer's own refusal isn't.
   */
  override async evaluate(txCborHex: string, additionalUtxo?: unknown[]): Promise<unknown> {
    if (!(await this.uses("submit"))) return super.evaluate(txCborHex, additionalUtxo);
    try {
      const answer = await this.data.evaluate(txCborHex, additionalUtxo);
      if ((answer as { jsonrpc?: unknown } | null)?.jsonrpc === "2.0") return answer;
    } catch {
      // Below, as an answer that wasn't Ogmios's.
    }
    await this.deps.parts.down("submit");
    return super.evaluate(txCborHex, additionalUtxo);
  }

  /**
   * A submit goes to Koios at once when it can't have reached the node, and
   * is maybe sent (pending.ts) when it might have: the same signed
   * transaction is sent again later, through Koios while the part is down,
   * which the ledger takes once. Anything the node itself answered, through
   * the data layer, stands as Koios's would.
   */
  override async submitTx(txCbor: Uint8Array<ArrayBuffer>): Promise<string> {
    if (!(await this.uses("submit"))) return super.submitTx(txCbor);
    let failure: Failure;
    try {
      return await this.data.submitTx(txCbor);
    } catch (e) {
      const failed = failureOf(e);
      if (!failed) throw e;
      failure = failed;
    }
    await this.deps.parts.down("submit", failure.status === 429 ? failure.retryAfterMs : undefined);
    if (submitFallback(failure) === "maybe") {
      throw new KoiosBusyError(t("koios.dataNoAnswer"), true, "silent", failure);
    }
    try {
      return await super.submitTx(txCbor);
    } catch (e) {
      // A connection lost with no answer may have been lost after the transaction went out (a proxy's own 502
      // carries no CORS, and reads as one). What Koios then says is spent may be spent by this very one; and Koios
      // not answering at all (busy, its node down, no grant: an error with a `trouble`) says nothing of that first
      // try. Either is maybe sent, never refused (pending.ts settles it). The node's own refusal of the
      // transaction stands: it's the same transaction.
      if (failure.status === undefined) {
        if (e instanceof SpentInputError) throw new SpentMaybeSentError(e.message, true, "silent", failure);
        if (e instanceof KoiosBusyError || (e instanceof KoiosError && e.trouble !== undefined)) {
          throw new KoiosBusyError(t("koios.dataNoAnswer"), true, "silent", failure);
        }
      }
      throw e;
    }
  }
}

/**
 * The worker's Koios, one per call (sw.ts): the data layer's wrapper where
 * the network has one, plain Koios elsewhere. `origin` is the build's
 * (networks.ts `dataOrigin`); tests pass their own.
 */
export function chainClient(
  deps: DataDeps,
  origin: (network: NetworkName) => string | undefined = (n) => dataOrigin(n, __DATA_ORIGIN__),
): (network: NetworkName) => Koios {
  return (network) => {
    const at = origin(network);
    if (at) return new DataLayerKoios(network, at, deps);
    return new Koios(NETWORKS[network].koios, deps.fetch, deps.sleep, undefined, deps.limits ? deps.limits.koios : KOIOS_LIMIT);
  };
}
