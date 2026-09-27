// Private sessions: a swap's quote, the payment that funds a session's
// one-time account (recorded before it's sent), Minswap's swap read and
// signed with the session's key alone, and everything brought back into the
// private balance. The 12-word phrase, the real WebAssembly, and fakes of
// Koios, giveme.my and Minswap's aggregator.
import { describe, expect, it } from "vitest";

import { bodyOutpoints } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { MAX_DEPOSIT_BOXES, UNLOCK_WAIT_MS } from "../src/background/lovejoin";
import { builtOutputs, DIRECT_PROTOCOLS, excludedProtocols, MAINNET_PROTOCOLS, Minswap } from "../src/background/minswap";
import { pendingKey } from "../src/background/pending";
import { PRIVATE_PREFIX, UnreadableRecordError } from "../src/background/private-store";
import {
  checkAsk,
  checkOrder,
  INDEX_PROBE,
  Refused,
  SESSION_BACK,
  SESSION_CHAIN_PREFIX,
  SESSION_OUT,
  SessionService,
} from "../src/background/sessions";
import { SESSION_SPENT } from "../src/background/spent";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { bytes, cbor, type Cbor, hex, ORDER_ADDRESS, ORDER_DATUM, recordedSwap, SENDER, SESSION_ADDRESS, swapTx } from "./fixtures/swap-tx";
import { loadTestWasm, minswapEstimate, ownedUtxos, sessionSwap, testBalances, vectors, withdrawPreprod } from "./fakes";

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
/** A funding the chain doesn't have after this long never reached it (sessions.ts). */
const FAILED_AFTER = 20 * 60_000 + 1;
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

/** Minswap's swap from session 0's funding, as the fake aggregator builds it. */
const SWAP = swapTx();

/** Koios takes what's submitted, then answers `status` as though it hadn't: a gateway that timed out, say. Returns the undo. */
function unanswered(t: Awaited<ReturnType<typeof unlocked>>, status = 504) {
  const real = t.koios.fetch;
  t.koios.fetch = async (url, init) => {
    const answer = await real(url, init);
    return url.endsWith("/submittx") ? new Response("upstream request timeout", { status }) : answer;
  };
  return () => {
    t.koios.fetch = real;
  };
}

/** Koios's gateway turns submits away (429) before its node sees them. Returns the undo. */
function turnedAway(t: Awaited<ReturnType<typeof unlocked>>) {
  const real = t.koios.fetch;
  t.koios.fetch = async (url, init) => (url.endsWith("/submittx") ? new Response("", { status: 429 }) : real(url, init));
  return () => {
    t.koios.fetch = real;
  };
}

