// The one submitted transaction the wallet watches on each network: the
// last Send of any kind there. Home asks about the network it shows every
// 15 s, and the worker's runs keep a maybe-sent one going on a network it
// doesn't show (`watch`). Once the network confirms it, the
// cached balances are dropped so the next reading sees the new UTxOs. A
// private one's watch stops after 10 minutes; one from the public account,
// which stops being valid at a slot (account.ts), is watched until the chain
// shows it or passes that slot, when nothing was sent and its UTxOs are
// freed.
//
// A submit Koios didn't answer may or may not have gone through (koios.ts
// KoiosBusyError), and sending another payment could then pay twice (launch
// review #10). So it's watched as maybe sent: its UTxOs are held back, Send
// sends the very same bytes again, the watch does too now and then (the
// network takes them once), and nothing new is built on that network until
// it's settled. The Seedelf history is written once it's seen. One that
// never shows is let go, its UTxOs freed: from the public account when the
// chain passes its slot, and a private one, which has no slot yet, after 20
// minutes unseen.
//
// Every write of the watch goes through `put`: nothing replaces a
// transaction that may still go through with another, not a Send checked
// before it went maybe sent, nor Lovejoin's withdraw or mix (final review
// money-submit-1). Its watch is what stops a second payment.

import type { NetworkName } from "../networks";
import type { PendingTx } from "../shared/rpc";
import { VALID_FOR_MS } from "./account";
import type { ActivityService } from "./activity";
import { txInputs } from "./cbor";
import { forgetContractView } from "./contract-scan";
import { KoiosBusyError, SpentInputError, type Koios } from "./koios";
import { forgetSpent, rememberSpent } from "./spent";
import type { Area } from "./storage";
import { SESSION_BALANCES_PREFIX, type Wallet } from "./wallet";

/**
 * chrome.storage.session: the submitted transaction being watched, one per
 * network (`seedelf.pendingTx.<network>`), so a switch to the other network
 * and a Send there never drops the watch of one that may still go through.
 */
export const SESSION_PENDING_PREFIX = "seedelf.pendingTx.";
export const pendingKey = (network: NetworkName) => SESSION_PENDING_PREFIX + network;

/** Stop watching a submitted private transaction after this long. */
const WATCH_MS = 10 * 60_000;
/** How often a maybe-sent transaction goes again while the chain hasn't shown it. */
const RESEND_MS = 2 * 60_000;
/** A maybe-sent private payment the chain hasn't shown after this long most likely never went out. */
export const UNSEEN_AFTER_MS = 20 * 60_000;
/**
 * How far past its slot the chain must be before a transaction counts as
 * expired: Koios's backends can lag, one by 20 minutes (spent.ts), and a
 * lagging one's tx_status could miss one that landed just in time.
 */
export const EXPIRED_AFTER_SLOTS = 30 * 60;

/** Refused while a payment may still go through. */
export const MAYBE_SENT_WAIT =
  "Your last payment may still go through: Koios didn't answer when it was sent, and the network hasn't shown it yet. " +
  "Home shows when it lands, or when it can't any more. Send another after that.";

/** What the watch keeps beyond what Home is shown. */
interface Watched extends PendingTx {
  /** A maybe-sent transaction, signed (hex), to send again as it is. */
  txCbor?: string;
  /** The outpoints it spends, freed if it never lands. */
  inputs?: string[];
  /** A Seedelf spend's: its UTxOs come back with a full read of the contract. */
  contract?: boolean;
  /** The reviewed summary, for the Seedelf history once it's seen (activity.ts). */
  summary?: object;
  /** Where Send keeps it, cleared once it's settled. */
  kept?: string;
  /** When it last went again. */
  resentAt?: number;
}

export interface PendingDeps {
  wallet: Wallet;
  session: Area;
  koios: (network: NetworkName) => Koios;
  now: () => number;
  /** Writes a maybe-sent Seedelf spend into the history once it's seen. */
  activity?: ActivityService;
}

/** A kept, signed transaction on its way: what Send hands `submitWatched`. */
export interface Sending {
  network: NetworkName;
  txHash: string;
  kind: PendingTx["kind"];
  /** Signed, hex. */
  txCbor: string;
  /** Where Send keeps it, and what's kept there. */
  key: string;
  kept: object;
  /** The reviewed summary, for the Seedelf history. */
  summary: object;
  /** A Seedelf spend, of the contract's UTxOs. */
  contract: boolean;
  invalidHereafter?: number;
  /** Sent before, and Koios didn't answer. */
  again: boolean;
}

const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

/** A maybe-sent transaction the chain hasn't settled: while it's watched, nothing new goes out on its network. */
function unsettled(w: Watched | undefined): w is Watched {
  return !!w?.maybeSent && w.confirmations === null && !w.dropped;
}

