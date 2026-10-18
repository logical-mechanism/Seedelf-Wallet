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
// Where they're found:
// - **The data layer** (mainnet), at most every REFRESH_MS: its list of every
//   shown pool, each verified here again. It can leave a pool out, never make
//   one look real.
// - **Koios** (preprod, or while the data layer can't answer), when the
//   Lovejoin page opens: the holder's outputs since the last look, each
//   candidate's launch transaction, read in batches.
// - **The bundled head start** (`src/lovejoin-pools.json`, written at each
//   release by `npm run lovejoin-pools`): every pool shown then, and the
//   height looked to, so a new device's first look starts there.
//
// Kept on the device, unsealed (`seedelf.lovejoinPools.<network>`): every
// standard pool found and the height Koios was read to. The same for every
// wallet, but its time shows when the wallet last looked. Deleted with the
// wallet (wallet.ts's reset clears local storage but for what it keeps).

import tokenList from "../tokens/list.json";
import bundled from "../lovejoin-pools.json";
import type { NetworkName } from "../networks";
import type { TokenQuantity } from "../shared/rpc";
import type { Koios, KoiosUtxo } from "./koios";
import type { PoolRef } from "./lovejoin";
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

export interface Kept {
  /** Koios's holder read to this block. */
  height: number;
  pools: FoundPool[];
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

  constructor(private readonly deps: DiscoveryDeps) {}

  /** Every pool shown on `network` that the wallet knows of, in launch order: no request. */
  async known(network: NetworkName): Promise<FoundPool[]> {
    const { pools } = await this.kept(network);
    return shown(pools);
  }

  /** The data layer's crowds, as its last list counted them; none on Koios. */
  crowdsOf(network: NetworkName): ReadonlyMap<string, IndexCrowd> | undefined {
    return this.crowds.get(network);
  }

  private async kept(network: NetworkName): Promise<Kept> {
    const head = this.deps.headStart?.(network) ?? (bundled as unknown as Record<NetworkName, Kept>)[network] ?? { height: 0, pools: [] };
    const stored = await this.deps.local.get<Kept>(key(network));
    const pools = new Map<string, FoundPool>();
    for (const p of [...head.pools, ...(stored?.pools ?? [])]) pools.set(refOf(p.ref.reference), p);
    return { height: Math.max(head.height, stored?.height ?? 0), pools: [...pools.values()] };
  }

  private async keep(network: NetworkName, found: FoundPool[], height?: number): Promise<void> {
    const was = await this.kept(network);
    const known = new Set(was.pools.map((p) => refOf(p.ref.reference)));
    const fresh = found.filter((p) => !known.has(refOf(p.ref.reference)));
    if (!fresh.length && (height === undefined || height <= was.height)) return;
    await this.deps.local.set(key(network), { height: Math.max(was.height, height ?? 0), pools: [...was.pools, ...fresh.map(slim)] });
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
    const at = this.deps.now();
    const last = this.asked.get(network);
    if (last !== undefined && at >= last && at - last < REFRESH_MS) return;
    this.asked.set(network, at);
    const index = await this.deps.index?.(network);
    if (!index) return;
    let answer: IndexPools;
    try {
      answer = await index.pools();
    } catch (e) {
      if (e instanceof IndexDown) return;
      throw e;
    }
    this.answered.set(network, at);
    const found: FoundPool[] = [];
    for (const p of answer.pools) {
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

/** Whether a row at the holder holds one token named `lovejoin`, and ADA: a candidate. */
function holdsNft(r: KoiosUtxo): boolean {
  const [nft, ...rest] = r.asset_list ?? [];
  return !rest.length && nft?.asset_name === NFT_NAME && nft.quantity === "1" && !r.reference_script && !!r.inline_datum;
}

const refOf = (u: Pick<KoiosUtxo, "tx_hash" | "tx_index">) => `${u.tx_hash}#${u.tx_index}`;

/** A pool as kept: its scripts named by their hashes alone, which WebAssembly fills in from its own derivation. */
function slim(p: FoundPool): FoundPool {
  const scripts = p.ref.scripts?.map((s) => ({
    ...s,
    reference_script: s.reference_script ? { ...s.reference_script, bytes: null } : s.reference_script,
  }));
  return { ...p, ref: { ...p.ref, ...(scripts ? { scripts } : {}) } };
}
