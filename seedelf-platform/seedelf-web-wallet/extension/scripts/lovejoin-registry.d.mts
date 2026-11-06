// Types for the Lovejoin registry's naming, so `tests/lovejoin-registry.test.ts`
// can import it. The script itself stays plain JavaScript: it is run with
// `node` directly, and `scripts/` is outside the typecheck's `include`.

/** WebAssembly's verified view of a pool, the fields the script reads (`lovejoin::PoolView`). */
export interface PoolView {
  id: string;
  /** `tokenV1` for 8131b1d's set, `v2` for v2's. */
  version: string;
  boxLovelace: string;
  token?: { policyId: string; assetName: string; quantity: string };
  mixBoxHash: string;
  mixLogicHash: string;
  feeHash: string;
}

/** One entry of the registry's `contracts`. */
export interface Contract {
  name: string;
  version: number;
  language: "PLUTUS";
  languageVersion: 3;
  scriptHash: string;
  github: string;
  description: string;
}

/** The set names WebAssembly verifies a token pool as. */
export type SetName = "tokenV1" | "v2";

export declare const NETWORK: "mainnet";
/** seedelf-core's `lovejoin/templates.rs`, which pins each set's commit. */
export declare const TEMPLATES: URL;
export declare const MAX_NAME: number;
export declare const MAX_DESCRIPTION: number;

/** Each set's templates.rs constant, what its names add, and its registry version. */
export declare const SETS: Record<SetName, { commit: string; label: string; version: number }>;

/** Each set's commit, read from templates.rs's source. */
export declare function commitsOf(source: string): Record<SetName, string>;

/** `units` with `decimals` places, as the wallet writes amounts. */
export declare function amount(units: string, decimals: number): string;

/** What a pool's boxes each hold, by the token registry's tickers and decimals. */
export declare function valueOf(view: PoolView, tokens: Record<string, { ticker?: string; decimals?: number }>): string;

/** A pool's four entries, named for `value` and its set; throws for a set SETS doesn't name. */
export declare function entriesOf(view: PoolView, value: string, commits: Record<string, string>): Contract[];
