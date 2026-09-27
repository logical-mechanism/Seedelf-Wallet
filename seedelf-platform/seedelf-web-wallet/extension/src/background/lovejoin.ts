// Lovejoin, the mixer, in the worker (roadmap chunk 16).
//
// A private session's spare ADA goes through Lovejoin on its way back.
// sessions.ts asks here for the chain: WebAssembly builds all of it before
// any of it is sent (the deposit, each box fanned out, then the return),
// measured against the deployed scripts and signed with the session's key.
// sessions.ts sends it in order, each transaction on the one before's change.
//
// The boxes come back later, each on its own, after a random delay (the
// settings' range). At the first unlock after it (or the next minute's alarm
// while unlocked), a box of ours in the pool is withdrawn into a fresh
// register, paid from itself, with giveme.my's collateral: nothing ties it to
// the session. One box a run: others due at the same time wait a fresh short
// delay each (WITHDRAW_SPREAD_MS), so a wallet locked for hours doesn't send
// them all in one burst at unlock. The box that goes is the one that has
// waited longest in the pool, and only once it has waited the delay's least.
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
// wait again, each a fresh delay.
//
// Koios requests: one pool read and one evaluate for a chain; one pool read
// at each unlock, only on a wallet that has used Lovejoin here (a restored
// wallet finds its boxes when the Lovejoin tile opens); a withdraw is
// giveme.my plus one submit.

