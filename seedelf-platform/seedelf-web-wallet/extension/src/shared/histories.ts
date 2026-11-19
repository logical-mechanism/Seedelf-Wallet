// Where each private UTxO's money came from (privacy review §2.3). Two
// Seedelf UTxOs spent in one transaction can be taken to share an owner, so a
// spend ties together the histories of everything it spends: two boxes back
// from Lovejoin, or a session's change spent in another session's funding.
//
// The worker reads each UTxO's history from the sealed Seedelf history
// (activity.ts), never from Koios, and gives it a class. WebAssembly's coin
// selection keeps different classes apart where one of the choices it tries
// without merging them pays (seedelf-core's build::Histories), and merges
// them otherwise: it never refuses what the CLI's order would pay, and
// nothing asks. The review then says what
// was merged, and the UTxOs screen tags each UTxO with where it came from.
//
// A class's id names its history:
//   public:<n>     made private from public account n (a move-in). Written
//                  bare as "public" before chunk 18, and read as "public:0":
//                  see `canonicalPart`.
//   received:<tx>  a payment someone else made: one class each
//   session:<n>    what private session n's funding left, and its return
//   box:<tx>       a box back from Lovejoin: one class each. Its origin is
//                  "mixed" where the wallet knows the box is mixed (its own
//                  chain's last mix made it, or Koios said a mix did), on its
//                  way back alone (`mixedBox`): only such a box goes first
//                  for a stealth mint, and a funding and a Send take it before
//                  any other box (l3rank#3). Anything merged with it, a
//                  spend's change included, reads "lovejoin", as every box
//                  brought back before that record was kept (chunk 51, the
//                  owner's answer 4 to B15). One whose making the wallet can't
//                  place carries its own unknown:<tx> too (`unplacedBox`):
//                  still a box, tagged Unknown beside (chunk 51, round three)
//   unknown        nothing on the device says (a restore, or older than it keeps)
//   unknown:<tx>   the same, kept apart by the transaction that made it once
//                  any other money's history is known (independent review L40)
//   elsewhere:<tx> what a spend of this phrase's made elsewhere (another
//                  Chrome profile or device) left here: ranked as another
//                  session's money, which it may be, and tagged Unknown, as
//                  this device knows nothing more of it (chunk 51, gap-g9#1)
//   change:<tx>    what a spend of the wallet's own, transaction <tx>, left in
//                  the private balance: tied in the open to what that spend
//                  paid, so a stealth mint, a pool's start or a funding takes
//                  it after money others paid and a box a mix brought back,
//                  and, nothing fresher paying, before money made private:
//                  origin "change", unless it names a public account, a
//                  session or a spend made elsewhere, when it ranks as a
//                  session's money, after money made private (`merged`);
//                  tagged Change (`leftBy`;
//                  chunk 51, the owner's answers 2 to B15 and of 2026-11-18,
//                  l2rank#6). Change kept before the part was gets it as the
//                  history is read (activity.ts classOf, l2time#2)
// Money whose histories were merged names each, sorted, joined by "+".

import { joinSentences, t } from "../i18n";
/** Where a UTxO's money came from, as WebAssembly reads it. */
export type Origin = "own" | "received" | "session" | "change" | "lovejoin" | "mixed" | "unknown";

/** A UTxO's history: UTxOs of one class share it, and spending them together ties nothing new. */
export interface HistoryClass {
  id: string;
  origin: Origin;
}

