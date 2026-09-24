// Request handlers for the service worker. The WebAssembly module is passed
// in, so the same code runs under Vitest (Node) and in Chrome.

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import type { Message, Preview, Requests, Status } from "../shared/rpc";

export interface Context {
  wasm: typeof Wasm;
  version: string;
  network: NetworkName;
  networks: NetworkName[];
}

export async function handle(message: Message, ctx: Context): Promise<Requests[Message["type"]]["result"]> {
  switch (message.type) {
    case "status":
      return status(ctx);
    case "preview":
      return preview(message.phrase, ctx);
  }
}

function status({ version, network, networks }: Context): Status {
  return { version, network, networks };
}

function preview(typed: string | undefined, { wasm, network }: Context): Preview {
  const started = performance.now();
  const generated = !typed?.trim();
  const phrase = generated ? wasm.generatePhrase() : typed!.trim();

  // fromPhrase validates the phrase and throws a user-facing reason.
  const seedelf = wasm.SeedelfKey.fromPhrase(phrase, 0);
  try {
    const cardano = wasm.CardanoAccount.fromPhrase(phrase, 0);
    try {
      const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
      const base = seedelf.baseRegister();
      const seedelfPublicValue = base.publicValue;
      base.free();
      return {
        phrase,
        generated,
        receiveAddress: cardano.receiveAddress(net, 0),
        changeAddress: cardano.changeAddress(net, 0),
        stakeAddress: cardano.stakeAddress(net),
        seedelfPublicValue,
        millis: Math.round(performance.now() - started),
      };
    } finally {
      cardano.free();
    }
  } finally {
    seedelf.free();
  }
}
