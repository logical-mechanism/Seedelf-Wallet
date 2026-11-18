# gap-g2#1: verification

From lane gap-G2, graded low by its finder.

## Trace: confirmed, low

The finding holds as described. "Mix again from my public account" pays every mix of every box from one UTxO: the account's largest that holds only ADA. The worker picks the box count from the pool's room and the chain cap and never looks at the account's ADA. The page sends no count, and nothing retries with fewer boxes. So when the account's ADA is split across UTxOs and no single one pays for every box, the review is refused, even though fewer boxes, or two fee inputs, would build. Lovejoin v2's scripts and the ledger accept a mix with extra fee inputs: mix_logic reads only the mix-script inputs, and mix_box only asks for the mix_logic withdrawal.

I found no guard, no other caller and no test that covers it. One test, lovejoin_test.rs:1268-1281, pins today's refusal as intended ("No one UTxO pays for it, though two together would: it says so"). None of the brief's lists settle it.

Severity is low:
- **Who:** the user, by an ordinary press.
- **Cost:** no money is lost; the user gets a refusal.
- **Ways out:** a self-send to merge the UTxOs (one fee of about 0.2 ₳ and a wait), a lower Settings depth (less privacy), or "Pay from my private balance anyway" (a tie the page warns about). It is not a stuck state.

**Evidence:**

The trace (every cited line opened in TREE; code is the same as web-wallet/1.9.1 apart from manifest.ts and READMEs):

1. **Page.** Lovejoin.tsx:1601-1611: AgainActions shows a plain button. It is turned off only by busy, mixingAgain, publicSending or unusable, never by the account's ADA. Lovejoin.tsx:2954-2955: againPublicReview sends only `{ ...named, width: w }`. handlers.ts:551-552 calls `publicAgainBuild(ctx.network, message.pool, widthOf(message.width))` with no count; `lovejoin-mix-public-build` (:555) does pass `message.boxes`.

2. **Worker.** lovejoin.ts:5022: readAccount returns `utxos`, the spendable UTxOs without the collateral (account.ts:183, :199). The collateral is the oldest UTxO of exactly 5 ₳ with no tokens (coin-control.ts:184, :205).
   - :5052-5053: `most = floor(MAX_CHAIN_MIXES / mixesPerBox)` and `count = min(theirs, floor(others / (mixesPerBox × (w−1))), most)`. MAX_CHAIN_MIXES = 10 × 13 = 130 (:1811). Nothing reads ADA.
   - :5067-5096: build(3, boxes) calls wasm.buildLovejoinAgainFromAccount. unstale (:4598-4615) retries only on StalePool. narrower (:2685, :5087-5093) only falls back from four a mix to three. Nothing retries with fewer boxes.
   - Defaults: depth 2, width 3 (shared/preferences.ts:174-176).

3. **WebAssembly.** wasm/src/lovejoin.rs:
   - :2480: `boxes = request.boxes.min(ours.len())`.
   - :2485-2486: `// One UTxO pays for every mix: the largest of ADA alone.` and `needed = again_funding_in(boxes, …)`.
   - :2488-2494: ADA only, `eval::refusal` none, not the collateral, `max_by_key(lovelace)`.
   - :2495-2505: refuses with "…doesn't pay for mixing {n} again: that takes {⌈needed⌉} ₳ in one UTxO of ADA alone, besides the collateral".

4. **Core.** seedelf-core/src/lovejoin/mod.rs:
   - :1966-1968: again_funding_in = 1.5 ₳ + boxes × per_box_again_in.
   - :1942-1944: per_box_again_in = mixes_per_box_at × mix_fee_estimate (0.95 ₳, :1777).
   - :1767-1769: mixes_per_box_at = (w^d − 1)/(w − 1).
   - :566-572: Payer has one `fee: Coin`.
   - :1062-1063 and :1087: mix_with adds `payer.fee.input()` alone.
   - :2557-2578: fan_out's first mix pays from payer.fee, each later one from the change before.

5. **Contracts.** Lovejoin v2 at 29573c5:
   - mix_logic.ak:316-333: collect_well_formed_mix_inputs keeps only inputs at the mix script.
   - mix_logic.ak:153-230: validate_mix checks the first N outputs and that the rest aren't at the script. Nothing limits the other inputs.
   - mix_box.ak: spend needs only `pairs.has_key(self.withdrawals, mix_logic)`.
   - So a second fee input is valid.

