# 1.9.0 gate review: the verified findings

This is the review of `web-wallet/release-1.9.0` at `8d7c4b0c` (PR #378), covering everything since `web-wallet/1.8.1` (`f77aa5c1`). It was run in two rounds:
- **Find:** nine lanes and a completeness critic (`find-result.json`, `find-full.txt`).
- **Verify:** nine verifiers, each told to refute (`verify-result.json`, `verify-full.txt`).

Paths below are relative to `seedelf-platform/seedelf-web-wallet/` unless they start with `seedelf-platform/` or another top-level folder.

There are no high findings.

## Medium

### M1 (#373): honest position actions on real dApps get the release warning, with false figures and false words

**Merges:** cip30-rust#1, dapp-ui#2, i18n#1 and i18n#2.

**The grades split:**
- **v-a-impact: medium.** It ran on 7 real Indigo transactions.
- **v-a-trace: low.** Its reasons: no exploit, and the owner's stated trade-off.
- **I take medium,** for how often real users hit it.

**Mechanism.** `released_from_contracts` (wasm/src/cip30.rs:1099-1135) counts every contract UTxO's value that doesn't reach the account's addresses. That includes value re-created at the same script, which is on purpose: cip30.rs:1105-1106 covers a listing relisted under a new owner's datum. It applies whenever the account's key is a required signer, or a datum names it.

**On chain** (v-a-impact, re-keyed to the test account through `cip30::inspect_tx`): every Indigo V3 CDP adjust and close, and every INDY staking adjust, gets the row, the contractYours callout and the switch.
- The owner's key is the only required signer.
- The datum names the owner.
- The position is re-created at the same script.
- A shared protocol UTxO is re-created too: `eeea2dd2…` for CDPs, the staking manager holding 101,604 ₳.

**What the row shows.** "Leaves a contract, not to you" covers the whole position plus the shared UTxO:
- 75,005 ₳ for an 81.65 iUSD repay;
- 41,505 ₳ for an 8,000 ₳ deposit;
- 520,005 ₳ for a 1,408 iUSD repay;
- 101,606.53 ₳ for staking 222 INDY more.

**What the callout says:** "Your signature releases your own order or listing from a contract. It doesn't come back to you." That's false every time.

**How often:** Indigo has 314 live CDPs from 264 owners, with 212 CDP actions in 30 days as a lower bound.

**Synthetic cases (v-a-trace):** a top-up shows the whole vault, a partial withdrawal what's left, borrow-more position plus pool, a partial cancel the remainder.

**The words:**
- The row and the switch ("I expect this to leave the contract") say the money leaves, when it stays.
- contractYours asserts ownership, the kind of contract and loss as fact. `namesKey` is only a 28-byte window scan matching the key in any role (cip30.rs:1093-1096, 1270).

**Documented:**
- PR #373 and architecture.md:563 accept the mechanism: a reprice, "a loan's repayment can read as releasing the ADA paid on".
- Nothing states the breadth (positions, shared-state UTxOs, partial cancels and withdrawals, a burnt position token), or that the words are false there.

**No safe exemption exists.** An honest reprice and an attacker's relist at the same contract render byte-identical windows (v-a-trace/review-v-a-trace-same.test.ts).
- A "kept at the same script" exemption removes the attack's warning along with the honest one.
- A gate on "the new datum names the key" is bypassable: a 1-lovelace payee, or the key in a spare field.
- Indigo rewrites its datums on every action, so a byte-identical-datum rule covers none of these.

**Safe fixes (wording and docs; no request, nothing refused):**
- Row: "From a contract, not to you".
- Switch: "I expect this not to come back to me". A cancel-redirect victim answers no; a repricer, or a top-up, answers yes.
- contractYours, claiming only what's computed: "This contract's data names your key. What your signature releases here doesn't come back to you."
- Optional: an info row "Goes back to the same contract: X ₳" that leaves the switch in place.
- Docs: name the class in architecture.md:563 and flows.md:430.
- Redraft es and ja and back-translate them, minding the negation word lists.
- Tests to update: dapp-prompt.test.ts:107-116 and e2e extension.spec.ts:5845-5853.

## Low

### L1 (#373, cip30-rust#3): a burnt position or auth token reads as "Leaves a contract, not to you"

- Confirmed on 2 real Indigo closes, beside the mint row's "Burns 1 CDP".
- `released_from_contracts` never gets the burn map (cip30.rs:1758-1767, 1826).
- **The finder's fix is unsafe.** Subtracting the burn lets a burn of the account's own units, or the site's, stand for the contract's units leaving. Two verifiers each showed it hiding a take.
- **Safe version:** credit only the burn beyond the account's own net put-in, and the found strangers' inputs, of that asset. Give no credit when an input wasn't found. See the diffs at v-a-impact/burn_mutant.diff ("guarded") and v-cip30-lows/v3-burn-fix-mutant.diff ("refined").
- On Indigo, the close still warns through M1's shared UTxO.

### L2 (#373, cip30-rust#2 + critic#1): the documented limits are narrower than what the code does

**(a) The native-script clause** `contract_inputs > 0 && script_data_hash.is_none()` (cip30.rs:1838) switches off with any script data hash. A supplemental datum alone gives one, with no Plutus and no collateral:
- ledger: Alonzo Tx.hs:466-471 and Babbage UTxO.hs:79-84;
- 5 real transactions show it.

The docs say "a transaction that also runs Plutus".

**(b) Other proofs of ownership.** A Plutus contract can take a withdrawal, a certificate or a vote as the owner's proof, not only the owner's input. If its datum is kept by hash and withheld, only the note shows.

**Fixes:**
- **Docs:** widen architecture.md:563 and the PR's limits.
- **No-request code options (owner's call):**
  - Verify the body's script data hash against the witness set shown. With no redeemers it's blake2b-256(A0‖datums‖A0); with redeemers, `orders::integrity_hash` plus the cost models.
  - Count a contract input whose datum is kept by hash and isn't in the witness set as key-released. Prototyped: the 65 tests pass and p8-p10 flip. The cost: a dApp that shows an incomplete witness set gets the switch.
- A script-type lookup would be a new request and a data-layer change, so not that.

### L3 (#373, cip30-rust#4): an unfound contract input signed for by the stake key alone gets no warning

- The window says "It spends 1 UTxO the wallet couldn't find… Only your stake key signs here."
- It's narrow. An order placed through the connector is kept for 20 minutes and is found. A site's session can't sign a swap session's order: it gets `nothingToSign`.
- What's left: an order made outside this wallet naming the account's stake key, spent before the data source lists it.
- **Fix:** when `keyReleases && unknownInputs`, show the warning and the switch. Or drop the sentence.

### L4 (#373, cip30-rust#6): up to 10 ₳ of a contract can be burnt as fee with only the note

- Above 10 ₳ it warns, but understates by 10 ₳.
- The PR says "a contract burned as fee still warns".
- It's griefing only: the fee goes to the reward pot.
- **Fix:** document it. The cap is sound: the largest possible fee is about 8.9 ₳.

### L5 (#373, i18n#3 + the blind back-translation): the switch commits to different things in each language

- **en:** "I expect".
- **es:** "Sé que esto sale del contrato", which means "I know": awareness, which a victim who has read the callout has. It has a second reading, "comes from the contract".
- **ja:** 想定どおりです, "is as expected". It can read as the wallet's own reassurance that this is normal. Japanese acknowledgement labels usually say …ことを理解しました or …ことを確認しました.
- **Fix:** redraft with M1's switch wording and back-translate.
- Blind-check nits:
  - es contractYours's "liberar una orden" has a business sense, "approve an order for execution".
  - ja notes say 使用します ("uses"), weaker than "spends".
  - 保持額は X ₳ とトークンです is unnatural.

### L6 (#373, dapp-ui#3): Transaction details never marks the DRep key as yours

- Nor another account's payment keys past 20.
- Meanwhile the sign window says "It signs for … your DRep".
- markYours (background/tx-view.ts:247-307) has no `drepOf`.
- **Fix:** derive `drepOf().hash` per account, as dapp.ts publicKeys does, gated on the request's governance flag.

### L7 (#373, cross#1): the session's own cancel review and Danogo direct-swap review say "the wallet asks nobody"

- But `inspect` looked up the order, the pool and the collateral UTxO through `koios(network).utxoInfo` (sessions.ts:4359).
- This dates from 1.8.1. #373 fixed only the sign window, and its test comment (tx-view-screen.test.ts:96) states the opposite rule.
- **Fix:** a `lookedUp` prop on the session-tx-detail button picks tx.privacy.inputsHintSite, set when `review.kind === "cancel" || review.againstPools`.
- Not `site`: that also switches the signatures row to the site's text.

### L8 (#375, routes#1): routeOf's second estimate can fail, and the user then sees Minswap's raw error with an endless retry

**Two ways it fails:**
- a 400 for a name the validator refuses (no trigger seen);
- a 404 "Quote not found" when the exclusion leaves no route (seen live, in a constructed case).

**What follows:**
- The quote shows "Minswap refused it (400/404): …"; the 400 version is about 1,275 characters.
- A funded runner retries every 30 s, backing off to 5 min, with no end, instead of pausing.
- 1.8.1 refused in the wallet's words and paused, which is architecture.md:669's design.
- Stop works, and no money is at risk.

**Fix, tested** (v-routes/fix-routes1b.diff):
- Add trouble codes `name-refused` (`/exclude_protocols\/\d+ must be equal to constant/`) and `no-route` (404, `/^quote not found\.?$/i`), with `MINSWAP_REASON` entries.
- When the second ask fails with one of them, routeOf keeps `first`.
- 18 swap test files pass, 373 tests, and tsc is clean.
- Also a docs nit: architecture.md:660's cost line.

### L9 (#377, v4-orders#1): V4's `max_per_execution` is the fee a fill takes whole, and nothing holds it to the approved DEX fee

- A fill takes exactly the cap: 11 of 11 fills measured, and the SDK says so. V3's comparable field is only a ceiling.
- The V4 reader reads fields 0, 1 and 5 (orders.rs:504-514), and `approved` keeps no DEX fee (sessions.ts:394).
- An inflated cap passes up to `withinFunding`, an extra 1,779,103 lovelace at most per swap, by run.
- Only Minswap's build can reach it, which sits within the trust architecture.md:646 states.
- Today both fresh builds write cap = budget = 1.28 ₳ = the quoted fee.
- **Fix (owner's call):** record `approved.dexFee` at Start swap and hold the sum of the V4 caps to it. Sessions approved earlier fall back to the funding bound. Or add one doc line.

### L10: test gaps (every behaviour verified correct)

**#373:**
- **mutants#1:** there's no test of the required-signer or datum term in a Plutus-shaped body, the bounty's own shape. Mutants e and f survive, and the e2e's transaction has no script data hash either. Killing tests: mutants/cip30_test-additions.diff.
- **mutants#2:** the per-asset `put_in` subtraction is untested (mutant d).
- **mutants#3:** the per-request switch is untested (mutant m survives Vitest and the e2e, whose step can't fail). A verified queued-window e2e is in v-e2e-queue/probe-e2e-queue.ts.txt: 12/12 on the dev and store builds, and 3/3 failures under m. Rewrite extension.spec.ts:5870-5878 into it.
- **mutants#5:** a stranger's key input counted as a contract input (z1).
- **cip30-rust#7:** a DRep signer, an unfound contract input, a non-canonical datum, an untagged list, and a real chain transaction. Probes r2, r3, r6 and r7 are in cip30-rust/review_cip30_rust_test.rs.
- **cross#3:** reading a release through a private session's keys (cross/cross_review_test.rs.txt).
- **dapp-ui#4:** yourSigners' session-stake and other-account-stake branches.

**#375:**
- **mutants#4:** routeOf's network at swapBuild and order() (z6, z7). Pins are in v-routes/v-routeof-network.test.ts and v-routeof-mainnet-runner.test.ts.

**#377:**
- **mutants#6:** fills_once's second module (z9); also z5.
- **routes#3:** V4's Stop, restore-scan find and fill have no Vitest; routes/review-v4-stop.test.ts shows they work.
- **Optional:** v-v4-build's build A, re-keyed to a test session, as a whole-transaction fixture.

### L11 (#373, i18n#4): the contract-UTxO notes aren't in the critical set

- They're the only signal in the documented limits.
- Rename them to `dappUi.note.warn.contractInputs*` and list them in verified-critical.

## Nits

- **cip30-rust#5:** the datum scan runs again for every contract input. A crafted 62 KB transaction, which can't go on chain, costs about 0.9 s per read in wasm: a site freezing its own window. The memo is prototyped: 480 ms down to 15 ms natively (v-cip30-lows/cip30-rust5-memo-scan-mutant.diff).
- **cip30-rust#8:** a key split across byte-string chunks is missed.
- **cip30-rust#9:** contract token totals saturate. The workspace rule says checked or u128.
- **cross#2:** markYours now opens every other account for every private spend's view: tens of ms, and up to 2.4 s at 100 accounts. That contradicts tx-view.ts:5 and flows.md:275. Cache each account's key set until lock.
- **dapp-ui#1:** the worker's dapp-answer doesn't check the switch. Sites can't reach it.
- **i18n#5:** the 12 new note values have a plain space before ₳. The released row at DappApprovals.tsx:1109 already has U+00A0, so that half of the finding was wrong.
- **i18n#6:** the verified-critical record for #373 names no keys.
- **v4-orders#2:** the orders.rs and orders_test.rs headers date V4's cancel facts to 2026-10-07, "from source or bytecode".
- **cross#4:** wasm/README.md's inspectDappTx row lacks the seven new fields.
- **docs-prep#3:** chunk 46's plan has a stale status line, table row and sentence.
- **docs-prep#4:** releases.md:50 links `plans/chunk-44-lovejoin-v2.md`, which is now under `archive/plans/`.

## Outside the wallet (#372, verification tooling)

- **docs-prep#1 (low):** check.sh counts an imported module's replayed Undetermined warning as the importer's own. It over-reports UNDETERM and never under-reports.
- **docs-prep#2 (nit):** seedelf-verification/README.md:53-55 still says to review the output for Undetermined warnings.

## Refuted, or nothing to fix

- **routes#4:** the free check ran. Two unsigned build-tx answers (USDr to sUSDr and USDCx to USDr), for a public mainnet sender with an unregistered stake key, pass readDexOrder, checkOrder, the dry-run cancel through V4's real script, and withinFunding. V4 swaps won't pause after funding on today's API.
- **routes#2:** preprod's direct-swap DEX gets funded, then paused. That's the stated trade-off, and not new.
- **The es and ja layout at 400×605:** no overflow and no clipping, confirmed by the screenshots too. In ja the callout starts at the fold.
- **cip30-rust#4's scenario of a site spending a swap session's order:** it can't happen; the site's session gets `nothingToSign`.

## Not covered

- No live preprod or mainnet run. V4's first live swap and Stop are still the live run's.
- es and ja were back-translated blind by a model, not by a native speaker.
- Not read from chain: Liqwid, Lenfi, Levvy and Optim, a real jpg.store reprice, and a pool swap that lists the user's key. Indigo was read.
- V4's validators aren't public. The scoop path (config_token, extension) rests on the SDK and on what's seen on chain.
- The attacker lane was stopped by a safety check before it ran anything. The critic's 11 probes and the verifiers' probes cover the defensive question.
- No package or zip rebuild. The full e2e and Rust suites weren't re-run (CI is green on #378).
