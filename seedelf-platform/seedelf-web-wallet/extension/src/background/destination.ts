// Where a withdrawal or a send goes, as the user typed it: a bech32 address,
// or an ADA Handle. A handle is looked up through Koios
// (`asset_nft_address`), which sees which handle is asked about. A
// destination carrying this account's staking key is flagged: paying it from
// Seedelf re-links the money to the account.

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import { ADA_HANDLE_POLICY, CIP68_USER_TOKEN, HANDLE } from "../shared/handles";
import type { WithdrawDestination } from "../shared/rpc";
import { SEEDELF_NOT_AN_ADDRESS, seedelfName } from "../shared/seedelf-name";
import type { Koios } from "./koios";
import type { Wallet } from "./wallet";

export { ADA_HANDLE_POLICY, HANDLE };

const hex = (text: string) => Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join("");

export interface DestinationDeps {
  wasm: typeof Wasm;
  wallet: Wallet;
  koios: (network: NetworkName) => Koios;
}

/** A destination as typed: a bech32 address, or `$handle`. Throws the reason it can't be paid. */
export async function resolveDestination(
  deps: DestinationDeps,
  network: NetworkName,
  to: string,
): Promise<WithdrawDestination> {
  const { wasm, wallet } = deps;
  const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
  const text = to.trim();
  // Send pays a seedelf before it gets here; Withdraw can't.
  if (seedelfName(text)) throw new Error(SEEDELF_NOT_AN_ADDRESS);
  let address = text;
  let handle: string | undefined;
  if (text.startsWith("$")) {
    handle = text.slice(1).toLowerCase();
    if (!HANDLE.test(handle)) throw new Error("An ADA Handle is $ and up to 28 letters, digits, or . _ - @.");
    const koios = deps.koios(network);
    let found: string | undefined;
    for (const name of [hex(handle), CIP68_USER_TOKEN + hex(handle)]) {
      found = await koios.assetNftAddress(ADA_HANDLE_POLICY, name);
      if (found) break;
    }
    if (!found) throw new Error(`No ADA Handle $${handle} on ${network}.`);
    address = found;
  }
  // Throws the reason: not an address, a script, a stake address, the other network.
  wasm.checkPayableAddress(address, net);
  const own = await wallet.withKeys((keys) => keys.cardano.isOwnAddress(address));
  return handle ? { address, handle, own } : { address, own };
}

/**
 * `resolveDestination` for one payment's recipients: each looked up once,
 * however many times it's paid (a handle is a Koios request). They're asked
 * one after another, which Koios's public tier prefers to a burst.
 */
export function destinationResolver(
  deps: DestinationDeps,
  network: NetworkName,
): (to: string) => Promise<WithdrawDestination> {
  const found = new Map<string, Promise<WithdrawDestination>>();
  return (to) => {
    const text = to.trim();
    // A handle's case doesn't matter; an address's does.
    const key = text.startsWith("$") ? text.toLowerCase() : text;
    let destination = found.get(key);
    if (!destination) {
      destination = resolveDestination(deps, network, text);
      found.set(key, destination);
    }
    return destination;
  };
}
