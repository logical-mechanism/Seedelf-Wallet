// A swap that runs itself, against what its orders did on chain
// (independent review L15, L16, M18, D2): a copy Koios didn't answer whose
// order landed all the same, the close while an order may still pay the
// account, the return after a cancel, and a refund told from a fill; what
// Stop's own cancel spends and puts up, a cancel the fill beat, or that went
// unseen and is sent again, and the return after one as Koios lists it
// (release review C03, C04, C12, C16, C18, C25, C32); that cancel sent again
// while its first copy waits in a mempool, and Review it myself and Stop
// after a copy was given up (cross-area review X01, X04).
import { describe, expect, it } from "vitest";

import { bodyOutpoints } from "../src/background/cbor";
import { builtOutputs } from "../src/background/minswap";
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
    // The page says what it waits on: an order Koios can't find yet (release review C16).
    expect(view.auto).toMatchObject({ step: "cancelling", orderOpen: t.clock.now });

    // utxo_info catches up: its order is on chain, and Stop's own cancel of it goes (chunk 24, Step 3).
    t.koios.addedToAccounts.push(atContract(SWAP_TX, 0));
    view = await sessions.advance("preprod", 0, true);
    expect(bodyOutpoints(t.koios.submitted.at(-1)!, 0)).toContain(`${SWAP_TX}#0`);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel"]);
    expect(view.auto!.orderOpen).toBeUndefined();
  });

  it("is built again, as before, when no order of it is on chain", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await unansweredOrder(t, sessions);
    await busy(t, 16 * 60_000);
    await sessions.advance("preprod", 0, true);
    expect(t.minswap.calls.filter((c) => c.path === "build-tx")).toHaveLength(2);
  });

  it("never places a second order, nor brings anything back, while a copy given up has its order open, and Stop cancels that order (release review C18)", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    funded(t);
    t.koios.addedToAccounts.push(atSession("0c".repeat(32), 1, "5000000"));
    // Sent, and tx_status doesn't show it for 16 minutes: given up. The copy built again spends what it did, still
    // counted spent: refused, so it pauses.
    t.koios.missing.add(SWAP_TX);
    await sessions.advance("preprod", 0);
    await busy(t, 16 * 60_000);
    let view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.paused).toMatchObject({ why: "refused" });
    // Review it myself is refused too, before Minswap is asked: what an order swap Koios took spends stays counted
    // spent, so it's never built again by hand (cross-area review X04).
    await expect(sessions.swapBuild("preprod", 0)).rejects.toThrow("This session's swap was sent already.");
    const builds = t.minswap.calls.filter((c) => c.path === "build-tx").length;
    // Its order is on chain after all, and open; the swap's change isn't listed yet. The run's first utxo_info,
    // where it looks for the copy's orders, reaches a backend behind the others: the copy stays given up, and only
    // the read of the swap's open orders finds it.
    t.koios.spent.add(FUNDING);
    t.koios.addedToAccounts.push(orderRow(SWAP_TX));
    const real = t.koios.fetch;
    let behind = 0;
    t.koios.fetch = async (url, init) => {
      const answer = await real(url, init);
      const asked = init.body ? (JSON.parse(String(init.body)) as { _utxo_refs?: string[] }) : {};
      if (!url.endsWith("/utxo_info") || !asked._utxo_refs?.includes(`${SWAP_TX}#0`) || behind <= 0) return answer;
      behind--;
      const rows = (await answer.json()) as Array<{ tx_hash: string; tx_index: number }>;
      return Response.json(rows.filter((r) => `${r.tx_hash}#${r.tx_index}` !== `${SWAP_TX}#0`));
    };
    behind = 1;
    view = await sessions.resume("preprod", 0);
    expect(behind).toBe(0);
    expect(t.minswap.calls.filter((c) => c.path === "build-tx")).toHaveLength(builds);
    expect(t.koios.submitted).toHaveLength(2);
    expect((await bookOf(t)).sessions[0]!.txs.find((x) => x.txHash === SWAP_TX)).toMatchObject({ replaced: true });
    // Stop: the order is cancelled first, never left at the DEX for a session that's over.
    behind = 1;
    view = await sessions.stop("preprod", 0);
    expect(behind).toBe(0);
    expect(bodyOutpoints(t.koios.submitted.at(-1)!, 0)).toContain(`${SWAP_TX}#0`);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "cancel"]);
    // The page showed no swap: Stop's late warning names an order, which the wallet cancels (cross-area review X04).
    expect(view).toMatchObject({ ordered: true });
    expect(view).not.toHaveProperty("orderedPools");
  });
});

