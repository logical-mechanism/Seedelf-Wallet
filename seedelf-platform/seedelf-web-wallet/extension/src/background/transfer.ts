// Transfer: pay someone's seedelf from the Seedelf balance. The equivalent of
// the CLI's `transfer`, built by the same core code (`build::transfer`)
// through WebAssembly, and sent like every Seedelf spend (script-spend.ts).
//
// lookup  a seedelf is found by its full name in the wallet contract, as
//         the balance reading sees it (contract-scan.ts). Koios is never asked
//         about the recipient's token (asset_utxos and the like): that would
//         tell it exactly who is being paid.
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
import { seedelfLabel } from "./chain";
import { readContractView, type ContractView } from "./contract-scan";
import type { KoiosUtxo } from "./koios";
import { keep, measure, nothingToSpend, readContract, send, type ScriptSpendDeps } from "./script-spend";
import { outpoint } from "./spent";

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
    const view = await readContractView(this.deps, network);
    const utxo = find(view, name, network);
    const own = view.owned.some((u) => outpoint(u) === outpoint(utxo));
    return { name, label: seedelfLabel(name), own };
  }

  async build(network: NetworkName, to: string, lovelace: string, tokens: TokenQuantity[]): Promise<TransferSummary> {
    const { wasm } = this.deps;
    const name = nameOf(to);
    const { view, utxos, params } = await readContract(this.deps, network);
    const recipient = find(view, name, network);
    const request = { network, params, utxos, to: name, recipient, lovelace, tokens };
    if (request.utxos.length === 0) {
      throw nothingToSpend(this.deps, view, "Your Seedelf balance is empty. Move some ADA in first; transfers are paid from there.");
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

}

/** The contract UTxO holding the seedelf `name`, found locally. */
function find(view: ContractView, name: string, network: NetworkName): KoiosUtxo {
  const utxo = view.seedelfs[name];
  if (!utxo) throw new Error(`No seedelf with that name on ${network}.`);
  return utxo;
}

function nameOf(to: string): string {
  const name = seedelfName(to);
  if (!name) throw new Error(SEEDELF_NAME_RULE);
  return name;
}
