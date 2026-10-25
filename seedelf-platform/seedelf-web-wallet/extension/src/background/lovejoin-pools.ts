// Lovejoin's token pools, found (chunk 34's 34c): which pools the wallet
// reads beside the classic pool. Every launch puts its reference UTxO at
// Lovejoin's holder, which takes no parameters, so the holder is the index,
// and every wallet reads the same pools: no read names a pool of anyone's.
//
// A pool is shown when it's standard and the earliest launched of its values
// (the box's ADA and its token). Standard means genuine (its seed among its
// launch's inputs makes its NFT, and the datum names exactly the scripts that
// seed makes: WebAssembly derives them from the bundled templates), of a
// token in the wallet's list or of ADA at any amount but the classic pool's
// 10 ₳, and finished by its launch: the launch transaction puts `mix_box` and
// `mix_logic` at the holder and registers L, unless an earlier block did
// (the owner, 2026-10-17). None of it can change once it's on chain, so a pool
// shown stays shown, and a copy never is.
//
// A device can still learn of an earlier launch late: the data layer left it
// out, or Koios didn't know its launch yet. So a pool `known` has handed over
// stays in it for good on that device, beside the earlier one, and the
// wallet's boxes in it never drop out of view: the read set only grows
// (session 1, 11; 1.6.0's release review, STATE-2). Such a pool is a copy
// from then on: read for the boxes already in it, taking no new box, for good
// (decision 30). Every other copy a device keeps, standard but left out by the
// rule, is read once for the wallet's boxes, the first pool read after it's
// found: so a restore, whose record Remove wallet deleted, finds what the
// wallet put in one before (the merged fixes' review, MERGED-1). Which copy
// holds them is the wallet's to know: the Lovejoin service keeps it sealed,
// and reads it from then on. Here, only that each copy was read, as on every
// device that found it (round two's review, R2-4).
//
// Where they're found:
// - **The data layer** (mainnet), at most every REFRESH_MS: its list of every
//   shown pool, each verified here again. It can leave a pool out, never pass
//   off other scripts as a pool's. Verified offline, a pool may still not be
//   on chain (a seed no launch spent verifies as well), so the ledger is the
//   judge of that: every transaction into a token pool reads its reference
//   UTxO, a deposit too (1.6.0's release review, 317-wallet#0).
// - **Koios** (preprod, or while the data layer can't answer), when the
//   Lovejoin page opens: the holder's outputs since the last look, each
//   candidate's launch transaction, read in batches.
// - **The bundled head start** (`src/lovejoin-pools.json`, written at each
//   release by `npm run lovejoin-pools`, from the holder's start under that
//   release's token list): every pool shown then, and the height looked to,
//   so a new device's first look starts there. So does the next look of a
//   device whose token list changed with an update: a pool refused as
//   unlisted is looked at again (STATE-4).
//
// Kept on the device, unsealed (`seedelf.lovejoinPools.<network>`): every
// standard pool found, those handed over, the copies read once, the height
// Koios was read to and the token list it was read under. The same for every wallet with the same
// history, but its time shows when the wallet last looked. Deleted with the
// wallet (wallet.ts's reset clears local storage but for what it keeps).

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import tokenList from "../tokens/list.json";
import bundled from "../lovejoin-pools.json";
import type { NetworkName } from "../networks";
import type { TokenQuantity } from "../shared/rpc";
import type { Koios, KoiosUtxo } from "./koios";
import type { LovejoinDeps, PoolRef } from "./lovejoin";
import { IndexDown, type IndexCrowd, type IndexPools, type PrivateIndex, utxoOf } from "./private-index";
import type { Area } from "./storage";
import { isTrap } from "./wasm";

/** `reference_holder`'s hash: every launch's reference UTxO sits at it for good. */
export const HOLDER = "288fea77a0f674c6080aadd8ed3ca42cd5a920bf1f00c0d3e63306e4";

/** The NFT's name, ASCII `lovejoin`: the only one `one_shot_mint` allows. */
export const LOVEJOIN_NFT = "6c6f76656a6f696e";
const NFT_NAME = LOVEJOIN_NFT;

/** The classic pool's box: an ADA pool on the new scripts at this value is a copy of its, never shown. */
const CLASSIC_LOVELACE = "10000000";

