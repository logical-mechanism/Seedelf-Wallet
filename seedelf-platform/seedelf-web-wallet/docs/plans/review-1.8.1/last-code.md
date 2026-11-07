# 1.8.1's last look at the round-two fix-ups: code

Reviewer `last-code`. Lens: the code and tests of the fix-ups (`git diff a619169f`). That covers:

- the revert of v-pv11-impact#2, and the new tests that hold it;
- koios.ts's `KeyHashObj` gate, and everything that reads its words or its type;
- r2-last#1's tests and r2-tests#2's timeouts;
- the rust lane's two-key fee tests.

I read the main tree as merged, and ran mutants in a private copy of the extension only.

**In short:**

- **No defect found.** Every hunk in my part does what its report says. Each new test fails on what it claims to hold, and for the reason it gives.
- **The revert is complete:**
  - `unknownInputs` is `2a8060d3`'s, bar one doc sentence, and nothing in `src/` reads a 3004's reason any more;
  - `tests/lovejoin.test.ts` is `2a8060d3`'s byte for byte (sha256 `ff935e22…` both);
  - the planner test file differs from `2a8060d3`'s by its one new test;
  - round one changed no shared fake or fixture for v-pv11-impact#2, so there's nothing else to undo.
- **The gate is right for every real PV10 and PV11 body.** I checked this against cardano-ledger's source:
  - Both rules name only the withdrawals that fail.
  - Each names its account by a derived `Show` of the credential, `KeyHashObj (…)` or `ScriptHashObj (…)`.
  - cardano-submit-api hands that `show` text on, through Koios and the data layer alike.
  - The one loose case is the worker lane's documented one: a script's refusal beside a second failure that shows a key's address.
- **The rust lane's minimums are worked out apart from the code under test:**
  - Core's takes its count of keys from the test, and signs with fresh random keys.
  - WebAssembly's reads every signature from the signed bytes, and each caller first asserts who signed.
- **Runs:**
  - the nine touched extension files, 402 of 402, and the typecheck clean;
  - core's `lovejoin_pools_test`, 41 of 41, and WebAssembly's `lovejoin_test`, 35 of 35;
  - 14 TypeScript mutants, each restored and checked by sha256;
  - the rust lane's own mutant records, read.
- **Four notes for the lead, none a defect** (*Notes*, below).

## Findings

None.

## Checked, and it held

### The revert of v-pv11-impact#2

**The code** (`EXT/src/background/lovejoin.ts:595-615`):

- `MISSING_INPUT` is gone.
- `unknownInputs` names only an `unknownOutputReferences` list, as at `2a8060d3`. Its doc gains one sentence, and nothing else differs.
- Nothing else in `src/` reads Ogmios's 3004 reason. The only `reason` read near an evaluation is WebAssembly's own `declaredCovers` answer (`:4545`, `:4823`), which round one never touched.

**What an answer that names nothing now does**, traced through both callers:

- **tailWitness** (`:4542-4544`): `[]` fails `unknown?.length`, so it's a `StalePool([])`. witnessTail (`sessions.ts:5397`) catches only CollateralError and KoiosError, so the chain stops there in `lj.stalePool`'s words. That's 1.8.0's behaviour.
- **crossCheck** (`:4821-4822`): `StalePool([])` again. unstale (`:4598`) adds nothing to `avoid`, and after STALE_POOL_TRIES it throws `lj.poolDrifted`.
- `StalePool`'s message names no inputs, so an empty list shows nothing odd.

**The tests:**

- `tests/lovejoin.test.ts` is `2a8060d3`'s exactly: `unknownBox` and the runner's case answer the invented 3117 again.
- `tests/lovejoin-planner.test.ts` differs from `2a8060d3` by the new test at `:1575` alone. The two "asks again" cases are back on the 3117.
- `tests/lovejoin-refusals.test.ts:156` now holds the reverted rule:
  - the recorded answer gives `[]`, which is stale, not `undefined`;
  - a 3117's list is still named.
- No other test, fake or fixture depends on the naming:
  - `unknown_inputs.json`, "missing from UTxO set" and `unknownTo` appear only in those three files;
  - `fakes.ts`, `chain-fixtures.ts` and `v2-pools.ts` are unchanged since `2a8060d3`;
  - no e2e spec names any of them.

### The new tests hold what they say

**R1, round one's naming put back.** All four new tests fail, each for the reason it gives:

| Test | What R1 gives |
|---|---|
| `lovejoin-refusals.test.ts:156` | `expected [ "a1…#0" ] to deeply equal []` |
| `:222`, the public Mix again | `got 'None of your boxes in Lovejoin's pool came from a mix from your public account.'` |
| `:237`, the private Mix again | `mix.skipped` is `'none of your boxes is in Lovejoin's pool anymore'` |
| `lovejoin-planner.test.ts:1575` | `expected undefined to be "Lovejoin's pool changed while the wallet read it."`: the chain waits |

**T1, tailWitness's `unknown?.length &&` dropped,** so that an empty list reads as Ogmios being behind:

- Of that describe's 48 tests, only the planner's new test fails.
- So the new test also holds a guard nothing held before.

**What each new test asserts is what its title says:**

- **The public Mix again (`:222`):**
  - It throws `lj.poolDrifted`.
  - It counts three evaluations, each of a transaction that spends one of the account's own boxes, so all three tries drew them.
  - With nothing named, it couldn't pass vacuously: a build that worked would fail `rejects.toThrow`.
- **The private Mix again (`:237`):**
  - Nothing is skipped.
  - The retry is in `lj.poolDrifted`'s words.
  - Only the funding (`out`) was sent, after three evaluations.
- **Both copied setups are faithful.** `cutAfterDeposit` matches lovejoin-reward-balance.test.ts's line for line, but for what it returns. `adaBox` takes either a byte or a whole hash.
- **The planner's stop (`:1575`):**
  - The chain is stopped in `lj.stalePool`'s words, and ended.
  - giveme.my is never asked.
  - Its `spent` mark doesn't short-circuit the path: R1 shows tailWitness is reached and decides it.

### koios.ts's gate (`koios.ts:1252`), against the real bodies

**Protocol version 10,** read at `cardano-ledger-conway-1.17.4.0`:

- The failure is `WithdrawalsNotInRewardsCERTS !(Map.Map (RewardAccount …) Coin)`.
- `RewardAccount` derives `Show` (`RewardAccount {raNetwork = …, raCredential = …}`), and so does `Credential` (`ScriptHashObj !(ScriptHash c) | KeyHashObj !(KeyHash kr c)`).
- So the two bodies the worker lane rewrote are PV10's real shape: `koios.test.ts:382` and `staking.test.ts:777`, each `ConwayCertsFailure (WithdrawalsNotInRewardsCERTS (fromList [(RewardAccount {raNetwork = Testnet, raCredential = KeyHashObj (KeyHash {unKeyHash = "…"})},Coin 1500000)]))`.

**Protocol version 11,** read on cardano-ledger's main branch:

- Shelley's `testIncompleteAndMissingWithdrawals` fails on `withdrawalsThatDoNotDrainAccounts`, and on nothing else.
- Its two failures are `ShelleyWithdrawalsMissingAccounts Withdrawals` and `ShelleyIncompleteWithdrawals (NonEmptyMap AccountAddress (Mismatch RelEQ Coin))`.
- Conway's LEDGER maps them one to one onto `ConwayWithdrawalsMissingAccounts` and `ConwayIncompleteWithdrawals`.

**What the gate gives each case:**

| The body | What it gives |
|---|---|
| A key's account alone | `KeyHashObj` is there: staking's words, a `RewardsChangedError` |
| A script's account alone | The network's words, a `RewardsChangedError` |
| Both in one transaction, the key's taken whole | Only the script's is named: the network's words. That's right, since the user's staking didn't change |
| Both in one transaction, both refused | Staking's words |
| A script's beside another failure that shows a key's address (an output too small, say) | Staking's words: the worker lane's documented case |
| A script's beside `ConwayWdrlNotDelegatedToDRep` | That failure shows `KeyHash {…}`, not `KeyHashObj`, so it doesn't count: the network's words |

**The text is `show` text through both backends:**

- cardano-submit-api renders each failure with `show`. That's the shape of the live-found `ConwayMempoolFailure "All inputs are spent…"` (`submit-inputs-spent.test.ts:22`).
- The data layer passes `submittx` to home's cardano-submit-api (`seedelf-data/README.md`, *The submit part*), so its text is Koios's.

**Its place in submitTx:**

- It sits after the spent check (`:1243`) and before stakingRefusal.
- A refusal that names no withdrawal is untouched.
- Round one's ordering inside stakingRefusal still holds: `WithdrawalsMissingAccounts` before `NotDelegatedToDRep`, and DELEG's names.

### Who reads the words or the type

