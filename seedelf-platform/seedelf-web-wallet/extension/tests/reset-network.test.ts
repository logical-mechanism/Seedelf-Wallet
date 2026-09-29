// A wallet from before the network switch keeps no network, only works it
// out from its vault (preprod). Removing it, or Forgot password, keeps that
// network, so the phrase is restored on preprod, never on mainnet first, and
// the reset's answer says the network as it now stands (independent review
// L42).
import { describe, expect, it } from "vitest";

import { handle, type Context } from "../src/background/handlers";
import { LOCAL_NETWORK, NetworkChoice } from "../src/background/preferences";
import type { NetworkName } from "../src/networks";
import type { Account, Message, Status } from "../src/shared/rpc";
import { loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";

/** The worker's handlers on a build with both networks, mainnet first, as the store's is. */
function context(t: ReturnType<typeof testBalances>): Context {
  const networks: NetworkName[] = ["mainnet", "preprod"];
  return {
    ...(t as unknown as Context),
    wasm: loadTestWasm(),
    connector: async (on) => on,
    version: "1.0.0",
    network: "mainnet",
    networks,
    networkChoice: new NetworkChoice(t.local, networks),
  };
}

/** A request as the worker answers it: on the network chosen as it comes in. */
async function ask(message: Message, ctx: Context) {
  return handle(message, { ...ctx, network: await ctx.networkChoice.get() });
}

describe("removing a wallet from before the network switch", () => {
  for (const locked of [false, true]) {
    it(`keeps it on preprod for the next restore${locked ? ", from Forgot password" : ""}`, async () => {
      const t = testBalances();
      const ctx = context(t);
      const phrase = vectors("cardano_account.json").find((v) => v.account === 0)!.phrase;
      await t.wallet.create(phrase, PASSWORD);
      // Made before the switch: no network kept, so it's on preprod by its vault.
      await t.local.remove(LOCAL_NETWORK);
      expect(await ctx.networkChoice.get()).toBe("preprod");
      if (locked) await t.wallet.lock();

      const answer = (await ask({ type: "reset-wallet" }, ctx)) as Status;
      expect(answer).toMatchObject({ state: "no-wallet", network: "preprod" });
      expect(await ctx.networkChoice.get()).toBe("preprod");

      expect(await ask({ type: "restore-wallet", phrase, password: PASSWORD }, ctx)).toMatchObject({ network: "preprod" });
      const account = (await ask({ type: "account" }, ctx)) as Account;
      expect(account.receiveAddress.startsWith("addr_test1")).toBe(true);
    });
  }

  it("leaves a wallet's own network as it was", async () => {
    const t = testBalances();
    const ctx = context(t);
    await ask({ type: "restore-wallet", phrase: vectors("cardano_account.json")[0]!.phrase, password: PASSWORD }, ctx);
    expect(await ctx.networkChoice.get()).toBe("mainnet");
    expect(await ask({ type: "reset-wallet" }, ctx)).toMatchObject({ network: "mainnet" });
    expect(await ctx.networkChoice.get()).toBe("mainnet");
  });
});
