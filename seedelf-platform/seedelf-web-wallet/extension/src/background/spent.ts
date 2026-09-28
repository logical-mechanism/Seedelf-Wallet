// What this wallet has spent. Koios's gateway balances several backends,
// and one can fall behind the others. Found live on preprod: right after
// tx_status called a transaction confirmed, account_utxos still listed the
// UTxO it spent; later, one backend answered with the account as it was 20
// minutes and two transactions before. A balance read from it is stale, and
// a transaction built on it is refused for spending a UTxO twice.
//
// So the worker remembers the inputs of every transaction it submits, in
// chrome.storage.session (wiped on lock). An answer that lists one of them
// came from a backend that's behind: it's read again, a few times, and what's
// spent is left out either way, so nothing is ever built on it.
//
// Each is kept for SPENT_KEEP_MS from when it was spent, well past the 20
// minutes a backend was seen behind: by time, not by count, so a long
// Lovejoin chain (four inputs a mix, up to 130 mixes) can't push out what
// another feature spent a minute before it.
//
// What sites' own transactions spend, sent through the dApp connector, is
// kept apart, with a cap of its own (`rememberSiteSpent`): a site resending
// old transactions, or sending many of its own, never pushes out what the
// wallet spent itself (independent review L7). Both count everywhere.

import type { NetworkName } from "../networks";
import { bodyOutpoints, txInputs } from "./cbor";
import type { KoiosUtxo } from "./koios";
import { rememberSent } from "./sent-txs";
import type { Area } from "./storage";

/** chrome.storage.session: `txhash#index` of every UTxO this wallet has spent lately, and when (ms). */
export const SESSION_SPENT = "seedelf.spent";

/** How long a spent UTxO is remembered. */
export const SPENT_KEEP_MS = 2 * 60 * 60_000;
/** Never more than this many, however many were spent within SPENT_KEEP_MS (about 1 MB). */
const SPENT_MOST = 10_000;
/** chrome.storage.session: what sites' transactions sent through the connector spent, and when (ms), apart from the wallet's own. */
export const SESSION_SPENT_SITES = "seedelf.spent.sites";
/** Of those, never more than this many, the newest. */
const SITES_SPENT_MOST = 5_000;

/** The kept record; a list of outpoints from before times were kept counts as spent now. */
async function kept(session: Area, now: number): Promise<Record<string, number>> {
  const raw = await session.get<Record<string, number> | string[]>(SESSION_SPENT);
  if (Array.isArray(raw)) return Object.fromEntries(raw.map((o) => [o, now]));
  return raw ?? {};
}

/**
 * Remembers the inputs of a transaction about to be submitted on `network`.
 * Call it while unlocked. What's spent is kept for both networks together
 * (an outpoint is never on both); the transaction itself, on its own.
 */
export async function rememberSpent(session: Area, network: NetworkName, tx: Uint8Array, now = Date.now()): Promise<void> {
  const spent = await kept(session, now);
  for (const o of txInputs(tx)) spent[o] = now;
  const fresh = Object.entries(spent)
    .filter(([, at]) => now - at < SPENT_KEEP_MS)
    .sort(([, a], [, b]) => a - b)
    .slice(-SPENT_MOST);
  await session.set(SESSION_SPENT, Object.fromEntries(fresh));
  // And the transaction itself, a while: a site on its network may build on its outputs (sent-txs.ts).
  await rememberSent(session, network, tx, now);
}

/**
 * Remembers the inputs of a site's own transaction the connector sends
 * (dapp.ts), apart from what the wallet spent, under a cap of their own:
 * nothing a site sends pushes the wallet's own out. Not kept among the
 * wallet's own sends (sent-txs.ts): a site chains on its own from what the
 * connector keeps for it. Call it while unlocked.
 */
export async function rememberSiteSpent(session: Area, tx: Uint8Array, now = Date.now()): Promise<void> {
  const spent = (await session.get<Record<string, number>>(SESSION_SPENT_SITES)) ?? {};
  for (const o of txInputs(tx)) spent[o] = now;
  const fresh = Object.entries(spent)
    .filter(([, at]) => now - at < SPENT_KEEP_MS)
    .sort(([, a], [, b]) => a - b)
    .slice(-SITES_SPENT_MOST);
  await session.set(SESSION_SPENT_SITES, Object.fromEntries(fresh));
}

/** Everything spent, the wallet's own and sites', and when: for reading only. */
async function everySpent(session: Area, now: number): Promise<Record<string, number>> {
  const sites = (await session.get<Record<string, number>>(SESSION_SPENT_SITES)) ?? {};
  const own = await kept(session, now);
  for (const [o, at] of Object.entries(sites)) own[o] = Math.max(own[o] ?? 0, at);
  return own;
}

/** Forgets `outpoints`: a transaction that never landed spent nothing (pending.ts). Call it while unlocked. */
export async function forgetSpent(session: Area, outpoints: readonly string[], now = Date.now()): Promise<void> {
  const spent = await kept(session, now);
  for (const o of outpoints) delete spent[o];
  await session.set(SESSION_SPENT, spent);
}

