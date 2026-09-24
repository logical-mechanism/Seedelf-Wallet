// Send: pay any normal address, or an ADA Handle, from the Cardano account,
// as any Cardano wallet does. Nothing about it is Seedelf's: it's paid in the
// open, and the Cardano account's Activity lists it from Koios.
//
// build   reads the destination (destination.ts) and the account
//         (account.ts), then builds and signs inside WebAssembly
//         (seedelf-core `build::account_send`), like a move-in. The signed
//         transaction waits in session storage until the user confirms it.
// submit  sends exactly that transaction (script-spend.ts `send`), then hands
//         it to the pending watch.
//
// Setting a collateral (coin-control.ts) is one of these too: 5 ₳ paid to the
// account's own `0/0`, whose output (the first: the payment comes before the
// change) is the collateral from Send on.

import type { NetworkName } from "../networks";
import type { PendingTx, SendSummary, TokenQuantity, WithdrawDestination } from "../shared/rpc";
import { nothingInAccount, readAccount } from "./account";
import { COLLATERAL_LOVELACE } from "./coin-control";
import { resolveDestination } from "./destination";
import { keep, send, type ScriptSpendDeps } from "./script-spend";

/** chrome.storage.session: the payment built last, until it's sent or replaced. */
export const SESSION_SEND = "seedelf.send.built";

/** chrome.storage.session: the collateral payment built last. */
export const SESSION_COLLATERAL = "seedelf.collateral.built";

type SendResult = Omit<SendSummary, "network" | "address" | "handle" | "own"> & { txCbor: string; to: string };

export class SendService {
  constructor(private readonly deps: ScriptSpendDeps) {}

  /**
   * Pays `to` (an address or `$handle`) `lovelace` and `tokens`. `lovelace`
   * null sends the most possible; below what the payment needs, it's raised
   * to that, so "0" sends only the ADA the tokens need.
   */
  async build(network: NetworkName, to: string, lovelace: string | null, tokens: TokenQuantity[]): Promise<SendSummary> {
    const destination = await resolveDestination(this.deps, network, to);
    return this.pay(network, destination, lovelace, tokens, SESSION_SEND);
  }

  /** Signed at review: Send only submits it. */
  submit(network: NetworkName, txHash: string): Promise<PendingTx> {
    return send(this.deps, network, txHash, SESSION_SEND, "send", "payment");
  }

  /** 5 ₳ to the account's own receive address `0/0`, to be its collateral. */
  async buildCollateral(network: NetworkName): Promise<SendSummary> {
    const { wasm, wallet } = this.deps;
    const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
    const address = await wallet.withKeys((keys) => keys.cardano.receiveAddress(net, 0));
    const destination = { address, own: true };
    return this.pay(network, destination, COLLATERAL_LOVELACE.toString(), [], SESSION_COLLATERAL);
  }

  /** Sends the collateral payment; its first output is the collateral from now on. */
  async submitCollateral(network: NetworkName, txHash: string): Promise<PendingTx> {
    const pending = await send(this.deps, network, txHash, SESSION_COLLATERAL, "collateral", "collateral payment");
    await this.deps.coins.sent(network, `${txHash}#0`);
    return pending;
  }

  private async pay(
    network: NetworkName,
    destination: WithdrawDestination,
    lovelace: string | null,
    tokens: TokenQuantity[],
    key: string,
  ): Promise<SendSummary> {
    const { wasm, wallet } = this.deps;
    const { params, utxos, held, withdrawal } = await readAccount(this.deps, network);
    if (utxos.length === 0) throw nothingInAccount(held, "Your Cardano account is empty, so there's nothing to send.");

    const request = { network, params, utxos, to: destination.address, lovelace, tokens, withdrawal };
    const result = await wallet.withKeys(
      (keys) => JSON.parse(wasm.buildAccountSend(keys.cardano, JSON.stringify(request))) as SendResult,
    );
    const { txCbor, to: _to, ...rest } = result;
    const summary: SendSummary = { ...rest, ...destination, network };
    await keep(this.deps, key, { ...summary, txCbor });
    return summary;
  }
}
