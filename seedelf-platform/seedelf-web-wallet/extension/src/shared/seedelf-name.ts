// A seedelf's name is its whole token name: 32 bytes of hex starting with the
// 5eed0e1f prefix. Tags aren't unique (anyone can mint "alice"), so a
// seedelf is only ever paid by its full name.

import { t } from "../i18n";
/** The seedelf token-name prefix (lib/token_name.ak). */
export const SEEDELF_PREFIX = "5eed0e1f";

const NAME = /^5eed0e1f[0-9a-f]{56}$/;

/** A pasted seedelf name, tidied (spaces dropped, lowercase); undefined when it isn't a whole name. */
export function seedelfName(input: string): string | undefined {
  const name = input.replace(/\s+/g, "").toLowerCase();
  return NAME.test(name) ? name : undefined;
}

// `.warn.`, both: Send's destination field shows them in its alert, through
// the state its effect sets (scripts/i18n-critical.mjs follows it there).
export const SEEDELF_NAME_RULE = () => t("shared.seedelf.warn.nameRule");

/** Send from the public account pays someone else's seedelf; paying your own is Make private (a move-in). */
export const OWN_SEEDELF_FROM_ACCOUNT = () => t("shared.seedelf.warn.ownFromAccount");

/** Make public (withdraw) pays an address; a seedelf is paid by Send. */
export const SEEDELF_NOT_AN_ADDRESS = () => t("shared.seedelf.notAnAddress");
