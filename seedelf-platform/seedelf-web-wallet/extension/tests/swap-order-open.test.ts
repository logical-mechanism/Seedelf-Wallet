// A stopped swap waiting on an order Minswap doesn't list (independent
// review L16, the owner's call: keep the wait, and say what it waits for).
// The runner records when it first finds the swap so, and clears it once
// that order is spent or Minswap lists it; the swap's page and its row say
// it plainly, with a neutral tag.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SessionView } from "../src/shared/rpc";
import { NetworkContext } from "../src/ui/network";
import { nowLine, Session, SwapRow } from "../src/ui/screens/Swaps";
import { bech32 } from "./fixtures/bech32";
import { bytes, ORDER_ADDRESS } from "./fixtures/swap-tx";
import { ASK, atSession, bookOf, busy, MIN, ORDER, PASSWORD, signing, SWAP_TX, unlocked, type T } from "./swap-session";

/** An order output at the DEX's contract, not at the session's account: utxo_info knows it, credential_utxos of the session doesn't. */
function atContract(txHash: string, index: number, value = "14000000") {
  return { ...atSession(txHash, index, value), address: bech32("addr_test", bytes(ORDER_ADDRESS)), payment_cred: "a6".repeat(28) };
}

const CANCEL = "06".repeat(32);
const LISTED = `${SWAP_TX}#0`;
const UNLISTED = `${SWAP_TX}#2`;

/**
 * A swap of a split route, stopped: its two orders are on chain, and the
 * account holds its collateral. `cancelled`: Minswap listed only the first,
 * whose cancel landed; without it, the first filled before Stop. Either way
 * the second is still at the DEX, and Minswap lists nothing.
 */
async function stoppedSwap(t: T, { cancelled = true, stopping = true } = {}) {
  const now = t.clock.now;
  const done = (kind: string, txHash: string, extra = {}) => ({ kind, txHash, at: now, confirmed: true, ...extra });
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: now,
        txs: [
          done("out", "01".repeat(32)),
          done("swap", SWAP_TX, { orders: [LISTED, UNLISTED] }),
          ...(cancelled ? [done("cancel", CANCEL)] : []),
        ],
        swap: { ...ASK, amountOut: "906594100", minAmountOut: "902083681" },
        auto: {
          approved: { minAmountOut: "902083681", fund: { lovelace: "16000000", tokens: [] } },
          ...(stopping ? { stopping: now } : {}),
        },
      },
    ],
  });
  t.koios.addedToAccounts.push(atContract(SWAP_TX, 0), atContract(SWAP_TX, 2), atSession("0c".repeat(32), 1, "5000000"));
  t.koios.addedToAccounts.push(
    cancelled ? atSession(CANCEL, 0, "9000000") : atSession("bb".repeat(32), 0, "2000000", [[MIN, "400000000"]]),
  );
  t.koios.spent.add(LISTED);
}

/** The session's `auto`, as its sealed record has it. */
async function recorded(t: T) {
  return (await bookOf(t)).sessions[0]!.auto!;
}

/** Koios answers every `utxo_info` with a 500 until the undo. */
function utxoInfoDown(t: T) {
  const real = t.koios.fetch;
  t.koios.fetch = async (url, init) => (url.endsWith("/utxo_info") ? new Response("", { status: 500 }) : real(url, init));
  return () => {
    t.koios.fetch = real;
  };
}

