# Fixer `wlj-1`: box crediting and ties (Lane L, after `bootstrap`)

Findings 316#0, 316#1, 316#3, 316#4 and x-privacy#0. Everything is in `background/lovejoin.ts`, plus two comment moves in `shared/rpc.ts`. I didn't touch `funding()`, `sessions.ts` or `Lovejoin.tsx`, added no strings, and ran no cargo. **No test of mine needs the pkg rebuilt.**

## Findings

| id | status | change |
|---|---|---|
| 316#0 (high) | fixed | A box brought back by hand counts against the Bootstrap that held it. The new `holderOf` picks the one whose deposit put the box there, or, for a box someone else's mix moved, the oldest landed Bootstrap with more boxes out than it still has at its deposit. Bring one back now and Bring every box back now both store it on the withdraw (`Withdrawing.holder`), and `countBack` credits it. A `bootstrap: true` sealed by an earlier build is credited by where its box sat, and only then by age. `squareUp` credits each Bootstrap first for the boxes its deposit no longer lists, then by age. `bootstrapOf` uses boxes no record accounts for as stand-ins only for a Bootstrap whose deposit went in (`found`, or a box of it listed now). A box that comes back by itself from a let-go Bootstrap's deposit counts against that Bootstrap. |
| 316#1 (medium) | partly | Cases (b) and (c) are fixed. When a public seed's or Bootstrap's chain record goes, its deposit's account is kept in a new sealed `Schedule.depositors` record, kept and pruned as `origins` is. `depositAccountOf` reads it once the entry has closed. **Case (a)** is not fixed: a 1.5.0 public seed whose record went before the update can't be told from a mix's last box without a lookup. That's an owner's call (below). |
| 316#3 (low) | fixed | When a chain with no box of its own sends its collateral's mix, `chainSent` makes its entry with that one box: a return that came back directly, or a tail built again. Your mixes shows it, and the counts balance. |
| 316#4 (nit) | fixed | rpc.ts: the stranded `/** One transaction of a chain … */` moved down to `LovejoinChainTx`, and `cleared`'s comment is on its own line. Two anchored edits. |
| x-privacy#0 (low) | partly | **Worker half fixed.** Paying from the private balance for a box a public account's deposit made, the wallet now picks, after a pure box-back, a UTxO made private from no *other* public account where one pays, and only then the smallest. It no longer ties two accounts for the user where it doesn't have to. No refusal: where only such a UTxO pays, it's used as before, and its history names both accounts. **The page half (naming the accounts in the questions) goes to the screens round** (see "Notes"). The worker already gives the page what it needs. |

### Why the fixes differ from the suggested ones

- **316#0: the stored holder, not only "match by deposit".** The fix notes were right that matching by deposit isn't enough. A moved box picked first (it's listed last) went to the oldest Bootstrap, which then closed early with one of its own still at its deposit. The second test reproduces this, and mutation (b) shows the deposit-only version failing it.
- **316#1: a record of its own, not an Origin with `mixed: false`.** An Origin feeds the rules for how boxes come back: `depositsOf`, `mixedOf`, `knownOf` and `found` all read it. Suppose one lagging listing drops a held Bootstrap box's leaf. With such an Origin, the box would read as "not mixed yet" while `bootstrapOf` still held it. Home would count it twice, and Bring one back would refuse it with "the server says a deposit put it in". Today that happens only after a Koios lookup; the Origin would make it happen without one. `depositors` is read by `depositAccountOf` alone, so how boxes come back is unchanged. It costs no request.
- **x-privacy#0: a better default and words, never a refusal.** The finding suggested skipping or refusing a payer. Per the owner's rule, I only stop the wallet making the link on the user's behalf. The public payer is the user's choice, and naming it is page work.

## Tests

All new tests are in a new file: `extension/tests/lovejoin-crediting-review-fixes.test.ts` (10 tests). It uses the real WebAssembly, PR #163's preprod token pool, and the classic pool's recorded boxes.

**316#0**, describe "two Bootstraps in one pool (1.6.0's release review, 316#0)":
1. "counts a box brought back by hand against the Bootstrap whose deposit put it there: the older one keeps holding its own". Setup: two public Bootstraps of 2 boxes each, listed oldest first, and Bring one back pressed twice as the page picks (`heldRequest`). Then: B1 keeps both boxes held, has no due time, and Home shows `bootstrap: 2, boxes: 0`. 34 h later nothing comes back by itself. Both by-hand returns are `box:<tx>+public:0`.
   - Fail before: `AssertionError: expected [ [ …(2) ] ] to deeply equal [ [ …(2) ] ]`. B2's entry was left open and B1's closed.
