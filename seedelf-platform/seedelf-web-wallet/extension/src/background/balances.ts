// Balances: read the chain through Koios and work out what this wallet owns.
//
// Seedelf side: every UTxO in the wallet contract, kept when the register in
// its datum is ours (g^x == u, checked in WebAssembly). The contract is read
// in full only when due, otherwise from the last block seen (contract-scan.ts). This is what the CLI's
// `balance` does, and UTxOs holding a seedelf are listed as seedelfs rather
// than counted in the balance, also as in the CLI.
//
// Cardano side: every UTxO under one of the account's payment keys, whatever
// its staking part (account.ts). Keys come from the gap limit over the
// addresses that have used the account's stake key. Asking by payment key
// also leaves out what anyone can pair with our stake key: their own payment
// key or script, which proves nothing about us. The stake key's standing
// (`account_info`: the pool, the vote, the rewards) is read alongside
// (staking.ts).
//
// What the user locked, and the Cardano account's collateral, are counted in
// the balance and reported apart (coin-control.ts), fresh on every request,
// since locking a UTxO doesn't read the chain again. So is what the wallet's
// own sent transactions pay back to each side before a reading lists it, a
// payment's change or a Make private's deposit (incoming.ts): the balance
// leaves out what was spent at once. Each Seedelf says who
// paid for it, when the device knows (minted-by.ts), for Remove's default.
//
// The reading is cached per network in chrome.storage.session and wiped on lock.
// Once a private spend that pays nothing to the public account lands, only
// its private side is behind (pending.ts): the next reading reads the
// contract alone and keeps the account's side, so the account isn't read
// in the same second as the private transaction lands, which would tie the
// two by timing (privacy review §2.9). Refresh reads both.
// Session storage holds 10 MB for the whole extension, and anyone can pay
// this wallet, on either side, UTxOs holding a thousand tokens each: a
// reading too large to keep is used anyway, and read again next time.
// A reading that still lists a UTxO this wallet has spent came from a Koios
// backend that's behind (spent.ts): it's read again, a few times, and what's
// spent is left out either way.

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import type { Balances, Locked, SeedelfInfo, StakeInfo } from "../shared/rpc";
import { readAccountUtxos, type Account, type PathedUtxo } from "./account";
import { registerOf, seedelfLabel, seedelfTokenOf, sumValue } from "./chain";
import {
  SESSION_ACCOUNT_ACTIVITY_PREFIX,
  SESSION_ACCOUNT_ADDRESSES_PREFIX,
  type AccountAddresses,
  type ActivityService,
} from "./activity";
import {
  SESSION_ACCOUNT_UTXOS_PREFIX,
  SESSION_TOO_LARGE_PREFIX,
  type CoinControlService,
  type ReadingUtxos,
} from "./coin-control";
import { keptContractView, readContractView } from "./contract-scan";
import { incomingOf, type Incoming } from "./incoming";
import type { Koios, KoiosUtxo } from "./koios";
import { mintedBy, paidByOf, type MintedBy } from "./minted-by";
import type { PrivateStore } from "./private-store";
import { recentlySent } from "./sent-txs";
import { outpoint, reservedSet, spentSet } from "./spent";
import { readStake } from "./staking";
import type { Area } from "./storage";
import { SESSION_BALANCES_PREFIX, SESSION_PRIVATE_STALE_PREFIX, type Keys, type Wallet } from "./wallet";
import { isTrap } from "./wasm";

export interface ContractConfig {
  /** The wallet contract's script hash: its payment credential. */
  walletContractHash: string;
  seedelfPolicyId: string;
}

/** Contract variant 1 (seedelf-core `get_config(1, …)`). The hashes are the same on both networks. */
export const CONTRACT_V1: ContractConfig = {
  walletContractHash: "94bca9c099e84ffd90d150316bb44c31a78702239076a0a80ea4a469",
  seedelfPolicyId: "84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255",
};

export interface BalanceDeps {
  wasm: typeof Wasm;
  wallet: Wallet;
  session: Area;
  koios: (network: NetworkName) => Koios;
  now: () => number;
  contract?: ContractConfig;
  /** Waits between readings; tests don't. */
  sleep?: (ms: number) => Promise<void>;
  /** Notes new UTxOs of ours as arrivals in the Seedelf history. */
  activity?: ActivityService;
  /** What's locked on each side. */
  coins: CoinControlService;
  /** chrome.storage.local, where the pool list is kept: a pool's ticker is looked up there first. */
  local?: Area;
  /** The sealed records: who paid for each Seedelf (minted-by.ts). */
  store?: PrivateStore;
}

