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

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import type { MoveInSummary, PendingTx, TokenQuantity } from "../shared/rpc";
import { nothingInAccount, readAccount, validUntil } from "./account";
import type { ActivityService } from "./activity";
import type { CoinControlService } from "./coin-control";
import type { Koios } from "./koios";
import { settleMaybeSent, submitWatched } from "./pending";
import type { PreferencesService } from "./preferences";
import type { PrivateStore } from "./private-store";
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
  async build(network: NetworkName, lovelace: string | null, tokens: TokenQuantity[]): Promise<MoveInSummary> {
    const { wasm, wallet, session, now } = this.deps;
    await settleMaybeSent(this.deps, network);
    const { params, utxos, held, withdrawal } = await readAccount(this.deps, network);
    if (utxos.length === 0) throw nothingInAccount(held, "Your public account is empty, so there's nothing to make private.");

    return wallet.withKeys(async (keys) => {
      const invalidHereafter = validUntil(wasm, network, now());
      const request = { network, params, utxos, lovelace, tokens, withdrawal, invalidHereafter };
      const result = JSON.parse(wasm.buildMoveIn(keys.cardano, keys.seedelf, JSON.stringify(request)));
      const { txCbor, ...rest } = result as MoveInSummary & { txCbor: string };
      const summary: MoveInSummary = { ...rest, network };
      await session.set(SESSION_BUILT, { ...summary, txCbor, builtAt: now(), invalidHereafter } satisfies Built);
      return summary;
    });
  }

  /** One Koios didn't answer comes back maybe sent, and stays kept: Send again sends the same bytes, however old. */
  async submit(network: NetworkName, txHash: string): Promise<PendingTx> {
    const { wallet, session, now } = this.deps;
    const built = await wallet.withKeys(() => session.get<Built>(SESSION_BUILT));
    if (!built || built.txHash !== txHash || built.network !== network) {
      throw new Error("That payment isn't ready to send. Review it again.");
    }
    const again = built.sentCbor !== undefined;
    if (!again) {
      if (now() - built.builtAt > BUILT_TTL_MS) {
        throw new Error("That payment was built more than 10 minutes ago. Review it again.");
      }
      await settleMaybeSent(this.deps, network);
    }
    const { txCbor, builtAt: _builtAt, sentCbor: _sentCbor, ...summary } = built;
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
    });
  }
}
