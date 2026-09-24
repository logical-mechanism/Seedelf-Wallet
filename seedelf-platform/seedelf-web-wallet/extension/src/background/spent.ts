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

import { txInputs } from "./cbor";
import type { KoiosUtxo } from "./koios";
import type { Area } from "./storage";

/** chrome.storage.session: `txhash#index` of every UTxO this wallet has spent this session. */
export const SESSION_SPENT = "seedelf.spent";

/** A transaction spends a handful of UTxOs; this keeps the last few hundred. */
const KEEP = 500;

/** Remembers the inputs of a transaction about to be submitted. Call it while unlocked. */
export async function rememberSpent(session: Area, tx: Uint8Array): Promise<void> {
  const spent = (await session.get<string[]>(SESSION_SPENT)) ?? [];
  await session.set(SESSION_SPENT, [...spent, ...txInputs(tx)].slice(-KEEP));
}

/** The remembered outpoints. Call it while unlocked. */
export async function spentSet(session: Area): Promise<Set<string>> {
  return new Set((await session.get<string[]>(SESSION_SPENT)) ?? []);
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
