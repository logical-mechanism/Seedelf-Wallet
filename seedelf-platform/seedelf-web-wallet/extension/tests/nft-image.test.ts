// An NFT's image, shown only when the user asks (chunk 20): where its metadata
// says the image is, what the wallet will fetch and how, and what it won't.
// The metadata is Koios's real answers (fixtures/record-nft-images.mjs).
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CONTRACT_V1 } from "../src/background/balances";
import { Koios, type FetchLike, type KoiosAssetInfo } from "../src/background/koios";
import {
  base64,
  imageOf,
  imageType,
  MAX_IMAGE_BYTES,
  NftImageService,
  readCapped,
  sourceOf,
} from "../src/background/nft-image";
import { IPFS_GATEWAY } from "../src/networks";

interface Recorded {
  policy_id: string;
  asset_name: string;
  answer: KoiosAssetInfo[];
}
const recorded = JSON.parse(readFileSync(new URL("fixtures/nft-images.json", import.meta.url), "utf8")) as {
  preprod: Recorded[];
  mainnet: Recorded[];
};
const find = (network: "preprod" | "mainnet", name: string) => {
  const row = recorded[network].find((r) => r.asset_name === name);
  if (!row) throw new Error(`not recorded: ${name}`);
  return row;
};
const info = (row: Recorded) => row.answer[0]!;

// HANOI15102024: CIP-25, its mediaType "image/jpg".
const HANOI = find("preprod", "48414e4f493135313032303234");
// CIP-68 (label 222), its image in the reference datum.
const TICKET = find("preprod", "000de14048414e4f49303032");
// CIP-68 by its name, with no metadata anywhere.
const BARE = find("preprod", "000de14048414e4f49303031");
// Veil-Mesh-License: its image is "ipfs://", with no CID.
const VEIL = find("preprod", "5665696c2d4d6573682d4c6963656e7365");
// SpaceBud #0, keyed by its name as text.
const SPACEBUD = find("mainnet", "537061636542756430");
// An ADA Handle: CIP-68 and CIP-25 both.
const HANDLE = find("mainnet", "000de1402d2d302d2d");

const CID0 = "QmQ6C7C5V5ghPHqLLvsr7r27GTmbUeae9QwhUL2ZDUC4dE";
const CID1 = "bafybeiajmj5tgac4bfj7islsi4cqojdogqsnsq6uza2qi6362wvdm6rzfq";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);

describe("where the metadata says an image is", () => {
  it("reads CIP-25 under the name as text, and keeps the type it declares", () => {
    expect(imageOf(info(HANOI), HANOI.policy_id, HANOI.asset_name)).toEqual({
      uri: `ipfs://${CID0}`,
      mediaType: "image/jpg",
    });
    expect(imageOf(info(SPACEBUD), SPACEBUD.policy_id, SPACEBUD.asset_name)?.uri).toBe(
      "ipfs://QmNyHUZxfRxGpwg9QSbe3cMDkaT8so17TRvzXpNio5gbGf",
    );
  });

  it("reads CIP-68's reference datum, bytes as UTF-8", () => {
    expect(imageOf(info(TICKET), TICKET.policy_id, TICKET.asset_name)?.uri).toBe(
      "ipfs://QmbHJ9xCsyXCrLfTgpATZuHqZjDqQHM9j1EGEzrVfbXpgv",
    );
  });

  it("prefers the datum for a CIP-68 NFT that has both, which its minter can update", () => {
    const both = info(HANDLE);
    expect(imageOf(both, HANDLE.policy_id, HANDLE.asset_name)).toEqual({
      uri: "ipfs://zb2rhhpMMNwveNqyweWxRPXxBfqp5uStxSpZ2k7oAd1wH9x8Y",
      mediaType: "image/jpeg",
    });
    // With the minting metadata's image different, the datum's is still the one read.
    const minted = structuredClone(both) as { minting_tx_metadata: Record<string, Record<string, Record<string, { image: string }>>> };
    minted.minting_tx_metadata["721"]![HANDLE.policy_id]![HANDLE.asset_name]!.image = `ipfs://${CID0}`;
    expect(imageOf(minted, HANDLE.policy_id, HANDLE.asset_name)?.uri).toMatch(/^ipfs:\/\/zb2rh/);
    // With no datum, the minting metadata's.
    expect(imageOf({ ...minted, cip68_metadata: null }, HANDLE.policy_id, HANDLE.asset_name)?.uri).toBe(`ipfs://${CID0}`);
  });

  it("is nothing for a token Koios has no metadata for", () => {
    expect(imageOf(info(BARE), BARE.policy_id, BARE.asset_name)).toBeUndefined();
    expect(imageOf({}, BARE.policy_id, BARE.asset_name)).toBeUndefined();
  });

  it("reads CIP-25 v2's hex names and an image split into 64-byte pieces", () => {
    const policy = "ab".repeat(28);
    const name = "ff00ff"; // not UTF-8: only its hex can name it
    const metadata = { "721": { [policy]: { [name]: { image: ["ipfs://", CID1, "/a b.png"] } } } };
    expect(imageOf({ minting_tx_metadata: metadata }, policy, name)?.uri).toBe(`ipfs://${CID1}/a b.png`);
    const prefixed = { "721": { [`0x${policy}`]: { [`0x${name}`]: { image: "ipfs://x" } } } };
    expect(imageOf({ minting_tx_metadata: prefixed }, policy, name)?.uri).toBe("ipfs://x");
  });

  it("doesn't take another token's CIP-25 entry from the same mint", () => {
    // One minting transaction's metadata can name many tokens, each under its own name.
    expect(imageOf(info(SPACEBUD), SPACEBUD.policy_id, "ffffff")).toBeUndefined();
  });
});

