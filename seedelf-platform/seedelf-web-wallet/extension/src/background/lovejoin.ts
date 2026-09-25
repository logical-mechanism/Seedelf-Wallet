// Lovejoin, the mixer, in the worker (roadmap chunk 16).
//
// A private session's spare ADA goes through Lovejoin on its way back.
// sessions.ts asks here for the chain: WebAssembly builds all of it before
// any of it is sent (the deposit, each box fanned out, then the return),
// measured against the deployed scripts and signed with the session's key.
// sessions.ts sends it in order, each transaction on the one before's change.
//
// The boxes come back later, each on its own, after a random delay (the
// settings' range). At the first unlock after it (or the next minute's alarm
// while unlocked), a box of ours in the pool is withdrawn into a fresh
// register, paid from itself, with giveme.my's collateral: nothing ties it to
// the session. Boxes aren't remembered, they're found: other people's mixes
// move them, and the Seedelf key's check finds them wherever they are, after a
// restore too. Only the due times are kept, sealed (`lovejoin.<network>`).
//
// Before a chain is used, Koios's Ogmios measures its first mix, given the
// unsent deposit as extra UTxOs: the check that the wallet's evaluator costs
// scripts as the network does (a hard fork can change that). If it doesn't,
// the chain doesn't start: a session's return comes back directly instead,
// and says why.
//
// The Lovejoin tile mixes too, without a session to return: from the private
// balance through a one-time account (sessions.ts's mix sessions), or from
// the public account straight in (here): its deposit and mixes, paid by the
// account and put up against its collateral, the change left in it.
//
// Koios requests: one pool read and one evaluate for a chain; one pool read
// at each unlock, only on a wallet that has used Lovejoin here (a restored
// wallet finds its boxes when the Lovejoin tile opens); a withdraw is
// giveme.my plus one submit.

import type { LovejoinDelay, LovejoinDepth } from "../shared/preferences";
import type { NetworkName } from "../networks";
import type { LovejoinFunding, LovejoinHeld, LovejoinPublicSummary, LovejoinStatus, PendingTx, TokenQuantity } from "../shared/rpc";
import { nothingInAccount, readAccount } from "./account";
import { SpentInputError, type KoiosUtxo } from "./koios";
import { SESSION_PENDING } from "./pending";
import type { PreferencesService } from "./preferences";
import type { PrivateStore } from "./private-store";
import type { ScriptSpendDeps } from "./script-spend";
import { rememberSpent, spentSet, unspent } from "./spent";
import { SESSION_BALANCES_PREFIX } from "./wallet";

/** chrome.storage.session: a mix from the public account, built and signed, waiting for Send. */
export const SESSION_LOVEJOIN_PUBLIC = "seedelf.lovejoin.public";

/** A built mix is only sent within this long; after that, build again. */
const BUILT_TTL_MS = 10 * 60_000;

/** A chained transaction Koios refuses as spending what it hasn't seen: tried again this many times, waiting this much longer each time. */
export const CHAIN_RETRIES = 4;
export const CHAIN_RETRY_MS = 2_000;

/** The network measured a chain's scripts differently from the wallet: the chain doesn't start. */
export class LovejoinSkipped extends Error {
  constructor(readonly reason: string) {
    super(`Lovejoin was left out: ${reason}.`);
  }
}

/** Lovejoin's `mix_box` script hash: where every box sits. Preprod only, until Lovejoin launches on mainnet. */
export const LOVEJOIN_MIX_BOX: Partial<Record<NetworkName, string>> = {
  preprod: "67ffe4ed7f0ccd0a3e3069fddc26d9bccde3fe63d3d58c5e84f7ecc5",
};

/** Every box holds exactly this. */
export const LOVEJOIN_DENOM = 10_000_000n;

/** A chain as WebAssembly builds it (`lovejoin::ChainResult`). */
export interface LovejoinChain {
  txs: Array<{ kind: "deposit" | "mix" | "back"; txCbor: string; txHash: string; fee: string }>;
  boxes: number;
  depth: number;
  /** Every fee of the chain, the return's too. */
  fees: string;
  /**
   * What the return brings back at once: the change, the collateral and the
   * token UTxOs' ADA, less its fee. A public account's chain has no return:
   * the change that stays in the account.
   */
  returned: string;
  /** The tokens it brings back with them. */
  tokens: TokenQuantity[];
  /** How many of the funding's Seedelf UTxOs the return merged into. */
  merged: number;
  leaves: Array<{ txHash: string; txIndex: number }>;
}

