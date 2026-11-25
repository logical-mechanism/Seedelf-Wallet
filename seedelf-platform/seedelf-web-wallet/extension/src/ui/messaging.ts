// Seedelf Messaging on the screens (chunk 54's 54f): the worker's overview of
// a network's conversations, kept fresh as the worker says it changed, and
// how each one is named. The names are protocol.md §7's labels: a Seedelf the
// user wrote to, one the other side showed with a proof that verified (§19),
// an unknown sender, and what a conversation continues. No message's text
// ever changes them, and a reveal that didn't verify never names anything.

import { useCallback, useEffect, useState } from "react";

import { dateLocale, type I18nKey, t } from "../i18n";
import type { NetworkName } from "../networks";
import {
  isMessagingChanged,
  MESSAGING_SYNC_EVERY_MS,
  type Contact,
  type MessagingConversation,
  type MessagingOverview,
} from "../shared/rpc";
import { seedelfLabel, seedelfTail } from "../shared/seedelf-name";
import { call } from "./background";
import { nameSkeleton, shortCounterparty } from "./format";

/**
 * How often a wallet page on screen asks the worker to read the relay, while Messages is on: the alarm's minute is
 * slow to talk in, and slow to show what arrived on Home's row and the top bar's count.
 */
export const SYNC_OPEN_EVERY_MS = MESSAGING_SYNC_EVERY_MS;

/**
 * This page's own ID for the worker, random and kept nowhere: the worker keeps its one grid for every page while any is
 * heard from by it (background/messaging.ts). Never sent beyond the worker.
 */
const PAGE_ID = crypto.randomUUID();

/** Calls `listener` when the worker says `network`'s messages changed. Returns an unsubscribe. */
export function onMessagingChanged(network: NetworkName, listener: () => void): () => void {
  const handler = (message: unknown) => {
    if (isMessagingChanged(message) && message.network === network) listener();
  };
  chrome.runtime.onMessage.addListener(handler);
  return () => chrome.runtime.onMessage.removeListener(handler);
}

/**
 * The network's overview while the wallet is unlocked, read again whenever the worker says it changed: what the top
 * bar's button and Home's row count, and what Messages lists. Reading it asks the worker alone, never the relay. A read
 * the worker refuses (an inbox whose record won't open, say) is kept as `error`, in the worker's words, for Messages to
 * say with Try again (screens#7, cross-feature#8): never an empty page with nothing said. `reload` resolves once its read
 * is answered, whichever way, so a Try again can say it's waiting while the read waits for a sync (O8).
 */
export function useMessagingOverview(network: NetworkName, unlocked: boolean) {
  const [overview, setOverview] = useState<MessagingOverview>();
  const [error, setError] = useState<string>();
  const reload = useCallback((): Promise<void> => {
    return call("messaging", {}).then(
      (next) => {
        setOverview(next);
        setError(undefined);
      },
      (e: Error) => {
        setOverview(undefined);
        setError(e.message);
      },
    );
  }, []);
  // An overview a press brought back (the switch, a Seedelf's switch, Start Messages again): the read it is.
  const set = useCallback((next: MessagingOverview) => {
    setOverview(next);
    setError(undefined);
  }, []);
  useEffect(() => {
    setOverview(undefined);
    setError(undefined);
    if (!unlocked) return;
    reload();
    return onMessagingChanged(network, reload);
  }, [network, unlocked, reload]);
  return { overview, error, reload, setOverview: set };
}

/**
 * While this page is seen and the network's Messages are on, asks the worker to read the relay (`pollOnGrid`): once as
 * it's shown and as it comes into view, then at each tick of the worker's one grid for every page. It isn't activity:
 * auto-lock counts on.
 */
export function useSyncWhileSeen(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    return pollOnGrid({
      ask: (kind) => call("messaging-sync", { page: PAGE_ID, kind }),
      visible: () => document.visibilityState === "visible",
      onVisibility: (listener) => {
        document.addEventListener("visibilitychange", listener);
        return () => document.removeEventListener("visibilitychange", listener);
      },
      setTimeout: (run, ms) => setTimeout(run, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    });
  }, [on]);
}

