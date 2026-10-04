// The words typed to delete the wallet, on Settings' Remove wallet and on the
// lock screen's Delete and restore: one check for both, so neither can accept
// what the other refuses.
//
// The phrase is the wallet's language's own ("eliminar billetera",
// "ウォレットを削除"), and English's is accepted in every language as well:
// someone following an English guide types it, and so do the end-to-end tests.
// What's typed is folded before it's compared. A Japanese IME in full-width
// mode types ｄｅｌｅｔｅ　ｗａｌｌｅｔ, and compared as typed, the button stayed
// disabled with nothing to say why.

import { t } from "../i18n";

/** The phrase in the wallet's language, as the field's label shows it. */
export const deletePhrase = (): string => t("reset.confirmText");

/** Text as it's compared: full-width and other compatibility forms folded, spaces collapsed, case dropped. */
const fold = (text: string): string => text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/** Whether `typed` is the phrase: the language's own, or English's. */
export function confirmsDelete(typed: string): boolean {
  const said = fold(typed);
  // `lng` reads English's bundle whatever the language is.
  return said === fold(deletePhrase()) || said === fold(t("reset.confirmText", { lng: "en" }));
}
