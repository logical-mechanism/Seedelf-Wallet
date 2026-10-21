// A payment in several transactions (WebAssembly's parts, script-spend.ts `keepParts`), sent: each part that pays its
// own way goes at Send, one after another. A part of tokens with no ADA of its own to pay its fee with spends what the
// part before it carried forward, an output of ADA alone to the wallet's own register (1.6.0, item 10b: "chain where
// needed", the owner, 2026-10-21). giveme.my witnesses only what's on the ledger (Collateral-Provider's
// WALLET_INTEGRATION.md, *Chained transactions*), so such a part waits until the one before it is in a block, then
// goes as Send sends any (script-spend.ts `send`): giveme.my, the one-time key, Koios.
//
// The parts that wait are held in session storage (`seedelf.waiting.<network>`), each kept under its own key so a new
// review never takes it, and what they spend reserved (spent.ts) so nothing else builds on it. The sessions alarm and
// Home's poll send each once its parent shows (`pumpParts`), never as the wallet unlocks. A lock wipes session storage,
// and with it what waits: the rest never go, and what they'd have spent stays in the private balance. A session's
// funding short of them is the session's to tell (10a's rule: sessions.ts `fundingState`), and is told at once when a
// part is turned away (`stopped`).

import { t } from "../i18n";
import type { NetworkName } from "../networks";
import type { PendingTx } from "../shared/rpc";
import { txInputs } from "./cbor";
import { CollateralError } from "./collateral";
import { chainStatus } from "./feed";
import { KoiosBusyError } from "./koios";
import { settleMaybeSent, startRuns, UNSEEN_AFTER_MS } from "./pending";
import { type Kept, partKey, type ScriptSpendDeps, send, type SpendWhat } from "./script-spend";
import { reservationOf, SESSION_RESERVED_PREFIX, type Reservation } from "./spent";
import { WalletLocked } from "./wallet";
import { isTrap } from "./wasm";

/** chrome.storage.session: each network's payments with parts still to go, by their first part's hash. */
export const SESSION_WAITING_PREFIX = "seedelf.waiting.";
const waitingKey = (network: NetworkName) => SESSION_WAITING_PREFIX + network;

/** Where a part that waits is kept, by its hash: apart from Send's own keys, which the next review writes over. */
export const waitingPartKey = (txHash: string) => `seedelf.waitingPart.${txHash}`;

/** Its reservation's name (spent.ts): what its parts still to go spend. */
const reservationName = (first: string) => `parts.${first}`;

/**
 * How long a part waits, after its parent shows, for giveme.my to see it too: its own read of the chain may be a
 * little behind Koios's. A refusal after that stops the rest.
 */
export const GIVEME_BEHIND_MS = 3 * 60_000;

/** How long Home can still say a payment's parts stopped, after they did. */
const STOPPED_KEEP_MS = 60 * 60_000;

/**
 * How often a waiting part's parent is looked for: Home asks every few seconds while it watches, and Koios's public
 * tier is shared (memory: the Koios budget). A block is about 20 s.
 */
export const LOOK_EVERY_MS = 15_000;

/** When each parent was last looked for, by hash: in the worker's memory, so a restart looks at once. */
const looked = new Map<string, number>();

/** Why the rest of a payment's parts didn't go: a part turned away, or the part before never showed. */
export type PartsStopped = "refused" | "unseen";

/** A payment's parts, some still to go. */
export interface Waiting {
  /** Every part's hash, in order: the first names the payment. */
  hashes: string[];
  /** The part each spends what was carried forward from, by its hash; null for one that pays its own way. */
  after: Array<string | null>;
  /** How many went. */
  sent: number;
  /** When the last went, or (`seen`) when the next one's parent first showed. */
  at: number;
  seen?: number;
  kind: PendingTx["kind"];
  what: SpendWhat;
  stopped?: PartsStopped;
  /** A session's funding: the session's index. */
  session?: number;
}

