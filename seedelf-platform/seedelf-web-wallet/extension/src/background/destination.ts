// Where a withdrawal or a send goes, as the user typed it: a bech32 address,
// or an ADA Handle. A handle is looked up through Koios
// (`asset_nft_address`), which sees which handle is asked about. A
// destination carrying this account's staking key is flagged: paying it from
// Seedelf re-links the money to the account.

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import type { WithdrawDestination } from "../shared/rpc";
import { SEEDELF_NOT_AN_ADDRESS, seedelfName } from "../shared/seedelf-name";
import type { Koios } from "./koios";
import type { Wallet } from "./wallet";

/** The ADA Handle policy, the same on preprod and mainnet. */
export const ADA_HANDLE_POLICY = "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a";
/** CIP-68's user-token label, which newer handles carry. */
const CIP68_USER_TOKEN = "000de140";
/** An ADA Handle's name, after the $. */
export const HANDLE = /^[a-z0-9._@-]{1,28}$/;

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
