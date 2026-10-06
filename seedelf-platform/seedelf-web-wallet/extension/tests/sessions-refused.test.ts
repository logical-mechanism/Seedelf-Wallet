// What a refused funding leaves its review (ui/components/SessionRefused.tsx
// refusalOf): the session's record is read before the refusal's kind. A
// funding the worker found gone from Send's keeping was sent, whatever it
// called the refusal, and built again it would fund a second session (chunk
// 23's second review, fix round).
import { describe, expect, it, vi } from "vitest";

import type { SessionView } from "../src/shared/rpc";

const book = vi.hoisted(() => ({ sessions: [] as Array<Partial<SessionView>>, fails: false }));
vi.mock("../src/ui/background", async (original) => ({
  ...(await original<typeof import("../src/ui/background")>()),
  call: async () => {
    if (book.fails) throw new Error("locked");
    return book.sessions;
  },
}));

const { refusalOf, unsentWhyText } = await import("../src/ui/components/SessionRefused");
const { RpcError } = await import("../src/ui/background");

const stale = new RpcError("That payment isn't ready to send. Review it again.", "stale");
const FUNDING = "ab".repeat(32);
const funding = [{ kind: "out" as const, txHash: FUNDING, at: 1 }];
const plain = new RpcError("That session was started already. Start a new one.");

describe("a refused funding's way on", () => {
  it("watches a recorded funding that may have gone out, even when the worker called its review stale", async () => {
    book.sessions = [{ index: 3, stage: "funding", txs: funding }];
    expect(await refusalOf(stale, 3, FUNDING)).toEqual({ kind: "watch", detail: stale.message });
    expect(await refusalOf(plain, 3, FUNDING)).toEqual({ kind: "watch", detail: plain.message });
    // Another page's funding recorded on the same account isn't this review's: this one never went.
    expect(await refusalOf(stale, 3, "cd".repeat(32))).toEqual({ kind: "again", changed: true, detail: stale.message });
  });

  it("builds again a funding turned away once recorded, or a stale review nothing recorded", async () => {
    book.sessions = [{ index: 3, stage: "failed", unsent: true, unsentWhy: "busy", txs: funding }];
    expect(await refusalOf(stale, 3, FUNDING)).toEqual({ kind: "again", changed: false, detail: stale.message });
    book.sessions = [];
    expect(await refusalOf(stale, 3)).toEqual({ kind: "again", changed: true, detail: stale.message });
    // Nothing recorded, and not stale: Send can go again.
    expect(await refusalOf(plain, 3)).toBeUndefined();
    // The record out of reach: a stale review is built again, as before.
    book.fails = true;
    expect(await refusalOf(stale, 3)).toEqual({ kind: "again", changed: true, detail: stale.message });
    book.fails = false;
  });

  it("names giveme.my when it refused, from the refusal or the record, but still watches one that may have gone (blind test §9.5)", async () => {
    const giveme = new RpcError("giveme.my, which lends the collateral, refused this transaction (400).", "stale", "giveme");
    const busy = new RpcError("giveme.my, which lends the collateral, couldn't take this transaction just now (503).", "stale", "givemeBusy");
    book.sessions = [];
    expect(await refusalOf(giveme, 3)).toEqual({ kind: "again", changed: false, by: "giveme", detail: giveme.message });
    expect(await refusalOf(busy, 3)).toEqual({ kind: "again", changed: false, by: "givemeBusy", detail: busy.message });
    // Recorded as giveme.my's refusal: named, as busy when the refusal says so.
    book.sessions = [{ index: 3, stage: "failed", unsent: true, unsentWhy: "refused", txs: funding }];
    expect(await refusalOf(plain, 3, FUNDING)).toEqual({ kind: "again", changed: false, by: "giveme", detail: plain.message });
    expect(await refusalOf(busy, 3, FUNDING)).toMatchObject({ kind: "again", by: "givemeBusy" });
    // Recorded as giveme.my's outage: said as one, whatever the refusal in hand says.
    book.sessions = [{ index: 3, stage: "failed", unsent: true, unsentWhy: "givemeBusy", txs: funding }];
    expect(await refusalOf(plain, 3, FUNDING)).toMatchObject({ kind: "again", by: "givemeBusy" });
    expect(unsentWhyText("givemeBusy")).toBe("giveme.my, the service that lends its collateral, couldn't take it just then.");
    // A recorded funding that may have gone out is watched, whoever the refusal names: built again, it would pay twice.
    book.sessions = [{ index: 3, stage: "funding", txs: funding }];
    expect(await refusalOf(giveme, 3, FUNDING)).toEqual({ kind: "watch", detail: giveme.message });
  });
});
