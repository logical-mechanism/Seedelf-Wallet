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
// A tag is said as a tag, with its last sixteen, and a contact's name only for
// that contact's Seedelf, as Send says them (screens#3).

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

import { joinSentences, Rich, useT } from "../../i18n";
import { NETWORKS, type NetworkName } from "../../networks";
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
import { BackIcon, CheckIcon, CopyIcon, MessageIcon, PencilIcon, PenIcon, SendIcon, ShieldIcon, TrashIcon, UserPlusIcon } from "../components/Icons";
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
  initialOf,
  listTimeOf,
  momentOf,
  onMessagingChanged,
  ownShown,
  revealVerifiedText,
  seedelfOf,
  shareUsedUp,
  tagShared,
  timeOf,
  utf8Length,
} from "../messaging";
import { useNetwork } from "../network";
import { usePreferences } from "../preferences";
import { SeedelfNameInput, type Found } from "./Transfer";

/** Wide enough for the list and a conversation side by side. */
const WIDE = "(min-width: 760px)";

/** A relay's gap is said for as long as a message sent then could still have been on it, and a margin. */
const GAP_SHOWN_MS = 48 * 3600_000;

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

/** A press of the list's that asks the worker: busy while it runs, its refusal said in the worker's words. */
function usePress() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = async (ask: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await ask();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
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
  reload?: () => void;
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
  const now = Date.now();
  // The switch as the overview says it, or as the settings do where the overview can't be read: it's still the
  // user's to turn (cross-feature#8).
  const on = overview ? overview.on : loaded && prefs.messaging[network];

  const flip = () =>
    press.run(async () => {
      try {
        onSwitched(await call("messaging-switch", { on: !on }));
      } catch (e) {
        // Turned, maybe, and the overview after it refused: read again, whatever it says.
        reload?.();
        throw e;
      }
    });

  const gap = overview?.gapAt !== undefined && now - overview.gapAt < GAP_SHOWN_MS ? overview.gapAt : undefined;
  // The relay's hold on this connection's reading for the day (W16): said while it holds, by this device's clock.
  const dayRead = overview?.dayReadUntil !== undefined && overview.dayReadUntil > now ? overview.dayReadUntil : undefined;
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
          disabled={!overview}
          data-testid="messages-new"
        >
          <PenIcon size={17} />
        </button>
      </header>

      <div className="messages__scroll">
        {/* Just the switch (the owner, 2026-11-22): what it tells the server is the privacy policy's. */}
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
            data-testid="messages-switch"
          />
        </div>
        {press.error && (
          <p className="error" role="alert">
            {press.error}
          </p>
        )}

        {/* The overview the worker couldn't read: its words, Try again, and, for an inbox that won't open, starting this
            network's Messages again behind a question (screens#7, cross-feature#8). */}
        {!overview && readError && (
          <div className="messages__problem" data-testid="messages-read-error">
            <p className="error" role="alert">
              {readError}
            </p>
            <div className="messages__problem-actions">
              <button type="button" className="secondary" onClick={() => reload?.()}>
                {t("common.tryAgain")}
              </button>
              <button type="button" className="link link--quiet" onClick={() => setClearing(true)} data-testid="messages-clear">
                {t("messages.clear")}
              </button>
            </div>
          </div>
        )}

        {/* The relay's off switch (W15) stands in for "can't reach": it's on purpose, and an update is coming. */}
        {on && overview?.paused && (
          <Callout tone="warn" testId="messages-paused">
            {t("messages.warn.paused")}
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
                  reload?.();
                })
              }
              disabled={press.busy}
              data-testid="messages-retry"
            >
              {t("common.tryAgain")}
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
            and deleting a conversation doesn't bring them back, so never the no-room words above. */}
        {overview?.droppedUnread !== undefined && overview.droppedUnread > 0 && (
          <Callout tone="warn" testId="messages-dropped-unread">
            {t("messages.warn.droppedUnread", { count: overview.droppedUnread })}
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
              onClick={() => void press.run(async () => onSwitched(await call("messaging-switch", { on: false, network: other })))}
              disabled={press.busy}
            >
              {t("messages.turnOff")}
            </button>
          </StateLine>
        ))}

        {on && seedelfs.length > 0 && <SeedelfSwitches seedelfs={seedelfs} onSwitched={onSwitched} />}

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
                    now={now}
                    current={open?.kind === "thread" && open.cid === c.cid}
                    onOpen={() => onOpen({ kind: "thread", cid: c.cid })}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        {empty && (
          <p className="messages__none" data-testid="messages-none">
            {on ? t("messages.none") : t("messages.noneOff")}
          </p>
        )}
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
 * The Seedelfs under the wallet's key and whether each takes first messages (W8): on for one this browser made, at the
 * register it put it under; off for any other until the user turns it on, since one someone else made under the key can
 * tie the user's Seedelfs to each other once it's answered at. Turning one on or off asks no server.
 */