2. "counts a box someone else's mix moved against the Bootstrap it was moved from, not the oldest". B2 has one box at its deposit and one moved. The three presses take the moved box, then `b2#0`, then `b1#1`. Then `b1#0` stays held and never comes back.
   - Fail before: `AssertionError: a box the page offers to bring back: expected undefined to be defined`. B1 closed early, so at the third press nothing was held.
3. "counts each box Bring every box back now takes against the Bootstrap that held it, though the run stops partway". The moved box is listed first, and the run is out of time after one withdraw. Then B2 shows `back: 1` and B1 is untouched.
4. "counts a box back by itself from where a Bootstrap brought back all at once put it against that Bootstrap, not another mix". A let-go Bootstrap's box comes back by itself while a public mix is open in the pool. It's credited to the Bootstrap, and the mix stays open.
5. "squares up a box another device brought back against the Bootstrap whose deposit no longer lists it". B2's boxes vanish from the listing with no withdraw of ours. 4 h later B1 still holds both, and nothing comes back.
   - Fail before: `expected [ [ …(2) ] ] to deeply equal [ [ …(2) ] ]` (`b2…` left, `b1…` expected).
6. "holds nothing in a Bootstrap's place before its deposit is listed: the wallet's other box comes back as any".
   - Fail before: `AssertionError: expected [ { …(3) } ] to deeply equal []`. `f1` was held in place of a Bootstrap that hadn't landed.

Tests 3 and 4 were written after the fix. Their fail-before is the mutation that undoes exactly their hunk (below).

**316#1**, describe "a public deposit's box, its chain's record and its mix gone (1.6.0's release review, 316#1)":
- "records every box of a public Bootstrap let go as the account's, though another box closed its mix's count first". This is case (b), with the real `publicBuild`/`publicSubmit`/`pumpPublic` flow in the classic pool, and a box of the wallet's that a mix made coming back first.
- "records both boxes of a 1.5.0 public seed as the account's, though an older box closed its mix's count first". This is case (c): a kept 1.5.0 seed record, and an older 1.5.0 session leaf due first.
- Fail before, both: `AssertionError: box 1: expected undefined to deeply equal { …(2) }`. The first box was tied through the still-open entry; the last came back tied to nothing.

**316#3**, describe "a chain with no box of its own (1.6.0's release review, 316#3)":
- "follows a return's collateral mixed on its way into the pool as a mix of its own, until its box is back". The record is a `boxes: 0` return with a tail, its three transactions sent. Then `mixes()` lists `{ pool, boxes: 1 }` for session 0, its leaf comes back by itself, and the entry closes.
- Fail before: `AssertionError: expected [] to deeply equal [ ObjectContaining{…} ]`.

**x-privacy#0**, describe "a stuck pool's box paid back from the private balance (1.6.0's release review, x-privacy#0)":
- "pays with one that names no public account but the box's own where one pays, never the smallest that ties another". Account 0's Bootstrap box in a stuck pool. The private UTxOs are a smaller one made private from account 1 and a larger one from account 0. The larger one pays, and the history names account 0 alone.
- Fail before: the withdraw spent `d2…#0` (account 1's), where `d1…#0` was expected.

### Mutation checks

Each was undone with Edit, the tests rerun, and the hunk put back with Edit. In each case the named test failed and the others passed.

- **(a)** countBack without `its` (credit by age alone): tests 1 and 2 fail.
- **(b)** dropWithdrawing not passing `holder` (deposit-only crediting, as the suggested snippet had it): test 2 fails.
- **(c)** squareUp without the "missing at its deposit first" pass: test 5 fails.
- **(d)** bootstrapOf's stand-ins for any entry, landed or not: test 6 fails.
- **(e)** Bring every box back now not passing `holder`: test 3 fails.
- **(f)** countBack without the let-go deposit rule: test 4 fails.
- **316#1:** depositAccountOf without the `depositors` read fails both 316#1 tests. sortOut without the `depositors` write fails both too.
- **316#3:** chainSent without the new `else if`: the 316#3 test fails.
- **x-privacy#0:** the sort without the `another` rank: the x-privacy#0 test fails.

### Existing tests adapted (setup only; each encoded the stand-in hold that 316#0 removes)

- **`tests/lovejoin-flows.test.ts`**, "still brings a 1.5.0 seed's box back by itself once someone else's mix moved it, as a Bootstrap's never does (34d's review 6)". The test confirms the deposit, but its box is moved before any read lists it, and it skipped Home's watch. Now it calls `lj.landedDeposit("preprod", summary.entry)` after confirmation, as pending.ts's `depositLanded` does in the wallet. Without that call, nothing says the deposit went in.
- **`tests/lovejoin-pools.test.ts`**, "tells a pool's page of its own boxes alone when none can come back (34f's review, 6)". Its synthetic Bootstrap's only box sat at `f1`, not at its deposit, and that deposit was never listed. Its box is now at its deposit (`b10…`). The assertion (UI-5's words) is unchanged.

