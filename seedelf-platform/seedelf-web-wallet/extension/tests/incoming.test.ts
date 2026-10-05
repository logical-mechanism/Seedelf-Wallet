// What the wallet's own sent transactions pay back before the chain shows them
// (chunk 23's second review, HM-1, HM-2): a payment's change, once a reading
// leaves out what it spent, and a Make private's deposit, from what the device
// keeps. Never counted twice, never for one that didn't go out, and no request.
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import { SESSION_CONTRACT_PREFIX } from "../src/background/contract-scan";
import { forgetSpent } from "../src/background/spent";
import { TransferService } from "../src/background/transfer";
import { koiosPreprod, loadTestWasm, testBalances, transferPreprod, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
/** The 15-word phrase's receive address: someone else's. */
const THEIRS = account(15).preprod.receive_0 as string;

const TUSDM = { policyId: "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9", assetName: "0014df10745553444d" };

/** On the device's real clock: what's sent is timed by it (sent-txs.ts), and a reading by the wallet's. */
async function unlocked() {
  const t = testBalances();
  t.clock.now = Date.now();
  await t.wallet.create(account(12).phrase, PASSWORD);
  return t;
}

describe("what the wallet's own transactions pay back", () => {
  it("counts a payment's change once a reading leaves out what it spent, and only then", async () => {
    const t = await unlocked();
    const before = await t.balances.get("preprod");
    expect(before.cardano.incoming).toBeUndefined();
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    await t.send.submit("preprod", summary.txHash);
    const asked = t.koios.calls.length;

    // The reading from before the payment still counts what it spent: adding the change would count it twice.
    expect((await t.balances.get("preprod")).cardano.incoming).toBeUndefined();
    expect(t.koios.calls).toHaveLength(asked);

    // A reading after it leaves the spent UTxOs out, and the change is on its way back: the balance doesn't collapse.
    t.clock.now = Date.now() + 60_000;
    const after = await t.balances.get("preprod", true);
    const incoming = after.cardano.incoming!;
    expect(incoming.utxos).toBe(1);
    expect(BigInt(after.cardano.lovelace) + BigInt(incoming.lovelace)).toBe(
      BigInt(before.cardano.lovelace) + BigInt(summary.withdrawal ?? "0") - 2_000_000n - BigInt(summary.fee),
    );
    // The tokens that came back with the change stay listed.
    const held = (b: typeof before) => new Map(b.cardano.tokens.map((x) => [`${x.policyId}.${x.assetName}`, BigInt(x.quantity)]));
    const was = held(before);
    const now = held(after);
    for (const token of incoming.tokens) now.set(`${token.policyId}.${token.assetName}`, (now.get(`${token.policyId}.${token.assetName}`) ?? 0n) + BigInt(token.quantity));
    expect(now).toEqual(was);
    expect(after.seedelf.incoming).toBeUndefined();

    // Freed, as one that never went out is: nothing is on its way.
    await t.wallet.withKeys(() => forgetSpent(t.session, txInputs(t.koios.submitted[0]!)));
    expect((await t.balances.get("preprod")).cardano.incoming).toBeUndefined();
  });

  it("counts a Make private's deposit on the private side at once, which lost nothing to it", async () => {
    const t = await unlocked();
    const before = await t.balances.get("preprod");
    const summary = await t.moveIn.build("preprod", "5000000", []);
    await t.moveIn.submit("preprod", summary.txHash);
    const b = await t.balances.get("preprod");
    expect(b.seedelf.incoming).toEqual({ lovelace: "5000000", tokens: [], utxos: 1 });
    expect(b.seedelf.lovelace).toBe(before.seedelf.lovelace);
    // The public side's reading is from before: it still counts what the deposit spent.
    expect(b.cardano.incoming).toBeUndefined();
  });
});

describe("what's never counted twice (chunk 23's second review, fix round)", () => {
  /** Holds every Koios answer but a submit's until `release`: a reading that waits on Koios while a payment goes. */
  const held = (t: Awaited<ReturnType<typeof unlocked>>) => {
    let release!: () => void;
    t.koios.hold = new Promise((r) => (release = r));
    return async () => {
      release();
      t.koios.hold = undefined;
    };
  };
  const tick = () => new Promise((r) => setTimeout(r, 10));

  it("counts neither of two sent transactions that spend the same UTxO: only one of them can land", async () => {
    const t = await unlocked();
    await t.balances.get("preprod");
    const first = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    await t.send.submit("preprod", first.txHash);
    // Let go unseen, its UTxOs freed and kept as sent, and a second payment built on them.
    const spends = txInputs(t.koios.submitted[0]!);
    await t.wallet.withKeys(() => forgetSpent(t.session, spends));
    const second = await t.send.build("preprod", [{ to: THEIRS, lovelace: "3000000", tokens: [] }]);
    await t.send.submit("preprod", second.txHash);
    expect(txInputs(t.koios.submitted[1]!).some((o) => spends.includes(o))).toBe(true);

    t.clock.now = Date.now() + 60_000;
    const after = await t.balances.get("preprod", true);
    expect(after.cardano.incoming).toBeUndefined();
  });

  it("leaves a payment's change out of a reading that began before it, however late that reading ended", async () => {
    const t = await unlocked();
    const before = await t.balances.get("preprod");
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    const release = held(t);
    const reading = t.balances.get("preprod", true);
    await tick();
    // Sent while the reading waits on Koios: it took what's spent before, so it still lists, and counts, what this spent.
    await t.send.submit("preprod", summary.txHash);
    t.clock.now = Date.now() + 60_000;
    await release();
    const b = await reading;
    expect(b.cardano.lovelace).toBe(before.cardano.lovelace);
    expect(b.cardano.incoming).toBeUndefined();
  });

  it("tells the private side's change by when the reading began, not when it ended", async () => {
    const t = await unlocked();
    await t.balances.get("preprod");
    const summary = await t.transfer.build("preprod", [{ to: transferPreprod.to, lovelace: transferPreprod.lovelace, tokens: transferPreprod.tokens }]);
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    const wasm = loadTestWasm();
    const transfer = new TransferService({
      ...t.deps,
      wasm: { ...wasm, signScriptSpend: (_key: unknown, r: string) => JSON.stringify({ txCbor: JSON.parse(r).txCbor, txHash: summary.txHash }) } as typeof wasm,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    });
    const release = held(t);
    const reading = t.balances.get("preprod", true);
    await tick();
    await transfer.submit("preprod", summary.txHash);
    t.clock.now = Date.now() + 60_000;
    await release();
    // It began before the transfer went, so it still counts what the transfer spent: its change would count twice.
    expect((await reading).seedelf.incoming).toBeUndefined();
    // A reading that began after it leaves those out, and the change is on its way.
    t.clock.now = Date.now() + 120_000;
    expect((await t.balances.get("preprod", true)).seedelf.incoming).toMatchObject({ utxos: 1 });
  });

  it("counts nothing on the private side with no view of the contract kept to say what's listed", async () => {
    const t = await unlocked();
    await t.balances.get("preprod");
    const summary = await t.moveIn.build("preprod", "5000000", []);
    await t.moveIn.submit("preprod", summary.txHash);
    expect((await t.balances.get("preprod")).seedelf.incoming).toMatchObject({ lovelace: "5000000" });
    // Session storage was full when the view was kept: whether a reading lists the deposit isn't known.
    await t.session.remove(`${SESSION_CONTRACT_PREFIX}preprod`);
    expect((await t.balances.get("preprod")).seedelf.incoming).toBeUndefined();
  });

  it("gives a token on its way the decimals a reading lists it with", async () => {
    const t = await unlocked();
    const rows = Object.values(koiosPreprod.accounts).flatMap((a) => a.account_utxos.flatMap((u) => u.asset_list ?? []));
    const row = rows.find((a) => a.policy_id === TUSDM.policyId && a.asset_name === TUSDM.assetName)!;
    const was = row.decimals;
    row.decimals = 6;
    try {
      await t.balances.get("preprod");
      const summary = await t.moveIn.build("preprod", "5000000", [{ ...TUSDM, quantity: "1000000" }]);
      await t.moveIn.submit("preprod", summary.txHash);
      const { incoming } = (await t.balances.get("preprod")).seedelf;
      expect(incoming!.tokens).toEqual([expect.objectContaining({ ...TUSDM, quantity: "1000000", decimals: 6 })]);
    } finally {
      row.decimals = was;
    }
  });
});
