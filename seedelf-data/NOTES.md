# seedelf-data: the maintainers' notes

Why the data layer's API is built as it is, the checks run against Koios and the chain, and the query planner's measurements. Each measurement says what it ran on, and when. [README.md](README.md) is the API's reference, and [deploy/README.md](deploy/README.md) the runbook for home and the VPS. The record of the data layer's plan, with the original reasoning behind each choice, is [chunk-26-data-layer.md](../seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-26-data-layer.md).

## The workspace

**Its own Cargo workspace,** apart from `seedelf-platform/`, so nothing here moves the CLI's `Cargo.lock`. It pins the same Rust (`rust-toolchain.toml`): bump the two together. It can't depend on `seedelf-core`, so the token pools' checks are a copy ([below](#lovejoins-token-pools)).

**`.env` is never committed.** `.env.example` lists the variables, and `api/src/config.rs` reads them. `cargo run` and the live tests reach the services it names, home's mainnet ones included.

## Reference code

`_reference/` holds shallow clones to read and optimise against. Git ignores it, and its own README says what's where. To recreate it:

```bash
mkdir -p _reference && cd _reference
for r in cardano-community/koios-artifacts blockfrost/blockfrost-backend-ryo \
         IntersectMBO/cardano-db-sync cardano-community/guild-operators \
         CardanoSolutions/kupo; do
  git clone --depth 1 "https://github.com/$r.git"
done
```

- **koios-artifacts** is the public routes' starting point. It's CC-BY-4.0, so credit it wherever its SQL is used.
- **blockfrost-backend-ryo** is a second set of db-sync queries to compare query plans against.
- **kupo**'s `docs/api/v2.11.0.yaml` is the HTTP API the private index's second source reads. Its filters are inclusive.

## Token decimals

They're built in (`api/data/token-decimals.json`), made by `scripts/token-decimals.py` from a checkout of the Cardano token registry, Koios's own source. Refreshing them needs that checkout (about 500 MB), wherever it's kept, then a build:

```bash
git clone --depth 1 https://github.com/cardano-foundation/cardano-token-registry.git
python3 scripts/token-decimals.py cardano-token-registry > api/data/token-decimals.json
```

Refresh it the way the wallet refreshes its token list: the script, a commit, a build, then a deploy.

## Tests

**One test at a time** for the live ones (`--test-threads=1`): the database role allows 10 connections, and a running server holds some of them.

