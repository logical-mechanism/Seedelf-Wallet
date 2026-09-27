// How the wallet names, sorts and finds tokens. Tickers, names and logos come
// from the wallet's own registry (src/tokens/, made by `npm run tokens` at each
// release), so the wallet never asks anyone about the tokens it holds. A token
// that isn't listed goes by its own name, never borrows a listed one's logo,
// and is always marked, with its fingerprint: anyone can mint a token called
// SNEK, or "₳" (launch review #18). Every text view names a token through
// `tokenText`.

import { blake2b } from "@noble/hashes/blake2.js";

import type { NetworkName } from "../networks";
import type { TokenAmount, TokenRef } from "../shared/rpc";
import mainnet from "../tokens/registry.mainnet.json";
import preprod from "../tokens/registry.preprod.json";
import { formatQuantity, nameSkeleton, shortHex, tokenKey, tokenName } from "./format";

export interface TokenInfo {
  ticker: string;
  name: string;
  decimals: number;
  /** A small square WebP, as a data URI. */
  logo?: string;
}

const REGISTRY: Record<NetworkName, Record<string, TokenInfo>> = {
  preprod,
  // Only a mainnet build carries the mainnet list.
  mainnet: __MAINNET_ENABLED__ ? mainnet : {},
};

/** The registry's entry for a token, if the wallet's list has it. */
export function tokenInfo(network: NetworkName, t: { policyId: string; assetName: string }): TokenInfo | undefined {
  return REGISTRY[network][tokenKey(t)];
}

/**
 * A token's name alone: `tokenText`'s label. Where the text can say more,
 * `tokenAmountText` (or TokenAmountText) also marks a token that isn't on
 * the wallet's list.
 */
export function tokenLabel(network: NetworkName, t: TokenRef): string {
  return tokenText(network, t).label;
}

/**
 * How many decimal places a token's amounts have: the wallet's list's, for a
 * listed token, over what Koios read from the token registry (a form's
 * `TokenAmount`); none known is 0, raw units. Every form, review and list
 * uses this, so they never disagree on a token's unit (launch review #55).
 */
export function tokenDecimals(network: NetworkName, t: TokenRef & { decimals?: number }): number {
  return tokenInfo(network, t)?.decimals ?? t.decimals ?? 0;
}

/** A token's quantity in its units (`tokenDecimals`): "1,000.5". */
export function tokenQuantity(network: NetworkName, t: TokenRef & { quantity: string; decimals?: number }): string {
  return formatQuantity(t.quantity, tokenDecimals(network, t));
}

/** How a text view names a token: see `tokenText`. */
export interface TokenText {
  /**
   * What to call it: its ticker, when it's on the wallet's list; otherwise
   * its own name, unless that could pass for ADA or a listed token, hides
   * characters, or doesn't read as text: then its shortened fingerprint.
   */
  label: string;
  /** On the wallet's list: the only tokens whose name the wallet vouches for. */
  listed: boolean;
  /** Its CIP-14 fingerprint, `asset1…`, whole. */
  fingerprint: string;
  /** The fingerprint shortened, as the lists show it: "asset1qz8h…x7k3pd". */
  id: string;
  /** An unlisted token whose own name passes for ADA or a listed token: "ADA", or that token's ticker. */
  posesAs?: string;
  /** Such a token's own name, which `label` then isn't. */
  own?: string;
}

/**
 * How every text view names a token: reviews, a site's signing prompt,
 * Activity, swaps and sessions. A listed token is its ticker. Any other is
 * marked (`tokenMark`: "not on the wallet's list", with its fingerprint), and
 * one whose own name reads like ADA ("₳", "ADA", "lovelace") or like a listed
 * token's ticker or name, however it's spelled (case, lookalike letters,
 * invisible characters), goes by its fingerprint instead, so it never reads
 * as the real one.
 */
