// Lovejoin, the mixer, in the worker (roadmap chunk 16).
//
// A private session's spare ADA goes through Lovejoin on its way back.
// sessions.ts asks here for the chain: WebAssembly builds all of it before
// any of it is sent (the deposit, each box fanned out, then the return),
// measured against the deployed scripts and signed with the session's key.
// sessions.ts sends it in order, each transaction on the one before's change.
//
// The boxes come back later, each on its own, after a random delay (the
// settings' range). Then, on the minute's alarm while the wallet is unlocked,
// a box of ours in the pool is withdrawn into a fresh register, paid from
// itself, with giveme.my's collateral: nothing on its way back names the
// session or an account, though Koios and giveme.my see this device send
// both ends, and a box hides only among the fan-out's leaves whose owners
// also bring them back into a Seedelf (privacy review §2.6, §5.3).
// Never the moment the wallet unlocks (privacy review §3.1): a box that came
// due while it was locked waits a fresh draw inside the stretch the unlock
// keeps it open (UNLOCK_WAIT_MS), once, so a short unlock never holds it for
// good. Nor in a run that sent anything else, nor right after the wallet's
// own send (QUIET_AFTER_SEND_MS). One box a run: others due at the same time
// wait a fresh short delay each (WITHDRAW_SPREAD_MS), so a wallet locked for
// hours doesn't send them all in one burst. The box that goes is one that
// has waited the delay's least since a mix last moved it, one someone else's
// mix has moved since the wallet's chain left it if there is one (§3.6),
// and then the one that has waited longest in the pool.
// Boxes aren't remembered, they're found: other people's mixes
// move them, and the Seedelf key's check finds them wherever they are, after a
// restore too. What's kept, sealed (`lovejoin.<network>`), is the due times
// and each chain the wallet sends: its deposit, its mixes and its leaves,
// recorded before any of it is sent.
//
// A chain is sent over many blocks, and only while the wallet is unlocked; a
// lock, a closed browser or an update wipes what's left of it (it waits in
// chrome.storage.session). A box that one of the wallet's chains made and
// hadn't finished mixing is still traceable to where it came from, so it
// never comes back by itself: it's shown as not mixed yet, for Mix my boxes
// again. A chain cut short isn't sent on later: its later mixes were built
// with pool boxes other people's mixes may have spent by then, so it would
// stop at the first of them, while mixing again draws fresh ones. While any
// chain is being sent, no box is withdrawn at all.
//
// Before a chain is used, Koios's Ogmios measures its first mix, given the
// unsent deposit as extra UTxOs: the check that the wallet's evaluator costs
// scripts as the network does (a hard fork can change that). If it doesn't,
// the chain doesn't start: a session's return comes back directly instead,
// and says why.
//
// The Lovejoin tile mixes too, without a session to return: from the private
// balance through a one-time account (sessions.ts's mix sessions), or from
// the public account straight in (here): its deposit and mixes, paid by the
// account and put up against its collateral, the change left in it.
//
// Mix my boxes again fans the wallet's boxes in the pool out once more (a
// chain cut short, or boxes nobody has mixed since), with no deposit, paid
// from the private balance through a mix session. While one runs, no box is
// withdrawn: its chain spends them. Once its first mix is in, those boxes
// wait again, each a fresh delay. A box a mix from the public account put in
// is the account's, which paid for that mix in the open: paying for its
// mixes from the private balance would tie the two, so it's left out unless
// the user asks, and the public account pays to mix it again instead, no
// new tie (publicAgainBuild, privacy review §2.10).
//
// Koios requests: one pool read and one evaluate for a chain; one pool read
// at each unlock, only on a network where the wallet has something open in
// Lovejoin: boxes on their way back, a chain, boxes not mixed yet (a
// restored wallet finds its boxes when the Lovejoin tile opens, and opening
// it with nothing there keeps no record, privacy review §2.18); one at a
// swap's review, when its return would go through Lovejoin, used again for
// five minutes (room, §2.7); a withdraw is giveme.my plus one submit.

import type { LovejoinDelay, LovejoinDepth } from "../shared/preferences";
import { lovejoinOn, NETWORKS, type NetworkName } from "../networks";
import type {
  LeftOutUtxo,
  LovejoinFunding,
  LovejoinHeld,
  LovejoinPublicSummary,
  LovejoinStatus,
  PendingTx,
  TokenQuantity,
} from "../shared/rpc";
import { nothingInAccount, readAccount } from "./account";
import { txInputs } from "./cbor";
import { KoiosBusyError, KoiosError, SpentInputError, type Koios, type KoiosUtxo } from "./koios";
import { settleMaybeSent, watchSent } from "./pending";
import type { PreferencesService } from "./preferences";
import type { PrivateStore } from "./private-store";
import type { ScriptSpendDeps } from "./script-spend";
import {
  lastSpentAt,
  outpoint,
  rememberSpent,
  reservationOf,
  reservations,
  reservedSet,
  SESSION_RESERVED_PREFIX,
  SPENT_KEEP_MS,
  spentSet,
  unspent,
  type Reservation,
} from "./spent";
import { SESSION_BALANCES_PREFIX } from "./wallet";

/** chrome.storage.session: a mix from the public account, built and signed, waiting for Send. */
export const SESSION_LOVEJOIN_PUBLIC = "seedelf.lovejoin.public";
/** chrome.storage.session: a mix from the public account being sent, a window at a time, per network: `seedelf.lovejoin.sending.<network>`. */
export const SESSION_LOVEJOIN_SENDING = "seedelf.lovejoin.sending.";

/** A built mix is only sent within this long; after that, build again. */
const BUILT_TTL_MS = 10 * 60_000;

/** A mix from the public account is built or sent while the last one from it is still being sent. */
const PUBLIC_STILL_SENDING = "Your last mix from the public account is still being sent. Wait for it to finish.";
/** The mix kept for Send isn't the one asked for, or something took its place since. */
const NOT_READY = "That mix isn't ready to send. Review it again.";
/** A mix from the public account is built while a transaction of the last one may have gone through, unseen yet. */
const PUBLIC_MAYBE_WAIT =
  "Your last mix from the public account may have gone through: Koios didn't answer when one of its transactions was sent, and the network hasn't shown it yet. The wallet looks for it first. Try again in a few minutes.";

/** A chained transaction Koios didn't answer, or asked to slow down for: tried again this many times, waiting CHAIN_BUSY_MS longer each time. */
export const CHAIN_RETRIES = 4;
export const CHAIN_BUSY_MS = 10_000;
/**
 * A chained transaction refused as spending what's already spent: tried
 * again (and looked for on chain) every CHAIN_SPENT_MS, CHAIN_SPENT_TRIES
 * times, about three minutes, several blocks. Either Koios hasn't seen its
 * parent yet, or it's this very transaction, sent by a try Koios never
 * answered and waiting in the mempool for a block (found on preprod: a
 * 49-transaction chain stopped at its 7th, which landed 15 s later).
 */
export const CHAIN_SPENT_MS = 10_000;
export const CHAIN_SPENT_TRIES = 18;

/** How one chained transaction's tries have gone so far. */
export interface ChainTries {
  /** Koios didn't answer, or asked to slow down: the transaction may have gone in. */
  busy: number;
  /** Refused as spending what's spent. */
  spent: number;
  /**
   * It may have gone in before these tries: it was sent already and hasn't
   * landed, or a send of it began and never finished (a worker stopped
   * during a back-off).
   */
  maybeSent?: boolean;
}

/**
 * How long to wait before sending a chain's transaction `i` again after `e`
 * (counting it in `tries`), or undefined when sending it again can't help.
 * Koios didn't answer, or hasn't seen a parent yet, or the transaction went
 * in already: the same transaction again, a little later, is safe, and the
 * sender looks for it on chain each time. The first transaction's inputs are
 * all on chain, so a spent one is spent, unless a try Koios didn't answer
 * sent it.
 */
export function chainRetryMs(i: number, tries: ChainTries, e: unknown): number | undefined {
  if (e instanceof KoiosBusyError) {
    if (tries.busy >= CHAIN_RETRIES) return undefined;
    tries.busy++;
    return CHAIN_BUSY_MS * tries.busy;
  }
  if (e instanceof SpentInputError && (i > 0 || tries.busy > 0 || tries.maybeSent)) {
    if (tries.spent >= CHAIN_SPENT_TRIES) return undefined;
    tries.spent++;
    return CHAIN_SPENT_MS;
  }
  return undefined;
}

/**
 * A chained transaction refused as spending what's spent while Koios
 * couldn't say whether it's on chain (tx_status didn't answer). Sent before,
 * it may be this very transaction, landed or waiting in a mempool (mayBeIn).
 */
export class SpentUnread extends SpentInputError {}

/**
 * After a submit of `txHash` refused as spending what's spent (`e`): returns
 * when it's on chain after all (sent already, by a Send pressed twice or a
 * try that got through), else throws `e`, or SpentUnread when Koios couldn't
 * say.
 */
export async function sentAlready(koios: Koios, txHash: string, e: SpentInputError): Promise<void> {
  const status = await koios.txStatus([txHash]).catch(() => undefined);
  if (!status) throw new SpentUnread(e.message);
  if (status.get(txHash) == null) throw e;
}

/**
 * Whether a send of a chain's transaction that ended in `e` may have gone in
 * after all: refused as spending what's spent while Koios couldn't say
 * whether it's on chain (SpentUnread), when it was sent before or a try
 * Koios didn't answer may have sent it. Then it's taken as sent, never
 * counted against CHAIN_SPENT_TRIES: the chain goes back to looking for it
 * on chain, and sends it again after CHAIN_RESEND_MS, however long tx_status
 * is down (final review lovejoin-6). Only a read that says it isn't on chain
 * counts, so one that can't land still stops its chain.
 */
export function mayBeIn(tries: ChainTries, e: unknown): boolean {
  return e instanceof SpentUnread && (tries.maybeSent === true || tries.busy > 0);
}

/**
 * The most transactions of a chain waiting in the mempool at once. A block
 * may use 20 billion CPU steps in scripts and a mix uses about 5.8 billion
 * (5.73 measured on preprod, 5.80 on mainnet), so a block takes 3 mixes, and
 * a node's mempool holds about two blocks' worth. A submit past that waits
 * for a block to make room, longer than Koios answers (found on preprod: a
 * long chain's submits timed out from its 7th on). Four leaves room for
 * other people's transactions; fewer would let a block take fewer of ours,
 * and make every chain longer. On mainnet other people's scripts share the
 * blocks too, so a long chain takes longer there.
 */
export const CHAIN_WINDOW = 4;
/** How often a chain being sent looks for its transactions on chain. */
export const CHAIN_POLL_MS = 5_000;
/**
 * A chain's oldest transaction in the mempool that hasn't landed after this
 * long (several blocks) is sent again: a node may have dropped it, and with
 * it every transaction of the chain after it, so they all go again, in order
 * (independent review L25). The ledger takes each once.
 */
export const CHAIN_RESEND_MS = 3 * 60_000;
/**
 * The most one call sends a chain for: about a block. The rest goes on at
 * the next call (the runner's step, the page, the alarm), so no request runs
 * near Chrome's five minutes.
 */
export const CHAIN_PUMP_MS = 20_000;

/** A chain being sent, kept in chrome.storage.session between calls. */
export interface ChainProgress {
  txs: LovejoinChain["txs"];
  /** The next to send. */
  next: number;
  /** Sent, and not seen on chain yet. */
  flying: string[];
  /** When each of `flying` was last sent (ms), in its order. */
  sentAt?: number[];
  /**
   * The transaction a send began for and hadn't finished when this was
   * saved: it may be in the mempool already, if the worker stopped partway
   * (Chrome stops an idle worker during a long back-off).
   */
  sending?: number;
  /**
   * The next transaction, refused as spending what's spent, for which those
   * in the mempool were sent again (pumpChain): refused once more, the chain
   * stops.
   */
  resentFor?: number;
}

/**
 * Sends more of a chain, in order, with at most CHAIN_WINDOW of it waiting in
 * the mempool: it sends while there's room, looks for what it sent on chain
 * every CHAIN_POLL_MS, and returns true once all of it is sent, or false
 * after about `budgetMs`, the rest for the next call. `send` sends transaction
 * `i` (its retries included; `maybeSent`: it may be in the mempool already),
 * `onChain` says which hashes are on chain, and `save` keeps the progress
 * after each change. A read of what's on chain that Koios doesn't answer sees
 * nothing yet; once the oldest in the mempool has waited CHAIN_RESEND_MS,
 * every one there is sent again, in order. A resend refused as spent while
 * Koios still can't say is no failure: `send` returns (mayBeIn), and it's
 * looked for again. A transaction refused as spending what's spent, after
 * its tries, while those it builds on are still in the mempool as far as the
 * wallet knows, is no failure yet either: a node dropped them (the one before
 * them landed, or a block was rolled back), so they go again, in order, and
 * it goes once more at the next call, which stays well short of Chrome's
 * five minutes (independent review L25).
 */
