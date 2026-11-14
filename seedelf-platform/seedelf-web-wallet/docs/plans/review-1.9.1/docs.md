# docs (find:docs)

6 finding(s).

## docs#1: development.md's copy-paste release blocks still name 1.9.0

- **Severity:** low; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/docs/development.md:182`
- **Since:** n/a

**What.** Part 1's block says `release_version=1.9.0` (line 182), and part 2 says "With `package.json` at 1.9.0, that file is `extension/release/seedelf-wallet-1.9.0-mainnet.zip`" (line 279). 1.9.0's prep bumped both lines in the same commit as its version. The release tree has `package.json` and `package-lock.json` modified but `development.md` not.

**Scenario.** The owner pastes part 1's block as-is for 1.9.1. `npm version 1.9.0` either stops with "Version not changed" or, after the bump, sets the version back to 1.9.0. Line 279 names the wrong zip.

**Evidence.** `git show ed14af7b -- docs/development.md`: `-release_version=1.8.1` / `+release_version=1.9.0`, and the same change on the 'With `package.json` at …' line. `grep -n 1.9.0 docs/development.md` → 182 and 279. `git status --short` in the release tree: package.json and package-lock.json modified, development.md clean.

**Suggestion.** In the release prep commit, set both lines to 1.9.1, as ed14af7b did for 1.9.0.

## docs#2: Chunk 46 still holds the Rust proptest as an open owner's call, which chunk 49 took over

- **Severity:** low; **confidence:** traced
- **Where:** `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-46-verification-on-upstream.md:142`
- **Since:** new in 1.9.1

**What.** #381 added chunk 49, whose step 3 is this proptest (⬜, "carried by chunk 46 as ❓, and now it's the empirical half of step 2"). Neither #381 nor #382 touched chunk 46's line 142, which still says it's the owner's call. So two live plans hold one item with different statuses. plans/README calls a stale plan read as current the one failure mode that costs real work.

**Scenario.** A session picks up chunk 46, reads line 142, and asks the owner to decide a proptest that chunk 49 already scheduled. Or it builds it twice.

**Evidence.** chunk-46…md:142: "❓ **A Rust proptest of the Schnorr path through the deployed bytes** (chunk 40, offered 2026-11-02). … The owner's call." chunk-49-no-locked-funds.md:67-69: "### 3. ⬜ The Rust prover through the deployed bytes: a proptest. This was chunk 40's offer, carried by chunk 46 as ❓, and now it's the empirical half of step 2."

**Suggestion.** Replace line 142 with: "- **A Rust proptest of the Schnorr path through the deployed bytes** (chunk 40's offer): moved to [chunk 49](../chunk-49-no-locked-funds.md)'s step 3."

## docs#3: Chunk 48's archived record doesn't name its merge

- **Severity:** nit; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-48-seedelf-every-tx-kernel.md:41`
- **Since:** new in 1.9.1

**What.** The record was written before the merge. It lists 3b2e14d8, ab379990 and 04b57c4a, then "then chunk 49's plan, with this file moved here" with no hash, and never names #381's merge. Chunk 45's record does name its merge ("**#368** (…, merged as `d190f717`)").

**Scenario.** Someone checking what #381 put on `main` has to look up the merge themselves.

**Evidence.** `gh pr view 381 --json mergeCommit` → 4e5ee50075f5…; `git log --oneline 4e5ee500^2 -4` → 363acdf3 (chunk 49 plan + archive), 04b57c4a, ab379990, 3b2e14d8.

**Suggestion.** "PR #381 (`web-wallet/seedelf-every-tx`, into `main`, merged as `4e5ee500`):" … "- 363acdf3, chunk 49's plan, with this file moved here."

## docs#4: Chunk 50 quotes a *Status* section that seedelf-verification's README doesn't have

- **Severity:** nit; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-50-docs-for-outsiders.md:50`
- **Since:** new in 1.9.1

**What.** The tier table says the verification README has "a *Status* made of chunk records". The README has no Status section, either at #383's base 45a0b3bb or at 3063b33f. Its section made of chunk records is *Next* (line 177).

**Scenario.** The chunk 50 agent that owns group 6 looks for a Status section that isn't there.

**Evidence.** `git show 45a0b3bb:seedelf-verification/README.md | grep -n '^## '` → Running it, What's proved, Not proved and why, Found along the way, Writing a property, When a Lovejoin property comes back Falsified, Next (177).

**Suggestion.** "… and a *Next* made of chunk records".

## docs#5: "342 files" in chunks 46 and 49 doesn't match the tree's count

- **Severity:** nit; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-46-verification-on-upstream.md:41`
- **Since:** new in 1.9.1

**What.** Chunk 46 line 41 says "342 files state failure that way", and chunk 49 line 114 says "`isErrorState` across 342 files". The tracked tree has 339 .lean files that name `isUnsuccessful`, and 354 files of any type. The 342 may have been counted in a scratch worktree with extra modules. The number sizes chunk 46's migration, so it should be the tree's, or say where it was counted.

**Scenario.** The migration session plans for, or checks off, 342 files, but there are 339.

**Evidence.** `git grep -l isUnsuccessful <c> -- 'seedelf-verification/*.lean' | wc -l` → 339 at 14b24e59, 04b57c4a and 3063b33f; over all of seedelf-verification → 354.

**Suggestion.** "339 files" (the tracked .lean files at 4e5ee500), in both plans.

## docs#6: The review folder must not land under docs/plans/

- **Severity:** nit; **confidence:** traced
- **Where:** `seedelf-platform/seedelf-web-wallet/docs/plans/README.md:3`
- **Since:** n/a

