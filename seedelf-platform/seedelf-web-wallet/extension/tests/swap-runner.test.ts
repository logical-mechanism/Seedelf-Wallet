// A swap that runs itself, against what its orders did on chain
// (independent review L15, L16, M18, D2): a copy Koios didn't answer whose
// order landed all the same, the close while an order may still pay the
// account, the return after a cancel, and a refund told from a fill.
import { describe, expect, it } from "vitest";

import { bodyOutpoints } from "../src/background/cbor";
import { txIdOf } from "./fixtures/cbor";
import { slippageKeeping } from "../src/background/sessions";
import {
  ASK,
  atSession,
  bookOf,
  busy,
  FUNDING,
  funded,
  fundingOutsSpent,
  MIN,
  ORDER,
  ordered,
  orderRow,
  signing,
  started,
  SWAP_TX,
  unanswered,
  unlocked,
  type T,
} from "./swap-session";

/** An order output at the DEX's contract, not at the session's account: utxo_info knows it, credential_utxos of the session doesn't. */
function atContract(txHash: string, index: number, value = "14000000") {
  return orderRow(txHash, index, value);
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
    // It landed. tx_status still doesn't show it, and Minswap doesn't list its order.
    ordered(t);
    await busy(t, 11 * 60_000);
    const view = await sessions.advance("preprod", 0, true);
    // Its order is on chain: it's the step, not a copy to build again, and Stop's own cancel of it goes at once
    // (chunk 24, Step 3); nothing comes back yet.
    expect(t.koios.calls.some((c) => c.path === "utxo_info" && c.body._utxo_refs.includes(`${SWAP_TX}#0`))).toBe(true);
    expect(view.txs.map((x) => [x.kind, !!x.confirmed])).toEqual([
      ["out", true],
      ["swap", true],
      ["cancel", false],
    ]);
    expect(t.koios.submitted).toHaveLength(3);
    expect(bodyOutpoints(t.koios.submitted.at(-1)!, 0)).toContain(`${SWAP_TX}#0`);
    expect(t.minswap.calls.map((c) => c.path)).not.toContain("cancel-tx");
    expect(view.stage).toBe("open");
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

  /**
   * The copy landed, and the account's listing shows it: the funding is spent and its change is there. utxo_info's
   * backend is as far behind as tx_status's: it doesn't know the order yet.
   */
  function landedUnknown(t: T) {
    t.koios.spent.add(FUNDING);
    t.koios.addedToAccounts.push(atSession(SWAP_TX, 1, "131585414"));
  }

  it("never places a second order when the copy's change is at the account, though utxo_info doesn't know its order yet", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await unansweredOrder(t, sessions);
    // It was filled too, and Minswap lists nothing.
    landedUnknown(t);
    t.koios.addedToAccounts.push(atSession("aa".repeat(32), 0, "2000000", [[MIN, "906594100"]]));
    const builds = t.minswap.calls.filter((c) => c.path === "build-tx").length;
    await busy(t, 16 * 60_000);
    let view = await sessions.advance("preprod", 0, true);
    expect(t.minswap.calls.filter((c) => c.path === "build-tx")).toHaveLength(builds);
    expect(t.koios.submitted).toHaveLength(2);
    // Its change is proof it landed: it's the step, whose order is waited on.
    expect(view.txs.map((x) => [x.kind, !!x.confirmed])).toEqual([
      ["out", true],
      ["swap", true],
    ]);
    expect(view.auto!.filled).toBe(false);

    // utxo_info catches up: the order is spent, and the fill comes back.
    t.koios.addedToAccounts.push(atContract(SWAP_TX, 0));
    t.koios.spent.add(`${SWAP_TX}#0`);
    view = await sessions.advance("preprod", 0, true);
    expect(t.minswap.calls.filter((c) => c.path === "build-tx")).toHaveLength(builds);
    expect(view.auto).toMatchObject({ step: "returning", filled: true });
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "back"]);
  });

  it("Stop waits to cancel a copy whose change is at the account, rather than bring the rest back", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await unansweredOrder(t, sessions);
    await sessions.stop("preprod", 0);
    landedUnknown(t);
    await busy(t, 16 * 60_000);
    let view = await sessions.advance("preprod", 0, true);
    expect(view.txs.map((x) => [x.kind, !!x.confirmed])).toEqual([
      ["out", true],
      ["swap", true],
    ]);
    expect(t.koios.submitted).toHaveLength(2);

    // utxo_info catches up: its order is on chain, and Stop's own cancel of it goes (chunk 24, Step 3).
    t.koios.addedToAccounts.push(atContract(SWAP_TX, 0));
    view = await sessions.advance("preprod", 0, true);
    expect(bodyOutpoints(t.koios.submitted.at(-1)!, 0)).toContain(`${SWAP_TX}#0`);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel"]);
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

  it("closes once the swap's own orders are spent, whatever Minswap lists or whether it answers (chunk 24, Step 3)", async () => {
    for (const how of ["runner", "refresh"] as const) {
      const t = await unlocked();
      const sessions = signing(t);
      await broughtBack(t, [`${SWAP_TX}#0`]);
      t.koios.addedToAccounts.push(atContract(SWAP_TX, 0));
      t.koios.spent.add(`${SWAP_TX}#0`);
      // An order Minswap lists that isn't one the session placed holds nothing open, and Minswap isn't asked.
      t.minswap.orders = [{ ...ORDER, tx_in: `${"bb".repeat(32)}#1` }];
      t.minswap.fetch = async () => new Response("", { status: 503 });
      const stage = how === "runner" ? (await sessions.advance("preprod", 0, true)).stage : (await sessions.list("preprod", true))[0]!.stage;
      expect(stage).toBe("closed");
      expect(t.minswap.calls).toHaveLength(0);
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
    fundingOutsSpent(t);
    expect((await sessions.advance("preprod", 0, true)).stage).toBe("closed");
    expect(t.minswap.calls.map((c) => c.path)).toEqual(["estimate"]);
  });
});

