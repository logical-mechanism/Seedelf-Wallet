// Seedelf Messaging's screen (chunk 54's 54f), reached from the top bar's
// round button and from Home's row, as a messenger lays one out: the
// conversations on the left, the one picked on the right, its messages with
// their times and the box to write in at the foot. Where the window is too
// narrow for both, the list comes first and a conversation takes its place,
// with Back to the list.
//
// Everything here asks the worker (background/messaging.ts), which alone
// reads the relay, and only while the network's switch is on (call 9). The
// names are protocol.md §7's labels; a message's states are §6's and §10's:
// "sent, expires at …", never "delivered"; "missing", never "expired".
// Nothing in a message starts a payment: its text is shown as text.
//
// Where the user wrote first and has a reply, Show my Seedelf proves one of
// the wallet's Seedelfs to the other side (§19, call 15). A Seedelf the other
// side showed names the conversation only once it's verified, and checked on
// the chain at the user's press; one that isn't is never named, since an
// unverified "says they're …" would be a tool for phishing. The wallet's own
// notice of it is drawn as a notice, never as a bubble of the other side's, so
// no text a message carries can pass for it (the 1.10.0 gate's screens#1).
// A tag is said as a tag, with its last sixteen and its output index, and a
// contact's name only for that contact's Seedelf, as Send says them (screens#3).

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import { joinList, joinSentences, Rich, useT } from "../../i18n";
import { MESSAGING_NETWORKS, messagingOpen, NETWORKS, type NetworkName } from "../../networks";
import {
  CONVERSATION_NAME_CHARS as NAME_CHARS,
  type Contact,
  type MessagingConversation,
  type MessagingEntry,
  type MessagingOverview,
  type MessagingSeedelf,
  type MessagingThread,
} from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { ContactEditor, useContacts } from "../components/Contacts";
import {
  BackIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  MessageIcon,
  PencilIcon,
  PenIcon,
  SendIcon,
  ShieldIcon,
  SpinnerIcon,
  TrashIcon,
  UserPlusIcon,
} from "../components/Icons";
import { Modal } from "../components/Modal";
import { RadioCards } from "../components/RadioCards";
import { pressedBack, useBrowserBack } from "../history";
import {
  answeredAfterRestart,
  clockHoursOf,
  continuedName,
  conversationDetail,
  conversationTail,
  conversationTitle,
  dayOf,
  expiresOf,
  type Held,
  heldOf,
  initialOf,
  listTimeOf,
  momentOf,
  onMessagingChanged,
  ownShown,
  revealVerifiedText,
  rowWaiting,
  seedelfOf,
  shareUsedUp,
  tagShared,
  timeOf,
  utf8Length,
} from "../messaging";
import { useNetwork } from "../network";
import { usePreferences } from "../preferences";
import { waitText } from "../sites";
import { SeedelfNameInput, type Found } from "./Transfer";

/** Wide enough for the list and a conversation side by side. */
const WIDE = "(min-width: 760px)";

/** A relay's gap is said for as long as a message sent then could still have been on it, and a margin. */
const GAP_SHOWN_MS = 48 * 3600_000;

/**
 * How long a press runs before it says it's waiting. A press, and a screen's read, waits while Messages read or post
 * (the 1.10.0 gate's O8), and in the TAKE_MARGIN_MS (3 s) before each read the wallet makes by itself, until that read
 * is done: a few seconds at most, as long as the server's timeouts at most. Under this, its button
 * is only disabled, so a quick press doesn't flash a word.
 */
export const PRESS_WAIT_SHOWN_MS = 700;

/** What the right-hand pane shows. A thread may open with a text still to send, and why it wasn't: a reply's. */
type Open = { kind: "thread"; cid: string; draft?: Draft } | { kind: "request"; cid: string } | { kind: "new" };

/** A text the box opens with, and why it wasn't sent: a request's reply, accepted, whose message was refused. */
interface Draft {
  text: string;
  error: string;
}

export function Messages({
  overview,
  error,
  reload,
  setOverview,
  onBack,
}: {
  overview: MessagingOverview | undefined;
  /** Why the overview couldn't be read, in the worker's words: said with Try again, never a blank page. */
  error?: string;
  /** Reads the overview again. */
  reload?: () => void;
  setOverview: (o: MessagingOverview) => void;
  onBack: () => void;
}) {
  const t = useT();
  const wide = useWide();
  const [open, setOpen] = useState<Open>();
  const [contacts, setContacts] = useContacts();
  const on = overview?.on === true;
  // A request's reply refused after its accept, while the user had moved on: kept for when its conversation is next
  // opened, never dropped unsaid (screens#6).
  const drafts = useRef(new Map<string, Draft>());

  // Read when Messages opens, not only when the worker says something changed: one that failed before is asked again
  // here (screens#7).
  useEffect(() => {
    reload?.();
  }, [reload]);

  // A conversation opened with the draft a refused reply left it, once.
  const openPane = useCallback((next: Open | undefined) => {
    if (next?.kind === "thread" && !next.draft) {
      const draft = drafts.current.get(next.cid);
      drafts.current.delete(next.cid);
      setOpen(draft ? { ...next, draft } : next);
    } else setOpen(next);
  }, []);

  // A pane's action that finishes after the user moved on (a reply's accept, a start, a restart) leaves them where they
  // are: it moves on only from the pane that asked. Whether it moved.
  const shown = useRef(open);
  shown.current = open;
  const from =
    (asker: Open) =>
    (next: Open | undefined): boolean => {
      const now = shown.current;
      const still = now?.kind === asker.kind && (now.kind === "new" || (asker.kind !== "new" && now.cid === asker.cid));
      if (still) setOpen(next);
      return still;
    };

  // Back, the browser's too: from a conversation to the list where only one shows, else Home.
  const back = !wide && open ? () => setOpen(undefined) : onBack;
  useBrowserBack(back);

  // What "Continues …" names: a conversation the user named, or whose Seedelf is known. One that's only an unknown
  // sender's, or gone, is "an earlier conversation", in a sentence of its own (i18n#2).
  const titleOf = useCallback(
    (cid: string) => {
      const c = overview?.conversations.find((x) => x.cid === cid);
      return c ? continuedName(c, contacts) : undefined;
    },
    [overview, contacts],
  );
  // Every conversation's name, with its Seedelf: what a tag is held to (`tagShared`).
  const titles = (overview?.conversations ?? []).map((c) => ({
    cid: c.cid,
    title: conversationTitle(c, contacts),
    ...(seedelfOf(c) ? { seedelf: seedelfOf(c) } : {}),
  }));

  const list = (
    <ListPane
      overview={overview}
      error={error}
      reload={reload}
      contacts={contacts}
      open={open}
      onOpen={openPane}
      onBack={onBack}
      onSwitched={setOverview}
      titleOf={titleOf}
    />
  );
  const pane = open ? (
    open.kind === "thread" ? (
      <ThreadPane
        key={open.cid}
        cid={open.cid}
        draft={open.draft}
        on={on}
        held={heldOf(overview)}
        contacts={contacts}
        onContacts={setContacts}
        titleOf={titleOf}
        others={titles.filter((x) => x.cid !== open.cid)}
        onBack={wide ? undefined : () => setOpen(undefined)}
        onOpen={(cid) => from(open)({ kind: "thread", cid })}
        onGone={() => from(open)(undefined)}
      />
    ) : open.kind === "request" ? (
      <RequestPane
        key={open.cid}
        cid={open.cid}
        request={overview?.requests.find((r) => r.cid === open.cid)}
        on={on}
        titleOf={titleOf}
        onBack={wide ? undefined : () => setOpen(undefined)}
        onAccepted={(draft) => {
          // Moved on meanwhile: the text and why are kept for the conversation, said when it's next opened.
          if (!from(open)({ kind: "thread", cid: open.cid, ...(draft ? { draft } : {}) }) && draft) drafts.current.set(open.cid, draft);
        }}
        onGone={() => from(open)(undefined)}
      />
    ) : (
      <NewMessagePane
        on={on}
        onContacts={setContacts}
        onBack={wide ? undefined : () => setOpen(undefined)}
        onStarted={(cid) => from(open)({ kind: "thread", cid })}
      />
    )
  ) : (
    <div className="messages__empty" data-testid="messages-pick">
      <MessageIcon size={28} />
      <p>{t("messages.pick")}</p>
    </div>
  );

  return (
    <section className={`messages ${wide ? "messages--wide" : "messages--narrow"}`} aria-label={t("messages.title")} data-testid="messages">
      {(wide || !open) && <div className="messages__list">{list}</div>}
      {(wide || open) && <div className="messages__pane">{pane}</div>}
    </section>
  );
}

/**
 * Reads `load` when the pane opens, and again when the worker says the network's messages changed, but only while the
 * page is seen: reading a thread or a request marks it read, so a page left in a background tab that read it would
 * clear an unread count nobody saw. Seen again, it reads.
 */
