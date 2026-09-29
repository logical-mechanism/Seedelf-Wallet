// A session's return takes what's at its account by cost (independent review
// H1, H2): a stranger's token UTxO whose own ADA doesn't pay for its deposit
// stays, and only it is left behind; the session's own comes back, and the
// session closes. When even the session's own can't pay its way, it's left
// behind until more arrives, and a mix of the boxes again doesn't hold them
// meanwhile. The real WebAssembly, and fakes of Koios.
import { describe, expect, it } from "vitest";

import { bodyOutpoints } from "../src/background/cbor";
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

/** A UTxO at session 0's account, as Koios lists it: `tokens` as [policy + name, quantity]. */
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

/** `n` distinct tokens of one policy with 2-byte names, one of each: what a stranger packs into a UTxO. */
const junk = (n: number): Array<[string, string]> =>
  Array.from({ length: n }, (_, i) => [`${"ab".repeat(28)}${i.toString(16).padStart(4, "0")}`, "1"]);

const OUT = "01".repeat(32);
const SWAP = "02".repeat(32);
const FILL = "aa".repeat(32);
const STRANGER = "bb".repeat(32);

interface Book {
  next: number;
  sessions: Array<{
    index: number;
    txs: Array<{ kind: string; txHash: string }>;
    leftBehind?: Array<{ txHash: string; txIndex: number; reason: string; lovelace: string }>;
    nothingBack?: number;
    closedAt?: number;
  }>;
}

/** Session 0, a swap that runs itself whose order filled: its funding and its swap on chain. */
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
}

const TOP_UP = "03".repeat(32);

/** Session 0, a site's private session, funded. */
async function siteSession(t: T) {
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: t.clock.now,
        txs: [
          { kind: "out", txHash: OUT, at: t.clock.now, confirmed: true },
          { kind: "out", txHash: TOP_UP, at: t.clock.now, confirmed: true },
        ],
        site: { origin: "https://example.org" },
      },
    ],
  });
}

/** Session 0, a mix of the wallet's boxes again, funded, its chain not built yet. */
async function mixingAgain(t: T) {
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: t.clock.now,
        txs: [{ kind: "out", txHash: OUT, at: t.clock.now, confirmed: true }],
        mix: { boxes: 2, again: true },
        auto: { approved: { minAmountOut: "0", fund: { lovelace: "10000000", tokens: [] } } },
      },
    ],
  });
}

const book = async (t: T) => (await t.store.get<Book>("sessions.preprod"))!;
const last = (t: T) => t.koios.submitted.at(-1)!;

/** What a submitted return spent lands: those UTxOs are gone from the account. */
function landed(t: T, tx: Uint8Array) {
  for (const o of bodyOutpoints(tx, 0) ?? []) t.koios.spent.add(o);
}

describe("a session's return, with a stranger's tokens at its account (independent review H1, H2)", () => {
  it("brings the session's own back and leaves only the stranger's 400 tokens on 12 ₳ behind, then closes", async () => {
    const t = await unlocked();
    await filledSwap(t);
    // The fill (a batcher's), the swap's change and the collateral, and a stranger's junk: its deposit would take ~38 ₳.
    t.koios.addedToAccounts.push(
      atSession(FILL, 0, "2000000", [[MIN, "906594100"]]),
      atSession(SWAP, 1, "1500000"),
      atSession(OUT, 1, "5000000"),
      atSession(STRANGER, 0, "12000000", junk(400)),
    );
    let view = await t.sessions.advance("preprod", 0, true);
    expect(t.koios.submitted).toHaveLength(1);
    const back = last(t);
    expect(bodyOutpoints(back, 0)!.sort()).toEqual([`${FILL}#0`, `${OUT}#1`, `${SWAP}#1`].sort());
    // Only the stranger's is left behind, never the session's own.
    expect(view.leftBehind).toEqual([{ txHash: STRANGER, txIndex: 0, reason: "fee", lovelace: "12000000" }]);
    expect(view.holding).toMatchObject({ utxos: 3 });
    expect(view.txs.at(-1)).toMatchObject({ kind: "back", txHash: txIdOf(back) });

    // It lands: what's left holds nothing open, and the session is over.
    landed(t, back);
    t.clock.now += 60_000;
    view = await t.sessions.advance("preprod", 0, true);
    expect(view.stage).toBe("closed");
    expect(t.koios.submitted).toHaveLength(1);
    expect(view.leftBehind).toEqual([{ txHash: STRANGER, txIndex: 0, reason: "fee", lovelace: "12000000" }]);
  });

  it("says in the review which UTxO stays, and why", async () => {
    const t = await unlocked();
    await siteSession(t);
    t.koios.addedToAccounts.push(atSession(OUT, 0, "40000000"), atSession(OUT, 1, "5000000"), atSession(STRANGER, 0, "12000000", junk(400)));
    const review = await t.sessions.backBuild("preprod", 0, true);
    expect(review.inputs).toBe(2);
    expect(review.leftOut).toEqual([{ txHash: STRANGER, txIndex: 0, reason: "cost" }]);
    expect((await book(t)).sessions[0]!.leftBehind).toEqual([{ txHash: STRANGER, txIndex: 0, reason: "fee", lovelace: "12000000" }]);
  });

  it("leaves the session's own behind only when it can't pay its way, and tries again once more arrives", async () => {
    const t = await unlocked();
    await siteSession(t);
    // The session's own token on too little ADA for its deposit and fee, and nothing else.
    t.koios.addedToAccounts.push(atSession(OUT, 0, "1100000", [[MIN, "5"]]));
    await expect(t.sessions.backBuild("preprod", 0, true)).rejects.toThrow("too little to pay for its own way back");
    let [view] = await t.sessions.list("preprod", true);
    expect(view!.leftBehind).toEqual([{ txHash: OUT, txIndex: 0, reason: "fee", lovelace: "1100000" }]);
    expect((await book(t)).sessions[0]!.nothingBack).toBe(t.clock.now);

    // A top-up arrives: the next return takes both, and nothing is left behind.
    t.koios.addedToAccounts.push(atSession(TOP_UP, 0, "3000000"));
    const review = await t.sessions.backBuild("preprod", 0, true);
    expect(review.inputs).toBe(2);
    expect(review.leftOut ?? []).toEqual([]);
    [view] = await t.sessions.list("preprod", true);
    expect(view!.leftBehind).toBeUndefined();
    expect((await book(t)).sessions[0]!.nothingBack).toBeUndefined();
  });

  it("leaves a stranger's token alone at the account behind, once no return can take it", async () => {
    const t = await unlocked();
    await filledSwap(t);
    t.koios.addedToAccounts.push(atSession(STRANGER, 0, "1200000", [[MIN, "5"]]));
    const view = await t.sessions.advance("preprod", 0, true);
    expect(t.koios.submitted).toHaveLength(0);
    expect(view.leftBehind).toEqual([{ txHash: STRANGER, txIndex: 0, reason: "fee", lovelace: "1200000" }]);
  });
});

