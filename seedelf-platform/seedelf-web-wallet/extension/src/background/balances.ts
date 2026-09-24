// Balances: read the chain through Koios and work out what this wallet owns.
//
// Seedelf side: every UTxO in the wallet contract, kept when the register in
// its datum is ours (g^x == u, checked in WebAssembly). This is what the CLI's
// `balance` does, and UTxOs holding a seedelf are listed as seedelfs rather
// than counted in the balance, also as in the CLI.
//
// Cardano side: the addresses that have used the account's stake key, walked
// with the gap limit along the receive and change chains, then the account's
// UTxOs, keeping only those at addresses this wallet derived. Anyone can pair
// their own payment key or script with our stake key, so the stake key alone
// proves nothing.
//
// The reading is cached per network in chrome.storage.session and wiped on lock.

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import type { Balances, SeedelfInfo } from "../shared/rpc";
import { discoverChain, registerOf, seedelfLabel, seedelfTokenOf, sumValue } from "./chain";
import type { Koios, KoiosUtxo } from "./koios";
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
}

export class BalanceService {
  private readonly inFlight = new Map<NetworkName, Promise<Balances>>();

  constructor(private readonly deps: BalanceDeps) {}

  /** The cached reading, or a new one when there's none or `refresh` is set. Throws if locked. */
  async get(network: NetworkName, refresh = false): Promise<Balances> {
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

  private async read(network: NetworkName): Promise<Balances> {
    const { wasm, wallet, session, now, contract = CONTRACT_V1 } = this.deps;
    const koios = this.deps.koios(network);
    const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;

    // Network calls happen outside withKeys, so they never hold up a lock.
    const stake = await wallet.withKeys(({ cardano }) => cardano.stakeAddress(net));
    const [usedAddresses, accountUtxos, contractUtxos] = await Promise.all([
      koios.accountAddresses(stake),
      koios.accountUtxos(stake),
      koios.credentialUtxos([contract.walletContractHash]),
    ]);

    // Ownership is decided, and the result cached, only while still unlocked.
    return wallet.withKeys(async (keys) => {
      const balances: Balances = {
        network,
        updatedAt: now(),
        seedelf: this.seedelfSide(keys, contractUtxos, contract.seedelfPolicyId),
        cardano: this.cardanoSide(keys, net, new Set(usedAddresses), accountUtxos),
      };
      await session.set(SESSION_BALANCES_PREFIX + network, balances);
      return balances;
    });
  }

  private seedelfSide(keys: Keys, utxos: KoiosUtxo[], policyId: string): Balances["seedelf"] {
    const seedelfs: SeedelfInfo[] = [];
    const spendable: KoiosUtxo[] = [];
    for (const utxo of utxos.filter((u) => this.isOwned(keys, u))) {
      const name = seedelfTokenOf(utxo, policyId);
      if (name) seedelfs.push({ assetName: name, label: seedelfLabel(name), lovelace: utxo.value });
      else spendable.push(utxo);
    }
    seedelfs.sort((a, b) => (a.label ?? "￿").localeCompare(b.label ?? "￿") || a.assetName.localeCompare(b.assetName));
    const { lovelace, tokens } = sumValue(spendable);
    return { lovelace: lovelace.toString(), tokens, utxos: spendable.length, seedelfs };
  }

  private isOwned(keys: Keys, utxo: KoiosUtxo): boolean {
    const hex = registerOf(utxo);
    if (!hex) return false;
    const register = new this.deps.wasm.Register(hex.generator, hex.publicValue);
    try {
      return keys.seedelf.isOwned(register);
    } catch {
      // Points that don't decode, or aren't in the prime-order subgroup, can't be ours to spend.
      return false;
    } finally {
      register.free();
    }
  }

  private cardanoSide(
    keys: Keys,
    net: Wasm.Network,
    used: ReadonlySet<string>,
    utxos: KoiosUtxo[],
  ): Balances["cardano"] {
    const receive = discoverChain(used, (i) => keys.cardano.receiveAddress(net, i));
    const change = discoverChain(used, (i) => keys.cardano.changeAddress(net, i));
    const ours = new Set([...receive.addresses, ...change.addresses]);
    const mine = utxos.filter((u) => ours.has(u.address));
    const { lovelace, tokens } = sumValue(mine);
    return {
      lovelace: lovelace.toString(),
      tokens,
      utxos: mine.length,
      addressesUsed: receive.used + change.used,
    };
  }
}
