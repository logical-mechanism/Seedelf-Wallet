// A chain is sent only while the wallet is unlocked: a lock while one of
// its transactions waits to be tried again stops it there, before that try,
// and so does a lock and an unlock while it waits, which wiped its progress.
// Nothing of it is written back (independent review L14).
import { describe, expect, it } from "vitest";

import { CHAIN_CUT, SESSION_LOVEJOIN_SENDING } from "../src/background/lovejoin";
import { SESSION_CHAIN_PREFIX } from "../src/background/sessions";
import { CHAINS, lovejoinOf, PASSWORD, publicFunded, sessionsOf, withSession, type Tested } from "./chain-fixtures";

/** Koios answers the `nth` submit with a 503, and counts the submits made while the wallet is locked. */
function busyOnce(t: Tested, nth: number) {
  const fetch = t.koios.fetch;
  const seen = { submits: 0, whileLocked: 0 };
  t.koios.fetch = async (url, init) => {
    if (url.endsWith("/submittx")) {
      seen.submits++;
      if ((await t.wallet.state()) !== "unlocked") seen.whileLocked++;
      if (seen.submits === nth) return new Response("", { status: 503 });
    }
    return fetch(url, init);
  };
  return seen;
}

describe("a mix from the public account and a lock (independent review L14)", CHAINS, () => {
  it("never tries a transaction again once the wallet locked while it waited", async () => {
    const t = await publicFunded();
    const lovejoin = lovejoinOf(t, { sleep: () => t.wallet.lock() });
    const summary = await lovejoin.publicBuild("preprod", 1);
    const seen = busyOnce(t, 1);
    // The deposit's submit gets a 503; the wallet locks while the send waits to try it again.
    await expect(lovejoin.publicSubmit("preprod", summary.txHash)).rejects.toThrow("locked");
    expect(seen).toEqual({ submits: 1, whileLocked: 0 });
    // Unlocked again, its record says a lock cut it, and that its deposit, sent unanswered, may have gone through
    // (independent review L5).
    await t.wallet.unlock(PASSWORD);
    expect(await lovejoin.progress("preprod")).toEqual({ total: 5, sent: 0, stopped: CHAIN_CUT(), maybeSent: true });
  });

  it("never tries it again, nor writes its progress back, after a lock and an unlock while it waited", async () => {
    const t = await publicFunded();
    const lovejoin = lovejoinOf(t, {
      sleep: async () => {
        await t.wallet.lock();
        await t.wallet.unlock(PASSWORD);
      },
    });
    const summary = await lovejoin.publicBuild("preprod", 1);
    const seen = busyOnce(t, 2);
    await expect(lovejoin.publicSubmit("preprod", summary.txHash)).rejects.toThrow(CHAIN_CUT());
    // The deposit went; its first mix got a 503, and wasn't tried again after the lock.
    expect(seen.submits).toBe(2);
    expect(await t.wallet.withKeys(() => t.session.get(SESSION_LOVEJOIN_SENDING + "preprod"))).toBeUndefined();
    expect(await lovejoin.pumpPublic("preprod")).toBe(false);
    expect(seen.submits).toBe(2);
    expect(await lovejoin.progress("preprod")).toEqual({ total: 5, sent: 1, stopped: CHAIN_CUT() });
  });
});

describe("a session's chain and a lock (independent review L14)", CHAINS, () => {
  it("never tries a transaction again, nor writes its progress back, after a lock and an unlock while it waited", async () => {
    const { t } = await withSession("40000000");
    const sessions = sessionsOf(t, async () => {
      await t.wallet.lock();
      await t.wallet.unlock(PASSWORD);
    });
    const review = await sessions.backBuild("preprod", 0);
    const seen = busyOnce(t, 3);
    await expect(sessions.backSubmit("preprod", review.txHash)).rejects.toThrow(CHAIN_CUT());
    // The deposit and a mix went; the next got a 503, and wasn't tried again after the lock.
    expect(seen.submits).toBe(3);
    expect(await t.wallet.withKeys(() => t.session.get(`${SESSION_CHAIN_PREFIX}preprod.0`))).toBeUndefined();
    await sessions.runAll("preprod");
    expect(seen.submits).toBe(3);
    expect((await sessions.list("preprod"))[0]!.chain).toMatchObject({ total: 10, stopped: CHAIN_CUT() });
    expect((await t.lovejoin.status("preprod")).chains).toEqual([
      { session: 0, boxes: 2, total: 10, sent: 2, at: expect.any(Number), stopped: CHAIN_CUT() },
    ]);
  });
});
