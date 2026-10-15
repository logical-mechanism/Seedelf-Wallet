# Chunk 37 · A pool's return on stake

The owner asked for it on 2026-10-15: "branch and implement return on stake (ROS) for a pool. Lace shows it in the pool browser and on a pool's details, with recent epochs' rewards. Koios pool_history has a per-epoch ROS figure, so it would cost one request per pool opened. Small but worth it as a quick feature." It was one of the five Lace items declined on 2026-10-14; delegation history, another, came back the same day as chunk 36.

**Status: 🚧 the wallet and the data layer's route are built** on `web-wallet/pool-ros`, from `main` after #310 (the wallet pushed as `86e8e45`, `bc2ed2d`). **What's left is the route's live test,** which reads home's db-sync, so the owner runs it; then the PR.

## Start here

1. ~~The measurements~~: the owner ran them on 2026-10-15 (*Measured*), since the auto-mode classifier now refuses reads of `cexplorer_new` ("Production Reads"). The live test needs the same: the owner runs it, or gives a go-ahead.
2. ~~The design~~: C, the per-epoch sweep (*Measured*), with nothing new on home.
3. ~~The route~~: `GET /api/v1/pool_history`, `seedelf-data/api/src/public/history.rs`, with its grammar test (`public_grammar.rs`) and its live test (`live_public.rs`, `a_pools_history_is_koioss_with_every_epoch_paid`), offline suite, fmt and clippy clean.
4. **The live test, by the owner,** on the dev box: `cargo test -p seedelf-data-api --test live_public a_pools_history -- --ignored --nocapture`. If its window no longer meets the recording's (18 epochs on), `python3 -I api/tests/fixtures/record-pool-history.py` first.
5. Then the usual order: one PR, merge, deploy the API, check the route live, then package.

## What Lace does (2.4.2, `_reference/lace` at `e431933`)

- **An estimate, not a history:** `estimateStakePoolROS` (`packages/contract/cardano-stake-pools/src/estimate-ros.ts`) works a yearly rate out of the pool's live stake, pledge, margin and cost and the network's reserves, monetary expansion, treasury cut and `a0` (the Shelley ledger spec's maxPool, Fig. 46), assuming blocks in proportion to stake, so luck and downtime play no part. Zero when the live pledge is under the declared.
- **Where:** each card in the pool browser (`~3.1%`, sortable by it, from the bulk summary with the declared pledge standing in for the live one) and the pool's details (`ROS`).
- **"Recent epochs' rewards"** are on the *Your Stake* sheet only: the account's own rewards from its pool over the last 5 or 15 epochs, as bars.

## What this wallet does

- **What the pool paid, on its page:** **Return on stake**, the last of a pool's figures (after Blocks made), "3.14% a year": what each ADA staked with it earned over its last 18 epochs, after its fees, compounding. The figures' one ⓘ says over how many epochs, that the server didn't give some (when it didn't), and that it's what the pool did, not what it will do.
- **Recent epochs,** folded under the figures: each epoch's blocks and rate, or "not known".
- **Where:** the browser's pool page (read with `pool_info`, two requests), and Staking's **Pool details** (read the first time it unfolds: opening Staking costs what it did). Back from a review shows it again without asking (`PoolsView.history`).
- **Not on the list's rows:** a figure on every row would be a request per pool (2,891 on mainnet), and Lace's estimate on them is a formula, not what any pool did. The owner may want the formula on the rows anyway: it's free, from what the list and `epoch_params` carry, plus `totals`' reserves.

## Koios's `pool_history`, and its holes

