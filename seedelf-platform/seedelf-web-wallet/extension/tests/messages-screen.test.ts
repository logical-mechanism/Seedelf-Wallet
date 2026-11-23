// The Messages screen itself (screens/Messages.tsx) on the tree's fake DOM, the worker answered by the test: what it
// draws for each state the 1.10.0 gate's worker rounds added, and what each press asks (the gate's S1 to S6 and its
// Package B). Before it, nothing in tests/ rendered Messages (screens#12): the round-one review's scratch tests are
// the start of this one.
import { readFileSync } from "node:fs";

import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { Contact, MessagingConversation, MessagingEntry, MessagingOverview, MessagingThread } from "../src/shared/rpc";
import { answer as answered, type Asked, click, elements, FakeElement, FakeEvent, fakeDocument, fakeDom, type FakeNode, type Root } from "./fake-dom";

const worker = vi.hoisted(() => ({ waiting: [] as Asked[] }));
vi.mock("../src/ui/background", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  call: (type: string, payload: unknown) => new Promise((resolve, reject) => worker.waiting.push({ type, payload, resolve, reject })),
}));

// What the fake DOM lacks and the screen asks of a browser.
const media = { wide: false };
const listeners = new Set<(m: unknown) => void>();
vi.stubGlobal("HTMLInputElement", class {});
// Settings reads which view it is (view.ts) as it loads.
vi.stubGlobal("location", { search: "", hash: "" });
vi.stubGlobal("matchMedia", () => ({ matches: media.wide, addEventListener() {}, removeEventListener() {} }));
vi.stubGlobal("chrome", {
  runtime: {
    onMessage: { addListener: (l: (m: unknown) => void) => listeners.add(l), removeListener: (l: (m: unknown) => void) => listeners.delete(l) },
  },
  storage: { local: { onChanged: { addListener() {}, removeListener() {} } } },
});
(fakeDocument as unknown as { visibilityState: string }).visibilityState = "visible";
// React asks whether the browser has the input event before it listens for one: say so, before react-dom loads.
(fakeDocument as unknown as { oninput: null }).oninput = null;
(FakeElement.prototype as unknown as { showModal(): void; close(): void }).showModal = () => {};
(FakeElement.prototype as unknown as { showModal(): void; close(): void }).close = () => {};

const { Messages } = await import("../src/ui/screens/Messages");
const { NetworkContext } = await import("../src/ui/network");
const { ContactEditor } = await import("../src/ui/components/Contacts");
const { RemoveWallet, ServerStatusLine, KoiosOnly } = await import("../src/ui/screens/Settings");
const { Reset } = await import("../src/ui/screens/Unlock");
const { MessagesRow } = await import("../src/ui/screens/Home");
const { PreferencesContext } = await import("../src/ui/preferences");
const { DEFAULT_PREFERENCES } = await import("../src/shared/preferences");
const { DappApprovals } = await import("../src/ui/screens/DappApprovals");

let createRoot: (container: unknown) => Root;
beforeAll(async () => {
  createRoot = await fakeDom();
});
afterEach(() => {
  worker.waiting.length = 0;
  listeners.clear();
  media.wide = false;
});

const answer = (type: string, value: unknown, error?: Error) => answered(worker.waiting, type, value, error);
const asked = (type: string) => worker.waiting.filter((w) => w.type === type);
const byTest = (root: FakeNode, id: string) => elements(root).filter((e) => e.getAttribute("data-testid") === id);
const one = (root: FakeNode, id: string) => {
  const found = byTest(root, id);
  if (found.length !== 1) throw new Error(`${found.length} elements with data-testid="${id}"`);
  return found[0]!;
};
const labelled = (root: FakeNode, label: string) => elements(root).filter((e) => e.getAttribute("aria-label") === label);
const button = (root: FakeNode, text: string) => {
  const found = elements(root).filter((e) => e.localName === "button" && e.textContent === text);
  if (found.length !== 1) throw new Error(`${found.length} buttons "${text}"`);
  return found[0]!;
};
const classes = (e: FakeElement) => (e.getAttribute("class") ?? "").split(/\s+/);

/** The worker's broadcast that the network's messages changed. */
async function changed() {
  await act(async () => {
    for (const l of [...listeners]) l({ event: "messaging-changed", network: "preprod" });
    await new Promise((done) => setTimeout(done, 0));
  });
}

/** Types `text` into a box: its value, then the input event React's onChange hears. */
function type(box: FakeElement, text: string) {
  act(() => {
    if (box.localName === "input") (box as unknown as { type: string }).type ??= "text";
    (box as unknown as { value: string }).value = text;
    box.dispatchEvent(new FakeEvent("input"));
  });
}
// A box React has just drawn holds its text as its defaultValue, which a browser shows (the fake DOM keeps it as set).
const valueOf = (box: FakeElement) => (box as unknown as { value?: string; defaultValue?: string }).value ?? (box as unknown as { defaultValue?: string }).defaultValue;

class Key extends FakeEvent {
  constructor(
    readonly key: string,
    readonly shiftKey = false,
    readonly isComposing = false,
  ) {
    super("keydown");
  }
}
function press(box: FakeElement, key: Key) {
  act(() => {
    box.dispatchEvent(key);
  });
  return key;
}