describe("a swap's return after Stop's cancel (independent review L16)", () => {
  it("cancels every order of the swap still open, not only those a cancel before took (chunk 24, Step 3)", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const now = t.clock.now;
    const done = (kind: string, txHash: string, extra = {}) => ({ kind, txHash, at: now, confirmed: true, ...extra });
    const CANCEL = "06".repeat(32);
    // A split route: a cancel of the first order landed. The second is still at the DEX.
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: now,
          txs: [done("out", "01".repeat(32)), done("swap", SWAP_TX, { orders: [`${SWAP_TX}#0`, `${SWAP_TX}#2`] }), done("cancel", CANCEL)],
          swap: { ...ASK, amountOut: "906594100", minAmountOut: "902083681" },
          auto: { approved: { minAmountOut: "902083681", fund: { lovelace: "16000000", tokens: [] } }, stopping: now },
        },
      ],
    });
    t.koios.addedToAccounts.push(
      atContract(SWAP_TX, 0),
      atContract(SWAP_TX, 2),
      atSession(CANCEL, 0, "9000000"),
      atSession("0c".repeat(32), 1, "5000000"),
    );
    t.koios.spent.add(`${SWAP_TX}#0`);
    let view = await sessions.advance("preprod", 0, true);
    // The second, from chain: the wallet's own cancel of it, rather than a wait on it.
    expect(t.koios.submitted).toHaveLength(1);
    expect(bodyOutpoints(t.koios.submitted[0]!, 0)).toContain(`${SWAP_TX}#2`);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel", "cancel"]);

    // It lands: everything comes back, the second order's refund too.
    const second = txIdOf(t.koios.submitted[0]!);
    t.koios.confirmations = 1;
    t.koios.spent.add(`${SWAP_TX}#2`);
    t.koios.addedToAccounts.push(atSession(second, 0, "13700000"));
    view = await sessions.advance("preprod", 0, true);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel", "cancel", "back"]);
    expect(t.koios.submitted).toHaveLength(2);
  });
});

