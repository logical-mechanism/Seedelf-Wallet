// An NFT's image, when the user asks to see it: one NFT at a time, from its
// details, and never otherwise (chunk 20, docs/plans/chunk-20-nft-images.md).
// Nothing is fetched for a wallet merely holding NFTs, or opening Tokens.
//
// A click costs two requests. Koios's `asset_info` gives the token's metadata:
// CIP-25's from the transaction that minted it (label 721), and CIP-68's from
// its reference token's datum. Then, when the image is on IPFS, the gateway
// (networks.ts IPFS_GATEWAY) gives the file. Each sees this IP address ask
// about this NFT; that's the trade the user makes by clicking, and the details
// say so where they click.
//
// Only IPFS is fetched, through that one gateway, and an image written on
// chain needs no request at all. Any other address is handed back for the
// page to show, not fetched: anyone can send this wallet an NFT, and one whose
// image sits on a server of its sender's choosing would tell that server the
// IP address of whoever looks at it. A gateway's address in the metadata
// (`https://ipfs.io/ipfs/…`, `https://<cid>.ipfs.dweb.link/…`) is the same
// file under its CID, so it comes from the one gateway instead.
//
// The file comes back to the page as a data URI and is kept nowhere: no
// cookies or referrer go out (SERVICE_FETCH), and `no-store` keeps it out of
// Chrome's cache on the disk, so the disk never says which NFTs this wallet
// looked at, as it never says which contract UTxOs are the user's
// (privacy.md). The page holds what it shows until the wallet locks.

import { t } from "../i18n";
import { IPFS_GATEWAY, IPFS_GATEWAY_HOST, type NetworkName } from "../networks";
import type { NftImage } from "../shared/rpc";
import { CONTRACT_V1 } from "./balances";
import { SERVICE_FETCH, type FetchLike, type Koios, type KoiosAssetInfo } from "./koios";

/** The largest image the wallet shows: one larger isn't read past this. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** How long the gateway has to send the whole file. */
const TIMEOUT_MS = 30_000;

/** What every image request goes out with: no cookies, no referrer, and nothing left in Chrome's cache. */
export const IMAGE_FETCH = { ...SERVICE_FETCH, cache: "no-store" } as const satisfies RequestInit;

/** The gateway's host, as the words name it. */
export const GATEWAY_HOST = new URL(IPFS_GATEWAY).host;

/** Whether Chrome lets the worker reach the gateway. Outside an extension, as in tests, the answer is yes. */
export type GatewayCheck = () => Promise<boolean>;

const chromeAllows: GatewayCheck = async () => {
  if (typeof chrome === "undefined" || !chrome.permissions) return true;
  return chrome.permissions.contains({ origins: [IPFS_GATEWAY_HOST] }).catch(() => false);
};

export interface NftImageDeps {
  koios: (network: NetworkName) => Koios;
  fetch?: FetchLike;
  /** Chrome's grant for the gateway, checked before anything is asked. */
  allowed?: GatewayCheck;
}

export class NftImageService {
  constructor(private readonly deps: NftImageDeps) {}

  /**
   * The image of `policyId.assetName`, which the user asked to see. Without
   * Chrome's grant for the gateway nothing is asked at all, Koios included:
   * a user who turned the gateway down has said no to the lookup too.
   */
  async show(network: NetworkName, policyId: string, assetName: string): Promise<NftImage> {
    if (!/^[0-9a-f]{56}$/.test(policyId) || !/^(?:[0-9a-f]{2}){0,32}$/.test(assetName)) {
      throw new Error(t("nftImage.notAToken"));
    }
    // A Seedelf has no image, and asking Koios about one would tie this IP to it.
    if (policyId === CONTRACT_V1.seedelfPolicyId) return { none: "seedelf" };
    if (!(await (this.deps.allowed ?? chromeAllows)())) throw new Error(t("nftImage.notAllowed", { host: GATEWAY_HOST }));
    const info = await this.deps.koios(network).assetInfo(policyId, assetName);
    const found = info ? imageOf(info, policyId, assetName) : undefined;
    if (!found) return { none: "metadata" };
    const source = found.uri === undefined ? undefined : sourceOf(found.uri);
    if (!source) return { none: "image" };
    if ("data" in source) return { image: source.data, from: "chain" };
    if ("elsewhere" in source) return { elsewhere: source.elsewhere };
    return this.fromIpfs(source.ipfs, found.mediaType);
  }

