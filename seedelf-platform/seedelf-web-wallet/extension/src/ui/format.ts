// Display formatting for amounts and token names. Amounts arrive as integer
// strings and are handled as bigint, so nothing is rounded on the way.

import { currentLanguage, dateLocale, type I18nKey, t } from "../i18n";
import { epochStart, type NetworkName, slotStart } from "../networks";
import {
  ALWAYS_ABSTAIN,
  ALWAYS_NO_CONFIDENCE,
  type AdaPrice,
  type Locked,
  type PoolRef,
  type StakeInfo,
  type TokenAmount,
} from "../shared/rpc";
import { seedelfShort } from "../shared/seedelf-name";

/** An integer amount with `decimals` places, grouped and with trailing zeros trimmed: "1,234.5". */
export function formatQuantity(quantity: string, decimals: number): string {
  const value = BigInt(quantity);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = (abs / scale).toLocaleString("en-US");
  const fraction = decimals > 0 ? (abs % scale).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** Lovelace as ADA. */
export function formatAda(lovelace: string): string {
  return formatQuantity(lovelace, 6);
}

// CIP-67 labels that prefix CIP-68 token names: reference (100), NFT (222),
// fungible (333) and rich fungible (444).
const CIP67_LABELS = ["000643b0", "000de140", "0014df10", "001bc280"];

/** A token's name for display: UTF-8 text when it reads as text, otherwise shortened hex. */
export function tokenName(assetName: string): string {
  if (!assetName) return t("format.noName");
  const label = CIP67_LABELS.find((l) => assetName.startsWith(l));
  const body = label ? assetName.slice(8) : assetName;
  try {
    const bytes = Uint8Array.from(body.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text && !/[\u0000-\u001f\u007f-\u009f]/.test(text)) return text;
  } catch {
    // not UTF-8
  }
  return shortHex(assetName);
}

/**
 * Characters that look like a Latin letter once lower-cased: Cyrillic,
 * Greek and IPA letters, digits, and the i, l and 1 of many fonts.
 */
const LOOKS_LIKE: Record<string, string> = {
  а: "a", в: "b", г: "r", е: "e", з: "3", к: "k", м: "m", н: "h", о: "o", п: "n", р: "p", с: "c", т: "t", у: "y",
  х: "x", ь: "b", ѕ: "s", і: "l", ј: "j", ԁ: "d", ԛ: "q", ԝ: "w", ү: "y", һ: "h", ӏ: "l",
  α: "a", β: "b", γ: "y", ε: "e", ζ: "z", η: "n", ι: "l", κ: "k", μ: "u", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u",
  χ: "x", ω: "w", ı: "l", ɑ: "a", ɡ: "g", ʏ: "y",
  0: "o", 1: "l", 5: "s", i: "l", "|": "l",
};

/**
 * Letters that draw a Latin letter as they're written, read before case is folded: a capital can draw another letter
 * than its small one does (Greek capital nu draws N, its small letter a v), and some scripts have no case at all.
 * Lower-cased first, Greek capital nu, mu, eta and upsilon folded to "v", "u", "n" and "u", and Cherokee's and Lisu's
 * letters not at all, so a token named "SNEK" or "ADA" in them read as its own name (chunk 51, e9b#1). After Unicode's
 * confusables (UTS #39), for the scripts that draw Latin letters: Greek and Coptic capitals, Cherokee, Lisu, Armenian,
 * and Latin's own small capitals. A capital that draws no Latin letter keeps its own small letter, unmapped: Greek gamma
 * and omega, and Cyrillic ghe and pe, aren't y, w, r or n as their small letters pass for. Written as code points,
 * since a Greek capital alpha and a Latin A can't be told apart on the page.
 */
const DRAWS: Record<string, string> = {
  // Greek capitals, and the lunate sigma and yot.
  "\u0391": "a", "\u0392": "b", "\u0395": "e", "\u0396": "z", "\u0397": "h", "\u0399": "l", "\u039A": "k",
  "\u039C": "m", "\u039D": "n", "\u039F": "o", "\u03A1": "p", "\u03A4": "t", "\u03A5": "y", "\u03A7": "x",
  "\u03F9": "c", "\u03F2": "c", "\u037F": "j", "\u03F3": "j", "\u0393": "\u03B3", "\u03A9": "\u03C9",
  // Cyrillic capitals that draw no Latin letter, though their small letters do.
  "\u0413": "\u0433", "\u041F": "\u043F",
  // Cherokee (its small letters are added below).
  "\u13A0": "d", "\u13A1": "r", "\u13A2": "t", "\u13A5": "l", "\u13A9": "y", "\u13AA": "a", "\u13AB": "j",
  "\u13AC": "e", "\u13B3": "w", "\u13B7": "m", "\u13BB": "h", "\u13BD": "y", "\u13C0": "g", "\u13C2": "h",
  "\u13C3": "z", "\u13CF": "b", "\u13D2": "r", "\u13D4": "w", "\u13D5": "s", "\u13D9": "v", "\u13DA": "s",
  "\u13DE": "l", "\u13DF": "c", "\u13E2": "p", "\u13E6": "k", "\u13F4": "b",
  // Lisu, which has no case.
  "\uA4D0": "b", "\uA4D1": "p", "\uA4D3": "d", "\uA4D4": "t", "\uA4D6": "g", "\uA4D7": "k", "\uA4D9": "j",
  "\uA4DA": "c", "\uA4DC": "z", "\uA4DD": "f", "\uA4DF": "m", "\uA4E0": "n", "\uA4E1": "l", "\uA4E2": "s",
  "\uA4E3": "r", "\uA4E6": "v", "\uA4E7": "h", "\uA4EA": "w", "\uA4EB": "x", "\uA4EC": "y", "\uA4EE": "a",
  "\uA4F0": "e", "\uA4F2": "l", "\uA4F3": "o", "\uA4F4": "u",
  // Coptic capitals (their small letters are added below).
  "\u2C80": "a", "\u2C82": "b", "\u2C8C": "z", "\u2C8E": "h", "\u2C92": "l", "\u2C94": "k", "\u2C98": "m",
  "\u2C9A": "n", "\u2C9E": "o", "\u2CA2": "p", "\u2CA4": "c", "\u2CA6": "t", "\u2CA8": "y", "\u2CAC": "x",
  // Armenian.
  "\u0555": "o", "\u0585": "o", "\u054D": "u", "\u057D": "u", "\u053C": "l", "\u0578": "n", "\u0570": "h",
  "\u0581": "g", "\u0566": "q",
  // Latin's small capitals.
  "\u1D00": "a", "\u0299": "b", "\u1D04": "c", "\u1D05": "d", "\u1D07": "e", "\uA730": "f", "\u0262": "g",
  "\u029C": "h", "\u026A": "l", "\u1D0A": "j", "\u1D0B": "k", "\u029F": "l", "\u1D0D": "m", "\u0274": "n",
  "\u1D0F": "o", "\u1D18": "p", "\u0280": "r", "\uA731": "s", "\u1D1B": "t", "\u1D1C": "u", "\u1D20": "v",
  "\u1D21": "w", "\u1D22": "z",
};
// A Cherokee or Coptic small letter draws what its capital does.
for (const [c, latin] of Object.entries(DRAWS)) {
  const code = c.codePointAt(0)!;
  if ((code >= 0x13a0 && code <= 0x13f5) || (code >= 0x2c80 && code <= 0x2cb1)) DRAWS[c.toLowerCase()] ??= latin;
}

/** A character that draws nothing but takes room: any white space, wide or not, and the braille blank. */
export const BLANK = /[\s\p{Zs}\u2800]/u;
const BLANK_RUN = new RegExp(`${BLANK.source}{2,}`, "gu");

/**
 * `text` with each run of blanks as one space. Nine em spaces between "SNEK" and an "x" are a name the lists cut to
 * "SNEK …", and so a list's row read as the listed SNEK (chunk 51, gap-g10#1). One blank is left as it is.
 */
export function oneSpaced(text: string): string {
  return text.replace(BLANK_RUN, " ");
}

/**
 * A name reduced to how it looks, to tell apart names that only look the
 * same: compatibility forms folded (NFKD: full-width, bold, ligatures),
 * accents and invisible characters dropped, case folded, lookalike letters
 * mapped to one Latin letter, and only letters, digits and "₳" kept. "S N E K",
 * "Ｓnek", "ЅNЕK" and "5NEK" are all "snek"-alike; "8Ball" and "8 BALL" match.
 */
export function nameSkeleton(name: string): string {
  return foldName(name).replace(/[^\p{L}\p{N}₳]/gu, "");
}

/**
 * A name folded as `nameSkeleton` folds it, but with its spaces and
 * punctuation still in, so its words can be told apart: "ADA bonus" is
 * "ada bonus", and "OOO SNEK" is "ooo snek", as "000 SNEK" is.
 */
export function foldName(name: string): string {
  // Each character as it's written first (`DRAWS`), then case folded and mapped as a small letter (`LOOKS_LIKE`).
  return [...name.normalize("NFKD").replace(/[\p{M}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, "")]
    .map((c) => DRAWS[c] ?? [...c.toLowerCase()].map((l) => LOOKS_LIKE[l] ?? l).join(""))
    .join("");
}

/**
 * A name as a list shows it: without the invisible characters that could hide or reorder its letters, and with its
 * blanks one space each (`oneSpaced`), so wide ones can't push its last letters out of the list's row.
 */
export function plainName(name: string): string {
  return oneSpaced(name.replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, "")).trim();
}

/** `5eed0e1f…9ff2` */
export function shortHex(hex: string, head = 8, tail = 4): string {
  return hex.length <= head + tail + 1 ? hex : `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

/** A bech32 address, as a pasted or a listed one is written: its prefix, the "1", and its data. */
const BECH32_ADDRESS = /^[a-z_]+1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{20,}$/;

/**
 * An address or a Seedelf's name shortened to parts that are costly to match. An address keeps ten characters of its
 * data after its prefix, which are its header and its payment part, each one past those taking some 32 keys to match,
 * and its last six. A Seedelf's name keeps its prefix, its last sixteen and its output index (`seedelfShort`): the
 * sixteen are eight bytes of the transaction its mint spent, which a Seedelf minted from another output of that
 * transaction shares, and the index tells those two apart (the 1.10.0 gate: a live run made such a pair, which read
 * alike). The last six of an address are its checksum, which anyone can solve for, and the start of a name is a prefix
 * and a tag anyone can copy: Activity cut an address to as few as three first characters and those six, and the lists
 * cut a name to its prefix, its tag and three bytes anyone can grind (chunk 51, gap-g10#2). Anything else as `shortHex`.
 */
export function shortCounterparty(text: string): string {
  if (BECH32_ADDRESS.test(text)) return shortHex(text, text.lastIndexOf("1") + 11, 6);
  if (/^5eed0e1f[0-9a-f]{40,}$/i.test(text)) return seedelfShort(text);
  return shortHex(text, 12, 6);
}

/** "just now", "12 s ago", "3 min ago", "2 h ago". */
export function timeAgo(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 5) return t("format.justNow");
  if (s < 60) return t("format.secondsAgo", { n: s });
  if (s < 3600) return t("format.minutesAgo", { n: Math.floor(s / 60) });
  return t("format.hoursAgo", { n: Math.floor(s / 3600) });
}

/** When something happened, in a list: "Today, 14:02", "Yesterday, 09:12", "23 Mar, 18:40", and the year if it isn't this one. */
export function whenOf(at: number, now: Date): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return t("format.today", { time });
  if (days === 1) return t("format.yesterday", { time });
  const year = d.getFullYear() === now.getFullYear() ? {} : ({ year: "numeric" } as const);
  return t("format.dateAndTime", { date: d.toLocaleDateString(dateLocale(), { day: "numeric", month: "short", ...year }), time });
}

/**
 * When epoch `epoch` ends on `network`, as the next starts: "9 Oct 2026, 21:44". The time too, since voting closes
 * then, part-way through the day: mainnet's epochs end at 21:44:51 UTC (release review C43). Its seconds are
 * dropped, so it's never late.
 * Counted from Shelley's start (networks.ts), so no request. In the language's own way (`dateLocale`).
 */
export function epochEnds(network: NetworkName, epoch: number): string {
  return momentText(epochStart(network, epoch + 1));
}

/**
 * When `slot` comes on `network`, "6 Nov 2026, 14:02", for a transaction's validity interval: a site's, on its sign
 * window. Counted from Shelley's start (networks.ts), so no request. `up` rounds the minute up, for an end: a
 * transaction lands until its end's slot starts, so an end shown so is never early (1.7.1's release review).
 * Undefined past the last moment a Date holds, in the year 275760, which a slot of a u64 can name.
 */
export function slotText(network: NetworkName, slot: number, up = false): string | undefined {
  const at = slotStart(network, slot);
  const ms = up ? Math.ceil(at / 60_000) * 60_000 : at;
  return Math.abs(ms) <= 8.64e15 ? momentText(ms) : undefined;
}

/** A moment, "9 Oct 2026, 21:44", its seconds dropped. */
function momentText(ms: number): string {
  const time = new Date(ms).toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" });
  return t("format.dateAndTime", { date: dayText(ms), time });
}

/**
 * A day as the wallet writes one, "23 Sept 2026", in the language's own way (`dateLocale`), the month in words. The
 * browser's own short date was "10/5/2026" on the connected sites, which reads as either month (the pass-two visual
 * review).
 */
export function dayText(ms: number): string {
  return new Date(ms).toLocaleDateString(dateLocale(), { day: "numeric", month: "short", year: "numeric" });
}

/** A typed ADA amount as a lovelace string, or undefined if it isn't one ("1,234.5" and "1234.5" both work). */
export function parseAda(text: string): string | undefined {
  return parseQuantity(text, 6);
}

/**
 * A typed amount of something with `decimals` places as its raw integer
 * string, or undefined if it isn't one: "1,234.5" with 6 decimals is
 * "1234500000". More decimal places than it has isn't an amount.
 *
 * A comma groups thousands only where it belongs ("1,234"). With no point,
 * a single comma with fewer than three digits after it is a decimal comma:
 * "12,5" is 12.5, never 125. Anything else with a comma isn't an amount.
 */
export function parseQuantity(text: string, decimals: number): string | undefined {
  let clean = text.trim();
  if (DECIMAL_COMMA.test(clean)) clean = clean.replace(",", ".");
  const match = /^(\d+|[1-9]\d{0,2}(?:,\d{3})+)(?:\.(\d*))?$/.exec(clean);
  if (!match || (match[2] ?? "").length > decimals) return undefined;
  const scale = 10n ** BigInt(decimals);
  return (BigInt(match[1]!.replaceAll(",", "")) * scale + BigInt((match[2] ?? "").padEnd(decimals, "0") || "0")).toString();
}

/** A number written with a decimal comma: digits, one comma, and at most two digits after it ("12,5", "0,25", "12,"). */
const DECIMAL_COMMA = /^\d+,\d{0,2}$/;

/** Whole units grouped by commas only where they belong, or not at all: "1,234", "1234", never "1,23" or "0,500". */
const WELL_GROUPED = /^(\d+|[1-9]\d{0,2}(,\d{3})+)$/;

/**
 * What an amount field says when a comma typed or pasted can't be a thousands
 * separator. A function, not a constant: a module-level `t()` would be read
 * when this file is first imported — before `main.tsx` has had a chance to put
 * the wallet in the user's language — and would stay English for the session.
 */
export const commaNote = () => t("format.commaNote");
/** Spanish writes 1,125 for 1.125, so there a paste like it reads both ways: both readings, for the user to pick. */
export const ambiguousCommaNote = (typed: string) =>
  t("format.warn.ambiguousComma", { typed, thousands: typed.replace(",", ""), decimal: typed.replace(",", ".") });

/**
 * What an edit put into `previous` to make `typed`: where, and the text
 * typed or pasted ("" for a deletion). What the two share at each end was
 * already there.
 */
function editOf(previous: string, typed: string): { start: number; text: string } {
  const shortest = Math.min(previous.length, typed.length);
  let start = 0;
  while (start < shortest && previous[start] === typed[start]) start++;
  let end = 0;
  while (end < shortest - start && previous[previous.length - 1 - end] === typed[typed.length - 1 - end]) end++;
  return { start, text: typed.slice(start, typed.length - end) };
}

/** A block explorer link for a transaction. Shown through ExplorerLink, which warns on the private side. */
export function explorerUrl(network: "preprod" | "mainnet", txHash: string): string {
  return `https://${network === "preprod" ? "preprod." : ""}cardanoscan.io/transaction/${txHash}`;
}

/** A block explorer link for an address: everything it did. */
export function explorerAddressUrl(network: "preprod" | "mainnet", address: string): string {
  return `https://${network === "preprod" ? "preprod." : ""}cardanoscan.io/address/${address}`;
}

/** All the ADA there will ever be: 45 billion ₳, in lovelace. */
export const MAX_SUPPLY_LOVELACE = 45_000_000_000_000_000n;

/** What an amount field accepts, and what it says when it changes or refuses something. */
export interface AmountRules {
  decimals: number;
  /** The most it may be, as a raw integer. */
  max: bigint;
  /** For anything that isn't a number. */
  notANumber: string;
  /** When decimal places past `decimals` are dropped. */
  tooPrecise: string;
  /** When it's more than `max`. */
  tooMuch: string;
}

/**
 * Cleans what the user typed or pasted into an amount field.
 *
 * - The thousands are grouped with commas again as digits come and go: the
 *   field's own commas move ("3,000,000,00" after a Backspace is
 *   "300,000,000").
 * - A comma the user types or pastes is read for what it can only mean. With
 *   no point, one comma with fewer than three digits after it is the decimal
 *   point: "12,5" is 12.5, and "0,5" is 0.5, never 125 or 5. Otherwise it must
 *   group thousands where it belongs ("12,500"), or the edit is refused
 *   (`commaNote`): a comma never just disappears.
 * - Decimal places past `decimals` are dropped, not rounded: the amount never
 *   grows.
 * - Anything that isn't a number (a letter, a "-", two points) stays as
 *   typed, with the note, and isn't an amount: `parseQuantity` reads nothing
 *   from it, so the form's Review waits until it's put right. It used to keep
 *   the previous value, which left Review on with a number the user had typed
 *   over (chunk 23's second review, PY-9). Text like that has no commas of
 *   the field's own, so the next edit reads all of it as typed.
 * - More than `max` keeps the previous value.
 *
 * `note` says what was changed or refused.
 */
export function sanitizeAmount(previous: string, typed: string, rules: AmountRules): { value: string; note?: string } {
  let text = typed.trim();
  if (text === "") return { value: "" };
  const edit = previous === "" || parseQuantity(previous, rules.decimals) !== undefined ? editOf(previous, text) : { start: 0, text };
  const commaTyped = edit.text.includes(",");
  let decimalComma = false;
  if (commaTyped && !text.includes(".")) {
    const comma = text.lastIndexOf(",");
    // The one comma typed, with at most two digits after it: the field's other commas are its own.
    const only = edit.text.indexOf(",") === edit.text.lastIndexOf(",");
    const inEdit = comma >= edit.start && comma < edit.start + edit.text.length;
    if (only && inEdit && /^\d{0,2}$/.test(text.slice(comma + 1))) {
      text = `${text.slice(0, comma)}.${text.slice(comma + 1)}`;
      decimalComma = true;
    }
  }
  if (text.startsWith(".")) text = `0${text}`;
  const match = /^([\d,]*)(?:\.(\d*))?$/.exec(text);
  if (!match || !/\d/.test(match[1]!)) {
    // Digits and commas a comma typed can't make sense of keep the number before it, as below.
    if (commaTyped && /^[\d,.]*$/.test(text)) return { value: previous, note: commaNote() };
    return { value: typed.trim(), note: rules.notANumber };
  }
  // In Spanish a comma is the decimal mark, so a paste of d,ddd could be either: change nothing and say both.
  if (commaTyped && !decimalComma && rules.decimals > 0 && currentLanguage() === "es" && /^\d{1,3},\d{3}$/.test(text))
    return { value: previous, note: ambiguousCommaNote(text) };
  if (commaTyped && !decimalComma && !WELL_GROUPED.test(match[1]!)) return { value: previous, note: commaNote() };
  let fraction = match[2];
  let note: string | undefined;
  if (fraction !== undefined && fraction.length > rules.decimals) {
    fraction = fraction.slice(0, rules.decimals);
    note = rules.tooPrecise;
  }
  // Whole units only: no point either.
  if (rules.decimals === 0) fraction = undefined;
  const whole = BigInt(match[1]!.replaceAll(",", "")).toLocaleString("en-US");
  const value = fraction === undefined ? whole : `${whole}.${fraction}`;
  if (BigInt(parseQuantity(value, rules.decimals) ?? "0") > rules.max) return { value: previous, note: rules.tooMuch };
  return note ? { value, note } : { value };
}

/** ADA's rules: 6 decimal places (0.000001 ₳ is one lovelace), and no more than all the ADA there is. */
export const ADA_RULES: AmountRules = {
  decimals: 6,
  max: MAX_SUPPLY_LOVELACE,
  get notANumber() {
    return t("format.ada.notANumber");
  },
  get tooPrecise() {
    return t("format.ada.tooPrecise");
  },
  get tooMuch() {
    return t("format.ada.tooMuch");
  },
};

/** `sanitizeAmount` with ADA's rules. */
export function sanitizeAda(previous: string, typed: string): { value: string; note?: string } {
  return sanitizeAmount(previous, typed, ADA_RULES);
}

/** An amount's digits and point, without the commas. */
const significant = (text: string) => text.replace(/[^\d.]/g, "");

/**
 * Where the caret goes when `typed` (the caret at `caret`) is cleaned into
 * `value`: after the same digits, however the commas moved.
 */
export function caretAfter(typed: string, caret: number, value: string): number {
  // A decimal comma that became the point counts as the point.
  const read = !typed.includes(".") && value.includes(".") ? typed.replace(/,(?=\d{0,2}\s*$)/, ".") : typed;
  const before = significant(read.slice(0, caret)).length;
  if (before === 0) return 0;
  let seen = 0;
  for (let i = 0; i < value.length; i++) {
    if (/[\d.]/.test(value[i]!) && ++seen === before) return i + 1;
  }
  return value.length;
}

/**
 * When an edit only took a comma out of `previous` (Backspace or Delete on
 * one), the digit beside it goes instead: the text and caret to clean.
 */
export function deleteBesideComma(
  previous: string,
  typed: string,
  caret: number,
  kind: string | undefined,
): { text: string; caret: number } {
  if (typed.length >= previous.length || significant(typed) !== significant(previous)) return { text: typed, caret };
  if (kind === "deleteContentBackward" && caret > 0) {
    return { text: typed.slice(0, caret - 1) + typed.slice(caret), caret: caret - 1 };
  }
  if (kind === "deleteContentForward") return { text: typed.slice(0, caret) + typed.slice(caret + 1), caret };
  return { text: typed, caret };
}

// `plural()` lived here until chunk 19. It took the noun as an English string
// ("1 UTxO", "3 UTxOs"), so every call was display text no locale file could
// reach — and because its arguments are bare lowercase words, the scan that
// found the rest of the strings walked straight past them. Use a plural key
// instead: `t("amount.utxos", { count: n })`, or, where the number is formatted,
// a key with `{{n}}` shown and `count` only choosing the form (PlutusTree's
// `count()` does that). Its absence is what stops the pattern coming back.

/** An ADA amount, and how many tokens come with it: "22.7 ₳ and 1 token". */
export function adaWithTokens(lovelace: string, tokens: number): string {
  return tokens ? t("format.adaAndTokens", { ada: formatAda(lovelace), count: tokens }) : adaText(lovelace);
}

/**
 * "22.7 ₳", with a no-break space: a review's row, or a line beside a long
 * label, put the ₳ on a line of its own (chunk 23's second review, V-7).
 */
export const adaText = (lovelace: string) => `${formatAda(lovelace)} ₳`;

/** A token's key in maps and React lists: `policy.name`. */
export const tokenKey = (t: { policyId: string; assetName: string }) => `${t.policyId}.${t.assetName}`;

/** One side of the balances less what's locked on it: what a payment can use. */
export function unlocked<S extends { lovelace: string; tokens: TokenAmount[]; utxos: number; locked: Locked }>(side: S): S {
  if (!side.locked.utxos) return side;
  const locked = new Map(side.locked.tokens.map((t) => [tokenKey(t), BigInt(t.quantity)]));
  const tokens = side.tokens
    .map((t) => ({ ...t, quantity: (BigInt(t.quantity) - (locked.get(tokenKey(t)) ?? 0n)).toString() }))
    .filter((t) => BigInt(t.quantity) > 0n);
  const lovelace = (BigInt(side.lovelace) - BigInt(side.locked.lovelace)).toString();
  return { ...side, lovelace, tokens, utxos: side.utxos - side.locked.utxos };
}

/**
 * " · 5 ₳ locked" when some of a balance side is locked, for a form's line under its title. `ada` writes the
 * amount: a form passes `useAmounts().ada`, so hidden balances stay hidden there too (chunk 23's second review, HM-9).
 */
export function lockedAside(side: { locked: Locked }, ada: (lovelace: string) => string = formatAda): string {
  return side.locked.utxos ? t("home.lockedMeta", { amount: ada(side.locked.lovelace) }) : "";
}

/** A percentage to at most two places: "18.79%", "2%". */
export function formatPercent(value: number): string {
  return `${Number(value.toFixed(2)).toLocaleString("en-US")}%`;
}

/**
 * The staking rewards a payment from the account spends along with it: all of
 * them, when the user spends rewards and the vote is delegated (Conway pays
 * out nothing otherwise).
 */
export function spentRewards(staking: StakeInfo, spendRewards: boolean): bigint {
  return spendRewards && staking.registered && staking.drep ? BigInt(staking.rewards) : 0n;
}

/** Rewards that can't be withdrawn until the vote is delegated. */
export const rewardsLocked = (s: StakeInfo) => s.registered && BigInt(s.rewards) > 0n && !s.drep;

/** The account's side with `rewards` added to what it can pay: they ride along with any payment. */
export function withRewards<S extends { lovelace: string }>(side: S, rewards: bigint): S {
  return rewards > 0n ? { ...side, lovelace: (BigInt(side.lovelace) + rewards).toString() } : side;
}

/** ", with 57.47 ₳ of rewards" after what a form can pay, when rewards ride along; `ada` as for `lockedAside`. */
export function rewardsAside(rewards?: string, ada: (lovelace: string) => string = formatAda): string {
  return rewards ? t("format.withRewards", { amount: ada(rewards) }) : "";
}

/**
 * An ID shortened so its hash shows, not only its prefix: "pool1" and
 * CIP-129's "drep1y2" say nothing about whose it is, and a lookalike can be
 * ground to match a few characters after them (launch review #59).
 */
export const shortId = (id: string) => shortHex(id, 16, 6);

/** A pool by its ticker, else its name, else its shortened ID. */
export function poolLabel(pool: PoolRef): string {
  return pool.ticker ?? pool.name ?? shortId(pool.id);
}

/**
 * Where the vote goes, in words: a pinned choice, the account's own DRep (`own`), a DRep by its `name` or its
 * shortened ID, or nowhere. A DRep's name never stands alone ("DRep · 8Ball"): a DRep picks its own, and one called
 * "Always abstain" read as that choice on the vote's review, in Activity, its CSV and Delegations. For the same
 * reason the account's own DRep is a flag, never a name passed in (chunk 51, gap-g7#1).
 */
export function voteLabel(drep: string | null, { name, own = false }: { name?: string; own?: boolean } = {}): string {
  if (!drep) return t("format.vote.notDelegated");
  if (drep === ALWAYS_ABSTAIN) return t("format.vote.abstain");
  if (drep === ALWAYS_NO_CONFIDENCE) return t("format.vote.noConfidence");
  if (own) return t("drep.yourOwn");
  return name ? t("format.vote.drep", { name }) : shortId(drep);
}

/** A governance action's kind in words, as Transaction details and a site's sign window say what a proposal proposes. */
export function proposalWords(action: string): string {
  const words: Record<string, I18nKey> = {
    parameterChange: "tx.proposal.parameterChange",
    hardFork: "tx.proposal.hardFork",
    treasuryWithdrawals: "tx.proposal.treasuryWithdrawals",
    noConfidence: "tx.proposal.noConfidence",
    updateCommittee: "tx.proposal.updateCommittee",
    newConstitution: "tx.proposal.newConstitution",
    information: "tx.proposal.information",
  };
  const key = words[action];
  return key ? t(key) : action;
}

/**
 * How many of `items` share each name, as it looks (`nameSkeleton`): two
 * DReps both called "8Ball", or pools with the same ticker. Anyone can
 * choose any name, so a shared one is flagged and the ID shown.
 */
export function sharedNames<T>(items: T[], name: (item: T) => string | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const n = name(item);
    const key = n === undefined ? "" : nameSkeleton(n);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** How many share `name` in `counts` (sharedNames): 1 or 0 when it's its own. */
export const sharing = (counts: Map<string, number>, name: string | undefined) =>
  (name === undefined ? 0 : counts.get(nameSkeleton(name))) ?? 0;

/** An ADA amount's value at `price`, in its currency: "$12.34", "€0.22", "¥397". */
export function formatFiat(lovelace: string, price: AdaPrice): string {
  const value = (Number(BigInt(lovelace)) / 1_000_000) * price.rate;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: price.currency.toUpperCase() }).format(value);
}
