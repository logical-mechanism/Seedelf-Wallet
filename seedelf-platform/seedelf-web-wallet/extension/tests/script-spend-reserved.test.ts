// A private spend reviewed before a session's return through Lovejoin
// started being sent is refused at Send if it spends what that chain will
// (independent review L18): its last transaction merges into the funding
// change the spend may have taken, and only one of the two could land.
// The real WebAssembly, fakes of Koios and giveme.my.
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import { Koios } from "../src/background/koios";
import { nothingToSpend, readContract } from "../src/background/script-spend";
import { outpoint, SESSION_RESERVED_PREFIX, type Reservation } from "../src/background/spent";
import { SESSION_WITHDRAW, WithdrawService } from "../src/background/withdraw";
import { loadTestWasm, testBalances, vectors, withdrawPreprod } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const THEIRS = account(15).preprod.receive_0 as string;

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  t.koios.evaluation = withdrawPreprod.amount.evaluation;
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return t;
}
type T = Awaited<ReturnType<typeof unlocked>>;

/** The withdraw service with WebAssembly's signature stood in for, as withdraw.test.ts does. */
function withSigner(t: T, txHash: string) {
  const wasm = loadTestWasm();
  return new WithdrawService({
    wasm: {
      ...wasm,
      signScriptSpend: (_key: unknown, request: string) => JSON.stringify({ txCbor: (JSON.parse(request) as { txCbor: string }).txCbor, txHash }),
    } as typeof wasm,
    wallet: t.wallet,
    session: t.session,
    koios: () => new Koios("https://preprod.koios.rest/api/v1", t.koios.fetch, async () => undefined),
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    now: () => t.clock.now,
    coins: t.coins,
    store: t.store,
  });
}

/** A Make public, reviewed and kept for Send, and one of the private UTxOs it spends. */
async function reviewed(t: T) {
  const summary = await t.withdraw.build("preprod", [{ to: THEIRS, lovelace: "5000000", tokens: [] }]);
  const kept = (await t.session.get<{ txCbor: string }>(SESSION_WITHDRAW))!;
  const [input] = txInputs(Uint8Array.from(Buffer.from(kept.txCbor, "hex")));
  return { summary, input: input! };
}

/** Chains' reservations, by chain: each of `inputs`, sent now (no `until`), or only kept for Send until then. */
async function reserve(t: T, chains: Record<string, { inputs: string[]; until?: number }>) {
  const kept: Record<string, Reservation> = {};
  for (const [chain, { inputs, until }] of Object.entries(chains)) {
    kept[chain] = { inputs, collateral: [], ...(until !== undefined ? { until } : {}) };
  }
  await t.session.set(`${SESSION_RESERVED_PREFIX}preprod`, kept);
}

describe("a private spend kept for Send (independent review L18)", () => {
  it("is refused once a return's chain being sent spends what it does, and nothing is submitted", async () => {
    const t = await unlocked();
    const { summary, input } = await reviewed(t);
    await reserve(t, { "session:0": { inputs: [input] } });
    await expect(withSigner(t, summary.txHash).submit("preprod", summary.txHash)).rejects.toThrow(
      "spends a UTxO a chain through Lovejoin, sent since you reviewed it, spends too. Review it again.",
    );
    expect(t.koios.submitted).toHaveLength(0);
  });

  it("goes when the chain is only kept for Send, or spends something else", async () => {
    const t = await unlocked();
    const { summary, input } = await reviewed(t);
    // One built and kept for Send, not sent: its pool boxes alone count. Another, sent, spends something else.
    await reserve(t, {
      "session:0": { inputs: [input], until: t.clock.now + 60_000 },
      "session:1": { inputs: [`${"ee".repeat(32)}#0`] },
    });
    await withSigner(t, summary.txHash).submit("preprod", summary.txHash);
    expect(t.koios.submitted).toHaveLength(1);
  });

  it("goes once the chain being sent is over", async () => {
    const t = await unlocked();
    const { summary, input } = await reviewed(t);
    await reserve(t, { "session:0": { inputs: [input] } });
    const service = withSigner(t, summary.txHash);
    await expect(service.submit("preprod", summary.txHash)).rejects.toThrow("Review it again");
    await t.session.remove(`${SESSION_RESERVED_PREFIX}preprod`);
    await service.submit("preprod", summary.txHash);
    expect(t.koios.submitted).toHaveLength(1);
  });
});

describe("a payment's parts still to go (1.6.0 review: parts-reservation-blamed-on-lovejoin)", () => {
  /** What a payment's parts still to go reserve is named after its first part (parts.ts). */
  const PARTS = `parts.${"ee".repeat(32)}`;

  it("are named as what holds a kept spend, never a chain through Lovejoin", async () => {
    const t = await unlocked();
    const { summary, input } = await reviewed(t);
    await reserve(t, { [PARTS]: { inputs: [input] } });
    const service = withSigner(t, summary.txHash);
    await expect(service.submit("preprod", summary.txHash)).rejects.toThrow(
      "That payment spends a UTxO that a payment still being sent in parts spends too. Review it again.",
    );
    // A return through Lovejoin holding it as well is one: said as that.
    await reserve(t, { [PARTS]: { inputs: [input] }, "session:0": { inputs: [input] } });
    await expect(service.submit("preprod", summary.txHash)).rejects.toThrow("a chain through Lovejoin");
    expect(t.koios.submitted).toHaveLength(0);
  });

  it("are what Max leaves out, and what the private balance waits for, in words of their own", async () => {
    const t = await unlocked();
    const deps = { ...t.deps, collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch) };
    const [held, ...rest] = (await readContract(deps, "preprod")).utxos;
    await reserve(t, { [PARTS]: { inputs: [outpoint(held!)] } });
    const max = await t.withdraw.build("preprod", [{ to: THEIRS, lovelace: null, tokens: [] }]);
    expect(max.leftOut).toEqual([{ txHash: held!.tx_hash, txIndex: held!.tx_index, reason: "parts" }]);

    // With the rest locked, nothing pays, and the error says what the private balance waits for.
    for (const u of rest) await t.coins.setLocked("preprod", "seedelf", outpoint(u), true);
    await expect(t.withdraw.build("preprod", [{ to: THEIRS, lovelace: "1000000", tokens: [] }])).rejects.toThrow(
      "Every UTxO in your private balance is locked, or waits for a payment still being sent in parts.",
    );
    const read = await readContract(deps, "preprod");
    expect(read.waiting.map(outpoint)).toEqual([outpoint(held!)]);
    const only = { ...read.view, owned: read.view.owned.filter((u) => outpoint(u) === outpoint(held!)) };
    expect(nothingToSpend({}, only, "Your private balance is empty.", read.returning, read.waiting).message).toBe(
      "Your private balance waits for a payment still being sent in parts. Try again once it's all sent.",
    );
    // Beside a return through Lovejoin, that's what it says.
    const [other] = rest;
    await reserve(t, { [PARTS]: { inputs: [outpoint(held!)] }, "session:0": { inputs: [outpoint(other!)] } });
    const both = await readContract(deps, "preprod");
    expect(nothingToSpend({}, both.view, "Your private balance is empty.", both.returning, both.waiting).message).toContain(
      "a return through Lovejoin",
    );
  });
});
