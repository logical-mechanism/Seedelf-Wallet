// Transfer: pay seedelfs from the Seedelf balance, up to 20 in one
// transaction. The equivalent of the CLI's `transfer`, built by the same core
// code (`build::transfer`) through WebAssembly, and sent like every Seedelf
// spend (script-spend.ts).
//
// lookup  a seedelf is found by its full name in the wallet contract, as
//         the balance reading sees it (contract-scan.ts): in the view the
//         last reading kept when it's there, otherwise after reading what's
//         new. Koios is never asked about the recipient's token (asset_utxos
//         and the like): that would tell it exactly who is being paid.
// build   the same lookup, fresh, for every recipient. WebAssembly checks
//         each recipient's UTxO (in the contract, holding that seedelf, under
//         a register), pays a new re-randomization of each register, picks
//         the Seedelf UTxOs that pay (keeping different histories apart
//         where it can, script-spend.ts `Classes`), and drafts under a new
//         one-time key. Paying one of your own seedelfs is allowed, and
//         flagged. Max (`lovelace` null, one Seedelf) pays everything but the
//         fees and what the tokens that stay need (blind test §9.6), every
//         UTxO, in parts of 20 at most (the owner's test of 1.6.0), and says
//         how many it left and why (`leftWhy`, 1.6.0's release review); a
//         payment that's too much says the most that can go, and what has to
//         stay (short.ts `privateShortOf`).
// submit  giveme.my witnesses the collateral, then Koios submits exactly the
//         reviewed transaction.

import { t } from "../i18n";
import type { NetworkName } from "../networks";
import type { LeftOutUtxo, PaymentAsk, PendingTx, SeedelfLookup, SeedelfPaid, TransferSummary, BuildStage } from "../shared/rpc";
import { checkRecipients } from "../shared/recipients";
import { SEEDELF_NAME_RULE, seedelfName } from "../shared/seedelf-name";
import { seedelfLabel } from "./chain";
import { keptContractView, readContractView, type ContractView } from "./contract-scan";
import type { KoiosUtxo } from "./koios";
import { reviewParts, sendParts } from "./parts";
import { settleMaybeSent } from "./pending";
import { privateShortOf, tooMany } from "./short";
import {
  carried,
  changeHistory,
  keepParts,
  measureLocally,
  nothingToSpend,
  readContract,
  spentHistories,
  unspendable,
  whole,
  type OutRef,
  type ScriptSpendDeps,
} from "./script-spend";
import { outpoint } from "./spent";

/** chrome.storage.session: the transfer built last, until it's sent or replaced. */
export const SESSION_TRANSFER = "seedelf.transfer.built";

type TransferResult = Omit<TransferSummary, "network" | "payments" | "inputs" | "histories" | "leftOut"> & {
  txCbor: string;
  seed: string;
  payments: Omit<SeedelfPaid, "label">[];
  inputs: OutRef[];
  classesMixed: string[];
};

export class TransferService {
  constructor(private readonly deps: ScriptSpendDeps) {}

  /**
   * The seedelf named `to`, if the wallet contract holds it: found in the
   * view the last reading kept, with no request, or else after reading
   * what's new. Build reads it fresh anyway.
   */
  async lookup(network: NetworkName, to: string): Promise<SeedelfLookup> {
    const name = seedelfNameOf(to);
    const kept = await this.deps.wallet.withKeys(() => keptContractView(this.deps.session, network));
    const view = kept?.seedelfs[name] ? kept : await readContractView(this.deps, network);
    const utxo = seedelfUtxo(view, name, network);
    return { name, label: seedelfLabel(name), own: holdsOwn(view, utxo) };
  }