6. **Contrast.** The account's first public mix, chain_from_account_at, takes as many ADA-only UTxOs as pay, largest first, and one more when the build comes up short (lovejoin.rs:2278-2294, :2341-2379).

7. **Pinned.** wasm/tests/lovejoin_test.rs:1268-1281 asserts the refusal for two UTxOs that would pay together.

8. **Since.** 1c054c3b (2026-09-27) added the `// One UTxO pays for every mix` line and `max_by_key`. The refusal string is in web-wallet/1.6.0 and web-wallet/1.9.1 (one match each).

9. **The finder's figures, checked.** At depth 2, width 3: 4 mixes a box, 3.8 ₳ a box. 8 boxes need 31.9 ₳, shown as 32 ₳. most = 32 and room = 64/8 = 8, so the count is 8. 6 boxes need 24.3 ₳, which the 25 ₳ UTxO pays.

10. **Run** (Vitest, the worker with the real built WebAssembly in wasm/pkg, which carries the refusal string): `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g2-1.test.ts`. The control (11 ₳ in one UTxO) built both boxes. The same 11 ₳ in two UTxOs failed:
```
 FAIL  tests/r51-gap-g2-1.test.ts > r51 gap-g2#1: Mix again from my public account > mixes the account's boxes again when its UTxOs of ADA alone pay for it together, though no one of them pays for every box
AssertionError: promise rejected "Error: Your public account's ADA doesn't …" instead of resolving
 ❯ tests/r51-gap-g2-1.test.ts:77:24
Caused by: Error: Your public account's ADA doesn't pay for mixing 2 boxes again: that takes 10 ₳ in one UTxO of ADA alone, besides the collateral
 ❯ Module.buildLovejoinAgainFromAccount ../wasm/pkg/seedelf_wasm.js:1226:14
 ❯ src/background/lovejoin.ts:5083:34
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

11. **Sketch fix.** In a copy at $HOME/.cache/seedelf-review-51/verify-gap-g2_1-trace (since removed), I capped the worker's count at what the largest ADA-only UTxO pays for. The same test then passed: "Test Files 1 passed (1), Tests 1 passed (1), Duration 6.68s".

**Known:** None: it isn't settled or known.
- docs/backlog.md: the open calls, the ⬜ candidates (the Lovejoin list in full) and the Declined list.
- The *Left open*, *For the owner*, *Disputed* and *Not fixed* sections of every archived review and chunk plan.
- chunk-46 and chunk-49, SECURITY.md's out-of-scope list, and the owner's rules.
- Terms searched: 'one UTxO of ADA alone', 'in one UTxO', 'largest ADA', 'UTxO of ADA alone', 'pay for mixing', 'again_from_account', 'publicAgainBuild', 'Mix again from my public account', 'fee inputs', 'consolidat', 'again_affordable', "account's ADA".
- The nearest item is the backlog's ⬜ R3-14: chain_from_account_at, a different builder, refuses where ADA alone falls short rather than take more token UTxOs. It's a sibling of this one, not the same item.
- Chunk 34's session 6, item 1 (the owner, 2026-10-19) made the Mix form's stepper stop at what the public account's ADA pays for. Mix again from my public account never got that cap.
- Today's behaviour is pinned only by a test comment (wasm/tests/lovejoin_test.rs:1268-1281), not by any settled list.
- In chunk 51 it appears only in INDEX.md:347, with no merge.

**Fix notes:**

This needs the owner's call: it changes what Mix again from my public account builds.

**(a), recommended, best done in WebAssembly rather than the worker.** Only WebAssembly applies the paying UTxO's own filter: ADA only, `eval::refusal`, not the collateral. In again_from_account_at, after the largest ADA-only UTxO is picked:
- set `boxes = boxes.min(again_affordable_in(lovelace(largest), &protocol, depth, width))`;
- refuse only when that is 0.

ChainResult.boxes already carries the real count into the worker's summary (`chain.boxes`), and the summary already has `owned`, so the review can say "N of your M" (gap-g2#4). The four-to-three fallback (`narrower` → `build(3, count(3))`) also passes through WebAssembly's cap. A worker-only cap, which my sketch used, would have to copy WebAssembly's filter; my test passes under either.

**(b).** Let core's Payer take several fee coins for the first mix, as chain_from_account_at's deposit does: all of them inputs of the first mix, change from their sum. This touches:
- mix_with: inputs, the `known` rows, signers, and the fee measure;
- fan_out's first `paying`;
- the signer lists in again_from_account_at.

Measure it again at four a mix: a four-box mix fits the CPU limit by about 1%, and mix_logic and mix_box walk every input.

**Same family.** Other one-UTxO payers: collateral_mix (lovejoin.rs:545) and withdraw_paid_in (:2778). Each pays only one transaction's fee, so they rarely bite. The public Mix again is the member whose cost grows with the boxes: at depth 3 its eight boxes need 100.3 ₳ in one UTxO.

**Tests.**
- wasm/tests/lovejoin_test.rs:1268-1281 has to change under (b).
- Under (a), its UTxOs (just over 1.7 ₳ each, at depth 1) still pay for no box, since one box needs 2.45 ₳. Its refusal stays, but the count in its message may change.
- The finder's test sketch ("under (a) it mixes one box") needs larger UTxOs for the same reason; the test above uses 6.5 ₳ + 4.5 ₳.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g2-1.test.ts`