export const UNKNOWN: HistoryClass = { id: "unknown", origin: "unknown" };
/** Money made private from public account `account`, and its change. */
export const madePrivate = (account: number): HistoryClass => ({ id: `public:${account}`, origin: "own" });
export const receivedIn = (txHash: string): HistoryClass => ({ id: `received:${txHash}`, origin: "received" });
/** Private session `index`'s (from 0, as the worker counts them). */
export const sessionClass = (index: number): HistoryClass => ({ id: `session:${index}`, origin: "session" });
/** A box back from Lovejoin: each withdraw brings back one. */
export const boxFrom = (txHash: string): HistoryClass => ({ id: `box:${txHash}`, origin: "lovejoin" });
/**
 * The way back of a box the wallet knows is mixed (its own chain's last mix made it, or Koios said a mix did), withdraw
 * `txHash`, alone: the one a stealth mint takes first (chunk 51, the owner's answer 4 to B15). Its id is a box's; merged
 * with anything, it reads as one again (`merged`).
 */
export const mixedBox = (txHash: string): HistoryClass => ({ id: `box:${txHash}`, origin: "mixed" });
/** Money with no history, by the transaction that made it: kept apart from other such money while anything else's is known. */
export const unknownIn = (txHash: string): HistoryClass => ({ id: `unknown:${txHash}`, origin: "unknown" });
/**
 * The way back, withdraw `txHash`, of a box whose making the wallet can't place: one someone else put in (a register
 * copied as found included), one Koios hasn't said of, one nobody asked about. Still a box to selection, taken last and
 * one at a time, and after money others paid by a stealth mint and a funding, tagged Back from Lovejoin and Unknown, and
 * a box to a review (chunk 51, round three: l2rank#1, l2time#1, l2time#3, l2still#1).
 */
export const unplacedBox = (txHash: string): HistoryClass => merged([boxFrom(txHash), unknownIn(txHash)]);
/**
 * What transaction `txHash`, a spend of this phrase's made elsewhere, left here: one that spent the wallet's own rows,
 * which only this phrase's key can, though this device sent nothing of it (chunk 51, gap-g9#1). A funding takes it
 * last, as another session's money, which it may be.
 */
export const spentElsewhere = (txHash: string): HistoryClass => ({ id: `elsewhere:${txHash}`, origin: "session" });
/**
 * The part a spend of the wallet's own, transaction `txHash`, adds to what it leaves in the private balance, its
 * change: that money is tied in the open to what the spend paid (a new Seedelf, a pool's start, a payment), so a
 * stealth mint or a funding takes it after money others paid and a box a mix brought back (chunk 51, the owner's
 * answer 2 to B15), and, nothing fresher paying, before money made private (`merged`; the owner's answer of
 * 2026-11-18, l2rank#6). A Make public to one of the user's own accounts adds that account's instead.
 */
export const leftBy = (txHash: string): HistoryClass => ({ id: `change:${txHash}`, origin: "change" });

/**
 * The form `madePrivate` wrote before chunk 18, when there was one public
 * account: sealed history records on devices from then still hold it, bare or
 * inside a merged id ("public+session:1").
 */
const LEGACY_MADE_PRIVATE = "public";

/**
 * A part as it is compared: the bare "public" of a wallet from before several
 * accounts reads as account 0's, which is the account it was. Canonicalizing
 * on the way in is what keeps money made private from account 0 before this
 * chunk and after **one** class — two would have the wallet say a spend ties
 * two accounts together when both are account 0, which is a privacy note that
 * is simply false.
 */
const canonicalPart = (part: string) => (part === LEGACY_MADE_PRIVATE ? "public:0" : part);

/** The public account a part names, if it names one. */
const accountIn = (part: string) => {
  const canonical = canonicalPart(part);
  return canonical.startsWith("public:") ? Number(canonical.slice("public:".length)) : undefined;
};

const parts = (c: HistoryClass) => c.id.split("+").map(canonicalPart);

/** A part `spentElsewhere` wrote: ranked as a session's money, but said as money of no history, since that's all it is here. */
const elsewhere = (part: string) => part.startsWith("elsewhere:");
/** A part `leftBy` wrote: ranked as a session's money, and said as change. */
const left = (part: string) => part.startsWith("change:");

/**
 * Where a part came from. None reads "mixed": that names a box's way back alone (`mixedBox`), never merged money. Nor
 * "change": a spend's change reads as a session's here, and `merged` names it change where nothing else it carries
 * ranks it later.
 */