export async function pumpChain(
  chain: ChainProgress,
  io: {
    send(i: number, maybeSent: boolean): Promise<void>;
    onChain(hashes: string[]): Promise<Set<string>>;
    save(): Promise<void>;
    sleep(ms: number): Promise<void>;
    now(): number;
  },
  budgetMs: number,
): Promise<boolean> {
  // A chain saved before sends were timed counts from now.
  if (chain.sentAt?.length !== chain.flying.length) chain.sentAt = chain.flying.map(() => io.now());
  const sentAt = () => chain.sentAt!;
  // Marked before the submit, so a send cut short is known to maybe be in.
  const send = async (i: number, again: boolean) => {
    const maybeSent = again || chain.sending === i;
    chain.sending = i;
    await io.save();
    await io.send(i, maybeSent);
    delete chain.sending;
  };
  // Every one in the mempool, sent again in order: each spends the change of
  // the one before, so a node that dropped one dropped every one after it.
  const resend = async () => {
    for (const [k, hash] of [...chain.flying].entries()) {
      const at = chain.txs.findIndex((t) => t.txHash === hash);
      if (at < 0) continue;
      await send(at, true);
      sentAt()[k] = io.now();
      await io.save();
    }
  };
  for (let polls = Math.ceil(budgetMs / CHAIN_POLL_MS); ; polls--) {
    if (chain.flying.length >= CHAIN_WINDOW) {
      const on = await io.onChain(chain.flying).catch((e: unknown) => {
        if (e instanceof KoiosError) return new Set<string>();
        throw e;
      });
      if (on.size) {
        chain.sentAt = sentAt().filter((_, k) => !on.has(chain.flying[k]!));
        chain.flying = chain.flying.filter((h) => !on.has(h));
        await io.save();
      } else if (io.now() - sentAt()[0]! >= CHAIN_RESEND_MS) {
        await resend();
      }
    }
    while (chain.next < chain.txs.length && chain.flying.length < CHAIN_WINDOW) {
      try {
        await send(chain.next, false);
      } catch (e) {
        if (!(e instanceof SpentInputError) || !chain.flying.length || chain.resentFor === chain.next) throw e;
        chain.resentFor = chain.next;
        await resend();
        return false;
      }
      chain.flying.push(chain.txs[chain.next]!.txHash);
      sentAt().push(io.now());
      chain.next++;
      await io.save();
    }
    if (chain.next >= chain.txs.length) return true;
    if (polls <= 0) return false;
    await io.sleep(CHAIN_POLL_MS);
  }
}

/**
 * A chain's progress isn't where it waits anymore, or another chain's is
 * there in its place: a lock wiped it while a send of it waited (the wallet
 * may be unlocked again since). Nothing more of it is sent, and nothing of it
 * is written back; its record says it was cut (independent review L14).
 */
export class ChainGone extends Error {
  constructor() {
    super(CHAIN_CUT);
  }
}

/** The network measured a chain's scripts differently from the wallet: the chain doesn't start. */
export class LovejoinSkipped extends Error {
  constructor(readonly reason: string) {
    super(`Lovejoin was left out: ${reason}.`);
  }
}

/**
 * The network doesn't know an input a chain's first mix spends: the pool
 * read was behind (a Koios backend lagging, or a box someone mixed since).
 * `unknown`: the inputs it names, when it does.
 */
class StalePool extends Error {
  constructor(readonly unknown: string[]) {
    super("Lovejoin's pool changed while the wallet read it.");
  }
}

/** How many times a chain is built again, from a fresh pool read, when the network doesn't know a box it drew. */
export const STALE_POOL_TRIES = 2;

/**
 * The inputs Ogmios's answer says it doesn't know (`txhash#index`): its
 * error 3117, or 3110 for a redeemer on one. Undefined when it says
 * nothing of the kind; empty when it doesn't name them.
 */
export function unknownInputs(answer: unknown): string[] | undefined {
  type Failure = { code?: unknown; data?: unknown };
  const error = (answer as { error?: Failure } | null)?.error;
  if (!error || typeof error !== "object") return undefined;
  const items = (Array.isArray(error.data) ? error.data : []) as Array<{ error?: Failure } | null>;
  const stale = error.code === 3117 || items.some((i) => i?.error?.code === 3110 || i?.error?.code === 3117);
  if (!stale) return undefined;
  const named = [error.data, ...items.map((i) => i?.error?.data)].flatMap((d) => {
    const refs = (d as { unknownOutputReferences?: unknown } | null)?.unknownOutputReferences;
    return Array.isArray(refs) ? (refs as Array<{ transaction?: { id?: unknown }; index?: unknown }>) : [];
  });
  return named.flatMap((r) => (typeof r.transaction?.id === "string" && Number.isInteger(r.index) ? [`${r.transaction.id}#${r.index}`] : []));
}

// Where Lovejoin sits on each network (its `mix_box` hash) and the pool's
// floor come from networks.ts (`lovejoin`), which the UI reads too.

/** Every box holds exactly this. */
export const LOVEJOIN_DENOM = 10_000_000n;

/** A chain as WebAssembly builds it (`lovejoin::ChainResult`). */
export interface LovejoinChain {
  txs: Array<{ kind: "deposit" | "mix" | "back"; txCbor: string; txHash: string; fee: string }>;
  boxes: number;
  depth: number;
  /** Every fee of the chain, the return's too. */
  fees: string;
  /**
   * What the return brings back at once: the change, the collateral and the
   * token UTxOs' ADA, less its fee. A public account's chain has no return:
   * the change that stays in the account.
   */
  returned: string;
  /** The tokens it brings back with them. */
  tokens: TokenQuantity[];
  /** How many of the funding's Seedelf UTxOs the return merged into. */
  merged: number;
  leaves: Array<{ txHash: string; txIndex: number }>;
  /** The session's UTxOs the return leaves at its account (SessionBackSummary's `leftOut`). */
  leftOut: LeftOutUtxo[];
  /** Why nothing was built: the pool's boxes are too few to mix with (a session's chain only). */
  skipped?: string;
}

/** What the review shows before a chain is built (`lovejoin::PlanResult`). */
export interface LovejoinPlan {
  boxes: number;
  spare: string;
  mixes: number;
  mixFees: string;
}

interface Schedule {
  /** When each box that's on its way back is due, in ms. */
  due: number[];
  /** Each chain the wallet sent here that may still hold a box, recorded before its first transaction was. */
  chains: ChainRecord[];
  /** How many of the wallet's boxes the last pool read found not mixed yet, for Home. */
  notMixed?: number;
  /** A withdraw whose submit Koios didn't answer: it may have gone through, and is looked for before another is built. */
  withdrawing?: Withdrawing;
  /** What put a due time off, by the time (ms): so none is put off for good. */
  marks?: Record<string, DueMark>;
  /**
   * The leaves of chains whose records went (RECORD_KEEP_MS), `txhash#index`,
   * and whose chain made each (chainOwner): kept while the box is still
   * there, unmoved, so the box brought back is one someone else's mix has
   * moved since (backOrder, privacy review §3.6).
   */
  leaves?: Record<string, string>;
}

/** Why a due time was drawn again. */
interface DueMark {
  /** At an unlock: a later unlock doesn't draw it again, so it goes at the next run (privacy review §3.1). */
  unlock?: true;
  /** How often the wallet's own sends pushed it: after QUIET_PUSHES, it goes anyway. */
  pushes?: number;
}

/** A withdraw that may have gone through, signed as it was sent, and when it was sent first and last (ms). */
interface Withdrawing {
  txHash: string;
  txCbor: string;
  lovelace: string;
  fee: string;
  at: number;
  sentAt: number;
}

/** Koios didn't answer a withdraw's submit: it may have gone through. */
class WithdrawMaybeSent extends Error {
  constructor() {
    super("Koios didn't answer when the box was sent back, so it may have gone through. The wallet looks for it before bringing back another.");
  }
}

/** A chain through Lovejoin, as the sealed schedule keeps it. */
interface ChainRecord {
  /** Its last transaction's hash: the return, or a public mix's last mix. */
  id: string;
  /** A session's return or mix (its index); none for a mix from the public account. */
  session?: number;
  /** Where it waits while it's being sent (chrome.storage.session). */
  progress: string;
  deposit?: string;
  mixes: string[];
  /** Where the wallet's boxes end up, mixed all the way. */
  leaves: OutRef[];
  boxes: number;
  /** The wallet's boxes mixed again, with no deposit. */
  again?: boolean;
  total: number;
  sent: number;
  at: number;
  /** Its boxes' withdraws are set: its deposit is in, or, mixing again, its first mix. */
  scheduled?: boolean;
  /** All sent. */
  done?: boolean;
  /** Why it stopped partway. */
  stopped?: string;
  /** When it was all sent, or stopped. */
  ended?: number;
  /**
   * How many of its boxes it left not mixed yet, whose due times went: they
   * never come back by themselves (unschedule). Counted so none goes twice.
   */
  unscheduled?: number;
  /**
   * A mix from the public account that stopped at a transaction that may
   * have gone through: Koios didn't answer when it was sent (independent
   * review L5). Its index, hash, what it spends, and when (ms). Until it's
   * settled (publicUnsettled), no other mix from the account is built.
   */
  maybe?: { index: number; txHash: string; inputs: string[]; at: number };
}

/** Why a chain whose progress is gone stopped: nothing is sending the rest. */
export const CHAIN_CUT = "The wallet locked, or the browser closed, while its chain was being sent.";

/**
 * A chain's record is kept this long after it ended, even when the pool
 * lists no box of it: a transaction of it a node dropped after the wallet
 * sent it leaves a box unmixed, and a listing that's behind (a Koios backend
 * lagging) may not show that box yet. The listing is read with what the
 * wallet spent (sortOut), so a box a sent transaction spends keeps its record
 * however long it's hidden.
 */
const RECORD_KEEP_MS = SPENT_KEEP_MS + 60 * 60_000;

interface KeptPublic extends LovejoinPublicSummary {
  chain: LovejoinChain["txs"];
  leaves: OutRef[];
  builtAt: number;
}

/** The public account's own boxes mixed again, as a chain's review has them. */
type PublicAgain = LovejoinPublicSummary & { again: true };

/** A public mix being sent: its chain, how far it has got, and why it stopped, if it did. */
interface SendingPublic extends ChainProgress {
  network: NetworkName;
  boxes: number;
  stopped?: string;
  /** It stopped at this transaction, which may have gone through (ChainRecord `maybe`). */
  maybe?: number;
}

/** What a chain's transaction `i` is called, where a stop says which went and which may have. */
const stepName = (txs: LovejoinChain["txs"], i: number) =>
  txs[i]?.kind === "deposit" ? "its deposit" : `its transaction ${i + 1} of ${txs.length}`;

export interface LovejoinDeps extends ScriptSpendDeps {
  store: PrivateStore;
  preferences: PreferencesService;
  /** In [0, 1): the delays' draw, secureRandom unless a test pins it. */
  random?: () => number;
  /** Whether the wallet's boxes are being mixed again (sessions.ts): no box is withdrawn meanwhile. */
  mixingAgain?: (network: NetworkName) => Promise<boolean>;
  /** The sessions alarm (chrome.alarms), which sends the rest of a public mix while the wallet is unlocked. */
  alarm?: { start(): Promise<void> };
}

const HOUR = 3_600_000;

/**
 * Boxes due at once come back one a run; each of the others waits again,
 * somewhere in this range from then (ms), so no two go out together.
 */
export const WITHDRAW_SPREAD_MS: [number, number] = [5 * 60_000, 60 * 60_000];

/**
 * Nothing goes out the moment the wallet unlocks (privacy review §3.1): a
 * box that came due while it was locked, or a swap's step found then, waits
 * a fresh draw in this range from the unlock (ms), never past the auto-lock
 * less its low end, so it still goes in the stretch the unlock keeps the
 * wallet open (unlockWait).
 */
export const UNLOCK_WAIT_MS: [number, number] = [2 * 60_000, 20 * 60_000];

