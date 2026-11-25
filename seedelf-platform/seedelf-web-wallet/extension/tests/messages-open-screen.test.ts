// The Messages page where Messages isn't open (networks.ts `MESSAGING_NETWORKS`; the owner's call, 2026-11-24): on
// mainnet one line says where it is, in the switch's place, with no switch and nothing to write from; on preprod the
// switch, and under it the line that the test is for a wallet that isn't a mainnet wallet (the Seedelf key is the same
// on every network). The worker's side is messaging-open.test.ts.
//
// Nothing to write from, over what a development build left there too (1.10.0's second review, the worker's finding
// 8): a conversation's box, Start again, Show my Seedelf, and a request's Accept and reply box are not offered on a
// closed network, and the box says the closed line, never "what you write waits until you turn them on" (there is no
// switch to turn). Reading, naming and deleting stay. Where Messages is open and the switch is off, nothing changes:
// what's written waits.
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { NetworkName } from "../src/networks";
import type { MessagingConversation, MessagingEntry, MessagingOverview, MessagingThread } from "../src/shared/rpc";
import { answer as answered, type Asked, click, elements, FakeElement, FakeEvent, fakeDocument, fakeDom, type FakeNode, type Root, submit } from "./fake-dom";

const worker = vi.hoisted(() => ({ waiting: [] as Asked[] }));
vi.mock("../src/ui/background", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  call: (type: string, payload: unknown) => new Promise((resolve, reject) => worker.waiting.push({ type, payload, resolve, reject })),
}));
vi.stubGlobal("HTMLInputElement", class {});
vi.stubGlobal("location", { search: "", hash: "" });
vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
vi.stubGlobal("chrome", {
  runtime: { onMessage: { addListener() {}, removeListener() {} } },
  storage: { local: { onChanged: { addListener() {}, removeListener() {} } } },
});
(fakeDocument as unknown as { visibilityState: string }).visibilityState = "visible";
// React asks whether the browser has the input event before it listens for one: say so, before react-dom loads.
(fakeDocument as unknown as { oninput: null }).oninput = null;
(FakeElement.prototype as unknown as { showModal(): void; close(): void }).showModal = () => {};
(FakeElement.prototype as unknown as { showModal(): void; close(): void }).close = () => {};

const { Messages } = await import("../src/ui/screens/Messages");
const { NetworkContext } = await import("../src/ui/network");

const off: MessagingOverview = { on: false, conversations: [], requests: [] };
const page = (network: NetworkName, overview: MessagingOverview | undefined = off) =>
  renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: network },
      createElement(Messages, { overview, error: undefined, reload: () => undefined, setOverview: () => undefined, onBack: () => undefined }),
    ),
  );
const has = (html: string, testId: string) => html.includes(`data-testid="${testId}"`);
const tagOf = (html: string, testId: string) => html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";

