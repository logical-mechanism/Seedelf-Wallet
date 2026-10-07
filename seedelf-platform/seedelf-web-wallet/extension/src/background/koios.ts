// A small Koios REST client for the service worker, with only the queries the
// wallet needs. The contract query is the same one the CLI makes
// (seedelf-koios `credential_utxos`). Results are paged 1000 rows at a time in
// a fixed order, and rate limits or server errors are retried twice.

import { t } from "../i18n";
export interface KoiosAsset {
  policy_id: string;
  asset_name: string;
  quantity: string;
  decimals: number;
  fingerprint: string;
}

export interface KoiosUtxo {
  tx_hash: string;
  tx_index: number;
  address: string;
  /** Lovelace, as a decimal string. */
  value: string;
  stake_address: string | null;
  payment_cred: string | null;
  block_height: number | null;
  /** Unix seconds of the block that made it. */
  block_time?: number;
  /** The datum's CBOR (hex), and its JSON, which `trimmed` drops: registers are read from the bytes. */
  inline_datum: { bytes: string; value: unknown } | null;
  /** A datum by hash (older outputs); only the dApp connector reads it. */
  datum_hash?: string | null;
  asset_list: KoiosAsset[] | null;
  /**
   * The reference script it carries, if any. Anyone can send one; the
   * WebAssembly prices it, and a Seedelf spend can't take it yet.
   */
  reference_script?: KoiosScript | null;
}

/** A reference script as the wallet keeps it: Koios's, less its JSON `value` (`trimmed`). */
export interface KoiosScript {
  hash: string | null;
  /** Bytes. */
  size: number | null;
  /** `plutusV1`, `plutusV2`, `plutusV3`, `timelock` or `multisig`. */
  type: string | null;
  /** The script's CBOR, hex. */
  bytes: string | null;
}

const textOrNull = (v: unknown) => (typeof v === "string" ? v : null);

/**
 * A UTxO as the wallet keeps it, cut right after it's read: its datum's
 * JSON dropped, and its reference script cut to what prices it. Anyone can
 * pay an address an output whose datum or native script nests thousands of
 * levels deep. V8 parses that, but JSON.stringify, structuredClone and
 * chrome.storage overflow on it, and the WebAssembly refused a whole request
 * over it (launch review H4). Registers come from the datum's bytes
 * (chain.ts). A script is never cut to nothing: a UTxO holding one must
 * still read as holding one.
 */
export function trimmed(row: KoiosUtxo): KoiosUtxo {
  const datum = row.inline_datum as { bytes?: unknown } | null;
  const script = row.reference_script as Record<string, unknown> | null | undefined;
  return {
    ...row,
    inline_datum: datum ? { bytes: textOrNull(datum.bytes) ?? "", value: null } : null,
    ...(script == null
      ? {}
      : {
          reference_script: {
            hash: textOrNull(script.hash),
            size: typeof script.size === "number" ? script.size : null,
            type: textOrNull(script.type),
            bytes: textOrNull(script.bytes),
          },
        }),
  };
}

/**
 * Whether the wallet can price spending `u`: it holds no reference script,
 * or one Koios gives the bytes of, as long as it says it is (core's
 * `utxos::reference_script_size`). WebAssembly leaves the others out of
 * anything it builds, for good; the UTxOs screen says so.
 */
export function measurable(u: KoiosUtxo): boolean {
  const script = u.reference_script as { bytes?: unknown; size?: unknown } | null | undefined;
  if (!script) return true;
  const { bytes, size } = script;
  return typeof bytes === "string" && /^([0-9a-fA-F]{2})+$/.test(bytes) && (size == null || size === bytes.length / 2);
}

/** One of an account's transactions: `account_txs`. */
export interface KoiosAccountTx {
  tx_hash: string;
  block_height: number;
  /** Unix seconds. */
  block_time: number;
}

/** A transaction's inputs and outputs: `tx_info`, with only what Activity reads. */
export interface KoiosTxInfo {
  tx_hash: string;
  block_height: number;
  /** Unix seconds. */
  tx_timestamp: number;
  fee: string;
  inputs: KoiosTxOut[];
  outputs: KoiosTxOut[];
  /** The transaction's metadata, by label. */
  metadata?: Record<string, unknown> | null;
  /** Rewards withdrawn, per reward account. */
  withdrawals?: Array<{ amount: string; stake_addr: string }> | null;
  /** Its certificates: `type` is Koios's name (`stake_registration`, `pool_delegation`, `vote_delegation`, …), `info` what each names. */
  certificates?: Array<{ index: number | null; type: string; info: Record<string, unknown> | null }> | null;
  /** Its votes: `voter` is a DRep's ID (CIP-129) when a DRep cast it. */
  voting_procedures?: Array<{ vote: string; voter: string; voter_role: string }> | null;
}

export interface KoiosTxOut {
  payment_addr: { bech32: string };
  value: string;
  asset_list: Array<{ policy_id: string; asset_name: string; quantity: string }> | null;
}

/** What a transaction spent: `tx_info`'s inputs, each where it sat (`cred`: its payment key or script hash, hex). */
export interface KoiosTxSpends {
  tx_hash: string;
  inputs: Array<{ payment_addr: { bech32: string; cred?: string | null } }> | null;
}