**What.** `docs/plans/review-1.9.1/` (untracked, holds REVIEWBRIEF.md) sits in plans/, which holds only live chunk plans ("if a file is here, it's live"). 1.9.0's review went to docs/archive/plans/review-1.9.0.md.

**Scenario.** The release commit stages docs/plans/review-1.9.1/ as it is, and a finished review then reads as a live plan.

**Evidence.** `git status --short` → `?? seedelf-platform/seedelf-web-wallet/docs/plans/review-1.9.1/`. `ls docs/archive/plans` → review-1.6.0.md … review-1.9.0.md.

**Suggestion.** Write the record as docs/archive/plans/review-1.9.1.md, and leave no folder in plans/.

## Checked and holds

- Relative links and anchors: 0 bad in releases.md, architecture.md, the chunk 46/48/49/50 plans, plans/README.md, backlog.md, development.md, wasm/README.md, flows.md and privacy.md. The script is scratchpad/review-1.9.1/docs/linkcheck.py (GitHub-style anchor slugs, code blocks skipped); on a test file it caught a missing file, a missing anchor and an anchor to a bold line that isn't a heading.
- releases.md's 1.9.0 row and record: c0b451a8 is web-wallet/1.9.0, the PR numbers and merges for #370–#378 match git log --first-parent, and 8d7c4b0c is an ancestor.
- 1.9.0's lists at c0b451a8 match the record: tokens preprod 2 / mainnet 32, token-decimals 1,175, DReps preprod 67 (4 new) and mainnet 466 (only the date line changed), Lovejoin pools unchanged since f77aa5c1. Nothing in seedelf-data/ or list.json changed since web-wallet/1.8.0, so no deploy was needed.
- 1.9.0's test counts (783 Rust, 3,304 Vitest, e2e 109) match review-1.9.0.md, and its #lessons and #the-translations anchors resolve.
- architecture.md's Chains where needed sentence (#384) matches lib.rs chained (lines 4280-4315): the last-tokens part (!more) tries amount(picks, owed.max(least(share)), ...) first and carries only when short, and the chain ends after a carry once no tokens and nothing are owed. 'An amount's' is right: Max goes through max_chained, which #384 didn't change.
- Nothing #384 changed made wasm/README.md's buildTransferParts row, flows.md's Parts that wait (lines 370-371) or privacy.md line 183 false. A carry is still an output of ADA alone to a fresh re-randomization of the change's owner (build.rs:1682-1689), so a carry that ends a chain is linked the same way change is.
- backlog.md: no line on chains or parts that #384 closes, and none it needs to add.
- House rules in the new text hold: no release dates or store status, every lowercase 'seedelf' in prose is a crate or folder name, no release notes, and no privacy-policy entry is owed since #384 changes no data handling.
- docs/plans/ holds only live plans (38 planning, 46 in progress, 49 and 50 not started), and chunk 48 is in archive/plans/.
- Chunk 48's facts hold: its base is 14b24e59 and its three commits exist; the script hashes (94bca9c0, 84967d91, 6777ba4d) match constants.rs and references.rs; the theorem names exist with #guard_msgs on #print axioms (Lean's three); 14+14=28 matches check.sh's seedelf_every list; the 16G/30m caps and peaks match check.sh:30-33.
- Chunk 49's code references all exist: create_proof and proof_nonce with the padded 32-byte c in schnorr.rs, from_cbor and apply_data in templates.rs, uplc =1.1.23, Register::create and rerandomize, eval_test.rs, AnyTx.lean, the script-hex-not-lake-inputs finding, and schnorrProve's challenge argument order.
- Chunk 46's 11-13 additions: every module and file it names exists (Walk, Owner, Fold, Shared, Collect, PolicyLinesAll, LinesAllCek with cek_rfl, seedelfName_eq, every Mix/Own/FeeMix/MixIff module, gen-lovejoin-owner.py), and 4e5ee500 is #381's merge.
- Chunk 50's facts hold: seedelf-cli has readme = "../README.md"; there are four crate READMEs and three CLAUDE.md files; chunk 22 had nine reviewers; the CI path filter skips Markdown except wasm/README.md; Settings links privacy-policy.md by its GitHub URL; every quoted marker is in the file named; all 41 tracked Markdown files outside the working folders sit in a tier.
- development.md's release blocks otherwise fit a patch release: the parts-suite command, the lists, the deploy condition and the tag step.

## Coverage

Every docs change since 1.9.0 is read in full: #379, #381's wallet docs, #382, #383, and #384's architecture.md sentence against chained. Not checked: the 1.9.0 record's zip SHA-256, size and toolchain lines (no zip without touching the lead's build), and the upstream facts in chunk 46 (#78's merge date, Z3 5.4.1, #455 MERGEABLE), since there was no network. The brief asked for report.md in the scratch folder, but the harness refused to write it; this output is the report. The link checker is at SCRATCH/review-1.9.1/docs/linkcheck.py. One note for the code lane, not graded: when a chain ends on a carry (lib.rs:4310), the carried ADA is the spend's rest, kept apart from change_lovelace (build.rs split). So whole()'s changeLovelace (script-spend.ts:516), and through it a funding's privacy note (DappApprovals fundingPrivacy, fed from sessions.ts:3108), leaves out ADA that stays in the private balance tied to the one-time account. I reasoned the branch is near-unreachable: tokens run out only after the last-tokens part, which carries only where amount is short. For carries to have paid everything, what's owed must be no more than that part's tokens' least, and then a carry needs more ADA than amount does (one more output). The code lane should confirm.