describe("a mix of the boxes again (independent review H1)", () => {
  it("sends its return past a stranger's junk, so it holds the boxes no longer than its return", async () => {
    const t = await unlocked();
    await mixingAgain(t);
    t.koios.addedToAccounts.push(atSession(OUT, 0, "10000000"), atSession(OUT, 1, "5000000"), atSession(STRANGER, 0, "12000000", junk(400)));
    expect(await t.sessions.mixingAgain("preprod")).toBe(true);
    await t.sessions.advance("preprod", 0, true);
    // No Lovejoin here: it comes back directly, the stranger's left behind.
    expect(bodyOutpoints(last(t), 0)!.sort()).toEqual([`${OUT}#0`, `${OUT}#1`].sort());
    expect(await t.sessions.mixingAgain("preprod")).toBe(false);
  });

  it("doesn't hold the boxes while even its own money at its account can't come back", async () => {
    const t = await unlocked();
    await mixingAgain(t);
    // Its funding's, a token on too little ADA: nothing pays for its own way back.
    t.koios.addedToAccounts.push(atSession(OUT, 0, "1100000", [[MIN, "5"]]));
    expect(await t.sessions.mixingAgain("preprod")).toBe(true);
    const view = await t.sessions.advance("preprod", 0, true);
    expect(t.koios.submitted).toHaveLength(0);
    expect(view.leftBehind).toEqual([{ txHash: OUT, txIndex: 0, reason: "fee", lovelace: "1100000" }]);
    expect(await t.sessions.mixingAgain("preprod")).toBe(false);
  });

  it("keeps holding the boxes while Koios lists only a stranger's there, not its funding yet", async () => {
    const t = await unlocked();
    await mixingAgain(t);
    // Only a stranger's token on too little ADA: its funding, on chain, isn't listed yet.
    t.koios.addedToAccounts.push(atSession(STRANGER, 0, "1200000", [[MIN, "5"]]));
    let view = await t.sessions.advance("preprod", 0, true);
    expect(t.koios.submitted).toHaveLength(0);
    expect(view.leftBehind).toEqual([{ txHash: STRANGER, txIndex: 0, reason: "fee", lovelace: "1200000" }]);
    expect((await book(t)).sessions[0]!.nothingBack).toBeUndefined();
    expect(await t.sessions.mixingAgain("preprod")).toBe(true);

    // Its funding shows: its return goes, and only then are the boxes let go.
    t.koios.addedToAccounts.push(atSession(OUT, 0, "10000000"), atSession(OUT, 1, "5000000"));
    t.clock.now += 60_000;
    view = await t.sessions.advance("preprod", 0, true);
    expect(t.koios.submitted).toHaveLength(1);
    expect(await t.sessions.mixingAgain("preprod")).toBe(false);
  });
});

describe("what a return left behind for its fee (independent review H1)", () => {
  it("isn't anymore once a later return only waits for room to take it, so it holds the session open", async () => {
    const t = await unlocked();
    await siteSession(t);
    // Two of the session's own UTxOs whose tokens together are more than an output holds, left behind for their
    // fee by an earlier return that found too little; then more money arrives.
    const most = "10000000000000000000";
    const fresh = "04".repeat(32);
    const b = await book(t);
    b.sessions[0]!.leftBehind = [
      { txHash: OUT, txIndex: 0, reason: "fee", lovelace: "3000000" },
      { txHash: TOP_UP, txIndex: 0, reason: "fee", lovelace: "3000000" },
    ];
    await t.store.set("sessions.preprod", b);
    t.koios.addedToAccounts.push(
      atSession(OUT, 0, "3000000", [[MIN, most]]),
      atSession(TOP_UP, 0, "3000000", [[MIN, most]]),
      atSession(fresh, 0, "40000000"),
    );
    const review = await t.sessions.backBuild("preprod", 0, true);
    // One of them waits for the next return: none is left behind anymore.
    expect(review.leftOut).toEqual([{ txHash: TOP_UP, txIndex: 0, reason: "tokens" }]);
    expect((await book(t)).sessions[0]!.leftBehind ?? []).toEqual([]);
  });
});