/** A stake key's standing: `account_info`. No row at all means it was never registered. */
export interface KoiosAccountInfo {
  stake_address: string;
  status: "registered" | "not registered";
  /** `pool1…`, or null. */
  delegated_pool: string | null;
  /** A DRep's ID (CIP-129), `drep_always_abstain`, `drep_always_no_confidence`, or null. */
  delegated_drep: string | null;
  /** Lovelace that can be withdrawn now. */
  rewards_available: string;
  /** The deposit paid when it was registered (lovelace). */
  deposit: string;
}

/** A live pool, with only what the pool browser reads: `pool_list`. */
export interface KoiosPool {
  pool_id_bech32: string;
  ticker: string | null;
  /** 0 to 1. */
  margin: number | null;
  /** Lovelace. */
  fixed_cost: string | null;
  pledge: string | null;
  active_stake: string | null;
  retiring_epoch: number | null;
}

/** One pool's details: `pool_info`. */
export interface KoiosPoolInfo {
  pool_id_bech32: string;
  meta_json: { name?: string; ticker?: string; homepage?: string; description?: string } | null;
  margin: number | null;
  fixed_cost: string | null;
  pledge: string | null;
  live_pledge: string | null;
  live_stake: string | null;
  /** A percentage: 100 is saturated. */
  live_saturation: number | null;
  live_delegators: number | null;
  block_count: number | null;
  pool_status: "registered" | "retiring" | "retired";
  retiring_epoch: number | null;
}

/** A DRep: `drep_info`. */
export interface KoiosDrepInfo {
  drep_id: string;
  drep_status: "registered" | "retired";
  /** Voted or updated recently enough to count. */
  active: boolean;
  expires_epoch_no: number | null;
  /** Voting power: the stake delegated to it (lovelace). */
  amount: string;
  live_delegator_count: number | null;
}

/** The account's own DRep: `drep_info`, with what retiring needs and its profile's anchor. */
export interface KoiosDrepStanding extends KoiosDrepInfo {
  /** The deposit it paid (lovelace): what retiring returns. */
  deposit: string | null;
  meta_url: string | null;
  meta_hash: string | null;
}

/** What Koios found at a DRep's profile: `drep_metadata`, its validity and name. */
export interface KoiosDrepProfile {
  drep_id: string;
  /** The file was read and matched its hash (true), didn't (false), or Koios couldn't say (null). */
  is_valid: boolean | null;
  givenName: unknown;
}

/** A live governance action: `proposal_list`, the columns the wallet shows, its title and abstract from the anchor as Koios read it. */
export interface KoiosProposal {
  proposal_id: string;
  proposal_tx_hash: string;
  proposal_index: number;
  proposal_type: string;
  proposed_epoch: number;
  /** The last epoch it can be voted on in. */
  expiration: number;
  deposit: string;
  meta_url: string | null;
  meta_hash: string | null;
  meta_is_valid: boolean | null;
  title: string | null;
  abstract: string | null;
  /** Its transaction's block time (seconds); absent from a list kept from before it was asked for. */
  block_time?: number;
  /** A treasury withdrawal's payments as the ledger holds them, or one alone (withdrawalsOf); null for any other type. */
  withdrawal?: Array<{ stake_address: string; amount: string }> | { stake_address: string; amount: string } | null;
}

/** One vote: `vote_list`. */
export interface KoiosVote {
  proposal_id: string;
  vote: "Yes" | "No" | "Abstain";
  block_time: number;
}

/** A DRep's name from its CIP-119 metadata: `drep_metadata`, the name only. */
export interface KoiosDrepName {
  drep_id: string;
  /** A string, or a JSON-LD `{ "@value": … }`, or anything its author wrote. */
  givenName: unknown;
}

/**
 * A token's metadata: `asset_info`, its two metadata columns only. Both are
 * whatever the token's minter wrote, so they're read as `unknown`
 * (nft-image.ts).
 */