export function tokenText(network: NetworkName, t: TokenRef & { fingerprint?: string }): TokenText {
  const info = tokenInfo(network, t);
  const fingerprint = t.fingerprint || assetFingerprint(t);
  const id = shortHex(fingerprint, 10, 6);
  if (info) return { label: info.ticker, listed: true, fingerprint, id };
  const own = tokenName(t.assetName);
  const readable =
    own !== shortHex(t.assetName) && own !== "(no name)" && !HIDDEN.test(own.replace(EMOJI, "")) && /\S/.test(own);
  if (!readable) return { label: id, listed: false, fingerprint, id };
  const posesAs = lookalikeOf(network, own);
  return posesAs ? { label: id, listed: false, fingerprint, id, posesAs, own } : { label: own, listed: false, fingerprint, id };
}

/**
 * What a text view adds after an unlisted token's name, as a clause:
 * "not on the wallet's list, asset1qz8h…x7k3pd", or for one that passes for
 * another, "not on the wallet's list: it calls itself ₳, but it isn't ADA".
 * `whole` gives the whole fingerprint (a CSV). Nothing for a listed token.
 */
export function tokenMark(text: TokenText, whole = false): string | undefined {
  if (text.listed) return undefined;
  const LIST = "not on the wallet's list";
  if (text.posesAs) {
    const real = text.posesAs === ADA ? ADA : `the listed ${text.posesAs}`;
    return `${LIST}: it calls itself ${text.own}, but it isn't ${real}`;
  }
  // The label is its fingerprint already, unless it's a CSV's whole one.
  if (text.label === text.id) return whole ? `${LIST}, ${text.fingerprint}` : LIST;
  return `${LIST}, ${whole ? text.fingerprint : text.id}`;
}

/**
 * A token amount as one line of text, named by `tokenText`: "1,000 SNEK", or
 * "500 FOO (not on the wallet's list, asset1qz8h…x7k3pd)". The quantity is
 * as given (with `tokenDecimals`); a sign is the caller's.
 */
export function tokenAmountText(network: NetworkName, t: TokenRef & { quantity: string; decimals?: number; fingerprint?: string }): string {
  const text = tokenText(network, t);
  const mark = tokenMark(text);
  return `${tokenQuantity(network, t)} ${text.label}${mark ? ` (${mark})` : ""}`;
}

const ADA = "ADA";

/** What an unlisted token may never be called: ADA by any of its names. */
const ADA_NAMES = ["ada", "tada", "₳", "t₳", "lovelace", "cardano"];

/** Characters that change how a name shows without showing: bidi controls, zero-width ones, fillers. */
const HIDDEN = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/u;

/** An emoji, which may carry a variation selector and join others: those invisible characters are its own. */
const EMOJI = /\p{Extended_Pictographic}[\uFE0E\uFE0F]?(?:\u200D\p{Extended_Pictographic}[\uFE0E\uFE0F]?)*/gu;

/** Each network's names to keep, skeleton to what the name passes for. */
const LOOKALIKES = new Map<NetworkName, Map<string, string>>();

/** The listed token, or ADA, whose name `own` could pass for; undefined if none. */
function lookalikeOf(network: NetworkName, own: string): string | undefined {
  let names = LOOKALIKES.get(network);
  if (!names) {
    names = new Map(ADA_NAMES.map((n) => [nameSkeleton(n), ADA]));
    // This network's list first, then the other's: a token named like either is kept apart.
    const networks: NetworkName[] = network === "mainnet" ? ["mainnet", "preprod"] : ["preprod", "mainnet"];
    for (const n of networks) {
      for (const info of Object.values(REGISTRY[n])) {
        for (const name of [info.ticker, info.name]) {
          const key = nameSkeleton(name);
          if (key && !names.has(key)) names.set(key, info.ticker);
        }
      }
    }
    LOOKALIKES.set(network, names);
  }
  const key = nameSkeleton(own);
  // "₳" anywhere reads as an ADA amount: "1,000 ₳ bonus".
  if (key.includes("₳")) return ADA;
  return names.get(key);
}

/**
 * CIP-14: a token's fingerprint, `asset1…`, the bech32 of the blake2b-160
 * of its policy ID and asset name. Koios gives it for held tokens; a site's
 * transaction and Activity carry only the policy and name.
 */
