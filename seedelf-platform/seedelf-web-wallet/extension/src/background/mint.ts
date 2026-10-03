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
//          from other people's Seedelf payments, so it takes received money
//          first when the sealed history says which that is (privacy review
//          §2.3).
//
// Both are built by script-spend.ts's draft → Ogmios → finish, and kept in
// session storage until Send: signed for the account, unsigned with its
// one-time key's seed for a stealth mint, which giveme.my witnesses at Send.

import { t } from "../i18n";
import type { NetworkName } from "../networks";
import { madePrivate, type HistoryClass } from "../shared/histories";
import type { MintSource, MintSummary, PendingTx, BuildStage } from "../shared/rpc";
import { nothingInAccount, readAccount, validUntil } from "./account";
import { rememberMint } from "./minted-by";
import { settleMaybeSent } from "./pending";
import {
  changeHistory,
  keep,
  measure,
  measureLocally,
  nothingToSpend,
  readContract,
  send,
  spentHistories,
  type OutRef,
  type ScriptSpendDeps,
} from "./script-spend";

/** chrome.storage.session: the mint built last, until it's sent or replaced. */
export const SESSION_MINT = "seedelf.mint.built";

type MintResult = Omit<MintSummary, "network" | "label" | "inputs" | "from" | "histories"> & {
  txCbor: string;
  seed?: string;
  inputs: OutRef[];
  collateral?: unknown;
  /** A stealth mint's: the classes it spends together. */
  classesMixed?: string[];
};

export type MintDeps = ScriptSpendDeps;

export class MintService {
  constructor(private readonly deps: MintDeps) {}

  async build(
    network: NetworkName,
    label: string,
    from: MintSource,
    progress?: (stage: BuildStage) => void,
  ): Promise<MintSummary> {
    progress?.("checking");
    await settleMaybeSent(this.deps, network);
    return from === "account" ? this.buildFromAccount(network, label, progress) : this.buildStealth(network, label, progress);
  }

  private async buildFromAccount(
    network: NetworkName,
    label: string,
    progress?: (stage: BuildStage) => void,
  ): Promise<MintSummary> {
    const { wasm, wallet } = this.deps;
    progress?.("reading");
    const [{ params, utxos, collateral, held, withdrawal }, invalidHereafter] = await Promise.all([
      readAccount(this.deps, network),
      validUntil(this.deps.koios(network)),
    ]);
    // The draft Ogmios measures and the finish hold the same slot.
    const request = { network, params, label, utxos, collateral, withdrawal, invalidHereafter };
    if (request.utxos.length === 0) {
      throw nothingInAccount(held, t("worker.mint.accountEmpty"));
    }

    // Ogmios measures this draft, so it's a request out, not a local measure.
    progress?.("measuring");
    const finished = await measure<MintResult>(
      this.deps,
      network,
      request,
      (keys, r) => wasm.draftAccountMint(keys.cardano, keys.seedelf, r),
      (keys, r) => wasm.finishAccountMint(keys.cardano, keys.seedelf, r),
    );
    // Its Seedelf's ADA comes back into the private balance, when it's
    // removed there, as money the account paid: the account that paid it, so
    // a later spend doesn't co-spend it with another account's (chunk 18).
    const origin = madePrivate(await wallet.withKeys((keys) => keys.account));
    return this.keep(network, label, "account", finished, origin, undefined, request.invalidHereafter);
  }

  private async buildStealth(
    network: NetworkName,
    label: string,
    progress?: (stage: BuildStage) => void,
  ): Promise<MintSummary> {
    const { wasm } = this.deps;
    progress?.("reading");
    const { view, utxos, params, returning, classes } = await readContract(this.deps, network);
    const request = { network, params, label, utxos, classes };
    if (request.utxos.length === 0) {
      throw nothingToSpend(
        this.deps,
        view,
        t("worker.mint.privateEmpty"),
        returning,
      );
    }

    progress?.("measuring");
    const finished = await measureLocally<MintResult>(this.deps, request, (keys, r) => wasm.buildMint(keys.seedelf, r));
    const histories = spentHistories(classes, finished.inputs, finished.classesMixed);
    return this.keep(network, label, "seedelf", finished, changeHistory(classes, finished.inputs), histories);
  }

  /** `origin`: the history of what it leaves in the private balance; `histories`: a stealth mint's inputs'. */
  private async keep(
    network: NetworkName,
    label: string,
    from: MintSource,
    finished: MintResult,
    origin: HistoryClass,
    histories?: HistoryClass[],
    invalidHereafter?: number,
  ): Promise<MintSummary> {
    const { txCbor, seed, inputs, collateral: _collateral, classesMixed: _mixed, ...rest } = finished;
    const summary: MintSummary = { ...rest, network, label, from, inputs: inputs.length, ...(histories ? { histories } : {}) };
    await keep(this.deps, SESSION_MINT, { ...summary, txCbor, seed, invalidHereafter, origin });
    return summary;
  }

  /**
   * For a stealth mint, giveme.my first witnesses the collateral; an
   * account-paid one was signed at review. Who paid is kept first, sealed,
   * naming the public account when one did, so removing the Seedelf defaults
   * to that side and warns if the wallet has since moved to another account
   * (minted-by.ts).
   */
  async submit(network: NetworkName, txHash: string): Promise<PendingTx> {
    const { wallet, session, store } = this.deps;
    const [built, account] = await wallet.withKeys(
      async (keys) => [await session.get<MintSummary>(SESSION_MINT), keys.account] as const,
    );
    if (built?.txHash === txHash && built.network === network) {
      await rememberMint(store, network, built.tokenName, built.from, account);
    }
    return send(this.deps, network, txHash, SESSION_MINT, "mint", "Seedelf");
  }
}
