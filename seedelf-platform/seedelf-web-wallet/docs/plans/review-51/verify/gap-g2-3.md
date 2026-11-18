# gap-g2#3: verification

From lane gap-G2, graded low by its finder.

## Trace: confirmed, low

The finding holds as described. The public Mix form's copy of WebAssembly's pick is publicPick, at Lovejoin.tsx:410. It leaves out only locked UTxOs, the collateral and UTxOs flagged `unspendable`. On the public side, `unspendable` is set only for a reference script whose bytes Koios doesn't give (coin-control.ts:324, koios.ts:92-97). WebAssembly's chain_from_account_at refuses more than that: its token pick (wasm/src/lovejoin.rs:2227) and its ADA pick (:2284) drop every UTxO that eval::refusal refuses, which is any reference script and any inline datum nested past 128 levels (seedelf-core eval.rs:62-90).

So a stranger can put one of two UTxOs at the account: one with a reference script Koios gives the bytes of, or one with a datum too deep to read. Either way it is counted in 'What Lovejoin can spend from your public account' and in the stepper's cap, and Review then refuses the count the stepper offered.

Nothing missed guards it:
- The worker's publicBuild passes readAccount's UTxOs to WebAssembly unchanged.
- UtxoInfo has no field that could carry this.
- The existing test pins 'one holding a reference script' only for a UTxO already flagged `unspendable` (tests/lovejoin-form-review-fixes.test.ts:209).

I ran the real WebAssembly and both cases failed as predicted. With a fix sketch applied in a throwaway copy, the same test passes.

