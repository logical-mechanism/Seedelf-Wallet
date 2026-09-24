// Transfer: pay someone's seedelf from the Seedelf balance. The equivalent of
// the CLI's `transfer`, built by the same core code (`build::transfer`)
// through WebAssembly, and sent like every Seedelf spend (script-spend.ts).
//
// lookup  a seedelf is found by its full name in the whole wallet contract:
//         the credential_utxos query a balance reading already makes. Koios
//         is never asked about the recipient's token (asset_utxos and the
//         like): that would tell it exactly who is being paid.
// build   the same lookup, fresh. WebAssembly checks the recipient's UTxO (in
//         the contract, holding that seedelf, under a register), pays a new
//         re-randomization of that register, picks the Seedelf UTxOs that
//         pay, and drafts under a new one-time key. Paying one of your own
//         seedelfs is allowed, and flagged.
// submit  giveme.my witnesses the collateral, then Koios submits exactly the
//         reviewed transaction.

import type { NetworkName } from "../networks";
import type { PendingTx, SeedelfLookup, TokenQuantity, TransferSummary } from "../shared/rpc";
import { SEEDELF_NAME_RULE, seedelfName } from "../shared/seedelf-name";
import { CONTRACT_V1, ownedUtxos } from "./balances";
import { seedelfLabel } from "./chain";
import type { KoiosUtxo } from "./koios";
import { keep, measure, readContract, send, spendable, type ScriptSpendDeps } from "./script-spend";

/** chrome.storage.session: the transfer built last, until it's sent or replaced. */
export const SESSION_TRANSFER = "seedelf.transfer.built";

type TransferResult = Omit<TransferSummary, "network" | "label" | "inputs"> & {
  txCbor: string;
  seed: string;
  inputs: unknown[];
};

export class TransferService {
  constructor(private readonly deps: ScriptSpendDeps) {}

  /** The seedelf named `to`, if the wallet contract holds it. */
  async lookup(network: NetworkName, to: string): Promise<SeedelfLookup> {
    const name = nameOf(to);
    const { contract = CONTRACT_V1 } = this.deps;
    const utxos = await this.deps.koios(network).credentialUtxos([contract.walletContractHash]);
    const utxo = this.find(utxos, name, network);
    const own = await this.deps.wallet.withKeys((keys) => ownedUtxos(this.deps.wasm, keys, [utxo]).length > 0);
    return { name, label: seedelfLabel(name), own };
  }

  async build(network: NetworkName, to: string, lovelace: string, tokens: TokenQuantity[]): Promise<TransferSummary> {
    const { wasm, wallet } = this.deps;
    const name = nameOf(to);
    const { contractUtxos, params } = await readContract(this.deps, network);
    const recipient = this.find(contractUtxos, name, network);
    const request = await wallet.withKeys((keys) => ({
      network,
      params,
      utxos: spendable(this.deps, keys, contractUtxos),
      to: name,
      recipient,
      lovelace,
      tokens,
    }));
    if (request.utxos.length === 0) {
      throw new Error("Your Seedelf balance is empty. Move some ADA in first; transfers are paid from there.");
    }

    const finished = await measure<TransferResult>(
      this.deps,
      network,
      request,
      (keys, r) => wasm.draftTransfer(keys.seedelf, r),
      (keys, r) => wasm.finishTransfer(keys.seedelf, r),
    );
    const { txCbor, seed, inputs, ...rest } = finished;
    const summary: TransferSummary = { ...rest, network, label: seedelfLabel(name), inputs: inputs.length };
    await keep(this.deps, SESSION_TRANSFER, { ...summary, txCbor, seed });
    return summary;
  }

  submit(network: NetworkName, txHash: string): Promise<PendingTx> {
    return send(this.deps, network, txHash, SESSION_TRANSFER, "transfer", "transfer");
  }

  /** The contract UTxO holding the seedelf `name`, found locally. */
  private find(utxos: KoiosUtxo[], name: string, network: NetworkName): KoiosUtxo {
    const { contract = CONTRACT_V1 } = this.deps;
    const utxo = utxos.find((u) =>
      u.asset_list?.some((a) => a.policy_id === contract.seedelfPolicyId && a.asset_name === name),
    );
    if (!utxo) throw new Error(`No seedelf with that name on ${network}.`);
    return utxo;
  }
}

function nameOf(to: string): string {
  const name = seedelfName(to);
  if (!name) throw new Error(SEEDELF_NAME_RULE);
  return name;
}
