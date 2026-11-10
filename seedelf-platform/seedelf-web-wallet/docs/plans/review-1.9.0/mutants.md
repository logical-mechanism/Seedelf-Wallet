# 1.9.0's release review: the mutants lane's report

Round one, a finder. Verbatim from its structured report; full addresses of third parties shortened.

## Coverage

Read: COMMON.md; the release diffs of wasm/src/cip30.rs, cip30_test.rs, DappApprovals.tsx, dapp.ts, tx-view.ts, rpc.ts, TxDetail.tsx, minswap.ts, sessions.ts, orders.rs/orders.json and orders_test.rs; their tests (dapp-prompt, tx-view, tx-view-screen, swap-routes, sessions, direct-swaps, order-cancel-check) and the new e2e test (extension.spec.ts:5833-5879); chunk 47's plan; architecture.md:563.

Ran, in my own detached worktree at 8d7c4b0c (node_modules symlinked, the main tree's wasm/pkg copied in, CARGO_TARGET_DIR=~/.cache/seedelf-review-1.9.0/target-mutants, -j 4, MemoryMax caps). Baselines: cip30_test 65 ok, orders_test 26 ok, full Vitest 263 files and 3,276 tests ok in 5.5 min.

Mutants: 31 in all, each applied by exact unique text, tested, then restored with git checkout (every one came back clean). That's all of a to y, plus extras: z1-z9 and p2.
- Rust mutants ran against cip30_test or orders_test.
- cip30 survivors (d, e, f, z1, z2) were also run against session_test and payment_parts_shapes_test.
- TS mutants ran against their narrow Vitest files. The survivors (k, l, m, z6, z7) were then run against the full Vitest suite.
- I wrote tests that kill d, e, f, z1 and z9. Each passes on 8d7c4b0c and fails under its mutant. They lived only in the worktree; the diffs are in SCRATCH/review-1.9.0/mutants/cip30_test-additions.diff and orders_test-additions.diff.
- Mutant definitions are in SCRATCH/review-1.9.0/mutants/mutate.py and the runner in run.sh. Logs are log-<mutant>-<kind>.txt in the same folder.

Not done:
- e2e: it can't run without a build. Verdicts on e2e are by reading only.
- Not mutated: i18n, and TxDetail's "Must be signed by you" label (which tx-view-screen pins).

The worktree is removed and the main tree is untouched and clean. The 2.9 GB target at ~/.cache/seedelf-review-1.9.0/target-mutants is left in place.

## Findings

### mutants#1 (medium, #373, confirmed-by-run): No test covers the warning's required-signer or datum check in a Plutus-shaped body: the bounty report's own shape

**Files:** seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1832, seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1838, seedelf-platform/seedelf-web-wallet/wasm/tests/cip30_test.rs:2204, seedelf-platform/seedelf-web-wallet/wasm/tests/cip30_test.rs:2408, seedelf-platform/seedelf-web-wallet/extension/e2e/extension.spec.ts:5842

**Claim.** Every test that asserts key_releases is true builds its body with body()'s script_data_hash: None. So does the e2e's hand-built tx. With no script data hash, the native-script term (contract_inputs > 0 && no script data hash) is true in every one of those tests, and it hides the other two terms. Mutant f (drop the required-signer term) and mutant e (drop names_key from key_releases) both survive. Real orders and listings are Plutus scripts, and spending them always carries a script data hash. So a required signer under a Plutus script, which is exactly what the bounty report describes, is the one case no test reaches.

**Evidence.** cip30.rs:1832-1838:
`let key_releases = names_key || body.required_signers.iter().flat_map(|s| s.iter()).any(|h| keys.of_hash(h).is_some()) || (contract_inputs > 0 && body.script_data_hash.is_none());`

In cip30_test.rs, script_data_hash is set to Some only at 2300 and 2396 (no_witnesses(Some)), and both of those assert !key_releases (2304, 2411). The positive asserts at 2204, 2217, 2286, 2351 and 2408 all have no script data hash. The e2e tx `84a4 00.. 01.. 02.. 0e81581c..` has no key 0x0b either. dapp-prompt.test.ts sets keyReleases by hand.

Runs:
- run.sh cip30 f → 'test result: ok. 65 passed; 0 failed'. wasmother f → session_test 13 passed, payment_parts_shapes_test ok.
- run.sh cip30 e → 'ok. 65 passed'. wasmother e → ok.

Killing tests: they pass on 8d7c4b0c; under f, 'mut_f_a_required_signer_releases_under_a_plutus_script ... FAILED', and under e, 'mut_e_... FAILED'.

The f test:
`let mut b = body(vec![input(TX_B, 0)], vec![out_with_token(&theirs(), 49_800_000)]); b.required_signers = NonEmptySet::try_from(vec![key_00()]).ok(); b.script_data_hash = Some(Hash::new([1; 32])); let s = cip30::inspect_tx(&account(), &request(tx_hex(b), vec![contract_row(TX_B, 0)], true)).unwrap(); assert!(!s.names_key); assert!(s.key_releases); assert_eq!(s.released_lovelace, "49800000");`

The e test is a_datum_naming_the_accounts_key_counts_with_no_required_signer with `b.script_data_hash = Some(Hash::new([1; 32]))` added, asserting names_key and key_releases.

**Scenario.** Suppose a later change drops or breaks the required-signer term (mutant f). A site then spends the user's Plutus order with key 0/0 as a required signer, and pays the money to itself. The order keeps its datum by hash, and the site leaves that datum out of the witness set it shows the wallet, so names_key is false. key_releases comes out false. The window shows no warning, no 'Leaves a contract' row and no switch, only the note. The unit tests and the e2e still pass.

**Fix.** Add the two Plutus-shaped tests above. Give the e2e's hand-built tx a script data hash (map a5 with 0b5820…), so the e2e exercises the required-signer term instead of the native-script term.

### mutants#2 (medium, #373, confirmed-by-run): Untested: the account's own token of the same kind can hide a contract's token being taken

**Files:** seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1120, seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1124

**Claim.** released_from_contracts subtracts what the account put in, token by token, so that only the account's gain counts as reaching it. No test has the account spend a token of a kind a contract UTxO also holds. Mutant d (use what came back, ignore put_in) passes every wasm test file that reads inspect. Under that mutant, the account's own token passing through the transaction stands in for the contract's token that left.

**Evidence.** cip30.rs:1120-1124:
`let back = returned.tokens.get(k).unwrap_or(&0).saturating_sub(*put_in.tokens.get(k).unwrap_or(&0));`

Runs: run.sh cip30 d → 'ok. 65 passed'. wasmother d → session_test 13 passed, payment_parts_shapes_test ok.

Killing test mut_d2. It passes on 8d7c4b0c. Under d it fails with 'left: 0 right: 1' at the released_tokens assertion, after released_lovelace == "0" has already held. In other words, under the mutant nothing at all reads as released.
`let mut b = body(vec![input(TX_A, 0), input(TX_B, 0), input(TX_SITE, 3)], vec![out_with_token(&ours(Role::Receive, 0), 54_800_000), out_with_token(&theirs(), 2_000_000)]); b.required_signers = NonEmptySet::try_from(vec![key_00()]).ok(); let rows = vec![row(TX_A, 0, &ours(Role::Receive, 0), 5_000_000, &[(POLICY, "74657374", 1)]), contract_row(TX_B, 0), row(TX_SITE, 3, &theirs(), 2_000_000, &[])]; let s = cip30::inspect_tx(&account(), &request(tx_hex(b), rows, true)).unwrap(); assert_eq!(s.net_lovelace, "49800000"); assert!(s.net_tokens.is_empty()); assert!(s.key_releases); assert_eq!(s.released_lovelace, "0"); assert_eq!(s.released_tokens.len(), 1);`

**Scenario.** Under mutant d: the user's sell order holds 50 ₳ and 1 T, and the account also holds 1 T. A site builds a transaction with 0/0 as required signer. It pays the order's ADA (54.8 ₳) plus the account's own T back to the account, and sends the order's T to itself, padded with 2 ₳ from an input of its own. released_lovelace is 0 and released_tokens is empty, so releasesContractFunds is false. The window reads +49.8 ₳ and shows only the note: no warning, no switch. On 8d7c4b0c the same transaction releases 1 T and is warned of.

**Fix.** Add mut_d2, or the simpler mut_d: 1 T in and out of the account, and 49.8 ₳ plus 1 T to the site.

### mutants#3 (medium, #373, confirmed-by-run): Nothing tests that the Sign switch's yes applies only to its own request; the e2e check for it can't fail

**Files:** seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:126, seedelf-platform/seedelf-web-wallet/extension/e2e/extension.spec.ts:5870

**Claim.** `const ack = ackFor !== undefined && ackFor === currentId` is what stops a yes from carrying over to the next request. Mutant m (`ack = ackFor !== undefined`) passes the whole Vitest suite. Vitest can't mount DappApprovals at all: the environment is node, with no jsdom or happy-dom. The e2e step 'A yes is for one request: the next starts over' only sends the second request after the first window has closed (`await done`), so the second request opens in a new window with fresh state. That step can't fail. In real use the queue shows the next request in the same window, and ackFor lives in DappApprovals, outside the per-request <Screen key>.

**Evidence.** run.sh vitest: m → 'Test Files 263 passed | 1 skipped (264) / Tests 3276 passed | 4 skipped (3280)', identical to the baseline.

e2e (read, not run): 5865 `const done = sign.waitForEvent("close")` … 5868 `await done;` 5871 `const again = connectorWindow(context);`.

DappApprovals.tsx:117 `const current = approvals?.[0]` and :267 `key={current.id}` on Screen. ackFor is the parent component's state (:125), so it survives from one request to the next.

**Scenario.** Under mutant m: a site queues two signTx calls that each release contract funds. The user turns the switch on and signs the first. The second takes its place in the same window with the switch already on, and Sign enables as soon as the password is typed and the 1 s hold ends. The user never gives that request its own yes.

**Fix.** Add an e2e with both requests queued in one window: `const opened = connectorWindow(context); const first = cip30(dapp, "signTx", tx, false); const sign = await opened; const second = cip30(dapp, "signTx", tx, false); await expect(sign.getByText("1 of 2")).toBeVisible(); await sign.getByLabel("Your password, to sign").fill(PASSWORD); await sign.getByRole("switch", yes).click(); await sign.getByRole("button", { name: "Sign", exact: true }).click(); expect((await first).value).toMatch(/^a100/); await expect(sign.getByRole("switch", yes)).toHaveAttribute("aria-checked", "false"); await sign.getByLabel("Your password, to sign").fill(PASSWORD); await expect(sign.getByRole("button", { name: "Decline" })).toBeEnabled(); await expect(sign.getByRole("button", { name: "Sign", exact: true })).toBeDisabled();`. Waiting for Decline to enable gets past the hold before checking that Sign stays disabled.

### mutants#4 (low, #375, confirmed-by-run): Two of routeOf's three callers can pass the wrong network and every test still passes

**Files:** seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:3185, seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4126, seedelf-platform/seedelf-web-wallet/extension/tests/swap-routes.test.ts:16

**Claim.** With 'preprod' hard-coded as the network for Review it myself (swapBuild, mutant z6) or for the runner's order() (mutant z7), the full Vitest suite still passes. Two things blind the tests. The runner test's mock treats every route as mainnet's whenever rule.mainnet is set, whatever network it's handed. And every swapBuild test runs on preprod. Only quote()'s call is pinned: z8, the same mutant there, is killed.

**Evidence.** swap-routes.test.ts:16-17: `uncheckedProtocols: (network, est) => real.uncheckedProtocols(rule.mainnet ? "mainnet" : network, est)`. The runner test at :128 calls `sessions.advance("preprod", 0, true)`.

grep: every swapBuild call in tests is `swapBuild("preprod", 0)`.

Runs:
- run.sh vitest: z6 → 'Tests 3276 passed'.
- run.sh vitest: z7 → 'Tests 3276 passed'.
- z8 is killed by swap-routes 'is asked for again without it on mainnet, and quoted…'.

**Scenario.** Under z6 or z7, on mainnet, Minswap's best route goes through a DEX the wallet doesn't check (CswapV1, or one Minswap adds). The quote routes around it. Then Review it myself refuses with 'now routes through CswapV1', and the funded runner pauses with sess.refuse.warn.nowRoutes. That is the failure #375 fixed for the quote. No money is at risk: the swap pauses and Stop returns the funding.

**Fix.** The fixtures are preprod's, so a mainnet session test may be costly. A cheap pin is a source check, as hide-balances-forms.test.ts:57 does, that each routeOf( call in sessions.ts passes `network`.

### mutants#5 (low, #373, confirmed-by-run): Untested: a stranger's key input isn't counted as a contract input

**Files:** seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1075, seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1264

**Claim.** Mutant z1 makes at_script true for every address, so a stranger's key input counts as a contract input. It passes cip30_test, session_test and payment_parts_shapes_test. The tests that spend a stranger's input, such as cip30_test.rs:340 someone_elses_input_needs_partial_signing, never check contract_inputs or key_releases.

**Evidence.** cip30.rs:1075-1077 `fn at_script(row) -> bool { matches!(Address::from_bech32(&row.address), Ok(Address::Shelley(s)) if s.payment().is_script()) }`.

Runs: run.sh cip30 z1 → 'ok. 65 passed'. wasmother z1 → ok.

Killing test mut_z1: swap() rows plus `row(TX_B, 0, &theirs(), 5_000_000, &[])`, outputs `out(&theirs(), 8_000_000, None)`, partial_sign true; `assert_eq!(s.contract_inputs, 0); assert!(!s.key_releases);`. It passes on 8d7c4b0c and fails under z1.

**Scenario.** Under z1: in a co-signed peer-to-peer trade, a counterparty's key input sits in a body with no script data hash. It gets contract_inputs 1, key_releases comes from the native-script term, and their input counts as released. The window then warns 'Your signature helps release funds from a contract' and holds Sign behind the switch on an honest trade.

**Fix.** Add mut_z1.

### mutants#6 (low, #377, confirmed-by-run): Untested: fills_once's check of the second SundaeSwap V4 module

**Files:** seedelf-platform/seedelf-core/src/orders.rs:412, seedelf-platform/seedelf-core/tests/orders_test.rs:1177

**Claim.** fills_once checks both modules by hash: basic_order then fee_constraint. The test variants only replace the first module, pop the second, or add a third. Mutant z9 compares only the first module (`.zip(SUNDAE_V4_ONE_FILL).take(1)`) and passes orders_test. Under it, a datum naming basic_order followed by any other module reads as an order that fills once.

**Evidence.** orders.rs:405-426: SUNDAE_V4_ONE_FILL holds two hashes, and fills_once zips the constraints against both. The doc comment above it (orders.rs:399-404) says another module 'may leave the rest of an order at the script, where the runner wouldn't look'.

Run: run.sh orders z9 → 'test result: ok. 26 passed'.

Killing variant, added next to 'another order module': `variants.push(("another second module", edit(&|d| { let second = &mut items(&mut fields(d)[5])[1]; items(second)[0] = bytes(&OTHER); }), Expect::Unread));`. It passes on 8d7c4b0c; under z9 it fails with '"SundaeSwapV4" on "mainnet", another second module'.

**Scenario.** Under z9: Minswap builds a V4 order (the check exists because Minswap's builds aren't trusted) whose second module isn't fee_constraint.withdraw. The check reads it as a one-fill order and the session signs. The rest of a partial fill can stay at the script where the runner doesn't look. The funds aren't locked, since V4's cancel reads the owner alone.

**Fix.** Add the 'another second module' variant.

## What holds

- Baselines at 8d7c4b0c in my worktree: cip30_test 65 ok, orders_test 26 ok, full Vitest 263 files / 3,276 tests ok.
- (a) released_from_contracts returns the contract amount unchanged: killed by 7 cip30 tests, including an_honest_cancel_releases_nothing_away_from_the_account and what_the_accounts_key_releases_from_a_contract_is_said.
- (b) no fee term: killed by the same 7, including a_fee_far_over_any_real_one_isnt_allowed_for and every_contract_utxo_in_the_transaction_is_counted.
- (c) no came_in: killed by an_honest_cancel_releases_nothing_away_from_the_account and ada_paid_back_doesnt_hide_a_token_taken.
- (g) no no-script-data-hash term: killed by a_contract_input_with_no_script_data_hash_can_only_be_a_native_scripts.
- (h) datum_names_key reads inline datums only: killed by a_datum_kept_by_hash_is_read_from_the_transaction.
- (i) contract_inputs counted only when of_row succeeds: killed by what_a_contract_utxo_holds_is_never_a_reason_to_refuse.
- (j) MOST_FEE_ALLOWED = u64::MAX: killed by a_fee_far_over_any_real_one_isnt_allowed_for.
- (n) releasesContractFunds ignores tokens: killed by dapp-prompt 'warns of a token taken with the ADA paid back, and shows no empty ADA row'.
- (o) yourSigners ignores other accounts, (p) the active account's loop counts a stranger's key, (p2) the other accounts' loop does: all killed by tx-view.test 'marks a required signer that's one of the wallet's keys, and no one else's'.
- (q) fills_once always true, (r) a Some destination datum taken, (s) any MultisigScript tag taken, (z4) fills_once without its length check: each killed by an_order_is_the_sessions_only_when_its_canceller_and_every_payee_are, through its V4 variants ('another order module', 'a datum for the destination', 'owner not one key', 'no fee constraint').
- (t) V4 cancel redeemer Constr 1 []: killed by 9 orders tests. The real V4 script itself refuses it ('unexpected empty list') in every_dex_order_is_cancelled_through_its_real_script, on top of the byte check in the_sundae_v4_order_minswap_built_is_cancelled_with_its_stake_key.
- (u) V4 not stake-signed: killed by 11 orders tests, including the_sundae_v4_order_minswap_built_is_cancelled_with_its_stake_key and without_the_cancellers_signature_every_script_refuses.
- (v) routeOf without uncheckedProtocols: killed by both swap-routes 'a route through a DEX the wallet doesn't know' tests (quote and runner). (z8) quote() routeOf on 'preprod': killed by 'is asked for again without it on mainnet'.
- (z3) quote() not refusing a route that's still unchecked after the second ask: killed by sessions.test 'won't quote a route through one it can't check (final review sessions-4)' and swap-routes 'is refused through a DEX the wallet doesn't know in that DEX's words first'.
- (w) ChakraBondingCurve back in DIRECT_PROTOCOLS: killed by swap-routes 'never sends ChakraBondingCurve…' and 'asks Minswap to leave out every DEX…', and sessions.test 'funds the session with the swap…'.
- (x) PREPROD_NOT_PINNED emptied: killed by sessions.test 'leaves Splash out of routing on preprod…' and swap-routes 'routes through SundaeSwap V4 on mainnet… leaves it out of preprod'.
- (y) SundaeSwapV4 out of MAINNET_PROTOCOLS: killed by swap-routes 'routes through SundaeSwap V4 on mainnet…' and sessions.test 'won't quote a route through one it can't check'.
- (l) Sign button not waiting for the switch: survives the full Vitest suite. By reading, the e2e kills it: extension.spec.ts:5860 checks `await expect(button).toBeDisabled()` with the password filled and the switch off.
- (k) answer() without the switch check: survives Vitest and, by reading, the e2e too. Harmless: for a sign-tx request, answer(true) is reached only through the Sign button and Enter in the password box (DappApprovals.tsx:281, 317; onAnswer goes to connect requests only). Chrome doesn't submit a form implicitly while its default button is disabled, so this guard can't be reached while Sign's disabled state is right.
- (z2) a datum carried in the witness set hashed from a re-encoding, not its own bytes: survives by construction, because the test builds that datum by re-encoding. It would matter only for a non-canonically encoded datum kept by hash. Nit.
- (z5) a V4 constraint pair of any length accepted: survives. Nit: chunk 47 found V4's cancel reads the owner alone, so a malformed pair can't strand an order.
- A native-script UTxO unlocked by the account's key, spent in a body that also has a script data hash, gets only the note, with no warning or switch. Confirmed with a scratch test: key_releases false, released 50 ₳. This matches the limitation architecture.md:563 documents ('a native script's input in a transaction that also runs Plutus'). The simplest case, a script that needs only one of the account's keys (ScriptPubkey), could be matched locally from the key, since its hash is blake2b-224 of 0x00 ‖ [0, key].
- Removing the worktree touched nothing else: the node_modules symlink was unlinked first, and the main tree's node_modules (104M, vitest present) and git status are unchanged.