const nameOf = (tag: string, tail: string) => {
  const head = "5eed0e1f" + Buffer.from(tag).toString("hex") + "00";
  return head + "c".repeat(64 - head.length - tail.length) + tail;
};
const MINE = nameOf("web-wallet", "1111222233334444");
const ALICE = nameOf("alice", "0123456789abcdef");
const LOOKALIKE = nameOf("Alice B", "aaaabbbbccccdddd");
const CONTACT: Contact = { id: "1", name: "Alice B", kind: "seedelf", value: ALICE, network: "preprod" };
const now = Date.now();
const REGISTER = { generator: "a".repeat(96), publicValue: "b".repeat(96) };

const conversation = (over: Partial<MessagingConversation> & Pick<MessagingConversation, "cid" | "role">): MessagingConversation => ({
  startedAt: now - 3600_000,
  lastAt: now - 60_000,
  unread: 0,
  outbox: 0,
  unanswered: false,
  ...over,
});
const overviewOf = (conversations: MessagingConversation[], more: Partial<MessagingOverview> = {}): MessagingOverview => ({
  on: true,
  conversations,
  requests: [],
  ...more,
});
const threadOf = (c: MessagingConversation, messages: MessagingEntry[], more: Partial<MessagingThread> = {}): MessagingThread => ({
  conversation: c,
  messages,
  trimmed: 0,
  missing: 0,
  maxTextBytes: 1500,
  ...more,
});

interface Mounted {
  container: FakeElement;
  root: Root;
  setOverview: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  rerender: (overview: MessagingOverview | undefined, error?: string) => void;
}

async function mount(overview: MessagingOverview | undefined, { contacts = [] as Contact[], error }: { contacts?: Contact[]; error?: string } = {}): Promise<Mounted> {
  const container = fakeDocument.body.appendChild(fakeDocument.createElement("div"));
  const root = createRoot(container);
  const setOverview = vi.fn();
  const reload = vi.fn();
  const rerender = (next: MessagingOverview | undefined, err?: string) =>
    act(() =>
      root.render(
        createElement(
          NetworkContext.Provider,
          { value: "preprod" },
          createElement(Messages, { overview: next, error: err, reload, setOverview, onBack: () => {} }),
        ),
      ),
    );
  rerender(overview, error);
  await answer("contacts", contacts);
  return { container, root, setOverview, reload, rerender };
}

async function openThread(c: MessagingConversation, messages: MessagingEntry[] = [], more: Partial<MessagingThread> = {}, options: { overview?: Partial<MessagingOverview>; contacts?: Contact[] } = {}) {
  const mounted = await mount(overviewOf([c], options.overview), options.contacts ? { contacts: options.contacts } : {});
  click(byTest(mounted.container, "messages-conversation")[0]!);
  await answer("messaging-thread", threadOf(c, messages, more));
  return mounted;
}

const verified: MessagingEntry = { id: 1, dir: "in", at: now - 60_000, reveal: { status: "verified", name: ALICE } };
const WORDS = "Showed you their Seedelf tagged “alice” (5eed0e1f…0123456789abcdef), verified on the chain";

describe("the wallet's own notice of a reveal (S1, screens#1)", () => {
  it("is drawn as a notice, never as a bubble, and a text that says its words is a bubble and nothing else", async () => {
    const real = conversation({ cid: "c1", role: "responder", to: MINE, revealed: { name: ALICE, at: now } });
    const { container, root } = await openThread(real, [{ id: 0, dir: "in", at: now - 70_000, text: WORDS }, verified]);
    const notice = one(container, "reveal-notice");
    expect(notice.localName).toBe("li");
    expect(classes(notice)).toContain("thread__notice");
    expect(classes(notice)).not.toContain("bubble");
    expect(one(container, "bubble-reveal").textContent).toBe(WORDS);
    // Marked with the shield, which no bubble has.
    expect(elements(notice).some((e) => e.localName === "svg")).toBe(true);
    // The other side's text of the same words: a bubble of theirs, with none of the notice's markup.
    const [text] = byTest(container, "bubble");
    expect(byTest(container, "bubble")).toHaveLength(1);
    expect(text!.textContent).toContain(WORDS);
    expect(classes(text!)).toEqual(["bubble", "bubble--in"]);
    expect(elements(text!).some((e) => /thread__notice|bubble-reveal|reveal-notice/.test(`${e.getAttribute("class")} ${e.getAttribute("data-testid")}`))).toBe(false);
    expect(elements(text!).some((e) => e.localName === "svg")).toBe(false);
    act(() => root.unmount());
  });

  it("says the list's reveal line and 'You:' in styles of their own, never as the other side's words (screens#13)", async () => {
    const rows = [
      conversation({ cid: "r", role: "responder", to: MINE, revealed: { name: ALICE, at: now }, last: { dir: "in", reveal: true } }),
      conversation({ cid: "o", role: "initiator", handle: ALICE, last: { dir: "out", text: "I agreed to pay" } }),
      conversation({ cid: "i", role: "initiator", handle: LOOKALIKE, last: { dir: "in", text: "You: I agreed to pay" } }),
    ];
    const { container, root } = await mount(overviewOf(rows));
    const [reveal, mine, theirs] = byTest(container, "messages-conversation");
    expect(elements(reveal!).find((e) => classes(e).includes("convo__notice"))?.textContent).toBe("Showed you a Seedelf");
    const own = elements(mine!).find((e) => classes(e).includes("convo__preview"))!;
    expect(classes(own)).toContain("convo__preview--you");
    expect(elements(own).find((e) => classes(e).includes("convo__said"))?.textContent).toBe("I agreed to pay");
    const other = elements(theirs!).find((e) => classes(e).includes("convo__preview"))!;
    expect(other.textContent).toBe("You: I agreed to pay");
    expect(classes(other)).not.toContain("convo__preview--you");
    expect(elements(other).some((e) => classes(e).includes("convo__said") || classes(e).includes("convo__notice"))).toBe(false);
    act(() => root.unmount());
  });
});