/** What the device holds that says who paid for each Seedelf (minted-by.ts `paidByOf`). */
type Held = Omit<Parameters<typeof paidByOf>[2], "owned">;

const NOTHING: Locked = { lovelace: "0", tokens: [], utxos: 0 };

/** A reading, with its own UTxOs when it was too large to keep. */
interface Reading {
  balances: Balances;
  unkept?: ReadingUtxos;
}

export class BalanceService {
  private readonly inFlight = new Map<NetworkName, Promise<Reading>>();
  private readonly inFlightPrivate = new Map<NetworkName, Promise<Reading>>();

  constructor(private readonly deps: BalanceDeps) {}

  /** The cached reading, or a new one when there's none or `refresh` is set. Throws if locked. */
  async get(network: NetworkName, refresh = false): Promise<Balances> {
    const { balances, unkept } = await this.reading(network, refresh);
    return this.withIncoming(network, await this.withLocked(network, balances, unkept), unkept);
  }

  /** When the kept reading was made, without reading anything; undefined when there's none. Throws if locked. */
  async lastRead(network: NetworkName): Promise<number | undefined> {
    const cached = await this.deps.wallet.withKeys(() =>
      this.deps.session.get<Balances>(SESSION_BALANCES_PREFIX + network),
    );
    return cached?.updatedAt;
  }

  private async reading(network: NetworkName, refresh: boolean): Promise<Reading> {
    if (!refresh) {
      const { session } = this.deps;
      const [cached, privateStale] = await this.deps.wallet.withKeys(
        async () =>
          [
            await session.get<Balances>(SESSION_BALANCES_PREFIX + network),
            (await session.get(SESSION_PRIVATE_STALE_PREFIX + network)) !== undefined,
          ] as const,
      );
      if (cached && !privateStale) return { balances: cached };
      if (cached) return this.shared(this.inFlightPrivate, network, () => this.readPrivate(network, cached));
    }
    return this.shared(this.inFlight, network, () => this.read(network));
  }

  /** Pages asking at the same time share one reading. */
  private shared(inFlight: Map<NetworkName, Promise<Reading>>, network: NetworkName, read: () => Promise<Reading>): Promise<Reading> {
    let reading = inFlight.get(network);
    if (!reading) {
      reading = read().finally(() => inFlight.delete(network));
      inFlight.set(network, reading);
    }
    return reading;
  }

  /** What the device holds that says who paid for each Seedelf: read on the device alone, never asked of Koios. */
  private async mintRecord(network: NetworkName): Promise<MintedBy> {
    return this.deps.store ? await mintedBy(this.deps.store, network).catch(() => ({})) : {};
  }

  /**
   * The rest of `Held`, from session storage. Call it inside `withKeys`,
   * which is why `activeAccount` is passed in rather than read here: taking
   * the wallet's lock again from under it would deadlock.
   *
   * `account` and the Activity are the account the wallet is working on, so a
   * mint worked out from them is that account's (minted-by.ts).
   */
  private async held(network: NetworkName, recorded: MintedBy, account: KoiosUtxo[], activeAccount: number): Promise<Held> {
    const activity = await this.deps.session.get<{ entries: Array<{ txHash: string }> }>(SESSION_ACCOUNT_ACTIVITY_PREFIX + network);
    return { recorded, account, accountTxs: new Set(activity?.entries.map((e) => e.txHash)), activeAccount };
  }

  /**
   * The private side read again, the account's side as `cached` has it:
   * after a private spend landed (pending.ts). The contract is read from the
   * last block seen, as any reading does; the account isn't asked about.
   */
  private async readPrivate(network: NetworkName, cached: Balances): Promise<Reading> {
    const { wallet, session, now, contract = CONTRACT_V1 } = this.deps;
    // Before the read takes what's spent: what was sent since may still be in it (incoming.ts).
    const spentAsOf = now();
    const view = await readContractView(this.deps, network);
    const recorded = await this.mintRecord(network);
    const reading = await wallet.withKeys(async (keys): Promise<Reading> => {
      const utxos = (await session.get<PathedUtxo[]>(SESSION_ACCOUNT_UTXOS_PREFIX + network)) ?? [];
      const held = await this.held(
        network,
        recorded,
        utxos.map((p) => p.utxo),
        keys.account,
      );
      const balances: Balances = { ...cached, spentAsOf, seedelf: this.seedelfSide(view.owned, contract.seedelfPolicyId, held) };
      try {
        await session.set(SESSION_BALANCES_PREFIX + network, balances);
        await session.remove(SESSION_PRIVATE_STALE_PREFIX + network);
        return { balances };
      } catch {
        // Too large to keep, as `keep` handles it: the next request reads it all again.
        await session.remove(SESSION_BALANCES_PREFIX + network, SESSION_ACCOUNT_UTXOS_PREFIX + network).catch(() => undefined);
        await session.set(SESSION_TOO_LARGE_PREFIX + network, balances.updatedAt).catch(() => undefined);
        return { balances, unkept: { owned: view.owned, account: utxos, updatedAt: balances.updatedAt } };
      }
    });
    // The history never holds up, or breaks, a balance reading.
    await this.deps.activity?.arrived(network, view.owned).catch(() => undefined);
    return reading;
  }