/** How often the data layer's list is asked for: it's the same for every wallet, and moves every 200 slots at most. */
export const REFRESH_MS = 5 * 60_000;

/** Blocks read again at each look at Koios, below where the last stopped. */
const RESCAN_BLOCKS = 20;

/**
 * How old a launch's block must be before a look takes it (ms): about 30
 * blocks, as the data layer reads from 200 slots back at least. A launch
 * rolled back, or made again in another block, isn't taken where it was.
 */
export const SETTLE_MS = 10 * 60_000;

/** A pool's values: what a copy has the same of. */
export interface PoolValues {
  boxLovelace: string;
  token?: TokenQuantity;
}

/** A standard pool as the wallet keeps it: what WebAssembly verifies it from, its values, and where its launch is. */
export interface FoundPool extends PoolValues {
  /** Its NFT's policy. */
  id: string;
  ref: PoolRef;
  launch: { block: number; index: number; tx: string };
}

/**
 * A pool `known` hands over: `copy`, one the rule leaves out, as an earlier launch of its values is kept too. It's read
 * for the boxes already in it and takes no new box, for good (decision 30; the merged fixes' review, MERGED-1). Never
 * kept with the flag: it's the rule's to say at each hand-over.
 */
export interface HandedPool extends FoundPool {
  copy?: true;
}

export interface Kept {
  /** Koios's holder read to this block. */
  height: number;
  pools: FoundPool[];
  /**
   * The token list `height` was read under (`listFingerprint`). A head start's is checked against the list it's
   * bundled with; a device's sends its next look back to the head start when they differ (STATE-4).
   */
  listed?: string;
}

/** What a device keeps on a network beside the head start. */
interface Stored extends Kept {
  /** Each pool `known` has handed over, by reference UTxO: in the read set for good (STATE-2). */
  shown?: string[];
  /**
   * Each copy a pool read has read once for the wallet's boxes, by reference UTxO (`copiesRead`): never read so again
   * on this device, unless Remove wallet deletes the record (MERGED-1). Never which held them (R2-4).
   */
  checked?: string[];
}

/** What's kept, the head start's and the device's together. */
interface Merged extends Kept {
  /** Handed over on this device. */
  shown: ReadonlySet<string>;
  /** The copies read once on this device. */
  checked: ReadonlySet<string>;
  /** The token list in force (`listFingerprint`). */
  listed: string;
  /** The device's own record, as it is: none before its first look, or once Remove wallet deleted it. */
  stored?: Stored;
}

/** Where the pools found on a network are kept: wallet.ts's LOCAL_CACHES, which Remove wallet deletes, names each. */
export const LOCAL_LOVEJOIN_POOLS_PREFIX = "seedelf.lovejoinPools.";

const key = (network: NetworkName) => `${LOCAL_LOVEJOIN_POOLS_PREFIX}${network}`;

/** The scenarios' order, and the server's: block, then place in the block, then id. */
function earlier(a: FoundPool, b: FoundPool): boolean {
  if (a.launch.block !== b.launch.block) return a.launch.block < b.launch.block;
  if (a.launch.index !== b.launch.index) return a.launch.index < b.launch.index;
  return a.id < b.id;
}

const valuesOf = (p: PoolValues) =>
  JSON.stringify([p.boxLovelace, p.token ? [p.token.policyId, p.token.assetName, p.token.quantity] : null]);

/**
 * Of `pools`, all standard, the earliest launched of each value, in the order
 * they were launched (tests/fixtures/lovejoin-shown.json, which the data
 * layer's own copy of this rule is held to too).
 */
export function shown(pools: FoundPool[]): FoundPool[] {
  const first = new Map<string, FoundPool>();
  for (const p of pools) {
    const kept = first.get(valuesOf(p));
    if (!kept || earlier(p, kept)) first.set(valuesOf(p), p);
  }
  return [...first.values()].sort((a, b) => (earlier(a, b) ? -1 : earlier(b, a) ? 1 : 0));
}

/** The tokens whose pools are shown, by policy and name (round three, 20). */
const LISTED: Record<NetworkName, ReadonlySet<string>> = {
  preprod: new Set(tokenList.preprod.map((t) => t.policy + t.name)),
  mainnet: new Set(tokenList.mainnet.map((t) => t.policy + t.name)),
};

