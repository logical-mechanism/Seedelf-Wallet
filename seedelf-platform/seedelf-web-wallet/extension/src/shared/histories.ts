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
//   public         made private from the public account (a move-in)
//   received:<tx>  a payment someone else made: one class each
//   session:<n>    what private session n's funding left, and its return
//   box:<tx>       a box back from Lovejoin: one class each
//   unknown        nothing on the device says (a restore, or older than it keeps)
//   unknown:<tx>   the same, kept apart by the transaction that made it once
//                  any other money's history is known (independent review L40)
// Money whose histories were merged names each, sorted, joined by "+".

/** Where a UTxO's money came from, as WebAssembly reads it. */
export type Origin = "own" | "received" | "session" | "lovejoin" | "unknown";

/** A UTxO's history: UTxOs of one class share it, and spending them together ties nothing new. */
export interface HistoryClass {
  id: string;
  origin: Origin;
}

export const UNKNOWN: HistoryClass = { id: "unknown", origin: "unknown" };
/** Money made private from the public account, and its change. */
export const MADE_PRIVATE: HistoryClass = { id: "public", origin: "own" };
export const receivedIn = (txHash: string): HistoryClass => ({ id: `received:${txHash}`, origin: "received" });
/** Private session `index`'s (from 0, as the worker counts them). */
export const sessionClass = (index: number): HistoryClass => ({ id: `session:${index}`, origin: "session" });
/** A box back from Lovejoin: each withdraw brings back one. */
export const boxFrom = (txHash: string): HistoryClass => ({ id: `box:${txHash}`, origin: "lovejoin" });
/** Money with no history, by the transaction that made it: kept apart from other such money while anything else's is known. */
export const unknownIn = (txHash: string): HistoryClass => ({ id: `unknown:${txHash}`, origin: "unknown" });

const parts = (c: HistoryClass) => c.id.split("+");

function originOf(part: string): Origin {
  if (part === "public") return "own";
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

/** What the UTxOs screen calls each part of `c`: Back from Lovejoin, Received, Made private, Private session N, Unknown. */
export function historyTags(c: HistoryClass): string[] {
  const tag = (p: string) => {
    switch (originOf(p)) {
      case "own":
        return "Made private";
      case "received":
        return "Received";
      case "session":
        return `Private session ${Number(p.slice("session:".length)) + 1}`;
      case "lovejoin":
        return "Back from Lovejoin";
      default:
        return "Unknown";
    }
  };
  return [...new Set(parts(c).map(tag))];
}

const count = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);
/** "a", "a and b", "a, b and c"; "a, and b and c" when the last has an "and" of its own. */
function listed(items: string[]): string {
  if (items.length < 2) return items[0] ?? "";
  const last = items[items.length - 1]!;
  return `${items.slice(0, -1).join(", ")}${last.includes(" and ") ? ", and" : " and"} ${last}`;
}
/** Private session numbers, as a person counts them. */
const sessionNames = (indexes: number[]) =>
  `Private session${indexes.length > 1 ? "s" : ""} ${listed(indexes.sort((a, b) => a - b).map((i) => String(i + 1)))}`;

/**
 * What a review says of the histories a spend's inputs have (`spent`, each
 * class once): nothing when they're one, and otherwise what spending them
 * together ties. `max`: Max sends everything, so it takes every history.
 * `session`: the private session a funding pays, whose own money ties
 * nothing new; money another session left is named.
 */
export function historiesNote(
  spent: HistoryClass[] | undefined,
  { max = false, session }: { max?: boolean; session?: number } = {},
): string | undefined {
  if (!spent?.length) return undefined;
  const all = [...new Set(spent.flatMap(parts))];
  const boxes = all.filter((p) => p.startsWith("box:")).length;
  const received = all.filter((p) => p.startsWith("received:")).length;
  const unknown = all.filter((p) => originOf(p) === "unknown").length;
  const sessions = [...new Set(spent.flatMap(sessionsIn))];
  const others = sessions.filter((i) => i !== session);
  const said: string[] = [];
  if (spent.length > 1) {
    const kinds = [
      ...(boxes ? [count(boxes, "a box back from Lovejoin", "boxes back from Lovejoin")] : []),
      ...(received ? [count(received, "a payment you received", "payments you received")] : []),
      ...(all.includes(MADE_PRIVATE.id) ? ["money you made private"] : []),
      ...(unknown === 1 ? ["money the wallet has no history for"] : []),
      ...(unknown > 1 ? [`money from ${unknown} transactions the wallet has no history for`] : []),
      ...(sessions.length ? [`money from ${sessionNames(sessions)}`] : []),
    ];
    // What's spent together, as a fact: another choice might have paid, merging other histories (independent review L39).
    const lead = max ? "Sending everything spends" : "This spends";
    const lovejoin = boxes ? `, and undoes some of what Lovejoin did for ${boxes === 1 ? "the box" : "the boxes"}` : "";
    said.push(`${lead} ${listed(kinds)} together. Anyone can see they're one owner's, which ties them to each other${lovejoin}.`);
  }
  if (session !== undefined && others.length) {
    said.push(
      `It spends money that ${sessionNames(others)} left, so anyone can tie ${others.length === 1 ? "that session" : "those sessions"} to this one.`,
    );
  }
  return said.length ? said.join(" ") : undefined;
}
