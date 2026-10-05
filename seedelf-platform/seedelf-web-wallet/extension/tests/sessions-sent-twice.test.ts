// A session's funding, or a top-up, Koios took is gone from Send's keeping,
// and a page that missed the answer (a restarted worker, a lock mid-submit,
// another page pressing Send) used to be told its review was stale: "Nothing
// was sent", and "Refresh and review again" funded a second session (chunk
// 23's second review, fix round). The record is read first now, and one that
// went out, or may have, is never marked unsent. The 12-word phrase, the real
// WebAssembly, and fakes of Koios, giveme.my and Minswap's aggregator.
import { describe, expect, it } from "vitest";

import { Collateral, StaleReviewError } from "../src/background/collateral";
import { Minswap } from "../src/background/minswap";
import { pendingKey } from "../src/background/pending";
import { SessionService } from "../src/background/sessions";
import { SESSION_SPENT } from "../src/background/spent";
import { WalletLocked } from "../src/background/wallet";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, minswapEstimate, ownedUtxos, testBalances, vectors, withdrawPreprod } from "./fakes";

const PASSWORD = "correct horse battery";
const ORIGIN = "https://a.example";
const phrase = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase as string;

type T = Awaited<ReturnType<typeof unlocked>>;

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(phrase, PASSWORD);
  // One spend: the funding takes the 25 ₳ UTxO alone.
  const evaluation = withdrawPreprod.amount.evaluation as { result: unknown[] };
  t.koios.evaluation = { ...evaluation, result: evaluation.result.slice(0, 1) };
  // More of the private balance, so a top-up can be funded too.
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

/** Session 0's record, as the worker keeps it. */
async function record(t: T) {
  const book = await t.store.get<{ sessions: Array<{ index: number; txs: Array<{ txHash: string; unsent?: boolean }> }> }>(
    "sessions.preprod",
  );
  return book?.sessions.find((s) => s.index === 0);
}

describe("Send again on a funding that went out", () => {
  it("says a swap's session was started already, never that its review is stale", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const out = await sessions.outBuild("preprod", await sessions.quote("preprod", minswapEstimate.ask));
    await sessions.outSubmit("preprod", out.txHash);
    const again = await sessions.outSubmit("preprod", out.txHash).catch((e: unknown) => e);
    expect((again as Error).message).toContain("started already");
    expect(again).not.toBeInstanceOf(StaleReviewError);
    // A restarted worker: another service on the same storage.
    await expect(signing(t).outSubmit("preprod", out.txHash)).rejects.toThrow("started already");
    expect(t.koios.submitted).toHaveLength(1);
    // A review that was never sent, and isn't kept, is still stale.
    await expect(sessions.outSubmit("preprod", "ab".repeat(32))).rejects.toBeInstanceOf(StaleReviewError);
  });

  it("says a site's session was started already, and a top-up sent already", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const out = await sessions.siteOutBuild("preprod", ORIGIN, "15000000", []);
    await sessions.siteOutSubmit("preprod", out.txHash, ORIGIN);
    const again = await sessions.siteOutSubmit("preprod", out.txHash, ORIGIN).catch((e: unknown) => e);
    expect((again as Error).message).toContain("started already");
    expect(again).not.toBeInstanceOf(StaleReviewError);

    const more = await sessions.topUpBuild("preprod", 0, "3000000", []);
    await sessions.topUpSubmit("preprod", more.txHash);
    const twice = await sessions.topUpSubmit("preprod", more.txHash).catch((e: unknown) => e);
    expect((twice as Error).message).toMatch(/^That was sent already/);
    expect(twice).not.toBeInstanceOf(StaleReviewError);
    expect(t.koios.submitted).toHaveLength(2);
    // Recorded once.
    expect((await record(t))!.txs.filter((x) => x.txHash === more.txHash)).toHaveLength(1);
    await expect(sessions.topUpSubmit("preprod", "ab".repeat(32))).rejects.toBeInstanceOf(StaleReviewError);
  });

  it("never marks a funding Koios took unsent when the wallet locks before the watch takes it over", async () => {
    // Koios takes it, the wallet locks before the watch's own withKeys (pending.ts take), and an unlock lands
    // before the refusal is recorded: the funding went out, so it stays looked for, not failed.
    const t = await unlocked();
    const sessions = signing(t);
    const out = await sessions.siteOutBuild("preprod", ORIGIN, "15000000", []);
    const realFetch = t.koios.fetch;
    let armed = false;
    t.koios.fetch = async (url, init) => {
      const answer = await realFetch(url, init);
      if (url.endsWith("/submittx")) {
        await t.wallet.lock();
        armed = true;
      }
      return answer;
    };
    const store = t.store as unknown as { get: (name: string) => Promise<unknown> };
    const realGet = store.get.bind(t.store);
    store.get = async (name) => {
      if (armed) {
        armed = false;
        await t.wallet.unlock(PASSWORD);
      }
      return realGet(name);
    };
    await expect(sessions.siteOutSubmit("preprod", out.txHash, ORIGIN)).rejects.toBeInstanceOf(WalletLocked);
    expect(t.koios.submitted).toHaveLength(1);
    if ((await t.wallet.state()) !== "unlocked") await t.wallet.unlock(PASSWORD);
    expect((await record(t))!.txs[0]).not.toHaveProperty("unsent");
    expect((await sessions.list("preprod"))[0]!.stage).not.toBe("failed");
  });

  it("counts a funding Koios took as sent when session storage refuses the watch's write", async () => {
    // Full session storage as the watch takes it over: it stays as written ahead, maybe sent, and the funding is
    // never thrown back as refused, which would mark it unsent.
    const t = await unlocked();
    const sessions = signing(t);
    const out = await sessions.siteOutBuild("preprod", ORIGIN, "15000000", []);
    const set = t.session.set.bind(t.session);
    let spends = 0;
    t.session.set = async (key, value) => {
      if (key === SESSION_SPENT && ++spends === 2) throw new Error("QUOTA_BYTES quota exceeded");
      return set(key, value);
    };
    const started = await sessions.siteOutSubmit("preprod", out.txHash, ORIGIN);
    t.session.set = set;
    expect(started.pending.txHash).toBe(out.txHash);
    expect((await record(t))!.txs[0]).not.toHaveProperty("unsent");
    expect(await t.session.get(pendingKey("preprod"))).toMatchObject({ txHash: out.txHash, maybeSent: true });
  });
});