/** What the review shows before a chain is built (`lovejoin::PlanResult`). */
export interface LovejoinPlan {
  boxes: number;
  spare: string;
  mixes: number;
  mixFees: string;
}

interface Schedule {
  /** When each box that's on its way back is due, in ms. */
  due: number[];
}

interface KeptPublic extends LovejoinPublicSummary {
  chain: LovejoinChain["txs"];
  builtAt: number;
}

export interface LovejoinDeps extends ScriptSpendDeps {
  store: PrivateStore;
  preferences: PreferencesService;
  /** In [0, 1): the delays' draw. Tests pin it. */
  random?: () => number;
}

const HOUR = 3_600_000;
const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

/** The mixes one box goes through, `depth` waves deep and three wide. */
export const mixesPerBox = (depth: number) => (3 ** depth - 1) / 2;

/** A delay range's bounds, in hours. */
export function delayHours(delay: LovejoinDelay): [number, number] {
  const [low, high] = delay.split("-").map(Number);
  return [low!, high!];
}

/** The most boxes one mix from the tile takes. */
export const MAX_MIX_BOXES = 10;

/** A whole number of boxes, one to MAX_MIX_BOXES, or why not. */
export function checkBoxes(boxes: number): void {
  if (!Number.isInteger(boxes) || boxes < 1 || boxes > MAX_MIX_BOXES) {
    throw new Error(`Mix 1 to ${MAX_MIX_BOXES} boxes at a time.`);
  }
}

export class LovejoinService {
  constructor(private readonly deps: LovejoinDeps) {}

  /** Whether Lovejoin is deployed on `network`. */
  available(network: NetworkName): boolean {
    return LOVEJOIN_MIX_BOX[network] !== undefined;
  }

  async settings(): Promise<{ depth: LovejoinDepth; delay: LovejoinDelay }> {
    const p = await this.deps.preferences.get();
    return { depth: p.lovejoinDepth, delay: p.lovejoinDelay };
  }

  /** The boxes in the pool, less any a sent transaction of ours spends. */
  async pool(network: NetworkName): Promise<KoiosUtxo[]> {
    const hash = LOVEJOIN_MIX_BOX[network];
    if (!hash) throw new Error("Lovejoin isn't on this network yet.");
    const { wallet, session } = this.deps;
    const [rows, spent] = await Promise.all([
      this.deps.koios(network).credentialUtxos([hash]),
      wallet.withKeys(() => spentSet(session)),
    ]);
    return unspent(rows, spent);
  }

  /** How many boxes session `index`'s `rows` pay for at the set depth. */
  async plan(network: NetworkName, index: number, rows: KoiosUtxo[], collateral: KoiosUtxo): Promise<LovejoinPlan> {
    const { depth } = await this.settings();
    const request = { network, index, utxos: rows, collateral: { txHash: collateral.tx_hash, txIndex: collateral.tx_index }, depth };
    return this.deps.wallet.withKeys(
      (keys) => JSON.parse(this.deps.wasm.planLovejoin(keys.oneTime, JSON.stringify(request))) as LovejoinPlan,
    );
  }

  /**
   * Whether the pool has enough other boxes to mix `boxes` boxes at the set
   * depth with (a pool read), or why not: checked before a mix is funded.
   */
  async fits(network: NetworkName, boxes: number): Promise<void> {
    const { depth } = await this.settings();
    const needed = boxes * mixesPerBox(depth) * 2;
    const pool = (await this.pool(network)).length;
    if (pool < needed) {
      throw new Error(
        `Lovejoin's pool has ${pool} boxes to mix with, and ${boxes === 1 ? "a box" : `${boxes} boxes`} ${depth} ${depth === 1 ? "wave" : "waves"} deep ${boxes === 1 ? "needs" : "need"} ${needed}. Mix fewer, or less deep (Settings, Lovejoin).`,
      );
    }
  }

  /** What mixing `boxes` boxes at the set depth takes, before anything is built. */
  async funding(network: NetworkName, boxes: number): Promise<LovejoinFunding> {
    const { depth, delay } = await this.settings();
    const found = JSON.parse(this.deps.wasm.lovejoinFunding(JSON.stringify({ network, boxes, depth }))) as Omit<
      LovejoinFunding,
      "depth" | "delay" | "boxes"
    >;
    return { ...found, boxes, depth, delay };
  }

