// A submit Koios didn't answer may or may not have gone through (launch
// review #10). It comes back maybe sent, not as an error: its UTxOs are held
// back, Send sends the very same bytes again, nothing new is built until the
// chain shows it or it can't land, and then its UTxOs are freed. Found live:
// Koios's submit timed out on a full mempool, the transaction landed, and the
// wallet's advice (review it again) paid a second time.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import { SESSION_CONTRACT_PREFIX } from "../src/background/contract-scan";
import { SESSION_BUILT } from "../src/background/move-in";
import { EXPIRED_AFTER_SLOTS, MAYBE_SENT_WAIT, SESSION_PENDING, UNSEEN_AFTER_MS } from "../src/background/pending";
import { SESSION_SEND } from "../src/background/send";
import { spentSet } from "../src/background/spent";
import { SESSION_WITHDRAW, WithdrawService } from "../src/background/withdraw";
import type { PendingTx } from "../src/shared/rpc";
import { PendingBanner } from "../src/ui/components/PendingBanner";
import { txIdOf } from "./fixtures/cbor";
import { busyFor, loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
/** The 15-word phrase's receive address: someone else's. */
const THEIRS = account(15).preprod.receive_0 as string;
/** What the node answers a transaction whose inputs are spent, as Koios passes it on. */
const SPENT = "ConwayUtxowFailure (UtxoFailure (BadInputsUTxO (fromList [])))";

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  return t;
}

type T = Awaited<ReturnType<typeof unlocked>>;

/** Koios passes the next `times` submits on, and then doesn't answer: the 20 s timeout fires. */
function unanswered(t: T, times = 1) {
  const real = t.koios.fetch;
  let left = times;
  t.koios.fetch = async (url, init) => {
    const answer = await real(url, init);
    if (url.endsWith("/submittx") && left-- > 0) throw new DOMException("signal timed out", "TimeoutError");
    return answer;
  };
}

