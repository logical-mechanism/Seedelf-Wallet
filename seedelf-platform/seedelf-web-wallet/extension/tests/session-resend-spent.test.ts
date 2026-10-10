// A session's transaction the user sends again, after a try Koios didn't
// answer, stays maybe sent whatever that second try meets (final review
// F11): refused as spending what's spent (the network refuses one it has, in
// a mempool or landed while tx_status lags), or turned away before it
// reached a node (a 429). The first may be on its way, so its inputs stay
// held, a swap's orders are looked for before another is placed
// (independent review L15), and a return's history is written once it lands
// (independent review M7). The real WebAssembly, and fakes of Koios, giveme.my
// and Minswap's aggregator.
import { describe, expect, it } from "vitest";

import type { KoiosUtxo } from "../src/background/koios";
import { sessionSwap, testBalances, vectors } from "./fakes";
import { bookOf, busy, funded, ordered, signing, started, SWAP_TX, unanswered, unlocked } from "./swap-session";

const PASSWORD = "correct horse battery";
const BAD_INPUTS = "ConwayUtxowFailure (UtxoFailure (BadInputsUTxO (fromList [])))";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;

/** A UTxO at session 0's account, as Koios lists it. */
function atSession(tx_hash: string, tx_index: number, value: string): KoiosUtxo {
  return {
    tx_hash,
    tx_index,
    address: sessionSwap.address,
    value,
    stake_address: null,
    payment_cred: sessionSwap.keyHash,
    epoch_no: 315,
    block_height: 5_000_000,
    block_time: 1_800_000_000,
    datum_hash: null,
    inline_datum: null,
    reference_script: null,
    is_spent: false,
    asset_list: [],
  } as KoiosUtxo;
}

const OUT = "01".repeat(32);

/** An unlocked wallet with a site's session 0 holding 40 ₳ and its 5 ₳ collateral, its funding on chain. */
async function siteSession() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  t.koios.confirmations = 1;
  // The private history is there before any of this: what arrives later is received (independent review L38).
  await t.activity.arrived("preprod", []);
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: t.clock.now,
        txs: [{ kind: "out", txHash: OUT, at: t.clock.now, confirmed: true }],
        site: { origin: "https://example.org" },
      },
    ],
  });
  t.koios.addedToAccounts.push(atSession(OUT, 0, "40000000"), atSession(OUT, 1, "5000000"));
  return t;
}
type Site = Awaited<ReturnType<typeof siteSession>>;

/** Koios answers every submit with `status`, after passing it on or not (`taken`). Returns the undo. */
function answering(t: Site, status: number, taken: boolean) {
  const real = t.koios.fetch;
  t.koios.fetch = async (url, init) => {
    if (!url.endsWith("/submittx")) return real(url, init);
    if (taken) await real(url, init);
    return new Response("", { status });
  };
  return () => void (t.koios.fetch = real);
}

const recordOf = async (t: Site, txHash: string) =>
  (await t.store.get<{ sessions: Array<{ txs: Array<Record<string, unknown>> }> }>("sessions.preprod"))!.sessions[0]!.txs.find(
    (x) => x.txHash === txHash,
  );

async function classOf(t: Site, txHash: string) {
  const classes = await t.activity.classes("preprod", [{ tx_hash: txHash, tx_index: 0 } as KoiosUtxo]);
  return classes.get(`${txHash}#0`);
}

