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
/** How many times the wallet has locked with this page open: an answer asked for before a lock is dropped after it. */
let locks = 0;

const keyOf = (network: NetworkName, token: TokenRef) => `${network}:${token.policyId}.${token.assetName}`;

function changed() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Which lock the page is past: Show image notes it before it asks, for `rememberImage`. */
export const imageLocks = (): number => locks;

/**
 * Keeps what showing `token`'s image found, until the wallet locks. `asked`: `imageLocks()` when it was asked for. An
 * answer can take over a minute, and one that comes once the wallet has locked since is dropped, not kept past it.
 */
export function rememberImage(network: NetworkName, token: TokenRef, image: NftImage, asked = locks): void {
  if (asked !== locks) return;
  found.set(keyOf(network, token), image);
  changed();
}

/** Forgets every image shown: the wallet locked. Counted with none kept too, since one may be on its way. */
export function forgetImages(): void {
  locks++;
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
