// How the wallet names, sorts and finds tokens. Tickers, names and logos come
// from the wallet's own registry (src/tokens/, made by `npm run tokens` at each
// release), so the wallet never asks anyone about the tokens it holds. A token
// that isn't listed goes by its own name, and never borrows a listed one's logo.

import type { NetworkName } from "../networks";
import type { TokenAmount } from "../shared/rpc";
import mainnet from "../tokens/registry.mainnet.json";
import preprod from "../tokens/registry.preprod.json";
import { formatQuantity, shortHex, tokenKey, tokenName } from "./format";

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
  const own = tokenName(token.assetName);
  const readable = own !== shortHex(token.assetName) && own !== "(no name)";
  const fingerprint = shortHex(token.fingerprint, 10, 6);
  const decimals = token.decimals || info?.decimals || 0;
  return {
    token,
    info,
    label: info?.ticker ?? (readable ? own : fingerprint),
    sub: info ? info.name : fingerprint,
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
