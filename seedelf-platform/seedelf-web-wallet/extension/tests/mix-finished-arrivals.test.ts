// Chunk 51, e2b#1: a mix from the Lovejoin tile whose own return went (its chain's deposit, mix and return on chain),
// paid by a stranger before the runner closes it: the account's address is public from the funding, and a session
// closes only once nothing at it can come back (act). What reaches it then is the stranger's, not the mix's. It comes
// back directly, never in another chain over the mix's own settings (independent review L17, c421bd29: "a mix never
// starts a second chain"; on Mix my boxes again that chain took the user's own boxes), its 5 ₳ is no collateral of the
// session's to mix, and the mix still reads as mixed: `mix.skipped`, which the Lovejoin hub shows as "Not mixed", says
// why the mix's own boxes never went in, never why a stranger's later 2 ₳ didn't. The finished twin of
// return-chain-scope.test.ts's "a mix whose chain stopped partway". The verifier's three cases (verify/e2b-1.md), and
// their siblings: Stop pressed on such a mix, a mix whose own return came back directly with Lovejoin left out, and
// Settings' collateral mix on. The real WebAssembly, Lovejoin v2's 5 ₳ pool (v2-pools.ts), and fakes of Koios.
import { describe, expect, it } from "vitest";

import type { KoiosUtxo } from "../src/background/koios";
import { t as tr } from "../src/i18n";
import { detailOf, subOf } from "../src/ui/screens/Lovejoin";
import { account, AGREES, atSession, PASSWORD, sessionsOf } from "./chain-fixtures";
import { testBalances } from "./fakes";
import { ADA, ADA_POOL, ADA_ROWS } from "./v2-pools";

/** Building a chain runs the scripts of every mix in it. */
const CHAINS = { timeout: 120_000 };
const FUNDING = "ab".repeat(32);
/** The mix's return, its chain's last. */
const LAST = "ae".repeat(32);

type Book = {
  sessions: Array<{ chain?: { last: string }; txs: Array<{ kind: string }>; mix: { skipped?: string }; lovejoinSkipped?: string }>;
};

/**
 * Mix session 0 into the 5 ₳ pool whose own return went, as pump leaves it: through its chain (its funding, deposit,
 * mix and return, all on chain), or (`direct`) straight back with Lovejoin left out for `direct`'s reason. `paid`: what
 * a stranger paid its account since. `collateral`: Settings' collateral mix, off unless asked, as the stopped twin has
 * it, so the return asked about is the one that brings back what's at the account.
 */
async function finished(paid: KoiosUtxo[], { direct, collateral = false }: { direct?: string; collateral?: boolean } = {}) {
  const t = testBalances({ pools: [ADA_POOL] });
  await t.wallet.create(account(12).phrase, PASSWORD);
  t.koios.evaluation = AGREES;
  const at = t.clock.now;
  const done = (kind: string, txHash: string) => ({ kind, txHash, at, confirmed: true });
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: at,
        txs: direct
          ? [done("out", FUNDING), done("back", LAST)]
          : [done("out", FUNDING), done("deposit", "ac".repeat(32)), done("mix", "ad".repeat(32)), done("back", LAST)],
        mix: { boxes: 1, pool: ADA, ...(direct ? { skipped: direct } : {}) },
        auto: { approved: { minAmountOut: "0", fund: { lovelace: "15000000", tokens: [] } } },
        ...(direct ? {} : { chain: { total: 3, last: LAST, at } }),
      },
    ],
  });
  t.koios.addedToAccounts.push(...paid, ...ADA_ROWS);
  await t.deps.preferences.set({ lovejoinDepth: 1, lovejoinCollateral: collateral });
  return { t, sessions: sessionsOf(t) };
}

const book = async (t: ReturnType<typeof testBalances>) => (await t.store.get<Book>("sessions.preprod"))!.sessions[0]!;

