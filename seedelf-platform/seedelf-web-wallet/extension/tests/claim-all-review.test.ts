// Bring everything back's review (screens/ClaimAll.tsx), as a person works it.
//
// Chunk 51's whole review, e8b#3: the switch builds every return again (ClaimAll's `rebuild`), and a session the user
// taps to leave out while that build runs must stay out once it lands, and stay out of Send. The rebuild is an await,
// then a press after it, so this runs the real ClaimAll on React's own reconciler (react-dom/client, `act`), over the
// small DOM in fake-dom.ts. The worker is `call`, answered when the test says.
//
// And e8b#4: the total's "and N tokens" counts kinds, as Send's and Make public's do, not one per session.
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { SessionBackSummary, SessionView } from "../src/shared/rpc";
import { answer as answered, type Asked, click, elements, fakeDocument, fakeDom, type FakeElement, type Root } from "./fake-dom";

const worker = vi.hoisted(() => ({ waiting: [] as Asked[] }));

vi.mock("../src/ui/background", async (original) => ({
  ...(await original<typeof import("../src/ui/background")>()),
  call: (type: string, payload: unknown) =>
    new Promise((resolve, reject) => worker.waiting.push({ type, payload, resolve, reject })),
}));

const { ClaimAll, ClaimReview, isClaimable } = await import("../src/ui/screens/ClaimAll");
const { NetworkContext } = await import("../src/ui/network");

let createRoot: (container: unknown) => Root;
beforeAll(async () => {
  createRoot = await fakeDom();
});
afterEach(() => {
  worker.waiting.length = 0;
});

const SITES = { 4: "app.example", 5: "dex.example", 6: "nft.example" } as const;

const session = (index: 4 | 5 | 6): SessionView => ({
  index,
  network: "preprod",
  address: "addr_test1" + "s".repeat(50),
  createdAt: 0,
  stage: "open",
  txs: [{ kind: "out", txHash: "ef".repeat(32), at: 0, confirmed: true }],
  holding: { lovelace: "25000000", tokens: [], utxos: 2 },
  site: { origin: `https://${SITES[index]}` },
});

const back = (index: number, hash: string, over: Partial<SessionBackSummary> = {}): SessionBackSummary => ({
  network: "preprod",
  index,
  txHash: hash.repeat(32),
  fee: "300000",
  lovelace: "5200000",
  tokens: [],
  depositOutputs: 1,
  inputs: 2,
  ...over,
});
const chain = (entry: string) => ({ boxes: 2, depth: 2, mixes: 8, fees: "8000000", txs: 10, delay: "1-6", entry: entry.repeat(32) });

const throughLovejoin = {
  returns: [back(4, "a4", { lovejoin: chain("e4") }), back(5, "a5", { lovejoin: chain("e5") }), back(6, "a6", { lovejoin: chain("e6") })],
  skipped: [],
};
const straightBack = { returns: [back(4, "b4"), back(5, "b5"), back(6, "b6")], skipped: [] };

const container = fakeDocument.body.appendChild(fakeDocument.createElement("div"));
const byTestId = (id: string) => elements(container).find((e) => e.getAttribute("data-testid") === id);
const rows = () => elements(byTestId("claim-returns")!).filter((e) => e.localName === "button");
const row = (host: string) => rows().find((b) => b.textContent.includes(host))!;
const pressed = (e: FakeElement) => e.getAttribute("aria-pressed");
const theSwitch = () => byTestId("claim-way-switch")!;
const sendButton = () => elements(container).find((e) => e.localName === "button" && e.getAttribute("class") === "primary")!;
const backButton = () => elements(container).find((e) => e.localName === "button" && e.getAttribute("class") === "icon-button")!;
const answer = (type: string, value: unknown) => answered(worker.waiting, type, value);

