// Typed request/response messages between the UI and the service worker.
// The service worker owns every secret; the UI only ever asks it to do work.

import type { NetworkName } from "../networks";

export type WalletState = "no-wallet" | "locked" | "unlocked";

export interface Status {
  state: WalletState;
  version: string;
  network: NetworkName;
  networks: NetworkName[];
  /** When locked: how long until another unlock attempt is allowed (ms). */
  retryAfterMs: number;
}

export type UnlockResult =
  | { unlocked: true }
  /** `wrongPassword` is false when the attempt was refused for being too early. */
  | { unlocked: false; wrongPassword: boolean; retryAfterMs: number };

/** The unlocked wallet's public identifiers. */
export interface Account {
  /** Cardano account 0, receive address 0/0. */
  receiveAddress: string;
  stakeAddress: string;
  /** The Seedelf base register's public value (compressed G1, hex). */
  seedelfPublicValue: string;
}

/** A native token amount. `quantity` is the raw integer, as a decimal string. */
export interface TokenAmount {
  policyId: string;
  /** Hex. */
  assetName: string;
  quantity: string;
  /** From the token registry via Koios; 0 when unknown. */
  decimals: number;
  fingerprint: string;
}

/** One of the user's seedelfs: a named token in a UTxO the wallet owns. */
export interface SeedelfInfo {
  /** The full token name, hex. */
  assetName: string;
  /** The personal tag, when it reads as text. */
  label?: string;
  /** ADA locked with the token (lovelace string); only `remove` gets it back. */
  lovelace: string;
}

/** What the wallet holds on one network. Lovelace amounts are decimal strings. */
export interface Balances {
  network: NetworkName;
  /** When the chain was read (ms since the epoch). */
  updatedAt: number;
  /** UTxOs in the wallet contract this wallet owns, except those holding a seedelf (as in the CLI's `balance`). */
  seedelf: { lovelace: string; tokens: TokenAmount[]; utxos: number; seedelfs: SeedelfInfo[] };
  /** The Cardano account (CIP-1852 account 0). */
  cardano: { lovelace: string; tokens: TokenAmount[]; utxos: number; addressesUsed: number };
}

/** A token to bring along on a move-in; it moves in full. */
export interface TokenRef {
  policyId: string;
  assetName: string;
}

/** A built and signed move-in, waiting for the user to confirm it. Amounts are lovelace strings. */
export interface MoveInSummary {
  network: NetworkName;
  txHash: string;
  fee: string;
  /** Into Seedelf. */
  lovelace: string;
  tokens: Array<TokenRef & { quantity: string }>;
  /** How many new contract UTxOs hold it. */
  depositOutputs: number;
  /** Back to the Cardano account's receive address. */
  changeLovelace: string;
  changeTokens: number;
  inputs: number;
}

/** What pays for a new seedelf: the Cardano account (mint first, then move in), or the Seedelf balance (a stealth mint). */
export type MintSource = "account" | "seedelf";

/** A finished seedelf mint, waiting for the user to send it. Amounts are lovelace strings. */
export interface MintSummary {
  network: NetworkName;
  txHash: string;
  from: MintSource;
  /** The personal tag, as sent ("" for none). */
  label: string;
  /** The new seedelf's token name, hex: prefix, tag, and the smallest input spent. */
  tokenName: string;
  /** Locked with the seedelf; only removing it gets this back. */
  lovelace: string;
  fee: { size: string; compute: string; scriptReference: string; total: string };
  /** Back to where it was paid from: the Cardano account's `0/0`, or the Seedelf balance. */
  changeLovelace: string;
  changeTokens: number;
  changeOutputs: number;
  /** How many UTxOs pay for it. */
  inputs: number;
}

/** A token and an amount to send. `quantity` is the raw integer, as a decimal string. */
export type TokenQuantity = TokenRef & { quantity: string };

/** A seedelf found on chain, for the transfer form. */
export interface SeedelfLookup {
  /** The full token name, hex. */
  name: string;
  /** Its personal tag, when it reads as text. */
  label?: string;
  /** One of this wallet's own seedelfs: paying it moves money in a circle. */
  own: boolean;
}

/** A finished transfer, waiting for the user to send it. Amounts are lovelace strings. */
export interface TransferSummary {
  network: NetworkName;
  txHash: string;
  /** The seedelf paid: its full token name, and its tag when it reads as text. */
  to: string;
  label?: string;
  /** Paying one of your own seedelfs: the payment comes back to your Seedelf balance. */
  toSelf: boolean;
  lovelace: string;
  tokens: TokenQuantity[];
  fee: { size: string; compute: string; scriptReference: string; total: string };
  /** Back into the Seedelf balance. */
  changeLovelace: string;
  changeTokens: number;
  changeOutputs: number;
  /** How many Seedelf UTxOs pay for it. */
  inputs: number;
}

/** Where a withdrawal goes, as the wallet read it. */
export interface WithdrawDestination {
  /** The bech32 address paid. */
  address: string;
  /** The ADA Handle it was found by, without the "$". */
  handle?: string;
  /** It carries this wallet's Cardano account's staking key: paying it re-links the money. */
  own: boolean;
}

/** A finished withdrawal, waiting for the user to send it. Amounts are lovelace strings. */
export interface WithdrawSummary extends WithdrawDestination {
  network: NetworkName;
  txHash: string;
  /** Everything (Max), rather than an amount. */
  max: boolean;
  /** What the address receives. */
  lovelace: string;
  tokens: TokenQuantity[];
  fee: { size: string; compute: string; scriptReference: string; total: string };
  /** Back into the Seedelf balance: nothing, for Max. */
  changeLovelace: string;
  changeTokens: number;
  changeOutputs: number;
  /** How many Seedelf UTxOs pay for it. */
  inputs: number;
  /** Seedelf UTxOs Max left for another withdrawal (it takes 20 at most). */
  left: number;
}

