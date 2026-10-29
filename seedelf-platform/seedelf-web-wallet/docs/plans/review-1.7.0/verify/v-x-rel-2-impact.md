# v-x-rel-2-impact: x-rel#2, item 2's owner step won't gate the release PR

Verifier's job: impact and the fix. HEAD `6bca8bec`. Everything here was read-only: `gh api` GETs, `gh pr view`, `gh run view`, git reads. No scratch files were written.

## Verdict

**Partly. Severity: low**, down from medium. The settings choice is an **owner-call**.

- Every fact holds on the live repo.
- The gap is certain in practice. Required as #331's text says, the check binds no one who merges today.
- But it has no route into the store build. HEAD's exact tree already passed a full CI run. The release procedure also runs the suites locally before the PR (part 1) and on the store build before the upload (part 2).
- The scenario overstates what only CI catches. Its example, F4's mainnet grid, would be caught before the PR is opened.
- **Duplicate of pr331#0** (`verify/v-pr331-0-impact.md`, rated medium there). File them as one item.

## The facts, re-checked

- **`gh api repos/logical-mechanism/Seedelf-Wallet/branches/main/protection`:**
  - `required_status_checks {strict: true, contexts: [], checks: []}`
  - `required_approving_review_count: 1`
  - `enforce_admins.enabled: false`
- **Rulesets:** `…/rulesets` and `…/rules/branches/main` both return `[]`.
- **`…/branches/main`** shows `enforcement_level: "non_admins"`. That is the API's own statement that admins aren't held to the check rule.
- **#325 to #338:** each one has `reviewDecision: REVIEW_REQUIRED` and 0 reviews. The owner wrote and merged every one, so every merge was an admin bypass.
- **The other writer:** `quinn-logicalmechanism`, role `write`. They could approve, but never did in this range.
- **Merged before their own Web Wallet check finished:** 12 of 14, exactly as listed: #326 and #328 to #338.
  - #325 merged after its check went green.
  - #327 had no Web Wallet run. It is contracts only, under the pre-#331 path filter.
  - The checks take 39 to 67 minutes, docs PRs included.
- **The rule was already written.** "Merge only once its check is green" is in `development.md` at `babb8e76` (line 15 then and now). So all 12 merged against a written rule.
- **#331's own instructions** say only "require **Web Wallet required** … under *Require status checks to pass*". They say nothing about the bypass. Followed literally, the owner's merge box looks as it does today: the review rule still forces the bypass, and that bypass covers the check too.
- **#338's run (40780509816):**
  - It checked out `85f50705`. The API gives that commit's tree as `8bd149a8…`, the same as `6bca8bec^{tree}` and `62be5bc4^{tree}`.
  - All 19 steps of `check` passed: fmt, clippy, the Rust tests, the WebAssembly build and tests, typecheck, both Vitest builds, the build, e2e, `e2e:data`, and the store package with its e2e.
  - So the brief's "never CI-tested as one" no longer holds for HEAD.

## Where the finding overstates

- **"e2e:data and the preprod-only Vitest build run nowhere but CI":** half wrong. Part 1 runs `VITE_ENABLE_MAINNET=false npm test` on the release branch (`development.md:194`). Only `e2e:data`, fmt and clippy are CI-only in the written procedure.
  - The 1.6.0 gate's lead ran the data layer's e2e locally too (chunk-34 Session 12: "the data layer's 3 of 3").
- **"Part 2's `npm run e2e` would catch it only on the store build, and only after the merge":** part 1 also runs `npm run e2e`, on the dev build, after the refreshes and before the PR (`development.md:183-195`).
  - F4 says its mainnet-grid break fails "on both builds". So part 1 catches F4 before the PR exists.
- **What a red release PR merged early really costs:**
  - `main` goes red.
  - The zip is still gated by part 2's store-build e2e before the upload.
  - Only a failure in `e2e:data`, fmt or clippy would get past both parts, and fmt and clippy don't change the zip.

## Reach and impact

