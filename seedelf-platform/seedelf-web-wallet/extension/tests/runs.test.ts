// The worker's own runs (background/runs.ts): every network the build has,
// not only the one the wallet shows, so a switch in Settings leaves nothing
// waiting on the other.
import { describe, expect, it, vi } from "vitest";

import { runNetworks, type Runner } from "../src/background/runs";
import type { NetworkName } from "../src/networks";

/** The sessions alarm, as chrome.alarms would be, counting its starts as sw.ts does. */
function sessionsAlarm() {
  let starts = 0;
  const alarm = {
    on: false,
    start: vi.fn(async () => {
      starts++;
      alarm.on = true;
    }),
    stop: vi.fn(async () => {
      alarm.on = false;
    }),
    starts: () => starts,
  };
  return alarm;
}

/** A run's services, each saying what it has on which network. */
function runner(work: Partial<Record<NetworkName, { swaps?: boolean; mixing?: boolean; boxes?: number; maybeSent?: boolean; fails?: boolean }>>) {
  const of = (n: NetworkName) => work[n] ?? {};
  const alarm = sessionsAlarm();
  const ctx = {
    networks: ["mainnet", "preprod"],
    wallet: { state: async () => "unlocked", unlockedAt: async () => 1_800_000_000_000 },
    sessions: {
      runAll: vi.fn(async (n: NetworkName) => {
        if (of(n).fails) throw new Error("Koios didn't answer.");
        // As the real one does: it says whether its own network has something running, and leaves the alarm alone.
        return !!of(n).swaps;
      }),
    },
    lovejoin: {
      pumpPublic: vi.fn(async (n: NetworkName) => !!of(n).mixing),
      withdrawDue: vi.fn(async () => []),
      returning: vi.fn(async (n: NetworkName) => (of(n).boxes ?? 0) > 0),
    },
    pending: { watch: vi.fn(async (n: NetworkName) => !!of(n).maybeSent) },
  } as unknown as Runner;
  return { ctx, alarm };
}

describe("the worker's runs", () => {
  it("run every network, so a swap on preprod goes on while mainnet is shown, and keep the alarm for it", async () => {
    const { ctx, alarm } = runner({ preprod: { swaps: true } });
    await runNetworks(ctx, alarm, true);
    expect(vi.mocked(ctx.sessions.runAll).mock.calls).toEqual([
      ["mainnet", true],
      ["preprod", true],
    ]);
    expect(vi.mocked(ctx.lovejoin.withdrawDue).mock.calls).toEqual([
      ["mainnet", true, expect.any(Number)],
      ["preprod", true, expect.any(Number)],
    ]);
    expect(alarm.start).toHaveBeenCalled();
  });

  it("bring Lovejoin's boxes back last, after every network's other work, saying when the run began (privacy review §3.1)", async () => {
    const { ctx, alarm } = runner({ mainnet: { swaps: true, maybeSent: true }, preprod: { boxes: 1 } });
    const order: string[] = [];
    const log = (what: string) => async (n: NetworkName) => {
      order.push(`${what} ${n}`);
      return what === "withdraw" ? [] : false;
    };
    vi.mocked(ctx.sessions.runAll).mockImplementation(log("step") as never);
    vi.mocked(ctx.lovejoin.pumpPublic).mockImplementation(log("pump") as never);
    vi.mocked(ctx.pending.watch).mockImplementation(log("watch") as never);
    vi.mocked(ctx.lovejoin.withdrawDue).mockImplementation(log("withdraw") as never);
    const before = Date.now();
    await runNetworks(ctx, alarm);
    expect(order).toEqual([
      "step mainnet",
      "pump mainnet",
      "watch mainnet",
      "step preprod",
      "pump preprod",
      "watch preprod",
      "withdraw mainnet",
      "withdraw preprod",
    ]);
    // Not the unlock's run, and it began before any of it: a withdraw never goes in a run that sent something else.
    for (const [, unlock, since] of vi.mocked(ctx.lovejoin.withdrawDue).mock.calls) {
      expect(unlock).toBe(false);
      expect(since).toBeGreaterThanOrEqual(before);
      expect(since).toBeLessThanOrEqual(Date.now());
    }
    expect(vi.mocked(ctx.sessions.runAll).mock.calls.map((c) => c[1])).toEqual([false, false]);
  });

  it("never let the last network's quiet stop the alarm another's work needs", async () => {
    for (const work of [{ swaps: true }, { mixing: true }, { boxes: 2 }, { maybeSent: true }]) {
      const { ctx, alarm } = runner({ mainnet: work });
      await alarm.start();
      await runNetworks(ctx, alarm);
      expect(alarm.stop).not.toHaveBeenCalled();
      expect(alarm.on).toBe(true);
    }
  });

  it("go on with the other network when one fails, and stop the alarm with nothing to do on any", async () => {
    const { ctx, alarm } = runner({ mainnet: { fails: true }, preprod: { maybeSent: true } });
    await runNetworks(ctx, alarm);
    expect(ctx.pending.watch).toHaveBeenCalledWith("preprod");
    expect(alarm.on).toBe(true);

    const quiet = runner({});
    await quiet.alarm.start();
    await runNetworks(quiet.ctx, quiet.alarm);
    expect(quiet.alarm.on).toBe(false);
  });

  it("keep the alarm a swap started while mainnet's run read Koios, with nothing running when each network was read", async () => {
    const { ctx, alarm } = runner({});
    // The unlock's run reads Lovejoin's pool on mainnet; the user sends a swap's funding meanwhile, which starts the alarm.
    vi.mocked(ctx.lovejoin.withdrawDue).mockImplementation(async (network: NetworkName) => {
      if (network === "mainnet") await alarm.start();
      return [];
    });
    await runNetworks(ctx, alarm, true);
    expect(alarm.stop).not.toHaveBeenCalled();
    expect(alarm.on).toBe(true);

    // The next run finds nothing started meanwhile, and stops it if nothing runs by then.
    vi.mocked(ctx.lovejoin.withdrawDue).mockImplementation(async () => []);
    await runNetworks(ctx, alarm);
    expect(alarm.on).toBe(false);
  });

  it("stop the alarm while locked, asking nothing", async () => {
    const { ctx, alarm } = runner({ preprod: { swaps: true } });
    (ctx.wallet as unknown as { state: () => Promise<string> }).state = async () => "locked";
    await runNetworks(ctx, alarm);
    expect(alarm.stop).toHaveBeenCalled();
    expect(ctx.sessions.runAll).not.toHaveBeenCalled();
  });
});