describe("Bring everything back: a session left out while the switch builds them again (chunk 51, e8b#3)", () => {
  it("keeps a session the user left out during the rebuild out once it lands, and out of Send", async () => {
    const root = createRoot(container);
    act(() => root.render(createElement(ClaimAll, { sessions: [session(4), session(5), session(6)], onBack: () => {}, onDone: () => {} })));
    await answer("session-claim-build", throughLovejoin);

    // Built through Lovejoin: all three picked, the switch on.
    expect(rows().map(pressed)).toEqual(["true", "true", "true"]);
    expect(sendButton().textContent).toBe("Send 3 returns");
    expect(theSwitch().getAttribute("aria-checked")).toBe("true");

    // Lovejoin off: every return is built again, straight back. While that runs, the switch, Back and Send are off.
    click(theSwitch());
    expect(worker.waiting.map((w) => w.payload)).toEqual([{ indexes: [4, 5, 6], direct: true }]);
    expect(theSwitch().hasAttribute("disabled")).toBe(true);
    expect(backButton().hasAttribute("disabled")).toBe(true);
    expect(sendButton().hasAttribute("disabled")).toBe(true);

    // The user taps the session they still use on dex.example, to leave it out. What the screen shows it did:
    click(row("dex.example"));
    const shownAfterTap = pressed(row("dex.example"));

    // The rebuild lands, straight back.
    await answer("session-claim-build", straightBack);
    expect(theSwitch().getAttribute("aria-checked")).toBe("false");

    // A tap the screen took stays taken: the review keeps the choice it showed.
    expect
      .soft(pressed(row("dex.example")), `dex.example's row read aria-pressed=${shownAfterTap} after the tap; the button now reads "${sendButton().textContent}"`)
      .toBe(shownAfterTap);

    // And Send sends what the user chose: dex.example's return only if it was still picked.
    click(sendButton());
    const submit = worker.waiting.find((w) => w.type === "session-claim-submit");
    const meant = shownAfterTap === "false" ? ["b4", "b6"] : ["b4", "b5", "b6"];
    expect(submit?.payload).toEqual({ txHashes: meant.map((h) => h.repeat(32)) });

    act(() => root.unmount());
  });

  it("turns the rows off while it builds, as the switch, Back and Send are", async () => {
    const root = createRoot(container);
    act(() => root.render(createElement(ClaimAll, { sessions: [session(4), session(5), session(6)], onBack: () => {}, onDone: () => {} })));
    await answer("session-claim-build", throughLovejoin);
    expect(rows().some((r) => r.hasAttribute("disabled"))).toBe(false);
    click(theSwitch());
    expect(rows().every((r) => r.hasAttribute("disabled"))).toBe(true);
    await answer("session-claim-build", straightBack);
    expect(rows().some((r) => r.hasAttribute("disabled"))).toBe(false);
    act(() => root.unmount());
  });
});

describe("Bring everything back's total (chunk 51, e8b#4)", () => {
  const MIN = { policyId: "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72", assetName: "4d494e", quantity: "100" };
  const FOO = { policyId: "f0".repeat(28), assetName: "464f4f", quantity: "5" };
  const total = (returns: SessionBackSummary[]) =>
    renderToStaticMarkup(
      createElement(
        NetworkContext.Provider,
        { value: "preprod" },
        createElement(ClaimReview, {
          built: { returns, skipped: [] },
          chosen: new Set(returns.map((r) => r.index)),
          sessions: returns.map((r) => session(r.index as 4 | 5 | 6)),
          direct: false,
          busy: false,
          onToggle: () => {},
          onDirect: () => {},
        }),
      ),
    ).match(/data-testid="claim-total".*?<\/dl>/s)![0];

  it("counts a token two returns bring once, as Send's and Make public's totals count kinds", () => {
    // Each brings some MIN: one kind, said once, though each row says "and 1 token".
    expect(total([back(4, "c4", { tokens: [MIN] }), back(5, "c5", { tokens: [MIN] })])).toContain("and 1 token<");
    // And two kinds are two.
    expect(total([back(4, "c4", { tokens: [MIN] }), back(5, "c5", { tokens: [MIN, FOO] })])).toContain("and 2 tokens<");
  });
});

// Chunk 51's T1 lens over the screens (lane T1l): two of Bring everything back's guards a revert passed.
describe("Bring everything back's builds and its sessions (chunk 51, T1l)", () => {
  it("builds and signs its returns once, for the list it opened with, however it draws after (t1l#10)", async () => {
    const root = createRoot(container);
    act(() => root.render(createElement(ClaimAll, { sessions: [session(4), session(5), session(6)], onBack: () => {}, onDone: () => {} })));
    await answer("session-claim-build", throughLovejoin);
    const builds = () => worker.waiting.filter((w) => w.type === "session-claim-build");
    // The build landing draws the page again, and asks for nothing more.
    expect(builds()).toHaveLength(0);
    // Nor does a return taken off: it stays off.
    click(row("dex.example"));
    expect(builds()).toHaveLength(0);
    expect(pressed(row("dex.example"))).toBe("false");
    act(() => root.unmount());
  });

  it("offers only a session holding something that nothing brings back by itself (t1l#23)", () => {
    // The control: open, holding 2 UTxOs, nothing running.
    expect(isClaimable(session(4))).toBe(true);
    // A swap that brings itself back.
    expect(isClaimable({ ...session(4), auto: { step: "filling" } as NonNullable<SessionView["auto"]> })).toBe(false);
    // A session holding nothing.
    expect(isClaimable({ ...session(4), holding: { lovelace: "0", tokens: [], utxos: 0 } })).toBe(false);
  });
});