- **By type,** each rewords it as `REWARDS_MOVED()`:
  - pumpPublicNow (`lovejoin.ts:5424`, `:5446`);
  - withdrawOne (`:7708`);
  - the session chains' `pump` (`sessions.ts:5309`, `:5321`).
  - That `pump` sends only a session's Lovejoin return chain. Its deposit and its return withdraw nothing, and its mixes withdraw only from `mix_logic`. A direct swap's submit never goes through it.
- **By words: no one.**
  - Nothing in `src/ui`, `src/shared`, `ui-port.ts` or `sw.ts` reads `koios.staking.rewardsChanged`, `koios.staking.changed` or `koios.rejected`.
  - `retryReasonOf`, `unsentWhyOf` and `codeOf` read types and `trouble` alone.
- **Staking's flows** (Withdraw, Stop staking, a payment that spends rewards): every withdrawal they build is the public account's, a key's. So `KeyHashObj` is in every refusal, and the words are unchanged.
- **A direct swap:** the network's words, on the runner's retry and on its page (`direct-swaps.test.ts:657`). Its Send throws the same error from the same submitTx.
- **A site's transaction:** `send` throws a DappError whose `failure` is English `dapp.notSent`, and `sw.ts:427` posts `e.failure` alone.
- **K1, the gate dropped:** three tests fail, koios.test.ts ×2 and direct-swaps.test.ts ×1, as the worker reported.

### r2-last#1's tests

**Each option dropped from the rebuild line (`lovejoin.ts:7709`)** fails its own test at both protocol versions, and none of the describe's others:

| Mutant | What fails |
|---|---|
| L-bring | the Bring every box back mark, ×2 |
| L-unlocked | the lock and unlock, ×2 |
| L-bootstrap | the Bootstrap's count, ×2 |
| L-holder | the Bootstrap's count, ×2 |

**The lock test runs what it says:**

- giveme.my's fetch is read at call time, so the lock falls inside the rebuild, and `asked` is 2.
- The rebuild throws `lj.lockedWhileBuilding` before it takes the due time back, and the first try's `neverWent` had put it back already.

**The PV10 body these tests share** (`NOT_IN_REWARDS`) names no account. So it gets the network's words, as a real script's body would, and Lovejoin reads only the type. The tests behave as they would with the real shape.

### r2-tests#2's timeouts

- **With `SLOW` at 50 ms,** the three tests time out (S1, S2), so Vitest 5.0.3 hands the describe's timeout to its tests.
- **dapp.test.ts's two tests** (`:808`, `:1409`) are direct children of their describes (`:153`, `:1143`), with nothing nested in between.

### The rust lane's two-key fee tests

**Merged intact:** the main tree's hunks in `lovejoin_pools_test.rs` and `wasm/tests/lovejoin_test.rs` are the lane's patch line for line.

**Core's `ledger_minimum_fee`** (`seedelf-core/tests/lovejoin_pools_test.rs:1605`):

- **The count is the test's:**
  - 2 for `two_keys`, whose fee UTxO sits at `session` and its collateral at `other_key`;
  - 2 for the deposit, from UTxOs at two keys;
  - 2 for giveme.my beside the session's key.
- **The size is real:**
  - The test signs the unsigned transaction `signers` times with `build::fake_signer()`, which is a fresh `SecretKey::new(OsRng)` each call.
  - Pallas 0.35.1's `sign` pushes a witness each time, so two signers are two witnesses' bytes.
  - It shares only that signing step with the builder's `settle`.
- **The prices are its own:** exact rationals with one ceiling over the total, as the ledger's `txscriptfee` has it, and 15 lovelace a byte of every spent and read input's reference script.

**WebAssembly's `each_pays_the_ledgers_minimum`** (`wasm/tests/lovejoin_test.rs:765`):

- The size comes from the signed bytes, and the prices are worked out the same way.
- The reference scripts come from the rows, the pool's references and the outputs of the transactions before.
- An input it can't find panics, so nothing is skipped silently.
- Every caller asserts who signed first:
  - `signers(…)` in the chain test and the Mix again test;
  - the witness counts in the new test and in the paid withdraw.
  - So a transaction short of a witness can't lower its own minimum.

**The lane's records** (`SCRATCH/fix-r2-rust/mutants.jsonl`) match its report:

- G1–G3 are caught in core and in WebAssembly.
- H1–H6 survived before this round, and are caught now.
- H4a and H4b survived the extended tests, and the new test catches them.

**Re-run on the main tree,** by name: 41 of 41 and 35 of 35.

## Notes for the lead

None of these is a defect. Each is something a mutant showed no test tells apart.

