# 1.8.1's release review: readers

**Lens:** what reads a Lovejoin transaction after it's built, sent or landed, now that #367 lets one withdraw N > 0 from a pool's `mix_logic` reward account. #367 changed the builders; this looked at everything it didn't change. On `2a8060d3`.

**In short:** nothing takes `mix_logic`'s withdrawal for the user's own rewards, and nothing counts N as staking rewards. Every reader that sums withdrawals filters by the user's own stake key, and none computes a fee as inputs less outputs. Four findings:

| id | severity | PR | what |
|---|---|---|---|
| readers#4 | medium | 367 | The ledger at protocol version 11 never says `WithdrawalsNotInRewards`, so `RewardsChangedError` is never raised, on either network |
| readers#3 | low | 367 | Bring everything back: every return in one review takes the same balance, and every one after the first is refused at Send |
| readers#1 | low | 367 | A public mix's review says "Public account after" N short, and the backlog says it counts N |
| readers#2 | low | 367 | A take that landed counts as on its way for two hours: a new balance as large reads as none |

The repros were `EXT/tests/zz-r181-readers-{1..5}.test.ts`, each run alone with `npx vitest run tests/zz-r181-readers-<n>.test.ts`. They're deleted from the tree, and kept at `SCRATCH/review/readers/repros/`.

## Findings

### readers#4 · medium · 367 · at protocol version 11 the ledger refuses a short withdrawal as `ConwayIncompleteWithdrawals`, which nothing matches

- **File:** `EXT/src/background/koios.ts:1233` (and `:709`).
- **What's wrong.** `RewardsChangedError` is thrown only when the node's refusal contains `WithdrawalsNotInRewards`:
  ```ts
  if (staking) throw text.includes("WithdrawalsNotInRewards") ? new RewardsChangedError(staking) : new KoiosError(staking);
  ```
  - Mainnet has been at protocol version 11 since epoch 644, and preprod since epoch 294. Koios's `epoch_params` gives `protocol_major` 11 at both tips today (mainnet epoch 666, preprod 324).
  - cardano-ledger-conway 1.21.0.0 moved the withdrawal check from CERTS to LEDGER for `pvMajor pv > 10` (`hardforkConwayMoveWithdrawalsAndDRepChecksToLedgerRule`, `Conway/Era.hs`). In `Conway/Rules/Certs.hs` the old check is skipped (`then pure certState`). `Conway/Rules/Ledger.hs` runs `testIncompleteAndMissingWithdrawals`, which refuses as `ConwayIncompleteWithdrawals` (the amount is wrong) or `ConwayWithdrawalsMissingAccounts` (the account isn't registered).
  - 1.24.0.0 removed `WithdrawalsNotInRewardsCERTS` altogether.
  - cardano-node 11.0.1 and 11.1.3 need `cardano-ledger-conway >= 1.22.1.0`. Every node that follows a PV11 chain has the move.
  - The data layer hands cardano-submit-api's body on as it came (`DATA/api/src/submit.rs`, its header), so both networks' submits carry the new name.
  - No code or test in the repository names `IncompleteWithdrawals`. Every test hands koios.ts the PV10 name: `koios.test.ts:365-373`, `staking.test.ts:777`, `lovejoin-reward-balance.test.ts:211`.
- **Repro** (`zz-r181-readers-4`): a 400 from submittx with cardano-submit-api's body, its error `ConwayIncompleteWithdrawals (fromList [(AccountAddress {…ScriptHash "7a9d…"}, Mismatch {mismatchSupplied = Coin 0, mismatchExpected = Coin 500000000})])`.
  - It's a plain `KoiosError`, not a `RewardsChangedError`, and not in staking's words.
  - It reads: `The network rejected the transaction: {"contents":{"contents":{"contents":{"era":"ShelleyBasedEraConway","error":["ConwayIncompleteWithdrawals (fromList [(Accou…`.
  - The same call with `WithdrawalsNotInRewardsCERTS` is a `RewardsChangedError`.
- **The failure, on both networks today:**
  - **A Lovejoin chain refused for a moved balance** stops with the node's raw JSON (`lovejoin.ts:5392`, `sessions.ts:5309`), never `lj.warn.rewardsMoved`.
  - **A box's way back is never built again once** (`lovejoin.ts:7673`, the plan's Step 3.3). It fails in those raw words, and its due time waits for a later run. Bring every box back keeps the raw text as its `why`, which Settings shows.
  - **Staking, which predates #367:** a Withdraw, a Stop staking, or a payment spending the rewards that an epoch's rewards overtook between Review and Send shows the raw JSON. It should say "Your staking rewards changed since you reviewed this. Review it again." This has happened on mainnet since July.