## Files touched

- `extension/src/background/lovejoin.ts`:
  - new: `holderOf`, `accountsIn`, and the fields `Schedule.depositors` and `Withdrawing.holder`;
  - changed: `countBack`, `squareUp`, `bootstrapOf`, `depositAccountOf`;
  - `empty()` and `read()` know `depositors`;
  - sortOut's record drop writes and prunes `depositors`;
  - `chainSent`'s tail branch;
  - `withdrawNowNow` and `bringAllBackNow` pass `holder`;
  - `withdrawOne` keeps `holder`, and orders the private payer's UTxOs;
  - `dropWithdrawing` passes `holder` on.
- `extension/src/shared/rpc.ts`: the two comment moves (316#4).
- `extension/tests/lovejoin-crediting-review-fixes.test.ts` (new).
- `extension/tests/lovejoin-flows.test.ts` and `extension/tests/lovejoin-pools.test.ts`: one test's setup each, as above.

## Keys

None added or changed, critical or otherwise.

## Docs to update

- **privacy.md:198** (a Bootstrap's held boxes). Now true:
  - each box brought back by hand counts against the Bootstrap that held it: the one whose deposit put it there, or, for a box someone else's mix moved, the one it was moved from. So one Bootstrap's boxes still at its deposit stay held, whichever box goes first;
  - a box another device brought back is squared up against the Bootstrap whose deposit no longer lists it;
  - nothing is held in a Bootstrap's place before its deposit is known to be in, by a pool read listing a box there or a watch seeing it land.
- **privacy.md:208** and **flows.md:524** (Pay from my private balance). Now true: one back from Lovejoin first; then, for a box a public account's deposit made, one made private from no other public account, since another's would tie the two accounts; then the smallest that pays.
- **privacy.md:210.** Now true:
  - the tie is kept by the deposit once its chain's record and its mix are gone (`depositors`), so every box of a public Bootstrap or seed is the account's, however its mix's count closes;
  - **"a 1.5.0 public seed's"** is true only for a seed whose record 1.6.0 still found. Say so, unless the owner picks the lookup (owner's call 1).
- **privacy.md:235** (on this device). Optional, since the existing "the account that paid it, kept while their boxes sit unmoved" already covers it: after a public seed's or Bootstrap's chain record goes, which account made its deposit is kept by that deposit, sealed, until 3 hours after a pool read last listed a box there. No new request. The docs lane decides whether the privacy policy's Lovejoin line needs a dated Changes entry; I think the current words cover it.
- **architecture.md:684** (token pools' records), as one or two sentences:
  - a held box counts against the Bootstrap that held it (`holderOf`, kept on the withdraw as `holder`);
  - `squareUp` credits Bootstraps by what their deposits no longer list;
  - `bootstrapOf`'s stand-ins only for a landed Bootstrap;
  - `depositors` keeps a public deposit's account after its record;
  - a chain with no box of its own gets its entry when its collateral's mix is sent.
- **plans/chunk-34-token-pools.md:569** (34a′'s "against the pool's oldest Bootstrap") and **:926** (the tail's entry): record this review's change.

## Calls the owner might overturn

1. **316#1 case (a), not fixed.** A 1.5.0 public seed whose record went before the update. Its leaf (`"public"` in `leaves`) can't be told from a public mix's last box without asking. The options:
   - ask once before such a box goes back. That's free on mainnet while the data layer's `made_by` covers it; otherwise it's a Koios `tx_info`, which the policy's list of reads would need to name;
   - correct privacy.md:210.

   **Recommendation:** correct the doc for 1.6.0. It needs a 1.5.0 public seed (offered only below the classic pool's floor) still out at the update, and 1.5.0 recorded no ties at all.
2. **Nothing held in place of a Bootstrap that hasn't landed (316#0, the fix notes' item 4).** Rare case: someone else's mixes moved all of a Bootstrap's boxes before any read listed one, and no watch saw the deposit land. Those moved boxes are no longer held, and they come back by themselves. They're mixed, so they tie nothing, but they leave the pool. The alternative is today's rule, under which a box brought back in the window before landing frees one of the Bootstrap's own deposit boxes later, unmixed. Home's watch (public) and the session's watch (private) mark a landing in practice (MERGED-5).
3. **The tie is kept in a record of its own** (`depositors`), not as the Origin the review suggested. The reason is above. It's one more sealed field, gone 3 h after its boxes leave the deposit.
4. **x-privacy#0's private payer order** is Claude's choice of default, not a refusal: box-back, then a UTxO that ties no other account, then the smallest. Where only another account's money pays, it's spent as before.
5. **316#3's collateral box is a mix of its own in Your mixes** ("1 box of 5 ₳", a session's return). With an older mix open in the same pool, its box still counts against the oldest open mix first, as mixed boxes are interchangeable (decision 5). So that older card closes first; that's the hub's rule, not this bug.

## Notes for other fixers and the lead

- **No test needs the pkg rebuilt.**
- **The screens round, x-privacy#0's page half.** The worker already gives what's needed: `status().pools[i].otherAccounts` lists every public box whose account isn't the active one, a held Bootstrap box or a not-mixed box included, each with its `account`. `HeldQuestion` takes only `fromAccount: boolean` today (call site Lovejoin.tsx ~3084), and `anywayWarning` says "your public account". Suggested, short and `.privacy.`:
  - where the box is another account's, name it, as in "{{account}} paid for that Bootstrap, so such a box ties that account to your private balance too.";
  - under Pay from my public account: "That box is {{account}}'s: paying from {{active}} ties the two accounts.";
  - the same naming in `anywayWarning`'s public variants.

  Optionally, say in `lovejoin.stuck.privacy.private` that it takes one that ties no other account where it can (a critical key). No refusal.
- **wlj-2…wlj-4:**
  - `countBack(s, p, box, bootstrap, holder?)`;
  - `Withdrawing.holder`;
  - `Schedule.depositors` (in `read()`/`empty()`, written and pruned in sortOut beside `origins`);
  - `holderOf(s, owned, box)` for any new way a held box comes back.
- **reserve (Lane R):** I didn't touch `funding()`.
- **A test name now says more than happens:** `tests/lovejoin-release-rules.test.ts`, "lets go of the wallet's other box it held in its place once its record goes, and that box comes back" (STATE-5). The box is never held now, since nothing is held before a deposit lands. Its assertions still pass. Rename it if you like; I left it.
- **Seen, not mine:** `tests/i18n-review-fixes.test.ts` (Lane D, untracked) failed once mid-edit and passed on the rerun. deep-datum's `tests/lovejoin-discovery-review-fixes.test.ts` fails 2 tests until the rebuild.

## Checks

- `npx vitest run tests/lovejoin-crediting-review-fixes.test.ts`: 10 passed, on the default and the `VITE_ENABLE_MAINNET=false` builds.
- `npx vitest run tests/lovejoin tests/sessions tests/i18n tests/words.test.ts tests/chain`:
  - default: 53 files, 820 passed, 2 skipped, 4 failed. Those are deep-datum's 2 (rebuild) and `i18n-review-fixes` 2 (Lane D mid-edit; passed on the rerun);
  - preprod: 822 passed, 2 failed (deep-datum's).
- Every other test file that touches Lovejoin (60 files, `grep -l 'LovejoinService\|lovejoin' tests/*.test.ts`, minus the sets above), run in batches of 12: all passed on both builds.
- `tests/lovejoin-1-5-0.test.ts` (the 1.5.0 gate): passed. It and its fixtures are unedited.
- `npm run typecheck`: clean.
