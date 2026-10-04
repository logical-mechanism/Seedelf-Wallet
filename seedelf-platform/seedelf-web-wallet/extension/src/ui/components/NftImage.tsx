// An NFT's image in its details: off until the user clicks Show image, one NFT
// at a time (chunk 20). Before the click, the details say what it reveals and
// to whom, more strongly for an NFT in the private balance; after it, the
// image, or why there is none. Nothing is asked for an NFT nobody clicks.

import { useState, type ReactNode } from "react";
import { joinSentences, useT } from "../../i18n";

import { IPFS_GATEWAY, IPFS_GATEWAY_HOST } from "../../networks";
import { seedelfName } from "../../shared/seedelf-name";
import { call } from "../background";
import { useNetwork } from "../network";
import { imageIn, rememberImage, useShownImage } from "../nft-images";
import type { TokenView } from "../tokens";
import { Callout } from "./Callout";
import { CopyField } from "./CopyField";

/** The gateway's host, as the words name it. */
const HOST = new URL(IPFS_GATEWAY).host;

/** Whether an NFT's image can be asked for: not a Seedelf, which has none, and asking would tie this IP to it. */
export function hasImageToShow(view: TokenView): boolean {
  return view.nft && !seedelfName(view.token.assetName);
}

/** The top of an NFT's details: its image, once shown, or what's in its place until then (its avatar). */
export function NftPicture({ view, children }: { view: TokenView; children: ReactNode }) {
  const t = useT();
  const network = useNetwork();
  const image = imageIn(useShownImage(view.token));
  if (!image) return children;
  return (
    <img
      className="nft-image"
      src={image}
      alt={t("nftImage.alt", { label: view.label })}
      data-testid="nft-image"
      // One the browser can't draw is no image: the avatar comes back, and the note below says why.
      onError={() => rememberImage(network, view.token, { notImage: true })}
    />
  );
}

/**
 * What an NFT's details say about its image: what Show image reveals, and
 * the button; or, once asked, where the image came from or why there's none.
 * `of`: whose NFT it is, which decides what the click reveals.
 */
export function NftImageShow({ view, of }: { view: TokenView; of: "seedelf" | "cardano" }) {
  const t = useT();
  const network = useNetwork();
  const shown = useShownImage(view.token);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string>();

  if (!hasImageToShow(view)) return null;

  async function show() {
    setError(undefined);
    setAsking(true);
    try {
      // Before anything is awaited: Chrome asks only straight from a click,
      // and only the first time. Turned down, nothing is asked of anyone.
      const granted = await chrome.permissions.request({ origins: [IPFS_GATEWAY_HOST] });
      if (!granted) {
        setError(t("nftImage.warn.notGranted", { host: HOST }));
        return;
      }
      const found = await call("nft-image", { policyId: view.token.policyId, assetName: view.token.assetName });
      rememberImage(network, view.token, found);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAsking(false);
    }
  }

  if (shown) return <ShownImage shown={shown} />;
  return (
    <div className="stack-tight" data-testid="nft-image-show">
      <Callout tone="privacy" testId="nft-image-privacy">
        {joinSentences([
          of === "seedelf" ? t("nftImage.privacy.private", { host: HOST }) : t("nftImage.privacy.public", { host: HOST }),
          t("nftImage.privacy.chromeAsks", { host: HOST }),
        ])}
      </Callout>
      <button type="button" className="secondary" onClick={show} disabled={asking}>
        {asking ? t("nftImage.showing") : error ? t("common.tryAgain") : t("nftImage.show")}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** What showing the image found, under the picture. */
function ShownImage({ shown }: { shown: NonNullable<ReturnType<typeof useShownImage>> }) {
  const t = useT();
  if ("image" in shown) {
    return (
      <p className="note center" data-testid="nft-image-from">
        {joinSentences([shown.from === "ipfs" ? t("nftImage.fromIpfs", { host: HOST }) : t("nftImage.fromChain"), t("nftImage.held")])}
      </p>
    );
  }
  if ("elsewhere" in shown) {
    return (
      <div className="stack-tight" data-testid="nft-image-elsewhere">
        <Callout tone="privacy">{t("nftImage.privacy.elsewhere")}</Callout>
        <CopyField
          label={t("nftImage.address")}
          copyLabel={t("nftImage.copyAddress")}
          value={shown.elsewhere}
          testId="nft-image-address"
        />
      </div>
    );
  }
  const why =
    "tooLarge" in shown
      ? t("nftImage.tooLarge", { megabytes: Math.round(shown.tooLarge / (1024 * 1024)) })
      : "notImage" in shown
        ? t("nftImage.notImage")
        : shown.none === "metadata"
          ? t("nftImage.noMetadata")
          : shown.none === "seedelf"
            ? t("nftImage.seedelf")
            : t("nftImage.noImage");
  return (
    <p className="note center" data-testid="nft-image-none">
      {why}
    </p>
  );
}