/**
 * No box goes back within this long of the wallet's own last send, on
 * either network (what spent.ts remembers): a withdraw minutes after a
 * payment says both are one owner's. It's pushed a fresh QUIET_PUSH_MS
 * instead, at most QUIET_PUSHES times, and then goes anyway, so none waits
 * for good.
 */
export const QUIET_AFTER_SEND_MS = 5 * 60_000;
export const QUIET_PUSH_MS: [number, number] = [3 * 60_000, 10 * 60_000];
export const QUIET_PUSHES = 3;

/** A draw in `range` (ms). */
const within = ([low, high]: [number, number], random: () => number) => Math.round(low + (high - low) * random());

/**
 * A fresh wait from an unlock (ms): in UNLOCK_WAIT_MS, and never past the
 * auto-lock (`lockAfterMs`) less its low end, since the unlock keeps the
 * wallet open at least that long. At the shortest auto-lock it's the low
 * end: a box then goes at the first unlock that lasts it, or the next run
 * after a later one (DueMark `unlock`).
 */
export function unlockWait(lockAfterMs: number, random: () => number = secureRandom): number {
  const [low, cap] = UNLOCK_WAIT_MS;
  return within([low, Math.max(low, Math.min(cap, lockAfterMs - low))], random);
}

const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

/** The mixes one box goes through, `depth` waves deep and three wide. */
export const mixesPerBox = (depth: number) => (3 ** depth - 1) / 2;

/**
 * A uniform draw in [0, 1) from the browser's secure random source, with a
 * double's whole 53 bits. A box's delay is what keeps its withdraw from being
 * matched to its deposit by time, so it isn't drawn with Math.random, whose
 * generator can be worked out from a few of its outputs.
 */
export function secureRandom(): number {
  const [high, low] = crypto.getRandomValues(new Uint32Array(2));
  return ((high! >>> 5) * 2 ** 26 + (low! >>> 6)) / 2 ** 53;
}

/** A delay range's bounds, in hours. */
export function delayHours(delay: LovejoinDelay): [number, number] {
  const [low, high] = delay.split("-").map(Number);
  return [low!, high!];
}

/** The most boxes one mix from the tile takes. */
export const MAX_MIX_BOXES = 10;

/**
 * The most mixes one chain makes, any chain: ten boxes three waves deep, the
 * most a mix from the tile makes (about 15 s to build, and 44 blocks at
 * least to send). Mixing boxes again, and a return, take as many as fit
 * under it, the pool allowing.
 */
export const MAX_CHAIN_MIXES = MAX_MIX_BOXES * mixesPerBox(3);

/**
 * The most boxes one deposit makes: each is an output of about 150 bytes,
 * and a transaction holds 16 KiB (measured: 106 boxes fit with one input,
 * 108 don't). Room is left for a session holding a few dozen UTxOs. Past
 * it, a return's spare ADA comes back with its change (final review
 * lovejoin-5). Mixing again has no deposit.
 */
export const MAX_DEPOSIT_BOXES = 96;

/** The most boxes one chain with a deposit takes at `depth`: MAX_CHAIN_MIXES' worth, and what one deposit makes. */
export const chainBoxes = (depth: number) => Math.min(MAX_DEPOSIT_BOXES, Math.floor(MAX_CHAIN_MIXES / mixesPerBox(depth)));

/** A box in the pool, or anywhere: where it sits. */
export interface OutRef {
  txHash: string;
  txIndex: number;
}

const ref = (r: OutRef) => `${r.txHash}#${r.txIndex}`;

/** The pool as WebAssembly reads it (`lovejoin::OwnedResult`): only real boxes count, never junk left at mix_box. */
interface Split {
  /** Every UTxO at mix_box, less any a sent transaction of ours spends. */
  pool: KoiosUtxo[];
  /** The wallet's boxes in it. */
  owned: OutRef[];
  /** The real boxes that aren't the wallet's: what a mix draws from. */
  others: OutRef[];
  /** What the wallet's other chains, built or being sent, will spend: never drawn again (spent.ts). */
  reserved: Set<string>;
}

/** `boxes` less those another chain of the wallet's will spend. */
const free = (boxes: OutRef[], reserved: Set<string>) => boxes.filter((b) => !reserved.has(ref(b)));

/** Whether two reservations spend the same. */
const sameInputs = (a: Reservation, b: Reservation) => a.inputs.length === b.inputs.length && a.inputs.every((o, k) => o === b.inputs[k]);

/** What a chain's reservation (spent.ts) and record are kept under: the session's, or the public account's. */
export const chainOwner = (index?: number) => (index === undefined ? "public" : `session.${index}`);

/**
 * The wallet's boxes that a chain of its own made short of its last mixes:
 * not mixed yet, so still traceable to where they went in.
 */
function unmixedOf(chains: ChainRecord[], owned: OutRef[]): OutRef[] {
  const made = new Set(chains.flatMap((c) => [...(c.deposit ? [c.deposit] : []), ...c.mixes]));
  const leaves = new Set(chains.flatMap((c) => c.leaves.map(ref)));
  return owned.filter((b) => made.has(b.txHash) && !leaves.has(ref(b)));
}

/**
 * How many boxes chain `c` stopped short of their last mix, as its record
 * says: a deposit's boxes whose last mix wasn't sent. None for mixing again,
 * where a box the chain didn't reach is as it was, maybe free to come back.
 */
function unfinished(c: ChainRecord): number {
  if (!c.deposit || !c.scheduled) return 0;
  const sent = new Set([c.deposit, ...c.mixes].slice(0, c.sent));
  return Math.max(0, c.boxes - c.leaves.filter((l) => sent.has(l.txHash)).length);
}

/**
 * Chain `c` left `count` more of its boxes not mixed yet. They never come
 * back by themselves, so as many due times go (the latest, never leaving
 * fewer than `keep`, the boxes that can come back), and Home counts only
 * boxes on their way back. `c` counts them, so none goes twice. A box that
 * later goes back through Lovejoin (Mix my boxes again) gets a time afresh.
 */
function unschedule(s: Schedule, c: ChainRecord, count: number, keep = 0): void {
  if (count <= 0) return;
  const drop = Math.max(0, Math.min(count, s.due.length - keep));
  s.due.sort((a, b) => a - b).splice(s.due.length - drop, drop);
  c.unscheduled = (c.unscheduled ?? 0) + count;
}

/** When box `b` will have waited the delay's least (`least`, in hours) since a mix last moved it (Koios's `block_time`, in seconds), in ms. */
const waitedAt = (b: OutRef, rows: Map<string, KoiosUtxo>, least: number) => (rows.get(ref(b))?.block_time ?? 0) * 1000 + least * HOUR;

/**
 * `boxes` in the order they're brought back. First those that have waited
 * the delay's least since a mix last moved them: a box a mix moved minutes
 * ago says which mix it came from. Then one someone else's mix has moved
 * since a chain of the wallet's left it, not one of `leaves`: a box still
 * where the wallet's own last mix put it points back at that chain, while
 * one moved since hides among that mix's boxes too (privacy review §3.6).
 * Then the one that has sat longest in the pool.
 */
function backOrder(boxes: OutRef[], rows: Map<string, KoiosUtxo>, leaves: Set<string>, least: number, now: number): OutRef[] {
  const since = (b: OutRef) => rows.get(ref(b))?.block_time ?? 0;
  const early = (b: OutRef) => (waitedAt(b, rows, least) > now ? 1 : 0);
  const own = (b: OutRef) => (leaves.has(ref(b)) ? 1 : 0);
  return [...boxes].sort((a, b) => early(a) - early(b) || own(a) - own(b) || since(a) - since(b) || ref(a).localeCompare(ref(b)));
}

/**
 * Whose chain put box `b` where it is (chainOwner): the public account's, or
 * a session's; undefined when none of the wallet's recorded chains did (a
 * restore, or someone else's mix moved it since).
 */
function originOf(b: OutRef, s: Schedule): string | undefined {
  const made = s.chains.find((c) => c.deposit === b.txHash || c.mixes.includes(b.txHash));
  return made ? chainOwner(made.session) : s.leaves?.[ref(b)];
}

/** The boxes of `boxes` a mix from the public account put where they are. */
const fromPublic = (boxes: OutRef[], s: Schedule) => boxes.filter((b) => originOf(b, s) === chainOwner());

/** Where the wallet's own chains left its boxes, mixed all the way: each recorded chain's leaves, and those kept after its record went. */
const ownLeaves = (s: Schedule) => new Set([...s.chains.flatMap((c) => c.leaves.map(ref)), ...Object.keys(s.leaves ?? {})]);

/** Moves due time `from` to `to`, with its marks, changed by `mark`. */
function moveDue(s: Schedule, from: number, to: number, mark?: (m: DueMark) => void): void {
  const at = s.due.indexOf(from);
  if (at < 0) return;
  s.due[at] = to;
  const m: DueMark = { ...s.marks?.[from] };
  if (s.marks) delete s.marks[from];
  mark?.(m);
  if (Object.keys(m).length) (s.marks ??= {})[to] = m;
}

/** Whether a schedule holds nothing: no record is kept for it (privacy review §2.18). */
const empty = (s: Schedule) =>
  !s.due.length && !s.chains.length && !s.notMixed && !s.withdrawing && !Object.keys(s.leaves ?? {}).length;

/** How long a swap's review uses a reading of the pool again (room): reviews in a row ask Koios once. */
export const POOL_ROOM_MS = 5 * 60_000;

/** A whole number of boxes, one to MAX_MIX_BOXES, or why not. */
export function checkBoxes(boxes: number): void {
  if (!Number.isInteger(boxes) || boxes < 1 || boxes > MAX_MIX_BOXES) {
    throw new Error(`Mix 1 to ${MAX_MIX_BOXES} boxes at a time.`);
  }
}

export class LovejoinService {
  /**
   * The networks whose public mix is being sent right now: the Send, the
   * page and the alarm never send one twice at once. Claimed before anything
   * is awaited (independent review L26).
   */
  private pumping = new Set<NetworkName>();
  /** One task at a time on each record (inTurn). */
  private turns = new Map<string, Promise<unknown>>();
  /**
   * The chains recorded whose progress is being put where they wait
   * (recordChain), by id: not cut meanwhile (cuts). In memory: a worker that
   * stops in between never put it there, and the chain was cut.
   */
  private starting = new Set<string>();
  /** The pool as a swap's review last read it, by network (room). */
  private rooms = new Map<NetworkName, { at: number; room: { others: number; free: number } }>();

  constructor(private readonly deps: LovejoinDeps) {}

  /**
   * How far the public account's mix being sent has got, if one is: sent so
   * far, of all, and why it stopped, if it did. `advance`: send more of it
   * first, if there's room (the Lovejoin page, while it's open).
   */
  async progress(
    network: NetworkName,
    advance = false,
  ): Promise<{ total: number; sent: number; stopped?: string; maybeSent?: true } | null> {
    if (advance) await this.pumpPublic(network, 0).catch(() => undefined);
    let s = await this.sendingOf(network);
    // Stopped at a transaction that may have gone through: looked for first, and said as it now stands.
    if (s?.maybe !== undefined) {
      await this.publicUnsettled(network).catch(() => true);
      s = await this.sendingOf(network);
    }
    const maybe = (m: unknown) => (m !== undefined ? { maybeSent: true as const } : {});
    if (s) return { total: s.txs.length, sent: s.next, ...(s.stopped ? { stopped: s.stopped } : {}), ...maybe(s.maybe) };
    // Its progress is gone: a lock, a closed browser or an update cut it, and its record says how far it got.
    if (!this.available(network)) return null;
    await this.cuts(network);
    const lastOf = async () => (await this.read(network)).chains.filter((c) => c.session === undefined).at(-1);
    let last = await lastOf();
    if (last?.maybe) {
      await this.publicUnsettled(network).catch(() => true);
      last = await lastOf();
    }
    return last?.stopped ? { total: last.total, sent: last.sent, stopped: last.stopped, ...maybe(last.maybe) } : null;
  }

  /** Whether Lovejoin is deployed on `network` (networks.ts: the UI's gate is the same). */
  available(network: NetworkName): boolean {
    return lovejoinOn(network);
  }

  async settings(): Promise<{ depth: LovejoinDepth; delay: LovejoinDelay }> {
    const p = await this.deps.preferences.get();
    return { depth: p.lovejoinDepth, delay: p.lovejoinDelay };
  }

  /** The boxes in the pool, less any a sent transaction of ours spends. */
  async pool(network: NetworkName): Promise<KoiosUtxo[]> {
    const { rows, spent } = await this.listing(network);
    return unspent(rows, spent);
  }

