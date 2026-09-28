// A session's return Koios didn't answer is written to the private history
// once the chain shows it (independent review M7), whichever copy lands, so
// what it brought back is the session's money, never "received": a funding
// or a mint takes received money first, and would tie the sessions together.
// The real WebAssembly, and fakes of Koios.
import { describe, expect, it } from "vitest";

import type { KoiosUtxo } from "../src/background/koios";
import { txIdOf } from "./fixtures/cbor";
import { sessionSwap, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const MIN = "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed724d494e";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  t.koios.confirmations = 1;
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

/** Moves the clock on by `ms`, the user busy all along, so the wallet doesn't lock itself. */
async function busy(t: T, ms: number) {
  for (let left = ms; left > 0; left -= 10 * 60_000) {
    t.clock.now += Math.min(left, 10 * 60_000);
    await t.wallet.touch();
  }
}

const OUT = "01".repeat(32);
const SWAP = "02".repeat(32);
const FILL = "aa".repeat(32);

/** Session 0, a swap that runs itself, its order filled, coming back directly; what's at its account. */
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

/** What its return spent is gone from the account: it landed. */
function spentAll(t: T) {
  for (const o of [`${FILL}#0`, `${SWAP}#1`, `${OUT}#1`]) t.koios.spent.add(o);
}

interface Book {
  sessions: Array<{ txs: Array<{ kind: string; txHash: string; summary?: unknown }> }>;
}
const recorded = async (t: T, txHash: string) =>
  (await t.store.get<Book>("sessions.preprod"))!.sessions[0]!.txs.find((x) => x.txHash === txHash);

/** Whose money a Seedelf UTxO the return made is, as the history classes it. */
async function classOf(t: T, txHash: string) {
  const classes = await t.activity.classes("preprod", [{ tx_hash: txHash, tx_index: 0 } as KoiosUtxo]);
  return classes.get(`${txHash}#0`);
}

describe("a session's return Koios didn't answer (independent review M7)", () => {
  it("is written to the private history as the session's once the chain has it", async () => {
    const t = await unlocked();
    await filledSwap(t);
    const undo = unanswered(t);
    await t.sessions.advance("preprod", 0, true);
    undo();
    const back = txIdOf(t.koios.submitted.at(-1)!);
    t.koios.missing.add(back);
    // Not yet: nothing about it is written, but what it says is kept with it.
    expect((await t.activity.seedelf("preprod")).some((e) => e.txHash === back)).toBe(false);
    expect((await recorded(t, back))!.summary).toMatchObject({ index: 0, tokens: [{ quantity: "906594100" }] });

    // It lands: the next step writes it, and lets its summary go.
    t.koios.missing.delete(back);
    spentAll(t);
    await busy(t, 60_000);
    const view = await t.sessions.advance("preprod", 0, true);
    expect(view.stage).toBe("closed");
    const entry = (await t.activity.seedelf("preprod")).find((e) => e.txHash === back);
    expect(entry).toMatchObject({ kind: "session-back", direction: "in", detail: "Private session 1", origin: { id: "session:0", origin: "session" } });
    expect(await classOf(t, back)).toEqual({ id: "session:0", origin: "session" });
    expect((await recorded(t, back))!.summary).toBeUndefined();
  });

  it("is written when the copy that lands is the one Koios didn't answer, not the one built after it", async () => {
    const t = await unlocked();
    await filledSwap(t);
    let undo = unanswered(t);
    await t.sessions.advance("preprod", 0, true);
    undo();
    const first = txIdOf(t.koios.submitted.at(-1)!);
    t.koios.missing.add(first);

    // Unseen for 15 minutes: built again, and sent (Koios answers).
    await busy(t, 16 * 60_000);
    await t.sessions.advance("preprod", 0, true);
    const second = txIdOf(t.koios.submitted.at(-1)!);
    expect(second).not.toBe(first);
    t.koios.missing.add(second);

    // A reading of the private balance meanwhile finds the first's UTxO: noted as received, for now.
    await t.activity.arrived("preprod", [{ ...atSession(first, 0, "8000000"), address: "addr_test1" } as KoiosUtxo]);
    expect(await classOf(t, first)).toMatchObject({ origin: "received" });

    // The first lands after all: it's the return, and the history says whose it is.
    t.koios.missing.delete(first);
    spentAll(t);
    undo = () => undefined;
    await busy(t, 60_000);
    const view = await t.sessions.advance("preprod", 0, true);
    expect(view.txs.map((x) => [x.kind, x.txHash])).toEqual([
      ["out", OUT],
      ["swap", SWAP],
      ["back", first],
    ]);
    expect(await classOf(t, first)).toEqual({ id: "session:0", origin: "session" });
    expect((await t.activity.seedelf("preprod")).filter((e) => e.txHash === first)).toHaveLength(1);
  });

  it("is written for a site's session the user brought back, once a reading sees it land", async () => {
    const t = await unlocked();
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: t.clock.now,
          txs: [{ kind: "out", txHash: OUT, at: t.clock.now, confirmed: true }],
          site: { origin: "https://example.org" },
        },
      ],
    });
    t.koios.addedToAccounts.push(atSession(OUT, 0, "40000000"), atSession(OUT, 1, "5000000"));
    const review = await t.sessions.backBuild("preprod", 0, true);
    const undo = unanswered(t);
    await expect(t.sessions.backSubmit("preprod", review.txHash)).rejects.toThrow("Koios");
    undo();
    t.koios.missing.add(review.txHash);
    expect((await recorded(t, review.txHash))!.summary).toMatchObject({ index: 0, lovelace: review.lovelace });

    t.koios.missing.delete(review.txHash);
    t.koios.spent.add(`${OUT}#0`).add(`${OUT}#1`);
    await t.sessions.list("preprod", true);
    expect(await classOf(t, review.txHash)).toEqual({ id: "session:0", origin: "session" });
    expect((await recorded(t, review.txHash))!.summary).toBeUndefined();
  });
});