/** The withdraw service with giveme.my's witness and WebAssembly's signing stood in for (Rust tests cover them). */
function privately(t: T) {
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return new WithdrawService({
    ...t.deps,
    wasm: {
      ...wasm,
      signScriptSpend: (_key: unknown, request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
  });
}

const ids = (t: T) => t.koios.submitted.map((b) => txIdOf(b));

describe("a payment Koios didn't answer", () => {
  it("comes back maybe sent, holds its UTxOs back, and stops new payments until it lands", async () => {
    const t = await unlocked();
    // A move-in reviewed first, in another window: its Send waits too.
    const other = await t.moveIn.build("preprod", "5000000", []);
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    unanswered(t);
    const pending = await t.send.submit("preprod", summary.txHash);
    expect(pending).toMatchObject({ kind: "send", txHash: summary.txHash, confirmations: null, maybeSent: true });
    expect(pending.invalidHereafter).toBeGreaterThan(0);
    const inputs = txInputs(t.koios.submitted[0]!);
    expect(await spentSet(t.session)).toEqual(new Set(inputs));
    // Kept, signed as sent, for Send again.
    expect(await t.session.get(SESSION_SEND)).toMatchObject({ txHash: summary.txHash, sentCbor: Buffer.from(t.koios.submitted[0]!).toString("hex") });
    expect(await t.pending.pending()).toMatchObject({ txHash: summary.txHash, maybeSent: true });

    // Review it again, and the wallet would pay again with other UTxOs: it waits instead.
    await expect(t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }])).rejects.toThrow(MAYBE_SENT_WAIT);
    await expect(t.moveIn.build("preprod", "5000000", [])).rejects.toThrow(MAYBE_SENT_WAIT);
    await expect(t.withdraw.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }])).rejects.toThrow(MAYBE_SENT_WAIT);
    await expect(t.moveIn.submit("preprod", other.txHash)).rejects.toThrow(MAYBE_SENT_WAIT);

    // Send again: the network has it already, and it isn't on chain yet. Still maybe sent, not an error.
    t.koios.rejectSubmit = SPENT;
    expect(await t.send.submit("preprod", summary.txHash)).toMatchObject({ txHash: summary.txHash, maybeSent: true });
    expect(ids(t)).toEqual([summary.txHash, summary.txHash]);

    // It lands: the next review goes ahead, and only the one payment went out.
    t.koios.confirmations = 1;
    delete t.koios.rejectSubmit;
    const next = await t.send.build("preprod", [{ to: THEIRS, lovelace: "3000000", tokens: [] }]);
    expect(next.txHash).not.toBe(summary.txHash);
    expect(await t.session.get(SESSION_PENDING)).toBeUndefined();
    expect(ids(t)).toEqual([summary.txHash, summary.txHash]);
  });

  it("makes a collateral payment the collateral on its way, as one Koios answered", async () => {
    const t = await unlocked();
    await t.balances.get("preprod");
    const summary = await t.send.buildCollateral("preprod");
    unanswered(t);
    expect(await t.send.submitCollateral("preprod", summary.txHash)).toMatchObject({ kind: "collateral", maybeSent: true });
    expect(await t.coins.collateral("preprod")).toEqual({ state: "waiting", txHash: summary.txHash });
  });

  it("goes as an ordinary payment when Send again gets through", async () => {
    const t = await unlocked();
    const summary = await t.moveIn.build("preprod", "5000000", []);
    unanswered(t);
    expect(await t.moveIn.submit("preprod", summary.txHash)).toMatchObject({ maybeSent: true });
    // More than 10 minutes on: the same bytes can still go, however old.
    await busyFor(t, 15 * 60_000);
    t.koios.missing.add(summary.txHash);
    const pending = await t.moveIn.submit("preprod", summary.txHash);
    expect(pending).toMatchObject({ kind: "move-in", txHash: summary.txHash, confirmations: null });
    expect(pending.maybeSent).toBeUndefined();
    expect(ids(t)).toEqual([summary.txHash, summary.txHash]);
    expect(await t.session.get(SESSION_BUILT)).toBeUndefined();
    expect(await t.activity.seedelf("preprod")).toMatchObject([{ kind: "move-in", txHash: summary.txHash }]);
  });

  it("counts as sent when it's refused as spent and the chain has it", async () => {
    const t = await unlocked();
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    t.koios.rejectSubmit = SPENT;
    t.koios.confirmations = 2;
    expect(await t.send.submit("preprod", summary.txHash)).toMatchObject({ txHash: summary.txHash, confirmations: 2 });
    expect(await t.session.get(SESSION_SEND)).toBeUndefined();

    // Not on chain, and never unanswered before: spent by something else, and said so.
    const again = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2500000", tokens: [] }]);
    t.koios.confirmations = null;
    await expect(t.send.submit("preprod", again.txHash)).rejects.toThrow("a UTxO it spends is already spent");
    expect(await t.session.get(SESSION_SEND)).toBeDefined();
  });

  it("isn't maybe sent when Koios asks the wallet to slow down: it never passed it on", async () => {
    const t = await unlocked();
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => (url.endsWith("/submittx") ? new Response("", { status: 429 }) : real(url, init));
    await expect(t.send.submit("preprod", summary.txHash)).rejects.toThrow("Koios is limiting requests");
    expect(await t.session.get(SESSION_PENDING)).toBeUndefined();
    expect(await spentSet(t.session)).toEqual(new Set());
    expect(await t.session.get(SESSION_SEND)).not.toHaveProperty("sentCbor");
  });

  it("is sent again by the watch now and then, and one the network then takes goes on as sent", async () => {
    const t = await unlocked();
    const summary = await t.moveIn.build("preprod", "5000000", []);
    unanswered(t);
    await t.moveIn.submit("preprod", summary.txHash);
    expect(await t.pending.pending()).toMatchObject({ maybeSent: true });
    expect(ids(t)).toEqual([summary.txHash]);

    await busyFor(t, 2 * 60_000);
    const pending = await t.pending.pending();
    expect(ids(t)).toEqual([summary.txHash, summary.txHash]);
    expect(pending).toMatchObject({ txHash: summary.txHash, confirmations: null, submittedAt: t.clock.now });
    expect(pending!.maybeSent).toBeUndefined();
    expect(await t.session.get(SESSION_BUILT)).toBeUndefined();
    // The history has it from when the network took it.
    expect(await t.activity.seedelf("preprod")).toMatchObject([{ kind: "move-in", txHash: summary.txHash }]);
    await expect(t.moveIn.build("preprod", "5000000", [])).resolves.toBeDefined();
  });

  it("expires with the public account's slot: nothing was sent, and its UTxOs are free again", async () => {
    const t = await unlocked();
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    unanswered(t, Infinity);
    const { invalidHereafter } = await t.send.submit("preprod", summary.txHash);
    await busyFor(t, 2 * 60 * 60_000 + 60_000);
    t.koios.tip = invalidHereafter! + EXPIRED_AFTER_SLOTS - 1;
    expect(await t.pending.pending()).toMatchObject({ maybeSent: true, confirmations: null });
    expect(await t.pending.pending()).not.toHaveProperty("dropped");

    t.koios.tip = invalidHereafter! + EXPIRED_AFTER_SLOTS + 1;
    expect(await t.pending.pending()).toMatchObject({ txHash: summary.txHash, dropped: "expired", confirmations: null });
    expect(await spentSet(t.session)).toEqual(new Set());
    expect(await t.session.get(SESSION_SEND)).toBeUndefined();
    expect(await t.pending.pending()).toBeNull();
    await expect(t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }])).resolves.toBeDefined();
  });
});

