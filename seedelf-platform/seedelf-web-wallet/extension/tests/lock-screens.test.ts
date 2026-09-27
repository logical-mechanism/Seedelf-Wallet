// A Lock that fails is said, never shown as a click that did nothing or as
// "couldn't start"; and when the wallet locked itself because its core
// stopped working, the Unlock screen says so (launch review #17).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The screens read the page's URL when they load (ui/view.ts).
beforeAll(() => {
  vi.stubGlobal("location", { search: "" });
});

describe("the lock screens", () => {
  it("say why the wallet locked itself, and only then", async () => {
    const { Unlock } = await import("../src/ui/screens/Unlock");
    const props = { retryAfterMs: 0, onUnlocked: () => undefined, onForgot: () => undefined };
    const trapped = renderToStaticMarkup(createElement(Unlock, { ...props, lockedBy: "trap" }));
    expect(trapped).toContain('data-testid="unlock-why"');
    expect(trapped).toContain("core stopped working");
    expect(renderToStaticMarkup(createElement(Unlock, props))).not.toContain("unlock-why");
  });

  it("say a Lock that failed, and offer it again", async () => {
    const { LockFailed } = await import("../src/ui/App");
    const html = renderToStaticMarkup(createElement(LockFailed, { message: "Storage refused.", onRetry: () => undefined }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("The wallet couldn&#x27;t lock: Storage refused.");
    expect(html).toContain(">Lock</button>");
    expect(html).not.toContain("couldn&#x27;t start");
  });
});