  /** The reading with what's locked on each side now: from its own UTxOs, `unkept`, when it wasn't kept. */
  private async withLocked(network: NetworkName, b: Balances, unkept?: ReadingUtxos): Promise<Balances> {
    const locked = await this.deps.coins.locked(network, unkept);
    return { ...b, seedelf: { ...b.seedelf, locked: locked.seedelf }, cardano: { ...b.cardano, locked: locked.cardano } };
  }

  /**
   * The reading with what the wallet's own sent transactions pay back to each
   * side and it doesn't list yet (incoming.ts), fresh on every request from
   * what the device keeps: no request. It never breaks a reading.
   */
  private async withIncoming(network: NetworkName, b: Balances, unkept?: ReadingUtxos): Promise<Balances> {
    const { wasm, wallet, session, contract = CONTRACT_V1 } = this.deps;
    let coming: Incoming;
    try {
      coming = await wallet.withKeys(async (keys): Promise<Incoming> => {
        const sent = await recentlySent(session, network);
        if (!sent.length) return {};
        // None kept (session storage was full): what a side lists isn't known, and nothing is counted on it rather
        // than a landed transaction's outputs twice (chunk 23's second review, fix round).
        const owned = unkept?.owned ?? (await keptContractView(session, network, contract))?.owned;
        const account = unkept?.account ?? (await session.get<PathedUtxo[]>(SESSION_ACCOUNT_UTXOS_PREFIX + network));
        const addresses = await session.get<AccountAddresses>(SESSION_ACCOUNT_ADDRESSES_PREFIX + network);
        return incomingOf(wasm, sent, {
          // A reading kept from before it was noted: none of the private side's sends counts as left out.
          startedAt: b.spentAsOf ?? 0,
          account: account && new Set(account.map((p) => outpoint(p.utxo))),
          owned: owned && new Set(owned.map(outpoint)),
          spent: await spentSet(session),
          reserved: (await reservedSet(session, network)).inputs,
          keys: new Set(addresses?.keys ?? []),
          contract,
          ours: (utxos) => ownedUtxos(wasm, keys, utxos),
          decimals: decimalsOf([...(account ?? []).map((p) => p.utxo), ...(owned ?? [])]),
        });
      });
    } catch (e) {
      if (isTrap(e)) throw e;
      return b;
    }
    return {
      ...b,
      ...(coming.seedelf ? { seedelf: { ...b.seedelf, incoming: coming.seedelf } } : {}),
      ...(coming.cardano ? { cardano: { ...b.cardano, incoming: coming.cardano } } : {}),
    };
  }

  private async read(network: NetworkName): Promise<Reading> {
    const { wasm, wallet, session, now, contract = CONTRACT_V1 } = this.deps;
    const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;

    // Before what's spent is taken: a send after this may still be in the reading (incoming.ts).
    const spentAsOf = now();
    // Network calls happen outside withKeys, so they never hold up a lock.
    const [spent, stake] = await Promise.all([
      wallet.withKeys(() => spentSet(session)),
      wallet.withKeys(({ cardano }) => cardano.stakeAddress(net)),
    ]);
    const [{ account, utxos }, view, staking] = await Promise.all([
      readAccountUtxos(this.deps, network, spent),
      // The contract: in full when due, otherwise only what's new (contract-scan.ts).
      readContractView(this.deps, network),
      readStake(this.deps, network, stake),
    ]);
    const recorded = await this.mintRecord(network);

    // The result is cached only while still unlocked.
    const reading = await wallet.withKeys(async (keys): Promise<Reading> => {
      const held = await this.held(
        network,
        recorded,
        utxos.map((p) => p.utxo),
        keys.account,
      );
      const balances: Balances = {
        network,
        updatedAt: now(),
        spentAsOf,
        seedelf: this.seedelfSide(view.owned, contract.seedelfPolicyId, held),
        cardano: this.cardanoSide(account, utxos, staking),
      };
      // Activity reads the account's transactions against these.
      const addresses: AccountAddresses = { stake: account.stake, addresses: account.addresses, keys: [...account.paths.keys()] };
      if (await keep(session, network, balances, utxos, addresses)) return { balances };
      return { balances, unkept: { owned: view.owned, account: utxos, updatedAt: balances.updatedAt } };
    });
    // The history never holds up, or breaks, a balance reading.
    await this.deps.activity?.arrived(network, view.owned).catch(() => undefined);
    return reading;
  }

