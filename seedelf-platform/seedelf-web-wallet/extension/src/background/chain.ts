// Pure helpers over Koios UTxOs: reading registers from datums, discovering
// the Cardano account's addresses, looking further along its chains for a
// key, and adding up value. No network, no keys: a derivation is handed in.

import type { TokenAmount } from "../shared/rpc";
import { SEEDELF_PREFIX, seedelfLabel } from "../shared/seedelf-name";
import type { KoiosUtxo } from "./koios";

/** The standard BIP44 gap limit: stop after this many unused addresses in a row. */
export const GAP_LIMIT = 20;

export { SEEDELF_PREFIX, seedelfLabel };

export interface RegisterHex {
  generator: string;
  publicValue: string;
}

const HEX = /^(?:[0-9a-fA-F]{2})*$/;
/** Constructor 0's tag, and the general form's: `102([0, fields])`. */
const CONSTR_0 = 121;
const CONSTR_ANY = 102;
const POINT_BYTES = 48;

/** A CBOR item's head at `at`: its major type, its argument (null when indefinite), and where what follows starts. */
function headAt(b: Uint8Array, at: number): { major: number; arg: number | null; next: number } | undefined {
  if (at >= b.length) return undefined;
  const major = b[at]! >> 5;
  const info = b[at]! & 0x1f;
  if (info < 24) return { major, arg: info, next: at + 1 };
  if (info === 31) return { major, arg: null, next: at + 1 };
  if (info > 27) return undefined;
  const size = 1 << (info - 24);
  if (at + 1 + size > b.length) return undefined;
  // Past 2^53 it's inexact, but never one of the small numbers a register is read by.
  let arg = 0;
  for (let i = 1; i <= size; i++) arg = arg * 256 + b[at + i]!;
  return { major, arg, next: at + 1 + size };
}

/** A register's field at `at`: 48 bytes, whole or in chunks. */
function pointAt(b: Uint8Array, at: number): { hex: string; next: number } | undefined {
  const head = headAt(b, at);
  if (!head || head.major !== 2) return undefined;
  const chunks: Uint8Array[] = [];
  let length = 0;
  let next = head.next;
  if (head.arg !== null) {
    if (head.arg !== POINT_BYTES || next + POINT_BYTES > b.length) return undefined;
    chunks.push(b.subarray(next, next + POINT_BYTES));
    length = POINT_BYTES;
    next += POINT_BYTES;
  } else {
    // Definite byte strings until a break.
    for (;;) {
      if (b[next] === 0xff) {
        next++;
        break;
      }
      const chunk = headAt(b, next);
      if (!chunk || chunk.major !== 2 || chunk.arg === null || chunk.next + chunk.arg > b.length) return undefined;
      length += chunk.arg;
      if (length > POINT_BYTES) return undefined;
      chunks.push(b.subarray(chunk.next, chunk.next + chunk.arg));
      next = chunk.next + chunk.arg;
    }
    if (length !== POINT_BYTES) return undefined;
  }
  const hex = chunks.map((c) => Array.from(c, (x) => x.toString(16).padStart(2, "0")).join("")).join("");
  return { hex, next };
}

/**
 * The register in a wallet-contract UTxO's inline datum, read from its CBOR:
 * constructor 0 holding exactly two 48-byte byte strings, with nothing after,
 * however the CBOR spells them (a definite or indefinite list, bytes whole or
 * in chunks, constructor 0's general form `102([0, fields])`, its pair
 * definite or indefinite), as the node reads every one alike. That's what
 * the CLI and the WebAssembly read (seedelf-koios `register_of_datum`), never
 * the datum's JSON, which Koios's rows lose once `trimmed`. It's read token by
 * token, so a deeply nested datum is only "not a register". Anything else
 * isn't a spendable register, so it's skipped. Whether the points are valid
 * is left to the WebAssembly ownership check.
 */
