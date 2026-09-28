// The one submitted transaction the wallet watches on each network: the
// last Send of any kind there. Home asks about the network it shows every
// 15 s, and the worker's runs keep a maybe-sent one going on a network it
// doesn't show (`watch`). Once the network confirms it, the
// cached balances are dropped so the next reading sees the new UTxOs: for a
// private spend that pays nothing to the public account, only the private
// side, so the account isn't read again in the same second as the private
// transaction lands, which would tie the two by timing (privacy review
// §2.9). A private one's watch stops after 10 minutes; one from the public
// account, which stops being valid at a slot (account.ts), is watched until
// the chain shows it or passes that slot, when nothing was sent and its
// UTxOs are freed.
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
// Every write of the watch goes through `take`: nothing replaces a
// transaction that may still go through with another, not a Send checked
// before it went maybe sent, nor Lovejoin's withdraw or mix (final review
// money-submit-1). Its watch is what stops a second payment.
//
// A lock, a closed browser or an update clears session storage, and the
// watch with it, while a maybe-sent payment can still land for hours. So
// each is sealed on the device too (private-store.ts, `maybeSent.<network>`),
// and put back, its UTxOs held back again, before the watch is next read: at
// unlock, and before any build. Only its settling removes it (final review
// money-submit-4).

import type { NetworkName } from "../networks";
import type { PendingTx } from "../shared/rpc";
import { VALID_FOR_MS } from "./account";
import type { ActivityService } from "./activity";
import { txInputs } from "./cbor";
import { forgetContractView } from "./contract-scan";
import { KoiosBusyError, SpentInputError, type Koios, type KoiosUtxo } from "./koios";
import { UnreadableRecordError, type PrivateStore } from "./private-store";
import { forgetSpent, rememberSpent } from "./spent";
import type { Area } from "./storage";
import { SESSION_BALANCES_PREFIX, SESSION_PRIVATE_STALE_PREFIX, type Wallet } from "./wallet";

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
  /**
   * Put back from its sealed copy (restoreNow), and not sent again since: it
   * isn't let go as unseen before it has been, so that isn't judged on the
   * time the wallet was locked alone (independent review L9).
   */
  restored?: boolean;
  /** A private spend that pays the public account (`paysAccount`): its landing reads the account again too. */
  toAccount?: boolean;
}

/**
 * What spends only what's private (the private balance, a session's
 * account, a Lovejoin box), when it carries no slot: only the public
 * account's transactions do (account.ts), so an account-paid mint doesn't
 * count. Its landing reads only the private side again (`forgetReading`),
 * unless it pays the public account.
 */
const PRIVATE_SPENDS: ReadonlySet<PendingTx["kind"]> = new Set([
  "transfer",
  "withdraw",
  "remove",
  "mint",
  "session-out",
  "session-swap",
  "session-cancel",
  "session-back",
  "lovejoin-withdraw",
]);

/** Whether a Seedelf spend's reviewed summary pays the wallet's own public account: a removal to it, or a Make public to it. */
function paysAccount(kind: PendingTx["kind"], summary: object): boolean {
  const s = summary as { to?: unknown; payments?: Array<{ own?: unknown }> };
  if (kind === "remove") return s.to === "account";
  if (kind === "withdraw") return Array.isArray(s.payments) && s.payments.some((p) => p.own === true);
  return false;
}

/**
 * `w` landed, or was let go: the next balance reading sees it. A private
 * spend that pays nothing to the public account leaves the account's side
 * as it was, and only the private side is read again; anything else drops
 * the whole reading. Call it while unlocked.
 */
async function forgetReading(session: Area, w: Watched): Promise<void> {
  // One sealed maybe sent before `toAccount` was kept says so by its summary.
  const toAccount = w.toAccount || (!!w.contract && !!w.summary && paysAccount(w.kind, w.summary));
  if (PRIVATE_SPENDS.has(w.kind) && w.invalidHereafter === undefined && !toAccount) {
    await session.set(SESSION_PRIVATE_STALE_PREFIX + w.network, true);
  } else {
    await session.remove(SESSION_BALANCES_PREFIX + w.network);
  }
}