export function assetFingerprint(t: TokenRef): string {
  const bytes = Uint8Array.from(`${t.policyId}${t.assetName}`.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
  return bech32("asset", blake2b(bytes, { dkLen: 20 }));
}

const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

/** BIP-173 bech32 of `data`, under `prefix`. */
function bech32(prefix: string, data: Uint8Array): string {
  const words: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const byte of data) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((acc >> bits) & 31);
    }
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31);
  const polymod = (values: number[]) => {
    const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const v of values) {
      const top = chk >>> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i]!;
    }
    return chk;
  };
  const expanded = [...[...prefix].map((c) => c.charCodeAt(0) >> 5), 0, ...[...prefix].map((c) => c.charCodeAt(0) & 31)];
  const mod = polymod([...expanded, ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return `${prefix}1${[...words, ...checksum].map((w) => BECH32[w]).join("")}`;
}

/** A token as the lists show it. */
export interface TokenView {
  token: TokenAmount;
  info?: TokenInfo;
  /** The ticker, the name the token carries, or its shortened fingerprint. */
  label: string;
  /** A second line: the registry's full name, or the fingerprint. */
  sub: string;
  decimals: number;
  amount: string;
  nft: boolean;
}

// CIP-67 labels: 222 is an NFT; 333 and 444 are fungible.
const NFT_LABEL = "000de140";
const FT_LABELS = ["0014df10", "001bc280"];

/**
 * Whether a token is an NFT, without asking anyone: a CIP-68 label says so;
 * otherwise a listed token is fungible, and a single unit with no decimals is
 * an NFT.
 */
export function isNft(t: TokenAmount, info?: TokenInfo): boolean {
  if (t.assetName.startsWith(NFT_LABEL)) return true;
  if (info || FT_LABELS.some((l) => t.assetName.startsWith(l))) return false;
  return t.quantity === "1" && t.decimals === 0;
}

export function viewToken(network: NetworkName, token: TokenAmount): TokenView {
  const info = tokenInfo(network, token);
  const text = tokenText(network, token);
  const decimals = tokenDecimals(network, token);
  return {
    token,
    info,
    label: text.label,
    // One passing for another says what it calls itself, beside its fingerprint.
    sub: info ? info.name : text.posesAs ? `Calls itself ${text.own}, not on the wallet's list` : text.id,
    decimals,
    amount: formatQuantity(token.quantity, decimals),
    nft: isNft(token, info),
  };
}

export type TokenSort = "name" | "amount";

const byName = (a: TokenView, b: TokenView) =>
  a.label.localeCompare(b.label, "en", { numeric: true, sensitivity: "base" }) ||
  tokenKey(a.token).localeCompare(tokenKey(b.token));

/** The amount as a fixed-point bigint with 30 decimals, so amounts with different decimals compare. */
const scaled = (v: TokenView) => BigInt(v.token.quantity) * 10n ** BigInt(30 - Math.min(v.decimals, 30));

/** By name (A to Z), or by amount (largest first, then by name). */
export function sortTokens(views: TokenView[], sort: TokenSort): TokenView[] {
  const order =
    sort === "name"
      ? byName
      : (a: TokenView, b: TokenView) => {
          const d = scaled(b) - scaled(a);
          return d > 0n ? 1 : d < 0n ? -1 : byName(a, b);
        };
  return [...views].sort(order);
}

/** Tokens whose ticker, names, policy ID, asset name or fingerprint contain `query`. */
export function searchTokens(views: TokenView[], query: string): TokenView[] {
  const q = query.trim().toLowerCase();
  if (!q) return views;
  return views.filter((v) =>
    [v.label, v.sub, v.info?.name, tokenName(v.token.assetName), v.token.policyId, v.token.assetName, v.token.fingerprint]
      .filter(Boolean)
      .some((s) => s!.toLowerCase().includes(q)),
  );
}

/** The two letters an avatar shows when there's no logo. */
export function initials(label: string): string {
  const letters = [...label.replace(/[^\p{L}\p{N}]/gu, "")];
  return (letters.length ? letters.slice(0, 2).join("") : "?").toUpperCase();
}

/** One of a few avatar tints, the same for every token of a policy. */
export function tint(policyId: string): number {
  let h = 0;
  for (const c of policyId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 6;
}
