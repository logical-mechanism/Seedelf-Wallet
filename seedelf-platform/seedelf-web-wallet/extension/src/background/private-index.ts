// The private index (seedelf-data's /seedelf/v1/mainnet/…, chunk 26): the
// Seedelf contract and Lovejoin's mix box, from the wallet's own data layer.
// Every answer is the same for whoever asks, and none names a UTxO, a
// register or an owner: the wallet still decides which rows are its own,
// here, as it does with Koios's whole-contract read (contract-scan.ts).
//
// How it's read (seedelf-data/README.md, The private index):
//
//   snapshot       every row unspent as of a stable cursor, the settled view
//   since/{c}      what changed after cursor c: `created` rows (each with its
//                  `spent`, if it's gone since) and older rows `spent`, and
//                  the next stable cursor
//   names          every Seedelf name unspent at the tip, with its row
//   lovejoin/…     the same for the mix box, each box with who made it
//
// Its own part of the data layer (`private`): a failure marks it down, and
// the caller reads Koios instead (`IndexDown`).

import { dataOrigin, epochAt, type NetworkName } from "../networks";
import { assetFingerprint } from "../shared/fingerprint";
import { DATA_LIMIT, DATA_READ_TIMEOUT_MS, type DataDeps, type DataParts } from "./data-layer";
import { type FetchLike, type KoiosUtxo, RateLimit, retryAfterMs, SERVICE_FETCH } from "./koios";

/** Where something happened on chain: its block's slot, and the block's time (Unix seconds). No height: Kupo has none. */
export interface IndexPoint {
  slot: number;
  time: number;
}

/** A row of the private index (seedelf-data/README.md, A row). */
export interface IndexRow {
  /** `<tx hash>#<index>`. */
  ref: string;
  address: string;
  lovelace: string;
  /** `[policy, name, quantity, decimals]`. */
  assets?: Array<[string, string, string, number]>;
  /** The inline datum's CBOR, hex. */
  datum?: string;
  /** It carries a reference script. */
  script?: boolean;
  created: IndexPoint;
  /** In a `since` answer's `created`: spent since it was made. */
  spent?: IndexPoint & { by: string };
  /** A Lovejoin box's: whether a mix made it, and each input's payment and stake credentials (hex); `inputs` is null when Kupo answered. */
  made_by?: { mixed: boolean; inputs: Array<[string | null, string | null]> | null };
}

/** An older row spent after a cursor. */
export interface IndexSpent extends IndexPoint {
  ref: string;
  by: string;
}

export interface IndexTip extends IndexPoint {
  hash: string;
}

export interface IndexSnapshot {
  tip: IndexTip;
  cursor: string;
  rows: IndexRow[];
}

export type IndexSince =
  | { tip: IndexTip; from: string; cursor: string; created: IndexRow[]; spent: IndexSpent[]; reset?: undefined }
  /** The cursor's own block was rolled back: start again from a snapshot. */
  | { tip: IndexTip; reset: true };

export interface IndexNames {
  tip: IndexTip;
  names: Array<{ name: string; row: IndexRow }>;
}

/** The private index couldn't answer: its part is down, and the caller reads Koios. */
export class IndexDown extends Error {}

/** `rows`, as of a cursor, at the tip a `since` from it reached: what it made added, everything spent taken out. */
export function atTip(rows: IndexRow[], since: Extract<IndexSince, { reset?: undefined }>): IndexRow[] {
  const gone = new Set([...since.spent.map((s) => s.ref), ...since.created.filter((r) => r.spent).map((r) => r.ref)]);
  return [...rows, ...since.created].filter((r) => !gone.has(r.ref));
}

const REF = /^[0-9a-f]{64}#\d+$/;
const HEX = /^([0-9a-f]{2})*$/;

