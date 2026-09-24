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

import type { NetworkName } from "../networks";
import type { PendingTx, SendSummary, TokenQuantity } from "../shared/rpc";
import { readAccount } from "./account";
import { resolveDestination } from "./destination";
import { keep, send, type ScriptSpendDeps } from "./script-spend";

/** chrome.storage.session: the payment built last, until it's sent or replaced. */
export const SESSION_SEND = "seedelf.send.built";

type SendResult = Omit<SendSummary, "network" | "address" | "handle" | "own"> & { txCbor: string; to: string };

export class SendService {
  constructor(private readonly deps: ScriptSpendDeps) {}

  /**
   * Pays `to` (an address or `$handle`) `lovelace` and `tokens`. `lovelace`
   * null sends the most possible; below what the payment needs, it's raised
   * to that, so "0" sends only the ADA the tokens need.
   */
  async build(network: NetworkName, to: string, lovelace: string | null, tokens: TokenQuantity[]): Promise<SendSummary> {
    const { wasm, wallet } = this.deps;
    const destination = await resolveDestination(this.deps, network, to);
    const { params, utxos } = await readAccount(this.deps, network);
    if (utxos.length === 0) throw new Error("Your Cardano account is empty, so there's nothing to send.");

    const request = { network, params, utxos, to: destination.address, lovelace, tokens };
    const result = await wallet.withKeys(
      (keys) => JSON.parse(wasm.buildAccountSend(keys.cardano, JSON.stringify(request))) as SendResult,
    );
    const { txCbor, to: _to, ...rest } = result;
    const summary: SendSummary = { ...rest, ...destination, network };
    await keep(this.deps, SESSION_SEND, { ...summary, txCbor });
    return summary;
  }

  /** Signed at review: Send only submits it. */
  submit(network: NetworkName, txHash: string): Promise<PendingTx> {
    return send(this.deps, network, txHash, SESSION_SEND, "send", "payment");
  }
}