describe("the least a swap's order asks for (independent review L24)", () => {
  it("is the placed order's, once one is: Review it myself after a pause asks for less than was approved", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    funded(t);
    // The price moved: the runner pauses rather than ask for less.
    t.minswap.estimate = { ...t.minswap.estimate, amount_out: "900000000", min_amount_out: "895500000" };
    let view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.paused).toMatchObject({ why: "price" });
    expect(view.auto!.placedMinOut).toBeUndefined();
    // The user reviews the new price and sends it.
    const review = await sessions.swapBuild("preprod", 0);
    expect(review.quote!.minAmountOut).toBe("895500000");
    await sessions.txSubmit("preprod", review.txHash, "swap");
    view = (await sessions.list("preprod"))[0]!;
    expect(view.auto).toMatchObject({ approvedMinOut: "902083681", placedMinOut: "895500000" });
    // Kept with the copy that was sent, and never shown with the transaction.
    expect((await bookOf(t)).sessions[0]!.txs.at(-1)).toMatchObject({ kind: "swap", minAmountOut: "895500000" });
    expect(view.txs.at(-1)).not.toHaveProperty("minAmountOut");
  });

  it("is the runner's own when a fresh quote asks for more than was approved", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    funded(t);
    t.minswap.estimate = { ...t.minswap.estimate, amount_out: "910000000", min_amount_out: "905450000" };
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto).toMatchObject({ approvedMinOut: "902083681", placedMinOut: "905450000" });
  });

  it("is the approved one after a dip within the slippage, asked with the slippage that keeps Minswap's own there", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    funded(t);
    // A big trade moved the pool: still above the approved minimum, but Minswap's own at 0.5% is under it, and
    // asked for the approved one at 0.5% it refuses every build until the price comes back (mainnet, 1.1.0).
    t.minswap.estimate = { ...t.minswap.estimate, amount_out: "904000000", min_amount_out: "899502487" };
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.retry).toBeUndefined();
    expect(view.auto!.paused).toBeUndefined();
    const build = t.minswap.calls.find((c) => c.path === "build-tx")!;
    expect(build.body).toMatchObject({ min_amount_out: "902083681", estimate: { slippage: 0.2123 } });
    expect(view.auto).toMatchObject({ approvedMinOut: "902083681", placedMinOut: "902083681" });
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
  });
});

describe("slippageKeeping", () => {
  it("leaves Minswap's minimum, amount_out / (1 + slippage%) rounded down, at the least or above, a step under the bound", () => {
    expect(slippageKeeping(904000000n, 902083681n)).toBe(0.2123);
    for (const [out, least] of [
      [904000000n, 902083681n],
      [625803009n, 624557629n],
      [10_000_000_000_000_000n, 9_500_000_000_000_000n],
      [1_000_001n, 1_000_000n],
      [57n, 50n],
    ] as const) {
      const s = slippageKeeping(out, least);
      expect(Math.floor(Number(out) / (1 + s / 100))).toBeGreaterThanOrEqual(Number(least));
      // Two steps more, and it's no longer above the least: no more than it needs is given up.
      expect(Math.floor(Number(out) / (1 + (s + 0.0002) / 100))).toBeLessThanOrEqual(Number(least));
    }
  });

  it("is none when the quote is the least, or barely above it", () => {
    expect(slippageKeeping(902083681n, 902083681n)).toBe(0);
    expect(slippageKeeping(902083682n, 902083681n)).toBe(0);
  });
});