export interface KoiosAssetInfo {
  /** The latest minting transaction's metadata, by label: CIP-25's is "721". */
  minting_tx_metadata?: unknown;
  /** The reference token's datum (CIP-68), as detailed-schema JSON, keyed by the user token's label: "222" for an NFT. */
  cip68_metadata?: unknown;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * What every request to a service goes out with (Koios, giveme.my, CoinGecko,
 * Minswap): no cookies, and no referrer. With a host permission, the
 * worker's fetch would otherwise carry any cookie the browser holds for that
 * host, and one of giveme.my's would tie every private payment to this
 * browser (privacy review §2.14). No service needs one.
 */
export const SERVICE_FETCH = { credentials: "omit", referrerPolicy: "no-referrer" } as const satisfies RequestInit;

const PAGE_SIZE = 1000;

/** The columns each staking query asks for: what the wallet shows, nothing else. */
const POOL_COLUMNS = "pool_id_bech32,ticker,margin,fixed_cost,pledge,active_stake,retiring_epoch";
const POOL_INFO_COLUMNS =
  "pool_id_bech32,meta_json,margin,fixed_cost,pledge,live_pledge,live_stake,live_saturation,live_delegators,block_count,pool_status,retiring_epoch";
const DREP_INFO_COLUMNS = "drep_id,drep_status,active,expires_epoch_no,amount,live_delegator_count";
/** CIP-119's name only: a DRep's image would be fetched from anywhere its author chose. */
const DREP_NAME_COLUMNS = "drep_id,meta_json->body->givenName";
const DREP_STANDING_COLUMNS = `${DREP_INFO_COLUMNS},deposit,meta_url,meta_hash`;
const DREP_PROFILE_COLUMNS = "drep_id,is_valid,meta_json->body->givenName";
/**
 * A live governance action is one not yet ratified, enacted, dropped or
 * expired. Its metadata's text is most of a row (70 KB for mainnet's three on
 * 2026-10-04), so only the title and abstract are taken from it (5.7 KB). The
 * block time dates each row, and a treasury withdrawal's `withdrawal` says
 * who it pays and how much (chunk 23's second review, GV-1, GV-2): a few bytes
 * more of the same request, asking Koios nothing new.
 */
const LIVE_PROPOSALS =
  "ratified_epoch=is.null&enacted_epoch=is.null&dropped_epoch=is.null&expired_epoch=is.null";
const PROPOSAL_COLUMNS =
  "proposal_id,proposal_tx_hash,proposal_index,proposal_type,proposed_epoch,expiration,deposit,meta_url,meta_hash,meta_is_valid,title:meta_json->body->>title,abstract:meta_json->body->>abstract,block_time,withdrawal";
/** How many live actions a vote_list request asks about at once, so its address stays short. */
const VOTES_PER_REQUEST = 40;
/** What an NFT's image is read from: its CIP-25 and CIP-68 metadata, nothing else. */
const ASSET_INFO_COLUMNS = "minting_tx_metadata,cip68_metadata";
const RETRY_DELAYS_MS = [1000, 3000];

/**
 * How long a read waits for Koios. Mainnet's chain is far bigger than
 * preprod's, where this was first tuned at 20 s: one `credential_utxos` over
 * an account with real history can take tens of seconds on the public tier,
 * and the wallet was calling that offline (found on mainnet, 2026-09-28).
 */
const TIMEOUT_MS = 45_000;

/**
 * A submit's own wait. Shorter than a read's: past it the wallet has to treat
 * the transaction as maybe sent, which holds later payments back, so waiting
 * longer for a real answer is worth more than failing fast.
 */
const SUBMIT_TIMEOUT_MS = 30_000;

/**
 * Payment credentials in one `credential_utxos` request. Koios's public tier
 * refuses bodies over 5,120 bytes; 75 hex key hashes are about 4.5 KB.
 */
export const CREDENTIALS_PER_REQUEST = 75;

/** Outpoints in one `utxo_info` request: each is about 70 bytes, under the same 5,120-byte cap. */
export const REFS_PER_REQUEST = 60;

/** Transactions in one `tx_info` request for their inputs alone, as Activity asks 20 at a time for the rest. */
export const TXS_PER_REQUEST = 20;

/**
 * What went wrong at Koios, for a page that says it in a few words (a swap's
 * retry line): it asked the wallet to slow down, or gave no answer to read
 * (none at all, a server error, a refused request, a row missing). The
 * network refusing a transaction through it is none of these. Told where it
 * happens, so the page never reads the message, which is in the user's
 * language.
 */
export type KoiosTrouble = "rate-limited" | "silent";

export class KoiosError extends Error {
  constructor(
    message: string,
    readonly trouble?: KoiosTrouble,
  ) {
    super(message);
  }
}

/** How long everything waits after a 429 that named no Retry-After. */
export const BACK_OFF_MS = 10_000;

/** The longest a Retry-After is honoured, so a bad header can't park the wallet for hours. */
export const MAX_BACK_OFF_MS = 60_000;

/**
 * What a 429's `Retry-After` asks for (ms): seconds, or an HTTP date. A
 * missing or unreadable one is BACK_OFF_MS, and anything longer than
 * MAX_BACK_OFF_MS is capped by `hold`.
 */
export function retryAfterMs(response: Response | undefined, now: number = Date.now()): number {
  const header = response?.headers.get("retry-after");
  if (!header) return BACK_OFF_MS;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? BACK_OFF_MS : Math.max(0, at - now);
}

/**
 * Koios's public tier takes 100 requests every 10 seconds from an IP address
 * (and 5,000 a day). Every request the worker makes waits its turn here, so a
 * burst (a long Lovejoin chain, several screens reading at once) stays well
 * under it, with room left for anything else on the same connection. Each
 * attempt counts, retries too.
 *
 * The window is 40, not half the tier's 100, because Chrome stops the worker
 * after about 30 seconds idle and a fresh one starts with an empty window: two
 * workers either side of a stop can each spend theirs inside the same 10
 * seconds, so the pair must still fit. `hold` is what a 429 sets, and it does
 * carry across a restart (`store`): once Koios has asked the wallet to slow
 * down, every request waits, not just the one that was refused.
 */
export class RateLimit {
  private starts: number[] = [];
  /** Nothing starts before this (ms, `now`'s clock): what a 429 sets. */
  private until = 0;
  private restored?: Promise<void>;

