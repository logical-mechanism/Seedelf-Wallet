// What showing an NFT's image found, kept in this page's memory only, and
// only until the wallet locks (App.tsx forgets it): never on the disk, and
// never in the worker. So an image the user chose to see shows again, in its
// details and as its avatar in the lists, without asking anyone a second time
// (background/nft-image.ts). Each NFT is shown only when the user asks.

import { useSyncExternalStore } from "react";

import type { NetworkName } from "../networks";
import type { NftImage, TokenRef } from "../shared/rpc";
import { useNetwork } from "./network";

const found = new Map<string, NftImage>();
const listeners = new Set<() => void>();

const keyOf = (network: NetworkName, token: TokenRef) => `${network}:${token.policyId}.${token.assetName}`;

function changed() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Keeps what showing `token`'s image found, until the wallet locks. */
export function rememberImage(network: NetworkName, token: TokenRef, image: NftImage): void {
  found.set(keyOf(network, token), image);
  changed();
}

/** Forgets every image shown: the wallet locked. */
export function forgetImages(): void {
  if (!found.size) return;
  found.clear();
  changed();
}

/** What showing `token`'s image found, if the user has asked since the wallet unlocked. */
export function useShownImage(token: TokenRef): NftImage | undefined {
  const key = keyOf(useNetwork(), token);
  const read = () => found.get(key);
  return useSyncExternalStore(subscribe, read, read);
}

/** The image itself, when one was found: a data URI. */
export function imageIn(shown: NftImage | undefined): string | undefined {
  return shown && "image" in shown ? shown.image : undefined;
}
