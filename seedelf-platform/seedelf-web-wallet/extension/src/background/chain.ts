// Pure helpers over Koios UTxOs: reading registers from datums, discovering
// the Cardano account's addresses, and adding up value. No network, no keys.

import type { TokenAmount } from "../shared/rpc";
import type { KoiosUtxo } from "./koios";

/** The standard BIP44 gap limit: stop after this many unused addresses in a row. */
export const GAP_LIMIT = 20;

/** The seedelf token-name prefix (lib/token_name.ak). */
export const SEEDELF_PREFIX = "5eed0e1f";

const POINT_HEX = /^[0-9a-f]{96}$/;

export interface RegisterHex {
  generator: string;
  publicValue: string;
}

/**
 * The register in a wallet-contract UTxO's inline datum: constructor 0 with
 * two 48-byte fields, the same shape the CLI reads. Anything else (no datum,
 * another shape) isn't a spendable register, so it's skipped. Whether the
 * points are valid is left to the WebAssembly ownership check.
 */
export function registerOf(utxo: KoiosUtxo): RegisterHex | undefined {
  const value = utxo.inline_datum?.value as { constructor?: unknown; fields?: unknown } | undefined;
  if (!value || value.constructor !== 0 || !Array.isArray(value.fields) || value.fields.length !== 2) {
    return undefined;
  }
  const [g, u] = value.fields.map((f: { bytes?: unknown }) => f?.bytes);
  if (typeof g !== "string" || typeof u !== "string" || !POINT_HEX.test(g) || !POINT_HEX.test(u)) {
    return undefined;
  }
  return { generator: g, publicValue: u };
}

/**
 * Walks one address chain (receive or change) from index 0 until `gap`
 * addresses in a row are unused. Returns every address it looked at, so a
 * UTxO at any of them is recognized, and how many are used.
 */
export function discoverChain(
  used: ReadonlySet<string>,
  derive: (index: number) => string,
  gap = GAP_LIMIT,
): { addresses: string[]; used: number } {
  const addresses: string[] = [];
  let lastUsed = -1;
  let count = 0;
  for (let i = 0; i - lastUsed <= gap; i++) {
    const address = derive(i);
    addresses.push(address);
    if (used.has(address)) {
      lastUsed = i;
      count++;
    }
  }
  return { addresses, used: count };
}

/** Lovelace and native tokens across UTxOs. Quantities are exact (bigint). */
export function sumValue(utxos: KoiosUtxo[]): { lovelace: bigint; tokens: TokenAmount[] } {
  let lovelace = 0n;
  const tokens = new Map<string, TokenAmount & { total: bigint }>();
  for (const utxo of utxos) {
    lovelace += BigInt(utxo.value);
    for (const a of utxo.asset_list ?? []) {
      const key = `${a.policy_id}.${a.asset_name}`;
      const entry = tokens.get(key);
      if (entry) entry.total += BigInt(a.quantity);
      else {
        tokens.set(key, {
          policyId: a.policy_id,
          assetName: a.asset_name,
          quantity: "0",
          decimals: a.decimals ?? 0,
          fingerprint: a.fingerprint,
          total: BigInt(a.quantity),
        });
      }
    }
  }
  const list = [...tokens.values()]
    .map(({ total, ...t }) => ({ ...t, quantity: total.toString() }))
    .sort((a, b) => (a.policyId + a.assetName).localeCompare(b.policyId + b.assetName));
  return { lovelace, tokens: list };
}

/** The seedelf token in a UTxO, if it holds one. */
export function seedelfTokenOf(utxo: KoiosUtxo, policyId: string): string | undefined {
  return utxo.asset_list?.find((a) => a.policy_id === policyId && a.asset_name.startsWith(SEEDELF_PREFIX))
    ?.asset_name;
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
