// Withdraw: take money out of the Seedelf balance. Both are Seedelf script
// spends, built and sent by script-spend.ts:
//
// send    to any normal address, or an ADA Handle (the CLI's `sweep`): an
//         amount with optional tokens, or everything (Max, 20 UTxOs at most).
//         The change goes back into the Seedelf balance.
// remove  one of this wallet's seedelfs (the CLI's `remove`): the token is
//         burned, and the ADA locked with it goes to the Cardano account's
//         0/0 or back into the Seedelf balance. Returning it to whatever paid
//         for the mint links nothing new.
//
// A handle is looked up through Koios (`asset_nft_address`), which sees
// which handle is asked about. A destination carrying this account's staking
// key is flagged: withdrawing to it re-links the money to the account.

import type { NetworkName } from "../networks";
import type {
  PendingTx,
  RemoveSummary,
  RemoveTo,
  TokenQuantity,
  WithdrawDestination,
  WithdrawSummary,
} from "../shared/rpc";
import { seedelfName } from "../shared/seedelf-name";
import { seedelfLabel } from "./chain";
import { keep, measure, readContract, send, spendable, type ScriptSpendDeps } from "./script-spend";

/** chrome.storage.session: the withdrawal built last, until it's sent or replaced. */
export const SESSION_WITHDRAW = "seedelf.withdraw.built";
/** chrome.storage.session: the removal built last, until it's sent or replaced. */
export const SESSION_REMOVE = "seedelf.remove.built";

/** The ADA Handle policy, the same on preprod and mainnet. */
export const ADA_HANDLE_POLICY = "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a";
/** CIP-68's user-token label, which newer handles carry. */
const CIP68_USER_TOKEN = "000de140";
/** An ADA Handle's name, after the $. */
export const HANDLE = /^[a-z0-9._@-]{1,28}$/;

type WithdrawResult = Omit<WithdrawSummary, "network" | "address" | "handle" | "own" | "inputs"> & {
  txCbor: string;
  seed: string;
  to: string;
  inputs: unknown[];
};

type RemoveResult = Omit<RemoveSummary, "network" | "label" | "to"> & {
  txCbor: string;
  seed: string;
  /** The address paid, or null for the Seedelf balance. */
  to: string | null;
  inputs: unknown[];
};

const hex = (text: string) => Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join("");

export class WithdrawService {
  constructor(private readonly deps: ScriptSpendDeps) {}

  /** A destination as typed: a bech32 address, or `$handle`. */
  async resolve(network: NetworkName, to: string): Promise<WithdrawDestination> {
    const { wasm, wallet } = this.deps;
    const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
    const text = to.trim();
    let address = text;
    let handle: string | undefined;
    if (text.startsWith("$")) {
      handle = text.slice(1).toLowerCase();
      if (!HANDLE.test(handle)) throw new Error("An ADA Handle is $ and up to 28 letters, digits, or . _ - @.");
      const koios = this.deps.koios(network);
      let found: string | undefined;
      for (const name of [hex(handle), CIP68_USER_TOKEN + hex(handle)]) {
        found = await koios.assetNftAddress(ADA_HANDLE_POLICY, name);
        if (found) break;
      }
      if (!found) throw new Error(`No ADA Handle $${handle} on ${network}.`);
      address = found;
    }
    // Throws the reason: not an address, a script, a stake address, the other network.
    wasm.checkWithdrawAddress(address, net);
    const own = await wallet.withKeys((keys) => keys.cardano.isOwnAddress(address));
    return handle ? { address, handle, own } : { address, own };
  }

  async build(
    network: NetworkName,
    to: string,
    lovelace: string | null,
    tokens: TokenQuantity[],
  ): Promise<WithdrawSummary> {
    const { wasm } = this.deps;
    const destination = await this.resolve(network, to);
    const { view, params } = await readContract(this.deps, network);
    const request = { network, params, utxos: spendable(this.deps, view), to: destination.address, lovelace, tokens };
    if (request.utxos.length === 0) {
      throw new Error("Your Seedelf balance is empty, so there's nothing to withdraw.");
    }
    const finished = await measure<WithdrawResult>(
      this.deps,
      network,
      request,
      (keys, r) => wasm.draftWithdraw(keys.seedelf, r),
      (keys, r) => wasm.finishWithdraw(keys.seedelf, r),
    );
    const { txCbor, seed, to: _to, inputs, ...rest } = finished;
    const summary: WithdrawSummary = { ...rest, ...destination, network, inputs: inputs.length };
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
    if (!seedelf) throw new Error("That isn't a seedelf's name.");
    const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
    const { view, params } = await readContract(this.deps, network);
    // Any seedelf is found; WebAssembly refuses one that isn't this wallet's.
    const utxo = view.seedelfs[seedelf];
    if (!utxo) throw new Error(`No seedelf with that name on ${network}. It may be removed already.`);
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