/** A session's funding told its parts won't all go (sessions.ts). */
export type OnStopped = (network: NetworkName, w: Waiting) => Promise<void>;

/** Which earlier part each of `parts` spends an output of, read off its inputs (null: none). */
export function parentsOf(parts: Array<Pick<Kept, "txHash" | "txCbor">>): Array<string | null> {
  return parts.map(({ txCbor }, i) => {
    const inputs = txInputs(Uint8Array.from(txCbor.match(/../g) ?? [], (h) => Number.parseInt(h, 16)));
    return parts.slice(0, i).find((p) => inputs.some((o) => o.startsWith(`${p.txHash}#`)))?.txHash ?? null;
  });
}

/**
 * A review's parts (WebAssembly's, before anything's kept): each one's hash, fee and how many UTxOs it spends, and
 * whether it spends what an earlier part carried forward (`waits`), so goes once that one is in a block.
 */
export function reviewParts(
  parts: Array<{ txHash: string; fee: { total: string }; inputs: Array<{ txHash: string }> }>,
): Array<{ txHash: string; fee: string; inputs: number; waits?: true }> {
  return parts.map((p, i) => ({
    txHash: p.txHash,
    fee: p.fee.total,
    inputs: p.inputs.length,
    ...(p.inputs.some((input) => parts.slice(0, i).some((q) => q.txHash === input.txHash)) ? { waits: true as const } : {}),
  }));
}

async function waitingOn(deps: Pick<ScriptSpendDeps, "wallet" | "session">, network: NetworkName): Promise<Record<string, Waiting>> {
  return (await deps.wallet.withKeys(() => deps.session.get<Record<string, Waiting>>(waitingKey(network)))) ?? {};
}

async function writeWaiting(
  deps: Pick<ScriptSpendDeps, "wallet" | "session">,
  network: NetworkName,
  first: string,
  change: (w: Waiting | undefined) => Waiting | undefined,
): Promise<void> {
  await deps.wallet.withKeys(async () => {
    const all = (await deps.session.get<Record<string, Waiting>>(waitingKey(network))) ?? {};
    const next = change(all[first]);
    if (next) all[first] = next;
    else delete all[first];
    await deps.session.set(waitingKey(network), all);
  });
}

/** Sets payment `first`'s reservation to what `kept`, its parts still to go, spend; none frees it. */
async function reserve(deps: Pick<ScriptSpendDeps, "wallet" | "session">, network: NetworkName, first: string, kept: Kept[]): Promise<void> {
  await deps.wallet.withKeys(async () => {
    const key = SESSION_RESERVED_PREFIX + network;
    const all = (await deps.session.get<Record<string, Reservation>>(key)) ?? {};
    if (kept.length) all[reservationName(first)] = { inputs: reservationOf(kept).inputs, collateral: [] };
    else delete all[reservationName(first)];
    await deps.session.set(key, all);
  });
}

/** A payment's parts, as Send kept them, and how many go now: those before the first that waits for another. */
export interface Split {
  hashes: string[];
  kept: Kept[];
  after: Array<string | null>;
  goNow: number;
}

/**
 * How payment `hashes`, kept under `key` (keepParts), goes: the parts before the first that spends what another
 * carried forward go now, and those are reserved from (`reserve`) so nothing built meanwhile takes what they'll spend.
 * One part, or parts not all kept (Send then says the review is stale), all go now.
 */
export async function splitParts(deps: ScriptSpendDeps, network: NetworkName, key: string, hashes: string[]): Promise<Split> {
  const all: Split = { hashes, kept: [], after: hashes.map(() => null), goNow: hashes.length };
  if (hashes.length === 1) return all;
  const kept = await deps.wallet.withKeys(() => Promise.all(hashes.map((_, i) => deps.session.get<Kept>(partKey(key, i)))));
  if (!kept.every((k, i) => k !== undefined && k.txHash === hashes[i] && k.network === network)) return all;
  const after = parentsOf(kept as Kept[]);
  const waits = after.findIndex((a) => a !== null);
  if (waits < 0) return { ...all, kept: kept as Kept[], after };
  await reserve(deps, network, hashes[0]!, (kept as Kept[]).slice(waits));
  return { hashes, kept: kept as Kept[], after, goNow: waits };
}