  /** The pool as Koios lists it (a read), and what the wallet's sent transactions spend. */
  private async listing(network: NetworkName): Promise<{ rows: KoiosUtxo[]; spent: Set<string> }> {
    const hash = NETWORKS[network].lovejoin?.mixBox;
    if (!hash) throw new Error("Lovejoin isn't on this network yet.");
    const { wallet, session } = this.deps;
    const [rows, spent] = await Promise.all([
      this.deps.koios(network).credentialUtxos([hash]),
      wallet.withKeys(() => spentSet(session)),
    ]);
    return { rows, spent };
  }

  /**
   * The pool (a read) less what a sent transaction of the wallet's spends,
   * the wallet's boxes in it, and its boxes as Koios lists them, those spent
   * included (`listed`). A box a sent transaction spends may never go: that
   * transaction can be dropped, and Mix my boxes again's first mix spends
   * boxes an older chain left not mixed yet. Until it's gone from the
   * listing, the record that says it isn't mixed stays (sortOut).
   */
  private async ours(network: NetworkName): Promise<{ pool: KoiosUtxo[]; owned: OutRef[]; listed: OutRef[] }> {
    const { rows, spent } = await this.listing(network);
    const listed = await this.owned(network, rows);
    return { pool: unspent(rows, spent), owned: listed.filter((b) => !spent.has(ref(b))), listed };
  }

  /** How many boxes session `index`'s `rows` pay for at the set depth (`again`: the mixes alone). */
  async plan(network: NetworkName, index: number, rows: KoiosUtxo[], collateral: KoiosUtxo, again = false): Promise<LovejoinPlan> {
    const { depth } = await this.settings();
    const request = { network, index, utxos: rows, collateral: { txHash: collateral.tx_hash, txIndex: collateral.tx_index }, depth, again };
    return this.deps.wallet.withKeys(
      (keys) => JSON.parse(this.deps.wasm.planLovejoin(keys.oneTime, JSON.stringify(request))) as LovejoinPlan,
    );
  }

  /**
   * Whether the pool has enough other boxes to mix `boxes` boxes at the set
   * depth with (a pool read), or why not: checked before a mix is funded.
   * The wallet's own boxes don't count: a mix never takes two of them.
   */
  async fits(network: NetworkName, boxes: number): Promise<void> {
    const { others, reserved } = await this.split(network);
    this.floor(network, others.length);
    await this.enough(free(others, reserved).length, boxes);
  }

  /**
   * Lovejoin's pool as a swap's review sees it (privacy review §2.7): the
   * real boxes in it that aren't the wallet's (`others`, what the floor
   * counts), and those no chain of the wallet's will spend (`free`, what a
   * mix draws from). One pool read, used again for POOL_ROOM_MS, so reviews
   * in a row ask Koios once. Never throws: a pool it can't read says
   * nothing, and a return reads it again anyway.
   */
  async room(network: NetworkName): Promise<{ others: number; free: number } | undefined> {
    const kept = this.rooms.get(network);
    if (kept && this.deps.now() - kept.at < POOL_ROOM_MS) return kept.room;
    try {
      const { others, reserved } = await this.split(network);
      const room = { others: others.length, free: free(others, reserved).length };
      this.rooms.set(network, { at: this.deps.now(), room });
      return room;
    } catch {
      return undefined;
    }
  }

  /**
   * How many of the wallet's boxes Mix my boxes again takes (a pool read), of
   * how many it has there: every one, as far as the pool has other boxes to
   * mix them with and one chain goes (MAX_CHAIN_MIXES). Paid from the private
   * balance, it leaves out the boxes a mix from the public account put in
   * (privacy review §2.10), unless `publicToo`: the user asked, knowing it
   * ties the two.
   */
  async againBoxes(network: NetworkName, publicToo = false): Promise<{ boxes: number; owned: number }> {
    const { depth } = await this.settings();
    const split = await this.split(network);
    const { reserved } = split;
    if (!split.owned.length) throw new Error("None of your boxes is in Lovejoin's pool, so there's nothing to mix again.");
    const owned = publicToo ? split.owned : this.privately(split.owned, await this.read(network));
    if (!owned.length) {
      throw new Error(
        "Your boxes in Lovejoin's pool came from a mix from your public account: mixing them again from your private balance would tie the two. Mix them again from your public account instead.",
      );
    }
    this.floor(network, split.others.length);
    const others = free(split.others, reserved).length;
    const perBox = mixesPerBox(depth);
    const boxes = Math.min(free(owned, reserved).length, Math.floor(others / (perBox * 2)), Math.floor(MAX_CHAIN_MIXES / perBox));
    // None fits: say what the pool has.
    if (boxes < 1) await this.enough(others, 1);
    return { boxes, owned: owned.length };
  }

  /** `boxes` less those a mix from the public account put in: what the private balance mixes again without tying itself to the account. */
  private privately(boxes: OutRef[], s: Schedule): OutRef[] {
    const theirs = new Set(fromPublic(boxes, s).map(ref));
    return boxes.filter((b) => !theirs.has(ref(b)));
  }

  /**
   * Why a chain can't draw from a pool with only `others` real boxes that
   * aren't the wallet's (the network's `lovejoin.poolFloor`), or undefined when it can.
   */
  private floorShort(network: NetworkName, others: number): string | undefined {
    const floor = NETWORKS[network].lovejoin?.poolFloor ?? 0;
    if (others >= floor) return undefined;
    return `Lovejoin's pool holds ${others} ${others === 1 ? "box" : "boxes"} that aren't yours, and the wallet mixes only once it holds ${floor}, so there's enough to mix with`;
  }

  /** Throws why, when the pool is below its floor (floorShort). */
  private floor(network: NetworkName, others: number): void {
    const short = this.floorShort(network, others);
    if (short) throw new Error(`${short}. Try again later.`);
  }

  /** Whether `others` boxes in the pool mix `boxes` boxes at the set depth, or why not. */
  private async enough(others: number, boxes: number): Promise<void> {
    const { depth } = await this.settings();
    const needed = boxes * mixesPerBox(depth) * 2;
    if (others < needed) {
      throw new Error(
        `Lovejoin's pool has ${others} boxes to mix with, and ${boxes === 1 ? "a box" : `${boxes} boxes`} ${depth} ${depth === 1 ? "wave" : "waves"} deep ${boxes === 1 ? "needs" : "need"} ${needed}. Mix fewer, or less deep (Settings, Lovejoin).`,
      );
    }
  }

  /** What mixing `boxes` boxes at the set depth takes, before anything is built (`again`: the mixes alone). */
  async funding(network: NetworkName, boxes: number, again = false): Promise<LovejoinFunding> {
    const { depth, delay } = await this.settings();
    const found = JSON.parse(this.deps.wasm.lovejoinFunding(JSON.stringify({ network, boxes, depth, again }))) as Omit<
      LovejoinFunding,
      "depth" | "delay" | "boxes" | "again"
    >;
    return { ...found, boxes, depth, delay, ...(again ? { again } : {}) };
  }

  /**
   * Session `index`'s whole chain through Lovejoin, or nothing when Lovejoin
   * isn't here or its spare ADA doesn't pay for a box (the return is plain).
   * The return at its end merges into `merge`, the funding's change. `boxes`:
   * at most this many (a mix session's), else all the spare ADA pays for.
   * `again`: the wallet's boxes in the pool mixed again, with no deposit.
   * `own`: the session's own transactions, whose UTxOs the return takes
   * first. `publicToo`: mixing again takes the boxes a mix from the public
   * account put in too (againBoxes). Throws LovejoinSkipped when the network
   * measures its first mix differently.
   */
  async chain(
    network: NetworkName,
    index: number,
    rows: KoiosUtxo[],
    collateral: KoiosUtxo | undefined,
    params: unknown,
    merge: KoiosUtxo[] = [],
    boxes?: number,
    again = false,
    own: string[] = [],
    publicToo = false,
  ): Promise<LovejoinChain | undefined> {
    if (!this.available(network) || !collateral) return undefined;
    const plan = await this.plan(network, index, rows, collateral, again);
    const count = Math.min(plan.boxes, boxes ?? plan.boxes);
    if (count < 1) return undefined;
    const { depth } = await this.settings();
    const owner = chainOwner(index);
    return this.unstale(async (avoid) => {
      // Never what another chain of the wallet's will spend (this session's own
      // built before is being built again), nor a box the network didn't know.
      const split = await this.split(network, owner, avoid);
      return this.fanOut(network, split, { owner, index, rows, collateral, params, merge, count, depth, again, own, publicToo });
    });
  }

  /** Session `owner`'s chain, built from `split` and checked by the network (chain). */
  private async fanOut(
    network: NetworkName,
    split: Split,
    c: {
      owner: string;
      index: number;
      rows: KoiosUtxo[];
      collateral: KoiosUtxo;
      params: unknown;
      merge: KoiosUtxo[];
      count: number;
      depth: number;
      again: boolean;
      own: string[];
      publicToo: boolean;
    },
  ): Promise<LovejoinChain> {
    const { owner, index, rows, collateral, params, merge, depth, again, own, publicToo } = c;
    let { count } = c;
    const short = this.floorShort(network, split.others.length);
    if (short) throw new LovejoinSkipped(short);
    // Mixing again from the private balance never takes a box a mix from the public account put in, unless asked (againBoxes).
    const schedule = await this.read(network);
    const left = new Set(again && !publicToo ? fromPublic(split.owned, schedule).map(ref) : []);
    const owned = free(split.owned, split.reserved).filter((b) => !left.has(ref(b)));
    const others = free(split.others, split.reserved);
    if (again) {
      if (!owned.length) throw new LovejoinSkipped("none of your boxes is in Lovejoin's pool anymore");
      count = Math.min(count, owned.length);
    }
    // Each mix takes two boxes from the pool, never one twice, and never one of ours.
    const perBox = mixesPerBox(depth);
    if (others.length < perBox * 2) {
      throw new LovejoinSkipped(`Lovejoin's pool has ${others.length} boxes to mix with, and this needs ${perBox * 2}`);
    }
    // One chain is at most MAX_CHAIN_MIXES long, and one deposit makes at most MAX_DEPOSIT_BOXES,
    // whatever the spare ADA pays for: what's left comes back with the return.
    const most = again ? Math.floor(MAX_CHAIN_MIXES / perBox) : chainBoxes(depth);
    count = Math.min(count, Math.floor(others.length / (perBox * 2)), most);
    // Mixing again takes the wallet's boxes in the pool's order: the ones not mixed yet go first.
    const unmixed = new Set(unmixedOf(schedule.chains, owned).map(ref));
    const first = (u: KoiosUtxo) => (unmixed.has(outpoint(u)) ? 0 : 1);
    const request = {
      network,
      params,
      index,
      utxos: rows,
      collateral: { txHash: collateral.tx_hash, txIndex: collateral.tx_index },
      pool: this.real(split)
        .filter((u) => !left.has(outpoint(u)))
        .sort((a, b) => first(a) - first(b)),
      depth,
      boxes: count,
      merge,
      again,
      own,
    };
    const chain = await this.deps.wallet.withKeys(
      (keys) =>
        JSON.parse(this.deps.wasm.buildLovejoinChain(keys.oneTime, keys.seedelf, JSON.stringify(request))) as LovejoinChain,
    );
    if (chain.skipped) throw new LovejoinSkipped(chain.skipped);
    // Kept for Send (or sent at once) as soon as it's built, before the network's check: no other chain draws its
    // boxes meanwhile, and one that took any since this pool read has it built again (independent review L27).
    const mine = await this.reserve(network, owner, chain.txs, this.deps.now() + BUILT_TTL_MS);
    await this.crossCheck(network, chain).catch(async (e: unknown) => {
      await this.unreserve(network, owner, mine).catch(() => undefined);
      throw e;
    });
    return chain;
  }

  /**
   * Builds with `build` until the network knows every input its chain's
   * first mix spends. A read of the pool that was behind isn't a reason to
   * leave Lovejoin out: the boxes the network names are left out of the next
   * read (`avoid`), STALE_POOL_TRIES times, then it's Koios's error, to try
   * again later, never a skip.
   */
  private async unstale<T>(build: (avoid: Set<string>) => Promise<T>): Promise<T> {
    const avoid = new Set<string>();
    for (let tries = 0; ; tries++) {
      try {
        return await build(avoid);
      } catch (e) {
        if (!(e instanceof StalePool)) throw e;
        if (tries >= STALE_POOL_TRIES) {
          // Koios is behind: another try, later, may find it caught up.
          throw new KoiosError("Lovejoin's pool changed while the wallet read it: a box it drew isn't there anymore. Try again in a minute.");
        }
        for (const o of e.unknown) avoid.add(o);
      }
    }
  }

