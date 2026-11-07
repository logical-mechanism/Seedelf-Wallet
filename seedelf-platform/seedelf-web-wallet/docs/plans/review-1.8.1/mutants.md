# 1.8.1's release review: mutants (#367's tests, by mutation)

Reviewer `mutants`. Every rule #367 added (`git diff 08fbb6f6 9103df62`) was mutated one at a time in the worktree `Seedelf-Wallet-r181`, detached at `2a8060d3`. Each mutant ran first against the tests meant to catch it, and a survivor then ran against every test target that reaches its code.

- **121 mutants:** 52 in Rust (31 in `seedelf-core`, 21 in the wasm crate) and 69 in TypeScript.
- **Killed:** core 26 of 31; wasm 12 of 21 (one of them, W17, only from TypeScript); TypeScript 30 of 69.
- **Equivalent,** with the reasons under *Checked*: C3, C3w, W12, T1c, T2b and T6b. T1a differs only at an input the chain can't reach.
- **Every survivor is a test gap, not a bug in the code as merged.** Each rule holds by reading, and every repro below passes on `2a8060d3`.
- **One file is the whole of it:** only `lovejoin-reward-balance.test.ts` gives a `mix_logic` account a balance. So every flow it doesn't drive has no test of the balance at all: the session return's chain and tail, the public Mix again, the paid and private ways back, and the collateral's mix built again.
- **Ten findings, all low.** Nine are test gaps; the tenth is chunk 43's record naming two tests that don't exist, where mutants survive.
- **The worktree is left clean,** and `wasm/pkg` is restored with matching checksums. No repro is left anywhere.

## How it was run

- **Rust:** `cargo test -p seedelf-core --test <t>` or `-p seedelf-wasm --test <t>` in the worktree, on its own target.
  - The designed test ran first.
  - A core survivor then ran core's eight Lovejoin targets and its lib tests: `lovejoin_test`, `withdraw_zero_test`, `lovejoin_planner_test`, `lovejoin_pools_test`, `lovejoin_mainnet_test`, `lovejoin_box_value_test`, `lovejoin_width_test`, `lovejoin_vectors_test` and `--lib`.
  - Every survivor, core's included, ran the wasm crate's ten: `lovejoin_test`, `lovejoin_across_test`, `lovejoin_flows_test`, `lovejoin_mainnet_test`, `lovejoin_pools_test`, `lovejoin_v2_fixture_test`, `session_test`, `return_cost_test`, `cip30_test` and `api_test`.
  - Each was an exact string replacement, restored with `git checkout -- <file>` before the next.
- **TypeScript:** `npx vitest run <files>` in the worktree's extension, against its real `wasm/pkg`.
  - The designed file ran first: `lovejoin-reward-balance.test.ts`, `dapp.test.ts` or `koios.test.ts`.
  - A survivor whose effect shows with no balance (an `account_info` more or less at Send or on a try, or wiring) then ran every file of its flows. The groups: public 37, session 22, withdraw 35, tail 12, dApp 15, rules 4, at most 76 files at once.
  - A survivor whose effect needs a balance, or a `WithdrawalsNotInRewards` refusal in a Lovejoin flow, wasn't swept, because only `lovejoin-reward-balance.test.ts` makes either. Grepping `tests/` for `rewards_available`, `stakes.set` and `WithdrawalsNotInRewards` finds otherwise only `koios.test.ts` and `staking.test.ts`, which test the Koios client and the account's own staking.
- **W17** (the `lovejoinMixLogic` wrapper) can only be seen from TypeScript, since no Rust test calls a `#[wasm_bindgen]` function.
  - The module was built with W17 using build.sh's own cargo and wasm-bindgen steps, into scratch.
  - A control was built the same way from the unmutated source.
  - Each was swapped into the worktree's `wasm/pkg` for the run. The original pkg went back afterwards, and its four checksums match.
- **Baselines, before any mutant:** core's nine targets and the wasm crate's ten passed in the worktree, and `lovejoin-reward-balance.test.ts` passed 11 of 11. The lead's whole-suite Vitest run (`prep/vitest-baseline.log`, 3,208 passed) shows nothing failing beforehand.
- **Scripts and logs** are in `SCRATCH/review/mutants/`: `rust_mutants.py` and `ts_mutants.py` hold every mutant's exact text, and `rust-results.jsonl` and `ts-results.jsonl` every run.

## Findings

### mutants#1 · low · A withdraw refused after it read the balance must take nothing: no test holds it

**File:** `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1716`

**What's wrong.** `withdraw_with` hands the balance over (`rewards.taken(protocol)`, :1716) only once the build has passed its CantPayBack/PrivateTooSmall check (:1691–1701).

- **What leans on it:** `withdraw_private_in` tries the private UTxOs in order with one `Rewards`: "A UTxO too small is passed over having taken nothing" (`wasm/src/lovejoin.rs:2895–2896`).
- **Why no test catches it:**
  - `a_build_that_fails_takes_nothing` fails a withdraw only on someone else's box, which bails at :1434, before the balance is read at :1451.
  - `a_reward_balance_past_what_a_u64_holds_is_refused_in_words` fails it at the sum (:1452–1454).

**Evidence.** Two mutants survive all nine core targets and all ten wasm targets:

- **C5b:** the take moved to just after the sum.
- **C5c:** the take moved to just before the CantPayBack check.

**Failure if it slips.** A box brought back paid from the private balance (`withdrawOne`, `paid: "private"`), whose first UTxO in order is too small, in a pool whose account holds a balance too small to make up the output:

1. The next try withdraws 0 while the account holds the balance.
2. The node refuses it (`WithdrawalsNotInRewards`).
3. `withdrawOne` builds it again once and is refused the same way.
4. The box doesn't come back this run.

**Fix, test first.** `zz_r181_mutants_1`, under *Repros*, goes in `lovejoin_pools_test.rs` beside `a_box_worth_less_than_the_fee_cant_pay_its_way_back`. It runs a 1-lovelace balance through a CantPayBack `withdraw`, then a PrivateTooSmall `withdraw_private`, then the one that pays, which takes it.

- It passes on `2a8060d3`.
- It fails under C5b and C5c (`left: 0, right: 1` at the first balance check).

### mutants#2 · low · Mixing again: its take must leave the caller's `Rewards`, which a session's tail is built on: no test holds it

**File:** `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:2382`

**What's wrong.** `again_at` hands its `rewards` to `fan_out` (:2382–2391). Once the chain's first mix has taken a pool's balance, the caller's `Rewards` holds 0 there.

- **What leans on it:** WebAssembly's `chain_at`, on its again branch. It calls `again_at(…, &mut rewards)` (`wasm/src/lovejoin.rs:1630–1639`), then hands the same `rewards` to `with_return` (:1703), whose collateral tail "takes what `rewards` still holds for its pool".
- **Why no test catches it:**
  - Core's `a_chains_first_mix_takes_the_balance_and_its_change_carries_it` mixes again on a temporary (`&mut holding(&protocol, WINDFALL)`) and never reads it afterwards.
  - The wasm crate's `a_tail_in_the_chains_own_pool_takes_nothing_once_the_chain_took_it` runs with `again: false`.

