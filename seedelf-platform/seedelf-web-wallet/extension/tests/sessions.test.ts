// Private sessions: a swap's quote, the payment that funds a session's
// one-time account (recorded before it's sent), Minswap's swap read and
// signed with the session's key alone, and everything brought back into the
// private balance. The 12-word phrase, the real WebAssembly, and fakes of
// Koios, giveme.my and Minswap's aggregator.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { DIRECT_PROTOCOLS, Minswap } from "../src/background/minswap";
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

/** The runner's alarm, as chrome.alarms would be. */
function alarm() {
  const a = {
    on: false,
    start: async () => {
      a.on = true;
    },
    stop: async () => {
      a.on = false;
    },
  };
  return a;
}

/** The session service with giveme.my's witness and the one-time key's signature stood in for, as withdraw.test.ts does. */
function signing(t: Awaited<ReturnType<typeof unlocked>>, runner = alarm()) {
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
    alarm: runner,
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
    // Routed through DEXes that take orders only: one that swaps against its pools spends UTxOs that aren't the session's.
    expect(t.minswap.calls[0]!.body).toMatchObject({
      amount: "10000000",
      token_in: "lovelace",
      token_out: MIN,
      exclude_protocols: ["DanogoCLMMV1", "ChakraBondingCurve", "OpenDjedV1"],
    });
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
    // Its page watches the return; Home's banner still has only the funding.
    expect(await t.session.get(SESSION_PENDING)).toMatchObject({ kind: "session-out" });
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

  it("gives each session an address with its own stake key, and keeps a session from before at its shared one", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const out = await sessions.outBuild("preprod", await sessions.quote("preprod", ASK));
    // Payment key 0/0 and stake key 2/0 of account 24301' (pinned against cardano-address in session_test.rs).
    expect(out.address).toBe(sessionSwap.address);
    await sessions.outSubmit("preprod", out.txHash);

    // A session recorded before the fix has no `ownStake`: it keeps the shared Seedelf staking part, where its money is.
    const book = (await t.store.get<{ sessions: Array<{ ownStake?: boolean }> }>("sessions.preprod"))!;
    expect(book.sessions[0]!.ownStake).toBe(true);
    delete book.sessions[0]!.ownStake;
    await t.store.set("sessions.preprod", book);
    const wasm = loadTestWasm();
    const accounts = wasm.OneTimeAccounts.fromPhrase(account(12).phrase);
    const shared = accounts.sharedStakeAddress(wasm.Network.Preprod, 0);
    accounts.free();
    expect(shared).not.toBe(sessionSwap.address);
    const [view] = await sessions.list("preprod");
    expect(view!.address).toBe(shared);
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

/** An order of session 0's, as Minswap lists it. */
const ORDER = {
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
};

/** The recorded swap's id: signing it adds a witness, never changes its body. */
const SWAP_TX = txIdOf(Uint8Array.from(Buffer.from(sessionSwap.swapCbor, "hex")));

describe("a swap that runs itself", () => {
  type T = Awaited<ReturnType<typeof unlocked>>;

  /** Session 0's funding, sent: the one approval. */
  async function started(sessions: SessionService, quote?: Awaited<ReturnType<SessionService["quote"]>>) {
    const out = await sessions.outBuild("preprod", quote ?? (await sessions.quote("preprod", ASK)));
    await sessions.outSubmit("preprod", out.txHash);
    return out;
  }

  /** The funding lands: Koios confirms everything, and the account holds what the recorded swap spends. */
  function funded(t: T) {
    t.koios.confirmations = 1;
    t.koios.addedToAccounts.push(atSession(sessionSwap.utxo.tx_hash, sessionSwap.utxo.tx_index, sessionSwap.utxo.value));
  }

  it("places the order once the funding lands, brings everything back once it's filled, and is done once that lands", async () => {
    const t = await unlocked();
    const runner = alarm();
    const sessions = signing(t, runner);
    await started(sessions);
    expect(runner.on).toBe(true);

    // The funding isn't on chain yet: one tx_status, and nothing else.
    let calls = t.koios.calls.length;
    let view = await sessions.advance("preprod", 0);
    expect(view.auto).toEqual({ step: "funding", stopping: false, filled: false, approvedMinOut: "902083681" });
    expect(t.koios.calls.slice(calls).map((c) => c.path)).toEqual(["tx_status"]);

    // It lands. Asked again within 15 s, the runner doesn't read.
    funded(t);
    calls = t.koios.calls.length;
    await sessions.advance("preprod", 0);
    expect(t.koios.calls.length).toBe(calls);

    // 15 s on: the order, from a fresh quote, for at least what was approved.
    t.clock.now += 15_000;
    view = await sessions.advance("preprod", 0);
    expect(t.minswap.calls.map((c) => c.path)).toEqual(["estimate", "estimate", "build-tx"]);
    expect(t.minswap.calls.at(-1)!.body).toMatchObject({
      sender: sessionSwap.address,
      min_amount_out: "902083681",
      estimate: { exclude_protocols: DIRECT_PROTOCOLS },
    });
    expect(txIdOf(t.koios.submitted.at(-1)!)).toBe(SWAP_TX);
    expect(view.txs.map((x) => [x.kind, !!x.confirmed])).toEqual([
      ["out", true],
      ["swap", false],
    ]);
    expect(view.auto!.step).toBe("ordering");
    // Its page watches the swap: Home's banner still has only the funding.
    expect(await t.session.get(SESSION_PENDING)).toMatchObject({ kind: "session-out" });

    // The order lands and waits for a batcher.
    t.koios.spent.add(`${sessionSwap.utxo.tx_hash}#${sessionSwap.utxo.tx_index}`);
    t.koios.addedToAccounts.push(atSession(SWAP_TX, 1, "131585414"));
    t.minswap.orders = [ORDER];
    t.clock.now += 15_000;
    view = await sessions.advance("preprod", 0);
    expect(view.auto).toMatchObject({ step: "filling", filled: false });
    expect(t.koios.submitted).toHaveLength(2);

    // Minswap stops listing it before its proceeds show up: still waiting.
    t.minswap.orders = [];
    t.clock.now += 15_000;
    view = await sessions.advance("preprod", 0);
    expect(view.auto).toMatchObject({ step: "filling", filled: false });
    expect(t.koios.submitted).toHaveLength(2);

    // Filled: the proceeds arrive, and everything goes back into the private balance.
    t.koios.addedToAccounts.push(atSession("aa".repeat(32), 0, "2000000", [[MIN, "906594100"]]));
    t.clock.now += 15_000;
    view = await sessions.advance("preprod", 0);
    expect(view.auto).toMatchObject({ step: "returning", filled: true });
    expect(view.holding).toMatchObject({ tokens: [{ assetName: "4d494e", quantity: "906594100" }], utxos: 2 });
    expect(t.koios.submitted).toHaveLength(3);
    expect((await t.activity.seedelf("preprod"))[0]).toMatchObject({ kind: "session-back", direction: "in" });

    // The return lands and the account is empty: done, and the alarm stops.
    t.koios.spent.add(`${SWAP_TX}#1`).add(`${"aa".repeat(32)}#0`);
    t.clock.now += 15_000;
    view = await sessions.advance("preprod", 0);
    expect(view).toMatchObject({ stage: "closed", auto: { step: "done" }, holding: { utxos: 0 } });
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "back"]);
    await sessions.runAll("preprod");
    expect(runner.on).toBe(false);
  });

  it("pauses when the price moved past what was approved, and orders at least that when it's back within it", async () => {
    const t = await unlocked();
    const runner = alarm();
    const sessions = signing(t, runner);
    await started(sessions);
    funded(t);
    t.minswap.estimate = { ...minswapEstimate.estimate, amount_out: "900000000", min_amount_out: "895500000" };
    let view = await sessions.advance("preprod", 0);
    expect(view.auto!.paused).toEqual({ at: t.clock.now, why: "price", amountOut: "900000000" });
    expect(t.minswap.calls.map((c) => c.path)).not.toContain("build-tx");
    // Paused, it waits for the user: the runner leaves it, and the alarm stops.
    t.clock.now += 60_000;
    await sessions.runAll("preprod");
    expect(t.minswap.calls.filter((c) => c.path === "estimate")).toHaveLength(2);
    expect(runner.on).toBe(false);

    // Expected above the approved minimum again, though its own minimum is under it: the order asks for the approved one.
    t.minswap.estimate = { ...minswapEstimate.estimate, amount_out: "904000000", min_amount_out: "899960000" };
    view = await sessions.resume("preprod", 0);
    expect(view.auto!.paused).toBeUndefined();
    expect(runner.on).toBe(true);
    expect(t.minswap.calls.at(-1)).toMatchObject({ path: "build-tx", body: { min_amount_out: "902083681" } });
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
  });

  it("pauses rather than sign a swap that pays out more than was funded for it", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const quote = await sessions.quote("preprod", ASK);
    // 14 ₳ funded for the swap: the order's 14 ₳ and its fee are more.
    await started(sessions, { ...quote, fund: { lovelace: "14000000", tokens: [] } });
    funded(t);
    const view = await sessions.advance("preprod", 0);
    expect(view.auto!.paused).toMatchObject({ why: "refused", detail: "it pays out more ADA than was funded for the swap." });
    expect(t.koios.submitted).toHaveLength(1);
  });

  it("pauses rather than sign a swap that spends UTxOs that aren't the session's, as a DEX swapping against its pools does", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    // The account holds another UTxO than the one Minswap's swap spends.
    t.koios.confirmations = 1;
    t.koios.addedToAccounts.push(atSession("bb".repeat(32), 0, "30000000"));
    const view = await sessions.advance("preprod", 0);
    expect(view.auto!.paused).toMatchObject({ why: "refused", detail: "it spends something that isn't this session's." });
    expect(t.koios.submitted).toHaveLength(1);
  });

  it("carries on in a restarted worker, from what's stored and on chain", async () => {
    const t = await unlocked();
    await started(signing(t));
    funded(t);
    const view = await signing(t).advance("preprod", 0);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
  });

  it("does nothing while the wallet is locked, and carries on once it's unlocked", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    funded(t);
    await t.wallet.lock();
    const before = t.minswap.calls.length;
    await expect(sessions.runAll("preprod")).rejects.toThrow("locked");
    expect(t.minswap.calls).toHaveLength(before);
    await t.wallet.unlock(PASSWORD);
    await sessions.runAll("preprod");
    expect(t.minswap.calls.slice(before).map((c) => c.path)).toEqual(["estimate", "build-tx"]);
  });

  it("waits after a failure and tries again, longer each time", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    funded(t);
    const real = t.minswap.fetch;
    t.minswap.fetch = async (url, init) =>
      url.endsWith("/estimate") ? new Response("Rate limit exceeded, retry in 50 seconds", { status: 429 }) : real(url, init);
    let view = await sessions.advance("preprod", 0);
    expect(view.auto!.retry).toEqual({ at: t.clock.now + 30_000, error: expect.stringContaining("limiting requests") });

    // Not before the 30 s are up.
    t.clock.now += 20_000;
    const calls = t.koios.calls.length;
    await sessions.advance("preprod", 0);
    expect(t.koios.calls).toHaveLength(calls);

    // Then again, and after a second failure, a minute.
    t.clock.now += 10_000;
    view = await sessions.advance("preprod", 0);
    expect(view.auto!.retry!.at).toBe(t.clock.now + 60_000);

    // Try again, now: it goes on.
    t.minswap.fetch = real;
    view = await sessions.resume("preprod", 0);
    expect(view.auto!.retry).toBeUndefined();
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
  });

  it("builds a step again when Koios never took its transaction and the chain doesn't have it", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    funded(t);
    t.koios.rejectSubmit = "Koios is down";
    let view = await sessions.advance("preprod", 0);
    // Recorded before it was sent, and kept, but not shown: the swap isn't placed.
    expect(view.txs.map((x) => x.kind)).toEqual(["out"]);
    expect(view.auto).toMatchObject({ step: "ordering", retry: { error: expect.stringContaining("Koios is down") } });
    // The funding, and the swap Koios refused.
    expect(t.koios.submitted).toHaveLength(2);

    // A minute on, Koios is back but the chain doesn't have it. It may still be on its way, so the runner waits.
    t.koios.rejectSubmit = undefined;
    t.koios.missing.add(SWAP_TX);
    t.clock.now += 60_000;
    await sessions.advance("preprod", 0);
    expect(t.koios.submitted).toHaveLength(2);

    // Two minutes on and still not there: it's built again and sent.
    t.clock.now += 60_000;
    view = await sessions.advance("preprod", 0);
    expect(t.koios.submitted).toHaveLength(3);
    expect(txIdOf(t.koios.submitted.at(-1)!)).toBe(SWAP_TX);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
    expect(t.minswap.calls.filter((c) => c.path === "build-tx")).toHaveLength(2);
  });

  it("stops before the order: it waits for the funding, then brings it all back without ordering", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    let view = await sessions.stop("preprod", 0);
    expect(view.auto).toMatchObject({ step: "funding", stopping: true });
    funded(t);
    t.clock.now += 15_000;
    view = await sessions.advance("preprod", 0);
    expect(view.auto).toMatchObject({ step: "returning", stopping: true, filled: false });
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "back"]);
    // Only the quote was ever asked for.
    expect(t.minswap.calls.map((c) => c.path)).toEqual(["estimate"]);
  });

  it("never cancels an order by itself; Stop asks Minswap to cancel it", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    funded(t);
    await sessions.advance("preprod", 0);
    t.koios.spent.add(`${sessionSwap.utxo.tx_hash}#${sessionSwap.utxo.tx_index}`);
    t.koios.addedToAccounts.push(atSession(SWAP_TX, 1, "131585414"));
    t.minswap.orders = [ORDER];

    // Ten minutes on, still not filled: the runner keeps waiting. (Past the 15 minutes auto-lock allows, it would wait for the unlock.)
    t.clock.now += 10 * 60_000;
    let view = await sessions.advance("preprod", 0);
    expect(view.auto).toMatchObject({ step: "filling", stopping: false });
    expect(t.minswap.calls.map((c) => c.path)).not.toContain("cancel-tx");

    view = await sessions.stop("preprod", 0);
    expect(view.auto).toMatchObject({ step: "cancelling", stopping: true });
    expect(t.minswap.calls.at(-1)).toMatchObject({
      path: "cancel-tx",
      body: { sender: sessionSwap.address, orders: [{ tx_in: ORDER.tx_in, protocol: "Minswap" }] },
    });
  });
});
