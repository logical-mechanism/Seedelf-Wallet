// Reading the Cardano account: every UTxO under one of its payment keys,
// whatever the address's staking part. A base address, an enterprise address
// (no staking part), or our key paired with someone else's stake key: it's
// our money either way, and the wallet can spend it. What this wallet has
// already spent is left out (spent.ts), and each UTxO comes with its key's
// path for WebAssembly to sign (which checks the address's payment key
// against that path before signing).
//
// Which keys: the receive and change chains, walked with the gap limit over
// the addresses Koios lists under the account's stake key
// (`account_addresses`); then every payment key in that range is asked about
// by credential (`credential_utxos`). Two requests, one after the other, and a
// move-in, mint or send adds `epoch_params` alongside.
//
// To spend, what the user locked and the collateral are left out
// (coin-control.ts); the collateral comes back on its own, for a mint. When
// the user spends staking rewards (preferences.ts), `account_info` is read
// alongside too, and the whole reward balance rides along, if the account's
// vote is delegated: Conway pays out nothing otherwise.

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import { discoverChain } from "./chain";
import type { CoinControlService } from "./coin-control";
import type { Koios, KoiosAccountInfo, KoiosUtxo } from "./koios";
import type { PreferencesService } from "./preferences";
import { readFresh, spentSet, unspent } from "./spent";
import type { Area } from "./storage";
import type { Keys, Wallet } from "./wallet";

export interface AccountDeps {
  wasm: typeof Wasm;
  wallet: Wallet;
  session: Area;
  koios: (network: NetworkName) => Koios;
  /** Waits between reads of a Koios backend that's behind (spent.ts); tests don't. */
  sleep?: (ms: number) => Promise<void>;
}

/** Where a payment key sits: chain (0 receive, 1 change) and index. */
export interface KeyPath {
  role: 0 | 1;
  index: number;
}

export type PathedUtxo = { utxo: KoiosUtxo } & KeyPath;

/** The account's keys in range, as discovery found them. */
export interface Account {
  stake: string;
  /** Each payment key hash (hex) in range, with its path. */
  paths: Map<string, KeyPath>;
  /** The base addresses in range, for Activity. */
  addresses: string[];
  /** How many of them have been used. */
  used: number;
}

/**
 * The receive and change chains, each walked from index 0 until 20
 * addresses in a row are unused. `used` is the set of addresses Koios lists
 * under the account's stake key.
 */
export function discoverAccount(keys: Keys, net: Wasm.Network, used: ReadonlySet<string>): Omit<Account, "stake"> {
  const receive = discoverChain(used, (i) => keys.cardano.receiveAddress(net, i));
  const change = discoverChain(used, (i) => keys.cardano.changeAddress(net, i));
  const paths = new Map<string, KeyPath>();
  receive.addresses.forEach((_, index) => paths.set(keys.cardano.paymentKeyHash(0, index), { role: 0, index }));
  change.addresses.forEach((_, index) => paths.set(keys.cardano.paymentKeyHash(1, index), { role: 1, index }));
  return { paths, addresses: [...receive.addresses, ...change.addresses], used: receive.used + change.used };
}

/** The account's keys, and every unspent UTxO under them. */
export async function readAccountUtxos(
  deps: AccountDeps,
  network: NetworkName,
  spent: ReadonlySet<string>,
): Promise<{ account: Account; utxos: PathedUtxo[] }> {
  const { wasm, wallet } = deps;
  const koios = deps.koios(network);
  const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
  // Network calls happen outside withKeys, so they never hold up a lock.
  const stake = await wallet.withKeys(({ cardano }) => cardano.stakeAddress(net));
  const [found, rows] = await readFresh(
    spent,
    async () => {
      const used = await koios.accountAddresses(stake);
      const found = await wallet.withKeys((keys) => discoverAccount(keys, net, new Set(used)));
      return [found, await koios.credentialUtxos([...found.paths.keys()])] as const;
    },
    ([, rows]) => rows,
    deps.sleep,
  );
  const utxos = unspent(rows, spent).flatMap((utxo) => {
    const path = utxo.payment_cred ? found.paths.get(utxo.payment_cred) : undefined;
    return path ? [{ utxo, ...path }] : [];
  });
  return { account: { ...found, stake }, utxos };
}

/** Why the account has nothing to pay with: `held` from readAccount, `empty` for an empty account. */
export function nothingInAccount(held: number, empty: string): Error {
  return new Error(
    held
      ? "Everything in your Cardano account is locked or is its collateral. Unlock a UTxO on its UTxOs screen first."
      : empty,
  );
}

export interface SpendingAccount {
  params: Record<string, unknown>;
  /** What may be spent: not locked, not the collateral. */
  utxos: PathedUtxo[];
  collateral?: PathedUtxo;
  /** How many UTxOs the account holds in all. */
  held: number;
  /** The stake key's standing, when it was read; undefined too when it was never registered. */
  stake?: KoiosAccountInfo;
  /** The rewards to withdraw along with the payment (lovelace), when the user spends them and can. */
  withdrawal?: string;
}

/**
 * To spend from the account (a move-in, an account-paid mint, a send, a
 * staking transaction): the UTxOs that may be spent, fresh, the collateral,
 * and the protocol parameters. The stake key is read too for `stake`, or
 * when the user spends rewards.
 */
export async function readAccount(
  deps: AccountDeps & { coins: CoinControlService; preferences?: PreferencesService },
  network: NetworkName,
  { stake: readStake = false } = {},
): Promise<SpendingAccount> {
  const { wasm, wallet } = deps;
  const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
  const [spent, stakeAddress, preferences] = await Promise.all([
    wallet.withKeys(() => spentSet(deps.session)),
    wallet.withKeys(({ cardano }) => cardano.stakeAddress(net)),
    deps.preferences?.get(),
  ]);
  const spendRewards = preferences?.spendRewards ?? false;
  const koios = deps.koios(network);
  const [{ utxos }, params, stake] = await Promise.all([
    readAccountUtxos(deps, network, spent),
    koios.epochParams(),
    readStake || spendRewards ? koios.accountInfo(stakeAddress) : undefined,
  ]);
  const { spendable, collateral } = await deps.coins.account(network, utxos);
  const withdrawable =
    spendRewards && stake?.status === "registered" && stake.delegated_drep && BigInt(stake.rewards_available) > 0n;
  return {
    params,
    utxos: spendable,
    collateral,
    held: utxos.length,
    stake,
    ...(withdrawable ? { withdrawal: stake.rewards_available } : {}),
  };
}
