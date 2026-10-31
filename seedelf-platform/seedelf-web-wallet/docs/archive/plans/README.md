# Finished plans and reviews

**A record, not maintained.** Every file here describes a chunk or a review as it was built, and much of it has been superseded since — a design replaced, an API renamed, a step done. **Don't build from it.** What still holds is in the design docs ([architecture.md](../../architecture.md), [flows.md](../../flows.md), [privacy.md](../../privacy.md), [keys-and-accounts.md](../../keys-and-accounts.md), [development.md](../../development.md)), and what's still open is a line in [backlog.md](../../backlog.md). They moved here from `docs/plans/` on 2026-10-04, in the documentation review (chunk 22), when the owner decided `plans/` holds live specs only. Chunk 23's two usability reviews joined them on 2026-10-31, when the roadmaps moved to [../](../).

**Why keep them:** the reasoning. A design doc says what the wallet does; the plan says why, what was tried first, and what the owner decided. Line numbers inside them are as of when each was written.

## The reviews' IDs

The code and the tests cite the reviews' findings by ID about 800 times, and the design docs more, so **these files are never renumbered or rewritten**:

| Review | IDs | Cited as |
|---|---|---|
| [crypto-review.md](crypto-review.md) (2026-09-25) | its *Not fixed* list, by number | "crypto review, *Not fixed* #1" (#3 has three items under it) |
| [launch-review.md](launch-review.md) (2026-09-26) | M1–M6, H1–H9, #10–#62; its *Still open* list, by number | "launch review #32"; "launch review, *Still open* #2" |
| the launch review's second, adversarial round (2026-09-27) | `<area>-<n>`, areas `sessions`, `lovejoin`, `money-submit`, `network-dapp`, `core-ui` | "final review sessions-1". **These are listed in no file:** each fix commit names its IDs, so `git log --grep='final review sessions-1'` finds one. Not the same as the independent review's *Final review*. |
| [privacy-review.md](privacy-review.md) (2026-09-27) | section numbers, §2.1–§6 | "privacy review §2.3"; `tests/screens.test.ts` names its tests by them |
| [independent-review.md](independent-review.md) (2026-09-27/28) | H, M, L and D findings; its *Final review*, F1–F13 | "independent review M5" |
| [usability-review.md](usability-review.md) (chunk 23, round two) | findings by screen or area, `FR-1`, `ST-4`, `HM-3`, `DX-8`, … | "the usability review's DX-8" |
| [blind-task-usability-test.md](blind-task-usability-test.md) (chunk 23) | its tasks `T01`–`T20` (`T20a`), exploratory runs `E01`–`E05`, §4's moments, §9's ten changes, Appendix B's rows | "blind test §9"; "blind test T17" |
| [chunk-34-token-pools.md](chunk-34-token-pools.md)'s reviews (2026-10-18/19) | the rehearsal's `R0`–`R12`; the release review of #308–#320, `MONEY-n`, `PRIV-n`, `DATA-n`, `UI-n`, `STATE-n`; the merged fixes' review, `MERGED-1`–`MERGED-5`; fix round two's review, `R2-1`–`R2-4`, and its last review, `R3-1`–`R3-3`; the last review's `WORKER-n`, `SCREENS-n`, `CROSS-n`, `PRIVACY-n`, `I18N-DOCS-n`; the owner's calls 34–36 | "1.6.0's preprod rehearsal, R3"; "the merged fixes' review, MERGED-1"; "fix round two's last review, R3-1". **Its `R3-1`–`R3-3` share their names with 1.6.0's review of the fixes (below):** this plan's are a copy pool's read (`stillIn`), a copy's own reason (`LovejoinUnusable.again`) and architecture.md's rows, and a bare one in the code is whichever its code is about. Its *Session 12* is 1.6.0's release review, below |
| [review-1.6.0.md](review-1.6.0.md) (2026-10-24/26) | `316#0`, `318-rust#0`, `x-privacy#1`, …; the review of the fixes `R3-1`–`R3-31`; its leftovers `L1`–`L6`; `LIVE-1`; the fixers by name (`fx-promise`) | "1.6.0's release review, 318-rust#0"; "1.6.0's review of the fixes, R3-9". **Their full text is in git, not here:** that file's *The IDs* says where, at `7e2d89ed` |