/** Moves the clock on by `ms`, the user busy all along, so the wallet doesn't lock itself. */
async function busy(t: Awaited<ReturnType<typeof unlocked>>, ms: number) {
  for (let left = ms; left > 0; left -= 10 * 60_000) {
    t.clock.now += Math.min(left, 10 * 60_000);
    await t.wallet.touch();
  }
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
  t.minswap.swapCbor = SWAP;
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

describe("the record of sessions", () => {
  it("is never written over when it won't open, so the sessions it lists aren't lost", async () => {
    const t = await unlocked();
    const quote = await t.sessions.quote("preprod", ASK);
    const out = await t.sessions.outBuild("preprod", quote);
    await t.sessions.outSubmit("preprod", out.txHash).catch(() => undefined);
    expect(await t.sessions.list("preprod")).toHaveLength(1);

    // Damaged on the device: it won't open, and it isn't taken for no sessions at all.
    const key = `${PRIVATE_PREFIX}sessions.preprod`;
    const sealed = (await t.local.get<{ data: string }>(key))!;
    const damaged = { ...sealed, data: `${sealed.data[0] === "A" ? "B" : "A"}${sealed.data.slice(1)}` };
    await t.local.set(key, damaged);
    await expect(t.sessions.list("preprod")).rejects.toThrow(UnreadableRecordError);
    await expect(t.sessions.outBuild("preprod", quote)).rejects.toThrow("couldn't open its record of your private sessions");
    expect(await t.local.get(key)).toEqual(damaged);

    // One built before it broke isn't sent over it either.
    await t.local.set(key, sealed);
    const next = await t.sessions.outBuild("preprod", quote);
    await t.local.set(key, damaged);
    await expect(t.sessions.outSubmit("preprod", next.txHash)).rejects.toThrow(UnreadableRecordError);
    expect(await t.local.get(key)).toEqual(damaged);
    expect(t.koios.submitted).toHaveLength(0);
  });
});

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

  it("is verified only for ADA, a token the wallet lists, or one Minswap verifies by its ID; the wallet won't fund one that isn't", async () => {
    const t = await unlocked();
    // MIN is on the wallet's own list: nothing more is asked.
    expect(await t.sessions.quote("preprod", ASK)).toMatchObject({ verified: true });
    expect((await t.sessions.quote("preprod", { ...ASK, tokenIn: MIN, tokenOut: "lovelace", amount: "500" })).verified).toBe(true);
    expect(t.minswap.calls.map((c) => c.path)).toEqual(["estimate", "estimate"]);

    // A token named like a known one, held in the private balance: Minswap's verified list has another by that name.
    const fake = `${"0bad".repeat(14)}534e454b`;
    const real = `${"279c".repeat(14)}534e454b`;
    const verified: Array<{ token_id: string; ticker: string; is_verified: boolean }> = [{ token_id: real, ticker: "SNEK", is_verified: true }];
    const fetch = t.minswap.fetch;
    t.minswap.fetch = async (url, init) => {
      if (!url.endsWith("/tokens")) return fetch(url, init);
      t.minswap.calls.push({ path: "tokens", body: JSON.parse(String(init.body)) });
      return Response.json({ tokens: verified });
    };
    const spoofed = await t.sessions.quote("preprod", { ...ASK, tokenOut: fake });
    expect(spoofed.verified).toBe(false);
    expect(t.minswap.calls.at(-1)).toMatchObject({ path: "tokens", body: { query: fake, only_verified: true } });
    await expect(t.sessions.outBuild("preprod", spoofed)).rejects.toThrow("won't swap into it");
    expect(t.koios.calls.some((c) => c.path === "account_addresses")).toBe(false);

    // The real one, by its ID: verified.
    expect((await t.sessions.quote("preprod", { ...ASK, tokenOut: real })).verified).toBe(true);
  });

  it("says what its return through Lovejoin is expected to take: nothing for a token's proceeds, and boxes for ADA's", async () => {
    const t = await unlocked();
    const sessions = new SessionService({
      ...t.deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      store: t.store,
      minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
      lovejoin: t.lovejoin,
    });
    // ADA for MIN: the tokens come back with their deposit, and the 2 ₳ of room pays for no box.
    expect((await sessions.quote("preprod", ASK)).lovejoin).toEqual({
      boxes: 0,
      depth: 2,
      mixes: 0,
      mixFees: "0",
      withdrawFees: "0",
      delay: "1-6",
    });
    // MIN for 50 ₳: the proceeds, the deposit back and the room, 54 ₳, pay for 3 boxes at 13.8 ₳ each and the deposit.
    t.minswap.estimate = { ...minswapEstimate.estimate, amount_out: "50000000", min_amount_out: "49750000" };
    const selling = { ...ASK, tokenIn: MIN, tokenOut: "lovelace", amount: "500" };
    expect((await sessions.quote("preprod", selling)).lovejoin).toEqual({
      boxes: 3,
      depth: 2,
      mixes: 12,
      mixFees: "11400000",
      withdrawFees: "900000",
      delay: "1-6",
    });
    // A large one: no more than one chain takes (MAX_CHAIN_MIXES, 32 boxes of 4 mixes).
    t.minswap.estimate = { ...minswapEstimate.estimate, amount_out: "906594100" };
    expect((await sessions.quote("preprod", selling)).lovejoin).toMatchObject({ boxes: 32, mixes: 128, mixFees: "121600000" });
    // One wave deep, 1,600 ₳: no more than one deposit makes (final review lovejoin-5).
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    t.minswap.estimate = { ...minswapEstimate.estimate, amount_out: "1600000000" };
    expect((await sessions.quote("preprod", selling)).lovejoin).toMatchObject({ boxes: MAX_DEPOSIT_BOXES, depth: 1, mixes: MAX_DEPOSIT_BOXES });
    // Where Lovejoin isn't, there's nothing to say.
    expect((await t.sessions.quote("preprod", selling)).lovejoin).toBeUndefined();
  });

  it("leaves Splash out of routing on preprod, where Minswap builds its orders with a mainnet address", () => {
    expect(excludedProtocols("preprod")).toEqual([...DIRECT_PROTOCOLS, "Splash", "SplashStable"]);
  });

  it("leaves out of mainnet's routing the DEXes whose orders the check refuses, and won't quote a route through one it can't check (final review sessions-4)", async () => {
    // VyFinance names its owner as one 56-byte field; MuesliSwap stakes its orders to its own key.
    expect(excludedProtocols("mainnet")).toEqual([...DIRECT_PROTOCOLS, "VyFinance", "MuesliSwap"]);
    expect(MAINNET_PROTOCOLS).not.toContain("VyFinance");
    expect(MAINNET_PROTOCOLS).not.toContain("MuesliSwap");
    const t = await unlocked();
    const selling = { ...ASK, tokenIn: MIN, tokenOut: "lovelace", amount: "500" };
    const leg = minswapEstimate.estimate.paths[0]![0]!;
    const via = (...protocols: string[]) => {
      t.minswap.estimate = { ...minswapEstimate.estimate, paths: protocols.map((protocol) => [{ ...leg, protocol }]) };
    };
    // One Minswap routes through, but the wallet doesn't know its orders: refused before anything is funded.
    via("MinswapV2", "CswapV1");
    await expect(t.sessions.quote("mainnet", selling)).rejects.toThrow(
      "Minswap routes this swap through CswapV1, whose orders the wallet can't check yet, so it won't swap this way.",
    );
    // On preprod, the check alone stands.
    await expect(t.sessions.quote("preprod", selling)).resolves.toMatchObject({ route: ["MinswapV2", "CswapV1"] });
    // Through DEXes whose orders name the owner's key as a field of its own: quoted.
    via("MinswapV2", "SundaeSwapV3", "Splash");
    await expect(t.sessions.quote("mainnet", selling)).resolves.toMatchObject({ route: ["MinswapV2", "SundaeSwapV3", "Splash"] });
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
    expect(sent.length).toBeGreaterThan(SWAP.length / 2 + 96);

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
    expect(await t.session.get(pendingKey("preprod"))).toMatchObject({ kind: "session-out" });
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
    // Turned away, it never went out: the page says so, and offers nothing but Forget.
    expect(failed).toMatchObject({ index: 0, stage: "failed", unsent: true });
    // The kept payment for index 0 can't be sent again, and the next session is index 1.
    await expect(t.sessions.outSubmit("preprod", out.txHash)).rejects.toThrow("started already");
    expect((await t.sessions.outBuild("preprod", quote)).index).toBe(1);
    // A failed session can be forgotten; its index still isn't reused.
    expect(await t.sessions.forget("preprod", 0)).toEqual([]);
    expect((await t.sessions.outBuild("preprod", quote)).index).toBe(1);
  });

  it("waits for a funding Koios didn't answer rather than call it failed, and fails one its gateway turned away at once", async () => {
    const t = await unlocked();
    moreFunds(t, 1);
    const sessions = signing(t);
    const quote = await sessions.quote("preprod", ASK);
    let undo = unanswered(t);
    const out = await sessions.outBuild("preprod", quote);
    // Koios didn't answer: the Send is maybe sent (script-spend's send), not refused.
    await expect(sessions.outSubmit("preprod", out.txHash)).resolves.toMatchObject({ maybeSent: true });
    undo();
    // Its node took it: it may land any moment, so it's funding, not failed, and it can't be forgotten.
    expect(t.koios.submitted.map(txIdOf)).toEqual([out.txHash]);
    expect((await sessions.list("preprod", true))[0]).toMatchObject({ index: 0, stage: "funding" });
    await expect(sessions.forget("preprod", 0)).rejects.toThrow("Only a session whose funding never reached the chain");
    // It lands.
    t.koios.confirmations = 1;
    t.koios.addedToAccounts.push(atSession(sessionSwap.utxo.tx_hash, sessionSwap.utxo.tx_index, sessionSwap.utxo.value));
    expect((await sessions.list("preprod", true))[0]).toMatchObject({ index: 0, stage: "open" });

    // A 429 is Koios's gateway turning it away before its node sees it: never sent.
    undo = turnedAway(t);
    const next = await sessions.outBuild("preprod", quote);
    await expect(sessions.outSubmit("preprod", next.txHash)).rejects.toThrow("limiting requests");
    undo();
    t.koios.confirmations = null;
    expect((await sessions.list("preprod", true)).find((v) => v.index === 1)).toMatchObject({ stage: "failed", unsent: true });
  });

  it("never takes a one-time account the chain has seen used, whatever this device's record says", async () => {
    // A restored wallet, one removed and restored, or the same phrase in
    // another browser: the record starts at 0, but sessions 0, 1, 2 and 4 were paid.
    const t = await unlocked();
    const net = loadTestWasm().Network.Preprod;
    const reward = (i: number) => t.wallet.withKeys((keys) => keys.oneTime.rewardAddress(net, i));
    for (const i of [0, 1, 2, 4]) t.koios.usedStakes.add(await reward(i));
    const quote = await t.sessions.quote("preprod", ASK);
    const probes = () => t.koios.calls.filter((c) => c.path === "account_addresses");
    expect((await t.sessions.outBuild("preprod", quote)).index).toBe(3);
    // The next index alone first; it was used, so the INDEX_PROBE after it at once: 1 to 20.
    expect(probes().map((c) => c.body._stake_addresses.length)).toEqual([1, INDEX_PROBE]);
    expect(probes()[0]!.body._stake_addresses).toEqual([await reward(0)]);
    expect(probes()[1]!.body._stake_addresses[3]).toBe(await reward(4));

    // A whole batch used: it asks about the next one.
    for (let i = 0; i <= INDEX_PROBE; i++) t.koios.usedStakes.add(await reward(i));
    expect((await t.sessions.outBuild("preprod", quote)).index).toBe(INDEX_PROBE + 1);
    expect(probes().map((c) => c.body._stake_addresses.length)).toEqual([1, INDEX_PROBE, 1, INDEX_PROBE, INDEX_PROBE]);
    expect(probes()[4]!.body._stake_addresses[0]).toBe(await reward(INDEX_PROBE + 1));
  });

  it("asks Koios about the next one-time account alone, never the ones to come", async () => {
    // Overlapping windows would tie every session the wallet opens together, whatever the IP address.
    const t = await unlocked();
    moreFunds(t, 1);
    const sessions = signing(t);
    const net = loadTestWasm().Network.Preprod;
    const reward = (i: number) => t.wallet.withKeys((keys) => keys.oneTime.rewardAddress(net, i));
    const probes = () => t.koios.calls.filter((c) => c.path === "account_addresses").map((c) => c.body._stake_addresses);
    const quote = await sessions.quote("preprod", ASK);
    await sessions.outBuild("preprod", quote);
    const out = await sessions.outBuild("preprod", quote);
    await sessions.outSubmit("preprod", out.txHash);
    await sessions.outBuild("preprod", quote);
    expect(probes()).toEqual([[await reward(0)], [await reward(0)], [await reward(1)]]);
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

/** The swap's id: signing it adds a witness, never changes its body. */
const SWAP_TX = txIdOf(bytes(SWAP));

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

  /** The swap lands: its order waits at the DEX's contract (output 0), and its change is at the account. */
  function ordered(t: T) {
    t.koios.spent.add(`${sessionSwap.utxo.tx_hash}#${sessionSwap.utxo.tx_index}`);
    t.koios.addedToAccounts.push(atSession(SWAP_TX, 1, "131585414"), {
      ...atSession(SWAP_TX, 0, "14000000"),
      address: bech32("addr_test", bytes(ORDER_ADDRESS)),
      payment_cred: "a6".repeat(28),
    });
  }

  it("brings back what's left when its return through Lovejoin stopped partway, whatever Minswap still lists", async () => {
    // Found on preprod: a filled swap's return deposited its boxes and ran some
    // mixes, then a submit failed. What's at the account came from the chain
    // itself, so nothing "arrived" from outside, and the runner waited for good.
    const t = await unlocked();
    const sessions = signing(t);
    const now = t.clock.now;
    const done = (kind: string, txHash: string) => ({ kind, txHash, at: now, confirmed: true });
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: now,
          txs: [done("out", "01".repeat(32)), done("swap", "02".repeat(32)), done("deposit", "03".repeat(32)), done("mix", "04".repeat(32))],
          swap: { ...ASK, amountOut: "906594100", minAmountOut: "902083681" },
          auto: { approved: { minAmountOut: "902083681", fund: { lovelace: "16000000", tokens: [] } }, filled: now },
        },
      ],
    });
    // The collateral, and the last mix's change; Minswap still lists the order.
    t.koios.addedToAccounts.push(atSession("01".repeat(32), 1, "5000000"), atSession("04".repeat(32), 3, "12619619"));
    t.minswap.orders = [{ tx_in: `${"02".repeat(32)}#0`, protocol: "MinswapV2" } as never];
    let [view] = await sessions.list("preprod");
    // The timeline says it's coming back, not waiting for the fill.
    expect(view!.auto!.step).toBe("returning");

    view = await sessions.advance("preprod", 0, true);
    // Directly: its deposit is in, so it doesn't go through Lovejoin again.
    const book = (await t.store.get<{ sessions: Array<{ txs: Array<{ kind: string; txHash: string }> }> }>("sessions.preprod"))!;
    const back = book.sessions[0]!.txs.at(-1)!;
    expect(back.kind).toBe("back");
    expect(txIdOf(t.koios.submitted.at(-1)!)).toBe(back.txHash);
    expect(view.auto?.retry).toBeUndefined();
    expect(t.minswap.calls.some((c) => c.path === "pending-orders")).toBe(false);
  });

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
    expect(await t.session.get(pendingKey("preprod"))).toMatchObject({ kind: "session-out" });

    // The order lands and waits for a batcher.
    ordered(t);
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

    // Filled: the batcher spends the order and pays the proceeds, and everything goes back into the private balance.
    t.koios.spent.add(`${SWAP_TX}#0`);
    t.koios.addedToAccounts.push(atSession("aa".repeat(32), 0, "2000000", [[MIN, "906594100"]]));
    t.clock.now += 15_000;
    view = await sessions.advance("preprod", 0);
    expect(view.auto).toMatchObject({ step: "returning", filled: true });
    expect(view.holding).toMatchObject({ tokens: [{ assetName: "4d494e", quantity: "906594100" }], utxos: 2 });
    expect(t.koios.submitted).toHaveLength(3);
    expect((await t.activity.seedelf("preprod"))[0]).toMatchObject({ kind: "session-back", direction: "in" });

    // The return lands and the account is empty: done, and nothing runs, so the worker's run stops the alarm (runs.ts).
    t.koios.spent.add(`${SWAP_TX}#1`).add(`${"aa".repeat(32)}#0`);
    t.clock.now += 15_000;
    view = await sessions.advance("preprod", 0);
    expect(view).toMatchObject({ stage: "closed", auto: { step: "done" }, holding: { utxos: 0 } });
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "back"]);
    expect(await sessions.runAll("preprod")).toBe(false);
    // Only that run stops it, once for every network: runAll leaves it alone.
    expect(runner.on).toBe(true);
  });

  it("takes nothing a stranger pays the account for the fill while its order is still at the DEX's contract", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    funded(t);
    await sessions.advance("preprod", 0);
    ordered(t);
    // Minswap hasn't listed the new order yet, and someone sends the account 1 ₳.
    t.koios.addedToAccounts.push(atSession("dd".repeat(32), 0, "1000000"));
    t.clock.now += 15_000;
    let view = await sessions.advance("preprod", 0);
    expect(view.auto).toMatchObject({ step: "filling", filled: false });
    expect(t.koios.submitted).toHaveLength(2);
    // Asked about the order itself: the swap's output 0, where the batcher finds it.
    expect(t.koios.calls.at(-1)).toMatchObject({ path: "utxo_info", body: { _utxo_refs: [`${SWAP_TX}#0`] } });

    // Filled: the order is spent, and its proceeds come back with the rest.
    t.koios.spent.add(`${SWAP_TX}#0`);
    t.koios.addedToAccounts.push(atSession("aa".repeat(32), 0, "2000000", [[MIN, "906594100"]]));
    t.clock.now += 15_000;
    view = await sessions.advance("preprod", 0);
    expect(view.auto).toMatchObject({ step: "returning", filled: true });
    expect(t.koios.submitted).toHaveLength(3);
  });

  it("looks at the account before it calls a funding failed: what the funding paid is there, so it goes on", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const out = await started(sessions);
    // A Koios backend whose tx_status never knows the funding, though the account holds what it paid.
    t.koios.confirmations = 1;
    t.koios.missing.add(out.txHash);
    t.koios.addedToAccounts.push(
      atSession(sessionSwap.utxo.tx_hash, sessionSwap.utxo.tx_index, sessionSwap.utxo.value),
      atSession(out.txHash, 1, "5000000"),
    );
    await busy(t, FAILED_AFTER);
    const view = await sessions.advance("preprod", 0);
    expect(view.stage).toBe("open");
    expect(view.txs.map((x) => [x.kind, !!x.confirmed])).toEqual([
      ["out", true],
      ["swap", false],
    ]);
  });

  it("goes on with a funding it found failed once it shows up after all: on a refresh, or Try again", async () => {
    for (const how of ["refresh", "resume"] as const) {
      const t = await unlocked();
      const runner = alarm();
      const sessions = signing(t, runner);
      await started(sessions);
      // Twenty minutes, and the chain has none of it: failed, and the runner leaves it.
      await busy(t, FAILED_AFTER);
      let view = await sessions.advance("preprod", 0);
      expect(view.stage).toBe("failed");
      // Not seen isn't turned away: it may still land, so the page offers Try again.
      expect(view.unsent).toBeUndefined();
      expect(await sessions.runAll("preprod")).toBe(false);
      // Nothing runs, so the worker's run stops the alarm (runs.ts).
      await runner.stop();

      // It lands late.
      funded(t);
      if (how === "refresh") {
        expect((await sessions.list("preprod", true))[0]).toMatchObject({ stage: "open", auto: { step: "ordering" } });
        expect(runner.on).toBe(true);
        view = await sessions.advance("preprod", 0, true);
      } else {
        view = await sessions.resume("preprod", 0);
      }
      expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
    }
  });

  it("looks for a step Koios didn't answer before building it again, and once that copy lands, it's the one", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    await sessions.stop("preprod", 0);
    funded(t);
    // The return goes out, and Koios times out on it: it may be on its way.
    const undo = unanswered(t);
    let view = await sessions.advance("preprod", 0, true);
    undo();
    const first = txIdOf(t.koios.submitted.at(-1)!);
    t.koios.missing.add(first);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "back"]);

    // Minutes on, it isn't built again: Koios may have it.
    await busy(t, 3 * 60_000);
    await sessions.advance("preprod", 0, true);
    expect(t.koios.submitted).toHaveLength(2);

    // Unseen for 15 minutes: it's built again, from what it spent, free again now (final review sessions-1).
    await busy(t, 13 * 60_000);
    await sessions.advance("preprod", 0, true);
    expect(t.koios.submitted).toHaveLength(3);
    const second = txIdOf(t.koios.submitted.at(-1)!);
    expect(second).not.toBe(first);
    t.koios.missing.add(second);

    // The first lands after all: it's the return, the second can't land, and the session is done.
    t.koios.missing.delete(first);
    t.koios.spent.add(`${sessionSwap.utxo.tx_hash}#${sessionSwap.utxo.tx_index}`);
    view = await sessions.advance("preprod", 0, true);
    expect(view.stage).toBe("closed");
    expect(view.txs.map((x) => [x.kind, x.txHash])).toEqual([
      ["out", expect.any(String)],
      ["back", first],
    ]);
  });

  /** Session 0's funding UTxO the recorded swap spends, and its 5 ₳ collateral, as `txhash#index`. */
  const FUNDING = `${sessionSwap.utxo.tx_hash}#${sessionSwap.utxo.tx_index}`;
  const COLLATERAL = `${"0c".repeat(32)}#1`;

  /** A running swap, funded with the recorded swap's UTxO and 5 ₳ of collateral, whose order's submit gets a 504 and never reaches a node. */
  async function unanswered504(t: T, sessions: SessionService) {
    await started(sessions);
    funded(t);
    t.koios.addedToAccounts.push(atSession("0c".repeat(32), 1, "5000000"));
    t.koios.missing.add(SWAP_TX);
    const undo = unanswered(t);
    const view = await sessions.advance("preprod", 0);
    undo();
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
  }

  it("builds a swap Koios didn't answer again from the funding it spent, once it's gone unseen (final review sessions-1)", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await unanswered504(t, sessions);
    // Unseen for 15 minutes. Minswap builds it again with a later validity, so another id, from the same funding.
    await busy(t, 16 * 60_000);
    t.minswap.swapCbor = swapTx({ ttl: 134_700_000 });
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.paused).toBeUndefined();
    const again = t.koios.submitted.at(-1)!;
    expect(txIdOf(again)).not.toBe(SWAP_TX);
    expect(bodyOutpoints(again, 0)).toEqual([FUNDING]);
  });

  it("brings the funding back when Stop comes while an order Koios didn't answer is unseen, and isn't over while that copy may land (final review sessions-1, sessions-2)", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await unanswered504(t, sessions);
    // Stop, five minutes on: it waits for the order, which Koios may have.
    await busy(t, 5 * 60_000);
    await sessions.stop("preprod", 0);
    expect(t.koios.submitted).toHaveLength(2);

    // Unseen for 15 minutes, and Minswap lists no order of it: everything comes back, the funding it spent too.
    await busy(t, 11 * 60_000);
    await sessions.advance("preprod", 0, true);
    expect(t.minswap.calls.at(-1)!.path).toBe("pending-orders");
    const back = t.koios.submitted.at(-1)!;
    expect(bodyOutpoints(back, 0)!.sort()).toEqual([FUNDING, COLLATERAL].sort());

    // The return lands. The order's copy is still looked for its two hours: over only after them.
    t.koios.spent.add(FUNDING).add(COLLATERAL);
    let view = await sessions.advance("preprod", 0, true);
    expect(view).toMatchObject({ stage: "open", holding: { utxos: 0 } });
    await busy(t, 2 * 60 * 60_000);
    view = await sessions.advance("preprod", 0, true);
    expect(view.stage).toBe("closed");
  });

  it("isn't over while Koios still lists what a step that never landed spent, though the wallet counts it spent (final review sessions-1)", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const now = t.clock.now;
    const done = (kind: string, txHash: string) => ({ kind, txHash, at: now, confirmed: true });
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: now,
          txs: [done("out", "01".repeat(32)), done("back", "05".repeat(32))],
          swap: { ...ASK, amountOut: "906594100", minAmountOut: "902083681" },
          auto: { approved: { minAmountOut: "902083681", fund: { lovelace: "16000000", tokens: [] } }, stopping: now },
        },
      ],
    });
    // A transaction Koios didn't answer spent it, and never landed: it's still at the account.
    t.koios.addedToAccounts.push(atSession("01".repeat(32), 0, "16000000"));
    await t.wallet.withKeys(() => t.session.set(SESSION_SPENT, { [`${"01".repeat(32)}#0`]: Date.now() }));
    expect((await sessions.list("preprod", true))[0]!.stage).toBe("open");
    expect((await sessions.advance("preprod", 0, true)).stage).toBe("open");
    // Gone from the account: over.
    t.koios.spent.add(`${"01".repeat(32)}#0`);
    expect((await sessions.advance("preprod", 0, true)).stage).toBe("closed");
  });

  it("takes a swap that went unseen and lands late, with no copy after it, for the step: Stop cancels its order, Try again waits for its fill (final review sessions-2)", async () => {
    for (const how of ["stop", "stop before tx_status shows it", "resume"] as const) {
      const t = await unlocked();
      const sessions = signing(t);
      await started(sessions);
      funded(t);
      t.koios.addedToAccounts.push(atSession("0c".repeat(32), 1, "5000000"));
      // Sent, but tx_status doesn't show it for 16 minutes. Its copy built again spends what the first did,
      // counted spent still: refused, so it pauses.
      t.koios.missing.add(SWAP_TX);
      await sessions.advance("preprod", 0);
      await busy(t, 16 * 60_000);
      let view = await sessions.advance("preprod", 0, true);
      expect(view.auto!.paused).toMatchObject({ why: "refused" });
      const builds = t.minswap.calls.filter((c) => c.path === "build-tx").length;

      // It shows up after all, and Minswap lists its order (tx_status, behind, may not show it yet).
      if (how !== "stop before tx_status shows it") t.koios.missing.delete(SWAP_TX);
      ordered(t);
      t.minswap.orders = [{ ...ORDER, tx_in: `${SWAP_TX}#0` }];
      if (how !== "resume") {
        view = await sessions.stop("preprod", 0);
        // Its order is cancelled, never left at the DEX for a session that's over.
        expect(t.minswap.calls.map((c) => c.path)).toContain("cancel-tx");
        expect(view.txs.map((x) => x.kind)).not.toContain("back");
        expect(view.stage).toBe("open");
      } else {
        view = await sessions.resume("preprod", 0);
        expect(view.auto).toMatchObject({ step: "filling" });
        // Filled: its proceeds come back, with no second order.
        t.minswap.orders = [];
        t.koios.spent.add(`${SWAP_TX}#0`);
        t.koios.addedToAccounts.push(atSession("aa".repeat(32), 0, "2000000", [[MIN, "906594100"]]));
        view = await sessions.advance("preprod", 0, true);
        expect(view.auto).toMatchObject({ step: "returning", filled: true });
        expect(t.minswap.calls.filter((c) => c.path === "build-tx")).toHaveLength(builds);
      }
    }
  });

  it("is over once a return that went unseen lands late, with no copy after it (final review sessions-2)", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    await sessions.stop("preprod", 0);
    funded(t);
    await sessions.advance("preprod", 0, true);
    const back = txIdOf(t.koios.submitted.at(-1)!);
    // tx_status doesn't show it for 16 minutes; its copy built again finds nothing to spend.
    t.koios.missing.add(back);
    await busy(t, 16 * 60_000);
    await sessions.advance("preprod", 0, true);
    expect(t.koios.submitted).toHaveLength(2);
    // It shows up after all: it's the return, and the session is over.
    t.koios.missing.delete(back);
    t.koios.spent.add(FUNDING);
    const view = await sessions.advance("preprod", 0, true);
    expect(view.stage).toBe("closed");
    expect(view.txs.map((x) => [x.kind, x.txHash])).toEqual([
      ["out", expect.any(String)],
      ["back", back],
    ]);
    expect(await sessions.runAll("preprod")).toBe(false);
  });

  it("looks only at the orders of the swap's copy that landed, recorded before it was sent (final review sessions-3)", async () => {
    /** The swap `txHash` landed: its order waits at the DEX's contract (output 0), and its change is at the account. */
    const landed = (t: T, txHash: string) => {
      t.koios.spent.add(FUNDING);
      t.koios.addedToAccounts.push(atSession(txHash, 1, "131585414"), {
        ...atSession(txHash, 0, "14000000"),
        address: bech32("addr_test", bytes(ORDER_ADDRESS)),
        payment_cred: "a6".repeat(28),
      });
    };
    /** A batcher fills the order at `txHash`#0, and pays the proceeds. */
    const fill = (t: T, txHash: string) => {
      t.koios.spent.add(`${txHash}#0`);
      t.koios.addedToAccounts.push(atSession("aa".repeat(32), 0, "2000000", [[MIN, "906594100"]]));
    };
    const LATER = swapTx({ ttl: 134_700_000 });
    const later = txIdOf(bytes(LATER));

    // A swap Koios didn't answer that went in: a stranger's 1 ₳ while Minswap lists nothing isn't its fill.
    let t = await unlocked();
    let sessions = signing(t);
    await started(sessions);
    funded(t);
    let undo = unanswered(t);
    await sessions.advance("preprod", 0);
    undo();
    landed(t, SWAP_TX);
    t.koios.addedToAccounts.push(atSession("dd".repeat(32), 0, "1000000"));
    let view = await sessions.advance("preprod", 0, true);
    expect(view.auto).toMatchObject({ step: "filling", filled: false });
    expect(t.koios.submitted).toHaveLength(2);

    // The copy Koios didn't answer lands, after one built again was sent: its fill is taken.
    t = await unlocked();
    sessions = signing(t);
    await started(sessions);
    funded(t);
    t.koios.missing.add(SWAP_TX);
    undo = unanswered(t);
    await sessions.advance("preprod", 0);
    undo();
    await busy(t, 16 * 60_000);
    t.minswap.swapCbor = LATER;
    t.koios.missing.add(later);
    await sessions.advance("preprod", 0, true);
    expect(txIdOf(t.koios.submitted.at(-1)!)).toBe(later);
    t.koios.missing.delete(SWAP_TX);
    landed(t, SWAP_TX);
    fill(t, SWAP_TX);
    view = await sessions.advance("preprod", 0, true);
    expect(view.auto).toMatchObject({ step: "returning", filled: true });
    expect(view.txs.map((x) => [x.kind, x.txHash])).toEqual([
      ["out", expect.any(String)],
      ["swap", SWAP_TX],
      ["back", expect.any(String)],
    ]);

    // The copy built again, which Koios didn't answer, lands instead: its fill is taken.
    t = await unlocked();
    sessions = signing(t);
    await started(sessions);
    funded(t);
    t.koios.missing.add(SWAP_TX);
    await sessions.advance("preprod", 0);
    // Sent cleanly, it's counted spent until a lock: built again after one.
    await busy(t, 16 * 60_000);
    await t.wallet.lock();
    await t.wallet.unlock(PASSWORD);
    t.minswap.swapCbor = LATER;
    undo = unanswered(t);
    await sessions.advance("preprod", 0, true);
    undo();
    expect(txIdOf(t.koios.submitted.at(-1)!)).toBe(later);
    landed(t, later);
    fill(t, later);
    view = await sessions.advance("preprod", 0, true);
    expect(view.auto).toMatchObject({ step: "returning", filled: true });
    expect(view.txs.map((x) => [x.kind, x.txHash])).toEqual([
      ["out", expect.any(String)],
      ["swap", later],
      ["back", expect.any(String)],
    ]);
  });

  it("brings back in another return what one couldn't take, and closes without what can't come back", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    await sessions.stop("preprod", 0);
    funded(t);
    // A stranger's junk: three UTxOs of 2^63 − 1 of one token, more together than an output holds, on a
    // little ADA each; and one holding a reference script Koios gives no bytes for, which no transaction takes.
    const junk = `${"ab".repeat(28)}6a756e6b`;
    const most = (2n ** 63n - 1n).toString();
    t.koios.addedToAccounts.push(
      ...["e1", "e2", "e3"].map((h) => atSession(h.repeat(32), 0, "1200000", [[junk, most]])),
      { ...atSession("e4".repeat(32), 0, "3000000"), reference_script: { hash: "cd".repeat(28), size: 900, type: "plutusV3", bytes: null } },
    );

    // The return takes the funding and two of them; the third waits for the next.
    let view = await sessions.advance("preprod", 0, true);
    const first = t.koios.submitted.at(-1)!;
    expect(bodyOutpoints(first, 0)!.sort()).toEqual(
      [`${sessionSwap.utxo.tx_hash}#${sessionSwap.utxo.tx_index}`, `${"e1".repeat(32)}#0`, `${"e2".repeat(32)}#0`].sort(),
    );
    expect(view.leftBehind).toEqual([{ txHash: "e4".repeat(32), txIndex: 0, reason: "script", lovelace: "3000000" }]);

    // It lands. The next return is of the third alone: 1.2 ₳ can't pay for its own deposit and fee, so it stays.
    for (const h of [`${sessionSwap.utxo.tx_hash}#${sessionSwap.utxo.tx_index}`, `${"e1".repeat(32)}#0`, `${"e2".repeat(32)}#0`]) {
      t.koios.spent.add(h);
    }
    view = await sessions.advance("preprod", 0, true);
    expect(t.koios.submitted).toHaveLength(2);
    expect(view.auto?.retry).toBeUndefined();
    // Nothing else can come back: the session's over, and says what it left.
    view = await sessions.advance("preprod", 0, true);
    expect(view).toMatchObject({ stage: "closed", holding: { utxos: 0 } });
    expect(view.leftBehind).toEqual([
      { txHash: "e4".repeat(32), txIndex: 0, reason: "script", lovelace: "3000000" },
      { txHash: "e3".repeat(32), txIndex: 0, reason: "fee", lovelace: "1200000" },
    ]);
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
    // Paused, it waits for the user: the runner leaves it, and the worker's run stops the alarm (runs.ts).
    t.clock.now += 60_000;
    expect(await sessions.runAll("preprod")).toBe(false);
    expect(t.minswap.calls.filter((c) => c.path === "estimate")).toHaveLength(2);
    await runner.stop();

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

  it("pauses rather than sign a swap that pays anyone but the session, an order made out to it, and Minswap's quoted fee", async () => {
    const other = `00${"c4".repeat(28)}${"c5".repeat(28)}`;
    const refused = async (swapCbor: string, quoted?: string) => {
      const t = await unlocked();
      const sessions = signing(t);
      t.minswap.swapCbor = swapCbor;
      if (quoted) t.minswap.estimate = { ...minswapEstimate.estimate, aggregator_fee: quoted };
      await started(sessions);
      funded(t);
      const { paused } = (await sessions.advance("preprod", 0)).auto!;
      // Paused, nothing is signed: only the funding was sent.
      expect(t.koios.submitted).toHaveLength(paused ? 1 : 2);
      return paused?.why === "refused" ? paused.detail : paused;
    };
    // The change to someone else.
    expect(await refused(swapTx({ outputs: [[ORDER_ADDRESS, 14_000_000, ORDER_DATUM], [other, 131_585_414]] }))).toBe(
      "it pays an address that isn't this session's.",
    );
    // The session's key under someone else's staking.
    const franken = `${SESSION_ADDRESS.slice(0, 58)}${"c5".repeat(28)}`;
    expect(await refused(swapTx({ outputs: [[ORDER_ADDRESS, 14_000_000, ORDER_DATUM], [franken, 131_585_414]] }))).toBe(
      "it pays this session's key under someone else's staking part.",
    );
    // An order made out to someone else: the recorded one's, the public account's.
    expect(await refused(swapTx({ datum: builtOutputs(bytes(recordedSwap.cbor))[0]!.datum! }))).toBe(
      "its order isn't for this session.",
    );
    // An order whose details it doesn't carry.
    expect(await refused(sessionSwap.swapCbor)).toBe("it pays a contract without saying who the order is for.");
    // An order under another staking part.
    const staked = `10${"a6".repeat(28)}${"c5".repeat(28)}`;
    expect(await refused(swapTx({ outputs: [[staked, 14_000_000, ORDER_DATUM], [SESSION_ADDRESS, 131_585_414]] }))).toBe(
      "it pays a contract under someone else's staking part.",
    );

    // Minswap's fee: one more output, ADA alone, no more than the fee approved with the funding, wherever it goes.
    const withFee = swapTx({ outputs: [[ORDER_ADDRESS, 14_000_000, ORDER_DATUM], [other, 1_000_000], [SESSION_ADDRESS, 130_585_414]] });
    expect(await refused(withFee, "1000000")).toBeUndefined();
    expect(await refused(withFee, "999999")).toBe("it pays an address that isn't this session's.");
    expect(await refused(withFee)).toBe("it pays an address that isn't this session's.");
    const contract = `70${"f0".repeat(28)}`;
    const toContract = swapTx({ outputs: [[ORDER_ADDRESS, 14_000_000, ORDER_DATUM], [contract, 1_000_000], [SESSION_ADDRESS, 130_585_414]] });
    expect(await refused(toContract, "1000000")).toBeUndefined();
    expect(await refused(toContract)).toBe("it pays a contract without saying who the order is for.");
    // No order at all, only the fee: nothing a swap would sign.
    expect(await refused(swapTx({ outputs: [[other, 1_000_000], [SESSION_ADDRESS, 144_585_414]] }), "1000000")).toBe(
      "it places no order.",
    );
  });

  it("pauses rather than sign a swap that gives ADA to the treasury, which no output shows", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    t.minswap.swapCbor = swapTx({
      outputs: [
        [ORDER_ADDRESS, 14_000_000, ORDER_DATUM],
        [SESSION_ADDRESS, 31_585_414],
      ],
      donation: 100_000_000,
    });
    await started(sessions);
    funded(t);
    const view = await sessions.advance("preprod", 0);
    expect(view.auto!.paused).toMatchObject({ why: "refused", detail: "it gives ADA to the treasury." });
    expect(t.koios.submitted).toHaveLength(1);
  });

  it("cancels an order with a small fee that pays no one else, and pauses rather than sign one with a large fee", async () => {
    const cancelTx = (fee: number, donation?: number) => {
      const own = bytes(SESSION_ADDRESS);
      const body = new Map<number, Cbor>([
        // The swap's change, and its order at the DEX's contract.
        [0, { tag: 258, of: [[bytes(SWAP_TX), 1], [bytes(SWAP_TX), 0]] }],
        [1, [new Map<number, Cbor>([[0, own], [1, 131_585_414 + 14_000_000 - fee - (donation ?? 0)]])]],
        [2, fee],
        [3, 134_639_865],
        [13, { tag: 258, of: [[bytes(SWAP_TX), 1]] }],
        [14, { tag: 258, of: [bytes(sessionSwap.keyHash)] }],
        [16, new Map<number, Cbor>([[0, own], [1, 131_585_414 - (fee * 3) / 2]])],
        [17, (fee * 3) / 2],
      ]);
      if (donation) body.set(22, donation);
      const redeemers = new Map<number, Cbor>([[5, [[0, 0, { tag: 122, of: [] }, [500_000, 200_000_000]]]]]);
      return hex(cbor([body, redeemers, true, null]));
    };
    const stopped = async (cancelCbor: string) => {
      const t = await unlocked();
      const sessions = signing(t);
      await started(sessions);
      funded(t);
      await sessions.advance("preprod", 0);
      // The order waits at the DEX's contract; Stop asks Minswap to cancel it.
      ordered(t);
      t.minswap.orders = [{ ...ORDER, tx_in: `${SWAP_TX}#0` }];
      t.minswap.cancelCbor = cancelCbor;
      const view = await sessions.stop("preprod", 0);
      return { view, sent: t.koios.submitted.length };
    };
    // 0.4 ₳, all of it back to the session: signed and sent.
    const fine = await stopped(cancelTx(400_000));
    expect(fine.view.auto!.paused).toBeUndefined();
    expect(fine.view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel"]);
    // 5 ₳ is more than any cancel of Minswap's takes.
    const costly = await stopped(cancelTx(5_000_000));
    expect(costly.view.auto!.paused).toMatchObject({ why: "refused", detail: "its cancel's fee is more than a cancel takes." });
    expect(costly.sent).toBe(2);
    // So is 13 ₳ of the order's given to the treasury.
    const gift = await stopped(cancelTx(400_000, 13_000_000));
    expect(gift.view.auto!.paused).toMatchObject({ why: "refused", detail: "it gives ADA to the treasury." });
  });

  it("reads where a swap pays the same way on the order Minswap's aggregator really built", async () => {
    const outputs = builtOutputs(bytes(recordedSwap.cbor));
    // Made out to its sender (the 12-word phrase's public account): its order, output 0, and the change back.
    expect(checkOrder(outputs, { address: SENDER, keyHash: SENDER.slice(2, 58) }, 0n)).toEqual([0]);
    expect(() => checkOrder(outputs, { address: SESSION_ADDRESS, keyHash: sessionSwap.keyHash }, 0n)).toThrow(Refused);
  });

  it("won't let the user sign a swap the runner wouldn't", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    t.minswap.swapCbor = sessionSwap.swapCbor;
    await started(sessions);
    funded(t);
    await expect(sessions.swapBuild("preprod", 0)).rejects.toThrow("The wallet won't sign what Minswap built: it pays a contract without saying");
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

  it("sends no step the moment the wallet unlocks: one found then waits a fresh draw inside the unlocked stretch, and goes after (privacy review §3.1)", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    // The funding lands while the wallet is locked, and it's unlocked hours later.
    funded(t);
    await t.wallet.lock();
    t.clock.now += 3 * HOUR;
    await t.wallet.unlock(PASSWORD);
    const at = t.clock.now;
    const sent = t.koios.submitted.length;
    await sessions.runAll("preprod", true);
    // The unlock's run reads the session, and sends nothing: Minswap isn't even asked to build the order.
    expect(t.koios.submitted).toHaveLength(sent);
    expect(t.minswap.calls.map((c) => c.path)).not.toContain("build-tx");
    let [view] = await sessions.list("preprod");
    const until = view!.auto!.waitsUntil!;
    // Inside the stretch the unlock keeps the wallet open: 2 minutes on at least, 2 before the 15-minute auto-lock at most.
    expect(until).toBeGreaterThanOrEqual(at + UNLOCK_WAIT_MS[0]);
    expect(until).toBeLessThanOrEqual(at + 13 * 60_000);
    // The alarm's runs, and the page watching it, wait for it.
    await busy(t, 60_000);
    await sessions.runAll("preprod");
    t.clock.now += 20_000;
    await sessions.advance("preprod", 0);
    expect(t.koios.submitted).toHaveLength(sent);
    // Once it's past, the next run places the order, and the wait is done with.
    t.clock.now = until;
    await t.wallet.touch();
    await sessions.runAll("preprod");
    expect(txIdOf(t.koios.submitted.at(-1)!)).toBe(SWAP_TX);
    [view] = await sessions.list("preprod");
    expect(view!.auto!.waitsUntil).toBeUndefined();
  });

  it("draws a step's wait at one unlock only: locked before it went, it goes at the run after the next unlock's", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    funded(t);
    await t.wallet.lock();
    t.clock.now += 3 * HOUR;
    await t.wallet.unlock(PASSWORD);
    const sent = t.koios.submitted.length;
    await sessions.runAll("preprod", true);
    const until = (await sessions.list("preprod"))[0]!.auto!.waitsUntil!;
    // The wallet locks a minute later; hours on, the next unlock doesn't draw it again, nor sends it.
    await busy(t, 60_000);
    await t.wallet.lock();
    t.clock.now += 3 * HOUR;
    await t.wallet.unlock(PASSWORD);
    await sessions.runAll("preprod", true);
    expect(t.koios.submitted).toHaveLength(sent);
    expect((await sessions.list("preprod"))[0]!.auto!.waitsUntil).toBe(until);
    // The run after it places the order.
    await busy(t, 60_000);
    await sessions.runAll("preprod");
    expect(txIdOf(t.koios.submitted.at(-1)!)).toBe(SWAP_TX);
  });

  it("takes a step at once when the user asks, whatever the wait after the unlock", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    funded(t);
    await t.wallet.lock();
    t.clock.now += 3 * HOUR;
    await t.wallet.unlock(PASSWORD);
    await sessions.runAll("preprod", true);
    expect((await sessions.list("preprod"))[0]!.auto!.waitsUntil).toBeDefined();
    // The page's Refresh.
    const view = await sessions.advance("preprod", 0, true);
    expect(txIdOf(t.koios.submitted.at(-1)!)).toBe(SWAP_TX);
    expect(view.auto!.waitsUntil).toBeUndefined();
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
    ordered(t);
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

describe("bring everything back", () => {
  it("returns each session that holds something in its own transaction, and says why it left out the rest", async () => {
    const t = await unlocked();
    const { wasm } = t.deps;
    const at = await t.wallet.withKeys((k) =>
      [0, 1, 2, 3].map((i) => ({ address: k.oneTime.address(wasm.Network.Preprod, i), keyHash: k.oneTime.keyHash(i) })),
    );
    const now = t.clock.now;
    const out = (n: number) => ({ kind: "out", txHash: String(n).repeat(64), at: now, confirmed: true });
    await t.store.set("sessions.preprod", {
      next: 4,
      sessions: [
        { index: 0, ownStake: true, createdAt: now, txs: [out(1)], site: { origin: "https://a.example" } },
        { index: 1, ownStake: true, createdAt: now, txs: [out(2)], site: { origin: "https://b.example" } },
        {
          index: 2,
          ownStake: true,
          createdAt: now,
          txs: [out(3)],
          swap: { ...ASK, amountOut: "906594100", minAmountOut: "902083681" },
          auto: { approved: { minAmountOut: "902083681", fund: { lovelace: "16000000", tokens: [] } } },
        },
        { index: 3, ownStake: true, createdAt: now, txs: [out(4)], site: { origin: "https://c.example" } },
      ],
    });
    const held = (i: number, tx: string, value: string) => ({
      ...atSession(tx, 0, value),
      address: at[i]!.address,
      payment_cred: at[i]!.keyHash,
    });
    t.koios.addedToAccounts.push(
      held(0, "a0".repeat(32), "20000000"),
      held(2, "a2".repeat(32), "9000000"),
      held(3, "a3".repeat(32), "7000000"),
    );

    // Sessions 0 and 3 hold something; 1 holds nothing, and 2 is a swap that brings itself back.
    const { returns, skipped } = await t.sessions.claimBuild("preprod", [0, 1, 2, 3]);
    expect(returns.map((r) => [r.index, r.inputs])).toEqual([
      [0, 1],
      [3, 1],
    ]);
    expect(skipped).toEqual([
      { index: 1, reason: "It holds nothing." },
      { index: 2, reason: "A swap that runs itself comes back by itself." },
    ]);

    // Sent one after another, each its own transaction: never one spending several sessions together.
    const { sent, failed } = await t.sessions.claimSubmit("preprod", returns.map((r) => r.txHash));
    expect(failed).toEqual([]);
    expect(sent.map((x) => x.index)).toEqual([0, 3]);
    expect(t.koios.submitted.map((b) => txIdOf(b))).toEqual(returns.map((r) => r.txHash));
    const views = await t.sessions.list("preprod");
    expect(views.find((v) => v.index === 0)!.txs.map((x) => x.kind)).toEqual(["out", "back"]);
    expect(views.find((v) => v.index === 3)!.stage).toBe("returning");
    // Sent once: asked again, there's nothing ready.
    await expect(t.sessions.claimSubmit("preprod", returns.map((r) => r.txHash))).rejects.toThrow("aren't ready to send");
  });
});

describe("disconnecting a site's session", () => {
  const ORIGIN = "https://a.example";

  it("waits for its funding, and its return, to reach the chain, and for the account to be empty as Koios lists it", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const out = await sessions.siteOutBuild("preprod", ORIGIN, "15000000", []);
    await sessions.siteOutSubmit("preprod", out.txHash, ORIGIN);
    // Sent, and not on chain yet: the account reads empty, but the funding may land any moment.
    await expect(sessions.disconnect("preprod", 0)).rejects.toThrow("hasn't reached the chain yet");

    // It lands: the account holds it.
    t.koios.confirmations = 1;
    t.koios.addedToAccounts.push(atSession("a0".repeat(32), 0, "15000000"), atSession("a1".repeat(32), 1, "5000000"));
    await expect(sessions.disconnect("preprod", 0)).rejects.toThrow("Bring it back first");

    // Brought back: the page shows it holding nothing, since the wallet spent it, but the return isn't on chain.
    const back = await sessions.backBuild("preprod", 0);
    await sessions.backSubmit("preprod", back.txHash);
    t.koios.missing.add(back.txHash);
    expect((await sessions.list("preprod", true))[0]).toMatchObject({ stage: "returning", holding: { utxos: 0 } });
    await expect(sessions.disconnect("preprod", 0)).rejects.toThrow("hasn't reached the chain yet");
    // Twenty minutes on it still isn't, and never will be: what it spent is still at the account.
    await busy(t, FAILED_AFTER);
    await expect(sessions.disconnect("preprod", 0)).rejects.toThrow("Bring it back first");

    // A return that lands empties it: disconnected, for good.
    t.koios.missing.clear();
    t.koios.addedToAccounts.splice(0);
    await sessions.disconnect("preprod", 0);
    expect((await sessions.list("preprod"))[0]!.stage).toBe("closed");
  });

  it("waits for a funding the wallet's watch still sends, or took lately, whatever the 20 minutes since it was first sent say (final review sessions-6)", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const out = await sessions.siteOutBuild("preprod", ORIGIN, "15000000", []);
    // Koios takes 20 s, then doesn't answer: the watch has it as maybe sent, from then.
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      if (!url.endsWith("/submittx")) return real(url, init);
      t.clock.now += 20_000;
      return new Response("upstream request timeout", { status: 504 });
    };
    await expect(sessions.siteOutSubmit("preprod", out.txHash, ORIGIN)).resolves.toMatchObject({ pending: { maybeSent: true } });
    t.koios.fetch = real;
    t.koios.missing.add(out.txHash);

    // Twenty minutes since the session recorded it: the watch still sends it, so it may land yet.
    await busy(t, FAILED_AFTER - 20_000);
    await expect(sessions.disconnect("preprod", 0)).rejects.toThrow("hasn't reached the chain yet");
    // A lock wipes the watch until it's put back: its sealed copy still says so.
    await t.wallet.lock();
    await t.wallet.unlock(PASSWORD);
    await expect(sessions.disconnect("preprod", 0)).rejects.toThrow("hasn't reached the chain yet");

    // The watch sends it again, and Koios takes it: sent a minute ago, it may still land.
    await t.pending.pending("preprod");
    expect(await t.session.get(pendingKey("preprod"))).toMatchObject({ txHash: out.txHash, submittedAt: t.clock.now });
    await busy(t, 60_000);
    await expect(sessions.disconnect("preprod", 0)).rejects.toThrow("hasn't reached the chain yet");

    // Twenty minutes after that, still not on chain: it never went, and the empty session ends.
    await busy(t, FAILED_AFTER);
    await sessions.disconnect("preprod", 0);
    expect((await sessions.list("preprod"))[0]!.stage).toBe("closed");
  });

  it("forgets no swap whose funding the wallet's watch still sends (final review sessions-6)", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const out = await sessions.outBuild("preprod", await sessions.quote("preprod", ASK));
    const undo = unanswered(t);
    await sessions.outSubmit("preprod", out.txHash);
    undo();
    t.koios.missing.add(out.txHash);
    // Twenty minutes on, the runner finds it never funded; the watch, which hasn't looked since, still sends it.
    await busy(t, FAILED_AFTER);
    expect((await sessions.advance("preprod", 0)).stage).toBe("failed");
    await expect(sessions.forget("preprod", 0)).rejects.toThrow("Its funding may still reach the chain");
    // The watch lets it go, unseen: now it's forgotten.
    await t.pending.pending("preprod");
    expect(await t.session.get(pendingKey("preprod"))).toBeUndefined();
    expect(await sessions.forget("preprod", 0)).toEqual([]);
  });

  it("waits for its return's chain through Lovejoin, and doesn't wait for what no return takes", async () => {
    const t = await returning("0f".repeat(32));
    // The chain's rest is being sent between the runner's steps.
    const chain = `${SESSION_CHAIN_PREFIX}preprod.0`;
    await t.wallet.withKeys(() => t.session.set(chain, { txs: [], next: 0, flying: [], index: 0, kept: SESSION_BACK, summary: {} }));
    await expect(t.sessions.disconnect("preprod", 0)).rejects.toThrow("still being sent");
    await t.wallet.withKeys(() => t.session.remove(chain));

    // Brought back, but for a stranger's UTxO holding a reference script no transaction of the wallet's takes.
    t.koios.addedToAccounts.push({
      ...atSession("e4".repeat(32), 0, "3000000"),
      reference_script: { hash: "cd".repeat(28), size: 900, type: "plutusV3", bytes: null },
    });
    const back = await t.sessions.backBuild("preprod", 0);
    expect(back.inputs).toBe(2);
    await t.sessions.backSubmit("preprod", back.txHash);
    t.koios.confirmations = 1;
    t.koios.spent.add(`${"a0".repeat(32)}#0`).add(`${"a1".repeat(32)}#1`);
    const [view] = await t.sessions.list("preprod", true);
    expect(view).toMatchObject({ stage: "open", holding: { utxos: 0 } });
    expect(view!.leftBehind).toEqual([{ txHash: "e4".repeat(32), txIndex: 0, reason: "script", lovelace: "3000000" }]);
    await t.sessions.disconnect("preprod", 0);
    expect((await t.sessions.list("preprod"))[0]!.stage).toBe("closed");
  });
});