  /** The file at `/ipfs/<path>` on the gateway, as a data URI. */
  private async fromIpfs(path: string, declared: string | undefined): Promise<NftImage> {
    const url = `${IPFS_GATEWAY}/ipfs/${path}`;
    const get = this.deps.fetch ?? ((u: string, init: RequestInit) => fetch(u, init));
    let response: Response;
    try {
      response = await get(url, { ...IMAGE_FETCH, method: "GET", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new Error(failed(e));
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const status = response.status;
      if (status === 429) throw new Error(t("nftImage.busy", { host: GATEWAY_HOST }));
      throw new Error(t(status >= 500 ? "nftImage.trouble" : "nftImage.notFound", { host: GATEWAY_HOST, status }));
    }
    let bytes: Uint8Array | undefined;
    try {
      bytes = await readCapped(response, MAX_IMAGE_BYTES);
    } catch (e) {
      throw new Error(failed(e));
    }
    if (!bytes) return { tooLarge: MAX_IMAGE_BYTES };
    const type = imageType(bytes, response.headers.get("content-type"), declared);
    if (!type) return { notImage: true };
    return { image: `data:${type};base64,${base64(bytes)}`, from: "ipfs" };
  }
}

/** Why the gateway gave nothing, in words: too slow, or not reached. */
function failed(e: unknown): string {
  if (e instanceof DOMException && e.name === "TimeoutError") return t("nftImage.slow", { host: GATEWAY_HOST });
  return t("nftImage.unreachable", { host: GATEWAY_HOST, cause: e instanceof Error ? e.message : String(e) });
}

/** What the metadata says of the image: its address and the type it declares, either possibly missing. */
export interface ImageEntry {
  uri?: string;
  mediaType?: string;
}

// CIP-67's label for an NFT (222), as an asset name starts.
const NFT_LABEL = "000de140";

/**
 * Where a token's metadata says its image is, or undefined when Koios has
 * none for it. A CIP-68 NFT (label 222) reads its reference datum first,
 * which its minter can update, and CIP-25's after; anything else reads
 * CIP-25's alone.
 */
export function imageOf(info: KoiosAssetInfo, policyId: string, assetName: string): ImageEntry | undefined {
  const fromDatum = cip68(info.cip68_metadata);
  const fromMint = cip25(info.minting_tx_metadata, policyId, assetName);
  const entries = assetName.startsWith(NFT_LABEL) ? [fromDatum, fromMint] : [fromMint];
  const found = entries.filter((e): e is ImageEntry => e !== undefined);
  return found.find((e) => e.uri !== undefined) ?? found[0];
}

const record = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/** A metadata string: CIP-25 splits one longer than 64 bytes into a list of pieces. */
function text(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length && v.every((p) => typeof p === "string")) return v.join("");
  return undefined;
}

/** CIP-25: `721 → policy → asset name → { image, mediaType }`, the names as text (v1) or hex (v2). */
function cip25(metadata: unknown, policyId: string, assetName: string): ImageEntry | undefined {
  const policies = record(record(metadata)?.["721"]);
  const assets = record(policies?.[policyId] ?? policies?.[`0x${policyId}`]);
  if (!assets) return undefined;
  const name = utf8(assetName);
  const keys = [name, assetName, `0x${assetName}`].filter((k): k is string => k !== undefined);
  const entry = keys.map((k) => record(assets[k])).find(Boolean);
  if (!entry) return undefined;
  return { uri: text(entry.image), mediaType: text(entry.mediaType) };
}

/**
 * CIP-68: the reference datum, `Constr 0 [metadata, version, extra]`, which
 * Koios gives in detailed-schema JSON under the user token's label. The
 * metadata is a map of bytes to bytes (or a list of them, for a long one),
 * read as UTF-8.
 */
function cip68(metadata: unknown): ImageEntry | undefined {
  const datum = record(record(metadata)?.["222"]);
  const fields = datum?.fields;
  const map = Array.isArray(fields) ? record(fields[0])?.map : undefined;
  if (!Array.isArray(map)) return undefined;
  const entry: ImageEntry = {};
  for (const pair of map) {
    const key = utf8(textBytes(record(pair)?.k) ?? "");
    const value = datumText(record(pair)?.v);
    if (key === "image" && value !== undefined) entry.uri = value;
    if (key === "mediaType" && value !== undefined) entry.mediaType = value;
  }
  return entry;
}

/** A datum's `{ bytes }`, as hex. */
const textBytes = (v: unknown): string | undefined => {
  const bytes = record(v)?.bytes;
  return typeof bytes === "string" ? bytes : undefined;
};

/** A datum value as text: `{ bytes }`, or `{ list: [{ bytes }…] }` joined. */
function datumText(v: unknown): string | undefined {
  const one = textBytes(v);
  if (one !== undefined) return utf8(one);
  const list = record(v)?.list;
  if (!Array.isArray(list) || !list.length) return undefined;
  const parts = list.map((p) => {
    const hex = textBytes(p);
    return hex === undefined ? undefined : utf8(hex);
  });
  return parts.every((p): p is string => p !== undefined) ? parts.join("") : undefined;
}

/** Hex as UTF-8 text, or undefined when it isn't hex of valid UTF-8. */
function utf8(hex: string): string | undefined {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) return undefined;
  const bytes = Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** Where an image is: a path on IPFS (`<cid>[/path]`, as a gateway takes it), on chain, or anywhere else. */
export type ImageSource = { ipfs: string } | { data: string } | { elsewhere: string };

/** The longest address the wallet hands the page: anything longer reads as no image. */
const MAX_ADDRESS = 2048;

/** The longest image written on chain the wallet shows: far more than one transaction can carry. */
const MAX_DATA_URI = 1024 * 1024;

/** An image written into the metadata itself, as a data URI. */
const DATA_IMAGE = /^data:image\/[a-z0-9.+-]+(?:;[a-z0-9=._+-]+)*,/i;

/**
 * A CID as gateways take it: v0 (base58btc, `Qm…`), or v1 in a multibase of
 * letters and digits alone (base32 `b`/`B`, base58btc `z`, base16 `f`/`F`,
 * base36 `k`/`K`). Nothing else may go first in a path to the gateway.
 */
const CID = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|[bBzfFkK][0-9A-Za-z]{40,200})$/;

