// Chunk 51, G8's notes (b1#1's family). `npm run tokens` writes src/tokens/registry.<network>.json, which is committed,
// in the order of its units (`policy.name`), and sorted them with localeCompare and no locale, which takes the
// refreshing shell's (LC_ALL, then LC_MESSAGES, then LANG). In Danish or Norwegian "aa" sorts as "å", after "z", so a
// refresh made there moved every unit with an "aa" in its lead to the end: a diff with nothing in it. It sorts in
// "en-US" now, as the notices' byName does. Each case sorts in a fresh node in that locale, as the refresh would run.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const script = pathToFileURL(fileURLToPath(new URL("../scripts/tokens.mjs", import.meta.url))).href;

/** `units` as the registry's entries, sorted by tokens.mjs's `byUnit` in a fresh node in `locale`. */
function sortedIn(locale: string, units: string[]): string[] {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: locale };
  delete env.NODE_OPTIONS;
  const code = [
    `import { readFileSync } from "node:fs";`,
    `import { byUnit } from ${JSON.stringify(script)};`,
    `const sorted = JSON.parse(readFileSync(0, "utf8")).map((unit) => [unit, {}]).sort(byUnit);`,
    `process.stdout.write(JSON.stringify(sorted.map(([unit]) => unit)));`,
  ].join("\n");
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", code], {
    env,
    input: JSON.stringify(units),
    encoding: "utf8",
    timeout: 60_000,
  });
  return JSON.parse(out);
}

const committed = ["mainnet", "preprod"].map((network) =>
  Object.keys(JSON.parse(readFileSync(new URL(`../src/tokens/registry.${network}.json`, import.meta.url), "utf8"))),
);
// Units whose order an "aa" decides, beside the committed ones (none of which has one where it counts today).
const AA = ["aa11c0ffee.4d494e", "ab22c0ffee.4d494e", "b033c0ffee.4d494e", "f0aac0ffee.00", "f0abc0ffee.00"];

describe("the token registry's order", () => {
  const units = [...committed.flat(), ...AA];
  let reference: string[] = [];
  beforeAll(() => {
    reference = sortedIn("C", units);
  }, 60_000);

  it("is each committed file's own order", () => {
    expect(committed.flat().length).toBeGreaterThan(10);
    for (const keys of committed) expect(reference.filter((u) => keys.includes(u))).toEqual(keys);
  });

  it.each(["en_US.UTF-8", "da_DK.UTF-8", "nb_NO.UTF-8", "et_EE.UTF-8"])(
    "is the same in %s as in C",
    (locale) => {
      expect(sortedIn(locale, units)).toEqual(reference);
    },
    60_000,
  );
});