describe("what a message draws (screens#11)", () => {
  it("stays inside its bubble: a stack of combining marks can't paint over the bubbles and notices above", () => {
    const css = readFileSync(new URL("../src/ui/styles.css", import.meta.url), "utf8");
    const rule = css.match(/\n\.bubble \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/overflow:\s*hidden|contain:\s*paint/);
  });
});

describe("a reveal not checked on the chain yet (S4, W2)", () => {
  const c = conversation({ cid: "c1", role: "responder", to: MINE });
  const unchecked: MessagingEntry = { id: 0, dir: "in", at: now - 1000, reveal: { status: "unchecked" } };

  it("says so, and checks only at the user's press, with one request", async () => {
    const { container, root } = await openThread(c, [unchecked]);
    expect(one(container, "bubble-reveal").textContent).toBe("Showed you a Seedelf, not checked on the chain yet");
    expect(asked("messaging-check-reveal")).toHaveLength(0);
    click(one(container, "reveal-check"));
    expect(asked("messaging-check-reveal").map((w) => w.payload)).toEqual([{ cid: "c1" }]);
    await answer("messaging-check-reveal", null);
    // Read again: verified, named, and no button left.
    await answer("messaging-thread", threadOf({ ...c, revealed: { name: ALICE, at: now } }, [{ ...unchecked, reveal: { status: "verified", name: ALICE } }]));
    expect(one(container, "bubble-reveal").textContent).toBe(WORDS);
    expect(byTest(container, "reveal-check")).toHaveLength(0);
    act(() => root.unmount());
  });

  it("says why a check was refused, and stays unchecked", async () => {
    const { container, root } = await openThread(c, [unchecked]);
    click(one(container, "reveal-check"));
    await answer("messaging-check-reveal", undefined, new Error("Koios didn't answer."));
    expect(one(container, "thread-press-error").textContent).toBe("Koios didn't answer.");
    expect(byTest(container, "reveal-check")).toHaveLength(1);
    act(() => root.unmount());
  });

  it("offers no check while Messages are off, and none while one runs", async () => {
    const off = await openThread(c, [unchecked], {}, { overview: { on: false } });
    expect(byTest(off.container, "reveal-check")).toHaveLength(0);
    act(() => off.root.unmount());
    const running = await openThread(c, [{ ...unchecked, reveal: { status: "checking" } }]);
    expect(one(running.container, "bubble-reveal").textContent).toBe("Showed you a Seedelf, checking it on the chain");
    expect(byTest(running.container, "reveal-check")).toHaveLength(0);
    act(() => running.root.unmount());
  });

  it("never names one that failed", async () => {
    const { container, root } = await openThread(c, [{ ...unchecked, reveal: { status: "failed" } }]);
    expect(one(container, "bubble-reveal").textContent).toBe("Showed you a Seedelf that couldn't be verified, so it isn't named.");
    expect(classes(one(container, "reveal-notice"))).toContain("thread__notice--failed");
    act(() => root.unmount());
  });
});

describe("a sent message's state (S4)", () => {
  const c = conversation({ cid: "c1", role: "responder", to: MINE });
  const states = async (messages: MessagingEntry[], overview: Partial<MessagingOverview> = {}) => {
    const mounted = await openThread(c, messages, {}, { overview });
    return { ...mounted, texts: byTest(mounted.container, "bubble-state").map((e) => e.textContent) };
  };

  it("offers Send again for what the server refused, its bytes kept, and only that", async () => {
    const { container, root, texts } = await states([
      { id: 0, dir: "out", at: now, text: "a", sent: "refused", refusedBy: "server", resend: true },
      { id: 1, dir: "out", at: now, text: "b", sent: "refused", refusedBy: "wallet" },
    ]);
    expect(texts).toEqual([" · not sent: the server refused it Send again", " · not sent: Seedelf Wallet couldn't encrypt it"]);
    expect(byTest(container, "bubble-resend")).toHaveLength(1);
    click(one(container, "bubble-resend"));
    expect(asked("messaging-resend").map((w) => w.payload)).toEqual([{ cid: "c1", id: 0 }]);
    act(() => root.unmount());
  });

  it("offers no Send again while Messages are off", async () => {
    const { container, root } = await states([{ id: 0, dir: "out", at: now, text: "a", sent: "refused", refusedBy: "server", resend: true }], { on: false });
    expect(byTest(container, "bubble-resend")).toHaveLength(0);
    act(() => root.unmount());
  });

  it("says 'sent' alone once its time on the server has passed, never that it still expires (i18n#5)", async () => {
    const { root, texts } = await states([
      { id: 0, dir: "out", at: now - 40 * 3600_000, text: "old", sent: "posted", expires: now - 4 * 3600_000 },
      { id: 1, dir: "out", at: now, text: "new", sent: "posted", expires: now + 36 * 3600_000 },
    ]);
    expect(texts[0]).toBe(" · sent");
    expect(texts[1]).toMatch(/^ · sent, expires /);
    act(() => root.unmount());
  });

  it("says a text still queued after one already sealed waits for a reply, not for its stamp", async () => {
    const { root, texts } = await states([
      { id: 0, dir: "out", at: now, text: "first", sent: "queued" },
      { id: 1, dir: "out", at: now, text: "second", sent: "posted", expires: now + 3600_000 },
      { id: 2, dir: "out", at: now, text: "third", sent: "queued" },
    ]);
    expect(texts).toEqual([" · preparing", expect.stringMatching(/^ · sent, expires/), " · waiting for a reply"]);
    act(() => root.unmount());
  });

  it("counts down to its own next try, and never reads that out each second (screens#14)", async () => {
    const { container, root } = await states([
      { id: 0, dir: "out", at: now, text: "big", sent: "pending", nextTry: now + 125_000 },
      { id: 1, dir: "out", at: now, text: "small", sent: "pending" },
    ]);
    const [big, small] = byTest(container, "bubble-state");
    expect(big!.textContent).toMatch(/^ · sending in 2:0\d$/);
    expect(big!.getAttribute("aria-live")).toBe("off");
    expect(small!.textContent).toBe(" · sending");
    expect(small!.getAttribute("aria-live")).toBeNull();
    act(() => root.unmount());
  });
});