describe("what an image address is", () => {
  it("is IPFS in every shape metadata writes it, as `<cid>[/path]`", () => {
    for (const uri of [`ipfs://${CID0}`, `ipfs://ipfs/${CID0}`, `ipfs:${CID0}`, ` ipfs://${CID0} `, CID0, `/ipfs/${CID0}`]) {
      expect(sourceOf(uri), uri).toEqual({ ipfs: CID0 });
    }
    expect(sourceOf(`ipfs://${CID1}/art/a b.png?x=1#y`)).toEqual({ ipfs: `${CID1}/art/a%20b.png` });
  });

  it("takes another gateway's address as the same file under its CID, so only the one gateway is asked", () => {
    expect(sourceOf(`https://ipfs.io/ipfs/${CID0}`)).toEqual({ ipfs: CID0 });
    expect(sourceOf(`https://gateway.pinata.cloud/ipfs/${CID1}/1.png`)).toEqual({ ipfs: `${CID1}/1.png` });
    expect(sourceOf(`https://${CID1}.ipfs.dweb.link/1.png`)).toEqual({ ipfs: `${CID1}/1.png` });
  });

  it("is somewhere else for any other address, which isn't fetched", () => {
    for (const uri of ["https://example.com/nft.png", "ar://4zXmWOWjzVZUCoEzhIzy7iCg2xs_EkdCvT0I6TYOoGg", "http://x.test/ipfs/notacid"]) {
      expect(sourceOf(uri), uri).toEqual({ elsewhere: uri });
    }
  });

  it("is an image written on chain, shown with no request at all", () => {
    expect(sourceOf("data:image/svg+xml;utf8,<svg/>")).toEqual({ data: "data:image/svg+xml;utf8,<svg/>" });
    expect(sourceOf("data:image/png;base64,iVBORw0KGgo=")).toEqual({ data: "data:image/png;base64,iVBORw0KGgo=" });
  });

  it("is nothing for an empty one, IPFS with no CID, a path that climbs, or data that isn't an image", () => {
    for (const uri of ["", "  ", "ipfs://", `ipfs://${CID0}/../x`, `ipfs://${CID0}/%2e%2e/x`, "data:text/html,<script>", "ipfs://notacid"]) {
      expect(sourceOf(uri), uri).toBeUndefined();
    }
  });
});