/** What `pollOnGrid` needs of the page: the worker's answer, whether it's seen, and its timers. */
export interface PollEnv {
  /** One `messaging-sync`, its kind given: the worker's answer, `nextIn` the ms until the grid's next tick. */
  ask: (kind: "grid" | "view") => Promise<{ nextIn?: unknown } | null | undefined>;
  visible: () => boolean;
  /** Calls `listener` as the page is shown or hidden. Returns an unsubscribe. */
  onVisibility: (listener: () => void) => () => void;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

/**
 * A page's poll on the worker's grid (the 1.10.0 gate's round 5): every page shown polls at the same moments, every
 * SYNC_OPEN_EVERY_MS, which the worker answers with one read, and keeps its own background work off. A sync as the page
 * is shown and as it comes into view (`view`), then one at each tick (`grid`), each set from the last answer's `nextIn`
 * and read again at every tick, so it can't drift. One at a time: a sync asked while one runs joins it, and resolves
 * once its read and its posts are done, the take going on in the background and announced by `messaging-changed`; so
 * one poll is never sent while the last is out. A tick while hidden asks nothing. An answer that fails, or says nothing
 * a page can use: the next tick SYNC_OPEN_EVERY_MS from then, and the grid read again there. Returns its stop.
 */
export function pollOnGrid(env: PollEnv): () => void {
  let asking = false;
  let stopped = false;
  let next: unknown;
  const at = (ms: number) => {
    env.clearTimeout(next);
    next = stopped ? undefined : env.setTimeout(() => sync("grid"), ms);
  };
  const sync = (kind: "grid" | "view") => {
    if (stopped || asking || !env.visible()) return;
    asking = true;
    env.ask(kind).then(
      (answer) => {
        asking = false;
        at(nextInOf(answer));
      },
      () => {
        asking = false;
        at(SYNC_OPEN_EVERY_MS);
      },
    );
  };
  const unsubscribe = env.onVisibility(() => {
    if (env.visible()) {
      sync("view");
    } else {
      env.clearTimeout(next);
      next = undefined;
    }
  });
  sync("view");
  return () => {
    stopped = true;
    env.clearTimeout(next);
    next = undefined;
    unsubscribe();
  };
}

/** The ms an answer says until the grid's next tick: SYNC_OPEN_EVERY_MS where it says none a page can wait for. */
function nextInOf(answer: unknown): number {
  const ms = (answer as { nextIn?: unknown } | null | undefined)?.nextIn;
  return typeof ms === "number" && Number.isFinite(ms) && ms >= 0 && ms <= SYNC_OPEN_EVERY_MS ? ms : SYNC_OPEN_EVERY_MS;
}

/** Messages received and not yet shown, in conversations and requests alike. */
export function unreadOf(overview: MessagingOverview | undefined): number {
  if (!overview) return 0;
  return overview.conversations.reduce((n, c) => n + c.unread, 0) + overview.requests.reduce((n, r) => n + r.unread, 0);
}

/**
 * What names a Seedelf (its asset name): the user's contact for it, else its tag; with its name cut short
 * (seedelf-name.ts `seedelfShort`), since anyone can mint a tag. A contact's name only where a contact names this
 * very Seedelf: a tag that reads the same is still a tag (screens#3), which the screens say as Send does. No word of
 * the wallet's own is in it, so a sentence that names it says nothing the critical set can't see (`seedelfTitle` adds
 * "Seedelf").
 */
export interface SeedelfShown {
  /** Its name cut to its prefix, its last sixteen and its output index. */
  short: string;
  /**
   * Its last sixteen and its output index: what tells two Seedelfs tagged alike apart. The sixteen are bytes of the
   * transaction the mint spent, which a Seedelf minted from another output of it shares; the index tells those apart.
   */
  tail: string;
  /** The contact's name for it, where one names it. */
  contact?: string;
  /** Its tag, where it has one that reads as text: anyone can mint the same. */
  tag?: string;
}

export function seedelfShown(name: string, contacts: readonly Contact[] | undefined): SeedelfShown {
  const contact = contacts?.find((c) => c.kind === "seedelf" && c.value === name)?.name;
  const tag = seedelfLabel(name);
  return {
    short: shortCounterparty(name),
    tail: seedelfTail(name),
    ...(contact !== undefined ? { contact } : {}),
    ...(tag !== undefined ? { tag } : {}),
  };
}

/** What the name's place shows for a Seedelf: the contact's name, else its tag, else "Seedelf". */
export const seedelfTitle = (shown: SeedelfShown): string => shown.contact ?? shown.tag ?? t("messages.aSeedelf");

/**
 * The other side's Seedelf, where the wallet knows it: the one it wrote to, or, where it was written to, the one the
 * other side showed and the wallet verified (protocol.md §19).
 */
export function seedelfOf(c: Pick<MessagingConversation, "role" | "handle" | "revealed">): string | undefined {
  return c.role === "initiator" ? c.handle : c.revealed?.name;
}

/**
 * A conversation's name in the list and its header: the user's own name for it, where they gave one; else protocol.md
 * §7's label, the Seedelf written to or verified, or an unknown sender.
 */
export function conversationTitle(
  c: Pick<MessagingConversation, "role" | "handle" | "name" | "revealed">,
  contacts: readonly Contact[] | undefined,
): string {
  return c.name ?? labelOf(c, contacts);
}

/**
 * The last sixteen and the output index a conversation's name shows beside it, as `…0123456789abcdef #0`: where its
 * name is the other side's Seedelf's tag (or "Seedelf"), which anyone can mint, and not the user's own name for it or a
 * contact's (screens#3).
 */
export function conversationTail(
  c: Pick<MessagingConversation, "role" | "handle" | "name" | "revealed">,
  contacts: readonly Contact[] | undefined,
): string | undefined {
  const seedelf = seedelfOf(c);
  if (c.name !== undefined || !seedelf) return undefined;
  const shown = seedelfShown(seedelf, contacts);
  return shown.contact === undefined ? `…${shown.tail}` : undefined;
}

/** protocol.md §7's label for the other side: its Seedelf, written to or verified, or an unknown sender. */
function labelOf(c: Pick<MessagingConversation, "role" | "handle" | "revealed">, contacts: readonly Contact[] | undefined): string {
  const seedelf = seedelfOf(c);
  return seedelf ? seedelfTitle(seedelfShown(seedelf, contacts)) : t("messages.unknownSender");
}

/**
 * How "Continues …" names a conversation: the user's own name for it, else its Seedelf's contact or tag, else that
 * Seedelf's short name; none for one with neither, which is then "an earlier conversation", in a sentence of its own
 * (i18n#2). Never a word of the wallet's own, put inside another sentence.
 */
export function continuedName(
  c: Pick<MessagingConversation, "role" | "handle" | "name" | "revealed">,
  contacts: readonly Contact[] | undefined,
): string | undefined {
  if (c.name !== undefined) return c.name;
  const seedelf = seedelfOf(c);
  if (!seedelf) return undefined;
  const shown = seedelfShown(seedelf, contacts);
  return shown.contact ?? shown.tag ?? shown.short;
}

/**
 * The rest of protocol.md §7's label, under the name: which Seedelf an initiator wrote to, and whether it's a contact's
 * (Send's words); the Seedelf the other side showed and the wallet verified (§19); which of the user's a stranger wrote
 * to (verified by its proof); and what it continues, verified or only said. `titleOf` names the conversation continued,
 * where it has a name to give; with none, the sentence says "an earlier conversation" whole (i18n#2). A request's row
 * says what it continues first (`continuesFirst`), where its one line would cut it off (screens#14).
 */
export function conversationDetail(
  c: Pick<MessagingConversation, "role" | "handle" | "to" | "continues" | "name" | "revealed">,
  contacts: readonly Contact[] | undefined,
  titleOf: (cid: string) => string | undefined,
  { continuesFirst = false }: { continuesFirst?: boolean } = {},
): string[] {
  // A name the user gave stands over §7's label, which is still said under it: the name is theirs, the label the
  // protocol's.
  const lines: string[] = c.name ? [labelOf(c, contacts)] : [];
  if (c.role === "initiator" && c.handle) {
    const shown = seedelfShown(c.handle, contacts);
    lines.push(shown.contact !== undefined ? t("messages.privacy.yourContact", { short: shown.short }) : shown.short);
  } else {
    if (c.revealed) {
      const shown = seedelfShown(c.revealed.name, contacts);
      lines.push(
        t(shown.contact !== undefined ? "messages.privacy.verifiedContact" : "messages.privacy.verifiedSeedelf", { name: shown.short }),
      );
    }
    if (c.to) lines.push(t("messages.privacy.wroteTo", { name: ownShown(c.to) }));
  }
  if (c.continues) {
    const name = titleOf(c.continues.cid);
    const line =
      name !== undefined
        ? t(c.continues.verified ? "messages.privacy.continues" : "messages.privacy.saysContinues", { name })
        : t(c.continues.verified ? "messages.privacy.continuesEarlier" : "messages.privacy.saysContinuesEarlier");
    if (continuesFirst) lines.unshift(line);
    else lines.push(line);
  }
  return lines;
}

/**
 * Whether a Seedelf's name, shown as a tag (not a contact's), reads the same as a contact's name for another Seedelf or
 * as another conversation's name: anyone can mint any tag, so it's said in one line, as a shared DRep name is flagged
 * (screens#3). `others` are the other conversations' names, each with its Seedelf where it has one.
 */
export function tagShared(
  seedelf: string,
  contacts: readonly Contact[] | undefined,
  others: ReadonlyArray<{ title: string; seedelf?: string }>,
): boolean {
  const shown = seedelfShown(seedelf, contacts);
  if (shown.contact !== undefined || shown.tag === undefined) return false;
  const looks = nameSkeleton(shown.tag);
  if (!looks) return false;
  return (
    !!contacts?.some((x) => x.kind === "seedelf" && x.value !== seedelf && nameSkeleton(x.name) === looks) ||
    others.some((o) => o.seedelf !== seedelf && nameSkeleton(o.title) === looks)
  );
}

/**
 * A conversation started again (or continued in a new one) that the other side answered here since (screens#2): its
 * session is live, so its box comes back and its row says its last message. Start again is offered only with no reply
 * (`unanswered`, or the writer's share of first messages used up, `firstContactLeft`) or where it can't continue
 * (`unreachable`): each is gone once a message of the other side's decrypts in it.
 */
export function answeredAfterRestart(
  c: Pick<MessagingConversation, "restartedAs" | "unanswered" | "unreachable" | "firstContactLeft">,
): boolean {
  return c.restartedAs !== undefined && !c.unanswered && !c.unreachable && c.firstContactLeft === undefined;
}

/** Written first, and the writer's share of first messages used up before a reply (W17): the next waits for one. */
export const shareUsedUp = (c: Pick<MessagingConversation, "firstContactLeft">): boolean => c.firstContactLeft?.messages === 0;

/**
 * What holds every message of a network back while its switch is on: the relay's off switch (`paused`: nothing is
 * solved or posted until it answers again), or no answer from it (`offline`). The list's notice says which, and a
 * waiting message says the same, in its row and in its thread (the 1.10.0 gate's blind reading: a paused network's
 * message counted down "sending in 1:54" beside "The server is asked again at …").
 */
export type Held = "paused" | "offline";

export const heldOf = (overview: Pick<MessagingOverview, "paused" | "offline"> | undefined): Held | undefined =>
  overview?.paused ? "paused" : overview?.offline ? "offline" : undefined;

/**
 * What a conversation's row says while a message of the user's waits, in its last message's place: what the thread
 * says of the message itself (Messages.tsx `SentState`), one line for them all.
 *
 *   paused                        "Waiting: Messages are paused", as each waiting message says
 *   every one waits for a reply   "Waiting for a reply", as each says, the switch on or off
 *   the switch off                "Waiting to send": "waiting for Messages to be on" (one still prepared: "preparing")
 *   no answer from the server     "Waiting for the server", as each says once it's prepared
 *   otherwise                     "Sending…": "preparing" or "sending", with about how long, or in how long
 *
 * None with nothing waiting: a last message that ended unsent is the row's state then ("Not sent").
 */
export function rowWaiting(
  c: Pick<MessagingConversation, "outbox" | "last">,
  on: boolean,
  held: Held | undefined,
): I18nKey | undefined {
  if (!c.outbox) return undefined;
  if (on && held === "paused") return "messages.waitingPaused";
  if (c.last?.unsent === "reply") return "messages.waitingReply";
  if (!on) return "messages.waiting";
  if (held === "offline") return "messages.waitingServer";
  return "messages.sending";
}

/**
 * How a verified reveal names the Seedelf it showed (protocol.md §19.5), as Send tells them apart (screens#3, i18n#2):
 * "your contact" and the contact's name, a tag as a tag, or the short name alone, each with the short name, which
 * no tag is in (seedelf-name.ts `seedelfShort`). One sentence each, never one put together from translated words.
 */
export function revealVerifiedText(name: string, contacts: readonly Contact[] | undefined): string {
  const shown = seedelfShown(name, contacts);
  if (shown.contact !== undefined) return t("messages.privacy.revealVerifiedContact", { contact: shown.contact, short: shown.short });
  if (shown.tag !== undefined) return t("messages.privacy.revealVerifiedTag", { tag: shown.tag, short: shown.short });
  return t("messages.privacy.revealVerified", { short: shown.short });
}

/** One of the user's own Seedelfs, as a stranger's message names it: its tag and its short name. */
export function ownShown(name: string): string {
  const tag = seedelfLabel(name);
  const short = shortCounterparty(name);
  return tag ? `${tag} (${short})` : short;
}

/** The first letter a row's round mark shows: the name's, or a question mark for an unknown sender. */
export function initialOf(title: string, known: boolean): string {
  if (!known) return "?";
  const first = [...title.trim()][0];
  return first ? first.toLocaleUpperCase() : "?";
}

/** The day a message falls on, for the thread's separators: "Today", "Yesterday", or its date. */
export function dayOf(at: number, now: number): string {
  const day = (ms: number) => new Date(new Date(ms).toDateString()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days === 0) return t("messages.today");
  if (days === 1) return t("messages.yesterday");
  const d = new Date(at);
  const year = d.getFullYear() === new Date(now).getFullYear() ? {} : ({ year: "numeric" } as const);
  return d.toLocaleDateString(dateLocale(), { weekday: "short", day: "numeric", month: "short", ...year });
}

/** A message's time, "14:02". */
export function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" });
}

