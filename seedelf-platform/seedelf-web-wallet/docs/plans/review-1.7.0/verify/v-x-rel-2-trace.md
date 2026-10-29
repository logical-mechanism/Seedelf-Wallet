# v-x-rel-2-trace: x-rel#2, item 2's owner step won't gate the release PR

**Verdict: partly. Severity: low** (the finding says medium). Confidence: high.

Checked on HEAD `6bca8bec`, with read-only `gh api` GETs and read-only git, on 2026-10-28.

- **The core holds, to the second.** Item 2's owner step, as #331 and the roadmap word it, adds *Web Wallet required* to a rule the owner bypasses on every merge. Two texts on HEAD say `main` already requires the job, and it requires no check at all.
- **The scenario's harm is narrower than written.** Part 1 of the release procedure runs `npm test`, `VITE_ENABLE_MAINNET=false npm test` and `npm run e2e` on the release branch, after the refreshes are committed and before the PR opens (development.md:189-195). So:
  - the preprod-only Vitest build does run outside CI;
  - F4's mainnet grid, which x-rel says fails e2e on both builds, meets part 1's dev-build e2e first.

  On the release PR, only these are left to CI alone: e2e:data, `typecheck`, fmt and clippy, plus the store build's e2e before the merge. Part 2 runs that e2e after the merge, but before the upload.

## What holds (each checked)

1. **No check is required today.**
   - `branches/main/protection` gives `required_status_checks {"strict":true,"contexts":[],"checks":[]}`, `required_approving_review_count: 1` and `enforce_admins {"enabled":false}`.
   - `rulesets?includes_parents=true` and `rules/branches/main` both give `[]`.
   - `branches/main` gives `"enforcement_level":"non_admins"`. That is GitHub's own statement that required checks bind only non-admins.
   - The owner's permission is `admin`.
2. **Every merge was an admin bypass.** In a GraphQL read, #325 to #338 were all authored and merged by `logicalmechanism`, with `reviewDecision: REVIEW_REQUIRED` and 0 reviews. One approval is required, so each merge bypassed protection. GitHub's documentation:
   - "By default, the restrictions of a branch protection rule do not apply to people with admin permissions to the repository" (about-protected-branches).
   - `enforce_admins`: "Set to true to enforce required status checks for repository administrators" (REST, branch protection).
   - `gh pr merge --admin`: "Use administrator privileges to merge a pull request that does not meet requirements" (`gh` 2.46 help).

   Classic protection has one bypass for the whole rule. Requiring the check therefore changes nothing on the owner's path.
3. **The step as written names no bypass.** #331's body says "**After merging (yours):** require **Web Wallet required** on `main`, under Settings → Branches → main → *Require status checks to pass*." Roadmap:36 says "then the owner turns the required check on in the branch's protection … left, the owner's: requiring it." `git grep` finds no mention of `enforce_admins` or the bypass anywhere in the tree.
4. **12 of 14 PRs merged mid-check.** Every pair of times in the finding matches the check runs on each PR's head, to the second:
   - #326, #328 to #338: mid-check, from 8 to 58 minutes before the check finished.
   - #325 waited. #327 had no Web Wallet run (contracts only, before #331).
   - Every run was `run_attempt: 1`, so no earlier attempt had finished green.
   - development.md:15's "Merge only once its check is green on every step" was already on `main` (`22acd30e`, an ancestor of `a5fc6576`) before all 12.
   - The last release PR did the same: #324 merged at 02:44:10Z, and its last head's check finished at 03:01:02Z.
5. **The two texts claim a requirement that doesn't exist.**
   - development.md:13: "That job is the one `main`'s branch protection requires".
   - web-wallet.yml:135: "The one check main requires (its branch protection names *Web Wallet required*…)".
   - Both are from `c5d19d3f` (#331). Roadmap:36 (🚧) is consistent with the truth; these two are not.
6. **#338's run did test HEAD's tree, and nobody waited for it.**
   - Job 123140775452's log: "HEAD is now at 85f5070 Merge 62be5bc4d688… into 11e249d2982a…".
   - `commits/85f5070` has tree `8bd149a83f3a…`, which is both `6bca8bec^{tree}` and `62be5bc4^{tree}`. `62be5bc4`'s only parent is `11e249d2`.
   - All 19 steps passed.
   - At the merge (22:55:43Z), the job was in step 15, the preprod-only Vitest build. e2e, e2e:data and the store e2e all ran after it.
   - **The user's note fits this.** #338 is docs-only: one file, `post-release-roadmap.md`, 6+/6−. Its run still took the full check because the docs live under `seedelf-platform/` (web-wallet.yml:28's prefix), which is how a docs PR came to cover the combined tree. That doesn't change the verdict.

## What's narrower: the scenario's last two sentences

> "Part 2's `npm run e2e` would catch it only on the store build, and only after the merge. e2e:data and the preprod-only Vitest build run nowhere but CI."

