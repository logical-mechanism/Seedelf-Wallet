// Messages through the handlers (handlers.ts), as a page asks for it: rules that held with no test before the 1.10.0
// gate (cross-feature#10, tests-ci#5 (a)). A page's 10 s poll and its reads aren't activity, so the auto-lock comes as
// it would with no page open; a Messages switch moves through `messaging-switch` alone, never `preferences-set`; and
// Remove wallet leaves Messages off with its records gone, Koios-only kept, so the next wallet asks the relay nothing
// until its own switch. The round-one review's scratch tests, lifted.
import { describe, expect, it } from "vitest";

import { handle, type Context } from "../src/background/handlers";
import { NetworkChoice } from "../src/background/preferences";
import { PRIVATE_PREFIX } from "../src/background/private-store";
import { AUTO_LOCK_MS } from "../src/background/wallet";
import { MESSAGING_SYNC_EVERY_MS, type MessagingOverview, type Message } from "../src/shared/rpc";
import { loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const phraseOf = (words: number) =>
  (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find((v) => v.account === 0 && v.phrase.split(" ").length === words)!
    .phrase;

function context(t: ReturnType<typeof testBalances>): Context {
  const { wallet, session, balances, moveIn, mint, transfer, withdraw, send, pending, contacts, messaging, activity, coins, staking, preferences, prices, nftImages, dapp, sessions, lovejoin, launch, accounts, dataParts } =
    t;
  return {
    wasm: loadTestWasm(),
    wallet,
    session,
    balances,
    moveIn,
    mint,
    transfer,
    withdraw,
    send,
    pending,
    contacts,
    messaging,
    activity,
    coins,
    staking,
    preferences,
    prices,
    nftImages,
    dapp,
    sessions,
    lovejoin,
    launch,
    accounts,
    dataParts,
    connector: async (on: boolean) => on,
    version: "1.0.0",
    network: "preprod",
    networks: ["preprod"],
    networkChoice: new NetworkChoice(t.local, ["preprod"]),
  } as unknown as Context;
}

const ask = (message: Record<string, unknown>, ctx: Context) => handle(message as unknown as Message, ctx);

describe("Messages through the handlers (cross-feature#10)", () => {
  it("isn't activity: a page polling every 10 s and reading the overview locks at the auto-lock's time, and locked asks nothing", async () => {
    const t = testBalances();
    const ctx = context(t);
    await ask({ type: "create-wallet", phrase: phraseOf(24), password: PASSWORD }, ctx);
    await ask({ type: "messaging-switch", on: true }, ctx);
    await t.messaging.whenIdle();
    let locked: number | undefined;
    for (let ms = 0; ms <= AUTO_LOCK_MS + 20_000; ms += 10_000) {
      t.clock.now += 10_000;
      await ask({ type: "messaging-sync" }, ctx);
      const overview = await ask({ type: "messaging" }, ctx).catch(() => undefined);
      if (!overview && locked === undefined) locked = ms + 10_000;
    }
    expect(await t.wallet.state()).toBe("locked");
    expect(locked).toBeDefined();
    expect(locked!).toBeLessThanOrEqual(AUTO_LOCK_MS + 10_000);
    t.relay.calls.length = 0;
    await ask({ type: "messaging-sync" }, ctx);
    await t.messaging.whenIdle();
    expect(t.relay.calls).toEqual([]);
  });

  it("answers a page's poll with how long until the worker's one grid's next tick (round 5)", async () => {
    const t = testBalances();
    const ctx = context(t);
    await ask({ type: "create-wallet", phrase: phraseOf(24), password: PASSWORD }, ctx);
    await ask({ type: "messaging-switch", on: true }, ctx);
    await t.messaging.whenIdle();
    // No page heard from: a whole period.
    expect(await ask({ type: "messaging-sync" }, ctx)).toEqual({ nextIn: MESSAGING_SYNC_EVERY_MS });
    const first = (await ask({ type: "messaging-sync", page: "page-1", kind: "view" }, ctx)) as { nextIn: number };
    expect(first.nextIn).toBeGreaterThan(0);
    expect(first.nextIn).toBeLessThanOrEqual(MESSAGING_SYNC_EVERY_MS);
    // A second page shown is on the first one's grid: its next tick is the same moment.
    const second = (await ask({ type: "messaging-sync", page: "page-2", kind: "view" }, ctx)) as { nextIn: number };
    expect(second.nextIn).toBeLessThanOrEqual(first.nextIn);
    expect(first.nextIn - second.nextIn).toBeLessThan(5000);
    await t.messaging.whenIdle();
  });

  it("moves a switch through messaging-switch alone: preferences-set carries none, and changes the rest", async () => {
    const t = testBalances();
    const ctx = context(t);
    await ask({ type: "create-wallet", phrase: phraseOf(24), password: PASSWORD }, ctx);
    await ask({ type: "preferences-set", messaging: { preprod: true, mainnet: true } }, ctx);
    expect((await t.preferences.get()).messaging).toEqual({ preprod: false, mainnet: false });
    await ask({ type: "messaging-switch", on: true }, ctx);
    await ask({ type: "preferences-set", messaging: { preprod: false }, hideBalances: true }, ctx);
    expect(await t.preferences.get()).toMatchObject({ hideBalances: true, messaging: { preprod: true, mainnet: false } });
    await t.messaging.whenIdle();
  });

  it("refuses a switch asked while locked, and changes nothing", async () => {
    const t = testBalances();
    const ctx = context(t);
    await ask({ type: "create-wallet", phrase: phraseOf(24), password: PASSWORD }, ctx);
    await ask({ type: "lock" }, ctx);
    t.relay.calls.length = 0;
    await expect(ask({ type: "messaging-switch", on: true }, ctx)).rejects.toThrow("The wallet is locked.");
    await t.messaging.whenIdle();
    expect((await t.preferences.get()).messaging).toEqual({ preprod: false, mainnet: false });
    expect(t.relay.calls).toEqual([]);
  });

  it("leaves Messages off and its records gone after Remove wallet, Koios-only kept, and the next wallet asks nothing", async () => {
    const t = testBalances();
    const ctx = context(t);
    await ask({ type: "create-wallet", phrase: phraseOf(24), password: PASSWORD }, ctx);
    await ask({ type: "preferences-set", koiosOnly: true }, ctx);
    await ask({ type: "messaging-switch", on: true }, ctx);
    await t.messaging.whenIdle();
    expect(await t.local.keys(PRIVATE_PREFIX + "messaging.")).not.toEqual([]);
    await ask({ type: "reset-wallet", force: true }, ctx);
    expect(await t.preferences.get()).toMatchObject({ koiosOnly: true, messaging: { preprod: false, mainnet: false } });
    expect(await t.local.keys(PRIVATE_PREFIX + "messaging.")).toEqual([]);
    expect(await t.local.keys(PRIVATE_PREFIX + "conversation.")).toEqual([]);
    t.relay.calls.length = 0;
    await ask({ type: "create-wallet", phrase: phraseOf(12), password: PASSWORD }, ctx);
    await t.messaging.syncAll(["preprod"]);
    await ask({ type: "messaging-sync" }, ctx);
    await t.messaging.whenIdle();
    expect(t.relay.calls).toEqual([]);
    expect((await ask({ type: "messaging" }, ctx)) as MessagingOverview).toMatchObject({ on: false, conversations: [], requests: [] });
  });
});