Result: It fails on TREE today because of the bug. The control step passed: 11 ₳ in one UTxO built both boxes. The finding's case then failed at line 77: "AssertionError: promise rejected … instead of resolving", caused by "Error: Your public account's ADA doesn't pay for mixing 2 boxes again: that takes 10 ₳ in one UTxO of ADA alone, besides the collateral". The error was raised in buildLovejoinAgainFromAccount, called from src/background/lovejoin.ts:5083. Summary: 1 file, 1 test failed, 6.05 s.

In a copy with a sketch of fix (a), the worker's count capped at what the largest ADA-only UTxO pays for, the same test passed (1 passed, 6.68 s). The copy has been removed. Only this file was run; no other file in TREE was changed.

```
/**
 * Chunk 51, gap-g2#1 (the trace verifier's test). Mix again from my public account pays every mix of every box it
 * counts from one UTxO of ADA alone (wasm/src/lovejoin.rs:2485-2505), and the worker counts the boxes with no regard
 * to what the account can pay (background/lovejoin.ts:5052-5055), so an account whose ADA-only UTxOs together pay is
 * refused outright: no fewer boxes, and no second fee input, though Lovejoin's scripts read only the boxes among a
 * mix's inputs. Asserts the right behaviour: the account's ADA pays, so something is built (both boxes from both
 * UTxOs, or as many as the largest pays for). Fails today with the refusal.
 */
import { describe, expect, it } from "vitest";
import type { KoiosUtxo } from "../src/background/koios";
import { CHAIN_CUT } from "../src/background/lovejoin";
import { koiosPreprod, testBalances, vectors } from "./fakes";
import { ADA, ADA_POOL, ADA_ROWS, adaBox, madeByAdaMix, ownDatum } from "./v2-pools";

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
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

describe("r51 gap-g2#1: Mix again from my public account", { timeout: 120_000 }, () => {
  it("mixes the account's boxes again when its UTxOs of ADA alone pay for it together, though no one of them pays for every box", async () => {
    // Two boxes two waves deep, three a mix: 8 mixes, planned at 1.5 + 2 × 4 × 0.95 = 9.1 ₳ (again_funding_in); one
    // box, 4 mixes, at 5.3 ₳.
    // Control: 11 ₳ in one UTxO pays for both, and the chain is built.
    const one = await withAccount(["11000000"]);
    await expect(one.lovejoin.publicAgainBuild("preprod", ADA)).resolves.toMatchObject({ again: true, boxes: 2, depth: 2 });

    // The same 11 ₳ in two UTxOs: 6.5 ₳ pays for one box alone, both together pay for two. The ledger and Lovejoin's
    // scripts take a mix with two fee inputs, so the account's ADA pays: something must be built, not refused.
    const two = await withAccount(["6500000", "4500000"]);
    const built = two.lovejoin.publicAgainBuild("preprod", ADA);
    await expect(built).resolves.toMatchObject({ again: true, depth: 2 });
    expect((await built).boxes).toBeGreaterThanOrEqual(1);
  });
});
```