describe("a stopped swap waiting on an order Minswap doesn't list (independent review L16)", () => {
  it("says so from the first time the runner finds it, and keeps that time while it waits", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await stoppedSwap(t);
    const first = t.clock.now;
    let view = await sessions.advance("preprod", 0, true);
    expect(view.auto).toMatchObject({ step: "cancelling", stopping: true, orderOpen: first });
    expect(await recorded(t)).toMatchObject({ orderOpen: first });
    // Nothing comes back meanwhile: what's at the account can still pay a cancel of it.
    expect(t.koios.submitted).toHaveLength(0);

    await busy(t, 30 * 60_000);
    view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.orderOpen).toBe(first);
    expect(t.koios.submitted).toHaveLength(0);
  });

  it("is cleared once that order is spent, and what's left comes back", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await stoppedSwap(t);
    expect((await sessions.advance("preprod", 0, true)).auto!.orderOpen).toBeDefined();

    // The DEX fills it: its proceeds are at the account.
    t.koios.spent.add(UNLISTED);
    t.koios.addedToAccounts.push(atSession("aa".repeat(32), 0, "2000000", [[MIN, "400000000"]]));
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.orderOpen).toBeUndefined();
    expect(await recorded(t)).not.toHaveProperty("orderOpen");
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel", "back"]);
    expect(t.koios.submitted).toHaveLength(1);
  });

  it("is cleared once Minswap lists it, which the runner then cancels", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await stoppedSwap(t);
    expect((await sessions.advance("preprod", 0, true)).auto!.orderOpen).toBeDefined();

    t.minswap.orders = [{ ...ORDER, tx_in: UNLISTED }];
    const view = await sessions.advance("preprod", 0, true);
    expect(t.minswap.calls.filter((c) => c.path === "cancel-tx").at(-1)!.body).toMatchObject({
      orders: [expect.objectContaining({ tx_in: UNLISTED })],
    });
    expect(view.auto!.orderOpen).toBeUndefined();
    expect(await recorded(t)).not.toHaveProperty("orderOpen");
  });

  it("says so too after a Stop that had nothing Minswap listed to cancel", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    // Not stopped: the second order waits for a batcher, as the page says.
    await stoppedSwap(t, { cancelled: false, stopping: false });
    let view = await sessions.advance("preprod", 0, true);
    expect(view.auto).toMatchObject({ step: "filling", stopping: false });
    expect(view.auto!.orderOpen).toBeUndefined();
    expect(await recorded(t)).not.toHaveProperty("orderOpen");

    // Stopped: Minswap lists nothing to cancel, so it waits on that order.
    view = await sessions.stop("preprod", 0);
    expect(view.auto).toMatchObject({ step: "cancelling", orderOpen: t.clock.now });
    expect(t.minswap.calls.map((c) => c.path)).not.toContain("cancel-tx");
    expect(t.koios.submitted).toHaveLength(0);

    // It's refunded: nothing waits any more, and it all comes back.
    t.koios.spent.add(UNLISTED);
    t.koios.addedToAccounts.push(atSession("aa".repeat(32), 0, "12000000"));
    view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.orderOpen).toBeUndefined();
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "back"]);
  });

  it("isn't said while Minswap lists the order, nor while the cancel is on its way", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await stoppedSwap(t);
    t.minswap.orders = [{ ...ORDER, tx_in: UNLISTED }];
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.orderOpen).toBeUndefined();
    expect(await recorded(t)).not.toHaveProperty("orderOpen");
  });

  it("isn't changed by a Koios read that fails, and is found at a later read", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await stoppedSwap(t);
    // Koios doesn't answer: nothing is known, so nothing is said, and the step is tried again later.
    let up = utxoInfoDown(t);
    let view = await sessions.advance("preprod", 0, true);
    up();
    expect(view.auto!.retry).toBeDefined();
    expect(view.auto!.orderOpen).toBeUndefined();
    expect(await recorded(t)).not.toHaveProperty("orderOpen");

    await busy(t, 5 * 60_000);
    view = await sessions.advance("preprod", 0, true);
    const found = t.clock.now;
    expect(view.auto).toMatchObject({ orderOpen: found });
    expect(view.auto!.retry).toBeUndefined();

    // Found so, then Koios fails: it stays as last found, and the page shows the retry.
    await busy(t, 5 * 60_000);
    up = utxoInfoDown(t);
    view = await sessions.advance("preprod", 0, true);
    up();
    expect(view.auto!.retry).toBeDefined();
    expect(view.auto!.orderOpen).toBe(found);
  });

  it("is the sealed record's: a worker restart, or a lock and an unlock, still shows it", async () => {
    const t = await unlocked();
    await stoppedSwap(t);
    const first = t.clock.now;
    await signing(t).advance("preprod", 0, true);

    // A new worker reads it from the record, before any run.
    const [view] = await signing(t).list("preprod");
    expect(view!.auto!.orderOpen).toBe(first);

    await t.wallet.lock();
    await t.wallet.unlock(PASSWORD);
    const sessions = signing(t);
    expect((await sessions.list("preprod"))[0]!.auto!.orderOpen).toBe(first);
    // Its runs after the unlock read the chain again: still waiting, still the same first time.
    await busy(t, 5 * 60_000);
    expect((await sessions.advance("preprod", 0, true)).auto!.orderOpen).toBe(first);
  });

  it("is written once when runs and pages ask together", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await stoppedSwap(t);
    const first = t.clock.now;
    const views = await Promise.all([
      sessions.advance("preprod", 0, true),
      sessions.advance("preprod", 0, true),
      sessions.runAll("preprod").then(() => sessions.advance("preprod", 0)),
    ]);
    for (const view of views) expect(view.auto!.orderOpen).toBe(first);
    expect(await recorded(t)).toMatchObject({ orderOpen: first });
  });
});