- **Other reviews:** this contradicts `worker.md:161`, and `money.md:83` and `:104`, which take the match to catch the node's word. worker#1's fix, Lovejoin's words where the error is rethrown, only takes effect once the match catches PV11's name.
- **Smallest fix, test first:**
  - **The tests:** koios.test.ts gets the PV11 body above, which must be a `RewardsChangedError` in staking's words. `lovejoin-reward-balance.test.ts`'s `NOT_IN_REWARDS` cases run with both names.
  - **The match:** in `stakingRefusal` and at `:1233`, match `/WithdrawalsNotInRewards|IncompleteWithdrawals/`. Word `WithdrawalsMissingAccounts` as `koios.staking.changed`: the account isn't registered.
  - **The docs:** fix `architecture.md:377`'s list of refusals.
  - **For the staking lens:** 1.24 also renamed `StakeKeyRegisteredDELEG` (to `DelegAccountAlreadyRegistered`). Worth a look at the rest of `stakingRefusal`'s regex. I didn't check it further.

### readers#3 · low · 367 · Bring everything back takes one balance in every return it builds, and Send then refuses all but the first

- **File:** `EXT/src/background/lovejoin.ts:4642`, with `sessions.ts:3319` and `:3352`, and the review total at `EXT/src/ui/screens/ClaimAll.tsx:257` and `:393`.
- **What's wrong.** `readRewards` counts only reservations being sent as taking a balance (`Object.values(kept).filter((r) => r.until === undefined)`). The plan meant this: "A chain kept for Send doesn't count: Send's read catches two that took one balance."
  - `claimBuildNow` builds each session's return in turn, and each is kept for Send with an `until` (`lovejoin.ts:3843`, `:4078`; `sessions.ts:4776`).
  - So every return in one Bring everything back review reads the same N, and each one's first transaction in the pool withdraws all of it.
  - At `claimSubmit`, the first goes. Its chain's reservation is then being sent, so every later return's `balancesHeld` reads 0 against its own N, and is refused as a stale review.
- **Repro** (`zz-r181-readers-3`). The harness is `lovejoin-share-review-fixes.test.ts`'s P2 claim: two sessions a restore found, through the 5 ₳ pool, with 500 ₳ in its `mix_logic` account.
  - Session 0's tail mix and session 1's first mix both withdraw `500000000`.
  - The review lists 501.82 ₳ and 509.48 ₳ back. Its "Back now" total is 1,011.31 ₳, where 511.31 ₳ can come.
  - `claimSubmit`: `{"sent":[{"index":0,…}],"failed":[{"index":1,"error":"Lovejoin's pool changed since you reviewed this. Review it again."}]}`.
- **The failure.** With a balance in a pool's account, Bring everything back over two or more sessions whose returns go through that pool counts the balance once per return in its "Back now". At Send it refuses every return after the first. A second review then sends them, reading 0. This is the "everything just continues on as normal" call's flow, and the consequence isn't written down.
- **Smallest fix, test first.**
  - **The test:** the repro becomes a test. Both returns are sent, and the review's returns count 500 ₳ once.
  - **The fix:** `claimBuildNow` hands what each return it built takes (`reservationOf(chain.txs).takes`) to the reads of the next builds, as `readRewards` counts a chain being sent. Those then take 0, and pass Send's read once the first is sent (`balanceAfter(N, N)` is 0, their own figure).
  - **One left out:** if the user leaves the first out, the rest meet N at Send and are asked to review again, as now.

### readers#1 · low · 367 · a public mix's review says "Public account after" N short, and the backlog says it counts N

- **File:** `EXT/src/ui/screens/Lovejoin.tsx:4002`, used by `PublicReview` (`:4041`) and `PublicAgainReview` (`:4107`). Also `ReviewTotals.tsx:63`.
- **What's wrong.** The after line is `before − leaving`, where `publicLeaving` is the boxes' ADA and the fees alone. The chain's `change` (`lovejoin.ts:4906`, `:5080`, `chain.returned`) carries the balance taken, but no screen reads it.
  - The archived plan's call 1 (`:197`) and `backlog.md:51` say "a return's or a public mix's review counts what comes back with it". That's true of a return's "Back now". It isn't true of a public mix's review.
