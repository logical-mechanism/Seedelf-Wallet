// Types for the third-party notices, so `tests/third-party.test.ts` can import
// them. The script itself stays plain JavaScript: it is run with `node`
// directly, and `scripts/` is outside the typecheck's `include`.

/** A component the notices list. */
export interface Component {
  /** "<name> v<version>". */
  name: string;
  licence: string;
  /** Its folder, where its licence files are. */
  dir: string;
}

/**
 * The npm packages the build bundles: package.json's dependencies, theirs, and
 * so on, found in `lock` (package-lock.json by default) where node finds them.
 * `installed` says whether a lockfile path is on disk (the disk's answer by
 * default): an optional one that isn't ships nothing.
 */
export declare function npmPackages(
  lock?: { packages: Record<string, Record<string, unknown>> },
  installed?: (path: string) => boolean,
): Component[];

/** The notices for `version`: their text, and how many components and licence texts it holds. */
export declare function thirdParty(version: string): { text: string; components: number; texts: number };
