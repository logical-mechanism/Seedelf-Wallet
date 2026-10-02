// The phrase's Cardano accounts, and which one the wallet is working on
// (chunk 18, P1).
//
// A wallet is one recovery phrase with one private balance and, until this
// chunk, one public account: CIP-1852 account `0'`. A user restoring a phrase
// may hold funds on accounts past it, and some people run several accounts as
// a form of privacy in the first place — so a wallet that can only see one is
// both losing their money and working against the habit they came with.
//
// Active     Which account the wallet works on, in chrome.storage.local
//            (`LOCAL_ACCOUNT`), unsealed and not per network: the keys are
//            the same on both. `Wallet` reads it at every key use, so a
//            switch writes this and nothing else.
// Known      Which accounts the phrase has used, sealed with the other
//            private records: how many accounts someone runs is about them.
//            It only grows — an account used on mainnet stays known on
//            preprod, where it is simply empty.
//
// **The Seedelf key stays on account 0** (the owner, 2026-10-02): one private
// balance for the whole phrase. The derivation would allow one key per
// account and it isn't needed, because stealth addressing already unlinks the
// move-ins — two accounts paying the same Seedelf create re-randomized
// registers that can't be tied to each other without the scalar. What that
// does *not* cover is co-spending, which `shared/histories.ts` handles by
// giving each account's money its own history class.

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import { LOCAL_ACCOUNT } from "../shared/preferences";
import type { KnownAccount } from "../shared/rpc";
import { SESSION_ACCOUNT_ACTIVITY_PREFIX, SESSION_ACCOUNT_ADDRESSES_PREFIX } from "./activity";
import { SESSION_ACCOUNT_UTXOS_PREFIX, SESSION_TOO_LARGE_PREFIX } from "./coin-control";
import type { Koios } from "./koios";
import type { PrivateStore } from "./private-store";
import type { Area } from "./storage";
import { SESSION_BALANCES_PREFIX, SESSION_PRIVATE_STALE_PREFIX, type Wallet } from "./wallet";

/**
 * How many accounts past the last known one may be probed in one discovery.
 * BIP44 stops at the first unused account, so this is only a bound on the
 * Koios cost of a phrase whose accounts are a strange shape — one request
 * each, and nothing here is paged.
 */
export const MAX_PROBE = 24;

/** The most accounts a wallet keeps: past this the picker is no longer a picker. */
export const MAX_ACCOUNTS = 25;

/** Account 0, which every phrase has whether it has ever been used or not. */
const FIRST: KnownAccount = { index: 0 };

/** What a user may call an account. Longer is cut; the number is always shown beside it. */
export const NAME_MAX = 24;

interface Record_ {
  known: KnownAccount[];
}

/** The name an account is shown by with none of its own: "Account 1" for index 0, as a person counts. */
export const accountLabel = (a: KnownAccount): string => a.name?.trim() || `Account ${a.index + 1}`;

export interface AccountsDeps {
  wasm: typeof Wasm;
  wallet: Wallet;
  store: PrivateStore;
  local: Area;
  session: Area;
  koios: (network: NetworkName) => Koios;
  now: () => number;
}

/**
 * Session storage an account's own reading left, wiped when the wallet moves
 * to another one. Keyed by network and nothing else, so they would otherwise
 * read as the new account's.
 *
 * `seedelf.contract.<net>` is **not** here: the private balance is shared, so
 * the next reading's private side comes from that cache as a delta, which is
 * what makes a switch cost one account read rather than a full scan. Neither
 * are what the wallet spent (`seedelf.reserved.*`, `seedelf.sent.*`) or a
 * payment in flight (`seedelf.pendingTx.*`): those protect every account from
 * a double spend, and a watch follows its payment to the end whichever
 * account is active.
 */
export const WIPED_ON_SWITCH = [
  SESSION_BALANCES_PREFIX,
  SESSION_PRIVATE_STALE_PREFIX,
  SESSION_ACCOUNT_UTXOS_PREFIX,
  SESSION_ACCOUNT_ADDRESSES_PREFIX,
  SESSION_ACCOUNT_ACTIVITY_PREFIX,
  SESSION_TOO_LARGE_PREFIX,
] as const;

/**
 * Which public account the wallet works on: account 0 for anything else kept,
 * or nothing — which is every wallet from before this chunk.
 *
 * A free function, not a method, because `Wallet` reads it while deriving the
 * keys and `AccountsService` needs the wallet. It needs no key: it is one
 * integer in chrome.storage.local, as the network is (`LOCAL_ACCOUNT` says
 * what that leaks and what stays sealed).
 */
export async function activeAccount(local: Area): Promise<number> {
  const kept = await local.get<unknown>(LOCAL_ACCOUNT);
  return isIndex(kept) ? kept : 0;
}

export class AccountsService {
  constructor(private readonly deps: AccountsDeps) {}

  /** The accounts this phrase is known to have used, account 0 first. Throws if locked. */
  async known(): Promise<KnownAccount[]> {
    const kept = await this.deps.store.get<Record_>("accounts");
    return sorted(kept?.known);
  }

  /** The account the wallet is working on (`activeAccount`). */
  active(): Promise<number> {
    return activeAccount(this.deps.local);
  }