function originOf(part: string): Origin {
  if (canonicalPart(part).startsWith("public:")) return "own";
  if (part.startsWith("received:")) return "received";
  if (part.startsWith("session:") || elsewhere(part) || left(part)) return "session";
  if (part.startsWith("box:")) return "lovejoin";
  return "unknown";
}

/** When merged money is ranked for selection, the tie that reaches furthest names it. */
const REACH: Origin[] = ["session", "own", "received", "lovejoin", "unknown"];

/**
 * The origin of money whose history is `all` (each part once): the tie that reaches furthest (REACH), but "change" for
 * a spend's change that names no public account, no session and no spend made elsewhere, which a stealth mint, a pool's
 * start and a funding take before money made private, nothing fresher paying (chunk 51, the owner's answer of
 * 2026-11-18, l2rank#6). Change that names one of those ranks as a session's money: after money made private.
 * WebAssembly's `merged_class` reads it the same way.
 */
function originOfAll(all: string[]): Origin {
  const origins = all.map(originOf);
  const origin = REACH.find((o) => origins.includes(o)) ?? "unknown";
  const later = (p: string) => p.startsWith("session:") || elsewhere(p) || accountIn(p) !== undefined;
  return origin === "session" && all.some(left) && !all.some(later) ? "change" : origin;
}

/** Whether `value` reads as a class: of any origin, a box a mix moved too (`mixedBox`), and a spend's change (`merged`). */
export function isHistoryClass(value: unknown): value is HistoryClass {
  const c = value as HistoryClass | undefined;
  return typeof c?.id === "string" && c.id !== "" && (REACH.includes(c.origin) || c.origin === "mixed" || c.origin === "change");
}

/**
 * `value` as a class, canonical (`canonicalPart`), or undefined when it isn't
 * one: how a class sealed in the Seedelf history is read back, so a record
 * written before several accounts compares equal to one written after.
 */
export function readClass(value: unknown): HistoryClass | undefined {
  if (!isHistoryClass(value)) return undefined;
  const id = value.id.split("+").map(canonicalPart).join("+");
  return id === value.id ? value : { id, origin: value.origin };
}

/** The history of money of `classes` spent together: each part once. */
export function merged(classes: HistoryClass[]): HistoryClass {
  const all = [...new Set(classes.flatMap(parts))].sort();
  if (!all.length) return UNKNOWN;
  return { id: all.join("+"), origin: originOfAll(all) };
}

/**
 * What a private spend of the wallet's own, transaction `txHash`, left in the private balance reads as, its history
 * kept as `kept` (activity.ts classOf): with the spend's own part (`leftBy`) where that history was kept before the part
 * was, as every spend's before this release, so it ranks and is tagged as change; never where it names a public
 * account, which a Make public to one of the user's own accounts names instead of the part. Its origin is what `merged`
 * gives its parts today. Read so, it asks nothing and keeps nothing new (chunk 51, l2time#2, l2rank#6).
 */
export function spendLeft(kept: HistoryClass, txHash: string): HistoryClass {
  const all = parts(kept);
  if (all.some(left)) return merged([kept]);
  if (all.some((p) => accountIn(p) !== undefined)) return kept;
  return merged([kept, leftBy(txHash)]);
}

/**
 * `c` less its boxes: each `box:<tx>` part, and the `unknown:<tx>` a box whose making the wallet can't place carries
 * (`unplacedBox`). `c` itself when it names no box; undefined when nothing else is left. What a stranger's copy of a
 * register already on chain takes of the row it copies, its own Unknown in the box's place: whoever wrote the copy
 * knows it, and no box is what a payer knows (activity.ts classes; chunk 51, money#1, own#2, l2rank#4).
 */
