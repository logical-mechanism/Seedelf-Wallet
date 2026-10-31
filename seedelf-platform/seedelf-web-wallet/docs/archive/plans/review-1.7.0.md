# 1.7.0's release review, its fixes and the gate (2026-10-28)

**Status: ✅ done, the gate for 1.7.0.** It's on branch `web-wallet/release-1.7.0` (PR #340). The working folder (`docs/plans/review-1.7.0/`: the brief, every reviewer's and verifier's report, the overflow sweep, the fixers' brief and every lane's report, and `FINDINGS.md`) was compressed into this file when the PR was ready. The full text is in git at `e8b007f8`; [The IDs](#the-ids) says where each family is. What still holds is in the design docs, and the open items are in [post-release-roadmap.md](../post-release-roadmap.md)'s *Kept in mind* and the release's handoff note in [roadmap.md](../roadmap.md).

## The review

**What it covered:** every PR since 1.6.0, #325–#338, as one tree at `6bca8bec`. Item 8's own branch, `web-wallet/leios-musashi`, stays unmerged on purpose and wasn't reviewed.
- **One reviewer for each PR**, 14 in all.
- **Ten lenses across them:**
  - where the PRs meet;
  - #332's overflow checks;
  - privacy;
  - the screens;
  - the docs;
  - release readiness;
  - mutation checks of the TypeScript tests and of the Rust tests;
  - scenario walks;
  - the update from 1.6.0.
- **Verification:** two refuters per finding (a trace, then its impact), one per nit.

The workflow was stopped before its last verifications and its synthesis. The fix lanes reproduce each finding with a failing test before they change anything, so the rest of those checks repeated that work. The owner noted the time spent on the docs-only PRs: seven of the fourteen were docs or dependencies, and their 35 findings took about 55 of the first 170 agents.

