// Types for the DRep list's rules, so `tests/dreps.test.ts` can import them. The script itself stays plain JavaScript:
// it is run with `node` directly, and `scripts/` is outside the typecheck's `include`.

/** One drep_metadata row, as METADATA_SELECT asks for it: CIP-119's text, or JSON-LD's `{"@value": …}`. */
export interface MetadataRow {
  drep_id: string;
  givenName?: unknown;
  doNotList?: unknown;
}

/** The share of the committed list's DReps a refresh may lose before it's refused. */
export declare const MAX_LOSS: number;

/** The query each drep_metadata request selects by. */
export declare const METADATA_SELECT: string;

/** A name as the wallet shows it, or undefined for none. */
export declare function nameOf(givenName: unknown): string | undefined;

/** Whether a DRep's `doNotList` asks directories not to list it. */
export declare function asksNotToBeListed(doNotList: unknown): boolean;

/** What one pass's rows add to `named` (DRep ID to name) and `unlisted` (those asking not to be listed). */
export declare function readRows(rows: MetadataRow[], named: Map<string, string>, unlisted: Set<string>): void;

/** The DReps a later pass asks for: neither named nor asking not to be listed. */
export declare function stillWanted(ids: string[], named: Map<string, string>, unlisted: Set<string>): string[];

/** The list a refresh writes, by name; throws when it loses more than MAX_LOSS of the committed list's other DReps. */
export declare function listOf(
  network: string,
  lists: { ids: string[]; named: Map<string, string>; unlisted: Set<string>; committed: Map<string, string> },
): { dreps: Array<[string, string]>; kept: number; gone: number; left: number };
