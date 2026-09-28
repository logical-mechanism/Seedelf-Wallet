// A maybe-sent payment sent again by the watch may be the copy the network
// takes: that's when it really goes out. Each time it goes again is
// recorded as the wallet's send, as lastSpentAt reads it, so Lovejoin's
// withdraws never go in the same run, or within minutes of it (independent
// review L8).
import { describe, expect, it } from "vitest";

import { runNetworks, type Runner } from "../src/background/runs";
import { lastSpentAt } from "../src/background/spent";
import { txIdOf } from "./fixtures/cbor";
import { busyFor, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const THEIRS = account(15).preprod.receive_0 as string;

async function maybeSent() {
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
  return { t, summary };
}

describe("a maybe-sent payment sent again", () => {
  it("counts as the wallet's send from then, whether the network takes it or not", async () => {
    const { t, summary } = await maybeSent();
    // Refused as spent: it's on its way already. Still the wallet's send, as far as the quiet rules go.
    t.koios.rejectSubmit = "ConwayUtxowFailure (UtxoFailure (BadInputsUTxO (fromList [])))";
    await busyFor(t, 6 * 60_000);
    const first = t.clock.now;
    expect(await t.pending.pending("preprod")).toMatchObject({ maybeSent: true });
    expect(await t.wallet.withKeys(() => lastSpentAt(t.session, t.clock.now))).toBe(first);

    // Taken this time.
    delete t.koios.rejectSubmit;
    await busyFor(t, 3 * 60_000);
    expect(await t.pending.pending("preprod")).not.toHaveProperty("maybeSent");
    expect(await t.wallet.withKeys(() => lastSpentAt(t.session, t.clock.now))).toBe(t.clock.now);
    expect(t.koios.submitted.map((b) => txIdOf(b))).toEqual([summary.txHash, summary.txHash, summary.txHash]);
  });

  it("is a send Lovejoin's withdraw sees in the same run, which begins after it", async () => {
    const { t } = await maybeSent();
    await busyFor(t, 6 * 60_000);
    const seen: Array<number | undefined> = [];
    const ctx = {
      networks: ["preprod"],
      wallet: t.wallet,
      sessions: { runAll: async () => false },
      lovejoin: {
        pumpPublic: async () => false,
        withdrawDue: async () => {
          seen.push(await t.wallet.withKeys(() => lastSpentAt(t.session, t.clock.now)));
          return [];
        },
        returning: async () => false,
      },
      pending: t.pending,
    } as unknown as Runner;
    await runNetworks(ctx, { start: async () => undefined, stop: async () => undefined, starts: () => 0 });
    // The payment went again in this run: the withdraw's rules read that, not the first send six minutes before.
    expect(seen).toEqual([t.clock.now]);
  });
});
