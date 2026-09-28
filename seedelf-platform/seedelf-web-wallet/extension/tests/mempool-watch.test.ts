// A private payment Koios didn't answer, whose every resend is refused as
// spending what's spent while the chain still shows what it spends unspent,
// is waiting in a mempool: it may still land, so it's never let go as
// unseen on age. Once something it spends shows spent on chain, and
// tx_status doesn't know it, the 20 minutes apply again (independent review
// L1).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import { MAYBE_SENT_WAIT, pendingKey, UNSEEN_AFTER_MS } from "../src/background/pending";
import { spentSet } from "../src/background/spent";
import { WithdrawService } from "../src/background/withdraw";
import type { PendingTx } from "../src/shared/rpc";
import { PendingBanner } from "../src/ui/components/PendingBanner";
import { txIdOf } from "./fixtures/cbor";
import { busyFor, loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const THEIRS = account(15).preprod.receive_0 as string;
const SPENT = "ConwayUtxowFailure (UtxoFailure (BadInputsUTxO (fromList [])))";

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  return t;
}

type T = Awaited<ReturnType<typeof unlocked>>;

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

/** A private Make public whose submit Koios didn't answer, and which the network has since: every resend is refused as spent. */
async function inAMempool(t: T) {
  const withdraw = privately(t);
  const summary = await withdraw.build("preprod", [{ to: THEIRS, lovelace: "5000000", tokens: [] }]);
  const real = t.koios.fetch;
  let first = true;
  t.koios.fetch = async (url, init) => {
    const answer = await real(url, init);
    if (url.endsWith("/submittx") && first) {
      first = false;
      throw new DOMException("signal timed out", "TimeoutError");
    }
    return answer;
  };
  expect(await withdraw.submit("preprod", summary.txHash)).toMatchObject({ maybeSent: true });
  t.koios.rejectSubmit = SPENT;
  return { withdraw, summary, inputs: txInputs(t.koios.submitted[0]!) };
}

describe("a maybe-sent private payment the network says it has", () => {
  it("is held past 20 minutes while the chain shows what it spends unspent, and says it may still land", async () => {
    const t = await unlocked();
    const { withdraw, summary, inputs } = await inAMempool(t);
    for (let minutes = 2; minutes <= 30; minutes += 2) {
      await busyFor(t, 2 * 60_000);
      const pending = await t.pending.pending("preprod");
      expect(pending).toMatchObject({ txHash: summary.txHash, maybeSent: true, inMempool: true });
      expect(pending).not.toHaveProperty("dropped");
    }
    expect(await spentSet(t.session)).toEqual(new Set(inputs));
    await expect(withdraw.build("preprod", [{ to: THEIRS, lovelace: "5000000", tokens: [] }])).rejects.toThrow(MAYBE_SENT_WAIT);
    // It lands at last: into the history, and new payments go ahead.
    t.koios.confirmations = 1;
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, confirmations: 1 });
    expect(await t.activity.seedelf("preprod")).toMatchObject([{ kind: "withdraw", txHash: summary.txHash }]);
  });

  it("is let go as unseen once something it spends shows spent on chain and tx_status doesn't know it", async () => {
    const t = await unlocked();
    const { summary, inputs } = await inAMempool(t);
    await busyFor(t, UNSEEN_AFTER_MS - 60_000);
    expect(await t.pending.pending("preprod")).toMatchObject({ inMempool: true });
    // Another transaction spent it: the next resend finds it so.
    for (const o of inputs) t.koios.spent.add(o);
    await busyFor(t, 2 * 60_000);
    expect(await t.pending.pending("preprod")).not.toHaveProperty("inMempool");
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, dropped: "unseen" });
    expect(await spentSet(t.session)).toEqual(new Set());
  });

  it("stays held across a lock: waiting in a mempool is sealed with it", async () => {
    const t = await unlocked();
    const { summary } = await inAMempool(t);
    await busyFor(t, 2 * 60_000);
    expect(await t.pending.pending("preprod")).toMatchObject({ inMempool: true });
    await t.wallet.lock();
    t.clock.now += UNSEEN_AFTER_MS;
    await t.wallet.unlock(PASSWORD);
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, maybeSent: true, inMempool: true });
    expect(await t.session.get(pendingKey("preprod"))).not.toHaveProperty("dropped");
  });

  it("is held while Koios can't say what it spends: only a UTxO shown spent lets it go", async () => {
    const t = await unlocked();
    const { summary } = await inAMempool(t);
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => (url.endsWith("/utxo_info") ? new Response("", { status: 503 }) : real(url, init));
    for (let minutes = 2; minutes <= UNSEEN_AFTER_MS / 60_000 + 4; minutes += 2) {
      await busyFor(t, 2 * 60_000);
      const pending = await t.pending.pending("preprod");
      expect(pending).toMatchObject({ txHash: summary.txHash, inMempool: true });
      expect(pending).not.toHaveProperty("dropped");
    }
  });
});

describe("Home's banner for one waiting in a mempool", () => {
  it("says it may still land, and never that it will be let go at 20 minutes", () => {
    const pending: PendingTx = {
      kind: "withdraw",
      network: "preprod",
      txHash: "ab".repeat(32),
      submittedAt: 0,
      confirmations: null,
      maybeSent: true,
      inMempool: true,
    };
    const text = renderToStaticMarkup(createElement(PendingBanner, { pending, watching: true, onDismiss: () => undefined }))
      .replace(/<[^>]+>/g, " ")
      .replaceAll("&#x27;", "'")
      .replace(/\s+/g, " ");
    expect(text).toContain("may have gone through");
    expect(text).toContain("it's waiting to go into a block, and may still land");
    expect(text).not.toContain("20 minutes");
    expect(text).not.toContain("Dismiss");
  });
});
