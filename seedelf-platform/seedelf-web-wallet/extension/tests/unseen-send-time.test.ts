// A maybe-sent private payment let go as unseen frees what it spends, but
// its last try, a minute or two before, may still have reached a node: when
// that was stays the wallet's last send, so Lovejoin's withdraws keep away
// from it as from any other (QUIET_AFTER_SEND_MS), in the same run too, and
// a lock keeps it (independent review L8, final review F8).
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { txInputs } from "../src/background/cbor";
import { QUIET_AFTER_SEND_MS } from "../src/background/lovejoin";
import { pendingKey } from "../src/background/pending";
import { runNetworks, type Runner } from "../src/background/runs";
import { spentSet } from "../src/background/spent";
import { noteStart } from "../src/background/wallet";
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

/**
 * A private payment Koios never answers for, sent again every two minutes
 * and ten seconds while tx_status doesn't know it, up to the look that lets
 * it go: its hash, inputs, and when it last went.
 */
async function triedUnseen(t: T) {
  const withdraw = privately(t);
  const summary = await withdraw.build("preprod", [{ to: THEIRS, lovelace: "5000000", tokens: [] }]);
  const real = t.koios.fetch;
  t.koios.fetch = async (url, init) => {
    const answer = await real(url, init);
    if (url.endsWith("/submittx")) throw new DOMException("signal timed out", "TimeoutError");
    return answer;
  };
  const sent = await withdraw.submit("preprod", summary.txHash);
  // No slot: only the 20 minutes unseen let it go.
  expect(sent).toMatchObject({ maybeSent: true });
  expect(sent).not.toHaveProperty("invalidHereafter");
  const inputs = txInputs(t.koios.submitted[0]!);
  let lastTry = 0;
  for (let i = 0; i < 9; i++) {
    await busyFor(t, 2 * 60_000 + 10_000);
    expect(await t.pending.pending("preprod")).toMatchObject({ maybeSent: true });
    lastTry = t.clock.now;
  }
  expect(t.koios.submitted.map((b) => txIdOf(b))).toEqual(Array(10).fill(summary.txHash));
  return { id: summary.txHash, inputs, lastTry };
}

describe("a maybe-sent private payment let go as unseen", () => {
  it("frees what it spends, and its last try stays the wallet's last send", async () => {
    const t = await unlocked();
    const { inputs, lastTry } = await triedUnseen(t);
    await busyFor(t, 2 * 60_000 + 10_000);
    expect(await t.pending.pending("preprod")).toMatchObject({ dropped: "unseen" });
    expect(t.clock.now - lastTry).toBeLessThan(QUIET_AFTER_SEND_MS);

    const spent = await t.wallet.withKeys(() => spentSet(t.session, t.clock.now));
    for (const o of inputs) expect(spent.has(o)).toBe(false);
    expect((await t.wallet.sends()).sent).toBe(lastTry);

    // A lock keeps it.
    await t.wallet.lock();
    await t.wallet.unlock(PASSWORD);
    expect((await t.wallet.sends()).sent).toBe(lastTry);
  });

  it("is a send Lovejoin's withdraw sees in the run that lets it go", async () => {
    const t = await unlocked();
    const { id, lastTry } = await triedUnseen(t);
    await busyFor(t, 2 * 60_000 + 10_000);
    const seen: number[] = [];
    const ctx = {
      networks: ["preprod"],
      wallet: t.wallet,
      sessions: { runAll: async () => false },
      lovejoin: {
        pumpPublic: async () => false,
        withdrawDue: async () => void seen.push((await t.wallet.sends()).sent),
        returning: async () => false,
      },
      pending: t.pending,
    } as unknown as Runner;
    await runNetworks(ctx, { start: async () => undefined, stop: async () => undefined, starts: () => 0 });
    expect(await t.session.get(pendingKey("preprod"))).toBeUndefined();
    expect(t.koios.submitted.map((b) => txIdOf(b))).toEqual(Array(10).fill(id));
    // Let go before the withdraw's turn: its last try, two minutes before, still counts.
    expect(seen).toEqual([lastTry]);
  });

  it("keeps when session storage began, as noted at the worker's start", async () => {
    const t = await unlocked();
    const started = t.clock.now - 60 * 60_000;
    await noteStart(t.session, started);
    const { lastTry } = await triedUnseen(t);
    await busyFor(t, 2 * 60_000 + 10_000);
    expect(await t.pending.pending("preprod")).toMatchObject({ dropped: "unseen" });
    expect(await t.wallet.sends()).toEqual({ sent: lastTry, forgotten: started });
  });
});
