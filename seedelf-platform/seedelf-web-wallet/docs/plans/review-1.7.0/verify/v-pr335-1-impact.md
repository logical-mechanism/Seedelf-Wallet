# v-pr335-1-impact: pr335#1, the 1.7.0 list and *Kept in mind* still show item 7 open

**Verdict: partly. Severity: nit** (the finding says low).

## What holds

The facts are right on HEAD (`6bca8bec`):
- `post-release-roadmap.md:41`: `7. ⬜ **Transaction details for every part** of a payment in parts.`
- `post-release-roadmap.md:374`: "a review opens only the first part's (321-parts-worker#5; Session 9's *parts-details-first-only*)". That is false since #335.
- Items 4 (the Bootstrap half), 5 and 6 are in the same state (`:38-40`), and so are their entries at `:373` and `:378-380`.
- `git diff --stat <merge>^1 <merge> -- docs/post-release-roadmap.md` is empty for #333 (`b2c3940f`), #335 (`0bad0d52`), #336 (`473b7f1a`) and #337 (`11e249d2`). It isn't empty for #330, #331 and #332, and #338 changed only item 8 (`:42`, `:405-409`).

The ✅ is earned. `keepParts` (`script-spend.ts:562-566`) puts `partHashes` on the first part and each later part under `partKey(key, i)`. All five keys that keep parts are in `BUILT_KEYS` (`tx-view.ts:79-100`): `SESSION_TRANSFER` and `SESSION_WITHDRAW` (`transfer.ts:158`, `withdraw.ts:144`), and `SESSION_OUT`, `SESSION_SITE_OUT` and `SESSION_MIX_OUT` (`sessions.ts:1911`, `:1958`, `:2134`). `txView` follows `partOf(record, wanted)` to `partKey(key, part)` (`tx-view.ts:156-162`). The five reviews pass `parts=` to `TxDetailButton`: `Transfer.tsx:236`, `Withdraw.tsx:223`, `Swaps.tsx:935`, `Lovejoin.tsx:3075` and `DappApprovals.tsx:772`.

## Why it isn't a low

**The missing ticks follow the owner's process.**
- #333's description: "**As agreed, the 1.7.0 list's tick waits for the release-prep docs commit.**"
- The owner's memory (`versioning-lines.md`, 2026-10-28): "Item PRs don't tick the list (adjacent lines conflicted across #330–#332, owner hit it 2026-10-28): ticks go in one docs commit at release prep."
- #330, #331 and #332 each changed one of lines 36 to 38 and merged within four minutes. That conflict is why the rule exists. So "#333, #335, #336 and #337 didn't" describes the rule working.
- #338 agrees: it branched from `11e249d2`, after all four had merged, and still ticked only its own item.

**Nobody reaches it in practice.**
- `post-release-roadmap.md` isn't in the store build, so no user, site or attacker sees it.
- Its readers are the owner, who set the rule, and the release-prep session, whose job is to tick the list. Packaging comes after that session.
- The scenario happens only if the release-prep commit misses an entry. That makes this a checklist item for that commit, not a defect of #335.

**The design-doc half is optional and not wrong.**
- `architecture.md:211` (the tx-view paragraph) and flows.md's *Read the transaction* (`:254`) say nothing false. They just don't mention the stepper.
- The two places that should say it already do. The storage row (`architecture.md:427`): "where the transaction view finds each (`tx-view.ts`, 1.7.0)". Send in parts (`flows.md:369`): "its **Transaction details** steps through every one ("Transaction 1 of 2", 1.7.0: it opened only the first's)".
- The funding-in-parts lines (`flows.md:473`, `:492`, `:514`) say "as private Send's do" or "as a swap's does", so they inherit that description.
- No other live doc says only the first part opens: a grep of `docs/`, excluding the archive and this review, finds only `:374`.

## Corrections to the fix

1. **Do it in the one release-prep docs commit, not as a fix per finding.**
   - Separate edits to lines 38 to 41 (this finding's item 7, pr336's item 5, pr337's item 6, pr333's item 4) would bring back the adjacent-line conflicts the owner's rule avoids.
   - x-docs#1, pr338#5, x-merge#5 and pr336's and pr337's notes carry the same list. Merge them into one entry.
2. **Strike in place, don't drop.**
   - Use the form of `:387-388`, as #330 and #332 did: "✅ **1.7.0:** <what it did>. ~~<the old entry>~~".
   - This keeps the review's IDs (321-parts-worker#5, *parts-details-first-only*) findable, which the brief's *The IDs* depends on.
3. **Item 7's tick should state its Koios cost** (rule 8), and the cost is nothing. For example: "7. ✅ **Transaction details for every part** of a payment in parts: a stepper in the view ("Transaction 1 of 2") on the five reviews that can go in parts, `tx-view.ts` following `partHashes` to each part's own key, from session storage alone (no Koios)."
4. **"Items 4's other half, 5 and 6 need the same" isn't quite enough.**
   - **Item 5:** `:379` ("one `utxo_info` per newly listed pool") and `:380` ("One batched `account_info`") name requests that were never built. Its ✅ text must state #336's requests: "One `tx_info` request for every launch, and one `account_update_history` for the L its launch didn't register" (`lovejoin-pools.ts:516-520`).
   - **Item 6:** its tick records the owner's calls: an hour (`TAIL_OFFER_MS`) and *Bring the rest back now*.
   - **Item 2:** stays 🚧.
5. **The design-doc clauses are optional (nit) and harmless.** If they're added, one clause each:
   - `architecture.md:211`, after "(a session's return keeps its chain inside it; Bring everything back keeps a list)": "; a payment in parts' later parts by the first's `partHashes`, each under `<key>.<i>`".
   - flows.md, the "It opens a modal of its own" bullet: "A payment in parts steps through its transactions ("Transaction 1 of 2")."

## What the fix changes or breaks

- **Nothing in tests or links.** It's docs only, and no test reads these three files: `words.test.ts` scans `src/` only, and the i18n tests read `docs/i18n/`. No heading changes, so no anchor breaks.
- **Rule 7 holds:** "✅ **1.7.0:**" names a version, not a release date or the store's status.
- **No privacy note or Koios statement is lost,** as long as point 4 above is followed.

## Repro

All read-only, no scratch test needed:
- `git diff --stat <merge>^1 <merge> -- …/post-release-roadmap.md` for each merge from #325 to #338: empty for #333, #335, #336 and #337.
- `gh pr view 333 --json body`: "As agreed, the 1.7.0 list's tick waits for the release-prep docs commit."
- `git merge-base 62be5bc4 11e249d2` returns `11e249d2`, so #338 was built on top of all four.
- `git diff 0bad0d52^1 0bad0d52 -- docs/`: #335 changed only the storage row and Send in parts.
- A grep of the live docs for "first part" or "only the first" finds only `post-release-roadmap.md:374`.

No scratch files were made.
