# 1.8.0's release review: the last look

Round one found 92 findings; eight fixers fixed them. Round two read the merged fixes and found 22, all low or nits; a tracer checked each low ([round2/verify.md](round2/verify.md)), and four fixers fixed them ([fix2/](fix2/)), merged by the lead with a few fixes of their own. **The last look reads what round two changed, and the docs as they'll ship.** It's the last review before the checks, the live run and the PR: what it finds either gets fixed or goes in the record as left.

## Read first

- [REVIEWBRIEF.md](REVIEWBRIEF.md)'s *The owner's calls*, *The rules this release is judged by*, *Severity* and *What to report*. They hold here.
- [R2BRIEF.md](R2BRIEF.md) and [FIX2BRIEF.md](FIX2BRIEF.md): what round two was, and the calls on it. **The owner answered four on 2026-11-06** (FIX2BRIEF's *The calls on round two*): they're settled, so not findings.
- Round two's reports in [round2/](round2/), the traces in [round2/verify.md](round2/verify.md), the fixers' reports in [fix2/](fix2/).

## The tree

- **The merged worktree:** `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/merged`, branch `review-1.8.0/merged`. Read-only for you: run no git command that changes state there.
- **Round two's code** is `git diff 4b4628e9 HEAD` there: the four lane merges (`62484474` sessions, `d124ce50` retire, `b8be83c3` screens, `faacdf98` e2e) and the lead's `4ad4dc06`.
- **The docs** are uncommitted there: every doc of the release, drafted by round one's writer and touched up by round two's (their report: [docs.md](docs.md), its *Round two* section). `git diff 1beba3fb` there, with `git status` for the new files, is the release's whole docs change.

## The parts

| Part | What it covers |
|---|---|
| **last-code** | Round two's code and tests, `git diff 4b4628e9 HEAD`. Each fix against its trace's fix (verify.md) and its finding: is it the fix the trace settled, and is anything left of the finding? Where the lanes meet: `priced`'s `held` and `collateralRoom` (sessions) beside the retired run's `recheck` (retire) beside the hub's words (screens), and the lead's three comments. Each new pin: does it fail under the mutant its lane says it kills, on the merged tree (re-run a sample, at least one a lane, by exact replacement with a sha256 restore)? Is any older test now vacuous? Traps (`rooms()` hands one on: does every caller of `rooms()`/`room()` hand it on in turn?), money (Stop's figures against the return the chain builds), requests (count them in a site's funding review, a swap's Review, Stop, a mix's review, and after a Stop of the retired run). |
| **last-docs** | Every doc of the release as it'll ship: `docs/store/privacy-policy.md` (its *Effective*, *Lovejoin's pools* and the 6 November entry: every request the code makes that 1.7.2's didn't, and when; nothing it says that the code doesn't do), `privacy.md`, `architecture.md`, `flows.md`, `lovejoin-mix-width.md`, the web wallet's `README.md`, `development.md`, `backlog.md`, `docs/store/README.md` (the listing, en, es, ja), `docs/i18n/glossary.md`, and the archived chunk-44 plan. Each sentence about the wallet's behaviour checked against the merged code (file:line). The house's words: *Seedelf*, the glossary, no release dates, no store status, short. And the translations round two changed: the es and ja values in `git diff 4b4628e9 HEAD -- extension/src/i18n/translations/`, natural and in the house's terms (their meaning is the blind round's, so judge naturalness and consistency, not meaning). |

## Your sandbox, and what you must never do

- **Your sandbox** is a git worktree at the merged head, `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/last/<your part>`, with `extension/node_modules` and `wasm/pkg` in place. Mutate and run tests there, and only there; it has the code, not the uncommitted docs, so read the docs in the merged worktree. Name scratch files with your part.
- REVIEWBRIEF.md's *Your sandbox* rules hold: targeted test files only, `--maxWorkers=2`; no network; never the data layer's binaries or `--ignored`; never open `support.ts`, the vectors, the test wallet or any `.env`; no formatter; no Playwright and no `npm run build`, `build:ext`, `tokens`, `dreps`, `lovejoin-pools`, `lovejoin-registry`, `package` or `store:images`.

## Your report

Your structured output: each finding numbered from 0 as `last-<part>#<n>` (code, docs), with its severity, where (file:line), the claim, a scenario, the evidence (a test, a mutant, or file:line against file:line), and a fix; then *covered* and *not checked*. A finding you can't show isn't one: say it under *not checked*.
