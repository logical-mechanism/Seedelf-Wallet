# x-rel: 1.7.0's release readiness (cross-PR lens, #325–#338)

## Summary

The code is ready to package once the release branch commits its steps. What's still missing is release work, not fixes.

**One correction to the brief.** It says the tree "was never CI-tested as one". It was: HEAD's tree (`8bd149a8…`) is byte-identical to `refs/pull/338/merge` (`85f5070`, "Merge 62be5bc4 into 11e249d2"). #338's Web Wallet run 40780509816 checked that tree, and every step passed: fmt, clippy, Rust tests, the WebAssembly build and tests, typecheck, Vitest on both builds, e2e, e2e:data, and the store package with its e2e. The run finished 23:28:25Z, 33 minutes after the merge. The run still left is the release PR's own, with the bump and the refreshed lists.

**Answers to the lens's questions:**
- **Data layer deploy: not needed.** Nothing in the range touches `seedelf-data/` or `extension/src/tokens/list.json`, and nothing uses a new route. #336 asks Koios directly (`koiosAlone()`). #333's parameters read is the existing `epoch_params`. The API now live was deployed from `641f751c` (run 40713719454, 2026-10-28), and that commit's `seedelf-data/` equals HEAD's (last changed in `22acd30e`). A deploy is needed only if the decimals refresh changes `token-decimals.json` (F4).
- **Koios is already a declared host.** `https://api.koios.rest/*` comes from `serviceHosts` → `NETWORKS.mainnet.koios`, and `package.mjs` refuses a store build without it. The manifest didn't change in the range, so the update adds no permission and no re-consent. What must change is the text (F2).
- **Store screenshots: none shows a screen the range changed.** The five shots are Home's two tabs and the Send privately, Create a Seedelf and Make public forms. The range touched Transfer and Withdraw only in their review stage (`TxDetailButton`'s `parts`), left Home and Create a Seedelf alone, and changed no existing en.json value: only six keys were added. 1.7.0 needs no regeneration. Whether 1.6.0's changes already made the images stale is under *Not checked*.

## Findings

### F1 · high · release: 1.7.0 isn't set yet

The version still reads 1.6.0 everywhere:
- `extension/package.json:3`;
- `extension/package-lock.json:3` and `:9`;
- `docs/development.md:181` (`release_version=1.6.0`) and `:242` ("With `package.json` at 1.6.0, that file is `extension/release/seedelf-wallet-1.6.0-mainnet.zip`").

`git diff --stat babb8e76..6bca8bec -- extension/package.json` is empty.

**Scenario:** part 2 runs on a merge that lacks the bump.
- `npm run package` writes `release/seedelf-wallet-1.6.0-mainnet.zip` over the shipped 1.6.0 zip. That folder is gitignored, and the file on disk still hashes to the recorded `6d1219aa…`.
- The dashboard then refuses the upload, because the version isn't higher.
- `package.mjs:40` checks only that the build matches `package.json`.

**Fix:** on the release branch, `npm version 1.7.0 --no-git-tag-version`: a minor bump, as the list says. Change development.md:181 and :242 to 1.7.0 in the same commit. No test pins the version.

### F2 · medium · privacy: #336 asks Koios while our server answers, and the summaries don't say so

`confirmed()` runs only on mainnet, while the data layer is up (`lovejoin-pools.ts:454`, `:565`). For each listed pool the device hasn't kept, it sends `tx_info`, and `account_update_history` where the launch didn't register L, to `api.koios.rest` through `koiosAlone()` (`:527`, `:551`).

The policy's pools paragraph (`privacy-policy.md:46`) and its 28 October entry say so. Every summary still says Koios is asked on mainnet only for what ours can't answer:
- **The listing's description:** `store/README.md:75`, "Koios … on mainnet for anything ours can't answer, or for everything if you turn ours off". The same sentence is in Spanish at `:163` and Japanese at `:227`.
- **The Koios host row:** `:261`. Its only "Even while its own server answers" case is the later-pool read.
- **The merged host box:** `:269`, "and for one Lovejoin read its server doesn't cover". It is 996 characters of about 1,000.
- **The test instructions:** `:334`, "api.koios.rest on mainnet when that server can't answer".
- **The policy's own summaries:** `privacy-policy.md:5` (In short), `:7` and `:40`.
- **The design doc:** `privacy.md:22`.
- **Checklist item 9:** `development.md:162`, "`api.koios.rest` only for a part the data layer couldn't answer".

**Scenario:** a user keeps Koios-only off so that Koios never sees them on mainnet. Someone launches a mainnet token pool. That user's next pool read sends Koios a `tx_info` from their IP, telling Koios they use Lovejoin. That contradicts what the store page and the policy's summary promise.

How often this happens: only for a pool the device hasn't kept. Mainnet's head start holds none today (height 14110720, 0 pools), and the release's refresh bundles any that exists by then.