  constructor(
    readonly max = 40,
    readonly windowMs = 10_000,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    /** Where a cooldown outlives the worker; tests leave it out and keep it in memory. */
    private readonly store?: HoldStore,
  ) {}

  /** Waits until a request may start, and counts it. */
  async take(): Promise<void> {
    await this.restore();
    for (;;) {
      const at = this.now();
      // A cooldown holds everything back, however empty the window is.
      if (at < this.until) {
        await this.sleep(this.until - at);
        continue;
      }
      this.starts = this.starts.filter((s) => at - s < this.windowMs);
      if (this.starts.length < this.max) {
        this.starts.push(at);
        return;
      }
      await this.sleep(this.starts[0]! + this.windowMs - at);
    }
  }

  /**
   * Koios asked the wallet to slow down: hold every request back for `ms`,
   * and keep it where a worker started later will read it.
   */
  hold(ms: number): void {
    this.until = Math.max(this.until, this.now() + Math.min(ms, MAX_BACK_OFF_MS));
    void this.store?.save(this.until);
  }

  /** What a cooldown still has to run (ms): 0 when nothing is held back. */
  holding(): number {
    return Math.max(0, this.until - this.now());
  }

  private restore(): Promise<void> {
    this.restored ??= (async () => {
      const kept = await this.store?.load();
      if (kept) this.until = Math.max(this.until, kept);
    })();
    return this.restored;
  }
}

/** Where a cooldown is kept so a worker Chrome restarted still honours it. */
export interface HoldStore {
  load(): Promise<number | undefined>;
  save(until: number): Promise<void>;
}

/** chrome.storage.session, which is memory-only and goes when the browser closes. */
export const sessionHoldStore: HoldStore = {
  async load() {
    try {
      const got = (await chrome.storage.session.get(SESSION_HOLD_KEY)) as Record<string, unknown>;
      const until = got[SESSION_HOLD_KEY];
      return typeof until === "number" ? until : undefined;
    } catch {
      return undefined;
    }
  },
  async save(until) {
    try {
      await chrome.storage.session.set({ [SESSION_HOLD_KEY]: until });
    } catch {
      // A cooldown that can't be kept still holds this worker back.
    }
  },
};

/** chrome.storage.session: when Koios's limit lets the wallet ask again. */
export const SESSION_HOLD_KEY = "seedelf.koios.until";

/** The worker's one limit, shared by every Koios it makes, whatever the network. */
export const KOIOS_LIMIT = new RateLimit(undefined, undefined, undefined, undefined, sessionHoldStore);

/** The network refused a transaction because an input it spends is already spent. */
export class SpentInputError extends KoiosError {}

/**
 * Koios didn't answer a submit (a timeout, a lost connection), asked the
 * wallet to slow down (429), or failed on its side (5xx). Sending the same
 * transaction again later is safe (the ledger takes it once). `maybeSent`:
 * it may or may not have gone through; not for a 429, which Koios's gateway
 * answers before passing anything on.
 */
export class KoiosBusyError extends KoiosError {
  constructor(
    message: string,
    readonly maybeSent = true,
    trouble: KoiosTrouble = "silent",
  ) {
    super(message, trouble);
  }
}

/**
 * Whether Chrome lets the wallet reach `url`'s host. Koios's public tier sends
 * browsers no CORS headers, so the wallet reads it only through the manifest's
 * host permission. Without the grant (the user limited the wallet's site
 * access in Chrome), a request fails like a lost connection. Outside an
 * extension, as in tests, the answer is yes.
 */
export type HostCheck = (url: string) => Promise<boolean>;

const chromeAllows: HostCheck = async (url) => {
  if (typeof chrome === "undefined" || !chrome.permissions) return true;
  return chrome.permissions.contains({ origins: [`${new URL(url).origin}/*`] }).catch(() => true);
};

/** Retrying can't help, and the wallet's page offers to ask Chrome again (App.tsx). */
export const KOIOS_NOT_ALLOWED = () => t("koios.notAllowed");

/**
 * A request that never got an answer. A timeout is Koios being slow, not the
 * connection being broken, so it says so: sending the user to look at their
 * ad blocker for a slow mainnet read wastes their time (found on mainnet,
 * 2026-09-28).
 */
function unreachable(e: unknown): string {
  const cause = e instanceof Error ? e.message : String(e);
  if (e instanceof DOMException && e.name === "TimeoutError") {
    return t("koios.timeout");
  }
  return t("koios.unreachable", { cause });
}

/** An answer that isn't data. */
function koiosTrouble(status: number, path: string): string {
  if (status === 429) {
    // The public tier caps both a burst (100 every 10 seconds) and a day (5,000),
    // and answers 429 for either, so the words have to cover both.
    return t("koios.rateLimited");
  }
  if (status >= 500) return t("koios.trouble", { status, path });
  return t("koios.refused", { status, path });
}

/**
 * The ledger's staking refusals in plain words. Most mean the account changed
 * between Review and Send: an epoch paid more rewards, say, and a withdrawal
 * must take exactly the balance.
 */
function stakingRefusal(text: string): string | undefined {
  if (text.includes("WithdrawalsNotInRewards")) {
    return t("koios.staking.rewardsChanged");
  }
  if (text.includes("NotDelegatedToDRep")) {
    return t("koios.staking.notDelegated");
  }
  if (text.includes("DelegateeStakePoolNotRegistered")) {
    return t("koios.staking.poolGone");
  }
  if (text.includes("DelegateeDRepNotRegistered")) {
    return t("koios.staking.drepGone");
  }
  if (/StakeKey(Not)?Registered|IncorrectDeposit|NonZeroRewardAccountBalance/.test(text)) {
    return t("koios.staking.changed");
  }
  return undefined;
}

export class Koios {
  constructor(
    private readonly base: string,
    private readonly fetchFn: FetchLike = (url, init) => fetch(url, init),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly allowed: HostCheck = chromeAllows,
    /** The worker passes KOIOS_LIMIT; tests go unthrottled. */
    private readonly limit?: RateLimit,
  ) {}