/** The parts that go now didn't all go: those held back are freed, and never go. */
export async function unsplit(deps: ScriptSpendDeps, network: NetworkName, split: Split): Promise<void> {
  if (split.goNow < split.hashes.length) await reserve(deps, network, split.hashes[0]!, []);
}

/**
 * The parts that went now did: those after them are held to go once their parents show, each moved to its own key,
 * and the sessions alarm started. `session`: a session's funding, told if they don't all go.
 */
export async function holdWaiting(
  deps: ScriptSpendDeps,
  network: NetworkName,
  key: string,
  split: Split,
  kind: PendingTx["kind"],
  what: SpendWhat,
  session?: number,
): Promise<void> {
  const { hashes, kept, after, goNow } = split;
  await deps.wallet.withKeys(async () => {
    for (const [i, part] of kept.entries()) {
      if (i < goNow) continue;
      await deps.session.set(waitingPartKey(part.txHash), part);
      await deps.session.remove(partKey(key, i));
    }
  });
  const w: Waiting = { hashes, after, sent: goNow, at: deps.now(), kind, what, ...(session !== undefined ? { session } : {}) };
  await writeWaiting(deps, network, hashes[0]!, () => w);
  await startRuns(deps.session);
}

/** Payment `first`'s parts as Home counts them: how many went of how many, and why the rest didn't, if they didn't. */
export async function partsOf(
  deps: Pick<ScriptSpendDeps, "wallet" | "session">,
  network: NetworkName,
  first: string,
): Promise<{ sent: number; total: number; stopped?: PartsStopped } | undefined> {
  const w = (await waitingOn(deps, network).catch(() => ({}) as Record<string, Waiting>))[first];
  if (!w) return undefined;
  return { sent: w.sent, total: w.hashes.length, ...(w.stopped ? { stopped: w.stopped } : {}) };
}

/** Part `sent - 1` of `first` went: the rest's reservation shrinks to what they spend, and with none left, it's done. */
async function went(deps: ScriptSpendDeps, network: NetworkName, first: string, sent: number): Promise<void> {
  const w = (await waitingOn(deps, network))[first];
  if (!w) return;
  if (sent >= w.hashes.length) {
    // Every part went: Home's banner names the last by the first (PendingTx.chain), as for parts that pay their own.
    await reserve(deps, network, first, []);
    await writeWaiting(deps, network, first, () => undefined);
    return;
  }
  const left = await deps.wallet.withKeys(() => Promise.all(w.hashes.slice(sent).map((h) => deps.session.get<Kept>(waitingPartKey(h)))));
  await reserve(
    deps,
    network,
    first,
    left.filter((k): k is Kept => !!k),
  );
  await writeWaiting(deps, network, first, (cur) => {
    if (!cur) return undefined;
    const { seen: _seen, ...rest } = cur;
    return { ...rest, sent, at: deps.now() };
  });
}

/**
 * The rest of `first`'s parts won't go (`why`): forgotten, their reservation freed, and a session's funding told
 * (`stopped`), so it's short at once rather than once its parts are missed. The record stays a while, so Home says so.
 */
async function stopWaiting(deps: ScriptSpendDeps, network: NetworkName, first: string, why: PartsStopped, stopped?: OnStopped): Promise<void> {
  const w = (await waitingOn(deps, network))[first];
  if (!w || w.stopped) return;
  await deps.wallet.withKeys(async () => {
    for (const h of w.hashes.slice(w.sent)) await deps.session.remove(waitingPartKey(h));
  });
  await reserve(deps, network, first, []);
  await writeWaiting(deps, network, first, (cur) => cur && { ...cur, stopped: why, at: deps.now() });
  await stopped?.(network, { ...w, stopped: why }).catch(() => undefined);
}

