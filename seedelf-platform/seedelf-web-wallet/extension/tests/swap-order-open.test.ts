// A stopped swap whose order Minswap doesn't list (independent review L16).
// Until chunk 24's Step 3 the runner could only wait on such an order, and
// said so; now it reads the swap's orders from chain and cancels them with
// its own cancel, so Stop brings the money back whatever Minswap lists. A
// record from before that still says the swap waits is cleared at its next
// run. The page and the row still say it plainly while a record holds it.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { bodyOutpoints } from "../src/background/cbor";
import { txIdOf } from "./fixtures/cbor";
import type { SessionView } from "../src/shared/rpc";
import { NetworkContext } from "../src/ui/network";
import { nowLine, Session, SwapRow } from "../src/ui/screens/Swaps";
import { ASK, atSession, bookOf, busy, MIN, orderRow, PASSWORD, signing, SWAP_TX, unlocked, type T } from "./swap-session";

/** An order output at the DEX's contract, not at the session's account: utxo_info knows it, credential_utxos of the session doesn't. */
function atContract(txHash: string, index: number, value = "14000000") {
  return orderRow(txHash, index, value);
}

const CANCEL = "06".repeat(32);
const LISTED = `${SWAP_TX}#0`;
const UNLISTED = `${SWAP_TX}#2`;

/**
 * A swap of a split route, stopped: its two orders are on chain, and the
 * account holds its collateral. `cancelled`: a cancel of the first landed;
 * without it, the first filled before Stop. Either way the second is still
 * at the DEX, and Minswap lists nothing. `orderOpen`: the record says the
 * swap waits on it, as the runner before Step 3 wrote.
 */
async function stoppedSwap(t: T, { cancelled = true, stopping = true, orderOpen }: { cancelled?: boolean; stopping?: boolean; orderOpen?: number } = {}) {
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
          ...(orderOpen === undefined ? {} : { orderOpen }),
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

/** Whether the wallet's own cancel of `order` was sent, and how many were. */
function cancels(t: T, order: string) {
  return t.koios.submitted.filter((tx) => bodyOutpoints(tx, 0)?.includes(order)).length;
}

describe("a stopped swap whose order Minswap doesn't list (independent review L16, chunk 24 Step 3)", () => {
  it("cancels that order with the wallet's own cancel, never asking Minswap, and never says it waits", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await stoppedSwap(t);
    t.minswap.orders = [];
    const view = await sessions.advance("preprod", 0, true);
    expect(cancels(t, UNLISTED)).toBe(1);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel", "cancel"]);
    expect(view.auto!.orderOpen).toBeUndefined();
    expect(t.minswap.calls).toHaveLength(0);
  });

  it("cancels it at once when Stop comes while it waits for a batcher", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await stoppedSwap(t, { cancelled: false, stopping: false });
    let view = await sessions.advance("preprod", 0, true);
    expect(view.auto).toMatchObject({ step: "filling", stopping: false });
    expect(t.koios.submitted).toHaveLength(0);

    view = await sessions.stop("preprod", 0);
    expect(cancels(t, UNLISTED)).toBe(1);
    expect(view.auto).toMatchObject({ step: "cancelling", stopping: true });
    expect(view.auto!.orderOpen).toBeUndefined();
  });

  it("clears a record from before that says it waits, and cancels the order", async () => {
    const t = await unlocked();
    await stoppedSwap(t, { orderOpen: t.clock.now - 60 * 60_000 });
    const sessions = signing(t);
    expect((await sessions.list("preprod"))[0]!.auto!.orderOpen).toBeDefined();
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.orderOpen).toBeUndefined();
    expect(await recorded(t)).not.toHaveProperty("orderOpen");
    expect(cancels(t, UNLISTED)).toBe(1);
  });

  it("sends nothing on a Koios read that fails, and cancels at a later read", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await stoppedSwap(t);
    const up = utxoInfoDown(t);
    let view = await sessions.advance("preprod", 0, true);
    up();
    expect(view.auto!.retry).toBeDefined();
    expect(t.koios.submitted).toHaveLength(0);

    await busy(t, 5 * 60_000);
    view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.retry).toBeUndefined();
    expect(cancels(t, UNLISTED)).toBe(1);
  });

  it("sends one cancel when runs and pages ask together, and one after a worker restart or an unlock", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await stoppedSwap(t);
    await Promise.all([
      sessions.advance("preprod", 0, true),
      sessions.advance("preprod", 0, true),
      sessions.runAll("preprod").then(() => sessions.advance("preprod", 0)),
    ]);
    expect(cancels(t, UNLISTED)).toBe(1);
    // A new worker, then a lock and an unlock: the cancel on its way is waited on, never sent twice.
    await signing(t).advance("preprod", 0, true);
    await t.wallet.lock();
    await t.wallet.unlock(PASSWORD);
    await busy(t, 5 * 60_000);
    await signing(t).advance("preprod", 0, true);
    expect(cancels(t, UNLISTED)).toBe(1);
  });

  it("brings everything back once its cancel lands", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await stoppedSwap(t);
    await sessions.advance("preprod", 0, true);
    const cancel = t.koios.submitted.at(-1)!;
    t.koios.confirmations = 1;
    t.koios.spent.add(UNLISTED);
    t.koios.addedToAccounts.push(atSession(txIdOf(cancel), 0, "13700000"));
    const view = await sessions.advance("preprod", 0, true);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel", "cancel", "back"]);
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
  "Stopped, but Koios can't find an order of this swap yet, so it isn't cancelled yet. " +
  "It is once Koios finds it, then everything comes back.";

describe("the page of a swap whose order Koios can't find yet (independent review L16)", () => {
  it("says plainly what it waits for, never that it's cancelling or done", () => {
    const s = cancelling({ orderOpen: 1 });
    expect(nowLine(s)).toBe(WAITS);
    const line = page(s);
    expect(line).toContain(WAITS);
    expect(line).toContain("Waiting on an order");
    expect(line).toContain("One is still open at a DEX, and Koios can't find it yet");
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