export function withoutBoxes(c: HistoryClass): HistoryClass | undefined {
  const all = parts(c);
  const boxes = all.filter((p) => p.startsWith("box:"));
  if (!boxes.length) return c;
  const ofABox = new Set(boxes.map((p) => `unknown:${p.slice("box:".length)}`));
  const rest = all.filter((p) => !p.startsWith("box:") && !ofABox.has(p));
  return rest.length ? merged(rest.map((id) => ({ id, origin: originOf(id) }))) : undefined;
}

/**
 * Whether money of class `c` is a box back from Lovejoin whose making the wallet knows: one it knows is mixed
 * (`mixedBox`), or boxes alone (`boxFrom`, or several merged), with no part of unknown making. Not a box of unknown
 * making (`unplacedBox`), nor one merged with money of no history: either may tie whoever put that in, as a payment of
 * theirs would (chunk 51, l3time#3, l3still#2).
 */
export const knownBox = (c: HistoryClass | undefined): boolean =>
  c?.origin === "mixed" || (c?.origin === "lovejoin" && parts(c).every((p) => p.startsWith("box:")));

/** The session indexes among `c`'s parts. */
const sessionsIn = (c: HistoryClass) =>
  parts(c).flatMap((p) => (p.startsWith("session:") ? [Number(p.slice("session:".length))] : []));

/**
 * What the UTxOs screen calls each part of `c`: Back from Lovejoin, Received,
 * Made private, Private session N, Change, Unknown. Money made private names which
 * public account it came from once there is more than one to tell apart
 * (`accounts`, how many the wallet knows of): with one, there is nothing to
 * say and the tag stays as it was.
 */
export function historyTags(c: HistoryClass, accounts = 1): string[] {
  const tag = (p: string) => {
    switch (originOf(p)) {
      case "own":
        return accounts > 1 ? t("histories.tag.madePrivateFrom", { number: accountIn(p)! + 1 }) : t("histories.tag.madePrivate");
      case "received":
        return t("histories.tag.received");
      case "session":
        // Another profile's spend, perhaps its session's: this device knows no more of it (chunk 51, gap-g9#1).
        if (elsewhere(p)) return t("histories.tag.unknown");
        // What a spend of the wallet's own left, tied to that spend (chunk 51, the owner's answer 2 to B15).
        if (left(p)) return t("histories.tag.change");
        return t("histories.tag.session", { number: Number(p.slice("session:".length)) + 1 });
      case "lovejoin":
        return t("histories.tag.lovejoin");
      default:
        return t("histories.tag.unknown");
    }
  };
  return [...new Set(parts(c).map(tag))];
}

/**
 * "a", "a and b", "a, b and c"; "a, and b and c" when the last has an "and" of
 * its own. The joining stays here rather than in the translations because the
 * shape of the sentence is English's and must not move; what a language gets to
 * choose is the separator and the conjunction, which are keys.
 */
function listed(items: string[]): string {
  if (items.length < 2) return items[0] ?? "";
  const last = items[items.length - 1]!;
  const and = last.includes(t("histories.list.and")) ? t("histories.list.andAnd") : t("histories.list.and");
  return `${items.slice(0, -1).join(t("histories.list.comma"))}${and}${last}`;
}

// The names and kinds below are `.privacy.`: they say which histories a
// note's spend ties together, so each is part of that privacy note.

/** Private session numbers, as a person counts them. */
const sessionNames = (indexes: number[]) =>
  t("histories.privacy.sessionNames", {
    count: indexes.length,
    list: listed(indexes.sort((a, b) => a - b).map((i) => String(i + 1))),
  });
/** Public account numbers, as a person counts them (from 1). */
const accountNames = (indexes: number[]) =>
  t("histories.privacy.accountNames", {
    count: indexes.length,
    list: listed(indexes.sort((a, b) => a - b).map((i) => String(i + 1))),
  });

/**
 * What a review says of the histories a spend's inputs have (`spent`, each
 * class once; two that name the same history count once all the same): nothing when they're one, and otherwise what spending them
 * together ties. `max`: Max sends everything, so it takes every history.
 * `session`: the private session a funding pays, whose own money ties
 * nothing new; money another session left is named.
 */
