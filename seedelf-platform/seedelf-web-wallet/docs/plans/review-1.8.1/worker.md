# 1.8.1 review · worker: #367's WebAssembly requests and the worker

Reviewer id `worker`. Tree: `web-wallet/release-1.8.1` at `2a8060d3`. Diff read: `git diff 08fbb6f6 9103df62 -- WW/wasm WW/extension/src`, with the tests it changed, and the code each new line calls into (core's `Rewards`, `mix_with`, `withdraw_with`; the worker's reservations, sent and spent records, `pumpChain` callers, `settleWithdrawing`; the data layer's `account_info` and submit pass-through).

## What I ran

- Vitest, by name: `tests/lovejoin-reward-balance.test.ts`, `tests/koios.test.ts`, `tests/lovejoin-1-5-0.test.ts`: 3 files, 47 tests, all pass.
- Cargo, by target: `cargo test -p seedelf-wasm --test` `lovejoin_test` (29), `lovejoin_flows_test` (14), `lovejoin_across_test` (4), `session_test` (13, 1 ignored: the fixture recorder), `return_cost_test` (5), `lovejoin_mainnet_test` (8), `lovejoin_pools_test` (6): all pass.
- Four repros, `EXT/tests/zz-r181-worker-{1,2,3,4}.test.ts`, run by name, then deleted from the tree. Copies are in `SCRATCH/review/worker/`. What each showed is under its finding.
- Nothing else: no e2e, no live run, no submit, no network beyond the fakes.

## Findings

### worker#1 · low · Send answers a refused chain in staking's words

`extension/src/background/lovejoin.ts:5411` and `extension/src/background/sessions.ts:5319`.

- **What's wrong.** When the network refuses a chain's mix with `WithdrawalsNotInRewards`, the chain's own record says it in Lovejoin's words (`lj.warn.rewardsMoved`). But both catches then rethrow the original `RewardsChangedError`, whose message is staking's (`koios.staking.rewardsChanged`). That message is what the user sees in four places. The plan said the opposite: "A chain it stops says it in Lovejoin's own words... never staking's."
- **Evidence.**
  - lovejoin.ts `pumpPublicNow`: `sending.stopped = ... e instanceof RewardsChangedError ? REWARDS_MOVED() : ...`, then `throw unsure !== undefined ? new Error(sending.stopped) : e;`.
  - sessions.ts `pump`: `const why = e instanceof RewardsChangedError ? REWARDS_MOVED() : ...`, then `throw e;`.
  - Repro 1 refused the second submit (the first mix) with the node's `WithdrawalsNotInRewardsCERTS`, with 500 ₳ in the 5 ₳ pool's account:
    - **The public mix's Send** rejected with "Your staking rewards changed since you reviewed this. Review it again." Its progress said "The network refused it: Lovejoin's pool changed as it was sent. Nothing was lost."
    - **A reviewed return's Send** (`backSubmit`) said the same staking words, while `chain.stopped` had Lovejoin's.
    - **Bring everything back** (`claimSubmit`): `failed[0].error` was the staking words.
    - **A mix that runs itself** (the runner's `step`): the Lovejoin page's detail read "Why it stopped: The network refused it: Lovejoin's pool changed as it was sent. Nothing was lost. It tries again at 00:00:30. What went wrong: Your staking rewards changed since you reviewed this. Review it again."
  - The existing test, "stops in Lovejoin's words, never staking's", swallows the Send's rejection (`.catch(() => undefined)`) and checks only `stopped`.
- **The failure.** A pool's balance moves in the seconds between Send's read and the first mix's submit. Or, for the runner, it moves at any point while a chain is sent, its collateral tail's wait for giveme.my included. The user is then told their staking rewards changed and to review again. Their staking rewards didn't move, and a runner's mix has nothing to review.
  - **The public mix:** its review was used up at Send, so a new review makes a new deposit. Meanwhile the deposit that went in waits, not mixed yet, for Mix my boxes again.
- **Fix, test first.** In lovejoin-reward-balance.test.ts, assert what `publicSubmit` rejects with (`REWARDS_MOVED()`), and add a session-return case (`backSubmit`, and `claimSubmit`'s `failed[].error`). Then:
  - lovejoin.ts:5411: `throw unsure !== undefined ? new Error(sending.stopped) : e instanceof RewardsChangedError ? new RewardsChangedError(REWARDS_MOVED()) : e;`.
  - sessions.ts:5319: `throw e instanceof RewardsChangedError ? new RewardsChangedError(REWARDS_MOVED()) : e;`.
  - Both keep the type and drop staking's words.

### worker#2 · low · a collateral tail's claim on the balance holds while its mix waits for giveme.my

`extension/src/background/lovejoin-rewards.ts:74` (`takingFrom`'s reservations), with `lovejoin.ts:4692` (`reserve` → `reservationOf(txs)`, the tail's mix included) and `lovejoin.ts:1449`/`1456` (`tailWaits`, `mixing`).

- **What's wrong.** A chain being sent counts as taking whatever any of its transactions withdraws, sent or not (`Reservation.takes`). The plan meant that for a chain's first mix, which goes seconds after Send.
- **But a session's collateral tail is different.** Its mix is sent only once giveme.my signs, after its deposit is on chain. That's minutes normally, and up to `TAIL_KEEP_MS` (24 h) when giveme.my is slow.
- **Where the tail takes the balance.** It's the only transaction in its pool in two cases:
  - a direct return with its collateral mixed (a site's session whose spare pays for no box);
  - a token pool's mix, whose tail goes into the 5 ₳ pool.
  - In both, the tail's mix takes the whole balance (lucky winner), and the wallet's own reads give 0 there until it's sent.
- **Evidence.** Repro 2: a session of 4 ₳ plus its 5 ₳ collateral, 500 ₳ in the 5 ₳ pool's account.
  - The review came back directly with a tail: `deposit(tail)`, then `mix(tail)` withdrawing 500000000, then `back`; `balances` [500000000].
  - After `backSubmit`: the tail's deposit was sent, its mix not. The reservation `session.0` had no `until` and `takes {f0ff52…: "500000000"}`.
  - `rewardsIn` for the pool then gave `"0"`, while account_info still said 500 ₳.
  - A mix from the public account built in that pool then withdrew `0`, and its Send went through: Send's re-read compares 0 with 0.
- **The failure.** Each of these happens only while the tail's mix waits.
  - **A public mix or another session's chain in that pool** builds on 0. Its deposit lands, and its first mix is refused (`WithdrawalsNotInRewards`: the ledger still holds the balance). The chain stops after its deposit, its boxes not mixed yet.
  - **Due withdraws in that pool** go meanwhile: `chainsMixing` leaves out a chain whose tail alone waits. Each is built on 0, refused, built again on 0 and refused again. That's two giveme.my witnesses and two submits each run, until the tail lands.
  - **Bring one back now** says "Lovejoin's pool changed". The pool didn't change: the wallet's own tail holds the balance.
  - **It's rare.** It needs a balance in the pool, a tail that took it, and another flow there inside the wait.
  - **The owner's call has a consequence here** nobody wrote down. The lucky-winner rule makes the tail, built first, the winner. The "on its way" rule then keeps the wallet's own later transactions there from taking it, though they would be sent first.
- **Fix, test first.** Repro 2's shape: a direct return with a tail that took the balance, sent, its mix waiting. Then a public mix built in that pool should take the balance, or be refused at Send.
  - **Smallest fix:** leave a tail's mix (`tail: true` on the chain's transactions) out of a reservation's `takes`. It counts as on its way once it's sent (`heldSent`).
  - **Its cost:** a tail refused because another build took the balance first stops there, as it stops for a box it drew that went. tailChain then builds it again on a fresh read.
  - **The alternative:** keep the claim, and make due withdraws wait for such a tail. The public mix and other chains would still be cut.
  - **The owner's to pick.**

### worker#3 · low · a maybe-sent way back that took a balance and lost it is resent for two hours, holding every way back

`extension/src/background/lovejoin.ts:7836` (`settleWithdrawing`: `await koios.submitTx(bytes).catch(() => undefined);`).

- **What's wrong.** A withdraw whose submit got no answer stays `withdrawing`. `settleWithdrawing` resends it every `CHAIN_RESEND_MS` and ignores every refusal, until `SPENT_KEEP_MS` (2 h) after it was first sent. While it's withdrawing, no other box comes back:
  - withdrawDue returns nothing;
  - Bring one back now throws `lj.lastBoxMaybe`;
  - Bring every box back waits (`elsewhere("withdraw")`).
- **Before 1.8.1**, such a withdraw withdrew 0, so a resend of one that never reached a node could still land.
- **Now it can take a balance**, and once another wallet's transaction takes that balance it can never land. Every resend is refused with `WithdrawalsNotInRewards`.
- **Evidence.** Repro 3: a box due, 500 ₳ in the pool's account, and its submit's connection lost (a `WithdrawMaybeSent`). Then the balance went to 0 (another wallet's take), and every resend was refused with the node's words:
  - `+4m: withdrawing true, submits 2, Bring one back now: The last box may still be on its way back. Try again in a few minutes.`
  - `+30m: withdrawing true, submits 11, …the same`
  - `+60m: withdrawing true, submits 21, …the same`
  - `+110m: withdrawing true, submits 37, …the same`
  - `+125m: withdrawing false`, dropped at 2 h.
  - That's about 40 refused resends over two hours (36 by +110 m), every way back held.
- **The failure.** Every box's way back is held for up to two hours, and Koios gets a doomed submit every three minutes. It needs a balance, an unanswered submit, and a lost race: rare, but new with #367.
- **Fix, test first.** Repro 3's shape: after the resend is refused for the balance, the next run builds the box again on a fresh read and sends it.
  - **The change:** in `settleWithdrawing`, a resend refused with `RewardsChangedError` drops the withdraw as never went (`neverWent`, `forgetWithdraw`, its due time back) and returns false.
  - **Why it's safe:** a copy that's in a block or a mempool is refused as spent first. koios.ts checks `BadInputsUTxO` and "All inputs are spent" before `stakingRefusal`, so `RewardsChangedError` on a resend means it can't land as built.

### worker#4 · low (test gap) · the sessions' side of #367 is held by no test

`extension/src/background/sessions.ts:5048` (`balancesHeld`), `sessions.ts:5309` (`pump`'s words), and the reads in `lovejoin.ts` `tailChain`, `acrossOf` and sessions.ts `buildBack`'s direct tail.

- **What's wrong.** lovejoin-reward-balance.test.ts covers only the public account's mix and a box's way back.
- **No test in the suite sets a balance for a session.** If any of these were removed, nothing would fail:
  - `balancesHeld` in `backSubmit` and `claimSubmit`;
  - sessions.ts `pump`'s `REWARDS_MOVED`;
  - `tailChain`'s read and `balances`;
  - `buildBack`'s direct-tail read and `balances`;
  - `acrossOf`'s legs' reads;
  - `holdOnly` keeping a held step's `takes`.
  - Grep: only koios, dapp, staking, lovejoin-1-5-0 and lovejoin-reward-balance tests name `REWARDS_MOVED*`, `rewardsIn`, `lovejoinMixLogic` or `WithdrawalsNotInRewards`.
- **Evidence that they work today.** Repro 4:
  - `backSubmit` of a return built on 500 ₳, after the balance went to 0: a `StaleReviewError` in `lj.rewardsMovedReview`'s words, nothing submitted.
  - `claimSubmit` after 0 → 3 ₳: `failed: [{ index: 0, error: "Lovejoin's pool changed since you reviewed this. Review it again." }]`, nothing submitted.
  - Repro 1: a session chain's `stopped` is Lovejoin's words.
  - Repro 2: a direct return's tail takes the balance and keeps `balances`.
- **Fix.** Add repro 4's two cases, a direct return's tail taking a balance (repro 2's first half), and a session chain stopped by the refusal (repro 1's second case, with worker#1's fix) to lovejoin-reward-balance.test.ts.

### worker#5 · nit · a private Bootstrap reads its pool's reward account for nothing

`extension/src/background/lovejoin.ts:3826` (`fanOut`'s `rewardsOf`).

- **What's wrong.** A Bootstrap is a deposit alone: no mix, no withdrawal. The public one skips the read on purpose (lovejoin.ts:4852: "a Bootstrap runs no script, and reads none").
- **The private one doesn't.** Its session's chain is built with `fixed` 0, and `fanOut`'s `attempt` reads account_info whatever the depth. The read never reaches a transaction: `balancesOf` finds no withdrawal.
- **The failure.** One wasted account_info per private Bootstrap, from the IP that sends it moments later. It names the pool, not the wallet.
- **Fix.** `...(depth > 0 ? rewardsField(await this.rewardsOf(network, c, [pool, c.collateralPool?.pool])) : {})`. A test: a private Bootstrap's build asks no account_info.

## Checked, and held

**Every build path, and what it reads.**
- **Read, one account_info a pool a build:**
  - a session's chain (`fanOut`; `acrossOf` for a return across pools, reusing `c.rewards` when it falls back to the ADA pool's chain), the collateral's tail built inside it;
  - a mix and Mix my boxes again from the public account (`publicBuild`, `publicAgainBuild`, read outside `unstale`);
  - a collateral mix built again (`tailChain`);
  - a direct return's tail (`buildBack`, "read once, for every try");
  - every branch of `withdrawOne`: due, Bring one back now, Bring every box back, the retired pools' run, a Bootstrap's held box, paid by the account or the private balance.
- **Correctly read none:** a public Bootstrap; the way-back probes (`usable`, `comes_back`, `way_back` build on `Rewards::none()` and are never sent).
- **Stuck for good?** No path that builds on 0 while a balance sits there is stuck for good. Every one reads again at its next build or Send, and the waits that hold one are bounded:
  - `holdOnly`'s held step and a sent transaction's 2 h;
  - worker#2's tail wait;
  - worker#3's 2 h.
  - Mix my boxes again and Bring one back still work afterwards.

**The request's `rewards`.**
- **Parsing:** `RewardsIn(BTreeMap<String, String>)`, `#[serde(transparent)]`, `#[serde(default)]` on all eight requests the worker sends it to: `ChainRequest`, `CollateralMixRequest`, `AccountChainRequest` twice, the three withdraws', `api::SessionReturnRequest`. A number in place of a string is refused by serde, and the worker sends strings only.
- **Bounds:** a hash not 28 bytes, or an amount not a u64, is refused in words. The worker's `readBalance` caps at 45×10^15, below u64, so nothing it sends is refused. A hash no pool has is ignored.
- **Shared:** one `Rewards` runs through a chain and its tail. `chain_at`, `chain_across_pools` and `with_return` share it, so the tail in the chain's own pool takes 0.
- **Copied per try:** `chain_from_account_at` gives each try a fresh copy, and `withdraw_private_in` passes over a too-small UTxO having taken nothing.
- **The direct return:** `session_return`'s tail falls back to no tail without spending the read.
- **The hash and account agree:** the worker's `"f1"`/`"f0"` header plus hash matches core's `reward_account` (mainnet 0xf1, preprod 0xf0), and the data layer accepts 0xf1 (`ids.rs` `stake_bytes`).

**The read.**
- **What counts as unread:** a failed account_info, or a trap or a lock handed on. A missing row is 0, and not unread.
- **The data layer's figure:** `rewards_available` is a string (`account.rs:128`), summing `reward` (pool refunds included) and `reward_rest` less withdrawals.
- **`takingFrom`:** sent transactions held back (`goingOut`, `either`), and the reservations being sent (`until` none), never a review's.
- **`balanceAfter`'s blind spot:** it says 0 for a new windfall at least as large inside 2 h of the wallet's own take of one. That's two windfalls across an epoch boundary in 2 h, as for the account's own rewards.

**Two flows built at once in one pool.**
- **A public mix kept for Send and a runner's chain:** Send's re-read catches it (moved, stale review).
- **Bring every box back's withdraws back to back:** each reads the one before as on its way (heldSent), and takes 0.
- **Due and by-hand withdraws:** serialized by `withdraw.<network>`.
- **A runner's chain and a withdraw at once:** one is refused. A withdraw builds again on a fresh read. A chain is cut, which the owner's backlog line covers.

**Across a worker restart, and from 1.8.0.**
- **A restart:** `takes` is kept with the reservation in chrome.storage.session, and kept chains keep `balances` there too.
- **A 1.8.0 profile's state** (reservations with no `takes`, kept chains with no `balances`) lives in chrome.storage.session, which an extension update clears.
- **And even read:** no `takes` is taken as 0, which is what 1.8.0's withdrew.

**Send's re-read.**
- **Where:** `publicStart`, `backSubmit`, `claimSubmit`; repro 4 shows the sessions' two.
- **`readsFor`:** names every account the chain's transactions withdraw from, 0 included, so a balance arriving after a build on 0 is caught.
- **An unread read** at Send is no move.
- **Its own chain:** a kept chain's reservation has `until`, so its own takes never count against it.

**`RewardsChangedError`.**
- **The match:** `text.includes("WithdrawalsNotInRewards")`, which catches Conway's `WithdrawalsNotInRewardsCERTS`. The data layer passes cardano-submit-api's body through (`submit.rs` `pass_through`), and `serverWords` reads only a top-level `error`, so the node's words reach the match on both networks.
- **Order:** `SpentInputError` is checked first.
- **Types kept:** `DataLayerKoios.submitTx` rethrows it unwrapped (no `trouble`). Staking's flows still get a `KoiosError` in staking's words.

**`withdrawOne`.**
- **The first refusal:** the due time goes back, the record and spent marks go, then it builds again on a fresh read with giveme.my asked again.
- **The second refusal:** a `KoiosError` in Lovejoin's words. Due runs give the due time back, Bring every box back carries on to the next box, and Bring one back now shows it.

**The worker's English.**
- **New words:** `REWARDS_MOVED` and `REWARDS_MOVED_REVIEW` are functions. `stopped`, `why` and `retry.error` store text only to show it, which is accepted.
- **Matches:** nothing compares or parses the new words. koios.ts matches the node's English, and the existing regexes match WebAssembly's.

**Wiring.** sw.ts passes `lovejoin` to `DappService`, and rpc.ts's `paidScripts?` matches cip30.rs's `paid_scripts` (camelCase).