/** The outpoints spent within SPENT_KEEP_MS. Call it while unlocked. */
export async function spentSet(session: Area, now = Date.now()): Promise<Set<string>> {
  const spent = await everySpent(session, now);
  return new Set(Object.keys(spent).filter((o) => now - spent[o]! < SPENT_KEEP_MS));
}

/**
 * When the wallet last sent a transaction, on either network, as what it
 * spent says (ms): none since the unlock, undefined. Call it while unlocked.
 * Lovejoin's withdraws keep away from it (lovejoin.ts QUIET_AFTER_SEND_MS).
 */
export async function lastSpentAt(session: Area, now = Date.now()): Promise<number | undefined> {
  const at = Object.values(await everySpent(session, now)).filter((t) => now - t < SPENT_KEEP_MS);
  return at.length ? at.reduce((a, b) => Math.max(a, b)) : undefined;
}

export const outpoint = (u: KoiosUtxo) => `${u.tx_hash}#${u.tx_index}`;

/** How many times an answer behind this wallet's own spends is read again, and how long apart. */
const STALE_RETRIES = 3;
const STALE_WAIT_MS = 3_000;

export const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Calls `read` until none of the UTxOs in its answer (`utxosOf`) is one this
 * wallet has spent, or it has tried a few times; returns the last answer.
 * Leave the spent ones out of it with `unspent`.
 */
export async function readFresh<R>(
  spent: ReadonlySet<string>,
  read: () => Promise<R>,
  utxosOf: (answer: R) => KoiosUtxo[],
  sleep: (ms: number) => Promise<void> = wait,
): Promise<R> {
  for (let attempt = 0; ; attempt++) {
    const answer = await read();
    if (attempt === STALE_RETRIES || !utxosOf(answer).some((u) => spent.has(outpoint(u)))) return answer;
    await sleep(STALE_WAIT_MS);
  }
}

/** `utxos` less the ones this wallet has already spent. */
export function unspent(utxos: KoiosUtxo[], spent: ReadonlySet<string>): KoiosUtxo[] {
  return spent.size ? utxos.filter((u) => !spent.has(outpoint(u))) : utxos;
}

// What the wallet's Lovejoin chains will spend. A chain is signed whole
// before any of it is sent (lovejoin.ts), and sent over many blocks: until
// then its pool boxes, its change to come and its collateral are still
// listed as unspent. So each chain reserves them, and nothing else takes
// them meanwhile: another chain's draw from the pool, and, while it's being
// sent, a payment from its account or a site connected to it, or from the
// private balance, whose UTxO a return merges into (script-spend.ts).
// Reservations are kept apart from what's spent: a reading that lists one
// isn't behind.

/** chrome.storage.session: each chain's reservation, per network: `seedelf.reserved.<network>`, by chain. */
export const SESSION_RESERVED_PREFIX = "seedelf.reserved.";

/** What one chain's transactions spend and put up as collateral (`txhash#index`). */
export interface Reservation {
  inputs: string[];
  collateral: string[];
  /** Built and kept for Send until then (ms): its pool boxes alone count. None while it's being sent. */
  until?: number;
}

/** A chain's reservation, from its transactions' CBOR (hex). */
export function reservationOf(txs: Array<{ txCbor: string }>, until?: number): Reservation {
  const inputs = new Set<string>();
  const collateral = new Set<string>();
  for (const { txCbor } of txs) {
    const bytes = Uint8Array.from(txCbor.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
    for (const o of txInputs(bytes)) inputs.add(o);
    for (const o of bodyOutpoints(bytes, 13) ?? []) collateral.add(o);
  }
  return { inputs: [...inputs], collateral: [...collateral], ...(until !== undefined ? { until } : {}) };
}

/** Every chain's reservation on `network`, less those kept for Send past their time. Call it while unlocked. */
export async function reservations(session: Area, network: NetworkName, now: number): Promise<Record<string, Reservation>> {
  const kept = (await session.get<Record<string, Reservation>>(SESSION_RESERVED_PREFIX + network)) ?? {};
  return Object.fromEntries(Object.entries(kept).filter(([, r]) => r.until === undefined || r.until > now));
}

/**
 * What the chains on `network` will spend: every chain's (`except` one, the
 * chain being built again), or `only` one chain's, and of those only the
 * ones being sent (`sending`), with their collateral. Call it while unlocked.
 */
export async function reservedSet(
  session: Area,
  network: NetworkName,
  {
    sending = false,
    except,
    only,
    now = Date.now(),
  }: { sending?: boolean; except?: string; only?: string; now?: number } = {},
): Promise<{ inputs: Set<string>; collateral: Set<string> }> {
  const kept = Object.entries(await reservations(session, network, now)).filter(
    ([chain, r]) => chain !== except && (only === undefined || chain === only) && (!sending || r.until === undefined),
  );
  return {
    inputs: new Set(kept.flatMap(([, r]) => r.inputs)),
    collateral: new Set(kept.flatMap(([, r]) => r.collateral)),
  };
}
