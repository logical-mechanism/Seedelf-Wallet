// Send: pay any normal address, or an ADA Handle, from the Cardano account,
// as any Cardano wallet does; or someone's seedelf, by its full name. One
// payment pays up to 20 of them, each its own amount and tokens, with an
// optional note (CIP-20's message, which anyone can read). It's paid in the
// open, and the Cardano account's Activity lists it from Koios.
//
// build   reads each destination (destination.ts) and the account
//         (account.ts), then builds and signs inside WebAssembly
//         (seedelf-core `build::account_send_many`), like a move-in. A seedelf is
//         found in the wallet contract as Transfer finds it (transfer.ts),
//         never by asking Koios about its token, and paid like a move-in but
//         under a fresh copy of its register: only
//         its owner can spend it, and nothing on chain ties it to their
//         seedelf. The signed transaction waits in session storage until the
//         user confirms it.
// submit  sends exactly that transaction (script-spend.ts `send`), then hands
//         it to the pending watch.
//
// Setting a collateral (coin-control.ts) is one of these too: 5 ₳ paid to the
// account's own `0/0`, whose output (the first: the payment comes before the
// change) is the collateral from Send on.

import type { NetworkName } from "../networks";
import type { Paid, PaymentAsk, PendingTx, SendPaid, SendSummary, WithdrawDestination } from "../shared/rpc";
import { checkRecipients } from "../shared/recipients";
import { OWN_SEEDELF_FROM_ACCOUNT, seedelfName } from "../shared/seedelf-name";
import { nothingInAccount, readAccount } from "./account";
import { seedelfLabel } from "./chain";
import { COLLATERAL_LOVELACE } from "./coin-control";
import { readContractView, type ContractView } from "./contract-scan";
import { destinationResolver } from "./destination";
import type { KoiosUtxo } from "./koios";
import { keep, send, type ScriptSpendDeps } from "./script-spend";
import { holdsOwn, seedelfUtxo } from "./transfer";

/** chrome.storage.session: the payment built last, until it's sent or replaced. */
export const SESSION_SEND = "seedelf.send.built";

/** chrome.storage.session: the collateral payment built last. */
export const SESSION_COLLATERAL = "seedelf.collateral.built";

type SendResult = Omit<SendSummary, "network" | "payments"> & { txCbor: string; payments: Array<Paid & { to: string }> };

/** Where a payment goes: an address, or a seedelf with the contract UTxO holding it. */
type Destination = WithdrawDestination & Pick<SendPaid, "seedelf"> & { recipient?: KoiosUtxo };

export class SendService {
  constructor(private readonly deps: ScriptSpendDeps) {}

  /**
   * Pays each of `payments` its `lovelace` and `tokens`, in one transaction.
   * `to` is an address, a `$handle`, or a seedelf's full name. `lovelace`
   * null sends the most possible, to a single recipient; below what a
   * payment needs, it's raised to that, so "0" sends only the ADA the tokens
   * need.
   */
  async build(network: NetworkName, payments: PaymentAsk[], note?: string): Promise<SendSummary> {
    checkRecipients(payments.length);
    const names = payments.map((p) => seedelfName(p.to));
    // Every seedelf among them is found in one reading of the contract.
    const view = names.some(Boolean) ? await readContractView(this.deps, network) : undefined;
    const resolve = destinationResolver(this.deps, network);
    const destinations: Destination[] = [];
    for (const [i, p] of payments.entries()) {
      const name = names[i];
      destinations.push(name ? seedelf(view!, network, name) : await resolve(p.to));
    }
    return this.pay(network, destinations, payments, SESSION_SEND, note);
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
    const payment = { to: address, lovelace: COLLATERAL_LOVELACE.toString(), tokens: [] };
    return this.pay(network, [{ address, own: true }], [payment], SESSION_COLLATERAL);
  }

  /** Sends the collateral payment; its first output is the collateral from now on. */
  async submitCollateral(network: NetworkName, txHash: string): Promise<PendingTx> {
    const pending = await send(this.deps, network, txHash, SESSION_COLLATERAL, "collateral", "collateral payment");
    await this.deps.coins.sent(network, `${txHash}#0`);
    return pending;
  }

  private async pay(
    network: NetworkName,
    destinations: Destination[],
    asked: PaymentAsk[],
    key: string,
    note?: string,
  ): Promise<SendSummary> {
    const { wasm, wallet } = this.deps;
    const { params, utxos, held, withdrawal } = await readAccount(this.deps, network);
    if (utxos.length === 0) throw nothingInAccount(held, "Your public account is empty, so there's nothing to send.");

    const payments = destinations.map((d, i) => ({
      to: d.seedelf?.name ?? d.address,
      recipient: d.recipient,
      lovelace: asked[i]!.lovelace,
      tokens: asked[i]!.tokens,
    }));
    // A note is CIP-20's message on the transaction, which WebAssembly checks and writes.
    const request = { network, params, utxos, payments, withdrawal, note: note || undefined };
    const result = await wallet.withKeys(
      (keys) => JSON.parse(wasm.buildAccountSend(keys.cardano, JSON.stringify(request))) as SendResult,
    );
    const { txCbor, payments: paid, ...rest } = result;
    const summary: SendSummary = {
      ...rest,
      network,
      payments: paid.map(({ to: _to, ...p }, i) => {
        const { recipient: _recipient, ...shown } = destinations[i]!;
        return { ...shown, ...p };
      }),
    };
    await keep(this.deps, key, { ...summary, txCbor });
    return summary;
  }
}

/** Someone else's seedelf, found in the wallet contract. Your own is a move-in, so it's refused. */
function seedelf(view: ContractView, network: NetworkName, name: string): Destination {
  const recipient = seedelfUtxo(view, name, network);
  if (holdsOwn(view, recipient)) throw new Error(OWN_SEEDELF_FROM_ACCOUNT);
  const label = seedelfLabel(name);
  return { address: recipient.address, own: false, seedelf: label ? { name, label } : { name }, recipient };
}