/** Where a removed seedelf's ADA goes: the Cardano account's `0/0`, or back into the Seedelf balance. */
export type RemoveTo = "account" | "seedelf";

/** A finished seedelf removal, waiting for the user to send it. Amounts are lovelace strings. */
export interface RemoveSummary {
  network: NetworkName;
  txHash: string;
  /** The seedelf burned: its full token name, and its tag when it reads as text. */
  name: string;
  label?: string;
  to: RemoveTo;
  /** What comes back: the ADA locked with it, less the fee. */
  lovelace: string;
  fee: { size: string; compute: string; scriptReference: string; total: string };
}

/** A submitted transaction the wallet is watching. */
export interface PendingTx {
  kind: "move-in" | "mint" | "transfer" | "withdraw" | "remove";
  network: NetworkName;
  txHash: string;
  submittedAt: number;
  /** Null until it's on chain. */
  confirmations: number | null;
}

type None = Record<never, never>;

/** Every request the service worker answers: its payload and its result. */
export interface Requests {
  status: { payload: None; result: Status };
  "generate-phrase": { payload: None; result: { phrase: string } };
  /** Checks a typed phrase; fails with a reason to show the user. */
  "validate-phrase": { payload: { phrase: string }; result: null };
  "create-wallet": { payload: { phrase: string; password: string }; result: Status };
  "restore-wallet": { payload: { phrase: string; password: string }; result: Status };
  unlock: { payload: { password: string }; result: UnlockResult };
  lock: { payload: None; result: Status };
  activity: { payload: None; result: null };
  account: { payload: None; result: Account };
  /** The last reading, or a new one if there is none or `refresh` is set. */
  balances: { payload: { refresh?: boolean }; result: Balances };
  wordlist: { payload: None; result: string[] };
  /** Builds and signs a move-in without submitting it. `lovelace` null moves the most possible. */
  "move-in-build": { payload: { lovelace: string | null; tokens: TokenRef[] }; result: MoveInSummary };
  /** Submits the move-in built last, if its hash matches. */
  "move-in-submit": { payload: { txHash: string }; result: PendingTx };
  /** Builds a seedelf mint (Ogmios measures its scripts) without sending it. */
  "mint-build": { payload: { label: string; from: MintSource }; result: MintSummary };
  /** Submits the mint built last, if its hash matches: an account-paid one as signed, a stealth one once giveme.my has witnessed it. */
  "mint-submit": { payload: { txHash: string }; result: PendingTx };
  /** Finds a seedelf by its full name in the wallet contract, as read from Koios. */
  "transfer-lookup": { payload: { to: string }; result: SeedelfLookup };
  /** Builds a transfer to a seedelf (Ogmios measures its spends) without sending it. */
  "transfer-build": { payload: { to: string; lovelace: string; tokens: TokenQuantity[] }; result: TransferSummary };
  /** Submits the transfer built last, if its hash matches, once giveme.my has witnessed it. */
  "transfer-submit": { payload: { txHash: string }; result: PendingTx };
  /** Reads a withdrawal's destination: an address, or `$handle` looked up through Koios. */
  "withdraw-resolve": { payload: { to: string }; result: WithdrawDestination };
  /** Builds a withdrawal (`lovelace` null sends everything) without sending it. */
  "withdraw-build": {
    payload: { to: string; lovelace: string | null; tokens: TokenQuantity[] };
    result: WithdrawSummary;
  };
  /** Submits the withdrawal built last, if its hash matches, once giveme.my has witnessed it. */
  "withdraw-submit": { payload: { txHash: string }; result: PendingTx };
  /** Builds the removal of one of this wallet's seedelfs without sending it. */
  "remove-build": { payload: { name: string; to: RemoveTo }; result: RemoveSummary };
  /** Submits the removal built last, if its hash matches, once giveme.my has witnessed it. */
  "remove-submit": { payload: { txHash: string }; result: PendingTx };
  /** The submitted transaction being watched, with fresh confirmations; null when there's none. */
  "pending-tx": { payload: None; result: PendingTx | null };
  "reset-wallet": { payload: None; result: Status };
}

export type RequestName = keyof Requests;

export type Message = {
  [K in RequestName]: { type: K } & Requests[K]["payload"];
}[RequestName];

export type Reply<K extends RequestName> =
  | { ok: true; value: Requests[K]["result"] }
  | { ok: false; error: string };

const REQUESTS: ReadonlySet<string> = new Set<RequestName>([
  "status",
  "generate-phrase",
  "validate-phrase",
  "create-wallet",
  "restore-wallet",
  "unlock",
  "lock",
  "activity",
  "account",
  "balances",
  "wordlist",
  "move-in-build",
  "move-in-submit",
  "mint-build",
  "mint-submit",
  "transfer-lookup",
  "transfer-build",
  "transfer-submit",
  "withdraw-resolve",
  "withdraw-build",
  "withdraw-submit",
  "remove-build",
  "remove-submit",
  "pending-tx",
  "reset-wallet",
]);

export function isMessage(value: unknown): value is Message {
  const type = (value as { type?: unknown } | null)?.type;
  return typeof type === "string" && REQUESTS.has(type);
}

/** Broadcast by the worker to open UI pages when the wallet state changes. */
export const STATE_CHANGED = { event: "state-changed" } as const;

export function isStateChanged(value: unknown): boolean {
  return (value as { event?: unknown } | null)?.event === STATE_CHANGED.event;
}
