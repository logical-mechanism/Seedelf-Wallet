// A Lovejoin box's withdraw as it's sent: kept, sealed, before Koios is
// asked, so a lock or a closed browser meanwhile never loses it (independent
// review M1); a 429 or a refusal isn't a withdraw that may have gone through
// (M11); and one that may have is sent again only under a new withdraw's
// timing rules, each resend counting as the wallet's send (M11, L8), and a
// fresh draw into an unlock. None is sent when the wallet locked and
// unlocked while it was built (L11). The real WebAssembly, a recorded
// preprod pool, and fakes of Koios and giveme.my.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { CHAIN_RESEND_MS, LovejoinService, QUIET_AFTER_SEND_MS, QUIET_PUSH_MS, UNLOCK_WAIT_MS } from "../src/background/lovejoin";
import { SESSION_SENT_PREFIX } from "../src/background/sent-txs";
import { lastSpentAt, SESSION_SPENT, spentSet } from "../src/background/spent";
import { SESSION_UNLOCKED_AT } from "../src/background/wallet";
import { txIdOf } from "./fixtures/cbor";
import { bytes, swapTx } from "./fixtures/swap-tx";
import { busyFor, loadTestWasm, madeByMix, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
const PHRASE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase;
/** Each withdraw is built and measured in WebAssembly: past Vitest's 5 s on CI's runners. */
const SLOW = { timeout: 30_000 };

/** Lovejoin's preprod pool, as Koios lists it (2026-09-25). */
const POOL = (
  JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }
).pool;

type T = ReturnType<typeof testBalances>;

interface Kept {
  due: number[];
  marks?: Record<string, { unlock?: true; pushes?: number }>;
  withdrawing?: { txHash: string; sentAt: number; waitUntil?: number; pushes?: number; unlock?: true };
}
const kept = async (t: T) => (await t.store.get<Kept>("lovejoin.preprod"))!;
/** The transactions kept as sent on preprod (sent-txs.ts), whatever their age. Call it while unlocked. */
const sentKept = async (t: T) => (await t.session.get<unknown[]>(`${SESSION_SENT_PREFIX}preprod`)) ?? [];

/** A box of ours in the pool: a fresh re-randomization of the Seedelf key's register. */
async function ownedBox(t: T, tx: string): Promise<KoiosUtxo> {
  const wasm = loadTestWasm();
  const datum = await t.wallet.withKeys((keys) => wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister())));
  // Someone else's mix moved it: Koios says so, as the wallet asks before it takes a box no record accounts for (M14).
  madeByMix(t.koios, tx.repeat(32));
  return { ...POOL[0]!, tx_hash: tx.repeat(32), tx_index: 0, inline_datum: { bytes: Buffer.from(datum).toString("hex"), value: {} } };
}

/**
 * An unlocked wallet, unlocked an hour ago with its unlock's draws made, with
 * Lovejoin's pool and `boxes` boxes of its own in it, all due; and Lovejoin
 * with giveme.my's witness stood in for, so a withdraw that goes is submitted.
 */
