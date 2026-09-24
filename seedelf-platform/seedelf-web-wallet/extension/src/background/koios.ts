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

export class Koios {
  constructor(
    private readonly base: string,
    private readonly fetchFn: FetchLike = (url, init) => fetch(url, init),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Every UTxO whose payment credential is one of `credentials` (key or script hashes, hex). */
  credentialUtxos(credentials: string[]): Promise<KoiosUtxo[]> {
    return this.paged("credential_utxos", { _payment_credentials: credentials, _extended: true });
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
   * Submits a signed transaction; returns its hash. Not retried: if an answer
   * were lost, a second submit would fail with "inputs already spent" and hide
   * the fact that the first one went through.
   */
  async submitTx(txCbor: Uint8Array<ArrayBuffer>): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.base}/submittx`, {
        method: "POST",
        headers: { "content-type": "application/cbor" },
        body: txCbor,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new KoiosError(`Couldn't reach Koios (${(e as Error).message}).`);
    }
    const text = await response.text();
    if (!response.ok) throw new KoiosError(`The network rejected the transaction: ${text.slice(0, 500)}`);
    return JSON.parse(text) as string;
  }

  /** Confirmations for each transaction; `null` until it's on chain. */
  async txStatus(txHashes: string[]): Promise<Map<string, number | null>> {
    const rows = await this.post<{ tx_hash: string; num_confirmations: number | null }>("tx_status", {
      _tx_hashes: txHashes,
    });
    return new Map(rows.map((r) => [r.tx_hash, r.num_confirmations]));
  }

  private async paged<T>(path: string, body: unknown): Promise<T[]> {
    const rows: T[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await this.post<T>(path, body, `order=tx_hash.asc,tx_index.asc&offset=${offset}&limit=${PAGE_SIZE}`);
      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
    }
  }

  private post<T>(path: string, body: unknown, query = ""): Promise<T[]> {
    return this.request<T>("POST", path, body, query);
  }

  private async request<T>(method: "GET" | "POST", path: string, body: unknown, query = ""): Promise<T[]> {
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
        if (response.ok) return (await response.json()) as T[];
        failure = `Koios answered ${response.status} for ${path}.`;
      } catch (e) {
        failure = `Couldn't reach Koios (${(e as Error).message}).`;
      }
      const retryable = !response || response.status === 429 || response.status >= 500;
      const delay = RETRY_DELAYS_MS[attempt];
      if (!retryable || delay === undefined) throw new KoiosError(failure);
      await this.sleep(delay);
    }
  }
}
