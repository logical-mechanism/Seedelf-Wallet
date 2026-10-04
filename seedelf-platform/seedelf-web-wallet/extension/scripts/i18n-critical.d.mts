// Types for the critical-key deriver, so `tests/i18n.test.ts` and
// `tests/i18n-critical-helpers.test.ts` can import it.
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

/** A key a critical element shows from outside its own JSX. */
export interface HelperKey {
  /** The key, by its base. */
  key: string;
  /** The critical element, as `ui/screens/X.tsx:12`. */
  at: string;
  /** The names followed to it, outermost first: a function, a const, `<Component>`. */
  via: string[];
}

/**
 * Every key a critical element shows through a function it calls, a name it
 * reads or a component it renders, followed through src/ui and src/shared:
 * what `criticalKeys`, reading the element's own JSX, can't see. One entry
 * per key per element, by its shortest route. For `tests/i18n-critical-helpers.test.ts`.
 */
export declare function keysThroughHelpers(options: {
  /** The real keys, en.json's: a literal counts when it names one. */
  keys: string[];
  /** The .tsx files to look for critical elements in; every one under src/ui by default. */
  files?: string[];
  /** The directories a name may be followed into; src/ui and src/shared by default. */
  follow?: string[];
  /** A file's source, or undefined when there is none; the disk by default. */
  read?: (path: string) => string | undefined;
  /** What `at` is relative to; src by default. */
  root?: string;
}): HelperKey[];