import type { LovejoinDelay, LovejoinDepth } from "../shared/preferences";
import type { NetworkName } from "../networks";
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
import { KoiosBusyError, KoiosError, SpentInputError, type KoiosUtxo } from "./koios";
import { SESSION_PENDING } from "./pending";
import type { PreferencesService } from "./preferences";
import type { PrivateStore } from "./private-store";
import type { ScriptSpendDeps } from "./script-spend";
import {
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
 * The most transactions of a chain waiting in the mempool at once. A block
 * may use 20 billion CPU steps in scripts and a mix uses 5.73 billion, so a
 * block takes 3 mixes, and a node's mempool holds about two blocks' worth. A
 * submit past that waits for a block to make room, longer than Koios answers
 * (found on preprod: a long chain's submits timed out from its 7th on). Four
 * leaves room for other people's transactions.
 */
export const CHAIN_WINDOW = 4;
/** How often a chain being sent looks for its transactions on chain. */
export const CHAIN_POLL_MS = 5_000;
/**
 * A chain's oldest transaction in the mempool that hasn't landed after this
 * long (several blocks) is sent again: a node may have dropped it, and with
 * it every transaction of the chain after it. The ledger takes it once.
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
}

/**
 * Sends more of a chain, in order, with at most CHAIN_WINDOW of it waiting in
 * the mempool: it sends while there's room, looks for what it sent on chain
 * every CHAIN_POLL_MS, and returns true once all of it is sent, or false
 * after about `budgetMs`, the rest for the next call. `send` sends transaction
 * `i` (its retries included; `maybeSent`: it may be in the mempool already),
 * `onChain` says which hashes are on chain, and `save` keeps the progress
 * after each change. A read of what's on chain that Koios doesn't answer sees
 * nothing yet; the oldest in the mempool is sent again after CHAIN_RESEND_MS.
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
        const oldest = chain.txs.findIndex((t) => t.txHash === chain.flying[0]);
        if (oldest >= 0) {
          await send(oldest, true);
          sentAt()[0] = io.now();
          await io.save();
        }
      }
    }
    while (chain.next < chain.txs.length && chain.flying.length < CHAIN_WINDOW) {
      await send(chain.next, false);
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

/** The network measured a chain's scripts differently from the wallet: the chain doesn't start. */
export class LovejoinSkipped extends Error {
  constructor(readonly reason: string) {
    super(`Lovejoin was left out: ${reason}.`);
  }
}

/** Lovejoin's `mix_box` script hash: where every box sits. Preprod only, until Lovejoin launches on mainnet. */
export const LOVEJOIN_MIX_BOX: Partial<Record<NetworkName, string>> = {
  preprod: "67ffe4ed7f0ccd0a3e3069fddc26d9bccde3fe63d3d58c5e84f7ecc5",
};

/**
 * The fewest real boxes that aren't the wallet's that Lovejoin's pool must
 * hold before a chain draws from it: a box is hidden only among others, and
 * a pool of a few hides little. Mainnet's is the owner's to tune; preprod
 * takes any pool, for testing.
 */
export const POOL_FLOOR: Record<NetworkName, number> = { preprod: 0, mainnet: 30 };

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
}

/** Why a chain whose progress is gone stopped: nothing is sending the rest. */
export const CHAIN_CUT = "The wallet locked, or the browser closed, while its chain was being sent.";

/**
 * A chain's record is kept this long after it ended, even holding no box: a
 * transaction of it a node dropped after the wallet sent it leaves a box
 * unmixed, and that box only shows again once the wallet forgets having
 * spent it (spent.ts).
 */
const RECORD_KEEP_MS = SPENT_KEEP_MS + 60 * 60_000;

interface KeptPublic extends LovejoinPublicSummary {
  chain: LovejoinChain["txs"];
  leaves: OutRef[];
  builtAt: number;
}

/** A public mix being sent: its chain, how far it has got, and why it stopped, if it did. */
interface SendingPublic extends ChainProgress {
  network: NetworkName;
  boxes: number;
  stopped?: string;
}

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
 * The most mixes one chain makes: ten boxes three waves deep, the most a mix
 * from the tile makes (about 15 s to build). Mixing boxes again takes as
 * many as fit, the pool allowing.
 */
export const MAX_CHAIN_MIXES = MAX_MIX_BOXES * mixesPerBox(3);

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

/** `boxes` by how long they've sat in the pool, longest first (Koios's `block_time`, in seconds). */
function longestFirst(boxes: OutRef[], rows: Map<string, KoiosUtxo>): OutRef[] {
  const since = (b: OutRef) => rows.get(ref(b))?.block_time ?? 0;
  return [...boxes].sort((a, b) => since(a) - since(b) || ref(a).localeCompare(ref(b)));
}

/** A whole number of boxes, one to MAX_MIX_BOXES, or why not. */
export function checkBoxes(boxes: number): void {
  if (!Number.isInteger(boxes) || boxes < 1 || boxes > MAX_MIX_BOXES) {
    throw new Error(`Mix 1 to ${MAX_MIX_BOXES} boxes at a time.`);
  }
}

export class LovejoinService {
  /** A public mix is being sent right now: the Send, the page and the alarm never send it twice at once. */
  private pumping = false;
  /** One task at a time on each record (inTurn). */
  private turns = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: LovejoinDeps) {}

  /**
   * How far the public account's mix being sent has got, if one is: sent so
   * far, of all, and why it stopped, if it did. `advance`: send more of it
   * first, if there's room (the Lovejoin page, while it's open).
   */
  async progress(network: NetworkName, advance = false): Promise<{ total: number; sent: number; stopped?: string } | null> {
    if (advance) await this.pumpPublic(network, 0).catch(() => undefined);
    const s = await this.sendingOf(network);
    if (s) return { total: s.txs.length, sent: s.next, ...(s.stopped ? { stopped: s.stopped } : {}) };
    // Its progress is gone: a lock, a closed browser or an update cut it, and its record says how far it got.
    if (!this.available(network)) return null;
    await this.cuts(network);
    const last = (await this.read(network)).chains.filter((c) => c.session === undefined).at(-1);
    return last?.stopped ? { total: last.total, sent: last.sent, stopped: last.stopped } : null;
  }

  /** Whether Lovejoin is deployed on `network`. */
  available(network: NetworkName): boolean {
    return LOVEJOIN_MIX_BOX[network] !== undefined;
  }

  async settings(): Promise<{ depth: LovejoinDepth; delay: LovejoinDelay }> {
    const p = await this.deps.preferences.get();
    return { depth: p.lovejoinDepth, delay: p.lovejoinDelay };
  }

  /** The boxes in the pool, less any a sent transaction of ours spends. */
  async pool(network: NetworkName): Promise<KoiosUtxo[]> {
    const hash = LOVEJOIN_MIX_BOX[network];
    if (!hash) throw new Error("Lovejoin isn't on this network yet.");
    const { wallet, session } = this.deps;
    const [rows, spent] = await Promise.all([
      this.deps.koios(network).credentialUtxos([hash]),
      wallet.withKeys(() => spentSet(session)),
    ]);
    return unspent(rows, spent);
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
   * How many of the wallet's boxes Mix my boxes again takes (a pool read), of
   * how many it has there: every one, as far as the pool has other boxes to
   * mix them with and one chain goes (MAX_CHAIN_MIXES).
   */
  async againBoxes(network: NetworkName): Promise<{ boxes: number; owned: number }> {
    const { depth } = await this.settings();
    const split = await this.split(network);
    const { owned, reserved } = split;
    if (!owned.length) throw new Error("None of your boxes is in Lovejoin's pool, so there's nothing to mix again.");
    this.floor(network, split.others.length);
    const others = free(split.others, reserved).length;
    const perBox = mixesPerBox(depth);
    const boxes = Math.min(free(owned, reserved).length, Math.floor(others / (perBox * 2)), Math.floor(MAX_CHAIN_MIXES / perBox));
    // None fits: say what the pool has.
    if (boxes < 1) await this.enough(others, 1);
    return { boxes, owned: owned.length };
  }

  /**
   * Why a chain can't draw from a pool with only `others` real boxes that
   * aren't the wallet's (POOL_FLOOR), or undefined when it can.
   */
  private floorShort(network: NetworkName, others: number): string | undefined {
    const floor = POOL_FLOOR[network];
    if (others >= floor) return undefined;
    return `Lovejoin's pool holds ${others} ${others === 1 ? "box" : "boxes"} that aren't yours, and the wallet mixes only once it holds ${floor}, so yours hide among enough others`;
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
   * first. Throws LovejoinSkipped when the network measures its first mix
   * differently.
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
  ): Promise<LovejoinChain | undefined> {
    if (!this.available(network) || !collateral) return undefined;
    const plan = await this.plan(network, index, rows, collateral, again);
    let count = Math.min(plan.boxes, boxes ?? plan.boxes);
    if (count < 1) return undefined;
    const { depth } = await this.settings();
    const owner = chainOwner(index);
    // Never what another chain of the wallet's will spend; this session's own
    // built before is being built again.
    const split = await this.split(network, owner);
    const short = this.floorShort(network, split.others.length);
    if (short) throw new LovejoinSkipped(short);
    const owned = free(split.owned, split.reserved);
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
    // One chain is at most MAX_CHAIN_MIXES long, whatever the spare ADA pays for: what's left comes back with the return.
    count = Math.min(count, Math.floor(others.length / (perBox * 2)), Math.floor(MAX_CHAIN_MIXES / perBox));
    // Mixing again takes the wallet's boxes in the pool's order: the ones not mixed yet go first.
    const unmixed = new Set(unmixedOf((await this.read(network)).chains, owned).map(ref));
    const first = (u: KoiosUtxo) => (unmixed.has(outpoint(u)) ? 0 : 1);
    const request = {
      network,
      params,
      index,
      utxos: rows,
      collateral: { txHash: collateral.tx_hash, txIndex: collateral.tx_index },
      pool: this.real(split).sort((a, b) => first(a) - first(b)),
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
    await this.crossCheck(network, chain);
    // Kept for Send (or sent at once): no other chain draws its boxes meanwhile.
    await this.reserve(network, owner, chain.txs, this.deps.now() + BUILT_TTL_MS);
    return chain;
  }

  /**
   * Reserves what chain `owner`'s transactions spend and put up as
   * collateral (spent.ts), in place of its reservation before: kept for Send
   * until `until`, or, without it, being sent.
   */
  reserve(network: NetworkName, owner: string, txs: LovejoinChain["txs"], until?: number): Promise<void> {
    return this.reserving(network, (kept) => {
      kept[owner] = reservationOf(txs, until);
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
    const sending = await this.sendingOf(network);
    if (sending && !sending.stopped) throw new Error("Your last mix from the public account is still being sent. Wait for it to finish.");
    const { wasm, wallet, session, now } = this.deps;
    const { params, utxos, collateral, held } = await readAccount(this.deps, network);
    if (!collateral) {
      throw new Error("Lovejoin's mixes need your public account's collateral. Set it aside in Settings, Collateral, first.");
    }
    if (!utxos.length) throw nothingInAccount(held, "Your public account is empty, so there's nothing to mix.");
    const { depth, delay } = await this.settings();
    const split = await this.split(network, chainOwner());
    this.floor(network, split.others.length);
    const request = { network, params, utxos, collateral, pool: this.real(split), depth, boxes };
    const chain = await wallet.withKeys(
      (keys) => JSON.parse(wasm.buildLovejoinFromAccount(keys.cardano, keys.seedelf, JSON.stringify(request))) as LovejoinChain,
    );
    try {
      await this.crossCheck(network, chain);
    } catch (e) {
      if (e instanceof LovejoinSkipped) throw new Error(`The network doesn't measure Lovejoin's scripts as the wallet does (${e.reason}), so nothing was sent.`);
      throw e;
    }
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
    await wallet.withKeys(() =>
      session.set(SESSION_LOVEJOIN_PUBLIC, { ...summary, chain: chain.txs, leaves: chain.leaves, builtAt: now() } satisfies KeptPublic),
    );
    await this.reserve(network, chainOwner(), chain.txs, now() + BUILT_TTL_MS);
    return summary;
  }

  /**
   * Sends the public account's mix built last, in order, each transaction on
   * the one before's change; a child Koios hasn't seen the parent of yet is
   * tried again a little later. The boxes' withdraws are set once the
   * deposit is in. Home's banner watches the last mix.
   */
  async publicSubmit(network: NetworkName, txHash: string): Promise<PendingTx> {
    const { wallet, session, now } = this.deps;
    const built = await wallet.withKeys(() => session.get<KeptPublic>(SESSION_LOVEJOIN_PUBLIC));
    if (!built || built.txHash !== txHash || built.network !== network) {
      throw new Error("That mix isn't ready to send. Review it again.");
    }
    if (now() - built.builtAt > BUILT_TTL_MS) throw new Error("That mix was built more than 10 minutes ago. Review it again.");
    const sending: SendingPublic = { network, boxes: built.boxes, txs: built.chain, next: 0, flying: [] };
    await wallet.withKeys(async () => {
      await session.set(SESSION_LOVEJOIN_SENDING + network, sending);
      await session.remove(SESSION_LOVEJOIN_PUBLIC);
    });
    // Being sent: its change to come and its collateral are the chain's too.
    await this.reserve(network, chainOwner(), built.chain);
    await this.recordChain(network, {
      progress: SESSION_LOVEJOIN_SENDING + network,
      txs: built.chain,
      leaves: built.leaves ?? [],
      boxes: built.boxes,
    });
    await this.deps.alarm?.start();
    // The first window now; the Lovejoin page and the alarm send the rest as blocks make room.
    await this.pumpPublic(network, 0);
    const pending: PendingTx = { kind: "lovejoin-mix", network, txHash, submittedAt: now(), confirmations: null };
    await wallet.withKeys(async () => {
      await session.remove(SESSION_BALANCES_PREFIX + network);
      await session.set(SESSION_PENDING, pending);
    });
    return pending;
  }

  /**
   * More of the public mix being sent, for about `budgetMs` (a block by
   * default): a window at a time, so no more than a few of its mixes wait in
   * the mempool (pumpChain). Its Send sends the first, and the alarm and the
   * Lovejoin page the rest. Returns whether some is left to send. A
   * transaction that can't be sent stops it, and says why (progress).
   */
  async pumpPublic(network: NetworkName, budgetMs = CHAIN_PUMP_MS): Promise<boolean> {
    if (this.pumping) return true;
    const sending = await this.sendingOf(network);
    if (!sending || sending.stopped) return false;
    this.pumping = true;
    const { wallet, session } = this.deps;
    const koios = this.deps.koios(network);
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const save = () => wallet.withKeys(() => session.set(SESSION_LOVEJOIN_SENDING + network, sending));
    const id = sending.txs.at(-1)!.txHash;
    try {
      const done = await pumpChain(
        sending,
        {
          send: async (i, maybeSent) => {
            const step = sending.txs[i]!;
            const bytes = hexBytes(step.txCbor);
            const tries = { busy: 0, spent: 0, maybeSent };
            for (;;) {
              try {
                const submitted = await koios.submitTx(bytes);
                if (submitted !== step.txHash) throw new Error(`Koios answered with another transaction id (${submitted}).`);
                break;
              } catch (e) {
                // Sent already (a Send pressed twice, or a retry that got through).
                if (e instanceof SpentInputError && (await koios.txStatus([step.txHash]).catch(() => undefined))?.get(step.txHash) != null) {
                  break;
                }
                const wait = chainRetryMs(i, tries, e);
                if (wait === undefined) throw e;
                await sleep(wait);
              }
            }
            await wallet.withKeys(() => rememberSpent(session, bytes));
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
        await wallet.withKeys(() => session.remove(SESSION_LOVEJOIN_SENDING + network));
        await this.release(network, chainOwner());
      }
      return !done;
    } catch (e) {
      sending.stopped = e instanceof Error ? e.message : String(e);
      await save().catch(() => undefined);
      await this.chainEnded(network, id, sending.stopped).catch(() => undefined);
      await this.release(network, chainOwner()).catch(() => undefined);
      throw e;
    } finally {
      this.pumping = false;
    }
  }

  private sendingOf(network: NetworkName): Promise<SendingPublic | undefined> {
    return this.deps.wallet.withKeys(() => this.deps.session.get<SendingPublic>(SESSION_LOVEJOIN_SENDING + network));
  }

  /**
   * `boxes` boxes were mixed again: the earliest due times go, and each box
   * waits again, a fresh delay from now, as a deposit's boxes do.
   */
  async reschedule(network: NetworkName, boxes: number): Promise<void> {
    const due = await this.draw(boxes);
    await this.update(network, (s) => {
      s.due.sort((a, b) => a - b);
      s.due.splice(0, boxes);
      s.due.push(...due);
    });
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
   */
  async recordChain(
    network: NetworkName,
    chain: { session?: number; progress: string; txs: LovejoinChain["txs"]; leaves: OutRef[]; boxes: number; again?: boolean },
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
    await this.update(network, (s) => {
      s.chains = [...s.chains.filter((c) => c.id !== record.id), record];
    });
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

  /** Chain `id` is all sent, or `stopped` partway, and why. */
  async chainEnded(network: NetworkName, id: string, stopped?: string): Promise<void> {
    const now = this.deps.now();
    await this.update(network, (s) => {
      const c = s.chains.find((r) => r.id === id);
      if (!c || c.ended) return;
      c.ended = now;
      if (stopped === undefined) c.done = true;
      else c.stopped = stopped;
    });
  }

  /**
   * Marks each chain recorded as being sent whose progress is gone as
   * stopped: a lock, a closed browser or an update wiped it partway, and
   * nothing sends the rest (CHAIN_CUT). No Koios request.
   */
  async cuts(network: NetworkName): Promise<void> {
    const { wallet, session, now } = this.deps;
    const live = (await this.read(network)).chains.filter((c) => !c.ended);
    if (!live.length) return;
    const gone = new Set<string>();
    for (const c of live) {
      if ((await wallet.withKeys(() => session.get(c.progress))) === undefined) gone.add(c.id);
    }
    if (!gone.size) return;
    const at = now();
    await this.update(network, (s) => {
      for (const c of s.chains) {
        if (!gone.has(c.id) || c.ended) continue;
        c.stopped = CHAIN_CUT;
        c.ended = at;
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
   * or free to come back. A record that ended long enough ago and holds no
   * box anymore goes, and Home's count of boxes not mixed yet follows.
   */
  private async sortOut(network: NetworkName, owned: OutRef[]): Promise<{ unmixed: OutRef[]; free: OutRef[] }> {
    const now = this.deps.now();
    const { chains } = await this.read(network);
    const unmixed = unmixedOf(chains.filter((c) => c.ended), owned);
    await this.update(network, (s) => {
      s.chains = s.chains.filter((c) => !c.ended || now - c.ended < RECORD_KEEP_MS || unmixedOf([c], owned).length > 0);
      s.notMixed = unmixed.length;
    });
    const held = new Set(unmixedOf(chains, owned).map(ref));
    return { unmixed, free: owned.filter((b) => !held.has(ref(b))) };
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
    if (!this.available(network)) return { available: false, boxes: [], lovelace: "0", due: [], notMixed: [], chains: [] };
    await this.cuts(network);
    const owned = await this.owned(network, await this.pool(network));
    const { unmixed, free: back } = await this.sortOut(network, owned);
    const known = (await this.read(network)).due.length;
    if (back.length > known) await this.schedule(network, back.length - known);
    const { due, chains } = await this.read(network);
    return {
      available: true,
      boxes: owned,
      lovelace: (BigInt(owned.length) * LOVEJOIN_DENOM).toString(),
      due: [...due].sort((a, b) => a - b),
      notMixed: unmixed,
      chains: chains
        .filter((c) => !c.done)
        .map((c) => ({
          ...(c.session !== undefined ? { session: c.session } : {}),
          boxes: c.boxes,
          total: c.total,
          sent: c.sent,
          at: c.at,
          ...(c.stopped ? { stopped: c.stopped } : {}),
        })),
    };
  }

  /**
   * The boxes on their way back, from the schedule alone: one due time per
   * box, kept to the pool's count at each scan; how many weren't mixed yet at
   * the last one; and how many chains stopped partway. No Koios request, so
   * Home can ask whenever it shows.
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
   * Withdraws a box that's due, one a run. `scan` (at unlock) reads the pool even
   * when nothing is due yet, on a wallet that has used Lovejoin here, so its
   * boxes' due times follow the pool. One run at a time.
   */
  withdrawDue(network: NetworkName, scan = false): Promise<PendingTx[]> {
    if (!this.available(network)) return Promise.resolve([]);
    return this.inTurn(`withdraw.${network}`, () => this.withdrawDueNow(network, scan));
  }

  private async withdrawDueNow(network: NetworkName, scan: boolean): Promise<PendingTx[]> {
    // A chain mixing them again spends them: they wait until it's sent.
    if (await this.deps.mixingAgain?.(network)) return [];
    // A chain being sent is still putting boxes in and mixing them: none comes back meanwhile.
    if (await this.chainsSending(network)) return [];
    const used = (await this.deps.store.get<Schedule>(`lovejoin.${network}` as const)) !== undefined;
    const { due } = await this.read(network);
    const now = this.deps.now();
    if (!(scan && used) && !due.some((t) => t <= now)) return [];
    const pool = await this.pool(network);
    const owned = await this.owned(network, pool);
    // A box a chain of the wallet's made and hadn't finished mixing never
    // comes back by itself: it waits, not mixed yet, for Mix my boxes again.
    const { free: back } = await this.sortOut(network, owned);
    // A box with no due time (a restore) gets one; a due time with no box
    // (withdrawn by hand, or a chain that didn't go through) goes.
    if (back.length > due.length) await this.schedule(network, back.length - due.length);
    const schedule = await this.read(network);
    const kept = [...schedule.due].sort((a, b) => a - b).slice(0, back.length);
    await this.update(network, (s) => (s.due = kept));

    // One box a run. Boxes due together (the wallet stayed locked through
    // their delays) would otherwise go back to back, and a burst of withdraws
    // says they're one owner's: the others each wait a fresh delay of
    // WITHDRAW_SPREAD_MS from now, drawn on its own, and the alarm takes them
    // as they come due while the wallet is unlocked.
    const ready = kept.filter((t) => t <= now);
    const [time] = ready;
    if (time === undefined) return [];
    // The box that has waited longest, never one a chain of the wallet's will spend.
    const reserved = await this.reservedBoxes(network);
    const rows = new Map(pool.map((u) => [outpoint(u), u]));
    const [box] = longestFirst(free(back, reserved), rows);
    if (!box) return [];
    // And only once it has waited the delay's least since it came into the
    // pool: a box a mix moved minutes ago would say which mix it came from.
    const [least] = delayHours((await this.settings()).delay);
    const waited = (rows.get(ref(box))?.block_time ?? 0) * 1000 + least * HOUR;
    if (waited > now) {
      await this.update(network, (s) => {
        const at = s.due.indexOf(time);
        if (at >= 0) s.due[at] = waited;
      });
      return [];
    }
    if (ready.length > 1) {
      const random = this.deps.random ?? secureRandom;
      const [low, high] = WITHDRAW_SPREAD_MS;
      await this.update(network, (s) => {
        s.due = [time, ...s.due.filter((t) => t > now), ...ready.slice(1).map(() => now + Math.round(low + (high - low) * random()))];
      });
    }
    try {
      const pending = await this.withdrawOne(network, pool, box);
      await this.update(network, (s) => {
        const at = s.due.indexOf(time);
        if (at >= 0) s.due.splice(at, 1);
      });
      return [pending];
    } catch {
      // Tried again at the next unlock or alarm.
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
    const pool = await this.pool(network);
    const owned = await this.owned(network, pool);
    const { unmixed, free: back } = await this.sortOut(network, owned);
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
      [chosen] = longestFirst(free(back, reserved), new Map(pool.map((u) => [outpoint(u), u])));
      if (!chosen) {
        throw new Error(
          unmixed.length
            ? "Your boxes in Lovejoin's pool weren't mixed yet. Mix them again first, or choose one to bring back anyway."
            : "None of your boxes is in Lovejoin's pool.",
        );
      }
    }
    const pending = await this.withdrawOne(network, pool, chosen);
    // The earliest due time goes with a box that had one.
    if (back.some((b) => ref(b) === ref(chosen!))) {
      await this.update(network, (s) => {
        s.due.sort((a, b) => a - b);
        s.due.shift();
      });
    }
    // Home's banner watches it, as it does every send the user makes; the ones due by themselves stay out of it.
    await this.deps.wallet.withKeys(() => this.deps.session.set(SESSION_PENDING, pending));
    return pending;
  }

  /**
   * The pool (a read), the wallet's boxes in it, the real boxes that aren't,
   * and what the wallet's chains will spend, `except` one chain's own.
   */
  private async split(network: NetworkName, except?: string): Promise<Split> {
    const { wallet, session, now } = this.deps;
    const [pool, { inputs }] = await Promise.all([
      this.pool(network),
      wallet.withKeys(() => reservedSet(session, network, { except, now: now() })),
    ]);
    const { boxes, otherBoxes } = await this.ownership(network, pool);
    return { pool, owned: boxes, others: otherBoxes, reserved: inputs };
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
    const submitted = await koios.submitTx(bytes);
    if (submitted !== built.txHash) throw new Error(`Koios answered with another transaction id (${submitted}).`);
    await wallet.withKeys(async () => {
      await rememberSpent(session, bytes);
      await session.remove(SESSION_BALANCES_PREFIX + network);
    });
    const pending: PendingTx = { kind: "lovejoin-withdraw", network, txHash: built.txHash, submittedAt: now(), confirmations: null };
    await this.deps.activity?.sent(network, pending, { lovelace: built.lovelace, fee: built.fee }).catch(() => undefined);
    return pending;
  }

  private async read(network: NetworkName): Promise<Schedule> {
    const kept = await this.deps.store.get<Partial<Schedule>>(`lovejoin.${network}` as const);
    return {
      due: Array.isArray(kept?.due) ? kept.due.filter((t) => typeof t === "number") : [],
      // Kept before chains were recorded: none.
      chains: Array.isArray(kept?.chains) ? kept.chains : [],
      ...(typeof kept?.notMixed === "number" ? { notMixed: kept.notMixed } : {}),
    };
  }

  /** Changes the sealed schedule, one change at a time: the runner, the chains and the page never undo each other's. */
  private update(network: NetworkName, change: (s: Schedule) => void): Promise<void> {
    return this.inTurn(`lovejoin.${network}`, async () => {
      const schedule = await this.read(network);
      change(schedule);
      await this.deps.store.set(`lovejoin.${network}` as const, schedule);
    });
  }
}
