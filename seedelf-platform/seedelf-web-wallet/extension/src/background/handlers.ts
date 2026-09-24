// Request handlers for the service worker. The WebAssembly module and the
// wallet are passed in, so the same code runs under Vitest (Node) and in Chrome.

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import type { Message, Requests, Status } from "../shared/rpc";
import type { Wallet } from "./wallet";

export interface Context {
  wasm: typeof Wasm;
  wallet: Wallet;
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
    case "wordlist":
      return wasm.bip39Wordlist();
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