/** Whether `row` has a row's shape: anything else is an answer the wallet won't build on. */
function isRow(row: unknown): row is IndexRow {
  const r = row as IndexRow | null;
  return (
    typeof r?.ref === "string" &&
    REF.test(r.ref) &&
    typeof r.address === "string" &&
    typeof r.lovelace === "string" &&
    /^\d+$/.test(r.lovelace) &&
    typeof r.created?.slot === "number" &&
    typeof r.created.time === "number" &&
    (r.datum === undefined || (typeof r.datum === "string" && HEX.test(r.datum))) &&
    (r.assets === undefined ||
      (Array.isArray(r.assets) &&
        r.assets.every(
          (a) => Array.isArray(a) && typeof a[0] === "string" && typeof a[1] === "string" && typeof a[2] === "string",
        ))) &&
    (r.made_by === undefined || isMadeBy(r.made_by))
  );
}

const credOrNull = (c: unknown) => c === null || (typeof c === "string" && /^[0-9a-f]{56}$/.test(c));
const isMadeBy = (m: IndexRow["made_by"]) =>
  typeof m?.mixed === "boolean" &&
  (m.inputs === null || (Array.isArray(m.inputs) && m.inputs.every((i) => Array.isArray(i) && credOrNull(i[0]) && credOrNull(i[1]))));

const isPoint = (p: unknown): p is IndexPoint =>
  typeof (p as IndexPoint | null)?.slot === "number" && typeof (p as IndexPoint).time === "number";
const isTip = (t: unknown): t is IndexTip => isPoint(t) && typeof (t as IndexTip).hash === "string";
const isCursor = (c: unknown): c is string => typeof c === "string" && /^\d+\.[0-9a-f]{64}$/.test(c);

/** The index's client: one part of the data layer, its failures marking it down. */
export class PrivateIndex {
  constructor(
    /** `<origin>/seedelf/v1/mainnet`. */
    private readonly base: string,
    private readonly parts: DataParts,
    private readonly fetchFn: FetchLike = (url, init) => fetch(url, init),
    private readonly limit: RateLimit | undefined = DATA_LIMIT,
  ) {}

  /** The contract's rows unspent as of a stable cursor. */
  async snapshot(): Promise<IndexSnapshot> {
    return this.snapshotAt("contract/snapshot");
  }

  /** What changed in the contract after `cursor`. */
  async since(cursor: string): Promise<IndexSince> {
    return this.sinceAt(`contract/since/${cursor}`);
  }

  /** Every Seedelf name unspent at the tip, with its row. */
  async names(): Promise<IndexNames> {
    const answer = await this.get<IndexNames>("names");
    if (!isTip(answer?.tip) || !Array.isArray(answer.names)) throw await this.failed();
    if (!answer.names.every((n) => typeof n?.name === "string" && HEX.test(n.name) && isRow(n.row))) throw await this.failed();
    return answer;
  }

  /** Lovejoin's pool: every box unspent as of a stable cursor, with who made each. */
  async pool(): Promise<IndexSnapshot> {
    return this.snapshotAt("lovejoin/pool");
  }

  /** What changed in Lovejoin's pool after `cursor`. */
  async poolSince(cursor: string): Promise<IndexSince> {
    return this.sinceAt(`lovejoin/since/${cursor}`);
  }

  /**
   * Lovejoin's pool at the tip: the snapshot, and what changed since its
   * cursor, both answers every wallet shares. A pool read at the stable
   * cursor alone would be ten blocks behind, and a chain drawing from it
   * would take boxes spent since.
   */
  async poolNow(): Promise<{ tip: IndexTip; rows: IndexRow[] }> {
    const snapshot = await this.pool();
    const since = await this.poolSince(snapshot.cursor);
    // Rolled back since the snapshot, a moment ago: Koios this once.
    if (since.reset) throw new IndexDown("Lovejoin's pool was rolled back as it was read.");
    return { tip: since.tip, rows: atTip(snapshot.rows, since) };
  }

  private async snapshotAt(path: string): Promise<IndexSnapshot> {
    const answer = await this.get<IndexSnapshot>(path);
    if (!isTip(answer?.tip) || !isCursor(answer.cursor) || !Array.isArray(answer.rows) || !answer.rows.every(isRow)) {
      throw await this.failed();
    }
    return answer;
  }

