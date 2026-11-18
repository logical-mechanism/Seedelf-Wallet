// The browser's Back (Alt+Left, a mouse's back button) is a screen's own Back (history.ts `useBrowserBack`), and like
// the screen's button it does nothing while that Back is off, as Screen keeps it off while a transaction is being sent
// (`backDisabled`). Without the check, the browser's Back left a review while its Send was in flight: the very press
// the disabled button refuses. A revert of it passed every test (chunk 51, t1l#12).
//
// Screen runs on React's own reconciler here, over fake-dom.ts, and the page hears the browser's Back as it would: a
// popstate on the window.
import { act, createElement } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { fakeDocument, fakeDom, popState, type Root } from "./fake-dom";

const { Screen } = await import("../src/ui/components/Screen");

let createRoot: (container: unknown) => Root;
beforeAll(async () => {
  createRoot = await fakeDom();
});

const container = fakeDocument.body.appendChild(fakeDocument.createElement("div"));

describe("the browser's Back on a screen whose own Back is off (chunk 51, t1l#12)", () => {
  it("does nothing while a transaction is being sent, and goes back once it may", () => {
    const onBack = vi.fn();
    const root = createRoot(container);
    const screen = (busy: boolean) =>
      createElement(Screen, { title: "Review the payment", titleId: "review", onBack, backDisabled: busy, children: null });
    // Sending: the screen's own Back is off, and the browser's Back is too.
    act(() => root.render(screen(true)));
    popState();
    expect(onBack).not.toHaveBeenCalled();
    // Sent, or refused: Back is on again, and the browser's Back is the screen's.
    act(() => root.render(screen(false)));
    popState();
    expect(onBack).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
