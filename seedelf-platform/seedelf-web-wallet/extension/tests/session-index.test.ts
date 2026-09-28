// A new session's one-time account is asked about again just before its
// funding is sent (independent review M13). Review finds the index unused,
// but the funding may wait for Send, and the same phrase in another browser
// (or a wallet removed and restored, whose record starts again at 0) may
// fund a session of its own there meanwhile: two sessions on one key are
// tied together on chain, and each site would see the other's money. The
// 12-word phrase, the real WebAssembly, and fakes of Koios, giveme.my and
// Minswap's aggregator.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { Minswap } from "../src/background/minswap";
import { SESSION_MIX_OUT, SessionService } from "../src/background/sessions";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, minswapEstimate, sessionSwap, testBalances, vectors, withdrawPreprod } from "./fakes";

const PASSWORD = "correct horse battery";
const ORIGIN = "https://a.example";
const phrase = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase as string;
const USED = "That session's one-time account was used meanwhile";

type T = Awaited<ReturnType<typeof unlocked>>;

/** A browser holding the 12-word phrase: its own storage, and its own view of Koios. */
async function unlocked() {
  const t = testBalances();
  await t.wallet.create(phrase, PASSWORD);
  // One spend: the funding takes the 25 ₳ UTxO alone.
  const evaluation = withdrawPreprod.amount.evaluation as { result: unknown[] };
  t.koios.evaluation = { ...evaluation, result: evaluation.result.slice(0, 1) };
  return t;
}

/** The session service with giveme.my's witness and the one-time key's signature stood in for, as sessions.test.ts does. */
function signing(t: T) {
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

/** One-time account `index`'s stake address, as Koios is asked about it. */
function reward(t: T, index: number) {
  const net = loadTestWasm().Network.Preprod;
  return t.wallet.withKeys((keys) => keys.oneTime.rewardAddress(net, index));
}

/** The sessions this browser has recorded. */
async function recorded(t: T) {
  return (await t.store.get<{ next: number; sessions: Array<{ index: number }> }>("sessions.preprod")) ?? { next: 0, sessions: [] };
}

describe("a new session's funding", () => {
  it("isn't sent to an account another browser funded after it was reviewed: a new review takes the next", async () => {
    const [a, b] = [await unlocked(), await unlocked()];
    const [sa, sb] = [signing(a), signing(b)];
    // Both review a session for a site at about the same time: index 0 is unused for both.
    const outA = await sa.siteOutBuild("preprod", ORIGIN, "15000000", []);
    const outB = await sb.siteOutBuild("preprod", "https://b.example", "15000000", []);
    expect([outA.index, outB.index]).toEqual([0, 0]);

    // A sends first, and its funding lands: B's Koios sees index 0's stake key used.
    await sa.siteOutSubmit("preprod", outA.txHash, ORIGIN);
    b.koios.usedStakes.add(await reward(b, 0));

    // B's Send asks again, and refuses: nothing is sent, and no session recorded. The used index is skipped.
    await expect(sb.siteOutSubmit("preprod", outB.txHash, "https://b.example")).rejects.toThrow(USED);
    expect(b.koios.submitted).toHaveLength(0);
    expect(await recorded(b)).toEqual({ next: 1, sessions: [] });
    // Its new review takes the next unused one; the one reviewed before isn't sent.
    expect((await sb.siteOutBuild("preprod", "https://b.example", "15000000", [])).index).toBe(1);
    await expect(sb.siteOutSubmit("preprod", outB.txHash, "https://b.example")).rejects.toThrow();
    expect(b.koios.submitted).toHaveLength(0);
  });

  it("isn't sent to an account something was paid to meanwhile, whatever its stake key says", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const out = await sessions.outBuild("preprod", await sessions.quote("preprod", minswapEstimate.ask));
    // A payment to account 0's payment key alone (an enterprise address), which account_addresses doesn't show.
    t.koios.addedToAccounts.push({
      tx_hash: "0d".repeat(32),
      tx_index: 0,
      address: sessionSwap.address,
      value: "2000000",
      stake_address: null,
      payment_cred: sessionSwap.keyHash,
      block_height: 5_000_000,
      inline_datum: null,
      asset_list: [],
    } as KoiosUtxo);
    await expect(sessions.outSubmit("preprod", out.txHash)).rejects.toThrow(USED);
    expect(t.koios.submitted).toHaveLength(0);
    // Its stake key still reads unused, which is all a review asks about: the index is skipped, so the new
    // review takes the next and goes, rather than being refused on the same index each time.
    expect(await recorded(t)).toEqual({ next: 1, sessions: [] });
    const again = await sessions.outBuild("preprod", await sessions.quote("preprod", minswapEstimate.ask));
    expect(again.index).toBe(1);
    await sessions.outSubmit("preprod", again.txHash);
    expect(t.koios.submitted.map(txIdOf)).toEqual([again.txHash]);
    expect(await recorded(t)).toMatchObject({ next: 2, sessions: [{ index: 1 }] });
  });

  it("asks about a mix's account too", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    // A mix reviewed for account 0, waiting for Send.
    await t.wallet.withKeys(() =>
      t.session.set(SESSION_MIX_OUT, {
        network: "preprod",
        txHash: "0e".repeat(32),
        txCbor: "",
        seed: "",
        index: 0,
        address: sessionSwap.address,
        payments: [],
        inputs: 1,
        mix: { boxes: 1, depth: 2, mixes: 4, lovelace: "15300000" },
        builtAt: t.clock.now,
      }),
    );
    t.koios.usedStakes.add(await reward(t, 0));
    await expect(sessions.mixOutSubmit("preprod", "0e".repeat(32))).rejects.toThrow(USED);
    expect(await recorded(t)).toEqual({ next: 1, sessions: [] });
  });

  it("isn't recorded or sent when Koios can't be asked, and goes once it can", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const out = await sessions.siteOutBuild("preprod", ORIGIN, "15000000", []);
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => (url.includes("/account_addresses") ? new Response("", { status: 400 }) : real(url, init));
    await expect(sessions.siteOutSubmit("preprod", out.txHash, ORIGIN)).rejects.toThrow("account_addresses");
    expect(t.koios.submitted).toHaveLength(0);
    expect(await recorded(t)).toEqual({ next: 0, sessions: [] });

    // Asked again: still unused, so it's recorded and sent.
    t.koios.fetch = real;
    await expect(sessions.siteOutSubmit("preprod", out.txHash, ORIGIN)).resolves.toMatchObject({ index: 0 });
    expect(t.koios.submitted.map(txIdOf)).toEqual([out.txHash]);
    expect(await recorded(t)).toMatchObject({ next: 1, sessions: [{ index: 0 }] });
  });

  it("asks about the one account it's about to use, and no other", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const out = await sessions.siteOutBuild("preprod", ORIGIN, "15000000", []);
    const before = t.koios.calls.length;
    await sessions.siteOutSubmit("preprod", out.txHash, ORIGIN);
    const asked = t.koios.calls.slice(before);
    expect(asked.filter((c) => c.path === "account_addresses").map((c) => c.body._stake_addresses)).toEqual([[await reward(t, 0)]]);
    expect(asked.filter((c) => c.path === "credential_utxos").map((c) => c.body._payment_credentials)).toEqual([[sessionSwap.keyHash]]);
  });
});
