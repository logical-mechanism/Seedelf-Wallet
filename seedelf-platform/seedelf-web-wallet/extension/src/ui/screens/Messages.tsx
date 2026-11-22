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
// side showed names the conversation only once it's verified; one that
// isn't is never named, since an unverified "says they're …" would be a tool
// for phishing.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { useT } from "../../i18n";
import { NETWORKS, type NetworkName } from "../../networks";
import {
  CONVERSATION_NAME_CHARS as NAME_CHARS,
  type Contact,
  type MessagingConversation,
  type MessagingEntry,
  type MessagingOverview,
  type MessagingThread,
} from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { ContactEditor, useContacts } from "../components/Contacts";
import { BackIcon, MessageIcon, PencilIcon, PenIcon, SendIcon, ShieldIcon, TrashIcon } from "../components/Icons";
import { Modal } from "../components/Modal";
import { RadioCards } from "../components/RadioCards";
import { pressedBack, useBrowserBack } from "../history";
import {
  conversationDetail,
  conversationTitle,
  dayOf,
  expiresOf,
  gapTimeOf,
  initialOf,
  listTimeOf,
  onMessagingChanged,
  ownShown,
  seedelfOf,
  seedelfShown,
  timeOf,
  utf8Length,
} from "../messaging";
import { useNetwork } from "../network";
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
  setOverview,
  onBack,
}: {
  overview: MessagingOverview | undefined;
  setOverview: (o: MessagingOverview) => void;
  onBack: () => void;
}) {
  const t = useT();
  const wide = useWide();
  const [open, setOpen] = useState<Open>();
  const [contacts, setContacts] = useContacts();
  const on = overview?.on === true;

  // A pane's action that finishes after the user moved on (a reply's accept, a start, a restart) leaves them where they
  // are: it moves on only from the pane that asked.
  const shown = useRef(open);
  shown.current = open;
  const from =
    (asker: Open) =>
    (next: Open | undefined): void => {
      const now = shown.current;
      if (now?.kind === asker.kind && (now.kind === "new" || (asker.kind !== "new" && now.cid === asker.cid))) setOpen(next);
    };

  // Back, the browser's too: from a conversation to the list where only one shows, else Home.
  const back = !wide && open ? () => setOpen(undefined) : onBack;
  useBrowserBack(back);

  const titleOf = useCallback(
    (cid: string) => {
      const c = overview?.conversations.find((x) => x.cid === cid);
      return c ? conversationTitle(c, contacts) : undefined;
    },
    [overview, contacts],
  );

  const list = (
    <ListPane
      overview={overview}
      contacts={contacts}
      open={open}
      onOpen={setOpen}
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
        onAccepted={(draft) => from(open)({ kind: "thread", cid: open.cid, ...(draft ? { draft } : {}) })}
        onGone={() => from(open)(undefined)}
      />
    ) : (
      <NewMessagePane
        on={on}
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

function ListPane({
  overview,
  contacts,
  open,
  onOpen,
  onBack,
  onSwitched,
  titleOf,
}: {
  overview: MessagingOverview | undefined;
  contacts: Contact[] | undefined;
  open: Open | undefined;
  onOpen: (open: Open) => void;
  onBack: () => void;
  onSwitched: (o: MessagingOverview) => void;
  titleOf: (cid: string) => string | undefined;
}) {
  const t = useT();
  const network = useNetwork();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string>();
  const now = Date.now();
  const on = overview?.on === true;

  async function flip() {
    if (!overview) return;
    setSwitching(true);
    setError(undefined);
    try {
      onSwitched(await call("messaging-switch", { on: !overview.on }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSwitching(false);
    }
  }

  const lostCount = overview?.lost.length ?? 0;
  const gap = overview?.gapAt !== undefined && now - overview.gapAt < GAP_SHOWN_MS ? overview.gapAt : undefined;
  const empty = overview && !overview.conversations.length && !overview.requests.length;

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
        <div className="setting-row messages__switch">
          <span className="stack-tight">
            <span id="messages-switch-label">{t("messages.switch", { network: NETWORKS[network].label })}</span>
            <span className="note" id="messages-switch-note">
              {t("messages.privacy.relay")}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={on}
            aria-labelledby="messages-switch-label"
            aria-describedby="messages-switch-note"
            onClick={() => void flip()}
            disabled={!overview || switching}
            data-testid="messages-switch"
          />
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {on && overview?.offline && (
          <Callout tone="warn" testId="messages-offline">
            {t("messages.warn.offline")}
          </Callout>
        )}
        {on && gap !== undefined && (
          <Callout tone="warn" testId="messages-gap">
            {t("messages.warn.gap", { when: gapTimeOf(gap) })}
          </Callout>
        )}

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
                          ).join(" · ")}
                        </span>
                        {r.unread > 0 && <span className="convo__unread">{r.unread}</span>}
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
        {lostCount > 0 && (
          <p className="note" data-testid="messages-lost">
            {t("messages.lost", { count: lostCount })}
          </p>
        )}
        <p className="note messages__unlock">{t("messages.unlockLine")}</p>
      </div>
    </>
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
  // one else can choose, so two Seedelfs tagged alike don't read as one.
  const tail =
    !c.name && seedelf && !contacts?.some((x) => x.kind === "seedelf" && x.value === seedelf) ? `…${seedelf.slice(-16)}` : undefined;
  const state = c.restartedAs
    ? t("messages.state.restarted")
    : c.unreachable
      ? t("messages.state.cantContinue")
      : c.unanswered
        ? t("messages.state.noReply")
        : undefined;
  const preview =
    c.last === undefined
      ? ""
      : c.last.reveal
        ? t(c.last.dir === "out" ? "messages.preview.revealOut" : "messages.preview.revealIn")
        : c.last.text === undefined
          ? t("messages.unreadable")
          : c.last.dir === "out"
            ? t("messages.you", { text: c.last.text })
            : c.last.text;
  return (
    <button type="button" className="convo" aria-current={current ? "true" : undefined} onClick={onOpen} data-testid="messages-conversation">
      <span className={known ? "convo__mark" : "convo__mark convo__mark--unknown"} aria-hidden="true">
        {initialOf(title, known)}
      </span>
      <span className="convo__text">
        <span className="convo__top">
          <span className="convo__name">
            {title}
            {tail && <span className="convo__tail">{tail}</span>}
          </span>
          <span className="convo__time">{listTimeOf(c.lastAt, now)}</span>
        </span>
        <span className="convo__bottom">
          <span className={state ? "convo__preview convo__preview--state" : "convo__preview"}>
            {c.outbox > 0 ? t(on ? "messages.sending" : "messages.waiting") : (state ?? preview)}
          </span>
          {c.unread > 0 && <span className="convo__unread">{c.unread}</span>}
        </span>
      </span>
    </button>
  );
}

/** A conversation's header: Back where the list isn't beside it, its mark and name, its §7 label, and Delete. */
function PaneHead({
  title,
  known,
  detail,
  onBack,
  onRename,
  onDelete,
}: {
  title: string;
  known: boolean;
  detail: string[];
  onBack?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  const t = useT();
  const id = useId();
  return (
    <header className="thread__head">
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
      <span className={known ? "convo__mark" : "convo__mark convo__mark--unknown"} aria-hidden="true">
        {initialOf(title, known)}
      </span>
      <span className="thread__who">
        <h2 className="thread__name" id={id} data-testid="thread-name">
          {title}
        </h2>
        {detail.map((line) => (
          <span key={line} className="thread__detail" data-testid="thread-detail">
            {line}
          </span>
        ))}
      </span>
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
        <button type="button" className="icon-button icon-button--small" onClick={onDelete} aria-label={t("messages.delete")} title={t("messages.delete")}>
          <TrashIcon size={16} />
        </button>
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
  // A Seedelf the other side showed, verified, being saved to the contacts.
  const [saving, setSaving] = useState<string>();
  // A reply's text that wasn't sent, offered once: Start again, then Cancel, doesn't bring it back.
  const [kept, setKept] = useState(draft);

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

  const c = thread?.conversation;
  // Starting again: an unanswered conversation to the same Seedelf (§16.4), or one that can't continue with its
  // identities (§6). The next message opens the new conversation. One unanswered with no Seedelf to write to again (a
  // continuation this wallet wrote) can't be: the worker would refuse it, so it's only said.
  const restart = c && !c.restartedAs && (c.unreachable ? "continue" : c.unanswered && c.handle ? "restart" : undefined);
  const unanswered = c && !c.restartedAs && !c.unreachable && c.unanswered && !c.handle;
  // Starting again only while it still can: a reply that arrives meanwhile turns the box back to this conversation's.
  const restarting = again && restart !== undefined;

  async function send(text: string): Promise<boolean> {
    if (restarting) {
      const { cid: next } = await call(restart === "continue" ? "messaging-continue" : "messaging-restart", { cid, text });
      onOpen(next);
      return true;
    }
    await call("messaging-send", { cid, text });
    load();
    return true;
  }

  if (!c) {
    return (
      <div className="thread">
        <PaneHead title={titleOf(cid) ?? t("messages.title")} known={false} detail={[]} onBack={onBack} />
        <div className="thread__scroll">{error ? <p className="error" role="alert">{error}</p> : <p className="note center">{t("messages.loading")}</p>}</div>
      </div>
    );
  }

  const title = conversationTitle(c, contacts);
  return (
    <div className="thread" data-testid="thread">
      <PaneHead
        title={title}
        known={!!seedelfOf(c) || !!c.name}
        detail={conversationDetail(c, contacts, titleOf)}
        onBack={onBack}
        onRename={() => setNaming(true)}
        onDelete={() => setDeleting(true)}
      />
      <MessageList
        messages={thread.messages}
        on={on}
        contacts={contacts}
        onSave={setSaving}
        before={
          <>
            {thread.trimmed > 0 && <li className="thread__note">{t("messages.trimmed", { count: thread.trimmed })}</li>}
            {thread.missing > 0 && (
              <li className="thread__note" data-testid="thread-missing">
                {t("messages.missing", { count: thread.missing })}
              </li>
            )}
          </>
        }
      />
      {c.restartedAs ? (
        <div className="thread__state" data-testid="thread-restarted">
          <span>{t("messages.restartedAs")}</span>
          <button type="button" className="secondary" onClick={() => onOpen(c.restartedAs!)}>
            {t("messages.openIt")}
          </button>
        </div>
      ) : restart && !again ? (
        <div className="thread__state" data-testid="thread-restart">
          <span>{t(restart === "continue" ? "messages.warn.cantContinue" : "messages.warn.noReply")}</span>
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
      ) : unanswered ? (
        <div className="thread__state" data-testid="thread-no-reply">
          <span>{t("messages.warn.noReply")}</span>
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
      {!c.restartedAs && !restarting && thread.seedelfs && (
        <div className="thread__actions">
          <button type="button" className="link" onClick={() => setRevealing(true)} data-testid="thread-reveal">
            {t("messages.reveal.button")}
          </button>
        </div>
      )}
      {!c.restartedAs && (
        <Composer
          key={restarting ? "again" : "send"}
          draft={restarting ? undefined : kept}
          placeholder={t(restarting ? "messages.firstAgain" : "messages.write")}
          // The new conversation's first message carries more than this one's next: the worker says if it's too long.
          maxBytes={restarting ? undefined : thread.maxTextBytes}
          off={!on}
          onSend={send}
        />
      )}
      {deleting && (
        <DeleteConversation
          cid={cid}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false);
            onGone();
          }}
        />
      )}
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
        <p className="note">{t("messages.renameNote")}</p>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

/** The messages of a thread or a request, by day, the newest at the foot, kept in view as more arrive. */
function MessageList({
  messages,
  on,
  before,
  contacts,
  onSave,
}: {
  messages: MessagingEntry[];
  on: boolean;
  before?: ReactNode;
  contacts?: Contact[];
  /** Saves a verified Seedelf the other side showed to the contacts. */
  onSave?: (name: string) => void;
}) {
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);
  const atFoot = useRef(true);
  const now = Date.now();
  // At the foot when it opens, and kept there as messages come, unless the reader scrolled up to read.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atFoot.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  let day = "";
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
          return [
            sep && (
              <li key={`day-${m.id}`} className="thread__day">
                {d}
              </li>
            ),
            <li key={m.id} className={`bubble bubble--${m.dir}${m.reveal ? " bubble--reveal" : ""}`} data-testid="bubble">
              {m.reveal ? (
                <RevealText reveal={m.reveal} contacts={contacts} onSave={onSave} />
              ) : (
                <p className={m.text === undefined ? "bubble__text bubble__text--unreadable" : "bubble__text"}>
                  {m.text ?? t("messages.unreadable")}
                </p>
              )}
              <span className="bubble__meta">
                {timeOf(m.at)}
                {m.dir === "out" && m.sent && <SentState entry={m} on={on} now={now} />}
              </span>
            </li>,
          ];
        })}
      </ol>
    </div>
  );
}

