// Private sessions: a swap's quote, the payment that funds a session's
// one-time account (recorded before it's sent), Minswap's swap read and
// signed with the session's key alone, and everything brought back into the
// private balance. The 12-word phrase, the real WebAssembly, and fakes of
// Koios, giveme.my and Minswap's aggregator.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { Minswap } from "../src/background/minswap";
import { SESSION_PENDING } from "../src/background/pending";
import { checkAsk, SESSION_OUT, SessionService } from "../src/background/sessions";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, minswapEstimate, ownedUtxos, sessionSwap, testBalances, vectors, withdrawPreprod } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const MIN = "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed724d494e";
const ASK = minswapEstimate.ask;

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  // One spend: the funding takes the 25 ₳ UTxO alone.
  const evaluation = withdrawPreprod.amount.evaluation as { result: unknown[] };
  t.koios.evaluation = { ...evaluation, result: evaluation.result.slice(0, 1) };
  return t;
}

/** More of the private balance: copies of its 25 ₳ UTxO, as if paid in since, so several sessions can be funded. */
function moreFunds(t: Awaited<ReturnType<typeof unlocked>>, n: number) {
  for (let i = 1; i <= n; i++) {
    t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: i.toString(16).padStart(2, "0").repeat(32), block_height: 9_000_000 + i });
  }
}

/** A UTxO at session 0's account, as Koios lists it. */
function atSession(tx_hash: string, tx_index: number, value: string, tokens: Array<[string, string]> = []): KoiosUtxo {
  return {
    tx_hash,
    tx_index,
    address: sessionSwap.address,
    value,
    stake_address: null,
    payment_cred: sessionSwap.keyHash,
    epoch_no: 315,
    block_height: 5_000_000,
    block_time: 1_800_000_000,
    datum_hash: null,
    inline_datum: null,
    reference_script: null,
    is_spent: false,
    asset_list: tokens.map(([id, quantity]) => ({
      policy_id: id.slice(0, 56),
      asset_name: id.slice(56),
      quantity,
      decimals: 0,
      fingerprint: "",
    })),
  } as KoiosUtxo;
}

