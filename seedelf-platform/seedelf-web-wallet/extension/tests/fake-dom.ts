// A DOM just big enough for react-dom/client to render a screen into and dispatch a click or a submit through, for
// a test of what a press does after an await, which the house's static seam can't run (screens-wiring-review-fixes
// .test.ts: "What a press does after an await doesn't run here"). No new dependency. Clicks go through React's root
// listeners, so React's own rule for a disabled button (no onClick) holds as a browser's does. Chunk 51's e8b#3
// verifier wrote it; its tests share it.
import { act } from "react";
import { vi } from "vitest";

const HTML_NS = "http://www.w3.org/1999/xhtml";
type Options = boolean | { capture?: boolean } | undefined;
const capturing = (o: Options) => (typeof o === "boolean" ? o : !!o?.capture);

export class FakeEvent {
  target: FakeNode | null = null;
  currentTarget: unknown = null;
  defaultPrevented = false;
  stopped = false;
  readonly bubbles = true;
  readonly cancelable = true;
  readonly button = 0;
  readonly timeStamp = Date.now();
  constructor(readonly type: string) {}
  preventDefault() {
    this.defaultPrevented = true;
  }
  stopPropagation() {
    this.stopped = true;
  }
  stopImmediatePropagation() {
    this.stopped = true;
  }
}

type Handler = ((e: FakeEvent) => void) | { handleEvent(e: FakeEvent): void };

class FakeTarget {
  listeners: Array<{ type: string; fn: Handler; capture: boolean }> = [];
  addEventListener(type: string, fn: Handler, o?: Options) {
    this.listeners.push({ type, fn, capture: capturing(o) });
  }
  removeEventListener(type: string, fn: Handler, o?: Options) {
    const capture = capturing(o);
    this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn && l.capture === capture));
  }
  fire(event: FakeEvent, capture: boolean) {
    for (const l of this.listeners.filter((x) => x.type === event.type && x.capture === capture)) {
      if (typeof l.fn === "function") l.fn.call(this, event);
      else l.fn.handleEvent(event);
    }
  }
}

