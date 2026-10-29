# v-x-docs-0-impact: x-docs#0, impact and the fix

**Finding:** items 4–7 of the 1.7.0 list and five (1.7.0) *Kept in mind* entries still read as open, and two describe requests that weren't built (x-docs, filed as low).

**Verdict: partly. Severity: nit.** Confidence: high on every fact.
- Every fact holds on HEAD (`6bca8bec`).
- It isn't a defect in the tree under review:
  - The open marks are the state the owner agreed.
  - Nothing in the store build reads the roadmap.
  - #336's real requests are already stated where rule 8 and rule 3 are served: privacy.md, the policy and the code.
- What's left is a checklist for the release-prep docs commit. Its fix is right in substance, with the corrections below.

## What holds (HEAD `6bca8bec`)

- **The list** (`docs/post-release-roadmap.md`):
  - :38 item 4 is 🚧, with only "✅ The overflow half".
  - :39 item 5, :40 item 6 ("The owner's calls first: after how long it's offered, and its words") and :41 item 7 are ⬜.
- ***Kept in mind*:**
  - Still open: :373 (the way out), :374 ("a review opens only the first part's"), :378 ("`BOOTSTRAP_BACK_RESERVE` is a fixed 1.5 ₳"), :379 ("one `utxo_info` per newly listed pool") and :380 ("One batched `account_info`").
  - Every (1.7.0) entry is one of these five, or :387, :388 and :405, which are done. So the finding's list is complete.
- **No PR ticked its own item.** `git diff --stat <merge>^1 <merge>` shows no change to `post-release-roadmap.md` for #333, #335, #336 or #337. #330, #331 and #332 each changed it.
- **#338** changed only item 8 (:42) and its entry (:405–409). Its diff context still shows 5–7 at ⬜. This matches the user's note that #338 is docs only and updated item 8's text.
- **The work is on HEAD:**
  - **Item 4:** `seedelf-core/src/lovejoin/mod.rs:1744` `pub fn bootstrap_back_reserve(params: &ProtocolParameters)`, with `:1750` `.max(BOOTSTRAP_BACK_RESERVE)`. The constant (:1733) is now only its floor.
  - **Item 5:** `lovejoin-pools.ts:565` `confirmed()` calls `launched()` (:522) on `koiosAlone()` (:570). That asks `koios.launches()` (`koios.ts:926`, `tx_info`, 20 a request, `TXS_PER_REQUEST` :448). Only for an L its launch didn't register, it also asks `firstRegistrations()` (`:954`, `account_update_history`, 75 a request, `CREDENTIALS_PER_REQUEST` :442). Nothing on this path asks `utxo_info` or `account_info`.
  - **Item 6:** `lovejoin.ts:335` `TAIL_OFFER_MS = 60 * 60_000`, documented at :331–332 as "(the owner, 2026-10-28 …)". Also `handlers.ts:512` `"session-skip-collateral-mix"`, and `en.json:921` `"lj.tail.wayOut": "Bring the rest back now"`.
  - **Item 7:** `tx-view.ts:190–192` follows `partHashes`, and `TxDetail.tsx:151–164` is the stepper.