  /** The accounts and the active one, for the picker. Throws if locked. */
  async list(): Promise<{ accounts: KnownAccount[]; active: number }> {
    const [accounts, active] = await Promise.all([this.known(), this.active()]);
    // The active account is always offered, even on a network where discovery hasn't seen it used.
    return { accounts: accounts.some((a) => a.index === active) ? accounts : sorted([...accounts, { index: active }]), active };
  }

  /**
   * Puts the wallet on account `index`, which must be one it knows of, and
   * wipes what the account it left read (`WIPED_ON_SWITCH`). `Wallet` reads
   * the choice at every key use, so nothing else has to happen: the next one
   * re-derives, and no request can sign with the account the user just left.
   *
   * The caller refuses the switch first when something of the account's is in
   * flight (handlers.ts `atStake`): switching under a payment being watched
   * is how a watch loses its account.
   */
  async use(index: number, networks: readonly NetworkName[]): Promise<number> {
    if (!isIndex(index)) throw new Error("That isn't an account.");
    const known = await this.known();
    if (!known.some((a) => a.index === index)) {
      throw new Error("Seedelf Wallet doesn't know that account. Check for it in Settings first.");
    }
    if ((await this.active()) === index) return index;
    await this.deps.local.set(LOCAL_ACCOUNT, index);
    await this.wipe(networks);
    return index;
  }

  /** What the account the wallet left read, on every network: the next reading is the new account's. */
  private async wipe(networks: readonly NetworkName[]): Promise<void> {
    const keys = networks.flatMap((n) => WIPED_ON_SWITCH.map((prefix) => prefix + n));
    await this.deps.session.remove(...keys).catch(() => undefined);
  }

  /** Names account `index`, or clears the name with an empty one. Throws if locked. */
  async rename(index: number, name: string): Promise<KnownAccount[]> {
    const trimmed = name.trim().slice(0, NAME_MAX);
    const known = await this.known();
    if (!known.some((a) => a.index === index)) throw new Error("Seedelf Wallet doesn't know that account.");
    const next = known.map((a) => (a.index === index ? { ...a, ...(trimmed ? { name: trimmed } : { name: undefined }) } : a));
    await this.keep(next);
    return sorted(next);
  }

  /**
   * Puts the wallet on account 0, needing no key. Called **before** a create
   * or restore derives anything: the choice is in unsealed storage, which
   * Remove wallet keeps as it keeps the network, so without this a new phrase
   * would derive the account the last one was left on.
   */
  async useFirst(): Promise<void> {
    await this.deps.local.set(LOCAL_ACCOUNT, 0);
  }

  /**
   * Records account 0 as the one account known, with no request at all: a new
   * phrase has nothing anywhere, and a restored one is discovered separately.
   * Called after the wallet is unlocked, since it seals.
   */
  async recordFirst(): Promise<void> {
    await this.keep([FIRST]);
  }

  /**
   * Looks for accounts past the ones it knows, in order, stopping at the
   * first never used — BIP44's rule. The new ones are added to `known` and
   * returned.
   *
   * **One `account_addresses` request per account probed, never a batch.**
   * `Koios.usedStakeAddresses` would answer for twenty accounts at once, and
   * that one request would tell Koios those twenty stake addresses are one
   * wallet's — which works directly against the habit several accounts exist
   * to serve. The requests go separately instead. Koios still sees them from
   * one IP seconds apart, which the privacy docs say in those words rather
   * than claiming more.
   *
   * `limit` bounds one run (`MAX_PROBE`): the picker's "check for another
   * account" passes 1, so it costs exactly one request.
   */
  async discover(network: NetworkName, limit = MAX_PROBE): Promise<KnownAccount[]> {
    const { wallet, wasm, koios } = this.deps;
    const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
    const known = await this.known();
    const highest = known.reduce((max, a) => Math.max(max, a.index), 0);
    const client = koios(network);
    const found: KnownAccount[] = [];
    for (let index = highest + 1; index < Math.min(highest + 1 + limit, MAX_ACCOUNTS); index += 1) {
      const stake = await wallet.withAccount(index, ({ cardano }) => cardano.stakeAddress(net));
      const addresses = await client.accountAddresses(stake);
      // Never used: BIP44 stops here, and so does the Koios cost.
      if (!addresses.length) break;
      found.push({ index, foundAt: this.deps.now() });
    }
    if (found.length) await this.keep([...known, ...found]);
    return found;
  }

  private async keep(known: KnownAccount[]): Promise<void> {
    await this.deps.store.set("accounts", { known: sorted(known) } satisfies Record_);
  }
}

/** Whether `value` is an account index this wallet will use. */
export function isIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < MAX_ACCOUNTS;
}

/** Account 0 first, each index once, and account 0 always there. */
function sorted(known: KnownAccount[] | undefined): KnownAccount[] {
  const all = new Map<number, KnownAccount>([[0, FIRST]]);
  for (const a of known ?? []) {
    if (!isIndex(a?.index)) continue;
    const name = typeof a.name === "string" && a.name.trim() ? a.name.trim().slice(0, NAME_MAX) : undefined;
    all.set(a.index, { index: a.index, ...(name ? { name } : {}), ...(typeof a.foundAt === "number" ? { foundAt: a.foundAt } : {}) });
  }
  return [...all.values()].sort((a, b) => a.index - b.index);
}