async function due(boxes = 1) {
  const t = testBalances();
  await t.wallet.create(PHRASE, PASSWORD);
  const owned = await Promise.all(["e1", "e2"].slice(0, boxes).map((tx) => ownedBox(t, tx)));
  t.koios.addedToAccounts.push(...POOL, ...owned);
  const unlocked = t.clock.now - HOUR;
  await t.wallet.withKeys(() => t.session.set(SESSION_UNLOCKED_AT, unlocked));
  await t.store.set("lovejoin.preprod", { due: owned.map(() => t.clock.now - HOUR), unlock: unlocked });
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  const lovejoin = new LovejoinService({
    ...t.deps,
    wasm: {
      ...wasm,
      finishLovejoinWithdraw: (request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
  });
  return { t, lovejoin, box: `${"e1".repeat(32)}#0` };
}

/**
 * Koios's submit answers as `answer` says, given its node's answer when it
 * `passes` the transaction on, with `meanwhile` run before it answers.
 */
function submitting(
  t: T,
  answer: (taken?: Response) => Response,
  { passes = true, meanwhile = async (): Promise<void> => undefined } = {},
) {
  const real = t.koios.fetch;
  t.koios.fetch = async (url, init) => {
    if (!url.endsWith("/submittx")) return real(url, init);
    const taken = passes ? await real(url, init) : undefined;
    await meanwhile();
    return answer(taken);
  };
  return () => {
    t.koios.fetch = real;
  };
}

describe("a withdraw kept before it's sent (independent review M1)", SLOW, () => {
  for (const koios of ["doesn't answer", "takes it"] as const) {
    it(`leaves it looked for when the wallet locks while Koios ${koios}, and writes its history once it's seen`, async () => {
      const { t, lovejoin, box } = await due();
      // The wallet locks (the Lock button, the auto-lock, a closed browser) while Koios is asked.
      const undo = submitting(t, (taken) => (koios === "takes it" ? taken! : new Response("", { status: 504 })), {
        meanwhile: () => t.wallet.lock(),
      });
      await lovejoin.withdrawDue("preprod", false, t.clock.now).catch(() => undefined);
      undo();
      const sent = txIdOf(t.koios.submitted.at(-1)!);
      await t.wallet.unlock(PASSWORD);
      // Sealed before Koios was asked: it's there after the lock.
      expect((await kept(t)).withdrawing?.txHash).toBe(sent);
      // Looked for first: nothing else goes back while it may be on its way, and its box is held again.
      t.koios.missing.add(sent);
      await busyFor(t, 60_000);
      await lovejoin.withdrawDue("preprod", false, t.clock.now);
      expect(t.collateral.asked).toHaveLength(1);
      expect(await t.wallet.withKeys(() => spentSet(t.session, t.clock.now))).toContain(box);
      // Seen: in the history, and no longer looked for.
      t.koios.missing.delete(sent);
      t.koios.confirmations = 1;
      await lovejoin.withdrawDue("preprod", false, t.clock.now);
      expect((await kept(t)).withdrawing).toBeUndefined();
      expect((await t.activity.seedelf("preprod")).some((e) => e.txHash === sent)).toBe(true);
    });
  }

  it("keeps it looked for when Koios's answer breaks off after it took it: that isn't a refusal", async () => {
    const { t, lovejoin, box } = await due();
    // Koios passes it on, and its answer's body times out as it's read.
    const undo = submitting(
      t,
      () =>
        new Response(
          new ReadableStream({
            start: (c) => c.error(new DOMException("The operation timed out.", "TimeoutError")),
          }),
          { status: 202 },
        ),
    );
    expect(await lovejoin.withdrawDue("preprod", false, t.clock.now)).toEqual([]);
    undo();
    const sent = txIdOf(t.koios.submitted.at(-1)!);
    expect((await kept(t)).withdrawing?.txHash).toBe(sent);
    expect((await kept(t)).due).toEqual([]);
    expect(await t.wallet.withKeys(() => spentSet(t.session, t.clock.now))).toContain(box);
  });

  it("forgets it when the network refuses it: nothing went, its box is free, and its due time stays", async () => {
    const { t, lovejoin, box } = await due();
    t.koios.rejectSubmit = "ScriptFailures";
    const before = (await kept(t)).due;
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(t.collateral.asked).toHaveLength(1);
    expect((await kept(t)).withdrawing).toBeUndefined();
    expect((await kept(t)).due).toEqual(before);
    expect(await t.wallet.withKeys(() => spentSet(t.session, t.clock.now))).not.toContain(box);
    expect(await t.wallet.withKeys(() => lastSpentAt(t.session, t.clock.now))).toBeUndefined();
    // Nor kept as sent: the withdraw drawn again on its box counts alone as on its way back, rather than neither of
    // two spending one box (incoming.ts, chunk 23's second review, fix round).
    expect(await t.wallet.withKeys(() => sentKept(t))).toEqual([]);
  });

  it("is kept no more once it's sent, and its history is written then", async () => {
    const { t, lovejoin } = await due();
    const [pending] = await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(pending?.txHash).toBe(txIdOf(t.koios.submitted.at(-1)!));
    expect((await kept(t)).withdrawing).toBeUndefined();
    expect((await t.activity.seedelf("preprod")).some((e) => e.txHash === pending!.txHash)).toBe(true);
  });
});

describe("a withdraw built across a lock and an unlock (independent review L11)", SLOW, () => {
  it("isn't sent: its due time stays, and waits the new unlock's fresh draw", async () => {
    const { t, lovejoin } = await due();
    const before = (await kept(t)).due;
    // The wallet locks, and is unlocked again, while giveme.my answers.
    const witness = t.collateral.fetch;
    t.collateral.fetch = async (url, init) => {
      await t.wallet.lock();
      t.clock.now += 20_000;
      await t.wallet.unlock(PASSWORD);
      return witness(url, init);
    };
    const submits = t.koios.submitted.length;
    expect(await lovejoin.withdrawDue("preprod", false, t.clock.now)).toEqual([]);
    t.collateral.fetch = witness;
    expect(t.koios.submitted).toHaveLength(submits);
    expect((await kept(t)).withdrawing).toBeUndefined();
    expect((await kept(t)).due).toEqual(before);
    // The next run draws it a fresh wait from the unlock.
    const unlocked = t.clock.now;
    await busyFor(t, 60_000);
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(t.koios.submitted).toHaveLength(submits);
    const [drawn] = (await kept(t)).due;
    expect(drawn).toBeGreaterThanOrEqual(unlocked + UNLOCK_WAIT_MS[0]);
  });
});

describe("a withdraw Koios turned away (independent review M11)", SLOW, () => {
  it("isn't one that may have gone through: a 429 keeps its due time, and a later run sends it", async () => {
    const { t, lovejoin, box } = await due();
    const before = (await kept(t)).due;
    // Koios's gateway answers 429 before passing anything on.
    const undo = submitting(t, () => new Response("", { status: 429 }), { passes: false });
    expect(await lovejoin.withdrawDue("preprod", false, t.clock.now)).toEqual([]);
    undo();
    expect(t.collateral.asked).toHaveLength(1);
    expect((await kept(t)).withdrawing).toBeUndefined();
    expect((await kept(t)).due).toEqual(before);
    expect(await t.wallet.withKeys(() => spentSet(t.session, t.clock.now))).not.toContain(box);
    expect(await t.wallet.withKeys(() => sentKept(t))).toEqual([]);
    // The next minute's run tries it again, and it goes.
    await busyFor(t, 60_000);
    const [pending] = await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(pending?.txHash).toBe(txIdOf(t.koios.submitted.at(-1)!));
    expect((await kept(t)).due).toEqual([]);
  });
});

describe("a withdraw that may have gone through, sent again (independent review M11, L8)", SLOW, () => {
  /** A withdraw Koios didn't answer, sent `ago` ms before now, and not on chain yet. */
  async function maybeSent(t: T, ago: number) {
    const cbor = swapTx();
    const txHash = txIdOf(bytes(cbor));
    const at = t.clock.now - ago;
    const kept = (await t.store.get<object>("lovejoin.preprod")) ?? {};
    await t.store.set("lovejoin.preprod", { ...kept, withdrawing: { txHash, txCbor: cbor, lovelace: "9700000", fee: "300000", at, sentAt: at } });
    await t.wallet.withKeys(() => t.session.set(SESSION_SPENT, { [txInputs(bytes(cbor))[0]!]: at }));
    t.koios.missing.add(txHash);
    return txHash;
  }
  const resent = (t: T, txHash: string) => t.koios.submitted.filter((b) => txIdOf(b) === txHash).length;
  const paid = (t: T, at: number) =>
    t.wallet.withKeys(async () => {
      const spent = (await t.session.get<Record<string, number>>(SESSION_SPENT)) ?? {};
      await t.session.set(SESSION_SPENT, { ...spent, [`${"9a".repeat(32)}#0`]: at });
    });

  it("never in a run that sent something else, nor minutes after the wallet's own send: it's pushed a fresh few minutes", async () => {
    const { t, lovejoin } = await due();
    const txHash = await maybeSent(t, 4 * 60_000);
    // This run sent a payment a moment ago: it isn't sent again, nor pushed.
    const payment = t.clock.now - 2_000;
    await paid(t, payment);
    await lovejoin.withdrawDue("preprod", false, t.clock.now - 5_000);
    expect(resent(t, txHash)).toBe(0);
    expect((await kept(t)).withdrawing?.waitUntil).toBeUndefined();
    // The next run, the payment a minute behind: it waits a fresh 3 to 10 minutes.
    await busyFor(t, 60_000);
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(resent(t, txHash)).toBe(0);
    const { waitUntil, pushes } = (await kept(t)).withdrawing!;
    expect(pushes).toBe(1);
    expect(waitUntil).toBeGreaterThanOrEqual(t.clock.now + QUIET_PUSH_MS[0]);
    expect(waitUntil).toBeLessThanOrEqual(t.clock.now + QUIET_PUSH_MS[1]);
    // Not before then.
    await busyFor(t, waitUntil! - t.clock.now - 1_000);
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(resent(t, txHash)).toBe(0);
    // Then, the payment five minutes behind, it goes, and its wait is done with.
    await busyFor(t, Math.max(waitUntil!, payment + QUIET_AFTER_SEND_MS) - t.clock.now);
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(resent(t, txHash)).toBe(1);
    expect((await kept(t)).withdrawing).toMatchObject({ sentAt: t.clock.now });
    expect((await kept(t)).withdrawing?.waitUntil).toBeUndefined();
  });

  it("goes again every few minutes while nothing else was sent: its own last send isn't another's", async () => {
    const { t, lovejoin } = await due();
    const txHash = await maybeSent(t, CHAIN_RESEND_MS);
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(resent(t, txHash)).toBe(1);
    await busyFor(t, CHAIN_RESEND_MS);
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(resent(t, txHash)).toBe(2);
  });

  it("counts each resend as the wallet's send: a box due once it's seen waits the quiet after it (L8)", async () => {
    const { t, lovejoin } = await due();
    const txHash = await maybeSent(t, 10 * 60_000);
    // Sent again: the wallet's last send is now.
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(resent(t, txHash)).toBe(1);
    expect(await t.wallet.withKeys(() => lastSpentAt(t.session, t.clock.now))).toBe(t.clock.now);
    // It's seen a minute later; the box due doesn't go back a minute after that send, it's pushed.
    await busyFor(t, 60_000);
    t.koios.missing.delete(txHash);
    t.koios.confirmations = 1;
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect((await kept(t)).withdrawing).toBeUndefined();
    expect(t.collateral.asked).toHaveLength(0);
    const [pushed] = (await kept(t)).due;
    expect(pushed).toBeGreaterThanOrEqual(t.clock.now + QUIET_PUSH_MS[0]);
    // Once the resend is as far behind as any send must be, it goes.
    await busyFor(t, Math.max(pushed!, t.clock.now - 60_000 + QUIET_AFTER_SEND_MS) - t.clock.now);
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(t.collateral.asked).toHaveLength(1);
  });

  it("waits a fresh draw into the unlock after a lock, rather than go a minute in, and keeps the alarm for it", async () => {
    const { t, lovejoin } = await due();
    const txHash = await maybeSent(t, 10 * 60_000);
    await t.wallet.lock();
    t.clock.now += HOUR;
    await t.wallet.unlock(PASSWORD);
    const unlocked = t.clock.now;
    // The unlock's run only looks for it, and draws its wait.
    await lovejoin.withdrawDue("preprod", true);
    expect(resent(t, txHash)).toBe(0);
    const { waitUntil, unlock } = (await kept(t)).withdrawing!;
    expect(unlock).toBe(true);
    expect(waitUntil).toBeGreaterThanOrEqual(unlocked + UNLOCK_WAIT_MS[0]);
    // With no box due, the alarm still runs for it.
    expect(await lovejoin.returning("preprod")).toBe(true);
    // Not the next minute's run: at its draw.
    await busyFor(t, 60_000);
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(resent(t, txHash)).toBe(0);
    await busyFor(t, waitUntil! - t.clock.now);
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(resent(t, txHash)).toBe(1);
    expect((await kept(t)).withdrawing).toMatchObject({ sentAt: t.clock.now });
    expect((await kept(t)).withdrawing?.unlock).toBeUndefined();
  });

  it("is sent again at once when the user asks for a box back, and says it may still be on its way", async () => {
    const { t, lovejoin } = await due();
    const txHash = await maybeSent(t, 4 * 60_000);
    await paid(t, t.clock.now - 2_000);
    await expect(lovejoin.withdrawNow("preprod")).rejects.toThrow("may still be on its way");
    expect(resent(t, txHash)).toBe(1);
  });
});