describe("a return kept for Send", () => {
  it("isn't cleared by the runner bringing another session back", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const net = t.deps.wasm.Network.Preprod;
    const one = await t.wallet.withKeys((k) => ({ address: k.oneTime.address(net, 1), keyHash: k.oneTime.keyHash(1) }));
    const now = t.clock.now;
    const out = (n: number) => ({ kind: "out", txHash: String(n).repeat(64), at: now, confirmed: true });
    await t.store.set("sessions.preprod", {
      next: 2,
      sessions: [
        { index: 0, ownStake: true, createdAt: now, txs: [out(1)], site: { origin: "https://a.example" } },
        {
          index: 1,
          ownStake: true,
          createdAt: now,
          txs: [out(2)],
          swap: { ...ASK, amountOut: "906594100", minAmountOut: "902083681" },
          auto: { approved: { minAmountOut: "902083681", fund: { lovelace: "16000000", tokens: [] } }, stopping: now },
        },
      ],
    });
    t.koios.addedToAccounts.push(atSession("a0".repeat(32), 0, "12000000"), {
      ...atSession("b0".repeat(32), 0, "16000000"),
      address: one.address,
      payment_cred: one.keyHash,
    });

    // The user reviews Bring it back for the site's session; meanwhile the runner brings the stopped swap back.
    const back = await sessions.backBuild("preprod", 0);
    await sessions.advance("preprod", 1, true);
    expect((await sessions.list("preprod")).find((v) => v.index === 1)!.txs.map((x) => x.kind)).toEqual(["out", "back"]);
    // The user's Send still sends what they reviewed.
    await expect(sessions.backSubmit("preprod", back.txHash)).resolves.toMatchObject({ txHash: back.txHash });
    expect(t.koios.submitted.map(txIdOf).at(-1)).toBe(back.txHash);
  });
});

