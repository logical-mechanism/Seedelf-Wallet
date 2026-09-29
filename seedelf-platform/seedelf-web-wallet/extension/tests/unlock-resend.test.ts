// Nothing goes out the moment the wallet unlocks (privacy review §3.1): a
// maybe-sent payment put back from its sealed copy is only looked for by the
// unlock's run and by Home's first look, and goes again two minutes on
// (independent review L9). A private one put back within its 20 minutes
// isn't let go before it has gone again; one put back past them, however
// long ago, is let go at the first look, and nothing is sent.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { pendingKey, UNSEEN_AFTER_MS } from "../src/background/pending";
import { runNetworks, type Runner } from "../src/background/runs";
import { WithdrawService } from "../src/background/withdraw";
import { txIdOf } from "./fixtures/cbor";
import { busyFor, loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const THEIRS = account(15).preprod.receive_0 as string;

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  return t;
}

type T = Awaited<ReturnType<typeof unlocked>>;

const ids = (t: T) => t.koios.submitted.map((b) => txIdOf(b));

function unanswered(t: T, times = 1) {
  const real = t.koios.fetch;
  let left = times;
  t.koios.fetch = async (url, init) => {
    const answer = await real(url, init);
    if (url.endsWith("/submittx") && left-- > 0) throw new DOMException("signal timed out", "TimeoutError");
    return answer;
  };
}

function runner(t: T): Runner {
  return {
    networks: ["mainnet", "preprod"],
    wallet: t.wallet,
    sessions: { runAll: async () => false },
    lovejoin: { pumpPublic: async () => false, withdrawDue: async () => [], returning: async () => false },
    pending: t.pending,
  } as unknown as Runner;
}

const alarm = () => ({ start: async () => undefined, stop: async () => undefined, starts: () => 0 });

/** The withdraw service with giveme.my's witness and WebAssembly's signing stood in for, as maybe-sent.test.ts has it. */
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

describe("a maybe-sent payment, as the wallet unlocks", () => {
  it("is only looked for by the unlock's run and Home's first look, and goes again two minutes on", async () => {
    const t = await unlocked();
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    unanswered(t);
    await t.send.submit("preprod", summary.txHash);
    await t.wallet.lock();
    t.clock.now += 10 * 60_000;
    await t.wallet.unlock(PASSWORD);

    await runNetworks(runner(t), alarm(), true);
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, maybeSent: true });
    expect(ids(t)).toEqual([summary.txHash]);
    // A run a minute on still waits.
    await busyFor(t, 60_000);
    await runNetworks(runner(t), alarm());
    expect(ids(t)).toEqual([summary.txHash]);
    // Two minutes after the unlock, it goes.
    await busyFor(t, 60_000);
    await runNetworks(runner(t), alarm());
    expect(ids(t)).toEqual([summary.txHash, summary.txHash]);
  });

  it("put back within its 20 minutes, isn't let go before it has gone again, and is let go if that's unanswered", async () => {
    const t = await unlocked();
    const withdraw = privately(t);
    const summary = await withdraw.build("preprod", [{ to: THEIRS, lovelace: "5000000", tokens: [] }]);
    unanswered(t, Infinity);
    await withdraw.submit("preprod", summary.txHash);
    await t.wallet.lock();
    t.clock.now += UNSEEN_AFTER_MS - 60_000;
    await t.wallet.unlock(PASSWORD);
    expect(await t.pending.watch("preprod", true)).toBe(true);
    // Past its 20 minutes now, and not sent again yet: held.
    await busyFor(t, 90_000);
    expect(await t.pending.pending("preprod")).toMatchObject({ maybeSent: true });
    expect(ids(t)).toEqual([summary.txHash]);
    await busyFor(t, 30_000);
    // Sent again, and Koios doesn't answer that either.
    expect(await t.pending.pending("preprod")).toMatchObject({ maybeSent: true });
    expect(ids(t)).toEqual([summary.txHash, summary.txHash]);
    expect(await t.pending.pending("preprod")).toMatchObject({ dropped: "unseen" });
  });

  for (const [how, locked] of [
    ["25 minutes", UNSEEN_AFTER_MS + 5 * 60_000],
    ["a day", 24 * 60 * 60_000],
  ] as const) {
    it(`put back past its 20 minutes, locked for ${how}, is let go at the first look, and nothing is sent`, async () => {
      const t = await unlocked();
      const withdraw = privately(t);
      const summary = await withdraw.build("preprod", [{ to: THEIRS, lovelace: "5000000", tokens: [] }]);
      unanswered(t);
      await withdraw.submit("preprod", summary.txHash);
      await t.wallet.lock();
      t.clock.now += locked;
      await t.wallet.unlock(PASSWORD);
      // The unlock's run looks, and lets it go.
      expect(await t.pending.watch("preprod", true)).toBe(false);
      expect(await t.session.get(pendingKey("preprod"))).toBeUndefined();
      expect(t.local.data.has("seedelf.private.maybeSent.preprod")).toBe(false);
      await busyFor(t, 2 * 60_000);
      await runNetworks(runner(t), alarm());
      expect(ids(t)).toEqual([summary.txHash]);
    });
  }

  it("taken back when Koios refuses it, though a lock and an unlock came while it was asked", async () => {
    const t = await unlocked();
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      if (!url.endsWith("/submittx")) return real(url, init);
      await t.wallet.lock();
      await t.wallet.unlock(PASSWORD);
      // Home looks as the wallet opens: the payment is put back from its sealed copy.
      await t.pending.pending("preprod");
      return new Response("ConwayUtxowFailure (UtxoFailure (ValueNotConservedUTxO))", { status: 400 });
    };
    await expect(t.send.submit("preprod", summary.txHash)).rejects.toThrow("The network rejected the transaction");
    expect(await t.session.get(pendingKey("preprod"))).toBeUndefined();
    expect(t.local.data.has("seedelf.private.maybeSent.preprod")).toBe(false);
  });
});
