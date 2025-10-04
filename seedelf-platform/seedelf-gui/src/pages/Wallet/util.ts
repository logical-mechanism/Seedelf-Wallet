/// store util functions here
import { Tokens, Token, AddressAsset } from "@/types/wallet";

export const display_ascii = (text: string) => {
  let hex = text.slice(8, 38);
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(byte)) return null;
    bytes.push(byte);
  }
  const printable = (b: number) => b >= 32 && b <= 126;

  const chars = bytes
    .filter(printable)
    .map((b) => String.fromCharCode(b))
    .join("");

  return chars;
};

// Matches your types: Token.token_name = Uint8Array, Token.amount = number.
// Merges by (policy_id, token_name) and clamps to Number.MAX_SAFE_INTEGER.
export function addressAssetsToTokens(assets: AddressAsset[]): Tokens {
  const byKey = new Map<string, Token>();

  for (const a of assets) {
    const policyHex = normalizeHex(a.policy_id);
    const nameBytes = parseAssetNameToBytes(a.asset_name); // Uint8Array (per your type)
    const nameKey = bytesToHex(nameBytes); // stable key for Map
    const amt = toSafeNumber(a.quantity); // string → number (clamped)

    const key = `${policyHex}:${nameKey}`;
    const prev = byKey.get(key);
    if (prev) {
      byKey.set(key, {
        policy_id: policyHex,
        token_name: prev.token_name, // keep bytes
        amount: safeAdd(prev.amount, amt),
      });
    } else {
      byKey.set(key, {
        policy_id: policyHex,
        token_name: nameBytes,
        amount: amt,
      });
    }
  }

  return { items: Array.from(byKey.values()) };
}

/* ----------------- helpers ----------------- */

const MAX_SAFE = Number.MAX_SAFE_INTEGER; // 2^53 - 1

function toSafeNumber(x: string | number | bigint): number {
  let b: bigint;
  try {
    if (typeof x === "number") {
      if (!Number.isFinite(x)) return 0;
      b = BigInt(Math.trunc(x));
    } else if (typeof x === "bigint") {
      b = x;
    } else {
      b = BigInt(x || "0");
    }
  } catch {
    b = 0n;
  }
  const max = BigInt(MAX_SAFE);
  if (b > max) {
    console.warn(
      "[tokens] quantity exceeds JS safe integer; clamping to MAX_SAFE",
      {
        value: b.toString(),
      },
    );
    return MAX_SAFE;
  }
  if (b < 0n) return 0;
  return Number(b);
}

function safeAdd(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isFinite(sum) || sum > MAX_SAFE) return MAX_SAFE;
  if (sum < 0) return 0;
  return Math.trunc(sum);
}

function normalizeHex(h: string): string {
  const s = (h || "").trim().toLowerCase().replace(/^0x/, "");
  return /^[0-9a-f]*$/.test(s) ? s : "";
}

/** Hex if even-length hex; else treat as UTF-8 and encode to bytes. */
function parseAssetNameToBytes(asset_name: string): Uint8Array {
  const s = (asset_name ?? "").trim();
  const hexLike = /^[0-9a-fA-F]*$/.test(s) && s.length % 2 === 0;
  return hexLike ? hexToBytes(s) : utf8ToBytes(s);
}

function hexToBytes(hex: string): Uint8Array {
  const s = normalizeHex(hex);
  if (s.length % 2 !== 0) throw new Error("hexToBytes: invalid hex length");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2)
    out[i / 2] = parseInt(s.slice(i, i + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++)
    out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function utf8ToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}