  /**
   * Session `index`'s whole chain through Lovejoin, or nothing when Lovejoin
   * isn't here or its spare ADA doesn't pay for a box (the return is plain).
   * The return at its end merges into `merge`, the funding's change. `boxes`:
   * at most this many (a mix session's), else all the spare ADA pays for.
   * Throws LovejoinSkipped when the network measures its first mix
   * differently.
   */
  async chain(
    network: NetworkName,
    index: number,
    rows: KoiosUtxo[],
    collateral: KoiosUtxo | undefined,
    params: unknown,
    merge: KoiosUtxo[] = [],
    boxes?: number,
  ): Promise<LovejoinChain | undefined> {
    if (!this.available(network) || !collateral) return undefined;
    const plan = await this.plan(network, index, rows, collateral);
    let count = Math.min(plan.boxes, boxes ?? plan.boxes);
    if (count < 1) return undefined;
    const { depth } = await this.settings();
    const pool = await this.pool(network);
    // Each mix takes two boxes from the pool, never one twice.
    count = Math.min(count, Math.floor(pool.length / (mixesPerBox(depth) * 2)));
    if (count < 1) throw new LovejoinSkipped("Lovejoin's pool has too few boxes to mix with right now");
    const request = {
      network,
      params,
      index,
      utxos: rows,
      collateral: { txHash: collateral.tx_hash, txIndex: collateral.tx_index },
      pool,
      depth,
      boxes: count,
      merge,
    };
    const chain = await this.deps.wallet.withKeys(
      (keys) =>
        JSON.parse(this.deps.wasm.buildLovejoinChain(keys.oneTime, keys.seedelf, JSON.stringify(request))) as LovejoinChain,
    );
    await this.crossCheck(network, chain);
    return chain;
  }

  /**
   * Has Koios's Ogmios measure the chain's first mix, with the deposit it
   * spends (not on chain yet) as extra UTxOs, and compares that with what the
   * mix declares, which the wallet measured. Throws LovejoinSkipped when the
   * network measures more or refuses a script: then the wallet's evaluator
   * is behind the network (a hard fork), and sending would risk the
   * collateral. A Koios error is thrown as it is, to be tried again.
   */
  private async crossCheck(network: NetworkName, chain: LovejoinChain): Promise<void> {
    const { wasm } = this.deps;
    const first = chain.txs.find((t) => t.kind === "mix");
    const deposit = chain.txs.find((t) => t.kind === "deposit");
    if (!first || !deposit) return;
    const additional = JSON.parse(wasm.ogmiosUtxos(deposit.txCbor)) as unknown[];
    const answer = await this.deps.koios(network).evaluate(first.txCbor, additional);
    const checked = JSON.parse(wasm.declaredCovers(first.txCbor, JSON.stringify(answer))) as { covers: boolean; reason?: string };
    if (!checked.covers) throw new LovejoinSkipped(checked.reason ?? "the network measured its scripts differently");
  }

  /**
   * Builds `boxes` boxes from the public account straight into Lovejoin: the
   * deposit and every mix, signed by the account's keys and checked against
   * the network, kept for Send. Its collateral backs every mix.
   */
  async publicBuild(network: NetworkName, boxes: number): Promise<LovejoinPublicSummary> {
    if (!this.available(network)) throw new Error("Lovejoin isn't on this network yet.");
    checkBoxes(boxes);
    const { wasm, wallet, session, now } = this.deps;
    const { params, utxos, collateral, held } = await readAccount(this.deps, network);
    if (!collateral) {
      throw new Error("Lovejoin's mixes need your public account's collateral. Set it aside in Settings, Collateral, first.");
    }
    if (!utxos.length) throw nothingInAccount(held, "Your public account is empty, so there's nothing to mix.");
    const { depth, delay } = await this.settings();
    const pool = await this.pool(network);
    const request = { network, params, utxos, collateral, pool, depth, boxes };
    const chain = await wallet.withKeys(
      (keys) => JSON.parse(wasm.buildLovejoinFromAccount(keys.cardano, keys.seedelf, JSON.stringify(request))) as LovejoinChain,
    );
    try {
      await this.crossCheck(network, chain);
    } catch (e) {
      if (e instanceof LovejoinSkipped) throw new Error(`The network doesn't measure Lovejoin's scripts as the wallet does (${e.reason}), so nothing was sent.`);
      throw e;
    }
    const last = chain.txs.at(-1)!;
    const summary: LovejoinPublicSummary = {
      network,
      txHash: last.txHash,
      boxes: chain.boxes,
      depth: chain.depth,
      delay,
      mixes: chain.txs.filter((t) => t.kind === "mix").length,
      txs: chain.txs.length,
      fees: chain.fees,
      change: chain.returned,
    };
    await wallet.withKeys(() => session.set(SESSION_LOVEJOIN_PUBLIC, { ...summary, chain: chain.txs, builtAt: now() } satisfies KeptPublic));
    return summary;
  }