1. **Two variants of the gate survive, and neither difference is reachable from the wallet's own flows:**
   - **K2,** staking's words unless `ScriptHashObj` is named. It differs only for a body that names no account, which no real refusal is. The worker lane said so. It passes 157 of 157 in five files.
   - **K3,** `KeyHash` in place of `KeyHashObj`. It differs for a script's refusal beside a failure that names a bare key hash, such as `ConwayWdrlNotDelegatedToDRep` or missing signatures, and that takes a site's transaction. It passes 110 of 110 in four files.
2. **No test holds the spent check above the gate.**
   - With the gate moved above `koios.ts:1243`, the 34 files that name a spent input or a withdrawal refusal pass, 711 of 711.
   - The order is right as merged. The combination is realistic: another wallet's mix that draws one of the wallet's boxes must take the pool's whole balance, so the wallet's own is then refused for both.
   - Today that's a SpentInputError: a chain's step looks for it with `sentAlready`, then retries. Moved, it would be a `RewardsChangedError`: the chain stops at once in `REWARDS_MOVED()`'s words, and withdrawOne builds once more before the spent box refuses it. That's benign.
   - A resend of the wallet's own transaction that landed meets the mempool's "All inputs are spent" first. That names no withdrawal, so either order gives a SpentInputError.
   - stakingRefusal's own `RewardsChangedError` has sat below the spent check since chunk 43, and no test holds that either. O3 moves the gate and stakingRefusal above the spent check together, keeping their own order, and it passes the same 711. (O2, stakingRefusal alone moved above, fails only the gate's three tests, because it then runs ahead of the gate.)
   - A body with both `BadInputsUTxO` and a `ConwayIncompleteWithdrawals`, expected as a SpentInputError, would hold both.
3. **WebAssembly's fee check has no upper bound** (`fee >= needed` alone), as the lane says.
   - So a slip that counts too many of the account's keys would pass. One example: a fee UTxO and a collateral at one key counted as two. That overpays one signature's bytes, about 4,400 lovelace a transaction.
   - Core can't see it, since core prices the count it's given.
   - Mix again prices on the most keys by design, but the counts in `chain_from_account_at` and `withdraw_paid_in` are exact. A bound like core's (`< 1_000` a mix or deposit, `< 6_000` a paid withdraw) would fit those. It's optional.
4. **Two leftovers from going back to `2a8060d3`, both optional:**
   - `NOT_IN_REWARDS`'s PV10 body isn't PV10's shape (above). It's harmless.
   - The comments at tailWitness (`lovejoin.ts:4536-4537`) and witnessTail (`sessions.ts:5406-5407`) still describe the "behind, ask again" rule as live. They're `2a8060d3`'s text, and `unknownInputs`' new sentence and architecture.md's pointer now say no real answer reaches that rule.

## How I worked

- **Read:** every hunk of the fix-ups in my part, and the code each reaches:
  - `submitTx`, `stakingRefusal`, `WITHDRAWAL_REFUSED`;
  - tailWitness, witnessTail, crossCheck, unstale and withdrawOne;
  - pumpPublicNow and the session chains' `pump`;
  - dapp.ts's `send` and `notSent`, and the UI's readers.
- **Ledger source, read only on GitHub** (`gh api`):
  - `Conway/Rules/Ledger.hs` and `Shelley/Rules/Ledger.hs` on the main branch;
  - `Conway/Rules/Certs.hs` at `cardano-ledger-conway-1.17.4.0` and `-1.19.0.0`;
  - `Address.hs` and `Credential.hs` at 1.17.4.0.
- **A private copy of the extension** at `SCRATCH/review/last-code/tree/`:
  - `src`, `tests` and the configs are copied;
  - `node_modules` is linked entry by entry, with Vitest's caches kept local;
  - `wasm`, `docs` and the crates are linked read-only.
  - `diff -rq` held the copy equal to the main tree before the mutants and after them.
  - Mutants ran there alone, through `SCRATCH/review/last-code/mutate.py`. Each checks the file against the main tree before it runs, and checks the restore by sha256 after. The outcomes are in `mutants.jsonl`, each run's log in `mutant-<id>.log`.
- **Runs:**
  - in the copy: the nine touched files, 402 of 402, and `tsc --noEmit -p .`, clean;
  - in the main tree, by name: core's `lovejoin_pools_test` and WebAssembly's `lovejoin_test`, `--locked`.
- **Not done:**
  - no file in the main tree but this report, and no `zz-r181-code` repro was needed;
  - no build, no npm install, no e2e or `e2e/live`, no `--ignored`;
  - nothing in seedelf-data, no lake;
  - no network but the GitHub reads above.
