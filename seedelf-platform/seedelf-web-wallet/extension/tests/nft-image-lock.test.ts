// Show image's answer and the lock (release review C24): Koios and the gateway can take over a minute, and the wallet
// can lock meanwhile (auto-lock, or Lock in another window). App forgets the images as it locks, so an answer that
// comes after that is dropped: kept, it showed again after the next unlock, though the details say an image is kept
// only until the wallet locks.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { NftImage, TokenAmount } from "../src/shared/rpc";

const worker = vi.hoisted(() => ({ asked: 0, answer: undefined as ((image: NftImage) => void) | undefined }));
vi.mock("../src/ui/background", async (original) => ({
  ...(await original<typeof import("../src/ui/background")>()),
  call: () => {
    worker.asked++;
    return new Promise((resolve) => {
      worker.answer = resolve;
    });
  },
}));

const { askImage } = await import("../src/ui/components/NftImage");
const { TokenDetails } = await import("../src/ui/components/TokenList");
const { NetworkContext } = await import("../src/ui/network");
const { forgetImages } = await import("../src/ui/nft-images");
const { viewToken } = await import("../src/ui/tokens");

const chrome = { permissions: { request: async () => true } };
beforeAll(() => {
  vi.stubGlobal("chrome", chrome);
});
afterEach(() => {
  forgetImages();
  worker.asked = 0;
  worker.answer = undefined;
  chrome.permissions.request = async () => true;
});

const nft: TokenAmount = {
  policyId: "1606863d520f318bc4b79aeab706706c7d0e08a59cd46170fd5a12fa",
  assetName: "48414e4f493135313032303234",
  quantity: "1",
  decimals: 0,
  fingerprint: "asset1hanoi",
};
const IMAGE = "data:image/png;base64,iVBORw0KGgo=";
const details = () =>
  renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(TokenDetails, { view: viewToken("preprod", nft), of: "seedelf", onClose: () => undefined }),
    ),
  );

/** Show image pressed: Chrome's permission given, and the worker asked. Its answer is still to come. */
async function pressed(): Promise<{ asking: Promise<boolean> }> {
  const asking = askImage("preprod", nft);
  await vi.waitFor(() => expect(worker.answer).toBeDefined());
  return { asking };
}

describe("Show image's answer", () => {
  it("is kept while the wallet stays unlocked", async () => {
    const { asking } = await pressed();
    worker.answer!({ image: IMAGE, from: "ipfs" });
    expect(await asking).toBe(true);
    expect(details()).toContain(`<img class="nft-image" src="${IMAGE}"`);
  });

  it("is dropped when it comes after the wallet locked, so the next unlock shows nothing of it", async () => {
    const { asking } = await pressed();
    // App, as the wallet locks: nothing was kept yet, and the answer on its way is what this has to stop.
    forgetImages();
    worker.answer!({ image: IMAGE, from: "ipfs" });
    await asking;
    const html = details();
    expect(html).not.toContain("<img");
    expect(html).toContain(">Show image</button>");
    // Asked again after the unlock, it's kept.
    worker.answer = undefined;
    const again = await pressed();
    worker.answer!({ image: IMAGE, from: "ipfs" });
    await again.asking;
    expect(details()).toContain(`<img class="nft-image" src="${IMAGE}"`);
  });

  it("is never asked for when Chrome isn't given the gateway", async () => {
    chrome.permissions.request = async () => false;
    expect(await askImage("preprod", nft)).toBe(false);
    expect(worker.asked).toBe(0);
  });
});
