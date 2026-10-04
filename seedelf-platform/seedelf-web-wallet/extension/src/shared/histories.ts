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
//   box:<tx>       a box back from Lovejoin: one class each
//   unknown        nothing on the device says (a restore, or older than it keeps)
//   unknown:<tx>   the same, kept apart by the transaction that made it once
//                  any other money's history is known (independent review L40)
// Money whose histories were merged names each, sorted, joined by "+".

import { joinSentences, t } from "../i18n";
/** Where a UTxO's money came from, as WebAssembly reads it. */
export type Origin = "own" | "received" | "session" | "lovejoin" | "unknown";

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
/** Money with no history, by the transaction that made it: kept apart from other such money while anything else's is known. */
export const unknownIn = (txHash: string): HistoryClass => ({ id: `unknown:${txHash}`, origin: "unknown" });

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

function originOf(part: string): Origin {
  if (canonicalPart(part).startsWith("public:")) return "own";
  if (part.startsWith("received:")) return "received";
  if (part.startsWith("session:")) return "session";
  if (part.startsWith("box:")) return "lovejoin";
  return "unknown";
}

/** When merged money is ranked for selection, the tie that reaches furthest names it. */
const REACH: Origin[] = ["session", "own", "received", "lovejoin", "unknown"];

/** Whether `value` reads as a class. */
export function isHistoryClass(value: unknown): value is HistoryClass {
  const c = value as HistoryClass | undefined;
  return typeof c?.id === "string" && c.id !== "" && REACH.includes(c.origin);
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
  const origins = all.map(originOf);
  return { id: all.join("+"), origin: REACH.find((o) => origins.includes(o))! };
}

/** The session indexes among `c`'s parts. */
const sessionsIn = (c: HistoryClass) =>
  parts(c).flatMap((p) => (p.startsWith("session:") ? [Number(p.slice("session:".length))] : []));

/**
 * What the UTxOs screen calls each part of `c`: Back from Lovejoin, Received,
 * Made private, Private session N, Unknown. Money made private names which
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
  const boxes = all.filter((p) => p.startsWith("box:")).length;
  const received = all.filter((p) => p.startsWith("received:")).length;
  const unknown = all.filter((p) => originOf(p) === "unknown").length;
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
    said.push(t("histories.privacy.together", { lead, kinds: listed(kinds), lovejoin }));
  }
  if (accounts.length > 1) {
    said.push(t("histories.privacy.accounts", { accounts: accountNames(accounts) }));
  }
  if (session !== undefined && others.length) {
    said.push(t("histories.privacy.sessions", { sessions: sessionNames(others), count: others.length }));
  }
  return said.length ? joinSentences(said) : undefined;
}
