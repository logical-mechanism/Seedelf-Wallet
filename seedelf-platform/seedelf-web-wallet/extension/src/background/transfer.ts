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
//         flagged. Max (`lovelace` null, one Seedelf) pays everything of up
//         to 20 UTxOs but the fee and what the tokens that stay need (blind
//         test §9.6); a payment that's too much says the most that can go,
//         and what has to stay (short.ts `privateShortOf`).
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
import { settleMaybeSent } from "./pending";
import { privateShortOf } from "./short";
import {
  changeHistory,
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
    const { view, utxos, params, returning, classes } = await readContract(this.deps, network);
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
      );
    }

    progress?.("measuring");
    const measured = (r: typeof request) =>
      measureLocally<TransferResult>(this.deps, r, (keys, json) => wasm.buildTransfer(keys.seedelf, json));
    // Core's shortfall in the user's words, with what has to stay and the most that can go: Max's, built again on
    // the same UTxOs (blind test §4.4, T05; chunk 23's second review, PY-10).
    const finished = await measured(request).catch(async (e: unknown) => {
      const available = utxos.reduce((sum, u) => sum + BigInt(u.value), 0n);
      const most = () => measured({ ...request, payments: [{ ...request.payments[0]!, lovelace: null }] });
      throw await privateShortOf(e, request.payments.map((p) => p.lovelace), most, available);
    });
    const { txCbor, seed, inputs, payments: paid, classesMixed, ...rest } = finished;
    const histories = spentHistories(classes, inputs, classesMixed);
    // Max says what no Seedelf spend can take, and what a return through Lovejoin being sent will spend, as Make
    // public's does (withdraw.ts).
    const leftOut: LeftOutUtxo[] = finished.max
      ? [
          ...unspendable(this.deps, view).map((u) => ({ txHash: u.tx_hash, txIndex: u.tx_index, reason: "script" as const })),
          ...returning.map((u) => ({ txHash: u.tx_hash, txIndex: u.tx_index, reason: "returning" as const })),
        ]
      : [];
    const summary: TransferSummary = {
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
    await keep(this.deps, SESSION_TRANSFER, { ...summary, txCbor, seed, origin: changeHistory(classes, inputs) });
    return summary;
  }

  submit(network: NetworkName, txHash: string): Promise<PendingTx> {
    return send(this.deps, network, txHash, SESSION_TRANSFER, "transfer", "payment");
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