  /**
   * Sends the public account's mix built last, in order, each transaction on
   * the one before's change; a child Koios hasn't seen the parent of yet is
   * tried again a little later. The boxes' withdraws are set once the
   * deposit is in. Home's banner watches the last mix.
   */
  async publicSubmit(network: NetworkName, txHash: string): Promise<PendingTx> {
    const { wallet, session, now } = this.deps;
    const built = await wallet.withKeys(() => session.get<KeptPublic>(SESSION_LOVEJOIN_PUBLIC));
    if (!built || built.txHash !== txHash || built.network !== network) {
      throw new Error("That mix isn't ready to send. Review it again.");
    }
    if (now() - built.builtAt > BUILT_TTL_MS) throw new Error("That mix was built more than 10 minutes ago. Review it again.");
    const koios = this.deps.koios(network);
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    for (const [i, step] of built.chain.entries()) {
      const bytes = hexBytes(step.txCbor);
      for (let attempt = 0; ; attempt++) {
        try {
          const submitted = await koios.submitTx(bytes);
          if (submitted !== step.txHash) throw new Error(`Koios answered with another transaction id (${submitted}).`);
          break;
        } catch (e) {
          // Sent already (a Send pressed twice, or a retry that got through).
          if (e instanceof SpentInputError && (await koios.txStatus([step.txHash]).catch(() => undefined))?.get(step.txHash) != null) {
            break;
          }
          if (i === 0 || attempt >= CHAIN_RETRIES || !(e instanceof SpentInputError)) throw e;
          await sleep(CHAIN_RETRY_MS * (attempt + 1));
        }
      }
      await wallet.withKeys(() => rememberSpent(session, bytes));
      if (step.kind === "deposit") await this.schedule(network, built.boxes);
    }
    const pending: PendingTx = { kind: "lovejoin-mix", network, txHash, submittedAt: now(), confirmations: null };
    await wallet.withKeys(async () => {
      await session.remove(SESSION_LOVEJOIN_PUBLIC);
      await session.remove(SESSION_BALANCES_PREFIX + network);
      await session.set(SESSION_PENDING, pending);
    });
    return pending;
  }

  /** Sets `boxes` withdraws to come, each after its own random delay. */
  async schedule(network: NetworkName, boxes: number): Promise<void> {
    const { delay } = await this.settings();
    const [low, high] = delayHours(delay);
    const random = this.deps.random ?? Math.random;
    const now = this.deps.now();
    const due = Array.from({ length: boxes }, () => now + Math.round((low + (high - low) * random()) * HOUR));
    await this.update(network, (s) => s.due.push(...due));
  }

  /**
   * The wallet's boxes in the pool (a pool read), and when they're due. A box
   * found with no due time (a restore) gets one here.
   */
  async status(network: NetworkName): Promise<LovejoinStatus> {
    if (!this.available(network)) return { available: false, boxes: [], lovelace: "0", due: [] };
    const owned = await this.owned(network, await this.pool(network));
    const known = (await this.read(network)).due.length;
    if (owned.length > known) await this.schedule(network, owned.length - known);
    const { due } = await this.read(network);
    return { available: true, boxes: owned, lovelace: (BigInt(owned.length) * LOVEJOIN_DENOM).toString(), due: [...due].sort((a, b) => a - b) };
  }

  /**
   * The boxes on their way back, from the schedule alone: one due time per
   * box, kept to the pool's count at each scan. No Koios request, so Home
   * can ask whenever it shows.
   */
  async held(network: NetworkName): Promise<LovejoinHeld> {
    if (!this.available(network)) return { boxes: 0, lovelace: "0", next: null };
    const { due } = await this.read(network);
    return {
      boxes: due.length,
      lovelace: (BigInt(due.length) * LOVEJOIN_DENOM).toString(),
      next: due.length ? Math.min(...due) : null,
    };
  }