describe("Review it myself after a copy of the swap was given up (cross-area review X04)", () => {
  it("builds the swap again by hand from the funding that copy spent, until Koios knows that copy's order", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    // Koios didn't answer its order: what it spends is freed once it's given up, and the swap built again pauses.
    await unansweredOrder(t, sessions);
    t.minswap.estimate = { ...t.minswap.estimate, amount_out: "900000000", min_amount_out: "895500000" };
    await busy(t, 16 * 60_000);
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.paused).toMatchObject({ why: "price" });
    expect(view.txs.map((x) => x.kind)).toEqual(["out"]);
    expect((await bookOf(t)).sessions[0]!.txs.find((x) => x.txHash === SWAP_TX)).toMatchObject({ replaced: true });
    expect((await sessions.swapBuild("preprod", 0)).kind).toBe("swap");

    // Its order is on chain after all: that copy landed, and it's the swap. Minswap isn't asked.
    t.koios.addedToAccounts.push(orderRow(SWAP_TX));
    const builds = t.minswap.calls.filter((c) => c.path === "build-tx").length;
    await expect(sessions.swapBuild("preprod", 0)).rejects.toThrow("This session's swap was sent already.");
    expect(t.minswap.calls.filter((c) => c.path === "build-tx")).toHaveLength(builds);
  });
});

describe("Stop's own cancel, what it spends and puts up (release review C04)", () => {
  /** Session 0, stopped while its swap's order waits at the DEX: the account holds `held`. */
  async function stoppedWith(t: T, held: Array<ReturnType<typeof atSession>>) {
    const now = t.clock.now;
    const done = (kind: string, txHash: string, extra = {}) => ({ kind, txHash, at: now, confirmed: true, ...extra });
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: now,
          txs: [done("out", "01".repeat(32)), done("swap", SWAP_TX, { orders: [`${SWAP_TX}#0`] })],
          swap: { ...ASK, amountOut: "906594100", minAmountOut: "902083681" },
          auto: { approved: { minAmountOut: "902083681", fund: { lovelace: "16000000", tokens: [] } }, stopping: now },
        },
      ],
    });
    t.koios.addedToAccounts.push(atContract(SWAP_TX, 0), ...held);
  }

  it("pauses, saying why in the wallet's words, when the account holds no UTxO of ADA alone to put up as collateral", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await stoppedWith(t, [atSession("bb".repeat(32), 0, "6000000", [[MIN, "400000000"]])]);
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.paused).toMatchObject({
      why: "refused",
      detail: "this session's account holds no UTxO of ADA alone to put up as collateral for cancelling the order.",
    });
    expect(t.koios.submitted).toHaveLength(0);
  });

  it("leaves out of it a stranger's UTxO holding a datum, which it couldn't spend, and cancels all the same", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const stranger = { ...atSession("dd".repeat(32), 0, "2000000"), inline_datum: { bytes: "d87980", value: null } };
    await stoppedWith(t, [atSession("0c".repeat(32), 1, "5000000"), atSession(SWAP_TX, 1, "1500000"), stranger]);
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.paused).toBeUndefined();
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel"]);
    const cancel = bodyOutpoints(t.koios.submitted.at(-1)!, 0)!;
    expect(cancel).toContain(`${SWAP_TX}#0`);
    expect(cancel).not.toContain(`${"dd".repeat(32)}#0`);
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
      for (const answers of [true, false]) {
        const t = await unlocked();
        const sessions = signing(t);
        await broughtBack(t, [`${SWAP_TX}#0`]);
        t.koios.addedToAccounts.push(atContract(SWAP_TX, 0));
        t.koios.spent.add(`${SWAP_TX}#0`);
        // An order Minswap lists that isn't one the session placed holds nothing open, and Minswap isn't asked:
        // answering, it would serve that list; down, every call it gets is still recorded, then answered 503
        // (release review C25).
        t.minswap.orders = [{ ...ORDER, tx_in: `${"bb".repeat(32)}#1` }];
        if (!answers) {
          const listing = t.minswap.fetch;
          t.minswap.fetch = async (url, init) => (await listing(url, init), new Response("", { status: 503 }));
        }
        const stage = how === "runner" ? (await sessions.advance("preprod", 0, true)).stage : (await sessions.list("preprod", true))[0]!.stage;
        expect(stage).toBe("closed");
        expect(t.minswap.calls).toHaveLength(0);
      }
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

