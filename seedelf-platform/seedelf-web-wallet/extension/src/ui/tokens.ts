// How the wallet names, sorts and finds tokens. Tickers, names and logos come
// from the wallet's own registry (src/tokens/, made by `npm run tokens` at each
// release), so the wallet never asks anyone about the tokens it holds. A token
// that isn't listed goes by its own name, never borrows a listed one's logo,
// and is always marked, with its fingerprint: anyone can mint a token called
// SNEK, or "₳" (launch review #18). Every text view names a token through
// `tokenText`.


import { t } from "../i18n";
import type { NetworkName } from "../networks";
import type { TokenAmount, TokenRef } from "../shared/rpc";
import mainnet from "../tokens/registry.mainnet.json";
import preprod from "../tokens/registry.preprod.json";
import { assetFingerprint } from "../shared/fingerprint";
import { foldName, formatQuantity, nameSkeleton, shortHex, tokenKey, tokenName } from "./format";

export { assetFingerprint };

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
 * Every token on the wallet's list for `network`, with what the list says of
 * it: the swap picker finds these on the device before it asks Minswap
 * (privacy review §3.11).
 */
export function listedTokens(network: NetworkName): Array<{ policyId: string; assetName: string; info: TokenInfo }> {
  return Object.entries(REGISTRY[network]).map(([key, info]) => {
    const [policyId, assetName] = key.split(".");
    return { policyId: policyId!, assetName: assetName ?? "", info };
  });
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
 * invisible characters, digits before it that join the amount: "000 ADA"),
 * or has ADA as one of its words ("ADA bonus"), goes by its fingerprint
 * instead, so it never reads as the real one.
 */
export function tokenText(network: NetworkName, t: TokenRef & { fingerprint?: string }): TokenText {
  const info = tokenInfo(network, t);
  const fingerprint = t.fingerprint || assetFingerprint(t);
  const id = shortHex(fingerprint, 10, 6);
  if (info) return { label: info.ticker, listed: true, fingerprint, id };
  const own = tokenName(t.assetName);
  // An empty asset name is what `tokenName` answers "(no name)" to, in whichever
  // language: tested here as the empty name, never as that answer's text.
  const readable =
    !!t.assetName && own !== shortHex(t.assetName) && !HIDDEN.test(own.replace(EMOJI, "")) && /\S/.test(own);
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
  if (text.posesAs) {
    const real = text.posesAs === ADA ? ADA : t("tokens.theListed", { token: text.posesAs });
    return t("tokens.mark.posesAs", { own: text.own, real });
  }
  // The label is its fingerprint already, unless it's a CSV's whole one.
  if (text.label === text.id && !whole) return t("tokens.mark.unlisted");
  return t("tokens.mark.unlistedId", { id: whole ? text.fingerprint : text.id });
}

/**
 * A token amount as one line of text, named by `tokenText`: "1,000 SNEK", or
 * "500 FOO (not on the wallet's list, asset1qz8h…x7k3pd)". The quantity is
 * as given (with `tokenDecimals`); a sign is the caller's.
 */
export function tokenAmountText(
  network: NetworkName,
  token: TokenRef & { quantity: string; decimals?: number; fingerprint?: string },
): string {
  const text = tokenText(network, token);
  const mark = tokenMark(text);
  const amount = `${tokenQuantity(network, token)} ${text.label}`;
  // The mark's brackets are the language's: full-width around Japanese.
  return mark ? t("tokens.withMark", { amount, mark }) : amount;
}

const ADA = "ADA";

/** What an unlisted token may never be called: ADA by any of its names. */
const ADA_NAMES = ["ada", "tada", "₳", "t₳", "lovelace", "cardano"];

/** Characters that change how a name shows without showing: bidi controls, zero-width ones, fillers. */
const HIDDEN = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/u;

/** An emoji, which may carry a variation selector and join others: those invisible characters are its own. */
const EMOJI = /\p{Extended_Pictographic}[\uFE0E\uFE0F]?(?:\u200D\p{Extended_Pictographic}[\uFE0E\uFE0F]?)*/gu;

/** ADA's names as `nameSkeleton` has them: an unlisted token may not have one as any of its words either. */
const ADA_WORDS = new Set(ADA_NAMES.map(nameSkeleton));

/**
 * What may lead a name and join the amount a text view puts before it, so
 * "000 ADA" reads "1 000 ADA": digits in any script, spaces (the no-break
 * and thin ones too), punctuation and symbols.
 */
const AMOUNT_LEAD = /^[\p{N}\p{M}\p{P}\p{S}\p{Z}\s]+/u;

/**
 * The same in a folded name (`foldName`), where the letters that pass for 0
 * and 1 are o and l, as the digits are: whole words of them, and what
 * separates them ("OOO SNEK", "O,OOO SNEK").
 */
const FOLDED_LEAD = /^(?:[ol\p{N}]*[\p{P}\p{S}\p{Z}\s]+)+/u;

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
  const whole = names.get(key);
  if (whole) return whole;
  // Led by digits or separators, the rest follows the amount: "1 000 ADA",
  // "1 ,000 SNEK". Digits map to letters in a skeleton ("000 ADA" is
  // "oooada"), so the rest is looked up on its own.
  const folded = foldName(own);
  const rests = [foldName(own.replace(AMOUNT_LEAD, "")), folded.replace(FOLDED_LEAD, "")];
  for (const rest of rests) {
    const found = names.get(rest.replace(/[^\p{L}\p{N}₳]/gu, ""));
    if (found) return found;
  }
  // ADA as one word of several reads as an amount of it too: "1,000 ADA bonus".
  for (const name of [folded, ...rests]) {
    if (name.split(/[^\p{L}\p{N}₳]+/u).some((word) => ADA_WORDS.has(word))) return ADA;
  }
  return undefined;
}

/** A token as the lists show it. */
export interface TokenView {
  token: TokenAmount;
  info?: TokenInfo;
  /** The ticker, the name the token carries, or its shortened fingerprint. */
  label: string;
  /** A second line: the registry's full name, or the fingerprint. */
  sub: string;
  /**
   * The second line is a warning: a token passing for ADA or a listed one,
   * which goes by its fingerprint and says what it calls itself. Shown whole,
   * never cut: in the side panel it read "not on the wallet's …", the part
   * that matters lost (chunk 23's review, H-9).
   */
  warn?: boolean;
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
    sub: info ? info.name : text.posesAs ? t("tokens.callsItself", { own: text.own }) : text.id,
    ...(!info && text.posesAs ? { warn: true } : {}),
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
