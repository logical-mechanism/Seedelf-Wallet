// Display formatting for amounts and token names. Amounts arrive as integer
// strings and are handled as bigint, so nothing is rounded on the way.

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

/**
 * Cleans what the user typed or pasted into an ADA amount field. ADA has 6
 * decimal places (1 lovelace = 0.000001 ₳), so extra digits are dropped, not
 * rounded: the amount never grows. Anything that isn't a number, or is more
 * than all the ADA in existence, keeps the previous value. `note` says what
 * was changed or refused.
 */
export function sanitizeAda(previous: string, typed: string): { value: string; note?: string } {
  let text = typed.trim();
  if (text === "") return { value: "" };
  if (text.startsWith(".")) text = `0${text}`;
  const match = /^([\d,]*)(?:\.(\d*))?$/.exec(text);
  if (!match || !/\d/.test(match[1]!)) {
    return { value: previous, note: "Enter an amount in ADA, like 25 or 12.5." };
  }
  const decimals = match[2];
  let value = text;
  let note: string | undefined;
  if (decimals !== undefined && decimals.length > 6) {
    value = `${match[1]}.${decimals.slice(0, 6)}`;
    note = "ADA has at most 6 decimal places (0.000001 ₳ is one lovelace), so the extra digits were dropped.";
  }
  if (BigInt(parseAda(value) ?? "0") > MAX_SUPPLY_LOVELACE) {
    return { value: previous, note: "That's more than all the ADA there is: 45 billion ₳." };
  }
  return note ? { value, note } : { value };
}
