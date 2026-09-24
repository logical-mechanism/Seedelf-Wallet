// Move in: from the Cardano account into the user's Seedelf balance. The
// equivalent of the CLI's `external sweep`, built by the same core code
// (seedelf-core `build::move_in`) through WebAssembly.
//
// build   reads the account and the protocol parameters, then builds and
//         signs inside WebAssembly, and keeps the signed transaction in
//         session storage until the user confirms it.
// submit  sends exactly that transaction, then watches it.
// pending reports the watched transaction's confirmations. It stops watching
//         once it's on chain, or after 10 minutes.

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import type { MoveInSummary, PendingTx, TokenRef } from "../shared/rpc";
import { discoverAccount } from "./balances";
import type { Koios } from "./koios";
import type { Area } from "./storage";
import { SESSION_BALANCES_PREFIX, type Wallet } from "./wallet";

/** chrome.storage.session: the move-in built last, until it's confirmed or replaced. */
export const SESSION_BUILT = "seedelf.moveIn.built";
/** chrome.storage.session: the submitted transaction being watched. */
export const SESSION_PENDING = "seedelf.pendingTx";

/** A built move-in is only submitted within this long; after that, build again. */
const BUILT_TTL_MS = 10 * 60_000;
/** Stop watching a submitted transaction after this long. */
const WATCH_MS = 10 * 60_000;

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
}

export class MoveInService {
  constructor(private readonly deps: MoveInDeps) {}

  async build(network: NetworkName, lovelace: string | null, tokens: TokenRef[]): Promise<MoveInSummary> {
    const { wasm, wallet, session, now } = this.deps;
    const koios = this.deps.koios(network);
    const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;

    // Fresh chain state, read outside the wallet's queue.
    const stake = await wallet.withKeys(({ cardano }) => cardano.stakeAddress(net));
    const [used, utxos, params] = await Promise.all([
      koios.accountAddresses(stake),
      koios.accountUtxos(stake),
      koios.epochParams(),
    ]);

    return wallet.withKeys(async (keys) => {
      const { paths } = discoverAccount(keys, net, new Set(used));
      const pathed = utxos.flatMap((utxo) => {
        const path = paths.get(utxo.address);
        return path ? [{ utxo, ...path }] : [];
      });
      const request = { network, params, utxos: pathed, lovelace, tokens };
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

    const pending: PendingTx = { network, txHash, submittedAt: now(), confirmations: null };
    await wallet.withKeys(async () => {
      await session.remove(SESSION_BUILT);
      await session.set(SESSION_PENDING, pending);
    });
    return pending;
  }

  /** The watched transaction with fresh confirmations, or null. Clears it once confirmed or stale. */
  async pending(): Promise<PendingTx | null> {
    const { wallet, session, now } = this.deps;
    const pending = await wallet.withKeys(() => session.get<PendingTx>(SESSION_PENDING));
    if (!pending) return null;
    const statuses = await this.deps.koios(pending.network).txStatus([pending.txHash]);
    const confirmations = statuses.get(pending.txHash) ?? null;
    const current: PendingTx = { ...pending, confirmations };
    if (confirmations !== null || now() - pending.submittedAt > WATCH_MS) {
      await wallet.withKeys(async () => {
        await session.remove(SESSION_PENDING);
        // The next balance reading should see the new UTxOs.
        if (confirmations !== null) await session.remove(SESSION_BALANCES_PREFIX + pending.network);
      });
    }
    return current;
  }
}