describe("what a file is", () => {
  it("is what the gateway says, when that's an image", () => {
    expect(imageType(PNG, "image/png")).toBe("image/png");
    expect(imageType(PNG, "image/jpg; charset=binary")).toBe("image/jpeg");
  });

  it("is what its first bytes are, when the gateway doesn't say", () => {
    expect(imageType(PNG, "application/octet-stream")).toBe("image/png");
    expect(imageType(JPEG, null)).toBe("image/jpeg");
    expect(imageType(new TextEncoder().encode("GIF89a…"), "text/plain")).toBe("image/gif");
    expect(imageType(new TextEncoder().encode('<?xml version="1.0"?><svg/>'), "text/plain")).toBe("image/svg+xml");
  });

  it("is the type the metadata declares only when nothing else says, and nothing when nothing says image", () => {
    const unknown = new TextEncoder().encode("????");
    expect(imageType(unknown, "application/octet-stream", "image/jpg")).toBe("image/jpeg");
    expect(imageType(new TextEncoder().encode("<html>"), "text/html")).toBeUndefined();
    // A gateway that says what the file is isn't overruled by what the metadata says it should be.
    expect(imageType(new TextEncoder().encode("<html>"), "text/html", "image/png")).toBeUndefined();
    expect(imageType(unknown, "application/octet-stream", "video/mp4")).toBeUndefined();
  });

  it("goes to base64 a piece at a time, ten megabytes included", () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES).fill(0xab);
    expect(base64(big)).toBe(Buffer.from(big).toString("base64"));
    expect(base64(PNG)).toBe(Buffer.from(PNG).toString("base64"));
  });
});

describe("a body over the limit", () => {
  it("is refused unread when its length says so", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(10));
      },
    });
    const response = new Response(body, { headers: { "content-length": String(MAX_IMAGE_BYTES + 1) } });
    expect(await readCapped(response, MAX_IMAGE_BYTES)).toBeUndefined();
    expect(pulled).toBeLessThanOrEqual(1);
  });

  it("is cut off as it comes when nothing says its length", async () => {
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        sent += 1024;
        c.enqueue(new Uint8Array(1024));
      },
    });
    expect(await readCapped(new Response(body), 4096)).toBeUndefined();
    expect(sent).toBeLessThanOrEqual(5 * 1024);
    expect(await readCapped(new Response(PNG), 4096)).toEqual(PNG);
  });
});

/** Koios answering asset_info with `row`, and a gateway answering `file`; every request is kept. */
function services(row: KoiosAssetInfo | undefined, file: () => Response = () => new Response(PNG, { headers: { "content-type": "image/png" } })) {
  const koiosCalls: Array<{ url: string; init: RequestInit }> = [];
  const gatewayCalls: Array<{ url: string; init: RequestInit }> = [];
  const koiosFetch: FetchLike = async (url, init) => {
    koiosCalls.push({ url, init });
    return Response.json(row ? [row] : []);
  };
  const gateway: FetchLike = async (url, init) => {
    gatewayCalls.push({ url, init });
    return file();
  };
  const koios = new Koios("https://preprod.koios.rest/api/v1", koiosFetch, async () => undefined, async () => true);
  const service = (allowed = true) => new NftImageService({ koios: () => koios, fetch: gateway, allowed: async () => allowed });
  return { koiosCalls, gatewayCalls, service };
}