  /** `owned`: this wallet's contract UTxOs. `held`: what says who paid for each Seedelf. */
  private seedelfSide(owned: KoiosUtxo[], policyId: string, held: Held): Balances["seedelf"] {
    const seedelfs: SeedelfInfo[] = [];
    const spendable: KoiosUtxo[] = [];
    for (const utxo of owned) {
      const name = seedelfTokenOf(utxo, policyId);
      if (name) {
        const paid = paidByOf(utxo, name, { ...held, owned });
        seedelfs.push({
          assetName: name,
          label: seedelfLabel(name),
          lovelace: utxo.value,
          ...(paid ? { paidBy: paid.side } : {}),
          ...(paid?.account !== undefined ? { paidByAccount: paid.account } : {}),
        });
      }
      // One carrying a reference script can't be spent yet: see script-spend.ts's spendable.
      else if (!utxo.reference_script) spendable.push(utxo);
    }
    seedelfs.sort((a, b) => (a.label ?? "￿").localeCompare(b.label ?? "￿") || a.assetName.localeCompare(b.assetName));
    const { lovelace, tokens } = sumValue(spendable);
    return { lovelace: lovelace.toString(), tokens, utxos: spendable.length, seedelfs, locked: NOTHING };
  }

  private cardanoSide(account: Account, utxos: PathedUtxo[], staking: StakeInfo): Balances["cardano"] {
    const { lovelace, tokens } = sumValue(utxos.map((p) => p.utxo));
    return {
      lovelace: lovelace.toString(),
      tokens,
      utxos: utxos.length,
      addressesUsed: account.used,
      locked: NOTHING,
      staking,
    };
  }
}

/**
 * Keeps a reading for the next request, as contract-scan.ts keeps its view:
 * a write session storage refuses (it's full) never fails the reading, and
 * whether it was kept is returned. The addresses go first: they're small,
 * and Activity reads them. Then the balances, and the account's UTxOs, which
 * the UTxOs screen and what's locked read. If either can't be kept, neither
 * is, so nothing older is served in their place: the next request reads
 * again, and the lists say why they can't be shown (coin-control.ts).
 */
async function keep(
  session: Area,
  network: NetworkName,
  balances: Balances,
  utxos: PathedUtxo[],
  addresses: AccountAddresses,
): Promise<boolean> {
  const tooLarge = SESSION_TOO_LARGE_PREFIX + network;
  try {
    // A whole reading: neither side is behind.
    await session.remove(tooLarge, SESSION_PRIVATE_STALE_PREFIX + network);
    await session.set(SESSION_ACCOUNT_ADDRESSES_PREFIX + network, addresses);
    await session.set(SESSION_BALANCES_PREFIX + network, balances);
    await session.set(SESSION_ACCOUNT_UTXOS_PREFIX + network, utxos);
    return true;
  } catch {
    await session.remove(SESSION_BALANCES_PREFIX + network, SESSION_ACCOUNT_UTXOS_PREFIX + network).catch(() => undefined);
    await session.set(tooLarge, balances.updatedAt).catch(() => undefined);
    return false;
  }
}

/** Each token's decimals as Koios gave them in `utxos`, by `policy.asset`: what a transaction's outputs don't carry. */
function decimalsOf(utxos: KoiosUtxo[]): Map<string, number> {
  const found = new Map<string, number>();
  for (const u of utxos) {
    for (const a of u.asset_list ?? []) if (a.decimals) found.set(`${a.policy_id}.${a.asset_name}`, a.decimals);
  }
  return found;
}

/** The wallet-contract UTxOs whose register is ours (g^x == u, checked in WebAssembly). */
export function ownedUtxos(wasm: typeof Wasm, keys: Keys, utxos: KoiosUtxo[]): KoiosUtxo[] {
  return utxos.filter((utxo) => {
    const hex = registerOf(utxo);
    if (!hex) return false;
    const register = new wasm.Register(hex.generator, hex.publicValue);
    try {
      return keys.seedelf.isOwned(register);
    } catch {
      // Points that don't decode, or aren't in the prime-order subgroup, can't be ours to spend.
      return false;
    } finally {
      register.free();
    }
  });
}
