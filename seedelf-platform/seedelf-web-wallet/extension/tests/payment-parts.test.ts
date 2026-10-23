// The owner's test of 1.6.0, after bringing a pool's boxes back, a private UTxO each: "spending more than the max
// amount of utxos does not create two healthy tx to handle the utxo load, it just errors out without any solution".
// Send and Make public now go as several transactions, each spending its own UTxOs (20 at most), sent one after
// another, none waiting on another; the review adds them up, and Home's banner names the first while it watches the
// last. Through WebAssembly, on the 12-word phrase's synthetic Seedelf UTxOs and as many more of its 25 ₳ one.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { Koios } from "../src/background/koios";
import { pendingKey } from "../src/background/pending";
import { partKey } from "../src/background/script-spend";
import { SESSION_TRANSFER, TransferService } from "../src/background/transfer";
import { SESSION_WITHDRAW, WithdrawService } from "../src/background/withdraw";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, ownedUtxos, testBalances, transferPreprod, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const SLOW = { timeout: 120_000 };
const v12 = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
/** The 12-word phrase's own receive address: Make public's. */
const OWN = v12.preprod.receive_0 as string;
/** "This is a test.", a live preprod Seedelf the phrase doesn't own. */
const THEIRS = transferPreprod.to;

type T = ReturnType<typeof testBalances>;

async function unlocked(more = 0): Promise<T> {
  const t = testBalances();
  await t.wallet.create(v12.phrase, PASSWORD);
  // `more` of its 25 ₳ Seedelf UTxO, each its own outpoint, as boxes brought back from Lovejoin are.
  const base = ownedUtxos[0]!;
  t.koios.added.push(...Array.from({ length: more }, (_, i) => ({ ...base, tx_hash: (i + 1).toString(16).padStart(64, "0") })));
  return t;
}