describe("a writer's share of first messages used up (S4, W17)", () => {
  const used = { messages: 0, bytes: 0 };
  const sent: MessagingEntry = { id: 0, dir: "out", at: now, text: "hello", sent: "posted", expires: now + 3600_000 };

  it("says to wait for a reply, offers Start again at once, and counts no bytes", async () => {
    const c = conversation({ cid: "c1", role: "initiator", handle: ALICE, firstContactLeft: used });
    const { container, root } = await openThread(c, [sent], { maxTextBytes: 0 });
    const state = one(container, "thread-restart");
    expect(state.textContent).toContain("Wait for a reply: until one comes, their wallet takes no more messages from you here.");
    const box = one(container, "composer");
    type(box, "more");
    // No "N bytes too long" for a share with nothing left, and no send: the line says why.
    expect(container.textContent).not.toMatch(/too long/);
    press(box, new Key("Enter"));
    expect(asked("messaging-send")).toHaveLength(0);
    // Start again: what was typed is the new conversation's first message.
    click(button(state, "Start again"));
    const again = one(container, "composer");
    expect(again.getAttribute("placeholder")).toBe("First message of the new conversation");
    expect(valueOf(again)).toBe("more");
    press(again, new Key("Enter"));
    expect(asked("messaging-restart").map((w) => w.payload)).toEqual([{ cid: "c1", text: "more" }]);
    act(() => root.unmount());
  });

  it("only says it for a continuation this wallet wrote, which has no Seedelf to start again with", async () => {
    const c = conversation({ cid: "c1", role: "initiator", to: MINE, continues: { cid: "x", verified: true }, firstContactLeft: used });
    const { container, root } = await openThread(c, [sent], { maxTextBytes: 0 });
    expect(one(container, "thread-no-reply").textContent).toContain("Wait for a reply");
    expect(elements(container).some((e) => e.localName === "button" && e.textContent === "Start again")).toBe(false);
    act(() => root.unmount());
  });
});

describe("a conversation started again, then answered in (S3, screens#2)", () => {
  const sent: MessagingEntry = { id: 0, dir: "out", at: now - 60 * 3600_000, text: "hello Alice", sent: "posted", expires: now - 24 * 3600_000 };

  it("is live again: its row says the reply, and its box and Show my Seedelf are back", async () => {
    const old = conversation({ cid: "old", role: "initiator", handle: ALICE, restartedAs: "new", unread: 1, last: { dir: "in", text: "sorry, only saw this now" } });
    const next = conversation({ cid: "new", role: "initiator", handle: ALICE, unanswered: false, last: { dir: "out", text: "hello again?" } });
    const { container, root } = await mount(overviewOf([old, next]));
    const [row] = byTest(container, "messages-conversation");
    expect(row!.textContent).toContain("sorry, only saw this now");
    expect(row!.textContent).not.toContain("Started again");
    click(row!);
    await answer("messaging-thread", threadOf(old, [sent, { id: 1, dir: "in", at: now, text: "sorry, only saw this now" }], { seedelfs: [MINE] }));
    expect(one(container, "thread-answered-here").textContent).toContain("They answered here after you started again.");
    expect(byTest(container, "composer")).toHaveLength(1);
    expect(byTest(container, "thread-reveal")).toHaveLength(1);
    // The new one is still a press away.
    click(button(one(container, "thread-answered-here"), "Open the new one"));
    expect(asked("messaging-thread").map((w) => w.payload)).toEqual([{ cid: "new" }]);
    act(() => root.unmount());
  });

  it("but with no reply yet, says it was started again and has no box", async () => {
    const old = conversation({ cid: "old", role: "initiator", handle: ALICE, restartedAs: "new", unanswered: true });
    const { container, root } = await openThread(old, [sent]);
    expect(one(container, "thread-restarted").textContent).toContain("Started again as a new conversation.");
    expect(byTest(container, "composer")).toHaveLength(0);
    act(() => root.unmount());
  });
});

