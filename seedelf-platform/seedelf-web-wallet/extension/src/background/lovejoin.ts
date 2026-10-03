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
// own send (QUIET_AFTER_SEND_MS), one a lock or a closed browser made it
// forget included. One box a run: others due at the same time wait a fresh
// short delay each (WITHDRAW_SPREAD_MS), so a wallet locked for hours
// doesn't send them all in one burst. The box that goes is one that has
// waited the delay's least since a mix last moved it, and its own chain's
// delay's least (a swap's as approved) since that chain went in, or, moved
// by someone else's mix since, the longest of those of the chains that went
// in before that move; one someone else's mix has moved since the wallet's
// chain left it if there is one (§3.6); and then the one that has waited
// longest in the pool.
// Boxes aren't remembered, they're found: other people's mixes
// move them, and the Seedelf key's check finds them wherever they are, after a
// restore too. What's kept, sealed (`lovejoin.<network>`), is the due times
// and each chain the wallet sends: its deposit, its mixes and its leaves,
// recorded before any of it is sent. A restore (Remove wallet, Forgot
// password, another browser or device) has none of those records, so a box
// no record accounts for, found when more could come back than there are
// due times, is known by the transaction that made it (tx_info): a mix made
// it, and it comes back as any box does; a deposit did, and it's held, not
// mixed yet, as a recorded chain's box is; paid by the public account, it's
// the account's. Until Koios says, it's held, and asked of again at each
// pool read (independent review M14).
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
// five minutes (room, §2.7); a withdraw is giveme.my plus one submit. After
// a restore, one tx_info with a pool read, for the transactions that made
// the boxes no record accounts for, each asked of once, or again at each
// read until Koios answers for it (found). And in any wallet, where a box is
// taken (Mix my boxes again, a chain's build, Bring one back now, a box
// coming back by itself), one tx_info for the boxes it may take whose making
// isn't known yet: a box someone else's mix moved has no record (made,
// independent review M14).

import { t } from "../i18n";
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
import { SESSION_ACCOUNT_ADDRESSES_PREFIX, type AccountAddresses } from "./activity";
import { txInputs } from "./cbor";
import { GAP_LIMIT } from "./chain";
import { KoiosBusyError, KoiosError, SpentInputError, TXS_PER_REQUEST, type Koios, type KoiosTxSpends, type KoiosUtxo } from "./koios";
import { settleMaybeSent, watchSent } from "./pending";
import type { PreferencesService } from "./preferences";
import { UnreadableRecordError, type PrivateStore } from "./private-store";
import type { ScriptSpendDeps } from "./script-spend";
import {
  forgetSpent,
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
import { SESSION_BALANCES_PREFIX, SESSION_PRIVATE_STALE_PREFIX } from "./wallet";
import { isTrap } from "./wasm";

/** chrome.storage.session: a mix from the public account, built and signed, waiting for Send. */
export const SESSION_LOVEJOIN_PUBLIC = "seedelf.lovejoin.public";
/** chrome.storage.session: a mix from the public account being sent, a window at a time, per network: `seedelf.lovejoin.sending.<network>`. */
export const SESSION_LOVEJOIN_SENDING = "seedelf.lovejoin.sending.";

/** A built mix is only sent within this long; after that, build again. */
const BUILT_TTL_MS = 10 * 60_000;

/**
 * Ends the refusal when Lovejoin's pool is under its floor and the public
 * account could seed it instead. The Lovejoin page matches on it to offer
 * that, so the worker and the page keep one wording between them. It lived in
 * `networks.ts` until chunk 19: that module is imported by `vite.config.ts`
 * (through `manifest.ts`), so a `t()` there pulled i18next and all three
 * locale files into the build's own config graph.
 */
export const POOL_SEEDABLE = () => t("lj.poolSeedable");

/** A mix from the public account is built or sent while the last one from it is still being sent. */
const PUBLIC_STILL_SENDING = () => t("lj.mixSending");
/** The mix kept for Send isn't the one asked for, or something took its place since. */
const NOT_READY = () => t("lj.mixNotReady");
/**
 * A mix from the public account is built while a transaction of the last one
 * may have gone through, unseen yet, and the wallet is sure of it `left` ms
 * from now at the latest: one that never reached a node shows nothing, so
 * it's only known never to have gone once the wallet stops holding what it
 * spends (SPENT_KEEP_MS, two hours), and the copy says so (independent
 * review L5). Past that, only Koios not answering keeps it unsure.
 */
const publicMaybeWait = (left: number) => {
  if (left <= 0) {
    return t("lj.mixMaybeNoKoios");
  }
  const minutes = Math.max(1, Math.ceil(left / 60_000));
  const hours = Math.floor(minutes / 60);
  const hoursText = (n: number) => t("lj.hours", { count: n });
  const minutesText = (n: number) => t("lj.minutes", { count: n });
  const about = hours ? `${hoursText(hours)}${minutes % 60 ? ` ${minutesText(minutes % 60)}` : ""}` : minutesText(minutes);
  return t("lj.mixMaybeWait", { about });
};

/**
 * A mix from the public account stopped at a transaction that may have gone
 * through: the progress Home, the UTxOs page and the Lovejoin page ask for
 * looks for it (tx_status, and utxo_info when that says nothing) at most this
 * often on a network, as the alarm does a payment that may still go through.
 * Its Review and Send look each time (independent review L5).
 */
export const PUBLIC_LOOK_MS = 2 * 60_000;

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
  // One still waiting in a mempool is refused, and tried again until it lands
  // (CHAIN_SPENT_TRIES), so under heavy congestion all of them together can
  // take longer than Chrome lets one request run. Chrome then stops the
  // worker partway: what went is saved (`sending`, `sentAt`), and the next
  // call goes on from there, at worst stopping the chain at a `next` refused
  // again, as a send that can't go does (independent review L25).
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
    super(CHAIN_CUT());
  }
}

/** The network measured a chain's scripts differently from the wallet: the chain doesn't start. */
export class LovejoinSkipped extends Error {
  constructor(readonly reason: string) {
    super(t("lj.leftOut", { reason }));
  }
}

/**
 * The network doesn't know an input a chain's first mix spends: the pool
 * read was behind (a Koios backend lagging, or a box someone mixed since).
 * `unknown`: the inputs it names, when it does.
 */
