// Which chain through Lovejoin holds a session's later return back
// (independent review L17): only the latest, while it went in partly and its
// rest hasn't come back. A site's session paid again after a chain stopped,
// once that chain's rest is back, goes through Lovejoin again, as the
// privacy default says. The real WebAssembly, a recorded preprod pool, and
// fakes of Koios.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { CHAIN_CUT } from "../src/background/lovejoin";
import { Minswap } from "../src/background/minswap";
import { SESSION_BACK, SessionService } from "../src/background/sessions";
import { SESSION_SPENT } from "../src/background/spent";
import { sessionSwap, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;

const POOL = (
  JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }
).pool;
const CHAINS = { timeout: 60_000 };
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

/** A site's private session 0 holding 40 ₳ and its 5 ₳ collateral, and Lovejoin's pool. */
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
  // One wave deep: a few chains fit the recorded pool's 20 boxes.
  await t.deps.preferences.set({ lovejoinDepth: 1 });
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

type T = Awaited<ReturnType<typeof withSession>>["t"];

/** Koios refuses the `nth` submit from now on for good; the rest go through. Returns the undo. */
function refuseNth(t: T, nth: number) {
  const fetch = t.koios.fetch;
  let submits = 0;
  t.koios.fetch = async (url, init) => {
    if (url.endsWith("/submittx") && ++submits === nth) return new Response("ValueNotConservedUTxO", { status: 400 });
    return fetch(url, init);
  };
  return () => {
    t.koios.fetch = fetch;
  };
}

/** Its chain stopped at the fourth transaction, and the rest was sent back directly. */
async function cutThenRest(t: T, sessions: SessionService) {
  const review = await sessions.backBuild("preprod", 0);
  expect(review.lovejoin).toBeDefined();
  const undo = refuseNth(t, 4);
  await expect(sessions.backSubmit("preprod", review.txHash)).rejects.toThrow();
  undo();
  const rest = await sessions.backBuild("preprod", 0);
  expect(rest.lovejoin).toBeUndefined();
  // The chain's own page says it stopped: the rest's review needs no other word why.
  expect(rest.lovejoinSkipped).toBeUndefined();
  await sessions.backSubmit("preprod", rest.txHash);
  return rest.txHash;
}

/** The site pays the account again: 40 ₳, and 5 ₳ of ADA alone (as a top-up puts back). */
function paidAgain(t: T, tag: string) {
  t.koios.addedToAccounts.push(atSession(`${tag}1`.repeat(32), 0, "40000000"), atSession(`${tag}2`.repeat(32), 1, "5000000"));
}

describe("a site's session paid again after its chain stopped partway (independent review L17)", () => {
  it("goes through Lovejoin again once that chain's rest is back", CHAINS, async () => {
    const { t, sessions } = await withSession();
    await cutThenRest(t, sessions);
    // While the rest is on its way, a return still comes back directly, and says why (independent review L17).
    paidAgain(t, "d");
    const meanwhile = await sessions.backBuild("preprod", 0);
    expect(meanwhile.lovejoin).toBeUndefined();
    expect(meanwhile.lovejoinSkipped).toBe("the return of what its last chain through Lovejoin left wasn't on chain yet");
    // Asked for directly, it says nothing: the user left Lovejoin out.
    expect((await sessions.backBuild("preprod", 0, true)).lovejoinSkipped).toBeUndefined();

    // The rest lands: the chain is dealt with, and the next return goes through Lovejoin, as the default says.
    t.koios.confirmations = 1;
    t.clock.now += 60_000;
    await sessions.list("preprod", true);
    const later = await sessions.backBuild("preprod", 0);
    expect(later.lovejoinSkipped).toBeUndefined();
    expect(later.lovejoin).toMatchObject({ depth: 1 });
  });

  it("counts only the latest chain: an earlier chain's deposit doesn't hold back one whose first transaction was refused", CHAINS, async () => {
    const { t, sessions } = await withSession();
    await cutThenRest(t, sessions);
    t.koios.confirmations = 1;
    t.clock.now += 60_000;
    await sessions.list("preprod", true);
    paidAgain(t, "d");
    // A second chain, whose first transaction is refused: nothing of it went in.
    const second = await sessions.backBuild("preprod", 0);
    expect(second.lovejoin).toBeDefined();
    const undo = refuseNth(t, 1);
    await expect(sessions.backSubmit("preprod", second.txHash)).rejects.toThrow();
    undo();
    t.clock.now += 60_000;
    // Brought back again: through Lovejoin, not directly with no word why.
    const third = await sessions.backBuild("preprod", 0);
    expect(third.lovejoinSkipped).toBeUndefined();
    expect(third.lovejoin).toMatchObject({ depth: 1 });
  });
});

describe("a mix whose chain stopped partway and whose rest came back (independent review L17)", () => {
  it("brings what reaches its account after back directly, never in another chain", CHAINS, async () => {
    const { t, sessions } = await withSession();
    const at = t.clock.now;
    const done = (kind: string, txHash: string) => ({ kind, txHash, at, confirmed: true });
    const last = "ae".repeat(32);
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: at,
          txs: [done("out", "ab".repeat(32)), done("deposit", "ac".repeat(32)), done("back", "ad".repeat(32))],
          mix: { boxes: 1 },
          auto: { approved: { minAmountOut: "0", fund: { lovelace: "15000000", tokens: [] } } },
          chain: { total: 4, last, at, stopped: CHAIN_CUT },
        },
      ],
    });
    // The 40 ₳ and 5 ₳ at its account reached it since: a chain would pay for another mix with them.
    await sessions.advance("preprod", 0, true);
    expect(t.koios.submitted).toHaveLength(1);
    const book = await t.store.get<{ sessions: Array<{ chain: { last: string }; txs: Array<{ kind: string }> }> }>("sessions.preprod");
    expect(book!.sessions[0]!.chain.last).toBe(last);
    expect(book!.sessions[0]!.txs.map((x) => x.kind)).toEqual(["out", "deposit", "back", "back"]);
  });
});

describe("a return's chain through Lovejoin kept for Send (independent review L18)", () => {
  it("isn't sent when a transaction sent since its review spent what it spends, and nothing of it goes", CHAINS, async () => {
    const { t, sessions } = await withSession();
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toBeDefined();
    // A private spend reviewed after it and sent first took one of its UTxOs, as a Make public may take the
    // funding change a chain's last transaction merges into.
    const kept = (await t.session.get<{ chain: Array<{ txCbor: string }> }>(SESSION_BACK))!;
    const [taken] = txInputs(Buffer.from(kept.chain[0]!.txCbor, "hex"));
    const spent = (await t.session.get<Record<string, number>>(SESSION_SPENT)) ?? {};
    await t.session.set(SESSION_SPENT, { ...spent, [taken!]: Date.now() });
    await expect(sessions.backSubmit("preprod", review.txHash)).rejects.toThrow(
      "Something this return spends went out in another transaction since you reviewed it. Review it again.",
    );
    expect(t.koios.submitted).toHaveLength(0);
    const [view] = await sessions.list("preprod");
    expect(view!.chain).toBeUndefined();
  });
});
