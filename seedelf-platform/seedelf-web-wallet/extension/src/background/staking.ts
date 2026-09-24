// Staking and voting delegation from the Cardano account, after Lace: one
// pool per account, the vote delegated to a DRep or one of the pinned two,
// and the rewards withdrawn by hand or spent along with any payment
// (preferences.ts). None of it is Seedelf's: staking is public, and it names
// the account. Seedelf money has no staking part, so it can't be staked.
//
// Reading
//   stake   Koios's `account_info` joins every balance reading
//           (balances.ts), so Home always shows the pool and the rewards.
//           The pool's ticker comes from what this session has read, the
//           pool list on the device, or one `pool_info`.
//   pools   every live pool (`pool_list`, 1,000 a request), with the supply
//           and `optimal_pool_count` for saturation. It's the same for
//           everyone, so it's kept in chrome.storage.local for a day.
//   pool    one pool's details, fresh (`pool_info`).
//   drep    a DRep's standing and name (`drep_info`, `drep_metadata`).
// Building  like a send (send.ts): the account and its `account_info` read
//           fresh, then built and signed in WebAssembly with the payment keys
//           and the stake key, and kept until Send, which only submits it.

import type { NetworkName } from "../networks";
import {
  ALWAYS_ABSTAIN,
  ALWAYS_NO_CONFIDENCE,
  type DrepDetails,
  type PendingTx,
  type PoolDetails,
  type PoolList,
  type PoolRef,
  type PoolRow,
  type StakeInfo,
  type StakingAction,
  type StakingSummary,
} from "../shared/rpc";
import { nothingInAccount, readAccount } from "./account";
import type { Koios, KoiosAccountInfo, KoiosPoolInfo } from "./koios";
import { keep, send, type ScriptSpendDeps } from "./script-spend";
import type { Area } from "./storage";
import type { Wallet } from "./wallet";

/** chrome.storage.local, per network: every live pool, read at most once a day. */
export const LOCAL_POOLS_PREFIX = "seedelf.pools.";
/** chrome.storage.session, per network: the pools this session read the details of, by ID. */
export const SESSION_POOL_REFS_PREFIX = "seedelf.poolRefs.";
/** chrome.storage.session: the staking transaction built last, until it's sent or replaced. */
export const SESSION_STAKE = "seedelf.stake.built";

/** How long the pool list is kept. */
export const POOLS_TTL_MS = 24 * 60 * 60_000;

/** What reading the stake key needs. */
export interface StakeDeps {
  wallet: Wallet;
  session: Area;
  koios: (network: NetworkName) => Koios;
  /** Where the pool list is kept (chrome.storage.local). */
  local?: Area;
}

export type StakingDeps = ScriptSpendDeps & { local: Area };

const NOT_STAKING: StakeInfo = { registered: false, pool: null, drep: null, rewards: "0", deposit: "0" };

/** The account's stake key as Koios reads it, with its pool's ticker. */
export async function readStake(deps: StakeDeps, network: NetworkName, stake: string): Promise<StakeInfo> {
  const info = await deps.koios(network).accountInfo(stake);
  if (!info) return NOT_STAKING;
  const pool = info.delegated_pool ? await poolRef(deps, network, info.delegated_pool) : null;
  return stakeInfoOf(info, pool);
}

function stakeInfoOf(info: KoiosAccountInfo | undefined, pool: PoolRef | null): StakeInfo {
  if (!info) return NOT_STAKING;
  const registered = info.status === "registered";
  return {
    registered,
    pool: registered ? pool : null,
    drep: registered ? info.delegated_drep : null,
    rewards: info.rewards_available ?? "0",
    deposit: info.deposit ?? "0",
  };
}

/**
 * A pool's ticker and name: from what this session has read, then the pool
 * list on the device, then one `pool_info`. A failed lookup leaves just the ID.
 */
