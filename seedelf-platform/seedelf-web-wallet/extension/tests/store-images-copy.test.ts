// e2e/store-images.spec.ts makes the store listing's images, and CI doesn't
// run it (it writes into docs/). So it went on filling chunk 23's renamed tag
// label and waiting for its deleted "4 addresses used", unnoticed, until the
// 1.2.0 images were due. This holds the English it fills, clicks and waits for
// to en.json's.

import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const spec = read("../e2e/store-images.spec.ts");
const values = Object.values(JSON.parse(read("../src/i18n/translations/en.json")) as Record<string, string>);

/** On screen from the recordings or the code, not from en.json. */
const DATA = new Set(["MAINNET", "28 ₳", "USDM", "DJED"]);

/** The string each `call("…")` in the spec is handed; a negated assertion's isn't counted. */
const handed = (call: RegExp) => [...spec.matchAll(call)].map((m) => m[1]!);
const PLACEHOLDER = /\{\{[^}]+\}\}/g;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A value with its placeholders filled any way, if enough of it is its own words to tell ("{{a}} ({{b}})" isn't). */
const renders = (text: string) =>
  values.some(
    (v) =>
      v.replace(PLACEHOLDER, "").trim().length >= 4 &&
      new RegExp(`^${v.split(PLACEHOLDER).map(escape).join(".+")}$`).test(text),
  );
/** How a value starts, up to its first placeholder. */
const starts = (text: string) =>
  values.some((v) => {
    const head = v.split("{{")[0]!;
    return head.length >= 6 && (text.startsWith(head) || head.startsWith(text));
  });

it("the store images' spec looks for English the wallet still shows", () => {
  const labels = [...handed(/getByLabel\("([^"]+)"/g), ...handed(/getByRole\("\w+", \{ name: "([^"]+)"/g)];
  const texts = handed(/(?<!not\.)toHaveText\("([^"]+)"\)/g);
  const contained = handed(/(?<!not\.)toContainText\("([^"]+)"\)/g);
  // It still finds what it checks, so a rewrite of the spec can't leave this checking nothing.
  expect(labels.length + texts.length + contained.length).toBeGreaterThanOrEqual(15);
  const fix = "change the spec to the English en.json has now; what the recordings show goes in DATA";
  expect(labels.filter((label) => !values.includes(label)), fix).toEqual([]);
  expect(texts.filter((text) => !DATA.has(text) && !renders(text)), fix).toEqual([]);
  expect(contained.filter((text) => !DATA.has(text) && !starts(text)), fix).toEqual([]);
});