/** When a list row's last message came: its time today, "Yesterday", or its date. */
export function listTimeOf(at: number, now: number): string {
  const day = (ms: number) => new Date(new Date(ms).toDateString()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days === 0) return timeOf(at);
  if (days === 1) return t("messages.yesterday");
  return new Date(at).toLocaleDateString(dateLocale(), { day: "numeric", month: "short" });
}

/**
 * How far this device's clock is off the server's, as a warning says it: in hours, one decimal, without its sign,
 * which the warning's words say (`MessagingOverview.clockOff`).
 */
export const clockHoursOf = (off: number): string => String(Math.round(Math.abs(off) * 10) / 10);

/**
 * When the relay drops a sent message: its time, with its day when that isn't today, in the language's own words for
 * a date with no word of ours in it, as the gap's time is (`momentOf`): "sent, expires …" is a label the critical
 * set holds, and so says nothing it can't see.
 */
export function expiresOf(at: number, now: number): string {
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString();
  return sameDay ? timeOf(at) : new Date(at).toLocaleString(dateLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * A moment as the list's warnings name it (when the relay said envelopes were gone; until when it holds this
 * connection's reading for the day, `MessagingOverview.dayReadUntil`; when a paused network's server is asked again,
 * `MessagingOverview.pausedAskAt`): the language's own day and time, always with its
 * day, since the day's hold can end tomorrow, and with no word of ours in it, so a warning says nothing the critical set
 * can't see.
 */
export function momentOf(at: number): string {
  return new Date(at).toLocaleString(dateLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** A text's length as a message carries it: UTF-8 bytes. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}