/** A running swap, funded with the recorded swap's UTxO and 5 ₳ of collateral, its order on chain and waiting. */
async function orderWaits(t: T, sessions: ReturnType<typeof signing>) {
  await started(sessions);
  funded(t);
  t.koios.addedToAccounts.push(atSession("0c".repeat(32), 1, "5000000"));
  await sessions.advance("preprod", 0);
  ordered(t);
  t.clock.now += 20_000;
  const view = await sessions.advance("preprod", 0, true);
  expect(view.auto).toMatchObject({ step: "filling", filled: false });
}

describe("a cancel Koios took that the batcher's fill beat (release review C03)", () => {
  it("frees what it spent once it's given up, so the return takes the swap's change too, and the session ends", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await orderWaits(t, sessions);
    await sessions.stop("preprod", 0, true);
    // The wallet's own cancel spends every UTxO of ADA alone but its collateral: the swap's change too.
    const cancel = t.koios.submitted.at(-1)!;
    expect(bodyOutpoints(cancel, 0)!.sort()).toEqual([`${SWAP_TX}#0`, `${SWAP_TX}#1`].sort());
    // Koios took it, but the fill won the order: the cancel never lands, and the proceeds are at the account.
    t.koios.missing.add(txIdOf(cancel));
    t.koios.spent.add(`${SWAP_TX}#0`);
    t.koios.addedToAccounts.push(atSession("aa".repeat(32), 0, "2000000", [[MIN, "902083681"]]));

    // Unseen for 15 minutes, it's given up: what it spent is free again, and everything comes back in one return.
    await busy(t, 16 * 60_000);
    let view = await sessions.advance("preprod", 0, true);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "back"]);
    const back = t.koios.submitted.at(-1)!;
    expect(bodyOutpoints(back, 0)!.sort()).toEqual([`${SWAP_TX}#1`, `${"0c".repeat(32)}#1`, `${"aa".repeat(32)}#0`].sort());

    // It lands. The cancel is looked for its two hours, and then the session is over.
    for (const o of bodyOutpoints(back, 0)!) t.koios.spent.add(o);
    fundingOutsSpent(t);
    await busy(t, 2 * 60 * 60_000);
    view = await sessions.advance("preprod", 0, true);
    expect(view.stage).toBe("closed");
    expect(t.koios.submitted.filter((x) => txIdOf(x) !== txIdOf(cancel))).toHaveLength(3);
  });

  it("brings back what's left of the session's own once the fill is recorded and a return is in, though nothing new arrived", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const now = t.clock.now;
    const done = (kind: string, txHash: string, extra = {}) => ({ kind, txHash, at: now, confirmed: true, ...extra });
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: now,
          txs: [done("out", "01".repeat(32)), done("swap", SWAP_TX, { orders: [`${SWAP_TX}#0`] }), done("back", "05".repeat(32))],
          swap: { ...ASK, amountOut: "906594100", minAmountOut: "902083681" },
          auto: { approved: { minAmountOut: "902083681", fund: { lovelace: "16000000", tokens: [] } }, filled: now },
        },
      ],
    });
    // The fill came back, but its return left the swap's own change behind (counted spent then, by a step given up).
    t.koios.addedToAccounts.push(atContract(SWAP_TX, 0), atSession(SWAP_TX, 1, "131585414"));
    t.koios.spent.add(`${SWAP_TX}#0`);
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.retry).toBeUndefined();
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "back", "back"]);
    expect(bodyOutpoints(t.koios.submitted.at(-1)!, 0)).toEqual([`${SWAP_TX}#1`]);
  });

  it("still waits for the fill itself before the first return, whatever the swap's own change", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const now = t.clock.now;
    const done = (kind: string, txHash: string, extra = {}) => ({ kind, txHash, at: now, confirmed: true, ...extra });
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: now,
          txs: [done("out", "01".repeat(32)), done("swap", SWAP_TX, { orders: [`${SWAP_TX}#0`] })],
          swap: { ...ASK, amountOut: "906594100", minAmountOut: "902083681" },
          // Seen filled, and its return not sent yet: one that failed, say.
          auto: { approved: { minAmountOut: "902083681", fund: { lovelace: "16000000", tokens: [] } }, filled: now },
        },
      ],
    });
    // The listing is behind: the fill's proceeds aren't there yet, only the swap's change.
    t.koios.addedToAccounts.push(atContract(SWAP_TX, 0), atSession(SWAP_TX, 1, "131585414"));
    t.koios.spent.add(`${SWAP_TX}#0`);
    const view = await sessions.advance("preprod", 0, true);
    expect(t.koios.submitted).toHaveLength(0);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
  });
});