  /**
   * Every UTxO whose payment credential is one of `credentials` (key or
   * script hashes, hex); with `after`, only those in blocks after it. At most
   * `CREDENTIALS_PER_REQUEST` go in a request. Each is `trimmed`.
   */
  async credentialUtxos(credentials: string[], after?: number): Promise<KoiosUtxo[]> {
    const filter = after === undefined ? "" : `block_height=gt.${after}`;
    const rows: KoiosUtxo[] = [];
    for (let i = 0; i < credentials.length; i += CREDENTIALS_PER_REQUEST) {
      const body = { _payment_credentials: credentials.slice(i, i + CREDENTIALS_PER_REQUEST), _extended: true };
      rows.push(...(await this.paged<KoiosUtxo>("credential_utxos", body, filter)).map(trimmed));
    }
    return rows;
  }

  /**
   * The UTxOs asked for (`txhash#index`), spent or not, with their address
   * and value: for the dApp connector, the inputs of a dApp's transaction
   * that aren't the account's. At most `REFS_PER_REQUEST` go in a request.
   * Each is `trimmed`.
   */
  async utxoInfo(refs: string[]): Promise<KoiosUtxo[]> {
    const rows: KoiosUtxo[] = [];
    for (let i = 0; i < refs.length; i += REFS_PER_REQUEST) {
      const page = await this.post<KoiosUtxo>("utxo_info", { _utxo_refs: refs.slice(i, i + REFS_PER_REQUEST), _extended: true });
      rows.push(...page.map(trimmed));
    }
    return rows;
  }

  /**
   * The datums `hashes` name, their CBOR (hex) by hash: a DEX order that
   * keeps its datum by hash (a Plutus V1 one's) is cancelled with those exact
   * bytes (chunk 24).
   */
  async datumInfo(hashes: string[]): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    for (let i = 0; i < hashes.length; i += REFS_PER_REQUEST) {
      const page = await this.post<{ datum_hash: string; bytes: string }>("datum_info", {
        _datum_hashes: hashes.slice(i, i + REFS_PER_REQUEST),
      });
      for (const row of page) found.set(row.datum_hash, row.bytes);
    }
    return found;
  }

  /**
   * Every UTxO at `addresses` (bech32): what a DEX's partial fill of an order
   * left at the order's own address (chunk 24). Each is `trimmed`.
   */
  async addressUtxos(addresses: string[]): Promise<KoiosUtxo[]> {
    const rows = await this.paged<KoiosUtxo>("address_utxos", { _addresses: addresses, _extended: true });
    return rows.map(trimmed);
  }

  /** Every address that has used this stake key, including ones now empty. */
  async accountAddresses(stakeAddress: string): Promise<string[]> {
    const rows = await this.post<{ addresses: string[] }>("account_addresses", {
      _stake_addresses: [stakeAddress],
      _empty: true,
    });
    return rows[0]?.addresses ?? [];
  }

  /**
   * Which of `stakeAddresses` any address has ever used, empty ones included,
   * registered or not: one request.
   */
  async usedStakeAddresses(stakeAddresses: string[]): Promise<Set<string>> {
    const rows = await this.post<{ stake_address: string; addresses: string[] | null }>("account_addresses", {
      _stake_addresses: stakeAddresses,
      _empty: true,
    });
    return new Set(rows.filter((r) => r.addresses?.length).map((r) => r.stake_address));
  }

  /**
   * An account's transactions, newest first: `limit` of them from `offset`,
   * or with `after`, only those in blocks after it (one request, up to 1,000).
   */
  accountTxs(stakeAddress: string, { after, offset = 0, limit = 20 }: { after?: number; offset?: number; limit?: number }) {
    const body = { _stake_address: stakeAddress, ...(after === undefined ? {} : { _after_block_height: after }) };
    const page = after === undefined ? `&offset=${offset}&limit=${limit}` : "&limit=1000";
    return this.post<KoiosAccountTx>("account_txs", body, `order=block_height.desc,tx_hash.asc${page}`);
  }

  /** Inputs, outputs and fee of up to 20 transactions, in one request; nothing else. */
  txInfo(txHashes: string[]): Promise<KoiosTxInfo[]> {
    if (!txHashes.length) return Promise.resolve([]);
    // Metadata, withdrawals, certificates and votes cost no extra request: they're what Activity shows of notes,
    // staking and the account's own DRep.
    return this.post<KoiosTxInfo>("tx_info", {
      _tx_hashes: txHashes,
      _inputs: true,
      _metadata: true,
      _assets: true,
      _withdrawals: true,
      _certs: true,
      _scripts: false,
      _bytecode: false,
      _governance: true,
    });
  }