describe("showing an NFT's image", () => {
  it("asks Koios once, for two columns of one token, then the gateway once, with no cookies, referrer or cache", async () => {
    const s = services(info(HANOI));
    const shown = await s.service().show("preprod", HANOI.policy_id, HANOI.asset_name);
    expect(shown).toEqual({ image: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`, from: "ipfs" });

    expect(s.koiosCalls).toHaveLength(1);
    const asked = s.koiosCalls[0]!;
    expect(asked.url).toBe("https://preprod.koios.rest/api/v1/asset_info?select=minting_tx_metadata,cip68_metadata");
    expect(JSON.parse(String(asked.init.body))).toEqual({ _asset_list: [[HANOI.policy_id, HANOI.asset_name]] });

    expect(s.gatewayCalls).toHaveLength(1);
    const fetched = s.gatewayCalls[0]!;
    expect(fetched.url).toBe(`${IPFS_GATEWAY}/ipfs/${CID0}`);
    expect(fetched.init).toMatchObject({ method: "GET", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
  });

  it("asks nobody anything about a Seedelf: it has no image, and asking would tie this IP to it", async () => {
    const s = services(info(HANOI));
    expect(await s.service().show("preprod", CONTRACT_V1.seedelfPolicyId, `5eed0e1f${"00".repeat(28)}`)).toEqual({ none: "seedelf" });
    expect([...s.koiosCalls, ...s.gatewayCalls]).toEqual([]);
  });

  it("asks nobody anything, Koios included, without Chrome's grant for the gateway", async () => {
    const s = services(info(HANOI));
    await expect(s.service(false).show("preprod", HANOI.policy_id, HANOI.asset_name)).rejects.toThrow(
      "Chrome isn't letting the wallet reach ipfs.blockfrost.dev",
    );
    expect([...s.koiosCalls, ...s.gatewayCalls]).toEqual([]);
  });

  it("shows an image written on chain with no fetch, and hands back any other address unfetched", async () => {
    const policy = "ab".repeat(28);
    const onChain = { minting_tx_metadata: { "721": { [policy]: { "01": { image: ["data:image/svg+xml;utf8,", "<svg/>"] } } } } };
    const chain = services(onChain);
    expect(await chain.service().show("preprod", policy, "01")).toEqual({ image: "data:image/svg+xml;utf8,<svg/>", from: "chain" });
    expect(chain.gatewayCalls).toEqual([]);

    const away = { minting_tx_metadata: { "721": { [policy]: { "01": { image: "https://tracker.example/1.png" } } } } };
    const elsewhere = services(away);
    expect(await elsewhere.service().show("preprod", policy, "01")).toEqual({ elsewhere: "https://tracker.example/1.png" });
    expect(elsewhere.gatewayCalls).toEqual([]);
  });

  it("says why there's nothing: no metadata, or none it can read", async () => {
    expect(await services(info(BARE)).service().show("preprod", BARE.policy_id, BARE.asset_name)).toEqual({ none: "metadata" });
    expect(await services(undefined).service().show("preprod", BARE.policy_id, BARE.asset_name)).toEqual({ none: "metadata" });
    const veil = services(info(VEIL));
    expect(await veil.service().show("preprod", VEIL.policy_id, VEIL.asset_name)).toEqual({ none: "image" });
    expect(veil.gatewayCalls).toEqual([]);
  });

  it("stops at the limit, and says when what came isn't an image", async () => {
    const big = () => new Response(new Uint8Array(16), { headers: { "content-type": "image/png", "content-length": String(MAX_IMAGE_BYTES + 1) } });
    expect(await services(info(HANOI), big).service().show("preprod", HANOI.policy_id, HANOI.asset_name)).toEqual({
      tooLarge: MAX_IMAGE_BYTES,
    });
    const page = () => new Response("<html>", { headers: { "content-type": "text/html" } });
    expect(await services(info(TICKET), page).service().show("preprod", TICKET.policy_id, TICKET.asset_name)).toEqual({ notImage: true });
  });

  it("reads a JPEG the gateway calls nothing as the JPEG it is", async () => {
    const plain = () => new Response(JPEG, { headers: { "content-type": "application/octet-stream" } });
    const shown = await services(info(HANOI), plain).service().show("preprod", HANOI.policy_id, HANOI.asset_name);
    expect(shown).toMatchObject({ image: expect.stringMatching(/^data:image\/jpeg;base64,/) });
  });

  it("says in words what the gateway answered instead", async () => {
    const answer = (status: number) => () => new Response("no", { status });
    const show = (status: number) => services(info(HANOI), answer(status)).service().show("preprod", HANOI.policy_id, HANOI.asset_name);
    await expect(show(404)).rejects.toThrow("ipfs.blockfrost.dev couldn't give this image (status 404)");
    await expect(show(429)).rejects.toThrow("ipfs.blockfrost.dev is busy");
    await expect(show(502)).rejects.toThrow("ipfs.blockfrost.dev had trouble sending this image (status 502)");
    const down = new NftImageService({
      koios: () => new Koios("https://preprod.koios.rest/api/v1", async () => Response.json([info(HANOI)]), async () => undefined, async () => true),
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
      allowed: async () => true,
    });
    await expect(down.show("preprod", HANOI.policy_id, HANOI.asset_name)).rejects.toThrow("Couldn't reach ipfs.blockfrost.dev (Failed to fetch)");
  });

  it("refuses anything that isn't a policy ID and an asset name, before asking", async () => {
    const s = services(info(HANOI));
    for (const [policy, name] of [["xyz", ""], [HANOI.policy_id, "zz"], [HANOI.policy_id, "00".repeat(33)]] as const) {
      await expect(s.service().show("preprod", policy, name)).rejects.toThrow("That isn't a token the wallet can look up.");
    }
    expect(s.koiosCalls).toEqual([]);
  });
});
