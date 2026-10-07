// An NFT's image in its details: off until the user clicks Show image, one NFT
// at a time (chunk 20). Before the click, the details say what it reveals and
// to whom, more strongly for an NFT in the private balance; after it, the
// image, or why there is none. Nothing is asked for an NFT nobody clicks.

import { useEffect, useState, type ReactNode } from "react";
import { joinSentences, t, useT } from "../../i18n";

import { IPFS_GATEWAY, IPFS_GATEWAY_HOST, type NetworkName } from "../../networks";
import type { TokenRef } from "../../shared/rpc";
import { seedelfName } from "../../shared/seedelf-name";
import { call } from "../background";
import { useNetwork } from "../network";
import { imageIn, imageLocks, rememberImage, useShownImage } from "../nft-images";
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
 * What the details say before Show image: who it asks and what they see, and that Chrome asks first, unless access
 * the wallet has covers the gateway already (`reachable`), as Let sites connect's does: Chrome then asks nothing.
 * Exported for its tests.
 */
export function beforeShowing(of: "seedelf" | "cardano", reachable?: boolean): string {
  return joinSentences([
    of === "seedelf" ? t("nftImage.privacy.private", { host: HOST }) : t("nftImage.privacy.public", { host: HOST }),
    reachable !== true && t("nftImage.privacy.chromeAsks", { host: HOST }),
  ]);
}

/**
 * Show image's click: Chrome's permission, then the worker, and the answer kept until the wallet locks. One that
 * comes after a lock is dropped (`rememberImage`'s `asked`). False: Chrome wasn't given the gateway, so nothing was
 * asked. Exported for its tests.
 */
export async function askImage(network: NetworkName, token: TokenRef): Promise<boolean> {
  const asked = imageLocks();
  // Before anything is awaited: Chrome asks only straight from a click, and
  // only when no access the wallet has covers the gateway already.
  if (!(await chrome.permissions.request({ origins: [IPFS_GATEWAY_HOST] }))) return false;
  rememberImage(network, token, await call("nft-image", { policyId: token.policyId, assetName: token.assetName }), asked);
  return true;
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
  const offered = hasImageToShow(view);
  // Whether the wallet can reach the gateway already: then Chrome asks nothing, and the callout doesn't say it will.
  const [reachable, setReachable] = useState<boolean>();
  useEffect(() => {
    if (!offered) return;
    let live = true;
    globalThis.chrome?.permissions?.contains({ origins: [IPFS_GATEWAY_HOST] }).then(
      (yes) => live && setReachable(yes),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [offered]);

  if (!offered) return null;

  async function show() {
    setError(undefined);
    setAsking(true);
    try {
      if (!(await askImage(network, view.token))) setError(t("nftImage.warn.notGranted", { host: HOST }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAsking(false);
    }
  }

  return (
    <div>
      {!shown && (
        <div className="stack-tight" data-testid="nft-image-show">
          <Callout tone="privacy" testId="nft-image-privacy">
            {beforeShowing(of, reachable)}
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
      )}
      {/* What came, or why nothing did, in a region there from the start, so a screen reader says it (WCAG 4.1.3). */}
      <div role="status">{shown && <ShownImage shown={shown} />}</div>
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
