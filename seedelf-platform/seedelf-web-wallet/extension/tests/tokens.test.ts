import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { TokenAmount } from "../src/shared/rpc";
import { initials, isNft, searchTokens, sortTokens, tint, tokenInfo, viewToken } from "../src/ui/tokens";

const json = (name: string) => JSON.parse(readFileSync(new URL(`../src/tokens/${name}`, import.meta.url), "utf8"));

const token = (over: Partial<TokenAmount>): TokenAmount => ({
  policyId: "c0".repeat(28),
  assetName: "",
  quantity: "1",
  decimals: 0,
  fingerprint: "asset1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
  ...over,
});

// The real preprod tUSDM, in the wallet's list.
const TUSDM = { policyId: "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde", assetName: "0014df10745553444d" };

describe("the wallet's token registry", () => {
  it("has an entry, with a small logo, for every token on its list", () => {
    const list = json("list.json");
    for (const network of ["preprod", "mainnet"]) {
      const registry = json(`registry.${network}.json`);
      const keys = list[network].map((t: { policy: string; name: string }) => `${t.policy}.${t.name}`).sort();
      expect(Object.keys(registry).sort(), network).toEqual(keys);
      for (const [key, info] of Object.entries<{ ticker: string; decimals: number; logo?: string }>(registry)) {
        expect(key).toMatch(/^[0-9a-f]{56}\.[0-9a-f]*$/);
        expect(info.ticker, key).toBe(list[network].find((t: { policy: string; name: string }) => key === `${t.policy}.${t.name}`).ticker);
        expect(Number.isInteger(info.decimals)).toBe(true);
        if (info.logo) {
          expect(info.logo).toMatch(/^data:image\/webp;base64,/);
          expect(info.logo.length, `${info.ticker}'s logo`).toBeLessThan(16_000);
        }
      }
    }
  });

  it("names a listed token by its ticker, with its logo", () => {
    expect(tokenInfo("preprod", TUSDM)?.ticker).toBe("tUSDM");
    const v = viewToken("preprod", token({ ...TUSDM, quantity: "1234560000", decimals: 6 }));
    expect(v.label).toBe("tUSDM");
    expect(v.info?.logo).toMatch(/^data:image\/webp/);
    expect(v.amount).toBe("1,234.56");
    expect(v.nft).toBe(false);
  });

  it("carries only preprod unless it's a mainnet build", () => {
    const snek = { policyId: "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f", assetName: "534e454b" };
    expect(tokenInfo("mainnet", snek)).toBeUndefined();
  });

  it("never gives a lookalike the listed token's logo", () => {
    // Same name, another policy: its own name, the fingerprint under it, letters for a logo.
    const v = viewToken("preprod", token({ assetName: "0014df10745553444d", quantity: "5", decimals: 6 }));
    expect(v.info).toBeUndefined();
    expect(v.label).toBe("tUSDM");
    expect(v.sub).toBe("asset1qqqq…qqqqqq");
  });

  it("falls back on the fingerprint when a name isn't text, and on Koios's decimals", () => {
    const v = viewToken("preprod", token({ assetName: "accbfb633f637e3b", quantity: "5" }));
    expect(v.label).toBe("asset1qqqq…qqqqqq");
    expect(viewToken("preprod", token({ ...TUSDM, quantity: "1000000", decimals: 0 })).amount).toBe("1");
  });
});

describe("NFTs, without asking anyone", () => {
  it("follows CIP-68 labels, then a single unit with no decimals", () => {
    expect(isNft(token({ assetName: "000de14048414e4f49303031", quantity: "2" }))).toBe(true);
    expect(isNft(token({ assetName: "0014df104c494e4b", quantity: "1" }))).toBe(false);
    expect(isNft(token({ assetName: "001bc2804c494e4b", quantity: "1" }))).toBe(false);
    expect(isNft(token({ assetName: "48414e4f49", quantity: "1" }))).toBe(true);
    expect(isNft(token({ assetName: "48414e4f49", quantity: "1", decimals: 6 }))).toBe(false);
    expect(isNft(token({ assetName: "48414e4f49", quantity: "2" }))).toBe(false);
  });

  it("a listed token is fungible even when one unit is held", () => {
    expect(isNft(token({ ...TUSDM, quantity: "1" }), tokenInfo("preprod", TUSDM))).toBe(false);
  });
});

describe("sorting and searching", () => {
  const views = [
    token({ assetName: "5a5a", quantity: "2" }), // "ZZ", 2
    token({ assetName: "6162", quantity: "1500000", decimals: 6, policyId: "d1".repeat(28) }), // "ab", 1.5
    token({ assetName: "4d4d", quantity: "30", fingerprint: "asset1findme" }), // "MM", 30
  ].map((t) => viewToken("preprod", t));

  it("by name, A to Z whatever the case; by amount, largest first across decimals", () => {
    expect(sortTokens(views, "name").map((v) => v.label)).toEqual(["ab", "MM", "ZZ"]);
    expect(sortTokens(views, "amount").map((v) => v.label)).toEqual(["MM", "ZZ", "ab"]);
  });

  it("finds by name, policy ID and fingerprint", () => {
    expect(searchTokens(views, " zz ").map((v) => v.label)).toEqual(["ZZ"]);
    expect(searchTokens(views, "D1D1").map((v) => v.label)).toEqual(["ab"]);
    expect(searchTokens(views, "findme").map((v) => v.label)).toEqual(["MM"]);
    expect(searchTokens(views, "")).toHaveLength(3);
  });

  it("avatars: two letters, and a tint that's the same for a whole policy", () => {
    expect(initials("tUSDM")).toBe("TU");
    expect(initials("$-2")).toBe("2");
    expect(initials("…")).toBe("?");
    expect(tint("c0".repeat(28))).toBe(tint("c0".repeat(28)));
    expect(tint("c0".repeat(28))).toBeGreaterThanOrEqual(0);
    expect(tint("c0".repeat(28))).toBeLessThan(6);
  });
});