- **Repro** (`zz-r181-readers-1`): the real WebAssembly and v2's 5 ₳ pool, with the review rendered from Home's 65 ₳.
  - With nothing in the pool's account: change 51.516966 ₳, "Public account after 56.516966 ₳".
  - With 500 ₳ there: change 551.515881 ₳, "Public account after 56.515881 ₳".
  - Once the chain lands, the account holds 556.515881 ₳.
- **The failure.** A mix or a Mix again from the public account that takes a pool's balance says the account will hold N less than it will. It errs in the user's favour, and only when there's a balance.
- **Smallest fix, test first.**
  - **The test:** render `PublicReview` with a summary that took 500 ₳. "Public account after" is before − box − fees + 500 ₳.
  - **The fix:** the worker puts what the chain takes on `LovejoinPublicSummary` (`readsFor`'s amounts, summed), and the after row adds it.
  - **Or, at least:** correct the backlog line, where the owner's call 1 rests on it.

### readers#2 · low · 367 · a take that landed counts as on its way for two hours, so a new balance as large is withdrawn as 0

- **File:** `EXT/src/background/lovejoin-rewards.ts:68` (`takingFrom`), used at `lovejoin.ts:4652`.
- **What's wrong.** `takingFrom` counts every kept sent transaction whose inputs are still held as spent: `goingOut(sent, spent, { either: true })`, with `heldSent` and `spentSet` both kept two hours (`SENT_HELD_MS`, `SPENT_KEEP_MS`). It does so whether or not the transaction landed. `balanceAfter(read, taking)` then gives 0 for any reading at least as large.
  - account.ts met this for the account's own rewards (the fix round's second review) and leaves out a sent transaction whose change the fresh UTxOs list (`account.ts:191-192`). The Lovejoin copy of the rule has no such step.
- **Repro** (`zz-r181-readers-2`):
  - A public mix takes 500 ₳ and the whole chain lands (its record is done, its reservation gone).
  - An hour later, the wallet kept unlocked by a touch every ten minutes, 500 ₳ is in the account again.
  - `rewardsIn` reads `"0"`. After two hours from its send, the same reading is `"500000000"`.
- **The failure.** It needs the wallet unlocked throughout (a lock wipes both records), and a new balance at least as large within two hours of a take. That's an epoch's start right after a take, such as a second retired pool's deposit, or a pool's leader rewards paid there each epoch.
  - Every build in that pool then withdraws 0 and is refused at phase 1. A chain stops after its deposit, its boxes not mixed yet. A way back waits.
  - It clears itself after two hours.
- **Smallest fix, test first.**
  - **The test:** the repro: landed, then a new 500 ₳ an hour later, is read whole.
  - **The fix:** leave out a sent transaction known to have landed, as account.ts does. That's one the build's fresh pool read lists outputs of (a mix's boxes), or one whose chain record is done or landed. A withdraw counts until its `withdrawing` is dropped.

## Each reader, with N > 0

- **Public activity** (activity.ts `describe`, `stakingOf`). Repro `zz-r181-readers-5`.
  - A public mix that took 500 ₳ is still "Lovejoin mix", `+500 ₳`, direction in, the fee apart.
  - Its `staking` is undefined, and the CSV's rewards column is empty (`…,Lovejoin mix,in,500,0.2,…`).
  - `stakingOf` sums only withdrawals whose `stake_addr` is the account's (`activity.ts:742`). A script's stake address never is.
  - A deposit withdraws nothing. A box paid back by the account stays "Paid for a box back from Lovejoin": N goes to the register, not the account. Right.
- **Private activity:**
  - A way back's entry is the register's lovelace: box + N − fee, or less the paying private UTxO's (`lovejoin.ts` `withdrawOne`).
  - A return's is `chain.returned`, which counts N.
  - The history classes don't move. Right.
- **Home's incoming** (`incoming.ts` `incomingOf`):
  - It credits the public chain's last change, and the registers a return or a way back pays, N included.
  - Its `withdrawn` is the account's stake only (`:157`, `:209`). Right.
- **pendingEntries** (`incoming.ts:352`):
  - Withdrawals are filtered by the account's stake.
  - A chain's transactions are skipped while reserved. With no TTL, a Lovejoin transaction is never one the account pays for, and is never listed.
  - A way back that pays the account is left to Koios. Right.
- **pending.ts and the maybe-sent watch:** no amounts or withdrawals are read.
- **A chain's progress:** no amounts. **Its "what you get back"** (a return's "Back now", the wasm `with_return` and `DirectTail::rest`) counts N. Right. Bring everything back's total is readers#3.
- **The tx view** (`tx-view.ts` `markYours`, decode.rs, `TxDetail.tsx`):
  - The withdrawal is listed with the script's address and its amount, unmarked.
  - A reward address is marked the user's only by a key hash (header `e`). Right.
