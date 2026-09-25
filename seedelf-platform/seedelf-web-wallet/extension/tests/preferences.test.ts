// The settings, ADA's price, and ADA Handles among a balance's tokens.
import { describe, expect, it } from "vitest";

import { PreferencesService } from "../src/background/preferences";
import { LOCAL_PRICES, PRICE_TTL_MS, PriceService } from "../src/background/prices";
import { ADA_HANDLE_POLICY, handleOf, handlesIn } from "../src/shared/handles";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import { fakeCoinGecko, memoryArea } from "./fakes";

const hex = (text: string) => Buffer.from(text).toString("hex");

describe("preferences", () => {
  it("start from the defaults, and take only values they may", async () => {
    const prefs = new PreferencesService(memoryArea());
    expect(await prefs.get()).toEqual(DEFAULT_PREFERENCES);
    expect(DEFAULT_PREFERENCES).toEqual({
      spendRewards: true,
      hideBalances: false,
      lockAfterMinutes: 15,
      currency: "usd",
      // Sites can't see the wallet until the user turns the connector on.
      dappConnector: false,
    });

    expect(await prefs.set({ hideBalances: true, lockAfterMinutes: 60, currency: "eur" })).toEqual({
      spendRewards: true,
      hideBalances: true,
      lockAfterMinutes: 60,
      currency: "eur",
      dappConnector: false,
    });
    expect(await prefs.lockAfterMs()).toBe(60 * 60_000);

    // Nothing it can't be: 7 minutes, a currency the wallet doesn't offer, a string for a switch.
    await prefs.set({ lockAfterMinutes: 7 as never, currency: "xyz" as never, hideBalances: "yes" as never });
    expect(await prefs.get()).toMatchObject({ hideBalances: true, lockAfterMinutes: 60, currency: "eur" });
    await prefs.set({ currency: "off" });
    expect((await prefs.get()).currency).toBe("off");
    await prefs.set({ dappConnector: "on" as never });
    expect((await prefs.get()).dappConnector).toBe(false);
    await prefs.set({ dappConnector: true });
    expect((await prefs.get()).dappConnector).toBe(true);
  });

  it("read a kept value that's no longer allowed as the default", async () => {
    const local = memoryArea();
    await local.set("seedelf.preferences", { spendRewards: false, lockAfterMinutes: 1440, currency: 3 });
    expect(await new PreferencesService(local).get()).toEqual({ ...DEFAULT_PREFERENCES, spendRewards: false });
  });
});

describe("ADA's price", () => {
  function prices(rates?: Record<string, number>) {
    const local = memoryArea();
    const preferences = new PreferencesService(local);
    const clock = { now: 1_800_000_000_000 };
    const coingecko = fakeCoinGecko(rates);
    const service = new PriceService({ local, preferences, now: () => clock.now, fetch: coingecko.fetch });
    return { local, preferences, clock, coingecko, service };
  }

  it("asks no one on preprod: test ADA has no price", async () => {
    const t = prices();
    expect(await t.service.get("preprod")).toBeNull();
    expect(t.coingecko.state.urls).toEqual([]);
  });

  it("reads every currency in one request on mainnet, and keeps it five minutes", async () => {
    const t = prices();
    expect(await t.service.get("mainnet")).toEqual({ currency: "usd", rate: 0.25, updatedAt: t.clock.now });
    expect(t.coingecko.state.urls).toEqual([
      "https://api.coingecko.com/api/v3/simple/price?ids=cardano&vs_currencies=usd,eur,gbp,jpy,cad,aud,chf,brl",
    ]);

    // Another currency, or asking again, is answered from what's kept.
    await t.preferences.set({ currency: "eur" });
    t.clock.now += PRICE_TTL_MS - 1;
    expect(await t.service.get("mainnet")).toMatchObject({ currency: "eur", rate: 0.22 });
    expect(t.coingecko.state.urls).toHaveLength(1);

    // Five minutes on, it's read again.
    t.clock.now += 1;
    t.coingecko.state.rates.eur = 0.3;
    expect(await t.service.get("mainnet")).toMatchObject({ currency: "eur", rate: 0.3, updatedAt: t.clock.now });
    expect(t.coingecko.state.urls).toHaveLength(2);
  });

  it("asks nothing with the currency off, and shows nothing for one it didn't answer", async () => {
    const t = prices({ usd: 0.25 });
    await t.preferences.set({ currency: "off" });
    expect(await t.service.get("mainnet")).toBeNull();
    expect(t.coingecko.state.urls).toEqual([]);
    await t.preferences.set({ currency: "chf" });
    expect(await t.service.get("mainnet")).toBeNull();
    expect(t.coingecko.state.urls).toHaveLength(1);
  });

  it("keeps showing the last price for an hour when CoinGecko can't be read, then nothing", async () => {
    const t = prices();
    await t.service.get("mainnet");
    t.coingecko.state.fail = true;
    t.clock.now += PRICE_TTL_MS;
    expect(await t.service.get("mainnet")).toMatchObject({ rate: 0.25 });
    t.clock.now += 60 * 60_000;
    expect(await t.service.get("mainnet")).toBeNull();
    // A nonsense answer isn't kept.
    t.coingecko.state.fail = false;
    t.coingecko.state.rates = { usd: -1 };
    expect(await t.service.get("mainnet")).toBeNull();
    expect((await t.local.get<{ rates: object }>(LOCAL_PRICES))!.rates).toEqual({
      usd: 0.25,
      eur: 0.22,
      gbp: 0.19,
      jpy: 39.65,
    });
  });
});

describe("ADA Handles", () => {
  it("are the policy's plain and CIP-68 user tokens, by name", () => {
    expect(handleOf({ policyId: ADA_HANDLE_POLICY, assetName: hex("alice") })).toBe("alice");
    expect(handleOf({ policyId: ADA_HANDLE_POLICY, assetName: `000de140${hex("bob.sub")}` })).toBe("bob.sub");
    // The reference token (label 100) sits with the handle's contract, not its owner.
    expect(handleOf({ policyId: ADA_HANDLE_POLICY, assetName: `000643b0${hex("bob")}` })).toBeUndefined();
    // Another policy, or a name no handle can have.
    expect(handleOf({ policyId: "ab".repeat(28), assetName: hex("alice") })).toBeUndefined();
    expect(handleOf({ policyId: ADA_HANDLE_POLICY, assetName: hex("Not A Handle") })).toBeUndefined();
    expect(
      handlesIn([
        { policyId: ADA_HANDLE_POLICY, assetName: hex("zed") },
        { policyId: ADA_HANDLE_POLICY, assetName: `000de140${hex("amy")}` },
        { policyId: ADA_HANDLE_POLICY, assetName: hex("zed") },
      ]),
    ).toEqual(["amy", "zed"]);
  });
});
