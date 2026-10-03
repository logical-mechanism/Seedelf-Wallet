// Every language the wallet ships, bundled. Nothing is fetched: no new host,
// and the picker's list is derived from these files rather than kept beside
// them, so adding a language is one import and nothing else.
//
// To add one:
//   1. Write `<code>.json`, mirroring `en.json`'s keys exactly.
//   2. Set its own `language.name` (in that language) and `language.code`.
//   3. Import it below and add it to `bundles`.
// i18next and the picker then pick it up. `tests/i18n-parity.test.ts` holds
// the key sets identical, so a half-finished file fails rather than ships.

import en from "./en.json";
import es from "./es.json";
import ja from "./ja.json";

/** Every bundle we ship, by its fallback code. */
export const bundles = { en, es, ja } as const;

export type LanguageCode = keyof typeof bundles;

/** The language a wallet is in when nothing is stored and the system's isn't one of ours. */
export const DEFAULT_LANGUAGE: LanguageCode = "en";

/** The key each bundle names itself under, for the picker. */
const NAME_KEY = "language.name";
const CODE_KEY = "language.code";

/**
 * The picker's list: each language's code and its name *in that language*,
 * read from the bundle itself. A language never appears in the picker under
 * an English name.
 */
export const availableLanguages = Object.entries(bundles).map(([fallback, messages]) => {
  const flat = messages as Record<string, string>;
  return {
    code: (flat[CODE_KEY] ?? fallback).toLowerCase(),
    name: flat[NAME_KEY] ?? fallback,
  } as const;
});

export const supportedLanguageCodes = availableLanguages.map((l) => l.code);

/** What i18next's `init` takes: one namespace, every bundle preloaded. */
export const resources = Object.fromEntries(
  Object.entries(bundles).map(([code, messages]) => [code, { translation: messages }]),
);

/** Whether a stored or system-supplied code is one we ship. */
export const isSupportedLanguage = (value: unknown): value is LanguageCode =>
  typeof value === "string" && supportedLanguageCodes.includes(value.toLowerCase());

/** The keys of `en.json`, so a typo in a `t()` call is a compile error. */
export type I18nKey = keyof typeof en;