  /**
   * Reserves what chain `owner`'s transactions spend and put up as
   * collateral (spent.ts), in place of its reservation before: kept for Send
   * until `until`, or, without it, being sent. Never what another chain of
   * the wallet's reserved: one built at the same time drew from the pool
   * before this one's reservation was there, and the one that reserves
   * second is refused (StalePool, which builds it again without those
   * boxes), so no two chains spend one box (independent review L27). Kept
   * for Send, never in place of `owner`'s chain being sent; and, `held`,
   * sent only while its own reservation as it was kept for Send still stands:
   * another build of `owner`'s since (a second page's Review) took its place,
   * and may have drawn its boxes (independent review L30). Returns the
   * reservation made.
   */
  async reserve(network: NetworkName, owner: string, txs: LovejoinChain["txs"], until?: number, held = false): Promise<Reservation> {
    const mine = reservationOf(txs, until);
    await this.reserving(network, (kept) => {
      const was = kept[owner];
      if (until !== undefined && was && was.until === undefined) {
        throw new Error(owner === chainOwner() ? PUBLIC_STILL_SENDING : "Its return through Lovejoin is still being sent. Wait for it to finish.");
      }
      if (held && !(was?.until !== undefined && sameInputs(was, mine))) throw new Error(NOT_READY);
      const others = new Set(Object.entries(kept).flatMap(([chain, r]) => (chain === owner ? [] : r.inputs)));
      const taken = mine.inputs.filter((o) => others.has(o));
      if (taken.length) throw new StalePool(taken);
      kept[owner] = mine;
    });
    return mine;
  }

  /**
   * Takes back `mine`, chain `owner`'s reservation, if it still holds it: its
   * build went no further (the network's check refused it, say). What the
   * owner held before isn't put back: a chain built meanwhile may have drawn
   * those boxes, so the review before is built again rather than sent.
   */
  private unreserve(network: NetworkName, owner: string, mine: Reservation): Promise<void> {
    return this.reserving(network, (kept) => {
      const r = kept[owner];
      if (r && r.until === mine.until && sameInputs(r, mine)) delete kept[owner];
    });
  }

  /** Chain `owner` is all sent, stopped, or won't be sent: nothing is reserved for it. */
  release(network: NetworkName, owner: string): Promise<void> {
    return this.reserving(network, (kept) => {
      delete kept[owner];
    });
  }

  /** Changes the reservations, one change at a time, dropping those kept for Send past their time. */
  private reserving(network: NetworkName, change: (kept: Record<string, Reservation>) => void): Promise<void> {
    const { wallet, session, now } = this.deps;
    return this.inTurn(`reserved.${network}`, () =>
      wallet.withKeys(async () => {
        const kept = await reservations(session, network, now());
        change(kept);
        await session.set(SESSION_RESERVED_PREFIX + network, kept);
      }),
    );
  }

  /** Runs `task` after every other task of `name`'s, so read-change-writes of one record never overlap. */
  private inTurn<T>(name: string, task: () => Promise<T>): Promise<T> {
    const run = (this.turns.get(name) ?? Promise.resolve()).then(task, task);
    this.turns.set(name, run.catch(() => undefined));
    return run;
  }

  /**
   * Has Koios's Ogmios measure the chain's first mix, with the deposit it
   * spends (not on chain yet) as extra UTxOs, and compares that with what the
   * mix declares, which the wallet measured. A chain with no deposit (mixing
   * again) starts with a mix whose inputs are all on chain. Throws
   * LovejoinSkipped when the network measures more or refuses a script: then
   * the wallet's evaluator is behind the network (a hard fork), and sending
   * would risk the collateral. A Koios error is thrown as it is, to be tried
   * again.
   */
  private async crossCheck(network: NetworkName, chain: LovejoinChain): Promise<void> {
    const { wasm } = this.deps;
    const first = chain.txs.find((t) => t.kind === "mix");
    const deposit = chain.txs.find((t) => t.kind === "deposit");
    if (!first) return;
    const additional = deposit ? (JSON.parse(wasm.ogmiosUtxos(deposit.txCbor)) as unknown[]) : [];
    const answer = await this.deps.koios(network).evaluate(first.txCbor, additional);
    // An input it doesn't know is a pool read that was behind, not a disagreement: built again.
    const unknown = unknownInputs(answer);
    if (unknown) throw new StalePool(unknown);
    const checked = JSON.parse(wasm.declaredCovers(first.txCbor, JSON.stringify(answer))) as { covers: boolean; reason?: string };
    if (!checked.covers) throw new LovejoinSkipped(checked.reason ?? "the network measured its scripts differently");
  }

  /**
   * Builds `boxes` boxes from the public account straight into Lovejoin: the
   * deposit and every mix, signed by the account's keys and checked against
   * the network, kept for Send. Its collateral backs every mix.
   */
  async publicBuild(network: NetworkName, boxes: number): Promise<LovejoinPublicSummary> {
    if (!this.available(network)) throw new Error("Lovejoin isn't on this network yet.");
    checkBoxes(boxes);
    await this.publicReady(network);
    // It spends the account: not while a payment from it may still go through (pending.ts).
    await settleMaybeSent(this.deps, network);
    const { wasm, wallet, now } = this.deps;
    const { params, utxos, collateral, held } = await readAccount(this.deps, network);
    if (!collateral) {
      throw new Error("Lovejoin's mixes need your public account's collateral. Set it aside in Settings, Collateral, first.");
    }
    if (!utxos.length) throw nothingInAccount(held, "Your public account is empty, so there's nothing to mix.");
    const { depth, delay } = await this.settings();
    const chain = await this.unstale(async (avoid) => {
      const split = await this.split(network, chainOwner(), avoid);
      this.floor(network, split.others.length);
      const request = { network, params, utxos, collateral, pool: this.real(split), depth, boxes };
      const built = await wallet.withKeys(
        (keys) => JSON.parse(wasm.buildLovejoinFromAccount(keys.cardano, keys.seedelf, JSON.stringify(request))) as LovejoinChain,
      );
      return this.checked(network, built);
    });
    const last = chain.txs.at(-1)!;
    const summary: LovejoinPublicSummary = {
      network,
      txHash: last.txHash,
      boxes: chain.boxes,
      depth: chain.depth,
      delay,
      mixes: chain.txs.filter((t) => t.kind === "mix").length,
      txs: chain.txs.length,
      fees: chain.fees,
      change: chain.returned,
    };
    await this.keep(network, { ...summary, chain: chain.txs, leaves: chain.leaves, builtAt: now() }, chain.reserved);
    return summary;
  }

  /**
   * Refuses a new mix from the public account while the last is still being
   * sent, or stopped at a transaction that may have gone through, unseen
   * yet: the account could pay for a mix twice (independent review L5).
   * Otherwise nothing is being sent from it, and a reservation left as being
   * sent (a write that failed) goes, rather than hold every mix back. In the
   * account's turn, so no Send starts meanwhile (independent review L30).
   */
  private publicReady(network: NetworkName): Promise<void> {
    return this.inTurn(`public.${network}`, async () => {
      const sending = await this.sendingOf(network);
      if (sending && !sending.stopped) throw new Error(PUBLIC_STILL_SENDING);
      if (await this.publicUnsettledNow(network)) throw new Error(PUBLIC_MAYBE_WAIT);
      await this.reserving(network, (kept) => {
        if (kept[chainOwner()] && kept[chainOwner()]!.until === undefined) delete kept[chainOwner()];
      });
    });
  }

  /**
   * A mix from the public account, just built: reserved at once, before the
   * network's check, which it then passes, or its reservation goes
   * (independent review L27).
   */
  private async checked(network: NetworkName, built: LovejoinChain): Promise<LovejoinChain & { reserved: Reservation }> {
    const reserved = await this.reserve(network, chainOwner(), built.txs, this.deps.now() + BUILT_TTL_MS);
    try {
      await this.crossCheck(network, built);
    } catch (e) {
      await this.unreserve(network, chainOwner(), reserved).catch(() => undefined);
      if (e instanceof LovejoinSkipped) throw new Error(`The network doesn't measure Lovejoin's scripts as the wallet does (${e.reason}), so nothing was sent.`);
      throw e;
    }
    return { ...built, reserved };
  }

  /** Keeps a mix from the public account for Send, or lets its reservation go when it can't be kept. */
  private async keep(network: NetworkName, kept: KeptPublic, reserved: Reservation): Promise<void> {
    const { wallet, session } = this.deps;
    try {
      await wallet.withKeys(() => session.set(SESSION_LOVEJOIN_PUBLIC, kept));
    } catch (e) {
      await this.unreserve(network, chainOwner(), reserved).catch(() => undefined);
      throw e;
    }
  }

  /**
   * Mixes the wallet's boxes that a mix from the public account put in again,
   * paid by the account (privacy review §2.10): it paid for their deposit and
   * mixes in the open already, so paying again ties nothing new, where the
   * private balance would tie itself to the account. Every mix built, signed
   * by the account's keys and checked against the network, kept for Send as
   * a mix from it is (publicSubmit); no deposit, and the change stays in the
   * account. The boxes not mixed yet go first.
   */
  async publicAgainBuild(network: NetworkName): Promise<PublicAgain> {
    if (!this.available(network)) throw new Error("Lovejoin isn't on this network yet.");
    await this.publicReady(network);
    // It spends the account: not while a payment from it may still go through (pending.ts).
    await settleMaybeSent(this.deps, network);
    const { wasm, wallet, now } = this.deps;
    const { params, utxos, collateral, held } = await readAccount(this.deps, network);
    if (!collateral) {
      throw new Error("Lovejoin's mixes need your public account's collateral. Set it aside in Settings, Collateral, first.");
    }
    if (!utxos.length) throw nothingInAccount(held, "Your public account is empty, so there's nothing to pay for the mixes with.");
    const { depth, delay } = await this.settings();
    const chain = await this.unstale(async (avoid) => {
      const split = await this.split(network, chainOwner(), avoid);
      this.floor(network, split.others.length);
      const schedule = await this.read(network);
      const theirs = free(fromPublic(split.owned, schedule), split.reserved);
      if (!theirs.length) throw new Error("None of your boxes in Lovejoin's pool came from a mix from your public account.");
      const others = free(split.others, split.reserved).length;
      const perBox = mixesPerBox(depth);
      const boxes = Math.min(theirs.length, Math.floor(others / (perBox * 2)), Math.floor(MAX_CHAIN_MIXES / perBox));
      if (boxes < 1) await this.enough(others, 1);
      // Only the account's own boxes are the wallet's in what it's given, the ones not mixed yet first.
      const mine = new Set(split.owned.map(ref));
      const taken = new Set(theirs.map(ref));
      const unmixed = new Set(unmixedOf(schedule.chains, theirs).map(ref));
      const first = (u: KoiosUtxo) => (unmixed.has(outpoint(u)) ? 0 : 1);
      const pool = this.real(split)
        .filter((u) => !mine.has(outpoint(u)) || taken.has(outpoint(u)))
        .sort((a, b) => first(a) - first(b));
      const request = { network, params, utxos, collateral, pool, depth, boxes };
      const built = await wallet.withKeys(
        (keys) => JSON.parse(wasm.buildLovejoinAgainFromAccount(keys.cardano, keys.seedelf, JSON.stringify(request))) as LovejoinChain,
      );
      return this.checked(network, built);
    });
    const last = chain.txs.at(-1)!;
    const summary: PublicAgain = {
      network,
      txHash: last.txHash,
      boxes: chain.boxes,
      depth: chain.depth,
      delay,
      mixes: chain.txs.length,
      txs: chain.txs.length,
      fees: chain.fees,
      change: chain.returned,
      again: true,
    };
    await this.keep(network, { ...summary, chain: chain.txs, leaves: chain.leaves, builtAt: now() }, chain.reserved);
    return summary;
  }

  /**
   * Sends the public account's mix built last, in order, each transaction on
   * the one before's change; a child Koios hasn't seen the parent of yet is
   * tried again a little later. The boxes' withdraws are set once the
   * deposit is in. Home's banner watches the last mix.
   */
  async publicSubmit(network: NetworkName, txHash: string): Promise<PendingTx> {
    const { now } = this.deps;
    // One Send at a time on a network, and never while the last mix from the account is still being sent: its
    // progress stays its own (independent review L30).
    await this.inTurn(`public.${network}`, () => this.publicStart(network, txHash));
    await this.deps.alarm?.start();
    // The first window now; the Lovejoin page and the alarm send the rest as blocks make room.
    await this.pumpPublic(network, 0);
    const pending: PendingTx = { kind: "lovejoin-mix", network, txHash, submittedAt: now(), confirmations: null };
    await this.deps.wallet.withKeys(() => this.deps.session.remove(SESSION_BALANCES_PREFIX + network));
    await watchSent(this.deps, pending);
    return pending;
  }

