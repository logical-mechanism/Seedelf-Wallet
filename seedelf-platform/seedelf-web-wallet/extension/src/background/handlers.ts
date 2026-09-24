// Request handlers for the service worker. The WebAssembly module and the
// wallet are passed in, so the same code runs under Vitest (Node) and in Chrome.

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import type { Message, Requests, Status } from "../shared/rpc";
import type { BalanceService } from "./balances";
import type { MintService } from "./mint";
import type { MoveInService } from "./move-in";
import type { PendingService } from "./pending";
import type { TransferService } from "./transfer";
import type { Wallet } from "./wallet";

export interface Context {
  wasm: typeof Wasm;
  wallet: Wallet;
  balances: BalanceService;
  moveIn: MoveInService;
  mint: MintService;
  transfer: TransferService;
  pending: PendingService;
  version: string;
  network: NetworkName;
  networks: NetworkName[];
}

export async function handle(message: Message, ctx: Context): Promise<Requests[Message["type"]]["result"]> {
  const { wasm, wallet } = ctx;
  switch (message.type) {
    case "status":
      return status(ctx);
    case "generate-phrase":
      return { phrase: wasm.generatePhrase() };
    case "validate-phrase":
      wasm.validatePhrase(message.phrase);
      return null;
    case "create-wallet":
    case "restore-wallet":
      await wallet.create(message.phrase, message.password);
      return status(ctx);
    case "unlock":
      return wallet.unlock(message.password);
    case "lock":
      await wallet.lock();
      return status(ctx);
    case "activity":
      await wallet.touch();
      return null;
    case "account":
      return wallet.account(ctx.network);
    case "balances":
      return ctx.balances.get(ctx.network, message.refresh ?? false);
    case "wordlist":
      return wasm.bip39Wordlist();
    case "move-in-build":
      return ctx.moveIn.build(ctx.network, message.lovelace, message.tokens);
    case "move-in-submit":
      return ctx.moveIn.submit(ctx.network, message.txHash);
    case "mint-build":
      return ctx.mint.build(ctx.network, message.label, message.from);
    case "mint-submit":
      return ctx.mint.submit(ctx.network, message.txHash);
    case "transfer-lookup":
      return ctx.transfer.lookup(ctx.network, message.to);
    case "transfer-build":
      return ctx.transfer.build(ctx.network, message.to, message.lovelace, message.tokens);
    case "transfer-submit":
      return ctx.transfer.submit(ctx.network, message.txHash);
    case "pending-tx":
      return ctx.pending.pending();
    case "reset-wallet":
      await wallet.reset();
      return status(ctx);
  }
}

async function status({ wallet, version, network, networks }: Context): Promise<Status> {
  const state = await wallet.state();
  const retryAfterMs = state === "locked" ? await wallet.retryAfterMs() : 0;
  return { state, version, network, networks, retryAfterMs };
}
