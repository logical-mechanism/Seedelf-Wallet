# v-pr329-0-impact: pr329#0, impact and the fix

**Finding:** 1.7.0's list still shows items 4–7 open, though #333, #335, #336 and #337 landed them (pr329, rated low).

**Verdict:** partly. The facts hold, but this isn't a defect: the ticks were held back on purpose. **Severity: nit**, as a checklist item for the release-prep docs commit, not low.

## What holds (HEAD `6bca8bec`)

- **The list in `docs/post-release-roadmap.md`:**
  - :38 item 4 is 🚧, with only the overflow half ticked.
  - :39 item 5, :40 item 6 ("The owner's calls first: after how long it's offered, and its words") and :41 item 7 are ⬜.
  - :36 item 2 is 🚧, and :37 item 3 and :42 item 8 are ✅.
- **Five *Kept in mind* entries** still read as plans, with no ✅: :373, :374, :378, :379 ("one `utxo_info` per newly listed pool") and :380 ("One batched `account_info`").
- **None of #333, #335, #336 or #337 touched the roadmap.** `git diff --stat <merge>^1 <merge>` lists no `post-release-roadmap.md` for any of them.
- **#338 changed only item 8** and its entry. Its diff context still shows items 5–7 at ⬜. This matches the user's note: #338 is a docs-only PR that updated item 8's text.
- **The work itself is on HEAD:**
  - Item 4: `seedelf-core/src/lovejoin/mod.rs:1744–1750` `bootstrap_back_reserve(params)`, with `BOOTSTRAP_BACK_RESERVE` (:1733) now its floor.
  - Item 5: `lovejoin-pools.ts:565` `confirmed()` → `launched()` (:522). That calls `koios.ts:926` `launches` (`tx_info`) and `:954` `firstRegistrations` (`account_update_history`). The policy entry is `privacy-policy.md:93`.
  - Item 6: `lovejoin.ts:335` `TAIL_OFFER_MS = 60 * 60_000` ("the owner, 2026-10-28"), and `handlers.ts:512` `"session-skip-collateral-mix"`.
  - Item 7: `tx-view.ts:190–192` follows `partHashes`, and `TxDetail.tsx:151–164` is the stepper.
- **Item 2's 🚧 is right.** `gh api repos/logical-mechanism/Seedelf-Wallet/branches/main` gives `"required_status_checks":{"checks":[],"contexts":[]}`.

## Why it's not a defect

**The owner decided it.** After adjacent lines conflicted across #330–#332, the owner ruled on 2026-10-28 that item PRs don't tick the list.
- The user's memory, `versioning-lines.md`: "Item PRs don't tick the list (adjacent lines conflicted across #330–#332, owner hit it 2026-10-28): ticks go in one docs commit at release prep."
- #333's description: "As agreed, the 1.7.0 list's tick waits for the release-prep docs commit."
- #338 ticking only item 8 is consistent with that rule.
- Four other reviewers saw the same state, and three of them recorded it as deliberate: pr335#2, pr336 F8 (rated nit), pr338 #5 ("deliberate, see #333") and x-docs#1 ("This is agreed").

**No user, site or attacker can reach it.**
- The roadmap is a repo doc and isn't in the store build. `dist/` holds no docs (`grep -rl "Kept in mind\|post-release-roadmap" dist` finds nothing).
- No test reads it. `words.test.ts:12` scans only `../src`.

**The finding's harm scenarios can't happen in practice.**
- **"The release-prep commit reads ⬜ and builds a second way out":** that commit is where the ticks go, by the owner's rule. It's written on this branch during this gate, by the lead whose brief already lists each PR as landing its item ("Item 7", "Item 5", "Item 6", "Item 4, its other half").
- **"Cuts 1.7.0 believing four items unbuilt":** the same lead cuts the version, from that same table.
- **"A later session picks item 6 from *Kept in mind*":** that would need a session before the release-prep commit, which comes first. Even then, the code (`session-skip-collateral-mix`) answers in one grep.

## The fix: right place, a few corrections

The finding's fix sits where it belongs: one docs commit on `web-wallet/release-1.7.0`. It's docs only and within every rule. No guard or privacy note is touched, and the "✅ **1.7.0:**" prefix names a version, not a date or a store status, as :387–388 do. These corrections apply:

1. **Write it last, after this review's fix rounds.** Each ✅ should say what the code does then. Open findings on these same items could change the behaviour or the words: pr336 F1–F7, pr337 #1–#4, pr333 #1–#3.
2. **Rewrite :379–380 to the requests that were built, not just strike them.** By rule 8, each feature states its Koios cost.
   - One `tx_info` for each new pool's launch.
   - `account_update_history` only for an L that its launch didn't register.
   - Both on mainnet's data-layer path, and only for pools new to the device.
   - **Don't claim it closes a later rollback.** `confirmed()` (`lovejoin-pools.ts:565–583`) asks only about pools not kept yet (`if (!fresh.length) return found;`). A launch rolled back after its first confirmation stays kept, so the old entry's "or a deep rollback" is closed only at first sight. x-docs#1 says the same.
3. **Item 4's ✅:** keep the overflow half's caveat, that seedelf-wasm's own crate isn't checked. Name `bootstrap_back_reserve(params)`, since `BOOTSTRAP_BACK_RESERVE` is now only its floor.
4. **Item 6's ✅:** record the hour as the owner's (`TAIL_OFFER_MS`, "the owner, 2026-10-28"). Item 6 also left "its words" to the owner. Nothing records the owner approving `lj.tail.privacy.wayOut` beyond the merge (pr329's own *Not checked* says so). Don't claim it, or ask.
5. **Item 5's ✅:** don't quote the policy's date. pr336 F9 and x-docs#11 leave the *Effective* date to the owner, who set 1.6.0's at release, so a quoted "28 October 2026" could go stale. "With its privacy policy entry" is enough.
6. **Drop the version-bump line from this finding.** It's `development.md`'s release step 1 (:167–171, :279), already planned for this branch, and not a docs fix. `package.json:3` reads `"version": "1.6.0"` today, as it should before the bump.
7. **Item 2 stays 🚧,** as the finding says.
8. **Fold the duplicates into one release-prep item:** pr335#2, pr336 F8, pr337 #5 (its roadmap line), pr338 #5 and x-docs#1.

**What else the fix would change or break:** nothing shipped, and no test. Ticking in separate fix PRs instead would bring back the adjacent-line conflicts the owner's rule exists to avoid.

## Trace

- `git diff --stat` of each merge, d67f8054…6bca8bec.
- `git diff 6bca8bec^1 6bca8bec -- docs/post-release-roadmap.md`, and the roadmap diffs of #330, #331 and #332 (the strike convention).
- `gh pr view` of 333, 335, 336 and 337.
- `gh api .../branches/main`, read only.
- A grep of `dist/`, and reads of the code lines above.
- No scratch test was needed, and no file was created besides this report.

**Confidence:** high.
