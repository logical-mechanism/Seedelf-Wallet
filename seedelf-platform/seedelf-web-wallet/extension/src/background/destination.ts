// Where a withdrawal or a send goes, as the user typed it: a bech32 address,
// or an ADA Handle. A handle is looked up through Koios
// (`asset_nft_address`), which sees which handle is asked about. A
// destination that's this account's own is flagged: paying it from Seedelf
// re-links the money to the account. That's one carrying the account's
// staking key, or under one of its payment keys, whatever its staking part
// (an enterprise address, say), as the wallet counts and spends the account
// (account.ts): the first 20 of each chain, and those the last balance
// reading found (privacy review §2.17). Nothing is asked of anyone for it.

import { t } from "../i18n";
import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import { ADA_HANDLE_POLICY, CIP68_USER_TOKEN, HANDLE } from "../shared/handles";
import type { WithdrawDestination } from "../shared/rpc";
import { SEEDELF_NOT_AN_ADDRESS, seedelfName } from "../shared/seedelf-name";
import { SESSION_ACCOUNT_ADDRESSES_PREFIX, type AccountAddresses } from "./activity";
import type { Koios } from "./koios";
import type { Area } from "./storage";
import type { Wallet } from "./wallet";
import { isTrap } from "./wasm";

export { ADA_HANDLE_POLICY, HANDLE };

const hex = (text: string) => Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join("");

export interface DestinationDeps {
  wasm: typeof Wasm;
  wallet: Wallet;
  koios: (network: NetworkName) => Koios;
  /** chrome.storage.session: the account's payment keys the last balance reading found. */
  session?: Area;
  /** The public accounts the wallet knows of, by index (accounts.ts). The active one alone without it. */
  knownAccounts?: () => Promise<number[]>;
}

/** A destination as typed: a bech32 address, or `$handle`. Throws the reason it can't be paid. */
export async function resolveDestination(
  deps: DestinationDeps,
  network: NetworkName,
  to: string,
): Promise<WithdrawDestination> {
  const { wasm } = deps;
  const text = to.trim();
  // Send pays a seedelf before it gets here; Withdraw can't.
  if (seedelfName(text)) throw new Error(SEEDELF_NOT_AN_ADDRESS());
  let address = text;
  let handle: string | undefined;
  if (text.startsWith("$")) {
    handle = text.slice(1).toLowerCase();
    if (!HANDLE.test(handle)) throw new Error(t("worker.handle.format"));
    const koios = deps.koios(network);
    let found: string | undefined;
    for (const name of [hex(handle), CIP68_USER_TOKEN + hex(handle)]) {
      found = await koios.assetNftAddress(ADA_HANDLE_POLICY, name);
      if (found) break;
    }
    if (!found) throw new Error(t("worker.handle.notFound", { handle, network }));
    address = found;
  }
  checkPayable(wasm, network, address);
  const { own, account } = await ownAccount(deps, network, address);
  const mine = { own, ...(account !== undefined ? { ownAccount: account } : {}) };
  return handle ? { address, handle, ...mine } : { address, ...mine };
}

/** The text of WebAssembly's refusal of something that doesn't read as an address at all (api::payable_address). */
const NOT_BECH32 = /isn't a Cardano address/;

/**
 * Throws why `address` can't be paid on `network`, in the user's language and naming the thing that's wrong:
 * the other network's address, a stake address, a script's, or no address at all. WebAssembly's one English
 * sentence for all of them ("Payments go to a normal preprod address: not a script, stake or other network's
 * address") left the user to work out which (chunk 23's second review, PY-10). The prefix says the first two;
 * WebAssembly still checks the rest, and anything else it refuses on this network's prefix is a script.
 */
export function checkPayable(wasm: typeof Wasm, network: NetworkName, address: string): void {
  const text = address.trim().toLowerCase();
  const testnet = text.startsWith("addr_test1");
  const prefix = network === "mainnet" ? "addr1" : "addr_test1";
  if (/^stake(_test)?1/.test(text)) throw new Error(t("worker.address.stake", { prefix }));
  if (network !== "mainnet" && text.startsWith("addr1")) throw new Error(t("worker.address.mainnetHere"));
  if (network === "mainnet" && testnet) throw new Error(t("worker.address.testnetHere"));
  try {
    wasm.checkPayableAddress(address, network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod);
  } catch (e) {
    // A trap is the instance broken, not the address: thrown as it is, so the wallet locks (wasm.ts).
    if (isTrap(e)) throw e;
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(NOT_BECH32.test(message) ? t("worker.address.notAddress") : t("worker.address.script"));
  }
}

/**
 * Whether `address` is one of this wallet's public accounts', and which: the
 * active account first, then any other the wallet knows. Nothing is asked of
 * anyone — the other accounts' keys are derived on the device.
 */
export async function ownAccount(
  deps: DestinationDeps,
  network: NetworkName,
  address: string,
): Promise<{ own: boolean; account?: number }> {
  const { wallet } = deps;
  const active = await wallet.withKeys(async (keys) => {
    const found = await deps.session?.get<AccountAddresses>(SESSION_ACCOUNT_ADDRESSES_PREFIX + network);
    return { index: keys.account, own: keys.cardano.isOwnAddress(address, found?.keys ?? []) };
  });
  if (active.own) return { own: true, account: active.index };
  const known = (await deps.knownAccounts?.().catch(() => [])) ?? [];
  for (const index of known) {
    if (index === active.index) continue;
    if (await wallet.withAccount(index, (keys) => keys.cardano.isOwnAddress(address, []))) {
      return { own: true, account: index };
    }
  }
  return { own: false };
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