/**
 * A reveal's message (protocol.md §19): the user's own Seedelf shown; or the other side's, checking, verified with its
 * name (a contact's, else its tag and the part of its name no one else can choose) and Save to contacts, or failed,
 * never named.
 */
function RevealText({
  reveal,
  contacts,
  onSave,
}: {
  reveal: NonNullable<MessagingEntry["reveal"]>;
  contacts?: Contact[];
  onSave?: (name: string) => void;
}) {
  const t = useT();
  if (reveal.status === "shown" && reveal.name) {
    return (
      <p className="bubble__text" data-testid="bubble-reveal">
        {t("messages.reveal.shown", { name: ownShown(reveal.name) })}
      </p>
    );
  }
  if (reveal.status === "verified" && reveal.name) {
    const shown = seedelfShown(reveal.name, contacts);
    const saved = contacts?.some((c) => c.kind === "seedelf" && c.value === reveal.name);
    return (
      <>
        <p className="bubble__text" data-testid="bubble-reveal">
          {t("messages.reveal.verified", { name: `${shown.title} (${shown.short})` })}
        </p>
        {!saved && onSave && (
          <button type="button" className="link bubble__action" onClick={() => onSave(reveal.name!)} data-testid="bubble-reveal-save">
            {t("destination.saveToContacts")}
          </button>
        )}
      </>
    );
  }
  if (reveal.status === "checking") {
    return (
      <p className="bubble__text bubble__text--unreadable" data-testid="bubble-reveal">
        {t("messages.reveal.checking")}
      </p>
    );
  }
  return (
    <p className="bubble__text bubble__text--unreadable" data-testid="bubble-reveal">
      {t("messages.warn.revealFailed")}
    </p>
  );
}