/** The services with WebAssembly's signing stood in for (Rust tests cover it): each transaction as it came. */
function services(t: T, onSign?: (n: number) => void) {
  const wasm = loadTestWasm();
  let signed = 0;
  const deps = {
    wasm: {
      ...wasm,
      signScriptSpend: (_key: unknown, request: string) => {
        onSign?.(++signed);
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    wallet: t.wallet,
    session: t.session,
    koios: () => new Koios("https://preprod.koios.rest/api/v1", t.koios.fetch, async () => undefined),
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    now: () => t.clock.now,
    coins: t.coins,
    store: t.store,
  };
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return { withdraw: new WithdrawService(deps), transfer: new TransferService(deps) };
}

const submittedIds = (t: T) => t.koios.submitted.map((b) => txIdOf(b));

describe("a payment more UTxOs pay than one transaction spends (the owner's test of 1.6.0)", SLOW, () => {
  it("makes it public in parts, each spending its own, added up on the review, then sent one after another", async () => {
    const t = await unlocked(40);
    const { withdraw } = services(t);
    const summary = await withdraw.build("preprod", [{ to: OWN, lovelace: "600000000", tokens: [] }]);
    const parts = summary.parts!;
    expect(parts).toHaveLength(2);
    // The review's figures are theirs added up; its hash the first's.
    expect(summary.txHash).toBe(parts[0]!.txHash);
    expect(summary.payments[0]!.lovelace).toBe("600000000");
    expect(summary.inputs).toBe(parts.reduce((n, p) => n + p.inputs, 0));
    expect(summary.fee.total).toBe(parts.reduce((n, p) => n + BigInt(p.fee), 0n).toString());
    expect(summary.max).toBe(false);
    expect(parts.every((p) => p.inputs <= 20)).toBe(true);
    // Each kept for Send under its own key.
    for (const [i, p] of parts.entries()) expect((await t.session.get<{ txHash: string }>(partKey(SESSION_WITHDRAW, i)))?.txHash).toBe(p.txHash);
    expect(t.koios.submitted).toEqual([]);

    const pending = await withdraw.submit("preprod", summary.txHash);
    expect(submittedIds(t)).toEqual(parts.map((p) => p.txHash));
    expect(t.collateral.asked).toHaveLength(2);
    // Home's banner watches the last, naming the first, as a chain's does.
    const chain = { first: parts[0]!.txHash, total: 2 };
    expect(pending).toMatchObject({ kind: "withdraw", txHash: parts[1]!.txHash, chain });
    expect(await t.session.get(pendingKey("preprod"))).toMatchObject({ txHash: parts[1]!.txHash, chain });
    for (const i of [0, 1]) expect(await t.session.get(partKey(SESSION_WITHDRAW, i))).toBeUndefined();
    // Sent already: "Send" again sends nothing more.
    await expect(withdraw.submit("preprod", summary.txHash)).rejects.toThrow("That was sent already");
    expect(t.koios.submitted).toHaveLength(2);
  });

  it("sends a Seedelf its parts, and says how many went where one the network refuses stops the rest", async () => {
    const t = await unlocked(40);
    const { transfer } = services(t, (n) => {
      // The second, signed, is refused when it's submitted.
      if (n === 2) t.koios.rejectSubmit = "Transaction Fails Validation";
    });
    const summary = await transfer.build("preprod", [{ to: THEIRS, lovelace: "600000000", tokens: [] }]);
    expect(summary.parts).toHaveLength(2);
    expect(summary.payments[0]).toMatchObject({ to: THEIRS, lovelace: "600000000" });
    await expect(transfer.submit("preprod", summary.txHash)).rejects.toThrow(
      /^1 of 2 transactions went\. The rest didn't: .*Transaction Fails Validation.* Review what's left again\.$/,
    );
    // The first went, and is watched; the second never did.
    expect(await t.session.get(pendingKey("preprod"))).toMatchObject({ txHash: summary.parts![0]!.txHash });
    expect(await t.session.get(partKey(SESSION_TRANSFER, 0))).toBeUndefined();
  });

  it("sends all of a token held in more UTxOs than one transaction spends, in parts (\"send all my min to myself\")", async () => {
    const t = await unlocked();
    // Thirty of its UTxO holding tUSDM, as a pool's boxes brought back each hold a little of its token.
    const holder = ownedUtxos[1]!;
    t.koios.added.push(...Array.from({ length: 30 }, (_, i) => ({ ...holder, tx_hash: (i + 1).toString(16).padStart(64, "0") })));
    const token = holder.asset_list![0]!;
    // The 30 copies and the fixture's own.
    const all = (BigInt(token.quantity) * 31n).toString();
    const { withdraw } = services(t);
    const summary = await withdraw.build("preprod", [
      { to: OWN, lovelace: "0", tokens: [{ policyId: token.policy_id, assetName: token.asset_name, quantity: all }] },
    ]);
    expect(summary.parts?.map((p) => p.inputs)).toEqual([20, 11]);
    expect(summary.payments[0]!.tokens).toEqual([expect.objectContaining({ policyId: token.policy_id, assetName: token.asset_name, quantity: all })]);
    // Each part carries the least its share of the token needs, and the review says so: the least is theirs added up.
    expect(summary.payments[0]!.minimum).toBe(summary.payments[0]!.lovelace);
  });

  it("takes every UTxO with Max, in parts of 20, and leaves none", async () => {
    const t = await unlocked(30);
    const { withdraw } = services(t);
    const summary = await withdraw.build("preprod", [{ to: OWN, lovelace: null, tokens: [] }]);
    expect(summary.parts!.map((p) => p.inputs)).toEqual([20, 12]);
    expect(summary).toMatchObject({ max: true, left: 0, inputs: 32, changeLovelace: "0" });
  });

  it("keeps a payment one transaction spends as it always was, forgetting an earlier review's parts", async () => {
    const t = await unlocked(40);
    const { withdraw } = services(t);
    await withdraw.build("preprod", [{ to: OWN, lovelace: "600000000", tokens: [] }]);
    expect(await t.session.get(partKey(SESSION_WITHDRAW, 1))).toBeDefined();
    const one = await withdraw.build("preprod", [{ to: OWN, lovelace: "20000000", tokens: [] }]);
    expect(one.parts).toBeUndefined();
    expect(await t.session.get(partKey(SESSION_WITHDRAW, 1))).toBeUndefined();
    const pending = await withdraw.submit("preprod", one.txHash);
    expect(pending.chain).toBeUndefined();
    expect(submittedIds(t)).toEqual([one.txHash]);
  });
});
