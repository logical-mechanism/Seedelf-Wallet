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
import { EXPIRED_AFTER_SLOTS, MAYBE_SENT_WAIT, pendingKey, UNSEEN_AFTER_MS, watchSent } from "../src/background/pending";
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

/** Holds Koios's next request to `path` until `release`: `held` once it's there. */
function hold(t: T, path: string) {
  const real = t.koios.fetch;
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const held = new Promise<void>((r) => (reached = r));
  let armed = true;
  t.koios.fetch = async (url, init) => {
    if (armed && url.endsWith(`/${path}`)) {
      armed = false;
      reached();
      await gate;
    }
    return real(url, init);
  };
  return { held, release };
}

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
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, maybeSent: true });

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
    expect(await t.session.get(pendingKey("preprod"))).toBeUndefined();
    expect(ids(t)).toEqual([summary.txHash, summary.txHash]);
  });

  it("is watched on its own network: the other network's payments neither wait for it nor drop it", async () => {
    const t = await unlocked();
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    unanswered(t);
    await t.send.submit("preprod", summary.txHash);
    // The wallet moves to mainnet: nothing there waits for it, and mainnet's Home shows nothing.
    expect(await t.pending.pending("mainnet")).toBeNull();
    expect(await t.pending.watch("mainnet")).toBe(false);
    // A payment watched there has its own place, and never takes preprod's.
    await t.session.set(pendingKey("mainnet"), { kind: "send", network: "mainnet", txHash: "cd".repeat(32), submittedAt: t.clock.now, confirmations: null });
    expect(await t.session.get(pendingKey("preprod"))).toMatchObject({ txHash: summary.txHash, maybeSent: true });

    // The worker's runs keep preprod's going meanwhile: looked for, then sent again after two minutes, and taken.
    expect(await t.pending.watch("preprod")).toBe(true);
    expect(ids(t)).toEqual([summary.txHash]);
    t.clock.now += 2 * 60_000;
    expect(await t.pending.watch("preprod")).toBe(false);
    expect(ids(t)).toEqual([summary.txHash, summary.txHash]);
    expect(await t.session.get(pendingKey("preprod"))).toMatchObject({ txHash: summary.txHash, confirmations: null });
    expect(await t.session.get(pendingKey("preprod"))).not.toHaveProperty("maybeSent");
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
    expect(await t.session.get(pendingKey("preprod"))).toBeUndefined();
    expect(await spentSet(t.session)).toEqual(new Set());
    expect(await t.session.get(SESSION_SEND)).not.toHaveProperty("sentCbor");
  });

  it("is sent again by the watch now and then, and one the network then takes goes on as sent", async () => {
    const t = await unlocked();
    const summary = await t.moveIn.build("preprod", "5000000", []);
    unanswered(t);
    await t.moveIn.submit("preprod", summary.txHash);
    expect(await t.pending.pending("preprod")).toMatchObject({ maybeSent: true });
    expect(ids(t)).toEqual([summary.txHash]);

    await busyFor(t, 2 * 60_000);
    const pending = await t.pending.pending("preprod");
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
    expect(await t.pending.pending("preprod")).toMatchObject({ maybeSent: true, confirmations: null });
    expect(await t.pending.pending("preprod")).not.toHaveProperty("dropped");

    t.koios.tip = invalidHereafter! + EXPIRED_AFTER_SLOTS + 1;
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, dropped: "expired", confirmations: null });
    expect(await spentSet(t.session)).toEqual(new Set());
    expect(await t.session.get(SESSION_SEND)).toBeUndefined();
    expect(await t.pending.pending("preprod")).toBeNull();
    await expect(t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }])).resolves.toBeDefined();
  });
});

