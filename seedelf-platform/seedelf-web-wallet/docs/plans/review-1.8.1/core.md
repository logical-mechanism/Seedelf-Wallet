# 1.8.1 review · core: #367's builders in seedelf-core

Lens: `seedelf-core/src/lovejoin/{mod.rs, box_value.rs, pool.rs}`, `src/withdraw_zero.rs` and the tests #367 changed, as merged (`9103df62`; core is unchanged since, at `2a8060d3`).

**Verdict: no high or medium defect.** Every builder that runs `mix_logic` balances with a take, puts it in the user's own output, settles its fee on the transaction as sent, and takes nothing when it fails. A repro proved this on Lovejoin v2's scripts, the one set the wallet mixes in now. Found: one test gap (low) and two nits.

## Findings

### core#1 · low · test-coverage: no core test runs a take on Set::V2, and few check a take's fee against the ledger's

`seedelf-core/tests/lovejoin_pools_test.rs:1283` (and `lovejoin_test.rs:1087`, `:1219`, `:1241`, `:1275`; `lovejoin_planner_test.rs:880`; `lovejoin_mainnet_test.rs:373`)

- **What's wrong.** #367's take tests use three sets of scripts: the classic pool (preprod's and mainnet's bundled scripts), and Set::V1, through `lj_pool`, `lj_pool_by_reference` and its `poor` variant. None uses Set::V2.
  - Every version but V2 is retired (`Version::retired`), so a v2 pool is the only place the wallet still mixes. 1.8.1's head start adds mainnet's v2 5 ₳ pool.
  - The WebAssembly tests' `five()` is V1 too: `templates::derive` is `derive_in(Set::V1, …)`.
  - V2 is covered only by the extension's `lovejoin-reward-balance.test.ts`, through the real WebAssembly, for two kinds: a public chain's mix under its own collateral, and a box's withdraw paid by the box.
