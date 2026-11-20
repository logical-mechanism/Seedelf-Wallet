# seedelf-data

Seedelf Wallet reads Cardano mainnet through this API, at `https://mainnet.seedelf.logicalmechanism.io`. Seedelf Wallet is a Cardano wallet for Chrome with Seedelf built in; Seedelf is a stealth wallet that hides who receives and who spends ([what Seedelf is](../README.md)). The API sits in front of its own Cardano node, db-sync (the chain in a Postgres database) and Kupo (an index of only the outputs it's set to match).

**Mainnet only.** On preprod the wallet reads Koios ([koios.rest](https://koios.rest), a public Cardano API). On mainnet it reads Koios alone when Settings → *Read Cardano through Koios only* is on.

**The wallet falls back to Koios part by part.** When a part of this API can't answer, the wallet reads that part from Koios instead. The parts are the three the wallet's Settings name: the private balance, the public account, and sending. The public routes and the submit part take Koios's own paths and JSON, so for them the fallback is only a change of base URL.

## What it serves

- **[The private index](#the-private-index)** of the Seedelf contract and of Lovejoin's classic mix box, for the private balance and Lovejoin's boxes. Lovejoin is the mixer the wallet uses. A Lovejoin pool holds equal-value UTxOs, its boxes, at the pool's mix box; the classic pool is an ADA pool of 10 ₳ boxes, with scripts of its own. No request names a UTxO, a register (a Seedelf UTxO's datum, which only its owner can recognise) or an owner, so every answer is the same for whoever asks, and the wallet picks out its own rows.
- **[Lovejoin's token pools](#lovejoins-token-pools):** which pools are shown, each pool's crowd (how many deposits its boxes could have come from), and every shown pool's boxes in one feed.
- **[The public routes](#the-public-routes):** the 24 other Koios endpoints the wallet uses, for the public account, staking and governance, under Koios's own `/api/v1/` paths and JSON. They take only the requests the wallet makes.
- **[The submit part](#the-submit-part):** Koios's `/api/v1/submittx` and `/api/v1/ogmios` paths, passed to a cardano-submit-api and an Ogmios, for sending.
- **[`/health`](#health):** each part's state.

Every request passes [the edge](#the-edge) first: a bucket per IP, a monthly traffic ceiling, and CORS for the wallet's origins only.

## Run it

It's its own Cargo workspace, with the Rust that `rust-toolchain.toml` pins.

```bash
cp .env.example .env     # then fill it in; git ignores it
cargo run -p seedelf-data-api
curl http://127.0.0.1:8099/health
```

`cargo build --release -p seedelf-data-api` builds the binary. It reads its settings from the environment, or from a `.env` file in the folder it runs from or any folder above it:

| Variable | What it is |
|---|---|
| `MAINNET_DATABASE_URL` | db-sync's Postgres, through a read-only role. The only one required. |
| `MAINNET_KUPO_URL` | a Kupo that matches the contract and the mix box: the private index's second source. Without it, the private index reads db-sync alone. |
| `MAINNET_SUBMIT_API_URL`, `MAINNET_OGMIOS_URL` | cardano-submit-api and Ogmios, for the submit part. `submittx` needs both and `ogmios` needs Ogmios; a route missing one answers 503. |
| `DATA_LISTEN` | where it listens: `127.0.0.1:8099` by default |
| `DATA_ORIGINS`, `DATA_TRUST_PROXY`, `DATA_EGRESS_GB_MONTH`, `DATA_STATE_DIR` | the edge's settings ([below](#the-edge)) |
| `RUST_LOG` | the log level: `info` by default |

**What the services need,** as templates in [deploy/home/](deploy/home/):
- db-sync with the insert options in `db-sync-insert-options.json`, the read-only role in `seedelf_reader.sql`, and the extra indexes in `db-sync-indexes.sql`;
- a Kupo matching the contract's and the mix box's credentials, as `kupo_seedelf.service` runs it;
- cardano-submit-api with `tx-submit-mainnet-config.yaml`, and Ogmios.

**It listens on loopback** by default. On the VPS, Caddy is in front of it, for TLS. Never expose it without TLS.

**Tests:**

```bash
cargo test                                    # offline
cargo test -- --ignored --test-threads=1      # live, against the services in .env
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

The live tests run one at a time: the database role allows 10 connections, and a running server holds some of them.

## What it reads

The API runs on a VPS, behind Caddy. The services it reads run on a separate machine, which the VPS reaches through a WireGuard tunnel.

- **db-sync's Postgres,** for everything but the submit part. It reads with a read-only role: SELECT only, `default_transaction_read_only`, a 60 s timeout. That Postgres has neither Koios's own SQL functions (its `grest` schema) nor the pg_cardano extension they use, so the SQL is the API's own.
- **A Kupo that indexes only the contract and the mix box,** the private index's second source. It needs only the node, so the private index keeps answering while db-sync is down or behind.
- **cardano-submit-api and Ogmios,** for the submit part. Ogmios's `/health` also says whether the node is synced.
- **The node behind them is the relay of a stake pool,** on the same machine. A transaction sent through the API reaches the network from it.
- **Built in:** the token registry's decimals (`api/data/token-decimals.json`), and the wallet's mainnet token list, which says which tokens' Lovejoin pools are shown.

## What it sees and keeps

What the code does is in this repository; what runs on the servers isn't something a user can check. The deployed binary is built from `main` by `.github/workflows/data-layer-deploy.yml`, whose run prints its SHA-256.

- **Your IP address,** as any server does. It's kept only in memory, for its bucket ([the edge](#the-edge), `api/src/edge.rs`), and forgotten once the bucket is full again.
- **What a request names.** A public route's request names what it asks about, as a request to Koios would: stake keys, addresses, payment credentials, outputs, transactions, a pool, a DRep, a token. A submit carries the transaction. The private index's requests name nothing but a [cursor](#the-private-index), which shows roughly when the wallet last read.
- **No logs of a request.** It logs its start and failed queries only, never a request's address, path or body. A failed query logs only its SQLSTATE, since a Postgres message can quote a value the request sent. The database driver and axum, which can log a request's contents, sit behind a log filter of their own, so no `RUST_LOG` directive can turn them up (`api/src/main.rs`).
- **The servers' own logs, as configured here:** Caddy keeps no access log, and its error log leaves out the loggers that name a client (`deploy/edge/Caddyfile`). Postgres's log holds no statement (`deploy/home/postgresql-seedelf.conf`), and Kupo's HTTP log, set to Warning, no request path (`deploy/home/kupo_seedelf.service`).
- **Nothing kept or logged about a submit:** not the transaction, not its ID (`api/src/submit.rs`).
- **Answers the same for everyone are kept** for a time, in memory, and serve every wallet. **An answer about one user is never kept:** the *Kept* column of [the public routes](#the-public-routes) says which is which.
- **Its one file** is the month's count of bytes sent (`egress.json`), so a restart doesn't forget it.
- **Nothing in a browser's cache:** every answer but a CORS preflight carries `Cache-Control: no-store`.

## The edge

What stands between the internet and the routes, in `api/src/edge.rs`. Caddy in front does TLS and nothing else, so every limit is in this repository's code.

| Setting | What it does |
|---|---|
| `DATA_ORIGINS` | the origins CORS lets read answers, comma-separated: the wallet's `chrome-extension://<id>`. The wallet then needs no host permission. `Retry-After` is exposed, and a 429 carries CORS too, so the wallet can read why it waits. None by default. |
| `DATA_TRUST_PROXY=true` | behind Caddy on loopback: the client is the last `X-Forwarded-For` address. From anywhere else the header is ignored. Any value but `true` or `false` is refused at start. |
| `DATA_EGRESS_GB_MONTH` | the API's own traffic a calendar month (UTC), in GB, before every route but `/health` answers 503. Each day gets an equal share of what's left, so a flood costs a day, not the rest of the month. The count is kept in `egress.json` in `DATA_STATE_DIR`, or systemd's `StateDirectory`, so a restart doesn't forget it; with neither, the count starts from zero at each restart. Unset, there's no ceiling. It counts response bodies alone: TLS and headers come on top. |

**A bucket per client:** 300 units, refilled at 10 a second. IPv6 addresses are taken by their /64.

| Request | Costs |
|---|---|
| the private index, `/health`, and the public answers that are the same for everyone: `tip`, `epoch_params`, `totals`, `pool_list`, `proposal_list` | 1 |
| any other public route: one user's live SQL | 4 |
| `submittx`, `ogmios` | 10 |

- **Answers cost what they send:** a unit more for every 16 KB, charged after. A bucket can go below empty, to a full bucket's worth.
- **Past it, a 429** with `Retry-After`. The wallet paces itself under this: it keeps to 80 units every 10 s, by these weights (`DATA_LIMIT` in the wallet's [data-layer.ts](../seedelf-platform/seedelf-web-wallet/extension/src/background/data-layer.ts)).
- **A web page's requests are refused** with 403: a browser fetch that isn't CORS (an image, a `no-cors` fetch, a page load), or one from an origin that isn't the wallet's. The browser would hide the answer from the page but still download it, so any site's visitors could spend the month's traffic. A request with neither header (curl, a monitor) passes, and `/health` always does.
- **A CORS preflight is reused:** its `Access-Control-Max-Age` is 24 h, which Chrome caps at 2, so the wallet needn't send one before every POST.
- **At most 200,000 buckets.** Past that, refilled ones are dropped on the spot, at most once a second; if none are, a new client gets 503.

## Health

`GET /health` says each part's state:

- `private`, `public` and `submit`: `ok` or `down`;
- `source`: which source the private index answers from, `db-sync` or `kupo`;
- `egress`: `over` once the month's traffic ceiling is passed;
- `db_sync` and `kupo`: each source's tip and its age;
- `node`: the node's tip as Ogmios says it, its age, and whether Ogmios is `connected` to it;
- `network`: always `mainnet`.

It answers 200 while the private index and the public routes answer and the month's traffic is under its ceiling, and 503 otherwise. The submit part's state is said but doesn't change the status.

## The private index

It lists every UTxO at two payment credentials (`api/src/constants.rs`): the Seedelf wallet contract, `94bca9c099e84ffd90d150316bb44c31a78702239076a0a80ea4a469`, and the mix box of Lovejoin's classic pool, `c145c10ff4bcaef7f5a4dbb3fcbfddca4b6c7b08191b0690b12f1fad`. The routes take no parameter but a cursor (`api/src/private.rs`), so no request says which rows are the asker's.

**What a cursor is:** a point on the chain the server hands out, written `<slot>.<block hash>`. Its slot is a multiple of 200, at least 200 slots below the tip (about 10 blocks), and its hash is the newest block's at or before that slot. The server refuses any other slot with a 400. 200 slots is deeper than the forks mainnet usually sees, so a cursor almost never rolls back; when one does, the answer says `reset`. Wallets that read within the same 200 slots hold the same cursor, so one answer serves them all, and a request shows only roughly when its wallet last read.

Every route is under `/seedelf/v1/mainnet/`, and every answer carries `network` and the source's `tip` (its slot, hash and time).

| Route | Answer |
|---|---|
| `contract/snapshot` | the contract's rows unspent as of the stable `cursor` |
| `contract/since/{cursor}` | what changed after that cursor, which the answer repeats as `from`: `created` (each with its `spent`, if it's gone since) and `spent` (older rows spent after it, each its `ref`, `slot`, `time` and `by`), plus the new stable `cursor` |
| `names` | every Seedelf unspent at the tip, with the row that holds it. A Seedelf is a token under the Seedelf policy, `84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255`, whose name starts with `5eed0e1f` |
| `lovejoin/pool` and `lovejoin/since/{cursor}` | the same for Lovejoin's classic pool, at its mix box. Each box carries `made_by`: whether its transaction spent a box itself, and each input's payment and stake credentials |

For example, the contract's rows, then what changed since:

```bash
api=https://mainnet.seedelf.logicalmechanism.io
curl -s "$api/seedelf/v1/mainnet/contract/snapshot"         # {"network", "tip", "cursor", "rows"}
curl -s "$api/seedelf/v1/mainnet/contract/since/<cursor>"   # <cursor> from the answer above
```

**How a wallet reads it:**

1. **A snapshot gives the settled view** as of a stable cursor `C`.
2. **`since/C` gives the changes after it.** The settled view plus `created` minus every spend is the view at the tip.
3. **The answer's `cursor` is the new settled point `C'`.** Apply only the entries at or below `C'` to the settled view. Everything above it is recomputed from the next answer, so a fork above a cursor never needs undoing.
4. **`reset: true`** means the cursor's own block was rolled back: start again from a snapshot. A reset carries no cursor, so none can be taken by mistake.

**An answer's cursor never goes back.** A source a little behind the one that handed out `from` answers with `from` itself as the cursor.

**Two sources, one answer.** db-sync answers first. Kupo answers instead while db-sync is down, its tip over 3 minutes old, or more than 60 slots (about 3 blocks) behind Kupo's, and whenever a db-sync read fails.
- **A source is down** once its tip fails two reads in a row, and up again at the next good one. A tip read that takes 2 s has failed. Requests then skip that source at once, rather than each waiting on a timeout.
  - **The tip has a connection of its own,** so no burst of requests can starve the read that says whether db-sync is up.
  - **A read for a request gets 5 s** before the other source is asked.
  - **Postgres connections close** once sent bytes go 5 s unacknowledged, and idle ones are probed, so a tunnel that drops packets can't hold a dead connection for TCP's own 15 minutes.
- Both know every block by slot and hash, so a cursor from one is answered by the other, and a wallet never sees a switch.
- Their rows are the same, field for field and in the same order, with one exception: from Kupo, a box's `made_by.inputs` is `null`. Kupo indexes the outputs at the contract and the mix box, not who paid for a transaction. The live tests compare the two sources row for row (`api/tests/live_private.rs`).
- A source whose tip hasn't reached a cursor passes it to the other. If neither can answer, the route gives 503 with `Retry-After`, and the wallet goes to Koios.
- An answer Kupo makes from several reads is always of one chain state. If Kupo's checkpoint (`X-Most-Recent-Checkpoint`) moves between the reads, they're made again, 3 tries in all; after that the read counts as failed.
- Kupo keeps every block's checkpoint from its start, block 11,305,805, the contract's first output. A cursor from before that is a `reset` from Kupo.

**Caching:** each source's answers are kept until its tip moves. Both tips are read every 2 s, so one set of reads per block serves every request.
- **Requests that miss together share one read.**
- **Each source keeps at most 4,096 answers and 64 MB.** A `since` answer from an old cursor can be hundreds of KB, and anyone can ask for one. The answers every wallet reads (the snapshots, the token pools' included, the names, `epoch_params`, `totals`) are kept whatever the budget holds.
- **A failure is logged at most once every 10 s:** a source that's down fails every request.

## Lovejoin's token pools

Beside the classic pool, anyone can launch a Lovejoin pool, each with its own box value: ADA, or ADA and a token. These routes are under `/seedelf/v1/mainnet/lovejoin/` too, and db-sync alone answers them: Kupo indexes neither the pools nor the holder, where every launch puts its pool's reference UTxO (below). While db-sync can't answer, they answer 503, the wallet reads the token pools from Koios, and the classic pool's routes go on answering from Kupo.

| Route | Answer |
|---|---|
| `lovejoin/pools` | every shown pool as of the stable `cursor`: its `id`, its `version` (its template set, below: `v2` or `tokenV1`), its `reference` UTxO, the `seed` its launch spent, its `mix_box` and `mix_logic` reference scripts at the holder (each row with its `script_hash`; the wallet derives the bytes), where its `launch` is (`tx`, `block`, `index` in the block, slot and time), and its `crowd`; and the classic pool's `crowd` |
| `lovejoin/tokens` and `lovejoin/tokens/since/{cursor}` | the boxes of every shown pool, read as `lovejoin/pool` and `lovejoin/since` are, with `pools`: the `mix_box` hashes covered, those shown as of the cursor (or `from`'s). A box's `made_by.mixed` is whether its transaction spent from its own pool |

**What a launch is:** it spends a seed UTxO, and the seed fixes the pool's scripts. Applied to the seed, `one_shot_mint` hashes to P, `mix_logic` to L and `mix_box` to M. P is the policy of the pool's `lovejoin` NFT and the pool's `id`; M is where the boxes sit. The launch puts the pool's reference UTxO at the holder, `reference_holder`: an always-false script with no parameters, so whatever is put there stays for good.

**Two template sets:** the versions of Lovejoin's token-pool scripts the API recognises. `v2` is the one the wallet launches pools on. `tokenV1` is an older set: the wallet no longer launches on it, and only brings boxes back from its pools. They differ only in `mix_logic`, and a seed makes the same P on either, so a pool's datum's L says which set it runs.

**A pool is shown** (listed here, and offered by the wallet) **when it's standard and the earliest standard pool launched with its values on its template set** (its box's ADA and token), ordered by block, then place in the block, then id. A later standard pool with the same values on the same set is a copy, and isn't shown. The sets are separate: a `v2` pool is never a copy of a `tokenV1` pool, and a `tokenV1` pool shown stays shown, for the boxes the wallet brings back from it. Standard means:
- its reference UTxO is at the holder's enterprise address, with no reference script, holding one `lovejoin` NFT and ADA alone, and its datum has the shape `one_shot_mint` requires of a launch;
- its token is in the wallet's mainnet token list (`tokens/list.json`, built in), or it's an ADA pool at any amount but the classic pool's 10 ₳;
- one of its launch's inputs, the seed, makes its NFT's policy, and the datum names exactly the scripts that seed makes on one of the two sets;
- its launch transaction itself put `mix_box` and `mix_logic` at the holder's script (its payment part, whatever the stake part; never the key address under the holder's hash), each under no datum or a datum nested at most 128 levels deep (the deepest the wallet reads), and registered L as a stake credential, unless L was registered in an earlier block. The wallet passes over a script row under a deeper datum and never shows its pool, so this rule leaves the pool out too; if the launch also put a readable copy of the script at the holder, that copy is the one listed.

The rule is in `api/src/lovejoin/standard.rs`. None of it changes once it's on chain, so each candidate is checked once and its verdict kept in memory, and a pool shown stays shown. Everything at the holder is locked for good, so spam there is burned, and costs this server one check.

**A pool's crowd** is its `boxes`, the `deposits` they could have come from, and how many of the boxes a mix made (`mixed`). A transaction that pays a pool's `mix_box` without spending from it is a deposit; one that spends from it is a mix, and each box it makes could have come from any deposit behind any of its inputs. The deposits counted are those some box in the pool now could have come from, worked backwards from the boxes through each mix. A box is an output at the pool's `mix_box` script, whatever its stake part, holding exactly the box value, under a datum that's constructor 0 of two different 48-byte values, written either way the ledger reads it (tag 121, or `102([0, fields])`). The key address under `mix_box`'s hash holds no box: nothing can spend it. The two values are meant as BLS12-381 G1 points; checking that they're on the curve is left to the wallet. The crowd is the same for everyone; the wallet leaves its own boxes out of the count it shows.

For example, every shown pool and its crowd:

```bash
curl -s "https://mainnet.seedelf.logicalmechanism.io/seedelf/v1/mainnet/lovejoin/pools"   # {"network", "cursor", "classic", "pools"}
```

**Kept:** a cursor's pool list, for an hour. It's worked out once per cursor, in the background rather than inside a request, with a minute's budget. A request waits at most 5 s; past that, or when its cursor or the list can't be read, it gets the last list worked out, and a 503 only before the first one exists. The boxes' feed is kept for db-sync's tip.

## The public routes

Koios's paths and JSON, so a wallet falls back by changing its base URL. The code is `api/src/public/`.

| Route | What the wallet asks | Kept |
|---|---|---|
| `credential_utxos` | up to 75 payment credentials' unspent outputs, 1,000 a page by outpoint, optionally only blocks after a height; at most 20,000 in all (but the contract's and mix box's) | a block, for the contract's or mix box's; otherwise never |
| `address_utxos` | up to 20 addresses' unspent outputs, paged the same way; at most 20,000 in all | never |
| `utxo_info` | up to 60 outputs, spent or not | never |
| `datum_info` | up to 60 datums' CBOR | never |
| `tip` | the newest block | read every 2 s |
| `tx_status` | up to 100 transactions' confirmations | never |
| `epoch_params` | the newest epoch's parameters | a block |
| `totals` | the newest epoch's supply | a block |
| `account_addresses` | up to 20 stake keys' addresses, empty ones too | never |
| `account_info` | one stake key's standing | never |
| `account_reward_history` | one stake key's rewards, oldest first, 1,000 a page: the wallet's Staking screen, *Rewards history*, read only when it's opened | never |
| `account_update_history` | one stake key's certificates (registered, staked, vote delegated, stopped), oldest first, 1,000 a page: the Staking screen's *Delegation history*, read only when it's opened | never |
| `account_txs` | one stake key's transactions: a page of 20, at most 10,000 in, or up to 1,000 from a block on; for a key with at most 200,000 outputs. The wallet's restore scan | never |
| `credential_txs` | up to 75 payment credentials' transactions, whatever their addresses' staking part, paged as `account_txs` is; for at most 200,000 outputs in all. The wallet's Activity screen for the public account, by its payment keys | never |
| `tx_info` | up to 20 transactions, in Activity's shape or inputs alone | never |
| `pool_list` | the registered pools, 1,000 a page | an hour, within its epoch |
| `pool_info` | up to 5 pools' details and live stake | 10 minutes, within its epoch |
| `pool_history` | one pool's last 18 epochs whose rewards are final: active stake, blocks, and what it paid its stake. A pool's *Return on stake* | every pool's epoch, worked out once and kept for the server's life |
| `drep_info` | up to 5 DReps' standing | 10 minutes, within its epoch; the account's own (`deposit,meta_url,meta_hash` selected) never |
| `drep_metadata` | up to 5 DReps' profile names | 10 minutes; the account's own profile (`is_valid` selected) never |
| `proposal_list` | the live governance actions | 5 minutes, within its epoch |
| `vote_list` | one DRep's votes on up to 40 actions | never |
| `asset_nft_address` | the address holding one NFT (an ADA Handle) | never |
| `asset_info` | one token's CIP-25 and CIP-68 metadata | never |

**What one request may cost is bounded.** Any credential, address or stake key may be asked about, and some on mainnet hold hundreds of thousands of outputs. So a listing gathers at most 20,000 unspent outputs, and `account_txs` and `credential_txs` at most 200,000 outputs, with a page starting at most 10,000 transactions in. Past any of these, the answer is a 503, `{"error":"too large for this server"}`, with no `Retry-After`: it would be as large again, so the wallet reads Koios, for that request alone. They're set far above what one wallet's own accounts hold. Requests are also held to the wallet's own sizes (one account's standing, 20 keys probed).

**Answers kept for a time are kept within their epoch,** since a pool's status, a DRep's activity and the live actions turn at an epoch's start. Not-found answers aren't kept: anyone can ask about made-up IDs. When the store is full, the answer due to expire soonest makes room. A request waits at most 5 s for a shared answer, its queue included, then gets a 503.

**An ID has one spelling:** the lowercase bech32 the wallet sends. The server re-encodes what it decodes and takes the ID only if the two match: the decoder alone would also take a Bech32m checksum and stray padding bits, which would let one pool be asked for, cached and worked out under several names.

**Only the wallet's requests.** Each route takes exactly the query string and body the wallet's [koios.ts](../seedelf-platform/seedelf-web-wallet/extension/src/background/koios.ts) sends: its parameters, in its order, at its sizes. Anything else is a 400, `{"error":"not a request Seedelf Wallet makes"}`, before any query runs, so no caller can compose an expensive one. A POST's body is `application/json`. `api/tests/public_grammar.rs` holds a request each route takes, and ones it refuses. For example:

```bash
api=https://mainnet.seedelf.logicalmechanism.io
curl -s "$api/api/v1/tip"
curl -s "$api/api/v1/epoch_params?limit=1"
# one stake key's standing
curl -s -X POST -H 'content-type: application/json' \
  -d '{"_stake_addresses":["stake1u9c0yhlklkdd7vcwkvv2cjrgnw48y82jmm2ulk3vxe2qupsv2va8g"]}' \
  "$api/api/v1/account_info"
# the Seedelf contract's first 1,000 UTxOs
curl -s -X POST -H 'content-type: application/json' \
  -d '{"_payment_credentials":["94bca9c099e84ffd90d150316bb44c31a78702239076a0a80ea4a469"],"_extended":true}' \
  "$api/api/v1/credential_utxos?order=tx_hash.asc,tx_index.asc&limit=1000"
# a pool's last 18 epochs
curl -s "$api/api/v1/pool_history?_pool_bech32=pool1gaztx97t53k47fr7282d70tje8323vvzx8pshgts30t9krw62tm&select=epoch_no,active_stake,block_cnt,deleg_rewards&order=epoch_no.desc&limit=18"
```

**Answers use Koios's names and types** for every field the wallet reads. **Fields it never reads are left out:**
- the JSON form of a datum or a script (`value` is null). The wallet drops both and reads registers from the bytes, and anyone can nest a datum thousands of levels deep;
- from `tx_info`: collateral, reference inputs, mints, scripts and proposals, and every certificate but the seven an account's own transactions make.

**The SQL is written after Koios's `grest` functions** ([koios-artifacts](https://github.com/cardano-community/koios-artifacts), CC-BY-4.0): an account's standing, a pool's state and live stake, a DRep's activity and delegators, a token's minting metadata. The live tests hold some answers to Koios's recorded ones: a token's metadata, a delegation history, a pool's history (`api/tests/live_public.rs`). CIP-129 DRep, committee and governance action IDs are made in Rust (`api/src/ids.rs`).

**What stands in for Koios's caches:**
- **Token decimals** come from the Cardano token registry, Koios's own source, built into the API.
- **A pool's state** is worked out per request from its latest update and any retirement after it.
- **A pool's live stake** is summed over its live delegators: each account whose latest delegation is to the pool, not since deregistered, and in this epoch's stake, as Koios's `pool_delegators_list` counts them. Each account's reward sums change only at an epoch's start, so they're kept in memory for the epoch.
  - A request waits at most 3 s for the live figures, then answers with the epoch's snapshot (db-sync's `pool_stat` table) while they're finished in the background and kept.
  - Once a pool's figures are 10 minutes old, the next look gets them at once while fresh ones are worked out behind it, for 10 minutes more at most.
  - At most 2 pools are worked out at once, and a pool whose figures failed gets the snapshot for 5 minutes: a request naming several slow pools can't hold the public connections.
- **A token's latest minting metadata** is looked for among its latest 10,000 mints.
- **A token's supply and latest mint** are read from db-sync's table of mints, which it indexes by token.

**The public routes have their own connections:** 6, beside the private index's 2 and the tip's own 1, so a burst of them never holds the private index up.
- A query that waits 2 s for a connection, or runs past 10 s, answers 503, so the wallet goes to Koios rather than queueing.
- A connection that takes 3 s to open has failed, rather than waiting minutes on TCP.
- **While db-sync is down** (two failed reads of its tip) **or behind** (its tip over 3 minutes old), every public route answers 503 at once, kept answers included.

**The histories are read oldest first,** sorted in SQL by the order the wallet asks for, so the pages stay still while db-sync adds rows; the wallet shows them newest first.
- **`account_reward_history`** is Koios's: every reward paid to the key, by a pool or not. The next epoch's rewards are listed before they're paid, as Koios's are.
- **`account_update_history`** is Koios's, less withdrawals: a stake key's `registration`, `deregistration`, `delegation_pool` and `delegation_drep` rows, each with its transaction's hash and its block's epoch, slot and time. The request filters out Koios's fifth kind (`action_type=neq.withdrawal`): the wallet withdraws rewards with nearly every payment, and its Activity screen has them. A transaction's certificates of one kind for the key are one row, as in Koios's.

**`pool_history` follows Koios's pool history function** (`grest.get_pool_history_data_bulk`), with every pool's epoch worked out at once and kept. Each row is an epoch's active stake, the blocks made by slot leader, and `deleg_rewards`: the members' rewards earned in it and the leader's, less the pool's fees by the terms active then, rounded half to even. The 18 epochs are those whose rewards are final: the 18 ending two epochs ago.
- Every epoch has its `deleg_rewards`. A pool that made blocks and was paid nothing (a pledge not met) paid `"0"`, where Koios says null. Koios lists a pool's newest 18 epochs with stake, however old; this lists those of the 18 newest it had stake in.
- A request waits at most 3 s for epochs still being worked out (after a start, or as an epoch turns), then answers with those done.
- The newest epoch, worked out in its first hour of being paid, is worked out again 10 minutes on: db-sync inserts an epoch's rewards bit by bit until they're paid.

## The submit part

| Route | Upstream | The server's own checks |
|---|---|---|
| `POST /api/v1/submittx` | cardano-submit-api, `POST /api/submit/tx` | the body is `application/cbor` (415 if not) and at most 16 KiB, the ledger's `max_tx_size` (413 if more); at most 4 in flight (503 past it) |
| `POST /api/v1/ogmios` | Ogmios, `POST /` | `application/json` (415 if not: a `text/plain` POST needs no CORS preflight, so a web page could send one); a JSON-RPC 2.0 `evaluateTransaction` and no other method (400); at most 64 KiB; at most 2 in flight |

- **Answers pass through untouched,** status and body. Koios fronts the same two services, so the error strings the wallet classifies stay what they are.
- **No connection** to the submit-api or Ogmios (refused, or none within 3 s) is a 503 with `Retry-After`: nothing reached the node, so the wallet sends through Koios at once.
- **No answer** on a connection that opened is a 502, or a 504 after 30 s: to the wallet, either one means "maybe sent". Each request opens a fresh connection, so one that died with the tunnel can't hold a submit for the full 30 s.
- **The requests,** as `api/tests/live_submit.rs` sends them: a submit is the transaction's raw bytes; an evaluation, its CBOR in hex.

  ```bash
  curl -s -X POST -H 'content-type: application/cbor' --data-binary @tx.cbor \
    https://mainnet.seedelf.logicalmechanism.io/api/v1/submittx
  curl -s -X POST -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","method":"evaluateTransaction","params":{"transaction":{"cbor":"<tx hex>"}}}' \
    https://mainnet.seedelf.logicalmechanism.io/api/v1/ogmios
  ```
- **It depends on the node and Ogmios alone,** so db-sync can be down.
- **Only while the node is synced.** A node catching up after a restart rejects a valid spend of an output newer than its tip, as already spent, and Ogmios evaluates such a spend as having an unknown input. The wallet can't tell either answer from a real rejection. So Ogmios's `/health` is read every 2 s, and both paths answer 503 `behind` with `Retry-After` while the node's tip is more than 3 minutes old, while Ogmios can't reach the node, or once `/health` has failed two reads in a row. The wallet then goes to Koios at once. Without an Ogmios configured, the node's sync is unknown, and the submit part answers 503.
- **Nothing is cached or logged:** not a transaction, not its ID, not an upstream's URL.

## A row

```json
{
  "ref": "<tx hash>#<index>",
  "address": "addr1…",
  "lovelace": "1749860",
  "assets": [["<policy>", "<name>", "1", 0]],
  "datum": "d8799f5830…",
  "script": true,
  "created": { "slot": 144889937, "time": 1736456228 },
  "spent": { "slot": 199943000, "time": 1791509291, "by": "<tx hash>" },
  "made_by": { "mixed": true, "inputs": [["<payment cred>", "<stake cred or null>"]] }
}
```

- **Omitted when empty:** `assets`, `datum`, `script`, `spent` and `made_by` (Lovejoin only).
- **`made_by.mixed`** says whether the box's transaction spent from its own pool's mix box: the classic pool's on its routes, each token pool's own on `lovejoin/tokens`.
- **An asset** is `[policy, name, quantity, decimals]`: hex, hex, a decimal string, and the token registry's decimals, 0 for a token it doesn't list, as Koios gives them in an `asset_list`. The wallet shows a token its own list lacks by these, without asking about the token. Both sources fill them from the same file, so their rows stay the same.
- **`datum`** is the inline datum's raw CBOR. The wallet's own parser decides what it means.
- **`script`** is true when the output carries a reference script.
- **The address** is the exact bech32. The contract has outputs in both enterprise and staked form.
- **A point is a slot and its time,** with no block height: Kupo has none. Every row is from Shelley on, where a slot is a second, so its time is the slot plus 1,591,566,291.
- **`made_by.inputs`** is `null` when Kupo answered.

## Limits

- **Mainnet only.** Preprod reads Koios.
- **Only the wallet's requests.** It isn't a general Koios: any other request is a 400.
- **A request too large for it is a 503:** more than 20,000 unspent outputs, more than 200,000 outputs behind a transaction listing, or a page more than 10,000 transactions in. The wallet reads Koios for that request.
- **A part that's down answers 503,** and the wallet reads that part from Koios for 5 minutes. While db-sync is down, or its tip is over 3 minutes old, the public routes and the token pools' routes answer 503; the private index answers from Kupo.
- **The wallet trusts it to report the chain truthfully,** as it trusts Koios ([Data Layer Reliance](../README.md#data-layer-reliance)).
- **Known slow cases** (the measurements are in [NOTES.md](NOTES.md#known-slow-cases)):
  - `drep_info` reads every account's latest vote delegation, then keeps the answer.
  - **A pool's first look holds up whoever asks,** for up to 3 s, before the epoch's snapshot answers instead. Most of that time goes on each delegator's reward history. The wallet asks for its own pool's details when its Home screen first loads, to show the pool's ticker.
  - **A credential at very many addresses costs one lookup per address.**
  - **A deep page of `account_txs` or `credential_txs` joins every newer transaction too,** so the deeper it starts, the more it costs. That's why none starts more than 10,000 in.
- **A shared answer shows it was asked for.** A kept `drep_info` comes back far faster than one worked out, so a prober could tell someone asked about that DRep in the last 10 minutes. The same holds for every kept answer, and it's accepted: sharing answers is what keeps the load on the services behind the API flat.

## Help

For support and bugs, open a [GitHub issue](https://github.com/logical-mechanism/Seedelf-Wallet/issues) or a support ticket in the [Seedelf Discord](https://discord.gg/r8VwV2jGBy). Security vulnerabilities go by email only: see [SECURITY.md](../SECURITY.md).

## For contributors

- [NOTES.md](NOTES.md): the maintainers' notes: why each part is built as it is, the checks run against Koios and the chain, the query planner's measurements, and what the tests cover.
- [deploy/README.md](deploy/README.md): the runbook for the VPS, the WireGuard tunnel, and "home", the separate machine that runs the node, db-sync and Kupo. Deploys go through `.github/workflows/data-layer-deploy.yml` alone.
