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

import { t } from "../i18n";
import type { NetworkName } from "../networks";
import type {
  LeftOutUtxo,
  Paid,
  PaymentAsk,
  PendingTx,
  RemoveSummary,
  RemoveTo,
  WithdrawDestination,
  WithdrawSummary, BuildStage } from "../shared/rpc";
import { checkRecipients } from "../shared/recipients";
import { seedelfName } from "../shared/seedelf-name";
import { seedelfLabel } from "./chain";
import { destinationResolver, resolveDestination } from "./destination";
import { settleMaybeSent } from "./pending";
import { privateShort, privateShortOf } from "./short";
import {
  changeHistory,
  classesOf,
  keep,
  measureLocally,
  nothingToSpend,
  readContract,
  send,
  spentHistories,
  unspendable,
  type OutRef,
  type ScriptSpendDeps,
} from "./script-spend";

/** chrome.storage.session: the withdrawal built last, until it's sent or replaced. */
export const SESSION_WITHDRAW = "seedelf.withdraw.built";
/** chrome.storage.session: the removal built last, until it's sent or replaced. */
export const SESSION_REMOVE = "seedelf.remove.built";

type WithdrawResult = Omit<WithdrawSummary, "network" | "payments" | "inputs" | "histories"> & {
  txCbor: string;
  seed: string;
  payments: Array<Paid & { to: string }>;
  inputs: OutRef[];
  classesMixed: string[];
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
  async build(network: NetworkName, payments: PaymentAsk[], progress?: (stage: BuildStage) => void): Promise<WithdrawSummary> {
    const { wasm } = this.deps;
    checkRecipients(payments.length);
    const resolve = destinationResolver(this.deps, network);
    const destinations: WithdrawDestination[] = [];
    for (const p of payments) destinations.push(await resolve(p.to));
    progress?.("checking");
    await settleMaybeSent(this.deps, network);
    progress?.("reading");
    const { view, utxos, params, returning, classes } = await readContract(this.deps, network);
    const request = {
      network,
      params,
      utxos,
      classes,
      payments: payments.map((p, i) => ({ to: destinations[i]!.address, lovelace: p.lovelace, tokens: p.tokens })),
    };
    if (request.utxos.length === 0) {
      throw nothingToSpend(this.deps, view, t("worker.withdraw.empty"), returning);
    }
    progress?.("measuring");
    const measured = (r: typeof request & { most?: boolean }) =>
      measureLocally<WithdrawResult>(this.deps, r, (keys, json) => wasm.buildWithdraw(keys.seedelf, json));
    // Core's shortfall in the user's words, with what has to stay and the most an amount can be, the tokens not
    // sent staying: built again on the same UTxOs (blind test §4.4, T05; chunk 23's second review, PY-10). Max
    // itself sends every token, so that isn't its figure when a token stays.
    const finished = await measured(request).catch(async (e: unknown) => {
      const available = utxos.reduce((sum, u) => sum + BigInt(u.value), 0n);
      const most = () => measured({ ...request, most: true, payments: [{ ...request.payments[0]!, lovelace: null }] });
      throw await privateShortOf(e, request.payments.map((p) => p.lovelace), most, available);
    });
    const { txCbor, seed, inputs, payments: paid, classesMixed, ...rest } = finished;
    const histories = spentHistories(classes, inputs, classesMixed);
    // Max says what no Seedelf spend can take, which the private balance leaves out too, and what a
    // return through Lovejoin being sent will spend (final review lovejoin-3).
    const leftOut: LeftOutUtxo[] = finished.max
      ? [
          ...unspendable(this.deps, view).map((u) => ({ txHash: u.tx_hash, txIndex: u.tx_index, reason: "script" as const })),
          ...returning.map((u) => ({ txHash: u.tx_hash, txIndex: u.tx_index, reason: "returning" as const })),
        ]
      : [];
    const summary: WithdrawSummary = {
      ...rest,
      network,
      payments: paid.map(({ to: _to, ...p }, i) => ({ ...destinations[i]!, ...p })),
      inputs: inputs.length,
      ...(leftOut.length ? { leftOut } : {}),
      ...(histories ? { histories } : {}),
    };
    await keep(this.deps, SESSION_WITHDRAW, { ...summary, txCbor, seed, origin: changeHistory(classes, inputs) });
    return summary;
  }

  submit(network: NetworkName, txHash: string): Promise<PendingTx> {
    return send(this.deps, network, txHash, SESSION_WITHDRAW, "withdraw", "payment");
  }

  /** Builds the removal of the seedelf `name`; its ADA goes `to` the account's 0/0 or the Seedelf balance. */
  async buildRemove(
    network: NetworkName,
    name: string,
    to: RemoveTo,
    progress?: (stage: BuildStage) => void,
  ): Promise<RemoveSummary> {
    const { wasm, wallet } = this.deps;
    const seedelf = seedelfName(name);
    if (!seedelf) throw new Error(t("worker.withdraw.notASeedelf"));
    const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
    progress?.("checking");
    await settleMaybeSent(this.deps, network);
    progress?.("reading");
    const { view, params } = await readContract(this.deps, network);
    // Any seedelf is found; WebAssembly refuses one that isn't this wallet's.
    const utxo = view.seedelfs[seedelf];
    if (!utxo) throw new Error(t("worker.seedelf.notFoundMaybeRemoved", { network }));
    const request = await wallet.withKeys((keys) => ({
      network,
      params,
      utxo,
      to: to === "account" ? keys.cardano.receiveAddress(net, 0) : null,
    }));
    progress?.("measuring");
    const finished = await measureLocally<RemoveResult>(this.deps, request, (keys, r) => wasm.buildRemove(keys.seedelf, r)).catch(
      (e: unknown) => {
        throw privateShort(e);
      },
    );
    const { txCbor, seed, inputs: _inputs, to: _to, ...rest } = finished;
    const summary: RemoveSummary = { ...rest, network, label: seedelfLabel(seedelf), to };
    // Its ADA back in the private balance has the history of what paid for the Seedelf.
    const origin = (await classesOf(this.deps, network, [utxo]))[`${utxo.tx_hash}#${utxo.tx_index}`];
    await keep(this.deps, SESSION_REMOVE, { ...summary, txCbor, seed, ...(origin ? { origin } : {}) });
    return summary;
  }

  submitRemove(network: NetworkName, txHash: string): Promise<PendingTx> {
    return send(this.deps, network, txHash, SESSION_REMOVE, "remove", "removal");
  }
}
