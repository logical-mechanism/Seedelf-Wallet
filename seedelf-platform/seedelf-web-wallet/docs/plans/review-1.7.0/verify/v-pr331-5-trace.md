# v-pr331-5-trace: pr331#5, the docs say `main` requires *Web Wallet required*; it requires nothing yet

**Verdict: confirmed. Severity: nit** (two texts, no wallet behaviour). This is F6 in `reports/pr331.md`. I read GitHub's settings live at 2026-10-29T00:42Z. Re-check them before editing: the owner's step would make both texts true the moment it lands.

## What I traced, on HEAD (`6bca8bec`)

1. **Both texts are there as quoted.** #331's own commit wrote them, and nothing has touched them since.
   - `docs/development.md:13`: "That job is the one `main`'s branch protection requires, so no path filter can leave a PR waiting on a check that never comes (1.7.0)."
   - `.github/workflows/web-wallet.yml:135-136`: "# The one check main requires (its branch protection names *Web Wallet required*; data-layer.yml's job is called `check` too, so not that name)."
   - `git blame` puts both on `c5d19d3f` (#331). No later commit touches either file.
   - The header comment at `web-wallet.yml:3-4` ("always reports and main can require it") is accurate. Leave it alone.
2. **The roadmap says the step is still open.**
   - `post-release-roadmap.md:36`: "🚧 … then the owner turns the required check on in the branch's protection. The job is in (…); left, the owner's: requiring it."
   - #331's description says the same: "**After merging (yours):** require **Web Wallet required** on `main`".
   - #338, the docs PR that updated item 8's text, changes only the roadmap's line 42 (item 8, ⬜ to ✅) and lines around 405. Line 36 is current.
3. **GitHub requires no status check on `main`, at any level.** All of these are read-only GETs.
   - Classic protection: `"required_status_checks":{"strict":true,"contexts":[],"checks":[]}`.
   - `repos/…/rulesets?includes_parents=true` returns `[]`.
   - `repos/…/rules/branches/main` returns `[]`. That endpoint lists every active rule on the branch, organization rulesets included.
   - GraphQL `isRequired(pullRequestNumber:)` is `false` for the *Web Wallet required* run on #337 and on #338, both merged after #331. It's `false` for every other check run on #332, #337 and #338 too.
4. **A precision point on the title.** `main`'s protection does require two things: one approving review (`required_approving_review_count: 1`) and up-to-date branches (`strict: true`). It requires no status check, which is what the finding means by "nothing".

## The scenario, weighed

- **"A PR can't merge mid-check":** this half holds. Today a PR can merge mid-check, and nothing on GitHub stops it.
- **"A green main is a checked main":** this half is weaker. Two lines down, the same doc says nothing of the wallet's runs on `main` after the merge (development.md:15). A careful reader isn't misled on this half.
- **What limits the harm:**
  - The next bullet still says "Merge only once its check is green on every step, never while it's still running" (development.md:15).
  - Roadmap:36 says the step is left.
  - So only someone who reads line 13 alone, or the workflow comment alone, is misled. That makes it a nit, not low.
- **The texts would stay partly untrue even after the owner's step as written.** This is the same report's F1. I confirmed its premise independently:
  - Every PR from #325 to #338 merged by logicalmechanism with `reviewDecision=REVIEW_REQUIRED` and no reviews.
  - `enforce_admins` is `false`.
  - #331 merged out of date. #332's merge (`4610555a`) landed 19 s before it, and #331's head doesn't contain it (`git merge-base --is-ancestor 4610555a 3b32b92e^2` fails).
  - GitHub's docs: "By default, the restrictions of a branch protection rule don't apply to people with admin permissions to the repository."
  - So once *Web Wallet required* is listed, the admin bypass used on every merge skips it too. Neither text should imply that GitHub enforces it.

## The repro

I wrote a scratch shell check in my scratchpad, outside the tree (`zz-review-v-pr331-5-trace-1.sh`). It does three things:

- greps both texts on HEAD;
- reads classic protection's required checks, the rules on `main` and #338's `isRequired`;
- exits 1 when the texts claim a requirement that GitHub doesn't have.

Its result on HEAD:

```
texts claiming it: 2 of 2; classic protection lists it: 0; rulesets on main list it: 0; #338's run isRequired: false
FAIL: HEAD says main requires "Web Wallet required"; GitHub requires no such check
exit=1
```

I deleted it afterwards. No scratch file of mine remains.

## Fix advice

- **Two ways resolve it, whichever lands first:**
  - The owner does item 2's step, in whatever form F1 settles. Both texts then hold as to the requirement, with no edit.
  - The edit below.
- **The edit, until the owner's step:**
  - development.md:13: "That job is the one `main`'s branch protection is to require (roadmap item 2, the owner's step), so no path filter can leave a PR waiting on a check that never comes (1.7.0)."
  - web-wallet.yml:135-136: "The one check main is to require (roadmap item 2: its branch protection is to name *Web Wallet required*; data-layer.yml's job is called `check` too, so not that name)."
- **Word it together with F1:**
  - Neither text should imply that the protection stops a mid-check merge while merges go through the admin bypass.
  - development.md:15's manual rule stays the real guard until F1's option (a) or (b) is in.
  - If the owner picks F1's (b), a ruleset, change "its branch protection names" to "a ruleset on `main` names".
- **Leave `web-wallet.yml:3-4` alone.** "Main can require it" is accurate.
