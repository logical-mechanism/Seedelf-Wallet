// Seedelf Messaging on the screens (chunk 54's 54f): the worker's overview of
// a network's conversations, kept fresh as the worker says it changed, and
// how each one is named. The names are protocol.md §7's labels: a Seedelf the
// user wrote to, one the other side showed with a proof that verified (§19),
// an unknown sender, and what a conversation continues. No message's text
// ever changes them, and a reveal that didn't verify never names anything.

import { useCallback, useEffect, useState } from "react";

import { dateLocale, t } from "../i18n";
import type { NetworkName } from "../networks";
import { isMessagingChanged, type Contact, type MessagingConversation, type MessagingOverview } from "../shared/rpc";
import { seedelfLabel } from "../shared/seedelf-name";
import { call } from "./background";
import { shortCounterparty } from "./format";

/**
 * How often a wallet page on screen asks the worker to read the relay, while Messages is on: the alarm's minute is
 * slow to talk in, and slow to show what arrived on Home's row and the top bar's count.
 */
export const SYNC_OPEN_EVERY_MS = 10_000;

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
 * bar's button and Home's row count, and what Messages lists. Reading it asks the worker alone, never the relay.
 */
export function useMessagingOverview(network: NetworkName, unlocked: boolean) {
  const [overview, setOverview] = useState<MessagingOverview>();
  const reload = useCallback(() => {
    call("messaging", {}).then(setOverview, () => setOverview(undefined));
  }, []);
  useEffect(() => {
    setOverview(undefined);
    if (!unlocked) return;
    reload();
    return onMessagingChanged(network, reload);
  }, [network, unlocked, reload]);
  return { overview, reload, setOverview };
}

/**
 * While this page is seen and the network's Messages are on, asks the worker to read the relay now and every
 * SYNC_OPEN_EVERY_MS. One at a time: a sync can run past 10 seconds (a slow relay, a long catch-up, a post's proof of
 * work), and the worker runs one asked during another once more after it, so polls sent meanwhile would keep it
 * running. It isn't activity: auto-lock counts on.
 */
export function useSyncWhileSeen(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    let asking = false;
    const sync = () => {
      if (asking || document.visibilityState !== "visible") return;
      asking = true;
      call("messaging-sync", {})
        .catch(() => undefined)
        .finally(() => (asking = false));
    };
    sync();
    const every = setInterval(sync, SYNC_OPEN_EVERY_MS);
    document.addEventListener("visibilitychange", sync);
    return () => {
      clearInterval(every);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [on]);
}

/** Messages received and not yet shown, in conversations and requests alike. */
export function unreadOf(overview: MessagingOverview | undefined): number {
  if (!overview) return 0;
  return overview.conversations.reduce((n, c) => n + c.unread, 0) + overview.requests.reduce((n, r) => n + r.unread, 0);
}

/**
 * How a Seedelf (its asset name) is named: the user's contact for it, else its tag, else "Seedelf"; with its name cut
 * to parts no one else can choose, since anyone can mint a tag.
 */
export function seedelfShown(name: string, contacts: readonly Contact[] | undefined): { title: string; short: string } {
  const contact = contacts?.find((c) => c.kind === "seedelf" && c.value === name);
  return { title: contact?.name ?? seedelfLabel(name) ?? t("messages.aSeedelf"), short: shortCounterparty(name) };
}

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

/** protocol.md §7's label for the other side: its Seedelf, written to or verified, or an unknown sender. */
function labelOf(c: Pick<MessagingConversation, "role" | "handle" | "revealed">, contacts: readonly Contact[] | undefined): string {
  const seedelf = seedelfOf(c);
  return seedelf ? seedelfShown(seedelf, contacts).title : t("messages.unknownSender");
}

/**
 * The rest of protocol.md §7's label, under the name: which Seedelf an initiator wrote to, the Seedelf the other side
 * showed and the wallet verified (§19), which of the user's a stranger wrote to (verified by its proof), and what it
 * continues, verified or only said.
 */
export function conversationDetail(
  c: Pick<MessagingConversation, "role" | "handle" | "to" | "continues" | "name" | "revealed">,
  contacts: readonly Contact[] | undefined,
  titleOf: (cid: string) => string | undefined,
): string[] {
  // A name the user gave stands over §7's label, which is still said under it: the name is theirs, the label the
  // protocol's.
  const lines: string[] = c.name ? [labelOf(c, contacts)] : [];
  if (c.role === "initiator" && c.handle) lines.push(seedelfShown(c.handle, contacts).short);
  else {
    if (c.revealed) lines.push(t("messages.verifiedSeedelf", { name: seedelfShown(c.revealed.name, contacts).short }));
    if (c.to) lines.push(t("messages.wroteTo", { name: ownShown(c.to) }));
  }
  if (c.continues) {
    const name = titleOf(c.continues.cid) ?? t("messages.anEarlier");
    lines.push(t(c.continues.verified ? "messages.continues" : "messages.saysContinues", { name }));
  }
  return lines;
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

/** When the relay drops a sent message: its time, with its day when that isn't today. */
export function expiresOf(at: number, now: number): string {
  const days = Math.round((new Date(new Date(at).toDateString()).getTime() - new Date(new Date(now).toDateString()).getTime()) / 86_400_000);
  if (days === 0) return timeOf(at);
  if (days === 1) return t("messages.tomorrowAt", { time: timeOf(at) });
  return t("format.dateAndTime", { date: new Date(at).toLocaleDateString(dateLocale(), { day: "numeric", month: "short" }), time: timeOf(at) });
}

/**
 * When the relay said envelopes were gone, as the gap's warning names it: the language's own day and time, with no
 * word of ours in it, so the warning says nothing the critical set can't see.
 */
export function gapTimeOf(at: number): string {
  return new Date(at).toLocaleString(dateLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** A text's length as a message carries it: UTF-8 bytes. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}