export function registerOf(utxo: KoiosUtxo): RegisterHex | undefined {
  const hex = utxo.inline_datum?.bytes;
  if (typeof hex !== "string" || !HEX.test(hex)) return undefined;
  const b = Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

  const tag = headAt(b, 0);
  if (!tag || tag.major !== 6) return undefined;
  let at = tag.next;
  // In the general form, whether its pair is an indefinite list, which a break must end after the fields: the node
  // takes `102([_ 0, fields])` too (chunk 51, r2sign#1).
  let openPair = false;
  if (tag.arg === CONSTR_ANY) {
    const pair = headAt(b, at);
    if (!pair || pair.major !== 4 || (pair.arg !== null && pair.arg !== 2)) return undefined;
    openPair = pair.arg === null;
    const index = headAt(b, pair.next);
    if (!index || index.major !== 0 || index.arg !== 0) return undefined;
    at = index.next;
  } else if (tag.arg !== CONSTR_0) {
    return undefined;
  }

  const fields = headAt(b, at);
  if (!fields || fields.major !== 4 || (fields.arg !== null && fields.arg !== 2)) return undefined;
  const generator = pointAt(b, fields.next);
  const publicValue = generator && pointAt(b, generator.next);
  if (!generator || !publicValue) return undefined;
  at = publicValue.next;
  // An indefinite list, the fields or the pair: a break must end each, after the two fields.
  for (const open of [fields.arg === null, openPair]) {
    if (!open) continue;
    if (b[at] !== 0xff) return undefined;
    at++;
  }
  return at === b.length ? { generator: generator.hex, publicValue: publicValue.hex } : undefined;
}

/**
 * A register as rows are matched by: its two points as `registerOf` reads them, never the datum's bytes, which the
 * node takes in several spellings (r3a#1). Two rows with one key are under the same register, which anyone reading the
 * chain can see (chunk 51, gap-g1#1, x1a#2).
 */
export const registerKey = (r: RegisterHex): string => `${r.generator}.${r.publicValue}`.toLowerCase();

/** `rows` by their register (`registerKey`), each row once: a row whose datum is no register is left out. Asks no one. */
export function byRegister(rows: readonly KoiosUtxo[]): Map<string, KoiosUtxo[]> {
  const found = new Map<string, KoiosUtxo[]>();
  const seen = new Set<string>();
  for (const u of rows) {
    const at = `${u.tx_hash}#${u.tx_index}`;
    const register = seen.has(at) ? undefined : registerOf(u);
    seen.add(at);
    if (!register) continue;
    const key = registerKey(register);
    found.set(key, [...(found.get(key) ?? []), u]);
  }
  return found;
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

/**
 * How far along each of a public account's chains its payment keys are
 * looked for (`fartherKeys`): a thousand key hashes at most, about a fifth of
 * a second, each time an address carries the account's stake key under a
 * payment key the wallet doesn't know. Send and Make public look as far, in
 * WebAssembly (lib.rs `OWN_KEYS_STAKED`), and own-address.test.ts holds the
 * two together: one changed alone, a key read as the account's in a site's
 * prompt and as someone else's on Send (1.7.2's release review, pr359#4).
 */
export const FARTHER_KEYS = 500;

/**
 * Which of `keys` (payment key hashes, hex) are an account's past the first
 * GAP_LIMIT of each chain, as `paymentKeyHash` derives them: looked for along
 * both up to FARTHER_KEYS, stopping once each is found. An address of the
 * account's past those, before a balance reading found it, carries the
 * account's stake key, and so does anyone's who pairs their own key with it:
 * only its payment key says which. Lovejoin's madeBy looks here for what
 * made a box, and a site's signing prompt (dapp.ts `ties`) before it calls
 * an address someone else's.
 */
export function fartherKeys(paymentKeyHash: (role: number, index: number) => string, keys: Iterable<string>): string[] {
  const left = new Set(keys);
  const found: string[] = [];
  for (let i = GAP_LIMIT; i < FARTHER_KEYS && left.size; i++) {
    for (const role of [0, 1]) {
      const key = paymentKeyHash(role, i);
      if (left.delete(key)) found.push(key);
    }
  }
  return found;
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

