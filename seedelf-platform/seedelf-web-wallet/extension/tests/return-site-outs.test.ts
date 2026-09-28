// A site's own transaction, signed by its private session's key, is the
// session's own, not a stranger's (final review F4): what it paid the
// session's account (siteOuts) comes back with the session's money paying
// its tokens' deposit, as before H1, directly or through Lovejoin. A
// stranger's tokens that don't pay their own way are still left behind
// (independent review H1). The real WebAssembly, and fakes of Koios.
import { describe, expect, it } from "vitest";

import type { KoiosUtxo } from "../src/background/koios";
import { CHAINS, withSession } from "./chain-fixtures";
import { sessionSwap, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;

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

/** `n` NFTs of `policy` with 12-byte names: what a site's mint or sweep delivers in one output. */
const nfts = (n: number, policy: string): Array<[string, string]> =>
  Array.from({ length: n }, (_, i) => [`${policy}${(i + 1).toString(16).padStart(24, "0")}`, "1"]);

const OUT = "01".repeat(32);
/** The site's own transaction the session's key signed: 25 NFTs on 3 ₳ to the account (#0), and 9 ₳ of change (#1). */
const SITE = "5e".repeat(32);
/** Anyone's: 25 NFTs on 3 ₳ that nobody asked the session's key to sign for. */
const STRANGER = "bb".repeat(32);

interface Book {
  sessions: Array<{ index: number; siteOuts?: string[]; leftBehind?: Array<{ txHash: string; reason: string }> }>;
}
const leftBehind = async (t: { store: { get<V>(key: string): Promise<V | undefined> } }) =>
  ((await t.store.get<Book>("sessions.preprod"))!.sessions[0]!.leftBehind ?? []).map((b) => [b.txHash, b.reason]);

describe("a site's own transaction's tokens at its private session (final review F4)", () => {
  it("come back directly, their deposit paid by the session's ADA, while a stranger's that don't pay their way stay", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    t.koios.confirmations = 1;
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: t.clock.now,
          txs: [{ kind: "out", txHash: OUT, at: t.clock.now, confirmed: true, outs: [`${OUT}#1`] }],
          site: { origin: "https://example.org" },
          siteOuts: [`${SITE}#0`, `${SITE}#1`],
        },
      ],
    });
    t.koios.addedToAccounts.push(
      atSession(OUT, 1, "5000000"),
      atSession(SITE, 0, "3000000", nfts(25, "cd".repeat(28))),
      atSession(SITE, 1, "9000000"),
      atSession(STRANGER, 0, "3000000", nfts(25, "ef".repeat(28))),
    );
    const review = await t.sessions.backBuild("preprod", 0, true);
    // The site's delivery is taken with the session's own; only the stranger's is left out, for its cost.
    expect(review.inputs).toBe(3);
    expect(review.leftOut).toEqual([expect.objectContaining({ txHash: STRANGER, txIndex: 0, reason: "cost" })]);
    expect(review.tokens.filter((x) => x.policyId === "cd".repeat(28))).toHaveLength(25);
    expect(await leftBehind(t)).toEqual([[STRANGER, "fee"]]);
  });

  it("come back through Lovejoin too, in the chain's return", CHAINS, async () => {
    const { t, sessions } = await withSession("40000000");
    const book = (await t.store.get<{ next: number; sessions: Array<Record<string, unknown>> }>("sessions.preprod"))!;
    await t.store.set("sessions.preprod", { ...book, sessions: [{ ...book.sessions[0]!, siteOuts: [`${SITE}#0`] }] });
    t.koios.addedToAccounts.push(
      atSession(SITE, 0, "3000000", nfts(25, "cd".repeat(28))),
      atSession(STRANGER, 0, "3000000", nfts(25, "ef".repeat(28))),
    );
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin?.boxes).toBeGreaterThan(0);
    expect(review.leftOut).toEqual([expect.objectContaining({ txHash: STRANGER, txIndex: 0, reason: "cost" })]);
    expect(review.tokens.filter((x) => x.policyId === "cd".repeat(28))).toHaveLength(25);
    expect(await leftBehind(t)).toEqual([[STRANGER, "fee"]]);
  });
});