  /** Records the mix kept for Send (`txHash`), reserves what it spends, and puts its progress where it's sent from. */
  private async publicStart(network: NetworkName, txHash: string): Promise<void> {
    const { wallet, session, now } = this.deps;
    const built = await wallet.withKeys(() => session.get<KeptPublic>(SESSION_LOVEJOIN_PUBLIC));
    if (!built || built.txHash !== txHash || built.network !== network) throw new Error(NOT_READY);
    if (now() - built.builtAt > BUILT_TTL_MS) throw new Error("That mix was built more than 10 minutes ago. Review it again.");
    // A payment may have gone maybe sent since the review: nothing of the mix goes, or is kept for it, meanwhile.
    await settleMaybeSent(this.deps, network);
    const before = await this.sendingOf(network);
    if (before && !before.stopped) throw new Error(PUBLIC_STILL_SENDING);
    if (await this.publicUnsettledNow(network)) throw new Error(PUBLIC_MAYBE_WAIT);
    const sending: SendingPublic = { network, boxes: built.boxes, txs: built.chain, next: 0, flying: [] };
    // Recorded, sealed, before its progress is where anything can send it from (independent review L28). Its own
    // boxes mixed again: they wait afresh once its first mix is in (chainSent).
    const chain = { progress: SESSION_LOVEJOIN_SENDING + network, txs: built.chain, leaves: built.leaves ?? [], boxes: built.boxes };
    await this.recordChain(network, { ...chain, ...(built.again ? { again: true } : {}) }, async () => {
      // Being sent: its change to come and its collateral are the chain's too, as long as what its review
      // reserved is still its own.
      await this.reserve(network, chainOwner(), built.chain, undefined, true);
      try {
        await wallet.withKeys(async () => {
          await session.set(SESSION_LOVEJOIN_SENDING + network, sending);
          await session.remove(SESSION_LOVEJOIN_PUBLIC);
        });
      } catch (e) {
        await this.release(network, chainOwner()).catch(() => undefined);
        throw e;
      }
    });
  }

  /**
   * More of the public mix being sent, for about `budgetMs` (a block by
   * default): a window at a time, so no more than a few of its mixes wait in
   * the mempool (pumpChain). Its Send sends the first, and the alarm and the
   * Lovejoin page the rest. Returns whether some is left to send. A
   * transaction that can't be sent stops it, and says why (progress).
   */
  async pumpPublic(network: NetworkName, budgetMs = CHAIN_PUMP_MS): Promise<boolean> {
    if (this.pumping.has(network)) return true;
    this.pumping.add(network);
    try {
      return await this.pumpPublicNow(network, budgetMs);
    } finally {
      this.pumping.delete(network);
    }
  }

  private async pumpPublicNow(network: NetworkName, budgetMs: number): Promise<boolean> {
    const sending = await this.sendingOf(network);
    if (!sending || sending.stopped) return false;
    const { wallet, session } = this.deps;
    const koios = this.deps.koios(network);
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const key = SESSION_LOVEJOIN_SENDING + network;
    const id = sending.txs.at(-1)!.txHash;
    // Its progress is still where it waits, as this chain: a lock since (and an unlock after it) wiped it, or
    // another chain took its place, and nothing of it is sent or written back (independent review L14). Call it
    // while unlocked.
    const ours = async () => {
      if ((await session.get<SendingPublic>(key))?.txs?.at(-1)?.txHash !== id) throw new ChainGone();
    };
    const save = () =>
      wallet.withKeys(async () => {
        await ours();
        await session.set(key, sending);
      });
    // The next transaction, when a send of it gave up while it may have gone in all the same: a try Koios
    // didn't answer, and none that says it's in (independent review L5). Cleared once a send of it goes.
    let unsure: number | undefined;
    try {
      const done = await pumpChain(
        sending,
        {
          send: async (i, maybeSent) => {
            const step = sending.txs[i]!;
            const bytes = hexBytes(step.txCbor);
            const tries = { busy: 0, spent: 0, maybeSent };
            // Whether a try may have put it in: sent before, or one Koios didn't answer.
            let reached = maybeSent;
            for (;;) {
              try {
                try {
                  const submitted = await koios.submitTx(bytes);
                  if (submitted !== step.txHash) throw new Error(`Koios answered with another transaction id (${submitted}).`);
                } catch (e) {
                  if (!(e instanceof SpentInputError)) throw e;
                  await sentAlready(koios, step.txHash, e);
                }
                break;
              } catch (e) {
                // Refused while Koios couldn't say whether it's on chain, and it may be: looked for again (final review lovejoin-6).
                if (mayBeIn(tries, e)) break;
                if (e instanceof KoiosBusyError && e.maybeSent) reached = true;
                const wait = chainRetryMs(i, tries, e);
                if (wait === undefined) {
                  if (reached && i === sending.next && (e instanceof KoiosBusyError || e instanceof SpentInputError)) unsure = i;
                  throw e;
                }
                await sleep(wait);
                // Never after a lock: the wallet may have locked while it waited, and locking stops the chain.
                await wallet.withKeys(ours);
              }
            }
            if (unsure === i) unsure = undefined;
            await wallet.withKeys(() => rememberSpent(session, network, bytes, this.deps.now()));
            await this.chainSent(network, id, i);
          },
          onChain: async (hashes) => {
            const statuses = await koios.txStatus(hashes);
            return new Set(hashes.filter((h) => statuses.get(h) != null));
          },
          save,
          sleep,
          now: this.deps.now,
        },
        budgetMs,
      );
      if (done) {
        await this.chainEnded(network, id);
        // What it held, and its progress, go: unless a lock took them already, and something else holds its place.
        const here = await wallet.withKeys(() => ours().then(() => true, () => false));
        if (here) {
          // Its reservation first: nothing takes its place while its progress is there (independent review L30).
          await this.release(network, chainOwner());
          await wallet.withKeys(() => session.remove(key));
        }
      }
      return !done;
    } catch (e) {
      // A lock cut it: whatever holds its place now stays as it is, and its record says it was cut.
      if (e instanceof ChainGone) {
        await this.chainEnded(network, id, CHAIN_CUT).catch(() => undefined);
        throw e;
      }
      // Stopped at a transaction that may have gone through: what it spends counts as spent, and stays reserved,
      // and it's looked for before another mix from the account is built (independent review L5).
      const step = unsure === undefined ? undefined : sending.txs[unsure]!;
      const maybe = step && { index: unsure!, txHash: step.txHash, inputs: txInputs(hexBytes(step.txCbor)), at: this.deps.now() };
      sending.stopped = maybe
        ? `Koios didn't answer when ${stepName(sending.txs, maybe.index)} was sent, so it may have gone through. The wallet looks for it on chain before another mix from your public account is built.`
        : e instanceof Error
          ? e.message
          : String(e);
      if (maybe) {
        sending.maybe = maybe.index;
        await wallet.withKeys(() => rememberSpent(session, network, hexBytes(step!.txCbor), maybe.at)).catch(() => undefined);
      }
      // Recorded as stopped, and what it held let go, before its progress says so: nothing takes its place until
      // all of that is done (independent review L30).
      await this.chainEnded(network, id, sending.stopped, maybe).catch(() => undefined);
      if (!maybe) await this.release(network, chainOwner()).catch(() => undefined);
      await save().catch(() => undefined);
      throw maybe ? new Error(sending.stopped) : e;
    }
  }

  private sendingOf(network: NetworkName): Promise<SendingPublic | undefined> {
    return this.deps.wallet.withKeys(() => this.deps.session.get<SendingPublic>(SESSION_LOVEJOIN_SENDING + network));
  }

  /** Sets `boxes` withdraws to come, each after its own random delay. */
  async schedule(network: NetworkName, boxes: number): Promise<void> {
    const due = await this.draw(boxes);
    await this.update(network, (s) => s.due.push(...due));
  }

  /** `boxes` due times, each a random delay (the settings' range) from now. */
  private async draw(boxes: number): Promise<number[]> {
    const { delay } = await this.settings();
    const [low, high] = delayHours(delay);
    const random = this.deps.random ?? secureRandom;
    const now = this.deps.now();
    return Array.from({ length: boxes }, () => now + Math.round((low + (high - low) * random()) * HOUR));
  }

  /**
   * Records a chain before any of it is sent: its deposit, each mix and its
   * leaves, sealed, so the wallet knows which of its boxes it hasn't mixed
   * yet, after a lock too. `progress`: where it waits while it's sent.
   * `start` then puts it there (and reserves what it spends), so nothing can
   * send a chain with no record (independent review L28); meanwhile it isn't
   * taken for one a lock cut (cuts). One whose `start` fails never went:
   * its record goes.
   */
  async recordChain(
    network: NetworkName,
    chain: { session?: number; progress: string; txs: LovejoinChain["txs"]; leaves: OutRef[]; boxes: number; again?: boolean },
    start?: () => Promise<void>,
  ): Promise<void> {
    const { txs } = chain;
    const record: ChainRecord = {
      id: txs.at(-1)!.txHash,
      ...(chain.session !== undefined ? { session: chain.session } : {}),
      progress: chain.progress,
      ...(txs[0]?.kind === "deposit" ? { deposit: txs[0].txHash } : {}),
      mixes: txs.filter((t) => t.kind === "mix").map((t) => t.txHash),
      leaves: chain.leaves,
      boxes: chain.boxes,
      ...(chain.again ? { again: true } : {}),
      total: txs.length,
      sent: 0,
      at: this.deps.now(),
    };
    this.starting.add(record.id);
    try {
      await this.update(network, (s) => {
        s.chains = [...s.chains.filter((c) => c.id !== record.id), record];
      });
      try {
        await start?.();
      } catch (e) {
        await this.update(network, (s) => {
          s.chains = s.chains.filter((c) => c.id !== record.id);
        }).catch(() => undefined);
        throw e;
      }
    } finally {
      this.starting.delete(record.id);
    }
  }

  /**
   * Chain `id`'s transaction `i` is sent. Its first sets the boxes'
   * withdraws: a deposit's boxes, each a delay from now; boxes mixed again
   * wait afresh. Once only, however often it's sent.
   */
  async chainSent(network: NetworkName, id: string, i: number): Promise<void> {
    const record = (await this.read(network)).chains.find((c) => c.id === id);
    if (!record) return;
    const due = i === 0 && !record.scheduled ? await this.draw(record.boxes) : [];
    await this.update(network, (s) => {
      const c = s.chains.find((r) => r.id === id);
      if (!c) return;
      c.sent = Math.max(c.sent, i + 1);
      if (!due.length || c.scheduled) return;
      c.scheduled = true;
      if (c.again) {
        s.due.sort((a, b) => a - b);
        s.due.splice(0, c.boxes);
      }
      s.due.push(...due);
    });
  }

  /**
   * Chain `id` is all sent, or `stopped` partway, and why. Stopped, the due
   * times of the boxes it hadn't mixed all the way go (unschedule).
   */
  async chainEnded(network: NetworkName, id: string, stopped?: string, maybe?: ChainRecord["maybe"]): Promise<void> {
    const now = this.deps.now();
    await this.update(network, (s) => {
      const c = s.chains.find((r) => r.id === id);
      if (!c || c.ended) return;
      c.ended = now;
      if (stopped === undefined) c.done = true;
      else {
        c.stopped = stopped;
        if (maybe) c.maybe = maybe;
        unschedule(s, c, unfinished(c));
      }
    });
  }

  /**
   * Looks for the transaction a mix from the public account stopped at
   * while it may have gone through (ChainRecord `maybe`): on chain, it went;
   * not, and a UTxO it spends is spent now, it can't go anymore, whether it
   * did or not; unseen as long as the wallet holds what it spends
   * (SPENT_KEEP_MS), it never went. Then the mix's record and progress say
   * so, and what it reserved goes. Returns whether it's still unsettled: no
   * other mix from the account is built meanwhile, or the account could pay
   * for one twice (independent review L5). It's only looked for, never sent
   * again: its mix stopped.
   */
  private publicUnsettled(network: NetworkName): Promise<boolean> {
    return this.inTurn(`public.${network}`, () => this.publicUnsettledNow(network));
  }