export function historiesNote(
  spent: HistoryClass[] | undefined,
  { max = false, session }: { max?: boolean; session?: number } = {},
): string | undefined {
  if (!spent?.length) return undefined;
  // By canonical id (`canonicalPart`): a wallet from before several accounts
  // can hold the bare "public" beside a fresh "public:0", which are the same
  // history. Counted as two, the note would say a spend merges histories when
  // it merges none.
  const classes = [...new Map(spent.map((c) => [parts(c).join("+"), c])).values()];
  const all = [...new Set(classes.flatMap(parts))];
  const box = (p: string) => p.startsWith("box:");
  // A box an earlier spend took is that spend's change now, said as change: no box back from Lovejoin here, nor any
  // of a mix to undo (chunk 51, l2rank#5).
  const boxes = new Set(classes.flatMap((c) => (parts(c).some(left) ? [] : parts(c).filter(box)))).size;
  const received = all.filter((p) => p.startsWith("received:")).length;
  // What an earlier spend of the wallet's own left (`leftBy`), by that spend (chunk 51, l2rank#5).
  const changes = all.filter(left).length;
  // A box whose making the wallet can't place carries its own unknown:<tx> (`unplacedBox`): that's the box, said as
  // one, never money of another transaction (chunk 51, round three).
  const ofABox = new Set(all.filter(box).map((p) => `unknown:${p.slice("box:".length)}`));
  // What another profile's spend left is money the wallet has no history for, as its tag says (chunk 51, gap-g9#1).
  const unknown = all.filter((p) => (originOf(p) === "unknown" || elsewhere(p)) && !ofABox.has(p)).length;
  const sessions = [...new Set(classes.flatMap(sessionsIn))];
  const others = sessions.filter((i) => i !== session);
  // Which public accounts money was made private from: more than one, and
  // this spend ties those accounts to each other in the open (chunk 18).
  const accounts = [...new Set(all.flatMap((p) => { const n = accountIn(p); return n === undefined ? [] : [n]; }))];
  const said: string[] = [];
  if (classes.length > 1) {
    const kinds = [
      ...(boxes ? [t("histories.kind.privacy.boxes", { count: boxes })] : []),
      ...(received ? [t("histories.kind.privacy.received", { count: received })] : []),
      ...(changes ? [t("histories.kind.privacy.change", { count: changes })] : []),
      ...(accounts.length
        ? [
            accounts.length > 1 || accounts[0] !== 0
              ? t("histories.kind.privacy.madePrivateFrom", { accounts: accountNames(accounts) })
              : t("histories.kind.privacy.madePrivate"),
          ]
        : []),
      ...(unknown === 1 ? [t("histories.kind.privacy.unknownOne")] : []),
      ...(unknown > 1 ? [t("histories.kind.privacy.unknownMany", { count: unknown })] : []),
      ...(sessions.length ? [t("histories.kind.privacy.sessions", { sessions: sessionNames(sessions) })] : []),
    ];
    // What's spent together, as a fact: another choice might have paid, merging other histories (independent review L39).
    const lead = t(max ? "histories.privacy.leadMax" : "histories.privacy.lead");
    const lovejoin = boxes ? t("histories.privacy.lovejoinUndone", { count: boxes }) : "";
    // Never with nothing to name: "This spends  together" (chunk 51, l2rank#5).
    if (kinds.length) said.push(t("histories.privacy.together", { lead, kinds: listed(kinds), lovejoin }));
  }
  if (accounts.length > 1) {
    said.push(t("histories.privacy.accounts", { accounts: accountNames(accounts) }));
  }
  if (session !== undefined && others.length) {
    said.push(t("histories.privacy.sessions", { sessions: sessionNames(others), count: others.length }));
  }
  return said.length ? joinSentences(said) : undefined;
}
