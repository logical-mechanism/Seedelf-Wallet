// Reading the Cardano account to spend from it (a move-in, an account-paid
// mint, a send): its UTxOs, fresh and less what this wallet has already
// spent (spent.ts), each with its key's path for WebAssembly to sign, and the
// protocol parameters. Three Koios requests: account_addresses,
// account_utxos and epoch_params.

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import { pathedUtxos, type KeyPath } from "./balances";
import type { Koios, KoiosUtxo } from "./koios";
import { readFresh, spentSet, unspent } from "./spent";
import type { Area } from "./storage";
import type { Wallet } from "./wallet";

export interface AccountDeps {
  wasm: typeof Wasm;
  wallet: Wallet;
  session: Area;
  koios: (network: NetworkName) => Koios;
  /** Waits between reads of a Koios backend that's behind (spent.ts); tests don't. */
  sleep?: (ms: number) => Promise<void>;
}

export type PathedUtxo = { utxo: KoiosUtxo } & KeyPath;

export async function readAccount(
  deps: AccountDeps,
  network: NetworkName,
): Promise<{ params: Record<string, unknown>; utxos: PathedUtxo[] }> {
  const { wasm, wallet, session } = deps;
  const koios = deps.koios(network);
  const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;

  // Fresh chain state, read outside the wallet's queue.
  const [stake, spent] = await wallet.withKeys(
    async ({ cardano }) => [cardano.stakeAddress(net), await spentSet(session)] as const,
  );
  const [used, utxos, params] = await readFresh(
    spent,
    () => Promise.all([koios.accountAddresses(stake), koios.accountUtxos(stake), koios.epochParams()]),
    ([, utxos]) => utxos,
    deps.sleep,
  );
  const pathed = await wallet.withKeys((keys) => pathedUtxos(keys, net, new Set(used), unspent(utxos, spent)));
  return { params, utxos: pathed };
}
