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
 * The personal tag in a Seedelf's name, if it reads as text. A name is
 * prefix (4 bytes) ‖ tag (0–15 bytes) ‖ output index (1 byte) ‖ tx id,
 * cut to 32 bytes, with nothing marking where the tag ends. So take the
 * printable ASCII that starts the 15-byte window; the index byte after a
 * shorter tag is almost always unprintable.
 *
 * Nothing of that run is dropped unseen but the spaces that end it, which `seedelfIndex` says ("#32"): a space that
 * starts the tag, or follows another space, is shown as "␣" (`SHOWN_SPACE`), since a page draws neither. A label that
 * hid them let a Seedelf minted from output 32, or under a tag moved one place behind a space, read as another's (the
 * 1.10.0 gate's second review). A run of spaces alone is no label.
 */
export function seedelfLabel(assetName: string): string | undefined {
  const run = shownRun(assetName);
  if (!run) return undefined;
  return [...run].map((c, i) => (c === " " && (i === 0 || run[i - 1] === " ") ? SHOWN_SPACE : c)).join("");
}

/**
 * How a label shows a space a page wouldn't draw (one that starts the tag, or follows another): OPEN BOX, which is no
 * printable ASCII, so no tag's own byte reads as it.
 */
export const SHOWN_SPACE = "\u2423";

/** The tag's bytes as text, before any trim: the run of printable ASCII that starts the 15-byte window. */
function tagRun(assetName: string): string {
  let run = "";
  for (let i = SEEDELF_PREFIX.length; i < SEEDELF_PREFIX.length + 30 && i + 2 <= assetName.length; i += 2) {
    const byte = Number.parseInt(assetName.slice(i, i + 2), 16);
    if (!(byte >= 0x20 && byte <= 0x7e)) break;
    run += String.fromCharCode(byte);
  }
  return run;
}

/** That run without the spaces that end it: what the label shows, and where the index is read. */
const shownRun = (assetName: string): string => tagRun(assetName).replace(/ +$/, "");

/**
 * The output index in a Seedelf's name, as far as a name can be read: the byte right after the tag `seedelfLabel`
 * shows (the run of printable ASCII, less the spaces that end it), as a number; undefined where the name ends before
 * that byte. The mint spent output `index` of a transaction, its first input, and the bytes after the index are the
 * start of that transaction's id (lib/token_name.ak `generate`).
 *
 * What it's for: the last sixteen of a name, which the wallet shows, are bytes of that transaction's id. A Seedelf
 * minted from another output of the same transaction, under a tag as long, has the same sixteen, and anyone can mint
 * any tag: the two names differ at the index alone. Each then shows its own index, and they differ.
 *
 * What is shown is exact for the head of the name: the label gives every byte of the run (its spaces marked or
 * plain, none dropped), and the index is the one byte after it. So two names that show the same label, index and
 * sixteen are the same up to that byte and in their last eight, and differ only in bytes of a transaction's id
 * between: that takes two ids that match in the sixteen, 64 bits. For a Seedelf this wallet mints (a tag of printable
 * ASCII with no space at its ends: label.ts, CreateSeedelf) from an output under 32, the label is its tag and the
 * index its own, and nothing cheaper reads as it. tests/seedelf-short-form.test.ts holds that against every tag and
 * index of one transaction.
 *
 * Nothing marks where the tag ends, so the byte read isn't the index for every name:
 *
 *   - A tag with a byte that isn't printable ASCII (an accent, kana, a control byte) shows that byte, the tag's first
 *     such. A sibling under the same tag shows the same one: those two still read alike.
 *   - A tag that ends in a space reads "#32", whatever its index; and so does its sibling.
 *   - An index of 33 to 126 reads as a letter of the tag (under a tag shorter than fifteen), and the byte shown is a
 *     later one, of the transaction's id: its tag reads a letter longer than its sibling's. An index of 32 reads as
 *     itself, "#32".
 *   - The sixteen are 64 bits of a transaction's id.
 */
export function seedelfIndex(assetName: string): number | undefined {
  const at = SEEDELF_PREFIX.length + 2 * shownRun(assetName).length;
  const byte = assetName.slice(at, at + 2);
  return /^[0-9a-f]{2}$/i.test(byte) ? Number.parseInt(byte, 16) : undefined;
}

/**
 * The space between a name's last sixteen and its index: a no-break one, so no line ends between them. With a plain
 * space, "#0)" went to a line of its own in the Seedelfs' switches at 360 px, in a reveal's notice and in a bubble
 * (the 1.10.0 gate's visual check). A test writes it as the escape, u00a0.
 */
const INDEX_SPACE = "\u00a0";

/**
 * The end of a Seedelf's name as the wallet shows it: its last sixteen, a space, `#` and its output index
 * (`4b7616eb63a4b4b8 #1`); the sixteen alone where the name has no index to read. The sixteen are bytes of the
 * transaction the mint spent, which a Seedelf minted from another output of it shares: the index tells those apart
 * (`seedelfIndex`, with what it can't).
 */
export function seedelfTail(name: string): string {
  const index = seedelfIndex(name);
  const sixteen = name.slice(-16);
  return index === undefined ? sixteen : `${sixteen}${INDEX_SPACE}#${index}`;
}

/**
 * A Seedelf's name cut short, the one form the wallet shows it in: its prefix, then its end as `seedelfTail` has it
 * (`5eed0e1f…4b7616eb63a4b4b8 #1`). Every screen and the worker's own words call this, so no two cut a name their
 * own way. The start of a name is a prefix and a tag anyone can copy, so none of the tag is in it.
 */
export function seedelfShort(name: string): string {
  return `${name.slice(0, SEEDELF_PREFIX.length)}…${seedelfTail(name)}`;
}

const SHORT_FORM = new RegExp(`^${SEEDELF_PREFIX}…[0-9a-f]{16}(?:${INDEX_SPACE}#[0-9]{1,3})?$`, "i");

/**
 * Whether `text` is a Seedelf's short form as `seedelfShort` writes it: the prefix, "…", sixteen hex and, where the
 * name had one, the no-break space, "#" and the index. The worker saves a Seedelf with no tag so in Activity's
 * entries, which are sealed: a screen that meets one says it as it is, on one line, and never cuts it again. What an
 * entry saved before 1.10.0 (twelve and six, "5eed0e1f00cf…a4b4b8") isn't one, and stays as it was.
 */
export const isSeedelfShort = (text: string): boolean => SHORT_FORM.test(text);

// `.warn.`: Send's destination field shows it in its alert, through the state
// its effect sets (scripts/i18n-critical.mjs follows it there). Send pays your
// own seedelf too, and says so: it no longer refuses it (chunk 51, gap-g8#2).
export const SEEDELF_NAME_RULE = () => t("shared.seedelf.warn.nameRule");

/** Make public (withdraw) pays an address; a seedelf is paid by Send. */
export const SEEDELF_NOT_AN_ADDRESS = () => t("shared.seedelf.notAnAddress");