  /** publicUnsettled, in the account's turn. */
  private async publicUnsettledNow(network: NetworkName): Promise<boolean> {
    const c = (await this.read(network)).chains.find((r) => r.session === undefined && r.maybe);
    const m = c?.maybe;
    if (!c || !m) return false;
    const koios = this.deps.koios(network);
    const seen = (await koios.txStatus([m.txHash]).catch(() => undefined))?.get(m.txHash);
    // Koios didn't answer: looked for again next time.
    if (seen === undefined) return true;
    let how: "in" | "spent" | "never" = "in";
    if (seen === null) {
      const rows = (await koios.utxoInfo(m.inputs).catch(() => undefined)) as Array<KoiosUtxo & { is_spent?: boolean }> | undefined;
      if (!rows) return true;
      if (rows.some((r) => r.is_spent)) how = "spent";
      else if (this.deps.now() - m.at >= SPENT_KEEP_MS) how = "never";
      else return true;
    }
    const what = c.deposit === m.txHash ? "its deposit" : `its transaction ${m.index + 1} of ${c.total}`;
    const why = {
      in: `Koios didn't answer when ${what} was sent. It went through, and the mix stopped there.`,
      spent: `Koios didn't answer when ${what} was sent, and what it spends is spent now: if that was it, the boxes it made wait in the pool, not mixed yet.`,
      never: `Koios didn't answer when ${what} was sent, and it never went through.`,
    }[how];
    await this.update(network, (s) => {
      const r = s.chains.find((x) => x.id === c.id);
      if (r?.maybe?.txHash !== m.txHash) return;
      delete r.maybe;
      r.stopped = why;
      if (how === "in") r.sent = Math.max(r.sent, m.index + 1);
    });
    const { wallet, session } = this.deps;
    const key = SESSION_LOVEJOIN_SENDING + network;
    await wallet.withKeys(async () => {
      const p = await session.get<SendingPublic>(key);
      if (p?.txs?.at(-1)?.txHash !== c.id || p.maybe === undefined) return;
      delete p.maybe;
      p.stopped = why;
      if (how === "in") p.next = Math.max(p.next, m.index + 1);
      await session.set(key, p);
    });
    // Nothing of it can land later: what it held goes, as a stopped mix's does.
    await this.reserving(network, (kept) => {
      if (kept[chainOwner()] && kept[chainOwner()]!.until === undefined) delete kept[chainOwner()];
    });
    return false;
  }

  /**
   * Marks each chain recorded as being sent whose progress is gone as
   * stopped: a lock, a closed browser or an update wiped it partway, and
   * nothing sends the rest (CHAIN_CUT); or, whose progress says it stopped,
   * with its reason. No Koios request.
   */
  async cuts(network: NetworkName): Promise<void> {
    const { wallet, session, now } = this.deps;
    const live = (await this.read(network)).chains.filter((c) => !c.ended);
    if (!live.length) return;
    const stopped = new Map<string, string>();
    for (const c of live) {
      // Its progress is being put where it waits (recordChain): not cut.
      if (this.starting.has(c.id)) continue;
      const progress = await wallet.withKeys(() => session.get<ChainProgress & { stopped?: string }>(c.progress));
      // Another chain's in its place is this one's gone too.
      if (progress?.txs?.at(-1)?.txHash !== c.id) stopped.set(c.id, CHAIN_CUT);
      else if (progress.stopped) stopped.set(c.id, progress.stopped);
    }
    if (!stopped.size) return;
    const at = now();
    await this.update(network, (s) => {
      for (const c of s.chains) {
        const why = stopped.get(c.id);
        if (why === undefined || c.ended) continue;
        c.stopped = why;
        c.ended = at;
        unschedule(s, c, unfinished(c));
      }
    });
  }

  /** Whether a chain of the wallet's is being sent (recorded, and neither all sent nor stopped). */
  private async chainsSending(network: NetworkName): Promise<boolean> {
    await this.cuts(network);
    return (await this.read(network)).chains.some((c) => !c.ended);
  }

  /**
   * The wallet's boxes, as its recorded chains leave them: not mixed yet (a
   * chain that ended left them so; one being sent is still mixing its own),
   * or free to come back. `owned` leaves out what a sent transaction of the
   * wallet's spends; `listed` doesn't. A record that ended long enough ago
   * and holds no box in the listing anymore goes, and Home's count of boxes
   * not mixed yet follows. A box only hidden by a spend that may never land
   * keeps its record (final review lovejoin-1). A box not mixed yet that no
   * record counted before (a mix of it a node dropped) loses its due time
   * here, never one a box that can come back needs. A record that goes
   * leaves its leaves still listed behind, and each goes once its box has
   * moved or come back (privacy review §3.6).
   */
  private async sortOut(network: NetworkName, owned: OutRef[], listed: OutRef[]): Promise<{ unmixed: OutRef[]; free: OutRef[] }> {
    const now = this.deps.now();
    const { chains } = await this.read(network);
    const unmixed = unmixedOf(chains.filter((c) => c.ended), owned);
    const held = new Set(unmixedOf(chains, owned).map(ref));
    const free = owned.filter((b) => !held.has(ref(b)));
    const there = new Set(listed.map(ref));
    await this.update(network, (s) => {
      for (const c of s.chains) {
        if (c.ended) unschedule(s, c, unmixedOf([c], owned).length - (c.unscheduled ?? 0), free.length);
      }
      const keep = (c: ChainRecord) => !c.ended || now - c.ended < RECORD_KEEP_MS || unmixedOf([c], listed).length > 0;
      const gone = s.chains.filter((c) => !keep(c)).flatMap((c) => c.leaves.map((l) => [ref(l), chainOwner(c.session)] as const));
      const leaves = Object.entries({ ...s.leaves, ...Object.fromEntries(gone) }).filter(([r]) => there.has(r));
      if (leaves.length) s.leaves = Object.fromEntries(leaves);
      else delete s.leaves;
      s.chains = s.chains.filter(keep);
      s.notMixed = unmixed.length;
    });
    return { unmixed, free };
  }

  /** The wallet's boxes a chain of its, built or being sent, will spend: none of them is withdrawn. */
  private async reservedBoxes(network: NetworkName): Promise<Set<string>> {
    const { wallet, session, now } = this.deps;
    return (await wallet.withKeys(() => reservedSet(session, network, { now: now() }))).inputs;
  }

  /**
   * The wallet's boxes in the pool (a pool read), when they're due, which
   * aren't mixed yet, and its chains not all sent: being sent, or stopped
   * partway. A box found with no due time (a restore) gets one here.
   */
  async status(network: NetworkName): Promise<LovejoinStatus> {
    if (!this.available(network)) return { available: false, boxes: [], lovelace: "0", due: [], notMixed: [], fromPublic: [], chains: [] };
    await this.cuts(network);
    const { owned, listed } = await this.ours(network);
    const { unmixed, free: back } = await this.sortOut(network, owned, listed);
    const known = (await this.read(network)).due.length;
    if (back.length > known) await this.schedule(network, back.length - known);
    const schedule = await this.read(network);
    const { due, chains } = schedule;
    return {
      available: true,
      boxes: owned,
      lovelace: (BigInt(owned.length) * LOVEJOIN_DENOM).toString(),
      due: [...due].sort((a, b) => a - b),
      notMixed: unmixed,
      fromPublic: fromPublic(owned, schedule),
      chains: chains
        .filter((c) => !c.done)
        .map((c) => ({
          ...(c.session !== undefined ? { session: c.session } : {}),
          boxes: c.boxes,
          total: c.total,
          sent: c.sent,
          at: c.at,
          ...(c.stopped ? { stopped: c.stopped } : {}),
          ...(c.maybe ? { maybeSent: true as const } : {}),
        })),
    };
  }

  /**
   * The boxes on their way back, from the schedule alone: one due time per
   * box that can come back by itself, kept to the pool's count at each scan
   * (a box a chain left not mixed yet has none: unschedule); how many
   * weren't mixed yet at the last one; and how many chains stopped partway.
   * No Koios request, so Home can ask whenever it shows.
   */
  async held(network: NetworkName): Promise<LovejoinHeld> {
    if (!this.available(network)) return { boxes: 0, lovelace: "0", next: null, notMixed: 0, stopped: 0 };
    await this.cuts(network);
    const { due, chains, notMixed } = await this.read(network);
    return {
      boxes: due.length,
      lovelace: (BigInt(due.length) * LOVEJOIN_DENOM).toString(),
      next: due.length ? Math.min(...due) : null,
      notMixed: notMixed ?? 0,
      stopped: chains.filter((c) => c.stopped).length,
    };
  }

  /**
   * Withdraws a box that's due, one a run. `unlock` (the run as the wallet
   * unlocks) reads the pool even when nothing is due yet, on a network where
   * the wallet has something open in Lovejoin, so its boxes' due times follow
   * the pool; and sends nothing: each box due by then waits a fresh draw
   * (privacy review §3.1). `since`: when the run began, so nothing goes back
   * in a run that sent anything else. One run at a time.
   */
  withdrawDue(network: NetworkName, unlock = false, since?: number): Promise<PendingTx[]> {
    if (!this.available(network)) return Promise.resolve([]);
    return this.inTurn(`withdraw.${network}`, () => this.withdrawDueNow(network, unlock, since));
  }

  private async withdrawDueNow(network: NetworkName, unlock: boolean, since: number | undefined): Promise<PendingTx[]> {
    // A chain mixing them again spends them: they wait until it's sent.
    if (await this.deps.mixingAgain?.(network)) return [];
    // A chain being sent is still putting boxes in and mixing them: none comes back meanwhile.
    if (await this.chainsSending(network)) return [];
    // Nor while the last withdraw may still be on its way: two a minute apart say they're one owner's.
    if (await this.settleWithdrawing(network, unlock)) return [];
    const now = this.deps.now();
    const before = await this.read(network);
    // Only a network with something of the wallet's open in Lovejoin reads its pool at unlock (privacy review §2.18).
    const open = before.due.length > 0 || before.chains.length > 0 || (before.notMixed ?? 0) > 0;
    if (!(unlock && open) && !before.due.some((t) => t <= now)) return [];
    const { pool, owned, listed } = await this.ours(network);
    // A box a chain of the wallet's made and hadn't finished mixing never
    // comes back by itself: it waits, not mixed yet, for Mix my boxes again.
    const { free: back } = await this.sortOut(network, owned, listed);
    // A box with no due time (a restore) gets one; a due time with no box
    // (withdrawn by hand, or a chain that didn't go through) goes.
    const known = (await this.read(network)).due.length;
    if (back.length > known) await this.schedule(network, back.length - known);
    const schedule = await this.read(network);
    const kept = [...schedule.due].sort((a, b) => a - b).slice(0, back.length);
    await this.update(network, (s) => (s.due = kept));
    const random = this.deps.random ?? secureRandom;

    if (unlock) {
      // Nothing goes back the moment the wallet unlocks: it's when the user is
      // about to act, and a site connected to the account sees it. Each box
      // that came due while it was locked waits a fresh draw inside the
      // stretch the unlock keeps it open, once: one drawn at an unlock before
      // (the wallet locked again first) goes at the next run instead.
      const lockAfter = await this.deps.preferences.lockAfterMs();
      await this.update(network, (s) => {
        for (const t of s.due.filter((d) => d <= now && !s.marks?.[d]?.unlock)) {
          moveDue(s, t, now + unlockWait(lockAfter, random), (m) => (m.unlock = true));
        }
      });
      return [];
    }

    // One box a run. Boxes due together (the wallet stayed locked through
    // their delays) would otherwise go back to back, and a burst of withdraws
    // says they're one owner's: the others each wait a fresh delay of
    // WITHDRAW_SPREAD_MS from now, drawn on its own, and the alarm takes them
    // as they come due while the wallet is unlocked.
    const ready = kept.filter((t) => t <= now);
    const [time] = ready;
    if (time === undefined) return [];
    // Never a box a chain of the wallet's will spend, and in backOrder's turn.
    const reserved = await this.reservedBoxes(network);
    const rows = new Map(pool.map((u) => [outpoint(u), u]));
    const [least] = delayHours((await this.settings()).delay);
    const candidates = free(back, reserved);
    const [box] = backOrder(candidates, rows, ownLeaves(schedule), least, now);
    if (!box) return [];
    // And only once it has waited the delay's least since a mix last moved
    // it: a box a mix moved minutes ago would say which mix it came from.
    // Until one has, the due time waits past the first that will, by a fresh
    // draw, so it isn't the very moment either.
    if (waitedAt(box, rows, least) > now) {
      const first = Math.min(...candidates.map((b) => waitedAt(b, rows, least)));
      await this.update(network, (s) => moveDue(s, time, first + within(WITHDRAW_SPREAD_MS, random)));
      return [];
    }
    // Nor right after something else the wallet sent: in the same run (the
    // next takes it), or within QUIET_AFTER_SEND_MS, which pushes it a fresh
    // few minutes, a few times at most.
    const sent = await this.deps.wallet.withKeys(() => lastSpentAt(this.deps.session, now));
    if (sent !== undefined && since !== undefined && sent >= since) return [];
    const pushes = schedule.marks?.[time]?.pushes ?? 0;
    if (sent !== undefined && now - sent < QUIET_AFTER_SEND_MS && pushes < QUIET_PUSHES) {
      await this.update(network, (s) => moveDue(s, time, now + within(QUIET_PUSH_MS, random), (m) => (m.pushes = pushes + 1)));
      return [];
    }
    if (ready.length > 1) {
      // A fresh draw each, and a fresh start: a later unlock may draw it again.
      const fresh = (m: DueMark) => {
        delete m.unlock;
        delete m.pushes;
      };
      await this.update(network, (s) => {
        for (const t of ready.slice(1)) moveDue(s, t, now + within(WITHDRAW_SPREAD_MS, random), fresh);
      });
    }
    try {
      const pending = await this.withdrawOne(network, pool, box);
      await this.update(network, (s) => {
        const at = s.due.indexOf(time);
        if (at >= 0) s.due.splice(at, 1);
      });
      return [pending];
    } catch (e) {
      // It may have gone through: its due time goes, as a sent one's does.
      if (e instanceof WithdrawMaybeSent) {
        await this.update(network, (s) => {
          const at = s.due.indexOf(time);
          if (at >= 0) s.due.splice(at, 1);
        });
      }
      // Otherwise tried again at the next unlock or alarm.
      return [];
    }
  }