/** Whether a token (its policy and name, hex) is in the wallet's list on `network`: only such a token has pools. */
export const isListed = (network: NetworkName, policyId: string, assetName: string) => LISTED[network].has(policyId + assetName);

/**
 * A token list's fingerprint: SHA-256 of its units, sorted, cut to 16 hex. A
 * look's height holds only under the list it was read under, as a candidate
 * of a token not listed then was looked past (STATE-4).
 */
export function listFingerprint(network: NetworkName, listed: ReadonlySet<string> = LISTED[network]): string {
  return bytesToHex(sha256(new TextEncoder().encode([...listed].sort().join("\n")))).slice(0, 16);
}

/**
 * Of `pools`, those shown on a device: the rule's (`shown`), and those it handed over already, in launch order. One of
 * those the rule leaves out is a copy now: an earlier launch of its values turned up after it was handed over.
 */
function handedOf(pools: FoundPool[], handed: ReadonlySet<string>): HandedPool[] {
  const rule = shown(pools);
  const copies = pools.filter((p) => handed.has(refOf(p.ref.reference)) && !rule.includes(p)).map((p) => ({ ...p, copy: true as const }));
  return [...rule, ...copies].sort((a, b) => (earlier(a, b) ? -1 : earlier(b, a) ? 1 : 0));
}

/** What a write of the device's record keeps of it as it was: the pools handed over, the copies read, and its list. */
const keptOf = (was: Merged) => ({
  shown: [...was.shown],
  ...(was.checked.size ? { checked: [...was.checked] } : {}),
});

/** What WebAssembly answers about a pool (`lovejoin::PoolView`), as discovery reads it. */
interface PoolView {
  id: string;
  boxLovelace: string;
  token?: TokenQuantity;
  scriptsInline: number;
  seed?: { txHash: string; txIndex: number };
}

interface CandidateView {
  id: string;
  boxLovelace: string;
  token?: TokenQuantity;
  mixBoxHash: string;
  mixLogicHash: string;
}

type DiscoveryWasm = {
  lovejoinCandidate(request: string): string;
  lovejoinLaunchCheck(request: string): string;
  lovejoinVerifyPool(request: string): string;
};

export interface DiscoveryDeps {
  local: Area;
  wasm: DiscoveryWasm;
  koios: (network: NetworkName) => Pick<Koios, "koiosAlone">;
  /** The private index on `network`, when it's to be read now (private-index.ts). */
  index?: (network: NetworkName) => Promise<PrivateIndex | undefined>;
  now: () => number;
  /** The tokens whose pools are shown: the wallet's list unless a test names others. */
  listed?: (network: NetworkName) => ReadonlySet<string>;
  /** Where a device starts: the bundled head start unless a test gives another. */
  headStart?: (network: NetworkName) => Kept;
}

/** A WebAssembly call's answer, or undefined for why a pool isn't one; a trap is thrown. */
function tried<T>(call: () => string): T | undefined {
  try {
    return JSON.parse(call()) as T;
  } catch (e) {
    if (isTrap(e)) throw e;
    return undefined;
  }
}

export class PoolDiscovery {
  /** When the data layer was last asked, by network. */
  private asked = new Map<NetworkName, number>();
  /** When it last answered, by network. */
  private answered = new Map<NetworkName, number>();
  /** Its last answer's crowds, by pool (CLASSIC's under "classic"): the Lovejoin page's (34f). */
  private crowds = new Map<NetworkName, Map<string, IndexCrowd>>();
  /** A look at Koios under way, by network: the page opening twice looks once. */
  private looking = new Map<NetworkName, Promise<void>>();
  /**
   * The last write of what's kept, by network: each reads what's kept and writes it again, so they go one at a time.
   * A refresh and a look finishing together would each write over the other's pools or height (1.6.0's release
   * review, state.md's notes).
   */
  private writing = new Map<NetworkName, Promise<unknown>>();

  constructor(private readonly deps: DiscoveryDeps) {}