/** Session 0, a site's, whose funding made `change` (a UTxO of the private balance), holding 12 ₳ and its 5 ₳ collateral. */
async function returning(change: string) {
  const t = await unlocked();
  const now = t.clock.now;
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: now,
        txs: [{ kind: "out", txHash: change, at: now, confirmed: true }],
        site: { origin: "https://a.example" },
      },
    ],
  });
  t.koios.addedToAccounts.push(atSession("a0".repeat(32), 0, "12000000"), atSession("a1".repeat(32), 1, "5000000"));
  return t;
}

describe("a session's return", () => {
  const hex = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));

  it("merges into the Seedelf UTxO its funding made, under the session's own collateral, signed by its key alone", async () => {
    const change = ownedUtxos[0]!;
    const t = await returning(change.tx_hash);
    const back = await t.sessions.backBuild("preprod", 0);
    expect(back).toMatchObject({ index: 0, inputs: 2, merged: 1 });
    // What the private balance gains is the account's 17 ₳, less the fee.
    expect(BigInt(back.lovelace) + BigInt(back.fee)).toBe(17_000_000n);

    const kept = (await t.wallet.withKeys(() => t.session.get<{ txCbor: string }>(SESSION_BACK)))!;
    const bytes = hex(kept.txCbor);
    expect(bodyOutpoints(bytes, 0)!.sort()).toEqual(
      [`${change.tx_hash}#${change.tx_index}`, `${"a0".repeat(32)}#0`, `${"a1".repeat(32)}#1`].sort(),
    );
    expect(bodyOutpoints(bytes, 13)).toEqual([`${"a1".repeat(32)}#1`]);
    // No giveme.my: the session's collateral is enough, and nothing else signs.
    expect(t.collateral.asked).toEqual([]);

    await t.sessions.backSubmit("preprod", back.txHash);
    expect(txIdOf(t.koios.submitted.at(-1)!)).toBe(back.txHash);
  });

  it("makes new UTxOs when the funding's change isn't in the private balance anymore", async () => {
    const t = await returning("0f".repeat(32));
    const back = await t.sessions.backBuild("preprod", 0);
    expect(back.merged).toBe(0);
    const kept = (await t.wallet.withKeys(() => t.session.get<{ txCbor: string }>(SESSION_BACK)))!;
    expect(bodyOutpoints(hex(kept.txCbor), 0)).toHaveLength(2);
    expect(bodyOutpoints(hex(kept.txCbor), 13)).toBeUndefined();
  });
});
