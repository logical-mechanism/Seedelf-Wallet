// An NFT's details, as the page renders them (chunk 20): Show image is offered
// for an NFT and nothing else, with what the click reveals said beside it,
// more strongly for one in the private balance; what came back is shown there
// and as the NFT's avatar in the lists, until the wallet locks.
import { readFileSync } from "node:fs";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { i18n } from "../src/i18n/core";

import type { TokenAmount } from "../src/shared/rpc";
import { beforeShowing } from "../src/ui/components/NftImage";
import { TokenDetails, TokenRow } from "../src/ui/components/TokenList";
import { NetworkContext } from "../src/ui/network";
import { forgetImages, rememberImage } from "../src/ui/nft-images";
import { viewToken } from "../src/ui/tokens";

const markup = (element: ReactElement) =>
  renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, element));
/** What a person reads. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();

const noop = () => undefined;
const nft: TokenAmount = {
  policyId: "1606863d520f318bc4b79aeab706706c7d0e08a59cd46170fd5a12fa",
  assetName: "48414e4f493135313032303234",
  quantity: "1",
  decimals: 0,
  fingerprint: "asset1hanoi",
};
const details = (token: TokenAmount, of: "seedelf" | "cardano") =>
  markup(createElement(TokenDetails, { view: viewToken("preprod", token), of, onClose: noop }));
const IMAGE = "data:image/png;base64,iVBORw0KGgo=";

afterEach(async () => {
  forgetImages();
  await i18n.changeLanguage("en");
});

describe("an NFT's details before anything is asked", () => {
  it("offers Show image on the public side, saying who sees what, and that nothing is asked until then", () => {
    const html = details(nft, "cardano");
    expect(html).toContain(">Show image</button>");
    expect(html).not.toContain("<img");
    const shown = text(html);
    expect(shown).toContain(
      "Nothing is asked until you show its image. Then the server and ipfs.blockfrost.dev see your IP address asking about this NFT.",
    );
    expect(shown).toContain("The first time, Chrome asks you to let the wallet reach ipfs.blockfrost.dev.");
    expect(shown).not.toContain("private balance");
  });

  it("says on the private side that the click can tie this IP address to the UTxO holding it", () => {
    const shown = text(details(nft, "seedelf"));
    expect(shown).toContain("see your IP address asking about this NFT, and either could tie it to this part of your private balance.");
    expect(shown).toContain("Nothing is asked until you show its image.");
  });

  it("says Chrome asks first only when it will: not once the access given for connecting sites covers the gateway", () => {
    // Release review C24: that access is never handed back, so Chrome then answers Show image with no dialog at all.
    const asks = "The first time, Chrome asks you to let the wallet reach ipfs.blockfrost.dev.";
    expect(beforeShowing("cardano")).toContain(asks);
    expect(beforeShowing("seedelf", false)).toContain(asks);
    for (const of of ["cardano", "seedelf"] as const) {
      expect(beforeShowing(of, true)).not.toContain("Chrome");
      expect(beforeShowing(of, true)).toMatch(/^Nothing is asked until you show its image\. .*about this NFT/);
    }
  });

  it("offers nothing for a fungible token, or for a Seedelf, which has no image and mustn't be asked about", () => {
    const fungible: TokenAmount = { ...nft, assetName: "464f4f", quantity: "500", decimals: 0 };
    expect(details(fungible, "cardano")).not.toContain("Show image");
    const seedelf: TokenAmount = { ...nft, assetName: `5eed0e1f${"00".repeat(28)}` };
    expect(details(seedelf, "cardano")).not.toContain("Show image");
  });
});

describe("an NFT's details once its image was asked for", () => {
  it("shows the image, where it came from, and that nothing keeps it past the lock; and it's the NFT's avatar in the lists", () => {
    rememberImage("preprod", nft, { image: IMAGE, from: "ipfs" });
    const html = details(nft, "cardano");
    expect(html).toContain(`<img class="nft-image" src="${IMAGE}"`);
    expect(html).not.toContain("Show image");
    expect(text(html)).toContain(
      "From IPFS, through ipfs.blockfrost.dev. Kept in this window until the wallet locks, never saved.",
    );
    const row = markup(createElement(TokenRow, { view: viewToken("preprod", nft), onOpen: noop }));
    expect(row).toContain(`class="avatar avatar--nft avatar--image" src="${IMAGE}"`);
  });

  it("is per network: the same token on mainnet hasn't been asked for", () => {
    rememberImage("mainnet", nft, { image: IMAGE, from: "ipfs" });
    expect(details(nft, "cardano")).toContain(">Show image</button>");
  });

  it("is forgotten when the wallet locks", () => {
    rememberImage("preprod", nft, { image: IMAGE, from: "chain" });
    expect(text(details(nft, "cardano"))).toContain("Written on chain in its metadata, so only the server was asked.");
    forgetImages();
    expect(details(nft, "cardano")).toContain(">Show image</button>");
  });

  it("gives an address off IPFS to copy, never to open, and says what opening it tells that server", () => {
    rememberImage("preprod", nft, { elsewhere: "https://tracker.example/1.png" });
    const html = details(nft, "cardano");
    expect(html).not.toContain("<a ");
    expect(html).toContain('data-value="https://tracker.example/1.png"');
    expect(text(html)).toContain("Its image isn't on IPFS but on a server its sender chose, so the wallet won't fetch it.");
    expect(text(html)).toContain("Opening the address below tells that server your IP address.");
  });

  it("says what came in a status region that was there before it, so a screen reader says it (release review C48)", () => {
    expect(details(nft, "cardano")).toContain('<div role="status"></div>');
    const results = [
      [{ none: "metadata" }, '<div role="status"><p class="note center" data-testid="nft-image-none">'],
      [{ image: IMAGE, from: "ipfs" }, '<div role="status"><p class="note center" data-testid="nft-image-from">'],
      [{ elsewhere: "https://tracker.example/1.png" }, '<div role="status"><div class="stack-tight" data-testid="nft-image-elsewhere">'],
    ] as const;
    for (const [found, region] of results) {
      rememberImage("preprod", nft, found);
      expect(details(nft, "cardano")).toContain(region);
    }
  });

  it("says why there's no image", () => {
    const cases = [
      [{ none: "metadata" }, "The server has no metadata for this NFT, so there's no image to show."],
      [{ none: "image" }, "This NFT's metadata names no image the wallet can show."],
      [{ tooLarge: 10 * 1024 * 1024 }, "Its image is over 10 MB, more than the wallet shows."],
      [{ notImage: true }, "What came for it isn't an image this browser can show."],
    ] as const;
    for (const [found, words] of cases) {
      rememberImage("preprod", nft, found);
      expect(text(details(nft, "cardano"))).toContain(words);
    }
  });
});

describe("an NFT's details in Spanish and Japanese", () => {
  const strings = (code: string): Record<string, string> =>
    JSON.parse(readFileSync(new URL(`../src/i18n/translations/${code}.json`, import.meta.url), "utf8"));
  const say = (words: Record<string, string>, key: string, values: Record<string, string> = {}) =>
    Object.entries(values).reduce((v, [name, value]) => v.replaceAll(`{{${name}}}`, value), words[key]!);
  const host = { host: "ipfs.blockfrost.dev" };
  /** English the screen must never show once it speaks another language. */
  const ENGLISH = [/Show image/, /Nothing is asked/, /IP address/, /The first time/, /From IPFS/, /never saved/, /Copy the/, /Koios has no/];
  /** How the language joins two sentences: a space in Spanish, nothing in Japanese. */
  const GAP: Record<string, string> = { es: " ", ja: "" };

  for (const code of ["es", "ja"] as const) {
    it(`says it all in ${code}, the callout's sentences joined as ${code} joins them`, async () => {
      const words = strings(code);
      await i18n.changeLanguage(code);
      for (const of of ["cardano", "seedelf"] as const) {
        const html = details(nft, of);
        const shown = html.replace(/<[^>]+>/g, "").replaceAll("&#x27;", "'");
        const note = say(words, of === "seedelf" ? "nftImage.privacy.private" : "nftImage.privacy.public", host);
        expect(shown).toContain(`${note}${GAP[code]}${say(words, "nftImage.privacy.chromeAsks", host)}`);
        expect(html).toContain(`>${words["nftImage.show"]}</button>`);
        for (const english of ENGLISH) expect(shown, `${of}: ${english}`).not.toMatch(english);
      }
      rememberImage("preprod", nft, { image: IMAGE, from: "ipfs" });
      const after = details(nft, "cardano").replace(/<[^>]+>/g, "");
      expect(after).toContain(`${say(words, "nftImage.fromIpfs", host)}${GAP[code]}${words["nftImage.held"]}`);
      expect(details(nft, "cardano")).toContain(`alt="${say(words, "nftImage.alt", { label: "HANOI15102024" })}"`);
      rememberImage("preprod", nft, { elsewhere: "https://tracker.example/1.png" });
      const elsewhere = details(nft, "cardano");
      expect(elsewhere.replace(/<[^>]+>/g, "").replaceAll("&#x27;", "'")).toContain(words["nftImage.privacy.elsewhere"]!);
      expect(elsewhere).toContain(`aria-label="${words["nftImage.copyAddress"]}"`);
      rememberImage("preprod", nft, { tooLarge: 10 * 1024 * 1024 });
      expect(details(nft, "cardano").replace(/<[^>]+>/g, "")).toContain(say(words, "nftImage.tooLarge", { megabytes: "10" }));
      for (const english of ENGLISH) expect(elsewhere, String(english)).not.toMatch(english);
    });
  }
});
