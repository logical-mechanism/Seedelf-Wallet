# v-pr331-0-impact: pr331#0, the required check the owner's own merges would bypass

Verifier's job: impact and the fix. HEAD `6bca8bec`. All checks here were read-only: `gh api` GETs, git, and GitHub's docs. No scratch files were written.

## Verdict

**Confirmed, medium.** It's a release-process defect. It has no reach into the store build, and 1.7.0's own tree is already covered by a green run (below).

The fix points the right way, but it needs corrections:
- "Up to date" isn't needed for item 2's goal, and it's costly.
- Option (a) loosens the review rule for the repository's other writer.
- Auto-merge doesn't work the way the finding says under strict, or at all under (b).
- The test needs rewording for (b).

## The mechanism: every part holds

- **The protection on main** (`gh api …/branches/main/protection`):
  - `required_status_checks {strict: true, contexts: [], checks: []}`
  - `required_approving_review_count: 1`
  - `enforce_admins: false`
  - `…/rulesets` and `…/rules/branches/main` both return `[]`.
- **Every merge used the bypass.** #323 to #338 have 0 reviews each. The owner (`admin`) wrote every one of them and merged every one of them, so the review rule was always met by the bypass.
  - One correction: "can never meet that rule" is too strong. The repository has one other collaborator, a human with `write`, who could approve. Nobody ever has.
- **The bypass covers status checks too.** GitHub's docs: "By default, the restrictions of a branch protection rule do not apply to people with admin permissions to the repository". *Do not allow bypassing the above settings* removes that exemption. Classic protection has one bypass for the whole rule, so the owner's step as written adds *Web Wallet required* to a rule they already bypass on every merge.
- **Strict mode has had nothing to act on.** The docs say: "If required status checks aren't enabled, collaborators can merge the branch at any time, regardless of whether it is up to date". Git confirms that PRs merged out of date:
  - #331's head `c5d19d3f` lacks #332's merge `4610555a`.
  - #337's head `aa6f5fc2` lacks #336's merge `473b7f1a`.
  - Also, #335's head lacks #334's merge, and #333's head lacks #335's.
- **The timings.** I checked every merge time against its head's check runs. All 12 of the finding's mid-check merges are exact.
  - #331 merged 1m51s after its own `changes` job started.
  - #338, which the owner calls a pure docs PR, merged at 22:55:43Z. Its 58-minute check finished at 23:28:25Z.
- **"Nothing runs on main to show it."**
  - Push runs on main are only *Continuous Integration*, which covers the Aiken contracts. It's `success` on all ten merge commits from `d67f8054` to `6bca8bec`, so a broken wallet tree on main still looks green there.
  - No workflow pushes to main. The workflows are `continuous-integration.yml` (push and PR), `web-wallet.yml` (PR), `data-layer.yml` (PR, paths), `release.yml` (tags) and `data-layer-deploy.yml` (dispatch).

## Reach and impact

- **Who can reach it:** only the owner's merges. No user, site or attacker can, and nothing in the shipped build changes.
- **Is it real in practice? Yes, and certain, not an edge case.**
  - After the step as written, the merge box looks the same as today: the review rule still forces the bypass on every PR.
  - The owner already merges with checks visibly pending: 12 of 13 PRs in this range did, even with development.md:15's rule in place.
  - So item 2 would be ticked ✅, while the only person who merges is no more gated than now.
- **The precedent is real harm.** #323 left every private Bootstrap broken on main, a high finding in 1.6.0's review (roadmap.md:51). main showed green because only the contracts' CI runs there. The release review found it, days later, after other PRs had stacked on it.
- **What limits the harm to users:**
  - Part 1 of the release procedure runs the full suites locally on the release branch: `cargo test`, `npm test` in both builds, and `npm run e2e`.
  - Part 2 runs e2e on the store package.
  - GitHub notifies the pusher when a run fails.
  - So a store user is hurt only if those also miss it. The damage that does happen falls on the release line: the breakage is found late, and the docs claim a gate that doesn't exist.
- **Nothing here holds 1.7.0.**
  - HEAD's tree `8bd149a8` is `62be5bc4^{tree}`, #338's head.
  - #338's run, 40780509816, came from `pull_request` with main at `11e249d2`, which is `62be5bc4`'s parent. So it tested exactly HEAD's tree.
  - Every step passed: fmt, clippy, the Rust tests, the WebAssembly build and tests, typecheck, both Vitest builds, the e2e, the data-layer e2e, and the store package and its e2e.
  - The brief's "never CI-tested as one" is therefore superseded for the final tree.

