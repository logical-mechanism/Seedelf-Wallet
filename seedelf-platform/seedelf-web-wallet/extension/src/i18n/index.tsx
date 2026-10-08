// The wallet's words, for the screens. `./core.ts` holds the engine and is
// what the worker uses; this adds the two things React needs.
//
// There is no provider. `core.ts` initialises when it's imported, so a
// component rendered on its own — which is how the tests render them — has its
// words already, in English, with nothing to wrap it in.

import { Fragment, useEffect, useState, type ReactNode } from "react";

import { i18n, t, type Translate } from "./core";
import type { I18nKey } from "./translations";

export { currentLanguage, dateLocale, joinList, joinSentences, sentenceGap, setLanguage, startI18n, t } from "./core";
export { availableLanguages, DEFAULT_LANGUAGE, type LanguageCode } from "./translations";
export type { I18nKey };

/**
 * The wallet's words, and a redraw when the language changes — including a
 * change another page made, which `core.ts` follows.
 */
export function useT(): Translate {
  const [, redraw] = useState(0);
  useEffect(() => {
    const changed = () => redraw((n) => n + 1);
    i18n.on("languageChanged", changed);
    return () => {
      i18n.off("languageChanged", changed);
    };
  }, []);
  return t;
}

/** Unlikely in any sentence, so splitting on it can't cut a translation. */
const MARK = "\u0000";

/**
 * A sentence with markup inside it — a bolded phrase, a `<code>` span.
 *
 * The translator sees one whole sentence with `{{placeholders}}` where the
 * marked-up phrases go, so word order is theirs to choose:
 *
 *   "accounts.koios": "{{look}} and {{check}} each ask Koios about one account."
 *   <Rich k="accounts.koios" parts={{ look: <strong>…</strong>, check: <strong>…</strong> }} />
 *
 * Placeholders rather than numbered tags on purpose: `tests/i18n.test.ts`
 * already holds every locale to English's `{{tokens}}`, so a translation that
 * drops the bolded phrase fails there, with no second mechanism to maintain.
 */
export function Rich({
  k,
  parts,
  values,
}: {
  k: I18nKey;
  parts: Record<string, ReactNode>;
  values?: Record<string, unknown>;
}) {
  const translate = useT();
  const marks = Object.fromEntries(Object.keys(parts).map((name) => [name, `${MARK}${name}${MARK}`]));
  const text = translate(k, { ...values, ...marks });
  return (
    <>
      {text.split(MARK).map((piece, i) => (
        // Odd pieces are the placeholder names; even ones are the words around
        // them. A Fragment, never a <span>: the markup a screen renders has to
        // come out exactly as it did before the sentence moved into a key.
        <Fragment key={i}>{i % 2 ? (parts[piece] ?? "") : piece}</Fragment>
      ))}
    </>
  );
}