async function poolRef(deps: StakeDeps, network: NetworkName, id: string): Promise<PoolRef> {
  const known = await deps.wallet.withKeys(() =>
    deps.session.get<Record<string, PoolRef>>(SESSION_POOL_REFS_PREFIX + network),
  );
  if (known?.[id]) return known[id];
  const listed = (await deps.local?.get<PoolList>(LOCAL_POOLS_PREFIX + network))?.pools.find((p) => p.id === id);
  if (listed?.ticker) return { id, ticker: listed.ticker };
  try {
    const [info] = await deps.koios(network).poolInfo([id]);
    if (!info) return { id };
    const ref = refOf(info);
    await rememberPool(deps, network, ref);
    return ref;
  } catch {
    return { id };
  }
}

/** Remembers a pool's ticker and name for this session. */
async function rememberPool(deps: StakeDeps, network: NetworkName, ref: PoolRef): Promise<void> {
  const key = SESSION_POOL_REFS_PREFIX + network;
  await deps.wallet.withKeys(async () => {
    const known = (await deps.session.get<Record<string, PoolRef>>(key)) ?? {};
    await deps.session.set(key, { ...known, [ref.id]: ref });
  });
}

const refOf = (info: KoiosPoolInfo): PoolRef => ({
  id: info.pool_id_bech32,
  ...(info.meta_json?.ticker ? { ticker: info.meta_json.ticker } : {}),
  ...(info.meta_json?.name ? { name: info.meta_json.name } : {}),
});

/** Saturation, a percentage to two places: `stake` against the supply over `optimal_pool_count`. */
export function saturation(stake: bigint, supply: bigint, optimal: number): number {
  if (supply <= 0n || optimal <= 0) return 0;
  return Number((stake * BigInt(optimal) * 10_000n) / supply) / 100;
}

/** A DRep's name from its CIP-119 `givenName`: text, or JSON-LD's `@value`, cut to 64 characters. */
export function drepName(givenName: unknown): string | undefined {
  const text =
    typeof givenName === "string"
      ? givenName
      : typeof (givenName as { "@value"?: unknown } | null)?.["@value"] === "string"
        ? (givenName as { "@value": string })["@value"]
        : undefined;
  const clean = text?.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  return clean ? clean.slice(0, 64) : undefined;
}

/** What each staking transaction is called while it's pending. */
const PENDING_KIND: Record<StakingAction["kind"], PendingTx["kind"]> = {
  delegate: "stake",
  vote: "vote",
  withdraw: "withdraw-rewards",
  stop: "unstake",
};

export class StakingService {
  constructor(private readonly deps: StakingDeps) {}

  /** Every live pool: the list on the device when it's under a day old, unless `refresh`. */
  async pools(network: NetworkName, refresh = false): Promise<PoolList> {
    const { local, now } = this.deps;
    const key = LOCAL_POOLS_PREFIX + network;
    const kept = await local.get<PoolList>(key);
    if (kept && !refresh && now() - kept.updatedAt < POOLS_TTL_MS) return kept;

    const koios = this.deps.koios(network);
    const [rows, supply, params] = await Promise.all([koios.poolList(), koios.supply(), koios.epochParams()]);
    const optimal = Number(params.optimal_pool_count ?? 500);
    const pools = rows.map(
      (p): PoolRow => ({
        id: p.pool_id_bech32,
        ...(p.ticker ? { ticker: p.ticker } : {}),
        margin: p.margin ?? 0,
        cost: p.fixed_cost ?? "0",
        pledge: p.pledge ?? "0",
        stake: p.active_stake ?? "0",
        saturation: saturation(BigInt(p.active_stake ?? 0), BigInt(supply), optimal),
      }),
    );
    const list: PoolList = { pools, updatedAt: now() };
    await local.set(key, list);
    return list;
  }

