# 1.8.1's release review: v-pv11-trace

**Task:** trace readers#4 on its own: the protocol version on both networks, the ledger rule that refuses a short withdrawal there, cardano-submit-api's body for it, every match of the old name in the wallet and what each path shows, and the finder's repro. On `2a8060d3`.

**In short:** confirmed in full. I grade it low, not medium. Since protocol version 11 the ledger never says `WithdrawalsNotInRewards`, so neither of koios.ts's two matches fires on either network. What's lost:

- **The words:** Lovejoin's `lj.warn.rewardsMoved`, and staking's `koios.staking.rewardsChanged`. The user sees about 540 characters of raw JSON instead.
- **One rebuild:** a box's way back isn't built again once.

No flow gets stuck, nothing is lost, and both states are rare. The fix is worth making in 1.8.1. It's two regexes and one constant in koios.ts, uses only words that already exist, and brings back the behaviour the merged tests hold for the PV10 name. Five new test cases fail without it. With it, 517 tests in 29 related files and the full suite pass in a scratch mirror.

| id | verdict | severity | what |
|---|---|---|---|
| readers#4 | confirmed | low | The PV11 names `ConwayIncompleteWithdrawals` and `ConwayWithdrawalsMissingAccounts` reach neither `RewardsChangedError` nor staking's words |
| v-pv11-trace#1 | new | low | `stakingRefusal`'s DELEG regex misses the names nodes from 11.0.1 use, so a Stop staking reviewed at 0 rewards shows raw JSON too (predates #367) |

My repro was `EXT/tests/zz-r181-v-pv11-trace-1.test.ts`, run alone. It's deleted from the tree, and a copy is in `SCRATCH/review/v-pv11-trace/repros/`. The fix was tried only in a scratch mirror of the extension (`SCRATCH/review/v-pv11-trace/mirror/`, with symlinks to the real `node_modules`, `wasm/`, `seedelf-core` and `seedelf-crypto`), never in the tree. Its diff is `SCRATCH/review/v-pv11-trace/fix.diff`.

## readers#4 · confirmed · low

### (a) The protocol version on each network

I made two Koios reads, `epoch_params?select=epoch_no,protocol_major,protocol_minor&epoch_no=gte.…`. The start times are computed from each network's genesis.

| network | last PV10 epoch | first PV11 epoch | that epoch began | today |
|---|---|---|---|---|
| mainnet | 643 | **644** | 2026-07-18 21:44:51 UTC | epoch 666, PV 11.0 |
| preprod | 293 | **294** | 2026-06-10 00:00 UTC | epoch 324, PV 11.0 |

### (b) The ledger at PV11

