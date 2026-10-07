// Two fundings of different kinds can be reviewed on one one-time account at
// once: a swap's in the side panel, a site's in the connector's window. The
// one sent second was refused as "That session was started already", for a
// session that never started, and Send only repeated it (release review). None
// of it was sent, so it's a stale review now: its page builds it again, on the
// next unused account. One that was sent keeps the plain refusal. The 12-word
// phrase, the real WebAssembly, and fakes of Koios, giveme.my and Minswap's
// aggregator.
import { describe, expect, it } from "vitest";

import { Collateral, StaleReviewError } from "../src/background/collateral";
import { Minswap } from "../src/background/minswap";
import { SESSION_MIX_OUT, SESSION_SITE_OUT, SessionService } from "../src/background/sessions";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, minswapEstimate, ownedUtxos, sessionSwap, testBalances, vectors, withdrawPreprod } from "./fakes";

const PASSWORD = "correct horse battery";
const ORIGIN = "https://a.example";
const TAKEN = "Another session took that one-time account meanwhile";
const phrase = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase as string;

type T = Awaited<ReturnType<typeof unlocked>>;

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(phrase, PASSWORD);
  // One spend: the funding takes the 25 ₳ UTxO alone.
  const evaluation = withdrawPreprod.amount.evaluation as { result: unknown[] };
  t.koios.evaluation = { ...evaluation, result: evaluation.result.slice(0, 1) };
  // More of the private balance, so a new review can be funded once the first funding went.
  t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "01".repeat(32), block_height: 9_000_001 });
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
    alarm: { start: async () => undefined },
  });
}

/** The sessions this wallet has recorded. */
async function recorded(t: T) {
  return (await t.store.get<{ next: number; sessions: Array<{ index: number }> }>("sessions.preprod")) ?? { next: 0, sessions: [] };
}

/** Both reviewed on one-time account 0: a swap's funding, and a site's. */
async function bothOnZero(sessions: SessionService) {
  const quote = await sessions.quote("preprod", minswapEstimate.ask);
  const swap = await sessions.outBuild("preprod", quote);
  const site = await sessions.siteOutBuild("preprod", ORIGIN, "15000000", []);
  expect([swap.index, site.index]).toEqual([0, 0]);
  return { quote, swap, site };
}

describe("a funding whose account another funding took meanwhile", () => {
  it("is a stale review, built again on the next account: a swap's after a site's", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const { quote, swap, site } = await bothOnZero(sessions);
    await sessions.siteOutSubmit("preprod", site.txHash, ORIGIN);
    // Never "started already": its page offers Build it again, and Send can't only repeat the refusal.
    const refused = await sessions.outSubmit("preprod", swap.txHash).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(StaleReviewError);
    expect((refused as Error).message).toContain(TAKEN);
    await expect(sessions.outSubmit("preprod", swap.txHash)).rejects.toBeInstanceOf(StaleReviewError);
    // Nothing of it was sent, and the site's session is all that's recorded.
    expect(t.koios.submitted.map(txIdOf)).toEqual([site.txHash]);
    expect(await recorded(t)).toMatchObject({ next: 1, sessions: [{ index: 0 }] });
    expect((await sessions.outBuild("preprod", quote)).index).toBe(1);
  });

  it("is a stale review the other way round too: a site's after a swap's", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const { swap, site } = await bothOnZero(sessions);
    await sessions.outSubmit("preprod", swap.txHash);
    await expect(sessions.siteOutSubmit("preprod", site.txHash, ORIGIN)).rejects.toThrow(TAKEN);
    await expect(sessions.siteOutSubmit("preprod", site.txHash, ORIGIN)).rejects.toBeInstanceOf(StaleReviewError);
    expect(t.koios.submitted.map(txIdOf)).toEqual([swap.txHash]);
    expect((await sessions.siteOutBuild("preprod", ORIGIN, "15000000", [])).index).toBe(1);
  });

  it("is a stale review for a mix too, never 'That mix was started already'", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const site = await sessions.siteOutBuild("preprod", ORIGIN, "15000000", []);
    // A mix reviewed for account 0 in the side panel, waiting for Send.
    await t.session.set(SESSION_MIX_OUT, {
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
    });
    await sessions.siteOutSubmit("preprod", site.txHash, ORIGIN);
    const refused = await sessions.mixOutSubmit("preprod", "0e".repeat(32)).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(StaleReviewError);
    expect((refused as Error).message).toContain(TAKEN);
  });

  it("keeps the plain refusal for one that was sent, whatever became of its record", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    // A site's funding that went to Koios unanswered (Send's copy keeps it as sent), whose record went since.
    const site = await sessions.siteOutBuild("preprod", ORIGIN, "15000000", []);
    const kept = (await t.session.get<object>(SESSION_SITE_OUT))!;
    await t.session.set(SESSION_SITE_OUT, { ...kept, sentCbor: "84" });
    await t.store.set("sessions.preprod", { next: 1, sessions: [] });
    const refused = await sessions.siteOutSubmit("preprod", site.txHash, ORIGIN).catch((e: unknown) => e);
    expect((refused as Error).message).toBe("That session was started already. Start a new one.");
    expect(refused).not.toBeInstanceOf(StaleReviewError);
    expect(t.koios.submitted).toHaveLength(0);
  });
});