  /** One pool's details, fresh; its ticker is remembered for Home. */
  async pool(network: NetworkName, id: string): Promise<PoolDetails> {
    const poolId = this.deps.wasm.poolId(id);
    const [info] = await this.deps.koios(network).poolInfo([poolId]);
    if (!info) throw new Error("Koios doesn't know that pool. Check its ID.");
    await rememberPool(this.deps, network, refOf(info));
    return {
      ...refOf(info),
      ...(info.meta_json?.homepage ? { homepage: info.meta_json.homepage } : {}),
      ...(info.meta_json?.description ? { description: info.meta_json.description } : {}),
      margin: info.margin ?? 0,
      cost: info.fixed_cost ?? "0",
      pledge: info.pledge ?? "0",
      livePledge: info.live_pledge ?? "0",
      stake: info.live_stake ?? "0",
      saturation: info.live_saturation ?? 0,
      delegators: info.live_delegators ?? 0,
      blocks: info.block_count ?? 0,
      status: info.pool_status,
      retiringEpoch: info.retiring_epoch,
    };
  }

  /** A DRep by ID, in any form WebAssembly reads: its standing and name. */
  async drep(network: NetworkName, id: string): Promise<DrepDetails> {
    const drepId = this.deps.wasm.drepId(id);
    if (drepId === ALWAYS_ABSTAIN || drepId === ALWAYS_NO_CONFIDENCE) {
      throw new Error("That's one of the two pinned choices, not a DRep. Choose it from the list instead.");
    }
    const koios = this.deps.koios(network);
    const [[info], names] = await Promise.all([koios.drepInfo([drepId]), koios.drepNames([drepId])]);
    if (!info) throw new Error("Koios doesn't know that DRep. Check the ID.");
    const name = drepName(names.find((n) => n.drep_id === drepId)?.givenName);
    return {
      id: drepId,
      ...(name ? { name } : {}),
      status: info.drep_status,
      active: info.active,
      expiresEpoch: info.expires_epoch_no,
      votingPower: info.amount,
      delegators: info.live_delegator_count ?? 0,
    };
  }

  /**
   * Builds and signs `action` from the Cardano account, reading it and its
   * stake key fresh. The same pool or vote again is refused: it would only
   * cost a fee.
   */
  async build(network: NetworkName, action: StakingAction): Promise<StakingSummary> {
    const { wasm, wallet } = this.deps;
    const { params, utxos, held, stake } = await readAccount(this.deps, network, { stake: true });
    if (utxos.length === 0) {
      throw nothingInAccount(held, "Your Cardano account is empty. Staking needs ADA for the fee, and a 2 ₳ deposit the first time.");
    }
    const state = stakeInfoOf(stake, null);
    if (action.kind === "delegate" && state.registered && stake?.delegated_pool === wasm.poolId(action.pool)) {
      throw new Error("You're already staking with this pool.");
    }
    if (action.kind === "vote" && state.drep === wasm.drepId(action.drep)) {
      throw new Error("Your voting power is already delegated there.");
    }

    const request = {
      network,
      params,
      utxos,
      action,
      state: { registered: state.registered, deposit: state.deposit, rewards: state.rewards, drep: state.drep },
    };
    const result = await wallet.withKeys(
      (keys) => JSON.parse(wasm.buildStaking(keys.cardano, JSON.stringify(request))) as StakingSummary & { txCbor: string },
    );
    const { txCbor, ...rest } = result;
    const summary: StakingSummary = { ...rest, network };
    await keep(this.deps, SESSION_STAKE, { ...summary, txCbor });
    return summary;
  }

  /** Signed at review: Send only submits it. */
  async submit(network: NetworkName, txHash: string): Promise<PendingTx> {
    const built = await this.deps.wallet.withKeys(() => this.deps.session.get<StakingSummary>(SESSION_STAKE));
    const kind = built ? PENDING_KIND[built.action.kind] : "stake";
    return send(this.deps, network, txHash, SESSION_STAKE, kind, "staking transaction");
  }
}
