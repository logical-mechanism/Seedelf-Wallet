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
// that would tell it which Seedelf is this wallet's. A Seedelf the wallet
// made sits in its mint's output until its removal. But the policy is open
// and checks no output, and every register is public through its Seedelf's
// name, so anyone can mint a Seedelf of their own under the user's register,
// or send one there, and pay the account in the same transaction (chunk 51,
// e6#1). So the transaction that made the UTxO is taken for the mint, and
// only what a stranger can't make says who paid:
//
// - another of the wallet's own contract UTxOs from it is a stealth mint's
//   change, back in the private balance (a stranger's second output under
//   the user's register reads so too: a dust tag at most, left as it is);
// - the account's Activity listing it as one the account spent in (its fee:
//   an input under the account's payment keys, which needs its signature) is
//   an account-paid mint's. One of the account's UTxOs from it, or a
//   payment received in it, isn't: anyone's transaction can pay the account;
// - otherwise it isn't known, and Remove asks.
//
// **Which account paid, not only which side** (chunk 18). The mint is public,
// so it already links the Seedelf to the account that paid. Sending the freed
// ADA to a *different* account links that one to the Seedelf's name too — and
// anyone can join the two by the name, tying the accounts together. So the
// record names the account, and Remove warns when the wallet is on another
// one. A bare "account", written before this chunk, is account 0's: there was
// only one.

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import type { MintSource, TxDetail } from "../shared/rpc";
import { registerOf, type RegisterHex } from "./chain";
import type { KoiosUtxo } from "./koios";
import { UnreadableRecordError, type PrivateStore } from "./private-store";

/**
 * What the record holds for a Seedelf: the private balance, or which public
 * account paid. `"account"` with no index is what wallets wrote before chunk
 * 18, and is account 0's.
 */
export type PaidBy = MintSource | `account:${number}`;

/** A Seedelf's full token name (hex) to who paid for it. */
export type MintedBy = Record<string, PaidBy>;

/** Who paid for a Seedelf, and which public account if one did. */
export interface PaidByInfo {
  side: MintSource;
  /** The public account that paid, when it is known. */
  account?: number;
}

/** A kept value as the wallet reads it; undefined when it isn't one. */
export function readPaidBy(kept: unknown): PaidByInfo | undefined {
  if (kept === "seedelf") return { side: "seedelf" };
  if (kept === "account") return { side: "account", account: 0 };
  if (typeof kept === "string" && kept.startsWith("account:")) {
    const account = Number(kept.slice("account:".length));
    return Number.isInteger(account) && account >= 0 ? { side: "account", account } : undefined;
  }
  return undefined;
}

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
 * Keeps who paid for the Seedelf `tokenName`, naming the public account when
 * one did. A record that won't open is left as it is (private-store.ts), and
 * so is one that can't be written: Remove then asks, and the mint goes on
 * either way.
 */
export async function rememberMint(
  store: PrivateStore,
  network: NetworkName,
  tokenName: string,
  from: MintSource,
  account: number,
): Promise<void> {
  try {
    const value: PaidBy = from === "account" ? `account:${account}` : "seedelf";
    const kept = (await store.get<MintedBy>(record(network))) ?? {};
    if (kept[tokenName] === value) return;
    await store.set(record(network), { ...kept, [tokenName]: value });
  } catch {
    // Unreadable, or locked meanwhile: Remove asks instead.
  }
}

// Where each Seedelf minted here was put: the register its mint's output holds
// (`mintedAt.<network>`, sealed). Seedelf Messaging takes first messages by
// itself only at these, each at that register (messaging.ts, the 1.10.0
// gate's W8): the policy is open, so a Seedelf anyone mints under a register
// that is the sum of two of this wallet's own is owned by its scan exactly
// when both are, and answering at it, or showing it, would tell the minter
// that the two are one wallet's. A name, by itself, is no proof either: the
// pair is.

/** The registers each Seedelf minted here was put under, by its full token name (hex). */
export type MintedAt = Record<string, RegisterHex[]>;

const atRecord = (network: NetworkName) => `mintedAt.${network}` as const;

/** The registers each Seedelf this wallet minted here was put under; empty when there's no record, or it won't open. */
export async function mintedAt(store: PrivateStore, network: NetworkName): Promise<MintedAt> {
  try {
    return (await store.get<MintedAt>(atRecord(network))) ?? {};
  } catch (e) {
    if (e instanceof UnreadableRecordError) return {};
    throw e;
  }
}

