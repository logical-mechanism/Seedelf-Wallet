# Lovejoin's mix width: why three, and what four needs

Every Lovejoin mix the wallet makes takes three boxes (N = 3) by default: a session's return, a mix from either side, Mix my boxes again. Four is an option (below). A session's collateral's mix always takes three. The one-time account or the public account pays every mix, so there's no fee shard and the contract's floor is N ≥ 2. Three wasn't a guess. This page holds the measurements behind it, what N = 4 costs, and why four is an option and not the default. Measured on 2026-10-16.

## The answer

- **Four fits today, by about 1%.** A four-box mix uses 98.8–98.9% of the 10 billion CPU steps a transaction may use, leaving 111 to 118 million. Three uses 58%. Five never fits: it needs 15 billion.
- **The token pools fit the same way.** On Lovejoin's generalized contracts (PR #163, a box of ADA plus one token), four fits by 111 million steps, the thinnest of the three deployments; three uses 58.1%.
- **CPU is the only limit that binds.** Even six boxes use 21% of a transaction's memory and 8.3 KB of its 16 KB.
- **The margin doesn't wander, but it leaves no room.** A four-box mix of the wallet's always has the same shape, and the network measures it to the step as the wallet does. The only thing that moves its cost is where the fee input sorts among the boxes: 10 million steps between first and last at N = 4. So a four-box mix wouldn't fail at random. But it has no room for anything to change: whatever made a mix 1.2% dearer (a cost model that re-costs the BLS12-381 builtins, say) would make every one refuse to build. And a block holds only two of them, and only when nothing else in it runs scripts.
- **The cost is quadratic.** Each of a mix's N proofs checks a branch for each of the N outputs, about 540 million steps a branch. Going from three to four is 16/9 of the work, not 4/3.

**So the width stays three by default.** Four becomes comfortable once a transaction may use about **11 billion steps** (10% to spare). Five needs 15.05 billion. Six needs 21.3 billion, past the 20 billion a whole block may use today.