  /**
   * What each transaction spent, its inputs alone (`tx_info`): nothing of
   * their datums, scripts, tokens or metadata. At most `TXS_PER_REQUEST` go
   * in a request. A transaction Koios doesn't know has no row.
   */
  async txSpends(txHashes: string[]): Promise<KoiosTxSpends[]> {
    const rows: KoiosTxSpends[] = [];
    for (let i = 0; i < txHashes.length; i += TXS_PER_REQUEST) {
      rows.push(
        ...(await this.post<KoiosTxSpends>("tx_info", {
          _tx_hashes: txHashes.slice(i, i + TXS_PER_REQUEST),
          _inputs: true,
          _metadata: false,
          _assets: false,
          _withdrawals: false,
          _certs: false,
          _scripts: false,
          _bytecode: false,
        })),
      );
    }
    return rows;
  }

  /** A stake key's standing; undefined when it was never registered. */
  async accountInfo(stakeAddress: string): Promise<KoiosAccountInfo | undefined> {
    const [row] = await this.post<KoiosAccountInfo>("account_info", { _stake_addresses: [stakeAddress] });
    return row;
  }

  /** Every live pool (not retiring or retired), 1,000 a request. */
  async poolList(): Promise<KoiosPool[]> {
    const rows: KoiosPool[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await this.request<KoiosPool>(
        "GET",
        "pool_list",
        undefined,
        `pool_status=eq.registered&select=${POOL_COLUMNS}&order=pool_id_bech32.asc&offset=${offset}&limit=${PAGE_SIZE}`,
      );
      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
    }
  }

  /** The current supply of ADA (lovelace): what a pool's saturation is measured against. */
  async supply(): Promise<string> {
    const [row] = await this.request<{ supply: string }>(
      "GET",
      "totals",
      undefined,
      "select=epoch_no,supply&order=epoch_no.desc&limit=1",
    );
    if (!row) throw new KoiosError(t("koios.noTotals"), "silent");
    return row.supply;
  }

  /** Details of the pools asked for (`pool1…`), in no particular order. */
  poolInfo(poolIds: string[]): Promise<KoiosPoolInfo[]> {
    return this.post<KoiosPoolInfo>("pool_info", { _pool_bech32_ids: poolIds }, `select=${POOL_INFO_COLUMNS}`);
  }

  /** The DReps asked for (CIP-129 IDs); ones Koios doesn't know are left out. */
  drepInfo(drepIds: string[]): Promise<KoiosDrepInfo[]> {
    return this.post<KoiosDrepInfo>("drep_info", { _drep_ids: drepIds }, `select=${DREP_INFO_COLUMNS}`);
  }

  /** The account's own DRep, with its deposit and profile's anchor; undefined when it was never registered. */
  async drepStanding(drepId: string): Promise<KoiosDrepStanding | undefined> {
    const [row] = await this.post<KoiosDrepStanding>(
      "drep_info",
      { _drep_ids: [drepId] },
      `select=${DREP_STANDING_COLUMNS}`,
    );
    return row;
  }

  /** What Koios found at a DRep's profile; undefined when it has none. */
  async drepProfile(drepId: string): Promise<KoiosDrepProfile | undefined> {
    const [row] = await this.post<KoiosDrepProfile>(
      "drep_metadata",
      { _drep_ids: [drepId] },
      `select=${DREP_PROFILE_COLUMNS}`,
    );
    return row;
  }

  /** Every live governance action, the newest proposed first, 1,000 a request. */
  async proposalList(): Promise<KoiosProposal[]> {
    const rows: KoiosProposal[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await this.request<KoiosProposal>(
        "GET",
        "proposal_list",
        undefined,
        `${LIVE_PROPOSALS}&select=${PROPOSAL_COLUMNS}&order=proposed_epoch.desc,proposal_id.asc&offset=${offset}&limit=${PAGE_SIZE}`,
      );
      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
    }
  }

  /** `drepId`'s votes on the actions asked for (`gov_action1…`), newest first: a vote cast again replaces the one before. */
  async drepVotes(drepId: string, proposalIds: string[]): Promise<KoiosVote[]> {
    const votes: KoiosVote[] = [];
    for (let i = 0; i < proposalIds.length; i += VOTES_PER_REQUEST) {
      const ids = proposalIds.slice(i, i + VOTES_PER_REQUEST).map(encodeURIComponent).join(",");
      votes.push(
        ...(await this.request<KoiosVote>(
          "GET",
          "vote_list",
          undefined,
          `voter_id=eq.${encodeURIComponent(drepId)}&proposal_id=in.(${ids})&select=proposal_id,vote,block_time&order=block_time.desc`,
        )),
      );
    }
    return votes;
  }

  /** The DReps' names from their metadata; ones with none are left out. */
  drepNames(drepIds: string[]): Promise<KoiosDrepName[]> {
    return this.post<KoiosDrepName>("drep_metadata", { _drep_ids: drepIds }, `select=${DREP_NAME_COLUMNS}`);
  }