/** The session service with giveme.my's witness and the one-time key's signature stood in for, as withdraw.test.ts does. */
function signing(t: Awaited<ReturnType<typeof unlocked>>) {
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return new SessionService({
    ...t.deps,
    wasm: {
      ...wasm,
      signScriptSpend: (_key: unknown, request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
  });
}

describe("a swap's quote", () => {
  it("funds the session with the swap, the DEX's fee and deposit, and room for the swap's fee", async () => {
    const t = await unlocked();
    const quote = await t.sessions.quote("preprod", ASK);
    expect(quote).toMatchObject({
      amountIn: "10000000",
      amountOut: "906594100",
      minAmountOut: "902083681",
      dexFee: "2000000",
      deposits: "2000000",
      route: ["Minswap"],
      // 10 ₳ + 2 ₳ fee + 2 ₳ deposit + 2 ₳ of room.
      fund: { lovelace: "16000000", tokens: [] },
      collateral: "5000000",
    });
    expect(t.minswap.calls.map((c) => c.path)).toEqual(["estimate"]);
    expect(t.minswap.calls[0]!.body).toMatchObject({ amount: "10000000", token_in: "lovelace", token_out: MIN });
    // Selling a token: the session carries it, and ADA for the costs.
    const selling = await t.sessions.quote("preprod", { ...ASK, tokenIn: MIN, tokenOut: "lovelace", amount: "500" });
    expect(selling.fund).toEqual({
      lovelace: "6000000",
      tokens: [{ policyId: MIN.slice(0, 56), assetName: "4d494e", quantity: "500" }],
    });
  });

  it("refuses an ask before Minswap sees it", () => {
    expect(() => checkAsk({ ...ASK, amount: "0" })).toThrow("Enter an amount");
    expect(() => checkAsk({ ...ASK, amount: "1.5" })).toThrow("Enter an amount");
    expect(() => checkAsk({ ...ASK, tokenOut: "lovelace" })).toThrow("two different tokens");
    expect(() => checkAsk({ ...ASK, tokenOut: "zz" })).toThrow("isn't a token");
    expect(() => checkAsk({ ...ASK, slippage: 50 })).toThrow("Slippage");
  });
});

describe("a private session", () => {
  it("is funded, swaps with the session's key alone, and comes back whole", async () => {
    const t = await unlocked();
    moreFunds(t, 1);
    const sessions = signing(t);
    const quote = await sessions.quote("preprod", ASK);

    // Out: two payments to session 0's account, from the private balance.
    const out = await sessions.outBuild("preprod", quote);
    expect(out).toMatchObject({ index: 0, address: sessionSwap.address, inputs: 1 });
    expect(out.payments.map((p) => [p.address, p.lovelace])).toEqual([
      [sessionSwap.address, "16000000"],
      [sessionSwap.address, "5000000"],
    ]);
    const funded = await sessions.outSubmit("preprod", out.txHash);
    expect(funded).toMatchObject({ kind: "session-out", txHash: out.txHash });
    expect(t.koios.submitted.map(txIdOf)).toEqual([out.txHash]);
    expect(await t.session.get(SESSION_OUT)).toBeUndefined();
    // The private history names the session, not its address.
    expect((await t.activity.seedelf("preprod"))[0]).toMatchObject({
      kind: "session-out",
      direction: "out",
      lovelace: "21000000",
      detail: "Private session 1",
    });

    let [view] = await sessions.list("preprod");
    expect(view).toMatchObject({ index: 0, stage: "funding", holding: null, swap: { amountOut: "906594100" } });

    // The funding lands: the session's account holds it.
    t.koios.addedToAccounts.push(atSession(sessionSwap.utxo.tx_hash, sessionSwap.utxo.tx_index, sessionSwap.utxo.value));
    t.koios.confirmations = 1;
    [view] = await sessions.list("preprod", true);
    expect(view).toMatchObject({ stage: "open", holding: { lovelace: "145790603", tokens: [], utxos: 1 } });
    expect(view!.txs[0]).toMatchObject({ kind: "out", confirmed: true });

    // Swap: Minswap builds it for the session's address; WebAssembly reads it.
    const review = await sessions.swapBuild("preprod", 0);
    expect(t.minswap.calls.at(-1)).toMatchObject({
      path: "build-tx",
      body: { sender: sessionSwap.address, min_amount_out: "902083681" },
    });
    expect(review).toMatchObject({ kind: "swap", index: 0, quote: { amountOut: "906594100" } });
    expect(review.summary).toMatchObject({ ownInputs: 1, signs: ["0/0"], complete: true, fee: "205189" });
    expect(review.summary.paid).toMatchObject([{ lovelace: "14000000", script: true, datum: "hash" }]);

    const placed = await sessions.txSubmit("preprod", review.txHash, "swap");
    expect(placed).toMatchObject({ kind: "session-swap" });
    const sent = t.koios.submitted.at(-1)!;
    expect(txIdOf(sent)).toBe(review.txHash);
    // Signed: the witness set gained the session key's signature.
    expect(sent.length).toBeGreaterThan(sessionSwap.swapCbor.length / 2 + 96);

    // Filled: the proceeds and the change are at the account; the funding UTxO was spent.
    t.koios.spent.add(`${sessionSwap.utxo.tx_hash}#${sessionSwap.utxo.tx_index}`);
    t.koios.addedToAccounts.push(
      atSession(review.txHash, 1, "131585414"),
      atSession("aa".repeat(32), 0, "2000000", [[MIN, "906594100"]]),
    );
    expect(await sessions.orders("preprod", 0)).toEqual([]);

    // Back, a few minutes on: everything into the private balance, signed by the session's key.
    t.clock.now += 5 * 60_000;
    const back = await sessions.backBuild("preprod", 0);
    expect(back).toMatchObject({ index: 0, inputs: 2, tokens: [{ assetName: "4d494e", quantity: "906594100" }] });
    expect(BigInt(back.lovelace) + BigInt(back.fee)).toBe(133585414n);
    const returned = await sessions.backSubmit("preprod", back.txHash);
    expect(returned).toMatchObject({ kind: "session-back", txHash: back.txHash });
    expect(await t.session.get(SESSION_PENDING)).toMatchObject({ kind: "session-back" });
    expect((await t.activity.seedelf("preprod"))[0]).toMatchObject({
      kind: "session-back",
      direction: "in",
      detail: "Private session 1",
      assets: [{ assetName: "4d494e", quantity: "906594100" }],
    });

    // Once it's on chain and the account is empty, the session is over.
    t.koios.spent.add(`${review.txHash}#1`).add(`${"aa".repeat(32)}#0`);
    [view] = await sessions.list("preprod", true);
    expect(view).toMatchObject({ stage: "closed", holding: { lovelace: "0", utxos: 0 } });
    expect(view!.txs.map((x) => x.kind)).toEqual(["out", "swap", "back"]);
    await expect(sessions.backBuild("preprod", 0)).rejects.toThrow("That session is over");
    // The next one gets a new account.
    expect((await sessions.outBuild("preprod", quote)).index).toBe(1);
  });

  it("records a session before sending its funding, so a failed send never frees its index", async () => {
    const t = await unlocked();
    const quote = await t.sessions.quote("preprod", ASK);
    const out = await t.sessions.outBuild("preprod", quote);
    // giveme.my refuses (its recorded answer), so nothing reaches Koios.
    await expect(t.sessions.outSubmit("preprod", out.txHash)).rejects.toThrow();
    expect(t.koios.submitted).toHaveLength(0);
    const [failed] = await t.sessions.list("preprod", true);
    expect(failed).toMatchObject({ index: 0, stage: "failed" });
    // The kept payment for index 0 can't be sent again, and the next session is index 1.
    await expect(t.sessions.outSubmit("preprod", out.txHash)).rejects.toThrow("started already");
    expect((await t.sessions.outBuild("preprod", quote)).index).toBe(1);
    // A failed session can be forgotten; its index still isn't reused.
    expect(await t.sessions.forget("preprod", 0)).toEqual([]);
    expect((await t.sessions.outBuild("preprod", quote)).index).toBe(1);
  });

  it("won't sign a swap that spends anything but the session's, or bring a session back with an order waiting", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const out = await sessions.outBuild("preprod", await sessions.quote("preprod", ASK));
    await sessions.outSubmit("preprod", out.txHash);
    await expect(sessions.swapBuild("preprod", 0)).rejects.toThrow("holds nothing yet");

    // The account holds something else: Minswap's swap spends a UTxO that isn't there.
    t.koios.addedToAccounts.push(atSession("bb".repeat(32), 0, "30000000"));
    await expect(sessions.swapBuild("preprod", 0)).rejects.toThrow("spends something that isn't this session's");

    t.minswap.orders = [
      {
        owner_address: sessionSwap.address,
        protocol: "Minswap",
        token_in: {},
        token_out: {},
        amount_in: "10000000",
        min_amount_out: "902083681",
        created_at: 1,
        tx_in: `${"cc".repeat(32)}#0`,
        dex_fee: "2000000",
        deposit: "2000000",
      },
    ];
    expect(await sessions.orders("preprod", 0)).toEqual([
      { protocol: "Minswap", txIn: `${"cc".repeat(32)}#0`, amountIn: "10000000", minAmountOut: "902083681", createdAt: 1 },
    ]);
    // No swap was sent from it, so an order Minswap lists doesn't hold the return back...
    await expect(sessions.backBuild("preprod", 0)).resolves.toMatchObject({ inputs: 1 });
    // ...but once one was, a waiting order does.
    t.koios.addedToAccounts.push(atSession(sessionSwap.utxo.tx_hash, sessionSwap.utxo.tx_index, sessionSwap.utxo.value));
    t.koios.addedToAccounts.splice(0, 1);
    const review = await sessions.swapBuild("preprod", 0);
    await sessions.txSubmit("preprod", review.txHash, "swap");
    await expect(sessions.backBuild("preprod", 0)).rejects.toThrow("still waiting");
  });

  it("asks Koios once for every open session's account, and once about what's waiting", async () => {
    const t = await unlocked();
    moreFunds(t, 2);
    const sessions = signing(t);
    for (let i = 0; i < 3; i++) {
      const out = await sessions.outBuild("preprod", await sessions.quote("preprod", ASK));
      await sessions.outSubmit("preprod", out.txHash);
    }
    const before = t.koios.calls.length;
    const views = await sessions.list("preprod", true);
    expect(views.map((v) => v.index)).toEqual([2, 1, 0]);
    expect(t.koios.calls.slice(before).map((c) => c.path)).toEqual(["credential_utxos", "tx_status"]);
    expect(new Set(views.map((v) => v.address)).size).toBe(3);
    // Without refresh, nothing is asked.
    const quiet = t.koios.calls.length;
    await sessions.list("preprod");
    expect(t.koios.calls.length).toBe(quiet);
  });
});