export class FakeNode extends FakeTarget {
  parentNode: FakeNode | null = null;
  childNodes: FakeNode[] = [];
  nodeValue: string | null = null;
  constructor(
    readonly nodeType: number,
    readonly nodeName: string,
    public ownerDocument: FakeDocument | null,
  ) {
    super();
  }
  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): FakeNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get nextSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes;
    return siblings ? (siblings[siblings.indexOf(this) + 1] ?? null) : null;
  }
  get previousSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes;
    return siblings ? (siblings[siblings.indexOf(this) - 1] ?? null) : null;
  }
  get parentElement(): FakeNode | null {
    return this.parentNode?.nodeType === 1 ? this.parentNode : null;
  }
  appendChild<T extends FakeNode>(child: T): T {
    return this.insertBefore(child, null);
  }
  insertBefore<T extends FakeNode>(child: T, before: FakeNode | null): T {
    child.parentNode?.removeChild(child);
    const at = before ? this.childNodes.indexOf(before) : -1;
    if (at < 0) this.childNodes.push(child);
    else this.childNodes.splice(at, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild<T extends FakeNode>(child: T): T {
    const at = this.childNodes.indexOf(child);
    if (at >= 0) this.childNodes.splice(at, 1);
    child.parentNode = null;
    return child;
  }
  contains(other: FakeNode | null) {
    for (let n = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  getRootNode(): FakeNode {
    let n: FakeNode = this;
    while (n.parentNode) n = n.parentNode;
    return n;
  }
  get textContent(): string {
    return this.nodeType === 3 ? (this.nodeValue ?? "") : this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(text: string) {
    if (this.nodeType === 3) {
      this.nodeValue = text;
      return;
    }
    for (const c of [...this.childNodes]) this.removeChild(c);
    if (text) this.appendChild(this.ownerDocument!.createTextNode(text));
  }
  /** Capture from the window down, then bubble back up, as a browser dispatches a click. */
  dispatchEvent(event: FakeEvent) {
    const path: FakeTarget[] = [];
    for (let n: FakeNode | null = this; n; n = n.parentNode) path.push(n);
    path.push(fakeWindow);
    event.target = this;
    for (const t of [...path].reverse()) {
      if (event.stopped) break;
      event.currentTarget = t;
      t.fire(event, true);
    }
    for (const t of path) {
      if (event.stopped) break;
      event.currentTarget = t;
      t.fire(event, false);
    }
    return !event.defaultPrevented;
  }
}

class FakeText extends FakeNode {
  constructor(text: string, doc: FakeDocument) {
    super(3, "#text", doc);
    this.nodeValue = text;
  }
  get data() {
    return this.nodeValue ?? "";
  }
  set data(text: string) {
    this.nodeValue = text;
  }
}

class FakeStyle {
  [name: string]: unknown;
  setProperty(name: string, value: string) {
    this[name] = value;
  }
  removeProperty(name: string) {
    delete this[name];
  }
  getPropertyValue(name: string) {
    return String(this[name] ?? "");
  }
}

export class FakeElement extends FakeNode {
  readonly attributes = new Map<string, string>();
  readonly style = new FakeStyle();
  readonly tagName: string;
  readonly localName: string;
  scrollTop = 0;
  scrollLeft = 0;
  offsetHeight = 0;
  constructor(
    tag: string,
    doc: FakeDocument,
    readonly namespaceURI: string = HTML_NS,
  ) {
    super(1, namespaceURI === HTML_NS ? tag.toUpperCase() : tag, doc);
    this.tagName = this.nodeName;
    this.localName = tag;
  }
  setAttribute(name: string, value: unknown) {
    this.attributes.set(name, String(value));
  }
  setAttributeNS(_ns: string | null, name: string, value: unknown) {
    this.setAttribute(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  removeAttributeNS(_ns: string | null, name: string) {
    this.removeAttribute(name);
  }
  focus() {}
  blur() {}
}

class FakeDocument extends FakeNode {
  readonly documentElement: FakeElement;
  readonly head: FakeElement;
  readonly body: FakeElement;
  activeElement: FakeElement | null = null;
  defaultView: unknown = null;
  constructor() {
    super(9, "#document", null);
    this.documentElement = this.appendChild(new FakeElement("html", this));
    this.head = this.documentElement.appendChild(new FakeElement("head", this));
    this.body = this.documentElement.appendChild(new FakeElement("body", this));
  }
  get scrollingElement() {
    return this.documentElement;
  }
  createElement(tag: string) {
    return new FakeElement(tag, this);
  }
  createElementNS(ns: string, tag: string) {
    return new FakeElement(tag, this, ns);
  }
  createTextNode(text: string) {
    return new FakeText(text, this);
  }
  createComment(text: string) {
    const c = new FakeNode(8, "#comment", this);
    c.nodeValue = text;
    return c;
  }
}

export const fakeDocument = new FakeDocument();
const fakeHistory = {
  state: null as unknown,
  scrollRestoration: "auto",
  pushState(state: unknown) {
    this.state = state;
  },
  replaceState(state: unknown) {
    this.state = state;
  },
  back() {},
};
const fakeWindow = Object.assign(new FakeTarget(), {
  event: undefined,
  document: fakeDocument,
  history: fakeHistory,
  HTMLIFrameElement: class {},
  top: {},
  self: undefined as unknown,
  location: { protocol: "chrome-extension:", href: "chrome-extension://seedelf/index.html" },
});
fakeWindow.self = fakeWindow;
fakeDocument.defaultView = fakeWindow;

export type Root = { render(node: unknown): void; unmount(): void };

/** Puts the fake DOM in place of the globals and gives react-dom/client's createRoot: call it in a beforeAll. */
export async function fakeDom(): Promise<(container: unknown) => Root> {
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("history", fakeHistory);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const client = (await import("react-dom/client")) as unknown as {
    createRoot?: (container: unknown) => Root;
    default?: { createRoot: (container: unknown) => Root };
  };
  return client.createRoot ?? client.default!.createRoot;
}

/** Every element under `node`, in document order. */
export const elements = (node: FakeNode): FakeElement[] =>
  node.childNodes.flatMap((c) => (c instanceof FakeElement ? [c, ...elements(c)] : []));

/** A click on `e`, and what React draws from it. */
export function click(e: FakeElement) {
  act(() => {
    e.dispatchEvent(new FakeEvent("click"));
  });
}

/** A form's submit, as a submit button's press makes one in a browser. */
export function submit(form: FakeElement) {
  act(() => {
    form.dispatchEvent(new FakeEvent("submit"));
  });
}

/** A request the page made of the worker, answered (or refused) when the test says. */
export interface Asked {
  type: string;
  payload: unknown;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/** The worker answers the page's oldest unanswered `type` (or refuses it, with `error`), and React draws what it brings. */
export async function answer(waiting: Asked[], type: string, value: unknown, error?: Error) {
  const at = waiting.findIndex((w) => w.type === type);
  if (at < 0) throw new Error(`the page didn't ask the worker for ${type}: ${waiting.map((w) => w.type).join(", ")}`);
  const [asked] = waiting.splice(at, 1);
  await act(async () => {
    if (error) asked!.reject(error);
    else asked!.resolve(value);
    await new Promise((done) => setTimeout(done, 0));
  });
}