  /**
   * Every pool shown on `network` that the wallet knows of, in launch order: no request. The rule's, and every pool
   * handed over before, which is kept as handed over before it's returned: an earlier launch of its values found
   * later never takes it out of the read set, where the wallet may hold boxes (STATE-2).
   */
  async known(network: NetworkName): Promise<HandedPool[]> {
    const was = await this.kept(network);
    const pools = handedOf(was.pools, was.shown);
    if (pools.every((p) => was.shown.has(refOf(p.ref.reference)))) return pools;
    return this.serially(network, async () => {
      const now = await this.kept(network);
      const handed = handedOf(now.pools, now.shown);
      // The head start's pools go into the device's record too, so a later release's head start can't take one away.
      // The look's height and list stay as they were: handing over isn't looking.
      const stored: Stored = {
        height: now.stored?.height ?? 0,
        ...(now.stored?.listed !== undefined ? { listed: now.stored.listed } : {}),
        pools: now.pools.map(slim),
        ...keptOf(now),
        shown: [...new Set([...now.shown, ...handed.map((p) => refOf(p.ref.reference))])],
      };
      await this.deps.local.set(key(network), stored);
      return handed;
    });
  }

  /**
   * The copies kept on `network` that this device hasn't read for the wallet's boxes yet: every standard pool found
   * that the rule leaves out, as an earlier launch of its values is kept too, and that's neither handed over nor read
   * once. The same for every device that found the same pools, so reading them names no pool of the wallet's. The next
   * pool read lists them once beside the pools it reads, and says what it found (`copiesRead`). No request (MERGED-1).
   */
  async copiesUnread(network: NetworkName): Promise<FoundPool[]> {
    const was = await this.kept(network);
    const rule = shown(was.pools);
    return was.pools.filter((p) => !rule.includes(p) && !was.shown.has(refOf(p.ref.reference)) && !was.checked.has(refOf(p.ref.reference)));
  }

  /**
   * A pool read read the copies of `read` (each by reference UTxO) once: none of them is read so again (MERGED-1).
   * Those it found the wallet's boxes in are the service's to keep, sealed, and read (lovejoin.ts `copies`): this
   * record says only that each was read, the same for every device that found them (round two's review, R2-4).
   */
  copiesRead(network: NetworkName, read: string[]): Promise<void> {
    if (!read.length) return Promise.resolve();
    return this.serially(network, async () => {
      const now = await this.kept(network);
      const stored: Stored = {
        height: now.stored?.height ?? 0,
        ...(now.stored?.listed !== undefined ? { listed: now.stored.listed } : {}),
        pools: now.pools.map(slim),
        ...keptOf(now),
        checked: [...new Set([...now.checked, ...read])],
      };
      await this.deps.local.set(key(network), stored);
    });
  }

  /** Each pool kept on `network`'s launch transaction, by pool id: the hub's link, a copy's too. No request. */
  async launches(network: NetworkName): Promise<Map<string, string>> {
    return new Map((await this.kept(network)).pools.map((p) => [p.id, p.launch.tx]));
  }

  /** `work`, once every write of `network`'s record before it is done. */
  private serially<T>(network: NetworkName, work: () => Promise<T>): Promise<T> {
    const run = (this.writing.get(network) ?? Promise.resolve()).catch(() => undefined).then(work);
    this.writing.set(network, run);
    return run;
  }

  /** The data layer's crowds, as its last list counted them; none on Koios. */
  crowdsOf(network: NetworkName): ReadonlyMap<string, IndexCrowd> | undefined {
    return this.crowds.get(network);
  }

