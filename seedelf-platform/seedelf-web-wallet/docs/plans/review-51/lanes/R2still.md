# Lane R2still

Returned by the workflow's agent `af7f307913a4ee848`, written here by the lead from its structured answer.

## Findings (3)

### r2still#1 · low · x1a#3's fix is partial: a 674 map with a second "msg" key publishes lines the sign window never shows, and no line says there's more metadata

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2996`
- **Who:** site · **Since:** d9e015fb (this round's x1a#3 rule); note_of's first-msg-only read is older · **Confidence:** confirmed-by-run

**Scenario:**

A site asks for a signature on a transaction whose metadata is {674: {"msg": ["Thanks for order 77"], "msg": ["also owns addr_test1 of account 7"]}}. That is a CIP-20 map with the "msg" key twice, which the ledger accepts: a metadatum map is a list of pairs, so it takes duplicate keys. The window shows "Its note, which anyone can read: Thanks for order 77" and nothing else. The x1a#3 line "It carries other metadata too, which anyone can read." never appears. The second msg's lines are still signed and published under the user's key. Only Transaction details shows them. Two 674 labels, each holding one msg, read the same way in the wallet. The ledger may refuse that variant, since Conway's decoder may reject duplicate keys in the top-level map.

**Evidence:**

Paths are in FIXTREE. The code is new this round.
- dapp.ts:2996-3004 moreThanNote returns true only for a label other than 674, a non-map 674 value, or an entry that isn't `key.text === "msg" && lines(v)`. Every msg entry with text lines therefore counts as the note.
- wasm/src/cip30.rs:922-944 note_of takes the first label 674 (`.find(|(label, _)| *label == 674)`) and the first msg in it (`fields.iter().find_map(...)`). Only that one's lines become `summary.note`.
- dapp.ts:2162 sets otherMetadata only when besideNote/moreThanNote says so. DappApprovals.tsx:1102 shows the line only then.

Run: a probe in my copy (tests/r2still-dup-msg.test.ts) reused dapp-prompt.test.ts's x1a#3 harness: real WebAssembly, the worker's DappService over the fakes, signTx through the approval.
- Duplicate msg key: `summary.note ["Thanks for order 77"] otherMetadata undefined`. The page holds neither the second line nor the other-metadata line. wasm.decodeTx's metadata holds both entries.
- Two 674 labels: decodeTx gives both labels, and the note and flag come out the same.
- Both cases passed as written (2/2), so the gap is confirmed.

**Fix:**

Make the two readers agree. In moreThanNote, count as the note only what note_of shows: the first 674 label's first "msg" entry. Treat any later "msg" entry, and any second 674 label, as other metadata. Alternatively, have note_of collect the lines of every msg entry under every 674 label. Pin it with the probe's case in dapp-prompt.test.ts's x1a#3 block.

**Known check:**

Searched docs/backlog.md and every docs/archive/plans file for 674, duplicate key, second/two msg, msg key, otherMetadata and moreThanNote: nothing. verify/x1a-3.md and fixes/G5.md's round two don't name the duplicate-key case.

### r2still#2 · low · gap-g4#1 is fixed only for a leg the second listing holds; a leg both listings miss still comes back alone and directly, and since e2b#2's strangers rule the swap's page no longer says so

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4704`
- **Who:** nobody · **Since:** 506e4ed2 (gap-g4#1's fix, partial) with fdd3b8b2 (e2b#2's strangers rule) · **Confidence:** confirmed-by-run

**Scenario:**

The user swaps MIN for ADA through Lovejoin, the default. Minswap splits the route into two orders: leg 1 fills in block N and leg 2 in block N+1. On the run where utxo_info reads both orders spent, both of the run's account listings (credential_utxos) come from a backend still at block N. That's possible on preprod, or on Koios-only, where Koios's gateway balances several backends, as the impact verifier noted.
1. `since` is empty, so `late` is empty too.
2. The first return's chain takes leg 1, the change and the 5 ₳ collateral, which goes into the 5 ₳ pool.
3. On the next run, leg 2 (20 ₳ in the test) comes back alone in a second return. It goes directly, with NO_COLLATERAL, which ties it on chain to the session, and costs one more fee of about 0.2 ₳.
4. Leg 2's transaction is neither the session's own nor in auto.fills, because fillsOf ran on the two listings that missed it. So buildBack marks that return `strangers`, and sendBack leaves lovejoinSkipped unset.

The finished swap's page then never says part of it came back directly. Before e2b#2's fix it said "its 5 ₳ collateral isn't at its account anymore, and the mixes need it". For an ADA→token swap, outcomeOf also reads the missing token leg as "partly".

**Evidence:**

Paths are in FIXTREE.
- sessions.ts:3977-3992: `since` is the run's second listing, `fills = fillsOf(s, [...arrived, ...since])` is recorded once (only while `!auto.filled && !auto.refunded`), then `late = since`. :4005 is `bringBack(..., [...rows, ...late], ...)`.
- sessions.ts:4704-4711: `apart` = strangers when a back went and `rows.every((u) => !own.includes(u.tx_hash) && !fills.has(u.tx_hash))`.
- :5241 `const skipped = built.strangers ? undefined : built.lovejoinSkipped`, and :5361 `if (strangers) return;`.

Run: a probe in my copy appended a variant of lovejoin-planner.test.ts's gap-g4#1 test, with the real WebAssembly and SessionService/LovejoinService over the fakes. It is identical except that leg 2 is pushed into the account only after the runner's second credential_utxos call for the session's key.
- Merged tree: `{"listings":4,"closed":true,"firstTakesLate":false,"returns":2}`, `view.lovejoinSkipped undefined`, `second back spends the late leg true`, `second back's inputs 1`.
- Mutant in my copy with e2b#2's `{ strangers: true }` replaced by `{}`: the same run gives `lovejoinSkipped: "its 5 ₳ collateral isn't at its account anymore, and the mixes need it"`. The source was restored and diffed against FIXTREE.

**Fix:**

Two parts.
1. Take the class fix the impact verifier recorded (verify/gap-g4-1.md:370): build the first return only from a listing read in a run after the one that first found every order spent. Record that moment as auto.filled is recorded, and build from the next run's listing, which holds every leg the chain has.
2. Don't let e2b#2's rule misread a late fill. For example, keep adding arrivals to auto.fills after the outcome is recorded until a return that follows them has gone, or apply `strangers` only to rows that arrived after a return already took the swap's fills.

Test it with the variant above (both listings miss the leg): one return, which takes the leg, with no skip reason.

**Known check:**

verify/gap-g4-1.md: the impact verifier's fix note 1 names this member and its sturdier fix, which the fixer didn't take. Its 'lone-fill' sub-case is the owner's (H1) and isn't this. Searched docs/backlog.md and docs/archive/plans for late leg, split route, leg paid, strangers and lovejoinSkipped: nothing. e2b#2's verify and fixes/G4.md don't consider late fills.

### r2still#3 · low · This round's e7a#1, t1k#9 and t1j#6 tests fail on CI's preprod-only Vitest leg, so the fix PR's unit (preprod-only) job goes red and e7a#1's fix is pinned on one build only

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/tests/swap-form-review.test.ts:309`
- **Who:** nobody · **Since:** c8003eda (swap-form-review.test.ts) and f1da256d (worker-guards.test.ts) · **Confidence:** confirmed-by-run

**Scenario:**

CI's `unit (preprod-only)` job runs `VITE_ENABLE_MAINNET=false npm test` (.github/workflows/web-wallet.yml:197-201).
- On that build, all 8 tests of tests/swap-form-review.test.ts (e7a#1's four and t1k#9's four) throw "the picker doesn't list 29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c64d494e". That is mainnet's MIN, and a preprod-only build bundles no mainnet token list.
- tests/worker-guards.test.ts's t1j#6 case ("locks the wallet when WebAssembly traps under a page's request outside the wallet's queue") gets "That's a mainnet address; this wallet is on Preprod." instead of the trap's lock, because the wallet starts on preprod there.

No wallet code misbehaves. The branch can't pass CI as it is, and e7a#1's guard (a finder-medium) has no test on that build.

**Evidence:**

Run in my copy of FIXTREE's platform, with node_modules linked:
- Default build, all 289 files: 87 changed files (1,682 tests) plus 202 others (1,868 passed, 4 skipped), every one passing. tsc --noEmit was clean.
- `VITE_ENABLE_MAINNET=false npx vitest run --maxWorkers=6 --testTimeout=90000`: `Test Files 2 failed | 286 passed | 1 skipped (289); Tests 9 failed | 3540 passed | 5 skipped (3554)`.

The failing code:
- swap-form-review.test.ts:158 `const MIN = "29d222ce…4d494e"` and :309 `localMatches("mainnet", [], "", …).listed.find((p) => p.id === id)`, with NetworkContext "mainnet" at :227 and :282.
- worker-guards.test.ts:221-223 asks resolve-destination with `vectors(...)[0].mainnet.receive_0`, under "The worker is on mainnet, as a wallet with no network kept starts", which is true only when mainnet is enabled.

The pattern other tests use: tokens.test.ts:50 and token-lookalike-scripts.test.ts:168 `(__MAINNET_ENABLED__ ? it : it.skip)`. BASELINE.md: 3,306 passed on both builds before the round.

**Fix:**

Drive swap-form-review.test.ts on preprod: preprod's MIN from tokens/list.json (as lovejoin-planner.test.ts does), NetworkContext "preprod" and localMatches("preprod"), so it pins e7a#1 on both builds. Failing that, gate its mainnet cases with __MAINNET_ENABLED__. For t1j#6, ask with a receive address of the network the worker starts on: enabledNetworks(__MAINNET_ENABLED__)[0]'s vector. Then run `VITE_ENABLE_MAINNET=false npm test` before the PR.

**Known check:**

BASELINE.md and web-wallet.yml (the matrix's preprod-only leg). RESUME.md lists the extension's checks as still to run after the back-translation, so this wasn't seen yet. No backlog line covers it.

## Guards (20)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:412` | A box whose datum a stranger's mix wrote in constructor 0's general form dropping out of the wallet: stranded (r3a#1). Only (121,None)\|(102,Some(0)) is read. | seedelf-core/tests/lovejoin_test.rs a_box_in_constructor_0s_general_form_is_still_the_wallets, a_box_in_the_general_form_mixes_and_comes_back (both ran ok in my copy) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:448` | A KEY address carrying mix_box's hash being counted toward a pool's floor and drawn into mixes that fail (x2#1): spends_as_mix_box needs a script payment part on this network | seedelf-core/tests/lovejoin_test.rs a_key_address_carrying_mix_box_s_hash_holds_no_box (ran ok) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1774` | A paid withdraw whose account change is under its least at the settled fee (21caa3b8). Each draft round no longer refuses on the 0.5 ₳ guess | seedelf-core/tests/lovejoin_test.rs (21caa3b8's cases; in the lead's 933) |
| `seedelf-platform/seedelf-core/src/build.rs:2210` | An account collateral return under an output's least, which the node refuses after signing (21caa3b8) | seedelf-core/tests/merge_test.rs (21caa3b8's case) |
| `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:2344` | A private spend taking a row at the KEY address with the contract's hash, which no key can spend (x2#2): check_spendable's at_wallet_contract | wasm/tests/api_test.rs, lovejoin_flows_test.rs x2#2 cases (api_test 96/96 ok in my copy) |
| `seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs:2949` | A key-address row chosen as the private UTxO that pays a box's way back, stopping every private bring-back (x2#2) | wasm/tests/lovejoin_flows_test.rs (x2#2) |
| `seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs:453` | A direct return's collateral tail sending its change to a stranger-staked row's address (lead#1's confirmed part) | wasm/tests/lovejoin_test.rs a_direct_returns_tail_keeps_its_change_at_the_sessions_own_address, the_collateral_mix_built_again_keeps_its_change_at_the_sessions_own_address (ran ok) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/balances.ts:545` | A stranger's row at the KEY address with the contract's hash counting in the private balance and failing Max (x2#2) | tests/contract-scan.test.ts:272 and tests/private-index.test.ts:340 (x2#2) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/contract-scan.ts:200` | A row 1.9.1 sealed as the wallet's under the old rule staying counted for good (gap-g6#1): SETTLED_RULE 2 re-snapshots | tests/private-index.test.ts (seals a v1 record holding the planted row) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2859` | A stranger's 5 ₳ with a datum or script standing in as a session's collateral, so a site's spend of the real one goes unflagged and the return can't put one up (e3a#2) | tests/dapp.test.ts it.each over the three shapes |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/coin-control.ts:219` | A stranger's 5 ₳ with a reference script or unreadable datum becoming the account's automatic collateral, so public mixes fail (e8b#1). use() still takes the user's choice | tests/coin-control.test.ts (6, one the user's own choice) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4521` | A swap funded in parts pausing because Minswap spent an own part Koios doesn't list yet. It counts as own only if recorded, unspent, not collateral, and not counted spent (e7a#3) | tests/session-funding-parts.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4005` | A split route's leg in the run's second listing coming back alone and directly after the chain (gap-g4#1; partial, see r2still#2) | tests/lovejoin-planner.test.ts:883, tests/swap-runner.test.ts:939 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7718` | A due withdraw sent seconds after another send of the wallet's (x4#1 quiet re-check before takeDue and submit, also on the rewards retry) | tests/lovejoin-withdraw-submit.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4457` | The runner sending an order, cancel or return built across a lock and an unlock, the moment the wallet unlocks (x4#2). The session's reservation is released | tests/unlock-waits.test.ts |
| `seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:881` | A site's payment into the contract under a register no proof can meet being labelled 'anyone can take it' instead of locked for good. Constructor 0 is read in either spelling (d1#3, x3#1) | wasm/tests/cip30_test.rs a_payment_into_seedelf_says_who_can_take_it, decode_test.rs a_register_says_who_could_spend_what_is_under_it (ran ok) |
| `seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1290` | A burn to the KEY address carrying the contract's hash shown as a Seedelf payment (w2#2) | wasm/tests/cip30_test.rs a_key_address_with_the_contracts_hash_is_not_seedelf_wallets_contract (ran ok) |
| `seedelf-platform/seedelf-core/src/utxos.rs:41` | The CLI counting, sweeping or naming a Seedelf at the KEY address carrying the contract's hash (x2#2's CLI sibling) | seedelf-core/tests/utxos_test.rs, seedelf-cli/tests/cli/sweep.rs and remove.rs (cli harness 57/57 ok in my copy) |
| `seedelf-platform/seedelf-cli/src/commands/external/sweep.rs:45` | A stranger's junk rows overflowing the token sum and freezing external sweep for good (r4#1). rows::sweepable and most_that_fit take what one transaction can | seedelf-cli/tests/cli/external_sweep.rs external_sweep_goes_when_a_strangers_tokens_total_past_a_u64 and 7 more (ran ok) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:1965` | A site on the dApp account hearing another public account's Lovejoin chain by name (e3a#1, privacy) | tests/dapp-other-account-mix.test.ts |

## Checked and holds

- r3a#1 (high): parse_mix_datum reads (121,None)|(102,Some(0)) only (core mod.rs:410-415). from_row and from_resolved both use it, and the wasm and worker readers all go through from_row. Its two tests sit in seedelf-core/tests/lovejoin_test.rs and pass in my copy.
- x2#1 (medium): from_row requires spends_as_mix_box(&row.address): a script payment part on this network, any stake part (mod.rs:296-310, 448). The floor's `others` and every draw go through owned_in → from_row, and the index's rows carry their own bech32 address. BOX_READER 2 makes every device read each pool copy again under the new reader. Test in lovejoin_test.rs passes.
- r4#1 / r4#2 (high / medium): external sweep and sweep --all take what one transaction holds (rows::sweepable, most_that_fit), and balance totals are exact past a u64. 03cf290e's contract-script filter sits before the 20-UTxO window without undoing either. The CLI's 57 integration tests pass in my copy.
- r4#4 / r1#2 (medium): submit_tx now tells not sent, refused, spent and may-have-gone apart, and the CLI prints the id before sending. tests/cli/submit.rs's two tests pass.
- lead#1's confirmed part: direct_tail and collateral_mix send their change to an address the session's own transactions paid. The wasm lovejoin_test cases pass.
- e3a#1: ChainReservation keeps the paying account through reserve, holdOnly and publicStart (account 0 carries none). chainHeld holds the public reservation only for the site's own account, and signTx's first look, the approval's look and getCollateral each pass the right account. A view is always read for Settings' dApp account (`pinned` only re-reads).
- e3a#3 / e3b#1: shownSiteText writes Cf, Default_Ignorable, Cc, Zl and Zp as codes in SignData and the note, keeping tabs and line breaks. readableText keeps a byte order mark (ignoreBOM).
- e7a#1: the approval and Start swap use the build's own quote, picks and time (out.pay/out.get/out.at), and a rebuild with keepWay reuses out's ask. Its tests pass on the default build; see r2still#3 for the preprod-only build.
- gap-g4#1: a leg the run's second listing holds joins the first return (sessions.ts:3992, 4005). The traced timing is fixed; r2still#2 has the rest.
- e3a#2: sessionCollateral now uses the session rule (5 ₳, no tokens, no script, no datum). The plain-5 ₳ case the verifier called harmless is unchanged, as its notes allowed.
- e3b#2: ConnectRequest counts only unlocked private UTxOs, and the review's `before` is unchanged. e3b#4: an error is tied to its request's id and shown only on that request or the empty window.
- e4a#1 / e6#2: phrasePin covers balances read, readPrivate and readingNoted, readAccountUtxos (every caller), accounts discover/check/merge, pending settleNow and the dApp view's shared reading. activity.arrived runs only after the pinned turn. Public activity's cache is protected by its keys check.
- e4b#1: in the connector window only pointerdown and keydown count as activity. e4b#2: dapp-approvals is refused while locked, and the locked window renders Unlock, not DappApprovals.
- e5#2: paysAccounts and accountsPaid name the accounts a Seedelf spend pays, and forgetReading reads the landing turn's account. Lovejoin's paid withdraw passes paysAccounts [payer]. A Remove's `to: "account"` is the review's account.
- e8b#1: collateralFits applies to collateralOf's automatic pick and the Collateral page's candidate (read off the account's own rows); use() is unchanged. sessions.ts and dapp.ts use the same rule, and a Bootstrap passes no collateral. coin-control ↔ lovejoin is a new import cycle, but neither side uses the other's binding at module load.
- w3#1 / e8a#1: SessionRecord.mix records the reviewed depth and delay (not for a Bootstrap), and buildBack prefers them for the chain and its delay.
- e1b#1: refusesEvery ends Bring every box back's run when giveme.my is unreachable, at 429 or not JSON, or when Koios reports trouble. A 5xx ends it at the second in a row, and box-specific refusals still pass on to the next box.
- e2b#2's receivedOf sums only returns that went (unsent and replaced are excluded), and `brought` is kept on a resend.
- e7a#3: inspect takes an unlisted own output as the session's only if it's recorded, unspent per utxo_info, not collateral and not counted spent. partsUnlisted holds Stop for up to LOST_AFTER_MS.
- x4#1: the quiet check is read again right before takeDue, rememberSpent and the submit, and is passed through the rewards retry; Bring-all and withdrawNow are exempt, as the notes said. x4#2: stillUnder runs before order, cancel and bringBack sends, and releases the session's reservation.
- x2#2: atContract covers ownedUtxos, the Koios view, the index view and the Seedelfs locator, with SETTLED_RULE 2. The wasm at_wallet_contract covers check_spendable, recipient_register, remove_spend and withdraw_private_in, and the CLI's utxos.rs readers have their own. Every wasm private-spend builder I checked runs check_spendable first.
- gap-g3#2: letGoUnseen skips running sessions and needs a tx long past, unknown to tx_status, its inputs unspent, and nothing else of the session on its way.
- d1#3 / x3#1 / w2#2: spender() matches wallet.ak at 5b82530 (Owner if is_payable; Anyone for an identity public value with valid points, or no register; otherwise Nobody). Carried datums are keyed by the hash of their raw bytes. The 'dead' callout shows, and paidTo labels it as the contract.
- w2#1, w2#3, w2#6, w1b#2: cip30_test 81, decode_test 40 and api_test 96 all pass in my copy; the core eval change gives a Byron output its base58.
- r2a#2, r3b#1, r3a#2, r2b#3, r2b#4: core changes as reported. core's cbor::check_nesting matches cip30's old walk (128 levels, the same wrapped-bytes rule).
- Translations: en, es and ja have the same 3,038 base keys and agreeing placeholders. Nothing in src, tests or docs still uses the five keys e9b#2 renamed to .warn. names.
- Every fixed medium or high has its test in the right file citing its id. x3#1's cases sit in d1#3's tests without its id.
- The whole extension suite on the default build in my copy: 3,550 passed, 4 skipped; tsc --noEmit clean. The two 5 s timeouts seen under load (sessions.test.ts's cancel case, maybe-sent.test.ts's lock case) pass at 90 s, so load flakes, not regressions.

## Notes

- For the lead: the merged tree's extension suite fails only on CI's preprod-only leg (r2still#3). On the default build everything passes. Run `VITE_ENABLE_MAINNET=false npm test` before the PR.
- x1a#3 residual (r2still#1): a second top-level 674 label hides the same way in the wallet. Whether Conway's decoder takes duplicate top-level labels is worth one cardano-cli check offline; the duplicate "msg" inside a 674 map is ledger-valid either way.
- e7a#3 widens gap-g4#2, the owner's open call. A swap that spends the funding's unlisted 5 ₳ part now passes inspect as the session's own, where it used to pause. Its return then can't put up a collateral and comes back directly, as gap-g4#2 already describes for a listed one.
- gap-g6#2 (confirmed low; its verifier says needs_owner false): no fix commit names it. A custom account's deposit boxes (index 24+) still read as the private balance's after a restore.
- x3#1 has no test citing its id. Its constructor-0-general-form cases live in d1#3's cip30_test and decode_test, while FIX.md asked to keep the id.
- Nit: core lovejoin/mod.rs:293. mix_box_address's doc line ('`mix_box`'s enterprise script address, where every box sits.') now opens spends_as_mix_box's doc, and mix_box_address lost its doc.
- b1#5: the pinned action SHAs (dtolnay/rust-toolchain df2a88e9…, Swatinem/rust-cache d1527c8f…, softprops/action-gh-release 3bb12739…) can't be checked offline. A wrong one fails its job, so confirm each resolves before the next CLI tag.
- e2b#2's strangers rule assumes auto.fills is complete. Any fill or refund that arrives after the outcome run counts as a stranger's (r2still#2 is that case). A later partial refund would hit it too.
- G4 already said it: under a load average of 20+, several 5 s Vitest defaults time out. The lead's checks need a quiet machine or a longer --testTimeout.

## Coverage

Brief and record: read COMMON.md, FIX.md, RESUME.md, BASELINE.md, fix-branches.md and all six fixer reports. Read the INDEX table (all 323 lines, parsed) and the verify records of r3a#1, x2#1, r4#1, r4#2, e1a#1, e3a#1, e3a#2, e7a#1, x3#1, x4#1, gap-g4#1, gap-g4#2, gap-g5#1 and gap-g6#1, plus owner flags across every verify file. Read every fix commit's message in f87c3e77..HEAD.

Read in full in FIXTREE: the round's diffs of rpc.ts, dapp.ts, DappApprovals.tsx, ui/dapp.ts, coin-control.ts, balances.ts, contract-scan.ts, incoming.ts, pending.ts, sessions.ts (whole diff, plus act, inspect, buildBack and sendChain around it), lovejoin.ts (whole diff, plus withdrawOne and withdrawDue), lovejoin-pools.ts, wallet.ts, account.ts, accounts.ts, handlers.ts, App.tsx, tx-view.ts, destination.ts, collateral.ts, Swaps.tsx's NewSwap part, ClaimAll.tsx, SiteSessions.tsx, Collateral.tsx, format.ts, tokens.ts, Activity.tsx and activity.ts, and the en.json diff. In core: lovejoin/mod.rs's diffs (all five commits), withdraw_declaring in full, build.rs's 21caa3b8 hunk, cbor.rs's new walk, utxos.rs (03cf290e), and the CLI's external/sweep.rs. In wasm: cip30.rs's diff (spender, register_fields, carried datums, Byron owner, the paid loop) and lib.rs's 514c6579, a6b37119 and b27f0160 changes. Also check.sh's diff and release.yml's diff.

Skimmed: Lovejoin.tsx (the e8a#3, e8a#2, gap-g2#3 and gap-g2#4 parts), decode.rs (address and register detail only), the es and ja files (key parity only), Lean controls (names only), seedelf-koios and the rest of the CLI's commands.

Not read: rows.rs, web_server.rs, index.js, history.rs, the koios.rs paging rewrite, e2e spec changes, the screens I didn't name (Withdraw, CardanoSend, Receive, Utxos, Voting, Pools, Delegations, MoveIn, CreateSeedelf, RemoveSeedelf), and the Lean modules (never built). seedelf-data was not read beyond one grep showing index rows carry db-sync's bech32 address.

Runs, all in my own copy ($HOME/.cache/seedelf-review-51/R2still, now removed; FIXTREE untouched, git status clean):
- Vitest default build: all 289 files pass.
- Vitest with VITE_ENABLE_MAINNET=false: 2 files fail (r2still#3).
- tsc: clean.
- Rust: core lovejoin_test's r3a#1 and x2#1 cases; the CLI's cli harness, 57/57; wasm api_test, cip30_test, decode_test and lovejoin_test.
- Not re-run: the rest of the Rust workspace and the parts suite (the lead ran 933 tests at c8003eda, the last Rust change).
- Two probes (r2still#1, r2still#2) and one mutant (e2b#2's strangers off), described in the findings.

Lows sampled against the code, 35 or more: e3a#2, e3b#2, e3b#4, x1a#3, x1b#1, e4a#1, e6#2, e4b#1, e4b#2, e5#2, e8b#1, w3#1, e8a#1, e1b#1, e2b#2, e7a#3, x4#1, x4#2, x2#2, gap-g6#1, gap-g3#2, x1a#1, e9a#3, e8b#2, e8b#3, e8b#4, e9a#2, e9b#1, gap-g10#1, gap-g2#3, e8a#3, e9b#2, d1#3, x3#1, w2#1, w2#2, w2#6, w2#3, w1b#2, r2a#2, r3b#1, r3a#2, b1#1, b1#4, b1#5, v3#1 (script only).
