// 1.6.0's release review, L4: what the wallet's sends spend is written and read on one clock, the services' own
// (`now`), which is the device's in the worker and a test's in a test. A session's return wrote its marks on the
// device's clock while the script spends read them on the services' (script-spend.ts): under a test's clock, ahead of
// the device's, a return's spend was held as spent for no time at all, and one behind it for good. The real
// WebAssembly, and fakes of Koios.
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import type { KoiosUtxo } from "../src/background/koios";
import { SESSION_SPENT, SPENT_KEEP_MS, spentSet } from "../src/background/spent";
import { txIdOf } from "./fixtures/cbor";
import { busyFor, sessionSwap, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const MIN = "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed724d494e";
const PHRASE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase;

const OUT = "01".repeat(32);
const SWAP = "02".repeat(32);
const FILL = "aa".repeat(32);

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.confirmations = 1;
  await t.activity.arrived("preprod", []);
  return t;
}
type T = Awaited<ReturnType<typeof unlocked>>;

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
    asset_list: tokens.map(([id, quantity]) => ({ policy_id: id.slice(0, 56), asset_name: id.slice(56), quantity, decimals: 0, fingerprint: "" })),
  } as KoiosUtxo;
}

/** Session 0, a swap that runs itself, its order filled, coming back directly (return-history.test.ts). */
async function filledSwap(t: T) {
  const done = (kind: string, txHash: string) => ({ kind, txHash, at: t.clock.now, confirmed: true });
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: t.clock.now,
        txs: [done("out", OUT), done("swap", SWAP)],
        swap: { amount: "10000000", tokenIn: "lovelace", tokenOut: MIN, slippage: 0.5, amountOut: "906594100", minAmountOut: "902083681" },
        auto: { approved: { minAmountOut: "902083681", fund: { lovelace: "16000000", tokens: [] } }, direct: true },
      },
    ],
  });
  t.koios.addedToAccounts.push(atSession(FILL, 0, "2000000", [[MIN, "906594100"]]), atSession(SWAP, 1, "1500000"), atSession(OUT, 1, "5000000"));
}

/** Koios takes what's submitted, then answers 504, as a gateway that timed out would. Returns the undo. */
function unanswered(t: T) {
  const real = t.koios.fetch;
  t.koios.fetch = async (url, init) => {
    const answer = await real(url, init);
    return url.endsWith("/submittx") ? new Response("upstream request timeout", { status: 504 }) : answer;
  };
  return () => {
    t.koios.fetch = real;
  };
}

describe("a session's return, held as spent on the wallet's own clock (1.6.0's release review, L4)", () => {
  it("writes what its return spends on the services' clock, held as spent two hours on it, then free, sent or maybe sent", async () => {
    for (const answer of ["sent", "maybe sent"] as const) {
      const t = await unlocked();
      await filledSwap(t);
      const undo = answer === "maybe sent" ? unanswered(t) : () => undefined;
      await t.sessions.advance("preprod", 0, true);
      undo();
      const spends = txInputs(t.koios.submitted.at(-1)!);
      expect(spends, answer).toEqual(expect.arrayContaining([`${FILL}#0`, `${SWAP}#1`, `${OUT}#1`]));
      const marks = (await t.wallet.withKeys(() => t.session.get<Record<string, number>>(SESSION_SPENT)))!;
      for (const o of spends) expect(marks[o], `${answer}: ${o}`).toBe(t.clock.now);
      // As a script spend reads them (script-spend.ts): held, then free once SPENT_KEEP_MS has gone by on that clock.
      const held = async () => t.wallet.withKeys(() => spentSet(t.session, t.clock.now));
      expect([...(await held())], answer).toEqual(expect.arrayContaining(spends));
      await busyFor(t, SPENT_KEEP_MS);
      expect([...(await held())].filter((o) => spends.includes(o)), answer).toEqual([]);
    }
  });

  it("reads the session's account less what the wallet spent on the same clock: its return's spends held two hours, then listed again", async () => {
    const t = await unlocked();
    await filledSwap(t);
    const undo = unanswered(t);
    await t.sessions.advance("preprod", 0, true);
    undo();
    // It never lands: Koios still lists what it spends, which the wallet holds as spent meanwhile.
    t.koios.missing.add(txIdOf(t.koios.submitted.at(-1)!));
    const holding = async () => (await t.sessions.list("preprod", true))[0]!.holding;
    expect((await holding())?.utxos).toBe(0);
    await busyFor(t, SPENT_KEEP_MS);
    expect((await holding())?.utxos).toBe(3);
  });
});