  private async kept(network: NetworkName): Promise<Merged> {
    const head = this.deps.headStart?.(network) ?? (bundled as unknown as Record<NetworkName, Kept>)[network] ?? { height: 0, pools: [] };
    const stored = await this.deps.local.get<Stored>(key(network));
    const pools = new Map<string, FoundPool>();
    for (const p of [...head.pools, ...(stored?.pools ?? [])]) pools.set(refOf(p.ref.reference), p);
    const listed = listFingerprint(network, this.deps.listed?.(network));
    // The device's height holds under the list it was read under. An update that lists another token sends the next
    // look back to the head start, which that release wrote from the holder's start under its own list: a candidate
    // refused as unlisted was looked past, and is looked at again (STATE-4).
    const height = stored?.listed === listed ? Math.max(head.height, stored.height) : head.height;
    // A copy both handed over and read once was handed over for the wallet's boxes by this round's earlier code, and
    // says, unsealed, where they are. It's taken as never read, so the next pool read reads it once again and the
    // service keeps it sealed, as now (round two's review, R2-4); the next write leaves it out of both. A pool STATE-2
    // handed over while it was the rule's was never read once, and stays handed over.
    const rule = new Set(shown([...pools.values()]).map((p) => refOf(p.ref.reference)));
    const earlierCode = new Set((stored?.shown ?? []).filter((r) => (stored?.checked ?? []).includes(r) && !rule.has(r)));
    return {
      height,
      pools: [...pools.values()],
      shown: new Set((stored?.shown ?? []).filter((r) => !earlierCode.has(r))),
      checked: new Set((stored?.checked ?? []).filter((r) => !earlierCode.has(r))),
      listed,
      ...(stored ? { stored } : {}),
    };
  }

  private keep(network: NetworkName, found: FoundPool[], height?: number): Promise<void> {
    return this.serially(network, async () => {
      const was = await this.kept(network);
      const known = new Set(was.pools.map((p) => refOf(p.ref.reference)));
      const fresh = found.filter((p) => !known.has(refOf(p.ref.reference)));
      const to = Math.max(was.height, height ?? 0);
      if (!fresh.length && to === was.height && was.stored?.listed === was.listed) return;
      const stored: Stored = { height: to, listed: was.listed, pools: [...was.pools, ...fresh.map(slim)], ...keptOf(was) };
      await this.deps.local.set(key(network), stored);
    });
  }

  /**
   * Looks for pools launched since the wallet last did (the Lovejoin page, as
   * it opens): the data layer's list where it answers, or answered within
   * REFRESH_MS; Koios's holder otherwise.
   */
  async look(network: NetworkName): Promise<void> {
    await this.refresh(network);
    const answered = this.answered.get(network);
    const at = this.deps.now();
    if (answered !== undefined && at >= answered && at - answered < REFRESH_MS) return;
    await this.scan(network);
  }

  /**
   * The data layer's list, at most every REFRESH_MS on a network: every pool
   * it shows, verified here again, kept. Nothing when the network has no data
   * layer, or it can't answer.
   */
  async refresh(network: NetworkName): Promise<void> {
    // The data layer's crowds go with it: with Settings' Koios-only on, or the data layer marked down, the hub showed
    // its last counts until the worker restarted, where Koios's crowd line is boxes alone. Asks no one, and holds at
    // the next pool read, the five minutes or not (1.6.0's release review, UI-9).
    if (!(await this.deps.index?.(network))) this.crowds.delete(network);
    const at = this.deps.now();
    const last = this.asked.get(network);
    if (last !== undefined && at >= last && at - last < REFRESH_MS) {
      // An answer is always kept with the list it was read under (keep's first write), so a record without one since is
      // Remove wallet's (or `known`'s, after it): a wallet restored at once reads its token pools now, not five minutes
      // later (1.6.0's release review, state.md's notes). A refusal keeps nothing, so the five minutes hold for it.
      if (!this.answered.has(network) || (await this.deps.local.get<Stored>(key(network)))?.listed !== undefined) return;
      this.answered.delete(network);
    }
    this.asked.set(network, at);
    const index = await this.deps.index?.(network);
    if (!index) return;
    let answer: IndexPools;
    try {
      answer = await index.pools();
    } catch (e) {
      // Its list refused or unread: its crowds aren't the pools' now (UI-9).
      if (e instanceof IndexDown) {
        this.crowds.delete(network);
        return;
      }
      throw e;
    }
    this.answered.set(network, at);
    const found: FoundPool[] = [];
    for (const p of answer.pools) {
      // A launch puts the reference UTxO and both scripts at the holder in one transaction, the one listed as its
      // launch: a list saying otherwise contradicts itself, and isn't built on. That the pool is on chain at all, the
      // ledger checks: every transaction into a token pool reads its reference UTxO, a deposit too (1.6.0's release
      // review, 317-wallet#0).
      const launched = txOf(p.reference.ref);
      if (p.launch.tx !== launched || p.scripts.some((s) => txOf(s.ref) !== launched)) continue;
      const [txHash, txIndex] = p.seed.split("#");
      const ref: PoolRef = {
        reference: utxoOf(p.reference, HOLDER, network),
        seed: { txHash: txHash!, txIndex: Number(txIndex) },
        scripts: p.scripts.map((s) => ({
          ...utxoOf(s, HOLDER, network),
          reference_script: { hash: s.script_hash, size: null, type: "plutusV3", bytes: null },
        })),
      };
      const pool = this.verified(network, ref, { block: p.launch.block, index: p.launch.index, tx: p.launch.tx });
      if (pool) found.push(pool);
    }
    this.crowds.set(network, new Map([["classic", answer.classic.crowd], ...answer.pools.map((p) => [p.id, p.crowd] as const)]));
    await this.keep(network, found);
  }

