// A wallet from before the network switch keeps no network, only works it
// out from its vault (preprod). Removing it, or Forgot password, keeps that
// network, so the phrase is restored on preprod, never on mainnet first, and
// the reset's answer says the network as it now stands (independent review
// L42). The Koios-only switch beside it in Settings is kept the same way, so
// the restore after either asks Koios alone, its look for accounts and its
// scan of the one-time accounts too (1.5.0's release review, C08).
import { describe, expect, it, vi } from "vitest";

import { AccountsService } from "../src/background/accounts";
import { Collateral } from "../src/background/collateral";
import { chainClient, DataParts, type DataDeps } from "../src/background/data-layer";
import { handle, type Context } from "../src/background/handlers";
import { Minswap } from "../src/background/minswap";
import { LOCAL_NETWORK, LOCAL_PREFERENCES, NetworkChoice } from "../src/background/preferences";
import { SessionService } from "../src/background/sessions";
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

describe("Read Cardano through Koios only, across a reset", () => {
  const DATA = "https://data.test";
  const phrase = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 24)!.phrase as string;

  /** A mainnet build's worker: every account and session read goes through the data layer's client, as sw.ts wires it. */
  function worker() {
    const t = testBalances();
    const hosts: string[] = [];
    const deps: DataDeps = {
      // sw.ts: read at each request.
      koiosOnly: async () => (await t.preferences.get()).koiosOnly,
      parts: new DataParts(t.session, () => t.clock.now),
      fetch: async (url, init) => {
        hosts.push(new URL(url).host);
        return t.koios.fetch(url, init as never);
      },
      sleep: async () => undefined,
      limits: {},
    };
    const koios = chainClient(deps, (n) => (n === "mainnet" ? DATA : undefined));
    const sessions = new SessionService({
      ...t.deps,
      koios,
      collateral: () => new Collateral("https://www.giveme.my/mainnet/collateral/", t.collateral.fetch),
      store: t.store,
      minswap: () => new Minswap("https://agg-api.minswap.org/aggregator", t.minswap.fetch),
      alarm: { start: async () => undefined },
    });
    const ctx: Context = { ...context(t), accounts: new AccountsService({ ...t.deps, koios }), sessions, dataParts: deps.parts };
    return { t, ctx, hosts };
  }

  for (const locked of [false, true]) {
    it(`stays on through ${locked ? "Forgot password" : "Remove wallet"}, so the restore after it asks Koios alone`, async () => {
      const { t, ctx, hosts } = worker();
      await ask({ type: "preferences-set", koiosOnly: true, currency: "off" } as Message, ctx);
      await ask({ type: "restore-wallet", phrase, password: PASSWORD }, ctx);
      // One-time account 0 was used on mainnet, with one transaction: the restore's scan reads it.
      const stake = await t.wallet.withKeys((keys) => keys.oneTime.rewardAddress(loadTestWasm().Network.Mainnet, 0));
      t.koios.usedStakes.add(stake);
      t.koios.accountTxs.set(stake, [{ tx_hash: "f0".repeat(32), block_height: 5_000_000, block_time: 1_700_000_000 }]);
      if (locked) await ask({ type: "lock" }, ctx);

      await ask({ type: "reset-wallet", ...(locked ? {} : { force: true }) }, ctx);
      // Kept as the network is; every other setting goes back to its default.
      expect(await t.preferences.get()).toMatchObject({ koiosOnly: true, currency: "usd" });

      hosts.length = 0;
      await ask({ type: "restore-wallet", phrase, password: PASSWORD }, ctx);
      await vi.waitFor(async () => expect((await t.store.get<{ next: number }>("sessions.mainnet"))?.next).toBe(1));
      // The look for accounts and the scan of the one-time accounts, from the account's money to its transactions'
      // tx_info: all asked of Koios, none of the data layer.
      expect(hosts.length).toBeGreaterThan(0);
      expect(new Set(hosts)).toEqual(new Set(["api.koios.rest"]));
    });
  }

  it("goes on as before when it was off: removing the wallet leaves no settings behind", async () => {
    const { t, ctx } = worker();
    await ask({ type: "restore-wallet", phrase, password: PASSWORD }, ctx);
    await ask({ type: "reset-wallet", force: true }, ctx);
    expect((await t.preferences.get()).koiosOnly).toBe(false);
    expect(t.local.data.has(LOCAL_PREFERENCES)).toBe(false);
  });
});
