// Lovejoin's pools as the screens show them (chunk 34's 34f): what a box
// holds, in words; every pool the wallet reads, the classic pool among them;
// and the hub's order, grouped by token (session 1, 13): ADA first, then the
// tokens the wallet holds, known without a read, then the most used, counted
// as boxes not the wallet's. Each pool shows its own numbers and none is
// called the top one, since parked boxes can buy rank.

import { t } from "../i18n";
import type { NetworkName } from "../networks";
import type { LovejoinCrowd, LovejoinPoolStatus, LovejoinStatus, TokenAmount, TokenQuantity } from "../shared/rpc";
import { formatAda, tokenKey } from "./format";
import { assetFingerprint, tokenInfo, tokenQuantity, tokenText } from "./tokens";

/** What one box holds: its ADA, and a token pool's token. */
export interface BoxValue {
  lovelace: string;
  token?: TokenQuantity;
}

/**
 * A pool as the screens read it: a token pool's status, or the classic
 * pool's, made from LovejoinStatus's own fields. `id` none: the classic pool,
 * as every request names it.
 */
export interface ShownPool extends Omit<LovejoinPoolStatus, "id"> {
  id?: string;
}

/**
 * The classic pool's id where a request must name it, as the worker names it (lovejoin.ts CLASSIC): bringing back one
 * of its boxes from its own page, never another pool's.
 */
export const CLASSIC_ID = "classic";

/** The classic pool's box: 10 ₳, ADA alone. */
export const CLASSIC_BOX: BoxValue = { lovelace: "10000000" };

/**
 * What a box holds, in words: "10 ₳" for the classic pool, as every string
 * that said "10 ₳" says it still (backward compatibility 7); "25 ₳" for an
 * ADA pool at another amount; "100 NIGHT + 4.5 ₳" for a token pool, its token
 * in its own units and named as every view names it.
 */
export function boxText(network: NetworkName, box: BoxValue): string {
  const ada = formatAda(box.lovelace);
  if (!box.token) return t("lovejoin.box.ada", { ada });
  return t("lovejoin.box.token", { quantity: tokenQuantity(network, box.token), token: tokenText(network, box.token).label, ada });
}

/** Every pool the wallet read: the classic pool first, then each token pool, in the worker's order. */
export function poolsOf(status: LovejoinStatus | undefined): ShownPool[] {
  if (!status?.available) return [];
  const classic: ShownPool = {
    box: CLASSIC_BOX,
    others: status.others,
    free: status.free ?? status.others,
    floor: status.floor,
    boxes: status.boxes,
    lovelace: status.lovelace,
    due: status.due,
    notMixed: status.notMixed,
    ...(status.unsure ? { unsure: status.unsure } : {}),
    ...(status.deposits ? { deposits: status.deposits } : {}),
    fromPublic: status.fromPublic,
    ...(status.otherAccounts ? { otherAccounts: status.otherAccounts } : {}),
    ...(status.bootstrap ? { bootstrap: status.bootstrap } : {}),
    ...(status.crowd ? { crowd: status.crowd } : {}),
  };
  return [classic, ...(status.pools ?? [])];
}

/** The pool named `id` (none: the classic pool) among those read. */
export const poolNamed = (pools: ShownPool[], id: string | undefined) => pools.find((p) => p.id === id);

/** A copy of an earlier pool's values (`superseded`): read for the boxes already in it, and taking no new one, for good. */
export const isCopy = (p: Pick<ShownPool, "unusable">) => p.unusable?.why === "superseded";

/**
 * Whether the hub lists pool `p` to open: every pool the wallet reads, but a copy while the wallet has nothing in it.
 * There it only stood beside the earlier pool of its values, a second row of the same box with nothing to do on its
 * page; while the wallet's boxes are in it, it's listed, flagged, for them (the merged fixes' review, MERGED-1).
 */
export const shownOnHub = (p: ShownPool) => !isCopy(p) || p.boxes.length > 0 || (p.bootstrap?.length ?? 0) > 0;

/** A pool's token's unit, policy then name, as a balance's token key; none for an ADA pool. */
const unitOf = (box: BoxValue) => (box.token ? tokenKey(box.token) : undefined);

