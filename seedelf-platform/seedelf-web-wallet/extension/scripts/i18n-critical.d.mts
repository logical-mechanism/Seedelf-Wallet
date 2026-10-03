// Types for the critical-key deriver, so `tests/i18n.test.ts` can import it.
// The script itself stays plain JavaScript: it is run with `node` directly,
// and `scripts/` is outside the typecheck's `include`.

/** A key whose own name says it carries a privacy decision or a warning. */
export declare function criticalByName(key: string): boolean;

/**
 * The accuracy-critical keys: what a privacy or warning callout shows, plus
 * every key in `allKeys` whose name declares it one. Sorted.
 */
export declare function criticalKeys(allKeys?: string[]): string[];

/** Where the checked-in list lives. */
export declare const CRITICAL_FILE: string;
