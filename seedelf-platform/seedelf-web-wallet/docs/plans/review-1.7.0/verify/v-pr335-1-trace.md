# v-pr335-1-trace: pr335#1, the 1.7.0 list's item 7 and the view's descriptions

**Verdict: partly. Severity: nit.**

The facts are true on HEAD, but the stale ticks are on purpose. The owner agreed that item PRs don't tick the list, and that one docs commit at release prep does it. Release prep hasn't happened yet, since this review is the gate before packaging. So #335 left out nothing it was meant to do. Two smaller things are left: a list for that commit to cover, and a docs nit in the view's own paragraphs.

## What's true on HEAD

- `docs/post-release-roadmap.md:41`: `7. ⬜ **Transaction details for every part** of a payment in parts.`
- `docs/post-release-roadmap.md:374`: `- **Transaction details for every part (1.7.0)** of a payment in parts: a review opens only the first part's (321-parts-worker#5; …)`.
- `git diff --stat <merge>^1 <merge> -- docs/post-release-roadmap.md`:
  - **Empty** for b2c3940f (#333), 0bad0d52 (#335), 473b7f1a (#336) and 11e249d2 (#337).
  - **Not empty** for 81397dc4 (#330), 3b32b92e (#331) and 4610555a (#332), for ae610284 (#334, which added item 8) and for 6bca8bec (#338, which ticked item 8).
- Item 7 really is done on HEAD:
  - `tx-view.ts` follows `partHashes` (`partOf(record, wanted)`, then `partKey(key, part)`).
  - `TxDetail.tsx` has the stepper (`tx.partOf`).
  - The five reviews pass `parts`: Transfer:236, Withdraw:223, Swaps:935, Lovejoin:3075 and DappApprovals:772.

## Why it isn't a defect

- **#330–#332 ticked lines next to each other**, 36, 37 and 38 in the list and 386 and 387 under *Kept in mind*. They merged between 16:22 and 16:26 UTC on 2026-10-28 and conflicted.
- **The owner's agreement:** the project memory (`versioning-lines.md`) says: "Item PRs don't tick the list (adjacent lines conflicted across #330–#332, owner hit it 2026-10-28): ticks go in one docs commit at release prep."
- **#333 cites it.** It was opened at 16:47 UTC, and its description says: "As agreed, the 1.7.0 list's tick waits for the release-prep docs commit."
- **The later PRs followed it.** #335 was opened at 17:02 and merged at 17:14, and #336 and #337 came after it. None of the three touches the list.
- **#338 is not an exception.** It is item 8's own docs PR (the user: "a pure docs pr that updated the item 8 text"). The record is all that item delivers, since its branch stays unmerged.
- **So the scenario can't happen as described.** The owner packaging 1.7.0 makes the ticks commit as part of release prep, by their own call, and the next session loads that memory.

## What's left

1. **A list for the release-prep docs commit.** Nothing in the tree says the ticks wait; only #333's description and the memory do. The commit has to cover:
   - Item 4, its Bootstrap half (#333). The overflow half is ticked already.
   - Items 5 (#336), 6 (#337) and 7 (#335).
   - The *Kept in mind* bullets at lines 373 (item 6), 374 (item 7), 378 (item 4's Bootstrap half), and 379 and 380 (item 5's two). Mark each as `✅ 1.7.0:` and strike the old text, the way #330 and #332 did.
   - Item 2 stays 🚧 until the owner requires the check.
2. **Nit: the view's own paragraphs don't mention the stepper.** These are architecture.md:211 (the `tx-view.ts` paragraph) and flows.md:254–276 (*Read the transaction*), both written in 1.3.0 (`c853038e`). #335 described the stepper in architecture.md's storage-table row (line 427) and in flows.md:369 (Send in parts). Swap fundings (flows.md:473) and mix fundings (flows.md:514) point to Send's parts behaviour.
   - Nearly everything in the two view paragraphs is still true.
   - **One sentence is stale:** flows.md:272 says "A mix from the private balance is its one funding transaction". Since 1.6.0, a mix's funding can go in parts (flows.md:514: "Too much for one transaction, a mix's funding goes in parts"), and since #335 that review steps through every part (Lovejoin.tsx:3075 passes `parts={review.summary.parts}`). The code comment above that line says the same thing (Lovejoin.tsx:3071: "A mix from the private balance is this one transaction"). Both are older than #335, and neither says anything wrong about money or privacy.

## What decided it

- **A scratch test,** `extension/tests/zz-review-v-pr335-1-trace-1.test.ts`, now deleted. It read the roadmap, `tx-view.ts` and `TxDetail.tsx` on HEAD:
  - The premise (the feature is on HEAD) passes.
  - "item 7 is ticked" fails: it found `7. ⬜ **Transaction details for every part** of a payment in parts.`
  - "the Kept-in-mind bullet no longer says the gap is open" fails, on line 374.
- **#335's own tests** pass on HEAD: `npx vitest run tests/parts-send-review-fixes.test.ts tests/tx-view-screen.test.ts` gave 78 passed in 97.6 s.

## Fix advice

- **Don't tick the list in a review fix round.** Do it in the agreed release-prep docs commit, with the list in point 1.
- **The doc clauses are optional,** and can go in the same commit:
  - flows.md:272: "…is its funding transaction, or its funding's parts, which the view steps through".
  - architecture.md:211: "…and a payment in parts' later parts under `<key>.<i>`, by the first's `partHashes`".
  - Lovejoin.tsx:3071's comment could follow; that is `src/` and not for a reviewer to edit.