describe("the watch of a payment that may still go through", () => {
  /**
   * Two windows: `during` runs while the next submit is on its way to Koios,
   * and its own submit goes unanswered; the first then gets its answer, or
   * none either (`unansweredToo`).
   */
  function whileSubmitting(t: T, during: () => Promise<unknown>, unansweredToo = false) {
    const real = t.koios.fetch;
    let submits = 0;
    t.koios.fetch = async (url, init) => {
      if (!url.endsWith("/submittx")) return real(url, init);
      const first = ++submits === 1;
      if (first) await during();
      const answer = await real(url, init);
      if (!first || unansweredToo) throw new DOMException("signal timed out", "TimeoutError");
      return answer;
    };
  }

  it("stays when a payment checked before it went maybe sent goes through after it (final review money-submit-1)", async () => {
    const t = await unlocked();
    const moveIn = await t.moveIn.build("preprod", "5000000", []);
    const payment = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    // The move-in's Send is on its way when the payment's goes unanswered.
    let paid: PendingTx | undefined;
    whileSubmitting(t, async () => (paid = await t.send.submit("preprod", payment.txHash)));
    expect(await t.moveIn.submit("preprod", moveIn.txHash)).toMatchObject({ kind: "move-in", confirmations: null });
    expect(paid).toMatchObject({ txHash: payment.txHash, maybeSent: true });

    expect(await t.session.get(pendingKey("preprod"))).toMatchObject({ txHash: payment.txHash, maybeSent: true });
    await expect(t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }])).rejects.toThrow(MAYBE_SENT_WAIT);
    const spent = await spentSet(t.session);
    for (const tx of t.koios.submitted) for (const o of txInputs(tx)) expect(spent).toContain(o);
  });

  it("stays when another goes maybe sent beside it, which is held back all the same", async () => {
    const t = await unlocked();
    const moveIn = await t.moveIn.build("preprod", "5000000", []);
    const payment = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    whileSubmitting(t, () => t.send.submit("preprod", payment.txHash), true);
    expect(await t.moveIn.submit("preprod", moveIn.txHash)).toMatchObject({ txHash: moveIn.txHash, maybeSent: true });

    expect(await t.session.get(pendingKey("preprod"))).toMatchObject({ txHash: payment.txHash, maybeSent: true });
    // The move-in is kept as sent, for Send again, and its UTxOs are held back.
    expect(await t.session.get(SESSION_BUILT)).toHaveProperty("sentCbor");
    const spent = await spentSet(t.session);
    for (const tx of t.koios.submitted) for (const o of txInputs(tx)) expect(spent).toContain(o);
  });

  it("isn't taken by Lovejoin's withdraw or mix sent beside it, and is once it's settled", async () => {
    const t = await unlocked();
    const payment = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    unanswered(t);
    await t.send.submit("preprod", payment.txHash);
    const watched = await t.session.get(pendingKey("preprod"));
    const withdraw: PendingTx = { kind: "lovejoin-withdraw", network: "preprod", txHash: "cd".repeat(32), submittedAt: t.clock.now, confirmations: null };
    await watchSent(t.deps, withdraw);
    expect(await t.session.get(pendingKey("preprod"))).toEqual(watched);

    t.koios.confirmations = 1;
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: payment.txHash, confirmations: 1 });
    await watchSent(t.deps, withdraw);
    expect(await t.session.get(pendingKey("preprod"))).toEqual(withdraw);
  });
});