**What the offline tests check,** beyond each module's own:
- the private index against a scripted Kupo on loopback, with db-sync unreachable (`tests/scripted_kupo.rs`): a fork under a cursor answers `reset`, with no source fresh the index answers 503, and the token pools' routes answer 503 with a wait while the contract's answer from Kupo;
- the token pools' checks against the wallet's own vectors and scenarios ([below](#held-together-with-the-wallet)), the depth walk of a script row's datum among them; a launch made the way the wallet makes one passes as standard, and anything else is refused with its reason;
- the whole app behind its edge (`tests/edge.rs`): CORS for the wallet's origin alone, a 429 the wallet can read, a bucket per client Caddy names, the month's ceiling, and `no-store` on every answer but a preflight.

**What the live tests check:**

- **The public routes,** by what must hold however the chain moves:
  - the contract's and mix box's `credential_utxos` equal the private index, each row's tokens and decimals included;
  - a page after any outpoint is the rest;
  - every `tx_info` balances: inputs and withdrawals against outputs, fee, deposit and donation;
  - an account's payment keys' `credential_txs` lists only transactions under those keys, and every one of its stake key's newest transactions that's under them; its next page, and its answer from a block, carry on from it;
  - the pool list's pages make one sorted list;
  - an NFT's `asset_info` equals Koios's recorded answer;
  - a rewards history's pages make one list in its order, for reward accounts many pools pay (six pages) and one the reserves and the treasury paid too, and what's been paid by now is `account_info`'s rewards available plus withdrawals;
  - a delegation history's pages make one list in its order, no row twice and no withdrawal, each row's time and epoch its slot's, and Koios's recorded answer is its start, row for row (`tests/fixtures/account-update-history.json`): for a key that registered and delegated in one transaction then delegated its vote, one that stopped and registered again four times, one delegated twice in one transaction, mainnet's busiest re-delegator (two pages), and a key never registered.
  - a pool's history is newest first, 18 epochs at most, two epochs ago at most, every epoch paid (none with no blocks paid anything), and, where its window overlaps Koios's recorded answer, the same epochs, stake and blocks, with what each epoch paid one of the values Koios's servers gave (`tests/fixtures/pool-history.json`, `record-pool-history.py`): for the pool with the most delegators, OctasPool and a pool of about 100; a pool db-sync doesn't know has none.

- **The private index, from each source** (`tests/live_private.rs`):
  - from cursors a day, two days and a month back, and from Kupo's first block, the snapshot plus the delta replays exactly to the rows unspent at the tip, for both credentials (db-sync also from before the contract existed);
  - db-sync and Kupo name the same block at every slot asked, and give the same rows, field for field and in the same order, but for `made_by.inputs`;
  - a box's `mixed` is the same from both.
- **Lovejoin's token pools** (`tests/live_lovejoin.rs`, with `--nocapture` to see each candidate's verdict): the combined feed's queries, given the classic pool's mix box alone, give the classic route's rows field for field, `mixed` included; the classic pool's crowd counts the route's 10 ₳ boxes and their mixes; every crowd counts only the boxes at its mix box's script, and every launch's scripts are only those at the holder's script, never at the key address under the same hash (each prints what that key address holds); every candidate at the holder is read, its launch's inputs, scripts and registrations included, and checked.
- **The submit part,** at no cost, since nothing sent can ever land: bytes that aren't a transaction, the contract's first transaction resubmitted (`All inputs are spent`), and Ogmios's error for evaluating it, each passed through as the service gave it. It also covers what the server refuses itself.

**Checked end to end (2026-10-09):** the server run once as is and once with db-sync unreachable gave byte-identical contract snapshots, `since` answers and names at the same tip. The Lovejoin answers differed only in `made_by.inputs`.

## The edge

**Logs can't be turned up to show a request.** The database driver logs every query's parameters at debug, and axum's rejections quote bodies, so those libraries sit behind a filter of their own (`api/src/main.rs`), which every line must pass as well as `RUST_LOG`'s. Checked with `RUST_LOG=tokio_postgres::query=debug`: no query parameters were logged.

**`/health` is exempt from the page check and the egress ceiling,** so a monitor (or a browser tab) can always read it. The submit part's state is said there but not counted in the status, since the deploy compares the status with the one before.

## The private index

**db-sync answers first,** since its queries are enough for the load. **Kupo is the spare:** it needs only the node, so the private index keeps answering while db-sync is down, behind or resyncing. Kupo indexes outputs at the two credentials, not who paid for a transaction, which is why its boxes' `made_by.inputs` is `null`.

**Checked by cutting each link mid-run,** both by closing it and by freezing it so nothing answers. The private index answered from Kupo within 8 s; with both gone, every route answered 503 at once; and both came back within 8 s.

**The answers every wallet reads are always kept,** whatever the cache's budget holds (`state.rs` `ALWAYS_KEPT`): the snapshots, the names, `epoch_params`, `totals`, and the token pools' snapshot (317-data#1, 1.6.0's release review).

**The SQL:**
- **Every query starts from the credential's own outputs, in a `MATERIALIZED` CTE.** Left to itself, the planner can start from every transaction since a cursor instead: for two days of mainnet that's 880,000 transactions and 3.5 s, against 9.5 ms this way.
- **Every value is cast or encoded to a plain type in SQL,** so db-sync's domain types never reach the driver.

## Lovejoin's token pools

The code is `api/src/lovejoin/`. **Its checks are a copy of the wallet's:** this workspace can't depend on `seedelf-core`, which keeps its own copy, so the two are held to one set of vectors ([below](#held-together-with-the-wallet)), and a box's datum to the node's own reading of it. A change to either copy's rules changes the other's in the same PR.

**Where each part of the rule is:** the datum's shape and its depth walk in `datum.rs`; the two template sets in `templates.rs`, applied by hand in `flat.rs`, with no Pallas, uplc or blst; the shown rule in `standard.rs`; the crowd in `crowd.rs`; the holder's reads in `discovery.rs` and `db.rs`.

**The two sets' provenance:** `tokenV1` is Lovejoin 8131b1d's scripts, retired; `v2` is Lovejoin 29573c5's, whose `mix_logic` alone differs (xor32's fix). The wallet's WebAssembly names them the same way, and `routes.rs`' `a_listed_pool_names_its_set` holds the names (pr363#2, 1.8.0's release review).

**A release that lists a token is deployed here first:** the API builds in the wallet's mainnet token list, and shows a pool only of a listed token.

**A launch's script row under a datum nested past the wallet's 128 levels** (`datum.rs` `MAX_DEPTH`, `seedelf-core`'s `cbor::MAX_DEPTH`) leaves its pool out, since the wallet passes such a row over and never shows the pool (314-wasm#0, 1.6.0's release review).

**Verdicts are kept in memory** (`discovery.rs`, at most 200,000). Past that, a candidate is checked again at each request, and still shown when it's standard.
- **The holder is read incrementally, not from the start each time:** each read gathers only the holder's outputs, candidates or not, above the highest output id and transaction id gathered so far, as of its block (a later block's outputs have higher ids of both). Going on from the last candidate alone would gather a launch's scripts, and anything paid to the holder, again at every cursor (321-lj-rust-data#0). Every hour the holder is read again from the start, so a block rolled back under the stable cursor is forgotten within the hour.
- **An incremental read extends only the read it started from:** if an hourly read from the start, perhaps of an older block, has replaced that one meanwhile, it starts again from the new one, so nothing between the two is missed (DATA-3). What's refused is dropped from what's kept, and read again only by the hourly read.
- **A launch's inputs are tried once each,** however many candidates it made.

**`lovejoin/pools` answers by one 5 s deadline,** its cursor's read included: two separate 5 s waits would use up the wallet's 10 s, and a wallet that gets no answer holds its private part on Koios for 5 minutes (317-data#0). The stable cursor is read once per tip (317-data#2). A cursor read that fails or runs late answers the last list, which is most often this very cursor's (R3-15).

### Held together with the wallet

- `seedelf-platform/seedelf-core/tests/fixtures/lovejoin-pool-vectors.json`, which `seedelf-core`'s `lovejoin_vectors_test.rs` writes from its own derive, datum decoder and `cbor::within_depth`: ten seeds' four script hashes on each set (`v2` holds v2's), 32 datum encodings with what each reads as, and 28 script rows' datums with whether each is within the 128 levels (`scriptRowDatums`), which `datum.rs`' `within_depth` is held to.
- `seedelf-platform/seedelf-core/tests/fixtures/lovejoin-box-spellings.json`: a box's datum spelled many ways, each with what the node reads it as (cardano-cli, offline; `record-box-spellings.py` beside it records it again, only to add a spelling or for a new cardano-cli). `datum.rs`' `is_mix_datum` takes exactly the spellings the node reads as a box, as `seedelf-core`'s `PoolBox::from_row` does.
- `seedelf-platform/seedelf-web-wallet/extension/tests/fixtures/lovejoin-shown.json`: the earliest-of-each-value scenarios, which the wallet's `lovejoin-pools.ts` is tested against too.

## The public routes

**Why every request is bounded:** any credential, address or stake key may be asked about, and one listing of a credential with 220,000 unspent outputs read 2.4 GB from disk for every page.

**The SQL is the API's own.** The home Postgres has no `grest` schema and no pg_cardano, and the API reads with the read-only role, so nothing at home is installed. Its indexes beyond db-sync's own are recorded in [deploy/home/db-sync-indexes.sql](deploy/home/db-sync-indexes.sql), with the command that lists what's there.
- **Where Koios relies on an index it adds, the query goes another way.** A stake key's addresses come from `address.stake_address_id`: 2 ms, against 6.7 s through `tx_out.stake_address_id`, which db-sync doesn't index. An address is found by its bytes (`address.raw`), not its text.
  - **The exceptions are three of Koios's own, on small tables:** `delegation_vote` by account and by transaction, and `voting_procedure` by transaction. Together they're 25 MB, and nothing else reads those tables faster. Built at home on 2026-10-09:

    | Query | Before (the table read whole) | After |
    |---|---|---|
    | `account_info` | 16–19 ms | 0.1–0.4 ms |
    | `tx_info`'s certificates, a page of Activity | 15 ms | 0.3–0.6 ms |
    | `tx_info`'s votes, a page of Activity | 1.7 ms | 0.03 ms |

**db-sync's statistics are far off, so the hot queries don't lean on them.**
- **The problem:** Postgres samples `tx_out` and counts 44,000 distinct addresses (there are 54 million) and a million distinct transactions (there are 125 million). It then expects 243 unspent outputs at every address and 343 outputs on every transaction.
- **The fix:** each address's, transaction's or token's outputs are read on their own, behind `offset 0`, so the planner can't swap the per-key lookups for something its estimates make look cheaper. Measured on 2026-10-09, with the same rows before and after:

  | Query | Before | After |
  |---|---|---|
  | `credential_utxos`, a wallet's own 75 credentials | 4–6 ms (parallel workers for 3 rows) | 0.3–0.5 ms |
  | `credential_utxos`, a credential at 95,000 addresses | 4.1 s (it read every unspent output on the chain: 26 GB a page) | 160 ms |
  | `tx_info`'s outputs for a page of Activity | 5 ms (parallel workers for 40 rows) | 0.5–0.8 ms |
  | `asset_nft_address`, an ADA Handle last moved five months ago | 2.5–3.5 s, and past the 10 s cap for some (it walked every output, newest first, to the handle's) | 0.4–22 ms |

- **What doesn't work:** turning parallel workers off for every connection. It would fix the small queries but slows a large pool's live delegators from 0.4 s to 2.1 s. Raising `parallel_setup_cost` does nothing for these plans.

**What stands in for Koios's caches, and why:**
- **A pool's live stake waits 3 s at most,** then answers with the epoch's snapshot: a first look at a large pool, read from a cold disk, took 12 s.
- **A token's latest minting metadata is looked for among its latest 10,000 mints.** Read whole, a token minted 573,000 times took past 20 s; this way, 0.1 s.

**Every connection runs with `jit = off`.** JIT compiled plans whose estimates db-sync's `ma_tx_out` inflates: 76 of a UTxO query's 80 ms.

**The connections:** the role allows 10, and the API holds 9: the tip's 1, the private index's 2 and the public routes' 6, leaving one for a person.

**`account_txs` and `credential_txs` never join a whole history.** A transaction's id rises with its block, so a page takes the newest ids it needs, its own and every newer one, widened to the whole of the oldest block they reach, and joins only those: 0.5 s a first page for a key with 221,000 transactions, against 2.3 s before, and the same rows. A deeper page needs more of them, and one past the end of a long list would need them all, so no page starts more than 10,000 in (Activity's 500th *Load more*).
- **`credential_txs` gathers nothing past the cap:** a count from `tx_out`'s index alone gates the gathering, in the same query, so Minswap V2's pool script is refused in 0.1 s, against 4.9 s gathering its outputs to find out. `account_txs` is as it was.
- **A credential's outputs are gathered address by address,** never all its addresses first: a busy script's credential sits at millions of them, and the cap reaches at most as many addresses as outputs.
- **`account_txs` stays for older wallets:** it was Public activity's route up to wallet 1.4.1, and it's still the restore scan's.
- **Checked against Koios (2026-10-11):** the same pages, row for row, for a wallet's key and for the contract's and mix box's credentials together, at offsets 0 and 20.

**`account_reward_history`:** the pool's bech32 comes from `pool_hash.view`, sorted in SQL by the order the wallet asks for (`spendable_epoch.asc,earned_epoch.asc,type.asc,pool_id_bech32.asc,amount.asc`), oldest first by every column.
- **Oldest first is what keeps the pages still while db-sync adds rows.** It adds an account's next rewards as an epoch goes on, and refunds at an epoch's start, and takes back those of a key deregistered before it was paid: all among the newest, at the end. Newest first, a row added between two pages pushed one already read onto the next page too, and the wallet counted it twice.
- **Checked against Koios (2026-10-12), oldest first:** every page the same, row for row, for the reward account 13 pools pay (5,766 rows), one 34 pools pay (2,513, pools' deposits back among them), a member the reserves and the treasury paid too (457), and a key never paid (none). All four, every page: 0.5 s from home.

**`account_update_history`:** read from `stake_registration`, `stake_deregistration`, `delegation` and `delegation_vote`, sorted in SQL by the order the wallet asks for (`absolute_slot.asc,tx_hash.asc,action_type.asc`).
- **A transaction's certificates of one kind for the key are one row,** as Koios's `union` makes them: a key delegated twice in each of two transactions has 31 rows, not 33.
- **Each kind is read by its key's `addr_id`,** through db-sync's indexes and home's `delegation_vote_addr_id_idx`. Mainnet's busiest re-delegator (1,282 pool delegations, 1,289 rows): 117 ms from a cold disk, 5 ms warm.
- **Checked against Koios (2026-10-14), oldest first:** every page the same, row for row, for that re-delegator (1,000 and 289), a key that stopped and registered again four times (16), the key delegated twice in one transaction (31), the reward account 13 pools pay (3: registered and delegated in one transaction, then its vote delegated), and a key never registered (none). Each page in 3–55 ms from home.

**`pool_history`:** `deleg_rewards` is worked out in floating point and rounded half to even, as Postgres works Koios's out; the pool's terms are the latest `pool_update` by `active_epoch_no`.
- **Why every pool's at once:** `reward` (457.5M rows, 33 GB) has `idx_reward_pool_id` and `idx_reward_earned_epoch`, none on both, so one pool over 18 epochs is read through the epochs and filtered: 21M rows for 0.6M, 3.2 s from a cold disk and 1.1 s warm for the pool with the most delegators (35,041), as much as every pool's. One epoch, every pool: 0.18 s (measured 2026-10-15). So each epoch is worked out for every pool once (`History`), 18 after a start, behind the requests every minute, and one more as an epoch turns; the oldest goes.
- **The stake is `pool_stat`'s, a step ahead:** its row for epoch E − 1 is `epoch_stake`'s sum for E, which Koios reads, without an epoch's 1.3M `epoch_stake` rows. Its `number_of_blocks` is likewise the epoch before's; the blocks come from `block` (`idx_block_epoch_no`).
- **Why the newest epoch is worked out again:** db-sync inserts an epoch's rewards bit by bit until they're paid, and takes back at payday those owed to keys deregistered since. Koios's servers hold values cached at either stage, low or high: OctasPool's epoch 642 is 2,347, 14,373, 19,172 and 19,269 ₳ on four of them; db-sync's, final, is 19,172 ₳, and the 19,269 has about 98 ₳ more paid to members.
- **Where Koios's differs:** its cache leaves every other epoch's `deleg_rewards` null on most of its servers, and two answers a minute apart differ; here every epoch has one.

**`tx_info` reads its parts at once,** pipelined on one connection: two round trips to home, not six.

**The tables behind the README's plain words:** a rewards history reads `reward` and `reward_rest`; a token's supply and latest mint, `ma_tx_mint`; `drep_info`, `delegation_vote` whole. A delegation history's one row per kind per transaction is Koios's `union`.

### Known slow cases

The measurements behind the README's *Limits*:
- `drep_info` reads `delegation_vote` whole, for every account's latest vote delegation: 260 ms for the DRep with the most delegators, then kept. A kept one comes back in under a millisecond instead of 200–400 ms, the timing gap the README's *Limits* warns about.
- **A pool's first look:** on a cold disk, a pool of 2,000 delegators took 1.6 s and the largest (35,000) took 7 s. Most of that is each delegator's reward history: 6.2 s cold and 1.1 s warm for the largest.
- **A credential at very many addresses:** 160 ms for one at 95,000.
- **A deep page's cost:** for a busy key, 60 ms for the deepest page (10,000 in) against 30 ms for its first (warm, at home, 2026-10-12).

## The submit part

**Its answers matched Koios's byte for byte on 2026-10-08:** Koios fronts the same two services, so the error strings the wallet classifies stay what they are.

**Ogmios's `/health` gates both paths,** so an Ogmios restart sends submits to Koios for its few seconds.

**Why sync is judged by the tip's own slot:** `networkSynchronization` moves in steps of about 48 minutes in its last decimal place, far coarser than the 3-minute limit, and `lastTipUpdate` stays fresh on a node that's catching up, since its tip moves every moment.

**Errors are logged by kind only:** reqwest's own error messages carry the upstream's URL, which names home.
