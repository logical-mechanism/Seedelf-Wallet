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
// since locking a UTxO doesn't read the chain again.
//
// The reading is cached per network in chrome.storage.session and wiped on lock.
// A reading that still lists a UTxO this wallet has spent came from a Koios
// backend that's behind (spent.ts): it's read again, a few times, and what's
// spent is left out either way.

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import type { Balances, Locked, SeedelfInfo, StakeInfo } from "../shared/rpc";
import { readAccountUtxos, type Account, type PathedUtxo } from "./account";
import { registerOf, seedelfLabel, seedelfTokenOf, sumValue } from "./chain";
import { SESSION_ACCOUNT_ADDRESSES_PREFIX, type AccountAddresses, type ActivityService } from "./activity";
import { SESSION_ACCOUNT_UTXOS_PREFIX, type CoinControlService } from "./coin-control";
import { readContractView } from "./contract-scan";
import type { Koios, KoiosUtxo } from "./koios";
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
}

const NOTHING: Locked = { lovelace: "0", tokens: [], utxos: 0 };

export class BalanceService {
  private readonly inFlight = new Map<NetworkName, Promise<Balances>>();

  constructor(private readonly deps: BalanceDeps) {}

  /** The cached reading, or a new one when there's none or `refresh` is set. Throws if locked. */
  async get(network: NetworkName, refresh = false): Promise<Balances> {
    return this.withLocked(network, await this.reading(network, refresh));
  }

  /** When the kept reading was made, without reading anything; undefined when there's none. Throws if locked. */
  async lastRead(network: NetworkName): Promise<number | undefined> {
    const cached = await this.deps.wallet.withKeys(() =>
      this.deps.session.get<Balances>(SESSION_BALANCES_PREFIX + network),
    );
    return cached?.updatedAt;
  }

  private async reading(network: NetworkName, refresh: boolean): Promise<Balances> {
    if (!refresh) {
      const cached = await this.deps.wallet.withKeys(() =>
        this.deps.session.get<Balances>(SESSION_BALANCES_PREFIX + network),
      );
      if (cached) return cached;
    }
    // Pages asking at the same time share one reading.
    let reading = this.inFlight.get(network);
    if (!reading) {
      reading = this.read(network).finally(() => this.inFlight.delete(network));
      this.inFlight.set(network, reading);
    }
    return reading;
  }

  /** The reading with what's locked on each side now. */
  private async withLocked(network: NetworkName, b: Balances): Promise<Balances> {
    const locked = await this.deps.coins.locked(network);
    return { ...b, seedelf: { ...b.seedelf, locked: locked.seedelf }, cardano: { ...b.cardano, locked: locked.cardano } };
  }

  private async read(network: NetworkName): Promise<Balances> {
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

    // The result is cached only while still unlocked.
    const balances = await wallet.withKeys(async () => {
      const balances: Balances = {
        network,
        updatedAt: now(),
        seedelf: this.seedelfSide(view.owned, contract.seedelfPolicyId),
        cardano: this.cardanoSide(account, utxos, staking),
      };
      await session.set(SESSION_BALANCES_PREFIX + network, balances);
      // The UTxOs screen and what's locked read these.
      await session.set(SESSION_ACCOUNT_UTXOS_PREFIX + network, utxos);
      // Activity reads the account's transactions against these.
      const addresses: AccountAddresses = { stake: account.stake, addresses: account.addresses };
      await session.set(SESSION_ACCOUNT_ADDRESSES_PREFIX + network, addresses);
      return balances;
    });
    // The history never holds up, or breaks, a balance reading.
    await this.deps.activity?.arrived(network, view.owned).catch(() => undefined);
    return balances;
  }

  /** `owned`: this wallet's contract UTxOs. */
  private seedelfSide(owned: KoiosUtxo[], policyId: string): Balances["seedelf"] {
    const seedelfs: SeedelfInfo[] = [];
    const spendable: KoiosUtxo[] = [];
    for (const utxo of owned) {
      const name = seedelfTokenOf(utxo, policyId);
      if (name) seedelfs.push({ assetName: name, label: seedelfLabel(name), lovelace: utxo.value });
      else spendable.push(utxo);
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