/**
 * Puts `record` in its network's watch, unless another transaction there may
 * still go through: that one stays, until settle() settles it. Returns
 * whether `record` went in. Call it while unlocked.
 */
async function put(session: Area, record: Watched): Promise<boolean> {
  const was = await session.get<Watched>(pendingKey(record.network));
  if (unsettled(was) && was.txHash !== record.txHash) return false;
  await session.set(pendingKey(record.network), record);
  return true;
}

/**
 * Has Home's banner watch a transaction sent outside Send (Lovejoin's
 * withdraw brought back now, its mix from the public account), unless a
 * payment on that network may still go through: that one's watch stays.
 */
export async function watchSent(deps: PendingDeps, pending: PendingTx): Promise<void> {
  await deps.wallet.withKeys(() => put(deps.session, pending));
}

/** The watched transaction as Home is shown it. */
function shown(watched: Watched): PendingTx {
  const { txCbor: _txCbor, inputs: _inputs, contract: _contract, summary: _summary, kept: _kept, resentAt: _resentAt, ...pending } = watched;
  return pending;
}

/**
 * Submits a kept, signed transaction, and has the watch take it over. One
 * Koios didn't answer comes back maybe sent, not as an error. One refused as
 * spending what's spent counts as sent if the chain has it; after a try
 * Koios didn't answer, it's still maybe sent if the chain doesn't have it yet.
 */
export async function submitWatched(deps: PendingDeps, s: Sending): Promise<PendingTx> {
  const { wallet, session, now } = deps;
  const koios = deps.koios(s.network);
  const bytes = hexBytes(s.txCbor);
  let confirmations: number | null = null;
  try {
    const submitted = await koios.submitTx(bytes);
    if (submitted !== s.txHash) throw new Error(`Koios answered with another transaction id (${submitted}).`);
  } catch (e) {
    if (e instanceof KoiosBusyError && e.maybeSent) return maybeSent(deps, s);
    if (!(e instanceof SpentInputError)) throw e;
    // Spent already: by this very transaction, if an earlier try went through.
    confirmations = (await koios.txStatus([s.txHash]).catch(() => undefined))?.get(s.txHash) ?? null;
    if (confirmations === null) {
      // After a try Koios didn't answer, most likely that try, still on its way.
      if (s.again) return maybeSent(deps, s);
      // The kept view had a spent UTxO as ours: read the contract in full next time.
      if (s.contract) await forgetContractView(deps, s.network);
      throw e;
    }
  }

  const pending: PendingTx = { kind: s.kind, network: s.network, txHash: s.txHash, submittedAt: now(), confirmations, ...slot(s) };
  // The inputs of one that can expire, to free them if it does.
  const watched: Watched = s.invalidHereafter === undefined ? pending : { ...pending, inputs: txInputs(bytes) };
  await wallet.withKeys(async () => {
    await rememberSpent(session, bytes);
    await session.remove(s.key);
    await put(session, watched);
  });
  await deps.activity?.sent(s.network, pending, s.summary).catch(() => undefined);
  return pending;
}

const slot = (s: { invalidHereafter?: number }) => (s.invalidHereafter === undefined ? {} : { invalidHereafter: s.invalidHereafter });

/** Watches `s` as maybe sent: its UTxOs held back, and kept to go again as it is. */
async function maybeSent(deps: PendingDeps, s: Sending): Promise<PendingTx> {
  const { wallet, session, now } = deps;
  const watched = await wallet.withKeys(async () => {
    const was = await session.get<Watched>(pendingKey(s.network));
    if (was?.maybeSent && was.txHash === s.txHash) return was;
    const bytes = hexBytes(s.txCbor);
    const watched: Watched = {
      kind: s.kind,
      network: s.network,
      txHash: s.txHash,
      submittedAt: now(),
      confirmations: null,
      maybeSent: true,
      ...slot(s),
      txCbor: s.txCbor,
      inputs: txInputs(bytes),
      contract: s.contract,
      summary: s.summary,
      kept: s.key,
    };
    await rememberSpent(session, bytes);
    // Send sends these very bytes again, and asks giveme.my nothing.
    await session.set(s.key, { ...s.kept, sentCbor: s.txCbor });
    // Another that may still go through keeps the watch (both went out at
    // once, from two windows): new payments wait for it, and this one is
    // held back all the same.
    await put(session, watched);
    return watched;
  });
  // What the kept view has of the contract is behind whatever happened.
  if (s.contract) await forgetContractView(deps, s.network);
  return shown(watched);
}

/**
 * Looks for the watched transaction on chain, and settles it when it can:
 * seen, sent again and taken, or let go. Returns it as it now stands.
 */
