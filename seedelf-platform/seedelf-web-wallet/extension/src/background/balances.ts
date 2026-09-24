// Balances: read the chain through Koios and work out what this wallet owns.
//
// Seedelf side: every UTxO in the wallet contract, kept when the register in
// its datum is ours (g^x == u, checked in WebAssembly). The contract is read
// in full only when due, otherwise from the last block seen (contract-scan.ts). This is what the CLI's
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
// A reading that still lists a UTxO this wallet has spent came from a Koios
// backend that's behind (spent.ts): it's read again, a few times, and what's
// spent is left out either way.

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import type { Balances, SeedelfInfo } from "../shared/rpc";
import { discoverChain, registerOf, seedelfLabel, seedelfTokenOf, sumValue } from "./chain";
import { SESSION_ACCOUNT_ADDRESSES_PREFIX, type AccountAddresses, type ActivityService } from "./activity";
import { readContractView } from "./contract-scan";
import type { Koios, KoiosUtxo } from "./koios";
import { readFresh, spentSet, unspent } from "./spent";
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
    const [stake, spent] = await wallet.withKeys(
      async ({ cardano }) => [cardano.stakeAddress(net), await spentSet(session)] as const,
    );
    const [[usedAddresses, accountRead], view] = await Promise.all([
      readFresh(
        spent,
        () => Promise.all([koios.accountAddresses(stake), koios.accountUtxos(stake)]),
        ([, account]) => account,
        this.deps.sleep,
      ),
      // The contract: in full when due, otherwise only what's new (contract-scan.ts).
      readContractView(this.deps, network),
    ]);
    const accountUtxos = unspent(accountRead, spent);

    // The result is cached only while still unlocked.
    const balances = await wallet.withKeys(async (keys) => {
      const account = discoverAccount(keys, net, new Set(usedAddresses));
      const balances: Balances = {
        network,
        updatedAt: now(),
        seedelf: this.seedelfSide(view.owned, contract.seedelfPolicyId),
        cardano: this.cardanoSide(account, accountUtxos),
      };
      await session.set(SESSION_BALANCES_PREFIX + network, balances);
      // Activity reads the account's transactions against these.
      const addresses: AccountAddresses = { stake, addresses: [...account.paths.keys()] };
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
    return { lovelace: lovelace.toString(), tokens, utxos: spendable.length, seedelfs };
  }

  private cardanoSide(account: ReturnType<typeof discoverAccount>, utxos: KoiosUtxo[]): Balances["cardano"] {
    const mine = utxos.filter((u) => account.paths.has(u.address));
    const { lovelace, tokens } = sumValue(mine);
    return {
      lovelace: lovelace.toString(),
      tokens,
      utxos: mine.length,
      addressesUsed: account.used,
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

/** The account's UTxOs at addresses it derived, each with its key's path, for WebAssembly to sign. */
export function pathedUtxos(
  keys: Keys,
  net: Wasm.Network,
  used: ReadonlySet<string>,
  utxos: KoiosUtxo[],
): Array<{ utxo: KoiosUtxo } & KeyPath> {
  const { paths } = discoverAccount(keys, net, used);
  return utxos.flatMap((utxo) => {
    const path = paths.get(utxo.address);
    return path ? [{ utxo, ...path }] : [];
  });
}

/** Where an account address sits: chain (0 receive, 1 change) and index. */
export interface KeyPath {
  role: 0 | 1;
  index: number;
}

/**
 * The Cardano account's addresses, found with the gap limit on the receive
 * and change chains, each with its path. `used` is the set of addresses Koios
 * lists under the account's stake key.
 */
export function discoverAccount(
  keys: Keys,
  net: Wasm.Network,
  used: ReadonlySet<string>,
): { paths: Map<string, KeyPath>; used: number } {
  const receive = discoverChain(used, (i) => keys.cardano.receiveAddress(net, i));
  const change = discoverChain(used, (i) => keys.cardano.changeAddress(net, i));
  const paths = new Map<string, KeyPath>();
  receive.addresses.forEach((a, index) => paths.set(a, { role: 0, index }));
  change.addresses.forEach((a, index) => paths.set(a, { role: 1, index }));
  return { paths, used: receive.used + change.used };
}
