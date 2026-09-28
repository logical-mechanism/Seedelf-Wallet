// A private session's own 5 ₳ collateral: what its return's chain through
// Lovejoin puts up, never a stranger's 5 ₳ its evaluator can't take
// (independent review L20). The real WebAssembly, a recorded preprod pool,
// and fakes of Koios.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import { sessionSwap, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;

/** 20 boxes from Lovejoin's preprod pool, as Koios lists them. */
const POOL = (
  JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }
).pool;

/** Chains are built and measured in WebAssembly: a few seconds each, more on CI. */
const CHAINS = { timeout: 30_000 };

/** Ogmios's answer when the network measures no more than a transaction declares. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

function atSession(tx_hash: string, tx_index: number, value: string): KoiosUtxo {
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
    asset_list: [],
  } as KoiosUtxo;
}

/**
 * A site's private session 0, funded by `ab…`, whose own collateral a site's
 * transaction spent: it holds 40 ₳ and another 5 ₳ of ADA alone (`c2…#1`).
 */
async function withSession() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: t.clock.now,
        txs: [{ kind: "out", txHash: "ab".repeat(32), at: t.clock.now, confirmed: true }],
        site: { origin: "https://example.org" },
      },
    ],
  });
  t.koios.addedToAccounts.push(atSession("c1".repeat(32), 0, "40000000"), atSession("c2".repeat(32), 1, "5000000"), ...POOL);
  t.koios.evaluation = AGREES;
  const sessions = new SessionService({
    ...t.deps,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
    lovejoin: t.lovejoin,
    sleep: async () => undefined,
  });
  return { t, sessions };
}

describe("a return's chain through Lovejoin (independent review L20)", () => {
  it("never puts up a stranger's 5 ₳ carrying a datum, listed first, over the session's own 5 ₳", CHAINS, async () => {
    const { t, sessions } = await withSession();
    // 129 levels deep: past what the evaluator reads.
    const deep = { ...atSession("0c".repeat(32), 0, "5000000"), inline_datum: { bytes: `${"81".repeat(129)}80`, value: {} } };
    // And one by hash: the evaluator can't find its datum.
    const hashed = { ...atSession("0d".repeat(32), 0, "5000000"), datum_hash: "ee".repeat(32) };
    t.koios.addedToAccounts.unshift(deep, hashed);
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoinSkipped).toBeUndefined();
    expect(review.lovejoin).toMatchObject({ boxes: expect.any(Number) });
    expect(review.lovejoin!.boxes).toBeGreaterThan(0);
  });

  it("says why when the only 5 ₳ there carries a datum", CHAINS, async () => {
    const { t, sessions } = await withSession();
    t.koios.spent.add(`${"c2".repeat(32)}#1`);
    t.koios.addedToAccounts.unshift({ ...atSession("0c".repeat(32), 0, "5000000"), inline_datum: { bytes: `${"81".repeat(129)}80`, value: {} } });
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toBeUndefined();
    expect(review.lovejoinSkipped).toMatch(/5 ₳ collateral isn't at its account/);
  });
});