// `ipfs://<cid>`, and the forms real metadata has besides: `ipfs:<cid>`, `ipfs://ipfs/<cid>`.
const IPFS_SCHEME = /^ipfs:\/*(?:ipfs\/+)?([^?#]*)/i;
const SUBDOMAIN_GATEWAY = /^https?:\/\/([0-9a-z]+)\.ipfs\.[^/?#]+(\/[^?#]*)?/i;
const PATH_GATEWAY = /^https?:\/\/[^/?#]+\/ipfs\/([^?#]+)/i;
const BARE = /^\/?(?:ipfs\/)?([^?#]*)/i;

/**
 * Where an image address points, for the wallet to fetch or not; undefined
 * for one that's empty, unreadable, or names IPFS with no CID (`ipfs://`,
 * which real metadata has).
 */
export function sourceOf(uri: string): ImageSource | undefined {
  const raw = uri.trim();
  if (!raw) return undefined;
  if (/^data:/i.test(raw)) return DATA_IMAGE.test(raw) && raw.length <= MAX_DATA_URI ? { data: raw } : undefined;
  if (raw.length > MAX_ADDRESS) return undefined;
  const scheme = IPFS_SCHEME.exec(raw);
  if (scheme) {
    const path = ipfsPath(scheme[1]!);
    return path ? { ipfs: path } : undefined;
  }
  // A gateway's address is the same file under its CID; one whose CID isn't one is an address like any other.
  const subdomain = SUBDOMAIN_GATEWAY.exec(raw);
  const onGateway = subdomain ? ipfsPath(`${subdomain[1]}${subdomain[2] ?? ""}`) : ipfsPath(PATH_GATEWAY.exec(raw)?.[1]);
  if (onGateway) return { ipfs: onGateway };
  // A bare CID, as some metadata gives it, with or without `ipfs/` before it.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    const bare = ipfsPath(BARE.exec(raw)?.[1]);
    if (bare) return { ipfs: bare };
  }
  return { elsewhere: raw };
}

