# Lane R2tests

Returned by the workflow's agent `a315d82ce4d26ee45`, written here by the lead from its structured answer.

## Findings (10)

### r2tests#1 · low · d1#3's sign-window warning for a payment into Seedelf under a dead register has no test: drop it and the whole Vitest suite passes

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:1212`
- **Who:** site · **Since:** d9e015fb · **Confidence:** confirmed-by-run

**Scenario:**

A site asks the wallet to sign a payment into Seedelf Wallet's contract under a register no proof can meet, for example a 47-byte generator or an identity generator. The money is locked for good. The WebAssembly marks that payment seedelf: "dead", and that part is pinned. The window's only words about it are the dapp-seedelf-dead callout (dappUi.warn.deadRegister); otherwise the Pays list just says "Seedelf Wallet's contract". I changed the callout's condition so it never shows, and all 3,548 Vitest tests passed. A refactor that drops or misroutes this warning would ship green, and the user would sign the amount away with no word that nobody can ever spend it. The two sibling callouts in the same block (dapp-seedelf-unsafe for "none", dapp-seedelf-payment for "register") have no test either; those gaps predate this round.

**Evidence:**

Copy: git archive of FIXTREE HEAD 10a06db6 plus its wasm/pkg (built 04:06), in ~/.cache/seedelf-review-51/r2tests. Mutant: DappApprovals.tsx:1212 `s.paid.some((p) => p.seedelf === "dead")` -> `=== "never-dead"`. Full `npx vitest run`: Test Files 1 failed | 287 passed; Tests 2 failed | 3548 passed. The only failures are i18n.test.ts's two machine-draft checks, which also fail on the clean head (23 critical keys still marked machine). grep finds no unit or e2e test that mentions dapp-seedelf-dead or dappUi.warn.deadRegister; the only hit, stake-elsewhere-screens.test.ts, checks TxDetail's tx.out.deadRegister. The WebAssembly half is pinned: Spender::Nobody => "none" at cip30.rs:1303 fails cip30_test a_payment_into_seedelf_says_who_can_take_it.

**Fix:**

Add a dapp-prompt.test.ts case using its SignTx render helper (:77) with paid entries for seedelf "dead", "none" and "register", and assert each callout's text. That covers the whole class: every s.paid.some(...) callout in SignTx.

**Known check:**

Searched review-51 INDEX.md, fixes/G3.md and G5.md, data/R2*.json (r2sign#1 is about which datum shapes count as a Seedelf payment, not about this callout's test) and docs/backlog.md for deadRegister, dapp-seedelf and "dead".

### r2tests#2 · low · x1a#1/e9a#3's form notes on Send and Make public (stake works elsewhere) have no test; only the reviews' lines are pinned

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/CardanoSend.tsx:312`
- **Who:** stranger · **Since:** 8fd738ff · **Confidence:** confirmed-by-run

**Scenario:**

A stranger hands the user an address with the user's payment key and the stranger's stake key, presented as the user's own. When it is pasted into Send, or into Make public (Withdraw.tsx:322), the form's note (send-stake-elsewhere / withdraw-stake-elsewhere) says its stake works for someone else. That is the earliest point the wallet says so. I turned both form notes off with `&& false`, and the whole Vitest suite passed (3,548). Only the review's per-payment lines are pinned (CardanoSend.tsx:254 and Withdraw.tsx:253, which fail stake-elsewhere-screens.test.ts). The fix commit claims both forms and reviews.

**Evidence:**

Mutants UI-a (CardanoSend.tsx:312) and UI-c (Withdraw.tsx:322): `read.destination.stakeElsewhere && (` -> `... && false && (`. Run alone, stake-elsewhere-screens.test.ts gives 5 passed for each. Full suite with both applied: Tests 2 failed | 3548 passed, the 2 being the head's i18n machine-draft checks. Controls: UI-b (CardanoSend.tsx:254) fails 2 tests and UI-d (Withdraw.tsx:253) fails 1. No test or e2e spec references the send-stake-elsewhere or withdraw-stake-elsewhere testIds.

**Fix:**

Extend stake-elsewhere-screens.test.ts to render Send's and Make public's form with a read destination that is own and stakeElsewhere, and assert the note and its words.

**Known check:**