/** One token's pools on the hub: ADA's (`token` none) or a token's. */
export interface PoolGroup {
  /** The token's key (`tokenKey`), or "ada". */
  key: string;
  token?: { policyId: string; assetName: string };
  pools: ShownPool[];
  /** The wallet holds some of this token, in either balance. */
  held: boolean;
}

/** The boxes in pool `p` that aren't the wallet's: what the floor counts, and the hub's "most used". */
const othersOf = (p: ShownPool) => p.others;

/**
 * The hub's groups (session 1, 13): ADA's pools first, then the tokens the
 * wallet holds (`holdings`, both balances' tokens), then the rest, each set
 * by the boxes not the wallet's in all of its pools, most first. Within a
 * group, the most used pool first, then the smaller box.
 */
export function groupPools(pools: ShownPool[], holdings: TokenAmount[]): PoolGroup[] {
  const held = new Set(holdings.filter((t) => BigInt(t.quantity) > 0n).map(tokenKey));
  const groups = new Map<string, PoolGroup>();
  for (const p of pools) {
    const key = unitOf(p.box) ?? "ada";
    const group = groups.get(key) ?? {
      key,
      ...(p.box.token ? { token: { policyId: p.box.token.policyId, assetName: p.box.token.assetName } } : {}),
      pools: [],
      held: key !== "ada" && held.has(key),
    };
    group.pools.push(p);
    groups.set(key, group);
  }
  const used = (g: PoolGroup) => g.pools.reduce((sum, p) => sum + othersOf(p), 0);
  for (const g of groups.values()) {
    g.pools.sort((a, b) => othersOf(b) - othersOf(a) || cmp(BigInt(a.box.lovelace), BigInt(b.box.lovelace)) || cmp(quantity(a), quantity(b)));
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === "ada" || b.key === "ada") return a.key === "ada" ? -1 : 1;
    if (a.held !== b.held) return a.held ? -1 : 1;
    return used(b) - used(a);
  });
}

const quantity = (p: ShownPool) => BigInt(p.box.token?.quantity ?? "0");
const cmp = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The groups whose token matches `query`, as the hub's search finds them
 * (session 1, 13): by ticker or name, as the wallet's list has them, by
 * policy ID (from its start, at least 4 characters), or by fingerprint.
 * ADA's matches "ADA" and "₳". Nothing typed: all of them.
 */
export function searchGroups(network: NetworkName, groups: PoolGroup[], query: string): PoolGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups.filter((g) => {
    if (!g.token) return "ada".startsWith(q) || q === "₳" || "cardano".startsWith(q);
    const info = tokenInfo(network, g.token);
    const label = tokenText(network, g.token).label.toLowerCase();
    if (label.includes(q) || info?.ticker.toLowerCase().includes(q) || info?.name.toLowerCase().includes(q)) return true;
    if (q.length >= 4 && g.token.policyId.startsWith(q)) return true;
    return q.startsWith("asset1") && assetFingerprint(g.token).startsWith(q);
  });
}

/**
 * A pool's crowd in a line (session 1, 16; 34c, 31): the boxes not the
 * wallet's, which the floor counts, and, where the data layer counted them,
 * the deposits the pool's boxes could have come from, and "none mixed yet"
 * while no mix has made any. On Koios the boxes alone. Only the boxes not the
 * wallet's are counted: with the data layer's own count beside them, the
 * difference would give the wallet's boxes away while balances are hidden
 * (privacy review §2.16).
 */
export function crowdText(p: { others: number; crowd?: LovejoinCrowd }): string {
  const boxes = t("lovejoin.crowd.boxes", { count: p.others });
  if (!p.crowd) return boxes;
  const deposits = t("lovejoin.crowd.deposits", { count: p.crowd.deposits });
  return p.crowd.mixed === 0 && p.crowd.boxes > 0
    ? t("lovejoin.crowd.withDepositsUnmixed", { boxes, deposits })
    : t("lovejoin.crowd.withDeposits", { boxes, deposits });
}

/** A pool short of its floor: how far its bootstrap has got, as a share of the floor (session 1, 16). */
export function bootstrapProgress(p: { others: number; floor: number }): { have: number; floor: number; percent: number } | undefined {
  if (!p.floor || p.others >= p.floor) return undefined;
  return { have: p.others, floor: p.floor, percent: Math.round((p.others / p.floor) * 100) };
}