  private async sinceAt(path: string): Promise<IndexSince> {
    const answer = await this.get<IndexSince>(path);
    if (!isTip(answer?.tip)) throw await this.failed();
    if (answer.reset === true) return { tip: answer.tip, reset: true };
    const spent = (answer as { spent?: unknown }).spent;
    if (
      !isCursor(answer.cursor) ||
      !Array.isArray(answer.created) ||
      !answer.created.every(isRow) ||
      !Array.isArray(spent) ||
      !spent.every((s: IndexSpent) => isPoint(s) && typeof s.ref === "string" && REF.test(s.ref) && typeof s.by === "string")
    ) {
      throw await this.failed();
    }
    return answer;
  }

  /** One request: an answer, or the part marked down and `IndexDown` thrown. */
  private async get<T>(path: string): Promise<T> {
    await this.limit?.take(1);
    let response: Response;
    try {
      response = await this.fetchFn(`${this.base}/${path}`, {
        ...SERVICE_FETCH,
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(DATA_READ_TIMEOUT_MS),
      });
    } catch {
      throw await this.failed();
    }
    if (!response.ok) throw await this.failed(response.status === 429 ? retryAfterMs(response) : undefined);
    try {
      return (await response.json()) as T;
    } catch {
      throw await this.failed();
    }
  }

  private async failed(holdMs?: number): Promise<IndexDown> {
    await this.parts.down("private", holdMs);
    return new IndexDown("The private index didn't answer.");
  }
}

/**
 * The private index on `network`, when it's to be read now: the network has
 * a data layer, the Koios-only switch is off, and the part is up. Otherwise
 * undefined, and the caller reads Koios.
 */
export function privateIndexClient(
  deps: DataDeps,
  origin: (network: NetworkName) => string | undefined = (n) => dataOrigin(n, __DATA_ORIGIN__),
): (network: NetworkName) => Promise<PrivateIndex | undefined> {
  return async (network) => {
    const at = origin(network);
    if (!at || (await deps.koiosOnly()) || !(await deps.parts.up("private"))) return undefined;
    const limit = deps.limits ? deps.limits.data : DATA_LIMIT;
    return new PrivateIndex(`${at}/seedelf/v1/${network}`, deps.parts, deps.fetch, limit);
  };
}

/**
 * A row of the index as a Koios `credential_utxos` row, so everything that
 * reads one (WebAssembly's `UtxoResponse` included) reads it unchanged:
 *
 *   payment_cred   the credential the route is for (the contract, the mix box)
 *   epoch_no       from the slot: Shelley's 432,000-slot epochs
 *   block_time     `created.time`; Lovejoin's waits and the UTxOs screen read it
 *   block_height   0: the private side reads no height once its cursor is the index's
 *   is_spent       false: the index's view is of what's unspent
 *   inline_datum   the datum's bytes, as `trimmed` keeps Koios's
 *   reference_script  one with nothing known of it, when the row carries a script: the wallet never prices
 *                  spending one (koios.ts `measurable`)
 *   asset_list     each token's decimals as the index gives them, and its CIP-14 fingerprint worked out here
 */
export function utxoOf(row: IndexRow, paymentCred: string, network: NetworkName = "mainnet"): KoiosUtxo {
  const at = row.ref.lastIndexOf("#");
  return {
    tx_hash: row.ref.slice(0, at),
    tx_index: Number(row.ref.slice(at + 1)),
    address: row.address,
    value: row.lovelace,
    stake_address: null,
    payment_cred: paymentCred,
    block_height: 0,
    block_time: row.created.time,
    inline_datum: row.datum === undefined ? null : { bytes: row.datum, value: null },
    datum_hash: null,
    asset_list: (row.assets ?? []).map(([policy_id, asset_name, quantity, decimals]) => ({
      policy_id,
      asset_name,
      quantity,
      decimals: typeof decimals === "number" ? decimals : 0,
      fingerprint: assetFingerprint({ policyId: policy_id, assetName: asset_name }),
    })),
    reference_script: row.script ? { hash: null, size: null, type: null, bytes: null } : null,
    // WebAssembly's UtxoResponse requires these; KoiosUtxo's type leaves them out.
    ...{ epoch_no: epochAt(network, row.created.time * 1000), is_spent: false },
  };
}