describe("a swap's order found spent (independent review M18)", () => {
  /**
   * Session 0 with its swap landed (`ask`, its order at SWAP_TX#0 and, for a split route, #2), and
   * the change at the account; the orders are then spent, and `arrived` pays the account.
   */
  async function spent(
    ask: { tokenIn: string; tokenOut: string; amount: string },
    arrived: Array<ReturnType<typeof atSession>>,
    split = false,
    late: Array<ReturnType<typeof atSession>> = [],
  ) {
    const t = await unlocked();
    const sessions = signing(t);
    const now = t.clock.now;
    const orders = split ? [`${SWAP_TX}#0`, `${SWAP_TX}#2`] : [`${SWAP_TX}#0`];
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: now,
          txs: [
            { kind: "out", txHash: "01".repeat(32), at: now, confirmed: true },
            { kind: "swap", txHash: SWAP_TX, at: now, confirmed: true, orders, minAmountOut: "902083681" },
          ],
          swap: { ...ASK, ...ask, amountOut: "906594100", minAmountOut: "902083681" },
          auto: { approved: { minAmountOut: "902083681", fund: { lovelace: "16000000", tokens: [] } } },
        },
      ],
    });
    t.koios.addedToAccounts.push(
      atSession(SWAP_TX, 1, "131585414"),
      ...orders.map((o) => atContract(SWAP_TX, Number(o.split("#")[1]))),
    );
    for (const o of orders) t.koios.spent.add(o);
    t.koios.addedToAccounts.push(...arrived);
    // `late` lands as the orders are looked up: after the account was read.
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      if (url.endsWith("/utxo_info")) t.koios.addedToAccounts.push(...late.splice(0));
      return real(url, init);
    };
    const view = await sessions.advance("preprod", 0, true);
    return { t, sessions, view };
  }
  const buying = { tokenIn: "lovelace", tokenOut: MIN, amount: "10000000" };
  const selling = { tokenIn: MIN, tokenOut: "lovelace", amount: "906594100" };

  it("records a refund of an ADA→token order as refunded, not filled: what was asked for never came", async () => {
    const { t, sessions, view } = await spent(buying, [atSession("aa".repeat(32), 0, "12000000")]);
    expect(view.auto).toMatchObject({ step: "returning", filled: false, refunded: true });
    // It all comes back all the same.
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "back"]);
    // The return lands.
    t.koios.confirmations = 1;
    t.koios.spent.add(`${SWAP_TX}#1`).add(`${"aa".repeat(32)}#0`);
    const done = await sessions.advance("preprod", 0, true);
    expect(done).toMatchObject({ stage: "closed", auto: { step: "done", filled: false, refunded: true } });
  });

  it("records an ADA→token fill as filled, and a split route with a leg refunded as partly filled", async () => {
    let { view } = await spent(buying, [atSession("aa".repeat(32), 0, "2000000", [[MIN, "906594100"]])]);
    expect(view.auto).toMatchObject({ filled: true });
    expect(view.auto!.refunded).toBeUndefined();
    expect(view.auto!.partly).toBeUndefined();
    // One leg filled, for less than the whole asked for; the other gave its ADA back.
    ({ view } = await spent(
      buying,
      [atSession("aa".repeat(32), 0, "2000000", [[MIN, "450000000"]]), atSession("bb".repeat(32), 0, "7000000")],
      true,
    ));
    expect(view.auto).toMatchObject({ filled: true, partly: true });
  });

  it("tells a split route's outcome by what arrived once every order is spent, a leg paid after the account was read too", async () => {
    // ADA→token: the second leg's fill lands between the reading and the orders' lookup. Filled, not partly.
    let { view } = await spent(buying, [atSession("aa".repeat(32), 0, "2000000", [[MIN, "450000000"]])], true, [
      atSession("bb".repeat(32), 0, "2000000", [[MIN, "456594100"]]),
    ]);
    expect(view.auto).toMatchObject({ filled: true });
    expect(view.auto!.partly).toBeUndefined();
    // Token→ADA: the second leg's refund comes back late. Partly, not filled.
    ({ view } = await spent(selling, [atSession("aa".repeat(32), 0, "6000000")], true, [
      atSession("bb".repeat(32), 0, "2000000", [[MIN, "453297050"]]),
    ]));
    expect(view.auto).toMatchObject({ filled: true, partly: true });
  });

  it("tells a token→ADA refund by the token coming back, and a fill by it not", async () => {
    let { view } = await spent(selling, [atSession("aa".repeat(32), 0, "2000000", [[MIN, "906594100"]])]);
    expect(view.auto).toMatchObject({ filled: false, refunded: true });
    ({ view } = await spent(selling, [atSession("aa".repeat(32), 0, "12000000")]));
    expect(view.auto).toMatchObject({ filled: true });
    expect(view.auto!.refunded).toBeUndefined();
    // Half of it back: one leg of a split route refunded.
    ({ view } = await spent(
      selling,
      [atSession("aa".repeat(32), 0, "6000000"), atSession("bb".repeat(32), 0, "2000000", [[MIN, "453297050"]])],
      true,
    ));
    expect(view.auto).toMatchObject({ filled: true, partly: true });
  });
});

describe("Stop while the runner places the order (independent review L22)", () => {
  it("says an order went out first when the runner's step was placing it as Stop was pressed", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    funded(t);
    // The alarm's step is placing the order; Stop, pressed meanwhile, waits for it.
    const placing = sessions.advance("preprod", 0, true);
    const stopped = await sessions.stop("preprod", 0);
    await placing;
    expect(stopped.ordered).toBe(true);
    expect(stopped.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
    expect(stopped.auto).toMatchObject({ stopping: true });
  });

  it("says none went out when Stop came first", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    const stopped = await sessions.stop("preprod", 0);
    expect(stopped.ordered).toBe(false);
  });
});
