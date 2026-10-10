// Every request to a service goes out without the browser's cookies or a
// referrer (privacy review §2.14), and leaves nothing in Chrome's cache on the
// disk: Koios, giveme.my, CoinGecko, Minswap, the IPFS gateway for an NFT's
// image, and the data layer, whose API marks every answer no-store.
// The worker holds a host permission for most of them, and a fetch with it
// would carry any cookie the browser has for that host; one of giveme.my's
// would tie every private payment to this browser.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { chainClient, DataParts } from "../src/background/data-layer";
import { Koios, type FetchLike } from "../src/background/koios";
import { Minswap } from "../src/background/minswap";
import { NftImageService } from "../src/background/nft-image";
import { PreferencesService } from "../src/background/preferences";
import { PriceService } from "../src/background/prices";
import { ADA_HANDLE_POLICY } from "../src/shared/handles";
import { memoryArea } from "./fakes";

/** A fetch that keeps what each request went out with, and answers `body`. */
function recording(body: unknown) {
  const inits: RequestInit[] = [];
  const fetchFn: FetchLike = async (_url, init) => {
    inits.push(init);
    return Response.json(body);
  };
  return { inits, fetchFn };
}

const privately = (init: RequestInit) => {
  expect(init.credentials).toBe("omit");
  expect(init.referrerPolicy).toBe("no-referrer");
  // The disk never says what the wallet asked about: an ADA Handle, a DRep ID, an NFT, or when.
  expect(init.cache).toBe("no-store");
};

describe("a service request", () => {
  it("to Koios carries no cookies or referrer, and isn't cached: the GETs that name an ADA Handle or a DRep ID, POSTs and a submit", async () => {
    const { inits, fetchFn } = recording([]);
    const koios = new Koios("https://preprod.koios.rest/api/v1", fetchFn, async () => undefined);
    // A GET's address and answer are what Chrome's disk cache would keep, and these name what the wallet asked
    // about: a handle Withdraw resolved, and the DRep whose votes Voting read (1.3.0's release review, C33).
    await koios.assetNftAddress(ADA_HANDLE_POLICY, "6d7968616e646c65");
    await koios.drepVotes("drep1y2jmg4g450lced7q9n34rq6d5vjwkm0ugx6h0894u6ur92s9txn3a", ["gov_action1abc"]);
    expect(inits.map((i) => i.method)).toEqual(["GET", "GET"]);
    await koios.credentialUtxos(["94bc"]);
    await koios.txStatus(["ab"]).catch(() => undefined);
    const submit = recording("ab");
    await new Koios("https://preprod.koios.rest/api/v1", submit.fetchFn, async () => undefined)
      .submitTx(new Uint8Array([0x84]))
      .catch(() => undefined);
    expect(inits.filter((i) => i.method === "POST").length).toBeGreaterThanOrEqual(2);
    expect(submit.inits).toHaveLength(1);
    [...inits, ...submit.inits].forEach(privately);
  });

  it("to the data layer carries none, and lets Chrome reuse a POST's preflight, a GET kept out of the cache", async () => {
    // 1.4.0: `no-store` made Chrome send a CORS preflight before every POST, one more round trip each. The API
    // answers every request with Cache-Control: no-store (seedelf-data's app()), so nothing it says is kept, and
    // the preflight Chrome keeps in memory names only the route. Its fallback to Koios stays no-store.
    const { inits, fetchFn } = recording([]);
    const urls: string[] = [];
    const fetch: FetchLike = (url, init) => {
      urls.push(url);
      return fetchFn(url, init);
    };
    const koios = chainClient(
      { koiosOnly: async () => false, parts: new DataParts(memoryArea()), fetch, sleep: async () => undefined, limits: {} },
      (n) => (n === "mainnet" ? "https://data.test" : undefined),
    )("mainnet");
    await koios.credentialUtxos(["94bc"]);
    await koios.assetNftAddress(ADA_HANDLE_POLICY, "6d7968616e646c65");
    await koios.submitTx(new Uint8Array([0x84])).catch(() => undefined);
    expect(urls.every((u) => u.startsWith("https://data.test/"))).toBe(true);
    expect(inits.map((i) => [i.method, i.cache])).toEqual([
      ["POST", "default"],
      // A GET needs no preflight, and its address names an ADA Handle: no-store, whatever the server says.
      ["GET", "no-store"],
      ["POST", "default"],
    ]);
    for (const init of inits) {
      expect(init.credentials).toBe("omit");
      expect(init.referrerPolicy).toBe("no-referrer");
    }

    // The data layer down: the same call on Koios, no-store.
    inits.length = 0;
    const down = chainClient(
      {
        koiosOnly: async () => false,
        parts: new DataParts(memoryArea()),
        fetch: async (url, init) => (url.startsWith("https://data.test/") ? Promise.reject(new TypeError("Failed to fetch")) : fetchFn(url, init)),
        sleep: async () => undefined,
        limits: {},
      },
      (n) => (n === "mainnet" ? "https://data.test" : undefined),
    )("mainnet");
    await down.credentialUtxos(["94bc"]);
    expect(inits).toHaveLength(1);
    privately(inits[0]!);
  });

  it("to giveme.my carries none", async () => {
    const { inits, fetchFn } = recording({ witness: "a1" });
    await new Collateral("https://www.giveme.my/preprod/collateral/", fetchFn).witness("84a4");
    expect(inits).toHaveLength(1);
    privately(inits[0]!);
  });

  it("to CoinGecko carries none", async () => {
    const local = memoryArea();
    const { inits, fetchFn } = recording({ cardano: { usd: 0.25 } });
    const prices = new PriceService({
      session: memoryArea(),
      preferences: new PreferencesService(local),
      now: () => 1_800_000_000_000,
      fetch: fetchFn as typeof fetch,
    });
    expect(await prices.get("mainnet")).toMatchObject({ rate: 0.25 });
    expect(inits).toHaveLength(1);
    privately(inits[0]!);
  });

  it("to the IPFS gateway, for an NFT's image, carries none, and leaves nothing in Chrome's cache", async () => {
    const koios = recording([{ minting_tx_metadata: { "721": { ["ab".repeat(28)]: { "01": { image: `ipfs://Qm${"a".repeat(44)}` } } } } }]);
    const gateway = recording({});
    const images = new NftImageService({
      koios: () => new Koios("https://preprod.koios.rest/api/v1", koios.fetchFn, async () => undefined),
      fetch: gateway.fetchFn,
      allowed: async () => true,
    });
    await images.show("preprod", "ab".repeat(28), "01");
    expect(gateway.inits).toHaveLength(1);
    [...koios.inits, ...gateway.inits].forEach(privately);
  });

  it("to Minswap carries none", async () => {
    const { inits, fetchFn } = recording({ tokens: [], orders: [] });
    const minswap = new Minswap("https://agg-api.minswap.org/aggregator", fetchFn);
    await minswap.tokens("min");
    await minswap.estimate({ amount: "1000000", tokenIn: "lovelace", tokenOut: "ab".repeat(28), slippage: 1 });
    expect(inits).toHaveLength(2);
    inits.forEach(privately);
  });
});