  /** `ref` verified here, if it's a pool of a listed token or ADA, its scripts at the holder. */
  private verified(network: NetworkName, ref: PoolRef, launch: FoundPool["launch"]): FoundPool | undefined {
    const view = tried<PoolView>(() => this.deps.wasm.lovejoinVerifyPool(JSON.stringify({ network, pool: ref })));
    if (!view || view.scriptsInline !== 0 || !this.listedValue(network, view)) return undefined;
    return { id: view.id, boxLovelace: view.boxLovelace, ...(view.token ? { token: view.token } : {}), ref, launch };
  }

  /** Whether a pool of these values may be shown: a listed token's, or an ADA pool's but at the classic pool's 10 ₳. */
  private listedValue(network: NetworkName, v: PoolValues): boolean {
    if (!v.token) return v.boxLovelace !== CLASSIC_LOVELACE;
    const listed = this.deps.listed?.(network) ?? LISTED[network];
    return listed.has(v.token.policyId + v.token.assetName);
  }

  /**
   * Koios's holder, from where the last look stopped (the Lovejoin page, as it
   * opens): every standard pool launched since, kept. A look that fails keeps
   * nothing of itself, and the next starts where this one did.
   */
  scan(network: NetworkName): Promise<void> {
    const running = this.looking.get(network);
    if (running) return running;
    const look = this.holder(network).finally(() => this.looking.delete(network));
    this.looking.set(network, look);
    return look;
  }

  private async holder(network: NetworkName): Promise<void> {
    const koios = this.deps.koios(network).koiosAlone();
    const was = await this.kept(network);
    const known = new Set(was.pools.map((p) => refOf(p.ref.reference)));
    const rows = await koios.credentialUtxos([HOLDER], Math.max(0, was.height - RESCAN_BLOCKS));
    // Read to the highest block the holder has an output in; a fold, as a spread over a long answer overflows.
    let height = rows.reduce((h, r) => Math.max(h, r.block_height ?? 0), was.height);
    // A launch too recent to be settled is taken at a later look: the height stops short of its block.
    const settled = (r: KoiosUtxo) => (r.block_time ?? Infinity) * 1000 <= this.deps.now() - SETTLE_MS;
    // The cheap checks first, offline: the shape, the datum, the token, and the two scripts its datum names at the
    // holder in the same transaction. Only what passes is worth a request.
    const byTx = new Map<string, KoiosUtxo[]>();
    for (const r of rows) byTx.set(r.tx_hash, [...(byTx.get(r.tx_hash) ?? []), r]);
    const candidates = rows.flatMap((r) => {
      if (known.has(refOf(r)) || !holdsNft(r)) return [];
      if (!settled(r)) {
        height = Math.min(height, (r.block_height ?? 1) - 1);
        return [];
      }
      const view = tried<CandidateView>(() => this.deps.wasm.lovejoinCandidate(JSON.stringify({ network, reference: r })));
      if (!view || !this.listedValue(network, view)) return [];
      const scripts = (byTx.get(r.tx_hash) ?? []).filter((s) => s.reference_script?.hash);
      const has = (hash: string) => scripts.some((s) => s.reference_script?.hash === hash);
      return has(view.mixBoxHash) && has(view.mixLogicHash) ? [{ row: r, scripts }] : [];
    });
    if (!candidates.length) return this.keep(network, [], height);
    const launches = new Map((await koios.launches([...new Set(candidates.map((c) => c.row.tx_hash))])).map((l) => [l.tx_hash, l]));
    const found: Array<{ pool: FoundPool; stake: string; registers: boolean; time: number }> = [];
    let upTo = height;
    for (const { row, scripts } of candidates) {
      const launch = launches.get(row.tx_hash);
      // Koios doesn't know its transaction yet: the next look starts no later than its block.
      if (!launch?.inputs) {
        upTo = Math.min(upTo, (row.block_height ?? 1) - 1);
        continue;
      }
      const inputs = launch.inputs.map((i) => ({ txHash: i.tx_hash, txIndex: i.tx_index }));
      const check = tried<{ pool: PoolView; mixLogicStake: string }>(() =>
        this.deps.wasm.lovejoinLaunchCheck(JSON.stringify({ network, reference: row, inputs, scripts })),
      );
      if (!check || check.pool.scriptsInline !== 0 || !check.pool.seed) continue;
      const ref: PoolRef = { reference: row, seed: check.pool.seed, scripts };
      const pool = this.verified(network, ref, { block: launch.block_height, index: launch.tx_block_index, tx: launch.tx_hash });
      if (!pool) continue;
      const registers = (launch.certificates ?? []).some(
        (c) => c.type === "stake_registration" && c.info?.stake_address === check.mixLogicStake,
      );
      found.push({ pool, stake: check.mixLogicStake, registers, time: launch.tx_timestamp });
    }
    // L not registered by its launch: standard only if an earlier block registered it.
    const ask = found.filter((f) => !f.registers).map((f) => f.stake);
    const first = ask.length ? await koios.firstRegistrations(ask) : new Map<string, number>();
    const standard = found.filter((f) => f.registers || (first.get(f.stake) ?? Infinity) < f.time).map((f) => f.pool);
    await this.keep(network, standard, upTo);
  }
}

