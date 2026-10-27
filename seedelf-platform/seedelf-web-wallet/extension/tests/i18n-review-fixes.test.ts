// 1.6.0's release review, on the words of keys that were there already. i18n.test.ts catches mangling and leaves
// wording to people; what's here is an owner's rule that new values broke in all three languages.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const locale = (code: string): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../src/i18n/translations/${code}.json`, import.meta.url), "utf8"));

describe("a send no server answered, in every language (1.6.0's release review, x-i18n-ja#0)", () => {
  // The screens say "the server" wherever ours or Koios may answer (the owner, 2026-10-09). On mainnet the wallet's
  // own server takes a send first, so "Koios didn't answer" names the wrong one; 1.6.0's parts messages said it.
  const KOIOS_SILENT: Record<string, RegExp> = {
    en: /Koios didn.t answer/,
    es: /Koios no respondi/,
    ja: /Koios が応答/,
  };

  it.each(Object.keys(KOIOS_SILENT))("%s says the server didn't answer, never Koios", (code) => {
    const naming = Object.entries(locale(code))
      .filter(([, value]) => KOIOS_SILENT[code]!.test(value))
      .map(([key]) => key);
    expect(naming).toEqual([]);
  });
});