/**
 * Sends the part of `w` whose turn it is once its parent shows on chain, and on to the next while one needs no other
 * wait: nothing while another payment on the network may still go through, nor, for a while (GIVEME_BEHIND_MS), when
 * giveme.my or Koios turns it away as not ready. Otherwise a part turned away stops the rest, as does a parent that
 * never shows (UNSEEN_AFTER_MS after the part before it went).
 */
async function step(deps: ScriptSpendDeps, network: NetworkName, first: string, w: Waiting, stopped?: OnStopped): Promise<void> {
  const total = w.hashes.length;
  let { at, seen } = w;
  for (let i = w.sent; i < total; i++) {
    const hash = w.hashes[i]!;
    const parent = w.after[i];
    if (parent && seen === undefined) {
      const last = looked.get(parent);
      if (last !== undefined && deps.now() - last < LOOK_EVERY_MS && deps.now() >= last) return;
      looked.set(parent, deps.now());
      const { statuses } = await chainStatus(deps, network, [{ txHash: parent, sentAt: at, feed: "contract" }]);
      if (!statuses.get(parent)) {
        if (deps.now() - at > UNSEEN_AFTER_MS) await stopWaiting(deps, network, first, "unseen", stopped);
        return;
      }
      looked.delete(parent);
      const shown = (seen = deps.now());
      await writeWaiting(deps, network, first, (cur) => cur && { ...cur, seen: shown });
    }
    // Another payment on the network may still go through: this one waits for it, as a new one would.
    try {
      await settleMaybeSent(deps, network);
    } catch {
      return;
    }
    try {
      await send(deps, network, hash, waitingPartKey(hash), w.kind, w.what, { chain: { first, total }, waited: reservationName(first) });
    } catch (e) {
      if (e instanceof WalletLocked || isTrap(e)) throw e;
      // Not sent, and maybe only for now: giveme.my's view of the chain behind Koios's, giveme.my or Koios busy.
      const behind = e instanceof CollateralError || (e instanceof KoiosBusyError && !e.maybeSent);
      if (behind && deps.now() - (seen ?? at) < GIVEME_BEHIND_MS) return;
      await stopWaiting(deps, network, first, "refused", stopped);
      return;
    }
    await went(deps, network, first, i + 1);
    at = deps.now();
    seen = undefined;
  }
}

/** Each network's pump, one at a time: the alarm and Home's poll may both ask, and two would send a part twice. */
const pumping = new WeakMap<object, Map<NetworkName, Promise<boolean>>>();

/**
 * Sends what waits on `network` (`step`), each part once its parent shows. Returns whether any payment still has
 * parts to go, so the sessions alarm keeps going. `unlock`: the run as the wallet unlocks, which sends nothing (privacy
 * review §3.1). `stopped`: a session's funding, told its parts won't all go.
 */
export function pumpParts(
  deps: ScriptSpendDeps,
  network: NetworkName,
  { unlock = false, stopped }: { unlock?: boolean; stopped?: OnStopped } = {},
): Promise<boolean> {
  let byNetwork = pumping.get(deps.session);
  if (!byNetwork) pumping.set(deps.session, (byNetwork = new Map()));
  const going = byNetwork.get(network);
  if (going) return going;
  const run = (async () => {
    let busy = false;
    for (const [first, w] of Object.entries(await waitingOn(deps, network))) {
      if (w.stopped) {
        if (deps.now() - w.at > STOPPED_KEEP_MS) await writeWaiting(deps, network, first, () => undefined);
        continue;
      }
      if (!unlock) await step(deps, network, first, w, stopped);
      const now = (await waitingOn(deps, network))[first];
      if (now && !now.stopped) busy = true;
    }
    return busy;
  })().finally(() => byNetwork.delete(network));
  byNetwork.set(network, run);
  return run;
}

/** The worker's parts that wait (sw.ts): the sessions alarm's runs and Home's poll pump them. */
export class PartsService {
  constructor(private readonly deps: ScriptSpendDeps & { stopped?: OnStopped }) {}