describe("the return after Stop's cancel, as Koios lists it (release review C12)", () => {
  it("brings nothing back until Koios lists what the cancel paid: never the 5 ₳ alone, and the order's funds later", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await orderWaits(t, sessions);
    await sessions.stop("preprod", 0);
    const cancel = t.koios.submitted.at(-1)!;
    // It lands: tx_status shows it, utxo_info its order spent. The listing is a block behind: the swap's change it
    // spent is still there, and what it paid isn't yet.
    t.koios.spent.add(`${SWAP_TX}#0`);
    t.clock.now += 20_000;
    let view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.retry).toBeUndefined();
    expect(t.koios.submitted).toHaveLength(3);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel"]);

    // Koios lists it: one return, of the 5 ₳ and the order's funds together.
    t.koios.spent.add(`${SWAP_TX}#1`);
    builtOutputs(cancel).forEach((o, i) => t.koios.addedToAccounts.push(atSession(txIdOf(cancel), i, o.lovelace.toString())));
    t.clock.now += 20_000;
    view = await sessions.advance("preprod", 0, true);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel", "back"]);
    expect(bodyOutpoints(t.koios.submitted.at(-1)!, 0)).toEqual(expect.arrayContaining([`${"0c".repeat(32)}#1`, `${txIdOf(cancel)}#0`]));
  });
});