export interface PendingDeps {
  wallet: Wallet;
  session: Area;
  /** Where a maybe-sent transaction is sealed, so a lock or a closed browser doesn't forget it. */
  store: PrivateStore;
  koios: (network: NetworkName) => Koios;
  now: () => number;
  /** Writes a maybe-sent Seedelf spend into the history once it's seen. */
  activity?: ActivityService;
  /**
   * The worker's sessions alarm (sw.ts), whose runs keep a maybe-sent one
   * going (`watch`): PendingService's, which it keeps for the whole worker.
   */
  alarm?: { start(): Promise<void> };
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
 * Each network's changes to the watch and to its sealed copy, one at a time.
 * The sealed copy can't be written under the wallet's lock (PrivateStore
 * takes it too), so the two are kept in step here. By the worker's session
 * storage.
 */
const turns = new WeakMap<Area, Map<NetworkName, Promise<unknown>>>();

function inTurn<T>(deps: PendingDeps, network: NetworkName, task: () => Promise<T>): Promise<T> {
  let byNetwork = turns.get(deps.session);
  if (!byNetwork) turns.set(deps.session, (byNetwork = new Map()));
  const run = (byNetwork.get(network) ?? Promise.resolve()).then(task, task);
  byNetwork.set(network, run.catch(() => undefined));
  return run;
}

/**
 * The sessions alarm, by the worker's session storage: PendingService keeps
 * it here, since Send's services reach the watch through deps of their own.
 * It's started whenever the watch takes a maybe-sent payment, or puts one
 * back, so the worker's runs keep it going on a network the wallet doesn't
 * show, or with no page open: the unlock's run may have stopped it
 * (independent review L4).
 */
const alarms = new WeakMap<Area, { start(): Promise<void> }>();

async function wake(deps: PendingDeps): Promise<void> {
  await (deps.alarm ?? alarms.get(deps.session))?.start().catch(() => undefined);
}

const sealedName = (network: NetworkName) => `maybeSent.${network}` as const;

/** The sealed copy of the maybe-sent transaction on `network`, if there's one. Throws if locked. */
async function sealed(deps: PendingDeps, network: NetworkName): Promise<Watched | undefined> {
  try {
    return (await deps.store.get<Watched | null>(sealedName(network))) ?? undefined;
  } catch (e) {
    // One that won't open can't be put back; the next is sealed over it.
    if (e instanceof UnreadableRecordError) return undefined;
    throw e;
  }
}

/** Seals `w`, maybe sent. One that can't be sealed is still watched until a lock. */
async function seal(deps: PendingDeps, w: Watched): Promise<void> {
  await deps.store.set(sealedName(w.network), w).catch(() => undefined);
}

/** Drops the sealed copy of `w`, settled, if that's what's sealed. Call it in the network's turn. */
async function unseal(deps: PendingDeps, w: Watched): Promise<void> {
  const was = await sealed(deps, w.network).catch(() => undefined);
  if (was?.txHash === w.txHash) await deps.store.set(sealedName(w.network), null).catch(() => undefined);
}

/**
 * The watch on `network`. One a lock or a closed browser cleared is put
 * back from its sealed copy first, if it may still go through, and its
 * UTxOs held back again. It's put back as if sent again just now: nothing
 * sends it in the second the wallet unlocks, not the unlock's run, nor
 * Home's first look, and it goes again RESEND_MS on (privacy review §3.1,
 * independent review L9). Call it in the network's turn.
 */
async function restoreNow(deps: PendingDeps, network: NetworkName): Promise<Watched | undefined> {
  const { wallet, session, now } = deps;
  const key = pendingKey(network);
  const watched = await wallet.withKeys(() => session.get<Watched>(key));
  if (watched) return watched;
  const sealedOne = await sealed(deps, network);
  if (!unsettled(sealedOne) || sealedOne.network !== network || !sealedOne.txCbor) return undefined;
  const w: Watched = { ...sealedOne, resentAt: now(), restored: true };
  await wallet.withKeys(async () => {
    await rememberSpent(session, network, hexBytes(w.txCbor!));
    await session.set(key, w);
  });
  // What the kept view has of the contract is behind whatever happened meanwhile.
  if (w.contract) await forgetContractView(deps, network);
  await wake(deps);
  return w;
}

/** The watch on `network`, put back first if a lock cleared it (restoreNow). */
function watchedOn(deps: PendingDeps, network: NetworkName): Promise<Watched | undefined> {
  return inTurn(deps, network, () => restoreNow(deps, network));
}

/**
 * Puts `record` in its network's watch, unless another transaction there may
 * still go through: that one stays, until settle() settles it. So does
 * `record` itself, watched as maybe sent already, as it first was.
 * `alongside` runs under the same lock first. A maybe-sent one is sealed;
 * one it takes over from goes on as sent, and isn't any more. Returns what
 * the watch holds after.
 */
async function take(deps: PendingDeps, record: Watched, alongside?: () => Promise<void>): Promise<Watched> {
  const { wallet, session } = deps;
  const key = pendingKey(record.network);
  return inTurn(deps, record.network, async () => {
    await restoreNow(deps, record.network);
    const [was, watched] = await wallet.withKeys(async () => {
      await alongside?.();
      const was = await session.get<Watched>(key);
      if (unsettled(was) && (was.txHash !== record.txHash || record.maybeSent)) return [was, was] as const;
      await session.set(key, record);
      return [was, record] as const;
    });
    if (watched === record && record.maybeSent) await seal(deps, record);
    else if (watched === record && was?.maybeSent && was.txHash === record.txHash) await unseal(deps, was);
    return watched;
  });
}

/**
 * Has Home's banner watch a transaction sent outside Send (Lovejoin's
 * withdraw brought back now, its mix from the public account), unless a
 * payment on that network may still go through: that one's watch stays.
 */
export async function watchSent(deps: PendingDeps, pending: PendingTx): Promise<void> {
  await take(deps, pending);
}

/** The watched transaction as Home is shown it. */
function shown(watched: Watched): PendingTx {
  const {
    txCbor: _txCbor,
    inputs: _inputs,
    contract: _contract,
    summary: _summary,
    kept: _kept,
    resentAt: _resentAt,
    restored: _restored,
    toAccount: _toAccount,
    ...pending
  } = watched;
  return pending;
}

/**
 * Submits a kept, signed transaction, and has the watch take it over. It's
 * in the watch as maybe sent before it goes (`writeAhead`), so a lock, a
 * closed browser or a stopped worker while Koios is asked never loses it
 * (independent review M1). Taken, it goes on as an ordinary sent
 * transaction. One Koios didn't answer stays maybe sent, and comes back so,
 * not as an error. One refused as spending what's spent counts as sent if
 * the chain has it; after a try Koios didn't answer, it's still maybe sent
 * if the chain doesn't have it yet. Refused otherwise, it never went out:
 * what was written ahead is taken back (`takeBack`), and the refusal said.
 */
export async function submitWatched(deps: PendingDeps, s: Sending): Promise<PendingTx> {
  const { session, now } = deps;
  const koios = deps.koios(s.network);
  const bytes = hexBytes(s.txCbor);
  const ahead = await writeAhead(deps, s);
  // Sent before: Send's own copy says so, or the watch has it already, maybe sent.
  const again = s.again || ahead.again;
  let submitted: string | undefined;
  let confirmations: number | null = null;
  try {
    submitted = await koios.submitTx(bytes);
  } catch (e) {
    if (e instanceof KoiosBusyError && e.maybeSent) return stillMaybeSent(deps, s, ahead);
    if (e instanceof SpentInputError) {
      // Spent already: by this very transaction, if an earlier try went through.
      confirmations = (await koios.txStatus([s.txHash]).catch(() => undefined))?.get(s.txHash) ?? null;
      // After a try Koios didn't answer, most likely that try, still on its way.
      if (confirmations === null && again) return stillMaybeSent(deps, s, ahead);
    }
    if (confirmations === null) {
      // It never went out, unless the watch sent it again meanwhile: then it stays as the watch has it.
      const kept = ahead.again ? undefined : await takeBack(deps, s, ahead);
      if (kept) return shown(kept);
      // The kept view had a spent UTxO as ours: read the contract in full next time.
      if (e instanceof SpentInputError && s.contract) await forgetContractView(deps, s.network);
      throw e;
    }
  }
  if (submitted !== undefined && submitted !== s.txHash) {
    // Something went out, and what isn't known: it stays maybe sent, as written ahead.
    if (s.contract) await forgetContractView(deps, s.network).catch(() => undefined);
    throw new Error(`Koios answered with another transaction id (${submitted}).`);
  }

  const pending: PendingTx = { kind: s.kind, network: s.network, txHash: s.txHash, submittedAt: now(), confirmations, ...slot(s) };
  // The inputs of one that can expire, to free them if it does; a private one to the account says so.
  const watched: Watched = s.invalidHereafter === undefined ? { ...pending, ...toAccount(s) } : { ...pending, inputs: txInputs(bytes) };
  await take(deps, watched, async () => {
    await rememberSpent(session, s.network, bytes);
    await session.remove(s.key);
  });
  await deps.activity?.sent(s.network, pending, s.summary).catch(() => undefined);
  return pending;
}

const slot = (s: { invalidHereafter?: number }) => (s.invalidHereafter === undefined ? {} : { invalidHereafter: s.invalidHereafter });
const toAccount = (s: Sending) => (s.contract && paysAccount(s.kind, s.summary) ? { toAccount: true } : {});

/** What `writeAhead` wrote: the watch's record of `s`, and the sealed write, by its nonce. */
interface Ahead {
  record: Watched;
  /** The watch had this very one already, maybe sent (Send again), and keeps it as it first was. */
  again: boolean;
  nonce?: string;
}

/**
 * Writes `s` into its network's watch as maybe sent before it goes to
 * Koios: its UTxOs held back, kept to go again as it is, and sealed
 * (independent review M1). Whatever stops the submit halfway, a lock, a
 * closed browser, a stopped worker, leaves it watched: put back at the next
 * unlock, and settled as any maybe-sent one is (tx_status, sent again).
 * Refused while another payment on the network may still go through, as a
 * build is: one maybe-sent watch per network. One that can't be sealed
 * isn't sent.
 */
async function writeAhead(deps: PendingDeps, s: Sending): Promise<Ahead> {
  const { wallet, session, now } = deps;
  const key = pendingKey(s.network);
  const bytes = hexBytes(s.txCbor);
  const record: Watched = {
    kind: s.kind,
    network: s.network,
    txHash: s.txHash,
    submittedAt: now(),
    confirmations: null,
    maybeSent: true,
    ...slot(s),
    ...toAccount(s),
    txCbor: s.txCbor,
    inputs: txInputs(bytes),
    contract: s.contract,
    summary: s.summary,
    kept: s.key,
  };
  return inTurn(deps, s.network, async () => {
    await restoreNow(deps, s.network);
    const was = await wallet.withKeys(async () => {
      const was = await session.get<Watched>(key);
      if (unsettled(was) && was.txHash !== s.txHash) return was;
      await rememberSpent(session, s.network, bytes);
      // Send sends these very bytes again, and asks giveme.my nothing.
      await session.set(s.key, { ...s.kept, sentCbor: s.txCbor });
      if (!unsettled(was)) await session.set(key, record);
      return was;
    });
    if (unsettled(was)) {
      if (was.txHash !== s.txHash) throw new Error(MAYBE_SENT_WAIT);
      return { record: was, again: true };
    }
    const ahead: Ahead = { record, again: false };
    try {
      await deps.store.set(sealedName(s.network), record);
      ahead.nonce = await deps.store.sealedAs(sealedName(s.network));
    } catch (e) {
      // Not sealed, it isn't sent: a lock mid-submit would lose it.
      await undoAhead(deps, s, ahead).catch(() => undefined);
      throw e;
    }
    await wake(deps);
    return ahead;
  });
}

/**
 * Takes back what `writeAhead` wrote for `s`, refused: its watch, its UTxOs
 * held back, Send's copy as sent. Only while the watch still has it as it
 * was written: one sent again meanwhile (the watch's run) may have gone
 * after all, and stays; that one is returned. Call it in the network's turn.
 */
async function undoAhead(deps: PendingDeps, s: Sending, { record }: Ahead): Promise<Watched | undefined> {
  const { wallet, session } = deps;
  const key = pendingKey(s.network);
  const found = await wallet.withKeys(async () => {
    const cur = await session.get<Watched>(key);
    if (cur?.txHash !== record.txHash) return { undone: false };
    if (!writtenAhead(cur, record)) return { undone: false, kept: cur };
    await forgetSpent(session, record.inputs ?? []);
    await session.remove(key);
    const kept = await session.get<{ txHash?: string }>(s.key);
    if (kept?.txHash === s.txHash) await session.set(s.key, s.kept);
    return { undone: true };
  });
  if (found.undone) await unseal(deps, record);
  return found.kept;
}

/**
 * `s` was refused: it never went out, and what `writeAhead` wrote goes
 * (`undoAhead`). Locked meanwhile, the lock took the watch, the UTxOs held
 * back and Send's copy with it, and only the sealed copy is left, which goes
 * too while it's still the one written ahead. Returns the watch's record
 * when it stays.
 */
async function takeBack(deps: PendingDeps, s: Sending, ahead: Ahead): Promise<Watched | undefined> {
  try {
    return await inTurn(deps, s.network, () => undoAhead(deps, s, ahead));
  } catch {
    if (ahead.nonce) await deps.store.removeIf(sealedName(s.network), ahead.nonce).catch(() => undefined);
    return undefined;
  }
}

/**
 * `s` may have gone through: watched as maybe sent, as written ahead, from
 * when Koios last had it (its 20 minutes unseen count from then, as they did
 * before it was written ahead). One the watch had already stays as it first
 * was. Returns what the watch has of it.
 */
async function stillMaybeSent(deps: PendingDeps, s: Sending, ahead: Ahead): Promise<PendingTx> {
  const { wallet, session, now } = deps;
  const key = pendingKey(s.network);
  // What the kept view has of the contract is behind whatever happened.
  if (s.contract) await forgetContractView(deps, s.network).catch(() => undefined);
  const { record } = ahead;
  await wake(deps);
  // Locked meanwhile, it's sealed all the same, and put back at the unlock.
  const cur = await inTurn(deps, s.network, async () => {
    const found = await wallet.withKeys(async () => {
      const cur = await session.get<Watched>(key);
      if (ahead.again || !writtenAhead(cur, record)) return { cur };
      const later: Watched = { ...cur, submittedAt: now() };
      await session.set(key, later);
      return { cur: later, later };
    });
    if (found.later) await deps.store.set(sealedName(s.network), found.later).catch(() => undefined);
    return found.cur;
  }).catch(() => undefined);
  return shown(cur?.txHash === s.txHash ? cur : record);
}

/** Whether the watch holds `record` still as `writeAhead` wrote it: maybe sent, and not sent again since (put back after a lock isn't). */
function writtenAhead(cur: Watched | undefined, record: Watched): cur is Watched {
  return (
    cur?.txHash === record.txHash &&
    !!cur.maybeSent &&
    cur.submittedAt === record.submittedAt &&
    (cur.resentAt === record.resentAt || !!cur.restored)
  );
}

/**
 * The settle going on for each watched transaction, by the worker's session
 * storage: Home's pages and the worker's runs ask at once, and share it, so
 * one transaction is never sent again, or let go, twice at the same time.
 */
const settling = new WeakMap<Area, Map<string, Promise<Watched | undefined>>>();

/**
 * Looks for the watched transaction on chain, and settles it when it can:
 * seen, sent again and taken, or let go. Returns it as it now stands, or
 * what the watch holds instead, if anything.
 */
function settle(deps: PendingDeps, w: Watched, look = false): Promise<Watched | undefined> {
  let going = settling.get(deps.session);
  if (!going) settling.set(deps.session, (going = new Map()));
  const id = `${w.network}.${w.txHash}`;
  const run = going.get(id) ?? settleNow(deps, w, look).finally(() => going.delete(id));
  going.set(id, run);
  return run;
}

/** `look`: it's only looked for, never sent again (the unlock's run). */
async function settleNow(deps: PendingDeps, w: Watched, look: boolean): Promise<Watched | undefined> {
  const { wallet, session, now } = deps;
  const koios = deps.koios(w.network);
  // Koios is asked outside the lock, so the watch can change meanwhile (a
  // payment sent, another's settle): each change reads it again first, and
  // is made only while it still holds `w` (final review money-submit-3). Its
  // sealed copy goes once it's settled: seen, let go, or taken.
  const key = pendingKey(w.network);
  const turn = <T>(task: () => Promise<T>) => inTurn(deps, w.network, task);
  const ours = (cur: Watched | undefined): cur is Watched => cur?.txHash === w.txHash;
  const unchanged = (cur: Watched | undefined) =>
    ours(cur) && cur.maybeSent === w.maybeSent && cur.submittedAt === w.submittedAt && cur.resentAt === w.resentAt;

  const confirmations = (await koios.txStatus([w.txHash])).get(w.txHash) ?? null;
  if (confirmations !== null) {
    const { maybeSent: _maybeSent, ...seen } = { ...w, confirmations };
    await turn(async () => {
      await wallet.withKeys(async () => {
        if (ours(await session.get<Watched>(key))) await session.remove(key);
        // The next balance reading should see the new UTxOs.
        await forgetReading(session, w);
        await dropKept(session, w);
      });
      await unseal(deps, w);
    });
    if (w.summary) await deps.activity?.sent(w.network, shown(seen), w.summary).catch(() => undefined);
    return seen;
  }

  const age = now() - w.submittedAt;
  // Past its slot by the chain's clock, not this device's, which set the slot.
  const expired =
    w.invalidHereafter !== undefined && age > VALID_FOR_MS && (await koios.tipSlot()) > w.invalidHereafter + EXPIRED_AFTER_SLOTS;
  // Not while it waits in a mempool: it may still land (independent review L1). Nor
  // put back after a lock and not sent again since (independent review L9).
  const unseen =
    !expired && w.maybeSent && w.invalidHereafter === undefined && age > UNSEEN_AFTER_MS && !w.inMempool && !w.restored;
  if (expired || unseen) {
    const held = await turn(async () => {
      const held = await wallet.withKeys(async () => {
        const cur = await session.get<Watched>(key);
        // Past its slot, it can't land whatever happened meanwhile; one sent again and taken meanwhile isn't unseen.
        if (expired ? !ours(cur) : !unchanged(cur)) return { cur };
        if (w.inputs) await forgetSpent(session, w.inputs);
        await session.remove(key);
        await forgetReading(session, w);
        await dropKept(session, w);
        return undefined;
      });
      if (!held || expired) await unseal(deps, w);
      return held;
    });
    if (held) return held.cur;
    if (w.contract) await forgetContractView(deps, w.network);
    return { ...w, dropped: expired ? "expired" : "unseen" };
  }

  if (!look && w.maybeSent && w.txCbor && now() - (w.resentAt ?? w.submittedAt) >= RESEND_MS) {
    const { restored: _restored, ...resent } = w;
    let current: Watched = { ...resent, resentAt: now() };
    let taken = false;
    // Each time it goes again is the wallet's send, when that may be the one the network takes: Lovejoin's
    // withdraws keep away from it (lastSpentAt) as from any other, never in the same run (independent review L8).
    await wallet.withKeys(() => rememberSpent(session, w.network, hexBytes(w.txCbor!), now()));
    try {
      if ((await koios.submitTx(hexBytes(w.txCbor))) === w.txHash) {
        // Taken: an ordinary sent transaction from here on.
        const { maybeSent: _maybeSent, txCbor: _txCbor, summary, kept: _kept, ...sent } = current;
        current = { ...sent, submittedAt: now() };
        taken = true;
        await wallet.withKeys(() => dropKept(session, w));
        if (summary) await deps.activity?.sent(w.network, shown(current), summary).catch(() => undefined);
      }
    } catch (e) {
      // Refused as spent: most likely this very one, on its way. Unanswered again: keep watching.
      if (e instanceof SpentInputError) current = await mempool(koios, current);
    }
    return turn(async () => {
      const after = await wallet.withKeys(async () => {
        const cur = await session.get<Watched>(key);
        if (unchanged(cur)) {
          await session.set(key, current);
          return current;
        }
        if (!taken) return cur;
        // Taken after the watch let it go (unseen meanwhile): on its way after
        // all, so its UTxOs are held back again, and it's watched if nothing
        // else is.
        await rememberSpent(session, w.network, hexBytes(w.txCbor!));
        if (cur && !ours(cur)) return cur;
        await session.set(key, current);
        return current;
      });
      if (taken) await unseal(deps, w);
      // Sealed as it now waits, so a lock never lets one go on age that may still land.
      else if (after === current && !!current.inMempool !== !!w.inMempool) await seal(deps, current);
      return after;
    });
  }

  // A private one Koios took: watched for 10 minutes.
  if (!w.maybeSent && w.invalidHereafter === undefined && age > WATCH_MS) {
    await turn(() =>
      wallet.withKeys(async () => {
        if (unchanged(await session.get<Watched>(key))) await session.remove(key);
      }),
    );
  }
  return w;
}

/**
 * `w`, sent again and refused as spending what's spent: whether it waits in
 * a mempool (independent review L1). The node answers so for a transaction
 * it has already. While the chain doesn't show anything it spends as spent
 * (utxo_info, of what Koios already saw in the submit), it may still land:
 * it's held back, and a private one isn't let go on age. Once something it
 * spends shows spent, and tx_status doesn't know it, another spent it: the
 * 20 minutes unseen apply again. Koios not answering counts as not shown.
 */
async function mempool(koios: Koios, w: Watched): Promise<Watched> {
  const rows = (await koios.utxoInfo(w.inputs ?? []).catch(() => undefined)) as Array<KoiosUtxo & { is_spent?: boolean }> | undefined;
  if (!rows?.some((u) => u.is_spent)) return { ...w, inMempool: true };
  const { inMempool: _inMempool, ...rest } = w;
  return rest;
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
  // Put back first if a lock cleared it: nothing is built beside it after an unlock either.
  const w = await watchedOn(deps, network);
  if (!unsettled(w) || w.network !== network) return;
  await settle(deps, w);
  // As the watch stands now: another may have gone maybe sent meanwhile.
  if (unsettled(await deps.wallet.withKeys(() => deps.session.get<Watched>(pendingKey(network))))) throw new Error(MAYBE_SENT_WAIT);
}

export class PendingService {
  constructor(private readonly deps: PendingDeps) {
    if (deps.alarm) alarms.set(deps.session, deps.alarm);
  }

  /** The watched transaction on `network` as it now stands, or null. Clears it once it's settled. */
  async pending(network: NetworkName): Promise<PendingTx | null> {
    const watched = await watchedOn(this.deps, network);
    const settled = watched && (await settle(this.deps, watched));
    return settled ? shown(settled) : null;
  }

  /**
   * Keeps a maybe-sent transaction on `network` going while the wallet shows
   * another network, or no page at all (the worker's runs): looked for, and
   * sent again now and then. Returns whether it's still maybe sent: Koios
   * not answering says nothing of that, so it still is, and the runs keep
   * the alarm for it (independent review L3). One Koios took is left for
   * Home, which asks when it opens.
   */
  async watch(network: NetworkName, unlock = false): Promise<boolean> {
    const watched = await watchedOn(this.deps, network);
    if (!watched?.maybeSent) return false;
    // The unlock's run only looks: nothing goes out the moment the wallet unlocks (independent review L9).
    return settle(this.deps, watched, unlock).then(unsettled, () => true);
  }
}