- **Not run with a take anywhere, on any set:**
  - `mix_giveme` on V2 (a session's collateral tail);
  - `withdraw_paid` and `withdraw_private` on V2;
  - `mix_giveme` on mainnet.
- **The fee is checked against an independent ledger minimum only for mainnet's classic pool,** a mix under its own collateral and a withdraw paid by the box (`lovejoin_mainnet_test.rs:373`). The rest compare the fee to the next mix's (`abs_diff < 2_000`) or don't check it.
- **No chain test checks each transaction's balance.** `a_chains_first_mix_takes_the_balance_and_its_change_carries_it` and `a_chain_across_pools_takes_each_pools_balance_in_its_first_mix` check `Chain::change`, which core works out apart from the outputs. The wallet's evaluator runs phase 2 only, so it never checks value conservation.
- **Evidence (repro, run by its own target and deleted).** `CORE/tests/zz_r181_core_1.rs` built v2 pools from the WebAssembly crate's fixtures (`lovejoin-v2-ada-pool-preprod.json`, 5 ₳ boxes; `lovejoin-v2-token-pool-preprod.json`, 2 ₳ and LJTEST) and verified them as v2. Takes were 24 lovelace (one CBOR byte more than 0), 500 ₳, and 5,000 ₳ (past 2³², nine bytes).
  - **Every kind passed the scripts:** `mix`, `mix_giveme`, `withdraw`, `withdraw_paid`, `withdraw_private`.
  - **Each balanced:** inputs resolved from their outputs, plus the withdrawal, equal the outputs plus the fee, and tokens in equal tokens out.
  - **Each landed in the user's output:**
    - a mix's change output and `Mix::change` both hold `20 ₳ + take − fee`, and every box is exactly the box value;
    - giveme.my's collateral return is `5 ₳ − 3/2·fee`, the payer's own is `c − (3/2·fee + 1)`;
    - a withdraw's register is `denom + take − fee` (boxes paying), `≥ denom + take` (account paying, its change apart), or `denom + UTxO + take − fee` (private paying).
  - **Each fee is the ledger's minimum to 2 lovelace,** priced from size, summed budgets and reference scripts, worked out apart from the builder. For example, a v2 ADA mix at 500 ₳: fee 832,016, minimum 832,015. A v2 token withdraw at 5,000 ₳: 298,056 against 298,055.
  - **The script data hash matched,** recomputed from the redeemers' bytes as the transaction carries them and V3's language view, with one Reward redeemer, at index 0.
  - **Every chain transaction balanced** from the outputs before it: the classic pool and v2's ADA pool two waves deep, and `chain_across` v2 token then v2 ADA, its takes `[0, 5e9, 0, 0, 0, 3e6, 0, 0, 0]`.
- **What it risks.** Nothing, today. The scripts ignore the amount: read at `29573c5`, `8131b1d` and `cb5a5a3`, and #368's proofs say so for v2's `mix_box`. Fee settlement is one code path for every set. But a change to how a v2 pool's references are priced, or to the giveme or private paths, could break a take on the live set with no test failing.
- **Fix, test first.** Add the repro's three tests to the suite, for example a v2 section in `lovejoin_pools_test.rs` that reads the WebAssembly fixtures as `lovejoin_width_test.rs`'s `token_v2_protocol` does:
  - `v2_mixes_take_the_balance_and_pay_the_ledgers_fee`;
  - `v2_withdraws_take_the_balance_into_the_register`;
  - `every_chain_transaction_balances_with_a_take`.

  A copy is at `SCRATCH/review/core/zz_r181_core_1.rs`. No code change.

### core#2 · nit: `Rewards::of` with one hash twice keeps the last non-zero, so a later 0 never clears an earlier balance

`seedelf-core/src/lovejoin/mod.rs:599-601`

- **What's wrong.** `Rewards(balances.into_iter().filter(|(_, l)| *l > 0).collect())` filters before it collects. The doc ("Each pool's balance, by its mix_logic hash") doesn't say what one hash given twice means.
- **Evidence (repro):**
  - `[(h,5),(h,7)]` → 7, and `[(h,7),(h,5)]` → 5: the last wins;
  - `[(h,5),(h,0)]` → 5: the later 0 is dropped before it can override;
  - `[(h,0),(h,5)]` → 5.
- **Failure: none reachable today.** The worker names each pool once, by `lovejoinMixLogic`'s lowercase hex. `RewardsIn` is a `BTreeMap<String, String>`, and `hex::decode` takes upper case, so `{"AB…":"5","ab…":"0"}` names one hash twice: the result is 5, a withdrawal the ledger refuses at no cost.
- **Fix.** Say "the last non-zero wins" in the doc, or make the last entry win either way: collect, then `retain(|_, l| *l > 0)`. Test first: the repro's `rewards_of_one_hash_twice`.

### core#3 · nit: two docs leave out what joins the register besides the boxes and the take

`seedelf-core/src/lovejoin/mod.rs:1226-1228` (`Withdraw::lovelace`, added by #367) and `:1308-1311` (`withdraw_paid`)

- **What's wrong.**
  - `Withdraw::lovelace` says "the boxes' ADA and what was taken …, less the fee where the boxes pay it". For `withdraw_private` the register also holds the private UTxO's ADA, less the fee; for `withdraw_paid`, the account's top-up.
  - `withdraw_paid`'s doc still says the account makes up the rest "if their ADA is less than the Seedelf output needs". Since #367 the balance counts toward that minimum: the code's own comment at `:1492-1493`, and the plan.
- **Failure.** A reader of the docs alone would take a private withdraw's `lovelace` to be the box and the take, less the fee. WebAssembly's `WithdrawPrivateResult::lovelace` doc is right.
- **Fix.** One clause each, for example:
  - "…the boxes' ADA, a private payer's UTxO or an account's top-up, and what was taken…";
  - "…if their ADA and the balance taken are less…".

## Checked, and held

- **The ledger's balance, every branch** (repro, v2, and #367's tests on classic and V1): `mix` (own collateral), `mix_giveme`, `withdraw` (boxes), `withdraw_paid` (account, the top-up when the take is short), and `withdraw_private` all satisfy inputs + withdrawal = outputs + fee. No certificate, so no deposit.
- **A token pool's token stays in the boxes or the register,** never in a mix's change, which is ADA alone.
- **Where N lands:** always the user's own output. A mix's change, at `payer.address`: the session's or public account's, or `collateral_mix`'s `address`. A withdraw's fresh register. Never giveme.my's collateral return (`collateral_output(…, fee)` reads only the fee), never a box (each is exactly the box value; `mix_logic` holds outputs 0..N−1 to it), never a stranger's output.
- **The fee is settled on the transaction as sent.**
  - `mix_with` builds its `WithdrawZero` once, with `taken`, and every draft goes through `stage`. So the draft whose budgets are measured, every priced draft, and the final, re-measured transaction all carry the real amount.
  - `withdraw_with` writes `taken` in every `stage`, and each round proves and measures the transaction it would send (`declared.covers`).
  - Neither script reads the withdrawals, nor does any cost they pay depend on it: `mix_box` only `pairs.has_key`, and `mix_logic`'s `walk_outputs` reads the change's address, never its coin.
  - The change's and the register's own encoding widths are measured too.
  - At 5,000 ₳ the fee still meets the minimum, and the loop settles across the 2³² width boundary.
- **The script data hash** covers the redeemers and the language view, not withdrawals, and matches when recomputed from the bytes as sent. The Reward redeemer is the only one, at index 0, as one withdrawal needs.
- **Minimums.**
  - A mix's change is checked against an ADA-only least, and only ever grows with a take.
  - A withdraw's register is held to `minimum(lovelace)` of the output as built, its token included, so a token output's minimum growing with its encoded size is counted.
  - An account's change is held to its least after `fee + topped`; a take only shrinks `topped`.
- **Refusals with a take.** CantPayBack, PrivateTooSmall and "There isn't enough ADA left…" read the real figures, so a take passes exactly what the ledger would take. No take refuses a build the ledger would take, but for a 24 to 43 lovelace take: its one extra byte costs 44, so the register comes back 1 to 20 lovelace under none's (repro: take 24, register 4,704,958 against 4,704,978). The ledger takes no other amount, so this is right.
- **Overflow.** Every sum a take joins is checked: `paying`, `coming`, `coming + private UTxO`. The subtractions after a successful `stage` (`paying − fee`, `p.fee − fee − topped`) can't wrap. A chain's change carried on is `checked_add`ed with 0, or with the next leg's take. The session return's sweep sums with `checked_add` (`utxos::assets_of`). No WebAssembly code reads or sums `Mix::taken`, `Withdraw::taken` or `ChainTx::taken`. The worker caps a read at all the ADA there is (`readBalance`), far under what a u64 sum of a few needs.
- **The first built takes, every one after takes 0.**
  - `taken()` is the last statement before `Ok` in both `mix_with` and `withdraw_with`: no `?` after it, and nothing in the loops before it.
  - `fan_out` hands one `Rewards` to every mix, in the order built, and that is the order sent: each spends the one before's change.
  - In `chain_across`, legs go in order. The same pool twice takes once, and a seed (depth 0) takes nothing.
  - `collateral_tail` takes 0 after a chain in its pool, and the pool's balance when alone.
- **A build that fails takes nothing.** The withdraw and mix loops read the balance once and hand it on only on success. `PoolShort` is raised in `fresh_for`, before any mix of a chain or `again`. `check_width` and the deposit come first too.
- **Retries.** No core function builds a chain or mix twice with one `Rewards`; `least_box_lovelace`'s loop gives each `way_back` its own `none()`. In WebAssembly:
  - `chain_from_account_at` passes `&mut rewards.clone()` each try;
  - `withdraw_private_in` loops over UTxOs, but a failed build takes nothing;
  - every other entry point builds once from a fresh `RewardsIn::read()`, including the worker's stale and four-to-three rebuilds, which are separate calls.
- **`Rewards::of` with zeros** drops them (`of([(h,0)]) == none()`, #367's test). With one hash twice, see core#2.
- **`way_back` and `usable` / `comes_back` on `Rewards::none()`.**
  - The launch check, the box-value search and the pool verdict ignore a windfall, as the plan has it. Only the conservative way: a take only adds, apart from the 20-lovelace corner above.
  - The worker reads only `why`, `has` and `needs` from `lovejoinUsable`. No review shows `back` or `withdraw_fee`, so no review disagrees with what's sent.
  - A consequence nobody wrote down, not a defect: a pool judged stuck at none stays stuck with a windfall in its account, so Bring one back still goes through the account or a private UTxO, which ties the box to the payer, though the box plus the take could come back alone. That needs a stuck pool and a windfall at once, and matches "everything just continues on as normal".
- **The scripts and the amount** (Lovejoin, read through git only):
  - `mix_box` at `cb5a5a3`, `8131b1d` and `29573c5` asks only `pairs.has_key(self.withdrawals, Script(mix_logic))`.
  - `mix_logic`'s withdraw handler never reads withdrawals, and its publish handler accepts only `RegisterCredential`, so no DRep delegation is possible. Conway's not-delegated-to-a-DRep rule applies only to key-hash credentials.
  - #368's AnyTx README: "The withdrawal amount and all unrelated transaction fields are arbitrary."
- **`WithdrawZero::patch`** writes `(account, lovelace)` and nothing else, keeps refusing a signed transaction, a second account, witness datums and map-form redeemers, and recomputes the body hash (`withdraw_zero_test.rs`).
- **Named targets pass on this tree:**
  - `lovejoin_test` (30), `lovejoin_pools_test` (37), `lovejoin_planner_test` (13), `lovejoin_mainnet_test` (8), `withdraw_zero_test` (6);
  - `lovejoin_width_test` (4, its live test ignored), `lovejoin_box_value_test` (2), `lovejoin_launch_test` (8).

## How

- **Read:** the merged diff (`git diff 08fbb6f6 9103df62 -- seedelf-platform/seedelf-core`), the files whole, WebAssembly's callers of every builder, and the worker's `lovejoin-rewards.ts` and `withdrawOne`, for the callers' side of the contract.
- **Repro:** one, `CORE/tests/zz_r181_core_1.rs`, run only as `cargo test -p seedelf-core --test zz_r181_core_1`, then deleted. A copy is at `SCRATCH/review/core/zz_r181_core_1.rs`, with its logs beside it.
- **Not run:** no network, no `--ignored`, nothing in seedelf-data or seedelf-verification.