- **Who can reach it:** only the owner, by merging. No user, site or attacker can, and nothing in the shipped build changes.
- **Is it real in practice? Yes, for the process.**
  - 12 of 14 merges went in mid-check under a written rule.
  - The 1.6.0 release PR did too: #324 merged at 02:44:10Z while its last run (on `ef6af2bc`, docs and the privacy policy) was still going. That run finished green at 03:01:03Z. The code commit `7e2d89ed`'s run had passed hours earlier.
  - Earlier release PRs waited for green: #294 by 3 minutes, #296 and #306 by hours.
- **Real harm for 1.7.0: not shown.**
  - HEAD is green in full.
  - The release PR's code is gated in practice by the lead's checks and by part 1.
  - The store zip is gated by part 2.
  - The residual exposure is an `e2e:data`-only regression in the release PR's own changes, merged before its run finished.
- **Why low, not medium:**
  - The brief's medium is wrong behaviour with real harm in a reachable state. Here nothing user-facing is wrong.
  - What is wrong in the tree is wording: `development.md:13` and `web-wallet.yml:135-136` say `main` requires the check, and roadmap item 2 (`post-release-roadmap.md:36`) leaves out the no-bypass part. That is the brief's "a misleading doc".
  - Closing the owner's own bypass is a new guard on his merges, which is the brief's owner-call.
  - 1.6.0's review handled the same matter as an owner's call: Session 12's call 6.
  - It doesn't block 1.7.0.

## The fix: right direction, with corrections

The fix is right that the requirement has to bind admins, and that only the owner can set it. Corrections and side effects:

1. **Strict is a separate choice.** `strict: true` does nothing today, because no check is required. Under (a) it starts binding the owner.
   - Each PR must then be updated to `main`'s head and re-run, 40 to 67 minutes, after any other merge.
   - #330 to #332, merged within four minutes, would have taken about 3 hours.
   - Item 2's goal, no merge before its own check is green (#323's failure), doesn't need strict. Strict only buys a `main` tree tested as one.
2. **(a)'s 0 approvals also frees `quinn-logicalmechanism`** to merge their own PRs unreviewed once green. Today they need an approval and can't bypass. (b) keeps that.
3. **Auto-merge** is off at the repo (`allow_auto_merge: false`).
   - Under (a) it works, but under strict it stalls each time `main` moves.
   - Under (b) it never fires for the owner's PRs: auto-merge waits for the classic approval, which never comes.
4. **(b) needs its own "up to date" box ticked** for strict behaviour. Classic `strict` applies only to classic required checks. (b) also leaves the classic review bypass in the merge box.
5. **What binding admins changes or breaks:**
   - No automation breaks. No workflow pushes to `main`: `release.yml` is tags, `data-layer-deploy.yml` is dispatch, `continuous-integration.yml` only reads.
   - Direct pushes to `main` are refused for the owner too. `development.md:14` already says to go through a PR.
   - A hotfix waits for its check, unless the owner lifts the setting, which an admin can always do.
   - A flaky step or a registry outage holds merges until a re-run. CI has no retries.
   - Docs PRs under `seedelf-platform/` wait the full check (#338 took 58 minutes). Don't narrow the path rule: tests read `docs/` (`docs/i18n`, `words.test.ts`).
   - Nothing touches privacy, UI text or a wallet guard.
6. **The test:**
   - For (a), the finding's test is right. A read-only check also works: `…/branches/main` shows `enforcement_level: "everyone"` and the protection names *Web Wallet required*.
   - For (b), the bypass box can stay for the review, so the test must instead be that the merge can't complete while the check runs: `gh pr merge <n> --admin` refused. Then `…/rules/branches/main` lists the check, and the ruleset shows `bypass_actors: []`.
   - Use a harmless comment-only PR, never the release PR. If the setting failed, the release PR would merge early.
7. **In the tree (the lead's, in the release PR):**
   - `development.md:13` and `web-wallet.yml:135-136` should say "requires" only once it's set, or say "is to require, with no bypass" until then.
   - Roadmap item 2's owner step should name the no-bypass setting, in a few words.
   - Ask #331's step again in that form.

**Minimal, in my view:** (b) with loose checks. The owner's habit stays, except the merge waits for green. Or (a) with auto-merge if he wants one click and accepts (2). Add strict only if he wants `main` tested as one. Until one of these is set, the release PR merges only once green on every step (`development.md:15`, `:279`).
