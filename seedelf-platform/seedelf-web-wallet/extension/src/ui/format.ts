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
