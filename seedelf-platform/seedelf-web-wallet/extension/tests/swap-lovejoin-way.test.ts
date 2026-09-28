// How an approved swap comes back through Lovejoin (independent review L21):
// as deep and as long as its approval showed, whatever Settings says since,
// and Settings' off changes only swaps started later.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { KoiosUtxo } from "../src/background/koios";
import { ASK, atSession, signing, unlocked } from "./swap-session";

const HOUR = 3_600_000;

/** 20 boxes from Lovejoin's preprod pool, as Koios lists them (2026-09-25). */
const POOL = (
  JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }
).pool;

/** Ogmios's answer when the network measures no more than a transaction declares. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

/** Building and measuring a chain in WebAssembly takes seconds, more on CI's runners (lovejoin.test.ts). */
const CHAINS = { timeout: 30_000 };

describe("an approved swap's way back through Lovejoin (independent review L21)", CHAINS, () => {
  it("keeps the depth and the wait it was approved with, and Lovejoin, whatever Settings says since", async () => {
    const t = await unlocked();
    t.koios.evaluation = AGREES;
    const now = t.clock.now;
    const out = "ab".repeat(32);
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: now,
          txs: [{ kind: "out", txHash: out, at: now, confirmed: true }],
          swap: { ...ASK, amountOut: "906594100", minAmountOut: "902083681" },
          auto: {
            approved: { minAmountOut: "902083681", fund: { lovelace: "16000000", tokens: [] } },
            direct: false,
            lovejoin: { depth: 1, delay: "6-24" },
          },
        },
      ],
    });
    t.koios.addedToAccounts.push(atSession("c1".repeat(32), 0, "40000000"), atSession(out, 1, "5000000"), ...POOL);
    const sessions = signing(t, { lovejoin: t.lovejoin, sleep: async () => undefined });
    // Since, Settings says three waves deep, 1 to 6 hours, and Lovejoin off.
    await t.deps.preferences.set({ lovejoinDepth: 3, lovejoinDelay: "1-6", lovejoinReturns: false });

    // Stop's dialog prices it as approved.
    expect(await sessions.stopCost("preprod", 0)).toMatchObject({ depth: 1, delay: "6-24", on: true });
    // And its return goes through Lovejoin as approved.
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toMatchObject({ depth: 1, delay: "6-24" });
  });

  it("records the approval's depth and wait with the swap when it comes back through Lovejoin, and none when it comes back directly", async () => {
    for (const direct of [false, true]) {
      const t = await unlocked();
      const sessions = signing(t, { lovejoin: t.lovejoin, sleep: async () => undefined });
      await t.deps.preferences.set({ lovejoinDepth: 1, lovejoinDelay: "2-12" });
      const out = await sessions.outBuild("preprod", await sessions.quote("preprod", ASK));
      expect(out.lovejoin).toMatchObject({ depth: 1, delay: "2-12" });
      // Changed between the review and Send: what the review showed stands.
      await t.deps.preferences.set({ lovejoinDepth: 3, lovejoinDelay: "6-24" });
      await sessions.outSubmit("preprod", out.txHash, direct);
      const book = (await t.store.get<{ sessions: Array<{ auto: Record<string, unknown> }> }>("sessions.preprod"))!;
      const auto = book.sessions[0]!.auto;
      expect(auto.direct).toBe(direct);
      if (direct) expect(auto.lovejoin).toBeUndefined();
      else expect(auto.lovejoin).toEqual({ depth: 1, delay: "2-12" });
    }
  });

  it("gives a chain's boxes the wait its return said, not Settings' when its deposit goes", async () => {
    const t = await unlocked();
    await t.deps.preferences.set({ lovejoinDelay: "1-6" });
    const txs = (["deposit", "mix"] as const).map((kind, i) => ({ kind, txCbor: "", txHash: "a1".repeat(31) + `0${i}`, fee: "0" }));
    const at = t.clock.now;
    await t.lovejoin.recordChain("preprod", { progress: "seedelf.session.chain.preprod.0", txs, leaves: [], boxes: 3, delay: "6-24" });
    await t.lovejoin.chainSent("preprod", txs.at(-1)!.txHash, 0);
    const { due } = (await t.store.get<{ due: number[] }>("lovejoin.preprod"))!;
    expect(due).toHaveLength(3);
    for (const d of due) {
      expect(d - at).toBeGreaterThanOrEqual(6 * HOUR);
      expect(d - at).toBeLessThanOrEqual(24 * HOUR);
    }
  });
});
