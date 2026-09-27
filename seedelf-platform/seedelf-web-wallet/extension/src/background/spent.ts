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

import { txInputs } from "./cbor";
import type { KoiosUtxo } from "./koios";
import type { Area } from "./storage";

/** chrome.storage.session: `txhash#index` of every UTxO this wallet has spent lately, and when (ms). */
export const SESSION_SPENT = "seedelf.spent";

/** How long a spent UTxO is remembered. */
export const SPENT_KEEP_MS = 2 * 60 * 60_000;
/** Never more than this many, however many were spent within SPENT_KEEP_MS (about 1 MB). */
const SPENT_MOST = 10_000;

/** The kept record; a list of outpoints from before times were kept counts as spent now. */
async function kept(session: Area, now: number): Promise<Record<string, number>> {
  const raw = await session.get<Record<string, number> | string[]>(SESSION_SPENT);
  if (Array.isArray(raw)) return Object.fromEntries(raw.map((o) => [o, now]));
  return raw ?? {};
}

/** Remembers the inputs of a transaction about to be submitted. Call it while unlocked. */
export async function rememberSpent(session: Area, tx: Uint8Array, now = Date.now()): Promise<void> {
  const spent = await kept(session, now);
  for (const o of txInputs(tx)) spent[o] = now;
  const fresh = Object.entries(spent)
    .filter(([, at]) => now - at < SPENT_KEEP_MS)
    .sort(([, a], [, b]) => a - b)
    .slice(-SPENT_MOST);
  await session.set(SESSION_SPENT, Object.fromEntries(fresh));
}

/** The outpoints spent within SPENT_KEEP_MS. Call it while unlocked. */
export async function spentSet(session: Area, now = Date.now()): Promise<Set<string>> {
  const spent = await kept(session, now);
  return new Set(Object.keys(spent).filter((o) => now - spent[o]! < SPENT_KEEP_MS));
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
