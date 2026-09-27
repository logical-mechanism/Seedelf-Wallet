// The worker's own runs (background/runs.ts): every network the build has,
// not only the one the wallet shows, so a switch in Settings leaves nothing
// waiting on the other.
import { describe, expect, it, vi } from "vitest";

import { runNetworks, type Runner } from "../src/background/runs";
import type { NetworkName } from "../src/networks";

/** A run's services, each saying what it has on which network. */
function runner(work: Partial<Record<NetworkName, { swaps?: boolean; mixing?: boolean; boxes?: number; maybeSent?: boolean; fails?: boolean }>>) {
  const of = (n: NetworkName) => work[n] ?? {};
  const alarm = { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
  const ctx = {
    networks: ["mainnet", "preprod"],
    wallet: { state: async () => "unlocked" },
    sessions: {
      runAll: vi.fn(async (n: NetworkName) => {
        if (of(n).fails) throw new Error("Koios didn't answer.");
        // As the real one does: its own network's answer starts or stops the alarm.
        await (of(n).swaps ? alarm.start() : alarm.stop());
        return !!of(n).swaps;
      }),
    },
    lovejoin: {
      pumpPublic: vi.fn(async (n: NetworkName) => !!of(n).mixing),
      withdrawDue: vi.fn(async () => []),
      held: vi.fn(async (n: NetworkName) => ({ boxes: of(n).boxes ?? 0 })),
    },
    pending: { watch: vi.fn(async (n: NetworkName) => !!of(n).maybeSent) },
  } as unknown as Runner;
  return { ctx, alarm };
}

describe("the worker's runs", () => {
  it("run every network, so a swap on preprod goes on while mainnet is shown, and keep the alarm for it", async () => {
    const { ctx, alarm } = runner({ preprod: { swaps: true } });
    await runNetworks(ctx, alarm, true);
    expect(vi.mocked(ctx.sessions.runAll).mock.calls.map((c) => c[0])).toEqual(["mainnet", "preprod"]);
    expect(vi.mocked(ctx.lovejoin.withdrawDue).mock.calls).toEqual([
      ["mainnet", true],
      ["preprod", true],
    ]);
    expect(alarm.start).toHaveBeenCalled();
  });

  it("never let the last network's quiet stop the alarm another's work needs", async () => {
    for (const work of [{ swaps: true }, { mixing: true }, { boxes: 2 }, { maybeSent: true }]) {
      const { ctx, alarm } = runner({ mainnet: work });
      await runNetworks(ctx, alarm);
      // Preprod's runAll stopped it last: the run starts it again.
      expect(alarm.stop.mock.invocationCallOrder.at(-1)!).toBeLessThan(alarm.start.mock.invocationCallOrder.at(-1)!);
    }
  });

  it("go on with the other network when one fails, and leave the alarm stopped with nothing to do", async () => {
    const { ctx, alarm } = runner({ mainnet: { fails: true }, preprod: { maybeSent: true } });
    await runNetworks(ctx, alarm);
    expect(ctx.pending.watch).toHaveBeenCalledWith("preprod");
    expect(alarm.start).toHaveBeenCalled();

    const quiet = runner({});
    await runNetworks(quiet.ctx, quiet.alarm);
    expect(quiet.alarm.start).not.toHaveBeenCalled();
  });

  it("stop the alarm while locked, asking nothing", async () => {
    const { ctx, alarm } = runner({ preprod: { swaps: true } });
    (ctx.wallet as unknown as { state: () => Promise<string> }).state = async () => "locked";
    await runNetworks(ctx, alarm);
    expect(alarm.stop).toHaveBeenCalled();
    expect(ctx.sessions.runAll).not.toHaveBeenCalled();
  });
});