/**
 * What the Lovejoin service reads of discovery (sw.ts; here so the tests wire it as the worker does). The pools handed
 * over, each copy named one (`{ copy }`, apart from its PoolRef, which goes to WebAssembly as it is): at a pool read
 * after the data layer's list, asking nobody otherwise. And the copies a pool read reads once, and that it read them
 * (MERGED-1; which held the wallet's boxes the service keeps sealed, R2-4).
 */
export function serviceDeps(discovery: PoolDiscovery): Required<Pick<LovejoinDeps, "pools" | "known" | "copies" | "copiesRead">> {
  const handed = async (network: NetworkName) => (await discovery.known(network)).map((p) => (p.copy ? { copy: p.ref } : p.ref));
  return {
    // The data layer's list failing is no pool gone: what was found before is read. A trap isn't swallowed.
    pools: async (network) => {
      await discovery.refresh(network).catch((e: unknown) => {
        if (isTrap(e)) throw e;
      });
      return handed(network);
    },
    // What discovery kept, asking nobody: a swap's quote as the user types, and a return's first look.
    known: handed,
    copies: async (network) => (await discovery.copiesUnread(network)).map((p) => p.ref),
    copiesRead: (network, read) =>
      discovery.copiesRead(
        network,
        read.map((r) => refOf(r.reference)),
      ),
  };
}

/** Whether a row at the holder holds one token named `lovejoin`, and ADA: a candidate. */
function holdsNft(r: KoiosUtxo): boolean {
  const [nft, ...rest] = r.asset_list ?? [];
  return !rest.length && nft?.asset_name === NFT_NAME && nft.quantity === "1" && !r.reference_script && !!r.inline_datum;
}

const refOf = (u: Pick<KoiosUtxo, "tx_hash" | "tx_index">) => `${u.tx_hash}#${u.tx_index}`;

/** The transaction of an index row's `<tx hash>#<index>`. */
const txOf = (ref: string) => ref.slice(0, ref.lastIndexOf("#"));

/** A pool as kept: its scripts named by their hashes alone, which WebAssembly fills in from its own derivation. */
function slim(p: FoundPool): FoundPool {
  const scripts = p.ref.scripts?.map((s) => ({
    ...s,
    reference_script: s.reference_script ? { ...s.reference_script, bytes: null } : s.reference_script,
  }));
  return { ...p, ref: { ...p.ref, ...(scripts ? { scripts } : {}) } };
}