/**
 * Keeps the register the mint of `tokenName` put it under, beside any it was put under before. Unlike who paid
 * (`rememberMint`), its refusal surfaces (the 1.10.0 gate's W12, quota-outside#11): a record that won't open is left as
 * it is and UnreadableRecordError thrown, as is a write the browser refuses, or a lock. The caller says what then:
 * that Seedelf's switch shows off in Messages (it isn't a pair this browser made), and the mint goes on either way.
 */
export async function rememberRegister(store: PrivateStore, network: NetworkName, tokenName: string, register: RegisterHex): Promise<void> {
  const kept = (await store.get<MintedAt>(atRecord(network))) ?? {};
  const at = kept[tokenName] ?? [];
  if (at.some((r) => r.generator === register.generator && r.publicValue === register.publicValue)) return;
  await store.set(atRecord(network), { ...kept, [tokenName]: [...at, register] });
}

/**
 * Forgets every register `tokenName` was put under here (W12): the wallet's own Remove of that Seedelf, as it's sent,
 * so first messages to it stop then, whatever any kept view has shown of it. A Remove that never lands leaves it a
 * Seedelf this browser didn't make, whose switch the user can turn on. Throws as `rememberRegister` does.
 */
export async function forgetRegisters(store: PrivateStore, network: NetworkName, tokenName: string): Promise<void> {
  const kept = (await store.get<MintedAt>(atRecord(network))) ?? {};
  if (!kept[tokenName]) return;
  const { [tokenName]: _gone, ...rest } = kept;
  await store.set(atRecord(network), rest);
}

/**
 * The register a transaction this wallet built puts the Seedelf `tokenName` under: its output at Seedelf Wallet's
 * contract holding the token, its inline datum read as the contract view reads one (chain.ts `registerOf`). From the
 * transaction's own bytes, which fix every output: nobody else can make an output of it. Undefined where there's none.
 */
export function mintedRegister(
  wasm: Pick<typeof Wasm, "decodeTx" | "Network">,
  network: NetworkName,
  txCbor: string,
  policyId: string,
  tokenName: string,
): RegisterHex | undefined {
  const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
  const detail = JSON.parse(wasm.decodeTx(net, txCbor)) as TxDetail;
  const outputs = detail.outputs.filter(
    (o) => o.address.seedelf && o.inlineDatum && o.assets.some((a) => a.policyId === policyId && a.assetName === tokenName),
  );
  if (outputs.length !== 1) return undefined;
  return registerOf({ inline_datum: { bytes: outputs[0]!.inlineDatum! } } as KoiosUtxo);
}

/**
 * Who paid for the Seedelf in `utxo`: from the record, or else from what the
 * wallet already holds. Undefined when neither says.
 *
 * What the wallet holds is the account it is working on, so an answer worked
 * out that way is **that** account's (`activeAccount`): the mint is in its
 * Activity as one it spent in, which no other account's would be.
 */
export function paidByOf(
  utxo: Pick<KoiosUtxo, "tx_hash" | "tx_index">,
  tokenName: string,
  held: {
    recorded: MintedBy;
    /** The wallet's own contract UTxOs, the Seedelfs' included. */
    owned: Array<Pick<KoiosUtxo, "tx_hash" | "tx_index">>;
    /**
     * The account's transactions, as far as its Activity has read them. Only one with a fee says the account paid:
     * Activity sets it only where an input is under the account's payment keys (activity.ts `describe`), which takes
     * the account's signature. Its kind is worked out, never signed; and a transaction that only pays the account,
     * which anyone can make, has none (chunk 51, e6#1).
     */
    accountActivity: ReadonlyArray<{ txHash: string; fee?: string }>;
    /** Which public account those transactions are. */
    activeAccount?: number;
  },
): PaidByInfo | undefined {
  const recorded = readPaidBy(held.recorded[tokenName]);
  if (recorded) return recorded;
  const mint = utxo.tx_hash;
  if (held.owned.some((u) => u.tx_hash === mint && u.tx_index !== utxo.tx_index)) return { side: "seedelf" };
  if (held.accountActivity.some((e) => e.txHash === mint && e.fee !== undefined)) {
    return { side: "account", account: held.activeAccount ?? 0 };
  }
  return undefined;
}