function SeedelfSwitches({ seedelfs, onSwitched }: { seedelfs: MessagingSeedelf[]; onSwitched: (o: MessagingOverview) => void }) {
  const t = useT();
  const id = useId();
  const press = usePress();
  const flip = (s: MessagingSeedelf) =>
    press.run(async () => onSwitched(await call("messaging-answer-at", { name: s.name, register: s.register, on: !s.on })));
  return (
    <div className="messages__seedelfs" data-testid="messages-seedelfs">
      {seedelfs.map((s, i) => (
        <div className="setting-row" key={`${s.name}:${s.register.generator}:${s.register.publicValue}`} data-testid="messages-seedelf">
          <span className="stack-tight">
            <span id={`${id}-${i}`} className="messages__seedelf-name">
              {ownShown(s.name)}
            </span>
            <span className="note" id={`${id}-${i}-what`}>
              {t("messages.answerAt")}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={s.on}
            aria-labelledby={`${id}-${i}-what ${id}-${i}`}
            onClick={() => void flip(s)}
            disabled={press.busy}
            data-testid="messages-seedelf-switch"
          />
        </div>
      ))}
      {seedelfs.some((s) => !s.made) && <p className="note">{t("messages.privacy.answerAtMade")}</p>}
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
  now,
  current,
  onOpen,
}: {
  conversation: MessagingConversation;
  contacts: Contact[] | undefined;
  /** The switch: off, what's written waits, never "Sending…". */
  on: boolean;
  now: number;
  current: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  const title = conversationTitle(c, contacts);
  const seedelf = seedelfOf(c);
  const known = !!seedelf || !!c.name;
  // A Seedelf no contact names goes by its tag, which anyone can mint: its name's last sixteen beside it, the part no
  // one else can choose, so two Seedelfs tagged alike don't read as one. Its own, never the first thing cut (screens#4).
  const tail = conversationTail(c, contacts);
  // Started again and answered here since: live, so its last message says, never "Started again" (screens#2).
  const restarted = c.restartedAs !== undefined && !answeredAfterRestart(c);
  const state = c.unreadable
    ? t("messages.state.warn.unreadable")
    : restarted
      ? t("messages.state.restarted")
      : c.unreachable
        ? t("messages.state.warn.cantContinue")
        : c.unanswered
          ? t("messages.state.warn.noReply")
          : undefined;
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
            {c.outbox > 0 ? t(on ? "messages.sending" : "messages.waiting") : (state ?? preview)}
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
 * that's a tag has its last sixteen beside it, as the list's row does (screens#3). Narrow, with Back, the name and the
 * label's lines go under the row of buttons, across the pane: beside four buttons they broke anywhere in a 112 px
 * column, and the sixteen had no room (screens#14).
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
  /** The last sixteen of a Seedelf the name is the tag of (`conversationTail`). */
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
  // A press on a message of the thread: a reveal checked on the chain, a refused one sent again.
  const [pressing, setPressing] = useState(false);
  const [pressError, setPressError] = useState<string>();

  const load = useCallback(() => {
    call("messaging-thread", { cid }).then(
      (next) => {
        setThread(next);
        setError(undefined);
      },
      (e: Error) => setError(e.message),
    );
  }, [cid]);
  useReadWhileSeen(network, load);

  async function press(ask: () => Promise<unknown>) {
    setPressing(true);
    setPressError(undefined);
    try {
      await ask();
      load();
    } catch (e) {
      setPressError((e as Error).message);
    } finally {
      setPressing(false);
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
                <button type="button" className="secondary" onClick={load}>
                  {t("common.tryAgain")}
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
        contacts={contacts}
        busy={pressing}
        onCheck={() => void press(() => call("messaging-check-reveal", { cid }))}
        onResend={(id) => void press(() => call("messaging-resend", { cid, id }))}
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
      {!dead && !restarting && thread.seedelfs && (
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
  const [error, setError] = useState<string>();
  async function show() {
    if (!name) return;
    setBusy(true);
    setError(undefined);
    try {
      await call("messaging-reveal", { cid, name });
      onShown();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
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
            {t("messages.reveal.show")}
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function save(next: string) {
    setBusy(true);
    setError(undefined);
    try {
      await call("messaging-name", { cid, name: next });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
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
            disabled={busy || !value.trim()}
            data-testid="messages-name-save"
          >
            {t("messages.save")}
          </button>
          {name && (
            <button type="button" className="secondary" onClick={() => void save("")} disabled={busy}>
              {t("messages.removeName")}
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
            if (e.key === "Enter" && !e.nativeEvent.isComposing && value.trim()) {
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
  before,
  contacts,
  busy = false,
  onCheck,
  onResend,
}: {
  messages: MessagingEntry[];
  on: boolean;
  before?: ReactNode;
  contacts?: Contact[];
  /** A press on one of them is under way. */
  busy?: boolean;
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
              <RevealNotice key={m.id} entry={m} contacts={contacts} on={on} busy={busy} onCheck={onCheck} />
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
                    <SentState entry={m} on={on} now={now} waitsForReply={waitsForReply} busy={busy} onResend={onResend} />
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
 * button that checks it (nothing checks by itself, W2); checking; verified, naming the Seedelf as Send does (a contact's
 * name only for that contact's, a tag as a tag, each with the part of its name no one else can choose); or failed,
 * never named. Saving and copying it are the header's (the owner, 2026-11-22: no links in the chat).
 */
function RevealNotice({
  entry,
  contacts,
  on,
  busy,
  onCheck,
}: {
  entry: MessagingEntry;
  contacts?: Contact[];
  on: boolean;
  busy: boolean;
  onCheck?: () => void;
}) {
  const t = useT();
  const reveal = entry.reveal!;
  const verified = reveal.status === "verified" && reveal.name !== undefined;
  const failed = !verified && reveal.status !== "unchecked" && reveal.status !== "checking";
  const words = verified
    ? revealVerifiedText(reveal.name!, contacts)
    : reveal.status === "unchecked"
      ? t("messages.privacy.revealUnchecked")
      : reveal.status === "checking"
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
        {reveal.status === "unchecked" && on && onCheck && (
          <button type="button" className="secondary thread__notice-check" onClick={onCheck} disabled={busy} data-testid="reveal-check">
            {t("messages.checkOnChain")}
          </button>
        )}
      </span>
      <span className="thread__notice-time">{timeOf(entry.at)}</span>
    </li>
  );
}

/** A wait as a clock: 2:14, or 1:02:14 past an hour. */
function clockOf(ms: number): string {
  const all = Math.max(0, Math.ceil(ms / 1000));
  const [h, m, sec] = [Math.floor(all / 3600), Math.floor(all / 60) % 60, all % 60];
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/**
 * A sent message's state: being prepared (its stamp, solved with the switch off too), waiting for a reply (the
 * writer's share of first messages used up), sending, or waiting for the switch; "sent, expires at …" (never
 * "delivered"), and "sent" once that's past; or not sent, by the server (with Send again where its bytes are kept) or
 * by the wallet itself. While its proof of work is solved, about how long that takes; while the relay has asked this
 * message's size, or every post, to wait, how long until it's tried again (the owner, 2026-11-22). The countdown isn't
 * read out each second (screens#14).
 */
function SentState({
  entry,
  on,
  now,
  waitsForReply,
  busy,
  onResend,
}: {
  entry: MessagingEntry;
  on: boolean;
  now: number;
  waitsForReply: boolean;
  busy: boolean;
  onResend?: (id: number) => void;
}) {
  const t = useT();
  // Under 2 s of work isn't worth a number.
  const seconds = entry.working && entry.working.seconds >= 2 ? entry.working.seconds : undefined;
  const countdown = entry.sent === "pending" && on && seconds === undefined && entry.nextTry !== undefined && entry.nextTry > now;
  const byServer = entry.sent === "refused" && entry.refusedBy !== "wallet";
  const text =
    entry.sent === "posted"
      ? entry.expires !== undefined && entry.expires > now
        ? t("messages.sent.privacy.posted", { when: expiresOf(entry.expires, now) })
        : t("messages.sent.postedNoTime")
      : entry.sent === "refused"
        ? t(byServer ? "messages.sent.warn.refused" : "messages.sent.warn.refusedWallet")
        : entry.sent === "queued"
          ? seconds !== undefined
            ? t("messages.sent.preparing", { seconds })
            : waitsForReply
              ? t("messages.sent.waitsForReply")
              : t("messages.sent.queued")
          : !on
            ? t("messages.sent.waiting")
            : seconds !== undefined
              ? t("messages.sent.working", { seconds })
              : countdown
                ? t("messages.sent.nextTry", { time: clockOf(entry.nextTry! - now) })
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
            {t("messages.sendAgain")}
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
  const [messages, setMessages] = useState<MessagingEntry[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    setError(undefined);
    try {
      await call("messaging-accept", { cid });
      onAccepted();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  // A reply accepts the request first: its conversation, which the reply is sent in. Accepted, the request is gone,
  // so a reply the worker then refuses (too long, say) opens the conversation with its text and why, to send again;
  // or, where the user has moved on, is kept for when they next open it.
  async function reply(sending: string): Promise<boolean> {
    await call("messaging-accept", { cid });
    try {
      await call("messaging-send", { cid, text: sending });
    } catch (e) {
      onAccepted({ text: sending, error: (e as Error).message });
      return false;
    }
    onAccepted();
    return true;
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
        <button type="button" className="secondary" onClick={() => void accept()} disabled={busy} data-testid="request-accept">
          {t("messages.accept")}
        </button>
      </div>
      {error && (
        <p className="error thread__error" role="alert">
          {error}
        </p>
      )}
      <Composer text={text} onText={setText} placeholder={t("messages.reply")} off={!on} onSend={reply} />
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
      <Composer text={text} onText={setText} placeholder={t("messages.firstMessage")} off={!on} disabled={!ready} onSend={start} />
    </div>
  );
}

/**
 * The box at the foot: Enter sends, Shift+Enter starts a line, and Enter while an input method is composing (as
 * Japanese is typed) does neither. It grows with the text, to a few lines. The longest text the next message can carry
 * is in UTF-8 bytes: counted down as it nears. What it holds is its pane's (`text`), so a box that turns to another
 * conversation's keeps it; a send that comes back clears only what it sent, never what was typed since (screens#6).
 * Never spell-checked: what's typed stays on the device until it's sealed (privacy.md).
 */
export function Composer({
  text,
  onText,
  error: opened,
  placeholder,
  maxBytes,
  off,
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
  disabled?: boolean;
  onSend: (text: string) => Promise<boolean>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(opened);
  const box = useRef<HTMLTextAreaElement>(null);
  const bytes = utf8Length(text);
  const over = maxBytes !== undefined && bytes > maxBytes;
  const near = maxBytes !== undefined && bytes > maxBytes * 0.8;
  const can = !!text.trim() && !over && !busy && !disabled;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  async function send() {
    if (!can) return;
    const sending = text;
    setBusy(true);
    setError(undefined);
    try {
      // Sent: what it sent goes, and what was typed after it stays.
      if (await onSend(sending)) onText((now) => (now === sending ? "" : now.startsWith(sending) ? now.slice(sending.length).trimStart() : now));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      box.current?.focus();
    }
  }

  return (
    <div className="composer-wrap">
      {off && (
        <p className="note composer__off" data-testid="composer-off">
          {t("messages.offWaits")}
        </p>
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
          data-testid="composer"
        />
        <button type="submit" className="composer__send" disabled={!can} aria-label={t("messages.send")} title={t("messages.send")}>
          <SendIcon size={17} />
        </button>
      </form>
      {near && maxBytes !== undefined && (
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
  const [error, setError] = useState<string>();
  async function remove() {
    setBusy(true);
    setError(undefined);
    try {
      await call("messaging-delete", { cid });
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
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
            {t("messages.delete")}
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
  const [error, setError] = useState<string>();
  async function clear() {
    setBusy(true);
    setError(undefined);
    try {
      onCleared(await call("messaging-clear", {}));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
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
            {t("messages.clear")}
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
