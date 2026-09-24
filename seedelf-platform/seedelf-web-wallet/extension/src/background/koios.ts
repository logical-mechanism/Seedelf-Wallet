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
  inline_datum: { bytes: string; value: unknown } | null;
  asset_list: KoiosAsset[] | null;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const PAGE_SIZE = 1000;
const RETRY_DELAYS_MS = [1000, 3000];
const TIMEOUT_MS = 20_000;

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

export class Koios {
  constructor(
    private readonly base: string,
    private readonly fetchFn: FetchLike = (url, init) => fetch(url, init),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /**
   * Every UTxO whose payment credential is one of `credentials` (key or
   * script hashes, hex); with `after`, only those in blocks after it.
   */
  credentialUtxos(credentials: string[], after?: number): Promise<KoiosUtxo[]> {
    const body = { _payment_credentials: credentials, _extended: true };
    return this.paged("credential_utxos", body, after === undefined ? "" : `block_height=gt.${after}`);
  }

  /** Every address that has used this stake key, including ones now empty. */
  async accountAddresses(stakeAddress: string): Promise<string[]> {
    const rows = await this.post<{ addresses: string[] }>("account_addresses", {
      _stake_addresses: [stakeAddress],
      _empty: true,
    });
    return rows[0]?.addresses ?? [];
  }

  /** Every UTxO at an address with this stake key. Anyone can build such an address, so filter by payment key. */
  accountUtxos(stakeAddress: string): Promise<KoiosUtxo[]> {
    return this.paged("account_utxos", { _stake_addresses: [stakeAddress], _extended: true });
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
