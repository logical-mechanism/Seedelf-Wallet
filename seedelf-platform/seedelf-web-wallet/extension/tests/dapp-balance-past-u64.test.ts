// Chunk 51, w2#5 (the verifier's test). A stranger mints one token of their
// own three times, each the most one transaction can mint (2^63 − 1: Conway's
// `mint = multiasset<nonZeroInt64>`), into three outputs at the account's
// 0/0. Each output holds a u64's worth at most, as the ledger keeps it, but
// together they hold 3 × (2^63 − 1) ≈ 2.77 × 10^19, past a u64. The worker's
// getBalance (dapp.ts `balance()`) sums the account's available UTxOs in
// BigInt and hands the total to WebAssembly's cip30Value (cip30.rs
// `value_cbor`), which parsed each quantity as a u64 and refused the whole
// call. Every site connected to the account then heard InternalError for
// getBalance, until the user locked one of those UTxOs.
//
// What's right: getBalance still answers with a CIP-30 Value, its ADA the
// account's, the account's other tokens as before, and no quantity past what
// a Value holds: the stranger's token at u64::MAX, CIP-30's own ceiling (the
// owner's call, 2026-11-18). Driven through the worker with the real
// WebAssembly: it passes once the WebAssembly is built with cip30.rs's cap.

import { describe, expect, it } from "vitest";

import type { DappSession } from "../src/background/dapp";
import type { KoiosUtxo } from "../src/background/koios";
import { koiosPreprod, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const phrase12 = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
/** The 12-word account's `0/0`, where the stranger pays. */
const OWN = phrase12.preprod.receive_0 as string;
/** The most one transaction can mint of a token. */
const MOST_ONE_MINT = 2n ** 63n - 1n;
/** The most a CIP-30 Value (and a ledger output) holds of a token. */
const U64_MAX = 2n ** 64n - 1n;
const JUNK_POLICY = "ee".repeat(28);
const JUNK_NAME = "6a756e6b"; // "junk"

type Read = { lovelace: string; tokens: Array<{ policyId: string; assetName: string; quantity: string }> };

describe("chunk 51 w2#5: getBalance once a stranger's token adds up past a u64", () => {
  it("still answers every connected site with the account's Value", { timeout: 30_000 }, async () => {
    const t = testBalances();
    await t.wallet.create(phrase12.phrase, PASSWORD);
    await t.preferences.set({ dappConnector: true, spendRewards: false });
    const s: DappSession = { id: "r51-w2-5", origin: "https://app.example.com", title: "Example" };
    const enabling = t.dapp.call(s, "enable", []);
    for (let i = 0; i < 200 && t.dapp.approvals().length !== 1; i++) await new Promise((r) => setTimeout(r, 0));
    expect(t.dapp.approvals()).toHaveLength(1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    expect(await enabling).toBe(true);

    const { wasm } = t.deps;
    const read = async (): Promise<Read> => JSON.parse(wasm.cip30ReadValue((await t.dapp.call(s, "getBalance", [])) as string));
    const before = await read();
    expect(before.tokens.some((x) => x.policyId === JUNK_POLICY)).toBe(false);

    // The stranger's outputs at 0/0: 1.5 ₳ and the most one mint makes, each from its own mint.
    const template = Object.values(koiosPreprod.accounts)
      .flatMap((a) => a.account_utxos)
      .find((u) => u.address === OWN)!;
    const junk = (n: number): KoiosUtxo => ({
      ...template,
      tx_hash: `e${n}`.repeat(32),
      tx_index: 0,
      value: "1500000",
      asset_list: [
        { policy_id: JUNK_POLICY, asset_name: JUNK_NAME, quantity: MOST_ONE_MINT.toString(), decimals: 0, fingerprint: "asset1junk" },
      ],
      block_height: 1,
    });

    // Two of them: 2^64 − 2, which a u64 holds: the total exact.
    t.koios.addedToAccounts.push(junk(1), junk(2));
    t.clock.now += 31_000; // past the connector's 30 s reading
    const two = await read();
    expect(BigInt(two.lovelace)).toBe(BigInt(before.lovelace) + 3_000_000n);
    expect(two.tokens.find((x) => x.policyId === JUNK_POLICY)?.quantity).toBe((2n * MOST_ONE_MINT).toString());

    // The third: 3 × (2^63 − 1), past a u64. getBalance threw here
    // ("a token quantity isn't a whole number: \"27670116110564327421\""),
    // which a site hears as InternalError (sw.ts).
    t.koios.addedToAccounts.push(junk(3));
    t.clock.now += 31_000;
    const three = await read();
    expect(BigInt(three.lovelace)).toBe(BigInt(before.lovelace) + 4_500_000n);
    // The account's own tokens, as before.
    for (const token of before.tokens) expect(three.tokens).toContainEqual(token);
    // Nothing past what a CIP-30 Value holds: the stranger's token at its ceiling.
    for (const token of three.tokens) expect(BigInt(token.quantity) <= U64_MAX).toBe(true);
    expect(three.tokens.find((x) => x.policyId === JUNK_POLICY)?.quantity).toBe(U64_MAX.toString());
  });
});
