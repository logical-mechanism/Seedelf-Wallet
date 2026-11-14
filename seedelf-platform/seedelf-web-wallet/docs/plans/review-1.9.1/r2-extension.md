# r2-extension (r2-extension)

1 finding(s).

## r2-extension#1: wallet.test.ts: "changes the password" times out at Vitest's default 5 s under two-CPU load; the vault check, with less work, got 20 s

- **Severity:** low; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/extension/tests/wallet.test.ts:301`
- **Since:** older (the test predates 1.9.0; c3d24629 gave only the vault check its own timeout)

**What.** The structural vault check holds (see checked_ok), but under the brief's own load another test in the same file fails. `it("changes the password: the new one unlocks, the old one doesn't", …)` (wallet.test.ts:301) has no timeout of its own. vite.config.ts's `test` block sets none, so Vitest's 5 s applies. The test runs seven Argon2id derivations in pure JS (@noble/hashes argon2idAsync, `SBV1_ARGON2ID = { m: 19_456, t: 2, p: 1 }`, kdf.ts:18): create's seal; changePassword with a wrong password (openWithPassword); changePassword's open and seal; unlock with the old password; unlock with the new one; revealPhrase. c3d24629 gave the vault check `}, 20_000);` (wallet.test.ts:57, "An Argon2id seal and an open: slow on a busy machine") for two derivations, and left this test at 5 s. "backs off after wrong passwords" (wallet.test.ts:102) is next: five derivations, also at 5 s. This affects tests only, not anything a user sees.

**Scenario.** A unit-test run on a slowed machine or runner. Pinned to CPUs 0 and 1 (`taskset -c 0,1`) with two busy loops on each CPU, "changes the password" failed with `Test timed out in 5000ms` in 3 of 3 runs, at 5202, 5239 and 5119 ms. The vault check passed in 2049–2150 ms. CI's `npm test` on ubuntu-latest is closer to my parallel run (2.28 s), so the test flakes only when a runner is about 2.5 times slower than that.

**Evidence.** Script SCRATCH/review-1.9.1/r2-extension/vault-stress.sh: `taskset -c 0,1 npx vitest run tests/wallet.test.ts --reporter=verbose`, with N `taskset -c <0|1> timeout 1800 bash -c 'while :; do :; done'` loops, in my worktree at 23ca5f20 (identical extension and wasm/pkg). Times for "changes the password" / the vault check:
- 0 loops: 2099, 2067, 2147 / 781, 776, 727 ms, 27 passed (stress-nohog.log)
- 2 loops: 4028, 4088, 4039 / 1508, 1353, 1465 ms, 27 passed (stress-2hogs.log)
- 3 loops: 4972, 4313, 4326, 4853 / 1633, 1692, 1772, 1541 ms, 27 passed (stress-3hogs.log)
- 4 loops: `× changes the password … 5202ms → Test timed out in 5000ms.`, 5239 and 5119 ms likewise, `Tests 1 failed | 26 passed (27)` each time, vault check 2113, 2049, 2150 ms (stress-4hogs.log). Under the same load "backs off after wrong passwords" took 4386–4432 ms.
- Beside 5 parts files, 3 workers on 2 CPUs: 2278 / 1257 ms, 89 passed (stress-parallel.log).
KDF count from wallet.ts: changePassword = openWithPassword + `sealVault(entropy, next)` (wallet.ts:449-458); openWithPassword = `openVault` (wallet.ts:742).

**Suggestion.** Apply the vault check's reasoning to the heavier tests. Give "changes the password" and "backs off after wrong passwords" `}, 20_000)`, or set one timeout for the whole file. Rerun the file under vault-stress.sh with 4 loops before CI.

## Checked and holds

- Q1, who reads whole()'s minimum (script-spend.ts:507): only Transfer's and Withdraw's reviews, through amountText on the amount row (Transfer.tsx:193, Withdraw.tsx:179) and MinimumNote (Transfer.tsx:256, Withdraw.tsx:235). The funding review (PaidRows, DappApprovals.tsx:790), the swap, Lovejoin and top-up reviews read none. MoveIn and Send from the account read their own one-transaction minimum. No worker code reads it.
- Q1, a review in parts with a part of ADA alone (the bounty's plan run through whole() and the two UI pieces): it now shows '3.87 ₳' and no note, whether asked 0 or 2.913 ₳. The old rule gave '3.87 ₳ is the least ADA the network accepts with these tokens.', or '3.87 ₳, raised from 2.913 ₳' with 'Raised from 2.913 ₳: …'. The review is no longer false, but nothing explains the extra ADA except a total above what was typed. No real plan here or in round one has such a part.
- Q1, ADA alone in parts with the real WebAssembly through the worker (40 × 25 ₳ for 600 ₳, 60 × 1.6 ₳ for 40 ₳, to a Seedelf and to an address): the first part is a 'most' part with no minimum, so the old and new whole() both give null. The review shows '600 ₳' or '40 ₳' with no note, as before. Nothing relied on the old figure: payment-parts.test.ts:126 and e2e's 'Transactions2' are unchanged.
- Q1, tokens in parts with the real WebAssembly: 61 and 90 boxes of 100 MIN at 4.5 ₳, and 31 boxes, 16 reviews in all. Asked 50 ₳ shows '50 ₳' with no note, now that shapes#1's fix reaches the review: to a Seedelf, 46.7244 + 2 × 1.6378, and 43.4488 + 4 × 1.6378 for 90 boxes. Asked 3 ₳ shows '4.9134 ₳, raised from 3 ₳' and 'Raised from 3 ₳: 4.9134 ₳ is the least ADA the network accepts with these tokens.' (8.189 ₳ for 90). Asked 0 shows that least's note. The old and new whole() agree on all 16 rows (minimum-rows.json).
- Q2, round one's run (a) through the worker with the real WebAssembly: a site funding (dapp.privateBuild) of 12 bundles of 20 at their least (7.327 ₳ each) plus one UTxO of 1.45678 + 3 ₳, all 240 tokens, asked 0, so 82.18308 ₳. It goes as 2 parts with no wait. Part 0 has 7 inputs: changeLovelace 1.50289, which is its kept carry, and changeOutputs 1. Part 1 spends 6 bundles: change 2.085198. The review's change is 3.588088 ₳, equal to the decoded wallet outputs that no part spends. The note reads '…and its 3.588088 ₳ private change, to the one-time account.' (2.085198 without carry_kept). The balance after, 92.38078 − 88.792692 = 3.588088, agrees.
- Q2, the other consumers of changeLovelace and changeOutputs, none of them changed or made false: Transfer's Max-kept note (Transfer.tsx:250) is Max only, carry_kept runs only in the amount plans, and max_chained's last part spends its carry. Also unaffected: short.ts (Max and most), TotalRows (payments + fee), activity.sent (payments and fee), each part's sealed origin (from its inputs), carried, spentTogether, tokensKept and reviewParts (inputs), incoming.ts and tx-view's markYours (the transaction's own outputs). Nothing shows changeOutputs or changeMinimum for an amount. The swap and Lovejoin funding reviews show no change figure.
- Q3, the structural vault check (wallet.test.ts:42-50) is right. Create writes only seedelf.vault, and every write is awaited (wallet.ts:257-275). The record is exactly {version, blob}, and the blob opens to the phrase's entropy. Mutants in my worktree were all caught: words added to the record (keys [blob, version, words]), sorted words under a second key (keys [seedelf.vault, seedelf.notes]), and the phrase's text sealed instead of the entropy (the bytes differ). It searches nothing random, so it can't fail by chance.
- Q3, the vault check's time against its 20 s: 0.73–0.78 s pinned to two CPUs, 1.35–1.51 s with one busy loop per CPU, 1.54–1.77 s with 1.5, 2.05–2.15 s with two, and 1.26 s beside 5 WebAssembly-heavy files. That is at most 11% of its timeout.
- Q4, 18 files run in the release tree: payment-parts, payment-parts-chain, payment-parts-review-fixes, parts-send-review-fixes, session-funding-parts, site-funding-parts, wallet, max-left-review-fixes, restore-scan, sessions-review-fixes, chain-requests, screens-wiring-review-fixes, transfer, withdraw, dapp-prompt, site-funding-seen, dapp-chain-collateral and lovejoin-planner. All 380 tests passed on the default build (296 s) and with VITE_ENABLE_MAINNET=false (302 s); a probe confirmed __MAINNET_ENABLED__ is false there.
- Q4, the whole suite on both builds: 263 files passed and 1 skipped; 3306 tests passed and 4 skipped (407 s and 343 s, 6 workers). tsc --noEmit is clean at 23ca5f20. No failures to report.
- The new test in payment-parts-review-fixes.test.ts:184 fails on the old rule (minimum 3870000, not null) and passes now. Its second case passes either way, as a guard.
- Docs: architecture.md's 'Its least … only where every part sends tokens', privacy.md's 'a funding's note names it among the private change tied to the one-time account' and wasm/README.md's 'A carry no later part spends is its part's change (changeLovelace, changeOutputs)' all match the code and run (a).

## Coverage

Read: script-spend.ts (whole, PartBuilt, carried, spentTogether, tokensKept, keepParts), transfer.ts, withdraw.ts' use of whole, sessions.ts (buildFunding, siteOutBuild, the mix funding, fundingRecords, sendFunding), the Transfer and Withdraw review screens, AdaInput (amountText, MinimumNote), DappApprovals (the funding review, fundingPrivacy, FundingWayBack), the Swaps review, PaidRows, activity.ts (sent, classes), tx-view's markYours, incoming.ts' rules, short.ts' use of change, parts.ts' reviewParts, wallet.ts (create, changePassword, openWithPassword), vault.ts, kdf.ts and SecretBox's format. On the Rust side: lib.rs' build_transfer_parts, build_withdraw_parts, in_parts, chained, reserving, carry_kept, max_in_parts, max_chained, transfer_result and withdraw_result.

Ran, in my own worktree at 23ca5f20 (node_modules linked entry by entry, the release wasm/pkg copied, sha256 905a5205…):
- zz-r2ext-carry.test.ts: run (a) through dapp.privateBuild, each kept part decoded with wasm.decodeTx.
- zz-r2ext-minimum.test.ts: 16 Transfer and Withdraw reviews in parts, rendered.
- zz-r2ext-synthetic.test.ts: the bounty's plan through whole() and the UI pieces.
- zz-r2ext-env.test.ts: the build flag.
- vault-stress.sh, the vault mutants, and tsc.

In the release tree: Vitest only, as the brief allows.

Everything is in SCRATCH/review-1.9.1/r2-extension/: the four test files, run-a.json, minimum-rows.json, the stress-*.log files, and vitest-{default,preprod,full-default,full-preprod}.log.

Not done:
- #384's end after a carry (path (b)) through the worker. Round one reached it only from a constructed chain state, and the lead's lib.rs test covers it.
- Playwright (not run, per the brief).
- A before-fix wasm build to run the same funding through the worker. The before figure, 2.085198 ₳, follows from part 0's change being 0 without carry_kept, as in chain-rust's 3063b33f run.
- Swap and Lovejoin mix fundings with a kept carry, and Transfer or Withdraw of run (a)'s shape. I read these but didn't drive them; none shows a change figure.
- Which file the full suite skips. It is the same file on both builds.

The worktree is removed and I made no cargo target. Nothing was written in the release tree except Vitest's cache under node_modules/.vite. The brief's report.md wasn't written, per R2BRIEF (StructuredOutput only).
