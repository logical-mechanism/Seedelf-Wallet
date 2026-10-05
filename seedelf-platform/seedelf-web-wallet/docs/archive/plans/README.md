# Finished plans and reviews

**A record, not maintained.** Every file here describes a chunk or a review as it was built, and much of it has been superseded since — a design replaced, an API renamed, a step done. **Don't build from it.** What still holds is in the design docs ([architecture.md](../../architecture.md), [flows.md](../../flows.md), [privacy.md](../../privacy.md), [keys-and-accounts.md](../../keys-and-accounts.md), [development.md](../../development.md)), and what's still open is in [post-release-roadmap.md](../../post-release-roadmap.md)'s *Owed* and *Kept in mind*. They moved here from `docs/plans/` on 2026-10-04, in the documentation review (chunk 22), when the owner decided `plans/` holds live specs only.

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
