// Move in: from the Cardano account into the user's Seedelf balance. The
// equivalent of the CLI's `external sweep`, built by the same core code
// (seedelf-core `build::move_in`) through WebAssembly.
//
// build   reads the account and the protocol parameters, then builds and
//         signs inside WebAssembly, and keeps the signed transaction in
//         session storage until the user confirms it.
// submit  sends exactly that transaction, then hands it to the pending
//         watch (pending.ts). One Koios didn't answer may have gone through:
//         it stays kept, and Send sends it again.

import { t } from "../i18n";
import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import { madePrivate, type HistoryClass } from "../shared/histories";
import type { MoveInSummary, PendingTx, TokenQuantity, BuildStage } from "../shared/rpc";
import { nothingInAccount, readAccount, validUntil } from "./account";
import type { ActivityService } from "./activity";
import type { CoinControlService } from "./coin-control";
import type { Koios } from "./koios";
import { refuseSent, settleMaybeSent, submitWatched } from "./pending";
import type { PreferencesService } from "./preferences";
import type { PrivateStore } from "./private-store";
import { isPublicShort, publicShort } from "./short";
import type { Area } from "./storage";
import type { Wallet } from "./wallet";

/** chrome.storage.session: the move-in built last, until it's confirmed or replaced. */
export const SESSION_BUILT = "seedelf.moveIn.built";

/** A built move-in is only submitted within this long; after that, build again. */
const BUILT_TTL_MS = 10 * 60_000;

interface Built extends MoveInSummary {
  txCbor: string;
  builtAt: number;
  /** The slot it stops being valid at (account.ts `validUntil`). */
  invalidHereafter: number;
  /** Set once a submit went unanswered: Send sends it again as it is (pending.ts). */
  sentCbor?: string;
  /**
   * The history the money gains in the private balance: the public account it
   * came from (chunk 18). Kept with the built transaction rather than worked
   * out when it's sent, so it names the account that actually paid even if
   * the user switches afterwards. The Seedelf history reads it from the
   * summary a submit hands on (activity.ts `classOf`).
   */
  origin: HistoryClass;
  /** That account's index too, for what's kept as sent (pending.ts `Sending`, sent-txs.ts). */
  account: number;
}

export interface MoveInDeps {
  wasm: typeof Wasm;
  wallet: Wallet;
  session: Area;
  koios: (network: NetworkName) => Koios;
  now: () => number;
  /** Waits between reads of a Koios backend that's behind (spent.ts); tests don't. */
  sleep?: (ms: number) => Promise<void>;
  /** Writes the move-in into the Seedelf history once it's submitted. */
  activity?: ActivityService;
  /** Leaves out what the user locked, and the collateral. */
  coins: CoinControlService;
  /** Whether staking rewards are spent along with it. */
  preferences?: PreferencesService;
  /** Where a move-in that may still go through is sealed (pending.ts). */
  store: PrivateStore;
}

export class MoveInService {
  constructor(private readonly deps: MoveInDeps) {}

  /**
   * `tokens` come along in the quantities given; the rest of each stays in
   * the account. `lovelace` below what the deposit needs is raised to it, so
   * "0" moves only that.
   */
  async build(
    network: NetworkName,
    lovelace: string | null,
    tokens: TokenQuantity[],
    progress?: (stage: BuildStage) => void,
  ): Promise<MoveInSummary> {
    const { wasm, wallet, session, now } = this.deps;
    progress?.("checking");
    await settleMaybeSent(this.deps, network);
    progress?.("reading");
    const [{ params, utxos, held, withdrawal }, invalidHereafter] = await Promise.all([
      readAccount(this.deps, network),
      validUntil(this.deps.koios(network)),
    ]);
    if (utxos.length === 0) throw nothingInAccount(held, t("worker.moveIn.empty"));

    progress?.("building");
    return wallet.withKeys(async (keys) => {
      const request = { network, params, utxos, lovelace, tokens, withdrawal, invalidHereafter };
      const build = (r: typeof request) =>
        JSON.parse(wasm.buildMoveIn(keys.cardano, keys.seedelf, JSON.stringify(r))) as MoveInSummary & { txCbor: string };
      let result: MoveInSummary & { txCbor: string };
      try {
        result = build(request);
      } catch (e) {
        if (!isPublicShort(e)) throw e;
        // How much could go, by building it as Max would (chunk 23's second review, PY-10), or, when that's at least
        // what was asked, that what would stay is too little (fix round).
        throw publicShort(
          lovelace === null ? undefined : () => build({ ...request, lovelace: null }).lovelace,
          (max) => t("worker.short.moveIn", { max }),
          lovelace === null ? {} : { asked: lovelace, left: () => t("worker.short.moveInLeft") },
        );
      }
      const { txCbor, ...rest } = result;
      const summary: MoveInSummary = { ...rest, network };
      await session.set(SESSION_BUILT, {
        ...summary,
        txCbor,
        builtAt: now(),
        invalidHereafter,
        origin: madePrivate(keys.account),
        account: keys.account,
      } satisfies Built);
      return summary;
    });
  }

  /** One Koios didn't answer comes back maybe sent, and stays kept: Send again sends the same bytes, however old. */
  async submit(network: NetworkName, txHash: string): Promise<PendingTx> {
    const { wallet, session, now } = this.deps;
    const built = await wallet.withKeys(() => session.get<Built>(SESSION_BUILT));
    if (!built || built.txHash !== txHash || built.network !== network) {
      // Gone once it's sent: a page that missed the answer hears so, never "review it again" (pending.ts).
      await refuseSent(this.deps, network, txHash);
      throw new Error(t("worker.moveIn.notReady"));
    }
    const again = built.sentCbor !== undefined;
    if (!again) {
      if (now() - built.builtAt > BUILT_TTL_MS) {
        throw new Error(t("worker.moveIn.tooOld"));
      }
      await settleMaybeSent(this.deps, network);
    }
    const { txCbor, builtAt: _builtAt, sentCbor: _sentCbor, account, ...summary } = built;
    return submitWatched(this.deps, {
      network,
      txHash,
      kind: "move-in",
      txCbor,
      key: SESSION_BUILT,
      kept: built,
      summary,
      contract: false,
      invalidHereafter: built.invalidHereafter,
      again,
      // A review kept before the account was: the one active now.
      ...(typeof account === "number" ? { account } : {}),
    });
  }
}