  /** The current epoch's protocol parameters: one `epoch_params` row, passed to WebAssembly as is. */
  async epochParams(): Promise<Record<string, unknown>> {
    const [row] = await this.request<Record<string, unknown>>("GET", "epoch_params", undefined, "limit=1");
    if (!row) throw new KoiosError(t("koios.noParams"), "silent");
    return row;
  }

  /**
   * Who holds an NFT: the payment address of the one UTxO holding
   * `policyId.assetName`, or undefined if Koios knows of none. Used to find an
   * ADA Handle's address; Koios sees which handle is asked about.
   */
  async assetNftAddress(policyId: string, assetName: string): Promise<string | undefined> {
    const query = `_asset_policy=${encodeURIComponent(policyId)}&_asset_name=${encodeURIComponent(assetName)}`;
    const [row] = await this.request<{ payment_address?: string }>("GET", "asset_nft_address", undefined, query);
    return row?.payment_address ?? undefined;
  }

  /**
   * One token's metadata, for its image (chunk 20): CIP-25's, from the
   * transaction that minted it, and CIP-68's, from its reference token's
   * datum. Nothing else is asked for. Undefined when Koios knows no such
   * token. Koios sees which token is asked about.
   */
  async assetInfo(policyId: string, assetName: string): Promise<KoiosAssetInfo | undefined> {
    const [row] = await this.post<KoiosAssetInfo>(
      "asset_info",
      { _asset_list: [[policyId, assetName]] },
      `select=${ASSET_INFO_COLUMNS}`,
    );
    return row;
  }

  /**
   * Submits a signed transaction; returns its hash. Retried only when Koios
   * says its node was unreachable: otherwise, if an answer were lost, a
   * second submit would fail with "inputs already spent" and hide the fact
   * that the first one went through. An answer cut off after its status (the
   * timeout covers the body too), or one that isn't the hash it should be,
   * may have gone through all the same: it's a KoiosBusyError, maybe sent
   * (independent review L2).
   */
  async submitTx(txCbor: Uint8Array<ArrayBuffer>): Promise<string> {
    let response: Response;
    let text: string;
    for (let attempt = 0; ; attempt++) {
      await this.limit?.take();
      try {
        response = await this.fetchFn(`${this.base}/submittx`, {
          ...SERVICE_FETCH,
          method: "POST",
          headers: { "content-type": "application/cbor" },
          body: txCbor,
          signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
        });
      } catch (e) {
        if (!(await this.allowed(this.base))) throw new KoiosError(KOIOS_NOT_ALLOWED(), "silent");
        throw new KoiosBusyError(unreachable(e));
      }
      // Koios's gateway answers a 429 before passing anything on, whatever its body.
      if (response.status === 429) {
        this.limit?.hold(retryAfterMs(response, Date.now()));
        throw new KoiosBusyError(koiosTrouble(429, "submittx"), false, "rate-limited");
      }
      if (response.status >= 500) throw new KoiosBusyError(koiosTrouble(response.status, "submittx"));
      try {
        text = await response.text();
      } catch (e) {
        throw new KoiosBusyError(unreachable(e));
      }
      // Found live: a Koios backend whose own node was down answered. The
      // transaction never reached the network, so it's safe to send again,
      // and the gateway likely picks another backend.
      if (!text.includes("TxSubmitConnectionError")) break;
      if (attempt === RETRY_DELAYS_MS.length) {
        throw new KoiosError(t("koios.nodeDown"), "silent");
      }
      await this.sleep(RETRY_DELAYS_MS[attempt]!);
    }
    // A UTxO it spends is already spent: Koios showed the wallet an old view
    // of the chain (spent.ts), or this transaction already went through, or
    // another that spends the same (pending.ts looks for this one first).
    // Newer nodes say so from their mempool, before the ledger would, when
    // every input is spent: "All inputs are spent. Transaction has probably
    // already been included". Read as a plain refusal, it stopped a chain
    // through Lovejoin whose resend met it (found live, 2026-09-28).
    if (text.includes("BadInputsUTxO") || text.includes("All inputs are spent")) {
      throw new SpentInputError(
        t("koios.spentInput"),
      );
    }
    const staking = stakingRefusal(text);
    if (staking) throw new KoiosError(staking);
    // The public account's transactions are valid for two hours from this device's clock (account.ts).
    if (text.includes("OutsideValidityIntervalUTxO")) {
      throw new KoiosError(
        t("koios.outsideValidity"),
      );
    }
    if (text.includes("FeeTooSmallUTxO")) {
      throw new KoiosError(
        t("koios.feeTooSmall"),
      );
    }
    if (!response.ok) throw new KoiosError(t("koios.rejected", { why: text.slice(0, 500) }));
    let id: unknown;
    try {
      id = JSON.parse(text);
    } catch {
      id = undefined;
    }
    // Taken, with an answer that isn't a transaction's id: it may well be on its way.
    if (typeof id !== "string") throw new KoiosBusyError(t("koios.unreadableAnswer", { why: text.slice(0, 100) }));
    return id;
  }