describe("a tag that reads as a contact's name (S2, screens#3)", () => {
  it("is said as a tag, with its last sixteen and a line saying another Seedelf has the name; the contact says it's one", async () => {
    const stranger = conversation({ cid: "s", role: "responder", to: MINE, revealed: { name: LOOKALIKE, at: now } });
    const real = conversation({ cid: "a", role: "initiator", handle: ALICE });
    const { container, root } = await mount(overviewOf([stranger, real]), { contacts: [CONTACT] });
    // The list: the tag's last sixteen beside it, its own element, never cut (screens#4); the contact's has none.
    const [sRow, aRow] = byTest(container, "messages-conversation");
    expect(elements(sRow!).find((e) => classes(e).includes("convo__tail"))?.textContent).toBe("…aaaabbbbccccdddd");
    expect(elements(sRow!).find((e) => classes(e).includes("convo__name"))?.textContent).toBe("Alice B");
    expect(elements(aRow!).some((e) => classes(e).includes("convo__tail"))).toBe(false);
    // The stranger's header: no "your contact", and the shared name said.
    click(sRow!);
    await answer("messaging-thread", threadOf(stranger, [verified]));
    expect(byTest(container, "thread-detail").map((e) => e.textContent)).toEqual([
      "Verified Seedelf 5eed0e1f…aaaabbbbccccdddd",
      "Wrote to your Seedelf web-wallet (5eed0e1f…1111222233334444)",
    ]);
    expect(one(container, "thread-shared-name").textContent).toBe("Another Seedelf has this name too, in your contacts or another conversation.");
    // The header's name is the tag, its last sixteen beside it, as the list's row has them.
    expect(one(container, "thread-name").textContent).toBe("Alice B");
    expect(one(container, "thread-tail").textContent).toBe("…aaaabbbbccccdddd");
    // Narrow, the name and the lines sit under the row of buttons, across the pane (screens#14).
    const details = elements(container).find((e) => classes(e).includes("thread__details"))!;
    expect(details.textContent).toContain("Verified Seedelf");
    expect(elements(details).some((e) => e.getAttribute("data-testid") === "thread-tail")).toBe(true);
    click(labelled(container, "Back")[0]!);
    // The contact's: says it's one, and nothing shared.
    click(byTest(container, "messages-conversation")[1]!);
    await answer("messaging-thread", threadOf(real, []));
    expect(byTest(container, "thread-detail").map((e) => e.textContent)).toEqual(["Your contact · 5eed0e1f…0123456789abcdef"]);
    expect(byTest(container, "thread-shared-name")).toHaveLength(0);
    expect(byTest(container, "thread-tail")).toHaveLength(0);
    act(() => root.unmount());
  });
});