describe("the watch, asked about from several places at once (final review money-submit-3)", () => {
  it("keeps a payment that went maybe sent while a slow look found the one before it landed", async () => {
    const t = await unlocked();
    const moveIn = await t.moveIn.build("preprod", "5000000", []);
    const payment = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    await t.send.submit("preprod", payment.txHash);
    // Home looks for the payment, and Koios is slow to answer.
    const slow = hold(t, "tx_status");
    const poll = t.pending.pending("preprod");
    await slow.held;
    // Meanwhile the move-in goes unanswered: maybe sent.
    unanswered(t);
    expect(await t.moveIn.submit("preprod", moveIn.txHash)).toMatchObject({ maybeSent: true });

    // The payment landed; the move-in hasn't yet.
    t.koios.confirmations = 1;
    t.koios.missing.add(moveIn.txHash);
    slow.release();
    expect(await poll).toMatchObject({ txHash: payment.txHash, confirmations: 1 });
    expect(await t.session.get(pendingKey("preprod"))).toMatchObject({ txHash: moveIn.txHash, maybeSent: true });
    await expect(t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }])).rejects.toThrow(MAYBE_SENT_WAIT);
  });

  it("never writes a slow resend of one back over the watch of another", async () => {
    const t = await unlocked();
    const moveIn = await t.moveIn.build("preprod", "5000000", []);
    const payment = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    unanswered(t);
    await t.send.submit("preprod", payment.txHash);
    // Two minutes on, the worker's run sends the payment again, and Koios is slow to answer.
    await busyFor(t, 2 * 60_000);
    const slow = hold(t, "submittx");
    const watching = t.pending.watch("preprod");
    await slow.held;
    // Meanwhile the user sends it again, and the network takes it; then the move-in goes unanswered.
    expect(await t.send.submit("preprod", payment.txHash)).not.toHaveProperty("maybeSent");
    unanswered(t);
    expect(await t.moveIn.submit("preprod", moveIn.txHash)).toMatchObject({ maybeSent: true });

    // The slow resend is refused as spent (by itself).
    t.koios.rejectSubmit = SPENT;
    slow.release();
    expect(await watching).toBe(true);
    expect(await t.session.get(pendingKey("preprod"))).toMatchObject({ txHash: moveIn.txHash, maybeSent: true });
  });

  it("asks Koios once, however many pages ask at the same time", async () => {
    const t = await unlocked();
    const payment = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    unanswered(t);
    await t.send.submit("preprod", payment.txHash);
    await busyFor(t, 2 * 60_000);
    const statuses = () => t.koios.calls.filter((c) => c.path === "tx_status").length;
    const before = statuses();
    const slow = hold(t, "tx_status");
    const asked = [t.pending.pending("preprod"), t.pending.pending("preprod"), t.pending.watch("preprod")];
    await slow.held;
    await new Promise((r) => setTimeout(r, 20));
    slow.release();
    await Promise.all(asked);
    expect(statuses() - before).toBe(1);
    // Sent again once, not once a page.
    expect(ids(t)).toEqual([payment.txHash, payment.txHash]);
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
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, confirmations: 1 });
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
    expect(await t.pending.pending("preprod")).toMatchObject({ maybeSent: true });
    await expect(withdraw.build("preprod", [{ to: THEIRS, lovelace: "5000000", tokens: [] }])).rejects.toThrow(MAYBE_SENT_WAIT);
    await busyFor(t, 2 * 60_000);
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, dropped: "unseen" });
    expect(await spentSet(t.session)).toEqual(new Set());
    expect(await t.session.get(SESSION_WITHDRAW)).toBeUndefined();
    expect((await t.activity.seedelf("preprod")).map((e) => e.txHash)).not.toContain(summary.txHash);
    // Read in full again: the UTxOs it would have spent are in the balance.
    expect((await t.balances.get("preprod", true)).seedelf.lovelace).toBe(before.seedelf.lovelace);
  });
});