describe("the Messages page, where Messages isn't open", () => {
  it("says on mainnet where Messages is, with no switch and nothing to write from", () => {
    const html = page("mainnet");
    expect(has(html, "messages-closed")).toBe(true);
    expect(html).toContain("For now, Messages are on Preprod only.");
    expect(has(html, "messages-switch")).toBe(false);
    // The pen is there and can't be pressed; the line about turning Messages on isn't said.
    expect(tagOf(html, "messages-new")).toContain("disabled");
    expect(has(html, "messages-none")).toBe(false);
    expect(html).not.toContain("Turn Messages on");
    // The test's own line belongs with the switch.
    expect(has(html, "messages-test-wallet")).toBe(false);
  });

  it("says the same before the overview is read, and whatever it says", () => {
    expect(has(page("mainnet", undefined), "messages-closed")).toBe(true);
    expect(has(page("mainnet", undefined), "messages-switch")).toBe(false);
    // An overview that said on (the worker never does, there) still draws no switch.
    expect(has(page("mainnet", { ...off, on: true }), "messages-switch")).toBe(false);
  });

  it("draws the switch on preprod, and the line about which wallet to test with, as a warning, on or off", () => {
    for (const overview of [off, { ...off, on: true }]) {
      const html = page("preprod", overview);
      expect(has(html, "messages-switch")).toBe(true);
      expect(has(html, "messages-closed")).toBe(false);
      expect(tagOf(html, "messages-new")).not.toContain("disabled");
      expect(tagOf(html, "messages-test-wallet")).toContain("callout--warn");
      expect(html).toContain("Messages are a test for now: use a wallet that isn&#x27;t your mainnet wallet.");
    }
    expect(page("preprod", off)).toContain("Turn Messages on to write to a Seedelf");
  });

  // The owner's call of 2026-11-24: the Seedelfs' switches are behind one row under the list, as the page is first
  // drawn too (no effect has run in this markup).
  it("draws the Seedelfs' row under the list only while Messages are on: folded where one takes messages, open where none does", () => {
    const seedelfs = [{ name: MINE, register: { generator: "a".repeat(96), publicValue: "b".repeat(96) }, made: true, on: true }];
    const at = (html: string, testId: string) => html.indexOf(`data-testid="${testId}"`);
    expect(has(page("preprod", { ...off, seedelfs }), "messages-seedelfs-row")).toBe(false);
    const some = page("preprod", { ...off, on: true, seedelfs });
    expect(tagOf(some, "messages-seedelfs-row")).toContain('aria-expanded="false"');
    expect(has(some, "messages-seedelf-switch")).toBe(false);
    expect(some).toContain("taking messages: 1 of 1");
    expect(at(some, "messages-none")).toBeGreaterThan(at(some, "messages-test-wallet"));
    expect(at(some, "messages-seedelfs-row")).toBeGreaterThan(at(some, "messages-none"));
    expect(at(some, "messages-notes")).toBeGreaterThan(at(some, "messages-seedelfs-row"));
    const none = page("preprod", { ...off, on: true, seedelfs: seedelfs.map((s) => ({ ...s, on: false })) });
    expect(tagOf(none, "messages-seedelfs-row")).toContain('aria-expanded="true"');
    expect(has(none, "messages-seedelf-switch")).toBe(true);
    expect(none).toContain("taking messages: 0 of 1");
    expect(at(none, "messages-seedelf-switch")).toBeGreaterThan(at(none, "messages-seedelfs-row"));
    expect(at(none, "messages-notes")).toBeGreaterThan(at(none, "messages-seedelf-switch"));
  });
});

// What a development build left on mainnet, drawn on the tree's fake DOM, the worker answered by the test.
let createRoot: (container: unknown) => Root;
beforeAll(async () => {
  createRoot = await fakeDom();
});
afterEach(() => {
  worker.waiting.length = 0;
});

const answer = (type: string, value: unknown, error?: Error) => answered(worker.waiting, type, value, error);
const asked = (type: string) => worker.waiting.filter((w) => w.type === type);
const byTest = (root: FakeNode, id: string) => elements(root).filter((e) => e.getAttribute("data-testid") === id);
const one = (root: FakeNode, id: string) => {
  const found = byTest(root, id);
  if (found.length !== 1) throw new Error(`${found.length} elements with data-testid="${id}"`);
  return found[0]!;
};
const disabled = (e: FakeElement) => (e as unknown as { disabled?: boolean }).disabled === true || e.getAttribute("disabled") !== null;
function type(box: FakeElement, text: string) {
  act(() => {
    (box as unknown as { value: string }).value = text;
    box.dispatchEvent(new FakeEvent("input"));
  });
}

const now = Date.now();
const SEEDELF = "5eed0e1f" + Buffer.from("alice").toString("hex") + "00" + "c".repeat(30) + "0123456789abcdef";
const MINE = "5eed0e1f" + Buffer.from("mine").toString("hex") + "00" + "c".repeat(32) + "1111222233334444";
const CLOSED = "For now, Messages are on Preprod only.";
const OFF = "Messages are off: what you write waits until you turn them on.";

const conversation = (over: Partial<MessagingConversation> & Pick<MessagingConversation, "cid" | "role">): MessagingConversation => ({
  startedAt: now - 3600_000,
  lastAt: now - 60_000,
  unread: 0,
  outbox: 0,
  unanswered: false,
  ...over,
});
const threadOf = (c: MessagingConversation, messages: MessagingEntry[], more: Partial<MessagingThread> = {}): MessagingThread => ({
  conversation: c,
  messages,
  trimmed: 0,
  missing: 0,
  maxTextBytes: 1500,
  ...more,
});
const request = { cid: "r1", startedAt: now, to: MINE, messages: 1, lastAt: now, unread: 1 };

async function mount(network: NetworkName, overview: MessagingOverview) {
  const container = fakeDocument.body.appendChild(fakeDocument.createElement("div"));
  const root = createRoot(container);
  act(() =>
    root.render(
      createElement(
        NetworkContext.Provider,
        { value: network },
        createElement(Messages, { overview, error: undefined, reload: () => undefined, setOverview: () => undefined, onBack: () => undefined }),
      ),
    ),
  );
  await answer("contacts", []);
  return { container, root };
}