describe("the list's states (S4)", () => {
  it("says each the overview carries, and the line that the phrase doesn't bring conversations back", async () => {
    const { container, root } = await mount(
      overviewOf([], { paused: true, full: true, dropped: 3, clockOff: 2.5, alsoOn: ["mainnet"] }),
    );
    expect(one(container, "messages-paused").textContent).toBe("Messages are paused. An update of Seedelf Wallet is on its way.");
    expect(one(container, "messages-full").textContent).toBe("Messages are full. Delete a conversation to get new ones.");
    expect(one(container, "messages-dropped").textContent).toBe("3 messages couldn't be kept. Deleting a conversation makes room.");
    expect(one(container, "messages-clock").textContent).toBe(
      "This device's clock is about 2.5 h ahead of the server's: people may not get your first messages. Check its date and time.",
    );
    expect(one(container, "messages-also-on").textContent).toContain("Messages are also on for Mainnet.");
    expect(one(container, "messages-notes").textContent).toBe(
      "Messages arrive while Seedelf Wallet is unlocked. The server keeps them 36 hours. Conversations aren't restored with the recovery phrase.",
    );
    // The other network's: turned off from here, by that network's switch alone.
    click(button(one(container, "messages-also-on"), "Turn off"));
    expect(asked("messaging-switch").map((w) => w.payload)).toEqual([{ on: false, network: "mainnet" }]);
    act(() => root.unmount());
  });

  it("says a clock behind the other way", async () => {
    const { container, root } = await mount(overviewOf([], { clockOff: -0.6 }));
    expect(one(container, "messages-clock").textContent).toBe(
      "This device's clock is about 0.6 h behind the server's: you may not get first messages written to you. Check its date and time.",
    );
    act(() => root.unmount());
  });

  // The 1.10.0 gate's f5: what the backlog dropped unopened may be anyone's, and deleting a conversation doesn't bring
  // it back, so it's said apart from what had no room, in words of its own.
  it("says messages dropped before they could be read in a line of their own, never that deleting makes room (f5)", async () => {
    const both = await mount(overviewOf([], { dropped: 2, droppedUnread: 5 }));
    expect(one(both.container, "messages-dropped").textContent).toBe("2 messages couldn't be kept. Deleting a conversation makes room.");
    expect(one(both.container, "messages-dropped-unread").textContent).toBe("5 messages were dropped before they could be read.");
    expect(classes(one(both.container, "messages-dropped-unread"))).toContain("callout--warn");
    act(() => both.root.unmount());
    const alone = await mount(overviewOf([], { droppedUnread: 1 }));
    expect(one(alone.container, "messages-dropped-unread").textContent).toBe("1 message was dropped before it could be read.");
    expect(byTest(alone.container, "messages-dropped")).toHaveLength(0);
    expect(alone.container.textContent).not.toContain("makes room");
    act(() => alone.root.unmount());
    const none = await mount(overviewOf([], { dropped: 1 }));
    expect(byTest(none.container, "messages-dropped-unread")).toHaveLength(0);
    act(() => none.root.unmount());
  });

  it("keeps the no-room words out of the dropped-unread line in every language (f5)", () => {
    for (const code of ["en", "es", "ja"]) {
      const words: Record<string, string> = JSON.parse(readFileSync(new URL(`../src/i18n/translations/${code}.json`, import.meta.url), "utf8"));
      const forms = (base: string) => Object.keys(words).filter((k) => k.startsWith(`${base}_`));
      // The no-room line's second sentence: deleting a conversation makes room.
      const makesRoom = words[forms("messages.warn.dropped")[0]!]!.split(/(?<=[.。])\s*/).filter(Boolean).at(-1)!;
      expect(makesRoom.length, code).toBeGreaterThan(4);
      expect(forms("messages.warn.droppedUnread").length, code).toBeGreaterThan(0);
      for (const k of forms("messages.warn.droppedUnread")) expect(words[k], `${code} ${k}`).not.toContain(makesRoom);
    }
  });

  // W16: the relay said this connection read its share of the pool for the day. The day's hold is said in one line,
  // with the time it ends in the language's own words, and never as a server that can't be reached.
  it("says until when the day's reading is held, in one line, while it holds and Messages are on (W16)", async () => {
    const { dateLocale } = await import("../src/i18n");
    const until = Date.now() + 3 * 3600_000;
    const when = new Date(until).toLocaleString(dateLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const held = await mount(overviewOf([], { dayReadUntil: until }));
    expect(one(held.container, "messages-day-read").textContent).toBe(
      `This connection has read its share for the day: new messages wait until ${when}. You can still send.`,
    );
    expect(classes(one(held.container, "messages-day-read"))).toContain("callout--warn");
    expect(byTest(held.container, "messages-offline")).toHaveLength(0);
    act(() => held.root.unmount());
    // Past its time, or with Messages off: nothing said.
    for (const more of [{ dayReadUntil: Date.now() - 1000 }, { on: false, dayReadUntil: until }]) {
      const quiet = await mount(overviewOf([], more));
      expect(byTest(quiet.container, "messages-day-read"), JSON.stringify(more)).toHaveLength(0);
      act(() => quiet.root.unmount());
    }
  });

  it("offers Try again where a step stopped, which asks the worker to step over it", async () => {
    const { container, root, reload } = await mount(overviewOf([], { stopped: true }));
    expect(one(container, "messages-stopped").textContent).toContain("Messages stopped on an error and read nothing more until you try again.");
    click(one(container, "messages-retry"));
    expect(asked("messaging-retry")).toHaveLength(1);
    await answer("messaging-retry", null);
    expect(reload).toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("lists the Seedelfs under the key with a switch each: on for one this browser made, the rest off, and says why", async () => {
    const { container, root, setOverview } = await mount(
      overviewOf([], {
        seedelfs: [
          { name: MINE, register: REGISTER, made: true, on: true },
          { name: LOOKALIKE, register: REGISTER, made: false, on: false },
        ],
      }),
    );
    const switches = byTest(container, "messages-seedelf-switch");
    expect(switches.map((s) => s.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(one(container, "messages-seedelfs").textContent).toContain("Take messages at this Seedelf");
    expect(one(container, "messages-seedelfs").textContent).toContain(
      "Turn on only a Seedelf you made: one someone else made can tie your Seedelfs to each other.",
    );
    click(switches[1]!);
    expect(asked("messaging-answer-at").map((w) => w.payload)).toEqual([{ name: LOOKALIKE, register: REGISTER, on: true }]);
    const next = overviewOf([]);
    await answer("messaging-answer-at", next);
    expect(setOverview).toHaveBeenCalledWith(next);
    act(() => root.unmount());
  });

  it("shows no Seedelfs' switches while Messages are off, and says nothing of them when all were made here", async () => {
    const off = await mount(overviewOf([], { on: false, seedelfs: [{ name: MINE, register: REGISTER, made: true, on: true }] }));
    expect(byTest(off.container, "messages-seedelfs")).toHaveLength(0);
    act(() => off.root.unmount());
    const made = await mount(overviewOf([], { seedelfs: [{ name: MINE, register: REGISTER, made: true, on: true }] }));
    expect(one(made.container, "messages-seedelfs").textContent).not.toContain("Turn on only");
    act(() => made.root.unmount());
  });
});

describe("what can't be read (S4, screens#7, cross-feature#8)", () => {
  it("says an overview the worker refused in its words, with Try again, and starting Messages again behind a question", async () => {
    const words = "Seedelf Wallet couldn't open its record of your messages on this device, so it won't write over it.";
    const { container, root, reload, setOverview } = await mount(undefined, { error: words });
    expect(one(container, "messages-read-error").textContent).toContain(words);
    click(button(one(container, "messages-read-error"), "Try again"));
    expect(reload).toHaveBeenCalled();
    click(one(container, "messages-clear"));
    expect(container.textContent).toContain("Start Messages again on Preprod?");
    expect(container.textContent).toContain("Every conversation and request on Preprod is deleted from this browser, and doesn't come back.");
    expect(asked("messaging-clear")).toHaveLength(0);
    click(one(container, "messages-clear-confirm"));
    const fresh = overviewOf([]);
    await answer("messaging-clear", fresh);
    expect(setOverview).toHaveBeenCalledWith(fresh);
    act(() => root.unmount());
  });

  it("says a conversation whose record won't open, in its row and its pane, and deletes it from there", async () => {
    const c = conversation({ cid: "c1", role: "initiator", handle: ALICE, unread: 2, unreadable: true });
    const { container, root } = await mount(overviewOf([c]));
    const [row] = byTest(container, "messages-conversation");
    expect(row!.textContent).toContain("Can't be opened");
    click(row!);
    await answer("messaging-thread", undefined, new Error("Seedelf Wallet couldn't open its record of a conversation on this device, so it won't write over it."));
    expect(one(container, "thread-unread").textContent).toContain("couldn't open its record of a conversation");
    click(one(container, "thread-delete-unread"));
    click(one(container, "messages-delete-confirm"));
    expect(asked("messaging-delete").map((w) => w.payload)).toEqual([{ cid: "c1" }]);
    act(() => root.unmount());
  });
});

describe("what's typed (screens#6)", () => {
  const c = conversation({ cid: "c1", role: "responder", to: MINE });

  it("keeps what was typed while a send was on its way, and clears only what it sent", async () => {
    const { container, root } = await openThread(c);
    const box = one(container, "composer");
    type(box, "first");
    press(box, new Key("Enter"));
    expect(asked("messaging-send").map((w) => w.payload)).toEqual([{ cid: "c1", text: "first" }]);
    type(box, "first second, typed meanwhile");
    await answer("messaging-send", null);
    expect(valueOf(one(container, "composer"))).toBe("second, typed meanwhile");
    act(() => root.unmount());
  });

  it("keeps what was typed for a new conversation when a reply turns the box back to this one's", async () => {
    const old = conversation({ cid: "c1", role: "initiator", handle: ALICE, unanswered: true });
    const sent: MessagingEntry = { id: 0, dir: "out", at: now - 60 * 3600_000, text: "hello", sent: "posted", expires: now - 20 * 3600_000 };
    const { container, root } = await openThread(old, [sent]);
    click(button(one(container, "thread-restart"), "Start again"));
    type(one(container, "composer"), "are you still there?");
    await changed();
    await answer("messaging-thread", threadOf({ ...old, unanswered: false }, [sent, { id: 1, dir: "in", at: now, text: "hi!" }]));
    const box = one(container, "composer");
    expect(box.getAttribute("placeholder")).toBe("Message");
    expect(valueOf(box)).toBe("are you still there?");
    act(() => root.unmount());
  });

  it("keeps a request's reply that was refused after the user moved on, for when its conversation is opened", async () => {
    const request = { cid: "r1", startedAt: now, to: MINE, messages: 1, lastAt: now, unread: 1 };
    const { container, root, rerender } = await mount(overviewOf([], { requests: [request] }));
    click(elements(one(container, "messages-requests")).find((e) => e.localName === "button")!);
    await answer("messaging-request", [{ id: 0, dir: "in", at: now, text: "hello" }]);
    type(one(container, "composer"), "a long reply");
    press(one(container, "composer"), new Key("Enter"));
    click(labelled(container, "Back")[0]!);
    await answer("messaging-accept", null);
    await answer("messaging-send", undefined, new Error("A message can be at most 3 bytes."));
    // Still the list: nothing opened.
    expect(byTest(container, "thread")).toHaveLength(0);
    // Accepted, it's a conversation now: opened, it holds the reply and why it wasn't sent.
    rerender(overviewOf([conversation({ cid: "r1", role: "responder", to: MINE })]));
    click(one(container, "messages-conversation"));
    await answer("messaging-thread", threadOf(conversation({ cid: "r1", role: "responder", to: MINE }), [{ id: 0, dir: "in", at: now, text: "hello" }]));
    expect(valueOf(one(container, "composer"))).toBe("a long reply");
    expect(one(container, "composer-error").textContent).toBe("A message can be at most 3 bytes.");
    act(() => root.unmount());
  });
});

describe("contacts (screens#9, screens#10)", () => {
  it("names the conversation New message starts by the contact saved there", async () => {
    const { container, root } = await mount(overviewOf([]));
    click(one(container, "messages-new"));
    await answer("contacts", []);
    type(elements(container).find((e) => e.getAttribute("id") === "message-to")!, ALICE);
    await answer("seedelf-lookup", { name: ALICE, label: "alice", own: false });
    click(button(container, "Save to contacts"));
    type(elements(container).find((e) => e.getAttribute("id") === "contact-name")!, "Alice from work");
    click(elements(container).find((e) => e.localName === "button" && e.textContent === "Save" && e.getAttribute("class") === "primary")!);
    await answer("contact-save", [{ ...CONTACT, name: "Alice from work" }]);
    type(one(container, "composer"), "hello");
    press(one(container, "composer"), new Key("Enter"));
    await answer("messaging-start", { cid: "c1" });
    const c = conversation({ cid: "c1", role: "initiator", handle: ALICE, outbox: 1 });
    await answer("messaging-thread", threadOf(c, [{ id: 0, dir: "out", at: now, text: "hello", sent: "queued" }]));
    expect(one(container, "thread-name").textContent).toBe("Alice from work");
    expect(byTest(container, "thread-save")).toHaveLength(0);
    act(() => root.unmount());
  });

  it("saves a contact's name only once an input method's conversion is taken", async () => {
    const container = fakeDocument.body.appendChild(fakeDocument.createElement("div"));
    const root = createRoot(container);
    act(() => root.render(createElement(ContactEditor, { value: ALICE, onClose: () => {}, onSaved: () => {} })));
    const name = elements(container).find((e) => e.getAttribute("id") === "contact-name")!;
    type(name, "たなか");
    press(name, new Key("Enter", false, true));
    expect(asked("contact-save")).toHaveLength(0);
    press(name, new Key("Enter"));
    expect(asked("contact-save")).toHaveLength(1);
    act(() => root.unmount());
  });
});

describe("the rest of the list (screens#14)", () => {
  it("says what a request continues first, and an unread count in words", async () => {
    const request = { cid: "r1", startedAt: now, to: MINE, continues: { cid: "gone", verified: false }, messages: 1, lastAt: now, unread: 2 };
    const { container, root } = await mount(overviewOf([], { requests: [request] }));
    const row = elements(one(container, "messages-requests")).find((e) => e.localName === "button")!;
    expect(elements(row).find((e) => classes(e).includes("convo__preview"))?.textContent).toMatch(
      /^Says it continues an earlier conversation \(unverified\) · Wrote to your Seedelf web-wallet/,
    );
    expect(elements(row).find((e) => classes(e).includes("sr-only"))?.textContent).toBe("2 unread");
    act(() => root.unmount());
  });

  it("says Home's row is off with what's unread still counted", () => {
    const html = (overview: MessagingOverview) => renderToStaticMarkup(createElement(MessagesRow, { overview, onOpen: () => {} }));
    const unread = overviewOf([conversation({ cid: "c", role: "initiator", handle: ALICE, unread: 2 })], { on: false });
    expect(html(unread)).toContain("Off · 2 unread");
    expect(html(overviewOf([], { on: false }))).toContain(">Off<");
  });
});

describe("Settings and the wallet's removal (S5, S6)", () => {
  const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replace(/\s+/g, " ");

  it("never says everything goes through Koios while Messages are on (docs-claims#2)", () => {
    expect(plain(renderToStaticMarkup(createElement(ServerStatusLine, { koiosOnly: true, messages: true })))).toContain(
      "Using Koios only for Cardano. Messages use Seedelf Wallet's own server.",
    );
    expect(plain(renderToStaticMarkup(createElement(ServerStatusLine, { koiosOnly: true })))).toContain("Using Koios only.");
    const note = (messaging: { preprod: boolean; mainnet: boolean }) =>
      plain(
        renderToStaticMarkup(
          createElement(
            PreferencesContext.Provider,
            { value: { prefs: { ...DEFAULT_PREFERENCES, koiosOnly: true, messaging }, loaded: true, set: async () => undefined } },
            createElement(KoiosOnly),
          ),
        ),
      );
    expect(note({ preprod: true, mainnet: false })).toContain("Messages still go through Seedelf Wallet's own server.");
    expect(note({ preprod: true, mainnet: false })).not.toContain("Everything goes through Koios");
    expect(note({ preprod: false, mainnet: false })).toContain("Everything goes through Koios");
  });

  it("says Remove wallet and Forgot password delete conversations, which the phrase doesn't bring back (docs-claims#8)", () => {
    expect(plain(renderToStaticMarkup(createElement(RemoveWallet, { onBack: () => undefined, onRemoved: () => undefined })))).toContain(
      "Conversations in Messages are deleted too, and your recovery phrase doesn't bring them back.",
    );
    expect(plain(renderToStaticMarkup(createElement(Reset, { onCancel: () => undefined, onReset: () => undefined })))).toContain(
      "Conversations in Messages are deleted too, and your phrase doesn't bring them back.",
    );
  });
});

describe("the connector's window while a request is on its way (cross-feature#12)", () => {
  it("says it's loading, never that nothing's waiting, while the worker keeps it open for one", async () => {
    const container = fakeDocument.body.appendChild(fakeDocument.createElement("div"));
    const root = createRoot(container);
    act(() => root.render(createElement(NetworkContext.Provider, { value: "preprod" }, createElement(DappApprovals))));
    await answer("dapp-approvals", []);
    expect(one(container, "dapp-empty").textContent).toBe("Nothing's waiting.");
    // Empty, the window asks to close; the worker keeps it, a request the unlock let go still on its way to the list.
    await act(async () => {
      await new Promise((done) => setTimeout(done, 900));
    });
    await answer("dapp-close", false);
    await answer("dapp-approvals", []);
    expect(one(container, "dapp-empty").textContent).toBe("Loading…");
    act(() => root.unmount());
  });
});
