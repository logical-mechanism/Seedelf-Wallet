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

describe("a swap's return after Stop's cancel (independent review L16)", () => {
  it("waits for every order of the swap to be spent, not only those Minswap listed and cancelled", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const now = t.clock.now;
    const done = (kind: string, txHash: string, extra = {}) => ({ kind, txHash, at: now, confirmed: true, ...extra });
    const CANCEL = "06".repeat(32);
    // A split route: Minswap listed only the first order, and the cancel of it landed. The second is still at the DEX.
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
    expect(t.koios.submitted).toHaveLength(0);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel"]);

    // The second fills: everything comes back, its proceeds too.
    t.koios.spent.add(`${SWAP_TX}#2`);
    t.koios.addedToAccounts.push(atSession("aa".repeat(32), 0, "2000000", [[MIN, "400000000"]]));
    view = await sessions.advance("preprod", 0, true);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel", "back"]);
    expect(t.koios.submitted).toHaveLength(1);
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
