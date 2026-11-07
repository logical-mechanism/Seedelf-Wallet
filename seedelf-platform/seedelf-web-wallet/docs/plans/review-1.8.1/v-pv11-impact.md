# 1.8.1's release review: v-pv11-impact

**Task:** readers#4's wider question. Which of the wallet's classifications of the node's answers are dead at protocol version 11? On `2a8060d3`.

**In short:**
- **Dead on both networks, all in `stakingRefusal` and the type chosen beside it** (`koios.ts:709`, `:721`, `:1233`): `WithdrawalsNotInRewards` (readers#4), `NonZeroRewardAccountBalance` and, for DELEG, `IncorrectDeposit`. `StakeKeyRegistered` goes too once nodes run 11.2. Each one costs only words, and the one immediate rebuild of a Lovejoin way back.
- **Alive:** what money and a sent transaction's fate depend on. That's `BadInputsUTxO`, "All inputs are spent" (the maybe-sent rules), `TxSubmitConnectionError`, `OutsideValidityIntervalUTxO`, `FeeTooSmallUTxO`, the HTTP statuses, the data layer's own words, and Ogmios's 3010, 3110 and result fields.
- **Ogmios never says 3117 on an evaluation**, at PV11 or before: the ledger's evaluator never builds `UnknownTxIn`. A missing input is still caught (3110) but never named. So tailWitness's "Koios behind" rule (1.6.0) never fires, and a session's return stops at its collateral's mix where it should wait. It's older than this release and not PV11's doing.
- **The fix:** three lines in koios.ts, and one function for the names. I tried it in a scratch copy: 37 suites (894 tests) and the typecheck pass.

| id | severity | PR | what |
|---|---|---|---|
| readers#4 | low (confirmed) | 367 (and before) | At PV11 the ledger says `ConwayIncompleteWithdrawals` / `ConwayWithdrawalsMissingAccounts`, which nothing matches, so `RewardsChangedError` is never raised |
| v-pv11-impact#1 | low | before 1.8.0 | The rest of `stakingRefusal`'s regex: `NonZeroRewardAccountBalance` was renamed in conway 1.21, DELEG's `IncorrectDeposit` changed at PV > 10, and `StakeKeyRegistered` changes at 1.24 |
| v-pv11-impact#2 | low | before 1.8.0 (1.6.0) | Ogmios never names an unknown input (3110 + 3004, never 3117), so tailWitness's "behind" rule is dead and the return chain stops |

## What the networks run

- **PV11:** mainnet from epoch 644, preprod from epoch 294. Koios `epoch_params`: 643 → 10, 644 → 11; 293 → 10, 294 → 11.
- **Nodes:** cardano-node 11.0.1's notes say it's "the first release to support the PV11 intra-era hard fork", so every node on either network is 11.x:
  - 11.0.1: cardano-ledger-conway 1.22.1.0, cardano-api 11.0.0.0.
  - 11.1.1 to 11.1.3: conway 1.23.0.0, cardano-api 11.6.0.0.
  - 11.2.0, a pre-release (2026-10-28): conway 1.24.0.0, cardano-api 11.11.0.0.
- **Where the names come from:** the wallet reads cardano-submit-api's JSON, and its `error` list `show`s each failure. In cardano-api 11.6 `Orphans/Serialisation.hs` that's `ShowOf (ConwayLedgerPredFailure)`, and the Conway `ApplyTxError` is a `NonEmpty (ConwayLedgerPredFailure)`. So the names are those of the submit-api's own ledger version.
- **Ogmios:**
  - v7.0.0 (2026-06-20) is built for node 11.0.1.
  - Home runs v6.14.0: the data layer's `submit.rs` health fixture says so, at mainnet epoch 660.
  - Both encode every code and field the wallet reads the same way. I diffed `ScriptFailure.hs` and `PredicateFailure.hs` (codes) and `TxSubmission.hs` (results).
- **The sources:** shallow checkouts in `SCRATCH/review/v-pv11-impact/src/`:
  - ledger at `226b002d`, `f649f975` and `54e24ba4`, the commits the three nodes' notes cite, and at the `cardano-ledger-conway-1.19.0.0` tag, which Ogmios 6.14 pins (`server/cabal.project`, with cardano-node 10.5.1);
  - cardano-node 11.1.3, cardano-api 11.6.0.0, ouroboros-consensus 4.2.1.0, and Ogmios 6.14.0 and 7.0.0.

## Every classification, at PV11

**koios.ts `submitTx` and `stakingRefusal`** (text the node or Koios sent):

| substring matched | at PV11 (conway 1.22.1 / 1.23 / 1.24) | alive? | what the user sees now |
|---|---|---|---|
| `TxSubmitConnectionError` | `TxCmdTxSubmitConnectionError` (submit-api 11.0.1, 11.1.3, 11.2.0) | alive | "couldn't reach its Cardano node" |
| `BadInputsUTxO` | `ConwayUtxowFailure (UtxoFailure (BadInputsUTxO (NonEmptySet …)))` | alive | SpentInputError |
| `All inputs are spent` | `ConwayMempoolFailure "All inputs are spent. Transaction has probably already been included"` (MEMPOOL, the same in all three) | alive | SpentInputError |
| `WithdrawalsNotInRewards` | **`ConwayIncompleteWithdrawals`** or **`ConwayWithdrawalsMissingAccounts`** (LEDGER) | **dead** | raw JSON, a plain KoiosError |
| `NotDelegatedToDRep` | `ConwayWdrlNotDelegatedToDRep` | alive | its words |
| `DelegateeStakePoolNotRegistered` | `DelegateeStakePoolNotRegisteredDELEG` | alive | its words |
| `DelegateeDRepNotRegistered` | `DelegateeDRepNotRegisteredDELEG` | alive | its words |
| `StakeKeyNotRegistered` | `StakeKeyNotRegisteredDELEG` | alive | staking changed |
| `StakeKeyRegistered` | `StakeKeyRegisteredDELEG` up to 1.23; **`DelegAccountAlreadyRegistered`** at 1.24 | alive today | staking changed (raw JSON on 11.2) |
| `IncorrectDeposit` | DELEG at pvMajor > 10: **`DepositIncorrectDELEG`**, **`RefundIncorrectDELEG`**; GOVCERT's `ConwayDRepIncorrectDeposit` still matches | **dead for DELEG** | raw JSON |
| `NonZeroRewardAccountBalance` | **`StakeKeyHasNonZeroAccountBalanceDELEG`**, renamed in conway 1.21.0.0 | **dead** | raw JSON |
| `OutsideValidityIntervalUTxO` | the same | alive | its words |
| `FeeTooSmallUTxO` | the same (`Mismatch ('RelGTEQ) {supplied: …, expected: …}`) | alive | its words |

**Read by type alone, from the matches above and the HTTP statuses:**
- `pending.ts`: submitWatched, the resend, `mempool()`.
- `dapp.ts` `send`, `settle`, `notSent`.
- `sessions.ts` `unsentWhyOf`, `maybeSent`, `:5309`, `:5564`, `:5596`.
- `lovejoin.ts` `chainRetryMs`, `mayBeIn`, `sentAlready`, `:5392`, `:7663` to `:7676`.
- `data-layer.ts` `submitFallback` (`failure.error === "TxSubmitConnectionError"`), `SpentMaybeSentError`.
- All alive, except `RewardsChangedError`.

**Ogmios's evaluation answers** (`lovejoin.ts` `unknownInputs`; core's `build.rs` `Budgets::from_ogmios` / `ogmios_failure`, which the WebAssembly calls):

