// Display formatting for amounts and token names. Amounts arrive as integer
// strings and are handled as bigint, so nothing is rounded on the way.

import type { Locked, TokenAmount } from "../shared/rpc";

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
  if (!assetName) return "(no name)";
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

/** `5eed0e1f…9ff2` */
export function shortHex(hex: string, head = 8, tail = 4): string {
  return hex.length <= head + tail + 1 ? hex : `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

/** "just now", "12 s ago", "3 min ago", "2 h ago". */
export function timeAgo(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

/** A typed ADA amount as a lovelace string, or undefined if it isn't one ("1,234.5" and "1234.5" both work). */
export function parseAda(text: string): string | undefined {
  return parseQuantity(text, 6);
}

/**
 * A typed amount of something with `decimals` places as its raw integer
 * string, or undefined if it isn't one: "1,234.5" with 6 decimals is
 * "1234500000". More decimal places than it has isn't an amount.
 */
export function parseQuantity(text: string, decimals: number): string | undefined {
  const clean = text.trim().replaceAll(",", "");
  const match = /^(\d+)(?:\.(\d*))?$/.exec(clean);
  if (!match || (match[2] ?? "").length > decimals) return undefined;
  const scale = 10n ** BigInt(decimals);
  return (BigInt(match[1]!) * scale + BigInt((match[2] ?? "").padEnd(decimals, "0") || "0")).toString();
}

/** A block explorer link for a transaction. */
export function explorerUrl(network: "preprod" | "mainnet", txHash: string): string {
  return `https://${network === "preprod" ? "preprod." : ""}cardanoscan.io/transaction/${txHash}`;
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
 * - The thousands are grouped with commas again, wherever they were typed or
 *   deleted: "3,000,00" is "300,000".
 * - Decimal places past `decimals` are dropped, not rounded: the amount never
 *   grows.
 * - Anything that isn't a number, or is more than `max`, keeps the previous
 *   value.
 *
 * `note` says what was changed or refused.
 */
export function sanitizeAmount(previous: string, typed: string, rules: AmountRules): { value: string; note?: string } {
  let text = typed.trim();
  if (text === "") return { value: "" };
  if (text.startsWith(".")) text = `0${text}`;
  const match = /^([\d,]*)(?:\.(\d*))?$/.exec(text);
  if (!match || !/\d/.test(match[1]!)) return { value: previous, note: rules.notANumber };
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
  notANumber: "Enter an amount in ADA, like 25 or 12.5.",
  tooPrecise: "ADA has at most 6 decimal places (0.000001 ₳ is one lovelace), so the extra digits were dropped.",
  tooMuch: "That's more than all the ADA there is: 45 billion ₳.",
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
  const before = significant(typed.slice(0, caret)).length;
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

/** "1 UTxO", "3 UTxOs"; `many` for irregular plurals. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** An ADA amount, and how many tokens come with it: "22.7 ₳ and 1 token". */
export function adaWithTokens(lovelace: string, tokens: number): string {
  return tokens ? `${formatAda(lovelace)} ₳ and ${plural(tokens, "token")}` : `${formatAda(lovelace)} ₳`;
}

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

/** " · 5 ₳ locked" when some of a balance side is locked, for a form's line under its title. */
export function lockedAside(side: { locked: Locked }): string {
  return side.locked.utxos ? ` · ${formatAda(side.locked.lovelace)} ₳ locked` : "";
}
