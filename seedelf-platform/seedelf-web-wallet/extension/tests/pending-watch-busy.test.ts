// The worker's runs keep a maybe-sent payment going on a network the wallet
// doesn't show. A Koios error while it's looked for says nothing of whether
// it's settled: it's still maybe sent, so the run counts the network as busy
// and keeps the alarm (independent review L3).
import { describe, expect, it } from "vitest";

import { runNetworks, type Runner } from "../src/background/runs";
import { testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const THEIRS = account(15).preprod.receive_0 as string;

function sessionsAlarm() {
  let starts = 0;
  const alarm = {
    on: false,
    stops: 0,
    start: async () => {
      starts++;
      alarm.on = true;
    },
    stop: async () => {
      alarm.stops++;
      alarm.on = false;
    },
    starts: () => starts,
  };
  return alarm;
}

describe("a maybe-sent payment's watch, when Koios fails", () => {
  it("still says maybe sent, and the run keeps the alarm for it", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      const answer = await real(url, init);
      if (url.endsWith("/submittx")) throw new DOMException("signal timed out", "TimeoutError");
      return answer;
    };
    expect(await t.send.submit("preprod", summary.txHash)).toMatchObject({ maybeSent: true });

    // tx_status fails, retries and all.
    t.koios.fetch = async (url, init) => (url.endsWith("/tx_status") ? new Response("", { status: 502 }) : real(url, init));
    expect(await t.pending.watch("preprod")).toBe(true);

    const alarm = sessionsAlarm();
    await alarm.start();
    const ctx = {
      networks: ["mainnet", "preprod"],
      wallet: t.wallet,
      sessions: { runAll: async () => false },
      lovejoin: { pumpPublic: async () => false, withdrawDue: async () => [], returning: async () => false },
      pending: t.pending,
    } as unknown as Runner;
    await runNetworks(ctx, alarm);
    expect(alarm.on).toBe(true);
    expect(alarm.stops).toBe(0);

    // Settled, it stops keeping it.
    t.koios.fetch = real;
    t.koios.confirmations = 1;
    await runNetworks(ctx, alarm);
    await runNetworks(ctx, alarm);
    expect(alarm.on).toBe(false);
  });

  it("says nothing is watched on a network with none, whatever Koios does", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    t.koios.fetch = async () => new Response("", { status: 502 });
    expect(await t.pending.watch("preprod")).toBe(false);
  });
});