class StalePool extends Error {
  constructor(readonly unknown: string[]) {
    super(t("lj.stalePool"));
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
  /** Of those, how many Koios hasn't said the making of yet, after a restore (found): they may be mixed (M14). */
  unsure?: number;
  /** A withdraw whose submit Koios didn't answer: it may have gone through, and is looked for before another is built. */
  withdrawing?: Withdrawing;
  /** What put a due time off, by the time (ms): so none is put off for good. */
  marks?: Record<string, DueMark>;
  /**
   * The unlock (the wallet's `unlockedAt`) whose fresh draws were made: each
   * box due by then waits one, whichever run gets here first after it
   * (unlockDraws, independent review L10).
   */
  unlock?: number;
  /**
   * The leaves of chains whose records went (RECORD_KEEP_MS), `txhash#index`,
   * and whose chain made each (chainOwner): kept while the box is still
   * there, unmoved, so the box brought back is one someone else's mix has
   * moved since (backOrder, privacy review §3.6).
   */
  leaves?: Record<string, string>;
  /** What made each box no record accounts for, as Koios said, by the transaction that made it (found). */
  origins?: Record<string, Origin>;
  /**
   * The transactions that made boxes no record accounts for that a pool read
   * asked Koios of and it didn't answer for, or didn't know: each is asked
   * of again at every pool read, however many due times there are, and its
   * boxes are held until Koios says (found). By transaction, when a pool
   * read last listed a box it made (ms), which goes as an Origin's `seen`
   * does. Not those asked of only where a box is taken (made).
   */
  asking?: Record<string, number>;
}

/**
 * What made one of the wallet's boxes that no record of its accounts for: a
 * restore (Remove wallet, Forgot password, another browser or device) has
 * none of its chains' records. Read from the transaction that made it
 * (tx_info), once, and kept, sealed, by that transaction (independent review
 * M14).
 */
interface Origin {
  /**
   * One of its inputs sat at Lovejoin's mix_box: a mix made it, so it was
   * mixed once at least, and it comes back as any box does. A chain cut after
   * its first mix counts as mixed here, though the device that sent it holds
   * a box its later mixes didn't reach as not mixed yet (unmixedOf): the
   * record that says so is gone. None did: a deposit made it, so it was never
   * mixed, and it's held as a recorded chain's box not mixed yet is.
   */
  mixed: boolean;
  /**
   * One of its inputs was the public account's: its box, as one a mix from
   * the account put in is (fromPublic), which the private balance never pays
   * to mix unless asked (privacy review §2.10).
   */
  public?: true;
  /**
   * When a pool read last listed a box it made (ms). It goes RECORD_KEEP_MS
   * after, as a chain's record does: a listing that's behind may not show a
   * box yet, and one looked up again costs a request.
   */
  seen: number;
}

/**
 * How far along each of the public account's chains its payment keys are
 * looked for, when an input of a transaction that made a box carries the
 * account's stake key under a payment key the wallet doesn't know (madeBy):
 * a thousand key hashes at most, about a fifth of a second, once for each
 * such transaction.
 */
const FARTHER_KEYS = 500;

/** Why a due time was drawn again. */
interface DueMark {
  /**
   * At an unlock: a later unlock doesn't draw it again, so it goes at the
   * next run (privacy review §3.1). A push for a send the wallet forgot
   * leaves the next unlock its draw (quiet, independent review M10).
   */
  unlock?: true;
  /** How often the wallet's own sends pushed it: after QUIET_PUSHES, it goes anyway. */
  pushes?: number;
}

/**
 * A withdraw that may have gone through, signed as it was sent, and when it
 * was sent first and last (ms). Kept before it's first sent, so a lock, a
 * closed browser or a stopped worker while Koios is asked never loses it
 * (independent review M1).
 */
interface Withdrawing {
  txHash: string;
  txCbor: string;
  lovelace: string;
  fee: string;
  at: number;
  sentAt: number;
  /**
   * Not sent again before this (ms): a fresh draw at an unlock, or the
   * wallet's own send was too close (independent review M11).
   */
  waitUntil?: number;
  /** How often its own sends put it off since it was last sent: after QUIET_PUSHES, it goes anyway. */
  pushes?: number;
  /** Its wait was drawn at an unlock: a later unlock doesn't draw it again (DueMark `unlock`). */
  unlock?: true;
  /**
   * The due time its box had, taken out of `due` as this was kept: it goes
   * with the box once the withdraw went, and is back once it never did
   * (dropWithdrawing). So a record a lock kept in place never leaves a
   * second due time behind for a box already gone (final review F5).
   */
  due?: number;
}

/** Koios didn't answer a withdraw's submit: it may have gone through. */
class WithdrawMaybeSent extends Error {
  constructor(
    message = t("lj.boxMaybeSent"),
  ) {
    super(message);
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
  /**
   * A seed: a deposit with no mixes (publicBuild's `seed`). Its boxes sit in
   * the pool with no due time, for other people to mix with, until the user
   * brings one back: `sortOut` holds deposits back, and no due times are
   * drawn for it when it lands.
   */
  seed?: boolean;
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
   * Once it stopped: how many of its boxes a pool read last found it left not
   * mixed yet, still the wallet's, and whether one ever found any of them
   * (`found`). Found, none left since, and nothing of it that may still have
   * gone through: it has nothing more to ask of the user, and the Lovejoin
   * page and Home no longer show it, while the record lives out its
   * RECORD_KEEP_MS for the rules that read it (shown). One whose boxes no
   * read has found yet (its deposit not in yet) is still shown.
   */
  left?: number;
  found?: true;
  /** How long its boxes wait, as its return was approved or reviewed; Settings' when none (independent review L21). */
  delay?: LovejoinDelay;
  /**
   * A mix from the public account's transaction that may have gone through
   * (independent review L5): the one it stopped at when Koios didn't answer
   * it (`unanswered`); or its first, which spends the account, marked from
   * just before it's first sent until it's known to have gone (chainSent) or
   * an answer says it never did, so a lock or a closed browser meanwhile
   * leaves it looked for. Its index, hash, what it spends, and when (ms).
   * Once the mix ended, and until it's settled (publicUnsettled), no other
   * mix from the account is built.
   */
  maybe?: { index: number; txHash: string; inputs: string[]; at: number; unanswered?: true };
}

/**
 * A mix from the public account's transaction that may have gone through,
 * unsettled when the wallet was removed (ChainRecord `maybe`): kept, sealed,
 * on its own through Remove wallet (private-store.ts KEPT_ON_RESET), so the
 * same phrase restored here looks for it before another mix from the
 * account is built (keepOnReset, final review F1).
 */
interface KeptMaybe {
  txHash: string;
  inputs: string[];
  at: number;
}

/** The record KeptMaybe is sealed in, on `network`. */
const keptMaybeName = (network: NetworkName) => `lovejoinMaybe.${network}` as const;

/** Why a chain whose progress is gone stopped: nothing is sending the rest. */
export const CHAIN_CUT = () => t("lj.chainCut");

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
  /**
   * The next transaction, when a try of it may have reached a node (Koios
   * didn't answer it): kept with the progress, not only in one call, so a
   * resend of those before it (pumpChain, independent review L25) never
   * loses that, and a later call whose tries of it are all refused still
   * stops as "may have gone through" (final review F10). Goes once a send
   * of it goes.
   */
  reached?: number;
}

/** What a chain's transaction `i` is called, where a stop says which went and which may have. */
const stepName = (txs: LovejoinChain["txs"], i: number) =>
  txs[i]?.kind === "deposit" ? t("lj.step.deposit") : t("lj.step.transaction", { number: i + 1, total: txs.length });

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
 * payment says both are one owner's. A lock keeps the last one's time,
 * and a closed browser wipes it unseen, so one before the browser started
 * again may have been as late as that (wallet.ts `sends`, independent
 * review M10). It's pushed a fresh QUIET_PUSH_MS instead, at most
 * QUIET_PUSHES times, and then goes anyway, so none waits for good.
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

/**
 * Whether a withdraw at `now` would be too close to the wallet's own send
 * (QUIET_AFTER_SEND_MS): "sent", its last send (`sent`) was; "forgotten",
 * a send it forgot may have been (`forgotten`, a closed browser's): a guess,
 * so the push it makes leaves the next unlock its draw (DueMark `unlock`).
 * 0 for none. Undefined when neither.
 */
function quiet(now: number, sent: number, forgotten: number): "sent" | "forgotten" | undefined {
  if (now - sent < QUIET_AFTER_SEND_MS) return "sent";
  if (now - forgotten < QUIET_AFTER_SEND_MS) return "forgotten";
  return undefined;
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
 * Whether a record of the wallet's accounts for a box: one of its recorded
 * chains made it (its leaves too), or left it where it is (`leaves`, kept
 * after the record went).
 */
function recorded(s: Schedule): (b: OutRef) => boolean {
  const made = new Set(s.chains.flatMap((c) => [...(c.deposit ? [c.deposit] : []), ...c.mixes]));
  return (b) => made.has(b.txHash) || s.leaves?.[ref(b)] !== undefined;
}

/**
 * Whether what made box `b` is known: a record of the wallet's accounts for
 * it (recorded), or Koios said (`origins`). Only such a box is taken into a
 * mix again from the private balance or brought back, and it isn't asked of
 * again (made, independent review M14).
 */
function knownOf(s: Schedule): (b: OutRef) => boolean {
  const known = recorded(s);
  return (b) => known(b) || s.origins?.[b.txHash] !== undefined;
}

/**
 * Whether box `b` may come back as a mixed box: a record of the wallet's
 * accounts for it (recorded: one its chain left not mixed yet is held
 * apart, unmixedOf), or Koios said a mix made it. Never one Koios said a
 * deposit made: a withdraw checks this against the schedule as it is when
 * it takes a box, since another lookup (Mix my boxes again pressed on the
 * page) can keep a deposit's answer after its boxes were sorted out
 * (independent review M14).
 */
function mixedOf(s: Schedule): (b: OutRef) => boolean {
  const known = recorded(s);
  return (b) => known(b) || s.origins?.[b.txHash]?.mixed === true;
}

/** The boxes of `owned` no record accounts for that a deposit made, as Koios said (`origins`): not mixed yet. */
function depositsOf(s: Schedule, owned: OutRef[], origins: Record<string, Pick<Origin, "mixed">> = s.origins ?? {}): OutRef[] {
  const known = recorded(s);
  return owned.filter((b) => !known(b) && origins[b.txHash]?.mixed === false);
}

/** The wallet's boxes not mixed yet, as its records and what Koios said of the others have them: mixing again takes them first. */
const notMixedYet = (s: Schedule, owned: OutRef[]) => [...unmixedOf(s.chains, owned), ...depositsOf(s, owned)];

/**
 * Whether more of the boxes of `owned` could come back than `s` has due
 * times for: some were found with none, which a restore's boxes are (found).
 * So are some after Mix my boxes again took boxes not mixed yet, which had
 * none: the due times its first mix took for them were other boxes' (chainSent).
 * A chain with a deposit being sent set all its boxes' due times as its
 * deposit went in (chainSent), while some of its boxes are still mixing or
 * on their way: its boxes in the pool (its deposit's and its mixes', the
 * leaves it has reached too) are left out of the count, and as many of its
 * due times as Koios lists boxes of its (`listed`), so a box a restore found
 * while one is sent (a swap's return, say) is looked up too (independent
 * review M14). As listed, not as `owned` has them: a box its own mix spends
 * is listed until that mix is in, and only then the box that mix made, so
 * no box of its on its way leaves its due time to a box no record accounts
 * for. All its due times while Koios lists none of its boxes: its deposit
 * isn't in yet. A box of its someone else's mix moved since is no longer
 * listed as its, and the box that mix made is counted as the wallet's
 * other boxes are, with the due time it kept, so a wallet in its steady
 * state asks nothing then either (every one moved, the boxes are looked up,
 * as they are once the chain stops). Not Mix my boxes again's:
 * the boxes it takes are the wallet's own, counted as they are until the mix
 * that spends each is sent, and it takes as many due times as it sets
 * (chainSent), so the count holds as it goes, and a wallet in its steady
 * state asks nothing while it's sent.
 *
 * Only the pool reads go by it (status, and withdrawDue's schedule): a count
 * can miss a box, a chain's last mix a node dropped after it was all sent
 * leaving its due time to one a restore found, say. Where a box is taken, it
 * isn't relied on: what made each is asked of then (made).
 */
function moreThanDue(s: Schedule, owned: OutRef[], listed: OutRef[]): boolean {
  const held = new Set(notMixedYet(s, owned).map(ref));
  const sending = s.chains.filter((c) => !c.ended && c.scheduled && c.deposit);
  const made = new Set(sending.flatMap((c) => [c.deposit!, ...c.mixes]));
  const theirs = new Set(owned.filter((b) => made.has(b.txHash)).map(ref));
  const back = owned.filter((b) => !held.has(ref(b)) && !theirs.has(ref(b))).length;
  const theirDue = sending.reduce((n, c) => {
    const its = new Set([c.deposit!, ...c.mixes]);
    const found = listed.filter((b) => its.has(b.txHash)).length;
    return n + (found ? Math.min(c.boxes, found) : c.boxes);
  }, 0);
  return back > s.due.length - theirDue;
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
 * restore, or someone else's mix moved it since). After a restore, the
 * public account's when the transaction that made it spent the account's
 * (Origin `public`).
 */
function originOf(b: OutRef, s: Schedule): string | undefined {
  const made = s.chains.find((c) => c.deposit === b.txHash || c.mixes.includes(b.txHash));
  if (made) return chainOwner(made.session);
  return s.leaves?.[ref(b)] ?? (s.origins?.[b.txHash]?.public ? chainOwner() : undefined);
}

/**
 * Whether the Lovejoin page and Home show chain `c`: one being sent, or one
 * that stopped with something still to do: boxes it left not mixed yet, a
 * transaction that may have gone through, or boxes no pool read has found
 * yet. One whose boxes were found, and all mixed again or brought back since,
 * isn't.
 */
const shown = (c: ChainRecord) => !c.done && !(c.stopped && c.ended && c.found && c.left === 0 && !c.maybe);

/**
 * When chain `c`'s boxes may come back by its own wait (ms): its recorded
 * delay's least (a swap's as approved, a return's as reviewed) from when it
 * went in. 0 when it recorded none: Settings' least, since a mix last moved
 * a box, is the rule then (backOrder).
 */
const ownWaitAt = (c: ChainRecord) => (c.delay ? c.at + delayHours(c.delay)[0] * HOUR : 0);

/**
 * How far this device's clock (a chain's `at`) and the chain's (a box's
 * `block_time`) may be apart, as ripeAt asks which chains went in before a
 * box last moved: one recorded up to that much after still counts.
 */
const CLOCKS_APART_MS = 10 * 60_000;

/**
 * When box `b` may come back by the wait of the recorded chain that put it
 * where it is (ownWaitAt): another chain's earlier due time, drawn from a
 * shorter delay, never brings it back first (final review F9). A box whose
 * chain the wallet can't tell, someone else's mix having moved it since
 * (as §3.6 prefers), may be any recorded chain's that went in before that
 * move (Koios's `block_time` in `rows`): it waits the longest of theirs.
 * 0 at a leaf a record that went left (sortOut keeps one until its own wait
 * is over), or when no recorded chain went in before (a restore).
 */
function ripeAt(b: OutRef, s: Schedule, rows: Map<string, KoiosUtxo>): number {
  const made = s.chains.find((c) => c.deposit === b.txHash || c.mixes.includes(b.txHash));
  if (made) return ownWaitAt(made);
  if (s.leaves?.[ref(b)] !== undefined) return 0;
  // Unknown when it last moved: it may be any recorded chain's.
  const time = rows.get(ref(b))?.block_time;
  const moved = time === undefined ? Infinity : time * 1000 + CLOCKS_APART_MS;
  return Math.max(0, ...s.chains.filter((c) => c.at <= moved).map(ownWaitAt));
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

/**
 * Takes due time `due`, or the earliest, out of the schedule (its marks go
 * with it): a withdraw about to be sent holds it (Withdrawing `due`).
 * Undefined when there's none.
 */
function takeDue(s: Schedule, due: number | "earliest" | undefined): number | undefined {
  if (due === undefined || !s.due.length) return undefined;
  s.due.sort((a, b) => a - b);
  const at = due === "earliest" ? 0 : s.due.indexOf(due);
  return at < 0 ? undefined : s.due.splice(at, 1)[0];
}

/** Whether a schedule holds nothing: no record is kept for it (privacy review §2.18). */
const empty = (s: Schedule) =>
  !s.due.length &&
  !s.chains.length &&
  !s.notMixed &&
  !s.withdrawing &&
  !Object.keys(s.leaves ?? {}).length &&
  !Object.keys(s.origins ?? {}).length &&
  !Object.keys(s.asking ?? {}).length;

/** How long a swap's review uses a reading of the pool again (room): reviews in a row ask Koios once. */
export const POOL_ROOM_MS = 5 * 60_000;

/**
 * A whole number of boxes, one to `most`, or why not. A mix is capped at
 * MAX_MIX_BOXES because each box costs a wave of mix transactions and the
 * chain has to be sent one after another. A seed makes no mixes at all: it's
 * one deposit, so only the transaction's size caps it (MAX_DEPOSIT_BOXES).
 */
export function checkBoxes(boxes: number, most: number = MAX_MIX_BOXES): void {
  if (!Number.isInteger(boxes) || boxes < 1 || boxes > most) {
    throw new Error(t(most === MAX_MIX_BOXES ? "lj.boxRange.mix" : "lj.boxRange.seed", { most }));
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
  /** When progress last looked for a public mix's transaction that may have gone through, by network (PUBLIC_LOOK_MS). */
  private looked = new Map<NetworkName, number>();
  /**
   * Withdraws that never went (refused, or not sent at all) whose sealed
   * record a lock kept the wallet from dropping then (withdrawOne), by hash:
   * dropped at the next look, never sent again as one that may have gone
   * (dropRefused, final review F5). In memory, which a lock doesn't clear.
   * A worker that stopped since forgot them: such a record is then looked
   * for, and sent again under a new withdraw's rules, as one Koios didn't
   * answer is (independent review M11).
   */
  private refused = new Set<string>();

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
    // Stopped at a transaction that may have gone through: looked for first, now and then, and said as it now stands.
    if (s?.maybe !== undefined && this.lookDue(network)) {
      await this.publicUnsettled(network).catch(() => undefined);
      s = await this.sendingOf(network);
    }
    const maybe = (m: unknown) => (m !== undefined ? { maybeSent: true as const } : {});
    if (s) return { total: s.txs.length, sent: s.next, ...(s.stopped ? { stopped: s.stopped } : {}), ...maybe(s.maybe) };
    // Its progress is gone: a lock, a closed browser or an update cut it, and its record says how far it got.
    if (!this.available(network)) return null;
    await this.cuts(network);
    const lastOf = async () => (await this.read(network)).chains.filter((c) => c.session === undefined).at(-1);
    let last = await lastOf();
    if (last?.maybe && this.lookDue(network)) {
      await this.publicUnsettled(network).catch(() => undefined);
      last = await lastOf();
    }
    return last?.stopped ? { total: last.total, sent: last.sent, stopped: last.stopped, ...maybe(last.maybe) } : null;
  }

  /**
   * Whether progress looks for a public mix's transaction that may have gone
   * through now: at most every PUBLIC_LOOK_MS on a network, however often
   * Home and the UTxOs page ask. Counted as it's asked, so calls at once look
   * once.
   */
  private lookDue(network: NetworkName): boolean {
    const now = this.deps.now();
    const last = this.looked.get(network);
    if (last !== undefined && now >= last && now - last < PUBLIC_LOOK_MS) return false;
    this.looked.set(network, now);
    return true;
  }

  /** Whether Lovejoin is deployed on `network` (networks.ts: the UI's gate is the same). */
  available(network: NetworkName): boolean {
    return lovejoinOn(network);
  }

  async settings(): Promise<{ depth: LovejoinDepth; delay: LovejoinDelay }> {
    const p = await this.deps.preferences.get();
    return { depth: p.lovejoinDepth, delay: p.lovejoinDelay };
  }

  /** The pool as Koios lists it (a read), and what the wallet's sent transactions spend. */
  private async listing(network: NetworkName): Promise<{ rows: KoiosUtxo[]; spent: Set<string> }> {
    const hash = NETWORKS[network].lovejoin?.mixBox;
    if (!hash) throw new Error(t("lj.notOnNetwork"));
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
  private async ours(
    network: NetworkName,
  ): Promise<{ pool: KoiosUtxo[]; owned: OutRef[]; listed: OutRef[]; others: OutRef[] }> {
    const { rows, spent } = await this.listing(network);
    const { boxes: listed, otherBoxes } = await this.ownership(network, rows);
    const pool = unspent(rows, spent);
    return {
      pool,
      owned: listed.filter((b) => !spent.has(ref(b))),
      listed,
      // What the floor counts: real boxes that aren't ours and aren't spent.
      others: otherBoxes.filter((b) => !spent.has(ref(b))),
    };
  }

  /**
   * How many boxes session `index`'s `rows` pay for at the set depth (`again`: the mixes alone), or at
   * `fixed`, the depth a swap was approved with (independent review L21).
   */
  async plan(
    network: NetworkName,
    index: number,
    rows: KoiosUtxo[],
    collateral: KoiosUtxo,
    again = false,
    fixed?: LovejoinDepth | 0,
  ): Promise<LovejoinPlan> {
    const depth = fixed ?? (await this.settings()).depth;
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
    // The tile's own mix (mixOutBuild) is the one place this is asked, so a
    // short pool here can say the public account could seed it instead. A
    // session's return never comes through here: it falls back to direct.
    this.floor(network, others.length, true);
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
   * ties the two. It asks Koios first what made each box no record accounts
   * for, and refuses while Koios can't say (made, independent review M14).
   */
  async againBoxes(network: NetworkName, publicToo = false): Promise<{ boxes: number; owned: number }> {
    const { depth } = await this.settings();
    const split = await this.split(network);
    const { reserved } = split;
    if (!split.owned.length) throw new Error(t("lj.noneToMixAgain"));
    // What made each box no record accounts for says which the account put in: asked of now, whatever the pool
    // reads' count says, and none is paid for from the private balance while Koios hasn't said (independent review M14).
    if (!publicToo && (await this.made(network, split.owned)).untold.length) {
      throw new Error(
        t("lj.untoldSome"),
      );
    }
    const owned = publicToo ? split.owned : this.privately(split.owned, await this.read(network));
    if (!owned.length) {
      throw new Error(
        t("lj.privacy.fromAccount"),
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
    return t("lj.floorShort", { count: others, floor });
  }

  /**
   * Throws why, when the pool is below its floor (floorShort). `seedable`:
   * the public account could put boxes in instead, which needs no others, so
   * the refusal says so rather than only "try again later".
   */
  private floor(network: NetworkName, others: number, seedable = false): void {
    const short = this.floorShort(network, others);
    if (short) throw new Error(`${short}. ${seedable ? POOL_SEEDABLE() : t("lj.tryLater")}`);
  }

  /** Whether `others` boxes in the pool mix `boxes` boxes at the set depth, or why not. */
  private async enough(others: number, boxes: number): Promise<void> {
    const { depth } = await this.settings();
    const needed = boxes * mixesPerBox(depth) * 2;
    if (others < needed) {
      throw new Error(
        t("lj.notEnough", { others, count: boxes, depth, needed }),
      );
    }
  }

  /**
   * What mixing `boxes` boxes at the set depth takes, before anything is built (`again`: the mixes alone), or
   * at `fixed`, the depth a swap was approved with (independent review L21).
   */
  async funding(network: NetworkName, boxes: number, again = false, fixed?: LovejoinDepth | 0): Promise<LovejoinFunding> {
    const set = await this.settings();
    const { delay } = set;
    const depth = fixed ?? set.depth;
    const found = JSON.parse(this.deps.wasm.lovejoinFunding(JSON.stringify({ network, boxes, depth, again }))) as Omit<
      LovejoinFunding,
      "depth" | "delay" | "boxes" | "again"
    >;
    return { ...found, boxes, depth, delay, ...(again ? { again } : {}), ...(depth === 0 ? { seed: true } : {}) };
  }

  /**
   * Session `index`'s whole chain through Lovejoin, or nothing when Lovejoin
   * isn't here or its spare ADA doesn't pay for a box (the return is plain).
   * The return at its end merges into `merge`, the funding's change. `boxes`:
   * at most this many (a mix session's), else all the spare ADA pays for.
   * `again`: the wallet's boxes in the pool mixed again, with no deposit.
   * `own`: the session's own transactions, whose UTxOs the return takes
   * first. `publicToo`: mixing again takes the boxes a mix from the public
   * account put in too (againBoxes). `fixed`: the depth a swap was approved
   * with, rather than Settings' now (independent review L21). Throws
   * LovejoinSkipped when the network measures its first mix differently.
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
    fixed?: LovejoinDepth | 0,
  ): Promise<LovejoinChain | undefined> {
    if (!this.available(network) || !collateral) return undefined;
    const plan = await this.plan(network, index, rows, collateral, again, fixed);
    const count = Math.min(plan.boxes, boxes ?? plan.boxes);
    if (count < 1) return undefined;
    const depth = fixed ?? (await this.settings()).depth;
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
    // A seed (depth 0) makes no mixes, so it draws nothing from the pool and
    // the floor doesn't apply: this is where a chain is really built, and
    // gating it here is what made a seed fund a session and return it unspent.
    const short = depth === 0 ? undefined : this.floorShort(network, split.others.length);
    if (short) throw new LovejoinSkipped(short);
    // Mixing again from the private balance never takes a box a mix from the public account put in, unless asked
    // (againBoxes), nor one whose making no record accounts for and Koios hasn't said: each it may take is asked of
    // now, whatever the pool reads' count says, and one Koios can't say of is left out: it may be the account's (M14).
    const untold = again && !publicToo ? (await this.made(network, free(split.owned, split.reserved))).untold : [];
    const schedule = await this.read(network);
    const left = new Set(again && !publicToo ? [...fromPublic(split.owned, schedule), ...untold].map(ref) : []);
    const owned = free(split.owned, split.reserved).filter((b) => !left.has(ref(b)));
    const others = free(split.others, split.reserved);
    if (again) {
      if (!owned.length) {
        throw new LovejoinSkipped(
          untold.length
            ? t("lj.untoldAll")
            : t("lj.noneLeft"),
        );
      }
      count = Math.min(count, owned.length);
    }
    // Each mix takes two boxes from the pool, never one twice, and never one of ours.
    const perBox = mixesPerBox(depth);
    if (others.length < perBox * 2) {
      throw new LovejoinSkipped(t("lj.needsMore", { others: others.length, needed: perBox * 2 }));
    }
    // One chain is at most MAX_CHAIN_MIXES long, and one deposit makes at most MAX_DEPOSIT_BOXES,
    // whatever the spare ADA pays for: what's left comes back with the return.
    const most = again ? Math.floor(MAX_CHAIN_MIXES / perBox) : chainBoxes(depth);
    count = Math.min(count, Math.floor(others.length / (perBox * 2)), most);
    // Mixing again takes the wallet's boxes in the pool's order: the ones not mixed yet go first, those a restore
    // found a deposit made too (independent review M14).
    const unmixed = new Set(notMixedYet(schedule, owned).map(ref));
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
          throw new KoiosError(t("lj.poolDrifted"));
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
   * boxes), so no two chains spend one box (independent review L27). A mix
   * from the public account kept for Send, never in place of the one being
   * sent; and, `held`, sent only while its own reservation as it was kept
   * for Send still stands: another build since (a second page's Review) took
   * its place, and may have drawn its boxes (independent review L30). A
   * session's builds and sends go one at a time (SessionService), none while
   * its chain is on its way, so what it holds as being sent is left over
   * from one that stopped: its return takes its place, as before, never the
   * session's return sent directly for it. Returns the reservation made.
   */
  async reserve(network: NetworkName, owner: string, txs: LovejoinChain["txs"], until?: number, held = false): Promise<Reservation> {
    const mine = reservationOf(txs, until);
    await this.reserving(network, (kept) => {
      const was = kept[owner];
      if (owner === chainOwner() && until !== undefined && was && was.until === undefined) throw new Error(PUBLIC_STILL_SENDING());
      if (held && !(was?.until !== undefined && sameInputs(was, mine))) throw new Error(NOT_READY());
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

  /**
   * The mix from the public account being sent (`txs`) stopped at `step`,
   * which may have gone through: in place of what the whole chain reserved,
   * only what `step` spends stays held, still as being sent, until it's
   * settled (publicUnsettled). The mixes after it never go, so their pool
   * boxes are free for another chain's draw (independent review L5), and
   * the collateral for a site's transaction, a mix's too: no mix of the
   * chain waits for it anymore (final review F2). Only while the
   * reservation there is still that chain's.
   */
  private holdOnly(network: NetworkName, txs: LovejoinChain["txs"], step: LovejoinChain["txs"][number]): Promise<void> {
    const whole = reservationOf(txs);
    return this.reserving(network, (kept) => {
      const r = kept[chainOwner()];
      if (r && r.until === undefined && sameInputs(r, whole)) kept[chainOwner()] = { inputs: reservationOf([step]).inputs, collateral: [] };
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
    if (!checked.covers) throw new LovejoinSkipped(checked.reason ?? t("lj.measuredDifferently"));
  }

  /**
   * Builds `boxes` boxes from the public account straight into Lovejoin: the
   * deposit and every mix, signed by the account's keys and checked against
   * the network, kept for Send. Its collateral backs every mix.
   *
   * `seed` puts them in with no mixes (depth 0). A mix takes two other
   * people's boxes for each of its own, so an empty pool can't be mixed in,
   * and the wallet's own boxes never count towards the floor: without a
   * deposit that needs nothing, no pool could ever start. A seed is honest
   * about what it buys, which is nothing for the seeder: the box goes back
   * to the same owner and the chain shows it, so it only gives other people
   * boxes to mix with. Its boxes stay in the pool with no due time (they're
   * deposits, which `sortOut` holds back), until Bring one back.
   */
  async publicBuild(network: NetworkName, boxes: number, seed = false): Promise<LovejoinPublicSummary> {
    if (!this.available(network)) throw new Error(t("lj.notOnNetwork"));
    // A seed is one deposit with no mixes, so it takes as many boxes as the
    // transaction holds, not the handful a mix chain can send.
    checkBoxes(boxes, seed ? MAX_DEPOSIT_BOXES : MAX_MIX_BOXES);
    await this.publicReady(network);
    // It spends the account: not while a payment from it may still go through (pending.ts).
    await settleMaybeSent(this.deps, network);
    const { wasm, wallet, now } = this.deps;
    const { params, utxos, collateral, held } = await readAccount(this.deps, network);
    // Only a mix puts collateral up: it spends the pool's scripts. A seed is
    // the deposit alone, which spends no script, so it asks for none.
    if (!collateral && !seed) {
      throw new Error(t("lj.needCollateral"));
    }
    if (!utxos.length) {
      throw nothingInAccount(held, seed ? t("lj.accountEmptyPutIn") : t("lj.accountEmptyMix"));
    }
    const { depth: chosen, delay } = await this.settings();
    // A seed makes no mixes, so it draws nothing from the pool and the floor
    // doesn't apply: that's the point of it.
    const depth = seed ? 0 : chosen;
    const chain = await this.unstale(async (avoid) => {
      const split = await this.split(network, chainOwner(), avoid);
      if (!seed) this.floor(network, split.others.length, true);
      const request = { network, params, utxos, collateral: collateral ?? null, pool: this.real(split), depth, boxes };
      const built = await wallet.withKeys(
        (keys) => JSON.parse(wasm.buildLovejoinFromAccount(keys.cardano, keys.seedelf, JSON.stringify(request))) as LovejoinChain,
      );
      return this.checked(network, built);
    });
    const last = chain.txs.at(-1)!;
    const summary: LovejoinPublicSummary = {
      network,
      ...(seed ? { seed: true } : {}),
      txHash: last.txHash,
      entry: chain.txs[0]!.txHash,
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
      if (sending && !sending.stopped) throw new Error(PUBLIC_STILL_SENDING());
      const until = await this.publicUnsettledNow(network);
      if (until !== undefined) throw new Error(publicMaybeWait(until - this.deps.now()));
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
      if (e instanceof LovejoinSkipped) throw new Error(t("lj.crossCheckFailed", { reason: e.reason }));
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
    if (!this.available(network)) throw new Error(t("lj.notOnNetwork"));
    await this.publicReady(network);
    // It spends the account: not while a payment from it may still go through (pending.ts).
    await settleMaybeSent(this.deps, network);
    const { wasm, wallet, now } = this.deps;
    const { params, utxos, collateral, held } = await readAccount(this.deps, network);
    if (!collateral) {
      throw new Error(t("lj.needCollateral"));
    }
    if (!utxos.length) throw nothingInAccount(held, t("lj.accountEmptyPay"));
    const { depth, delay } = await this.settings();
    const chain = await this.unstale(async (avoid) => {
      const split = await this.split(network, chainOwner(), avoid);
      this.floor(network, split.others.length);
      const schedule = await this.read(network);
      const theirs = free(fromPublic(split.owned, schedule), split.reserved);
      if (!theirs.length) throw new Error(t("lj.noneFromAccount"));
      const others = free(split.others, split.reserved).length;
      const perBox = mixesPerBox(depth);
      const boxes = Math.min(theirs.length, Math.floor(others / (perBox * 2)), Math.floor(MAX_CHAIN_MIXES / perBox));
      if (boxes < 1) await this.enough(others, 1);
      // Only the account's own boxes are the wallet's in what it's given, the ones not mixed yet first.
      const mine = new Set(split.owned.map(ref));
      const taken = new Set(theirs.map(ref));
      const unmixed = new Set(notMixedYet(schedule, theirs).map(ref));
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
      entry: chain.txs[0]!.txHash,
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
    if (!built || built.txHash !== txHash || built.network !== network) throw new Error(NOT_READY());
    if (now() - built.builtAt > BUILT_TTL_MS) throw new Error(t("lj.mixTooOld"));
    // A payment may have gone maybe sent since the review: nothing of the mix goes, or is kept for it, meanwhile.
    await settleMaybeSent(this.deps, network);
    const before = await this.sendingOf(network);
    if (before && !before.stopped) throw new Error(PUBLIC_STILL_SENDING());
    const until = await this.publicUnsettledNow(network);
    if (until !== undefined) throw new Error(publicMaybeWait(until - now()));
    const sending: SendingPublic = { network, boxes: built.boxes, txs: built.chain, next: 0, flying: [] };
    // Recorded, sealed, before its progress is where anything can send it from (independent review L28). Its own
    // boxes mixed again: they wait afresh once its first mix is in (chainSent).
    const chain = { progress: SESSION_LOVEJOIN_SENDING + network, txs: built.chain, leaves: built.leaves ?? [], boxes: built.boxes };
    await this.recordChain(network, { ...chain, ...(built.again ? { again: true } : {}), ...(built.seed ? { seed: true } : {}) }, async () => {
      // Being sent: its change to come and its collateral are the chain's too, as long as what its review
      // reserved is still its own.
      await this.reserve(network, chainOwner(), built.chain, undefined, true);
      try {
        // Its progress last: a write that fails before it leaves nothing that sends the chain, whose record and
        // reservation then go (independent review L28).
        await wallet.withKeys(async () => {
          await session.remove(SESSION_LOVEJOIN_PUBLIC);
          await session.set(SESSION_LOVEJOIN_SENDING + network, sending);
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
   * transaction that can't be sent stops it, and says why (progress). With
   * none being sent, one that stopped at a transaction that may have gone
   * through is looked for instead (publicLook), and returns whether it's
   * still unsettled.
   */
  async pumpPublic(network: NetworkName, budgetMs = CHAIN_PUMP_MS): Promise<boolean> {
    if (this.pumping.has(network)) return true;
    this.pumping.add(network);
    let more: boolean | undefined;
    try {
      more = await this.pumpPublicNow(network, budgetMs);
    } finally {
      this.pumping.delete(network);
    }
    return more ?? this.publicLook(network);
  }

  /**
   * With no mix from the public account being sent: whether one that
   * stopped at a transaction that may have gone through is still unsettled,
   * looked for at most every PUBLIC_LOOK_MS on a network, as the pages look
   * (lookDue). The worker's runs ask too, so what it holds (what that
   * transaction spends, which a site's transaction on the account is refused)
   * goes once it's settled with no wallet page open, and the alarm keeps
   * going for it meanwhile (final review F2).
   */
  private async publicLook(network: NetworkName): Promise<boolean> {
    if (!this.available(network)) return false;
    const { chains } = await this.read(network);
    // Or one Remove wallet kept, after the same phrase was restored here (final review F1).
    if (!chains.some((r) => r.session === undefined && r.maybe) && !(await this.keptMaybe(network))) return false;
    if (!this.lookDue(network)) return true;
    return (await this.publicUnsettled(network)) !== undefined;
  }

  /** Sends more of the public mix being sent (pumpPublic); undefined when none is. */
  private async pumpPublicNow(network: NetworkName, budgetMs: number): Promise<boolean | undefined> {
    const sending = await this.sendingOf(network);
    if (!sending || sending.stopped) return undefined;
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
    // The next transaction, when a send of it gave up while it may have gone in all the same: a try that may have
    // reached a node, and none that says it's in (independent review L5). Cleared once a send of it goes.
    let unsure: number | undefined;
    // Whether its first transaction's record says it may have gone (chainMarked), and the next transaction, when
    // a send of it gave up on an answer that says it didn't go.
    let marked = false;
    let refused: number | undefined;
    try {
      const done = await pumpChain(
        sending,
        {
          send: async (i, maybeSent) => {
            const step = sending.txs[i]!;
            const bytes = hexBytes(step.txCbor);
            // Its first spends the account (a deposit, or mixing again's first mix): its record says, sealed, that
            // it may have gone before it's first sent, until it's known. A lock or a closed browser before an
            // answer then leaves it looked for, never a mix the account pays for twice (independent review L5).
            const first = i === 0 && sending.next === 0;
            const mark = async () => {
              await this.chainMarked(network, id, { index: 0, txHash: step.txHash, inputs: txInputs(bytes), at: this.deps.now() });
              marked = true;
            };
            if (first) await mark();
            // A try of it in an earlier call may have put it in too (`reached`, final review F10).
            const tries = { busy: 0, spent: 0, maybeSent: maybeSent || sending.reached === i };
            // Whether a try may have put it in: sent before, or one Koios didn't answer.
            let reached = tries.maybeSent;
            for (;;) {
              try {
                try {
                  const submitted = await koios.submitTx(bytes);
                  if (submitted !== step.txHash) throw new Error(t("worker.pending.otherTxId", { id: submitted }));
                } catch (e) {
                  if (!(e instanceof SpentInputError)) throw e;
                  await sentAlready(koios, step.txHash, e);
                }
                break;
              } catch (e) {
                // Refused while Koios couldn't say whether it's on chain, and it may be: looked for again (final review lovejoin-6).
                if (mayBeIn(tries, e)) break;
                // Koios didn't answer, or answered what isn't Koios's or the network's word (another id, a body it
                // couldn't read): it may have reached a node.
                if ((e instanceof KoiosBusyError && e.maybeSent) || !(e instanceof KoiosError)) reached = true;
                // Kept with the progress, which the next save writes: pumpChain may yet get past this send (L25).
                if (reached && i === sending.next) sending.reached = i;
                const wait = chainRetryMs(i, tries, e);
                if (wait === undefined) {
                  // Once a try may have put it in, a later answer says nothing of that one: Koios's node down, a
                  // gateway's page, even a refusal. Only answers to every try that say it didn't go let it go
                  // (independent review L5).
                  if (i === sending.next) {
                    if (reached) unsure = i;
                    else refused = i;
                  }
                  throw e;
                }
                // Every answer so far says it never went (Koios asked the wallet to slow down, say): its mark goes
                // while it waits, and is back before it's tried again, so a lock meanwhile holds no mix from the
                // account back for two hours.
                if (first && marked && !reached) {
                  await this.chainUnmarked(network, id, step.txHash);
                  marked = false;
                }
                await sleep(wait);
                // Never after a lock: the wallet may have locked while it waited, and locking stops the chain.
                await wallet.withKeys(ours);
                if (first && !marked) await mark();
              }
            }
            if (unsure === i) unsure = undefined;
            if (sending.reached === i) delete sending.reached;
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
      // A lock cut it: whatever holds its place now stays as it is, and its record says it was cut; its first
      // transaction's mark with it, unless that's known to have gone.
      if (e instanceof ChainGone) {
        await this.chainEnded(network, id, CHAIN_CUT(), sending.next > 0 ? null : undefined).catch(() => undefined);
        throw e;
      }
      // Stopped at a transaction that may have gone through: what it spends counts as spent, and stays reserved,
      // and it's looked for before another mix from the account is built (independent review L5). Nothing after
      // it is sent, so what the rest of the chain would have spent is free for other chains and sites. That's one
      // Koios didn't answer, or its first, marked, when nothing said whether it went (a write that failed after
      // it was sent, say). Otherwise its mark goes.
      const at = unsure ?? (marked && sending.next === 0 && refused === undefined ? 0 : undefined);
      const step = at === undefined ? undefined : sending.txs[at]!;
      const maybe = step && {
        index: at!,
        txHash: step.txHash,
        inputs: txInputs(hexBytes(step.txCbor)),
        at: this.deps.now(),
        ...(unsure !== undefined ? { unanswered: true as const } : {}),
      };
      sending.stopped =
        unsure !== undefined
          ? t("lj.stepMaybeSent", { what: stepName(sending.txs, unsure) })
          : e instanceof Error
            ? e.message
            : String(e);
      if (maybe) {
        sending.maybe = maybe.index;
        await wallet.withKeys(() => rememberSpent(session, network, hexBytes(step!.txCbor), maybe.at)).catch(() => undefined);
      }
      // Recorded as stopped, and what it held let go, before its progress says so: nothing takes its place until
      // all of that is done (independent review L30).
      await this.chainEnded(network, id, sending.stopped, maybe ?? null).catch(() => undefined);
      if (maybe) await this.holdOnly(network, sending.txs, step!).catch(() => undefined);
      else await this.release(network, chainOwner()).catch(() => undefined);
      // The runs look for it until it's settled (publicLook), with no page open too: the alarm goes on for that,
      // even when this is the alarm's own run, which takes this throw for nothing left to do and would stop it
      // (runs.ts never stops what was started while it went on) (final review F2).
      if (maybe) await this.deps.alarm?.start().catch(() => undefined);
      await save().catch(() => undefined);
      throw unsure !== undefined ? new Error(sending.stopped) : e;
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

  /**
   * Gives the boxes found with no due time (a restore) one each, so there
   * are as many due times as `back`, the boxes that can come back: counted
   * from the schedule as it is when they're added, so two reads at once (the
   * page and the alarm) add them once (independent review M14).
   */
  private async scheduleFound(network: NetworkName, back: number): Promise<void> {
    const known = (await this.read(network)).due.length;
    if (back <= known) return;
    const due = await this.draw(back - known);
    await this.update(network, (s) => s.due.push(...due.slice(0, Math.max(0, back - s.due.length))));
  }

  /** `boxes` due times, each a random delay (the settings' range, or `fixed`'s) from now. */
  private async draw(boxes: number, fixed?: LovejoinDelay): Promise<number[]> {
    const [low, high] = delayHours(fixed ?? (await this.settings()).delay);
    const random = this.deps.random ?? secureRandom;
    const now = this.deps.now();
    return Array.from({ length: boxes }, () => now + Math.round((low + (high - low) * random()) * HOUR));
  }

  /**
   * Records a chain before any of it is sent: its deposit, each mix and its
   * leaves, sealed, so the wallet knows which of its boxes it hasn't mixed
   * yet, after a lock too. `progress`: where it waits while it's sent.
   * `delay`: how long its boxes wait, as its return said (independent
   * review L21); Settings' when it's sent, without one. `start` then puts
   * it there (and reserves what it spends), so nothing can send a chain
   * with no record (independent review L28); meanwhile it isn't taken for
   * one a lock cut (cuts). One whose `start` fails never went: its record
   * goes.
   */
  async recordChain(
    network: NetworkName,
    chain: {
      session?: number;
      progress: string;
      txs: LovejoinChain["txs"];
      leaves: OutRef[];
      boxes: number;
      again?: boolean;
      seed?: boolean;
      delay?: LovejoinDelay;
    },
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
      ...(chain.seed ? { seed: true } : {}),
      ...(chain.delay ? { delay: chain.delay } : {}),
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
    // A seed's boxes get no due time: they stay in the pool for other people
    // to mix with until the user brings one back by hand.
    const due = i === 0 && !record.scheduled && !record.seed ? await this.draw(record.boxes, record.delay) : [];
    await this.update(network, (s) => {
      const c = s.chains.find((r) => r.id === id);
      if (!c) return;
      c.sent = Math.max(c.sent, i + 1);
      // It went: marked as maybe gone while it was sent (pumpPublic), it's known now.
      if (c.maybe?.index === i) delete c.maybe;
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
   * times of the boxes it hadn't mixed all the way go (unschedule). `maybe`:
   * the transaction it stopped at may have gone through (ChainRecord
   * `maybe`); null, nothing it marked so may have; none, its mark stays as
   * it is.
   */
  async chainEnded(network: NetworkName, id: string, stopped?: string, maybe?: ChainRecord["maybe"] | null): Promise<void> {
    const now = this.deps.now();
    await this.update(network, (s) => {
      const c = s.chains.find((r) => r.id === id);
      if (!c || c.ended) return;
      c.ended = now;
      if (stopped === undefined) {
        c.done = true;
        delete c.maybe;
      } else {
        c.stopped = stopped;
        if (maybe) c.maybe = maybe;
        else if (maybe === null) delete c.maybe;
        unschedule(s, c, unfinished(c));
      }
    });
  }

  /**
   * Marks chain `id`'s transaction `maybe` as one that may have gone through
   * (ChainRecord `maybe`) while it's sent, unless the chain ended, or has a
   * mark already.
   */
  private chainMarked(network: NetworkName, id: string, maybe: NonNullable<ChainRecord["maybe"]>): Promise<void> {
    return this.update(network, (s) => {
      const c = s.chains.find((r) => r.id === id);
      if (c && !c.ended && !c.maybe) c.maybe = maybe;
    });
  }

  /** Takes chain `id`'s mark on `txHash` back (chainMarked) while it's sent: every answer so far says it never went. */
  private chainUnmarked(network: NetworkName, id: string, txHash: string): Promise<void> {
    return this.update(network, (s) => {
      const c = s.chains.find((r) => r.id === id);
      if (c && !c.ended && c.maybe?.txHash === txHash) delete c.maybe;
    });
  }

  /**
   * Looks for the transaction a mix from the public account stopped at
   * while it may have gone through (ChainRecord `maybe`): on chain, it went;
   * not, and a UTxO it spends is spent now, it can't go anymore, whether it
   * did or not; unseen as long as the wallet holds what it spends
   * (SPENT_KEEP_MS), it never went. Then the mix's record and progress say
   * so, and what it reserved goes. Returns, while it's still unsettled, when
   * it will be at the latest, as long as Koios answers (ms): no other mix
   * from the account is built meanwhile, or the account could pay for one
   * twice (independent review L5). It's only looked for, never sent again:
   * its mix stopped.
   */
  private publicUnsettled(network: NetworkName): Promise<number | undefined> {
    return this.inTurn(`public.${network}`, () => this.publicUnsettledNow(network));
  }

  /** publicUnsettled, in the account's turn. */
  private async publicUnsettledNow(network: NetworkName): Promise<number | undefined> {
    // One whose progress is gone ends first (cuts): only a mix that ended is settled here, never one still being
    // sent, whose first transaction's mark goes with its send (chainSent).
    await this.cuts(network);
    const c = (await this.read(network)).chains.find((r) => r.session === undefined && r.maybe && r.ended);
    const m = c?.maybe;
    if (!c || !m) return this.keptUnsettled(network);
    const by = m.at + SPENT_KEEP_MS;
    const how = await this.lookFor(network, m);
    if (!how) return by;
    const what = c.deposit === m.txHash ? t("lj.step.deposit") : t("lj.step.transaction", { number: m.index + 1, total: c.total });
    const lead = m.unanswered
      ? t("lj.lead.unanswered", { what })
      : c.stopped === CHAIN_CUT()
        ? t("lj.lead.cut", { what })
        : t("lj.lead.stopped", { what });
    const why = {
      in: t("lj.why.in", { lead }),
      spent: t("lj.why.spent", { lead }),
      never: t("lj.why.never", { lead }),
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
    return undefined;
  }

  /**
   * Where transaction `m` of a mix from the public account, which may have
   * gone through, stands (publicUnsettled): on chain, it went ("in"); not,
   * and a UTxO it spends is spent now, it can't go anymore, whether it did or
   * not ("spent"); unseen as long as the wallet holds what it spends
   * (SPENT_KEEP_MS), it never went ("never"). Undefined while it's still
   * unsettled, or Koios didn't answer: looked for again next time.
   */
  private async lookFor(network: NetworkName, m: KeptMaybe): Promise<"in" | "spent" | "never" | undefined> {
    const koios = this.deps.koios(network);
    const seen = (await koios.txStatus([m.txHash]).catch(() => undefined))?.get(m.txHash);
    if (seen === undefined) return undefined;
    if (seen !== null) return "in";
    const rows = (await koios.utxoInfo(m.inputs).catch(() => undefined)) as Array<KoiosUtxo & { is_spent?: boolean }> | undefined;
    if (!rows) return undefined;
    if (rows.some((r) => r.is_spent)) return "spent";
    return this.deps.now() >= m.at + SPENT_KEEP_MS ? "never" : undefined;
  }

  /** What Remove wallet kept of a mix from the public account that may have gone through (keepOnReset), if this phrase opens it. */
  private async keptMaybe(network: NetworkName): Promise<KeptMaybe | undefined> {
    try {
      const m = await this.deps.store.get<KeptMaybe | null>(keptMaybeName(network));
      return m?.txHash ? m : undefined;
    } catch (e) {
      // One that won't open was another wallet's (adoptKept).
      if (e instanceof UnreadableRecordError) return undefined;
      throw e;
    }
  }

  /**
   * After the same phrase was restored here: what Remove wallet kept of a
   * mix from the public account whose transaction may have gone through
   * (keepOnReset) is looked for as publicUnsettled looks, and goes once it's
   * settled. Returns, while it isn't, when it will be at the latest: no
   * other mix from the account is built meanwhile, or the account could pay
   * for one twice (final review F1).
   */
  private async keptUnsettled(network: NetworkName): Promise<number | undefined> {
    const name = keptMaybeName(network);
    const nonce = await this.deps.store.sealedAs(name);
    const m = await this.keptMaybe(network);
    if (!m || nonce === undefined) return undefined;
    if (!(await this.lookFor(network, m))) return m.at + SPENT_KEEP_MS;
    // Only the one looked for: never one kept since.
    await this.deps.store.removeIf(name, nonce);
    return undefined;
  }

  /**
   * Whether a mix from the public account stopped at a transaction that may
   * have gone through, unsettled yet, or Remove wallet kept one: Remove
   * wallet says so first (final review F1). No Koios request.
   */
  async publicMaybe(network: NetworkName): Promise<boolean> {
    if (!this.available(network)) return false;
    await this.cuts(network);
    if ((await this.read(network)).chains.some((r) => r.session === undefined && r.maybe && r.ended)) return true;
    return (await this.keptMaybe(network)) !== undefined;
  }

  /**
   * Just before Remove wallet deletes the Lovejoin records: a mix from the
   * public account whose transaction may have gone through, unsettled yet,
   * is kept, sealed, on its own (KeptMaybe), as a payment that may is: the
   * same phrase restored here looks for it before another mix from the
   * account is built, and another phrase's wallet deletes it (adoptKept,
   * final review F1). Unlocked only: Forgot password can't read it.
   */
  async keepOnReset(networks: NetworkName[]): Promise<void> {
    for (const network of networks) {
      const chains = await this.read(network).then((s) => s.chains, () => []);
      const m = chains.filter((r) => r.session === undefined && r.maybe).at(-1)?.maybe;
      if (m) await this.deps.store.set(keptMaybeName(network), { txHash: m.txHash, inputs: m.inputs, at: m.at }).catch(() => undefined);
    }
  }

  /**
   * After a wallet is made or restored: what Remove wallet kept of a mix
   * from the public account (keepOnReset) stays if this phrase opens it, and
   * is looked for; one it can't open was another wallet's, and goes (final
   * review F1).
   */
  async adoptKept(networks: NetworkName[]): Promise<void> {
    for (const network of networks) {
      await this.deps.store.get(keptMaybeName(network)).catch(async (e: unknown) => {
        if (e instanceof UnreadableRecordError) await this.deps.store.remove(keptMaybeName(network));
      });
    }
  }

  /**
   * Marks each chain recorded as being sent whose progress is gone as
   * stopped: a lock, a closed browser or an update wiped it partway, and
   * nothing sends the rest (CHAIN_CUT()); or, whose progress says it stopped,
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
      if (progress?.txs?.at(-1)?.txHash !== c.id) stopped.set(c.id, CHAIN_CUT());
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

  /** Whether a chain of the wallet's is being sent (recorded, and neither all sent nor stopped). Remove wallet says so first. */
  async chainsSending(network: NetworkName): Promise<boolean> {
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
   *
   * A box no record accounts for, when more boxes could come back than there
   * are due times (a restore), is held as not mixed yet when a deposit made
   * it (`deposits`), or while Koios hasn't said what did (`unsure`, listed
   * last): found. So are the boxes of `force`, which Bring one back now is
   * about to choose from, asked of in the same request; one of those Koios
   * can't say of (`untold`) isn't free either, and isn't counted for Home.
   */
  private async sortOut(
    network: NetworkName,
    owned: OutRef[],
    listed: OutRef[],
    force: OutRef[] = [],
  ): Promise<{ unmixed: OutRef[]; free: OutRef[]; unsure: OutRef[]; deposits: OutRef[]; untold: OutRef[] }> {
    const now = this.deps.now();
    const before = await this.read(network);
    const { chains } = before;
    const { origins, unsure, untold } = await this.found(network, owned, listed, before, force);
    const deposits = depositsOf(before, owned, origins);
    const unmixed = [...unmixedOf(chains.filter((c) => c.ended), owned), ...deposits, ...unsure];
    const held = new Set([...unmixedOf(chains, owned), ...deposits, ...unsure, ...untold].map(ref));
    const free = owned.filter((b) => !held.has(ref(b)));
    const there = new Set(listed.map(ref));
    const listedTxs = new Set(listed.map((b) => b.txHash));
    await this.update(network, (s) => {
      for (const c of s.chains) {
        if (c.ended) unschedule(s, c, unmixedOf([c], owned).length - (c.unscheduled ?? 0), free.length);
        // What a stopped chain still leaves to mix, as this read finds it: once its boxes were found, and none
        // is left the wallet's, the pages stop showing it (shown). Found counts what's listed, spent or not.
        if (c.ended && c.stopped) {
          c.left = unmixedOf([c], owned).length;
          if (unmixedOf([c], listed).length) c.found = true;
        }
      }
      // Kept while its boxes haven't waited its own delay's least, too: the withdraws read that from it (ripeAt).
      const keep = (c: ChainRecord) =>
        !c.ended || now - c.ended < RECORD_KEEP_MS || unmixedOf([c], listed).length > 0 || now < ownWaitAt(c);
      const gone = s.chains.filter((c) => !keep(c)).flatMap((c) => c.leaves.map((l) => [ref(l), chainOwner(c.session)] as const));
      const leaves = Object.entries({ ...s.leaves, ...Object.fromEntries(gone) }).filter(([r]) => there.has(r));
      if (leaves.length) s.leaves = Object.fromEntries(leaves);
      else delete s.leaves;
      s.chains = s.chains.filter(keep);
      // What made a box no record accounts for goes once no read has listed a box it made for a while.
      const origins = Object.entries(s.origins ?? {}).flatMap(([tx, o]): Array<[string, Origin]> =>
        listedTxs.has(tx) ? [[tx, { ...o, seen: now }]] : now - o.seen < RECORD_KEEP_MS ? [[tx, o]] : [],
      );
      if (origins.length) s.origins = Object.fromEntries(origins);
      else delete s.origins;
      // So does a transaction Koios is still asked of; one it has said of since goes at once.
      const asking = Object.entries(s.asking ?? {}).flatMap(([tx, seen]): Array<[string, number]> =>
        s.origins?.[tx] ? [] : listedTxs.has(tx) ? [[tx, now]] : now - seen < RECORD_KEEP_MS ? [[tx, seen]] : [],
      );
      if (asking.length) s.asking = Object.fromEntries(asking);
      else delete s.asking;
      s.notMixed = unmixed.length;
      if (unsure.length) s.unsure = unsure.length;
      else delete s.unsure;
    });
    return { unmixed, free, unsure, deposits, untold };
  }

  /**
   * What made the boxes of `owned` that no record of the wallet's accounts
   * for (Origin), by transaction, as `s` keeps it; and the boxes of those
   * Koios hasn't said of (`unsure`). Only when more of the boxes could come
   * back than `s` has due times for (moreThanDue): that's a restore (Remove
   * wallet, Forgot password, another browser or device), whose chain records
   * are gone. A wallet in its steady state has a due time for each box that
   * can come back, boxes other people's mixes moved since included, and asks
   * Koios nothing (independent review M14). The transactions that made the
   * boxes with none kept are read (tx_info, with their inputs), in one
   * request, each only once: in the network's turn, so runs and pages at once
   * ask once, and what Koios says is kept, sealed, by the transaction. One
   * Koios doesn't answer for, or doesn't know, is kept as still asked of
   * (`asking`): its boxes are held, and it's asked of again at each later
   * pool read, however many due times there are by then, until Koios says.
   * The boxes of `force` with none kept, those Bring one back now may take,
   * are asked of too, in the same request, whatever the count says. One of
   * those alone Koios can't say of is returned apart (`untold`), and isn't
   * kept as still asked of: the pool reads go by their count.
   */
  private async found(
    network: NetworkName,
    owned: OutRef[],
    listed: OutRef[],
    s: Schedule,
    force: OutRef[] = [],
  ): Promise<{ origins: Record<string, Pick<Origin, "mixed" | "public">>; unsure: OutRef[]; untold: OutRef[] }> {
    const kept = s.origins ?? {};
    const known = recorded(s);
    const unknown = owned.filter((b) => !known(b) && !kept[b.txHash]);
    // Due times left over from something else never let a box Koios hasn't answered for go unasked, and free.
    const counted = moreThanDue(s, owned, listed) ? unknown : unknown.filter((b) => s.asking?.[b.txHash] !== undefined);
    const holding = new Set(counted.map((b) => b.txHash));
    const forced = new Set(force.map(ref));
    const ask = unknown.filter((b) => holding.has(b.txHash) || forced.has(ref(b)));
    if (!ask.length) return { origins: kept, unsure: [], untold: [] };
    const origins = await this.lookUp(network, ask, holding);
    const silent = ask.filter((b) => !origins[b.txHash]);
    return { origins, unsure: silent.filter((b) => holding.has(b.txHash)), untold: silent.filter((b) => !holding.has(b.txHash)) };
  }

  /**
   * What made each box of `boxes` that no record of the wallet's accounts for
   * and Koios hasn't said of yet, asked of now, whatever the pool reads'
   * count says (moreThanDue): before the wallet takes one into a mix again
   * from the private balance, or brings one back by itself (independent
   * review M14). In one request, each transaction once. One Koios can't say
   * of is returned (`untold`), never taken, and isn't kept as still asked
   * of: the pool reads go by their count, and a wallet in its steady state
   * holds nothing for it.
   */
  private async made(network: NetworkName, boxes: OutRef[]): Promise<{ origins: Record<string, Origin>; untold: OutRef[] }> {
    const s = await this.read(network);
    const known = knownOf(s);
    const ask = boxes.filter((b) => !known(b));
    if (!ask.length) return { origins: s.origins ?? {}, untold: [] };
    const origins = await this.lookUp(network, ask, new Set());
    return { origins, untold: ask.filter((b) => !origins[b.txHash]) };
  }

  /**
   * Asks Koios what made the boxes of `ask` (madeBy), each transaction once,
   * those it said of before left out: in the network's turn, so runs and
   * pages at once ask once, and what it says is kept, sealed, by the
   * transaction (`origins`). Those of `holding` it doesn't answer for, or
   * doesn't know, are kept as still asked of (`asking`, found). Returns what
   * Koios has said, by transaction, then.
   */
  private lookUp(network: NetworkName, ask: OutRef[], holding: Set<string>): Promise<Record<string, Origin>> {
    return this.inTurn(`origins.${network}`, async () => {
      const was = await this.read(network);
      const said = was.origins ?? {};
      const asked = [...new Set(ask.map((b) => b.txHash))].filter((tx) => !said[tx]);
      const told = asked.length ? await this.madeBy(network, asked) : new Map<string, Pick<Origin, "mixed" | "public">>();
      const at = this.deps.now();
      const fresh = Object.fromEntries([...told].map(([tx, o]) => [tx, { ...o, seen: at }]));
      const silent = asked.filter((tx) => !told.has(tx) && holding.has(tx));
      if (told.size || silent.some((tx) => was.asking?.[tx] === undefined)) {
        await this.update(network, (x) => {
          if (told.size) x.origins = { ...x.origins, ...fresh };
          const asking = { ...x.asking };
          for (const tx of told.keys()) delete asking[tx];
          for (const tx of silent) asking[tx] ??= at;
          if (Object.keys(asking).length) x.asking = asking;
          else delete x.asking;
        });
      }
      return { ...said, ...fresh };
    });
  }

  /**
   * What made each of `txHashes`, as Koios's tx_info says of its inputs: a
   * mix, when one sat at Lovejoin's mix_box; the public account, when one was
   * under one of its payment keys (accountKeys). Only a payment key says so:
   * anyone can pay from an address of their own payment key and the
   * account's stake key, without the account's signature, as activity.ts's
   * accountMatcher says. An input that carries the stake key under a payment
   * key the wallet doesn't know has the account's keys looked for further
   * (fartherKeys): an address of the account's past those known, before a
   * balance reading found it. Those Koios doesn't know are left out, and
   * those of a request it doesn't answer and of every one after it: each is
   * asked of again at a later read, and what came back before it is kept.
   */
  private async madeBy(network: NetworkName, txHashes: string[]): Promise<Map<string, Pick<Origin, "mixed" | "public">>> {
    const mixBox = NETWORKS[network].lovejoin?.mixBox;
    const koios = this.deps.koios(network);
    const rows: KoiosTxSpends[] = [];
    for (let i = 0; i < txHashes.length; i += TXS_PER_REQUEST) {
      try {
        rows.push(...(await koios.txSpends(txHashes.slice(i, i + TXS_PER_REQUEST))));
      } catch (e) {
        if (e instanceof KoiosError) break;
        throw e;
      }
    }
    const told = new Map<string, Pick<Origin, "mixed" | "public">>();
    const asked = new Set(txHashes);
    const read = rows.filter((r) => asked.has(r.tx_hash) && Array.isArray(r.inputs) && r.inputs.length > 0);
    if (!mixBox || !read.length) return told;
    const account = await this.accountKeys(network);
    const spent = read.map(({ tx_hash, inputs }) => [tx_hash, inputs!.map((i) => this.keysOf(i.payment_addr))] as const);
    // The stake key alone never makes an input the account's: its payment key is looked for further (independent review M14).
    const unknown = new Set(
      spent.flatMap(([, keys]) =>
        keys.flatMap(({ cred, stake }) =>
          cred !== undefined && cred !== mixBox && account.stake !== undefined && stake === account.stake && !account.payment.has(cred)
            ? [cred]
            : [],
        ),
      ),
    );
    if (unknown.size) for (const key of await this.fartherKeys(unknown)) account.payment.add(key);
    for (const [tx_hash, keys] of spent) {
      told.set(tx_hash, {
        mixed: keys.some((k) => k.cred === mixBox),
        ...(keys.some((k) => k.cred !== undefined && account.payment.has(k.cred)) ? { public: true as const } : {}),
      });
    }
    return told;
  }

  /**
   * Which of `creds` are the public account's payment keys past the first
   * GAP_LIMIT of each chain: looked for along both up to FARTHER_KEYS,
   * stopping once each is found. Each is an input's that carried the
   * account's stake key (madeBy), looked for once for each transaction Koios
   * says the making of, whose answer is kept (found).
   */
  private fartherKeys(creds: Set<string>): Promise<string[]> {
    return this.deps.wallet.withKeys(({ cardano }) => {
      const left = new Set(creds);
      const found: string[] = [];
      for (let i = GAP_LIMIT; i < FARTHER_KEYS && left.size; i++) {
        for (const role of [0, 1]) {
          const key = cardano.paymentKeyHash(role, i);
          if (left.delete(key)) found.push(key);
        }
      }
      return found;
    });
  }

  /**
   * The public account's keys as the wallet knows them (hex): its payment
   * keys, the first GAP_LIMIT of each chain and those the last balance
   * reading found past them; and its stake key, which each of its base
   * addresses carries however far past them, a balance reading or not
   * (madeBy looks further for one of those).
   */
  private accountKeys(network: NetworkName): Promise<{ payment: Set<string>; stake?: string }> {
    const { wallet, session, wasm } = this.deps;
    const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
    return wallet.withKeys(async ({ cardano }) => {
      const found = await session.get<AccountAddresses>(SESSION_ACCOUNT_ADDRESSES_PREFIX + network);
      const first = Array.from({ length: GAP_LIMIT }, (_, i) => [cardano.paymentKeyHash(0, i), cardano.paymentKeyHash(1, i)]).flat();
      const { stake } = this.keysOf({ bech32: cardano.stakeAddress(net) });
      return { payment: new Set([...first, ...(found?.keys ?? [])]), ...(stake !== undefined ? { stake } : {}) };
    });
  }

  /**
   * An address's payment credential (hex), a key's or a script's: Koios's
   * `cred`, or the address's own (CIP-19), when Koios gives none; and the
   * stake key it carries: a base address's, or a reward address's. Neither
   * for a Byron address, or one that can't be read.
   */
  private keysOf(address: { bech32: string; cred?: string | null }): { cred?: string; stake?: string } {
    let hex = "";
    try {
      hex = this.deps.wasm.cip30Address(address.bech32);
    } catch (e) {
      if (isTrap(e)) throw e;
    }
    const kind = Number.parseInt(hex.slice(0, 1), 16);
    const own = kind < 8 ? hex.slice(2, 58) : "";
    const cred = typeof address.cred === "string" ? address.cred : address.cred === null || own.length !== 56 ? undefined : own;
    const stake = kind === 0 || kind === 1 ? hex.slice(58, 114) : kind === 14 ? hex.slice(2, 58) : "";
    return { ...(cred !== undefined ? { cred } : {}), ...(stake.length === 56 ? { stake } : {}) };
  }

  /** The wallet's boxes a chain of its, built or being sent, will spend: none of them is withdrawn. */
  private async reservedBoxes(network: NetworkName): Promise<Set<string>> {
    const { wallet, session, now } = this.deps;
    return (await wallet.withKeys(() => reservedSet(session, network, { now: now() }))).inputs;
  }

  /**
   * The wallet's boxes in the pool (a pool read), when they're due, which
   * aren't mixed yet, and its chains not all sent: being sent, or stopped
   * partway. A box found with no due time (a restore) gets one here, once
   * Koios said a mix made it (found, independent review M14).
   */
  async status(network: NetworkName): Promise<LovejoinStatus> {
    if (!this.available(network)) return { available: false, boxes: [], others: 0, floor: 0, lovelace: "0", due: [], notMixed: [], fromPublic: [], chains: [] };
    await this.cuts(network);
    const { owned, listed, others } = await this.ours(network);
    const { unmixed, free: back, unsure, deposits } = await this.sortOut(network, owned, listed);
    await this.scheduleFound(network, back.length);
    const schedule = await this.read(network);
    const { due, chains } = schedule;
    return {
      available: true,
      boxes: owned,
      // What the floor counts, and the floor itself: the page offers to seed
      // the pool when it's short, without waiting for a mix to be refused.
      others: others.length,
      floor: NETWORKS[network].lovejoin?.poolFloor ?? 0,
      lovelace: (BigInt(owned.length) * LOVEJOIN_DENOM).toString(),
      due: [...due].sort((a, b) => a - b),
      notMixed: unmixed,
      ...(unsure.length ? { unsure } : {}),
      ...(deposits.length ? { deposits } : {}),
      fromPublic: fromPublic(owned, schedule),
      chains: chains
        .filter(shown)
        .map((c) => ({
          ...(c.session !== undefined ? { session: c.session } : {}),
          boxes: c.boxes,
          total: c.total,
          sent: c.sent,
          at: c.at,
          ...(c.stopped ? { stopped: c.stopped } : {}),
          ...(c.maybe && c.ended ? { maybeSent: true as const } : {}),
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
    const { due, chains, notMixed, unsure } = await this.read(network);
    return {
      boxes: due.length,
      lovelace: (BigInt(due.length) * LOVEJOIN_DENOM).toString(),
      next: due.length ? Math.min(...due) : null,
      notMixed: notMixed ?? 0,
      ...(unsure ? { unsure } : {}),
      stopped: chains.filter((c) => c.stopped && shown(c)).length,
    };
  }

  /**
   * Whether a box is on its way back on `network`: one due, or a withdraw
   * that may have gone through, looked for and sent again only by the
   * alarm's runs, under a new withdraw's rules (independent review M11). No
   * Koios request.
   */
  async returning(network: NetworkName): Promise<boolean> {
    return (await this.held(network)).boxes > 0 || (this.available(network) && !!(await this.read(network)).withdrawing);
  }

  /**
   * Withdraws a box that's due, one a run. `unlock` (the run as the wallet
   * unlocks) reads the pool even when nothing is due yet, on a network where
   * the wallet has something open in Lovejoin, so its boxes' due times follow
   * the pool; and sends nothing. Each box due by then waits a fresh draw
   * (privacy review §3.1), made by the first run after the unlock, this one
   * or another (unlockDraws). `since`: when the run began, so nothing goes
   * back in a run that sent anything else, or that began before the unlock.
   * One run at a time.
   */
  withdrawDue(network: NetworkName, unlock = false, since?: number): Promise<PendingTx[]> {
    if (!this.available(network)) return Promise.resolve([]);
    return this.inTurn(`withdraw.${network}`, () => this.withdrawDueNow(network, unlock, since));
  }

  private async withdrawDueNow(network: NetworkName, unlock: boolean, since: number | undefined): Promise<PendingTx[]> {
    // A withdraw a lock kept although it never went goes first, its due time back, so the unlock's draw takes that too.
    await this.dropRefused(network);
    // The unlock's fresh draws come first, before any Koios read: a read that
    // fails can't leave a box due to go at the next run (independent review L10).
    const unlocked = await this.unlockDraws(network);
    // A run that began before this unlock (the wallet locked and unlocked
    // while it went on) is the unlock's from here: it sends nothing (L11).
    if (since !== undefined && since < unlocked) unlock = true;
    // A chain mixing them again spends them: they wait until it's sent.
    if (await this.deps.mixingAgain?.(network)) return [];
    // A chain being sent is still putting boxes in and mixing them: none comes back meanwhile.
    if (await this.chainsSending(network)) return [];
    // Nor while the last withdraw may still be on its way: two a minute apart say they're one owner's.
    if (await this.settleWithdrawing(network, { unlock, since, unlocked })) return [];
    const now = this.deps.now();
    const before = await this.read(network);
    // Only a network with something of the wallet's open in Lovejoin reads its pool at unlock (privacy review §2.18).
    const open = before.due.length > 0 || before.chains.length > 0 || (before.notMixed ?? 0) > 0;
    if (!(unlock && open) && !before.due.some((t) => t <= now)) return [];
    const scheduled = new Set(before.chains.filter((c) => c.scheduled).map((c) => c.id));
    const { pool, owned, listed } = await this.ours(network);
    // A box a chain of the wallet's made and hadn't finished mixing never
    // comes back by itself: it waits, not mixed yet, for Mix my boxes again;
    // after a restore, one a deposit made too, or one Koios hasn't said of (M14).
    const { free: back } = await this.sortOut(network, owned, listed);
    // A box with no due time (a restore, a mix made it) gets one; a due time with no box
    // (withdrawn by hand, or a chain that didn't go through) goes, counted
    // from the schedule as it is then, not as it was read. A chain recorded
    // since the pool read, or whose deposit set its boxes' times since, has
    // boxes the read can't have found: nothing is dropped then, and no box
    // goes back while it's sent (independent review L29). A box held while
    // Koios can't say what made it (a restore) can't come back meanwhile:
    // one due time it had goes too, drawn afresh once Koios says, so no due
    // time no box takes has the pool read every minute (M14).
    await this.scheduleFound(network, back.length);
    let sending = false;
    await this.update(network, (s) => {
      sending = s.chains.some((c) => !c.ended || (c.scheduled && !scheduled.has(c.id)));
      if (!sending) s.due = [...s.due].sort((a, b) => a - b).slice(0, back.length);
    });
    const random = this.deps.random ?? secureRandom;
    // The unlock's run sends nothing (unlockDraws drew each box due's wait): it reads the pool, so due times follow it.
    if (unlock || sending) return [];
    const schedule = await this.read(network);
    const kept = [...schedule.due].sort((a, b) => a - b);

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
    if (!candidates.length) return [];
    // Only a box that has waited its own chain's delay's least since that
    // chain went in: a swap approved to wait longer than Settings' delay now
    // keeps its wait, whichever chain's due time comes first, after someone
    // else's mix moved its box too (ripeAt, final review F9).
    const [box] = backOrder(
      candidates.filter((b) => ripeAt(b, schedule, rows) <= now),
      rows,
      ownLeaves(schedule),
      least,
      now,
    );
    // And only once it has waited the delay's least since a mix last moved
    // it: a box a mix moved minutes ago would say which mix it came from.
    // Until one has, the due time waits past the first that will, by a fresh
    // draw, so it isn't the very moment either.
    if (!box || waitedAt(box, rows, least) > now) {
      const first = Math.min(...candidates.map((b) => Math.max(waitedAt(b, rows, least), ripeAt(b, schedule, rows))));
      await this.update(network, (s) => moveDue(s, time, first + within(WITHDRAW_SPREAD_MS, random)));
      return [];
    }
    // Nor right after something else the wallet sent: in the same run (the
    // next takes it), or within QUIET_AFTER_SEND_MS, which pushes it a fresh
    // few minutes, a few times at most.
    const { sent, forgotten } = await this.deps.wallet.sends();
    if (since !== undefined && sent >= since) return [];
    const pushes = schedule.marks?.[time]?.pushes ?? 0;
    const push = quiet(now, sent, forgotten);
    if (push && pushes < QUIET_PUSHES) {
      await this.update(network, (s) =>
        moveDue(s, time, now + within(QUIET_PUSH_MS, random), (m) => {
          m.pushes = pushes + 1;
          if (push === "forgotten") delete m.unlock;
        }),
      );
      return [];
    }
    // Nor a box whose making no record of the wallet's accounts for and Koios hasn't said: it's asked of now, alone
    // (made, independent review M14). The pool read's count of boxes against due times can let one go unasked: a
    // chain's last mix a node dropped after it was all sent leaves its due time to a box a restore found, the box
    // that mix spent staying spent by it for hours, then held as not mixed yet; and the quiet after the chain's
    // sends is long over by the time one is due. A deposit's is held from then on (sortOut); one Koios can't say of
    // waits a fresh draw, and isn't taken meanwhile. Only a mix's answer lets it go: a deposit's kept since the
    // boxes were sorted out (Mix my boxes again pressed on the page asked meanwhile) holds it as well (mixedOf).
    if (!mixedOf(schedule)(box)) {
      const { origins, untold } = await this.made(network, [box]);
      if (untold.length) await this.update(network, (s) => moveDue(s, time, now + within(WITHDRAW_SPREAD_MS, random)));
      if (origins[box.txHash]?.mixed !== true) return [];
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
      // Its due time goes with it, sent or maybe sent (Withdrawing `due`).
      return [await this.withdrawOne(network, pool, box, { unlocked, due: time })];
    } catch {
      // It never went: its due time is back, and it's tried again at the next unlock or alarm.
      return [];
    }
  }

  /**
   * Nothing goes back the moment the wallet unlocks: it's when the user is
   * about to act, and a site connected to the account sees it. Each box that
   * came due while it was locked, or comes due before the least of a fresh
   * wait would (independent review L13), waits a fresh draw inside the
   * stretch the unlock keeps it open, once: one drawn at an unlock before
   * (the wallet locked again first) goes at the next run instead. So does a
   * withdraw that may have gone through, before it's sent again (M11).
   * Drawn by whichever run gets here first after the unlock, the unlock's
   * own or one after it, from the sealed schedule alone: the unlock's run
   * failing on a Koios read, or coming after a run already under way, can't
   * skip it (L10). Returns the unlock.
   */
  private async unlockDraws(network: NetworkName): Promise<number> {
    const unlocked = await this.deps.wallet.unlockedAt();
    const before = await this.read(network);
    if (before.unlock === unlocked || (!before.due.length && !before.withdrawing)) return unlocked;
    const lockAfter = await this.deps.preferences.lockAfterMs();
    const random = this.deps.random ?? secureRandom;
    const now = this.deps.now();
    await this.update(network, (s) => {
      if (s.unlock === unlocked) return;
      for (const t of s.due.filter((d) => d < now + UNLOCK_WAIT_MS[0] && !s.marks?.[d]?.unlock)) {
        moveDue(s, t, now + unlockWait(lockAfter, random), (m) => (m.unlock = true));
      }
      const w = s.withdrawing;
      if (w && !w.unlock && Math.max(w.sentAt + CHAIN_RESEND_MS, w.waitUntil ?? 0) < now + UNLOCK_WAIT_MS[0]) {
        w.waitUntil = now + unlockWait(lockAfter, random);
        w.unlock = true;
      }
      s.unlock = unlocked;
    });
    return unlocked;
  }

  /**
   * Withdraws one of our boxes now, whatever its delay: `box`, or the one
   * that has waited longest. One not mixed yet only when asked `anyway`:
   * brought back, it ties where it went in to the private balance. Nor,
   * unless asked `anyway`, one whose making no record of the wallet's
   * accounts for and Koios hasn't said: it's asked of first, and one Koios
   * can't say of is refused (independent review M14).
   */
  withdrawNow(network: NetworkName, box?: OutRef, anyway = false): Promise<PendingTx> {
    return this.inTurn(`withdraw.${network}`, () => this.withdrawNowNow(network, box, anyway));
  }

  private async withdrawNowNow(network: NetworkName, box: OutRef | undefined, anyway: boolean): Promise<PendingTx> {
    if (await this.deps.mixingAgain?.(network)) {
      throw new Error(t("lj.mixingAgain"));
    }
    if (await this.chainsSending(network)) {
      throw new Error(t("lj.chainSending"));
    }
    if (await this.settleWithdrawing(network)) {
      throw new Error(t("lj.lastBoxMaybe"));
    }
    // Nor while a payment may still go through: Home's banner watches that one until it's settled (pending.ts).
    await settleMaybeSent(this.deps, network);
    const { pool, owned, listed } = await this.ours(network);
    const reserved = await this.reservedBoxes(network);
    const [least] = delayHours((await this.settings()).delay);
    const rows = new Map(pool.map((u) => [outpoint(u), u]));
    const before = await this.read(network);
    const known = knownOf(before);
    let chosen: OutRef | undefined;
    // What made the box it may take, when no record of the wallet's accounts for it and Koios hasn't said, is asked
    // of now, in the pool read's request, whatever its count says (independent review M14): the box asked for, or
    // those backOrder puts ahead of the first whose making is known. `anyway`: the user's call, taken as it is.
    let force: OutRef[] = [];
    if (box) {
      chosen = owned.find((b) => ref(b) === ref(box));
      if (!chosen) throw new Error(t("lj.boxGone"));
      if (reserved.has(ref(chosen))) throw new Error(t("lj.boxReserved"));
      if (!anyway && !known(chosen)) force = [chosen];
    } else {
      const held = new Set(notMixedYet(before, owned).map(ref));
      const order = backOrder(free(owned.filter((b) => !held.has(ref(b))), reserved), rows, ownLeaves(before), least, this.deps.now());
      const first = order.findIndex(known);
      force = first < 0 ? order : order.slice(0, first);
    }
    const { unmixed, free: back, unsure, deposits, untold } = await this.sortOut(network, owned, listed, force);
    // The box asked for.
    if (chosen) {
      // A box Koios hasn't said the making of may be a deposit's: after a restore, or where a count missed it (M14).
      if (!anyway && [...unsure, ...untold].some((b) => ref(b) === ref(chosen!))) {
        throw new Error(
          t("lj.privacy.boxUntold"),
        );
      }
      if (!anyway && unmixed.some((b) => ref(b) === ref(chosen!))) {
        // After a restore, one a deposit made: whose deposit, and why no mix followed it, the wallet can't know (M14).
        throw new Error(
          deposits.some((b) => ref(b) === ref(chosen!))
            ? t("lj.privacy.boxUnmixed")
            : t("lj.privacy.boxChainStopped"),
        );
      }
    } else {
      // One ahead Koios can't say of: none is taken in its place, which would bring back one backOrder puts after it.
      if (untold.length) {
        throw new Error(
          t("lj.untoldSomeMixed"),
        );
      }
      // Only a box whose making is known now: a record accounts for it, or Koios said a mix made it. Never one
      // Koios said a deposit made, by an answer another lookup kept after the boxes were sorted out (mixedOf).
      const after = await this.read(network);
      [chosen] = backOrder(free(back, reserved).filter(mixedOf(after)), rows, ownLeaves(after), least, this.deps.now());
      if (!chosen) {
        // Mix my boxes again refuses while Koios hasn't said of a box (againBoxes): it's never "first" then. Those
        // known not to be mixed are said apart from those Koios hasn't said of, which may be (M14).
        throw new Error(
          unsure.length && unsure.length === unmixed.length
            ? t("lj.untoldAllBack")
            : unsure.length
              ? t("lj.privacy.someUnmixed")
              : unmixed.length
                ? t("lj.privacy.allUnmixed")
                : t("lj.noneInPool"),
        );
      }
    }
    // The earliest due time goes with a box that had one, sent or maybe sent (Withdrawing `due`).
    const due = back.some((b) => ref(b) === ref(chosen!)) ? "earliest" : undefined;
    const pending = await this.withdrawOne(network, pool, chosen, { due });
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
    const [{ rows, spent }, { inputs }] = await Promise.all([
      this.listing(network),
      wallet.withKeys(() => reservedSet(session, network, { except, now: now() })),
    ]);
    const pool = unspent(rows, spent);
    const { boxes, otherBoxes } = await this.ownership(network, pool);
    return { pool, owned: boxes, others: otherBoxes, reserved: new Set([...inputs, ...avoid]) };
  }

  /** The pool's real boxes alone, the wallet's and others', that no other chain will spend: what a chain is built from. */
  private real({ pool, owned, others, reserved }: Split): KoiosUtxo[] {
    const real = new Set([...owned, ...others].map(ref));
    return pool.filter((u) => real.has(outpoint(u)) && !reserved.has(outpoint(u)));
  }

  /** WebAssembly's reading of the pool: the wallet's boxes, and the real boxes that aren't. */
  private ownership(network: NetworkName, pool: KoiosUtxo[]): Promise<{ boxes: OutRef[]; otherBoxes: OutRef[] }> {
    const request = JSON.stringify({ network, pool });
    return this.deps.wallet.withKeys(
      (keys) => JSON.parse(this.deps.wasm.lovejoinOwned(keys.seedelf, request)) as { boxes: OutRef[]; otherBoxes: OutRef[] },
    );
  }

  /**
   * Builds, signs and sends box's withdraw. `unlocked`: the unlock a run
   * checked it under (unlockDraws); the wallet locked and unlocked again
   * since, while Koios and giveme.my answered, it isn't sent, and waits the
   * new unlock's draw (independent review L11). `due`: the box's due time,
   * or the earliest, which the withdraw takes while it's kept (Withdrawing
   * `due`), and gives back if it never went.
   */
  private async withdrawOne(
    network: NetworkName,
    pool: KoiosUtxo[],
    box: { txHash: string; txIndex: number },
    { unlocked, due }: { unlocked?: number; due?: number | "earliest" } = {},
  ): Promise<PendingTx> {
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
    if (finished.txHash !== built.txHash) throw new Error(t("lj.signingChanged"));
    if (unlocked !== undefined && (await wallet.unlockedAt()) !== unlocked) {
      throw new Error(t("lj.lockedWhileBuilding"));
    }
    const bytes = hexBytes(finished.txCbor);
    // Kept, sealed, and its box counted as spent, before it's sent: a lock, a
    // closed browser or a stopped worker while Koios is asked leaves it to be
    // looked for (settleWithdrawing), never a withdraw the wallet forgot it
    // sent (independent review M1). Nothing is sent if it can't be kept.
    const at = now();
    await this.update(network, (s) => {
      const time = takeDue(s, due);
      s.withdrawing = {
        txHash: built.txHash,
        txCbor: finished.txCbor,
        lovelace: built.lovelace,
        fee: built.fee,
        at,
        sentAt: at,
        ...(time !== undefined ? { due: time } : {}),
      };
    });
    try {
      await wallet.withKeys(() => rememberSpent(session, network, bytes, at));
    } catch (e) {
      // A lock came first: nothing was sent (final review F5).
      await this.neverWent(network, built.txHash);
      throw e;
    }
    let submitted: string;
    try {
      submitted = await koios.submitTx(bytes);
    } catch (e) {
      // Refused (Koios said why), or never passed on (a 429, which Koios's
      // gateway answers first): nothing went. Anything else (Koios didn't
      // answer, failed after passing it on, or its answer broke off) and it
      // may be in, and it's looked for.
      const refused = e instanceof KoiosError && !(e instanceof KoiosBusyError && e.maybeSent);
      if (!refused) throw new WithdrawMaybeSent();
      // It isn't looked for, its box is free, and its due time is back for a
      // later run, under the same rules (independent review M11), after a
      // lock meanwhile too (final review F5).
      await this.neverWent(network, built.txHash);
      await wallet.withKeys(() => forgetSpent(session, txInputs(bytes))).catch(() => undefined);
      throw e;
    }
    if (submitted !== built.txHash) {
      throw new WithdrawMaybeSent(
        t("lj.withdrawOtherTxId", { id: submitted }),
      );
    }
    // Sent: what's left is best effort. A lock before its history is written
    // leaves it looked for, and settleWithdrawing writes it once it's seen.
    // The box comes back into the private balance: the next reading reads that side again, and not the
    // account's (independent review M8).
    await wallet.withKeys(() => session.set(SESSION_PRIVATE_STALE_PREFIX + network, true)).catch(() => undefined);
    const pending: PendingTx = { kind: "lovejoin-withdraw", network, txHash: built.txHash, submittedAt: now(), confirmations: null };
    await this.deps.activity?.sent(network, pending, { lovelace: built.lovelace, fee: built.fee }).catch(() => undefined);
    await this.dropWithdrawing(network, built.txHash).catch(() => undefined);
    return pending;
  }

  /**
   * Stops looking for withdraw `txHash`: seen, sent and in the history, or
   * it never went. `back`: it never went, so the due time it took is its
   * box's again (Withdrawing `due`).
   */
  private dropWithdrawing(network: NetworkName, txHash: string, back = false): Promise<void> {
    return this.update(network, (s) => {
      const w = s.withdrawing;
      if (w?.txHash !== txHash) return;
      if (back && w.due !== undefined) s.due.push(w.due);
      delete s.withdrawing;
    });
  }

  /**
   * Withdraw `txHash` never went: its record goes, and its box's due time is
   * back. A lock that came meanwhile keeps the record sealed, so it's
   * remembered as never sent (refused), and the next look drops it rather
   * than send it again (final review F5).
   */
  private async neverWent(network: NetworkName, txHash: string): Promise<void> {
    this.refused.add(txHash);
    await this.dropWithdrawing(network, txHash, true).then(
      () => this.refused.delete(txHash),
      () => undefined,
    );
  }

  /**
   * A withdraw that never went, whose record a lock kept (neverWent): the
   * record goes, its box is free, and its due time is back, before anything
   * looks for it or sends it again (final review F5). A run does this before
   * the unlock's draws, so a due time back that's past waits one too.
   */
  private async dropRefused(network: NetworkName): Promise<void> {
    if (!this.refused.size) return;
    const { withdrawing: w } = await this.read(network);
    if (!w || !this.refused.has(w.txHash)) return;
    await this.dropWithdrawing(network, w.txHash, true);
    this.refused.delete(w.txHash);
    const { wallet, session } = this.deps;
    await wallet.withKeys(() => forgetSpent(session, txInputs(hexBytes(w.txCbor)), { at: w.sentAt })).catch(() => undefined);
  }

  /**
   * A withdraw Koios didn't answer may have gone through, so it's looked for
   * (tx_status) before any other is built. On chain, it goes in the history,
   * and that's that. Not yet, it's sent again as it was, at most every
   * CHAIN_RESEND_MS (the ledger takes it once), and its box is held as spent
   * again after a lock. After SPENT_KEEP_MS it never went: its box shows in
   * the pool again, and comes back in turn. Returns whether it's still being
   * looked for.
   *
   * `run`: the unlock's or the alarm's run, where a resend may be its first
   * real send (a submit that never reached a node), so it keeps a new
   * withdraw's rules (independent review M11): never in the unlock's run,
   * but a fresh draw into it (unlockDraws, privacy review §3.1), nor in a
   * run that sent anything else, nor within QUIET_AFTER_SEND_MS of the
   * wallet's own send (resends). The user's ask (withdrawNow) sends it again
   * at once, once a wait already drawn is over. Each resend is the wallet's
   * send too, which what comes after keeps away from (L8). `run.unlocked`:
   * the unlock the run checked it under (unlockDraws); the wallet locked and
   * unlocked again since, while Koios answered, it isn't sent then, and
   * waits the new unlock's draw, as a new withdraw does (L11, final review
   * F6).
   */
  private async settleWithdrawing(network: NetworkName, run?: { unlock: boolean; since?: number; unlocked?: number }): Promise<boolean> {
    // One that never went isn't looked for, nor sent again (final review F5).
    await this.dropRefused(network);
    const { withdrawing: w } = await this.read(network);
    if (!w) return false;
    const { wallet, session } = this.deps;
    const koios = this.deps.koios(network);
    const bytes = hexBytes(w.txCbor);
    // A lock or a closed browser wiped what the wallet spent: its box is held again, as when it was sent.
    await wallet.withKeys(async () => {
      const spent = await spentSet(session, this.deps.now());
      if (txInputs(bytes).some((o) => !spent.has(o))) await rememberSpent(session, network, bytes, w.sentAt);
    });
    const drop = () => this.dropWithdrawing(network, w.txHash);
    const seen = (await koios.txStatus([w.txHash]).catch(() => undefined))?.get(w.txHash);
    // Taken once Koios answered, which can take a minute (final review F6).
    const now = this.deps.now();
    if (seen != null) {
      const pending: PendingTx = { kind: "lovejoin-withdraw", network, txHash: w.txHash, submittedAt: w.at, confirmations: seen };
      await this.deps.activity?.sent(network, pending, { lovelace: w.lovelace, fee: w.fee }).catch(() => undefined);
      // Only the private side is read again (independent review M8).
      await this.deps.wallet.withKeys(() => this.deps.session.set(SESSION_PRIVATE_STALE_PREFIX + network, true));
      await drop();
      return false;
    }
    // Koios didn't answer this either: looked for again next time.
    if (seen === undefined) return true;
    if (now - w.at >= SPENT_KEEP_MS) {
      await drop();
      return false;
    }
    if (now - w.sentAt >= CHAIN_RESEND_MS && (w.waitUntil ?? 0) <= now && (await this.resends(network, w, now, run))) {
      // Never at the moment of an unlock that came while Koios answered: the next run draws its wait into it.
      if (run?.unlocked !== undefined && (await wallet.unlockedAt().catch(() => undefined)) !== run.unlocked) return true;
      // Refused as spent, it's in the mempool already, or its box moved: either way it's looked for again.
      await koios.submitTx(bytes).catch(() => undefined);
      await wallet.withKeys(() => rememberSpent(session, network, bytes, now));
      await this.update(network, (s) => {
        if (s.withdrawing?.txHash !== w.txHash) return;
        s.withdrawing.sentAt = now;
        delete s.withdrawing.waitUntil;
        delete s.withdrawing.pushes;
        delete s.withdrawing.unlock;
      });
    }
    return true;
  }

  /**
   * Whether withdraw `w`, due to go again and not seen yet, goes in this
   * `run` (settleWithdrawing). Not in the unlock's run. Nor in one that sent
   * anything else, nor within QUIET_AFTER_SEND_MS of the wallet's own send
   * since `w` last went (its own isn't another's), one a closed browser made
   * it forget included: that pushes it a fresh QUIET_PUSH_MS, QUIET_PUSHES
   * times at most, as a box due is.
   */
  private async resends(network: NetworkName, w: Withdrawing, now: number, run?: { unlock: boolean; since?: number }): Promise<boolean> {
    if (!run) return true;
    if (run.unlock) return false;
    const known = await this.deps.wallet.sends();
    const sent = known.sent > w.sentAt ? known.sent : 0;
    const forgotten = known.forgotten > w.sentAt ? known.forgotten : 0;
    if (run.since !== undefined && sent >= run.since) return false;
    const pushes = w.pushes ?? 0;
    const push = quiet(now, sent, forgotten);
    if (!push || pushes >= QUIET_PUSHES) return true;
    const random = this.deps.random ?? secureRandom;
    await this.update(network, (s) => {
      if (s.withdrawing?.txHash !== w.txHash) return;
      s.withdrawing.waitUntil = now + within(QUIET_PUSH_MS, random);
      s.withdrawing.pushes = pushes + 1;
      if (push === "forgotten") delete s.withdrawing.unlock;
    });
    return false;
  }

  private async read(network: NetworkName): Promise<Schedule> {
    const kept = await this.deps.store.get<Partial<Schedule>>(`lovejoin.${network}` as const);
    const record = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
    return {
      due: Array.isArray(kept?.due) ? kept.due.filter((t) => typeof t === "number") : [],
      // Kept before chains were recorded: none.
      chains: Array.isArray(kept?.chains) ? kept.chains : [],
      ...(typeof kept?.notMixed === "number" ? { notMixed: kept.notMixed } : {}),
      ...(typeof kept?.unsure === "number" ? { unsure: kept.unsure } : {}),
      ...(kept?.withdrawing ? { withdrawing: kept.withdrawing } : {}),
      // Kept before due times were drawn again, or leaves kept: none.
      ...(record(kept?.marks) ? { marks: { ...kept!.marks } } : {}),
      ...(record(kept?.leaves) ? { leaves: { ...kept!.leaves } } : {}),
      // Kept before a restore's boxes were looked up: none. One that doesn't read as an Origin is asked of again.
      ...(record(kept?.origins)
        ? {
            origins: Object.fromEntries(
              Object.entries(kept!.origins!).filter(([, o]) => record(o) && typeof o.mixed === "boolean" && typeof o.seen === "number"),
            ),
          }
        : {}),
      ...(record(kept?.asking)
        ? { asking: Object.fromEntries(Object.entries(kept!.asking!).filter(([, seen]) => typeof seen === "number")) }
        : {}),
      ...(typeof kept?.unlock === "number" ? { unlock: kept.unlock } : {}),
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
