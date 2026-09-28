// A maybe-sent payment starts the worker's sessions alarm, so its runs keep
// it going (looked for, sent again now and then) on a network the wallet
// doesn't show, or with no page open, even after the unlock's run stopped
// the alarm with nothing else to do (independent review L4).
import { describe, expect, it } from "vitest";

import { PendingService } from "../src/background/pending";
import { runNetworks, type Runner } from "../src/background/runs";
import { txIdOf } from "./fixtures/cbor";
import { busyFor, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const THEIRS = account(15).preprod.receive_0 as string;

function sessionsAlarm() {
  let starts = 0;
  const alarm = {
    on: false,
    start: async () => {
      starts++;
      alarm.on = true;
    },
    stop: async () => {
      alarm.on = false;
    },
    starts: () => starts,
  };
  return alarm;
}

/** The wallet, with the worker's PendingService holding the alarm (sw.ts), and its runs over both networks. */
async function worker() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  const alarm = sessionsAlarm();
  const pending = new PendingService({ ...t.deps, alarm });
  const ctx = {
    networks: ["mainnet", "preprod"],
    wallet: t.wallet,
    sessions: { runAll: async () => false },
    lovejoin: { pumpPublic: async () => false, withdrawDue: async () => [], held: async () => ({ boxes: 0 }) },
    pending,
  } as unknown as Runner;
  return { t, alarm, pending, run: (unlock = false) => runNetworks(ctx, alarm, unlock) };
}

/** Koios passes the next submit on, and then doesn't answer. */
function unanswered(t: Awaited<ReturnType<typeof worker>>["t"]) {
  const real = t.koios.fetch;
  let left = 1;
  t.koios.fetch = async (url, init) => {
    const answer = await real(url, init);
    if (url.endsWith("/submittx") && left-- > 0) throw new DOMException("signal timed out", "TimeoutError");
    return answer;
  };
}

describe("a maybe-sent payment and the worker's alarm", () => {
  it("starts the alarm, which the unlock's run had stopped, and the runs send it again with no page asking", async () => {
    const { t, alarm, run } = await worker();
    await run(true);
    expect(alarm.on).toBe(false);

    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    unanswered(t);
    expect(await t.send.submit("preprod", summary.txHash)).toMatchObject({ maybeSent: true });
    expect(alarm.on).toBe(true);

    // The wallet shows mainnet, or no page is open: only the alarm's runs look at preprod.
    await run();
    expect(alarm.on).toBe(true);
    await busyFor(t, 2 * 60_000);
    await run();
    expect(t.koios.submitted.map((b) => txIdOf(b))).toEqual([summary.txHash, summary.txHash]);
    // Taken: nothing left to keep it for.
    await run();
    expect(alarm.on).toBe(false);
  });

  it("starts it when a payment sealed before a lock is put back", async () => {
    const { t, alarm, pending } = await worker();
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    unanswered(t);
    await t.send.submit("preprod", summary.txHash);
    await t.wallet.lock();
    await alarm.stop();
    await t.wallet.unlock(PASSWORD);
    expect(await pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, maybeSent: true });
    expect(alarm.on).toBe(true);
  });

  it("isn't started by a payment Koios took, beyond the one run that finds nothing to keep", async () => {
    const { t, alarm, run } = await worker();
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    expect(await t.send.submit("preprod", summary.txHash)).not.toHaveProperty("maybeSent");
    await run();
    expect(alarm.on).toBe(false);
  });
});