/**
 * A sent message's state: being prepared (its stamp, solved with the switch off too), sending, or waiting for the
 * switch; "sent, expires at …" (never "delivered"); or refused.
 */
function SentState({ entry, on, now }: { entry: MessagingEntry; on: boolean; now: number }) {
  const t = useT();
  const text =
    entry.sent === "posted"
      ? entry.expires !== undefined
        ? t("messages.sent.posted", { when: expiresOf(entry.expires, now) })
        : t("messages.sent.postedNoTime")
      : entry.sent === "refused"
        ? t("messages.sent.refused")
        : entry.sent === "queued"
          ? t("messages.sent.queued")
          : t(on ? "messages.sent.pending" : "messages.sent.waiting");
  return (
    <span className={entry.sent === "refused" ? "bubble__state bubble__state--refused" : "bubble__state"} data-testid="bubble-state">
      {" · "}
      {text}
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
  // so a reply the worker then refuses (too long, say) opens the conversation with its text and why, to send again.
  async function reply(text: string): Promise<boolean> {
    await call("messaging-accept", { cid });
    try {
      await call("messaging-send", { cid, text });
    } catch (e) {
      onAccepted({ text, error: (e as Error).message });
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
      <Composer placeholder={t("messages.reply")} off={!on} onSend={reply} />
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

function NewMessagePane({ on, onBack, onStarted }: { on: boolean; onBack?: () => void; onStarted: (cid: string) => void }) {
  const t = useT();
  const [to, setTo] = useState("");
  const [found, setFound] = useState<Found>({ state: "idle" });
  const ready = found.state === "found" && !found.seedelf.own;

  async function start(text: string): Promise<boolean> {
    if (found.state !== "found") return false;
    const { cid } = await call("messaging-start", { to: found.seedelf.name, text });
    onStarted(cid);
    return true;
  }

  return (
    <div className="thread" data-testid="new-message">
      <header className="thread__head">
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
      </header>
      <div className="thread__scroll thread__scroll--form">
        <SeedelfNameInput
          id="message-to"
          value={to}
          onChange={setTo}
          onFound={setFound}
          idleNote={t("messages.pasteName")}
          addressNote={t("messages.notAnAddress")}
        />
        {found.state === "found" && found.seedelf.own && (
          <p className="field-note" role="alert">
            {t("messages.ownSeedelf")}
          </p>
        )}
        <p className="note">{t("messages.firstTakes")}</p>
      </div>
      <Composer placeholder={t("messages.firstMessage")} off={!on} disabled={!ready} onSend={start} />
    </div>
  );
}

/**
 * The box at the foot: Enter sends, Shift+Enter starts a line, and Enter while an input method is composing (as
 * Japanese is typed) does neither. It grows with the text, to a few lines. The longest text the next message can carry
 * is in UTF-8 bytes: counted down as it nears.
 */
function Composer({
  draft,
  placeholder,
  maxBytes,
  off,
  disabled,
  onSend,
}: {
  /** What it opens with: a text that wasn't sent, and why. */
  draft?: Draft;
  placeholder: string;
  maxBytes?: number;
  off: boolean;
  disabled?: boolean;
  onSend: (text: string) => Promise<boolean>;
}) {
  const t = useT();
  const [text, setText] = useState(draft?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(draft?.error);
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
    setBusy(true);
    setError(undefined);
    try {
      if (await onSend(text)) setText("");
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
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-invalid={over || undefined}
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
      <p>{t("messages.deleteNote")}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
