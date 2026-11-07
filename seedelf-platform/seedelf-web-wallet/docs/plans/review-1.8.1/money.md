# 1.8.1 review · money: can a take ever cost anyone money?

Reviewer `money`. Scope: #367 (chunk 43), read against #362's and #368's proofs and every set of scripts a wallet transaction runs. Tree `2a8060d3`.

**Verdict: no.** No script of any set reads a withdrawal's amount, the fee or the payer's change, so an extra N ₳ never fails phase 2. Every take lands whole in the user's own output: a mix's change, carried to the account or the session's return, or a withdraw's register. It never reaches giveme.my's collateral return, a box or the fee. A balance that moves fails only at phase 1, at no cost. Two findings, both low test gaps: the merged tests never run v2, the set every new pool launches on, with a take, and four WebAssembly paths are never handed a balance. Repros in a scratch copy show both hold.

## Findings

### money#1 · low · test gap: v2's scripts are never run with a take

- **File:** `seedelf-platform/seedelf-core/tests/lovejoin_pools_test.rs:1283` (and `lovejoin_mainnet_test.rs:373`).
- **What's wrong:** every merged test that builds with a non-zero `Rewards` runs one of three sets of scripts: the classic pools' bundled scripts, or V1 (`lj_pool()`, Lovejoin's preprod token pool, 8131b1d). In wasm, `five()` is `templates::derive` = `Set::V1`.
  - None runs `Set::V2` (29573c5) with a take. V2 is the set every pool the wallet launches runs, and this release's head start adds mainnet's v2 5 ₳ pool (`fcb3f5ec…`).
  - On mainnet's classic scripts, `mix_giveme`, `withdraw_paid` and `withdraw_private` are never run with a take. On preprod's classic scripts, `withdraw_paid` and `withdraw_private` aren't either.
- **Evidence (the behaviour holds):** the repro `seedelf-core/tests/zz_r181_money_1.rs` ran 8 tests, all passing; it's deleted, with a copy at `SCRATCH/review/money/zz_r181_money_1.rs`.
  - It builds every kind with 500 ₳ in `mix_logic`'s account: `mix`, `mix_giveme`, `withdraw`, `withdraw_paid` and `withdraw_private`. It does so on the committed v2 ADA pool (`wasm/tests/fixtures/lovejoin-v2-ada-pool-preprod.json`), the v2 token pool, mainnet's classic pool and preprod's classic pool.
  - It also builds `collateral_tail` into the v2 5 ₳ pool.
  - A build that returns is the real scripts passing, since each builder measures its finished transaction. A control proves the evaluator bites: boxes of 6 ₳ in the v2 5 ₳ pool fail with "A script refused this transaction (withdraw 0: the validator crashed / exited prematurely)".
  - Measured again with a take, a mix's declared budgets are exactly what it uses, on v2 and both classic sets. For example, v2's Reward#0 declares 1,079,939 / 5,729,338,339 and uses 1,079,939 / 5,729,338,339. So a take can't leave a mix's budget short.
- **Failure it leaves open:** a v2 build that mishandled a take, a regression there, or a future set that reads the amount would pass every suite and fail live. The take is rare and its live run is declined, so a live run would never catch it.
- **Smallest fix, test first:** move the repro's `every_kind_takes_it` into `lovejoin_pools_test.rs`, on the v2 ADA and token fixtures, and into `lovejoin_mainnet_test.rs` for the classic kinds it lacks. Keep the budget check.

### money#2 · low · test gap: four WebAssembly paths never get a balance

- **File:** `seedelf-platform/seedelf-web-wallet/wasm/tests/lovejoin_across_test.rs:310` (the plan's claim is at `WW/docs/archive/plans/chunk-43-lovejoin-reward-balance.md:169`).
- **What's wrong:** wasm's balance tests are `a_chains_first_mix_in_each_pool_takes_its_balance_and_the_return_brings_it_back`, `a_tail_in_the_chains_own_pool_takes_nothing_once_the_chain_took_it`, `a_public_chain_leaves_the_balance_it_took_in_the_account` and `a_box_comes_back_with_the_pools_balance_in_its_register`, at `lovejoin_test.rs:2116`–`2250`. They cover a session's chain, its tail, a public chain and a box-paid withdraw.
  - `api::session_return`'s tail (`direct_tail`) and `lovejoin::collateral_mix`, the tail's mix built again (`buildCollateralMix`), are never handed a balance.
  - Neither are `chain_across_pools`, `again_from_account_at`, `withdraw_paid_in` and `withdraw_private_in`.
  - Every other test passes `rewards: Default::default()`.
  - The archived plan's Step 4 says `lovejoin_across_test.rs` checks "a request's `rewards` reaches each pool's first mix". It has no balance at all.
- **Evidence (the behaviour holds):** the repro `wasm/tests/zz_r181_money_2.rs` passed 2 of 2; it's deleted, with a copy at `SCRATCH/review/money/zz_r181_money_2.rs`. Both cases run on the v2 5 ₳ pool fixture with 500 ₳.
  - A direct return's tail mix withdraws 500 ₳. The return then sweeps 518,821,156 lovelace into Seedelf, against 18,821,332 with no balance, and `lovelace` says so.
  - The collateral mix built again withdraws 500 ₳. Its return sweeps 501,996,103 lovelace, and `returned` matches.
- **Failure it leaves open:** a dropped `rewards` in these paths is a phase-1 refusal, not lost money. But "the return after brings it back" is exactly the brief's question, and it's unproved for the two tail paths, where the change sits at a one-time account.
- **Smallest fix, test first:** add the two repro tests to `lovejoin_test.rs`, and one across-pools and one paid-withdraw request with `rewards`. Correct the plan's line, or leave the record and note it in the review record.

## Does any script read the amount? (every set a wallet transaction runs)

| Set | Source | `mix_logic` withdraw handler | `mix_box` | Fee read |
|---|---|---|---|---|
| Classic, preprod | Lovejoin fa5b605 (`references.rs:77`; contracts the same as the 5b46e95 "bootstrapping v0.4.0" deploy; format-only diff from cb5a5a3) | `_account`, reads `self.inputs`, `reference_inputs`, `outputs` (`mix_logic.ak:46`) | `pairs.has_key(self.withdrawals, …)` (`:60`): key only | only `fee_contract`, which no wallet transaction runs |
| Classic, mainnet | cb5a5a3 (`mod.rs:236`, `references.rs:178`) | same (`:46`) | same (`:62`) | same |
| `Set::V1` | 8131b1d | same (`:46`) | same (`:62`) | same |
| `Set::V2` | 29573c5 | same; differs from V1 in `sigma_or.ak` alone | same | same |

Seedelf's `wallet.ak` at 5b82530, spent in `withdraw_private`, reads its datum, its redeemer and `extra_signatories` only. In the Mix branch, an output past the boxes must only not be at `mix_box` (`walk_outputs`), so the change is free. In the Owner branch the context hashes every output, and the wallet proves over the staged outputs, re-proving each fee round. The withdrawal is in neither context.

**#368, v2's `mix_logic`:** `mix_logic_accepts_iff` (`Lovejoin/Every/Readable.lean:224`) unfolds to `withdrawOk`. That is `readReferenceDatum` (`txInfoReferenceInputs`), then `validateOwner`, which reads `txInfoInputs`, the input refs and every `txInfoOutputs` hashed into ctx, or `validateMix`. `validateMix` reads `txInfoInputs` and `walkOutputs`: N boxes of exactly the box value, then nothing at `mix_box`.
- No condition names `txInfoWdrl`, `txInfoFee` or a non-box output's value. `RewardingScript _` ignores the credential, and the only hypothesis is the reference inputs' values, which the ledger enforces.
- The proved bytes are core's V2 templates: the `.hex` files' sha256 equals `MIX_LOGIC_V2`, `MIX_BOX` and `ONE_SHOT_MINT`. The lead's capped build log ends `ok` for `Readable*`.

**#362, `mix_box`:** `every_context_iff` → `datumPassesLedger`: `∃ amount, (ScriptCredential L, amount) ∈ wdrl` (`AnyTx/BoxSemantics.lean:105`), any amount.

## What the merged tests cover with a take

| Set | mix (own) | mix (giveme.my) | withdraw, boxes | withdraw, account | withdraw, Seedelf | chain / again | collateral tail |
|---|---|---|---|---|---|---|---|
| Classic preprod | core | core | core, wasm | none | none | core, wasm (session, public) | core (10 ₳ pool stands in) |
| Classic mainnet | core | none | core | none | none | none | n/a |
| V1 | core | wasm (`five()`) | core (`poor`) | core | core | core (across leg) | wasm (`five()`) |
| V2 | none | none | none | none | none | none | none |

The repros fill every "none" above but the chains, which are mixes paid from the change before them.

## Where each take ends up (every caller)

- **A session's chain** (`chain_at`, `chain_across_pools`, the worker's `fanOut`/`acrossOf`): the first mix in each pool takes it, each later mix pays from that change, and `with_return`'s last transaction sweeps the chain's change, or the tail mix's change, into Seedelf. `own` holds it, so `plan_return` takes it first.
- **Its collateral tail** (`CollateralTail::build`): the deposit spends the chain's change and puts it in the deposit's change, never the 5 ₳ box. The giveme.my mix pays from that, and the return sweeps the mix's change (rows[0]).
  - `txs` order is chain, tail deposit, tail mix, back, and `pumpChain` sends in order. The return spends the mix's change, so it can't land before the mix.
  - The brief's "the tail mixes after its return" doesn't happen. A skipped or over tail sends no mix and takes nothing. The rest comes back directly, its deposit's change included.
- **A direct return's tail** (`direct_tail` in `session_return`): the mix's change is `rest[0]`, swept (repro money#2).
- **The mix built again** (`collateral_mix`, `tailChain`): mix, then back, which sweeps the mix's change (repro money#2).
- **A public chain and Mix again from the public account** (`chain_from_account_at`, `again_from_account_at`): the change is at the account's own Receive/0, and stays there. Each of `chain_from_account_at`'s tries takes from a fresh `rewards.clone()`.
- **The withdraws** (`withdraw_in`, `withdraw_paid_in`, `withdraw_private_in`, and a Bootstrap's bring-back through `withdrawOne`): the fresh Seedelf register gets it. For an account-paid withdraw, the take counts toward the register's minimum, so the account's change is untouched. `withdraw_private_in` keeps an untaken copy past a UTxO too small.
- **Never giveme.my's return, a box or the fee:** read from the bytes (repro money#1).
  - The giveme.my mix's collateral return is 3,751,976 lovelace (5 ₳ less 1.5 × the 832,016 fee). Its boxes are exactly 5 ₳ each, and its change is 20 ₳ + 500 ₳ − fee.
  - The withdraw's collateral return is 5 ₳ less 1.5 × its fee, and its register is 5 ₳ + 500 ₳ − fee.
  - The take's bytes cost 176 lovelace of fee (832,016 against 831,840).
- **Never a one-time account left unwatched:** every session path ends in a sweep of the change that holds the take. A chain cut short leaves it at the session's account, and the rest comes back directly (`chainSoFar`).

## The reverse: a stranger's balance, or one that moves

- **No phase-2 failure from an amount.** No script reads it, and the script context is built from the transaction, not the account. A balance that moves after the build gives the same context and the same budget, and `WithdrawalsNotInRewards` (Conway's CERTS) refuses it at phase 1.
- **The only local checks are scripts.** uplc (`eval_phase_two_raw`) and Ogmios's evaluate (`crossCheck`, `tailWitness`) never compare the amount with the account. So a wrong read is caught at the submit, at no cost.
- **On mainnet today:** Koios reads the classic `mix_logic` account (`stake17yx66vzx…`) and the v2 5 ₳ pool's (`stake17xn2s5r5…`) as registered, with `rewards_available` "0". The answers are strings, which `readBalance` takes.

## Checked, and it held

- Rewards hands a pool's balance to the first transaction built there, and 0 after.
  - A failed build takes nothing (`taken()` is called only on success), a balance past a u64 is refused in words, and a 0 is dropped.
  - One `Rewards` goes through `fan_out`, `chain_across`'s legs and `with_return`'s tail. So a tail in the chain's own pool withdraws 0.
- `mix_with` stages the same `WithdrawZero` (taken) in the draft and the final, and `paying = fee coin + taken` (checked).
  - `Mix::change` and the staged change agree. The collateral return comes from the payer's own 5 ₳, or giveme.my's, on the fee alone.
- `withdraw_with` sets `coming = total + taken` (checked) and makes `into_register` count it in all three paths. `topped` is cut by the take, `CantPayBack` and `PrivateTooSmall` count it, and `withdraw_paid`'s change is `fee coin − fee − topped`.
- The way-back probes (`way_back`, `comes_back`) build at `Rewards::none()`, so a pool's verdict never moves with a windfall. A Bootstrap reads none and runs no script.
- The worker hands every Lovejoin builder `rewards`: `buildLovejoinChain` ×2, `buildCollateralMix`, `buildLovejoinFromAccount`, `buildLovejoinAgainFromAccount`, the three withdraws and `buildSessionReturn`. Launches withdraw nothing.
- **What counts as on its way:**
  - `takingFrom` reads `goingOut` of `heldSent` (with `either`) and chains being sent (`until === undefined`), whose `takes` is kept by `reservationOf` and `holdOnly`.
  - `balanceAfter` gives 0 when read ≥ taking > 0.
  - `withdrawOne`'s retry runs after `neverWent` and `forgetWithdraw`, so the refused withdraw's own take isn't counted against it.
- **Two builds taking one balance:**
  - A chain kept for Send doesn't count as on its way. Its Send re-read (`rewardsMoved` in `publicStart`, `backSubmit` and `claimSubmit`) sees a take by another chain sent meanwhile, or by a withdraw: `sendChain` reserves it as sending before the next is checked, so the re-read is moved, a stale review.
  - Otherwise a double take is refused at phase 1.
- `RewardsChangedError` is raised only on `WithdrawalsNotInRewards`. A chain stops in Lovejoin's words, and a withdraw is built again once, giveme.my asked again.
- **The reward account:** wasm's `reward_account(hash, flag)` (0xf0/0xf1) matches the worker's `header + hash`, and `txWithdrawals` reads amounts as bigints.
  - The data layer takes `stake1` script addresses (`ids.rs` `stake_bytes`, 0xf1). Its `rewards_available` adds `reward` (pool refunds included), `reserves`, `treasury` and `proposal_refund`, less withdrawals, as a string.
- **The dApp guard:** `paidScripts` collects script reward accounts from a pool registration, a proposal's return and a treasury withdrawal's payees.
  - `DappService` refuses any that names a known `mix_logic`, for public and session signers alike, before the user is asked. A site's withdrawal from `mix_logic` isn't refused, since that pays nothing in.
- **The release prep's head start:** mainnet's v2 5 ₳ pool derives on `Set::V2` from seed `6db8a313…#3`, giving P `fcb3f5ec…`, L `a6a85074…` and M `dd94113c…` (repro).
- **The plan's citations are exact:** `mix_logic.ak:46` and `mix_box.ak:62` (`:60` at fa5b605), at every set.

## Repros

Each was named, run by name, and deleted from the tree. Copies are kept in `SCRATCH/review/money/`.
- `cargo test -p seedelf-core --test zz_r181_money_1`: 8 passed.
- `cargo test -p seedelf-wasm --test zz_r181_money_2`: 2 passed.
- One Koios read: mainnet `account_info` of the two `mix_logic` accounts.
