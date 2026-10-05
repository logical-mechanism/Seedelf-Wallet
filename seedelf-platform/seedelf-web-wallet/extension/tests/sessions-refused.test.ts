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

const { refusalOf } = await import("../src/ui/components/SessionRefused");
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
});