describe("a private payment Koios didn't answer", () => {
  it("asks giveme.my once, reads the contract in full, and goes into the history once it's seen", async () => {
    const t = await unlocked();
    const withdraw = privately(t);
    const summary = await withdraw.build("preprod", [{ to: THEIRS, lovelace: "5000000", tokens: [] }]);
    unanswered(t);
    expect(await withdraw.submit("preprod", summary.txHash)).toMatchObject({ kind: "withdraw", maybeSent: true });
    expect((await t.session.get<{ fullAt: number }>(`${SESSION_CONTRACT_PREFIX}preprod`))!.fullAt).toBe(0);
    expect(await t.activity.seedelf("preprod")).toEqual([]);

    // Send again: giveme.my isn't asked again (it would refuse inputs already on their way).
    t.koios.rejectSubmit = SPENT;
    expect(await withdraw.submit("preprod", summary.txHash)).toMatchObject({ maybeSent: true });
    expect(t.collateral.asked).toHaveLength(1);
    expect(ids(t)).toEqual([summary.txHash, summary.txHash]);

    t.koios.confirmations = 1;
    expect(await t.pending.pending()).toMatchObject({ txHash: summary.txHash, confirmations: 1 });
    expect(await t.activity.seedelf("preprod")).toMatchObject([{ kind: "withdraw", txHash: summary.txHash }]);
    expect(await t.session.get(SESSION_WITHDRAW)).toBeUndefined();
  });

  it("is let go after 20 minutes the chain doesn't show it, and its UTxOs count again", async () => {
    const t = await unlocked();
    const withdraw = privately(t);
    const summary = await withdraw.build("preprod", [{ to: THEIRS, lovelace: "5000000", tokens: [] }]);
    const before = await t.balances.get("preprod", true);
    unanswered(t, Infinity);
    const pending = await withdraw.submit("preprod", summary.txHash);
    expect(pending.invalidHereafter).toBeUndefined();
    const inputs = txInputs(t.koios.submitted[0]!);
    expect([...(await spentSet(t.session))]).toEqual(inputs);

    await busyFor(t, UNSEEN_AFTER_MS - 60_000);
    expect(await t.pending.pending()).toMatchObject({ maybeSent: true });
    await expect(withdraw.build("preprod", [{ to: THEIRS, lovelace: "5000000", tokens: [] }])).rejects.toThrow(MAYBE_SENT_WAIT);
    await busyFor(t, 2 * 60_000);
    expect(await t.pending.pending()).toMatchObject({ txHash: summary.txHash, dropped: "unseen" });
    expect(await spentSet(t.session)).toEqual(new Set());
    expect(await t.session.get(SESSION_WITHDRAW)).toBeUndefined();
    expect((await t.activity.seedelf("preprod")).map((e) => e.txHash)).not.toContain(summary.txHash);
    // Read in full again: the UTxOs it would have spent are in the balance.
    expect((await t.balances.get("preprod", true)).seedelf.lovelace).toBe(before.seedelf.lovelace);
  });
});

describe("Home's banner", () => {
  const sent: PendingTx = { kind: "send", network: "preprod", txHash: "ab".repeat(32), submittedAt: 0, confirmations: null };
  const text = (pending: PendingTx, watching: boolean) =>
    renderToStaticMarkup(createElement(PendingBanner, { pending, watching, onDismiss: () => undefined }))
      .replace(/<[^>]+>/g, " ")
      .replaceAll("&#x27;", "'")
      .replace(/\s+/g, " ");

  it("says plainly that a payment Koios didn't answer may have gone through, and that sending it again is safe", () => {
    expect(text({ ...sent, maybeSent: true }, true)).toContain(
      "Payment may have gone through. Waiting for the network… Koios didn't answer when it was sent. The wallet sends it again now and then, which is safe",
    );
    expect(text({ ...sent, maybeSent: true }, false)).toContain("Payment may have gone through Koios didn't answer");
    expect(text(sent, true)).toContain("Payment sent. Waiting for the network…");
  });

  it("says that nothing was sent when one expired, and what's likely when one was never seen", () => {
    expect(text({ ...sent, dropped: "expired" }, false)).toContain(
      "Payment expired: nothing was sent The network didn't take it in the time it was valid for, so it can't go through any more. Its UTxOs are back in your balance.",
    );
    expect(text({ ...sent, kind: "transfer", dropped: "unseen" }, false)).toContain(
      "Private payment not seen on the network Koios didn't answer when it was sent, and 20 minutes on the network still hasn't shown it, so it most likely never went out.",
    );
    expect(text({ ...sent, dropped: "expired" }, false)).toContain("Dismiss");
  });
});
