// Every request to a service goes out without the browser's cookies or a
// referrer (privacy review §2.14): Koios, giveme.my, CoinGecko, Minswap and
// the IPFS gateway for an NFT's image.
// The worker holds a host permission for most of them, and a fetch with it
// would carry any cookie the browser has for that host; one of giveme.my's
// would tie every private payment to this browser.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { Koios, type FetchLike } from "../src/background/koios";
import { Minswap } from "../src/background/minswap";
import { NftImageService } from "../src/background/nft-image";
import { PreferencesService } from "../src/background/preferences";
import { PriceService } from "../src/background/prices";
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
};

describe("a service request", () => {
  it("to Koios carries no cookies or referrer: a read, a POST and a submit", async () => {
    const { inits, fetchFn } = recording([]);
    const koios = new Koios("https://preprod.koios.rest/api/v1", fetchFn, async () => undefined);
    await koios.credentialUtxos(["94bc"]);
    await koios.txStatus(["ab"]).catch(() => undefined);
    const submit = recording("ab");
    await new Koios("https://preprod.koios.rest/api/v1", submit.fetchFn, async () => undefined)
      .submitTx(new Uint8Array([0x84]))
      .catch(() => undefined);
    expect(inits.length).toBeGreaterThanOrEqual(2);
    expect(submit.inits).toHaveLength(1);
    [...inits, ...submit.inits].forEach(privately);
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
    // The disk never says which NFTs this wallet looked at (privacy.md).
    expect(gateway.inits[0]!.cache).toBe("no-store");
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