**Evidence.** C26 (`again_at`'s `fan_out` given `&mut rewards.clone()`) survives every core and wasm target.

**Failure if it slips.** A session's Mix again in v2's 5 ₳ pool, with the collateral's tail in the same pool. The chain's first mix takes the balance and the tail's mix takes it again. The second of the two is refused when it's sent, partway through the return.

**Fix, test first.** `zz_r181_mutants_3`, in `lovejoin_test.rs`: `again` on `holding(&protocol, WINDFALL)`, then `assert_eq!(rewards, Rewards::none())`.

- It passes on `2a8060d3`.
- It fails under C26.

### mutants#3 · low · WebAssembly: six requests' `rewards`, and `chain_across_pools`' tail sharing the chain's `Rewards`, have no test

**File:** `seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs:1792`

**What's wrong.** Each of these reads the request's `rewards`, and replacing the read with `Rewards::none()` survives every Rust target:

| Mutant | Entry point | Line |
|---|---|---|
| W2 | `chain_across_pools` | :1792 |
| W4 | `again_from_account_at` | :2531 |
| W6 | `withdraw_paid_in` | :2801 |
| W7 | `withdraw_private_in` | :2896 |
| W8 | `collateral_mix` | :557 |
| W9 | `api::session_return`'s direct tail | `lib.rs:1423` |

- **W11 survives too:** `chain_across_pools` gives its tail a copy of its own. This is the across-pools twin of W10, which `a_tail_in_the_chains_own_pool_takes_nothing_once_the_chain_took_it` kills for `chain_in`.
- **The extension's suite can't see these either:** its one file with a balance drives only `chain_from_account` (publicBuild), `withdraw_in` (withdrawDue) and the rules. See mutants#6 and #7.

**Evidence.** W2, W4, W6, W7, W8, W9 and W11 survive the wasm crate's ten targets. W1, W3, W5 and W10, on the other entry points, are killed.

**Failure if one slips.** That flow builds a 0 withdrawal while the pool's account holds a balance, and the network refuses it. Two cases:

- **A paid way back:** a box too poor to come back alone, paid from the account, doesn't come back while the windfall sits there. That's the case the lucky winner was meant to carry.
- **A private return's chain across pools:** it's refused at its first mix.

**Fix, test first.** One wasm test for each entry point:

- **The pattern:** as `a_box_comes_back_with_the_pools_balance_in_its_register` does for `withdraw_in`, the request carries `rewards(&[(&protocol, 500_000_000)])`, and its first transaction's `withdrawn(…)` equals it.
- **For `chain_across_pools`:** two pools, and a tail in one of them that withdraws 0.

### mutants#4 · low · cip30: a proposal's deposit returned to a script isn't held

**File:** `seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1573`

**What's wrong.** `paidScripts` has three sources, and no test holds the proposal's deposit return.

- `a_transaction_names_every_script_reward_account_it_pays_into` (`cip30_test.rs:2060`) returns its proposal's deposit to `[6; 28]`. The same proposal's treasury withdrawal pays `[6; 28]` too, so `[5…, 6…]` comes out even with this source gone.
- `dapp.test.ts` drives a pool registration alone.

**Evidence.** W19 (the push at :1573–1576 removed) survives the wasm crate's ten targets. W18 and W20, which remove the pool registration's and the treasury recipient's pushes, are killed.

**Failure if it slips.** A site's proposal whose 100,000 ₳ deposit returns to a Lovejoin pool's `mix_logic` account is signed.

- The deposit lands there when the action ends.
- Every mix and way back in that pool is then refused until someone takes it.
- That is the case the owner asked this guard for: "the wallet at least does not allow a user to set that stake key for anything".

**Fix, test first.** `zz_r181_mutants_2`, in `cip30_test.rs`: one proposal returning its deposit to `[6; 28]`, with no treasury withdrawal, gives `paid_scripts == [hex([6; 28])]`.

- It passes on `2a8060d3`.
- It fails under W19 (`left: [], right: ["0606…"]`).

### mutants#5 · low · lovejoin-rewards.ts: four of its rules no test holds

**File:** `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-rewards.ts:68`

**What's wrong.** Five mutants survive `lovejoin-reward-balance.test.ts`:

- **T3a:** `takingFrom` without its first source, what the wallet sent and still holds (`goingOut`, :70–73).
  - That source is the only one for a withdraw, which keeps no reservation.
  - It's what stops the second due box of a run in the same pool from taking the first box's windfall again.
- **T3c:** `goingOut` called without `{ either: true }` (:70).
- **T3d:** the last chain being sent counted instead of the most (:74–77).
- **T4c:** `balanceAfter` keeping `read - taking` when the reading is more than the take (:87). The test pins only read equal to the take and read below it (`lovejoin-reward-balance.test.ts:69–75`), never above.
- **T7d:** `moved` with `every` for `some` (:118). The test's reads name one account each (:77–85), so a chain whose balances span two pools, one of them moved, isn't held.

**Evidence.** All five survive `lovejoin-reward-balance.test.ts`.

- They're balance-only: with a take of 0 nothing changes, and no other test file makes a take.
- The equivalent mutants in this file (T1c, T2b, T6b) are under *Checked*.

**Failure if T3a's rule slips.** Bring every box back, with two due boxes in one pool that holds a windfall:

1. The first box's withdraw takes the windfall.
2. The second, built while the first waits for its block, takes it again.
3. The mempool refuses the second, since the first took it.
4. Its one rebuild reads the same figure from Koios and is refused again.
5. That box waits for a later run.

**Fix, test first.** `zz-r181-mutants-1.test.ts`, under *Repros*: five unit tests on hand-made CBOR.

- It passes on `2a8060d3` and kills T3a, T3c, T3d, T4c and T7d.
- T4c's test pins today's rule: a take on its way that the reading still counts reads as 0. Whether a reading above the take should read as the difference is the owner's call. Either figure is refused at no cost when it's wrong.

### mutants#6 · low · A session's return: its reward balance passed, kept for Send, read again there and refused in Lovejoin's words, with no test

**File:** `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:3279`

**What's wrong.** The session return's half of chunk 43 has no test with a balance, and every one of these mutants survives:

| Rule | Mutant | Where |
|---|---|---|
| The session chain's read sent to WebAssembly | T25, T25b | `lovejoin.ts:3826`, `:4035` |
| Its balances kept for Send | T9f1, T9f2 | `lovejoin.ts:3839` (chain_in), `:4076` (across) |
| Its balances kept for Send | T9d1, T9d2 | `sessions.ts:4593`, `:4713` |
| The direct return's tail: balances kept | T9e | `sessions.ts:4800` |
| Read again at Send: `backSubmit` | T9b | `sessions.ts:3279` |
| Read again at Send: `claimSubmit` | T9c | `sessions.ts:3352` |
| The direct return's tail: rewards passed | T19 | `sessions.ts:4746` |
| The collateral's mix built again | T17, T17b | `lovejoin.ts:4495`, `:4501` |
| A chain stopped by the refusal, in Lovejoin's words | T11b | `sessions.ts:5309` |

**Evidence.** Ten survive `lovejoin-reward-balance.test.ts` and then the sweep over the session files, or the session and tail files: T25, T25b, T9f1, T9f2, T9d1, T9d2, T9e, T17b, T9b and T9c (22 or 29 files, 493 or 676 tests).

- **No test counts Send's reads:** each of those mutants drops an `account_info` read at Send even when the balance is 0. A return's chain names its pool's account with a 0 withdrawal, so its `balances` aren't empty, and the read happens.
- **The rest are balance-only:** T19, T17 and T11b survive their designed file.
- **The wasm side survives too:** W2, W8, W9 and W11 (mutants#3).

**Failure if one slips.** Two examples:

- **T9b:** a return is reviewed while its pool holds 500 ₳ and sent after another wallet took it.
  1. Nothing reads the balance again.
  2. The chain's deposit goes, and its first mix is refused.
  3. The session's chain stops cut short, instead of the review being made again.
- **T11b:** that refusal shows on the session's page in staking's words ("…staking changed since you reviewed…"), not in `lj.warn.rewardsMoved`'s.

**Fix, test first.** The public flow's tests (`lovejoin-reward-balance.test.ts:88–158`), done again for a session's return: `holding(t, WINDFALL)` before `backBuild`, then:

1. `backSubmit` and `claimSubmit` after `holding(t, 0n)` reject as `StaleReviewError`, with nothing sent.
2. The chain's first mix refused with `NOT_IN_REWARDS` stops the session in `REWARDS_MOVED()`.
3. A direct return's tail request names the 5 ₳ pool's balance.

### mutants#7 · low · The public Mix again and the paid ways back: their reward balance has no test

**File:** `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:5004`

**What's wrong.** These survive:

| Rule | Mutant | Where |
|---|---|---|
| `publicAgainBuild` reads the balance | T24 | `lovejoin.ts:5004` |
| `publicAgainBuild` keeps its balances for Send | T9g2 | `lovejoin.ts:5088` |
| `withdrawOne` paid by the account passes the rewards | T26b | `lovejoin.ts:7551` |
| `withdrawOne` paid privately passes the rewards | T26c | `lovejoin.ts:7574` |
| The rebuild after a refusal keeps who pays (`paid`) | T12d | `lovejoin.ts:7674` |
| Refused twice, it's said in Lovejoin's words | T12c | `lovejoin.ts:7675` |

Their wasm sides are W4, W6 and W7 (mutants#3). The publicBuild and unpaid withdraw versions of these rules are killed: T9g1, T26 and T26d.

**Evidence.** T24 and T9g2 survive the designed file and then the public files (36 files, 478 tests). T26b, T26c, T12d and T12c are balance-only or refusal-only: they survive their designed file, the one file that drives a way back with a balance.

**Failure if one slips.** Two examples:

- **T12d:** a box too poor to come back alone, paid from the public account, is refused once because its pool's balance moved. It's rebuilt as if the box paid: the box can't pay its way back, so the user's paid way back fails where it should have been rebuilt as paid.
- **T26b:** that paid way back withdraws 0 beside a windfall, and is refused twice.

**Fix, test first.** In the way back's describe (`lovejoin-reward-balance.test.ts:226–262`), the same three tests with `paid: true` and `paid: "private"`, the paid one with its rebuild after one refusal. Then `publicAgainBuild` with the public flow's two tests (:88–125).

### mutants#8 · low · The read's own rules: `account_info` failing, once a build, a Bootstrap, mainnet's header and a held step's take, with no test

**File:** `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4627`

**What's wrong.** These survive:

| Rule | Mutant | Where |
|---|---|---|
| An `account_info` that fails builds as before | T21 | `lovejoin.ts:4648` |
| It's marked `unread`, so a re-read that fails at Send doesn't count as a move | T22 | `lovejoin.ts:4653` |
| Each pool read once a build, stale rebuilds and four's fall to three included | T8a, T8b, T8c | `lovejoin.ts:4625`, `:4660` |
| A Bootstrap reads no balance | T18 | `lovejoin.ts:4853` |
| Mainnet's account header is `f1` | T8d | `lovejoin.ts:4627` |
| `holdOnly` keeps a held step's take | T14c | `lovejoin.ts:4742` |

**T8d in particular:** every test runs on preprod.

- The worker builds the account's bytes as a string (`"f1"`/`"f0"` + hash), beside WebAssembly's own derivation of the same account (`lovejoinMixLogic` returns its bech32).
- With `"f0"` on mainnet, `takingFrom` and `readsFor` match none of the wallet's withdrawals (`f1…`).
- So nothing it sent counts as on its way, and no balance is kept for Send. A moved balance is caught only by the network's refusal, after a chain's deposit went.

**Evidence.** These survive the designed file and then a sweep:

- **Every flow's files:** T21, T8a, T8b, T8c and T8d (75 or 76 files, 1,159 or 1,163 tests).
- **The public files:** T18 (36 files).
- **Balance-only:** T22 and T14c survive their designed file.

**Failure if one slips.** Two examples:

- **T8d:** as above, on mainnet only.
- **T21:** with Koios's `account_info` failing, every Lovejoin build fails, where it should build as before.

**Fix, test first.**

- Have `lovejoinMixLogic` return the account's bytes, which it derives already (`wasm/src/lovejoin.rs` `mix_logic`), and use them. Or add a mainnet case to the reward-balance test (`account` = `"f1"` + hash).
- Unit-test `readRewards`: with `account_info` failing, the build goes ahead (`unread`, as before); a session chain's stale rebuild asks `account_info` once; a Bootstrap asks none.

### mutants#9 · low · The dApp guard: token pools' `mix_logic`, asking nobody, and the worker's own wiring, with no test

**File:** `seedelf-platform/seedelf-web-wallet/extension/src/background/sw.ts:273`

**What's wrong.**

- **T13g:** sw.ts builds `DappService` without `lovejoin` (:273), and the mutant survives the dApp files and the two that touch sw.ts (16 files).
  - `DappDeps.lovejoin` is optional (`dapp.ts:294`), and the guard is `if (summary.paidScripts?.length && this.deps.lovejoin)` (`dapp.ts:2096`).
  - So a worker wired without it signs a payment into `mix_logic`'s account with every test passing.
  - The tests build the connector from `fakes.ts`, which passes `lovejoin` itself (:797).
- **T13d:** `mixLogicHashes` keeps only the classic pool's hash (`lovejoin.ts:4599–4602`). It survives because the dApp test names only the classic pool's `mix_logic`.
- **T13c:** `readSet(network, false)`, which asks discovery while a site waits for a signature, survives.
- W19 (mutants#4) is the same guard's WebAssembly side.

**Evidence.** T13g, T13c and T13d survive `dapp.test.ts` and the sweep over the dApp group (15 files) and sw.ts's (2).

**Failure if one slips.** Two examples:

- **T13g:** the guard is off in the shipped worker.
- **T13d:** a site's pool registration naming v2's 5 ₳ pool's `mix_logic` account is signed, and that pool's mixes and ways back stop until someone takes the deposit.

**Fix, test first.**

- Make `lovejoin` required in `DappDeps`, so `npm run typecheck` holds sw.ts to it.
- Give the dApp test's pool registration a second case naming the 5 ₳ pool's `mix_logic`, which `lovejoin-reward-balance.test.ts` derives from `ADA_POOL`.

### mutants#10 · low · Chunk 43's record names two tests that don't exist

**File:** `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-43-lovejoin-reward-balance.md:169`

**What's wrong.** Step 4 is marked done ("✅ every suite", :17), and its list names two tests that aren't there:

- **:169:** "WebAssembly (`wasm/tests/lovejoin_test.rs`, `lovejoin_across_test.rs`): a request's `rewards` reaches each pool's first mix and no other, the tail's in its own pool included".
  - `lovejoin_across_test.rs` gained only `rewards: Default::default()`, its three lines in #367's diff.
  - W2 and W11 survive.
- **:175:** "a chain refused while it's sent stops in Lovejoin's words, never staking's ([chain-resend.test.ts], through `pumpChain`)".
  - `chain-resend.test.ts` isn't in #367's diff.
  - The test that exists sends the public account's chain (`lovejoin-reward-balance.test.ts:141–158`, `publicSubmit`).
  - T11b, the session chain's words, survives.

**Evidence.** `git diff --stat 08fbb6f6 9103df62` lists no `chain-resend.test.ts`. Its `lovejoin_across_test.rs` hunk is three `rewards: Default::default()` lines.

**Failure.** The record reads as though those rules are held. A reviewer, or the next chunk, takes them as covered.

**Fix.** Either name what is tested and list the rest as *Not covered* (the record already has such a line, :122), or add the tests from mutants#3 and #6.

## Repros

Each repro was written into the worktree only and run by name. Each passed on `2a8060d3` and failed under its mutant. All were deleted before returning.

- `seedelf-core/tests/lovejoin_pools_test.rs`, `zz_r181_mutants_1_a_withdraw_that_cant_pay_back_takes_nothing` (mutants#1). Clean: ok. C5b and C5c: `assertion left == right failed, left: 0, right: 1` at its first balance check.
- `seedelf-core/tests/lovejoin_test.rs`, `zz_r181_mutants_3_mixing_again_takes_the_balance_from_the_callers_rewards` (mutants#2). Clean: ok. C26: `left: Rewards({[183, 7, 156, …]: 500000000}), right: Rewards({})`.
- `wasm/tests/cip30_test.rs`, `zz_r181_mutants_2_a_proposals_deposit_returned_to_a_script_is_named_alone` (mutants#4). Clean: ok. W19: `left: [], right: ["0606…06"]`.
- `extension/tests/zz-r181-mutants-1.test.ts` (mutants#5). Clean: 5 passed. T3a: 2 failed (T3a's and T3c's tests). T3c, T3d, T4c and T7d: 1 failed each, its own.

The Rust repros, as run:

```rust
// lovejoin_pools_test.rs
#[test]
fn zz_r181_mutants_1_a_withdraw_that_cant_pay_back_takes_nothing() {
    let sk = Scalar::from(777u64);
    let owner = Register::create(sk).unwrap();
    let pool = lj_pool();
    let boxes = vec![made_up_box(&pool, Some(&sk), 0x30)];
    let dear = ProtocolParameters { min_fee_b: pool.denom + 1_000_000, ..params() };
    let mut rewards = Rewards::of([(pool.mix_logic_hash, 1)]);
    let err = lovejoin::withdraw(&dear, &pool, &boxes, &sk, owner.clone().rerandomize().unwrap(), &mut rewards)
        .unwrap_err();
    assert!(err.downcast_ref::<lovejoin::CantPayBack>().is_some(), "{err}");
    assert_eq!(rewards.balance(&pool), 1);
    let err = lovejoin::withdraw_private(&dear, &pool, &boxes, &sk, owner.clone().rerandomize().unwrap(),
        &seedelf_payer(sk, 0xf2, 1_000_000), &mut rewards).unwrap_err();
    assert!(err.downcast_ref::<lovejoin::PrivateTooSmall>().is_some(), "{err}");
    assert_eq!(rewards.balance(&pool), 1);
    let back = lovejoin::withdraw_private(&dear, &pool, &boxes, &sk, owner.rerandomize().unwrap(),
        &seedelf_payer(sk, 0xf2, 20_000_000), &mut rewards).unwrap();
    assert_eq!(back.taken, 1);
    assert_eq!(rewards, Rewards::none());
}

// lovejoin_test.rs
#[test]
fn zz_r181_mutants_3_mixing_again_takes_the_balance_from_the_callers_rewards() {
    let protocol = Protocol::of(true).unwrap();
    let ours = our_boxes(Scalar::from(42u64), 1);
    let mut rewards = holding(&protocol, WINDFALL);
    let again = lovejoin::again(&params(), &protocol, &payer(20_000_000), &ours, 1,
        &all_pool_boxes(&protocol), &mut rewards).unwrap();
    assert_eq!(again.txs[0].taken, WINDFALL);
    assert_eq!(rewards, Rewards::none());
}

// cip30_test.rs
#[test]
fn zz_r181_mutants_2_a_proposals_deposit_returned_to_a_script_is_named_alone() {
    let (tx, rows) = proposing(vec![proposal(reward_bytes(0xf0, Hash::new([6; 28])), 100_000_000_000,
        conway::GovAction::Information)]);
    let summary = cip30::inspect_tx(&account(), &request(tx, rows, false)).unwrap();
    assert_eq!(summary.paid_scripts, vec![hex::encode([6; 28])]);
}
```

The TypeScript repro, as run:

```ts
const ACCOUNT = `f0${"ab".repeat(28)}`;
const COIN = `${"11".repeat(32)}#0`;
// A transaction spending COIN that withdraws `lovelace` from ACCOUNT, its fee `fee`.
const taking = (lovelace: number, fee = 0) =>
  `84a40081825820${"11".repeat(32)}00018002${fee.toString(16).padStart(2, "0")}05a1581d${ACCOUNT}1a${lovelace.toString(16).padStart(8, "0")}a0f5f6`;
const sent = (txCbor: string, n: number) => ({ txHash: n.toString(16).padStart(64, "0"), txCbor, sentAt: 0 });

expect(takingFrom([sent(taking(500_000_000), 1)], new Set([COIN]), [], ACCOUNT)).toBe(500_000_000n); // T3a
expect(takingFrom([sent(taking(500_000_000), 1)], new Set(), [], ACCOUNT)).toBe(0n);
expect(takingFrom([sent(taking(500_000_000, 1), 1), sent(taking(0, 2), 2)], new Set([COIN]), [], ACCOUNT)).toBe(500_000_000n); // T3c
expect(takingFrom([], new Set(), [{ inputs: [], collateral: [], takes: { [ACCOUNT]: "500000000" } }, { inputs: [], collateral: [] }], ACCOUNT)).toBe(500_000_000n); // T3d
expect(balanceAfter(503_000_000n, 500_000_000n)).toBe(0n); // T4c
// T7d: two accounts, one moved
expect(moved([read(ACCOUNT, "500000000"), read(OTHER, "0")], [read(ACCOUNT, "500000000"), read(OTHER, "3000000")])).toBe(true);
```

## Every mutant

A Rust survivor ran every target of its set: a core mutant core's nine targets and the wasm crate's ten, a wasm mutant the ten. *Balance-only: not swept* means its effect needs a balance in a `mix_logic` account, or a `WithdrawalsNotInRewards` refusal in a Lovejoin flow, and only its designed file makes either (*How it was run*).

### Rust

| id | mutant | file | verdict | killed by, or why it lives |
|---|---|---|---|---|
| C1 | mix_with: Rewards::taken skipped | `mod.rs` | killed | `a_mix_takes_the_reward_balance_whole_into_its_change` (seedelf-core lovejoin_test) |
| C2 | withdraw_with: Rewards::taken skipped | `mod.rs` | killed | `a_withdraw_takes_the_reward_balance_into_the_register` (seedelf-core lovejoin_test) |
| C3 | mix_with: Rewards::taken run twice | `mod.rs` | **survived** | equivalent (*Checked*) |
| C3w | withdraw_with: Rewards::taken run twice | `mod.rs` | **survived** | equivalent (*Checked*) |
| C4a | mix_with: taken right at the balance's read, before every later failure | `mod.rs` | killed | `a_build_that_fails_takes_nothing`; `a_reward_balance_past_what_a_u64_holds_is_refused_in_words` (seedelf-core lovejoin_test) |
| C4b | mix_with: taken after the sum, before the fee/collateral/eval failures | `mod.rs` | killed | `a_build_that_fails_takes_nothing` (seedelf-core lovejoin_test) |
| C5a | withdraw_with: taken right at the balance's read | `mod.rs` | killed | `a_reward_balance_past_what_a_u64_holds_is_refused_in_words` (seedelf-core lovejoin_test) |
| C5b | withdraw_with: taken after the sum, before CantPayBack/PrivateTooSmall/fee/eval failures | `mod.rs` | **survived** | survived every target of its set; the repro kills it; mutants#1 |
| C5c | withdraw_with: taken just before the CantPayBack/PrivateTooSmall check | `mod.rs` | **survived** | survived every target of its set; the repro kills it; mutants#1 |
| C6 | mix_with: the take into no output (the change without it) | `mod.rs` | killed | `a_mix_takes_the_reward_balance_whole_into_its_change` (seedelf-core lovejoin_test) |
| C7 | withdraw_with: the take into no output (the register without it) | `mod.rs` | killed | `a_withdraw_takes_the_reward_balance_into_the_register` (seedelf-core lovejoin_test) |
| C8 | withdraw_paid: the take into the wrong output (the payer's change, not the register) | `mod.rs` | killed | `a_token_pools_reward_balance_goes_to_the_change_or_the_register` (seedelf-core lovejoin_pools_test) |
| C9 | mix_with: the take into the wrong output (the first box, not the change) | `mod.rs` | killed | `a_mix_takes_the_reward_balance_whole_into_its_change` (seedelf-core lovejoin_test) |
| C10 | mix_with: checked_add made saturating | `mod.rs` | killed | `a_reward_balance_past_what_a_u64_holds_is_refused_in_words` (seedelf-core lovejoin_test) |
| C11 | mix_with: checked_add made wrapping | `mod.rs` | killed | `a_reward_balance_past_what_a_u64_holds_is_refused_in_words` (seedelf-core lovejoin_test) |
| C12 | withdraw_with: checked_add made saturating | `mod.rs` | killed | `a_reward_balance_past_what_a_u64_holds_is_refused_in_words` (seedelf-core lovejoin_test) |
| C13 | withdraw_with: checked_add made wrapping | `mod.rs` | killed | `a_reward_balance_past_what_a_u64_holds_is_refused_in_words` (seedelf-core lovejoin_test) |
| C14 | Rewards::balance ignoring the hash (any pool's balance) | `mod.rs` | killed | `a_mix_takes_only_its_own_pools_balance` (seedelf-core lovejoin_test) |
| C15 | WithdrawZero::patch writing 0 whatever it's given | `withdraw_zero.rs` | killed | `a_patch_withdraws_the_amount_it_is_given` (seedelf-core withdraw_zero_test) |
| C16 | Rewards::of keeping zeros | `mod.rs` | killed | `a_mix_takes_only_its_own_pools_balance` (seedelf-core lovejoin_test) |
| C17 | way_back taking a balance (500 ADA) | `box_value.rs` | killed | `a_pool_of_one_token_a_box_has_a_box_value`; `a_token_pools_box_value_is_proven` (seedelf-core lovejoin_box_value_test) |
| C17s | way_back taking a small balance (0.02 ADA, past the search's 10,000 step) | `box_value.rs` | killed | `a_pool_of_one_token_a_box_has_a_box_value`; `a_token_pools_box_value_is_proven` (seedelf-core lovejoin_box_value_test) |
| C18 | pool.rs measured (a pool's usable verdict) taking a balance (500 ADA) | `pool.rs` | killed | `a_box_already_there_is_asked_only_about_its_way_back`; `a_pool_isnt_usable_unregistered_too_small_or_unable_to_come_back`; `lovejoins_two_ada_pool_brings_a_box_back` (seedelf-core lovejoin_pools_test) |
| C19 | Rewards::taken taking every pool's balance | `mod.rs` | killed | `a_mix_takes_only_its_own_pools_balance` (seedelf-core lovejoin_test) |
| C20 | fan_out: ChainTx.taken always 0 | `mod.rs` | killed | `a_chains_first_mix_takes_the_balance_and_its_change_carries_it` (seedelf-core lovejoin_test) |
| C21 | mix_with: Mix.taken always 0 | `mod.rs` | killed | `a_mix_takes_the_reward_balance_whole_into_its_change` (seedelf-core lovejoin_test) |
| C22 | withdraw_with: Withdraw.taken always 0 | `mod.rs` | killed | `a_withdraw_takes_the_reward_balance_into_the_register` (seedelf-core lovejoin_test) |
| C23 | chain_across: each leg a copy of the Rewards (the caller's never taken) | `mod.rs` | killed | `a_chains_first_mix_takes_the_balance_and_its_change_carries_it` (seedelf-core lovejoin_test) |
| C24 | fan_out: each mix a copy of the Rewards | `mod.rs` | killed | `a_chains_first_mix_takes_the_balance_and_its_change_carries_it` (seedelf-core lovejoin_test) |
| C25 | collateral_tail: its mix a copy of the Rewards | `mod.rs` | killed | `a_sessions_collateral_mix_takes_only_what_its_chain_left` (seedelf-core lovejoin_test) |
| C26 | again_at: its fan_out a copy of the Rewards (the caller's never taken) | `mod.rs` | **survived** | survived every target of its set; the repro kills it; mutants#2 |
| W1 | chain_at: the request's rewards ignored | `lovejoin.rs` | killed | `a_chains_first_mix_in_each_pool_takes_its_balance_and_the_return_brings_it_back` (seedelf-wasm lovejoin_test) |
| W2 | chain_across_pools: the request's rewards ignored | `lovejoin.rs` | **survived** | survived every target of its set; mutants#3 |
| W3 | chain_from_account_at: the request's rewards ignored | `lovejoin.rs` | killed | `a_public_chain_leaves_the_balance_it_took_in_the_account` (seedelf-wasm lovejoin_test) |
| W4 | again_from_account_at: the request's rewards ignored | `lovejoin.rs` | **survived** | survived every target of its set; mutants#3 |
| W5 | withdraw_in: the request's rewards ignored | `lovejoin.rs` | killed | `a_box_comes_back_with_the_pools_balance_in_its_register` (seedelf-wasm lovejoin_test) |
| W6 | withdraw_paid_in: the request's rewards ignored | `lovejoin.rs` | **survived** | survived every target of its set; mutants#3 |
| W7 | withdraw_private_in: the request's rewards ignored | `lovejoin.rs` | **survived** | survived every target of its set; mutants#3 |
| W8 | collateral_mix (the collateral's mix built again): the request's rewards ignored | `lovejoin.rs` | **survived** | survived every target of its set; mutants#3 |
| W9 | session_return (a direct return's collateral tail): the request's rewards ignored | `lib.rs` | **survived** | survived every target of its set; mutants#3 |
| W10 | chain_at: the chain and its tail given separate copies | `lovejoin.rs` | killed | `a_tail_in_the_chains_own_pool_takes_nothing_once_the_chain_took_it` (seedelf-wasm lovejoin_test) |
| W11 | chain_across_pools: the chain and its tail given separate copies | `lovejoin.rs` | **survived** | survived every target of its set; mutants#3 |
| W12 | chain_from_account_at: one Rewards across tries (no copy a try) | `lovejoin.rs` | **survived** | equivalent (*Checked*) |
| W14 | mix_logic: the account's network flipped | `lovejoin.rs` | killed | `a_pools_mix_logic_and_its_reward_account_are_named` (seedelf-wasm lovejoin_test) |
| W15 | mix_logic: the wrong hash named (mix_box's) | `lovejoin.rs` | killed | `a_pools_mix_logic_and_its_reward_account_are_named` (seedelf-wasm lovejoin_test) |
| W15b | mix_logic: the account's bytes from the wrong hash (mix_box's) | `lovejoin.rs` | killed | `a_pools_mix_logic_and_its_reward_account_are_named` (seedelf-wasm lovejoin_test) |
| W16 | mix_logic: the pool ignored (the classic's) | `lovejoin.rs` | killed | `a_pools_mix_logic_and_its_reward_account_are_named` (seedelf-wasm lovejoin_test) |
| W17 | lovejoinMixLogic (the wasm_bindgen wrapper): the poolRef ignored | `lib.rs` | killed (from typescript) | no Rust test calls the wrapper; with the module rebuilt with it, 6 tests of `lovejoin-reward-balance.test.ts` fail (the first mix takes nothing, Send's re-read, the way back's take), and none with an unmutated module built the same way |
| W18 | cip30 paidScripts: a pool registration's reward account missing | `cip30.rs` | killed | `a_transaction_names_every_script_reward_account_it_pays_into` (seedelf-wasm cip30_test) |
| W19 | cip30 paidScripts: a proposal's deposit return missing | `cip30.rs` | **survived** | survived every target of its set; the repro kills it; mutants#4 |
| W20 | cip30 paidScripts: a treasury withdrawal's recipient missing | `cip30.rs` | killed | `a_transaction_names_every_script_reward_account_it_pays_into` (seedelf-wasm cip30_test) |
| W21 | cip30 paidScripts: not sorted or deduplicated | `cip30.rs` | killed | `a_transaction_names_every_script_reward_account_it_pays_into` (seedelf-wasm cip30_test) |

### TypeScript

| id | mutant | file | verdict | killed by, or why it lives |
|---|---|---|---|---|
| T1a | readBalance: past all the ADA made at-or-past (>=) | `lovejoin-rewards.ts` | **survived** | equivalent in practice (*Checked*) |
| T1b | readBalance: the string check dropped (a number read) | `lovejoin-rewards.ts` | killed | lovejoin-reward-balance.test.ts › reads a balance that's no whole number, or past all the ADA there is, as none |
| T1c | readBalance: the 20-digit bound dropped | `lovejoin-rewards.ts` | **survived** | equivalent (*Checked*) |
| T1d | readBalance: the ^ anchor dropped | `lovejoin-rewards.ts` | killed | lovejoin-reward-balance.test.ts › reads a balance that's no whole number, or past all the ADA there is, as none |
| T1e | readBalance: all the ADA ten times too much | `lovejoin-rewards.ts` | killed | lovejoin-reward-balance.test.ts › reads a balance that's no whole number, or past all the ADA there is, as none |
| T2a | takesOf: the last withdrawal, not the most | `lovejoin-rewards.ts` | killed | lovejoin-reward-balance.test.ts › counts what its chain being sent takes as taken: a build meanwhile in the pool takes none; lovejoin-reward-balance.test.ts › is a review to make again when the balance moved before Send, with nothing sent; lovejoin-reward-balance.test.ts › keeps what each chain takes of a pool's balance, by the account, as the reads leave it out (+2 more) |
| T2b | takesOf: an unreadable transaction throws instead of taking nothing | `lovejoin-rewards.ts` | **survived** | equivalent (*Checked*) |
| T3a | takingFrom: what the wallet sent (goingOut) not counted | `lovejoin-rewards.ts` | **survived** | balance-only: not swept; the repro kills it; mutants#5 |
| T3b | takingFrom: a chain being sent (its reservation's takes) not counted | `lovejoin-rewards.ts` | killed | lovejoin-reward-balance.test.ts › keeps what each chain takes of a pool's balance, by the account, as the reads leave it out |
| T3c | takingFrom: goingOut without either (two spending one coin left out) | `lovejoin-rewards.ts` | **survived** | balance-only: not swept; the repro kills it; mutants#5 |
| T3d | takingFrom: the last reservation, not the most | `lovejoin-rewards.ts` | **survived** | balance-only: not swept; the repro kills it; mutants#5 |
| T4a | balanceAfter: >= made > | `lovejoin-rewards.ts` | killed | lovejoin-reward-balance.test.ts › counts what its chain being sent takes as taken: a build meanwhile in the pool takes none; lovejoin-reward-balance.test.ts › takes none while the wallet's own transaction on its way takes it, what's read otherwise |
| T4b | balanceAfter: taking > 0 dropped | `lovejoin-rewards.ts` | killed | lovejoin-reward-balance.test.ts › brings it back in the box's register; lovejoin-reward-balance.test.ts › counts what its chain being sent takes as taken: a build meanwhile in the pool takes none; lovejoin-reward-balance.test.ts › is a review to make again when the balance moved before Send, with nothing sent (+4 more) |
| T4c | balanceAfter: what's read past the take kept (read - taking), not none | `lovejoin-rewards.ts` | **survived** | balance-only: not swept; the repro kills it; mutants#5 |
| T4d | balanceAfter: the take ignored | `lovejoin-rewards.ts` | killed | lovejoin-reward-balance.test.ts › counts what its chain being sent takes as taken: a build meanwhile in the pool takes none; lovejoin-reward-balance.test.ts › takes none while the wallet's own transaction on its way takes it, what's read otherwise |
| T5a | rewardsField: zeros kept | `lovejoin-rewards.ts` | killed | lovejoin-reward-balance.test.ts › names a request's balances only where there's one, and calls an unread one no move |
| T5b | rewardsField: keyed by the account bytes, not the hash | `lovejoin-rewards.ts` | killed | lovejoin-reward-balance.test.ts › brings it back in the box's register; lovejoin-reward-balance.test.ts › counts what its chain being sent takes as taken: a build meanwhile in the pool takes none; lovejoin-reward-balance.test.ts › is a review to make again when the balance moved before Send, with nothing sent (+6 more) |
| T5c | rewardsField: an empty rewards field where none holds anything | `lovejoin-rewards.ts` | killed | lovejoin-reward-balance.test.ts › names a request's balances only where there's one, and calls an unread one no move |
| T6a | readsFor: every read, named or not | `lovejoin-rewards.ts` | killed | lovejoin-reward-balance.test.ts › keeps what each chain takes of a pool's balance, by the account, as the reads leave it out |
| T6b | readsFor: the read's lovelace kept, not what the chain withdraws | `lovejoin-rewards.ts` | **survived** | equivalent (*Checked*) |
| T7a | moved: an unread re-read counts as a move | `lovejoin-rewards.ts` | killed | lovejoin-reward-balance.test.ts › names a request's balances only where there's one, and calls an unread one no move |
| T7b | moved: only a rise counts | `lovejoin-rewards.ts` | killed | lovejoin-reward-balance.test.ts › is a review to make again when the balance moved before Send, with nothing sent; lovejoin-reward-balance.test.ts › names a request's balances only where there's one, and calls an unread one no move |
| T7c | moved: only a fall counts | `lovejoin-rewards.ts` | killed | lovejoin-reward-balance.test.ts › is a review to make again when the balance moved before Send, with nothing sent; lovejoin-reward-balance.test.ts › names a request's balances only where there's one, and calls an unread one no move |
| T7d | moved: every account must move (some -> every) | `lovejoin-rewards.ts` | **survived** | balance-only: not swept; the repro kills it; mutants#5 |
| T8a | rewardsIn: known reads ignored (a pool read again each try) | `lovejoin.ts` | **survived** | survived the sweep (public+session+withdraw+tail+rules, 75 files); mutants#8 |
| T8b | rewardsOf: the build's earlier reads not passed (read again each try) | `lovejoin.ts` | **survived** | survived the sweep (public+session+withdraw+tail+rules, 75 files); mutants#8 |
| T8c | rewardsIn: one pool named twice read twice (no dedupe) | `lovejoin.ts` | **survived** | survived the sweep (public+session+withdraw+tail+rules, 75 files); mutants#8 |
| T8d | rewardsIn: mainnet's account header f0 (testnet's) | `lovejoin.ts` | **survived** | survived the sweep (public+session+withdraw+tail+rules, 76 files); mutants#8 |
| T9a | publicSubmit: no re-read at Send | `lovejoin.ts` | killed | lovejoin-reward-balance.test.ts › is a review to make again when the balance moved before Send, with nothing sent |
| T9f1 | a session chain (chain_in): balances not kept for Send | `lovejoin.ts` | **survived** | survived the sweep (session+tail, 29 files); mutants#6 |
| T9f2 | a session chain across pools: balances not kept for Send | `lovejoin.ts` | **survived** | survived the sweep (session+tail, 29 files); mutants#6 |
| T9g1 | publicBuild: balances not kept for Send | `lovejoin.ts` | killed | lovejoin-reward-balance.test.ts › is a review to make again when the balance moved before Send, with nothing sent; lovejoin-reward-balance.test.ts › takes it in its first mix alone, reads it once, and the change that stays in the account carries it |
| T9g2 | publicAgainBuild: balances not kept for Send | `lovejoin.ts` | **survived** | survived the sweep (public, 36 files); mutants#7 |
| T11a | a public chain refused: staking's words, not Lovejoin's | `lovejoin.ts` | killed | lovejoin-reward-balance.test.ts › stops in Lovejoin's words, never staking's |
| T12a | withdrawOne: no rebuild when the balance moved | `lovejoin.ts` | killed | lovejoin-reward-balance.test.ts › is built again once, at once, when the network says the balance moved, and sent; lovejoin-reward-balance.test.ts › refused again, sends nothing more and gives its due time back for a later run |
| T12b | withdrawOne: rebuilt with no again (rebuilt while refused) | `lovejoin.ts` | killed | lovejoin-reward-balance.test.ts › refused again, sends nothing more and gives its due time back for a later run |
| T12c | withdrawOne: refused again, staking's words | `lovejoin.ts` | **survived** | balance-only: not swept; mutants#7 |
| T12d | withdrawOne: the rebuild forgets who pays (paid) | `lovejoin.ts` | **survived** | balance-only: not swept; mutants#7 |
| T13c | mixLogicHashes: asks discovery (not quiet) | `lovejoin.ts` | **survived** | survived the sweep (dapp, 14 files); mutants#9 |
| T13d | mixLogicHashes: the classic pool's alone (no token pool's) | `lovejoin.ts` | **survived** | survived the sweep (dapp, 14 files); mutants#9 |
| T14c | holdOnly: a maybe-sent step's take not held | `lovejoin.ts` | **survived** | balance-only: not swept; mutants#8 |
| T17 | the collateral's mix built again: rewards not passed | `lovejoin.ts` | **survived** | balance-only: not swept; mutants#6 |
| T17b | the collateral's mix built again: balances not kept | `lovejoin.ts` | **survived** | survived the sweep (tail+session, 29 files); mutants#6 |
| T18 | publicBuild: a Bootstrap reads the balance too | `lovejoin.ts` | **survived** | survived the sweep (public, 36 files); mutants#8 |
| T20 | readRewards: chains kept for Send count as taking | `lovejoin.ts` | killed | lovejoin-reward-balance.test.ts › counts what its chain being sent takes as taken: a build meanwhile in the pool takes none; lovejoin-reward-balance.test.ts › stops in Lovejoin's words, never staking's |
| T21 | readRewards: an account_info that fails fails the build (not built as before) | `lovejoin.ts` | **survived** | survived the sweep (public+session+withdraw+tail+rules, 76 files); mutants#8 |
| T22 | readRewards: never marked unread | `lovejoin.ts` | **survived** | balance-only: not swept; mutants#8 |
| T24 | publicAgainBuild: the balance never read | `lovejoin.ts` | **survived** | survived the sweep (public, 36 files); mutants#7 |
| T25 | a session chain (chain_in): rewards not passed | `lovejoin.ts` | **survived** | survived the sweep (session+tail, 29 files); mutants#6 |
| T25b | a session chain across pools: rewards not passed | `lovejoin.ts` | **survived** | survived the sweep (session+tail, 29 files); mutants#6 |
| T26 | withdrawOne: the balance never read | `lovejoin.ts` | killed | lovejoin-reward-balance.test.ts › brings it back in the box's register; lovejoin-reward-balance.test.ts › is built again once, at once, when the network says the balance moved, and sent |
| T26b | withdrawOne paid by the account: rewards not passed | `lovejoin.ts` | **survived** | balance-only: not swept; mutants#7 |
| T26c | withdrawOne paid privately: rewards not passed | `lovejoin.ts` | **survived** | balance-only: not swept; mutants#7 |
| T26d | withdrawOne paying from the box: rewards not passed | `lovejoin.ts` | killed | lovejoin-reward-balance.test.ts › brings it back in the box's register; lovejoin-reward-balance.test.ts › is built again once, at once, when the network says the balance moved, and sent |
| T9b | backSubmit: no re-read at Send | `sessions.ts` | **survived** | survived the sweep (session, 22 files); mutants#6 |
| T9c | claimSubmit: no re-read at Send | `sessions.ts` | **survived** | survived the sweep (session, 22 files); mutants#6 |
| T9d1 | a return's chain (the tail's resumption): balances not kept | `sessions.ts` | **survived** | survived the sweep (session+tail, 29 files); mutants#6 |
| T9d2 | a return's chain: balances not kept | `sessions.ts` | **survived** | survived the sweep (session+tail, 29 files); mutants#6 |
| T9e | a direct return's collateral tail: balances not kept | `sessions.ts` | **survived** | survived the sweep (session+tail, 29 files); mutants#6 |
| T11b | a session chain refused: staking's words, not Lovejoin's | `sessions.ts` | **survived** | balance-only: not swept; mutants#6 |
| T19 | a direct return's collateral tail: rewards not passed | `sessions.ts` | **survived** | balance-only: not swept; mutants#6 |
| T13a | dApp: the mix_logic refusal removed | `dapp.ts` | killed | dapp.test.ts › won't sign a site's transaction that pays into a Lovejoin pool's reward account (chunk 43) |
| T13b | dApp: refuses every other script instead | `dapp.ts` | killed | dapp.test.ts › won't sign a site's transaction that pays into a Lovejoin pool's reward account (chunk 43) |
| T13e | dApp: the pools of the wrong network | `dapp.ts` | killed | dapp.test.ts › won't sign a site's transaction that pays into a Lovejoin pool's reward account (chunk 43) |
| T10a | submit: no RewardsChangedError | `koios.ts` | killed | koios.test.ts › explains the ledger's staking refusals; lovejoin-reward-balance.test.ts › is built again once, at once, when the network says the balance moved, and sent; lovejoin-reward-balance.test.ts › refused again, sends nothing more and gives its due time back for a later run (+1 more) |
| T10b | submit: every staking refusal a RewardsChangedError | `koios.ts` | killed | koios.test.ts › explains the ledger's staking refusals |
| T14a | reservationOf: the last withdrawal, not the most | `spent.ts` | killed | lovejoin-reward-balance.test.ts › keeps what each chain takes of a pool's balance, by the account, as the reads leave it out |
| T14b | reservationOf: no takes | `spent.ts` | killed | lovejoin-reward-balance.test.ts › keeps what each chain takes of a pool's balance, by the account, as the reads leave it out |
| T13g | sw.ts: the dApp connector not given Lovejoin (its refusal off in the worker) | `sw.ts` | **survived** | survived the sweep (dapp+sw, 16 files); mutants#9 |

## Checked, held

These held: each rule's mutant was killed, or the mutant is equivalent for the reason given.

**Core**

- **The hand-over:** `Rewards::taken` skipped in a mix or a withdraw (C1, C2), taking every pool's (C19), and a copy for each mix (C24), each leg (C23) and the collateral's tail (C25) are all killed by `lovejoin_test`'s reward tests.
- **A failed mix takes nothing:** the take moved to the read or to just after the sum (C4a, C4b) is killed by `a_build_that_fails_takes_nothing` and the u64 test. A withdraw's take at the read (C5a) is killed by the u64 test.
- **Where the take goes:** the user's own output and nowhere else. The change or the register without it (C6, C7), the payer's change instead of the register (C8, `lovejoin_pools_test`) and the first box instead of the change (C9) are all killed.
- **The sums are checked:** `checked_add` made saturating or wrapping, in a mix and in a withdraw (C10–C13), is killed by `a_reward_balance_past_what_a_u64_holds_is_refused_in_words`.
- **The balance's rules:**
  - `balance()` reads by hash (C14), and `Rewards::of` drops zeros (C16): both killed by `a_mix_takes_only_its_own_pools_balance`.
  - `WithdrawZero` writes the amount it's given (C15): killed by `withdraw_zero_test`'s `a_patch_withdraws_the_amount_it_is_given`.
- **The probes stay at 0** whatever the account holds: `way_back` with 500 ₳ (C17) and with 0.02 ₳ (C17s), past its search's 10,000-lovelace step, is killed by `lovejoin_box_value_test`. `usable` (C18) is killed by `lovejoin_pools_test`.
- **The `taken` fields** of `Mix`, `Withdraw` and `ChainTx` (C20–C22) are killed.
- **Equivalent, C3 and C3w:** `Rewards::taken` run twice is `BTreeMap::remove` twice, which is idempotent.

**WebAssembly**

- **The request's `rewards` are read** by `chain_at` (W1), `chain_from_account_at` (W3) and `withdraw_in` (W5), and `chain_at`'s chain and tail share one `Rewards` (W10): all killed by the wasm crate's `lovejoin_test` reward tests.
- **`mix_logic`'s view:** its network (W14), the hash it names (W15), the account built from the right hash (W15b) and the pool it's given (W16) are killed by `a_pools_mix_logic_and_its_reward_account_are_named`.
- **`lovejoinMixLogic`'s `poolRef`** (W17) is held only from TypeScript, as no Rust test calls a `#[wasm_bindgen]` function. With the module rebuilt with W17, six `lovejoin-reward-balance.test.ts` tests fail; with an unmutated module built the same way, both files pass (59 tests).
- **`paidScripts`:** the pool registration's source (W18), the treasury recipient's (W20), and the list sorted and deduplicated (W21) are killed by `a_transaction_names_every_script_reward_account_it_pays_into`.
- **Equivalent, W12:** one `Rewards` across `chain_from_account_at`'s tries. It tries again only on `build::is_short`, which in Lovejoin is `DEPOSIT_SHORT`, raised by `deposit_across` before any mix is built, so no try that fails has taken anything.

**TypeScript**

- **`readBalance`:** the string check (T1b), the `^` anchor (T1d) and `ALL_ADA`'s size (T1e) are killed.
  - **Equivalent, T1c:** the 20-digit bound dropped. Any figure of 21 digits or more is past `ALL_ADA` and reads as 0 either way.
  - **Equivalent in practice, T1a:** `>` made `>=`. It differs only at exactly 45,000,000,000 ₳, all the ADA there is, which no reward account can hold.
- **The other rules** are killed by `lovejoin-reward-balance.test.ts`: `takesOf`'s most (T2a), `takingFrom`'s chain-being-sent source (T3b), `balanceAfter`'s rule (T4a, T4b, T4d), `rewardsField` (T5a–T5c), `readsFor`'s filter (T6a), and `moved`'s unread rule and direction (T7a–T7c).
  - **Equivalent, T2b:** the worker's sent list holds only the wallet's own transactions, all of which `txWithdrawals` reads. A site's go to `rememberSiteSpent`, apart (`spent.ts`). `readsFor` reads only WebAssembly's own.
  - **Equivalent, T6b:** each build passes a read's figure, and its first transaction in that pool takes exactly that, so the most a chain withdraws from an account it names is the read itself.
- **The public flow and the unpaid way back,** all killed:
  - `publicSubmit`'s re-read and `publicBuild`'s balances (T9a, T9g1).
  - The public chain's words (T11a).
  - `withdrawOne`'s one rebuild and its `again` (T12a, T12b), its read (T26) and its box-paid request (T26d).
  - Chains kept for Send don't count as taking (T20).
- **The dApp refusal,** its match and its network (T13a, T13b, T13e), are killed by `dapp.test.ts`.
- **`RewardsChangedError`'s match,** both ways (T10a, T10b), is killed by `koios.test.ts`.
- **`reservationOf`'s `takes`** (T14a, T14b) are killed.

**The run itself**

- Every repro passes on `2a8060d3` and fails under its mutant, and all were deleted.
- The worktree is left clean (`git status --porcelain` prints nothing), and `wasm/pkg` is restored with its four checksums matching.
- Nothing ran against the network, seedelf-data, Lean, e2e or the main tree's build.
