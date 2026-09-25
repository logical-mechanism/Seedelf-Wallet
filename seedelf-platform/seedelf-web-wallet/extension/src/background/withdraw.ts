// Withdraw: take money out of the Seedelf balance. Both are Seedelf script
// spends, built and sent by script-spend.ts:
//
// send    to any normal addresses or ADA Handles (the CLI's `sweep`), up to
//         20 in one transaction: an amount with optional tokens for each, or
//         everything to a single one (Max, 20 UTxOs at most). The change goes
//         back into the Seedelf balance.
// remove  one of this wallet's seedelfs (the CLI's `remove`): the token is
//         burned, and the ADA locked with it goes to the Cardano account's
//         0/0 or back into the Seedelf balance. Returning it to whatever paid
//         for the mint links nothing new.
//
// The destination is read by destination.ts: an address, or a handle looked
// up through Koios.

import type { NetworkName } from "../networks";
import type {
  Paid,
  PaymentAsk,
  PendingTx,
  RemoveSummary,
  RemoveTo,
  WithdrawDestination,
  WithdrawSummary,
} from "../shared/rpc";
import { checkRecipients } from "../shared/recipients";
import { seedelfName } from "../shared/seedelf-name";
import { seedelfLabel } from "./chain";
import { resolveDestination } from "./destination";
import { keep, measure, nothingToSpend, readContract, send, type ScriptSpendDeps } from "./script-spend";

/** chrome.storage.session: the withdrawal built last, until it's sent or replaced. */
export const SESSION_WITHDRAW = "seedelf.withdraw.built";
/** chrome.storage.session: the removal built last, until it's sent or replaced. */
export const SESSION_REMOVE = "seedelf.remove.built";

type WithdrawResult = Omit<WithdrawSummary, "network" | "payments" | "inputs"> & {
  txCbor: string;
  seed: string;
  payments: Array<Paid & { to: string }>;
  inputs: unknown[];
};

type RemoveResult = Omit<RemoveSummary, "network" | "label" | "to"> & {
  txCbor: string;
  seed: string;
  /** The address paid, or null for the Seedelf balance. */
  to: string | null;
  inputs: unknown[];
};

export class WithdrawService {
  constructor(private readonly deps: ScriptSpendDeps) {}

  /** A destination as typed: a bech32 address, or `$handle`. */
  resolve(network: NetworkName, to: string): Promise<WithdrawDestination> {
    return resolveDestination(this.deps, network, to);
  }

  /** Pays each of `payments`, addresses or handles, in one transaction; `lovelace` null is Max, to a single one. */
  async build(network: NetworkName, payments: PaymentAsk[]): Promise<WithdrawSummary> {
    const { wasm } = this.deps;
    checkRecipients(payments.length);
    const destinations: WithdrawDestination[] = [];
    for (const p of payments) destinations.push(await this.resolve(network, p.to));
    const { view, utxos, params } = await readContract(this.deps, network);
    const request = {
      network,
      params,
      utxos,
      payments: payments.map((p, i) => ({ to: destinations[i]!.address, lovelace: p.lovelace, tokens: p.tokens })),
    };
    if (request.utxos.length === 0) {
      throw nothingToSpend(this.deps, view, "Your Seedelf balance is empty, so there's nothing to withdraw.");
    }
    const finished = await measure<WithdrawResult>(
      this.deps,
      network,
      request,
      (keys, r) => wasm.draftWithdraw(keys.seedelf, r),
      (keys, r) => wasm.finishWithdraw(keys.seedelf, r),
    );
    const { txCbor, seed, inputs, payments: paid, ...rest } = finished;
    const summary: WithdrawSummary = {
      ...rest,
      network,
      payments: paid.map(({ to: _to, ...p }, i) => ({ ...destinations[i]!, ...p })),
      inputs: inputs.length,
    };
    await keep(this.deps, SESSION_WITHDRAW, { ...summary, txCbor, seed });
    return summary;
  }

  submit(network: NetworkName, txHash: string): Promise<PendingTx> {
    return send(this.deps, network, txHash, SESSION_WITHDRAW, "withdraw", "withdrawal");
  }

  /** Builds the removal of the seedelf `name`; its ADA goes `to` the account's 0/0 or the Seedelf balance. */
  async buildRemove(network: NetworkName, name: string, to: RemoveTo): Promise<RemoveSummary> {
    const { wasm, wallet } = this.deps;
    const seedelf = seedelfName(name);
    if (!seedelf) throw new Error("That isn't a Seedelf's name.");
    const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
    const { view, params } = await readContract(this.deps, network);
    // Any seedelf is found; WebAssembly refuses one that isn't this wallet's.
    const utxo = view.seedelfs[seedelf];
    if (!utxo) throw new Error(`No Seedelf with that name on ${network}. It may be removed already.`);
    const request = await wallet.withKeys((keys) => ({
      network,
      params,
      utxo,
      to: to === "account" ? keys.cardano.receiveAddress(net, 0) : null,
    }));
    const finished = await measure<RemoveResult>(
      this.deps,
      network,
      request,
      (keys, r) => wasm.draftRemove(keys.seedelf, r),
      (keys, r) => wasm.finishRemove(keys.seedelf, r),
    );
    const { txCbor, seed, inputs: _inputs, to: _to, ...rest } = finished;
    const summary: RemoveSummary = { ...rest, network, label: seedelfLabel(seedelf), to };
    await keep(this.deps, SESSION_REMOVE, { ...summary, txCbor, seed });
    return summary;
  }

  submitRemove(network: NetworkName, txHash: string): Promise<PendingTx> {
    return send(this.deps, network, txHash, SESSION_REMOVE, "remove", "removal");
  }
}
