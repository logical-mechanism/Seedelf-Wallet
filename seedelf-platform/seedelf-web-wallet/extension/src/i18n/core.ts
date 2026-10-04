// The wallet's words, in the language the user chose. i18next, bundled: every
// locale is in the build, nothing is fetched, and no host is asked for.
//
// Two things about this module are load-bearing, and both are there so the
// rest of the wallet needs no ceremony:
//
//   * **It initialises when it's imported**, synchronously, in English. So a
//     component rendered bare — which is how about 120 tests render them —
//     has a working `t()` with no provider and no waiting, and the words that
//     come out are the English ones that were in the source before.
//   * **Nothing here is React.** The worker shows the user error messages too
//     (`sessions.ts`, `lovejoin.ts`, `dapp.ts`, `koios.ts`), so it needs the
//     same `t()`. React lives in `./index.tsx`.
//
// `startI18n()` then switches to the stored language before the first paint.
// Where that choice is kept, and what it discloses, is `LOCAL_LANGUAGE` in
// shared/preferences.ts, beside the network's key and the account's.

import i18next from "i18next";

import { LOCAL_LANGUAGE } from "../shared/preferences";
import { DEFAULT_LANGUAGE, type I18nKey, isSupportedLanguage, type LanguageCode, resources } from "./translations";

i18next.init({
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  resources,
  // Flat dot-notation keys ("receive.title"), so neither separator applies.
  keySeparator: false,
  nsSeparator: false,
  // React escapes what it renders; i18next escaping first would show the
  // entities themselves ("Couldn&#39;t read") on the screen.
  interpolation: { escapeValue: false },
  // Everything is already bundled: init synchronously, so `t()` works on the
  // line after this one rather than a tick later (i18next's `initAsync`).
  initAsync: false,
});

export const i18n = i18next;

/**
 * The system's language when it's one we ship, else English. Chrome's UI
 * language first — it's what the rest of the browser is in — then the
 * page's own list.
 */
export function getSystemLanguage(): LanguageCode {
  const asked: string[] = [];
  const ui = globalThis.chrome?.i18n?.getUILanguage?.();
  if (ui) asked.push(ui);
  asked.push(...(globalThis.navigator?.languages ?? []), globalThis.navigator?.language ?? "");
  for (const tag of asked) {
    if (!tag) continue;
    // "es-419" and "ja-JP" are Spanish and Japanese.
    const base = tag.toLowerCase().split("-")[0] ?? "";
    if (isSupportedLanguage(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}

/** The language stored for this profile, or undefined when nothing valid is. */
async function storedLanguage(): Promise<LanguageCode | undefined> {
  try {
    const got = await chrome.storage.local.get(LOCAL_LANGUAGE);
    const value = got[LOCAL_LANGUAGE];
    return isSupportedLanguage(value) ? value : undefined;
  } catch {
    // No extension storage (a test, or a page that can't reach it): English.
    return undefined;
  }
}

/**
 * Put the wallet in the right language before anything is drawn: the stored
 * one, else the system's. Awaited by `main.tsx` ahead of the first render, so
 * no screen is ever painted in English and then redrawn.
 */
export async function startI18n(): Promise<LanguageCode> {
  const chosen = (await storedLanguage()) ?? getSystemLanguage();
  await applyLanguage(chosen);
  follow();
  return chosen;
}

/** Switch language, and tell the document, without storing the choice. */
async function applyLanguage(code: LanguageCode): Promise<void> {
  if (i18next.language !== code) await i18next.changeLanguage(code);
  // Screen readers, hyphenation and spell check all read this.
  globalThis.document?.documentElement?.setAttribute("lang", code);
}

/** The user's choice: stored, and applied here and in every other open page. */
export async function setLanguage(code: LanguageCode): Promise<void> {
  await applyLanguage(code);
  try {
    await chrome.storage.local.set({ [LOCAL_LANGUAGE]: code });
  } catch {
    // Stored or not, the page the user is looking at has changed language.
  }
}

/** Current language, for a screen that shows which one is on. */
export const currentLanguage = (): LanguageCode =>
  isSupportedLanguage(i18next.language) ? i18next.language : DEFAULT_LANGUAGE;

let following = false;

/**
 * Follow the choice another page makes — the side panel beside a tab, or the
 * connector's window. Local storage's own event, never
 * `chrome.storage.onChanged`: that one carries session storage's changes too,
 * the vault's entropy among them, into this page (`ui/preferences.tsx` says
 * the same of the settings).
 */
function follow(): void {
  if (following) return;
  const changed = (changes: Record<string, chrome.storage.StorageChange>) => {
    const next = changes[LOCAL_LANGUAGE]?.newValue;
    if (isSupportedLanguage(next)) void applyLanguage(next);
  };
  try {
    chrome.storage.local.onChanged.addListener(changed);
    following = true;
  } catch {
    // No storage events here; the page still has the language it started in.
  }
}

/** What a `t()` call takes: one of our keys, and the values to put in it. */
export type Translate = (key: I18nKey, values?: Record<string, unknown>) => string;

/**
 * The wallet's words, outside React: the worker's messages, and anything a
 * plain function writes. Screens use `useT` from `./index.tsx` instead, so
 * they redraw when the language changes.
 *
 * Typed by us rather than by i18next, for one reason: a plural is named by its
 * base key and i18next's own types only know the `_one`/`_other` entries that
 * are really in the JSON. `Translate` accepts the base, which is what a call
 * site writes, and the cast is here — once — instead of at every call.
 */
export const t: Translate = (key, values) => i18next.t(key as never, values as never) as unknown as string;

/**
 * What goes between two whole sentences: a space in English and Spanish,
 * nothing in Japanese, where `.join(" ")` leaves "。 " in the middle of a
 * paragraph. Read from the bundle — `common.sentencePair` with both halves
 * empty — so a language added later brings its own and no code has to know it.
 */
export const sentenceGap = (): string => t("common.sentencePair", { first: "", next: "" });

/** Whole sentences, one after another, set the way the language sets them. Empty parts are left out. */
export const joinSentences = (parts: ReadonlyArray<string | false | null | undefined>): string =>
  parts.filter((part): part is string => Boolean(part)).join(sentenceGap());

/** The items of a list, with the language's own comma: ", " in English, "、" in Japanese. */
export const joinList = (items: readonly string[]): string => items.join(t("histories.list.comma"));