/**
 * `<cid>[/path]` checked and made safe for a URL: the CID one, and each part
 * of the path decoded and encoded again, with none of `.` or `..`.
 */
function ipfsPath(rest: string | undefined): string | undefined {
  if (rest === undefined) return undefined;
  const [cid, ...parts] = rest.split("/");
  if (!cid || !CID.test(cid)) return undefined;
  const path: string[] = [cid];
  for (const part of parts) {
    if (!part) continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      return undefined;
    }
    if (decoded === "." || decoded === "..") return undefined;
    path.push(encodeURIComponent(decoded));
  }
  return path.join("/");
}

/**
 * The body, or undefined when it's over `max` bytes: a length that says so
 * stops it before a byte is read, and one that doesn't is counted as it
 * comes and cut off there.
 */
export async function readCapped(response: Response, max: number): Promise<Uint8Array | undefined> {
  const length = Number(response.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(length) && length > max) {
    await response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length > max ? undefined : bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

const IMAGE_TYPE = /^image\/[a-z0-9.+-]+$/;

/** What a server sends when it doesn't know what a file is: only then does the metadata's word count. */
const GENERIC_TYPE = new Set(["", "application/octet-stream", "binary/octet-stream", "application/unknown"]);

/** A type as a data URI should say it: `image/jpg`, which metadata often has, is `image/jpeg`. */
const normal = (type: string) => (type === "image/jpg" ? "image/jpeg" : type);

/**
 * The image type of `bytes`: the gateway's, when it says image; else what
 * the first bytes are (PNG, JPEG, GIF, WebP, AVIF, SVG); else, when the
 * gateway didn't know what the file is, the type the metadata declares, if
 * that's an image. Undefined when nothing says image: a gateway that calls
 * it a web page isn't overruled by the metadata. Whatever the type, the page
 * shows it in an `<img>`, which runs no script and loads nothing, so a type
 * that's wrong only fails to draw.
 */
export function imageType(bytes: Uint8Array, header: string | null, declared?: string): string | undefined {
  const given = header?.split(";")[0]?.trim().toLowerCase();
  if (given && IMAGE_TYPE.test(given)) return normal(given);
  const sniffed = sniff(bytes);
  if (sniffed) return sniffed;
  if (!GENERIC_TYPE.has(given ?? "")) return undefined;
  const meta = declared?.trim().toLowerCase();
  return meta && IMAGE_TYPE.test(meta) ? normal(meta) : undefined;
}

function sniff(b: Uint8Array): string | undefined {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12))) return "image/avif";
  const head = new TextDecoder().decode(b.subarray(0, 512)).replace(/^﻿/, "").trimStart();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  return undefined;
}

/** Bytes as base64, a piece at a time: spreading 10 MB into one call would overflow the stack. */
export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