- **Part 1 runs on the release branch:** `npm run build`, `npm test`, `VITE_ENABLE_MAINNET=false npm test` and `npm run e2e` (development.md:191-195). They run on the committed bump and refreshes (":189 … commit them together. Then the checks"), before ":201 … open the PR into `main`".
- **Checklist item 1** (development.md:115), which part 1 says to complete, adds the WebAssembly tests.
- **So the half about the preprod-only build is false,** and F4's grid failure isn't one CI alone would catch.
- **What part 1 and the checklist lack:** `npm run e2e:data`, `npm run typecheck` (`npm run build` is `build:wasm && vite build`, with no `tsc`), `cargo fmt` and `cargo clippy`. Those, and the store e2e before the merge, are what a mid-check merge of the release PR leaves to luck.
- e2e:data doesn't touch the Lovejoin hub (`e2e/data-layer.spec.ts` has no `lovejoin`), so F4 isn't its failure either.
- Part 1 is also discipline, not enforcement. Still, the procedure as written does cover the example the scenario gives.

## Why low, not medium

- **Nothing in the shipped build is wrong.** No money, privacy or user flow is involved. The defect is a planned settings step that can't do its job, plus two misleading texts.
- **For 1.7.0:** HEAD's exact tree already has a complete green run (§6). The release PR then adds only the bump, the lists and the head start, which part 1 checks locally first.
- **Between releases** the gap is real and certain: 12 of 14 merges here, #323's red `main` in 1.6.0. Part 1 is the backstop there for everything it runs. That #323 failed at *Extension unit tests* is in development.md:15.
- **The case for medium** (pr331#0's impact verifier): the step's failure is certain, it defeats a list item the owner chose, and its precedent was a high bug. That is a fair owner's weighing for the process. For the release gate, the local checks hold most of it.

## Repro

`zz-review-v-x-rel-2-trace-1.sh` lived in my scratchpad, outside the tree, and is deleted. It:
- read the live protection, rulesets, branch rules and enforcement level;
- modelled the step as #331 words it (contexts + *Web Wallet required*, nothing else) and asked whether it binds an admin's merge;
- counted mid-check merges from the saved GraphQL read;
- grepped HEAD's two texts;
- listed which of CI's steps part 1 runs.

Its output, which **fails on HEAD as the finding predicts**:

```
A. live protection:
   contexts=[] checks=[] strict=True
   enforce_admins=False approvals=1
   enforcement_level=non_admins rulesets=0 rules_on_main=0 owner=admin
   after the step: contexts=['Web Wallet required']; binds an admin's merge: False; owner must bypass anyway (reviews): True
B. merge time vs the PR head's Web Wallet check:
   merged mid-check: 12 of 14: [326, 328, 329, 330, 331, 332, 333, 334, 335, 336, 337, 338]
C. HEAD's texts claiming the requirement:
   development.md:13: That job is the one `main`'s branch protection requires
   web-wallet.yml:135: The one check main requires
   roadmap:36 (consistent): left, the owner's: requiring it
D. the scenario's 'run nowhere but CI': which CI steps part 1 runs on the release branch, before the PR
   part 1 runs:     cargo test --workspace --locked
   part 1 runs:     npm test
   part 1 runs:     VITE_ENABLE_MAINNET=false npm test
   part 1 runs:     npm run e2e
   part 1 lacks:    npm run e2e:data
   part 1 lacks:    npm run typecheck
   part 1 lacks:    cargo fmt
   part 1 lacks:    cargo clippy
   checklist item 1 (development.md:115, which part 1 says to complete) runs: the WASM tests
FAIL: the owner's step as written leaves every merge bypassable (x-rel#2's core holds)
exit=1
```

## Fix advice

1. **The step must bind the owner's own merges.** Item 2's text and #331's instruction need to say so, or ticking item 2 means nothing. Word it as "require it in a rule your own merges can't bypass".
2. **Of the finding's two options, (b) is gentler.** A ruleset requiring *Web Wallet required*, with no bypass actors, keeps the one-approval rule for the other writer (`quinn-logicalmechanism`, write). Option (a) sets approvals to 0 for everyone.
   - Either way, an enforced "up to date" means each PR re-runs its roughly one-hour check after any other merge. This range merged #330 to #332 within four minutes, and #336 and #337 fifteen seconds apart.
   - That cost is also what makes `main`'s tree tested as one. Strict or not is the owner's call.
3. **The finding's test fits (a) only.** Under (b), the classic rule's bypass box will likely still show, for the review. The test there is that ticking it does not merge while the check is pending. Not verified: it needs a write.
4. **Until the owner's step lands,** development.md:13 and web-wallet.yml:135 should read "is the one `main` is to require (roadmap item 2)".
5. **The scenario's correction, for the report:** part 1 runs e2e and both Vitest builds before the PR. CI alone covers e2e:data, typecheck, fmt and clippy, and the store e2e before the merge.
6. **My idea, the owner's call:** add `npm run typecheck` and `npm run e2e:data` to part 1's list. Then a mid-check merge of the release PR leaves only lint to CI. It's a release-checklist line, not a wallet guard.

## Not checked

- I didn't try a merge under (a) or (b): both need writes. How the bypass and a ruleset combine comes from GitHub's docs and the API's `enforcement_level`.
- The protection's history needs the audit log. The finding assumes, as I do, that the one-approval rule stood at each merge. All 14 merges show `REVIEW_REQUIRED` with 0 reviews either way.
- No scratch file of mine remains in the tree. The scratchpad copies (the script, the GraphQL JSON and the job log) are deleted.
