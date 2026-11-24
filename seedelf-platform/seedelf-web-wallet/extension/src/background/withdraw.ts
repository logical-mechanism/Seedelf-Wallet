// Withdraw: take money out of the Seedelf balance. Both are Seedelf script
// spends, built and sent by script-spend.ts:
//
// send    to any addresses on the network (a script's with a warning) or
//         ADA Handles (the CLI's `sweep`), up to 100 in one transaction (chunk
//         51, r2a#1 and gap-g8#4): an amount with optional tokens for each, or
//         everything to a single one (Max: every UTxO, in parts of 20 at
//         most, saying how many it left and why, `leftWhy`). The change goes
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
import { leftBy, madePrivate, merged } from "../shared/histories";
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
import { decimalsOf } from "./balances";
import { seedelfLabel } from "./chain";
import { destinationResolver, resolveDestination } from "./destination";
import { forgetRegisters } from "./minted-by";
import { reviewParts, sendParts } from "./parts";
import { settleMaybeSent } from "./pending";
import { privateShort, privateShortOf, tooMany } from "./short";
import {
  carried,
  changeHistory,
  classesOf,
  keep,
  keepParts,
  measureLocally,
  nothingToSpend,
  readContract,
  send,
  spentHistories,
  unspendable,
  whole,
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
    const { view, utxos, params, returning, waiting, classes } = await readContract(this.deps, network);
    const request = {
      network,
      params,
      utxos,
      classes,
      payments: payments.map((p, i) => ({ to: destinations[i]!.address, lovelace: p.lovelace, tokens: p.tokens })),
    };
    if (request.utxos.length === 0) {
      throw nothingToSpend(this.deps, view, t("worker.withdraw.empty"), returning, waiting);
    }
    progress?.("measuring");
    // In as many transactions as the UTxOs it spends need, each spending its own (the owner's test of 1.6.0): one
    // when one does. A shortfall's `most` is built so too, as Max is, in as many parts as it takes (up to MAX_PARTS)
    // and added up (`whole`): what an amount in parts can pay.
    const measured = (r: typeof request & { most?: boolean }) =>
      measureLocally<{ parts: WithdrawResult[] }>(this.deps, r, (keys, json) => wasm.buildWithdrawParts(keys.seedelf, json)).then(
        (built) => built.parts,
      );
    // Core's shortfall in the user's words, with what has to stay and the most an amount can be, the tokens not
    // sent staying: built again on the same UTxOs (blind test §4.4, T05; chunk 23's second review, PY-10), over what
    // an amount takes, never a UTxO adding less than nothing (chunk 51, r2a#3). Max itself sends every token, so
    // that isn't its figure when a token stays.
    const parts = await measured(request).catch(async (e: unknown) => {
      const available = utxos.reduce((sum, u) => sum + BigInt(u.value), 0n);
      const most = async () => whole(await measured({ ...request, most: true, payments: [{ ...request.payments[0]!, lovelace: null }] }));
      throw tooMany(await privateShortOf(e, request.payments.map((p) => p.lovelace), most, available));
    });
    // A chained part's carry has the history of what the part before it spent.
    const seen = carried(classes, parts);
    const summaryOf = (finished: WithdrawResult): WithdrawSummary => {
      const { txCbor: _txCbor, seed: _seed, inputs, payments: paid, classesMixed, ...rest } = finished;
      const histories = spentHistories(seen, inputs, classesMixed);
      // Max says what no Seedelf spend can take, which the private balance leaves out too, and what a chain being
      // sent will spend: a return through Lovejoin (final review lovejoin-3), or a payment's parts still to go.
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
        payments: paid.map(({ to: _to, ...p }, i) => ({ ...destinations[i]!, ...p })),
        inputs: inputs.length,
        ...(leftOut.length ? { leftOut } : {}),
        ...(histories ? { histories } : {}),
      };
    };
    // A part's change is tied in the open to what it paid: paying one of the user's own public accounts, it's that
    // account's money, as money made private from it is; paying anyone else, that part's own, which its recipients know.
    // Either way the next stealth mint or a funding takes money others paid before it (chunk 51, money#2, own#1; the
    // owner's answer 2 to B15).
    const tiedBy = (p: WithdrawResult) => {
      const to = p.payments.map((x) => destinations.find((d) => d.address === x.to));
      const accounts = [...new Set(to.flatMap((d) => (d?.ownAccount !== undefined ? [d.ownAccount] : [])))];
      return [...accounts.map(madePrivate), ...(to.some((d) => d?.ownAccount === undefined) ? [leftBy(p.txHash)] : [])];
    };
    // Each part kept with its own figures, for the Seedelf history once it's sent; the review shows them added up.
    await keepParts(
      this.deps,
      SESSION_WITHDRAW,
      parts.map((p) => ({
        ...summaryOf(p),
        txCbor: p.txCbor,
        seed: p.seed,
        origin: merged([changeHistory(seen, p.inputs), ...tiedBy(p)]),
      })),
    );
    const summary = summaryOf(whole(parts, { classes: seen, utxos }));
    return parts.length > 1 ? { ...summary, parts: reviewParts(parts) } : summary;
  }

  submit(network: NetworkName, txHash: string): Promise<PendingTx> {
    return sendParts(this.deps, network, txHash, SESSION_WITHDRAW, "withdraw", "payment");
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
    // What sat with the Seedelf comes back in the units its UTxO gives it (Koios's decimals), for a token off the
    // wallet's list too: WebAssembly's token lists carry none, and the review showed one in raw units, 10^6 times what
    // the UTxOs screen and Home show (chunk 51, r2sign#3). The wallet's list still comes first (ui/tokens.ts).
    const decimals = decimalsOf([utxo]);
    const tokens = rest.tokens.map((token) => {
      const d = decimals.get(`${token.policyId}.${token.assetName}`);
      return d ? { ...token, decimals: d } : token;
    });
    const summary: RemoveSummary = { ...rest, tokens, network, label: seedelfLabel(seedelf), to };
    // Its ADA back in the private balance has the history of what paid for the Seedelf, and is tied in the open to the
    // Seedelf this removes, so the next stealth mint or a funding takes money others paid before it (chunk 51, the
    // owner's answer 2 to B15).
    const paidFor = (await classesOf(this.deps, network, [utxo]))[`${utxo.tx_hash}#${utxo.tx_index}`];
    const origin = merged([...(paidFor ? [paidFor] : []), leftBy(rest.txHash)]);
    await keep(this.deps, SESSION_REMOVE, { ...summary, txCbor, seed, origin });
    return summary;
  }

  async submitRemove(network: NetworkName, txHash: string): Promise<PendingTx> {
    // Which Seedelf it removes, as its review kept it.
    const built = await this.deps.wallet.withKeys(() => this.deps.session.get<{ network?: string; txHash?: string; name?: string }>(SESSION_REMOVE));
    const pending = await send(this.deps, network, txHash, SESSION_REMOVE, "remove", "removal");
    // Sent, or it may have gone: Messages stops taking first messages at the register this browser put it under, now,
    // whatever a kept view still shows (the 1.10.0 gate's W12). Best effort: the removal went whatever this write does,
    // and a view without the Seedelf stops them all the same.
    if (built?.network === network && built.txHash === txHash && built.name) {
      await forgetRegisters(this.deps.store, network, built.name).catch(() => undefined);
    }
    return pending;
  }
}