describe("a cancel built again after it went unseen (release review C32)", () => {
  /** From here on, what's submitted waits in a mempool: Koios takes it, and tx_status doesn't show it. */
  function inMempool(t: T) {
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      const answer = await real(url, init);
      if (url.endsWith("/submittx")) t.koios.missing.add(txIdOf(t.koios.submitted.at(-1)!));
      return answer;
    };
  }

  /** The cancels of the swap's order submitted, by id, each once. */
  const cancels = (t: T) => [...new Set(t.koios.submitted.filter((x) => bodyOutpoints(x, 0)?.includes(`${SWAP_TX}#0`)).map((x) => txIdOf(x)))];

  /** The record's cancels. */
  const recordedCancels = async (t: T) => (await bookOf(t)).sessions[0]!.txs.filter((x) => x.kind === "cancel");

  /** Runner steps 20 s apart while the cancel waits in the mempool, then it lands: everything comes back, once. */
  async function waitsThenLands(t: T, sessions: ReturnType<typeof signing>, cancel: string) {
    let view = await sessions.advance("preprod", 0);
    for (let i = 0; i < 3; i++) {
      t.clock.now += 20_000;
      view = await sessions.advance("preprod", 0);
    }
    expect(cancels(t)).toEqual([cancel]);
    expect(view.auto!.retry).toBeUndefined();
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel"]);
    const sent = t.koios.submitted.find((x) => txIdOf(x) === cancel)!;
    t.koios.missing.delete(cancel);
    t.koios.spent.add(`${SWAP_TX}#0`).add(`${SWAP_TX}#1`);
    builtOutputs(sent).forEach((o, i) => t.koios.addedToAccounts.push(atSession(cancel, i, o.lovelace.toString())));
    t.clock.now += 20_000;
    view = await sessions.advance("preprod", 0, true);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel", "back"]);
    expect(view.auto!.refunded).toBeUndefined();
    expect(cancels(t)).toEqual([cancel]);
  }

  it("is that very cancel sent again, looked for afresh, and no second one goes beside it while it waits (Koios never passed it on)", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await orderWaits(t, sessions);
    // Koios's gateway times out on Stop's cancel, never having passed it on.
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => (url.endsWith("/submittx") ? new Response("upstream request timeout", { status: 504 }) : real(url, init));
    await sessions.stop("preprod", 0);
    t.koios.fetch = real;
    const [first] = await recordedCancels(t);
    const cancel = first!.txHash as string;
    expect(cancels(t)).toEqual([]);
    t.koios.missing.add(cancel);
    inMempool(t);

    // Unseen for 15 minutes: built again byte for byte (a cancel has no validity interval), and sent again as that
    // very cancel, the step's live copy, looked for from now.
    await busy(t, 16 * 60_000);
    const view = await sessions.advance("preprod", 0, true);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel"]);
    expect(cancels(t)).toEqual([cancel]);
    const again = await recordedCancels(t);
    expect(again).toHaveLength(1);
    expect(again[0]).not.toHaveProperty("replaced");
    expect(again[0]!.at).toBe(t.clock.now);
    await waitsThenLands(t, sessions, cancel);
  });

  it("is that very cancel sent again by a worker started after one stopped mid-send, and no second one goes beside it", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await orderWaits(t, sessions);
    // Chrome stops the worker as the cancel goes out: recorded on its way, never submitted.
    const real = t.koios.fetch;
    t.koios.fetch = (url, init) => (url.endsWith("/submittx") ? new Promise<Response>(() => undefined) : real(url, init));
    void sessions.stop("preprod", 0);
    for (let i = 0; i < 400 && !(await recordedCancels(t)).some((x) => x.sending); i++) await new Promise((r) => setTimeout(r, 5));
    t.koios.fetch = real;
    const [first] = await recordedCancels(t);
    expect(first).toMatchObject({ sending: true });
    const cancel = first!.txHash as string;
    t.koios.missing.add(cancel);
    inMempool(t);

    // A new worker, three minutes on: built again byte for byte, and sent as that cancel.
    await busy(t, 3 * 60_000);
    const restarted = signing(t);
    const view = await restarted.advance("preprod", 0, true);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel"]);
    expect(cancels(t)).toEqual([cancel]);
    const again = await recordedCancels(t);
    expect(again).toHaveLength(1);
    expect(again[0]).not.toHaveProperty("replaced");
    expect(again[0]!.at).toBe(t.clock.now);
    await waitsThenLands(t, restarted, cancel);
  });

  /**
   * From here on, a node's mempool behind Koios: what's submitted is taken (202) and waits there, tx_status not
   * showing it, unless it's one waiting there already, or it spends what one waiting or the chain spent: then it's
   * refused as spent, as a node answers ("All inputs are spent", BadInputsUTxO). `cutOff`: the first one it takes,
   * its answer never comes back (Chrome stops the worker mid-send).
   */
  function node(t: T, { cutOff = false } = {}) {
    const waiting = new Map<string, string[]>();
    const taken: string[] = [];
    const refused: string[] = [];
    let took: () => void = () => undefined;
    /** Settles once the node has taken a transaction. */
    const tookOne = new Promise<void>((settle) => (took = settle));
    const real = t.koios.fetch;
    let cut = cutOff;
    t.koios.fetch = async (url, init) => {
      if (!url.endsWith("/submittx")) return real(url, init);
      const bytes = new Uint8Array(init.body as Uint8Array);
      const id = txIdOf(bytes);
      const ins = bodyOutpoints(bytes, 0) ?? [];
      const spent = new Set([...waiting.values()].flat());
      if (waiting.has(id) || ins.some((o) => spent.has(o) || t.koios.spent.has(o))) {
        refused.push(id);
        if (!waiting.has(id)) t.koios.missing.add(id);
        t.koios.calls.push({ path: "submittx", query: "", body: null });
        const why = waiting.has(id) ? "All inputs are spent. Transaction has probably already been included" : "BadInputsUTxO";
        return new Response(why, { status: 400 });
      }
      waiting.set(id, ins);
      taken.push(id);
      t.koios.missing.add(id);
      const answer = real(url, init);
      took();
      if (!cut) return answer;
      cut = false;
      return new Promise<Response>(() => undefined);
    };
    return {
      taken,
      refused,
      tookOne,
      /** Gone from the mempool, never to land: the fill took the order it cancels. */
      drop(id: string) {
        waiting.delete(id);
      },
      /** On chain: what it spends is spent, and what it pays is at the session's account. */
      land(id: string) {
        for (const o of waiting.get(id) ?? []) t.koios.spent.add(o);
        waiting.delete(id);
        t.koios.missing.delete(id);
        const sent = t.koios.submitted.find((x) => txIdOf(x) === id)!;
        builtOutputs(sent).forEach((o, i) => t.koios.addedToAccounts.push(atSession(id, i, o.lovelace.toString())));
      },
    };
  }

  /**
   * Stop's cancel sent again as it waits in a mempool, and refused as spent: still the step, listed, and looked for
   * from the resend, so nothing goes again for 15 minutes. Then the first copy lands, and everything comes back.
   */
  async function keptThenLands(t: T, sessions: ReturnType<typeof signing>, pool: ReturnType<typeof node>, cancel: string) {
    const again = await recordedCancels(t);
    expect(again).toHaveLength(1);
    expect(again[0]).not.toHaveProperty("unsent");
    expect(again[0]).not.toHaveProperty("replaced");
    expect(again[0]!.at).toBe(t.clock.now);
    let view = (await sessions.list("preprod"))[0]!;
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel"]);
    for (let i = 0; i < 14; i++) {
      await busy(t, 60_000);
      view = await sessions.advance("preprod", 0);
    }
    expect(pool.taken).toEqual([cancel]);
    expect(pool.refused).toEqual([cancel]);
    expect(view.auto!.retry).toBeUndefined();
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel"]);
    pool.land(cancel);
    view = await sessions.advance("preprod", 0, true);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel", "back"]);
    expect(view.auto!.refunded).toBeUndefined();
  }

  it("is that very cancel when Koios took it and it still waits in a mempool: refused as spent, it stays the step, and nothing is sent again meanwhile (cross-area review X01)", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await orderWaits(t, sessions);
    const pool = node(t);
    await sessions.stop("preprod", 0);
    const cancel = (await recordedCancels(t))[0]!.txHash as string;
    expect(pool.taken).toEqual([cancel]);

    // Unseen for 15 minutes: given up, built again byte for byte and sent again. The node still holds the first copy.
    await busy(t, 16 * 60_000);
    await sessions.advance("preprod", 0, true);
    expect(pool.refused).toEqual([cancel]);
    await keptThenLands(t, sessions, pool, cancel);
  }, 30_000);

  it("is that very cancel when the node took it as Chrome stopped the worker mid-send: a new worker's resend, refused as spent, stays the step (cross-area review X01)", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await orderWaits(t, sessions);
    const pool = node(t, { cutOff: true });
    void sessions.stop("preprod", 0);
    await pool.tookOne;
    const [first] = await recordedCancels(t);
    expect(first).toMatchObject({ sending: true });
    const cancel = first!.txHash as string;
    expect(pool.taken).toEqual([cancel]);

    await busy(t, 3 * 60_000);
    const restarted = signing(t);
    await restarted.advance("preprod", 0, true);
    expect(pool.refused).toEqual([cancel]);
    await keptThenLands(t, restarted, pool, cancel);
  }, 30_000);

  it("frees what that resent cancel spends once it's given up, when the fill won the order: the return takes the swap's change too (cross-area review X01)", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await orderWaits(t, sessions);
    const pool = node(t, { cutOff: true });
    void sessions.stop("preprod", 0, true);
    await pool.tookOne;
    const cancel = (await recordedCancels(t))[0]!.txHash as string;
    await busy(t, 3 * 60_000);
    const restarted = signing(t);
    let view = await restarted.advance("preprod", 0, true);
    expect(pool.refused).toEqual([cancel]);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel"]);

    // The batcher's fill wins the order: the cancel leaves the mempool, never to land, and the proceeds arrive.
    pool.drop(cancel);
    t.koios.spent.add(`${SWAP_TX}#0`);
    t.koios.addedToAccounts.push(atSession("aa".repeat(32), 0, "2000000", [[MIN, "902083681"]]));
    // Unseen for 15 minutes from the resend: given up, what it spends is free again, and it all comes back in one return.
    await busy(t, 16 * 60_000);
    view = await restarted.advance("preprod", 0, true);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "back"]);
    expect(bodyOutpoints(t.koios.submitted.at(-1)!, 0)!.sort()).toEqual([`${SWAP_TX}#1`, `${"0c".repeat(32)}#1`, `${"aa".repeat(32)}#0`].sort());
  }, 30_000);
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
