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

export function addressAssetsToTokens(assets: AddressAsset[]): Tokens {
  const byKey = new Map<string, Token>();

  for (const a of assets) {
    const policyHex = normalizeHex(a.policy_id);
    if (policyHex.length !== 56) {
      // If it's not 28 bytes, keep it but you may want to throw/validate upstream.
      // throw new Error(`policy_id must be 56 hex chars (28 bytes). Got: ${policyHex.length}`);
    }

    const nameBytes = parseAssetName(a.asset_name);
    const amount = safeBig(a.quantity);

    const key = `${policyHex}:${bytesToHex(nameBytes)}`;
    const prev = byKey.get(key);
    if (prev) {
      byKey.set(key, {
        policy_id: policyHex,
        token_name: nameBytes,
        amount: prev.amount + amount,
      });
    } else {
      byKey.set(key, {
        policy_id: policyHex,
        token_name: nameBytes,
        amount,
      });
    }
  }

  return { items: Array.from(byKey.values()) };
}

// ---- Helpers ----

function safeBig(x?: string | number | bigint): bigint {
  try {
    if (typeof x === "bigint") return x;
    if (typeof x === "number") return BigInt(Math.trunc(x));
    return BigInt(x ?? "0");
  } catch {
    return 0n;
  }
}

/** Lowercase and validate hex (no 0x prefix). */
function normalizeHex(h: string): string {
  const s = (h || "").trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]*$/.test(s)) return ""; // or throw
  return s;
}

/** Heuristic: treat as hex if only hex chars and even length; otherwise UTF-8. */
function parseAssetName(asset_name: string): Uint8Array {
  const s = (asset_name ?? "").trim();
  const hexLike = /^[0-9a-fA-F]*$/.test(s) && s.length % 2 === 0;
  return hexLike ? hexToBytes(s) : utf8ToBytes(s);
}

function hexToBytes(hex: string): Uint8Array {
  const s = normalizeHex(hex);
  if (s.length % 2 !== 0) throw new Error("hexToBytes: invalid hex length");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) {
    out[i / 2] = parseInt(s.slice(i, i + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i].toString(16).padStart(2, "0");
    out += b;
  }
  return out;
}

function utf8ToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}