**Since 1.6.0 four is a choice** (chunk 34's D3): Settings → *Lovejoin* → *Four boxes a mix*, off by default, on every pool. The Mix form and Mix my boxes again's review have the same switch, set as Settings has it until turned. Swaps' and sites' returns go at Settings' width.
- **A chain that can't go four wide goes three, and says why:** the pool too short for four, a chain longer than one goes, four costing more than the ADA pays for, or four refused when it's built (`widthFor`, `wayOver`). A chain whose four-box build, or the network's check of its first mix, is refused is built again at three, never sent back unmixed. Where three takes no box either (the pool has room at neither width), `wayOver` gives no reason: a swap's approval then records the width asked, for its return to decide, and says only that the pool is short, while a chain still goes three, so its refusal quotes three's need (1.6.0's release review, 319-worker#0).
- **The Mix form at four** stops its stepper at what fits four a mix, and says what three would take. Its build goes three only where the pool changed since, or four won't build.
- **Mix my boxes again at four** takes as many of the wallet's boxes as fit four a mix, and leaves the rest for the next press. It goes three only where four takes none (`againWay`).

So the margin above is why four is an option and not the default, and why it falls back.

## How it was measured

[`seedelf-core/tests/lovejoin_width_test.rs`](../../seedelf-core/tests/lovejoin_width_test.rs) builds the wallet's mix for N = 2 to 6.

**The mix's shape:**
- in: N boxes and the one-time account's one fee UTxO (a base address);
- out: the N new boxes and the change;
- the account's own collateral, the pool's three reference inputs, and `mix_logic`'s zero withdrawal.

The boxes are made up: fresh registers with their own UTxOs. The three deployments:
- the classic pool on preprod, `67ffe4ed…`;
- the classic pool on mainnet, `c145c10f…`;
- Lovejoin's token-pool test launch on preprod, `b51f7e03…`: 2 ADA plus 10¹⁶ LJTEST a box, recorded in `tests/fixtures/lovejoin-token-preprod.json` from the transactions that made its references. Its two scripts' references sit at a key address. A pool the wallet shows keeps them at Lovejoin's holder instead, but either way a mix reads them as the same three reference inputs.

Each mix is measured with the wallet's own evaluator (`uplc`) under a limit far past the ledger's, so the widths the ledger refuses are costed too. The fee input is tried first, in the middle and last.

**That it's the wallet's mix:** `lovejoin::mix`, given the same boxes and fee input, declares the same budgets, redeemer by redeemer, uses the same, and pays the same fee for the same size, to the step and the lovelace (`the_harness_builds_the_wallets_mix`). That holds on the classic pools and on the token pool read by reference, at three and four boxes; with that pool's scripts inline, as the wallet reads this preprod test pool, its mix declares what its scripts use (1.6.0's release review, 312#1). Five boxes are refused at measurement, since `mix_logic` alone needs more than the evaluator's cap (`the_wallet_refuses_five_boxes`). A four-box mix whose scripts each fit, but whose sum passes `MAX_TX_BUDGET`, is refused by that sum (`the_wallet_refuses_four_boxes_once_together_they_pass_a_transactions_computation`, under a V3 cost model 2% dearer: 10.08 billion steps; 312#0).

**That the network agrees** (`--ignored`): the same transactions went to Koios's Ogmios on preprod and mainnet, with the made-up UTxOs as `additionalUtxo`. Nothing was signed, sent or paid.
- At N = 2, 3 and 4, the network's budgets were the wallet's, redeemer by redeemer, on all three deployments.
- At N = 5 and 6 it refused all three: "overspending the budget".

**Two older measurements match it to the step:**
- The N = 4 mix made on preprod at epoch 289 (`55e067cd…`, in `tests/fixtures/eval-preprod.json`) declared 9,876,061,908 steps. That's the harness's figure with the fee input in the middle.
- Lovejoin's own rehearsal of the token pool ([its `docs/perf.md`](https://github.com/logical-mechanism/Lovejoin/blob/main/docs/perf.md#preprod-rehearsal-2026-10-11)) measured its N = 2 and N = 3 mixes at exactly the harness's figures with the fee input last.

**The limits, read the same day:** both networks allow 10 billion steps a transaction and 20 billion a block. A transaction may use 16.5 million memory units on mainnet and 17.5 million on preprod. Both V3 cost models were still the bundled ones.

## The numbers

The fee input first, the costliest place. "A block holds" is how many fit in a block's 20 billion steps. Fees past N = 4 are what the mix would cost if the ledger took it.

**The classic pool on mainnet** (what the wallet mixes on):

| N | CPU steps | Of 10 billion | Left | Memory | Size | Fee | A block holds |
|---|---|---|---|---|---|---|---|
| 2 | 2,802,440,087 | 28.0% | 7,197,559,913 | 784,588 | 1,642 B | 0.532 ₳ | 7 |
| **3** | **5,800,935,725** | **58.0%** | **4,199,064,275** | 1,270,700 | 2,715 B | **0.823 ₳** | **3** |
| 4 | 9,882,068,838 | 98.8% | 117,931,162 | 1,871,408 | 4,128 B | 1.214 ₳ | 2 |
| 5 | 15,045,897,606 | 150.5% | over by 5.0 billion | 2,587,000 | 5,885 B | (1.705 ₳) | 1 |
| 6 | 21,292,455,141 | 212.9% | over by 11.3 billion | 3,417,764 | 7,986 B | (2.296 ₳) | 0 |

**The token pool on preprod** (the generalized contracts):

| N | CPU steps | Of 10 billion | Left | Memory | Size | Fee | A block holds |
|---|---|---|---|---|---|---|---|
| 2 | 2,812,373,123 | 28.1% | 7,187,626,877 | 791,155 | 1,740 B | 0.542 ₳ | 7 |
| 3 | 5,809,358,265 | 58.1% | 4,190,641,735 | 1,267,023 | 2,862 B | 0.835 ₳ | 3 |
| 4 | 9,888,981,920 | 98.9% | 111,018,080 | 1,857,493 | 4,324 B | 1.227 ₳ | 2 |
| 5 | 15,051,293,912 | 150.5% | over by 5.1 billion | 2,562,853 | 6,130 B | (1.719 ₳) | 1 |
| 6 | 21,296,344,065 | 213.0% | over by 11.3 billion | 3,383,391 | 8,280 B | (2.312 ₳) | 0 |

**The classic pool on preprod** is within 1.3 million steps of mainnet's at every width: 5,800,296,743 at N = 3 and 9,881,216,862 at N = 4, which leaves 118,783,138. Mainnet's scripts are preprod's recompiled, and cost a touch more.

**A token pool costs 5 to 10 million steps more than the classic pool,** because `mix_logic` decodes three more fields of the reference datum: 9.1 million more at N = 3, 7.8 million at N = 4. Its box carries a token too, so its mix is 49 bytes bigger a box and about 0.01 ₳ dearer.

## Where the steps go

At N = 4 on mainnet, with the fee input first:
- `mix_logic` uses 9,777,608,216 steps, 98.9% of the mix.
- The four `mix_box` spends use 104,460,622. Each is about 19.7 million plus 2.6 million for every input sorted before it, so the fee input sorting first costs 10.3 million more than sorting last.
- `mix_logic` costs the same wherever the fee input sorts.

`mix_logic` against N, on the classic pool on preprod:

| N | `mix_logic` | Step from the width before |
|---|---|---|
| 2 | 2,754,938,742 | |
| 3 | 5,725,817,492 | +2,970,878,750 |
| 4 | 9,776,756,240 | +4,050,938,748 |
| 5 | 14,907,813,166 | +5,131,056,926 |
| 6 | 21,119,021,382 | +6,211,208,216 |

Each step grows by 1.08 billion, every time: about **540 million·N² + 271 million·N + 53 million**. Each of the N proofs checks N branches (a sigma-OR over every output), and each branch is about 540 million steps of BLS12-381 work. Nothing in the wallet's transaction can trim that. Only a cheaper `mix_logic`, a cheaper cost model, or a bigger limit can.

## What would let four in

Worst case, any of the three deployments:

| N | A transaction must allow | With 10% to spare | Blocks today (20 billion) |
|---|---|---|---|
| 3 | 5.81 billion (today: 10) | 6.46 billion | three a block |
| 4 | 9.89 billion | **10.99 billion** | two a block, with 0.22 billion left for everyone else |
| 5 | 15.05 billion | 16.72 billion | one a block |
| 6 | 21.30 billion | 23.66 billion | none: blocks must allow 21.3 billion too |

Matching the room three has today (42% spare) would take 17.1 billion steps a transaction for four.

What could get there:
- a protocol parameter update that raises `max_tx_ex_steps` (and, for six, `max_block_ex_steps`);
- a cost model update that makes the BLS12-381 builtins about 9% cheaper, which brings four to 9 billion steps under today's limit;
- a cheaper `mix_logic`. The contracts are frozen, and a new one is a new pool.

To check after a hard fork or a parameter change, run the live test:

```text
cargo test -p seedelf-core --test lovejoin_width_test -- --ignored --nocapture
```

It prints each network's limits as they stand, and fails if a V3 cost model no longer matches the bundled fixture. In that case, record `tests/fixtures/epoch_params*.json` again first.

## What four would cost a user

Mainnet's classic pool, the fee input in the middle (0.823 ₳ a mix at N = 3, 1.214 ₳ at N = 4). A box ends as one of the fan-out's N^depth leaves at best (privacy.md has why it's usually fewer). Others are the boxes from the pool a box's fan-out draws, N^depth − 1.

| Depth | N = 3: mixes, leaves, others, fees | N = 4: mixes, leaves, others, fees |
|---|---|---|
| 1 | 1, 3, 2, 0.82 ₳ | 1, 4, 3, 1.21 ₳ |
| 2 (default) | 4, 9, 8, 3.29 ₳ | 5, 16, 15, 6.07 ₳ |
| 3 | 13, 27, 26, 10.70 ₳ | 21, 64, 63, 25.48 ₳ |

At the default depth, four wide gives 16 leaves for 6.07 ₳, between three wide's depth 2 (9 leaves, 3.29 ₳) and depth 3 (27 leaves, 10.70 ₳). Depth 3 four wide needs 63 other boxes for each box, more than twice the 30 that mainnet's floor asks the pool to hold. And a chain of four-box mixes goes two a block at most, often one, against three now.

## What changing the width touches

Chunk 34 (34e, 34f) did this for four. Kept as the list of what a fifth width, or a change of default, would touch.

`lovejoin::mix` already takes any N ≥ 2, measures it, and refuses one over `build::MAX_TX_BUDGET` (10 billion steps, mainnet's limit), which five or more would need raised with the network's. So would the wallet's evaluator's own cap, `eval::MEASURE_LIMIT` (14 billion steps), which caps a transaction's scripts together, not each, since uplc runs each redeemer on what the ones before it left: `mix_logic` alone needs 14.9 billion at five boxes, so five fails measurement whatever `MAX_TX_BUDGET` says. The width lives in:
- `seedelf-core/src/lovejoin/mod.rs`:
  - `WIDTHS` and `check_width`, the widths a mix may take (three and four);
  - `mixes_per_box_at`, which is (width^depth − 1)/(width − 1);
  - `fresh_for` and `fan_out`, which take width − 1 other boxes for every mix;
  - `MIX_FEE_ESTIMATE` and `MIX_FEE_ESTIMATE_FOUR`, the plan for a mix at each width (`mix_fee_estimate`);
  - the funding sums built on these (`per_box_in`, `funding_for_in`, `again_funding_in` and the like).
- `extension/src/shared/preferences.ts`: `LOVEJOIN_WIDTHS`, the widths Settings offers.
- `extension/src/background/lovejoin.ts`:
  - `mixesPerBox`;
  - `CHAIN_WINDOW`, whose four in flight assume three mixes a block, and `CHAIN_WINDOW_FOUR`, two for four-box mixes (`chainWindow`);
  - when a chain asked to go four goes three (`widthFor`, `wayOver`, `againWay`), and where `wayOver` gives no reason, three taking no box either.
- The screens' `width ** depth` and costs at a width: Settings (`depthCost`), the Lovejoin page and `LovejoinReturn` (`lovejoinHides`).
- The words: "three wide" and "up to 9" in the strings, in [privacy.md](privacy.md), in [flows.md](flows.md) and in [architecture.md](architecture.md#lovejoin).

`extension/src/networks.ts`'s `mixCost` is still a three-box figure, and nothing reads it.

A pool's floor and the chain cap (`MAX_CHAIN_MIXES`, 130) would want a fresh look too, since four wide draws almost twice the others at depth 2.
