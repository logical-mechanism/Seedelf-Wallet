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
// Koios requests: one pool read for a chain; one at each unlock, only on a
// wallet that has used Lovejoin here (a restored wallet finds its boxes when
// the Lovejoin tile opens); a withdraw is giveme.my plus one submit.

import type { LovejoinDelay, LovejoinDepth } from "../shared/preferences";
import type { NetworkName } from "../networks";
import type { LovejoinStatus, PendingTx } from "../shared/rpc";
import type { KoiosUtxo } from "./koios";
import type { PreferencesService } from "./preferences";
import type { PrivateStore } from "./private-store";
import type { ScriptSpendDeps } from "./script-spend";
import { rememberSpent, spentSet, unspent } from "./spent";
import { SESSION_BALANCES_PREFIX } from "./wallet";

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
  /** What the return brings back at once: the change and the collateral. */
  returned: string;
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

export interface LovejoinDeps extends ScriptSpendDeps {
  store: PrivateStore;
  preferences: PreferencesService;
  /** In [0, 1): the delays' draw. Tests pin it. */
  random?: () => number;
}

const HOUR = 3_600_000;
const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

/** A delay range's bounds, in hours. */
export function delayHours(delay: LovejoinDelay): [number, number] {
  const [low, high] = delay.split("-").map(Number);
  return [low!, high!];
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
   * Session `index`'s whole chain through Lovejoin, or nothing when Lovejoin
   * isn't here or its spare ADA doesn't pay for a box (the return is plain).
   */
  async chain(
    network: NetworkName,
    index: number,
    rows: KoiosUtxo[],
    collateral: KoiosUtxo | undefined,
    params: unknown,
  ): Promise<LovejoinChain | undefined> {
    if (!this.available(network) || !collateral) return undefined;
    const plan = await this.plan(network, index, rows, collateral);
    if (plan.boxes < 1) return undefined;
    const { depth } = await this.settings();
    const pool = await this.pool(network);
    const request = {
      network,
      params,
      index,
      utxos: rows,
      collateral: { txHash: collateral.tx_hash, txIndex: collateral.tx_index },
      pool,
      depth,
      boxes: plan.boxes,
    };
    return this.deps.wallet.withKeys(
      (keys) =>
        JSON.parse(this.deps.wasm.buildLovejoinChain(keys.oneTime, keys.seedelf, JSON.stringify(request))) as LovejoinChain,
    );
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