  /** Pays each of `payments`, seedelfs by their full names, in one transaction; `lovelace` null is Max, to a single one. */
  async build(
    network: NetworkName,
    payments: PaymentAsk[],
    progress?: (stage: BuildStage) => void,
  ): Promise<TransferSummary> {
    const { wasm } = this.deps;
    checkRecipients(payments.length);
    const names = payments.map((p) => seedelfNameOf(p.to));
    progress?.("checking");
    await settleMaybeSent(this.deps, network);
    progress?.("reading");
    const { view, utxos, params, returning, waiting, classes } = await readContract(this.deps, network);
    const request = {
      network,
      params,
      utxos,
      classes,
      payments: payments.map((p, i) => ({
        to: names[i]!,
        recipient: seedelfUtxo(view, names[i]!, network),
        lovelace: p.lovelace,
        tokens: p.tokens,
      })),
    };
    if (request.utxos.length === 0) {
      throw nothingToSpend(
        this.deps,
        view,
        t("worker.transfer.empty"),
        returning,
        waiting,
      );
    }

    progress?.("measuring");
    // In as many transactions as the UTxOs it spends need, each spending its own (the owner's test of 1.6.0): one
    // when one does.
    const measured = (r: typeof request) =>
      measureLocally<{ parts: TransferResult[] }>(this.deps, r, (keys, json) => wasm.buildTransferParts(keys.seedelf, json)).then(
        (built) => built.parts,
      );
    // Core's shortfall in the user's words, with what has to stay and the most that can go: Max's, built again on
    // the same UTxOs (blind test §4.4, T05; chunk 23's second review, PY-10), every part of it.
    const parts = await measured(request).catch(async (e: unknown) => {
      const available = utxos.reduce((sum, u) => sum + BigInt(u.value), 0n);
      const most = async () => whole(await measured({ ...request, payments: [{ ...request.payments[0]!, lovelace: null }] }));
      throw tooMany(await privateShortOf(e, request.payments.map((p) => p.lovelace), most, available));
    });
    // A chained part's carry has the history of what the part before it spent.
    const seen = carried(classes, parts);
    const summaryOf = (finished: TransferResult): TransferSummary => {
      const { txCbor: _txCbor, seed: _seed, inputs, payments: paid, classesMixed, ...rest } = finished;
      const histories = spentHistories(seen, inputs, classesMixed);
      // Max says what no Seedelf spend can take, and what a chain being sent will spend: a return through Lovejoin,
      // or a payment's parts still to go. As Make public's does (withdraw.ts).
      const leftOut: LeftOutUtxo[] = finished.max
        ? [
            ...unspendable(this.deps, view).map((u) => ({ txHash: u.tx_hash, txIndex: u.tx_index, reason: "script" as const })),
            ...returning.map((u) => ({
              txHash: u.tx_hash,
              txIndex: u.tx_index,
              reason: waiting.includes(u) ? ("parts" as const) : ("returning" as const),
            })),
          ]
        : [];
      return {
        ...rest,
        network,
        payments: paid.map((p) => {
          const label = seedelfLabel(p.to);
          return label ? { ...p, label } : p;
        }),
        inputs: inputs.length,
        ...(leftOut.length ? { leftOut } : {}),
        ...(histories ? { histories } : {}),
      };
    };
    // Each part kept with its own figures, for the Seedelf history once it's sent; the review shows them added up.
    await keepParts(
      this.deps,
      SESSION_TRANSFER,
      parts.map((p) => ({ ...summaryOf(p), txCbor: p.txCbor, seed: p.seed, origin: changeHistory(seen, p.inputs) })),
    );
    const summary = summaryOf(whole(parts, { classes: seen, utxos }));
    return parts.length > 1 ? { ...summary, parts: reviewParts(parts) } : summary;
  }

  submit(network: NetworkName, txHash: string): Promise<PendingTx> {
    return sendParts(this.deps, network, txHash, SESSION_TRANSFER, "transfer", "payment");
  }

}

/** The contract UTxO holding the seedelf `name`, found locally. Send from the Cardano account pays it too. */
export function seedelfUtxo(view: ContractView, name: string, network: NetworkName): KoiosUtxo {
  const utxo = view.seedelfs[name];
  if (!utxo) throw new Error(t("worker.seedelf.notFound", { network }));
  return utxo;
}

/** Whether `utxo`, a seedelf's, is one of this wallet's own. */
export function holdsOwn(view: ContractView, utxo: KoiosUtxo): boolean {
  return view.owned.some((u) => outpoint(u) === outpoint(utxo));
}

/** A pasted seedelf name, tidied; throws the rule when it isn't whole. */
export function seedelfNameOf(to: string): string {
  const name = seedelfName(to);
  if (!name) throw new Error(SEEDELF_NAME_RULE());
  return name;
}