**140 findings:** 1 high, 7 medium, 85 low, 37 nits, 10 owner's calls.
- **The high (x-rel#0)** was only that 1.7.0 wasn't set yet: the release prep.
- **The mediums came down to four problems:**
  1. **#332 turned a wrapped sum into a lock** (x-overflow#0, x-upgrade#0). Since #332, core's arithmetic is checked in the store module, and a trap there locks the wallet. `eval::resolve` summed a row's token quantities with a plain `+=`, so a pool row listing its NFT twice past a u64 trapped at every pool read. A row 1.6.0 had kept, which verified then only by wrapping, would lock 1.7.0 at every read, Koios-only on or not.
  2. **#336 met chunk 34's launch** (x-merge#0). A pool's start refused a copy only of pools Koios had confirmed, so a pool the data layer listed but Koios hadn't confirmed could be started again.
  3. **#336's new Koios requests weren't in the store's words** (x-rel#1): the listing, its host permission box and the policy's summaries. And a trap under the check could be swallowed with every test green (x-mut-ts#0).
  4. **The required check didn't bind the owner's own merges** (pr331#0, x-rel#2). The classic rule doesn't bind admins, and every merge since #325 was an admin bypass.

## The overflow sweep

#332 changed what an unchecked sum does, so a separate workflow swept core, koios and crypto for every one a row could reach: four sweepers by area, then a verifier per site. It found two more, each reached again at every unlock, on a lying index's rows:
- `lovejoin` `withdraw_with`'s private payer, in Bring every box back now's loop;
- `orders::build_cancel`'s keep, in a stopping session's Splash cancel.

The public Send's `held` sum and `holding()`'s, which the lead suspected, are bounded: both see only UTxOs that `fitting`'s checked merge admitted. Over 150 others are bounded by construction, each with its reason in the sweep's reports.

## The fixes

Run in a git worktree beside the tree, so the review's verifiers kept reading an unchanged one. Seven code lanes by file ownership, each fix test-first, then two docs lanes once the code was in. A review across the merged fixes followed, in four lenses (the worker and money, the screens and words, the tests by reverting each fix in a copy, the docs against the code). Its 17 findings, all low or nits, were each fixed by its lens's fix-up.

| Lane | What | Outcome |
|---|---|---|
| rust | every overflow site refuses in words or can't overflow (`eval::resolve`, `withdraw_with`, `build_cancel`, `apart` in u128); a test fails if the `wasm-release` overrides go; a WebAssembly node test of a doubled NFT | 10 fixed, 2 not bugs |
| pools | #336's check no longer holds pool reads (only a look waits), asks once, reads the pool's own rows from Koios (`utxo_info`), locks the wallet on a trap; the launch's copy check reads the data layer's last list (`lastListed`, its own words: `lj.launch.copyListed`) | 7 fixed, 2 in part |
| tail | #337's line true in every state that offers it; the press in turn with the runner; on a page brought back by hand, the return's review; the stop reason; no empty row before the hour | 20 fixed, 3 not bugs |
| stepper | #335's stepper never past the last part, a review built again opens on its first, nothing of one part shows under the next | 5 fixed |
| bootstrap | #333's tests bind (the cap's search, the reserve under other fees, the WebAssembly export, the flows' funding) | 7 fixed |
| traps | a trap under the alarm's pump and returns locks the wallet, and a chain it stopped reads as cut | 2 fixed |
| ci | *Web Wallet required* sees renames, other bases and over 3,000 files; a read-only token | 4 fixed |
| docs | the policy, privacy.md, the listing, architecture.md, flows.md, development.md, the 1.7.0 list | 52 fixed |

Of the 144 outcomes (some findings sat in two lanes): 106 fixed, 10 in part, 14 owner's calls, 7 deferred, 7 not bugs.

## The release prep

- **Lists:**
  - tokens unchanged;
  - the DReps refreshed;
  - **mainnet's head start gained its first pool,** a 5 ₳ pool. That broke a test that assumed mainnet had none, as x-rel#3 predicted. A mainnet mix that makes mixes now reserves for the collateral's mix, as 1.6.0 wallets already did, since our server lists the pool.
- **Translations:** the two critical values the fixes changed (`lj.tail.privacy.wayOut`, `settings.koiosOnly.privacy.off`) and the listing's new Koios clause were back-translated blind in Spanish and Japanese, a fresh agent each with no English. There was no drift.
- **The registry:** the 5 ₳ pool's four scripts were added to the owner's fork of Strica's registry, for Cardanoscan's names (#339's step). Sending them is the owner's.
- **The required check:** the owner's ruleset on `main` requires *Web Wallet required*, with nobody on its bypass list (item 2).

## The live run

A preprod-only dev build of this tree, with wallet B in its 1.6.0 profile, so the update from 1.6.0 ran too. giveme.my was blocked in the driver, to hold the collateral's mix as giveme.my being down would. Every transaction was read back from Koios.

| What | Transactions |
|---|---|
| **A private Bootstrap (#333):** one 13 ₳ payment (11.5 ₳ and the 1.5 ₳ way back, priced from the parameters); a 10 ₳ box in the classic pool; the change swept back into Seedelf with nothing put up. The same figures as 1.6.0's | `22247bbb…`, `92ced70f…`, `ac6ca81e…` |
| **A private mix held at its collateral's mix (#337).** Its 15-minute idle lock struck twice during the hour. After the first, the offer stayed (the lock-cut branch). The second cut the mix's rebuild, its last try (`TAIL_TRIES`), so once the unlock's pause ended the session brought its rest back by itself, the 5 ₳ box left in the pool unmixed: 1.6.0's fallback | `2df09bca…`, `c36dc417…`, the mixes `9e5a7c66…`, `db9a769f…`, `00a07112…`, `96c2d287…`, the tail's deposit `919d036d…`, the return `0bc3743f…` |
| **Bring the rest back now, pressed on the page (#337)**, on a copy of this build with the hour shortened to 2 minutes and the idle lock at 60. The offer appeared on the mix card at its time without a refresh, under the new line. The press stopped the chain at the mix ("You chose not to wait for the collateral's mix…") and sent the return in its own request, under the session's own collateral, with nothing asked of giveme.my. The return merged into the funding's change, as returns have since chunk 16. The 5 ₳ box stays in the pool unmixed | `86f8346b…`, `d4efd932…`, `a4ca86b4…`, the tail's deposit `864c2d44…`, the return `d1dd60e4…` |
| **#336's Koios check, against mainnet's real data layer and Koios** (read-only, a throwaway test). The 5 ₳ pool, hidden from the head start, was kept once Koios answered `utxo_info` and `tx_info`; no pool read showed it before | none |
| **The release harness:** `e2e/live/run.mjs all`, six transactions, all confirmed. Then the staking flows. `staking`'s preset stopped at *vote abstain*, since B's vote already went there and the wallet rightly offered no review. So it ran as *stake TPREP*, *vote no confidence*, *stake LOGIC* and *vote abstain*, all confirmed, which left B as it was; the preset now votes no confidence first. Only `preprod.koios.rest` and `www.giveme.my` were contacted | all: `180b5d8f…`, `ebc23f83…`, `e997ac2c…`, `bee295c3…`, `89892672…`, `caeecd1e…`; staking: `6a133e75…`, `ab879c1c…`, `9e2993af…`, `ba9c9039…` |

The full hashes, in order:
- **Bootstrap:** `22247bbb506dd692f3b3b88f1317d472c98a44bc963c1a4ad0ad8348200e5904`, `92ced70f03a95142260a3af1915b26122b6777b38a22cf5eaac35e73db7eef59`, `ac6ca81e966c66be0531630ff660269766fc0387d8d7f29e634b036719706e37`.
- **The held mix:** `2df09bcab0fd6004a67582d4880bb90951aaf0df2992cd9873c79f300b16e95f`, `c36dc4176090bd166036e3abe4812bc46e500e31725c5c22823284ac570479f6`, `9e5a7c661e0297037a25b0293e36b0627f01e7119b2f901721eb8efe700dc4c2`, `db9a769f8f7c040c00aa9e1bd8e5e4e8442638f5b620fcfac8aabad906c3dd6c`, `00a07112f699e2188e1c10682024237510a319270cdab587f41f32cb3128747b`, `96c2d287819eed69ef41e661a0919643654a82ab494b26c7669f6552cfe6bacd`, `919d036d951842aa721b3860ac9b4422065a24f837107e2cb0678118dd911bc3`, `0bc3743f4ded30562033179adde1f40c14000104cdcafa65dbbd2cc7e2dc59e1`.
- **The press:** `86f8346b706133a171f21c45e1c3293043633cc3cc395894620bc0548503ba33`, `d4efd932571945668e0044e1c701bf734ba6b0634fc7eacfca857f0e3ba8e791`, `a4ca86b4946f6d466d1cdf0dca6efc8c13b1c11741a19214f3b2477d2d916438`, `864c2d444fdafd50db9223beb46ae664c26d64bcacec6311a6a892a26fb9c863`, `d1dd60e4aa009b7d99c4c2afb14df215e725724f3ee9ee1ee71200cf2ff02795`.

**What the live run found (LIVE-1, an owner's call).** A lock cuts a held collateral's mix, and the cut counts as one of its two builds (`TAIL_TRIES`). So while giveme.my is down, two idle locks end the mix early, though `TAIL_KEEP_MS` holds it up to a day, and the rest comes back with the 5 ₳ box unmixed. The user isn't asked, and the hour's offer may never show. The recommendation: count only the builds that failed for another reason (giveme.my refusing, a box gone), so a lock no longer uses one up.

## The checks

On the fixes' tree, then the final one (rebased on #339, with the head start's test fixed):
- Rust: fmt, clippy `-D warnings`, and 692 tests, with the release's ignored `payment_parts_shapes_test` in a release build.
- The WebAssembly rebuilt (`C compiler: Ubuntu clang version 21.1.8 (6ubuntu1)`), and `node --test` 59.
- `tsc` clean.
- Vitest: 2,955 on both builds, on the final tree.
- e2e: 104/104 on the dev build and on the store build, and the data layer's 3. The one e2e test the fixes edited passed 5 times in a row under a 2-CPU load, on both builds.
- Before the review, on `6bca8bec`: Rust 684, Vitest 2,909 on both builds, and e2e 104 and the data layer's 3, the first time that tree ran as one.

## Lessons

- **Tier the verification by stakes.** Two refuters on every low of a docs-only PR cost about two hours ahead of the code PRs' checks. Docs and dependencies get one reviewer; code PRs' mediums get two refuters, their lows one.
- **A profile change is a sweep, not a review item.** #332 changed what every unchecked sum in three crates does. The reviewers found one site and the lead suspected two more; a sweep by construction found two others the reviewers hadn't, and showed the lead's two bounded.
- **Run the release's refreshes before the checks.** The head start's first mainnet pool changed what a test expects, exactly as a finding predicted.
- **A live run longer than the idle lock is a run with locks in it.** Two 15-minute idle locks in the hour's wait used both of a held mix's builds; that's how LIVE-1 was found, and why the press ran on a copy with the lock at 60. And a harness preset that makes a change the wallet already has (a vote already at abstain) can't run twice on one wallet.
- **The critical-words gate checks key names, not values.** A changed critical value passes CI with no back-translation. The lead's step caught this round's; a value hash beside each verified key would make the gate catch the next (an owner's call, after 1.7.0).

## The IDs

The code, the tests and the docs cite these by ID. Their full text is in git at `e8b007f8`, under `seedelf-platform/seedelf-web-wallet/docs/plans/review-1.7.0/`. For example: `git show e8b007f8:seedelf-platform/seedelf-web-wallet/docs/plans/review-1.7.0/FINDINGS.md | grep -n -A40 '^## x-merge#0$'`.

| IDs | What | File at `e8b007f8` |
|---|---|---|
| `<PR>#<n>` (e.g. `pr336#0`), `x-<lens>#<n>` | the review's 140 findings, cited as "1.7.0's release review, …" | `FINDINGS.md`: each with its verdicts and outcome; `reports/<id>.md`, `verify/v-<id>-<n>-<trace\|impact>.md` |
| the overflow sweep's sites (`withdraw-private-into-register-1392`, `splash-cancel-keep-901`) | the sweep of core, koios and crypto | `verify/ovf-sweep-<area>.md`, `verify/ovf-verify-<area>-<n>.md` |
| a lane's name (`pools`, `tail`, `stepper`, `bootstrap`, `ci`, `traps`, `rust`, `docs-design`, `docs-roadmap`) | each lane's report: its findings, tests, calls | `fixes/<lane>.md`, and `FIXBRIEF.md` |
| `worker#<n>`, `screens#<n>`, `tests#<n>`, `F1` … `F8` | the review across the merged fixes, and its fix-ups | `fixes/review-<lens>.md`, `fixes/fixup-<lens>.md` |
| `LIVE-1`, cited as "1.7.0's live run" (1.6.0's own `LIVE-1` is another) | the live run's finding | this file's [The live run](#the-live-run) |
