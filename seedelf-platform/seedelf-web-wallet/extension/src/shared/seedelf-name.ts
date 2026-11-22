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

/**
 * The personal tag in a seedelf's name, if it reads as text. A name is
 * prefix (4 bytes) ‖ tag (0–15 bytes) ‖ output index (1 byte) ‖ tx id,
 * cut to 32 bytes, with nothing marking where the tag ends. So take the
 * printable ASCII that starts the 15-byte window; the index byte after a
 * shorter tag is almost always unprintable.
 */
export function seedelfLabel(assetName: string): string | undefined {
  let label = "";
  for (let i = SEEDELF_PREFIX.length; i < SEEDELF_PREFIX.length + 30 && i + 2 <= assetName.length; i += 2) {
    const byte = Number.parseInt(assetName.slice(i, i + 2), 16);
    if (!(byte >= 0x20 && byte <= 0x7e)) break;
    label += String.fromCharCode(byte);
  }
  label = label.trim();
  return label ? label : undefined;
}

// `.warn.`: Send's destination field shows it in its alert, through the state
// its effect sets (scripts/i18n-critical.mjs follows it there). Send pays your
// own seedelf too, and says so: it no longer refuses it (chunk 51, gap-g8#2).
export const SEEDELF_NAME_RULE = () => t("shared.seedelf.warn.nameRule");

/** Make public (withdraw) pays an address; a seedelf is paid by Send. */
export const SEEDELF_NOT_AN_ADDRESS = () => t("shared.seedelf.notAnAddress");
