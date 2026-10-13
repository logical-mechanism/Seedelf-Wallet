// A mix from the Lovejoin tile, which runs itself, whose return chain stopped
// before any of it went: a lock or a closed browser between the chain's record
// and its first send, which the runs now mark stopped (cross-area review X03),
// or Koios turning its deposit away. Nothing of it went in, so the runner
// builds it again, through Lovejoin (buildBack): its row on the Lovejoin page
// says it goes on, never that the rest comes back directly, which only a chain
// that went in partly does (the last review, L5). The real WebAssembly,
// Lovejoin's recorded preprod pool, and fakes of Koios.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { CHAIN_CUT } from "../src/background/lovejoin";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import type { SessionView } from "../src/shared/rpc";
import { detailOf, subOf } from "../src/ui/screens/Lovejoin";
import { account, AGREES, atSession, HOUR, PASSWORD, POOL } from "./chain-fixtures";
import { testBalances } from "./fakes";

const MINUTE = 60_000;
const FUNDING = "ab".repeat(32);
/** Building a chain runs the scripts of every mix in it, each time the runner builds it. */
const CHAINS = { timeout: 120_000 };

/**
 * A mix as mixOutSubmit records it, its funding on chain an hour ago: 15.3 ₳ and its 5 ₳ collateral at its account,
 * and Lovejoin's pool listed. `lockOnce`: the wallet locks as the runs' alarm starts, after the chain's record and
 * before its first send.
 */
async function funded(lockOnce = false) {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  t.koios.evaluation = AGREES;
  const created = t.clock.now - HOUR;
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: created,
        txs: [{ kind: "out", txHash: FUNDING, at: created, confirmed: true }],
        mix: { boxes: 1 },
        auto: { approved: { minAmountOut: "0", fund: { lovelace: "15300000", tokens: [] } } },
      },
    ],
  });
  t.koios.addedToAccounts.push(atSession(FUNDING, 0, "15300000"), atSession(FUNDING, 1, "5000000"), ...POOL);
  let armed = lockOnce;
  const sessions = new SessionService({
    ...t.deps,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
    lovejoin: t.lovejoin,
    sleep: async () => undefined,
    random: () => 0.5,
    alarm: {
      start: async () => {
        if (!armed) return;
        armed = false;
        await t.wallet.lock();
      },
    },
  });
  return { t, sessions };
}

/**
 * Runs every 30 seconds, the user busy, as the alarm runs them, until one sends something: the mix's row after each
 * run, and what the record holds then.
 */
async function untilSent(t: Awaited<ReturnType<typeof funded>>["t"], sessions: SessionService) {
  const rows: string[] = [];
  for (let i = 0; i < 60; i++) {
    t.clock.now += 30_000;
    await t.wallet.touch();
    const before = t.koios.submitted.length;
    await sessions.runAll("preprod");
    rows.push(subOf((await sessions.list("preprod"))[0]!, t.clock.now));
    if (t.koios.submitted.length > before) break;
  }
  type Mix = { txs: Array<{ kind: string }>; mix: { skipped?: string } };
  const record = (await t.store.get<{ sessions: Mix[] }>("sessions.preprod"))!.sessions[0]!;
  return { rows, kinds: record.txs.map((x) => x.kind), skipped: record.mix.skipped };
}

describe("a mix's return chain stopped before any of it went (the last review, L5)", () => {
  it("says it goes on after a lock cut it off, and then sends it through Lovejoin", CHAINS, async () => {
    const { t, sessions } = await funded(true);
    await expect(sessions.advance("preprod", 0, true)).rejects.toThrow();
    expect(t.koios.submitted).toEqual([]);
    // Unlocked minutes later: the unlock's run finds the chain stopped, and the mix's next step waits a fresh draw.
    t.clock.now += 10 * MINUTE;
    await t.wallet.unlock(PASSWORD);
    t.clock.now += 16_000;
    await sessions.runAll("preprod", true);
    const [view] = await sessions.list("preprod");
    expect(view!.chain).toMatchObject({ sent: 0, cut: false, stopped: CHAIN_CUT() });
    expect(subOf(view!, t.clock.now)).toBe("Funded: it goes on within 20 minutes of the unlock");
    // Why its chain stopped is still said under it.
    expect(detailOf(view!)).toContain("Why it stopped: The wallet locked, or the browser closed");
    // Never "the rest comes back directly" meanwhile: the runner sends its chain again, through Lovejoin.
    const { rows, kinds, skipped } = await untilSent(t, sessions);
    expect(rows.filter((r) => r.includes("comes back directly"))).toEqual([]);
    expect(kinds).toEqual(["out", "deposit", "mix", "mix", "mix"]);
    expect(skipped).toBeUndefined();
    expect(rows.at(-1)).toMatch(/^Sending \d of 6 transactions$/);
  });

  it("says it tries again by itself when Koios turned its deposit away, and then sends it through Lovejoin", CHAINS, async () => {
    const { t, sessions } = await funded();
    t.koios.rejectSubmit = "ConwayUtxowFailure (UtxoFailure (ValueNotConservedUTxO))";
    await sessions.advance("preprod", 0, true).catch(() => undefined);
    const [view] = await sessions.list("preprod");
    expect(view!.chain).toMatchObject({ sent: 0, cut: false });
    expect(view!.chain!.stopped).toBeDefined();
    expect(view!.auto!.retry).toBeDefined();
    expect(subOf(view!, t.clock.now)).toBe("Something went wrong: it tries again by itself");
    delete t.koios.rejectSubmit;
    const { rows, kinds, skipped } = await untilSent(t, sessions);
    expect(rows.filter((r) => r.includes("comes back directly"))).toEqual([]);
    expect(kinds).toEqual(["out", "deposit", "mix", "mix", "mix"]);
    expect(skipped).toBeUndefined();
  });

  it("still says the rest comes back directly once some of it went, and stays at the account for a session brought back by hand", () => {
    const mix = (chain: SessionView["chain"], auto = true): SessionView => ({
      index: 0,
      network: "preprod",
      address: "addr_test1" + "m".repeat(50),
      createdAt: 0,
      stage: "open",
      txs: [{ kind: "out", txHash: FUNDING, at: 0, confirmed: true }],
      holding: { lovelace: "5000000", tokens: [], utxos: 1 },
      mix: { boxes: 1 },
      ...(auto ? { auto: { step: "returning", stopping: false, filled: false, approvedMinOut: "0" } } : {}),
      chain,
    });
    const stopped = { total: 6, sent: 0, confirmed: 0, cut: false, stopped: CHAIN_CUT() };
    expect(subOf(mix({ ...stopped, sent: 4 }), 0)).toBe("Stopped after 4 of 6 transactions; the rest comes back directly");
    expect(subOf(mix({ ...stopped, cut: true }), 0)).toBe("Stopped after 0 of 6 transactions; what was left came back directly");
    // Stopping, it all comes back directly: so says its row.
    const auto = { step: "returning" as const, stopping: true, filled: false, approvedMinOut: "0" };
    expect(subOf({ ...mix(stopped), auto }, 0)).toBe("Stopping: it all comes back directly");
    // Nothing brings a session back by itself unless it runs itself: what's left waits for Bring it back.
    expect(subOf(mix(stopped, false), 0)).toBe(
      "Stopped after 0 of 6 transactions; the rest stays at the account until you bring it back",
    );
  });
});
