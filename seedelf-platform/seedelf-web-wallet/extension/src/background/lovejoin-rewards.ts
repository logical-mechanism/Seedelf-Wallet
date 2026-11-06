// What sits in each Lovejoin pool's `mix_logic` reward account (chunk 43). Every mix and withdraw runs `mix_logic` by
// withdrawing from that account, and the ledger takes only an account's whole balance: 0, unless someone put money
// there, as a stake pool that names it and retires does (its deposit comes back there). Then the first transaction to
// take it keeps it, and the wallet's take it into the user's own output (seedelf_core::lovejoin::Rewards).
//
// The worker reads each pool's balance where it builds there, one account_info a pool (LovejoinService `rewardsIn`),
// and hands it to WebAssembly as a request's `rewards`. What the wallet's own transactions on their way take counts as
// taken: Koios and the data layer report it until their block, and the ledger takes it once. A wrong figure costs
// nothing: the network refuses the transaction before any script runs (koios.ts RewardsChangedError).

import { txWithdrawals } from "./cbor";
import { goingOut } from "./incoming";
import type { SentTx } from "./sent-txs";
import type { Reservation } from "./spent";

/**
 * One pool's `mix_logic` reward account as a build read it: the pool (its id), `mix_logic`'s hash, the account's
 * bech32 (`stake`) and its bytes (`account`, hex), and the balance the build takes, in lovelace.
 */
export interface RewardRead {
  pool: string;
  hash: string;
  stake: string;
  account: string;
  lovelace: string;
  /** account_info didn't answer: built as before, on none, and never taken at Send for a balance that moved. */
  unread?: true;
}

/** More than all the ADA there will ever be: no reading of an account's balance, which is taken as none. */
const ALL_ADA = 45_000_000_000_000_000n;

/** A balance as account_info gives it (`rewards_available`): none when it's no whole number, or past all the ADA. */
export function readBalance(rewards: unknown): bigint {
  if (typeof rewards !== "string" || !/^\d{1,20}$/.test(rewards)) return 0n;
  const lovelace = BigInt(rewards);
  return lovelace > ALL_ADA ? 0n : lovelace;
}

const bytesOf = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

/**
 * What `txs` (their CBOR, hex) withdraw from each reward account, by its bytes (hex), where it's more than nothing:
 * the most any one of them does, as only one chain's first transaction in a pool takes any. One that can't be read
 * takes nothing.
 */
export function takesOf(txs: ReadonlyArray<{ txCbor: string }>): Map<string, bigint> {
  const takes = new Map<string, bigint>();
  for (const { txCbor } of txs) {
    let withdrawals: Array<{ account: string; lovelace: bigint }>;
    try {
      withdrawals = txWithdrawals(bytesOf(txCbor));
    } catch {
      continue;
    }
    for (const { account, lovelace } of withdrawals) {
      if (lovelace > (takes.get(account) ?? 0n)) takes.set(account, lovelace);
    }
  }
  return takes;
}

/**
 * What the wallet's own transactions on their way withdraw from `account` (its bytes, hex), the most any one does:
 * those it sent that what they spend is still held for (incoming.ts goingOut, either of two that spend one coin), and
 * those of a chain being sent, sent or not yet (its reservation's `takes`).
 */
export function takingFrom(sent: SentTx[], spent: ReadonlySet<string>, sending: Reservation[], account: string): bigint {
  let most = 0n;
  for (const { s } of goingOut(sent, spent, { either: true })) {
    const takes = takesOf([s]).get(account) ?? 0n;
    if (takes > most) most = takes;
  }
  for (const r of sending) {
    const takes = r.takes?.[account] === undefined ? 0n : readBalance(r.takes[account]);
    if (takes > most) most = takes;
  }
  return most;
}

/**
 * The balance a build may take, from what the account holds as `read`: none while a transaction of the wallet's on its
 * way takes it (`taking`), which the reading still counts until its block, as Home's forms leave the account's own
 * rewards (account.ts); what's read when it counts less, the reading made after that one landed.
 */
export function balanceAfter(read: bigint, taking: bigint): bigint {
  return taking > 0n && read >= taking ? 0n : read;
}

/** A request's `rewards`: each read that holds something, by its `mix_logic` hash. None when none does: as before. */
export function rewardsField(reads: readonly RewardRead[]): { rewards?: Record<string, string> } {
  const held = reads.filter((r) => r.lovelace !== "0");
  return held.length ? { rewards: Object.fromEntries(held.map((r) => [r.hash, r.lovelace])) } : {};
}

/**
 * Those of `reads` whose accounts `txs` withdraw from, each with what they withdraw: what a chain kept for Send reads
 * again before any of it goes (moved). Its other pools' balances don't touch it.
 */
export function readsFor(reads: readonly RewardRead[], txs: ReadonlyArray<{ txCbor: string }>): RewardRead[] {
  const named = new Set<string>();
  for (const { txCbor } of txs) {
    try {
      for (const { account } of txWithdrawals(bytesOf(txCbor))) named.add(account);
    } catch {
      // Unreadable: it names none.
    }
  }
  const takes = takesOf(txs);
  return reads.filter((r) => named.has(r.account)).map((r) => ({ ...r, lovelace: (takes.get(r.account) ?? 0n).toString() }));
}

/**
 * Whether an account of `before` reads otherwise in `now`: its balance moved between a build and its Send. One that
 * couldn't be read now says nothing: the network refuses what's wrong at no cost.
 */
export function moved(before: readonly RewardRead[], now: readonly RewardRead[]): boolean {
  return before.some((b) => {
    const read = now.find((n) => n.account === b.account);
    return read !== undefined && !read.unread && read.lovelace !== b.lovelace;
  });
}
