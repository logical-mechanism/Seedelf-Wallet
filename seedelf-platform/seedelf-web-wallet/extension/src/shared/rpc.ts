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