- **The deferral was agreed.**
  - #333's body says: "As agreed, the 1.7.0 list's tick waits for the release-prep docs commit."
  - The owner's memory (`versioning-lines.md`) says: "Item PRs don't tick the list (adjacent lines conflicted across #330–#332, owner hit it 2026-10-28): ticks go in one docs commit at release prep."
- **Item 2's 🚧 is right.** `gh api repos/logical-mechanism/Seedelf-Wallet/branches/main/protection/required_status_checks` gives `"contexts":[]` and `"checks":[]`.

## Can it happen in practice?

**Not through the shipped build.**
- `scripts/package.mjs` zips `dist/` only (:22, :116–118).
- No test, script or workflow reads the roadmap:
  - `words.test.ts` walks `src/` only (:12, :18–23).
  - Only `i18n.test.ts` reads `docs/`, and only `docs/i18n`.
  - `activity.test.ts` names the roadmap only in comments.
  - `web-wallet.yml` has no docs check.

**The finding's two scenarios each need a later slip:**
1. **A tick that keeps :379–380's text.** The house form strikes the old text and writes what was built: :387–388 read "✅ **1.7.0:** … ~~old~~". Even if the tick kept the text, the misstatement would sit in a planning doc's candidate list. The actual requests are stated in three places:
   - `privacy.md:200`: "the transaction that started it (`tx_info` …) and, where that didn't register L, L's registration (`account_update_history`)".
   - The policy, `privacy-policy.md:46` and `:93`.
   - The code's own comment, `lovejoin-pools.ts:516–521`.

   So rule 8 is already served where it matters.
2. **A session building a second way out from item 6.** The release-prep commit is the very next step of this gate (the lead's memory, `review-1-7-0-gate.md`). Item 6 also sits on a release list being cut now, beside #337 in `git log` and `handlers.ts:512`.

**Why nit, not low.** The brief's "low" covers a misleading doc. But this state isn't an oversight: the owner chose it, the merged PRs say so, and the finding says so too ("This is agreed … This finding is the exact list for that commit"). It's a to-do for the release-prep commit, not a defect.

**Sibling verdicts:**
- v-pr329-0, v-pr338-4 and v-x-rel-7 gave nit.
- v-x-merge-4 gave low.

**Duplicates:** pr329#1, pr338#5, x-merge#5 and x-rel F8 (v-pr329-0 also lists pr335#2 and pr336 F8). They should merge into one release-prep item.

## The fix

It's right in substance and stays within the owner's rules: no guard, no new text in the UI, and no release date or store status (rule 7; "✅ **1.7.0:**" names a version, as :387–388 do). It can't break a build or a test, since nothing reads the file. Corrections:

1. **Write the ticks last, after this review's fix rounds, against the code as fixed.** Several open findings change what items 5 and 6 do or need to say:
   - x-merge#1 (medium): #336's check against the launch's copy refusal.
   - x-merge#3: what *Bring the rest back now* does for a session brought back by hand.
   - x-merge#4: privacy.md and the new way out.
2. **Item 4's tick and :378.** Name core's `bootstrap_back_reserve(params)`, which prices the reserve as `direct_tail_reserve` does, with `BOOTSTRAP_BACK_RESERVE` now its 1.5 ₳ floor. That gives 1.5 ₳ at today's 4,310 lovelace a byte, and 1.8 ₳ at 6,465, where the cap stays 96 classic and 64 token boxes (was 68 and 51). :38 names the constant as the thing priced, which is no longer accurate.
3. **Item 6: "the owner's calls" fits only the hour.**
   - The hour is on record: `lovejoin.ts:331–332` says "the owner, 2026-10-28", the commit `aa6f5fc2` says "the owner's hour", and #337's body says "your hour".
   - Nothing records that the owner picked the words. #337 quotes them and the owner merged it, but that's acceptance, not authorship.
   - Write: "an hour (`TAIL_OFFER_MS`, the owner's call); *Bring the rest back now* (`lj.tail.wayOut`) under its privacy line (`lj.tail.privacy.wayOut`, critical)". Don't call the words the owner's unless they say so.
4. **:379–380: state the cost exactly, not "per new pool's launch".** The requests are batched. Suggested text:

   > ✅ **1.7.0:** a pool on the data layer's list that the device doesn't hold yet is kept only once Koios alone confirms it, as the holder's look does (`launched()`): its launch's `tx_info` (20 a request), and `account_update_history` (75 a request) only for an L its launch didn't register. A pool Koios can't confirm yet is asked about again at the next list, at most every 5 minutes (`REFRESH_MS`). A pool kept is never asked about again.

   Then strike the old :379 and :380 text. One ✅ entry for both is fine, since one change closed both.
5. **Item 5's rollback nuance.** The mechanism is right:
   - `confirmed()` checks only the pools in `fresh` (:568).
   - `keep()` only appends (:374–381).
   - So a launch rolled back after the check would stay kept.

   In practice it doesn't arise:
   - The data layer lists pools "as of a stable cursor" (`seedelf-data/api/src/lovejoin/routes.rs:5`), at least 200 slots back (`SETTLE_MS`'s comment, `lovejoin-pools.ts:81–86`).
   - The device checks at its own first list after that.
   - So the rollback would have to be deeper than any mainnet has had.

   The tick should say what's checked and when: "a lying server, or a launch not on chain when the device first sees the pool, is left out". It shouldn't carry over :379's "or a deep rollback" as closed in full, and it shouldn't add a new warning about rollbacks.
6. **Item 2 stays 🚧.** `main` requires no check yet (confirmed above).

## What else the fix changes

Nothing outside the roadmap:
- No code changes.
- No string changes.
- No critical key changes.
- No privacy text changes.

The commit is under `seedelf-platform/`, so the PR's *Web Wallet* check runs in full, as for any docs PR there.
