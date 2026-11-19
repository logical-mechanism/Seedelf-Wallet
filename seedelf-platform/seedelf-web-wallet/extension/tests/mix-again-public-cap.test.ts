/**
 * Chunk 51, gap-g2#1 (the trace verifier's test, its assertion made the fix's). Mix again from my public account pays
 * every mix of every box it counts from one UTxO of ADA alone (wasm/src/lovejoin.rs again_from_account_at), and the
 * worker counts the boxes from the pool's room with no regard to what the account can pay, so an account whose largest
 * UTxO of ADA alone paid for fewer boxes than the pool had room for was refused outright. Now as many go as that UTxO
 * pays for, paid from it alone, and the review says the rest wait for another press, and why; refused only where it
 * pays for none, as the Mix form's count is held to the account's ADA (chunk 34's session 6). The worker's case needs
 * WebAssembly built with this change; the review's words run on any.
 */
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import type { KoiosUtxo } from "../src/background/koios";
import { CHAIN_CUT, SESSION_LOVEJOIN_PUBLIC } from "../src/background/lovejoin";
import { t } from "../src/i18n";
import { publicAgainRest } from "../src/ui/screens/Lovejoin";
import { koiosPreprod, testBalances, vectors } from "./fakes";
import { ADA, ADA_POOL, ADA_ROWS, adaBox, madeByAdaMix, ownDatum } from "./v2-pools";

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };
const account = (words: number) => vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const inAda = (b: { txHash: string; txIndex: number }) => ({ ...b, pool: ADA });

/** A box of ours in the 5 ₳ pool, as lovejoin.test.ts makes one. */
async function ownedBox(t: ReturnType<typeof testBalances>, tx: string, txIndex: number): Promise<KoiosUtxo> {
  const box = adaBox(tx, await ownDatum(t.wallet), t.clock.now, 5, txIndex);
  madeByAdaMix(t.koios, tx);
  return box;
}

/**
 * Public Account 1 at Settings' defaults (two waves, three a mix): its 5 ₳ collateral, `ada` in UTxOs of ADA alone, and
 * two boxes of its own in the 5 ₳ pool beside 20 strangers', which a mix from it put in and a lock cut before mixing
 * them (lovejoin.test.ts's "mixes again from the public account" case). The pool has room for both: 8 others a box.
 */
async function withAccount(ada: string[]) {
  const t = testBalances({ pools: [ADA_POOL] });
  await t.wallet.create(account(12).phrase, PASSWORD);
  await t.deps.preferences.set({ lovejoinDepth: 2, lovejoinWidth: 3 });
  t.koios.evaluation = AGREES;
  t.koios.addedToAccounts.push(...ADA_ROWS);
  const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
  const keyHash = await t.wallet.withKeys((keys) => keys.cardano.paymentKeyHash(0, 0));
  const at = (tx: string, value: string) => ({ ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, payment_cred: keyHash, asset_list: [] });
  t.koios.addedToAccounts.push(at("e5", "5000000"), ...ada.map((value, i) => at((0xe6 + i).toString(16), value)));
  const D = "d9".repeat(32);
  const cut = {
    id: "a9".repeat(32),
    progress: "seedelf.lovejoin.sending.preprod",
    deposit: D,
    mixes: ["a8".repeat(32), "a9".repeat(32)],
    leaves: [inAda({ txHash: "a8".repeat(32), txIndex: 0 }), inAda({ txHash: "a9".repeat(32), txIndex: 0 })],
    boxes: 2,
    pools: { [ADA]: 2 },
    total: 3,
    sent: 1,
    at: t.clock.now - 2 * HOUR,
    scheduled: true,
    stopped: CHAIN_CUT(),
    ended: t.clock.now - 2 * HOUR,
  };
  t.koios.addedToAccounts.push(await ownedBox(t, D, 0), await ownedBox(t, D, 1));
  await t.store.set("lovejoin.preprod", { due: [], chains: [cut] });
  return t;
}

describe("chunk 51, gap-g2#1: Mix again from my public account", { timeout: 120_000 }, () => {
  it("mixes as many of the account's boxes as its largest UTxO of ADA alone pays for, and says the rest wait", async () => {
    // Two boxes two waves deep, three a mix: 8 mixes, planned at 1.5 + 2 × 4 × 0.95 = 9.1 ₳ (again_funding_in); one
    // box, 4 mixes, at 5.3 ₳.
    // Control: 11 ₳ in one UTxO pays for both, and the chain is built.
    const one = await withAccount(["11000000"]);
    const both = await one.lovejoin.publicAgainBuild("preprod", ADA);
    expect(both).toMatchObject({ again: true, boxes: 2, owned: 2, depth: 2 });
    expect(both.adaShort).toBeUndefined();

    // The same 11 ₳ in two UTxOs: 6.5 ₳ pays for one box alone, both together for two. One goes, paid from the 6.5 ₳
    // UTxO alone, and the review says why the other waits.
    const two = await withAccount(["6500000", "4500000"]);
    const built = await two.lovejoin.publicAgainBuild("preprod", ADA);
    expect(built).toMatchObject({ again: true, boxes: 1, owned: 2, depth: 2, adaShort: true });
    const kept = await two.wallet.withKeys(() => two.session.get<{ chain: Array<{ txCbor: string }> }>(SESSION_LOVEJOIN_PUBLIC));
    const first = txInputs(Uint8Array.from(Buffer.from(kept!.chain[0]!.txCbor, "hex")));
    expect(first).toContain(`${"e6".repeat(32)}#0`);
    expect(first).not.toContain(`${"e7".repeat(32)}#0`);
    expect(publicAgainRest(built)).toBe(t("lovejoin.review.asManyAsAdaPays", { count: 1 }));

    // None of them pays for even one box: refused, as before.
    const poor = await withAccount(["4000000", "4000000"]);
    await expect(poor.lovejoin.publicAgainBuild("preprod", ADA)).rejects.toThrow("doesn't pay for mixing a box again");
  });

  it("says why the rest wait: the pool's room, or the account's ADA", () => {
    expect(publicAgainRest({ boxes: 2, owned: 2 })).toBeUndefined();
    expect(publicAgainRest({ boxes: 2 })).toBeUndefined();
    expect(publicAgainRest({ boxes: 1, owned: 3 })).toBe(t("lovejoin.review.asManyAsOneGo", { count: 1 }));
    expect(publicAgainRest({ boxes: 1, owned: 3, adaShort: true })).toBe(t("lovejoin.review.asManyAsAdaPays", { count: 1 }));
    expect(t("lovejoin.review.asManyAsAdaPays", { count: 2 })).toContain("2 boxes");
  });
});