| code or field | at PV11 (Ogmios 6.14.0 and 7.0.0) | alive? |
|---|---|---|
| `result[].validator.{purpose,index}`, `budget.{memory,cpu}` | unchanged (`_encodeEvaluateTransactionResponse`) | alive |
| 3010 with `data[].validator`, `error.data.validationError`, `traces` | unchanged | alive |
| 3110 (`ExtraneousRedeemers`, a redeemer on an input Ogmios can't resolve) | unchanged | alive: stale, unnamed |
| **3117 / `unknownOutputReferences` in an evaluation** | **never sent** | **dead**: names lost (v-pv11-impact#2) |

No wasm/src code parses the node's or Ogmios's words itself; it calls core's `from_ogmios`.

## readers#4, traced: confirmed, low

- **Every claim holds.**
  - `Era.hs`: `hardforkConwayMoveWithdrawalsAndDRepChecksToLedgerRule pv = pvMajor pv > natVersion @10`, in conway 1.22.1.0 and 1.23.0.0.
  - `Rules/Certs.hs`: `then pure certState`. The CERTS check is skipped.
  - `Rules/Ledger.hs` runs `Shelley.testIncompleteAndMissingWithdrawals`, whose Shelley failures are injected as `ConwayIncompleteWithdrawals` / `ConwayWithdrawalsMissingAccounts` (`:194-195`).
  - The 1.24.0.0 changelog: "Remove `WithdrawalsNotInRewardsCERTS`".
  - No tracked code or test names either new failure (`git grep`).
- **One more detail.** `drainAccounts` zeroes each withdrawn account whatever the amount (`updateAccountBalances (\_ _ -> mempty)`). So a Stop staking that withdraws a stale amount gets `ConwayIncompleteWithdrawals` alone, never the DELEG failure too.
- **Repro 1** (koios.ts with PV11-shaped bodies): `incompleteOwn`, `incompleteMixLogic` and `missingAccount` are each a plain `KoiosError` reading "The network rejected the transaction: {"contents":…". The PV10 name is a `RewardsChangedError`.
- **Repro 2** (chunk 43's `lovejoin-reward-balance.test.ts` with `NOT_IN_REWARDS` as a PV11 node sends it): **3 of 11 fail.**
  - "stops in Lovejoin's words": `stopped` is the raw JSON.
  - "is built again once": 1 submit, not 2.
  - "refused again": 1 submit, not 2.
- **Its reach:**
  - "Use staking rewards when spending" is on by default (`shared/preferences.ts:165`, held by `staking.test.ts:792`). So any account flow that withdraws rewards is hit when Review falls before an epoch boundary and Send after it: a public Send, Make private, an account-paid mint, a session's funding.
  - Withdraw and Stop staking.
  - A Lovejoin mix or way back whose pool's balance moved, or a double take.
- **Why low, not medium:**
  - No sent transaction's fate changes. Every one is refused at phase 1 at no cost, as at PV10, and the types fate depends on are alive.
  - A chain stops either way, which is the owner's "no rebuild of a cut chain" call.
  - The way back's due time comes back, and the next due run reads the balance again and builds it. The sessions alarm fires every minute.
  - What's lost is staking's and Lovejoin's words, which tell the user to review again, and the one immediate rebuild.
- **Fix:** the shared one below. I'd raise `RewardsChangedError` for both new names, not readers' `koios.staking.changed` for the missing account. At PV10 `WithdrawalsNotInRewardsCERTS` covered both cases, so that restores exactly what chunk 43 was built against. Then Lovejoin keeps its own words when a pool's `mix_logic` account isn't registered.

## v-pv11-impact#1 · low · the rest of `stakingRefusal`'s regex

- **File:** `EXT/src/background/koios.ts:721`: `/StakeKey(Not)?Registered|IncorrectDeposit|NonZeroRewardAccountBalance/`.
- **`NonZeroRewardAccountBalance` is dead on every PV11 node.** Conway's DELEG failure has been `StakeKeyHasNonZeroAccountBalanceDELEG` since conway 1.21.0.0. Through 1.20.0.0 it was `StakeKeyHasNonZeroRewardAccountBalanceDELEG` (`gh api` reads of `Rules/Deleg.hs` at the 1.12, 1.16 to 1.21 tags).
  - **Reachable:** a Stop staking reviewed with 0 rewards stages no withdrawal: core's `Staking::withdraw` returns `Self::none()` at 0 (`staking.rs:208`). If an epoch then pays rewards before Send, the ledger refuses the unregistration with that failure.
  - **The user sees** "The network rejected the transaction: {…" for "Your account's staking changed since you reviewed this. Refresh, and review it again."
- **`IncorrectDeposit` is dead for DELEG at pvMajor > 10.** In `Rules/Deleg.hs`, `hardforkConwayDELEGIncorrectDepositsAndRefunds` makes a registration's deposit `DepositIncorrectDELEG (Mismatch …)` and an unregistration's refund `RefundIncorrectDELEG (Mismatch …)`. Neither contains the substring.
  - **Practically unreachable:** the deposit is the live `key_deposit` (2 ₳ since Shelley), and the refund is `account_info`'s `deposit`. An index that lies about it is the only way.
  - GOVCERT's `ConwayDRepIncorrectDeposit` still matches.
- **`StakeKeyRegistered`** is alive on 11.0.1 and 11.1.x. In conway 1.24.0.0 (node 11.2.0, a pre-release) it's `DelegAccountAlreadyRegistered (AccountAlreadyRegistered …)`.
- **No test holds any of these three:** no test names `NonZero…` or `IncorrectDeposit` at all.
- **Fix, test first:** koios.test.ts's "explains the ledger's staking refusals" gets bodies 4 to 7 below, each in staking's words.

  ```ts
  /StakeKey(Not)?Registered|AccountAlreadyRegistered|IncorrectDeposit|DepositIncorrect|RefundIncorrect|NonZero(Reward)?AccountBalance/
  ```

  None of the live bodies contains a new substring: `RefundIncorrect` isn't in `ConwayDRepIncorrectRefund`.

## v-pv11-impact#2 · low · Ogmios names no unknown input, so tailWitness's "Koios behind" rule never fires

- **Files:**
  - `EXT/src/background/lovejoin.ts:600-612` (`unknownInputs`).
  - `:4522-4524` (`tailWitness`: `if (unknown?.length && unknown.every((o) => ours.has(…))) throw new KoiosError(t("sess.notCaughtUp"))`).
  - `sessions.ts:5395-5425` (`witnessTail`).
- **What's wrong.** The rule (f16bdbca, shipped since web-wallet/1.6.0) needs Ogmios to name the input it doesn't know: 3117 with `unknownOutputReferences`.
  - **The ledger never builds `UnknownTxIn`.** It's only defined: in all of `eras/` and `libs/` (tests aside) at the ledger Ogmios 6.14 links (conway 1.19.0.0, alonzo 1.13.0.0) and at `226b002d`, `f649f975`, `54e24ba4`, and in `Evaluate.hs` at the alonzo 1.10.0.0 to 1.14.0.0 tags.
  - `getSpendingScriptsNeeded` skips an input missing from the UTxO (`Map.lookup txIn utxo`). So that input's redeemer is `RedeemerPointsToUnknownScriptHash`, which Ogmios encodes as **3110** with `extraneousRedeemers` and no input.
  - Every other redeemer fails to build its context: **3004**, whose `reason` alone names the input, "Unknown transaction input (missing from UTxO set): <id>#<index>". That's in Ogmios 6.14 and 7.0's `Json/Conway.hs`.
  - **Recorded:** core's own fixture `seedelf-core/tests/fixtures/ogmios/unknown_inputs.json` is exactly that, from preprod Ogmios through Koios at epoch 315, which is PV11 on preprod.
  - Every extension test hands the wallet an invented top-level `{ code: 3117, message: "Unknown transaction input", … }`: `lovejoin.test.ts:676`, `:2255`; `lovejoin-planner.test.ts:1558`, `:1586`.
- **Repro 3:** `unknownInputs(<the recorded answer>)` is `[]`: stale, but unnamed. The invented shape gives the name.
- **Repro 4:** `lovejoin-planner.test.ts`'s "asks again, rather than stop, while Koios's Ogmios doesn't know the outputs of its own deposit yet", with the real answer. It **fails**: the chain is ended at once, `stopped` "Lovejoin's pool changed while the wallet read it." The same test with the invented shape passes.
- **The failure:**
  - **The trigger:** on preprod, or on mainnet with the data layer's parts on Koios, the giveme.my witness runs once tx_status shows the deposit, and the evaluation lands on an Ogmios a block behind it.
  - **What happens:** the session's return stops after its collateral's deposit and spends one of `TAIL_TRIES` (2). After two such stops the collateral's mix is over, and its box waits in the 5 ₳ pool, unmixed, for Mix my boxes again.
  - **Why low:** nothing is lost, and the user's Bring back builds the mix again. With the data layer up, tx_status (home's db-sync) never runs ahead of home's node.
  - Also, `unstale` and the session's tail rebuild get no names for their `avoid` sets, so a rebuild relies on a fresh read alone.
- **Fix, test first:**
  - **The tests:** a unit test of `unknownInputs` on the recorded fixture expects `["a1…#0"]`, and a 3004 alone stays `undefined`. The planner test above uses the recorded shape. Both fail without the fix.
  - **The fix:** when the answer is already stale (a 3110 or 3117), also take the names in 3004 reasons, `/missing from UTxO set\): ([0-9a-f]{64})#(\d+)/`. It never changes which answers count as stale.
  - **Worth it in 1.8.1?** It's optional. It isn't a 1.8.1 regression, and it touches the `avoid` sets two features share. Otherwise it's a backlog line.

## The fix, tried in a scratch copy

`SCRATCH/review/v-pv11-impact/fix/` is a copy of `EXT` (node_modules and `wasm/` linked). The diffs are `SCRATCH/review/v-pv11-impact/repros/fix-koios.diff` and `fix-lovejoin.diff`.

```ts
// koios.ts, above stakingRefusal's comment
const WITHDRAWAL_REFUSED = /WithdrawalsNotInRewards|IncompleteWithdrawals|WithdrawalsMissingAccounts/;
//   stakingRefusal:  if (WITHDRAWAL_REFUSED.test(text)) return t("koios.staking.rewardsChanged");
//   its last regex:  /StakeKey(Not)?Registered|AccountAlreadyRegistered|IncorrectDeposit|DepositIncorrect|RefundIncorrect|NonZero(Reward)?AccountBalance/
//   :1233:           if (staking) throw WITHDRAWAL_REFUSED.test(text) ? new RewardsChangedError(staking) : new KoiosError(staking);
```

- **With it:**
  - Repro 1 gives `RewardsChangedError` for the three withdrawal bodies and staking's words for the DELEG ones.
  - Repro 2 passes 11/11, repro 3 gives the name, and repro 4 passes both shapes.
  - 37 suites pass, 894 tests: every file naming these words, types or codes, plus `submit-inputs-spent`, `data-layer`, `words`. So does `tsc --noEmit -p .`.
- **Order kept:** `WITHDRAWAL_REFUSED` stays before `NotDelegatedToDRep`, as at PV10. `staking.test.ts:777`'s body carries both and expects the rewards words.
- **The tests that must fail without it:**
  - koios.test.ts with bodies 1 to 7 below.
  - lovejoin-reward-balance.test.ts's `NOT_IN_REWARDS` cases with body 2: 3 fail.
  - staking.test.ts:777 with body 1.
  - The `unknownInputs` unit test and the planner test with body 8.
- **Docs:** `WW/docs/architecture.md:377` names only `WithdrawalsNotInRewards`. Name both, by protocol version. The archived chunk-43 plan (`:8`, `:171`) is a record.

## Test bodies shaped like a PV11 answer

cardano-submit-api's 400. Each `<error>` is one string, as conway 1.23's Show instances write it: Mismatch's custom `Mismatch ('RelEQ) {supplied: …, expected: …}`, Coin via Quiet, NonEmptyMap / NonEmptySet derived.

```
{"contents":{"contents":{"contents":{"era":"ShelleyBasedEraConway","error":[<error>],"kind":"ShelleyTxValidationError"},"tag":"TxValidationErrorInCardanoMode"},"tag":"TxCmdTxSubmitValidationError"},"tag":"TxSubmitFail"}
```

1. `ConwayIncompleteWithdrawals (NonEmptyMap (fromList [(AccountAddress {aaNetworkId = Testnet, aaId = AccountId {unAccountId = KeyHashObj (KeyHash {unKeyHash = "5e…5e"})}},Mismatch ('RelEQ) {supplied: Coin 1500000, expected: Coin 2100000})]))`
2. `ConwayIncompleteWithdrawals (NonEmptyMap (fromList [(AccountAddress {aaNetworkId = Mainnet, aaId = AccountId {unAccountId = ScriptHashObj (ScriptHash "dd94…")}},Mismatch ('RelEQ) {supplied: Coin 0, expected: Coin 500000000})]))`
3. `ConwayWithdrawalsMissingAccounts (Withdrawals {unWithdrawals = fromList [(AccountAddress {aaNetworkId = Testnet, aaId = AccountId {unAccountId = KeyHashObj (KeyHash {unKeyHash = "5e…5e"})}},Coin 1500000)]})`
4. `ConwayCertsFailure (CertFailure (DelegFailure (StakeKeyHasNonZeroAccountBalanceDELEG (Coin 1500000))))`
5. `ConwayCertsFailure (CertFailure (DelegFailure (DepositIncorrectDELEG (Mismatch ('RelEQ) {supplied: Coin 2000000, expected: Coin 3000000}))))`
6. `ConwayCertsFailure (CertFailure (DelegFailure (RefundIncorrectDELEG (Mismatch ('RelEQ) {supplied: Coin 2000000, expected: Coin 3000000}))))`
7. (conway 1.24) `ConwayCertsFailure (CertFailure (DelegFailure (DelegAccountAlreadyRegistered (AccountAlreadyRegistered (KeyHashObj (KeyHash {unKeyHash = "5e…5e"}))))))`
8. Ogmios: `seedelf-core/tests/fixtures/ogmios/unknown_inputs.json` as recorded. That's 3010 with items 3110 (`extraneousRedeemers`) and 3004 (`reason`: "Unknown transaction input (missing from UTxO set): <id>#<index>").

## Repros

They sat in the tree as `EXT/tests/zz-r181-v-pv11-impact-{1..4}.test.ts`, each run alone with `npx vitest run tests/zz-r181-v-pv11-impact-<n>.test.ts` (4 with `-t ZZPV11`). They're deleted from the tree, and kept in `SCRATCH/review/v-pv11-impact/repros/`.
- 1: 1 passed; it prints each body's outcome.
- 2: 3 failed, 8 passed.
- 3: 1 passed.
- 4: the real shape failed, the invented shape passed.

## Checked, and it held

- **The mempool's duplicate rule** is unchanged from conway 1.22.1 to 1.24: all regular inputs spent gives "All inputs are spent", and skips LEDGER. So a resend of a transaction in a mempool or on chain is still a SpentInputError.
  - The consensus mempool has no check by transaction ID (ouroboros-consensus 4.2.1.0), so nothing else answers a duplicate.
  - The maybe-sent watch, the dApp's `settle`, a chain's spent retries and `SpentMaybeSentError` all stand.
- **The UTXO failures** keep their names in all three versions: `BadInputsUTxO`, `OutsideValidityIntervalUTxO`, `FeeTooSmallUTxO`.
- **`TxCmdTxSubmitConnectionError`** is in submit-api 11.0.1, 11.1.3 and 11.2.0. Since cardano-api 11.0's `tryAny`, it also covers a connection that broke after a submit with no reply from the node. The wallet takes that as not sent and resends the same bytes. A copy that did go is then "already spent: check Activity". The window is a node dying mid-reply: noted, not a finding.
- **The staking names that stand:** `ConwayWdrlNotDelegatedToDRep`, still raised outside bootstrap; `DelegateeDRepNotRegisteredDELEG` and `DelegateeStakePoolNotRegisteredDELEG`; `StakeKeyNotRegisteredDELEG`.
- **Ogmios 6.14 to 7.0:** the codes the wallet reads are identical. 7.0 adds only 3169 and 3170. Its breaking changes don't touch what the wallet reads:
  - `maxReferenceScriptsSize` is renamed, but the wallet reads parameters from Koios;
  - the transaction objects drop empty fields, but the wallet never reads them;
  - the shelley/allegra/mary hints are gone.
- **core's `ogmios_failure`** catches the real stale answer through 3110 ("aren't on chain anymore"), as `mint_test.rs:865` holds on the recorded fixture.
- **`RewardsChangedError` never decides a transaction's fate.** It only picks words (`sessions.ts:5309`, `lovejoin.ts:5392`) and the way back's one rebuild (`:7673`). `unsentWhyOf` and the dApp's `notSent` treat it as any KoiosError.
- **New PV11 names nothing matches, and nothing needs to:**
  - `ScriptIntegrityHashMismatch` (was `PPViewHashesDontMatch`, never matched);
  - the relaxed `BabbageNonDisjointRefInputs`, and V3's `ReferenceInputsNotDisjointFromInputs`;
  - consensus's soft timeout `ConwayMempoolFailure "MempoolTxTooSlow …"`, which is 1 s by default.
- **The owner's calls:** a refused take still stops its chain (no rebuild of a cut chain), and the edge case's live run stays declined. Its consequence: nothing has ever run chunk 43's refusal path against a PV11 node, and repro 2 is the first test of it with a PV11 body.

## Notes for the owner (not wallet code)

- `seedelf-data/deploy/README.md` records no versions. Home's Ogmios is v6.14.0, per the data layer's fixture. Home's cardano-submit-api version is unknown.
- The names the wallet matches are the submit-api's. A submit-api older than 11.0.1 can't decode PV11's new LEDGER failures at all.

## Not checked

- The cardano-submit-api and Ogmios versions Koios's instances run. Their source at every PV11-capable version agrees, so the answer shouldn't change.
- A live PV11 refusal of a withdrawal. A submit isn't allowed, and the shape comes from the source and the recorded 2026-09-28 body.
- The CLI's own parsing (out of scope).