Searched INDEX.md (x1a#1, e9a#3), data/R2screens.json and R2sign.json, and the test tree for the testIds.

### r2tests#3 · low · e8b#2's sibling: Create Seedelf's review line for withdrawn rewards has no test

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/CreateSeedelf.tsx:150`
- **Who:** user · **Since:** 8fd738ff · **Confidence:** confirmed-by-run

**Scenario:**

With "Use staking rewards when spending" on (the default), Create Seedelf's account payment withdraws the account's rewards, and its review's RewardsRow says so. The fix commit names this as e8b#2's sibling. I removed the row and the whole Vitest suite passed. Its twin on the Collateral page (Collateral.tsx:207) is pinned by collateral-review.test.ts.

**Evidence:**

Mutant UI-w: remove `<RewardsRow withdrawal={summary.withdrawal} />` at CreateSeedelf.tsx:150. screens.test.ts and collateral-review.test.ts: 76 passed. Full suite: Tests 2 failed | 3548 passed (only i18n's machine-draft checks). Control: the same removal at Collateral.tsx:207 fails collateral-review.test.ts.

**Fix:**

Add a case to collateral-review.test.ts or hide-balances-forms.test.ts that renders Create Seedelf's review with summary.withdrawal set and asserts the rewards row.

**Known check:**

Searched INDEX.md (e8b#2) and the tests for CreateSeedelf, RewardsRow and withdrawal.

### r2tests#4 · low · e4a#1's accounts.ts siblings: the merge's and check()'s phrase pins have no test, though the fixer's report says each sibling fails its own case

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/accounts.ts:288`
- **Who:** user · **Since:** 2b3dfd80 · **Confidence:** confirmed-by-run

**Scenario:**

Account discovery for phrase A is waiting on Koios for its last probe, the one Koios answers "never used". A Settings "check account N" (accounts.ts:328) can be in the same state. Meanwhile Remove wallet and a restore of phrase B finish. When Koios answers, the pin should end the look as a lock does. Without it, A's found indices are kept into B's known-accounts record, and B's wallet lists and reads accounts its user never added: Koios is asked about B's account-N stake address. I replaced merge's pin with a no-op (E-a4), and separately removed check()'s pin (E-a8). Either one, or both together, passes the whole Vitest suite. accounts-restore-look.test.ts holds the phrase change over the first probe, so the next probe's used() pin throws before merge runs. Nothing changes the phrase during check().

**Evidence:**

E-a4: `this.merge(found, pin)` -> `this.merge(found, () => "")` at accounts.ts:278. E-a8: drop `await this.deps.wallet.withKeys(pin);` at :328. Each one gives 24 passed across remove-wallet-reading, accounts-restore-look and remove-wallet (51 passed with accounts.test.ts and accounts-switch-reading added). The full suite with E-a4, E-a8, E-d2 and r2tests#1's mutant applied: 3548 passed; only the 2 i18n checks fail. Control E-a9 (used()'s pin dropped) fails accounts-restore-look: `promise resolved "[ { index: 1, foundAt: 1800000000000 } ]" instead of rejecting`. With used() unpinned, merge's pin never catches it, because phrasePin() pins to whatever phrase it first sees. G6.md says: "each sibling reverted alone fails only its own case; accounts-restore-look.test.ts, remove-wallet.test.ts". That holds for account.ts, pending.ts settleNow and balances.ts (E-a2, E-a3, E-a5 to E-a7 all caught), but not for these two.

**Fix:**

Add two accounts-restore-look.test.ts cases. First, hold the probe that Koios answers unused (the index after the last used one) across reset, useFirst, create(B) and recordFirst. Second, hold check(network, n) the same way. Assert each promise rejects with the lock's words and B's list is still [0].

**Known check:**

Searched fixes/G6.md, INDEX.md (e4a#1, e6#2) and data/R2time.json. r2time#2 is about other writes after a submit, not these pins.

### r2tests#5 · low · r2a#2's error half (failed && !short_whole) is caught by no suite, the ignored parts suite included

- **Where:** `seedelf-platform/seedelf-core/src/build.rs:2874`
- **Who:** stranger · **Since:** c1c5b13a · **Confidence:** confirmed-by-run

**Scenario:**

Take a payment whose UTxOs together are short, for example the user's ADA beside a stranger's token piles that cost more than they add. Suppose another order runs into the transaction's size or budget limit. With `failed && !short_whole`, apart refuses with NotEnough, as it did before the fix. Revert that to `failed` and apart returns the size failure instead. In the WebAssembly, build_transfer and withdraw (lib.rs:3209, :3608) fall back to measured_or_more only on build::is_short, and the parts planner (:4106-4271) branches on it too. So a short payment would read as a hard failure there, with a size message (plausible; I didn't build that shape). I reverted only that half (M2b): every non-ignored suite still passes. The search half (M2a) fails apart_test.

**Evidence:**

M2b: `Err(match (failed && !short_whole, other, not_enough)` -> `(failed, other, not_enough)`, with short_whole still set. `cargo test -p seedelf-core`, `-p seedelf-wasm` and `-p seedelf-cli` all exit 0. Ignored parts suite in release (`payment_parts_shapes_test -- --ignored`): the head run twice, and M2b once, each gave `0 with problems, 108 refused, 0 of them Max`. Against the head, M2b's 592 lines differ only by 0.01 ₳ on Max lines, and the two head runs differ from each other the same way. Control M2a (the `Grown::Short if whole => { failed = false; break; }` revert at :2860) fails apart_test a_bundle_that_costs_more_than_it_adds_never_stops_what_the_clis_order_pays.

**Fix:**

Add an apart_test case: everything together is short, and one order fails by TooLarge or budget (for example, enough token UTxOs sorted first to pass the size limit). Assert build::is_short(&err) and the short words.

**Known check:**

Searched fixes/G1.md (its parts-suite claim is the only evidence for this half), INDEX.md (r2a#2, r2a#3) and data/R2money.json.

### r2tests#6 · low · v3#1's fix (a failed rebuild never reads as ok) has no committed test: drop tally.py's traceless-import rule and nothing notices

- **Where:** `seedelf-verification/tally.py:113`
- **Who:** nobody · **Since:** 40883a55 · **Confidence:** confirmed-by-run

**Scenario:**

The v3#1 fix makes tally.py and Audit/count.py (hole(), :79/:106) call a module not ok when it rests on a module with no trace. It also makes check.sh's forget() (:215) remove a failed module's build. No test or workflow in the repo runs these scripts, and the verifier's repro wasn't committed. I built a fake package: Lib/A imports Lib/B, A has a trace newer than its source, B has none. The head's tally.py reports "NOT OK Lib.A: rests on Lib.B, which has no trace" and "2 not ok". With that one problem line removed, it reports "1 not ok" and reads A as ok. That is exactly v3#1's failure, and no check would catch it coming back.

**Evidence:**

In SCRATCH/r51/work/R2tests/vpkg: Lib/A.lean (`import Lib.B`), Lib/B.lean, and .lake/build/lib/lean/Lib/A.trace = {"log": []}. Ran `python3 -I tally.py Lib` with the head's copy, then with `(f"rests on {under}, which has no trace", under is not None),` removed. Output: `== Lib: 2 modules, 0 Valid, 0 Expected Falsified, 2 not ok` vs `... 1 not ok`. grep finds no test or workflow that names tally.py, count.py or check.sh's forget. I couldn't exercise the Lean-side parts of 40883a55: v4a#1/v4b#1's controls, v5#2's SORRY verdict and the guarded #print axioms.

**Fix:**

Add a small `python3 -I` test that builds a fake .lake tree in a temp dir. It should check tally.py and count.py's hole() (traceless import, unreadable trace, sorry line) and check.sh's forget() against a fake failed build log. It runs in milliseconds, with no Lean.

**Known check:**

Searched data/R2verif.json (r2verif#3 is a coverage gap in the fix itself, not its test), INDEX.md (v3#1) and fix-branches.md; there is no G10 report in fixes/.

### r2tests#7 · low · New test private-index.test.ts 'is neither the wallet's nor a Seedelf's place' runs 3 to 6.4 s in its own file against Vitest's default 5 s, and times out with nothing wrong

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/tests/private-index.test.ts:344`
- **Who:** nobody · **Since:** 6aea4fb8 · **Confidence:** confirmed-by-run

**Scenario:**

Run alone, the test takes 0.23 to 0.56 s. After the file's first describe (14 tests), it takes 2.8 to 6.4 s. Neither vite.config.ts nor the test sets a timeout, so Vitest's 5 s applies. On this machine it timed out in 2 of 10 whole-file runs at load 4 to 12, and in 5 of 5 at load about 2. It passed inside the four whole-suite runs. So `npm test` on the branch head can go red with nothing wrong. It also hides what it guards: under the P1, P2, P3 and P5 mutants it failed only by this same timeout. With a 60 s limit it fails P3 and P1 by assertion (`expected { …(13) } to be undefined`).

**Evidence:**

`npx vitest run tests/private-index.test.ts --reporter=verbose` at the clean head. At load 4-12: 3283, 2818, 3207, 2964, 3152, 3005, 2935, 2851 ms, plus two runs that hit 5004/5005 ms and timed out. At load 1.6-2.3: 5004, 5004, 5007 ms (all timed out); with -t over the first describe, 5006 ms; with --testTimeout=60000, 6106 ms and (P3) 6402 ms. With -t on this test alone: 561, 533, 571, 324 ms. After just one other test ('reads a restore…' or 'seals nothing…'): 231 and 245 ms. The test's sleep is a no-op (fakes.ts:719), so the time is CPU work that grows with the tests before it. git log -S shows 6aea4fb8 added it.

**Fix:**

Give it an explicit timeout, as this round's slow tests already have (`{ timeout: 30_000 }`). Then find what the first 14 tests leave behind that slows its readContractView; the likely suspect is WebAssembly objects that are never freed. Checking the class: no other new test sits near 5 s inside its file.

**Known check:**

Searched INDEX.md, fixes/*.md (G4's note is about its own 20 to 30 s limits) and data/R2*.json for flak, timeout and private-index. r2still#3 ran with --testTimeout=90000, which hides this.

### r2tests#8 · low · The CLI's two new 'Tx Hash' lines (r4#4's id before sending, and the signing page's id in the terminal) have no test

- **Where:** `seedelf-platform/seedelf-cli/src/commands/submit.rs:26`
- **Who:** user · **Since:** 48a4c977 · **Confidence:** confirmed-by-run

**Scenario:**

r4#4 makes the CLI print a transaction's id before sending it. The point is that a submit Koios never answers can still be looked up if the user stops the run (Ctrl-C) during the 30 s wait. 4c3194f9 prints the id beside the signing page's address (web_server.rs:233). I removed either line and tests/cli/submit.rs still passed, as did the whole CLI suite and signing_page.rs. That's because the may-have-gone error names the id too, and it only appears once Koios answers or times out. Without the first line, a user who stops a hanging submit has no id to check before running again, which is the double payment r4#4 closes.

**Evidence:**

K3e: drop submit.rs:26 `println!("\nTx Hash: {}", id.bright_cyan());`. `cargo test -p seedelf-cli --test cli -- submit`: 2 passed. K10: drop web_server.rs:233's line: signing_page 4 passed, cli 57 passed. Controls: K3d (the MaybeSent message without the id) fails a_submit_koios_never_confirmed_names_the_transaction_it_sent; K3a, K3b and K3c (the SubmitError kinds) fail both submit tests.

**Fix:**

In a_submit_koios_never_confirmed_names_the_transaction_it_sent, assert that the id is printed while the mock still holds the answer (the 31 s delay case) or that the 'Tx Hash:' line is in stdout. In signing_page.rs, assert the run's stdout names the id.

**Known check:**

Searched fixes/G2.md, fix-branches.md, data/R2cli.json and INDEX.md (r4#4, r1#2).

### r2tests#9 · nit · e2b#2's 'nor clears' half (a strangers-only return leaves the skip reason alone) has no test

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:5361`
- **Who:** stranger · **Since:** fdd3b8b2 · **Confidence:** confirmed-by-run

**Scenario:**

A swap session's own return came back directly, with its note on why Lovejoin was left out. Then a later return brings back only a stranger's UTxOs. `if (strangers) return;` keeps that note. I removed the line and the whole Vitest suite passed. The run's two other failures were 5 s timeouts in restore-scan.test.ts and sessions.test.ts while a release build ran alongside; both files pass alone with the mutant (110 passed). The 'nor writes' half (sessions.ts:5241) and receivedOf are pinned by swap-page.test.ts.

**Evidence:**

G4-c3: drop sessions.ts:5361. swap-page.test.ts: 22 passed. Full suite: 4 failed | 3546 passed (i18n x2, plus restore-scan C41/C47 and sessions 'chunk 24, Step 3' with 'Test timed out in 5000ms'). Rerun alone with the mutant: Test Files 2 passed, Tests 110 passed. Controls: G4-c (receivedOf -> s.received) and G4-c2 (skipped ignoring strangers) each fail swap-page.

**Fix:**

Add a swap-page.test.ts case where the session's own return carries a lovejoinSkipped reason and a strangers-only return follows. Assert the reason is still there.

**Known check:**

Searched INDEX.md (e2b#2), fixes/G4.md and data/R2still.json; r2still#2 is about gap-g4#1's leg, not this.

### r2tests#10 · nit · decode_test's big-number test asserts a real-clock bound that adds nothing to the check before it

- **Where:** `seedelf-platform/seedelf-web-wallet/wasm/tests/decode_test.rs:1979`
- **Who:** nobody · **Since:** 36fbb96f · **Confidence:** traced

**Scenario:**

a_big_number_past_128_bytes_is_shown_in_hex decodes a 60,000-byte number, asserts the hex text, then asserts `started.elapsed() < 10 s` in a debug build. The equality already proves the hex path; a decimal would differ, and mutant W9 fails at the 129-byte case first. So the clock assertion can only fail on a slow or loaded runner. The work takes milliseconds today, so the risk is small, but it is a real clock by design.

**Evidence:**

decode_test.rs:1976-1981 (`let started = std::time::Instant::now(); ... assert!(started.elapsed() < std::time::Duration::from_secs(10), ...)`). W9 (the MOST_DECIMAL_BYTES cut-off disabled) fails at :1963 before reaching the timed part.

**Fix:**

Drop the timing assertion, or keep it as an #[ignore] benchmark.

**Known check:**

Searched fixes/G3.md (it gives the native timings this came from) and INDEX.md (w2#3).

## Guards (27)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:412` | A stranger's mix re-spelling a box datum as 102([0,…]) and stranding the user's box (r3a#1) | seedelf-core lovejoin_test a_box_in_constructor_0s_general_form_is_still_the_wallets, a_box_in_the_general_form_mixes_and_comes_back |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:448` | A fake box at the key address carrying mix_box's hash being drawn into chains (x2#1) | lovejoin_test a_key_address_carrying_mix_box_s_hash_holds_no_box, mix_boxs_address_on_the_other_network_holds_no_box |
| `seedelf-platform/seedelf-core/src/build.rs:2860` | apart refusing a payment a subset pays (r2a#2's search half) | apart_test a_bundle_that_costs_more_than_it_adds_never_stops_what_the_clis_order_pays (its error half at :2874: none, r2tests#5) |
| `seedelf-platform/seedelf-core/src/build.rs:2210` | Signing an account-collateral transaction whose collateral return falls under an output's least | merge_test an_account_collateral_whose_return_falls_under_its_least_is_refused |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1772` | A paid withdraw's account change under its least at the settled fee; and the first-round 0.5 ₳ guess refusing a payer coin the ledger takes | lovejoin_test a_paid_withdraw_keeps_the_accounts_change_at_least_an_outputs_least (M9a and M9c both caught) |
| `seedelf-platform/seedelf-core/src/orders.rs:1254` | A DEX swap nested past 128 levels trapping the cancel check | orders_test a_swap_nested_too_deep_is_refused_by_the_cancel_check_itself |
| `seedelf-platform/seedelf-core/src/utxos.rs:60` | The CLI counting, spending or naming rows at the key address carrying the contract's hash (x2#2; the guards at :90, :123, :156, :491, :518 and :540 each reverted alone) | utxos_test a_row_at_the_key_address_carrying_the_contracts_hash_isnt_the_contracts; cli sweep_all_leaves_a_row_at_the_key_address…, remove_finds_no_seedelf_at_the_key_address… |
| `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:2344` | A private spend taking a stranger's row at the key address with the contract's hash (check_spendable; remove_spend at :5061) | api_test withdraw::a_key_address_carrying_the_contracts_hash_holds_nothing_to_spend |
| `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:3034` | Paying a Seedelf located at the key address carrying the contract's hash | api_test transfer::a_seedelf_at_the_key_address_carrying_the_contracts_hash_cant_be_paid |
| `seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs:2949` | A stranger's key-address row chosen as the private payer of a box's way back | lovejoin_flows_test a_box_comes_back_paid_only_from_the_contracts_own_address |
| `seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs:453` | A direct return's deposit and mix change going to a stranger-staked address listed first (lead#1/W1b) | lovejoin_test a_direct_returns_tail_keeps_its_change_at_the_sessions_own_address; the_collateral_mix_built_again_keeps_its_change_at_the_sessions_own_address |
| `seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs:1229` | Plans and chains past 3 waves, or mixing again at depth 0 (each of the four calls reverted alone) | lovejoin_across_test a_plan_or_a_sessions_chain_is_refused_past_its_waves |
| `seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1303` | A site's payment into the contract under a dead or anyone-can-spend register reading as the user's | cip30_test a_payment_into_seedelf_says_who_can_take_it (the window's callout: none, r2tests#1) |
| `seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1290` | A key address with the contract's hash read as the contract (w2#2) | cip30_test a_key_address_with_the_contracts_hash_is_not_seedelf_wallets_contract |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/coin-control.ts:198` | A stranger's 5 ₳ with a reference script or a datum becoming the account's or a session's collateral | coin-control.test.ts 'a stranger's 5 ₳ the wallet can't put up'; session-collateral.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2862` | A site session's collateral being a stranger's 5 ₳ with a script or datum | dapp.test.ts 'keeps the funding's 5 ₳ as the session's collateral…' (it.each over three shapes) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:1965` | A site on one account probing another public account's Lovejoin chain (e3a#1) | dapp-other-account-mix.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/balances.ts:545` | A key-address row under the user's register counting in the private balance (x2#2) | contract-scan.test.ts 'a row at a KEY address…'; private-index.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/contract-scan.ts:200` | A v1-sealed planted row staying counted after the update (gap-g6#1) | private-index.test.ts 'sealed as ours by an older release…' |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7718` | A due box's withdraw sent seconds after the user's Send (x4#1) | lovejoin-withdraw-submit.test.ts 'a withdraw built while the user's Send goes' |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4457` | An order, cancel or return sent seconds after a lock and unlock (x4#2) | unlock-waits.test.ts (chunk 51, x4#2) x2 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4830` | A tile mix built at Settings' later depth or delay instead of the reviewed and funded one (w3#1) | lovejoin-planner.test.ts 'a mix keeps the depth and the wait its review showed…' (depth, delay and the recording each caught) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/wallet.ts:238` | A reading begun under one phrase landing as the next phrase's (e4a#1) | remove-wallet-reading.test.ts; accounts-restore-look.test.ts (merge and check pins: none, r2tests#4) |
| `seedelf-platform/seedelf-cli/src/commands/rows.rs:169` | A stranger's tokens past a u64 stopping sweep --all for good (r4#2) | cli sweep_all_goes_when_a_strangers_tokens_total_past_a_u64 (external sweep's own test passes with it off: the short-pile rule leaves the pile) |
| `seedelf-platform/seedelf-cli/src/commands/rows.rs:281` | A short sweep dropping the user's NFT along with a stranger's pile | cli external_sweep_takes_a_token_utxo_the_rest_can_carry_beside_a_pile |
| `seedelf-platform/seedelf-koios/src/koios.rs:658` | A 5xx, timeout or unreadable 2xx after the submit reading as refused, so a re-run pays again (r4#4) | cli submit_tx_tells_a_refusal_from_a_submit_that_may_have_gone; a_submit_koios_never_confirmed_names_the_transaction_it_sent |
| `seedelf-platform/seedelf-cli/src/commands/util/extract.rs:74` | util extract taking a UTxO at another script or on the other network | cli extract_refuses_what_isnt_a_datum_less_utxo_of_the_contracts (network half caught too) |

## Checked and holds

- Method: git archive of FIXTREE HEAD 10a06db6 plus its wasm/pkg (built 04:06) into ~/.cache/seedelf-review-51/r2tests, with CARGO_TARGET_DIR r2tests-target and node_modules linked entry by entry (my own .vite). About 168 mutants, each applied alone, run against its named test, then restored. Copy and target removed at the end.
- 0c965ff8 r3a#1: parse_mix_datum back to tag 121 only fails both new lovejoin_test tests.
- 64379c03 and fcb22df7 (CLI stranger rows), all caught: totals in u64 (3 balance tests), sweepable's overflow rule (sweep --all's test), the 20 cap, TooLarge shrinking (3 tests), the short-pile rule (both sweeps), one-at-a-time leaving (the NFT-beside-pile test), and fund, create and extract's fitting() (each its own test). External sweep with no sweepable at all fails the reference-script tests.
- 48a4c977, all caught: fund's selection order (selection_integration), z read as the validator reads it (both halves, schnorr_test), SubmitError kinds (K3a-c), the id in the may-have-gone error, keyset paging (koios_pages, 2 tests), history dedupe, run path token, Host check, frame headers (signing_page), the JSON '<' escape (web_server lib test), and extract's address and network check.
- 4c3194f9: register.rs's two corrected messages are each caught (register_test). The signing page script is caught: the witness merge, CIP-30 info words, the id shown, the unconfirmed-submit branch (cli-signing-page.test.ts).
- c1c5b13a, caught: apart's search half, check_cancels' nesting check, ogmios_purpose labels, asset_id_to_asset, mixes_per_box_at. Survivors: only the error half (r2tests#5) and fresh_for's check_width, which no caller can reach since both callers check the width first.
- d2a7278d x2#1, 1cf196c4 (Byron output to Ogmios), 21caa3b8 (both least checks, both rounds): all caught.
- 36fbb96f, caught: RemoveResult.tokens; each of the four check_waves calls; script stake credential and committee cold signers; is_script; bech32-only rows; Byron networks; the d1#3 verdicts (dead, identity public value, 102 form, a datum carried by hash); the big-number hex cut-off; decode's anyone flag and Byron payee; cip30 and decode nesting checks (decode's by a stack-overflow abort).
- 514c6579: each of the four at_wallet_contract checks caught alone. 03cf290e: each of the seven core reader guards caught alone, and koios at_script.
- a6b37119: direct_tail's change address, its collateral pick, and collateral_mix's change address are each caught.
- 2b3dfd80, caught: phrasePin; account.ts, pending.ts settleNow, balances' in-flight key, readingNoted and readPrivate pins; the connector window's activity; dapp-approvals while locked; paysActive; collateralOf and the Collateral page's candidate.
- fdd3b8b2, caught: recorded depth, delay and their recording; refusesEvery and the 5xx-twice rule; the quiet after a send; the payer's paysAccounts (lovejoin-release-rules 'reads again, as it lands'); Bootstrap's null collateral; receivedOf; the strangers' skip not written; partsUnlisted; own unlisted outs; stillUnder.
- d9e015fb, caught: the reservation's account and chainHeld's check, the session collateral rule, moreThanNote, view's phrase key and final pin, the leading BOM, the funding link's network, stakeElsewhere in tx-view, shownSiteText, the error tied to its request, the private-session form's unlocked count, SiteSessions' entry. Uncaught: the dead callout (r2tests#1). The manifest change is a no-op: both branches were already 'Seedelf Wallet'.
- 6aea4fb8 and 4cbac01e: atContract in ownedUtxos, the Koios view and the Seedelf place; destination's stakeElsewhere; SETTLED_RULE. All caught, though some only via r2tests#7's timeout: with a 60 s limit, P1, P2, P3 and P5 are each caught by an assertion.
- 506e4ed2 (late leg, letGoUnseen, BOX_READER), coin-control's collateralFits datum-hash half (via sessions too), c4b7a906 (the en-US sort in 9 locales, the key never printed, the pins), fc6a0aa1 (canWarn): all caught.
- 8fd738ff and c8003eda, caught: review stake lines, TxDetail, UTxO details, otherStake, unmixable (coin-control and Lovejoin form), decimals, Seedelf card tokens, Claim all's token kinds, the collateral review's rewards, Activity note codes, confusables, swap pair, DRep name cleaning (staking and dreps), anyway accounts, held-by-unlock, the stopped row, the Mix-again count. Uncaught: r2tests#2 and #3.
- Production seams in the test-only commits are behaviour-preserving: 1d509df7 (table_from, cancel_orders_from with identity budgets), 1dc64e1d (withdraw_declaring with with_margin(1)), 0a7d493e (proof_nonce_with: same HMAC order, aux still zeroized), b27f0160 (session_tx_request and session_data_request: the same governance: false struct update).
- Leftover r51: no r51 file, tracked or untracked, in FIXTREE (find and git ls-files). The only r51 string is a fixture site id 'r51-e4b-2' at dapp-approvals-locked.test.ts:22.
- New tests' timing patterns hold: the bounded setTimeout(0) polling is a pre-existing pattern over synchronous fakes. The submit test's 31 s delay against the 30 s client timeout is deterministic, just slow. signing_page.rs uses the fixed port 44203 under #[serial] with a stated precondition and 60-180 s deadlines. Random scalars in the new Rust tests stay inside the fee margins asserted (1,000 to 5,000 lovelace).

## Notes

- At its committed head (10a06db6), the fix branch fails i18n.test.ts: 23 accuracy-critical keys are still machine drafts in es and ja (dappUi.warn.deadRegister, send.warn.stakeElsewhere, tx.out.warn.anyoneCanSpend and more). That is expected until the blind back-translation lands. FIXTREE's working tree had uncommitted ja.json edits, then lovejoin.ts, test and doc edits, while I ran. I only read FIXTREE; those edits aren't mine. r2still#3 ran on the working tree, which is likely why its default leg was all green.
- Masked halves, no reachable harm: (1) e8b#3's functional setChosen update. The rows are disabled while the switch rebuilds, which the second test pins, so the first test fails only when both are reverted. (2) r4#1's external-sweep overflow test passes with sweepable's overflow rule off, because its junk rows are short of their deposit and the short-pile rule leaves the third one instead. The shared rule is pinned by sweep --all's test.
- Survivors I judged unreachable, so no finding: utxo_pages' dedupe (keyset paging by tx_hash and tx_index can't repeat a row); decode's reward_address Display for a Byron address (only malformed bytes); cip30 keying a Byron owner by its root, not one zero hash (othersSign isn't shown; refuseOddities compares it exactly, and a transaction missing a bootstrap witness can't be submitted anyway).
- For the owner: e5#2's path for a watch sealed before this release (no paysAccounts, pending.ts:204). Reverting it to the old rule, 'pays any own account, so read the account on screen', passes everything. It only affects a payment left maybe-sent across the update.
- Pre-existing tests with Vitest's default 5 s limit time out under heavy load: restore-scan 'offers 5 ₳…' (C41, C47) and sessions 'chunk 24, Step 3' did while a release build ran alongside, and both pass alone. G4.md notes the same for its own 20-30 s tests. Whoever runs the final checks should run them on a quiet machine.
- G4-g first looked like a survivor because I ran it against the wrong files. Its test is lovejoin-release-rules.test.ts 'reads again, as it lands…', and that test catches it. r2time#1 already covers the payer being read at the press.
- Not run: Playwright, and the wasm/tests/*.mjs node tests (they need a rebuilt module). I ran only the default Vitest leg; r2still#3 covers the preprod-only leg's failures.

## Coverage

Every fix commit from f87c3e77 to HEAD (10a06db6) was read and had its main change reverted in my copy; most commits had several sub-fixes reverted one at a time (about 168 mutants). Survivors were confirmed against the whole crate suite (Rust) or the whole default Vitest suite (TypeScript: four full runs of 3,554 tests each); for r2a#2 also the ignored release parts suite, run three times. Test-only commits (cc7440c9, 46975c50, 1d509df7, 3b755369, f1da256d, a9b5a3bb, 0a7d493e, 1dc64e1d, 5c5bc3c1, b27f0160) were checked only for behaviour-preserving seams; T1's lens owns their guards. 40883a55: only tally.py's rule was exercised, on a fake package. Its Lean parts (controls, SORRY verdict, #guard_msgs) and count.py's and check.sh's halves were read, not run (no Lean build allowed). Docs commits (10a06db6, README parts of c4b7a906 and 48a4c977) have no test to expect. Not reverted one by one: 8fd738ff's and c8003eda's nits (e8b#5, e9a#5, e9a#6, e9b#3, gap-g7#4, gap-g10#4, gap-g10#1's picker, e7b#4's epoch card, Activity's day grouping); fc6a0aa1's five renamed keys; 64379c03's print_stayed words. Not run: Playwright e2e, the wasm .mjs tests, and the VITE_ENABLE_MAINNET=false leg.
