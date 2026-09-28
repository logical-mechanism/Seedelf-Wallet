// A swap that runs itself, against what its orders did on chain
// (independent review L15, L16, M18, D2): a copy Koios didn't answer whose
// order landed all the same, the close while an order may still pay the
// account, the return after a cancel, and a refund told from a fill.
import { describe, expect, it } from "vitest";

import { bech32 } from "./fixtures/bech32";
import { bytes, ORDER_ADDRESS } from "./fixtures/swap-tx";
import {
  ASK,
  atSession,
  bookOf,
  busy,
  FUNDING,
  funded,
  MIN,
  ORDER,
  ordered,
  signing,
  started,
  SWAP_TX,
  unanswered,
  unlocked,
  type T,
} from "./swap-session";

/** An order output at the DEX's contract, not at the session's account: utxo_info knows it, credential_utxos of the session doesn't. */
function atContract(txHash: string, index: number, value = "14000000") {
  return { ...atSession(txHash, index, value), address: bech32("addr_test", bytes(ORDER_ADDRESS)), payment_cred: "a6".repeat(28) };
}

/** A running swap, funded with the recorded swap's UTxO and 5 ₳ of collateral, whose order's submit gets a 504 but goes through. */
async function unansweredOrder(t: T, sessions: ReturnType<typeof signing>) {
  await started(sessions);
  funded(t);
  t.koios.addedToAccounts.push(atSession("0c".repeat(32), 1, "5000000"));
  // tx_status doesn't show it: a backend more than 15 minutes behind.
  t.koios.missing.add(SWAP_TX);
  const undo = unanswered(t);
  const view = await sessions.advance("preprod", 0);
  undo();
  expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
}

describe("a swap's copy tx_status doesn't show (independent review L15)", () => {
  it("counts as placed once its order is on chain: Stop waits to cancel it, rather than bring the rest back and leave it at the DEX", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await unansweredOrder(t, sessions);
    await busy(t, 5 * 60_000);
    await sessions.stop("preprod", 0);
    // It landed. tx_status still doesn't show it, and Minswap hasn't listed its order yet.
    ordered(t);
    await busy(t, 11 * 60_000);
    let view = await sessions.advance("preprod", 0, true);
    // Its order is on chain: it's the step, not a copy to build again, and nothing comes back yet.
    expect(t.koios.calls.some((c) => c.path === "utxo_info" && c.body._utxo_refs.includes(`${SWAP_TX}#0`))).toBe(true);
    expect(view.txs.map((x) => [x.kind, !!x.confirmed])).toEqual([
      ["out", true],
      ["swap", true],
    ]);
    expect(t.koios.submitted).toHaveLength(2);
    expect(view.stage).toBe("open");

    // Minswap lists it: Stop's cancel is asked for.
    t.minswap.orders = [ORDER];
    view = await sessions.advance("preprod", 0, true);
    expect(t.minswap.calls.map((c) => c.path)).toContain("cancel-tx");
    expect(view.txs.map((x) => x.kind)).not.toContain("back");
  });

  it("never places a second order when the first landed and filled while tx_status didn't show it", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await unansweredOrder(t, sessions);
    // It landed and was filled: its order is spent, the proceeds are at the account, and Minswap lists nothing.
    ordered(t);
    t.koios.spent.add(`${SWAP_TX}#0`);
    t.koios.addedToAccounts.push(atSession("aa".repeat(32), 0, "2000000", [[MIN, "906594100"]]));
    const builds = t.minswap.calls.filter((c) => c.path === "build-tx").length;
    await busy(t, 16 * 60_000);
    const view = await sessions.advance("preprod", 0, true);
    expect(t.minswap.calls.filter((c) => c.path === "build-tx")).toHaveLength(builds);
    // The fill's proceeds come back instead.
    expect(view.auto).toMatchObject({ step: "returning", filled: true });
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "back"]);
  });

  it("is built again, as before, when no order of it is on chain", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await unansweredOrder(t, sessions);
    await busy(t, 16 * 60_000);
    await sessions.advance("preprod", 0, true);
    expect(t.minswap.calls.filter((c) => c.path === "build-tx")).toHaveLength(2);
  });
});

describe("a swap's close (independent review L15, D2)", () => {
  /** Session 0, brought back after its swap landed with `orders`, and its account empty. */
  async function broughtBack(t: T, orders: string[]) {
    const now = t.clock.now;
    const done = (kind: string, txHash: string, extra = {}) => ({ kind, txHash, at: now, confirmed: true, ...extra });
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: now,
          txs: [done("out", "01".repeat(32)), done("swap", SWAP_TX, { orders }), done("back", "05".repeat(32))],
          swap: { ...ASK, amountOut: "906594100", minAmountOut: "902083681" },
          auto: { approved: { minAmountOut: "902083681", fund: { lovelace: "16000000", tokens: [] } }, stopping: now },
        },
      ],
    });
  }

  it("waits while an order of the landed swap isn't spent, whatever Minswap lists", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    // A split route: Minswap listed and cancelled the first order; the second is still at the DEX, unlisted.
    await broughtBack(t, [`${SWAP_TX}#0`, `${SWAP_TX}#2`]);
    t.koios.addedToAccounts.push(atContract(SWAP_TX, 0), atContract(SWAP_TX, 2));
    t.koios.spent.add(`${SWAP_TX}#0`);
    expect((await sessions.advance("preprod", 0, true)).stage).toBe("open");
    expect((await sessions.list("preprod", true))[0]!.stage).toBe("open");
    expect((await bookOf(t)).sessions[0]!.closedAt).toBeUndefined();
    // Filled, and its proceeds brought back too: over.
    t.koios.spent.add(`${SWAP_TX}#2`);
    expect((await sessions.advance("preprod", 0, true)).stage).toBe("closed");
  });

  it("waits while Minswap lists an order for the account, though the swap's own are spent (a DEX's remainder, say)", async () => {
    for (const how of ["runner", "refresh"] as const) {
      const t = await unlocked();
      const sessions = signing(t);
      await broughtBack(t, [`${SWAP_TX}#0`]);
      t.koios.addedToAccounts.push(atContract(SWAP_TX, 0));
      t.koios.spent.add(`${SWAP_TX}#0`);
      t.minswap.orders = [{ ...ORDER, tx_in: `${"bb".repeat(32)}#1` }];
      const stage = async () =>
        how === "runner" ? (await sessions.advance("preprod", 0, true)).stage : (await sessions.list("preprod", true))[0]!.stage;
      expect(await stage()).toBe("open");
      // Minswap can't be reached: it isn't closed either.
      const real = t.minswap.fetch;
      t.minswap.fetch = async () => new Response("", { status: 503 });
      expect((await sessions.list("preprod", true))[0]!.stage).toBe("open");
      t.minswap.fetch = real;
      t.minswap.orders = [];
      expect(await stage()).toBe("closed");
    }
  });

  it("asks Minswap nothing to close a swap stopped before its order", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    await sessions.stop("preprod", 0);
    funded(t);
    await sessions.advance("preprod", 0, true);
    t.koios.spent.add(FUNDING);
    expect((await sessions.advance("preprod", 0, true)).stage).toBe("closed");
    expect(t.minswap.calls.map((c) => c.path)).toEqual(["estimate"]);
  });
});