**Fix:** add one clause wherever the claim appears, for example "and to confirm a Lovejoin pool ours lists that the wallet hasn't seen".
- The description in all three languages, with a blind back-translation of what changed (`store/README.md:114`).
- The `:261` row.
- The merged box. It has no room to add, so the new clause has to replace words, for example "and for two Lovejoin reads its server doesn't answer alone".
- `:334`, `privacy-policy.md:5`, `:7` and `:40`, `privacy.md:22`, and item 9.
- No permission changes on the dashboard.

### F3 · medium · ci: item 2's owner step, as written, won't gate the release PR

`gh api …/branches/main/protection` returns:
- `required_status_checks {strict: true, contexts: [], checks: []}`;
- `required_approving_review_count: 1`;
- `enforce_admins: false`;
- no rulesets.

All 14 PRs merged with `reviewDecision: REVIEW_REQUIRED`, no reviews, and the owner as merger, so every merge went through the admin bypass. That bypass skips required checks too, unless "Do not allow bypassing" is on. As a result, 12 of the 14 PRs (#326 and #328–#338) merged while their own check was still running:

| PR | Merged | Its check finished |
|---|---|---|
| #330 | 16:22Z | 16:58Z |
| #335 | 17:14Z | 18:03Z |
| #337 | 18:30Z | 19:14Z |

Requiring *Web Wallet required* as it stands only adds it to the rules the owner's merges already bypass. Meanwhile `development.md:13` and the comment at `web-wallet.yml:135` say `main` requires it now. #331's own report covers the same protection facts.

**Scenario:** the owner opens the release PR (the bump and the refreshed lists), turns the requirement on, and merges through the bypass as for every PR in this range, while e2e is still running. A failure there, such as F4's mainnet grid, turns `main` red after the merge. Part 2's `npm run e2e` would catch it only on the store build, and only after the merge.

**Fix (the owner's), before the release PR merges:** choose one:
- (a) set required approvals to 0, turn on "Do not allow bypassing", and require the check. `strict` is already on, so every merge is tested up to date with `main`.
- (b) add a branch ruleset that requires the check with no bypass actors.

Until then, merge the release PR only once it's green on every step (`development.md:15`). Have line 13 and `web-wallet.yml:135` say "requires" only once that's true.

### F4 · low · release: the refreshes haven't run since 1.6.0 (`8cd8ce08`)

**What each one touches:**

| Refresh | Writes | Reads |
|---|---|---|
| `npm run tokens` | `src/tokens/registry.{mainnet,preprod}.json` only (`list.json` is kept by hand) | real Koios |
| `npm run dreps` | `src/dreps/{mainnet,preprod}.json`, refusing a loss over 5% | Koios |
| `npm run lovejoin-pools` | `src/lovejoin-pools.json` | the holder from its start, through `scan` → `holder()` → #336's `launched()` (the check moved, unchanged) |
| The decimals script | `seedelf-data/api/data/token-decimals.json` (a deploy if it changes) | a fresh registry clone |

**Does the range make any of them riskier?** No: it touches no tokens, `list.json`, DReps or decimals, and its new tests inject `headStart`.

**One assumption that predates the range:**
- The e2e's mainnet case finds `lovejoin-pool-classic` on the hub (`e2e/extension.spec.ts:3389`). `classicRow` says "Mainnet bundles none" (`:3201`).
- The hub becomes a grid at `groups.length > 1` (`Lovejoin.tsx:1995`).
- So if a mainnet token pool has launched since 2026-10-25, bundling it fails that e2e on both builds in the release PR's CI.

**Fix:**
1. On the release branch: tokens, then lovejoin-pools, then dreps, then the decimals script.
2. Read the diffs.
3. If mainnet's head start gained a token pool, update that e2e step in the same commit.
4. If `token-decimals.json` changed, commit it and deploy after the merge (step 7).
5. Note each outcome in the handoff note.

### F5 · low · tests: #337's way out has never run against a chain

The PR says "e2e can't reach this state under its fakes", and that it stays dormant on mainnet until a 5 ₳ pool holds its floor. No e2e names it. It had no live preprod run. The checklist's collateral-mix line (`development.md:145`) ends at "that mix waits for giveme.my". The owner's standing rule is that private spends run live on preprod before they're reported.

**Scenario:** the first real press is a tester's or the owner's. If stopping mid-chain or the direct return misbehaves, the session waits out the day (`TAIL_KEEP_MS`).

**Fix:** a preprod run, then the same steps as a checklist line:
1. Take a private session's return with the 5 ₳ pool shown and the collateral mix on.
2. Once the collateral's deposit lands, block `www.giveme.my` (DevTools request blocking, or `page.route` in the live harness).
3. Wait the hour.
4. Check that the line and the button show on a swap's page, a site's page and a mix's card.
5. Press it. The rest should come back directly, the chain should show "You brought the rest back…", and the 5 ₳ box should stay unmixed in the pool.
6. Unblock giveme.my. *Mix my boxes again* should move the box.

### F6 · low · docs: the preprod checklist names none of 1.7.0's behaviours

**Gaps:**
- **#335:** e2e steps through only Make public's two parts (`extension.spec.ts:2662`). The checklist doesn't name the other four reviews that can go in parts: Send privately, a swap's funding, a site's funding and Lovejoin's private funding.
- **#337:** see F5.
- **#333:** the private Bootstrap's form now asks for 1.5 ₳ plus the priced `back`, which is still 3 ₳ at today's parameters.
- **#336:** the Koios clause in item 9 (F2).

**Fix:**
- Item 6's Max line: add "…and Transaction details steps through each transaction ('Transaction 1 of N'), on Send privately and a funding in parts too".
- Add F5's line after the collateral-mix line.
- The Bootstrap line: add "its form asks 3 ₳ beside the boxes at today's parameters, and the review's funding matches". Running it live also exercises #333's new sum.
- Item 9: F2's clause.

### F7 · low · tests: #336's check can't be exercised before mainnet's first new pool

Preprod reads Koios alone, so `confirmed()` never runs there. The data layer's e2e fake lists no token pool. Only unit tests over fakes reach it.

**Scenario:** if the new code has a defect, it fails closed. The first time it shows is a new mainnet pool that 1.7.0 wallets never show, mix into or read boxes in, while 1.6.0 wallets do. Koios is asked again every five minutes.

**Fix:** add an e2e:data case: the fake lists preprod's MIN pool re-tagged for mainnet, and the Koios fake answers its `tx_info`. Assert the pool shows and one `tx_info` reached Koios. Or accept the gap and record that in the handoff note.

### F8 · low · docs: the release-prep docs aren't in yet

**What's missing:**
- **The list:** items 4 (the Bootstrap half), 5, 6 and 7 merged (#333, #336, #337, #335), but still read 🚧/⬜ at `post-release-roadmap.md:38–41`. Their *Kept in mind* lines (`:373`, `:374`, `:378–380`) aren't ticked either. This is by design: #333 says "the 1.7.0 list's tick waits for the release-prep docs commit".
- **The handoff note:** `roadmap.md` has no 1.7.0 note.
- **The clean-tree check:** `git status --porcelain` prints `?? …/docs/plans/review-1.7.0/`, but part 2 needs it to print nothing (`development.md:219`).

**Fix:**
- Tick items 4 to 7. Item 2 stays the owner's until F3 is settled.
- Turn the *Kept in mind* lines into ✅ entries, as `:387–388` are.
- Add the 1.7.0 handoff note.
- Archive the review folder as 1.6.0's was (`docs/archive/plans/review-1.6.0.md`), or remove it before part 2.

### F9 · owner-call · privacy: the policy's date

The policy is dated 28 October 2026 (`privacy-policy.md:3`, `:93`), #336's merge day. 1.6.0's policy was moved to its release PR's merge day (`ef6af2bc`: "make the merge day today"), and #336's PR asks the same question.

**Your call:** keep 28 October, which already satisfies "before the new version ships", or move both the *Effective* line and the entry to the release PR's merge day in the release-prep commit.

## CLI notes

- **#332** puts overflow checks in `[profile.wasm-release]` only. The CLI keeps the plain release profile (`Cargo.toml:32`), so a u64 overflow in core still wraps silently in the CLI. Turning on `[profile.release.package.seedelf-core]` overflow-checks is the owner's call, at the CLI's next release.
- **#328's rustls** is an optional dependency that nothing turns on, so no CLI binary changes. h2 0.4.11 and 0.3.26 (RUSTSEC-2026-0258) and the yanked spin 0.9.8 are still open (`post-release-roadmap.md:419`).
- **#338's Leios run** found that Dijkstra (PV12) refuses Pallas 0.35's list-form redeemers. That covers every CLI script spend too. A CLI release is needed before any Dijkstra hard fork.
- **The CLI's sweep of 21 or more tokens without `--lovelace`** (321-parts-rust#0) is still open (`post-release-roadmap.md:389`).
- **Tags:** any tag for 1.7.0 must be `web-wallet/1.7.0`, or `release.yml` (`*.*.*`) builds and publishes a false CLI release.

## Not checked

- I ran none of tokens, dreps, lovejoin-pools or the decimals script (the brief forbids them), and made no mainnet reads. So I don't know whether a mainnet token pool exists now, which is what F4's e2e break depends on.
- I didn't render the store images. `store:images` writes tracked files, and `dist/` may be stale. The images date from 2026-10-12 (`46bcafcf`), and 1.6.0 didn't regenerate them, although Home.tsx (about 300 lines), Transfer and Withdraw, and the Max notes' words changed since. Whether that shows in the five shots is unchecked.
- I ran no tests. The CI result is GitHub's record of run 40780509816, matched to HEAD's tree hash.
- I didn't curl the live API. The deploy state comes from git and the deploy run's jobs (its Build ran, and its VPS step was `deploy`).
- I didn't see the dashboard's current listing. I assumed it equals `store/README.md` as uploaded for 1.6.0.
- I took the admin bypass from GitHub's documented default, and didn't try it.
