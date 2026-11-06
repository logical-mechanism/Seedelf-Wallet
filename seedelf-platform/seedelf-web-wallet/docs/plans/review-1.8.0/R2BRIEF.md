# 1.8.0's release review, round two: the reviewers' brief

Round one found 92 findings (44 clusters), and eight fixers fixed them, each in its own lane by file ownership. The lead merged the eight lanes and made a few fixes of their own at the merge. **Round two reviews the merged fixes, where the lanes meet.** A bug in one lane's fix that only shows beside another lane's is what this round exists to find.

## Read first

- **The rules:** [REVIEWBRIEF.md](REVIEWBRIEF.md)'s *The owner's calls*, *The rules this release is judged by*, *Severity* and *What to report*. They hold here too.
- **What round one found:** [FINDINGS.md](FINDINGS.md), its round-two section too.
- **What each fix changed, and how it was tested:** the fixers' reports, [fix/*.md](fix/), and their *For the lead* lists.
- **What the lead did at the merge** (on `review-1.8.0/merged`, commits after the eight merges):
  - `d188eaec`: the pins the lanes left for each other's files, applied.
  - `a990deb8`:
    - **critic#2:** Settings' Bring every box back, asked with no pool named, looks first (`lookSoon`), as Lovejoin's page does as it opens (`lovejoin.ts` `bringAllBack`). The rest of critic#2 (a restored Koios-only device doesn't list, schedule or show its boxes in a pool it doesn't know until the page opens) stays the restore's design: no look at each worker's first pool read.
    - **adapool#6:** `room()` names its pool; the default is gone.
    - **The chain lane's For the lead, 4:** Stop's dialog for a swap approved before 1.8.0 counts its boxes as its return does (`sessions.ts` `priced`'s `classic`, from `stopCost`).
    - **The retire lane's For the lead, 3:** Settings' Try again on the retired pools' stopped run asks "Bring the retired pools' boxes back now?" (`BringAllBackQuestion`'s `retired`, a new non-critical key).
  - `4b4628e9`: three older Stop tests' records, which model 1.8.0 approvals, carry the 5 ₳ `box` they were priced at; with none, a record is 1.7.2's and now capped.

## The owner's call of 2026-11-06, during this review

> "We need it to work since that if no 5 ada pool exists, or really any pool, then no mix happens. Then when it exists it uses it. Since I need the wallet to create the pool unless we create teh pool just before release which is possible too. idk. Other than that let everything run"

So: no head-start gate and no floor gate. With no pool, returns come back directly, and every screen says so truly, the connector's approval too. A pool launched later is found and used on both networks without Lovejoin's page opening.

## The tree

- **The merged branch** is `review-1.8.0/merged`, at `4b4628e9`. The base is `1beba3fb` (the release branch's prep, on `a6c94743`). `git diff 1beba3fb 4b4628e9` is everything this round reviews.
- **Line numbers** in your report are at `4b4628e9`.

## Known, so not findings unless you show them wrong

- **Not fixed, by choice:**
  - R8's `sessions.ts` half (`mixOutBuild` and `againBuild` read `epoch_params` before refusing a retired pool): a nit, unreachable from the screens.
  - critic#6 (Settings' Lovejoin row): the owner's.
  - critic#2 beyond Settings' press, as above.
- **Open, and planned:**
  - The share lane's `tailChain` sibling of P2 (a resumed collateral mix draws at build and reserves at Send). Judge it if you meet it: say whether it's worth fixing now.
  - The first unlock's bring-back has no e2e. The e2e lane found a recipe; it's planned.
- **Untested wiring, known:** `BringAllBack`'s `retired={!!bringAsk(pool, bringing).retired}` (no static render reaches its `asking` state), and `priced`'s cap on D3's `leg` at width 4.

## The lenses

| Lens | What it covers |
|---|---|
| **r2-worker** | The worker's merged code: `lovejoin.ts`, `sessions.ts`, `lovejoin-pools.ts`, `lovejoin-launch.ts`, `dapp.ts`, `handlers.ts`, `sw.ts`, `rpc.ts`. Where the lanes meet: the look (O1, critic#2) with every ask; `priced`, `collateralWanted`, `tailReserve`, `stopCost`, `lovejoinRoomNow`/`lovejoinRoomKept` read beside each other in one review; chain()'s O5 path with share's `holdTail` and P2's reservation; critic#4's cap beside O5 and P1; `retireOnce`, `bringAllBack` and the look. Count the requests one flow makes now (a double read of Koios's holder is a finding); traps; money (a fee shown that isn't paid, or paid and not shown). |
| **r2-screens** | The screens and the words: `Lovejoin.tsx` (screens' and share's edits), `Swaps.tsx` (find's and screens'), `DappApprovals.tsx`, `BringAllBack.tsx`, `Home.tsx`, `preferences.tsx`, and every changed value in `en.json`, `es.json` and `ja.json`, the non-critical ones too. Is each screen true in each state the owner's call makes reachable (no pool, a pool found later, a pool under its floor, the retired pools' run going or stopped)? One short line per button; the glossary; *Seedelf*. es and ja read natural and match their English. |
| **r2-tests** | The tests, by mutation, **on the merged tree**: run each lane's mutants again (their specs are in the scratchpad: `find-lane/`, `chain-work/`, `share-lane/`, `retire-fix/`, `connector-scripts/`, `screens-fix/`, `v44a-logs/`) where a merge may have made a test vacuous, and mutate where two lanes' code meets, the lead's fixes included. A fix no test catches is an untested guard. |
| **r2-critic** | Completeness, after the rest: what nobody checked. Every owner's call against the merged code; each fixer's claims against the code (a report that says more than the code does); every state's buttons; what the privacy policy now owes (every new request and when it's made); the live preprod run's plan (what it must cover). |

## Your sandbox, and what you must never do

- **Your sandbox** is a git worktree at `4b4628e9`: `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/<your lens>`, with `extension/node_modules` and `wasm/pkg` copied in. Read, mutate, add scratch tests and run tests there, and only there. Name scratch files with your lens.
- **Read-only for you:** the main tree, and the merged worktree (`…/scratchpad/merged`), where the docs writer is working. Run no git command that changes state anywhere.
- **Every other rule** of REVIEWBRIEF.md's *Your sandbox* holds: targeted test files only, `--maxWorkers=2` (seven agents share 12 CPUs); no network; never the data layer's binaries or `--ignored`; never open `support.ts`, the vectors, the test wallet or any `.env`; no formatter; no Playwright and no `npm run build`, `build:ext`, `tokens`, `dreps`, `lovejoin-pools`, `lovejoin-registry`, `package` or `store:images`.

## Your report

Return it as your structured output: each finding numbered from 0 as `<lens>#<n>`, then *covered*, then *not checked*. Also write it as Markdown to `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/seedelf-platform/seedelf-web-wallet/docs/plans/review-1.8.0/round2/<your lens>.md` if the harness lets you; if it refuses, the structured output is enough, and the lead writes the file.
