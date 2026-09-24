// A small Koios REST client for the service worker, with only the queries the
// wallet needs. The contract query is the same one the CLI makes
// (seedelf-koios `credential_utxos`). Results are paged 1000 rows at a time in
// a fixed order, and rate limits or server errors are retried twice.

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
  inline_datum: { bytes: string; value: unknown } | null;
  asset_list: KoiosAsset[] | null;
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
}

export interface KoiosTxOut {
  payment_addr: { bech32: string };
  value: string;
  asset_list: Array<{ policy_id: string; asset_name: string; quantity: string }> | null;
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

/** A DRep's name from its CIP-119 metadata: `drep_metadata`, the name only. */
export interface KoiosDrepName {
  drep_id: string;
  /** A string, or a JSON-LD `{ "@value": … }`, or anything its author wrote. */
  givenName: unknown;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const PAGE_SIZE = 1000;

/** The columns each staking query asks for: what the wallet shows, nothing else. */
const POOL_COLUMNS = "pool_id_bech32,ticker,margin,fixed_cost,pledge,active_stake,retiring_epoch";
const POOL_INFO_COLUMNS =
  "pool_id_bech32,meta_json,margin,fixed_cost,pledge,live_pledge,live_stake,live_saturation,live_delegators,block_count,pool_status,retiring_epoch";
const DREP_INFO_COLUMNS = "drep_id,drep_status,active,expires_epoch_no,amount,live_delegator_count";
/** CIP-119's name only: a DRep's image would be fetched from anywhere its author chose. */
const DREP_NAME_COLUMNS = "drep_id,meta_json->body->givenName";
const RETRY_DELAYS_MS = [1000, 3000];
const TIMEOUT_MS = 20_000;

/**
 * Payment credentials in one `credential_utxos` request. Koios's public tier
 * refuses bodies over 5,120 bytes; 75 hex key hashes are about 4.5 KB.
 */
export const CREDENTIALS_PER_REQUEST = 75;

export class KoiosError extends Error {}

/** The network refused a transaction because an input it spends is already spent. */
export class SpentInputError extends KoiosError {}

/** A request that never got an answer: offline, or blocked on the way. */
function unreachable(e: unknown): string {
  const cause = e instanceof Error ? e.message : String(e);
  return (
    `Couldn't reach Koios, the service the wallet reads Cardano from (${cause}). ` +
    "Check your internet connection, and any VPN or ad blocker that might block koios.rest."
  );
}

/** An answer that isn't data. */
function koiosTrouble(status: number, path: string): string {
  if (status === 429) return "Koios is limiting requests from your connection. Wait a minute and try again.";
  if (status >= 500) return `Koios is having trouble right now (${status} for ${path}). Try again in a minute.`;
  return `Koios refused the request (${status} for ${path}).`;
}

/**
 * The ledger's staking refusals in plain words. Most mean the account changed
 * between Review and Send: an epoch paid more rewards, say, and a withdrawal
 * must take exactly the balance.
 */
function stakingRefusal(text: string): string | undefined {
  if (text.includes("WithdrawalsNotInRewards")) {
    return "Your staking rewards changed since you reviewed this: a new epoch may have paid more. Review it again.";
  }
  if (text.includes("NotDelegatedToDRep")) {
    return "The network won't pay out rewards until your voting power is delegated. Delegate it on the Staking page, then try again.";
  }
  if (text.includes("DelegateeStakePoolNotRegistered")) {
    return "That pool isn't registered any more: it may have retired. Choose another.";
  }
  if (text.includes("DelegateeDRepNotRegistered")) {
    return "That DRep isn't registered any more. Choose another, or always abstain.";
  }
  if (/StakeKey(Not)?Registered|IncorrectDeposit|NonZeroRewardAccountBalance/.test(text)) {
    return "Your account's staking changed since you reviewed this. Refresh, and review it again.";
  }
  return undefined;
}

export class Koios {
  constructor(
    private readonly base: string,
    private readonly fetchFn: FetchLike = (url, init) => fetch(url, init),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /**
   * Every UTxO whose payment credential is one of `credentials` (key or
   * script hashes, hex); with `after`, only those in blocks after it. At most
   * `CREDENTIALS_PER_REQUEST` go in a request.
   */
  async credentialUtxos(credentials: string[], after?: number): Promise<KoiosUtxo[]> {
    const filter = after === undefined ? "" : `block_height=gt.${after}`;
    const rows: KoiosUtxo[] = [];
    for (let i = 0; i < credentials.length; i += CREDENTIALS_PER_REQUEST) {
      const body = { _payment_credentials: credentials.slice(i, i + CREDENTIALS_PER_REQUEST), _extended: true };
      rows.push(...(await this.paged<KoiosUtxo>("credential_utxos", body, filter)));
    }
    return rows;
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
    return this.post<KoiosTxInfo>("tx_info", {
      _tx_hashes: txHashes,
      _inputs: true,
      _metadata: false,
      _assets: true,
      _withdrawals: false,
      _certs: false,
      _scripts: false,
      _bytecode: false,
    });
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
    if (!row) throw new KoiosError("Koios returned no totals.");
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

  /** The DReps' names from their metadata; ones with none are left out. */
  drepNames(drepIds: string[]): Promise<KoiosDrepName[]> {
    return this.post<KoiosDrepName>("drep_metadata", { _drep_ids: drepIds }, `select=${DREP_NAME_COLUMNS}`);
  }

  /** The current epoch's protocol parameters: one `epoch_params` row, passed to WebAssembly as is. */
  async epochParams(): Promise<Record<string, unknown>> {
    const [row] = await this.request<Record<string, unknown>>("GET", "epoch_params", undefined, "limit=1");
    if (!row) throw new KoiosError("Koios returned no protocol parameters.");
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
   * Submits a signed transaction; returns its hash. Retried only when Koios
   * says its node was unreachable: otherwise, if an answer were lost, a
   * second submit would fail with "inputs already spent" and hide the fact
   * that the first one went through.
   */
  async submitTx(txCbor: Uint8Array<ArrayBuffer>): Promise<string> {
    let response: Response;
    let text: string;
    for (let attempt = 0; ; attempt++) {
      try {
        response = await this.fetchFn(`${this.base}/submittx`, {
          method: "POST",
          headers: { "content-type": "application/cbor" },
          body: txCbor,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        throw new KoiosError(unreachable(e));
      }
      text = await response.text();
      // Found live: a Koios backend whose own node was down answered. The
      // transaction never reached the network, so it's safe to send again,
      // and the gateway likely picks another backend.
      if (!text.includes("TxSubmitConnectionError")) break;
      if (attempt === RETRY_DELAYS_MS.length) {
        throw new KoiosError("Koios couldn't reach its Cardano node, so the transaction wasn't sent. Press Send again in a moment.");
      }
      await this.sleep(RETRY_DELAYS_MS[attempt]!);
    }
    // A UTxO it spends is already spent: Koios showed the wallet an old view
    // of the chain (spent.ts), or this transaction already went through.
    if (text.includes("BadInputsUTxO")) {
      throw new SpentInputError(
        "The network refused it: a UTxO it spends is already spent. Koios may have shown an out-of-date view of the chain. Wait a minute, refresh, and review it again.",
      );
    }
    const staking = stakingRefusal(text);
    if (staking) throw new KoiosError(staking);
    if (!response.ok) throw new KoiosError(`The network rejected the transaction: ${text.slice(0, 500)}`);
    return JSON.parse(text) as string;
  }

  /**
   * Has Ogmios, through Koios, run the scripts in an unsigned transaction.
   * Returns Ogmios's JSON-RPC answer as is: `result` lists what each script
   * used, or `error` says why they refused (Koios passes that on with status
   * 400). WebAssembly reads either. Retried like a read: evaluating changes
   * nothing.
   */
  evaluate(txCborHex: string): Promise<unknown> {
    const body = { jsonrpc: "2.0", method: "evaluateTransaction", params: { transaction: { cbor: txCborHex } } };
    return this.send<unknown>("POST", "ogmios", body, "", { answer400: true });
  }

  /** Confirmations for each transaction; `null` until it's on chain. */
  async txStatus(txHashes: string[]): Promise<Map<string, number | null>> {
    const rows = await this.post<{ tx_hash: string; num_confirmations: number | null }>("tx_status", {
      _tx_hashes: txHashes,
    });
    return new Map(rows.map((r) => [r.tx_hash, r.num_confirmations]));
  }

  /** All the rows, 1,000 a request; `filter` narrows them on Koios's side (PostgREST, e.g. `block_height=gt.5`). */
  private async paged<T>(path: string, body: unknown, filter = ""): Promise<T[]> {
    const rows: T[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await this.post<T>(
        path,
        body,
        `${filter ? `${filter}&` : ""}order=tx_hash.asc,tx_index.asc&offset=${offset}&limit=${PAGE_SIZE}`,
      );
      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
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
      try {
        response = await this.fetchFn(url, {
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
        failure = unreachable(e);
      }
      const retryable = !response || response.status === 429 || response.status >= 500;
      const delay = RETRY_DELAYS_MS[attempt];
      if (!retryable || delay === undefined) throw new KoiosError(failure);
      await this.sleep(delay);
    }
  }
}