  /** Sends what waits on `network` and can go: whether any still waits (`pumpParts`). */
  pump(network: NetworkName, unlock = false): Promise<boolean> {
    return pumpParts(this.deps, network, { unlock, stopped: this.deps.stopped });
  }

  /** Payment `first`'s parts, as Home's banner counts them (`partsOf`). */
  of(network: NetworkName, first: string): ReturnType<typeof partsOf> {
    return partsOf(this.deps, network, first);
  }

  /**
   * The payment whose parts went or stopped last on `network`, as Home's banner shows one, for when the watch holds
   * none (pending.ts lets a private one go once it's seen, or after 10 minutes): its last part that went, landed once
   * the next one's wait saw it (`seen`) or a part after it was turned away, which only happens once it's there; never
   * seen, it never showed. None once every part went.
   */
  async shown(network: NetworkName): Promise<PendingTx | undefined> {
    const [first, w] =
      Object.entries(await waitingOn(this.deps, network)).sort(([, a], [, b]) => b.at - a.at)[0] ?? [];
    if (!first || !w || w.sent === 0) return undefined;
    const landed = w.stopped === "refused" || w.seen !== undefined;
    return {
      kind: w.kind,
      network,
      txHash: w.hashes[w.sent - 1]!,
      submittedAt: w.at,
      confirmations: landed ? 1 : null,
      ...(w.stopped === "unseen" ? { dropped: "unseen" as const } : {}),
      chain: { first, total: w.hashes.length },
      parts: { sent: w.sent, total: w.hashes.length, ...(w.stopped ? { stopped: w.stopped } : {}) },
    };
  }
}

/**
 * Sends a payment kept in parts (keepParts), one after another, each as `send` sends one (written ahead, watched); the
 * last that goes now named in Home's banner by the first, as a chain is (`PendingTx.chain`). One part is sent as one
 * always was. A part that spends what the one before carried forward, and every part after it, waits for that one to
 * be in a block (`splitParts`, `holdWaiting`, `pumpParts`), and the answer says how many went (`parts`). Where one that
 * goes now after the first doesn't, or Koios doesn't answer one before the last of them (nothing more goes while it may
 * still go through), it says how many went, and why the rest didn't: those that went stay watched, in Home's banner
 * and Activity, and those that would have waited never go.
 */
export async function sendParts(
  deps: ScriptSpendDeps,
  network: NetworkName,
  txHash: string,
  key: string,
  kind: PendingTx["kind"],
  what: SpendWhat,
): Promise<PendingTx> {
  const first = await deps.wallet.withKeys(() => deps.session.get<Kept>(key));
  const hashes = first?.txHash === txHash && first.network === network && first.partHashes?.length ? first.partHashes : [txHash];
  const total = hashes.length;
  const split = await splitParts(deps, network, key, hashes);
  const { goNow } = split;
  let sent: PendingTx | undefined;
  try {
    for (const [i, hash] of hashes.slice(0, goNow).entries()) {
      const chain = total > 1 && i === goNow - 1 ? { chain: { first: hashes[0]!, total } } : {};
      try {
        sent = await send(deps, network, hash, partKey(key, i), kind, what, chain);
      } catch (e) {
        if (i === 0 || isTrap(e)) throw e;
        throw new Error(t("worker.parts.partly", { sent: i, total, why: e instanceof Error ? e.message : String(e) }));
      }
      // The last that goes now may be maybe sent: what waits for it waits for the chain to show it anyway.
      if (sent.maybeSent && i < goNow - 1) throw new Error(t("worker.parts.partlyMaybe", { sent: i + 1, total }));
    }
  } catch (e) {
    await unsplit(deps, network, split);
    throw e;
  }
  if (goNow === total) return sent!;
  await holdWaiting(deps, network, key, split, kind, what);
  return { ...sent!, parts: { sent: goNow, total } };
}
