# v-pr329-5-trace: pr329#5, the docs say `main` requires *Web Wallet required*

**Verdict: confirmed. Severity: low (a misleading doc).**

I tried to refute it three ways: a ruleset requiring the check where classic protection doesn't show it, a protection-as-code file, and a later PR that fixed the wording. None holds. On HEAD (`6bca8bec`), both lines state as fact that `main` requires the check, and GitHub requires no check on `main` at all.

## The two lines, on HEAD

- **`seedelf-platform/seedelf-web-wallet/docs/development.md:13`:** "That job is the one `main`'s branch protection requires, so no path filter can leave a PR waiting on a check that never comes (1.7.0)."
- **`.github/workflows/web-wallet.yml:135-136`:** "# The one check main requires (its branch protection names *Web Wallet required*; data-layer.yml's job is called `check` too, so not that name)."
- **Where they came from:** `git blame` puts both at `c5d19d3f`, the only commit in #331 (`git log 3b32b92e^1..3b32b92e`). Nothing later in `babb8e76..HEAD` touches either file. #338 changed `post-release-roadmap.md` alone (6+/6−), as the owner said.

## What `main` requires, live (read-only `gh`)

- **Classic protection** (`gh api repos/logical-mechanism/Seedelf-Wallet/branches/main/protection`): `"required_status_checks":{"strict":true,"contexts":[],…,"checks":[]}`, with `required_approving_review_count: 1` and `enforce_admins: false`.
- **Rulesets:** `gh api …/rulesets` returns `[]`. `gh api …/rules/branches/main` returns `[]`, and that endpoint lists every active rule on the branch at any level, the organisation's included. (`orgs/…/rulesets` itself needs the `admin:org` scope and returns 404 here, but the branch endpoint already covers it.)
- **GitHub's own view of a PR:** `gh pr checks 338 --required` prints "no required checks reported on the 'web-wallet/1.7.0-leios-done' branch". Without `--required`, the job itself is there and green: `Web Wallet required pass 2s`.
- **No protection as code:** `.github/` holds only the five workflows. `git grep` for branch protection or `required_status_checks` finds only the two lines above.

## The docs that are right

- **`post-release-roadmap.md:36`, item 2:** "🚧 … then the owner turns the required check on in the branch's protection. The job is in (*Web Wallet required*, …); left, the owner's: requiring it."
- **#331's description** says the same: "**After merging (yours):** require **Web Wallet required** on `main`, under Settings → Branches → main → *Require status checks to pass*."
- So the two lines describe a step the owner hasn't taken yet, written as if it had been taken.

## Repro (scratch, deleted)

- **The script:** `v-pr329-5-trace-check.sh`, in my scratchpad and outside the tree. It reads both lines through `git show HEAD:…` and the required checks from both endpoints above. It exits 1 if the docs claim the check is required and GitHub doesn't require it.
- **Live:** "classic protection required checks: []", "rulesets (every level) required checks: []", then "FAIL: HEAD's docs say main requires *Web Wallet required*; GitHub requires no such check". Exit 1.
- **Simulated** (`FAKE_REQUIRED="Web Wallet required"`, as if the owner had turned it on): "PASS". Exit 0. So the result depends on the live state, not on the script's wiring.

## How far the scenario goes

- **Ticking item 2 off `development.md`** is the weaker half: item 2's own line says the owner's step is left.
- **Relying on `main` to refuse a red PR** is real: nothing refuses one today. It would stay real even with the check required, because every merge in the range went through the admin bypass (finding 2).
- **What still holds:** the line's other half, that no path filter can leave a PR waiting, is true of the job however it's configured. The rest of the workflow comment holds too: `data-layer.yml:28`'s job is called `check`.
- **Severity:** only the word "requires" is wrong, and it's in a dev doc and a CI comment. That's low per the brief.

## Fix advice

- **The finding's fix is right.** Until the owner turns the check on:
  - **`development.md:13`:** "That job is the one `main`'s branch protection is to require (1.7.0's item 2, the owner's step), so no path filter can leave a PR waiting on a check that never comes."
  - **`web-wallet.yml:135`:** "# The one check for main to require (1.7.0's item 2: its branch protection is to name *Web Wallet required*; …".
- **If the owner turns it on before the release,** flip both lines back to the present tense and tick item 2 in the same PR.
- **The words won't fully stand without finding 2's settings.** With `enforce_admins: false` and one required review that nobody gives, the owner's merges still bypass the check.
