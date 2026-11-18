// A review's error is the review's, and a refusal is about what was asked: the form a review goes back to starts clean,
// and a refusal goes once the form changes (T05, chunk 23's fixes; Make public's and private Send's rule). Make private
// kept a refusal under a changed amount and the review's error after Back, and Collateral kept the review's error on its
// status page after Back (chunk 51, e8b#5). Public Send and Create a Seedelf had the same gaps and follow the same rule
// now; their forms need a typed address or tag, which the small DOM here can't type.
//
// Each press after an await runs on React's own reconciler, over fake-dom.ts; the worker is `call`, answered or
// refused when the test says.
import { act, createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { Balances, MoveInSummary, SendSummary } from "../src/shared/rpc";
import { answer as answered, type Asked, click, elements, fakeDocument, fakeDom, type Root, submit } from "./fake-dom";

const worker = vi.hoisted(() => ({ waiting: [] as Asked[] }));

vi.mock("../src/ui/background", async (original) => ({
  ...(await original<typeof import("../src/ui/background")>()),
  call: (type: string, payload: unknown) =>
    new Promise((resolve, reject) => worker.waiting.push({ type, payload, resolve, reject })),
}));

const { Collateral } = await import("../src/ui/screens/Collateral");
const { MoveIn } = await import("../src/ui/screens/MoveIn");
const { NetworkContext } = await import("../src/ui/network");

let createRoot: (container: unknown) => Root;
beforeAll(async () => {
  createRoot = await fakeDom();
});
afterEach(() => {
  worker.waiting.length = 0;
});

const container = fakeDocument.body.appendChild(fakeDocument.createElement("div"));
const buttons = () => elements(container).filter((e) => e.localName === "button");
const button = (text: string) => buttons().find((b) => b.textContent === text)!;
const backButton = () => buttons().find((b) => b.getAttribute("class") === "icon-button")!;
/** What the screen's alert says, if it has one. */
const alert = () => elements(container).find((e) => e.getAttribute("role") === "alert")?.textContent;
const answer = (type: string, value: unknown, error?: Error) => answered(worker.waiting, type, value, error);
const refuse = (type: string, message: string) => answer(type, undefined, new Error(message));
const onPreprod = (element: ReturnType<typeof createElement>) => createElement(NetworkContext.Provider, { value: "preprod" }, element);

const ADDRESS = "addr_test1" + "q".repeat(50);
const none = { lovelace: "0", tokens: [], utxos: 0 };

describe("Collateral's review (chunk 51, e8b#5)", () => {
  it("leaves its error behind when Back goes to the status page", async () => {
    const root = createRoot(container);
    act(() => root.render(onPreprod(createElement(Collateral, { onBack: () => {} }))));
    await answer("collateral", { state: "none", reclaimed: false });
    await answer("balances", { cardano: { utxos: 2 } });

    click(button("Set collateral"));
    const summary: Partial<SendSummary> = {
      network: "preprod",
      txHash: "ab".repeat(32),
      max: false,
      fee: "174609",
      inputs: 1,
      changeLovelace: "1000000",
      changeTokens: 0,
      payments: [{ address: ADDRESS, own: true, lovelace: "5000000", minimum: null, tokens: [] }],
    };
    await answer("collateral-build", summary);
    expect(elements(container).some((e) => e.getAttribute("data-testid") === "collateral-review")).toBe(true);

    click(button("Send"));
    await refuse("collateral-submit", "Built more than 10 minutes ago: build it again.");
    expect(alert()).toBe("Built more than 10 minutes ago: build it again.");

    click(backButton());
    expect(elements(container).some((e) => e.getAttribute("data-testid") === "collateral-status")).toBe(true);
    expect(alert()).toBeUndefined();
    act(() => root.unmount());
  });
});

describe("Make private (chunk 51, e8b#5)", () => {
  const cardano: Balances["cardano"] = {
    lovelace: "100000000",
    tokens: [],
    utxos: 2,
    addressesUsed: 1,
    locked: none,
    staking: { registered: false, pool: null, drep: null, rewards: "0", deposit: "0" },
  };
  const summary: MoveInSummary = {
    network: "preprod",
    txHash: "cd".repeat(32),
    fee: "180000",
    lovelace: "99820000",
    minimum: null,
    tokens: [],
    depositOutputs: 1,
    changeLovelace: "0",
    changeTokens: 0,
    inputs: 2,
  };
  const form = () => elements(container).find((e) => e.localName === "form")!;

  it("drops a refusal once the form changes, and the review's error once Back goes to the form", async () => {
    const root = createRoot(container);
    act(() => root.render(onPreprod(createElement(MoveIn, { cardano, onCancel: () => {}, onSent: () => {} }))));

    // Max, Review, and the worker refuses it: the refusal is under the form.
    click(button("Max"));
    submit(form());
    await refuse("move-in-build", "Up to 99.8 ₳ can be made private.");
    expect(alert()).toBe("Up to 99.8 ₳ can be made private.");
    // The form changes (Max off): the refusal answered the old one, and goes.
    click(button("Max"));
    expect(alert()).toBeUndefined();

    // Max again, and the review: its Send is refused, then Back goes to a form that starts clean.
    click(button("Max"));
    submit(form());
    await answer("move-in-build", summary);
    click(buttons().find((b) => b.getAttribute("class") === "primary")!);
    await refuse("move-in-submit", "Built more than 10 minutes ago: build it again.");
    expect(alert()).toBe("Built more than 10 minutes ago: build it again.");
    click(backButton());
    expect(form()).toBeDefined();
    expect(alert()).toBeUndefined();
    act(() => root.unmount());
  });
});