Grade, low (the finder's):
- Who: a stranger, who has to give away the UTxO's ADA. The figure is wrong by exactly that gift, so a minimum-ADA UTxO (about 1.2 to 2 ₳) moves the cap by at most one box, and only when the account sits near a box's threshold.
- Cost: no money moves, nothing is locked or misdirected, and the signed review is right. Review refuses in correct words.
- Way out: pick fewer boxes, or spend the stranger's UTxO in an ordinary public payment. Send and move-in take both kinds (tests/move-in.test.ts:163-183 shows Max spending a deep-datum row).

The Bootstrap form's public side has no ADA cap (bootstrapLimits :3721-3740), so there only its figure is wrong. A token pool's `enough` errs the same way through publicPick's shared `spendable` list; I traced that case but did not run it.

**Evidence:**

Trace, all paths under TREE seedelf-platform/:

1. A stranger pays the account's 0/0 base address an ADA-only UTxO that holds either a reference script Koios gives the bytes of, or an inline datum nested past 128 levels.
   - koios.ts:92-97: `measurable` is true when `bytes` is hex and `size` equals the byte length.
   - account.ts:95-125 (readAccountUtxos) keeps every row under the account's keys, with no script or datum filter.
   - balances.ts:460 stores those rows in session.

2. coin-control.ts:279-331 (lists), public side:
   - :324 `...(measurable(p.utxo) ? {} : script)` is the only flag; there is none for a measurable script or a deep datum.
   - rpc.ts:588-624: UtxoInfo has no field for either.

3. The Mix form reads them (Lovejoin.tsx):
   - :2782-2793 calls `call("utxos")`; handlers.ts:310-312 returns `ctx.coins.lists(...)`; the page keeps `lists.cardano`.
   - :2833 publicSideOf, then :487 publicMixAda, then :447 publicPick.
   - :410 `utxos.filter((u) => !u.locked && !u.collateral && !u.unspendable)`, and :411 sums every ADA-only UTxO.
   - :2841-2851 mixOffer, then mixMost :311-315, then boxesAffordable(side.lovelace, funding, box, 0n) (:279-288), which sets the stepper's `most`.
   - :618 labels the figure 'lovejoin.mix.inPublicSpendable' = 'What Lovejoin can spend from your public account'.
   - Bootstrap: :3181 uses the same publicSideOf, as a figure only.
   - Token pool: :313-314 publicBoxesAffordable (:458-471) builds `holding` from the same `spendable`, so `enough` counts the stranger's token too.

4. Review:
   - lovejoin.ts:4845 publicBuild calls readAccount (account.ts:162-213; only locked UTxOs, the collateral and a reserved collateral are taken out).
   - The request goes to wasm lib.rs:6238 buildLovejoinFromAccount, then chain_from_account_at.
   - wasm/src/lovejoin.rs:2227 and :2284 both apply `.filter(|p| seedelf_core::eval::refusal(&p.utxo).is_none())`.
   - eval.rs:62-70 (refusal: Some for any reference_script) and :77-90 (unreadable_datum: past cbor::MAX_DEPTH = 128).
   - So total < needed, and it bails at lovejoin.rs:2295-2307.

5. The finder's figures check out:
   - At depth 2, width 3: 4 mixes a box, so 5 + 4 × 0.95 = 8.8 ₳ a box (core lovejoin/mod.rs:1767, 1777), plus DEPOSIT_RESERVE 1.5 ₳ (:1806).
   - 10 × 8.8 + 1.5 = 89.5 ₳ fits under 90 ₳, so the stepper reaches 10.
   - 5 boxes need 45.5 ₳, which the refusal rounds up to '46 ₳'.

6. The run, at depth 1 (5.95 ₳ a box, 1.5 ₳ beside), with the real WebAssembly and v2's 5 ₳ pool:
   - Measurable script: the form shows 50 ₳ and offers 8 boxes. Review of 8: "Your public account's ADA doesn't pay for 8 boxes of 5 ₳ and their mixes: that takes 50 ₳ in UTxOs of ADA alone, besides the collateral". The build itself takes 3 and refuses 4.
   - Deep datum: the form shows 27 ₳ and offers 4. Review of 4 refused ('takes 26 ₳'). The build takes 3.

7. Fix check: in a copy at $HOME/.cache/seedelf-review-51/verify-gap-g2_3-trace (removed afterwards), I flagged public rows that have a reference_script or a datum that doesn't nest within 128 levels (coin-control lists) and had publicPick skip them. Result: 'Test Files 1 passed (1), Tests 2 passed (2)', 37 s.

8. Since: e43eef7f (publicMixAda's first form, 1.6.0's review fix round 2), whose filter was already `!u.locked && !u.collateral && !u.unspendable`. That came after the WebAssembly refusal filter (0334db01, launch review #12) and after unreadable_datum joined refusal (fc8561c7). publicPick (3ea05dc1) kept the same filter. All of it shipped in web-wallet/1.6.0.

9. Coverage:
   - tests/lovejoin-form-review-fixes.test.ts:196-226 models 'one holding a reference script' only as `unspendable: "script"`.
   - tests/lovejoin-public-cap-review-fixes.test.ts has no refused UTxO.
   - X3's checked line 'where the two differ, the copy errs low' misses this case.

**Known:** Not known. I searched `docs/backlog.md`, `docs/archive/plans/*` (each review's Not fixed, Left open, Disputed and For the owner sections, 1.6.0 to 1.9.1, the launch, independent and privacy reviews, the chunk 34 leftovers) and `docs/archive/post-release-roadmap.md`. Terms: publicMixAda, publicPick, publicBoxesAffordable, measurable, unspendable, evaluable, eval::refusal, 'reference script' together with Lovejoin/mix/public/stepper, 'too deep', unreadable_datum, MAX_DEPTH, stepper, 'What Lovejoin can spend', "ADA doesn't pay", 'ADA alone', R3-14, 321-lj-screens.

The nearest items, none of which covers the form counting UTxOs the build refuses:
- `backlog.md:67` and `post-release-roadmap.md:389` (R3-14's Rust half): the token pick refusing where it could take more UTxOs, so the stepper errs low. That is the opposite direction.
- Launch review #12: about the wallet's own spends of reference-script UTxOs; fixed.
- Independent review L20 and chunk 34's H1/H2: a session's collateral and inputs.
- Chunk 51's e8b#1: the collateral path, a different path.
- `SECURITY.md`: no in-scope exclusion applies, because the stranger's rows sit inside an honest answer.
- The owner's rules: none. The fix adds no refusal; a form figure would follow what the build does.

**Fix notes:**

Count on the same rule WebAssembly uses:
- Flag public rows that `evaluable` refuses (lovejoin.ts:2706, which already mirrors eval::refusal: any reference script, or a datum that withinDepth rejects). Use a new UtxoInfo flag, for example `unmixable`, set in coin-control lists. Leave `unspendable` as it is, since Send and move-in can spend these rows.
- Have publicPick (Lovejoin.tsx:410) skip flagged rows. That fixes the Mix figure and cap, the Bootstrap figure (:3181), cantAffordPublic's 'held', and publicBoxesAffordable's `enough` and ADA in token pools.
- Watch the import cycle: lovejoin.ts imports coin-control's COLLATERAL_LOVELACE, so move `evaluable`/`withinDepth` into a leaf module (cbor.ts or koios.ts) rather than importing lovejoin.ts from coin-control.
- Alternative: have the worker hand the form WebAssembly's own pick for a count.

Same family, no UI pick, nothing to change: WebAssembly applies the same filter at lovejoin.rs:2492 (Mix again's payer) and :2776 (the paid bring-back).

Also:
- Update UtxoInfo's doc (rpc.ts:617-623).
- Extend `tests/lovejoin-form-review-fixes.test.ts:196-226`, which models 'one holding a reference script' only as already `unspendable`.
- X3's checked line ('the copy errs low') should be corrected.

For the owner, wording only: the refusal could also say that a UTxO holding a reference script or an unreadable datum isn't taken. Today it reads 'takes N ₳ in UTxOs of ADA alone' while the stranger's UTxO is ADA alone, which can puzzle a user.

needs_owner: no. The fix adds no refusal and changes no default.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g2-3.test.ts`

Result: Run on TREE from extension/: `nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g2-3.test.ts`. Both tests fail on the bug. The control lines pass (the real build takes 3 boxes from e6 alone and refuses 4); only each test's last assertion fails:

```
 ❯ tests/r51-gap-g2-3.test.ts (2 tests | 2 failed) 41082ms
     × leaves out a stranger's UTxO holding a reference script Koios gives the bytes of 23367ms
     × leaves out a stranger's UTxO whose datum is nested past 128 levels 17714ms
 FAIL  ... reference script Koios gives the bytes of
-   "most": 3,
-   "review": "built 3",
-   "spendable": "20000000",
+   "most": 8,
+   "review": "Your public account's ADA doesn't pay for 8 boxes of 5 ₳ and their mixes: that takes 50 ₳ in UTxOs of ADA alone, besides the collateral",
+   "spendable": "50000000",
 ❯ tests/r51-gap-g2-3.test.ts:86:51
 FAIL  ... datum is nested past 128 levels
-   "most": 3,
-   "review": "built 3",
-   "spendable": "24000000",
+   "most": 4,
+   "review": "Your public account's ADA doesn't pay for 4 boxes of 5 ₳ and their mixes: that takes 26 ₳ in UTxOs of ADA alone, besides the collateral",
+   "spendable": "27000000",
 ❯ tests/r51-gap-g2-3.test.ts:93:54
 Test Files  1 failed (1)
      Tests  2 failed (2)
   Duration  55.66s
```

The same file in a copy with a fix sketch (publicPick skipping rows that hold a reference script or a datum past 128 levels): 'Test Files 1 passed (1), Tests 2 passed (2)', 37.21 s. The copy has been removed.

```
// Chunk 51, gap-g2#3: the public Mix form counts UTxOs that WebAssembly's chain never takes. The chain's pick
// (chain_from_account_at) leaves out every UTxO that eval::refusal refuses: any reference script, and an inline datum
// nested past cbor::MAX_DEPTH. The form's copy of that pick (Lovejoin.tsx publicPick) leaves out only a UTxO marked
// `unspendable`, and on the public side that's a reference script whose bytes Koios doesn't give (coin-control.ts
// lists, koios.ts measurable). So a stranger's UTxO at the account, holding a reference script Koios gives the bytes
// of, or a datum too deep to read, is counted in "What Lovejoin can spend from your public account" and in the
// stepper's cap, and Review refuses the count the stepper offers. Asserted here is the right behaviour: the figure is
// what the chain can spend, and the most the stepper offers is the most the chain builds. With the real WebAssembly
// and Lovejoin v2's 5 ₳ pool, as the chain tests have them (chain-fixtures.ts publicFunded).
import { describe, expect, it } from "vitest";

import type { KoiosUtxo } from "../src/background/koios";
import * as LovejoinScreen from "../src/ui/screens/Lovejoin";
import { publicFunded, type Tested } from "./chain-fixtures";
import { deepRow, withRawRows } from "./fakes";
import { ADA, ADA_BOX } from "./v2-pools";

const { mixOffer, publicSideOf } = LovejoinScreen;

/** Real chains are built and measured in WebAssembly: seconds each, more on CI. */
const SLOW = { timeout: 300_000 };

/** A native script of one key, `[0, keyhash]`: 32 bytes of CBOR, which Koios gives, so it's measurable. */
const SCRIPT = { hash: "ab".repeat(28), size: 32, type: "timelock", bytes: `8200581c${"cd".repeat(28)}` };

/** What a stranger puts at the account's 0/0, beside e6…#0 (`at`, the row it's made like). */
type Stranger = (t: Tested, at: KoiosUtxo) => void;

/** 30 ₳ of ADA alone carrying SCRIPT. */
const withScript: Stranger = (t, at) => {
  t.koios.addedToAccounts.push({ ...at, tx_hash: "e8".repeat(32), value: "30000000", reference_script: SCRIPT } as KoiosUtxo);
};

/** 3 ₳ of ADA alone whose inline datum is a list nested 200 levels deep. */
const withDeepDatum: Stranger = (t, at) => {
  withRawRows(t.koios, at.payment_cred!, [deepRow(at, 200, { txHash: "e9".repeat(32) })]);
};

/**
 * The public account: e6…#0 holds `lovelace`, beside its 5 ₳ collateral and the stranger's UTxO, and the UTxOs of ADA
 * alone it was recorded with are kept out of payments, so e6 is the only UTxO of ADA alone the chain may spend.
 * Lovejoin one wave deep, three boxes a mix: a box costs 5 ₳ and a mix's 0.95 ₳, and the funding keeps 1.5 ₳ beside
 * them. What the page has of it: Home's figure, and the account's UTxOs as its `utxos` read gives them (coin-control's
 * lists).
 */
async function account(lovelace: string, stranger: Stranger) {
  const t = await publicFunded(lovelace);
  await t.deps.preferences.set({ lovejoinDepth: 1 });
  const at = t.koios.addedToAccounts.find((u) => u.tx_hash === "e6".repeat(32))!;
  stranger(t, at);
  const home = (await t.balances.get("preprod")).cardano;
  let { cardano: utxos } = await t.coins.lists("preprod");
  const ours = ["e6", "e8", "e9"].map((x) => x.repeat(32));
  for (const u of utxos.filter((u) => !u.tokens.length && !u.collateral && !u.locked && !ours.includes(u.txHash))) {
    ({ cardano: utxos } = await t.coins.setLocked("preprod", "cardano", `${u.txHash}#${u.index}`, true));
  }
  return { t, home, utxos };
}

/** Review of `boxes` boxes from that account: what it built, or why not. */
async function review(t: Tested, boxes: number): Promise<string> {
  return t.lovejoin.publicBuild("preprod", boxes, { pool: ADA }).then(
    (s) => `built ${s.boxes}`,
    (e: unknown) => (e as Error).message,
  );
}

/**
 * The Mix form at one box, as the page has it (Lovejoin.tsx): its figure (publicSideOf), the stepper's most (mixOffer,
 * the pool's room left at ten), and Review at that most, on a fresh copy of the account.
 */
async function mixForm(lovelace: string, stranger: Stranger) {
  const { t, home, utxos } = await account(lovelace, stranger);
  const funding = await t.lovejoin.funding("preprod", 1, false, undefined, ADA);
  const { side, mixable } = publicSideOf(home, utxos, undefined, 1);
  const { most } = mixOffer("public", side, undefined, funding, ADA_BOX, 10, 1, 0n, mixable ? utxos : undefined);
  return { depth: funding.depth, mixable, spendable: side?.lovelace, most, review: await review(t, most) };
}

describe("gap-g2#3: the public Mix form counts only what the chain's pick can spend", SLOW, () => {
  it("leaves out a stranger's UTxO holding a reference script Koios gives the bytes of", async () => {
    // What the chain pays for: three boxes from e6's 20 ₳ (19.35 ₳), and not four (25.3 ₳); the stranger's 30 ₳ never.
    expect(await review((await account("20000000", withScript)).t, 3)).toBe("built 3");
    expect(await review((await account("20000000", withScript)).t, 4)).toMatch("doesn't pay for 4 boxes");
    // The form: its figure is what the chain can spend, and its stepper offers what the chain pays for.
    expect(await mixForm("20000000", withScript)).toEqual({ depth: 1, mixable: true, spendable: "20000000", most: 3, review: "built 3" });
  });

  it("leaves out a stranger's UTxO whose datum is nested past 128 levels", async () => {
    // What the chain pays for: three boxes from e6's 24 ₳, and not four; the stranger's 3 ₳, which would make 27, never.
    expect(await review((await account("24000000", withDeepDatum)).t, 3)).toBe("built 3");
    expect(await review((await account("24000000", withDeepDatum)).t, 4)).toMatch("doesn't pay for 4 boxes");
    expect(await mixForm("24000000", withDeepDatum)).toEqual({ depth: 1, mixable: true, spendable: "24000000", most: 3, review: "built 3" });
  });
});
```