  /**
   * Withdraws one of our boxes now, whatever its delay: `box`, or the one
   * that has waited longest. One not mixed yet only when asked `anyway`:
   * brought back, it ties where it went in to the private balance.
   */
  withdrawNow(network: NetworkName, box?: OutRef, anyway = false): Promise<PendingTx> {
    return this.inTurn(`withdraw.${network}`, () => this.withdrawNowNow(network, box, anyway));
  }

  private async withdrawNowNow(network: NetworkName, box: OutRef | undefined, anyway: boolean): Promise<PendingTx> {
    if (await this.deps.mixingAgain?.(network)) {
      throw new Error("Your boxes are being mixed again. Bring one back once that's done.");
    }
    if (await this.chainsSending(network)) {
      throw new Error("A chain of yours is being sent through Lovejoin. Bring a box back once it's all sent.");
    }
    if (await this.settleWithdrawing(network)) {
      throw new Error("The last box brought back may still be on its way: Koios didn't answer when it was sent. Try again in a few minutes.");
    }
    // Nor while a payment may still go through: Home's banner watches that one until it's settled (pending.ts).
    await settleMaybeSent(this.deps, network);
    const { pool, owned, listed } = await this.ours(network);
    const { unmixed, free: back } = await this.sortOut(network, owned, listed);
    const reserved = await this.reservedBoxes(network);
    let chosen: OutRef | undefined;
    if (box) {
      chosen = owned.find((b) => ref(b) === ref(box));
      if (!chosen) throw new Error("That box isn't in Lovejoin's pool as yours anymore.");
      if (reserved.has(ref(chosen))) throw new Error("A mix you built is about to take that box. Bring it back once that's sent.");
      if (!anyway && unmixed.some((b) => ref(b) === ref(chosen!))) {
        throw new Error(
          "That box wasn't mixed: its chain stopped before mixing it. Brought back now, it shows where it went in. Mix your boxes again first, or bring it back anyway.",
        );
      }
    } else {
      const [least] = delayHours((await this.settings()).delay);
      const rows = new Map(pool.map((u) => [outpoint(u), u]));
      [chosen] = backOrder(free(back, reserved), rows, ownLeaves(await this.read(network)), least, this.deps.now());
      if (!chosen) {
        throw new Error(
          unmixed.length
            ? "Your boxes in Lovejoin's pool weren't mixed yet. Mix them again first, or choose one to bring back anyway."
            : "None of your boxes is in Lovejoin's pool.",
        );
      }
    }
    // The earliest due time goes with a box that had one, sent or maybe sent.
    const dueGoes = () =>
      back.some((b) => ref(b) === ref(chosen!))
        ? this.update(network, (s) => {
            s.due.sort((a, b) => a - b);
            s.due.shift();
          })
        : Promise.resolve();
    let pending: PendingTx;
    try {
      pending = await this.withdrawOne(network, pool, chosen);
    } catch (e) {
      if (e instanceof WithdrawMaybeSent) await dueGoes();
      throw e;
    }
    await dueGoes();
    // Home's banner watches it, as it does every send the user makes; the ones due by themselves stay out of it.
    await watchSent(this.deps, pending);
    return pending;
  }

  /**
   * The pool (a read), the wallet's boxes in it, the real boxes that aren't,
   * and what the wallet's chains will spend, `except` one chain's own, with
   * the boxes to `avoid` (the network didn't know them).
   */
  private async split(network: NetworkName, except?: string, avoid: Set<string> = new Set()): Promise<Split> {
    const { wallet, session, now } = this.deps;
    const [pool, { inputs }] = await Promise.all([
      this.pool(network),
      wallet.withKeys(() => reservedSet(session, network, { except, now: now() })),
    ]);
    const { boxes, otherBoxes } = await this.ownership(network, pool);
    return { pool, owned: boxes, others: otherBoxes, reserved: new Set([...inputs, ...avoid]) };
  }

  /** The pool's real boxes alone, the wallet's and others', that no other chain will spend: what a chain is built from. */
  private real({ pool, owned, others, reserved }: Split): KoiosUtxo[] {
    const real = new Set([...owned, ...others].map(ref));
    return pool.filter((u) => real.has(outpoint(u)) && !reserved.has(outpoint(u)));
  }

  private async owned(network: NetworkName, pool: KoiosUtxo[]): Promise<OutRef[]> {
    return (await this.ownership(network, pool)).boxes;
  }

  /** WebAssembly's reading of the pool: the wallet's boxes, and the real boxes that aren't. */
  private ownership(network: NetworkName, pool: KoiosUtxo[]): Promise<{ boxes: OutRef[]; otherBoxes: OutRef[] }> {
    const request = JSON.stringify({ network, pool });
    return this.deps.wallet.withKeys(
      (keys) => JSON.parse(this.deps.wasm.lovejoinOwned(keys.seedelf, request)) as { boxes: OutRef[]; otherBoxes: OutRef[] },
    );
  }

  private async withdrawOne(network: NetworkName, pool: KoiosUtxo[], box: { txHash: string; txIndex: number }): Promise<PendingTx> {
    const { wasm, wallet, session, now } = this.deps;
    const koios = this.deps.koios(network);
    const params = await koios.epochParams();
    const built = await wallet.withKeys(
      (keys) =>
        JSON.parse(wasm.buildLovejoinWithdraw(keys.seedelf, JSON.stringify({ network, params, pool, boxRef: box }))) as {
          txCbor: string;
          txHash: string;
          fee: string;
          lovelace: string;
        },
    );
    const collateral = await this.deps.collateral(network).witness(built.txCbor);
    const finished = JSON.parse(wasm.finishLovejoinWithdraw(JSON.stringify({ txCbor: built.txCbor, collateral }))) as {
      txCbor: string;
      txHash: string;
    };
    if (finished.txHash !== built.txHash) throw new Error("Signing changed the withdraw, so it wasn't sent.");
    const bytes = hexBytes(finished.txCbor);
    let submitted: string;
    try {
      submitted = await koios.submitTx(bytes);
    } catch (e) {
      if (!(e instanceof KoiosBusyError)) throw e;
      // It may be in: its box counts as spent, and it's kept, sealed, to be looked for (settleWithdrawing).
      await wallet.withKeys(() => rememberSpent(session, network, bytes, now()));
      const at = now();
      await this.update(network, (s) => {
        s.withdrawing = { txHash: built.txHash, txCbor: finished.txCbor, lovelace: built.lovelace, fee: built.fee, at, sentAt: at };
      });
      throw new WithdrawMaybeSent();
    }
    if (submitted !== built.txHash) throw new Error(`Koios answered with another transaction id (${submitted}).`);
    await wallet.withKeys(async () => {
      await rememberSpent(session, network, bytes, now());
      await session.remove(SESSION_BALANCES_PREFIX + network);
    });
    const pending: PendingTx = { kind: "lovejoin-withdraw", network, txHash: built.txHash, submittedAt: now(), confirmations: null };
    await this.deps.activity?.sent(network, pending, { lovelace: built.lovelace, fee: built.fee }).catch(() => undefined);
    return pending;
  }

  /**
   * A withdraw Koios didn't answer may have gone through, so it's looked for
   * (tx_status) before any other is built. On chain, it goes in the history,
   * and that's that. Not yet, it's sent again as it was, at most every
   * CHAIN_RESEND_MS (the ledger takes it once). After SPENT_KEEP_MS it never
   * went: its box shows in the pool again, and comes back in turn. Returns
   * whether it's still being looked for. `unlock`: it's only looked for,
   * never sent again the moment the wallet unlocks (privacy review §3.1).
   */
  private async settleWithdrawing(network: NetworkName, unlock = false): Promise<boolean> {
    const { withdrawing: w } = await this.read(network);
    if (!w) return false;
    const koios = this.deps.koios(network);
    const now = this.deps.now();
    const drop = () =>
      this.update(network, (s) => {
        if (s.withdrawing?.txHash === w.txHash) delete s.withdrawing;
      });
    const seen = (await koios.txStatus([w.txHash]).catch(() => undefined))?.get(w.txHash);
    if (seen != null) {
      const pending: PendingTx = { kind: "lovejoin-withdraw", network, txHash: w.txHash, submittedAt: w.at, confirmations: seen };
      await this.deps.activity?.sent(network, pending, { lovelace: w.lovelace, fee: w.fee }).catch(() => undefined);
      await this.deps.wallet.withKeys(() => this.deps.session.remove(SESSION_BALANCES_PREFIX + network));
      await drop();
      return false;
    }
    // Koios didn't answer this either: looked for again next time.
    if (seen === undefined) return true;
    if (now - w.at >= SPENT_KEEP_MS) {
      await drop();
      return false;
    }
    if (!unlock && now - w.sentAt >= CHAIN_RESEND_MS) {
      // Refused as spent, it's in the mempool already, or its box moved: either way it's looked for again.
      await koios.submitTx(hexBytes(w.txCbor)).catch(() => undefined);
      await this.update(network, (s) => {
        if (s.withdrawing?.txHash === w.txHash) s.withdrawing.sentAt = now;
      });
    }
    return true;
  }

  private async read(network: NetworkName): Promise<Schedule> {
    const kept = await this.deps.store.get<Partial<Schedule>>(`lovejoin.${network}` as const);
    const record = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
    return {
      due: Array.isArray(kept?.due) ? kept.due.filter((t) => typeof t === "number") : [],
      // Kept before chains were recorded: none.
      chains: Array.isArray(kept?.chains) ? kept.chains : [],
      ...(typeof kept?.notMixed === "number" ? { notMixed: kept.notMixed } : {}),
      ...(kept?.withdrawing ? { withdrawing: kept.withdrawing } : {}),
      // Kept before due times were drawn again, or leaves kept: none.
      ...(record(kept?.marks) ? { marks: { ...kept!.marks } } : {}),
      ...(record(kept?.leaves) ? { leaves: { ...kept!.leaves } } : {}),
    };
  }

  /**
   * Changes the sealed schedule, one change at a time: the runner, the chains
   * and the page never undo each other's. A due time's marks go with it. One
   * that holds nothing isn't kept where none was: opening the Lovejoin tile on
   * a network the wallet hasn't used leaves nothing behind (§2.18).
   */
  private update(network: NetworkName, change: (s: Schedule) => void): Promise<void> {
    return this.inTurn(`lovejoin.${network}`, async () => {
      const key = `lovejoin.${network}` as const;
      const schedule = await this.read(network);
      change(schedule);
      const marks = Object.entries(schedule.marks ?? {}).filter(([t]) => schedule.due.includes(Number(t)));
      if (marks.length) schedule.marks = Object.fromEntries(marks);
      else delete schedule.marks;
      if (empty(schedule) && (await this.deps.store.get(key)) === undefined) return;
      await this.deps.store.set(key, schedule);
    });
  }
}
