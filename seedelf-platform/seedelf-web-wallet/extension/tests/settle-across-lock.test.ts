// A maybe-sent payment's look that began before a lock, and was still
// waiting on Koios when the wallet locked and unlocked again, never sends it
// again the moment the wallet unlocks: it goes only while the watch still
// holds it as that look read it, and a lock takes the watch, which comes
// back as sent again just now (independent review L9, final review F7). The
// unlock's run, looking only, may join that look, and still nothing goes.
import { describe, expect, it } from "vitest";

import { MAYBE_SENT_WAIT, pendingKey } from "../src/background/pending";
import { txIdOf } from "./fixtures/cbor";
import { busyFor, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const THEIRS = account(15).preprod.receive_0 as string;

/** A payment Koios didn't answer for, due to go again: its two minutes have passed. */
async function dueAgain() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
  const real = t.koios.fetch;
  let left = 1;
  t.koios.fetch = async (url, init) => {
    const answer = await real(url, init);
    if (url.endsWith("/submittx") && left-- > 0) throw new DOMException("signal timed out", "TimeoutError");
    return answer;
  };
  expect(await t.send.submit("preprod", summary.txHash)).toMatchObject({ maybeSent: true });
  await busyFor(t, 2 * 60_000 + 5_000);
  return { t, id: summary.txHash };
}

type T = Awaited<ReturnType<typeof dueAgain>>["t"];

const ids = (t: T) => t.koios.submitted.map((b) => txIdOf(b));

/** Runs `meanwhile` the first time the watch asks tx_status, before Koios answers. */
function onFirstLook(t: T, meanwhile: () => Promise<void>) {
  const real = t.koios.fetch;
  let looked = false;
  t.koios.fetch = async (url, init) => {
    if (url.endsWith("/tx_status") && !looked) {
      looked = true;
      await meanwhile();
    }
    return real(url, init);
  };
  return () => looked;
}

describe("a maybe-sent payment's look, across a lock and an unlock", () => {
  it("sends nothing at the unlock when the unlock's run joins it, and the payment goes two minutes on", async () => {
    const { t, id } = await dueAgain();
    let unlockAt = 0;
    let unlockRun: Promise<boolean> | undefined;
    const looked = onFirstLook(t, async () => {
      await t.wallet.lock();
      t.clock.now += 30_000;
      await t.wallet.unlock(PASSWORD);
      unlockAt = t.clock.now;
      // The unlock's run: it puts the payment back, and joins the look going on.
      unlockRun = t.pending.watch("preprod", true);
      await new Promise((r) => setTimeout(r, 0));
    });
    // Home's look, begun before the lock.
    const home = await t.pending.pending("preprod");
    expect(looked()).toBe(true);
    expect(await unlockRun).toBe(true);
    expect(home).toMatchObject({ txHash: id, maybeSent: true });
    // Nothing went again: only the first try.
    expect(ids(t)).toEqual([id]);
    expect(await t.session.get(pendingKey("preprod"))).toMatchObject({ txHash: id, maybeSent: true, resentAt: unlockAt });

    // A minute after the unlock it still waits; two minutes after, it goes, and is taken.
    await busyFor(t, 60_000);
    await t.pending.pending("preprod");
    expect(ids(t)).toEqual([id]);
    await busyFor(t, 60_000);
    expect(await t.pending.pending("preprod")).not.toHaveProperty("maybeSent");
    expect(ids(t)).toEqual([id, id]);
  });

  it("sends nothing when it resumes after the unlock before anything has put the payment back", async () => {
    const { t, id } = await dueAgain();
    onFirstLook(t, async () => {
      await t.wallet.lock();
      t.clock.now += 30_000;
      await t.wallet.unlock(PASSWORD);
    });
    await t.pending.pending("preprod");
    expect(ids(t)).toEqual([id]);
    // The next look puts it back, as sent again just now, and sends nothing either.
    const back = t.clock.now;
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: id, maybeSent: true });
    expect(await t.session.get(pendingKey("preprod"))).toMatchObject({ resentAt: back });
    expect(ids(t)).toEqual([id]);
  });

  it("still refuses a new payment whose look it was: the payment is put back first", async () => {
    const { t, id } = await dueAgain();
    onFirstLook(t, async () => {
      await t.wallet.lock();
      t.clock.now += 30_000;
      await t.wallet.unlock(PASSWORD);
    });
    await expect(t.send.build("preprod", [{ to: THEIRS, lovelace: "3000000", tokens: [] }])).rejects.toThrow(MAYBE_SENT_WAIT());
    expect(await t.session.get(pendingKey("preprod"))).toMatchObject({ txHash: id, maybeSent: true });
    expect(ids(t)).toEqual([id]);
  });

  it("still sends it again when no lock came while Koios was asked", async () => {
    const { t, id } = await dueAgain();
    let joined: Promise<boolean> | undefined;
    onFirstLook(t, async () => {
      // A run's watch asks meanwhile, and joins the look.
      joined = t.pending.watch("preprod");
      await new Promise((r) => setTimeout(r, 0));
    });
    // Sent again, and taken this time.
    expect(await t.pending.pending("preprod")).not.toHaveProperty("maybeSent");
    expect(await joined).toBe(false);
    expect(ids(t)).toEqual([id, id]);
  });
});
