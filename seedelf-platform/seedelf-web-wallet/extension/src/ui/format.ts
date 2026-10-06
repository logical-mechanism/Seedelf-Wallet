// Display formatting for amounts and token names. Amounts arrive as integer
// strings and are handled as bigint, so nothing is rounded on the way.

import { t } from "../i18n";
import { epochStart, type NetworkName } from "../networks";
import {
  ALWAYS_ABSTAIN,
  ALWAYS_NO_CONFIDENCE,
  type AdaPrice,
  type Locked,
  type PoolRef,
  type StakeInfo,
  type TokenAmount,
} from "../shared/rpc";

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
  return [...name.normalize("NFKD").replace(/[\p{M}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, "").toLowerCase()]
    .map((c) => LOOKS_LIKE[c] ?? c)
    .join("");
}

/** A name as a list shows it: without the invisible characters that could hide or reorder its letters. */
export function plainName(name: string): string {
  return name.replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, "").trim();
}

/** `5eed0e1f…9ff2` */
export function shortHex(hex: string, head = 8, tail = 4): string {
  return hex.length <= head + tail + 1 ? hex : `${hex.slice(0, head)}…${hex.slice(-tail)}`;
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
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return t("format.today", { time });
  if (days === 1) return t("format.yesterday", { time });
  const year = d.getFullYear() === now.getFullYear() ? {} : ({ year: "numeric" } as const);
  return t("format.dateAndTime", { date: d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...year }), time });
}

/**
 * The day epoch `epoch` ends on `network`, when the next starts: "9 Oct 2026".
 * Counted from Shelley's start (networks.ts), so no request. Pinned to en-GB
 * as every date in the wallet is, for now (a known gap, chunk 19's plan).
 */
export function epochEnds(network: NetworkName, epoch: number): string {
  return dayText(epochStart(network, epoch + 1));
}

/**
 * A day as the wallet writes one, "23 Sept 2026": pinned to en-GB with the rest. The browser's own short date was
 * "10/5/2026" on the connected sites, which reads as either month (the pass-two visual review).
 */
export function dayText(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
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

/** Where the vote goes, in words: a pinned choice, the DRep's name or shortened ID, or nowhere. */
export function voteLabel(drep: string | null, name?: string): string {
  if (!drep) return t("format.vote.notDelegated");
  if (drep === ALWAYS_ABSTAIN) return t("format.vote.abstain");
  if (drep === ALWAYS_NO_CONFIDENCE) return t("format.vote.noConfidence");
  return name ?? shortId(drep);
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