function useReadWhileSeen(network: NetworkName, load: () => void): void {
  useEffect(() => {
    const read = () => {
      if (document.visibilityState === "visible") load();
    };
    read();
    const stop = onMessagingChanged(network, read);
    document.addEventListener("visibilitychange", read);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", read);
    };
  }, [network, load]);
}

/** Where Messages is open, said on a network where it isn't: the list's line, and the box's in a pane there. */
const openOn = (t: ReturnType<typeof useT>) =>
  t("messages.warn.openOn", { network: joinList(MESSAGING_NETWORKS.map((n) => NETWORKS[n].label)) });

/** Whether the window is wide enough for the list and a conversation side by side. */
function useWide(): boolean {
  const [wide, setWide] = useState(() => matchMedia(WIDE).matches);
  useEffect(() => {
    const query = matchMedia(WIDE);
    const changed = () => setWide(query.matches);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  return wide;
}

/** Whether `busy` has lasted PRESS_WAIT_SHOWN_MS: when a press says it's waiting. It only draws: it asks nothing. */
function useWaiting(busy: boolean): boolean {
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    setWaited(false);
    if (!busy) return;
    const timer = setTimeout(() => setWaited(true), PRESS_WAIT_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [busy]);
  return busy && waited;
}

/**
 * Draws again once the soonest of `ats` (ms, this device's clock) has passed, so a line that holds until then (the
 * day's reading, a paused network's next ask) says no time that's gone. It only draws: it asks nothing.
 */
function useRedrawAt(...ats: Array<number | undefined>): void {
  const [, redraw] = useState(0);
  const now = Date.now();
  const next = Math.min(...ats.filter((at): at is number => at !== undefined && at > now));
  useEffect(() => {
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => redraw((n) => n + 1), Math.min(next - Date.now() + 50, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [next]);
}

/**
 * A press that asks the worker: one at a time, so a press while one runs is dropped, never sent twice; busy while it
 * runs, and saying it's waiting once it has run PRESS_WAIT_SHOWN_MS (O8), on the button pressed (`waits`); its refusal
 * said in the worker's words. `which` names the press, where one hook serves several buttons.
 */
function usePress() {
  const running = useRef(false);
  const [pressed, setPressed] = useState<string>();
  const [error, setError] = useState<string>();
  const waiting = useWaiting(pressed !== undefined);
  const run = async (ask: () => Promise<unknown>, which = "") => {
    if (running.current) return;
    running.current = true;
    setPressed(which);
    setError(undefined);
    try {
      await ask();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      running.current = false;
      setPressed(undefined);
    }
  };
  /** Whether the press `which` runs and has waited long enough to say so. */
  const waits = (which: string) => waiting && pressed === which;
  return { busy: pressed !== undefined, waiting, waits, error, run };
}

/** What a press's button says: its own words, or that it's waiting (O8). */
function PressLabel({ waits, children }: { waits: boolean; children: ReactNode }) {
  const t = useT();
  return <>{waits ? t("messages.pressWaiting") : children}</>;
}

function ListPane({
  overview,
  error: readError,
  reload,
  contacts,
  open,
  onOpen,
  onBack,
  onSwitched,
  titleOf,
}: {
  overview: MessagingOverview | undefined;
  error?: string;
  reload?: () => void | Promise<void>;
  contacts: Contact[] | undefined;
  open: Open | undefined;
  onOpen: (open: Open) => void;
  onBack: () => void;
  onSwitched: (o: MessagingOverview) => void;
  titleOf: (cid: string) => string | undefined;
}) {
  const t = useT();
  const network = useNetwork();
  const { prefs, loaded } = usePreferences();
  const press = usePress();
  const [clearing, setClearing] = useState(false);
  // A line that holds until a time says nothing once it's gone: the day's reading, a paused network's next ask.
  useRedrawAt(overview?.dayReadUntil, overview?.pausedAskAt);
  const now = Date.now();
  // The switch as the overview says it, or as the settings do where the overview can't be read: it's still the
  // user's to turn (cross-feature#8).
  const on = overview ? overview.on : loaded && prefs.messaging[network];
  // Messages isn't open on every network yet (networks.ts `MESSAGING_NETWORKS`, the owner's call 2026-11-24): where
  // it isn't, the page says where it is and offers no switch, and nothing is written from here, nor from a pane of
  // what a development build left there (`closed`, below: its box, Accept, Start again and Show my Seedelf).
  const closed = !messagingOpen(network);

  const flip = () =>
    press.run(async () => {
      try {
        onSwitched(await call("messaging-switch", { on: !on }));
      } catch (e) {
        // Turned, maybe, and the overview after it refused: read again, whatever it says.
        void reload?.();
        throw e;
      }
    }, "switch");

  const gap = overview?.gapAt !== undefined && now - overview.gapAt < GAP_SHOWN_MS ? overview.gapAt : undefined;
  // The relay's hold on this connection's reading for the day (W16): said while it holds, by this device's clock.
  const dayRead = overview?.dayReadUntil !== undefined && overview.dayReadUntil > now ? overview.dayReadUntil : undefined;
  // A paused network's next ask of the server (fix A): said while it's ahead. Only the server's answer ends the pause,
  // never this time, so past it the line says only that Messages are paused.
  const askAt = overview?.pausedAskAt !== undefined && overview.pausedAskAt > now ? overview.pausedAskAt : undefined;
  // The messages dropped before they could be read, as many as the line says: what Dismiss tells the worker was seen.
  const droppedUnread = overview?.droppedUnread ?? 0;
  const empty = overview && !overview.conversations.length && !overview.requests.length;
  const seedelfs = overview?.seedelfs ?? [];

  return (
    <>
      <header className="messages__head">
        <button
          type="button"
          className="icon-button"
          onClick={() => {
            pressedBack();
            onBack();
          }}
          aria-label={t("common.back")}
          title={t("common.back")}
        >
          <BackIcon />
        </button>
        <h1 className="messages__title">{t("messages.title")}</h1>
        <button
          type="button"
          className="icon-button"
          onClick={() => onOpen({ kind: "new" })}
          aria-label={t("messages.new")}
          title={t("messages.new")}
          aria-pressed={open?.kind === "new"}
          disabled={!overview || closed}
          data-testid="messages-new"
        >
          <PenIcon size={17} />
        </button>
      </header>

      <div className="messages__scroll">
        {/* Just the switch (the owner, 2026-11-22): what it tells the server is the privacy policy's. On a network
            Messages isn't open on, one line in its place. */}
        {closed ? (
          <p className="note messages__closed" data-testid="messages-closed">
            {openOn(t)}
          </p>
        ) : (
          <div className="setting-row messages__switch">
            <span id="messages-switch-label">{t("messages.switch")}</span>
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={on}
              aria-labelledby="messages-switch-label"
              onClick={() => void flip()}
              disabled={(!overview && !loaded) || press.busy}
              aria-busy={press.waits("switch") || undefined}
              data-testid="messages-switch"
            />
          </div>
        )}
        {/* What turning it on tells everyone (chunk 55, protocol.md §21.7; the owner's call 2): the list of who takes
            messages is public. Said while it's off, before the press. */}
        {!closed && (overview || loaded) && !on && (
          <p className="note" data-testid="messages-lists">
            {t("messages.privacy.listsSeedelfs")}
          </p>
        )}
        {press.waits("switch") && (
          <p className="note messages__waiting" role="status" data-testid="press-waits">
            {t("messages.pressWaiting")}
          </p>
        )}
        {press.error && (
          <p className="error" role="alert">
            {press.error}
          </p>
        )}
        {/* While Messages are a test (the owner, 2026-11-24): the Seedelf key is the same on every network, so the test
            is for a wallet that holds nothing on mainnet (seedelf-messaging/docs/security.md). */}
        {!closed && (
          <Callout tone="warn" testId="messages-test-wallet">
            {t("messages.warn.testWallet")}
          </Callout>
        )}

        {/* The overview the worker couldn't read: its words, Try again, and, for an inbox that won't open, starting this
            network's Messages again behind a question (screens#7, cross-feature#8). */}
        {!overview && readError && (
          <div className="messages__problem" data-testid="messages-read-error">
            <p className="error" role="alert">
              {readError}
            </p>
            <div className="messages__problem-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => void press.run(async () => reload?.(), "read")}
                disabled={press.busy}
                data-testid="messages-read-again"
              >
                <PressLabel waits={press.waits("read")}>{t("common.tryAgain")}</PressLabel>
              </button>
              <button type="button" className="link link--quiet" onClick={() => setClearing(true)} data-testid="messages-clear">
                {t("messages.clear")}
              </button>
            </div>
          </div>
        )}

        {/* The relay's off switch (W15, fix A) stands in for "can't reach": it's on purpose, and an update is coming;
            with when the wallet next asks the server, where the worker gives it. */}
        {on && overview?.paused && (
          <Callout tone="warn" testId="messages-paused">
            {joinSentences([t("messages.warn.paused"), askAt !== undefined && t("messages.warn.pausedAskAt", { when: momentOf(askAt) })])}
          </Callout>
        )}
        {on && overview?.offline && (
          <Callout tone="warn" testId="messages-offline">
            {t("messages.warn.offline")}
          </Callout>
        )}
        {/* The relay answered that this connection read its share for the day (W16): not "can't reach", and sending
            goes on. */}
        {on && dayRead !== undefined && (
          <Callout tone="warn" testId="messages-day-read">
            {t("messages.warn.dayRead", { when: momentOf(dayRead) })}
          </Callout>
        )}
        {overview?.stopped && (
          <StateLine testId="messages-stopped" text={t("messages.warn.stopped")}>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                void press.run(async () => {
                  await call("messaging-retry", {});
                  await reload?.();
                }, "retry")
              }
              disabled={press.busy}
              data-testid="messages-retry"
            >
              <PressLabel waits={press.waits("retry")}>{t("common.tryAgain")}</PressLabel>
            </button>
          </StateLine>
        )}
        {overview?.full && (
          <Callout tone="warn" testId="messages-full">
            {t("messages.warn.full")}
          </Callout>
        )}
        {overview?.dropped !== undefined && overview.dropped > 0 && (
          <Callout tone="warn" testId="messages-dropped">
            {t("messages.warn.dropped", { count: overview.dropped })}
          </Callout>
        )}
        {/* Dropped unopened, more having come at once than the wallet takes (the 1.10.0 gate's f5): they may be anyone's,
            and deleting a conversation doesn't bring them back, so never the no-room words above. It goes at Dismiss,
            the user's press alone, which tells the worker how many were seen: never by itself, since what was dropped
            is the wallet's envelopes, and nothing they are may start a request (round 4's #6). */}
        {droppedUnread > 0 && (
          <Callout tone="warn" testId="messages-dropped-unread">
            <span className="callout__row">
              <span data-testid="messages-dropped-unread-text">{t("messages.warn.droppedUnread", { count: droppedUnread })}</span>
              <button
                type="button"
                className="link callout__dismiss"
                onClick={() => void press.run(async () => onSwitched(await call("messaging-seen", { droppedUnread })), "seen")}
                disabled={press.busy}
                data-testid="messages-dropped-seen"
              >
                <PressLabel waits={press.waits("seen")}>{t("messages.dismissDropped")}</PressLabel>
              </button>
            </span>
          </Callout>
        )}
        {overview?.clockOff !== undefined && (
          <Callout tone="warn" testId="messages-clock">
            {t(overview.clockOff > 0 ? "messages.warn.clockAhead" : "messages.warn.clockBehind", { hours: clockHoursOf(overview.clockOff) })}
          </Callout>
        )}
        {on && gap !== undefined && (
          <Callout tone="warn" testId="messages-gap">
            {t("messages.warn.gap", { when: momentOf(gap) })}
          </Callout>
        )}
        {/* The worker reads every network whose switch is on, whichever the wallet shows (call 9): said, with the way
            to turn it off from here (docs-claims#3). */}
        {overview?.alsoOn?.map((other) => (
          <StateLine key={other} testId="messages-also-on" text={t("messages.warn.alsoOn", { network: NETWORKS[other].label })}>
            <button
              type="button"
              className="secondary"
              onClick={() => void press.run(async () => onSwitched(await call("messaging-switch", { on: false, network: other })), `off:${other}`)}
              disabled={press.busy}
            >
              <PressLabel waits={press.waits(`off:${other}`)}>{t("messages.turnOff")}</PressLabel>
            </button>
          </StateLine>
        ))}

        {overview && overview.requests.length > 0 && (
          <div className="messages__group">
            <h2>{t("messages.requests", { count: overview.requests.length })}</h2>
            <ul className="convos" data-testid="messages-requests">
              {overview.requests.map((r) => (
                <li key={r.cid}>
                  <button
                    type="button"
                    className="convo"
                    aria-current={open?.kind === "request" && open.cid === r.cid ? "true" : undefined}
                    onClick={() => onOpen({ kind: "request", cid: r.cid })}
                  >
                    <span className="convo__mark convo__mark--unknown" aria-hidden="true">
                      ?
                    </span>
                    <span className="convo__text">
                      <span className="convo__top">
                        <span className="convo__name">{t("messages.unknownSender")}</span>
                        <span className="convo__time">{listTimeOf(r.lastAt, now)}</span>
                      </span>
                      <span className="convo__bottom">
                        <span className="convo__preview">
                          {conversationDetail(
                            { role: "responder", ...(r.to ? { to: r.to } : {}), ...(r.continues ? { continues: r.continues } : {}) },
                            undefined,
                            titleOf,
                            { continuesFirst: true },
                          ).join(" · ")}
                        </span>
                        <Unread count={r.unread} />
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {overview && overview.conversations.length > 0 && (
          <div className="messages__group">
            {overview.requests.length > 0 && <h2>{t("messages.conversations")}</h2>}
            <ul className="convos" data-testid="messages-conversations">
              {overview.conversations.map((c) => (
                <li key={c.cid}>
                  <ConversationRow
                    conversation={c}
                    contacts={contacts}
                    on={on}
                    held={heldOf(overview)}
                    now={now}
                    current={open?.kind === "thread" && open.cid === c.cid}
                    onOpen={() => onOpen({ kind: "thread", cid: c.cid })}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        {empty && !closed && (
          <p className="messages__none" data-testid="messages-none">
            {on ? t("messages.none") : t("messages.noneOff")}
          </p>
        )}
        {/* The wallet's Seedelfs, under the requests and the conversations and folded into one row (the owner,
            2026-11-24): a switch for each over the list put a conversation with unread messages off the screen of a
            wallet that holds fifteen. */}
        {on && seedelfs.length > 0 && <SeedelfsRow seedelfs={seedelfs} onSwitched={onSwitched} />}
        {/* What the page always says: when messages come and how long the server keeps them, and that the phrase
            doesn't bring conversations back (where the can't-place count was, W3). */}
        <p className="note messages__unlock" data-testid="messages-notes">
          {joinSentences([t("messages.privacy.unlock"), t("messages.privacy.notRestored")])}
        </p>
      </div>
      {clearing && (
        <ClearMessages
          network={network}
          onClose={() => setClearing(false)}
          onCleared={(next) => {
            setClearing(false);
            onSwitched(next);
          }}
        />
      )}
    </>
  );
}

/** A state with a way out beside it: words on the left, a button on the right, as a conversation's are. */
function StateLine({ text, testId, children }: { text: string; testId?: string; children: ReactNode }) {
  return (
    <div className="thread__state" data-testid={testId}>
      <span>{text}</span>
      {children}
    </div>
  );
}

/**
 * The Seedelfs' switches behind one row at the foot of the list (the owner, 2026-11-24): the row says how many of the
 * wallet's Seedelfs take messages, and a press shows the switches under it, or hides them. It starts folded, but for a
 * wallet none of whose Seedelfs takes messages (one restored from its phrase has every switch off): there it starts
 * open, since nobody's first message would come and nothing would say why. The start is taken once, when the row first
 * shows: read from the count at every draw, turning the first switch on would fold the row under the press, its
 * waiting line and its error with it. Kept here and saved nowhere.
 */
function SeedelfsRow({ seedelfs, onSwitched }: { seedelfs: MessagingSeedelf[]; onSwitched: (o: MessagingOverview) => void }) {
  const t = useT();
  const id = useId();
  const taking = seedelfs.filter((s) => s.on).length;
  const [open, setOpen] = useState(taking === 0);
  // Opened by a press, the switches come into view: at the foot of a full list they'd open under its edge, and the
  // press would seem to do nothing. Never at the first draw, which leaves the list where it is.
  const fold = useRef<HTMLDivElement>(null);
  const pressed = useRef(false);
  useLayoutEffect(() => {
    if (open && pressed.current) fold.current?.scrollIntoView({ block: "nearest" });
  }, [open]);
  return (
    <div className="messages__seedelfs-fold" ref={fold}>
      <button
        type="button"
        className="menu-row menu-row--plain messages__seedelfs-row"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          pressed.current = true;
          setOpen(!open);
        }}
        data-testid="messages-seedelfs-row"
      >
        <span className="menu-row__text">
          <span>{t("messages.seedelfs")}</span>
          <span className="menu-row__sub menu-row__sub--wrap" data-testid="messages-seedelfs-count">
            {t("messages.seedelfsTaking", { on: taking, total: seedelfs.length })}
          </span>
        </span>
        {open ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
      </button>
      {open && <SeedelfSwitches boxId={id} seedelfs={seedelfs} onSwitched={onSwitched} />}
    </div>
  );
}

/**
 * The Seedelfs under the wallet's key and whether each takes first messages (W8): on for one this browser made, at the
 * register it put it under; off for any other until the user turns it on, since one someone else made under the key can
 * tie the user's Seedelfs to each other once it's answered at. Turning one on or off asks no server.
 */
function SeedelfSwitches({
  boxId,
  seedelfs,
  onSwitched,
}: {
  /** What the row that opens them names as the box it controls. */
  boxId: string;
  seedelfs: MessagingSeedelf[];
  onSwitched: (o: MessagingOverview) => void;
}) {
  const t = useT();
  const id = useId();
  const press = usePress();
  const keyOf = (s: MessagingSeedelf) => `${s.name}:${s.register.generator}:${s.register.publicValue}`;
  const flip = (s: MessagingSeedelf) =>
    press.run(async () => onSwitched(await call("messaging-answer-at", { name: s.name, register: s.register, on: !s.on })), keyOf(s));
  return (
    <div className="messages__seedelfs" id={boxId} data-testid="messages-seedelfs">
      {/* Over the switches, where they're read before one is pressed: under fifteen of them, the second line was off
          the screen (the 1.10.0 gate's blind reading). With none on, what that means, which the count alone didn't
          say. */}
      {!seedelfs.some((s) => s.on) && (
        <p className="note" data-testid="messages-seedelfs-none">
          {t("messages.seedelfsNone")}
        </p>
      )}
      {/* One line at the switches (the owner's call 2): turning one on puts it on the relay's public list. */}
      <p className="note" data-testid="messages-seedelfs-listed">
        {t("messages.privacy.listsSeedelf")}
      </p>
      {seedelfs.some((s) => !s.made) && <p className="note">{t("messages.privacy.answerAtMade")}</p>}
      {seedelfs.map((s, i) => (
        <div className="setting-row" key={keyOf(s)} data-testid="messages-seedelf">
          <span className="stack-tight">
            <span id={`${id}-${i}`} className="messages__seedelf-name">
              {ownShown(s.name)}
            </span>
            <span className="note" id={`${id}-${i}-what`}>
              {t("messages.answerAt")}
            </span>
            {/* Its good certificate on the relay's list names another key (chunk 55, protocol.md §21.8): nothing was
                posted for it here, and first messages to it go to that key. */}
            {s.elsewhere && (
              <span className="note" data-testid="messages-seedelf-elsewhere">
                {t("messages.warn.otherKey")}
              </span>
            )}
            {/* The relay won't list it again at its register (§21.7's check 3″): moving it lists it afresh. */}
            {s.tooOften && (
              <span className="note" data-testid="messages-seedelf-too-often">
                {t("messages.tooOften")}
              </span>
            )}
            {/* Its switch pressed and waiting (O8): said under it, the switch's own label unchanged. */}
            {press.waits(keyOf(s)) && (
              <span className="note messages__waiting" role="status" data-testid="press-waits">
                {t("messages.pressWaiting")}
              </span>
            )}
          </span>
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={s.on}
            aria-labelledby={`${id}-${i}-what ${id}-${i}`}
            aria-busy={press.waits(keyOf(s)) || undefined}
            onClick={() => void flip(s)}
            disabled={press.busy}
            data-testid="messages-seedelf-switch"
          />
        </div>
      ))}
      {press.error && (
        <p className="error" role="alert">
          {press.error}
        </p>
      )}
    </div>
  );
}

/** Messages not yet shown, as a count a screen reader says in words. */
function Unread({ count }: { count: number }) {
  const t = useT();
  if (count <= 0) return null;
  return (
    <span className="convo__unread">
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">{t("home.messages.unread", { count })}</span>
    </span>
  );
}

function ConversationRow({
  conversation: c,
  contacts,
  on,
  held,
  now,
  current,
  onOpen,
}: {
  conversation: MessagingConversation;
  contacts: Contact[] | undefined;
  /** The switch: off, what's written waits, never "Sending…". */
  on: boolean;
  /** What holds the network's messages back, the switch on: a waiting message's row says it, never "Sending…". */
  held: Held | undefined;
  now: number;
  current: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  const title = conversationTitle(c, contacts);
  const seedelf = seedelfOf(c);
  const known = !!seedelf || !!c.name;
  // A Seedelf no contact names goes by its tag, which anyone can mint: its name's last sixteen and its output index
  // beside it, so two Seedelfs tagged alike don't read as one. The sixteen are bytes of the transaction its mint spent,
  // which one minted from another output of it shares; the index tells those apart (seedelf-name.ts `seedelfIndex`).
  // Its own, never the first thing cut (screens#4).
  const tail = conversationTail(c, contacts);
  // Started again and answered here since: live, so its last message says, never "Started again" (screens#2).
  const restarted = c.restartedAs !== undefined && !answeredAfterRestart(c);
  // A last message of the user's that ended unsent (the server refused it, or the wallet couldn't seal it) is said, as
  // its thread says it: its text alone read "You: …", as if it went (the 1.10.0 gate's blind reading).
  const state = c.unreadable
    ? t("messages.state.warn.unreadable")
    : restarted
      ? t("messages.state.restarted")
      : c.unreachable
        ? t("messages.state.warn.cantContinue")
        : c.last?.unsent === "refused"
          ? t("messages.state.warn.notSent")
          : c.unanswered
            ? t("messages.state.warn.noReply")
            : undefined;
  // While one waits, what it waits for, as its thread says it (messaging.ts `rowWaiting`).
  const waiting = rowWaiting(c, on, held);
  // The other side's text is only ever text: "You:" and a reveal's line are the wallet's, each in a style of its own,
  // so nothing a message says reads as either (screens#1, screens#13).
  const preview =
    c.last === undefined ? (
      ""
    ) : c.last.reveal ? (
      <span className="convo__notice">{t(c.last.dir === "out" ? "messages.preview.revealOut" : "messages.preview.revealIn")}</span>
    ) : c.last.text === undefined ? (
      <span className="convo__notice">{t("messages.unreadable")}</span>
    ) : c.last.dir === "out" ? (
      <Rich k="messages.you" parts={{ text: <span className="convo__said">{c.last.text}</span> }} />
    ) : (
      c.last.text
    );
  return (
    <button type="button" className="convo" aria-current={current ? "true" : undefined} onClick={onOpen} data-testid="messages-conversation">
      <span className={known ? "convo__mark" : "convo__mark convo__mark--unknown"} aria-hidden="true">
        {initialOf(title, known)}
      </span>
      <span className="convo__text">
        <span className="convo__top">
          <span className="convo__name">{title}</span>
          {tail && <span className="convo__tail">{tail}</span>}
          <span className="convo__time">{listTimeOf(c.lastAt, now)}</span>
        </span>
        <span className="convo__bottom">
          <span
            className={
              state ? "convo__preview convo__preview--state" : c.last?.dir === "out" && !c.outbox ? "convo__preview convo__preview--you" : "convo__preview"
            }
          >
            {waiting ? t(waiting) : (state ?? preview)}
          </span>
          <Unread count={c.unread} />
        </span>
      </span>
    </button>
  );
}

/**
 * A conversation's header: Back where the list isn't beside it, its mark and name, its §7 label; and, where the other
 * side's Seedelf is known (written to, or shown and verified), Copy and Save to contacts beside Rename and Delete. A name
 * that's a tag has its last sixteen and its output index beside it, as the list's row does (screens#3). Narrow, with
 * Back, the name and the label's lines go under the row of buttons, across the pane: beside four buttons they broke
 * anywhere in a 112 px column, and the sixteen had no room (screens#14).
 */
function PaneHead({
  title,
  tail,
  known,
  detail,
  shared,
  seedelf,
  onBack,
  onSave,
  onRename,
  onDelete,
}: {
  title: string;
  /** The last sixteen and the output index of a Seedelf the name is the tag of (`conversationTail`). */
  tail?: string;
  known: boolean;
  detail: string[];
  /** The tag reads as a contact's name or another conversation's (`tagShared`). */
  shared?: boolean;
  /** The other side's Seedelf (asset name, hex), to copy. */
  seedelf?: string;
  onBack?: () => void;
  /** Saves `seedelf` to the contacts; absent once it's one. */
  onSave?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  const t = useT();
  const id = useId();
  const [copied, setCopied] = useState(false);
  const lines = [
    ...detail.map((line) => (
      <span key={line} className="thread__detail" data-testid="thread-detail">
        {line}
      </span>
    )),
    shared && (
      <span key="shared" className="thread__detail thread__detail--warn" data-testid="thread-shared-name">
        {t("messages.warn.sharedName")}
      </span>
    ),
  ].filter(Boolean);
  const name = (
    <h2 className="thread__name" id={id}>
      <span className="thread__title" data-testid="thread-name">
        {title}
      </span>
      {tail && (
        <span className="thread__tail" data-testid="thread-tail">
          {tail}
        </span>
      )}
    </h2>
  );
  return (
    <header className={onBack ? "thread__head thread__head--narrow" : "thread__head"}>
      <div className="thread__bar">
        {onBack && (
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              pressedBack();
              onBack();
            }}
            aria-label={t("common.back")}
            title={t("common.back")}
          >
            <BackIcon />
          </button>
        )}
        {/* Narrow, with Back, the list's mark isn't repeated: the name keeps the room beside four buttons. */}
        {!onBack && (
          <span className={known ? "convo__mark" : "convo__mark convo__mark--unknown"} aria-hidden="true">
            {initialOf(title, known)}
          </span>
        )}
        {onBack ? (
          <span className="thread__spacer" />
        ) : (
          <span className="thread__who">
            {name}
            {lines}
          </span>
        )}
        {seedelf && (
          <button
            type="button"
            className="icon-button icon-button--small"
            onClick={() => {
              void navigator.clipboard.writeText(seedelf).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              });
            }}
            aria-label={t(copied ? "common.copied" : "messages.copySeedelf")}
            title={t(copied ? "common.copied" : "messages.copySeedelf")}
            data-testid="thread-copy"
          >
            {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
          </button>
        )}
        {onSave && (
          <button
            type="button"
            className="icon-button icon-button--small"
            onClick={onSave}
            aria-label={t("destination.saveToContacts")}
            title={t("destination.saveToContacts")}
            data-testid="thread-save"
          >
            <UserPlusIcon size={16} />
          </button>
        )}
        {onRename && (
          <button
            type="button"
            className="icon-button icon-button--small"
            onClick={onRename}
            aria-label={t("messages.rename")}
            title={t("messages.rename")}
            data-testid="thread-rename"
          >
            <PencilIcon size={15} />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className="icon-button icon-button--small"
            onClick={onDelete}
            aria-label={t("messages.delete")}
            title={t("messages.delete")}
            data-testid="thread-delete"
          >
            <TrashIcon size={16} />
          </button>
        )}
      </div>
      {onBack && (
        <div className="thread__details">
          {name}
          {lines}
        </div>
      )}
    </header>
  );
}

function ThreadPane({
  cid,
  draft,
  on,
  held,
  contacts,
  onContacts,
  titleOf,
  others,
  onBack,
  onOpen,
  onGone,
}: {
  cid: string;
  draft?: Draft;
  on: boolean;
  /** What holds the network's messages back, the switch on (the overview's): a waiting message says it. */
  held: Held | undefined;
  contacts: Contact[] | undefined;
  onContacts: (contacts: Contact[]) => void;
  titleOf: (cid: string) => string | undefined;
  /** The other conversations' names, each with its Seedelf: what this one's tag is held to. */
  others: ReadonlyArray<{ title: string; seedelf?: string }>;
  onBack?: () => void;
  onOpen: (cid: string) => void;
  onGone: () => void;
}) {
  const t = useT();
  const network = useNetwork();
  // Not open here: the conversation is read, named and deleted, and nothing is written in it (the worker refuses too).
  const closed = !messagingOpen(network);
  const [thread, setThread] = useState<MessagingThread>();
  const [error, setError] = useState<string>();
  const [again, setAgain] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [naming, setNaming] = useState(false);
  const [revealing, setRevealing] = useState(false);
  // The other side's Seedelf, written to or shown and verified, being saved to the contacts (the header's button).
  const [saving, setSaving] = useState<string>();
  // What the box holds, kept here so a box that turns from this conversation's to a new one's, or back, keeps it
  // (screens#6). A reply's text that wasn't sent opens it, with why, once.
  const [text, setText] = useState(draft?.text ?? "");
  const [kept, setKept] = useState(draft?.error);
  // A press on a message of the thread, one at a time: its reveals checked on the chain, or a refused one sent again.
  // A check's notice says "checking" while its request runs, and only then (the freeze's fix B).
  const [pressing, setPressing] = useState<{ kind: "check" } | { kind: "resend"; id: number }>();
  const pressingNow = useRef(false);
  const [pressError, setPressError] = useState<string>();
  const pressWaits = useWaiting(pressing !== undefined);
  // Try again, for a thread whose read was refused: a read, which waits while Messages read or post too (O8).
  const retry = usePress();

  const load = useCallback(
    () =>
      call("messaging-thread", { cid }).then(
        (next) => {
          setThread(next);
          setError(undefined);
        },
        (e: Error) => setError(e.message),
      ),
    [cid],
  );
  useReadWhileSeen(network, load);

  async function press(kind: NonNullable<typeof pressing>, ask: () => Promise<unknown>) {
    if (pressingNow.current) return;
    pressingNow.current = true;
    setPressing(kind);
    setPressError(undefined);
    try {
      await ask();
      void load();
    } catch (e) {
      setPressError((e as Error).message);
    } finally {
      pressingNow.current = false;
      setPressing(undefined);
    }
  }

  const c = thread?.conversation;
  // Answered here after Start again: live again, its box and Show my Seedelf back (screens#2).
  const answeredHere = !!c && answeredAfterRestart(c);
  const dead = !!c?.restartedAs && !answeredHere;
  // The writer's own share of first messages used up before a reply (W17): the next waits for one, or starts again.
  const usedUp = !!c && !c.restartedAs && shareUsedUp(c);
  // Starting again: an unanswered conversation to the same Seedelf (§16.4), one whose share is used up, or one that
  // can't continue with its identities (§6). The next message opens the new conversation. One with no Seedelf to write
  // to again (a continuation this wallet wrote) can't be: the worker would refuse it, so it's only said.
  const restart =
    c && !c.restartedAs ? (c.unreachable ? "continue" : (c.unanswered || usedUp) && c.handle ? "restart" : undefined) : undefined;
  const waiting = c && !c.restartedAs && !c.unreachable && (c.unanswered || usedUp) && !c.handle;
  // Starting again only while it still can: a reply that arrives meanwhile turns the box back to this conversation's,
  // with what's typed in it kept.
  const restarting = again && restart !== undefined;

  async function send(sending: string): Promise<boolean> {
    if (restarting) {
      const { cid: next } = await call(restart === "continue" ? "messaging-continue" : "messaging-restart", { cid, text: sending });
      onOpen(next);
      return true;
    }
    await call("messaging-send", { cid, text: sending });
    load();
    return true;
  }

  const deleteModal = deleting && (
    <DeleteConversation
      cid={cid}
      onClose={() => setDeleting(false)}
      onDeleted={() => {
        setDeleting(false);
        onGone();
      }}
    />
  );

  if (!c) {
    // Not read yet, or refused: a record that won't open says so in the worker's words, and can still be deleted
    // (screens#7).
    return (
      <div className="thread">
        <PaneHead
          title={titleOf(cid) ?? t("messages.title")}
          known={false}
          detail={[]}
          onBack={onBack}
        />
        <div className="thread__scroll">
          {error ? (
            <div className="stack" data-testid="thread-unread">
              <p className="error" role="alert">
                {error}
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void retry.run(load, "load")}
                  disabled={retry.busy}
                  data-testid="thread-read-again"
                >
                  <PressLabel waits={retry.waits("load")}>{t("common.tryAgain")}</PressLabel>
                </button>
                <button type="button" className="danger" onClick={() => setDeleting(true)} data-testid="thread-delete-unread">
                  {t("messages.delete")}
                </button>
              </div>
            </div>
          ) : (
            <p className="note center">{t("messages.loading")}</p>
          )}
        </div>
        {deleteModal}
      </div>
    );
  }

  const title = conversationTitle(c, contacts);
  const seedelf = seedelfOf(c);
  const saved = !!seedelf && !!contacts?.some((x) => x.kind === "seedelf" && x.value === seedelf);
  return (
    <div className="thread" data-testid="thread">
      <PaneHead
        title={title}
        tail={conversationTail(c, contacts)}
        known={!!seedelf || !!c.name}
        detail={conversationDetail(c, contacts, titleOf)}
        shared={!!seedelf && tagShared(seedelf, contacts, others)}
        seedelf={seedelf}
        onBack={onBack}
        onSave={seedelf && contacts && !saved ? () => setSaving(seedelf) : undefined}
        onRename={() => setNaming(true)}
        onDelete={() => setDeleting(true)}
      />
      <MessageList
        messages={thread.messages}
        on={on}
        held={held}
        contacts={contacts}
        busy={pressing !== undefined}
        checking={pressing?.kind === "check"}
        resendWaits={pressing?.kind === "resend" && pressWaits ? pressing.id : undefined}
        onCheck={() => void press({ kind: "check" }, () => call("messaging-check-reveal", { cid }))}
        onResend={(id) => void press({ kind: "resend", id }, () => call("messaging-resend", { cid, id }))}
        before={
          <>
            {thread.trimmed > 0 && <li className="thread__note">{t("messages.warn.trimmed", { count: thread.trimmed })}</li>}
            {thread.missing > 0 && (
              <li className="thread__note" data-testid="thread-missing">
                {t("messages.warn.missing", { count: thread.missing })}
              </li>
            )}
          </>
        }
      />
      {pressError && (
        <p className="error thread__error" role="alert" data-testid="thread-press-error">
          {pressError}
        </p>
      )}
      {dead ? (
        <div className="thread__state" data-testid="thread-restarted">
          <span>{t("messages.restartedAs")}</span>
          <button type="button" className="secondary" onClick={() => onOpen(c.restartedAs!)}>
            {t("messages.openIt")}
          </button>
        </div>
      ) : answeredHere ? (
        <div className="thread__state thread__state--again" data-testid="thread-answered-here">
          <span>{t("messages.answeredHere")}</span>
          <button type="button" className="secondary" onClick={() => onOpen(c.restartedAs!)}>
            {t("messages.openNew")}
          </button>
        </div>
      ) : restart && !again ? (
        <div className="thread__state" data-testid="thread-restart">
          <span>
            {t(restart === "continue" ? "messages.warn.cantContinue" : usedUp && !c.unanswered ? "messages.warn.waitForReply" : "messages.warn.noReply")}
          </span>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setAgain(true);
              setKept(undefined);
            }}
            disabled={closed}
          >
            {t("messages.startAgain")}
          </button>
        </div>
      ) : waiting ? (
        <div className="thread__state" data-testid="thread-no-reply">
          <span>{t(usedUp && !c.unanswered ? "messages.warn.waitForReply" : "messages.warn.noReply")}</span>
        </div>
      ) : null}
      {/* Read again and refused: deleted in another window, say. Said over what was shown, which stays. */}
      {error && (
        <p className="error thread__error" role="alert">
          {error}
        </p>
      )}
      {restarting && (
        <div className="thread__state thread__state--again">
          <span>{t("messages.startingAgain")}</span>
          <button type="button" className="link" onClick={() => setAgain(false)}>
            {t("common.cancel")}
          </button>
        </div>
      )}
      {/* Once answered, where this wallet wrote first: its Seedelf, proved to the other side alone (§19). */}
      {!dead && !restarting && !closed && thread.seedelfs && (
        <div className="thread__actions">
          <button type="button" className="link" onClick={() => setRevealing(true)} data-testid="thread-reveal">
            {t("messages.reveal.button")}
          </button>
        </div>
      )}
      {!dead && (
        <Composer
          key={restarting ? "again" : "send"}
          text={text}
          onText={setText}
          error={restarting ? undefined : kept}
          placeholder={t(restarting ? "messages.firstAgain" : "messages.write")}
          // The new conversation's first message carries more than this one's next: the worker says if it's too long.
          // A share used up has no room to count down: its line above says to wait for a reply.
          maxBytes={restarting || usedUp ? undefined : thread.maxTextBytes}
          off={!on}
          closed={closed}
          disabled={usedUp && !restarting}
          onSend={send}
        />
      )}
      {deleteModal}
      {naming && <NameConversation cid={cid} name={c.name} onClose={() => setNaming(false)} />}
      {revealing && thread.seedelfs && (
        <RevealSeedelf
          cid={cid}
          seedelfs={thread.seedelfs}
          onClose={() => setRevealing(false)}
          onShown={() => {
            setRevealing(false);
            load();
          }}
        />
      )}
      {saving !== undefined && (
        <ContactEditor
          value={saving}
          onClose={() => setSaving(undefined)}
          onSaved={(next) => {
            setSaving(undefined);
            onContacts(next);
          }}
        />
      )}
    </div>
  );
}

/**
 * Shows the other side one of the wallet's Seedelfs (protocol.md §19): they all share its key, so any proves the same
 * owner, and the one picked is the one named. Only they can check it.
 */
function RevealSeedelf({
  cid,
  seedelfs,
  onClose,
  onShown,
}: {
  cid: string;
  seedelfs: string[];
  onClose: () => void;
  onShown: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(seedelfs.length === 1 ? seedelfs[0] : undefined);
  const [busy, setBusy] = useState(false);
  const showing = useRef(false);
  const waiting = useWaiting(busy);
  const [error, setError] = useState<string>();
  async function show() {
    if (!name || showing.current) return;
    showing.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await call("messaging-reveal", { cid, name });
      onShown();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    } finally {
      showing.current = false;
    }
  }
  return (
    <Modal
      title={t("messages.reveal.title")}
      titleId="messages-reveal-title"
      onClose={onClose}
      foot={
        <>
          <button type="button" className="primary" onClick={() => void show()} disabled={busy || !name} data-testid="messages-reveal-show">
            <PressLabel waits={waiting}>{t("messages.reveal.show")}</PressLabel>
          </button>
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
        </>
      }
    >
      <div className="stack">
        <RadioCards
          label={t("messages.reveal.pick")}
          id="messages-reveal-pick"
          value={name}
          onChange={setName}
          testId="messages-reveal-pick"
          // The one place the user chooses WHICH Seedelf to show: each name whole, on as many lines as it takes. Cut to
          // one line, it lost its last sixteen and its index, which tell two tagged alike apart.
          wrap
          options={seedelfs.map((s) => ({ value: s, label: ownShown(s), icon: <ShieldIcon size={16} /> }))}
        />
        <Callout tone="privacy">{t("messages.privacy.reveal")}</Callout>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** The user's own name for a conversation, on this device only; Remove the name puts §7's label back. */
function NameConversation({ cid, name, onClose }: { cid: string; name?: string; onClose: () => void }) {
  const t = useT();
  const [value, setValue] = useState(name ?? "");
  // Save or Remove the name, one at a time, Enter's too: never sent twice.
  const [busy, setBusy] = useState<"save" | "remove">();
  const saving = useRef(false);
  const waiting = useWaiting(busy !== undefined);
  const [error, setError] = useState<string>();
  async function save(next: string) {
    if (saving.current) return;
    saving.current = true;
    setBusy(next ? "save" : "remove");
    setError(undefined);
    try {
      await call("messaging-name", { cid, name: next });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(undefined);
    } finally {
      saving.current = false;
    }
  }
  return (
    <Modal
      title={t("messages.renameTitle")}
      titleId="messages-name-title"
      onClose={onClose}
      foot={
        <>
          <button
            type="button"
            className="primary"
            onClick={() => void save(value)}
            disabled={busy !== undefined || !value.trim()}
            data-testid="messages-name-save"
          >
            <PressLabel waits={waiting && busy === "save"}>{t("messages.save")}</PressLabel>
          </button>
          {name && (
            <button type="button" className="secondary" onClick={() => void save("")} disabled={busy !== undefined}>
              <PressLabel waits={waiting && busy === "remove"}>{t("messages.removeName")}</PressLabel>
            </button>
          )}
        </>
      }
    >
      <div className="field">
        <label htmlFor="messages-name">{t("messages.nameLabel")}</label>
        <input
          id="messages-name"
          value={value}
          maxLength={NAME_CHARS}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && value.trim() && busy === undefined) {
              e.preventDefault();
              void save(value);
            }
          }}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          data-testid="messages-name"
        />
        <p className="note">{t("messages.privacy.rename")}</p>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

/**
 * The messages of a thread or a request, by day, the newest at the foot, kept in view as more arrive. A reveal the
 * other side made is the wallet's own notice, centred and marked as no message can be (screens#1); the user's own is
 * their message, with its state.
 */
function MessageList({
  messages,
  on,
  held,
  before,
  contacts,
  busy = false,
  checking = false,
  resendWaits,
  onCheck,
  onResend,
}: {
  messages: MessagingEntry[];
  on: boolean;
  held?: Held;
  before?: ReactNode;
  contacts?: Contact[];
  /** A press on one of them is under way. */
  busy?: boolean;
  /** The check's request (`messaging-check-reveal`) runs now: its reveals say they're being checked, and only then. */
  checking?: boolean;
  /** The refused message whose Send again runs and is waiting (O8): its button says so. */
  resendWaits?: number;
  /** Checks the conversation's reveals on the chain (`messaging-check-reveal`); none where there's nothing to check. */
  onCheck?: () => void;
  /** Sends a refused message's kept bytes again (`messaging-resend`). */
  onResend?: (id: number) => void;
}) {
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);
  const atFoot = useRef(true);
  const [now, setNow] = useState(Date.now);
  // Each second while a message waits for its next try; otherwise when the messages change.
  const counting = messages.some((m) => m.nextTry !== undefined);
  useEffect(() => {
    setNow(Date.now());
    if (!counting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [messages, counting]);
  // At the foot when it opens, and kept there as messages come, unless the reader scrolled up to read.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atFoot.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  let day = "";
  // Past its first-contact stamp: a message of the user's was sealed already, so one still queued after it waits for a
  // reply (the writer's share of first messages used up), not for the stamp.
  let stamped = false;
  return (
    <div
      className="thread__scroll"
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        atFoot.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      <ol className="bubbles" aria-live="polite" data-testid="thread-messages">
        {before}
        {messages.map((m) => {
          const d = dayOf(m.at, now);
          const sep = d !== day;
          day = d;
          const waitsForReply = m.dir === "out" && m.sent === "queued" && stamped;
          if (m.dir === "out" && m.sent !== undefined && m.sent !== "queued") stamped = true;
          return [
            sep && (
              <li key={`day-${m.id}`} className="thread__day">
                {d}
              </li>
            ),
            m.reveal && m.dir === "in" ? (
              <RevealNotice key={m.id} entry={m} contacts={contacts} on={on} busy={busy} checking={checking} onCheck={onCheck} />
            ) : (
              <li key={m.id} className={`bubble bubble--${m.dir}${m.reveal ? " bubble--reveal" : ""}`} data-testid="bubble">
                {m.reveal?.status === "shown" && m.reveal.name ? (
                  <p className="bubble__text bubble__text--reveal" data-testid="bubble-reveal">
                    <ShieldIcon size={14} />
                    {t("messages.privacy.revealShown", { name: ownShown(m.reveal.name) })}
                  </p>
                ) : (
                  <p className={m.text === undefined ? "bubble__text bubble__text--unreadable" : "bubble__text"}>
                    {m.text ?? t("messages.unreadable")}
                  </p>
                )}
                <span className="bubble__meta">
                  {timeOf(m.at)}
                  {m.dir === "out" && m.sent && (
                    <SentState
                      entry={m}
                      on={on}
                      held={held}
                      now={now}
                      waitsForReply={waitsForReply}
                      busy={busy}
                      resendWaits={resendWaits === m.id}
                      onResend={onResend}
                    />
                  )}
                </span>
              </li>
            ),
          ];
        })}
      </ol>
    </div>
  );
}

/**
 * A reveal the other side made (protocol.md §19), as the wallet's own notice: not checked on the chain yet, with the
 * button that checks it (nothing checks by itself, W2); checking, only while a check's request runs, this page's
 * (`checking`) or another's (the worker's `checking`), never otherwise (the freeze's fix B); verified, naming the
 * Seedelf as Send does (a contact's name only for that contact's, a tag as a tag, each with the part of its name no one
 * else can choose); or failed, never named. Saving and copying it are the header's (the owner, 2026-11-22: no links in
 * the chat).
 */
function RevealNotice({
  entry,
  contacts,
  on,
  busy,
  checking,
  onCheck,
}: {
  entry: MessagingEntry;
  contacts?: Contact[];
  on: boolean;
  busy: boolean;
  checking: boolean;
  onCheck?: () => void;
}) {
  const t = useT();
  const reveal = entry.reveal!;
  const verified = reveal.status === "verified" && reveal.name !== undefined;
  const failed = !verified && reveal.status !== "unchecked" && reveal.status !== "checking";
  // This page's check runs: every reveal of the conversation not checked yet is being checked (checkReveals).
  const status = reveal.status === "unchecked" && checking ? "checking" : reveal.status;
  const words = verified
    ? revealVerifiedText(reveal.name!, contacts)
    : status === "unchecked"
      ? t("messages.privacy.revealUnchecked")
      : status === "checking"
        ? t("messages.privacy.revealChecking")
        : t("messages.warn.revealFailed");
  return (
    <li
      className={`thread__notice${verified ? " thread__notice--verified" : failed ? " thread__notice--failed" : ""}`}
      data-testid="reveal-notice"
    >
      <span className="thread__notice-mark" aria-hidden="true">
        <ShieldIcon size={15} />
      </span>
      <span className="thread__notice-body">
        <span className="thread__notice-text" data-testid="bubble-reveal">
          {words}
        </span>
        {status === "unchecked" && on && onCheck && (
          <button type="button" className="secondary thread__notice-check" onClick={onCheck} disabled={busy} data-testid="reveal-check">
            {t("messages.checkOnChain")}
          </button>
        )}
      </span>
      <span className="thread__notice-time">{timeOf(entry.at)}</span>
    </li>
  );
}

/**
 * A sent message's state: being prepared (its stamp, solved with the switch off too), waiting for a reply (the
 * writer's share of first messages used up), sending, or waiting for the switch; "sent, expires at …" (never
 * "delivered"), and "sent" once that's past; or not sent, by the server (with Send again where its bytes are kept) or
 * by the wallet itself. While its proof of work is solved, about how long that takes; while the relay has asked this
 * message's size, or every post, to wait, in how long it's tried again (the owner, 2026-11-22), in words a time of day
 * can't be read into ("sending in 3 min", as a declined site's wait is said: "2:14" read as a clock's). It isn't read
 * out as it changes (screens#14).
 *
 * What holds the whole network back comes first (`held`), so no message counts down beside the notice that says the
 * server is asked again in an hour (the 1.10.0 gate's blind reading). Paused, nothing is solved or posted: every
 * waiting message says so. With no answer from the server, one being posted waits for it; one still being prepared
 * goes on being prepared. The conversation's row says the same (messaging.ts `rowWaiting`).
 */
function SentState({
  entry,
  on,
  held,
  now,
  waitsForReply,
  busy,
  resendWaits,
  onResend,
}: {
  entry: MessagingEntry;
  on: boolean;
  held?: Held;
  now: number;
  waitsForReply: boolean;
  busy: boolean;
  /** Its Send again runs and is waiting (O8). */
  resendWaits: boolean;
  onResend?: (id: number) => void;
}) {
  const t = useT();
  // Under 2 s of work isn't worth a number.
  const seconds = entry.working && entry.working.seconds >= 2 ? entry.working.seconds : undefined;
  const paused = on && held === "paused";
  const offline = on && held === "offline";
  const countdown =
    entry.sent === "pending" && on && !paused && !offline && seconds === undefined && entry.nextTry !== undefined && entry.nextTry > now;
  const byServer = entry.sent === "refused" && entry.refusedBy !== "wallet";
  const text =
    entry.sent === "posted"
      ? entry.expires !== undefined && entry.expires > now
        ? t("messages.sent.privacy.posted", { when: expiresOf(entry.expires, now) })
        : t("messages.sent.postedNoTime")
      : entry.sent === "refused"
        ? t(byServer ? "messages.sent.warn.refused" : "messages.sent.warn.refusedWallet")
        : paused
          ? t("messages.sent.waitingPaused")
          : entry.sent === "queued"
            ? seconds !== undefined
              ? t("messages.sent.preparing", { seconds })
              : waitsForReply
                ? t("messages.sent.waitsForReply")
                : t("messages.sent.queued")
            : !on
              ? t("messages.sent.waiting")
              : offline
                ? t("messages.sent.waitingServer")
                : seconds !== undefined
                  ? t("messages.sent.working", { seconds })
                  : countdown
                    ? t("messages.sent.nextTry", { time: waitText(entry.nextTry! - now) })
                    : t("messages.sent.pending");
  return (
    <span
      className={entry.sent === "refused" ? "bubble__state bubble__state--refused" : "bubble__state"}
      data-testid="bubble-state"
      {...(countdown ? { "aria-live": "off" as const } : {})}
    >
      {" · "}
      {text}
      {byServer && entry.resend && on && onResend && (
        <>
          {" "}
          <button type="button" className="link bubble__again" onClick={() => onResend(entry.id)} disabled={busy} data-testid="bubble-resend">
            <PressLabel waits={resendWaits}>{t("messages.sendAgain")}</PressLabel>
          </button>
        </>
      )}
    </span>
  );
}

function RequestPane({
  cid,
  request,
  on,
  titleOf,
  onBack,
  onAccepted,
  onGone,
}: {
  cid: string;
  request: MessagingOverview["requests"][number] | undefined;
  on: boolean;
  titleOf: (cid: string) => string | undefined;
  onBack?: () => void;
  /** With the reply's text and why, when it was accepted but its message wasn't sent. */
  onAccepted: (draft?: Draft) => void;
  onGone: () => void;
}) {
  const t = useT();
  const network = useNetwork();
  // Not open here: the request is read and deleted, never accepted or answered (the worker refuses both too).
  const closed = !messagingOpen(network);
  const [messages, setMessages] = useState<MessagingEntry[]>();
  const [error, setError] = useState<string>();
  // Accept, or a reply (which accepts first): one at a time, so the request is never accepted twice; Accept says it's
  // waiting while it waits (O8), and a reply's box says so of its own.
  const [busy, setBusy] = useState<"accept" | "reply">();
  const acting = useRef(false);
  const acceptWaits = useWaiting(busy === "accept");
  const [deleting, setDeleting] = useState(false);
  const [text, setText] = useState("");

  const load = useCallback(() => {
    call("messaging-request", { cid }).then(
      (next) => {
        setMessages(next);
        setError(undefined);
      },
      (e: Error) => setError(e.message),
    );
  }, [cid]);
  useReadWhileSeen(network, load);

  async function accept() {
    if (acting.current) return;
    acting.current = true;
    setBusy("accept");
    setError(undefined);
    try {
      await call("messaging-accept", { cid });
      onAccepted();
    } catch (e) {
      setError((e as Error).message);
      setBusy(undefined);
    } finally {
      acting.current = false;
    }
  }

  // A reply accepts the request first: its conversation, which the reply is sent in. Accepted, the request is gone,
  // so a reply the worker then refuses (too long, say) opens the conversation with its text and why, to send again;
  // or, where the user has moved on, is kept for when they next open it.
  async function reply(sending: string): Promise<boolean> {
    if (acting.current) return false;
    acting.current = true;
    setBusy("reply");
    try {
      await call("messaging-accept", { cid });
      try {
        await call("messaging-send", { cid, text: sending });
      } catch (e) {
        onAccepted({ text: sending, error: (e as Error).message });
        return false;
      }
      onAccepted();
      return true;
    } finally {
      acting.current = false;
      setBusy(undefined);
    }
  }

  const detail = request
    ? conversationDetail({ role: "responder", ...(request.to ? { to: request.to } : {}), ...(request.continues ? { continues: request.continues } : {}) }, undefined, titleOf)
    : [];
  return (
    <div className="thread" data-testid="request">
      <PaneHead title={t("messages.unknownSender")} known={false} detail={detail} onBack={onBack} onDelete={() => setDeleting(true)} />
      {messages ? <MessageList messages={messages} on={on} /> : <div className="thread__scroll">{error ? null : <p className="note center">{t("messages.loading")}</p>}</div>}
      <div className="thread__state thread__state--request">
        <span>{t("messages.privacy.request")}</span>
        <button
          type="button"
          className="secondary"
          onClick={() => void accept()}
          disabled={busy !== undefined || closed}
          data-testid="request-accept"
        >
          <PressLabel waits={acceptWaits}>{t("messages.accept")}</PressLabel>
        </button>
      </div>
      {error && (
        <p className="error thread__error" role="alert">
          {error}
        </p>
      )}
      <Composer
        text={text}
        onText={setText}
        placeholder={t("messages.reply")}
        off={!on}
        closed={closed}
        disabled={busy === "accept"}
        onSend={reply}
      />
      {deleting && (
        <DeleteConversation
          cid={cid}
          request
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false);
            onGone();
          }}
        />
      )}
    </div>
  );
}

function NewMessagePane({
  on,
  onContacts,
  onBack,
  onStarted,
}: {
  on: boolean;
  /** The contacts once one is saved here: the conversation it starts is named by it (screens#9). */
  onContacts: (contacts: Contact[]) => void;
  onBack?: () => void;
  onStarted: (cid: string) => void;
}) {
  const t = useT();
  const closed = !messagingOpen(useNetwork());
  const [to, setTo] = useState("");
  const [found, setFound] = useState<Found>({ state: "idle" });
  const [text, setText] = useState("");
  const ready = found.state === "found" && !found.seedelf.own;

  async function start(sending: string): Promise<boolean> {
    if (found.state !== "found") return false;
    const { cid } = await call("messaging-start", { to: found.seedelf.name, text: sending });
    onStarted(cid);
    return true;
  }

  return (
    <div className="thread" data-testid="new-message">
      <header className="thread__head">
        <div className="thread__bar">
          {onBack && (
            <button
              type="button"
              className="icon-button"
              onClick={() => {
                pressedBack();
                onBack();
              }}
              aria-label={t("common.back")}
              title={t("common.back")}
            >
              <BackIcon />
            </button>
          )}
          <h2 className="thread__name thread__name--alone">{t("messages.new")}</h2>
        </div>
      </header>
      <div className="thread__scroll thread__scroll--form">
        <SeedelfNameInput
          id="message-to"
          value={to}
          onChange={setTo}
          onFound={setFound}
          idleNote={t("messages.pasteName")}
          addressNote={t("messages.notAnAddress")}
          onContacts={onContacts}
        />
        {found.state === "found" && found.seedelf.own && (
          <p className="field-note" role="alert">
            {t("messages.warn.ownSeedelf")}
          </p>
        )}
        <p className="note">{t("messages.firstTakes")}</p>
      </div>
      <Composer
        text={text}
        onText={setText}
        placeholder={t("messages.firstMessage")}
        off={!on}
        closed={closed}
        disabled={!ready}
        onSend={start}
      />
    </div>
  );
}

/**
 * The box at the foot: Enter sends, Shift+Enter starts a line, and Enter while an input method is composing (as
 * Japanese is typed) does neither. It grows with the text, to a few lines. The longest text the next message can carry
 * is in UTF-8 bytes, the worker's (`MessagingThread.maxTextBytes`, the crate's room after padding), never a figure of the
 * screen's: counted down as it nears. What it holds is its pane's (`text`), so a box that turns to another
 * conversation's keeps it; a send that comes back clears only what it sent, never what was typed since (screens#6).
 * One send at a time: a press while one runs is dropped, and one that waits while Messages read or post (O8) says so on
 * its button and under the box, its text still in it. Never spell-checked: what's typed stays on the device until it's
 * sealed (privacy.md).
 */
export function Composer({
  text,
  onText,
  error: opened,
  placeholder,
  maxBytes,
  off,
  closed,
  disabled,
  onSend,
}: {
  text: string;
  onText: Dispatch<SetStateAction<string>>;
  /** Why the text it opens with wasn't sent. */
  error?: string;
  placeholder: string;
  maxBytes?: number;
  off: boolean;
  /**
   * Messages isn't open on this network (networks.ts `MESSAGING_NETWORKS`): nothing is written from here, whatever a
   * development build left to write in, and the box says where Messages is, in the list's own words. The worker
   * refuses it too (1.10.0's second review).
   */
  closed?: boolean;
  disabled?: boolean;
  onSend: (text: string) => Promise<boolean>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const sendingNow = useRef(false);
  const waiting = useWaiting(busy);
  const [error, setError] = useState<string | undefined>(opened);
  const box = useRef<HTMLTextAreaElement>(null);
  const bytes = utf8Length(text);
  const over = maxBytes !== undefined && bytes > maxBytes;
  const near = maxBytes !== undefined && bytes > maxBytes * 0.8;
  const can = !!text.trim() && !over && !busy && !disabled && !closed;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  async function send() {
    if (!can || sendingNow.current) return;
    sendingNow.current = true;
    const sending = text;
    setBusy(true);
    setError(undefined);
    try {
      // Sent: what it sent goes, and what was typed after it stays.
      if (await onSend(sending)) onText((now) => (now === sending ? "" : now.startsWith(sending) ? now.slice(sending.length).trimStart() : now));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      sendingNow.current = false;
      setBusy(false);
      box.current?.focus();
    }
  }

  return (
    <div className="composer-wrap">
      {closed ? (
        <p className="note composer__off" data-testid="composer-closed">
          {openOn(t)}
        </p>
      ) : (
        off && (
          <p className="note composer__off" data-testid="composer-off">
            {t("messages.offWaits")}
          </p>
        )
      )}
      {error && (
        <p className="error" role="alert" data-testid="composer-error">
          {error}
        </p>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={box}
          rows={1}
          value={text}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-invalid={over || undefined}
          spellCheck={false}
          disabled={closed || undefined}
          data-testid="composer"
        />
        <button
          type="submit"
          className="composer__send"
          disabled={!can}
          aria-label={t(waiting ? "messages.pressWaiting" : "messages.send")}
          title={t(waiting ? "messages.pressWaiting" : "messages.send")}
          aria-busy={waiting || undefined}
          data-testid="composer-send"
        >
          {waiting ? (
            <span className="spin">
              <SpinnerIcon size={17} />
            </span>
          ) : (
            <SendIcon size={17} />
          )}
        </button>
      </form>
      {/* Its send waiting (O8): said in words too, where the count goes, which waits with it. */}
      {waiting ? (
        <p className="composer__count" role="status" data-testid="composer-waits">
          {t("messages.pressWaiting")}
        </p>
      ) : near && maxBytes !== undefined && (
        <p className={over ? "composer__count composer__count--over" : "composer__count"} aria-live="polite">
          {over ? t("messages.bytesOver", { count: bytes - maxBytes }) : t("messages.bytesLeft", { count: maxBytes - bytes })}
        </p>
      )}
    </div>
  );
}

function DeleteConversation({
  cid,
  request,
  onClose,
  onDeleted,
}: {
  cid: string;
  request?: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const removing = useRef(false);
  const waiting = useWaiting(busy);
  const [error, setError] = useState<string>();
  async function remove() {
    if (removing.current) return;
    removing.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await call("messaging-delete", { cid });
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    } finally {
      removing.current = false;
    }
  }
  return (
    <Modal
      title={t(request ? "messages.deleteRequest" : "messages.deleteConversation")}
      titleId="messages-delete-title"
      onClose={onClose}
      foot={
        <>
          <button type="button" className="danger" onClick={() => void remove()} disabled={busy} data-testid="messages-delete-confirm">
            <PressLabel waits={waiting}>{t("messages.delete")}</PressLabel>
          </button>
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
        </>
      }
    >
      <p>{t("messages.privacy.delete")}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

/**
 * Starts a network's Messages again, for an inbox that won't open (W9): every conversation and request of it deleted
 * from this browser, asked first. Nothing else of the wallet's changes, and no server is asked.
 */
function ClearMessages({
  network,
  onClose,
  onCleared,
}: {
  network: NetworkName;
  onClose: () => void;
  onCleared: (overview: MessagingOverview) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const clearing = useRef(false);
  const waiting = useWaiting(busy);
  const [error, setError] = useState<string>();
  async function clear() {
    if (clearing.current) return;
    clearing.current = true;
    setBusy(true);
    setError(undefined);
    try {
      onCleared(await call("messaging-clear", {}));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    } finally {
      clearing.current = false;
    }
  }
  return (
    <Modal
      title={t("messages.clearTitle", { network: NETWORKS[network].label })}
      titleId="messages-clear-title"
      onClose={onClose}
      foot={
        <>
          <button type="button" className="danger" onClick={() => void clear()} disabled={busy} data-testid="messages-clear-confirm">
            <PressLabel waits={waiting}>{t("messages.clear")}</PressLabel>
          </button>
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
        </>
      }
    >
      <p>{t("messages.warn.clearNote", { network: NETWORKS[network].label })}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