  /**
   * Withdraws every box that's due. `scan` (at unlock) reads the pool even
   * when nothing is due yet, on a wallet that has used Lovejoin here, so its
   * boxes' due times follow the pool.
   */
  async withdrawDue(network: NetworkName, scan = false): Promise<PendingTx[]> {
    if (!this.available(network)) return [];
    const used = (await this.deps.store.get<Schedule>(`lovejoin.${network}` as const)) !== undefined;
    const { due } = await this.read(network);
    const now = this.deps.now();
    if (!(scan && used) && !due.some((t) => t <= now)) return [];
    const pool = await this.pool(network);
    const owned = await this.owned(network, pool);
    // A box with no due time (a restore) gets one; a due time with no box
    // (withdrawn by hand, or a chain that didn't go through) goes.
    if (owned.length > due.length) await this.schedule(network, owned.length - due.length);
    const schedule = await this.read(network);
    const kept = [...schedule.due].sort((a, b) => a - b).slice(0, owned.length);
    await this.update(network, (s) => (s.due = kept));

    const sent: PendingTx[] = [];
    for (const time of kept.filter((t) => t <= now)) {
      const box = owned.shift();
      if (!box) break;
      try {
        sent.push(await this.withdrawOne(network, pool, box));
        await this.update(network, (s) => {
          const at = s.due.indexOf(time);
          if (at >= 0) s.due.splice(at, 1);
        });
      } catch {
        // Tried again at the next unlock or alarm.
        break;
      }
    }
    return sent;
  }

  /** Withdraws one of our boxes now, whatever its delay (`box`, or any). */
  async withdrawNow(network: NetworkName, box?: { txHash: string; txIndex: number }): Promise<PendingTx> {
    const pool = await this.pool(network);
    const owned = await this.owned(network, pool);
    const chosen = box ? owned.find((b) => b.txHash === box.txHash && b.txIndex === box.txIndex) : owned[0];
    if (!chosen) throw new Error("That box isn't in Lovejoin's pool as yours anymore.");
    const pending = await this.withdrawOne(network, pool, chosen);
    // The earliest due time goes with it.
    await this.update(network, (s) => {
      s.due.sort((a, b) => a - b);
      s.due.shift();
    });
    return pending;
  }

  private async owned(network: NetworkName, pool: KoiosUtxo[]): Promise<Array<{ txHash: string; txIndex: number }>> {
    const request = JSON.stringify({ network, pool });
    const found = await this.deps.wallet.withKeys(
      (keys) => JSON.parse(this.deps.wasm.lovejoinOwned(keys.seedelf, request)) as { boxes: Array<{ txHash: string; txIndex: number }> },
    );
    return found.boxes;
  }

  private async withdrawOne(network: NetworkName, pool: KoiosUtxo[], box: { txHash: string; txIndex: number }): Promise<PendingTx> {
    const { wasm, wallet, session, now } = this.deps;
    const koios = this.deps.koios(network);
    const params = await koios.epochParams();
    const built = await wallet.withKeys(
      (keys) =>
        JSON.parse(wasm.buildLovejoinWithdraw(keys.seedelf, JSON.stringify({ network, params, pool, boxRef: box }))) as {
          txCbor: string;
          txHash: string;
          fee: string;
          lovelace: string;
        },
    );
    const collateral = await this.deps.collateral(network).witness(built.txCbor);
    const finished = JSON.parse(wasm.finishLovejoinWithdraw(JSON.stringify({ txCbor: built.txCbor, collateral }))) as {
      txCbor: string;
      txHash: string;
    };
    if (finished.txHash !== built.txHash) throw new Error("Signing changed the withdraw, so it wasn't sent.");
    const bytes = hexBytes(finished.txCbor);
    const submitted = await koios.submitTx(bytes);
    if (submitted !== built.txHash) throw new Error(`Koios answered with another transaction id (${submitted}).`);
    await wallet.withKeys(async () => {
      await rememberSpent(session, bytes);
      await session.remove(SESSION_BALANCES_PREFIX + network);
    });
    const pending: PendingTx = { kind: "lovejoin-withdraw", network, txHash: built.txHash, submittedAt: now(), confirmations: null };
    await this.deps.activity?.sent(network, pending, { lovelace: built.lovelace, fee: built.fee }).catch(() => undefined);
    return pending;
  }

  private async read(network: NetworkName): Promise<Schedule> {
    const kept = await this.deps.store.get<Schedule>(`lovejoin.${network}` as const);
    return { due: Array.isArray(kept?.due) ? kept.due.filter((t) => typeof t === "number") : [] };
  }

  private async update(network: NetworkName, change: (s: Schedule) => void): Promise<void> {
    const schedule = await this.read(network);
    change(schedule);
    await this.deps.store.set(`lovejoin.${network}` as const, schedule);
  }
}
