// A session's reservation left as being sent, with no chain of it on its way
// (a worker that stopped between its reservation and its progress, or a
// release after a stop that failed), never sends the session's next return
// directly, unmixed: the return through Lovejoin takes its place, as it did
// before a mix from the public account's reservation was kept apart
// (independent review L30).
import { describe, expect, it } from "vitest";

import { SESSION_RESERVED_PREFIX } from "../src/background/spent";
import { CHAINS, withSession } from "./chain-fixtures";

type Reserved = Record<string, { inputs: string[]; collateral: string[]; until?: number }>;

describe("a session's reservation left as being sent (independent review L30)", CHAINS, () => {
  it("is taken over by its next return through Lovejoin, never sent directly for it", async () => {
    const { t, sessions } = await withSession("40000000");
    const stale = { inputs: [`${"c1".repeat(32)}#0`], collateral: [`${"c2".repeat(32)}#1`] };
    await t.wallet.withKeys(() => t.session.set(SESSION_RESERVED_PREFIX + "preprod", { "session.0": stale }));

    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toBeDefined();
    expect(review.lovejoinSkipped).toBeUndefined();
    const reserved = await t.wallet.withKeys(() => t.session.get<Reserved>(SESSION_RESERVED_PREFIX + "preprod"));
    expect(reserved?.["session.0"]?.until).toBeDefined();

    // And it's sent as reviewed, through Lovejoin.
    const submits = t.koios.submitted.length;
    await sessions.backSubmit("preprod", review.txHash);
    expect(t.koios.submitted.length - submits).toBeGreaterThan(1);
    expect((await sessions.list("preprod"))[0]!.chain).toMatchObject({ total: review.lovejoin!.txs });
  });

  it("still keeps a mix from the public account kept for Send from taking the place of one being sent", async () => {
    const { t } = await withSession("40000000");
    const sending = { inputs: [`${"e6".repeat(32)}#0`], collateral: [] };
    await t.wallet.withKeys(() => t.session.set(SESSION_RESERVED_PREFIX + "preprod", { public: sending }));
    await expect(t.lovejoin.reserve("preprod", "public", [], t.clock.now + 60_000)).rejects.toThrow("still being sent");
    await t.lovejoin.reserve("preprod", "session.0", [], t.clock.now + 60_000);
    const reserved = await t.wallet.withKeys(() => t.session.get<Reserved>(SESSION_RESERVED_PREFIX + "preprod"));
    expect(reserved?.public).toEqual(sending);
  });
});