async function openThread(network: NetworkName, c: MessagingConversation, messages: MessagingEntry[], more: Partial<MessagingThread> = {}) {
  const mounted = await mount(network, { on: false, conversations: [c], requests: [] });
  click(byTest(mounted.container, "messages-conversation")[0]!);
  await answer("messaging-thread", threadOf(c, messages, more));
  return mounted;
}

async function openRequest(network: NetworkName) {
  const mounted = await mount(network, { on: false, conversations: [], requests: [request] });
  click(elements(one(mounted.container, "messages-requests")).find((e) => e.localName === "button")!);
  await answer("messaging-request", [{ id: 0, dir: "in", at: now, text: "hello" }]);
  return mounted;
}

describe("what a development build left on a closed network (1.10.0's second review)", () => {
  const answeredByThem = conversation({ cid: "c1", role: "initiator", handle: SEEDELF });
  const said: MessagingEntry[] = [
    { id: 0, dir: "out", at: now - 120_000, text: "hello", sent: "posted" },
    { id: 1, dir: "in", at: now - 60_000, text: "hi" },
  ];

  it("shows a conversation with a box that can't send, the closed line over it, and no Show my Seedelf", async () => {
    const { container, root } = await openThread("mainnet", answeredByThem, said, { seedelfs: [MINE] });
    // Read as ever.
    expect(byTest(container, "bubble").map((b) => b.textContent)).toHaveLength(2);
    // The box: the line the list has, never the switch's.
    expect(one(container, "composer-closed").textContent).toBe(CLOSED);
    expect(byTest(container, "composer-off")).toHaveLength(0);
    expect(container.textContent).not.toContain(OFF);
    expect(disabled(one(container, "composer"))).toBe(true);
    expect(disabled(one(container, "composer-send"))).toBe(true);
    expect(byTest(container, "thread-reveal")).toHaveLength(0);
    // A submit made all the same asks the worker nothing.
    submit(elements(container).find((e) => e.localName === "form")!);
    expect(asked("messaging-send")).toHaveLength(0);
    // Naming and deleting stay.
    expect(byTest(container, "thread-rename")).toHaveLength(1);
    expect(byTest(container, "thread-delete")).toHaveLength(1);
    act(() => root.unmount());
  });

  it("offers no Start again there: an unanswered conversation only says so", async () => {
    const unanswered = conversation({ cid: "c2", role: "initiator", handle: SEEDELF, unanswered: true });
    const { container, root } = await openThread("mainnet", unanswered, [said[0]!]);
    const state = one(container, "thread-restart");
    expect(state.textContent).toContain("No reply in 48 hours");
    expect(elements(state).filter((e) => e.localName === "button" && !disabled(e))).toHaveLength(0);
    expect(disabled(one(container, "composer-send"))).toBe(true);
    act(() => root.unmount());
  });

  it("shows a request with no Accept to press and no reply box to write in", async () => {
    const { container, root } = await openRequest("mainnet");
    expect(byTest(container, "bubble").map((b) => b.textContent)).toHaveLength(1);
    expect(disabled(one(container, "request-accept"))).toBe(true);
    click(one(container, "request-accept"));
    expect(one(container, "composer-closed").textContent).toBe(CLOSED);
    expect(disabled(one(container, "composer"))).toBe(true);
    submit(elements(container).find((e) => e.localName === "form")!);
    expect(asked("messaging-accept")).toHaveLength(0);
    expect(asked("messaging-send")).toHaveLength(0);
    act(() => root.unmount());
  });

  it("changes nothing where Messages is open and its switch is off: what's written waits, and is sent to the worker", async () => {
    const thread = await openThread("preprod", answeredByThem, said, { seedelfs: [MINE] });
    expect(one(thread.container, "composer-off").textContent).toBe(OFF);
    expect(byTest(thread.container, "composer-closed")).toHaveLength(0);
    expect(byTest(thread.container, "thread-reveal")).toHaveLength(1);
    type(one(thread.container, "composer"), "waits for the switch");
    expect(disabled(one(thread.container, "composer-send"))).toBe(false);
    submit(elements(thread.container).find((e) => e.localName === "form")!);
    expect(asked("messaging-send").map((w) => w.payload)).toEqual([{ cid: "c1", text: "waits for the switch" }]);
    act(() => thread.root.unmount());
    worker.waiting.length = 0;

    const asking = await openRequest("preprod");
    expect(disabled(one(asking.container, "request-accept"))).toBe(false);
    expect(one(asking.container, "composer-off").textContent).toBe(OFF);
    click(one(asking.container, "request-accept"));
    expect(asked("messaging-accept").map((w) => w.payload)).toEqual([{ cid: "r1" }]);
    act(() => asking.root.unmount());
  });
});