- **account.ts and "Use staking rewards when spending"** (`readAccount`):
  - `withdrawingOf` reads the account's own reward address.
  - Lovejoin's builds never pass the account's `withdrawal`. `publicBuild` and `withdrawOne` send `utxos` and `collateral` alone, so no transaction withdraws twice. Right.
- **The staking screens and staking.ts:** the account's stake address only. Right.
- **The dApp signer's summary** (`cip30.rs:1516-1552`) of a site's transaction that withdraws from a script's reward account:
  - It's `own: false`, kept out of `staking_lovelace`. What it pays the account counts as received in the net (`difference` is signed i128).
  - The line reads "Withdraws N ₳ from a reward account that isn't yours." Right.
  - `paidScripts` rightly names only what pays into an account.
- **Fees:** no reader computes one as inputs less outputs.
  - Activity uses tx_info's `fee`, pendingEntries `d.fee`, the private history the review's fee, and cip30 and decode the body's fee.
  - Core adds N with `checked_add`. The wasm's `total − fee` runs only after a build that paid it.
- **Recognising Lovejoin by a withdrawal of 0:** nothing does.
  - Activity uses the mix box's address, the feed outputs, discovery the NFT.
  - The only zero-withdrawal rule is Danogo's `directSpends` (`sessions.ts:6734`), which no Lovejoin transaction reaches.
- **Sums of withdrawals:** each is filtered by account, or takes the most an account's does (`takesOf`, `reservationOf`).
- **Verdicts and madeSince:**
  - `way_back` and `measured` build at 0 by design. With N, a real withdraw only gets easier: a few bytes more fee, N more in the register.
  - `madeSince` and `ripeAt` read times alone.
- **On chain:** v2's `mix_logic` withdraw handler names `_account` and never reads the withdrawals, and `mix_box` only checks `pairs.has_key` (29573c5).

## The data layer, read only

- **Nothing in `DATA/api/src/lovejoin/` reads withdrawals.** `crowd.rs` counts `mix_box` outputs and spends, and the shown rule checks L's registration.
- **`account_info`'s `rewards_available`** (`account.rs:254`) is rewards (member, leader, refund) + reserves + treasury + proposal refunds, less every withdrawal. Each counts once its `spendable_epoch` is at most the current epoch, `max(epoch_no)` of `epoch_param`.
- **db-sync**, from the source on GitHub:
  - A pool's deposit refund goes in with earned = spendable = the reap's epoch (`LedgerPoolReap en`, from POOLREAP's `RetiredPools … en`; `insertPoolDepositRefunds … epochNo epochNo`).
  - A proposal's refund, and an enacted treasury withdrawal, go in spendable at the boundary's epoch (`insertProposalRefunds` and `insertRewardRests … currentEpochNo`). Unclaimed refunds are left out.
  - Leader rewards are spendable two epochs on.
  - `epoch_param` goes in with the new epoch's first block (`insertOnNewEpoch`).
  - So it's the ledger's withdrawable balance.
- **It takes a script's address:** `stake_bytes` takes header `0xf1`.
- **Mainnet's three `mix_logic` accounts** (the classic pool's, `dc6abe3b`'s and `fcb3f5ec`'s) hold 0 today, registered, per Koios. The edge case isn't live.
- **While the index trails the ledger:**
  - At an epoch's start, before db-sync has the boundary, or past 180 s behind: then a 503 sends the wallet to Koios.
  - A build in that pool withdraws the wrong figure and is refused at phase 1, with no collateral taken.
  - A chain stops after its deposit, its boxes waiting unmixed for Mix my boxes again. A way back's due time waits for a later run, and Bring every box back counts a failed run.
  - Nothing loops, and nothing is lost. Its words are readers#4's.

## Not checked

- The rest of `stakingRefusal`'s names at PV11 (readers#4's last point).
- giveme.my's own checks of a withdrawal of N (its source).