describe("a payment that may still go through, across a lock (final review money-submit-4)", () => {
  const SEALED = "seedelf.private.maybeSent.preprod";
  const again = (t: T) => t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);

  it("is still watched after a lock, auto-lock or a closed browser: new payments wait, and its UTxOs stay held back", async () => {
    const t = await unlocked();
    const summary = await again(t);
    unanswered(t);
    await t.send.submit("preprod", summary.txHash);
    const inputs = new Set(txInputs(t.koios.submitted[0]!));
    // Sealed on the device: nothing of it reads without the phrase.
    expect(JSON.stringify(t.local.data.get(SEALED))).not.toContain(summary.txHash);
    // It went through, and waits in a mempool: sent again, it's refused as spent.
    t.koios.rejectSubmit = SPENT;

    const locks: Array<() => Promise<unknown>> = [
      () => t.wallet.lock(),
      async () => void (t.clock.now += 16 * 60_000),
      () => t.session.clear(),
    ];
    for (const lock of locks) {
      await lock();
      await t.wallet.unlock(PASSWORD);
      // The first thing asked after the unlock is a new payment: it waits.
      await expect(again(t)).rejects.toThrow(MAYBE_SENT_WAIT);
      expect(await spentSet(t.session)).toEqual(inputs);
      expect(await t.pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, maybeSent: true });
    }

    // It lands: settled, nothing is sealed any more, and a lock forgets it.
    t.koios.confirmations = 1;
    delete t.koios.rejectSubmit;
    await expect(again(t)).resolves.toBeDefined();
    await t.wallet.lock();
    await t.wallet.unlock(PASSWORD);
    expect(await t.pending.pending("preprod")).toBeNull();
    expect(await t.store.get("maybeSent.preprod")).toBeNull();
  });

  it("is sent again by the worker's run at unlock, the network shown or not", async () => {
    const t = await unlocked();
    const summary = await again(t);
    unanswered(t);
    await t.send.submit("preprod", summary.txHash);
    await t.wallet.lock();
    t.clock.now += 5 * 60_000;
    await t.wallet.unlock(PASSWORD);
    expect(await t.pending.watch("preprod")).toBe(false);
    expect(ids(t)).toEqual([summary.txHash, summary.txHash]);
    // Taken: an ordinary sent payment, which a lock may forget.
    expect(await t.session.get(pendingKey("preprod"))).not.toHaveProperty("maybeSent");
    expect(await t.store.get("maybeSent.preprod")).toBeNull();
  });

  it("goes into the Seedelf history when a private one lands after the lock", async () => {
    const t = await unlocked();
    const withdraw = privately(t);
    const summary = await withdraw.build("preprod", [{ to: THEIRS, lovelace: "5000000", tokens: [] }]);
    unanswered(t);
    await withdraw.submit("preprod", summary.txHash);
    await t.wallet.lock();
    await t.wallet.unlock(PASSWORD);
    t.koios.confirmations = 1;
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, confirmations: 1 });
    expect(await t.activity.seedelf("preprod")).toMatchObject([{ kind: "withdraw", txHash: summary.txHash }]);
  });

  it("is let go at once when it can't land any more: past its slot, or a private one 20 minutes unseen", async () => {
    const t = await unlocked();
    const summary = await again(t);
    unanswered(t, Infinity);
    const { invalidHereafter } = await t.send.submit("preprod", summary.txHash);
    await t.wallet.lock();
    t.clock.now += 3 * 60 * 60_000;
    t.koios.tip = invalidHereafter! + EXPIRED_AFTER_SLOTS + 1;
    await t.wallet.unlock(PASSWORD);
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, dropped: "expired" });
    expect(await spentSet(t.session)).toEqual(new Set());
    expect(await t.store.get("maybeSent.preprod")).toBeNull();

    const withdraw = privately(t);
    const privateOne = await withdraw.build("preprod", [{ to: THEIRS, lovelace: "5000000", tokens: [] }]);
    await withdraw.submit("preprod", privateOne.txHash);
    await t.wallet.lock();
    t.clock.now += UNSEEN_AFTER_MS + 60_000;
    await t.wallet.unlock(PASSWORD);
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: privateOne.txHash, dropped: "unseen" });
    expect(await spentSet(t.session)).toEqual(new Set());
    await expect(again(t)).resolves.toBeDefined();
  });

  it("is deleted with the wallet", async () => {
    const t = await unlocked();
    const summary = await again(t);
    unanswered(t);
    await t.send.submit("preprod", summary.txHash);
    expect(t.local.data.has(SEALED)).toBe(true);
    await t.wallet.reset();
    expect(t.local.data.has(SEALED)).toBe(false);
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
    // It waits until the worker settles it, whatever Home's clock says: no Dismiss for a payment that may still land.
    const later = text({ ...sent, maybeSent: true }, false);
    expect(later).toContain("Payment may have gone through. Waiting for the network…");
    expect(later).not.toContain("Dismiss");
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