**Severity: medium.**
- It isn't high: no money is at risk, no user flow breaks, and it doesn't block the release.
- It isn't low:
  - the failure is certain, not an edge case;
  - it defeats the whole purpose of a release-list item the owner chose (Session 12's call 6);
  - the failure it lets back in has already put a high bug on main once.
- It fits the brief's "a lock that doesn't happen" and "a critical guard with no test". Which setting to use is the owner's call.

## The fix: what's right, and what to correct

The fix is right that enforcement has to bind admins, and that only the owner can change the setting. Six corrections:

1. **"Up to date" is a separate choice, and not needed for item 2's goal.**
   - That goal is that no PR merges before its own check is green, which was #323's failure.
   - Loose checks with no bypass achieve it. Each PR's check still tests the PR merged into main as it was when the run started (`refs/pull/N/merge`).
   - Strict, enforced, serializes bursts. Every PR under `seedelf-platform/` runs 40 to 68 minutes, docs PRs too (#338 took 58). So #330 to #332, merged within 4 minutes, would have taken about 3 hours, with an *Update branch* by hand before each later merge.
   - Under (a), enforcing makes the existing `strict: true` bind the owner, unless they untick it.
   - It's the owner's choice: strict buys a main tree tested as one.
2. **Option (a), required approvals 0, also frees the other writer.** That collaborator can't merge without an approval today, since they can't bypass. Under (a) they could merge their own PRs once green. Option (b) keeps the review rule for them.
3. **Auto-merge has two caveats.**
   - Under strict, auto-merge stalls once another PR lands: the PR goes out of date and waits for an update and a fresh run. "Lands it the moment it's green" holds only under loose checks.
   - Under (b), auto-merge never fires for the owner's own PRs. Auto-merge waits for every requirement, and the classic rule's one approval never comes.
4. **Option (b) rests on the docs and hasn't been tried.**
   - The docs say all applicable rules are enforced, and a ruleset binds admins unless they're on its bypass list.
   - The merge box will still offer the classic bypass checkbox, for the review. So the finding's test ("no bypass checkbox") would fail under (b) even when (b) works.
   - The test should be: with the bypass ticked, the merge still can't complete while the check runs. A crisp CLI form: `gh pr merge <n> --merge --admin` on a comment-only PR whose check is running must be refused. Use a change that's harmless if it lands.
5. **What binding admins would cost or break:**
   - It breaks no automation, since nothing pushes to main.
   - A mainnet hotfix waits for its 40 to 70 minute check, though an admin can lift the rule in an emergency.
   - A flaky step, or an outage at crates.io, npm or Playwright's download, blocks merges until a re-run passes. CI has no retries.
   - Docs PRs under `seedelf-platform/` wait the full check. Don't narrow the path rule to exempt `docs/`: Vitest reads `docs/i18n`, and narrowing reopens holes like the report's F2.
   - There are no privacy, UI-text or wallet-guard concerns. It binds the owner's own merges, which they asked for.
6. **The part in the tree is the wording.**
   - development.md:13 says "That job is the one `main`'s branch protection requires", and `web-wallet.yml:135-136` says "The one check main requires (its branch protection names *Web Wallet required*". Both are false today (`contexts: []`), and they'd still be hollow after the step as written.
   - Say "is to require, with no bypass" until it's done.
   - Roadmap item 2's step for the owner should name the no-bypass setting. Keep it short.
   - If the owner keeps merging by bypass, the push-to-main run is the alternative, and it only detects. `changes` must special-case `push`: on a push, `FILES` would be `…/pulls//files`, so `changes` fails, `check` is skipped, and `required` goes red.

**The minimal choice, in my view:** either of these, with loose checks.
- **(b):** a ruleset requiring *Web Wallet required* with no bypass actors and *up to date* off. The owner's habit stays the same, except they wait for green.
- **(a) with auto-merge:** if the owner prefers one click, and accepts that the other writer could then merge without a review.

Turn on strict only if the owner wants main's tree tested as one, at about an hour per PR for each merge that lands ahead of it.
