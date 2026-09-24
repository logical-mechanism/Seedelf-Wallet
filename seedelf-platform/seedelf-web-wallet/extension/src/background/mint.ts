// Create a seedelf. A mint links the seedelf to whatever pays for it
// (privacy.md, Known links), so there are two ways to pay:
//
// account  The Cardano account pays (the CLI's `create`, `build::account_mint`).
//          The default: minted before any move-in, the seedelf is linked to
//          the account openly, and money moved in afterwards looks like
//          paying anyone's seedelf. Its own UTxO is the collateral, and
//          WebAssembly signs it with the account's keys at review, like a
//          move-in; Send only submits.
// seedelf  A stealth mint from the Seedelf balance (the CLI's `util mint`,
//          `build::mint`). It only hides the payer when that balance came
//          from other people's Seedelf payments.
//
// Both are built by script-spend.ts's draft → Ogmios → finish, and kept in
// session storage until Send: signed for the account, unsigned with its
// one-time key's seed for a stealth mint, which giveme.my witnesses at Send.

import type { NetworkName } from "../networks";
import type { MintSource, MintSummary, PendingTx } from "../shared/rpc";
import { pathedUtxos } from "./balances";
import { keep, measure, readContract, send, spendable, type ScriptSpendDeps } from "./script-spend";

/** chrome.storage.session: the mint built last, until it's sent or replaced. */
export const SESSION_MINT = "seedelf.mint.built";

type MintResult = Omit<MintSummary, "network" | "label" | "inputs" | "from"> & {
  txCbor: string;
  seed?: string;
  inputs: unknown[];
  collateral?: unknown;
};

export type MintDeps = ScriptSpendDeps;

export class MintService {
  constructor(private readonly deps: MintDeps) {}

  build(network: NetworkName, label: string, from: MintSource): Promise<MintSummary> {
    return from === "account" ? this.buildFromAccount(network, label) : this.buildStealth(network, label);
  }

  private async buildFromAccount(network: NetworkName, label: string): Promise<MintSummary> {
    const { wasm, wallet } = this.deps;
    const koios = this.deps.koios(network);
    const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;

    // Fresh chain state, read outside the wallet's queue.
    const stake = await wallet.withKeys(({ cardano }) => cardano.stakeAddress(net));
    const [used, utxos, params] = await Promise.all([
      koios.accountAddresses(stake),
      koios.accountUtxos(stake),
      koios.epochParams(),
    ]);
    const request = await wallet.withKeys((keys) => ({
      network,
      params,
      label,
      utxos: pathedUtxos(keys, net, new Set(used), utxos),
    }));
    if (request.utxos.length === 0) {
      throw new Error("Your Cardano account is empty. Fund it first; the seedelf is paid from there.");
    }

    const finished = await measure<MintResult>(
      this.deps,
      network,
      request,
      (keys, r) => wasm.draftAccountMint(keys.cardano, keys.seedelf, r),
      (keys, r) => wasm.finishAccountMint(keys.cardano, keys.seedelf, r),
    );
    return this.keep(network, label, "account", finished);
  }

  private async buildStealth(network: NetworkName, label: string): Promise<MintSummary> {
    const { wasm, wallet } = this.deps;
    const { contractUtxos, params } = await readContract(this.deps, network);
    const request = await wallet.withKeys((keys) => ({
      network,
      params,
      label,
      utxos: spendable(this.deps, keys, contractUtxos),
    }));
    if (request.utxos.length === 0) {
      throw new Error("Your Seedelf balance is empty. Move some ADA in first; the seedelf is paid from there.");
    }

    const finished = await measure<MintResult>(
      this.deps,
      network,
      request,
      (keys, r) => wasm.draftMint(keys.seedelf, r),
      (keys, r) => wasm.finishMint(keys.seedelf, r),
    );
    return this.keep(network, label, "seedelf", finished);
  }

  private async keep(network: NetworkName, label: string, from: MintSource, finished: MintResult): Promise<MintSummary> {
    const { txCbor, seed, inputs, collateral: _collateral, ...rest } = finished;
    const summary: MintSummary = { ...rest, network, label, from, inputs: inputs.length };
    await keep(this.deps, SESSION_MINT, { ...summary, txCbor, seed });
    return summary;
  }

  /** For a stealth mint, giveme.my first witnesses the collateral; an account-paid one was signed at review. */
  submit(network: NetworkName, txHash: string): Promise<PendingTx> {
    return send(this.deps, network, txHash, SESSION_MINT, "mint", "seedelf");
  }
}