  /**
   * Has Ogmios, through Koios, run the scripts in an unsigned transaction.
   * Returns Ogmios's JSON-RPC answer as is: `result` lists what each script
   * used, or `error` says why they refused (Koios passes that on with status
   * 400). WebAssembly reads either. Retried like a read: evaluating changes
   * nothing. `additionalUtxo`: UTxOs it spends that aren't on chain yet, as
   * Ogmios v6's (a chain's unsent parents, from WebAssembly's ogmiosUtxos).
   */
  evaluate(txCborHex: string, additionalUtxo?: unknown[]): Promise<unknown> {
    const params = { transaction: { cbor: txCborHex }, ...(additionalUtxo?.length ? { additionalUtxo } : {}) };
    const body = { jsonrpc: "2.0", method: "evaluateTransaction", params };
    return this.send<unknown>("POST", "ogmios", body, "", { answer400: true });
  }

  /** The slot of the newest block Koios has. */
  async tipSlot(): Promise<number> {
    const [row] = await this.request<{ abs_slot?: unknown }>("GET", "tip", undefined);
    if (typeof row?.abs_slot !== "number") throw new KoiosError(t("koios.noTip"), "silent");
    return row.abs_slot;
  }

  /** Confirmations for each transaction; `null` until it's on chain. */
  async txStatus(txHashes: string[]): Promise<Map<string, number | null>> {
    const rows = await this.post<{ tx_hash: string; num_confirmations: number | null }>("tx_status", {
      _tx_hashes: txHashes,
    });
    return new Map(rows.map((r) => [r.tx_hash, r.num_confirmations]));
  }

  /**
   * All the rows, 1,000 a request, each UTxO once; `filter` narrows them on
   * Koios's side (PostgREST, e.g. `block_height=gt.5`). A page starts after
   * the last row of the one before, not at an offset: the UTxOs change
   * between requests, and one spent before an offset would shift the rest,
   * skipping a row, as one added would repeat a row.
   */
  private async paged<T extends { tx_hash: string; tx_index: number }>(path: string, body: unknown, filter = ""): Promise<T[]> {
    const rows = new Map<string, T>();
    let last: T | undefined;
    for (;;) {
      const after = last && `or=(tx_hash.gt.${last.tx_hash},and(tx_hash.eq.${last.tx_hash},tx_index.gt.${last.tx_index}))`;
      const query = [filter, after, `order=tx_hash.asc,tx_index.asc&limit=${PAGE_SIZE}`].filter(Boolean).join("&");
      const page = await this.post<T>(path, body, query);
      const known = rows.size;
      for (const row of page) {
        const outpoint = `${row.tx_hash}#${row.tx_index}`;
        if (!rows.has(outpoint)) rows.set(outpoint, row);
      }
      // A short page is the last. One with nothing new can't lead anywhere either.
      if (page.length < PAGE_SIZE || rows.size === known) return [...rows.values()];
      last = page.at(-1);
    }
  }

  private post<T>(path: string, body: unknown, query = ""): Promise<T[]> {
    return this.request<T>("POST", path, body, query);
  }

  private request<T>(method: "GET" | "POST", path: string, body: unknown, query = ""): Promise<T[]> {
    return this.send<T[]>(method, path, body, query);
  }

  /** One request, retried on rate limits, server errors and lost connections. `answer400` reads a 400's JSON too. */
  private async send<R>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    query = "",
    { answer400 = false } = {},
  ): Promise<R> {
    const url = `${this.base}/${path}${query ? `?${query}` : ""}`;
    for (let attempt = 0; ; attempt++) {
      let response: Response | undefined;
      let failure: string;
      let slow = false;
      await this.limit?.take();
      try {
        response = await this.fetchFn(url, {
          ...SERVICE_FETCH,
          method,
          headers:
            method === "POST"
              ? { accept: "application/json", "content-type": "application/json" }
              : { accept: "application/json" },
          body: method === "POST" ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (response.ok || (answer400 && response.status === 400)) return (await response.json()) as R;
        failure = koiosTrouble(response.status, path);
      } catch (e) {
        if (!(await this.allowed(url))) throw new KoiosError(KOIOS_NOT_ALLOWED(), "silent");
        slow = e instanceof DOMException && e.name === "TimeoutError";
        failure = unreachable(e);
      }
      // A 429 is the tier's limit, not this request's bad luck: hold every
      // request back, so retrying doesn't keep the limit tripped.
      let cooling = false;
      if (response?.status === 429 && this.limit) {
        this.limit.hold(retryAfterMs(response, Date.now()));
        cooling = true;
      }
      const retryable = !response || response.status === 429 || response.status >= 500;
      // A read that ran out of time already waited TIMEOUT_MS: two more of
      // those is over two minutes of a spinner, so it gets one retry, not two.
      const delays = slow ? RETRY_DELAYS_MS.slice(0, 1) : RETRY_DELAYS_MS;
      const delay = delays[attempt];
      if (!retryable || delay === undefined) {
        throw new KoiosError(failure, response?.status === 429 ? "rate-limited" : "silent");
      }
      // `take` waits the cooldown out at the top of the next attempt; sleeping
      // here too would only add to it. Without a limiter, the fixed delay stands.
      if (!cooling) await this.sleep(delay);
    }
  }
}
