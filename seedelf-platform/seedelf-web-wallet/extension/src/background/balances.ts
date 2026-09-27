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
// since locking a UTxO doesn't read the chain again. Each Seedelf says who
// paid for it, when the device knows (minted-by.ts), for Remove's default.
//
// The reading is cached per network in chrome.storage.session and wiped on lock.
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
import { readContractView } from "./contract-scan";
import type { Koios, KoiosUtxo } from "./koios";
import { mintedBy, paidByOf, type MintedBy } from "./minted-by";
import type { PrivateStore } from "./private-store";
import { spentSet } from "./spent";
import { readStake } from "./staking";
import type { Area } from "./storage";
import { SESSION_BALANCES_PREFIX, type Keys, type Wallet } from "./wallet";

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

  constructor(private readonly deps: BalanceDeps) {}

  /** The cached reading, or a new one when there's none or `refresh` is set. Throws if locked. */
  async get(network: NetworkName, refresh = false): Promise<Balances> {
    const { balances, unkept } = await this.reading(network, refresh);
    return this.withLocked(network, balances, unkept);
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
      const cached = await this.deps.wallet.withKeys(() =>
        this.deps.session.get<Balances>(SESSION_BALANCES_PREFIX + network),
      );
      if (cached) return { balances: cached };
    }
    // Pages asking at the same time share one reading.
    let reading = this.inFlight.get(network);
    if (!reading) {
      reading = this.read(network).finally(() => this.inFlight.delete(network));
      this.inFlight.set(network, reading);
    }
    return reading;
  }

  /** The reading with what's locked on each side now: from its own UTxOs, `unkept`, when it wasn't kept. */
  private async withLocked(network: NetworkName, b: Balances, unkept?: ReadingUtxos): Promise<Balances> {
    const locked = await this.deps.coins.locked(network, unkept);
    return { ...b, seedelf: { ...b.seedelf, locked: locked.seedelf }, cardano: { ...b.cardano, locked: locked.cardano } };
  }

  private async read(network: NetworkName): Promise<Reading> {
    const { wasm, wallet, session, now, contract = CONTRACT_V1 } = this.deps;
    const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;

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
    // Read on the device alone, never asked of Koios.
    const recorded: MintedBy = this.deps.store ? await mintedBy(this.deps.store, network).catch(() => ({})) : {};

    // The result is cached only while still unlocked.
    const reading = await wallet.withKeys(async (): Promise<Reading> => {
      const activity = await session.get<{ entries: Array<{ txHash: string }> }>(SESSION_ACCOUNT_ACTIVITY_PREFIX + network);
      const held: Held = {
        recorded,
        account: utxos.map((p) => p.utxo),
        accountTxs: new Set(activity?.entries.map((e) => e.txHash)),
      };
      const balances: Balances = {
        network,
        updatedAt: now(),
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
        const paidBy = paidByOf(utxo, name, { ...held, owned });
        seedelfs.push({ assetName: name, label: seedelfLabel(name), lovelace: utxo.value, ...(paidBy ? { paidBy } : {}) });
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
    await session.remove(tooLarge);
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