describe("a mix whose own return went, paid by a stranger before it closes (chunk 51, e2b#1)", () => {
  it("brings what reaches its account after back directly, never in another chain", CHAINS, async () => {
    // 40 ₳, and 5 ₳ of ADA alone a chain can put up as its collateral.
    const { t, sessions } = await finished([atSession("c1".repeat(32), 0, "40000000"), atSession("c2".repeat(32), 1, "5000000")]);
    await sessions.advance("preprod", 0, true);
    const s = await book(t);
    expect(s.txs.map((x) => x.kind)).toEqual(["out", "deposit", "mix", "back", "back"]);
    expect(s.chain!.last).toBe(LAST);
    expect(t.koios.submitted).toHaveLength(1);
  });

  it("still reads as mixed once a stranger's 2 ₳ came back and it closed", CHAINS, async () => {
    const stranger = atSession("c3".repeat(32), 0, "2000000");
    const { t, sessions } = await finished([stranger]);
    // The runner brings the 2 ₳ back, directly: no 5 ₳ at the account for a chain's collateral.
    await sessions.advance("preprod", 0, true);
    expect(t.koios.submitted).toHaveLength(1);
    // It lands, spending the 2 ₳, and the next step closes the session.
    t.koios.addedToAccounts.splice(t.koios.addedToAccounts.indexOf(stranger), 1);
    t.koios.confirmations = 1;
    t.clock.now += 60_000;
    await sessions.advance("preprod", 0, true);
    const [view] = await sessions.list("preprod");
    expect(view!.stage).toBe("closed");
    // Its boxes went in and were mixed: Done on the hub, never "Not mixed" (Lovejoin.tsx tagOf reads `mix.skipped`),
    // and its row says so, with no reason it was left out.
    expect({ skipped: view!.mix?.skipped, sub: subOf(view!, t.clock.now), detail: detailOf(view!) }).toEqual({
      skipped: undefined,
      sub: expect.stringMatching(/^In Lovejoin since /),
      detail: undefined,
    });
  });

  it("still reads as mixed when a stranger's 1 ₳ that can't come back is left at its account", CHAINS, async () => {
    const { t, sessions } = await finished([atSession("c4".repeat(32), 0, "1000000")]);
    // Too little to pay its own way back: nothing is sent, it's left behind, and the next step closes the session.
    await sessions.advance("preprod", 0, true);
    expect(t.koios.submitted).toHaveLength(0);
    t.clock.now += 60_000;
    await sessions.advance("preprod", 0, true);
    const [view] = await sessions.list("preprod");
    expect(view!.stage).toBe("closed");
    expect({ skipped: view!.mix?.skipped, sub: subOf(view!, t.clock.now) }).toEqual({
      skipped: undefined,
      sub: expect.stringMatching(/^In Lovejoin since /),
    });
  });

  it("still reads as mixed when Stop is pressed on it, and brings the stranger's back directly", CHAINS, async () => {
    // Stop is offered while it runs: a stranger's UTxO holds it open, so the user may press it. Stopped, a return comes
    // back directly, and a mix stopped before its boxes went in says so; this one's went in.
    const { t, sessions } = await finished([atSession("c5".repeat(32), 0, "40000000")]);
    await sessions.stop("preprod", 0);
    expect(t.koios.submitted).toHaveLength(1);
    const s = await book(t);
    expect(s.txs.map((x) => x.kind)).toEqual(["out", "deposit", "mix", "back", "back"]);
    expect(s.mix.skipped).toBeUndefined();
  });

  it("puts a stranger's 5 ₳ in no 5 ₳ pool as its collateral, Settings' collateral mix on: it all comes back directly", CHAINS, async () => {
    // The session's own 5 ₳ went with its chain. A return's collateral mix is the session's own collateral's, never a
    // stranger's 5 ₳ paid after: no deposit and no mix go, the one return alone.
    const { t, sessions } = await finished([atSession("c6".repeat(32), 0, "40000000"), atSession("c7".repeat(32), 1, "5000000")], {
      collateral: true,
    });
    await sessions.advance("preprod", 0, true);
    const s = await book(t);
    expect(s.txs.map((x) => x.kind)).toEqual(["out", "deposit", "mix", "back", "back"]);
    expect(s.chain!.last).toBe(LAST);
    expect(t.koios.submitted).toHaveLength(1);
  });

  it("whose own return came back directly, Lovejoin left out, brings a stranger's back directly too, its reason kept", CHAINS, async () => {
    // Its pool was under the floor, say: its funding came back directly, and the hub says why. What a stranger pays its
    // account after is no mix the user asked for: no chain goes, and the reason stays the mix's own.
    const why = tr("sess.skip.warn.noAdaPool");
    const { t, sessions } = await finished([atSession("c8".repeat(32), 0, "40000000"), atSession("c9".repeat(32), 1, "5000000")], {
      direct: why,
    });
    await sessions.advance("preprod", 0, true);
    const s = await book(t);
    expect(s.txs.map((x) => x.kind)).toEqual(["out", "back", "back"]);
    expect(s.chain).toBeUndefined();
    expect(s.mix.skipped).toBe(why);
    expect(t.koios.submitted).toHaveLength(1);
  });
});