describe("a site's session's return sent again after Koios didn't answer (final review F11)", () => {
  it("stays maybe sent when the network refuses it as spent, and its history is written once it lands", async () => {
    const t = await siteSession();
    const review = await t.sessions.backBuild("preprod", 0, true);
    // Koios takes it, and doesn't answer.
    const undo = answering(t, 504, true);
    await expect(t.sessions.backSubmit("preprod", review.txHash)).rejects.toThrow("The server");
    undo();
    const inputs = (await recordOf(t, review.txHash))!.inputs;
    expect(inputs).toBeTruthy();

    // A minute on the user sends it again: it waits in a mempool, and tx_status doesn't show it yet.
    t.clock.now += 60_000;
    t.koios.missing.add(review.txHash);
    t.koios.rejectSubmit = BAD_INPUTS;
    await expect(t.sessions.backSubmit("preprod", review.txHash)).rejects.toThrow("already spent");
    t.koios.rejectSubmit = undefined;
    const kept = await recordOf(t, review.txHash);
    expect(kept).not.toHaveProperty("unsent");
    expect(kept).toMatchObject({ kind: "back", inputs, summary: { index: 0 } });
    // It's on its way as far as the session can tell: the runs keep looking for it.
    expect((await t.sessions.list("preprod"))[0]!.stage).toBe("returning");
    expect(await t.sessions.runAll("preprod")).toBe(true);

    // It lands: the next run writes its history as the session's.
    t.koios.missing.delete(review.txHash);
    expect(await t.sessions.runAll("preprod")).toBe(false);
    expect(await classOf(t, review.txHash)).toEqual({ id: "session:0", origin: "session" });
    expect(await recordOf(t, review.txHash)).toMatchObject({ confirmed: true });
  });

  it("stays maybe sent when Koios turns the second try away (a 429): that one never left, the first may have", async () => {
    const t = await siteSession();
    const review = await t.sessions.backBuild("preprod", 0, true);
    let undo = answering(t, 504, true);
    await expect(t.sessions.backSubmit("preprod", review.txHash)).rejects.toThrow("The server");
    undo();
    t.clock.now += 60_000;
    t.koios.missing.add(review.txHash);
    undo = answering(t, 429, false);
    await expect(t.sessions.backSubmit("preprod", review.txHash)).rejects.toThrow("limiting requests");
    undo();
    expect(await recordOf(t, review.txHash)).not.toHaveProperty("unsent");
    t.koios.missing.delete(review.txHash);
    expect(await t.sessions.runAll("preprod")).toBe(false);
    expect(await classOf(t, review.txHash)).toEqual({ id: "session:0", origin: "session" });
  });

  it("is marked never sent when its first try was turned away, as before", async () => {
    const t = await siteSession();
    const review = await t.sessions.backBuild("preprod", 0, true);
    t.koios.rejectSubmit = "ConwayUtxowFailure (UtxoFailure (ValueNotConservedUTxO))";
    await expect(t.sessions.backSubmit("preprod", review.txHash)).rejects.toThrow();
    t.koios.rejectSubmit = BAD_INPUTS;
    t.koios.missing.add(review.txHash);
    await expect(t.sessions.backSubmit("preprod", review.txHash)).rejects.toThrow("already spent");
    expect(await recordOf(t, review.txHash)).toMatchObject({ unsent: true });
    expect(await recordOf(t, review.txHash)).not.toHaveProperty("inputs");
  });
});

describe("a swap sent again by the user after Koios didn't answer (final review F11)", () => {
  it("stays the swap's step when refused as spent: its order is looked for, and no second one is asked for", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    funded(t);
    // The price moved: the runner pauses, and the user reviews it and sends it.
    const estimate = t.minswap.estimate;
    t.minswap.estimate = { ...estimate, amount_out: "900000000", min_amount_out: "895500000" };
    expect((await sessions.advance("preprod", 0, true)).auto!.paused).toMatchObject({ why: "price" });
    const review = await sessions.swapBuild("preprod", 0);
    const undo = unanswered(t);
    await expect(sessions.txSubmit("preprod", review.txHash, "swap")).rejects.toThrow("The server");
    undo();

    // A minute on, Send again: it waits in a mempool, and tx_status doesn't show it yet.
    await busy(t, 60_000);
    t.koios.missing.add(SWAP_TX);
    t.koios.rejectSubmit = BAD_INPUTS;
    await expect(sessions.txSubmit("preprod", review.txHash, "swap")).rejects.toThrow("already spent");
    t.koios.rejectSubmit = undefined;
    const swap = (await bookOf(t)).sessions[0]!.txs.find((x) => x.kind === "swap")!;
    expect(swap).not.toHaveProperty("unsent");
    expect(swap).toMatchObject({ txHash: SWAP_TX, orders: [`${SWAP_TX}#0`] });
    // Nor built again by hand meanwhile.
    await expect(sessions.swapBuild("preprod", 0)).rejects.toThrow("sent already");

    // It lands: its order waits at the DEX, and Minswap doesn't list it yet. The user presses Try again later.
    ordered(t);
    const builds = () => t.minswap.calls.filter((c) => c.path === "build-tx").length;
    const before = builds();
    await busy(t, 2 * 60_000);
    let view = await sessions.resume("preprod", 0);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
    expect(builds()).toBe(before);
    // Still unseen by tx_status past its 15 minutes: its order, on chain, says it's the step.
    await busy(t, 15 * 60_000);
    view = await sessions.advance("preprod", 0, true);
    expect(view.txs.map((x) => [x.kind, !!x.confirmed])).toEqual([
      ["out", true],
      ["swap", true],
    ]);
    expect(builds()).toBe(before);
  });
});
