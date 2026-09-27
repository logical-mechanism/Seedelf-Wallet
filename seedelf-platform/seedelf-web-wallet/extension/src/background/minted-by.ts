// Who paid for each Seedelf: the public account or the private balance
// (mint.ts). Removing a Seedelf defaults to that side (RemoveSeedelf.tsx), so
// the freed ADA goes back where its money came from and links nothing new:
// a stealth-minted Seedelf's ADA sent to the account would tie the account
// to the Seedelf's name, and through the mint to the private UTxOs that paid
// for it (privacy review §3.2).
//
// It's kept at Send, sealed per network (`mintedBy.<network>`), apart from the
// private history, which is trimmed. A Seedelf minted before this was kept,
// in another browser, or found after a restore isn't in it; then what the
// wallet already holds decides, and Koios is never asked about the mint:
// that would tell it which Seedelf is this wallet's. A Seedelf's UTxO is
// only ever spent by its removal, so its transaction is the mint:
//
// - another of the wallet's own contract UTxOs from it is a stealth mint's
//   change, back in the private balance;
// - one of the account's UTxOs from it, or the account's Activity listing
//   it, is an account-paid mint's (its change goes to the account);
// - otherwise it isn't known, and Remove asks.

import type { NetworkName } from "../networks";
import type { MintSource } from "../shared/rpc";
import type { KoiosUtxo } from "./koios";
import { UnreadableRecordError, type PrivateStore } from "./private-store";

/** A Seedelf's full token name (hex) to who paid for it. */
export type MintedBy = Record<string, MintSource>;

const record = (network: NetworkName) => `mintedBy.${network}` as const;

/** Who paid for each Seedelf this wallet minted here; empty when there's no record, or it won't open. Throws if locked. */
export async function mintedBy(store: PrivateStore, network: NetworkName): Promise<MintedBy> {
  try {
    return (await store.get<MintedBy>(record(network))) ?? {};
  } catch (e) {
    if (e instanceof UnreadableRecordError) return {};
    throw e;
  }
}

/**
 * Keeps who paid for the Seedelf `tokenName`. A record that won't open is
 * left as it is (private-store.ts), and so is one that can't be written:
 * Remove then asks, and the mint goes on either way.
 */
export async function rememberMint(store: PrivateStore, network: NetworkName, tokenName: string, from: MintSource): Promise<void> {
  try {
    const kept = (await store.get<MintedBy>(record(network))) ?? {};
    if (kept[tokenName] === from) return;
    await store.set(record(network), { ...kept, [tokenName]: from });
  } catch {
    // Unreadable, or locked meanwhile: Remove asks instead.
  }
}

/**
 * Who paid for the Seedelf in `utxo`: from the record, or else from what the
 * wallet already holds. Undefined when neither says.
 */
export function paidByOf(
  utxo: Pick<KoiosUtxo, "tx_hash" | "tx_index">,
  tokenName: string,
  held: {
    recorded: MintedBy;
    /** The wallet's own contract UTxOs, the Seedelfs' included. */
    owned: Array<Pick<KoiosUtxo, "tx_hash" | "tx_index">>;
    /** The account's UTxOs. */
    account: Array<Pick<KoiosUtxo, "tx_hash">>;
    /** The account's transactions, as far as its Activity has read them. */
    accountTxs: ReadonlySet<string>;
  },
): MintSource | undefined {
  const recorded = held.recorded[tokenName];
  if (recorded === "account" || recorded === "seedelf") return recorded;
  const mint = utxo.tx_hash;
  if (held.owned.some((u) => u.tx_hash === mint && u.tx_index !== utxo.tx_index)) return "seedelf";
  if (held.account.some((u) => u.tx_hash === mint) || held.accountTxs.has(mint)) return "account";
  return undefined;
}
