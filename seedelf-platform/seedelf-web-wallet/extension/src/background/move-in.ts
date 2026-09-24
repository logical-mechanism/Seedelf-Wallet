// Move in: from the Cardano account into the user's Seedelf balance. The
// equivalent of the CLI's `external sweep`, built by the same core code
// (seedelf-core `build::move_in`) through WebAssembly.
//
// build   reads the account and the protocol parameters, then builds and
//         signs inside WebAssembly, and keeps the signed transaction in
//         session storage until the user confirms it.
// submit  sends exactly that transaction, then hands it to the pending
//         watch (pending.ts).

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import type { MoveInSummary, PendingTx, TokenQuantity } from "../shared/rpc";
import { nothingInAccount, readAccount } from "./account";
import type { ActivityService } from "./activity";
import type { CoinControlService } from "./coin-control";
import type { Koios } from "./koios";
import { SESSION_PENDING } from "./pending";
import type { PreferencesService } from "./preferences";
import { rememberSpent } from "./spent";
import type { Area } from "./storage";
import type { Wallet } from "./wallet";

/** chrome.storage.session: the move-in built last, until it's confirmed or replaced. */
export const SESSION_BUILT = "seedelf.moveIn.built";

/** A built move-in is only submitted within this long; after that, build again. */
const BUILT_TTL_MS = 10 * 60_000;

interface Built extends MoveInSummary {
  txCbor: string;
  builtAt: number;
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
    const { params, utxos, held, withdrawal } = await readAccount(this.deps, network);
    if (utxos.length === 0) throw nothingInAccount(held, "Your Cardano account is empty, so there's nothing to move in.");

    return wallet.withKeys(async (keys) => {
      const request = { network, params, utxos, lovelace, tokens, withdrawal };
      const result = JSON.parse(wasm.buildMoveIn(keys.cardano, keys.seedelf, JSON.stringify(request)));
      const { txCbor, ...rest } = result as MoveInSummary & { txCbor: string };
      const summary: MoveInSummary = { ...rest, network };
      await session.set(SESSION_BUILT, { ...summary, txCbor, builtAt: now() } satisfies Built);
      return summary;
    });
  }

  async submit(network: NetworkName, txHash: string): Promise<PendingTx> {
    const { wallet, session, now } = this.deps;
    const built = await wallet.withKeys(() => session.get<Built>(SESSION_BUILT));
    if (!built || built.txHash !== txHash || built.network !== network) {
      throw new Error("That move-in isn't ready to send. Review it again.");
    }
    if (now() - built.builtAt > BUILT_TTL_MS) {
      throw new Error("That move-in was built more than 10 minutes ago. Review it again.");
    }
    const bytes = Uint8Array.from(built.txCbor.match(/../g)!, (h) => Number.parseInt(h, 16));
    const submitted = await this.deps.koios(network).submitTx(bytes);
    if (submitted !== txHash) throw new Error(`Koios answered with another transaction id (${submitted}).`);

    const pending: PendingTx = { kind: "move-in", network, txHash, submittedAt: now(), confirmations: null };
    await wallet.withKeys(async () => {
      await rememberSpent(session, bytes);
      await session.remove(SESSION_BUILT);
      await session.set(SESSION_PENDING, pending);
    });
    await this.deps.activity?.sent(network, pending, built).catch(() => undefined);
    return pending;
  }
}