/** A page's markup. */
const html = (element: ReactElement) => renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, element));

/** A page's text, as a person reads it. */
function text(element: ReactElement): string {
  return html(element)
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}

const TUSDM = "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde" + "0014df10745553444d";

/** A swap that runs itself, ADA to tUSDM, stopped after its order landed and its cancel with it. */
function cancelling(auto: Partial<NonNullable<SessionView["auto"]>> = {}): SessionView {
  const tx = (kind: "out" | "swap" | "cancel", byte: string) => ({ kind, txHash: byte.repeat(32), at: 0, confirmed: true });
  return {
    index: 2,
    network: "preprod",
    address: "addr_test1" + "q".repeat(50),
    createdAt: 0,
    stage: "open",
    txs: [tx("out", "ab"), tx("swap", "cd"), tx("cancel", "ef")],
    swap: {
      amount: "10000000",
      tokenIn: "lovelace",
      tokenOut: TUSDM,
      slippage: 1,
      amountOut: "4200000",
      minAmountOut: "4158000",
      display: { in: { label: "₳", decimals: 6 }, out: { label: "tUSDM", decimals: 6 } },
    },
    holding: { lovelace: "14000000", tokens: [], utxos: 2 },
    auto: { step: "cancelling", stopping: true, filled: false, approvedMinOut: "4158000", ...auto },
  };
}

const page = (s: SessionView) =>
  text(createElement(Session, { session: s, reading: false, onRefresh: () => undefined, onBack: () => undefined, onChanged: () => undefined }));
const rowOf = (s: SessionView) => createElement(SwapRow, { session: s, onOpen: () => undefined });
const row = (s: SessionView) => text(rowOf(s));

const WAITS =
  "Stopped, but one of this swap's orders is still open at a DEX, and Minswap doesn't list it, so it can't be cancelled yet. " +
  "What's left waits at the swap's account: it comes back once that order is filled or refunded, or cancelled once Minswap " +
  "lists it. Nothing is lost meanwhile.";

describe("the page of a swap waiting on an order Minswap doesn't list (independent review L16)", () => {
  it("says plainly what it waits for, never that it's cancelling or done", () => {
    const s = cancelling({ orderOpen: 1 });
    expect(nowLine(s)).toBe(WAITS);
    const line = page(s);
    expect(line).toContain(WAITS);
    expect(line).toContain("Waiting on an order");
    expect(line).toContain("One is still open at a DEX, and Minswap doesn't list it");
    expect(line).not.toContain("Cancelling the order");
    expect(line).not.toContain("The order's funds back at the account");
  });

  it("has a neutral tag in the list, neither done nor an error", () => {
    const listed = row(cancelling({ orderOpen: 1 }));
    expect(listed).toContain("Order open");
    expect(listed).toContain("An order is still open at a DEX");
    for (const word of ["Done", "Failed", "Needs you", "Stopping", "Cancelling"]) expect(listed).not.toContain(word);
    expect(html(rowOf(cancelling({ orderOpen: 1 })))).toContain("swap-tag--off");
  });

  it("reads as before while the cancel is on its way, and a retry still shows first", () => {
    expect(nowLine(cancelling())).toBe("Cancelling the order. Once that's confirmed, it all comes back.");
    expect(page(cancelling())).toContain("Cancelled");
    expect(row(cancelling())).toContain("Stopping");
    const retrying = cancelling({ orderOpen: 1, retry: { at: Date.now() + 60_000, error: "Koios didn't answer." } });
    expect(row(retrying)).toContain("Retrying");
  });
});