async function settle(deps: PendingDeps, w: Watched): Promise<Watched> {
  const { wallet, session, now } = deps;
  const koios = deps.koios(w.network);
  const confirmations = (await koios.txStatus([w.txHash])).get(w.txHash) ?? null;
  if (confirmations !== null) {
    const { maybeSent: _maybeSent, ...seen } = { ...w, confirmations };
    await wallet.withKeys(async () => {
      await session.remove(pendingKey(w.network));
      // The next balance reading should see the new UTxOs.
      await session.remove(SESSION_BALANCES_PREFIX + w.network);
      await dropKept(session, w);
    });
    if (w.summary) await deps.activity?.sent(w.network, shown(seen), w.summary).catch(() => undefined);
    return seen;
  }

  const age = now() - w.submittedAt;
  // Past its slot by the chain's clock, not this device's, which set the slot.
  const expired =
    w.invalidHereafter !== undefined && age > VALID_FOR_MS && (await koios.tipSlot()) > w.invalidHereafter + EXPIRED_AFTER_SLOTS;
  const unseen = !expired && w.maybeSent && w.invalidHereafter === undefined && age > UNSEEN_AFTER_MS;
  if (expired || unseen) {
    await wallet.withKeys(async () => {
      if (w.inputs) await forgetSpent(session, w.inputs);
      await session.remove(pendingKey(w.network));
      await session.remove(SESSION_BALANCES_PREFIX + w.network);
      await dropKept(session, w);
    });
    if (w.contract) await forgetContractView(deps, w.network);
    return { ...w, dropped: expired ? "expired" : "unseen" };
  }

  if (w.maybeSent && w.txCbor && now() - (w.resentAt ?? w.submittedAt) >= RESEND_MS) {
    let current: Watched = { ...w, resentAt: now() };
    try {
      if ((await koios.submitTx(hexBytes(w.txCbor))) === w.txHash) {
        // Taken: an ordinary sent transaction from here on.
        const { maybeSent: _maybeSent, txCbor: _txCbor, summary, kept: _kept, ...sent } = current;
        current = { ...sent, submittedAt: now() };
        await wallet.withKeys(() => dropKept(session, w));
        if (summary) await deps.activity?.sent(w.network, shown(current), summary).catch(() => undefined);
      }
    } catch {
      // Refused as spent (most likely this very one, on its way), or unanswered again: keep watching.
    }
    await wallet.withKeys(() => session.set(pendingKey(w.network), current));
    return current;
  }

  // A private one Koios took: watched for 10 minutes.
  if (!w.maybeSent && w.invalidHereafter === undefined && age > WATCH_MS) {
    await wallet.withKeys(() => session.remove(pendingKey(w.network)));
  }
  return w;
}

/** Clears where Send keeps `w`, if it still holds it. Call it while unlocked. */
async function dropKept(session: Area, w: Watched): Promise<void> {
  if (!w.kept) return;
  const kept = await session.get<{ txHash?: string }>(w.kept);
  if (kept?.txHash === w.txHash) await session.remove(w.kept);
}

/**
 * Refuses a new payment on `network` while one there may still go through:
 * Koios didn't answer it, and the chain hasn't shown it. It's looked for
 * first, so one that landed, or can't land any more, stops nothing.
 * Otherwise both could land, and pay twice.
 */
export async function settleMaybeSent(deps: PendingDeps, network: NetworkName): Promise<void> {
  const w = await deps.wallet.withKeys(() => deps.session.get<Watched>(pendingKey(network)));
  if (!w?.maybeSent || w.network !== network) return;
  const current = await settle(deps, w);
  if (current.maybeSent && current.confirmations === null && !current.dropped) throw new Error(MAYBE_SENT_WAIT);
}

export class PendingService {
  constructor(private readonly deps: PendingDeps) {}

  /** The watched transaction on `network` as it now stands, or null. Clears it once it's settled. */
  async pending(network: NetworkName): Promise<PendingTx | null> {
    const watched = await this.deps.wallet.withKeys(() => this.deps.session.get<Watched>(pendingKey(network)));
    return watched ? shown(await settle(this.deps, watched)) : null;
  }

  /**
   * Keeps a maybe-sent transaction on `network` going while the wallet shows
   * another network, or no page at all (the worker's runs): looked for, and
   * sent again now and then. Returns whether it's still maybe sent. One Koios
   * took is left for Home, which asks when it opens.
   */
  async watch(network: NetworkName): Promise<boolean> {
    const watched = await this.deps.wallet.withKeys(() => this.deps.session.get<Watched>(pendingKey(network)));
    if (!watched?.maybeSent) return false;
    const current = await settle(this.deps, watched);
    return !!current.maybeSent && current.confirmations === null && !current.dropped;
  }
}