- **The request:** `pool_history?_pool_bech32=…&select=epoch_no,active_stake,block_cnt,deleg_rewards&order=epoch_no.desc&limit=18`. Koios's newest row is two epochs ago (an epoch's rewards are paid two after it).
- **The rate:** `deleg_rewards / active_stake` (what the pool paid its stake after its fees, Koios's own figure), yearly as Koios's `epoch_ros` is, `(1 + r)^73 − 1`, which epoch 317 of LOGIC reproduces to 9 places; the pool's, the mean of `log(1 + r)` over the known epochs, a year of them over.
- **Most Koios servers leave out every other epoch's rewards, on both networks** (`deleg_rewards`, `pool_fees` and `member_rewards` null, `epoch_ros` 0, with blocks made). Its cache job, `grest.pool_history_cache_update` (koios-artifacts, `files/grest/rpc/00_cached_tables/pool_history_cache.sql`), does nothing while it holds up to the epoch before the current one, so it runs every two epochs, and then from the newest epoch it holds: the epoch between is written before its rewards exist and never again. Koios's own `pool_history` carries the comment "temporary condition for testing, until cache table population fixed". Seen 2026-10-15 for OctasPool on mainnet (8 or 9 of 18 null on four answers in five; the fifth had 2) and LOGIC on preprod (6 of 18; the largest preprod pool's 18 were whole on one answer and had 8 null on another): a minute apart, the same request gave different holes.
- **So a null is "not known",** left out of the return and shown as such, never counted as nothing: counted as zero, OctasPool's recorded answer reads 0.95% a year instead of 1.72%, and LOGIC's 2.04% instead of 3.08%. An epoch with no blocks paid nothing, which is known ("0 blocks · 0% a year"). Koios also writes null where a pool made blocks and was paid nothing (a pledge not met), which reads "not known" too; the pool's own page warns of a pledge not met today.

## The data layer (mainnet)

**Needed before this wallet ships.** Every read goes there first on mainnet (`DataLayerKoios`, and `data-layer.test.ts`'s guard that no Koios call is left unrouted), and the privacy policy says it: reads go through our server first, Koios for a part it can't answer. Without the route the API answers 404, and any failure holds the wallet's whole public part on Koios for 5 minutes. The wallet's override is in already (`poolHistory`), as chunk 36's was before its route.

**The route:** `GET /api/v1/pool_history`, exactly the query above (one pool, that select, that order, `limit=18`), Koios's columns and JSON, one row an epoch the pool had stake in, from two epochs ago back 18. As built (design C, below): every pool's epoch worked out once and kept for the server's life (`History`), 18 after a start, behind the requests every minute (`keep_filled`), one more as an epoch turns; a request waits at most 3 s for epochs still being worked out, then answers with those done. The newest epoch worked out in its first hour of being paid is worked out again 10 minutes on, since db-sync inserts an epoch's rewards bit by bit until then. Better than Koios: `deleg_rewards` is never null, and a pledge not met is `"0"`. [seedelf-data's README](../../../../seedelf-data/README.md) has the rest.

**What it reads,** after Koios's `grest.get_pool_history_data_bulk` (CC-BY-4.0), for every pool in one epoch, in one statement:

- the stake: `pool_stat.stake` at epoch E − 1, which is `epoch_stake`'s sum for E (*Measured*);
- the blocks: `block` by slot leader for the epoch (`idx_block_epoch_no`);
- the rewards: `reward` earned in the epoch, `member` and `leader`, by pool;
- the terms: `pool_update`, the latest active by each epoch, for Koios's `deleg_rewards` (members' rewards plus the leader's less the pool's fees: `fixed_cost + (total − fixed_cost) × margin`, or the members' alone when the leader's is under the cost).

**The cost was the rewards,** which chose the design. Home's `reward` has `idx_reward_pool_id` and `idx_reward_earned_epoch`, each on its own, and no index on both: a large pool (35,000 delegators) has about 35,000 rows an epoch for every epoch since it started, and an epoch has a row for every delegator on the network. Three designs:

- **A. Per pool, kept for the epoch,** with `pool_info`'s 3 s budget. Cheapest to write; a large pool's first look may read gigabytes from a cold disk. Measure first.
- **B. A new index on home,** `reward (pool_id, earned_epoch) include (type, amount)`, built `concurrently` from `deploy/home/db-sync-indexes.sql` by the owner: then A is a range scan. Its size and build time come from the measurements.
- **C. A sweep a new epoch:** every pool's rewards for one epoch (`idx_reward_earned_epoch`, one epoch's rows), kept in memory for the 18 epochs (3,000 pools × 18 rows), the oldest dropped as a new one comes. Each pool's look is then a lookup; the cost is 18 epochs read once at each start, one an epoch after.

### Measured (2026-10-15, the owner's run on home)

Epoch 661; the largest pool `pool1gaztx97t53k47fr7282d70tje8323vvzx8pshgts30t9krw62tm` (35,041 delegators); the `reward` table 457.5M rows, 33 GB.

- **A, one pool over 18 epochs: 3.2 s cold, 1.1 s warm.** The planner reads `idx_reward_earned_epoch` for all 18 epochs and filters the pool out: 21M rows read, 621,000 kept, 246,000 buffers (1.9 GB) from disk. So a pool's look costs as much as every pool's over the same epochs, and would cost that for each pool opened. Out.
- **C, one epoch for every pool: 0.18 s** (its pages warm from A; A's cold run read 18 epochs in 3.2 s, so about 0.2 s an epoch cold). 1.2M rows, 933 pools paid in epoch 659, under 1.1 MB of memory to group them.
- **B isn't needed:** C is cheap without it, and an index on 457M rows would be many GB.
- **`pool_stat` is the snapshot a step ahead** (one small pool, epochs 656–661, and the largest's blocks): its `stake` at epoch N is `epoch_stake`'s sum at N + 1, which is Koios's `active_stake` for N + 1, and its `number_of_blocks` at N is the blocks made in N − 1. So an epoch E's stake is `pool_stat`'s at E − 1, and its blocks `pool_stat`'s at E + 1 (or `block` by `idx_block_epoch_no`, about 21,000 rows an epoch). The live test checks both against Koios for real pools.

**So: C.** Each epoch's every pool (stake, blocks, members' and leader's rewards, the terms active then) worked out once and kept for the API's life, the 18 newest final epochs (two ago back 18), the oldest dropped as an epoch turns; a pool's look is then a lookup. About 0.2–0.5 s an epoch, so 18 at a start in the background (single-flight, a few at a time), one more an epoch. It would also have every pool's return at hand, should the owner want it on the browser's rows on mainnet (preprod's Koios has nothing like it).

### The measurements (the queries that were run)

Read-only, as `seedelf_reader` on `cexplorer_new` (the URL in `seedelf-data/.env`), each with `set statement_timeout = '60s'`:

```sql
-- The largest pool by delegators, and the current epoch.
select ps.pool_hash_id, ph.view, ps.number_of_delegators from pool_stat ps join pool_hash ph on ph.id = ps.pool_hash_id
 where ps.epoch_no = (select max(epoch_no) from pool_stat) order by ps.number_of_delegators desc limit 1;
select max(no) from epoch;

-- A: one pool's rewards over 18 epochs (put the pool's id and the epochs in).
explain (analyze, buffers) select earned_epoch, sum(amount) filter (where type = 'member'),
       sum(amount) filter (where type = 'leader')
  from reward where pool_id = <id> and earned_epoch between <cur - 19> and <cur - 2>
   and type in ('member', 'leader') group by earned_epoch;

-- C: one epoch, every pool.
explain (analyze, buffers) select pool_id, sum(amount) filter (where type = 'member'),
       sum(amount) filter (where type = 'leader')
  from reward where earned_epoch = <cur - 2> and type in ('member', 'leader') group by pool_id;

-- B: how big the index would be.
select reltuples::bigint, pg_size_pretty(pg_relation_size('reward')) from pg_class where relname = 'reward';

-- The stake and blocks: does pool_stat line up with epoch_stake and block for the same epoch?
select ps.epoch_no, ps.stake, ps.number_of_blocks,
       (select sum(amount) from epoch_stake where pool_id = ps.pool_hash_id and epoch_no = ps.epoch_no),
       (select count(*) from block b join slot_leader sl on sl.id = b.slot_leader_id
         where sl.pool_hash_id = ps.pool_hash_id and b.epoch_no = ps.epoch_no)
  from pool_stat ps where ps.pool_hash_id = <id> and ps.epoch_no between <cur - 4> and <cur - 2> order by 1;
```

Each twice: the first from a cold disk, the second warm.

## Tests (the wallet)

- `staking.test.ts`: the one request, in its order; 18 epochs newest first with their blocks; epoch 317's rate against Koios's own `epoch_ros`; Koios's nulls left out, not counted as zero (which would take a point off LOGIC's); mainnet's OctasPool, every other epoch null, not halved; the ID as hex, and a DRep's refused; rows that aren't epochs left out, each epoch once, none past 18; no rate with no epoch known.
- `data-layer.test.ts`: the request on the data layer, in the order its grammar will take, or Koios when it fails.
- `pool-return-screen.test.ts`: the figures' last row, the hint's three wordings and none without a rate, the epochs folded, not known, reading and Try again, folded with the figures on Staking, and nowhere without a read.
- `e2e/extension.spec.ts`: opening Staking asks nothing, Pool details asks once (folded and opened again: still once), the epochs and the hint's count match the recording, a pool's page asks with its details, and Back from its review asks for neither again; the older staking test now sees `pool_history` beside `pool_info`. Ten runs each on 2 CPUs, dev and store builds: all passed.
- The fixture: `tests/fixtures/record-pool-history.mjs` (preprod's LOGIC and TPREP, mainnet's OctasPool), `pool-history.json`, served by `tests/fakes.ts`. Koios's servers disagree, so a new recording can differ: the one committed has mainnet's every-other-epoch holes, which the OctasPool test needs.