**The nodes** (GitHub release notes, each one's component table):

- **11.0.1** (2026-05-05) runs cardano-ledger-conway **1.22.1.0**. Its notes say it is "the first release to support the PV11 intra-era hard fork".
- **11.1.0 to 11.1.3** run **1.23.0.0**.
- **11.2.0**, a pre-release of 2026-10-28 that isn't recommended for mainnet, runs **1.24.0.0**.
- **For comparison:** 10.7.1 runs 1.22.0.0 and 10.6.4 runs 1.20.0.0.

**The rule** (source at those releases' commits: `226b002d` for 1.22.1.0, `f649f975` for 1.23.0.0, `54e24ba4` for 1.24.0.0):

- **`Conway/Era.hs`:** `hardforkConwayMoveWithdrawalsAndDRepChecksToLedgerRule pv = pvMajor pv > natVersion @10` (1.22.1.0 `:201-202`, 1.23.0.0 `:283-284`). Its comment says why: "both invalid withdrawals (submitted in the wrong network or with missing account addresss) and incomplete withdrawals were being reported with WithdrawalsNotInRewardsCERTS but now ConwayWithdrawalsMissingAccounts and ConwayIncompleteWithdrawals are the new predicate failures we use to report the two separate cases in LEDGER".
- **`Conway/Rules/Certs.hs`** (1.22.1.0 `:228-238`, 1.23.0.0 `:223-233`): `Empty -> if hardforkConwayMoveWithdrawalsAndDRepChecksToLedgerRule $ pp ^. ppProtocolVersionL then pure certState else … WithdrawalsNotInRewardsCERTS`. So at PV11 CERTS never checks a withdrawal.
- **1.24.0.0:** `Empty -> pure certState` (`:220`), and `ConwayCertsPredFailure` is a newtype over `CertFailure` alone. The CHANGELOG says: "Remove `WithdrawalsNotInRewardsCERTS` from `ConwayCertsPredFailure`".
- **`Conway/Rules/Ledger.hs`** (1.23.0.0 `:383-391`):
  - From PV11 it runs `Shelley.testIncompleteAndMissingWithdrawals (certState ^. certDStateL . accountsL) withdrawals`, then `drainAccounts withdrawals` (which sets each withdrawn account to zero), and only then CERTS.
  - 1.24 runs the same check for every protocol version (`:397-398`).
- **`Shelley/Rules/Ledger.hs`** (1.19.0.1 `:351-359`, with `withdrawalsThatDoNotDrainAccounts` in core's `State/Account.hs` `:212-216`, `withdrawalAmount == fromCompact (account ^. balanceAccountStateL)`):
  - No such account, or the wrong network: `ShelleyWithdrawalsMissingAccounts` → **`ConwayWithdrawalsMissingAccounts Withdrawals`**.
  - Any amount other than the balance: `ShelleyIncompleteWithdrawals` → **`ConwayIncompleteWithdrawals (NonEmptyMap AccountAddress (Mismatch RelEQ Coin))`**.

**Can a network running today still say `WithdrawalsNotInRewardsCERTS` at PV11? No.**

- Every node that follows PV11 is 11.0.1 or later: 11.0.1 to 11.1.3 skip the check, and 11.2.0 doesn't have it.
- 10.7's 1.22.0.0 has the move too: it came in 1.21.0.0 (CHANGELOG: "Add `ConwayWithdrawalsMissingAccounts` and `ConwayIncompleteWithdrawals`", "Add `hardforkConwayMoveWithdrawalsAndDRepChecksToLedgerRule`").
- Only a 10.6 or older binary (conway 1.20 or older) would still say the old name. It could follow PV11 only with experimental hard forks enabled, which no public relay runs.

**From outside.** cardano-wallet #5351 (2026-07-29) quotes, from its integration tests, the node rejecting a reward withdrawal whose amount changed between calculation and submission:

`ConwayIncompleteWithdrawals (NonEmptyMap (fromList [(AccountAddress {aaNetworkId = Testnet, aaId = AccountId {unAccountId = KeyHashObj …}},Mismatch (RelEQ) {supplied: Coin 56788710131, expected: Coin 103246030846})]))`

Gero wallet #1129 (2026-09-21) met the two new variants on a mainnet staking withdrawal: its Ogmios v6.14.0 couldn't decode them. Biglup's account-custody contract issue #1 is a script's zero withdrawal from its logic account, our Lovejoin case. Its suggested fix is "Rebuild and retry once on `ConwayIncompleteWithdrawals`".

### (c) What cardano-submit-api answers

- **`Web.hs`** (11.1.3 `:160`, `:169`): `throwError $ err400 { errBody = Aeson.encode (Types.TxSubmitFail err) }`.
- **`Types.hs`:** `TxSubmitFail` gives `{"tag":"TxSubmitFail","contents":…}`. `TxCmdError`'s generic ToJSON gives `{"tag":"TxCmdTxSubmitValidationError","contents":…}`.
- **cardano-api's `InMode.hs`** (11.0.0.0, the same file in 11.11.0.0):
  - `TxValidationErrorInCardanoMode` gives `{"tag":…,"contents":…}`.
  - `ShelleyTxValidationError` gives `{"kind":"ShelleyTxValidationError","era":"ShelleyBasedEraConway","error":…}`.
- **cardano-api's `Orphans/Serialisation.hs`:** `ApplyTxError`'s ToJSON is newtype-derived, so `error` is a JSON array. Each `ConwayLedgerPredFailure` in it goes `via ShowOf`, a string of its `show`.
- **The golden** (`cardano-testnet/…/tx.failed.response.json.golden`, the same at 11.0.1, 11.1.3 and 11.2.0) is `{"contents":{"contents":{"contents":{"era":"ShelleyBasedEraConway","error":["ConwayMempoolFailure \"All inputs are spent. …\""],"kind":"ShelleyTxValidationError"},"tag":"TxValidationErrorInCardanoMode"},"tag":"TxCmdTxSubmitValidationError"},"tag":"TxSubmitFail"}`.

So at 1.23 the refusal's entry reads `ConwayIncompleteWithdrawals (NonEmptyMap (fromList [(AccountAddress {aaNetworkId = Mainnet, aaAccountId = AccountId {unAccountId = KeyHashObj (KeyHash {unKeyHash = \"…\"})}},Mismatch {mismatchSupplied = Coin …, mismatchExpected = Coin …})]))`. For a script account it has `ScriptHashObj (ScriptHash \"…\")` in place of the key hash. The missing-account one is `ConwayWithdrawalsMissingAccounts (Withdrawals {unWithdrawals = fromList [(AccountAddress {…},Coin …)]})`.

- **The substrings that name them:** `IncompleteWithdrawals` and `WithdrawalsMissingAccounts`.
- **Match the constructor names only.** The record's field names change between versions: #5351's copy has `aaId` and a different `Mismatch` show.
- **The data layer** passes status and body through untouched (`DATA/api/src/submit.rs:1-5`).
- **Which binary names it.** The names come from the submit-api binary's own ledger decoder. Any submit-api that can decode a PV11 refusal at all prints these names.

### (d) Every match of the old name, and what each path shows today

**The matches:**

- **In code, only two:**
  - `koios.ts:709`, where `stakingRefusal` gives `koios.staking.rewardsChanged`.
  - `koios.ts:1233`, the `RewardsChangedError` type.
- **Comments:** `koios.ts:628` and `seedelf-core/src/withdraw_zero.rs:8`.
- **The doc:** `docs/architecture.md:377`.
- **The tests**, all with the PV10 name:
  - `koios.test.ts:365`, `:372`, `:373`;
  - `staking.test.ts:777`;
  - `lovejoin-reward-balance.test.ts:211` (`NOT_IN_REWARDS`, used by its three refusal cases).
- **The archived chunk-43 plan** is a record, so leave it.
- **No match** in `seedelf-data`, the wasm crate or `e2e/`.
- **The staking match dates from chunk 13** (`756a646e`, 2026-09-24), after both networks were at PV11. So staking's words have never shown in a released wallet, on either network.

**Only three places branch on the type:** `lovejoin.ts:5392`, `lovejoin.ts:7673` and `sessions.ts:5309`. Nothing tells errors apart by exact class, and `ui-port.ts` marks only `StaleReviewError` and `CollateralRefusedError` as stale.

**What each path shows**, traced and run in the repro below. Every refusal here is phase 1, so nothing is lost and no collateral is taken.

- **Lovejoin's chain.** This covers a public mix and Mix again (`pumpPublicNow`), and a session's chain (`sessions.ts` `pump`).
  - `chainRetryMs` retries neither type, so the chain stops either way. Only the words differ.
  - Its progress (`stopped`) and Send's rejection both read: `The network rejected the transaction: {"contents":{"contents":{"contents":{"era":"ShelleyBasedEraConway","error":["ConwayIncompleteWithdrawa…`.
  - It's never `lj.warn.rewardsMoved`.
- **A box's way back** (`withdrawOne`). There's no rebuild-once: one submit, and giveme.my is asked once. Its due time comes back and its box is free.
  - **A scheduled run** (`withdrawDueNow`, `lovejoin.ts:6904-6910`) swallows the error. Nothing is shown, and the box is tried again at the next unlock or alarm.
  - **Bring one back now:** the page shows the raw JSON. Pressing again builds on a fresh read.
- **Bring every box back.** Each `withdrawOne` reads the balance afresh (`rewardsIn`), so only the box that met the change waits. If that run sent nothing, Settings shows the raw JSON as its `why` and the run counts towards `BRING_FAILED_RUNS` (3), as the designed "refused again" path does.
- **Staking's Withdraw, and Stop staking with rewards at review.** The user sees raw JSON, not "Your staking rewards changed since you reviewed this. Review it again." LEDGER zeroes the withdrawn account before CERTS, so Stop staking's unregistration adds no second failure.
- **A payment that spends rewards** ("Use staking rewards when spending"): the same raw JSON.
- **Wider: a Stop staking reviewed at 0 rewards.** It carries no withdrawal (`staking.rs:207-209`), so when an epoch pays rewards before Send, CERTS refuses the unregistration as `StakeKeyHasNonZeroAccountBalanceDELEG`. That's raw JSON too, under a different name: v-pv11-trace#1.

### (e) The finder's repro, re-run from its text

**Its own fixture:**

- The answer is a plain `KoiosError`, not a `RewardsChangedError`.
- It reads `The network rejected the transaction: {"contents":{"contents":{"contents":{"era":"ShelleyBasedEraConway","error":["Conwa…`, 520 characters.
- The PV10 string is a `RewardsChangedError`.

So the repro holds. I extended it in `zz-r181-v-pv11-trace-1` (5 tests, then a sixth, all passing on `2a8060d3`, each asserting today's behaviour):

1. **The real 1.23 rendering, and the missing account.** Both bodies (the `NonEmptyMap` wrapper with the record `AccountId`, and `ConwayWithdrawalsMissingAccounts`) answer the same through Koios's backend and through `DATA_BACKEND`: a plain `KoiosError` of 519 to 538 characters.
2. **The DELEG names.** These are the 1.22+ NonZero name, `DepositIncorrectDELEG`, `RefundIncorrectDELEG` and 1.24's `DelegAccountAlreadyRegistered`.
   - Each is raw.
   - The 1.20 name `StakeKeyHasNonZeroRewardAccountBalanceDELEG` gives "Your account's staking changed since you reviewed this. Refresh, and review it again."
3. **The fix's substrings** occur in each body they're meant for, and in no other.
4. **A chain refused at PV11**, on `lovejoin-reward-balance.test.ts`'s own harness, with 500 ₳ taken and the account at 0 when it's sent: `stopped` is `The network rejected the transaction: {"contents"…ConwayIncompleteWithdrawa…`, and `publicSubmit` rejects with a `KoiosError` in the same words.
5. **A box's way back at PV11:**
   - one submit, and giveme.my asked once;
   - `withdrawing` cleared, and its due time back;
   - `withdrawDue` resolves with nothing thrown.
6. **Staking:** a Withdraw, a payment with rewards, and a Stop staking reviewed at 0 (the NonZero body). Each rejects with `The network rejected the transaction: …`.

### The fix

This is the smallest change that brings back what the merged code does for the PV10 name. It was tried in the scratch mirror only.

```diff
 export class RewardsChangedError extends KoiosError {}
+
+/**
+ * The ledger's names for that refusal: Conway's CERTS said `WithdrawalsNotInRewardsCERTS` up to protocol version 10;
+ * from 11 its LEDGER rule says `ConwayIncompleteWithdrawals` (not the whole balance) or
+ * `ConwayWithdrawalsMissingAccounts` (no such account), and cardano-ledger-conway 1.24 drops the old name.
+ */
+const REWARDS_CHANGED = /WithdrawalsNotInRewards|IncompleteWithdrawals|WithdrawalsMissingAccounts/;
 …
 function stakingRefusal(text: string): string | undefined {
-  if (text.includes("WithdrawalsNotInRewards")) {
+  if (/WithdrawalsNotInRewards|IncompleteWithdrawals/.test(text)) {
     return t("koios.staking.rewardsChanged");
   }
+  if (text.includes("WithdrawalsMissingAccounts")) {
+    return t("koios.staking.changed");
+  }
 …
-    if (staking) throw text.includes("WithdrawalsNotInRewards") ? new RewardsChangedError(staking) : new KoiosError(staking);
+    if (staking) throw REWARDS_CHANGED.test(text) ? new RewardsChangedError(staking) : new KoiosError(staking);
```

**The words for `ConwayWithdrawalsMissingAccounts`:** `koios.staking.changed`, "Your account's staking changed since you reviewed this. Refresh, and review it again." For staking that's right: the stake key went away between Review and Send.

- **Typed as `RewardsChangedError`.** A Lovejoin chain then says `lj.warn.rewardsMoved` rather than "your account", and a way back rebuilds once.
- **That's what PV10 did** for the same case, since `WithdrawalsNotInRewardsCERTS` covered both.
- **Both keys exist** in en, es and ja, so there's no new string and no translation.
- **Also acceptable, one regex:** treat the missing account exactly as the PV10 name, in `rewardsChanged`'s words. That's exact parity, slightly less apt for staking.

The order stays as it is: `WithdrawalsNotInRewards` and `IncompleteWithdrawals` are checked first, so a body that also says `ConwayWdrlNotDelegatedToDRep` reads as staking.test.ts's PV10 body does.

**Docs, same PR:**

- `architecture.md:377`: name `ConwayIncompleteWithdrawals` and `ConwayWithdrawalsMissingAccounts` with the old name.
- `koios.ts:628`'s comment.
- `withdraw_zero.rs:8`'s comment (a nit).

### Tests that must fail without it

Each was added in the mirror. All five fail on `2a8060d3` and pass with the fix.

1. **`koios.test.ts`, "explains the ledger's staking refusals"**, with cardano-submit-api's body:
   - `ConwayIncompleteWithdrawals` throws "rewards changed since you reviewed" and is a `RewardsChangedError`.
   - `ConwayWithdrawalsMissingAccounts` throws "staking changed since you reviewed" and is a `RewardsChangedError`.
   - **For v-pv11-trace#1:** the four DELEG names throw "staking changed since you reviewed" and aren't a `RewardsChangedError`.
   - Without the fix: "expected … 'rewards changed since you reviewed' but got 'The network rejected the transaction:…'".
2. **`staking.test.ts`, "refuses the same choice again, locked rewards, and what's gone stale":** the same Withdraw refused with the PV11 body throws "rewards changed since you reviewed". Without the fix it's raw.
3. **`lovejoin-reward-balance.test.ts`:** its three `NOT_IN_REWARDS` cases run with the PV10 body and with the PV11 body. Without the fix, the three PV11 runs fail:
   - **The chain:** `stopped` is "The network rejected the transaction:…", not `REWARDS_MOVED()`.
   - **"Built again once":** 1 submit where 2 are expected.
   - **"Refused again":** 1 submit where 2 are expected.

**With the fix in the mirror:**

- **Those three files:** 84 of 84 pass (79 old and 5 new).
- **29 files that touch submit refusals, staking words or Lovejoin's refusal:** 517 of 517 pass. They include dapp-governance, dapp-site-english, dapp-account-change, staking, sessions, sessions-review-fixes, session-close, session-resend-spent, maybe-sent, mempool-watch, write-ahead, payment-parts, parts-send-review-fixes, lovejoin-withdraw-submit, lovejoin-stopped-before, public-mix-mark, lovejoin-1-5-0, data-layer, words, i18n-critical-helpers and screens.
- **The full suite** (`--maxWorkers=4`, my repro left out, since it asserts today's behaviour): 255 files passed and 1 skipped. Six files failed only because the mirror lacked files outside `src/` and `tests/` (`docs/i18n/`, `e2e/`, `index.html`, `package-lock.json`, `public/`). Once those were copied, all six pass (47 tests).
- **The test changes** are `SCRATCH/review/v-pv11-trace/tests.diff`, beside `fix.diff`.

### Where it meets the other findings

- **worker#1 and worker#3 depend on it.** worker#1 rethrows in Lovejoin's words, and worker#3 has `settleWithdrawing` drop a resend refused as `RewardsChangedError`. Neither has any effect until this fix is in. Land them together, each with a PV11-body case.
- **worker#3's safety argument holds at PV11.** Conway's MEMPOOL rule (1.23 `Mempool.hs:111-121`) refuses a duplicate with "All inputs are spent" first and skips every other check (`whenFailureFreeDefault`). koios.ts checks spent before `stakingRefusal`. So a copy already in a block, or in this node's mempool, never reads as `RewardsChangedError`.
- **Other readings to correct:** `worker.md:161` and `money.md:83`/`:104`, which take the old match to catch the node's word, and mutants#1's "the node refuses it (WithdrawalsNotInRewards)".
- **Not for 1.8.1:** Dijkstra (PV12) renames these again (`WithdrawalAmountsInexactInLegacyMode`, `WithdrawalAccountsMissing`; `Dijkstra/Rules/Entities.hs` at 1.24's commit).

### Severity: low, not medium

- **Nothing stuck.** No flow is refused that should work. The ledger refuses a stale amount rightly, a chain stops as designed, a box comes back at a later run (or on a second press), and a staking review can be made again.
- **Not misleading.** The `.warn.` line is absent, not wrong: the raw text begins "The network rejected the transaction:".
- **Rare states.** It needs a balance in a pool's `mix_logic` account that moves between the read and the submit (all three on mainnet hold 0, readers' note). Or, for staking, an epoch boundary or a lagging index within a review's 10 minutes.
- **The one behaviour lost** is the rebuild-once. That's a real but narrow wrong behaviour, which is low by the brief.

**fixWorthy: yes.** The fix uses existing words, restores what the tests already hold for the PV10 name, and touches only koios.ts's classification. The new substrings are unique ledger constructor names. The type's only consumers are the three Lovejoin sites built for it.

## New: v-pv11-trace#1 · low · predates #367 · `stakingRefusal`'s DELEG names, on nodes from 11.0.1

- **File:** `EXT/src/background/koios.ts:721`:
  ```ts
  if (/StakeKey(Not)?Registered|IncorrectDeposit|NonZeroRewardAccountBalance/.test(text)) {
  ```
- **What's wrong:**
  - **The non-zero balance.** Conway 1.20.0.0 (node 10.6) named it `StakeKeyHasNonZeroRewardAccountBalanceDELEG`. From 1.22.1.0 (node 11.0.1, so every node that follows PV11) it's `StakeKeyHasNonZeroAccountBalanceDELEG Coin` (1.22.1.0 and 1.23.0.0 `Deleg.hs` data type; raised at 1.23 `:260-268`).
  - **The deposit and refund.** From PV11, `hardforkConwayDELEGIncorrectDepositsAndRefunds pv = pvMajor pv > natVersion @10` (added in 1.20.0.0) raises a wrong deposit as `DepositIncorrectDELEG (Mismatch …)` and a wrong refund as `RefundIncorrectDELEG (Mismatch …)`, not `IncorrectDepositDELEG` (1.23 `:199-211`, `:242-258`).
  - **Already registered.** 1.24.0.0 (node 11.2.0) replaces `StakeKeyRegisteredDELEG` with `DelegAccountAlreadyRegistered (AccountAlreadyRegistered (KeyHashObj …))`.
  - **What the regex matches.** It catches only `StakeKeyNotRegisteredDELEG`, and `StakeKeyRegisteredDELEG` up to 11.1.x. The other names are unmatched.
- **Failure.** The user reviews Stop staking at 0 rewards, so there's no withdrawal (`staking.rs:207-209`), and an epoch pays rewards before Send.
  - The node refuses it as `ConwayCertsFailure (CertFailure (DelegFailure (StakeKeyHasNonZeroAccountBalanceDELEG (Coin …))))`.
  - The wallet shows `The network rejected the transaction: {"contents"…` instead of "Your account's staking changed since you reviewed this. Refresh, and review it again." (repro case 6).
  - **Rarer:** a key deposit changed by governance between Review and Send, a refund that differs from Koios's figure, or a key another device registered meanwhile, on an 11.2 node.
  - Nothing is lost.
- **Fix, same PR as readers#4:**
  ```ts
  /StakeKey(Not)?Registered|AccountAlreadyRegistered|IncorrectDeposit|DepositIncorrect|RefundIncorrect|NonZero(Reward)?AccountBalance/
  ```
  Each still maps to `koios.staking.changed`. `IncorrectDeposit` already matches GOVCERT's `ConwayDRepIncorrectDeposit`, which is unchanged. None of the new substrings occurs in a refusal the wallet words otherwise.
- **The test:** koios.test.ts's four DELEG cases, above. They fail without the fix and pass with it.

## Checked, held

- **readers#4's facts** all hold:
  - epochs 644 and 294;
  - tips 666 and 324;
  - the 1.21 move;
  - the CERTS skip;
  - the LEDGER test;
  - 1.24's removal;
  - node 11.0.1 at 1.22.1.0 and 11.1.3 at 1.23.0.0;
  - the data layer passing the body through.
- **The data layer's backend** (`retries: false`): the body has no top-level `error`, so `serverWords` passes it to the same classification, and `DataLayerKoios.submitTx` rethrows a node refusal unchanged (`failureOf` gives none).
- **No other reader is affected.** `pending.ts` `submitWatched` and the maybe-sent resend, `dapp.ts` `send`, and `ui-port.ts`'s stale mark never branch on `RewardsChangedError`, so typing PV11's names changes no behaviour there.
- **The order in `submitTx`:** spent first (`BadInputsUTxO`, "All inputs are spent"), then staking, then validity and fee.
- **The staking flows' other names are current at 1.23 and 1.24:** `ConwayWdrlNotDelegatedToDRep`, `DelegateeStakePoolNotRegisteredDELEG`, `DelegateeDRepNotRegisteredDELEG` and `StakeKeyNotRegisteredDELEG`.
- **Stop staking with rewards at review** fails with `ConwayIncompleteWithdrawals` alone: LEDGER drains the account before CERTS (`drainAccounts` sets balances to zero, core `Account.hs:266-277`).

## Not checked

- **Which node and submit-api versions** Koios's backends and home actually run. Following PV11 needs 11.0.1 or later. The data layer's byte-for-byte check against Koios was made 2026-10-08, after PV11.
- **A live refusal body** from our own stack: no submits, by the brief. The rendering is from source, the golden, and cardano-wallet #5351's quote.
- **A session chain's refusal at PV11** wasn't run. It was traced: `sessions.ts:5309` differs from the public chain only in its words.
