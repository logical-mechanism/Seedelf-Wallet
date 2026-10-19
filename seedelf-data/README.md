# seedelf-data

Seedelf Wallet's data layer: the API in front of the home db-sync, Kupo and node. **Mainnet only.** The plan, and every decision behind it, is web wallet chunk 26, [docs/archive/plans/chunk-26-data-layer.md](../seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-26-data-layer.md).

**Its own Cargo workspace,** apart from `seedelf-platform/`, so nothing here moves the CLI's `Cargo.lock`. It pins the same Rust (`rust-toolchain.toml`).

## What's built

- **The private index** of the Seedelf contract and Lovejoin's mix box, read from db-sync, or from the Seedelf-only Kupo when db-sync is down or behind. Every answer is the same for whoever asks: none names a UTxO, a register or an owner. The wallet keeps deciding which rows are its own.
- **Lovejoin's token pools** (web wallet chunk 34's 34c), from db-sync alone: which pools are shown, found at the holder every launch uses and checked with this crate's own copy of the wallet's rules, each pool's crowd, and every shown pool's boxes in one feed.
- **The submit part:** Koios's `/api/v1/submittx` and `/api/v1/ogmios` paths, passed to the home cardano-submit-api and Ogmios.
- **The public routes:** the other 24 Koios endpoints the wallet uses, under Koios's own `/api/v1/` paths and JSON, taking only the requests `koios.ts` makes.
- **The edge,** for the VPS: buckets per IP, a monthly egress ceiling, and CORS for the wallet's origins only.
- **The deploy files and runbook,** [deploy/README.md](deploy/README.md): home's services through a WireGuard tunnel, and the API behind Caddy on a VPS.

**Live** at `https://mainnet.seedelf.logicalmechanism.io` (web wallet chunk 26c): a DigitalOcean droplet, deployed only through `.github/workflows/data-layer-deploy.yml`.

## Run it locally

```bash
cp .env.example .env     # then fill it in; git ignores it
cargo run -p seedelf-data-api
curl http://127.0.0.1:8099/health
```

**Listening:** it listens on loopback (`DATA_LISTEN`, `127.0.0.1:8099` by default). On the VPS, Caddy is in front of it ([deploy/README.md](deploy/README.md)); never expose it without TLS.

**Logging:** it logs its start and failed queries only. It never logs a request's address, path or body.

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

**Token decimals** are built in (`api/data/token-decimals.json`). Refreshing them needs a checkout of the token registry (about 500 MB), wherever it's kept, then a build:

```bash
git clone --depth 1 https://github.com/cardano-foundation/cardano-token-registry.git
python3 scripts/token-decimals.py cardano-token-registry > api/data/token-decimals.json
```

## Tests

```bash
cargo test                                    # offline
cargo test -- --ignored --test-threads=1      # against the real db-sync in .env
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

**One test at a time:** the database role allows 10 connections, and a running server holds some of them.

**What the offline tests check,** beyond each module's own:
- the private index against a scripted Kupo on loopback, with db-sync unreachable (`tests/scripted_kupo.rs`): a fork under a cursor answers `reset`, with no source fresh the index answers 503, and the token pools' routes answer 503 with a wait while the contract's answer from Kupo;
- the token pools' checks against the wallet's own vectors and scenarios (above), and a launch as the wallet makes one standard, anything else refused with its reason;
- the whole app behind its edge (`tests/edge.rs`): CORS for the wallet's origin alone, a 429 the wallet can read, a bucket per client Caddy names, the month's ceiling, and `no-store` on every answer but a preflight.

**What the live tests check:**

- **The public routes,** by what must hold however the chain moves:
  - the contract's and mix box's `credential_utxos` equal the private index, each row's tokens and decimals included;
  - a page after any outpoint is the rest;
  - every `tx_info` balances: inputs and withdrawals against outputs, fee, deposit and donation;
  - an account's payment keys' `credential_txs` lists only transactions under them, and every one of its stake key's newest that is; its next page and its answer from a block carry on from it;
  - the pool list's pages make one sorted list;
  - an NFT's `asset_info` equals Koios's recorded answer;
  - a rewards history's pages make one list in its order, for reward accounts many pools pay (six pages) and one the reserves and the treasury paid too, and what's been paid by now is `account_info`'s rewards available plus withdrawals;
  - a delegation history's pages make one list in its order, no row twice and no withdrawal, each row's time and epoch its slot's, and Koios's recorded answer is its start, row for row (`tests/fixtures/account-update-history.json`): for a key that registered and delegated in one transaction then delegated its vote, one that stopped and registered again four times, one delegated twice in one transaction, mainnet's busiest re-delegator (two pages), and a key never registered.
  - a pool's history is newest first, 18 epochs at most, two epochs ago at most, every epoch paid (none with no blocks paid anything), and where the windows meet Koios's recorded answer, the same epochs, stake and blocks, and what it paid one of the values Koios's servers gave (`tests/fixtures/pool-history.json`, `record-pool-history.py`): for the pool with the most delegators, OctasPool and a pool of about 100; a pool db-sync doesn't know has none.

- **The private index, from each source** (`tests/live_private.rs`):
  - from cursors a day, two days and a month back, and from Kupo's first block, the snapshot plus the delta replays exactly to the rows unspent at the tip, for both credentials (db-sync also from before the contract existed);
  - db-sync and Kupo name the same block at every slot asked, and give the same rows, field for field and in the same order, but for `made_by.inputs`;
  - a box's `mixed` is the same from both.
- **Lovejoin's token pools** (`tests/live_lovejoin.rs`, with `--nocapture` to see each candidate's verdict): the combined feed's queries, given the classic pool's mix box alone, give the classic route's rows field for field, `mixed` included; the classic pool's crowd counts the route's 10 ₳ boxes and their mixes; every candidate at the holder is read, its launch's inputs, scripts and registrations included, and checked.
- **The submit part,** at no cost, since nothing sent can ever land: bytes that aren't a transaction, the contract's first transaction resubmitted (`All inputs are spent`), and Ogmios's error for evaluating it, each passed through as the service gave it. It also covers what the server refuses itself.

**Checked end to end (2026-10-09):** the server run once as is and once with db-sync unreachable gave byte-identical contract snapshots, `since` answers and names at the same tip. The Lovejoin answers differed only in `made_by.inputs`.

## The edge

What stands between the internet and the routes, in `src/edge.rs`. Caddy in front does TLS and nothing else, so every limit is in code anyone can audit.

| Setting | What it does |
|---|---|
| `DATA_ORIGINS` | the origins CORS lets read answers, comma-separated: the wallet's `chrome-extension://<id>`. The wallet then needs no host permission. `Retry-After` is exposed, and a 429 carries CORS too, so the wallet can read why it waits. |
| `DATA_TRUST_PROXY=true` | behind Caddy on loopback: the client is the last `X-Forwarded-For` address. From anywhere else the header is ignored. |
| `DATA_EGRESS_GB_MONTH` | the API's own traffic a calendar month (UTC), in GB, before every route but `/health` answers 503. Each day gets an equal share of what's left, so a flood costs a day, not the rest of the month. It's kept in `egress.json` in systemd's `StateDirectory` (or `DATA_STATE_DIR`), so a restart doesn't forget it. It counts response bodies alone: TLS and headers come on top, so watch the VPS's own meter too. |

**A bucket per client:** 300 units, refilled at 10 a second. IPv6 addresses are taken by their /64.

| Request | Costs |
|---|---|
| the private index, `/health`, and the shared public answers: `tip`, `epoch_params`, `totals`, `pool_list`, `proposal_list` | 1 |
| any other public route: one user's live SQL | 4 |
| `submittx`, `ogmios` | 10 |

- **Answers cost what they send:** a unit more for every 16 KB, charged after. A bucket can go below empty, to a full bucket's worth.
- **Past it, a 429** with `Retry-After`. A wallet paces itself under this: its data layer client keeps to 80 units every 10 s, by these weights (`DATA_LIMIT` in the wallet's `data-layer.ts`).
- **A web page's requests are refused** with 403: a browser fetch that isn't CORS (an image, a `no-cors` fetch, a page load), or one from an origin that isn't the wallet's. The browser would hide the answer from the page but still download it, so any site's visitors could spend the month's traffic. A request with neither header (curl, a monitor) passes, and `/health` always does.
- **IPs exist only in memory:** a bucket is forgotten once it's full again, and nothing logs an address.
- **No answer is kept in a browser's cache:** every answer but a CORS preflight carries `Cache-Control: no-store`, refusals and 429s included. The wallet asks with `cache: "default"` (web wallet 1.4.0), so Chrome reuses a preflight for as long as its `Access-Control-Max-Age` allows (24 h here, which Chrome caps at 2), instead of sending one before every POST.
- **At most 200,000 buckets.** Past that, refilled ones are dropped on the spot, at most once a second; if none are, a new client gets 503.

**Logs can't be turned up to show a request.** The database driver logs every query's parameters at debug, and axum's rejections quote bodies. Those libraries are held by a filter of their own, which every line must pass as well as `RUST_LOG`'s, so no directive there can raise them, however narrow its target. Checked with `RUST_LOG=tokio_postgres::query=debug`: no query parameters were logged.

## The private index

All routes are under `/seedelf/v1/mainnet/`.

| Route | Answer |
|---|---|
| `contract/snapshot` | the contract's rows unspent as of the stable `cursor` |
| `contract/since/{cursor}` | what changed after `cursor`: `created` (each with its `spent`, if it's gone since) and `spent` (older rows spent after it), plus the new stable `cursor` |
| `names` | every Seedelf name unspent at the tip, with the row that holds it |
| `lovejoin/pool` and `lovejoin/since/{cursor}` | the same for the mix box. Each box carries `made_by`: whether its transaction spent a box itself, and each input's payment and stake credentials |
| `lovejoin/pools` | every shown token pool as of the stable cursor (below): its reference UTxO, the seed its launch spent, its `mix_box` and `mix_logic` reference scripts at the holder (each row with its `script_hash`; the wallet derives the bytes), where its launch is (`tx`, `block`, `index` in the block, slot and time), and its `crowd`; and the classic pool's `crowd`. db-sync alone |
| `lovejoin/tokens` and `lovejoin/tokens/since/{cursor}` | the boxes of every shown token pool, read as `lovejoin/pool` and `lovejoin/since` are, with `pools`: the `mix_box` hashes covered, those shown as of the cursor (or `from`'s). A box's `mixed` is whether its transaction spent from its own pool. db-sync alone |
| `/health` | each part's state (`private`, `public`, `submit`), the private index's `source`, db-sync's and Kupo's tips and ages, and the node's as Ogmios says (`node`, with `connected`): 200 while the private index and the public routes answer, 503 when either can't. The submit part's state is said but not counted, since the deploy compares the status with the one before |

**How a wallet reads it:**

1. **A snapshot gives the settled view** as of a stable cursor `C`.
2. **`since/C` gives the changes after it.** The settled view plus `created` minus every spend is the view at the tip.
3. **The answer's `cursor` is the new settled point `C'`.** Apply only the entries at or below `C'` to the settled view. Everything above it is recomputed from the next answer, so a fork above a cursor never needs undoing.
4. **`reset: true`** means the cursor's own block was rolled back: start again from a snapshot. A reset carries no cursor, so none can be taken by mistake.

**An answer's cursor never goes back.** A source a little behind the one that handed out `from` answers with `from` itself as the cursor.

**What a cursor is:** `<slot>.<block hash>`: a slot that's a multiple of 200, at least 200 slots below the tip (about 10 blocks), and the hash of the newest block at or before it. The server refuses any other slot. Deep cursors almost never roll back. Shared cursors mean a request shows only roughly when its wallet last read, and that one answer serves everyone at that point.

**Two sources, one answer.** db-sync answers first (the owner, 2026-10-08). Kupo answers instead while db-sync is down, its tip over 3 minutes old, or more than 60 slots (about 3 blocks) behind Kupo's, and whenever a db-sync read fails.
- **A source is down** once its tip fails two reads in a row, and up again at the next good one. A read that takes 2 s has failed. Requests then skip that source at once, rather than each waiting on a timeout.
  - **The tip has a connection of its own,** so no burst of requests can starve the read that says whether db-sync is up.
  - **A read for a request gets 5 s** before the other source is asked.
  - **Postgres connections close** once sent bytes go 5 s unacknowledged, and idle ones are probed. A tunnel that drops packets would otherwise hold a dead connection for TCP's own 15 minutes.
  - **Checked by cutting each link mid-run,** both by closing it and by freezing it so nothing answers. The private index answered from Kupo within 8 s; with both gone, every route answered 503 at once; and both came back within 8 s.
- Both know every block by slot and hash, so a cursor from one is answered by the other, and a wallet never sees a switch.
- Their rows are the same, field for field and in the same order, with one exception: from Kupo, a box's `made_by.inputs` is `null`. Kupo indexes outputs at our two credentials, not who paid for a transaction.
- A source whose tip hasn't reached a cursor passes it to the other. If neither can answer, the route gives 503 with `Retry-After`, and the wallet goes to Koios.
- An answer Kupo makes from several reads is read again if Kupo's checkpoint moved between them (`X-Most-Recent-Checkpoint`), so it's always of one chain state.
- Kupo keeps every block's checkpoint from its start, block 11,305,805, the contract's first output. A cursor from before that is a `reset` from Kupo.

**Caching:** each source's answers are kept until its tip moves. Both tips are read every 2 s, so one set of reads per block serves every request.
- **Requests that miss together share one read.**
- **Each source keeps at most 4,096 answers and 64 MB.** A `since` answer from an old cursor can be hundreds of KB, and anyone can ask for one. The answers every wallet reads (the snapshots, the names, `epoch_params`, `totals`) are kept whatever the budget holds.
- **A failure is logged at most once every 10 s:** a source that's down fails every request.

## Lovejoin's token pools

The code is `src/lovejoin/`. Its checks are a copy of the wallet's: this workspace can't depend on `seedelf-core` (the owner, 2026-10-17: core keeps its own copy), so the two are held to one set of vectors.

**A pool is shown when it's standard and the earliest launched of its values** (the box's ADA and its token), by block, then place in the block, then id. Standard means:
- its reference UTxO is at the holder's enterprise address, with no reference script, holding one `lovejoin` NFT and ADA alone, and its datum decodes as `one_shot_mint` holds a launch to (`datum.rs`);
- its token is in the wallet's mainnet token list (`tokens/list.json`, built in: a release that lists a token is deployed here first), or it's an ADA pool at any amount but the classic pool's 10 ₳;
- one of its launch's inputs, the seed, makes its NFT's policy, and the datum names exactly the scripts that seed makes (`templates.rs`, `flat.rs`: the pinned templates applied by hand, with no Pallas, uplc or blst);
- its launch transaction itself put `mix_box` and `mix_logic` at the holder, and registered L, unless an earlier block did (the owner, 2026-10-17).

None of it changes once it's on chain, so each candidate is checked once and its verdict kept in memory (`discovery.rs`, at most 200,000; past that, a candidate is checked again at each request, and still shown when it's standard), and a pool shown stays shown. Everything at the holder is locked for good, so spam there is burned, and costs this server one check.
- **The holder is read on, not again:** each read gathers only the outputs above the highest id read so far (a later block's outputs have higher ids), and all of them again every hour, so a block rolled back under the stable cursor is forgotten within it. A read on joins only the read it went on from: one that finds it replaced meanwhile by an hourly read, perhaps of an older block, reads on again from that, so nothing between the two is missed (1.6.0's release review, DATA-3). What's refused is dropped from what's kept.
- **A launch's inputs are tried once each,** however many candidates it made.

**A pool's crowd** (`crowd.rs`): its boxes, the deposits they could have come from, and how many a mix made. A transaction that pays a pool's `mix_box` without spending from it is a deposit; one that spends from it is a mix, and each box it makes could have come from any deposit behind any of its inputs. The deposits counted are those some box in the pool now could have come from, worked backwards from the boxes through each mix. A box is an output of exactly the box value with a box's datum (two 48-byte points, `a ≠ b`: whether they're on the curve is the wallet's to check).

**Kept:** `lovejoin/pools` for its cursor (an hour), worked out once per cursor in a task of its own with a minute's budget, off any request: a request waits for it up to its 5 s, and one that waits no longer gets the last list meanwhile, or 503 before the first. The feed is kept for db-sync's tip.

**Held together with the wallet:**
- `seedelf-platform/seedelf-core/tests/fixtures/lovejoin-pool-vectors.json`, which `seedelf-core`'s `lovejoin_vectors_test.rs` writes from its own derive and datum decoder: ten seeds' four script hashes, and 32 datum encodings with what each reads as.
- `seedelf-platform/seedelf-web-wallet/extension/tests/fixtures/lovejoin-shown.json`: the earliest-of-each-value scenarios, which the wallet's `lovejoin-pools.ts` is tested against too.

## The public routes

Koios's paths and JSON, so a wallet falls back by changing its base URL. The code is `src/public/`.

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
| `account_reward_history` | one stake key's rewards, oldest first, 1,000 a page: Staking's *Rewards history* (web wallet chunk 30), read only when it's opened | never |
| `account_update_history` | one stake key's certificates — registered, staked, vote delegated, stopped — oldest first, 1,000 a page: Staking's *Delegation history* (web wallet chunk 36), read only when it's opened | never |
| `account_txs` | one stake key's transactions: a page of 20, at most 10,000 in, or up to 1,000 from a block on; for a key with at most 200,000 outputs. The restore scan, and Public activity up to wallet 1.4.1 | never |
| `credential_txs` | up to 75 payment credentials' transactions, whatever their addresses' staking part, paged as `account_txs` is; for at most 200,000 outputs in all. Public activity, by the account's payment keys (web wallet chunk 28) | never |
| `tx_info` | up to 20 transactions, in Activity's shape or inputs alone | never |
| `pool_list` | the registered pools, 1,000 a page | an hour, within its epoch |
| `pool_info` | up to 5 pools' details and live stake | 10 minutes, within its epoch |
| `pool_history` | one pool's last 18 epochs whose rewards are final: active stake, blocks, and what it paid its stake. A pool's *Return on stake* (web wallet chunk 37) | every pool's epoch, worked out once and kept for the server's life |
| `drep_info` | up to 5 DReps' standing | 10 minutes, within its epoch; the account's own (`deposit,meta_url,meta_hash` selected) never |
| `drep_metadata` | up to 5 DReps' profile names | 10 minutes; the account's own profile (`is_valid` selected) never |
| `proposal_list` | the live governance actions | 5 minutes, within its epoch |
| `vote_list` | one DRep's votes on up to 40 actions | never |
| `asset_nft_address` | the address holding one NFT (an ADA Handle) | never |
| `asset_info` | one token's CIP-25 and CIP-68 metadata | never |

**What one request may cost is bounded.** Any credential, address or stake key may be asked about, and some on mainnet hold hundreds of thousands of outputs: one listing of a credential with 220,000 read 2.4 GB from disk for every page. So a listing gathers at most 20,000 unspent outputs, and `account_txs` and `credential_txs` at most 200,000 outputs, with a page starting at most 10,000 transactions in. Past any of these, the answer is a 503, `{"error":"too large for this server"}`, with no `Retry-After`: it would be as large again, so the wallet reads Koios, for that request alone. No wallet comes near any of them. Requests are also held to the wallet's own sizes (one account's standing, 20 keys probed).

**Answers kept for a time are kept within their epoch,** since a pool's status, a DRep's activity and the live actions turn at an epoch's start. Not-found answers aren't kept: anyone can ask about made-up IDs. When the store is full, the answer due to expire soonest makes room.

**An ID has one spelling:** the bech32 the wallet sends, re-encoded exactly. The decoder also takes a Bech32m checksum and stray padding bits, which would let one pool be asked for, cached and worked out under several names.

**Only the wallet's requests.** Each route takes exactly the query string and body `koios.ts` sends: its parameters, in its order, at its sizes. Anything else is a 400, `{"error":"not a request Seedelf Wallet makes"}`, before any query runs, so no caller can compose an expensive one.

**Answers about one user are never cached.** Answers that are the same for everyone are kept for the time above. A request waits at most 5 s for a shared answer, its queue included, then gets a 503.

**Koios's names and types,** for every field the wallet reads. **What it never reads is left out:**
- the JSON of a datum or a script (`value` is null): `trimmed()` drops both, registers come from the bytes, and anyone can nest a datum thousands of levels deep;
- from `tx_info`: collateral, reference inputs, mints, scripts and proposals, and every certificate but the seven an account's own transactions make.

**The SQL is the API's own.** The home Postgres has no `grest` schema and no pg_cardano, and the API reads with the read-only role, so nothing at home is installed. Its indexes beyond db-sync's own are recorded in [deploy/home/db-sync-indexes.sql](deploy/home/db-sync-indexes.sql), with the command that lists what's there.
- It follows Koios's `grest` functions ([koios-artifacts](https://github.com/cardano-community/koios-artifacts), CC-BY-4.0) rule for rule: an account's standing, a pool's state and live stake, a DRep's activity and delegators, a token's minting metadata.
- **Where Koios relies on an index it adds, the query goes another way.** A stake key's addresses come from `address.stake_address_id`: 2 ms, against 6.7 s through `tx_out.stake_address_id`, which db-sync doesn't index. An address is found by its bytes (`address.raw`), not its text.
  - **The exceptions are three of Koios's own, on small tables:** `delegation_vote` by account and by transaction, and `voting_procedure` by transaction. Together they're 25 MB, and nothing else reads those tables faster. Built at home on 2026-10-09:

    | Query | Before (the table read whole) | After |
    |---|---|---|
    | `account_info` | 16–19 ms | 0.1–0.4 ms |
    | `tx_info`'s certificates, a page of Activity | 15 ms | 0.3–0.6 ms |
    | `tx_info`'s votes, a page of Activity | 1.7 ms | 0.03 ms |
- **IDs are made in Rust:** CIP-129 DRep, committee and governance action IDs (`src/ids.rs`).

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

**What stands in for Koios's caches:**
- **Token decimals** come from the Cardano token registry, Koios's own source: `api/data/token-decimals.json`, made by `scripts/token-decimals.py` from a checkout of it and built into the API. Refresh it the way the wallet refreshes its token list: the script, a commit, a build.
- **A pool's state** is worked out per request from its latest update and any retirement after it.
- **A pool's live stake** is summed over its live delegators: each account whose latest delegation is to the pool, not since deregistered, and in this epoch's stake, as Koios's `pool_delegators_list` counts them. Their reward sums change only at an epoch's start, so each account's is kept in memory for the epoch.
  - A first look at a large pool, read from a cold disk, took 12 s. So a request waits at most 3 s for the live figures, then answers with the epoch's snapshot (`pool_stat`) while they're finished in the background and kept.
  - Once a pool's figures are 10 minutes old, the next look gets them at once while fresh ones are worked out behind it, for 10 minutes more at most.
  - At most 2 pools are worked out at once, and a pool whose figures failed gets the snapshot for 5 minutes: a request naming several slow pools can't hold the public connections.
- **A token's latest minting metadata** is looked for among its latest 10,000 mints. Read whole, a token minted 573,000 times took past 20 s; this way, 0.1 s.
- **A token's supply and latest mint** are read from `ma_tx_mint`, which db-sync indexes by token.

**Every connection runs with `jit = off`.** JIT compiled plans whose estimates db-sync's `ma_tx_out` inflates: 76 of a UTxO query's 80 ms.

**The public routes have their own connections:** 6, beside the private index's 3, so a burst of them never holds the private index up.
- A query that waits 2 s for a connection, or runs past 10 s, answers 503, so the wallet goes to Koios rather than queueing.
- A connection that takes 3 s to open has failed, rather than waiting minutes on TCP.
- **While db-sync is down** (two failed reads of its tip), every public route answers 503 at once, kept answers included.
- A failed query logs only its SQLSTATE: a Postgres message can quote a value the request sent.

**`account_txs` and `credential_txs` never join a whole history.** A transaction's id rises with its block, so a page takes the newest ids it needs, its own and every newer one, widened to the whole of the oldest block they reach, and joins only those: 0.5 s a first page for a key with 221,000 transactions, against 2.3 s before, and the same rows. A deeper page needs more of them, and one past the end of a long list would need them all, so no page starts more than 10,000 in (Activity's 500th *Load more*): deeper, the answer is a 503, too large, and the wallet reads that page from Koios.
- **`credential_txs` gathers nothing past the cap:** a count from `tx_out`'s index alone gates the gathering, in the same query, so Minswap V2's pool script is refused in 0.1 s, against 4.9 s gathering its outputs to find out. `account_txs` is as it was.
- **A credential's outputs are gathered address by address,** never all its addresses first: a busy script's credential sits at millions of them, and the cap reaches at most as many addresses as outputs.
- **Checked against Koios (2026-10-11):** the same pages, row for row, for a wallet's key and for the contract's and mix box's credentials together, at offsets 0 and 20.

**`account_reward_history` is Koios's, from `reward` and `reward_rest`,** the pool's bech32 from `pool_hash.view`, sorted in SQL by the order the wallet asks for (`spendable_epoch.asc,earned_epoch.asc,type.asc,pool_id_bech32.asc,amount.asc`), oldest first by every column. The next epoch's rewards are listed before they're paid, as Koios's are.
- **Oldest first is what keeps the pages still while db-sync adds rows.** It adds an account's next rewards as an epoch goes on, and refunds at an epoch's start, and takes back those of a key deregistered before it was paid: all among the newest, at the end. Newest first, a row added between two pages pushed one already read onto the next page too, and the wallet counted it twice. The wallet shows the list newest first.
- **Checked against Koios (2026-10-12), oldest first:** every page the same, row for row, for the reward account 13 pools pay (5,766 rows), one 34 pools pay (2,513, pools' deposits back among them), a member the reserves and the treasury paid too (457), and a key never paid (none). All four, every page: 0.5 s from home.

**`account_update_history` is Koios's, less withdrawals:** a stake key's rows from `stake_registration`, `stake_deregistration`, `delegation` and `delegation_vote` (`registration`, `deregistration`, `delegation_pool`, `delegation_drep`), each with its transaction's hash and its block's epoch, slot and time, sorted in SQL by the order the wallet asks for (`absolute_slot.asc,tx_hash.asc,action_type.asc`). The request filters out Koios's fifth kind (`action_type=neq.withdrawal`): the wallet withdraws rewards with nearly every payment, and Activity has them.
- **A transaction's certificates of one kind for the key are one row,** as Koios's `union` makes them: a key delegated twice in each of two transactions has 31 rows, not 33.
- **Each kind is read by its key's `addr_id`,** through db-sync's indexes and home's `delegation_vote_addr_id_idx`. Mainnet's busiest re-delegator (1,282 pool delegations, 1,289 rows): 117 ms from a cold disk, 5 ms warm.
- **Checked against Koios (2026-10-14), oldest first:** every page the same, row for row, for that re-delegator (1,000 and 289), a key that stopped and registered again four times (16), the key delegated twice in one transaction (31), the reward account 13 pools pay (3: registered and delegated in one transaction, then its vote delegated), and a key never registered (none). Each page in 3–55 ms from home.

**`pool_history` is Koios's `grest.get_pool_history_data_bulk`, every pool's epoch at once and kept** (web wallet chunk 37). Each row is an epoch's active stake, the blocks made by slot leader, and `deleg_rewards`: the members' rewards earned in it and the leader's, less the pool's fees by the terms active then (`pool_update`, the latest by `active_epoch_no`), in floating point and rounded half to even, as Postgres works Koios's out. The 18 epochs are those whose rewards are final, two ago back 18, as Koios's newest is.
- **Why every pool's at once:** `reward` (457.5M rows, 33 GB) has `idx_reward_pool_id` and `idx_reward_earned_epoch`, none on both, so one pool over 18 epochs is read through the epochs and filtered: 21M rows for 0.6M, 3.2 s from a cold disk and 1.1 s warm for the pool with the most delegators (35,041), as much as every pool's. One epoch, every pool: 0.18 s (measured 2026-10-15). So each epoch is worked out for every pool once (`History`), 18 after a start, behind the requests every minute, and one more as an epoch turns; the oldest goes. A request waits at most 3 s for epochs still being worked out, then answers with those done.
- **The stake is `pool_stat`'s, a step ahead:** its row for epoch E − 1 is `epoch_stake`'s sum for E, which Koios reads, without an epoch's 1.3M `epoch_stake` rows. Its `number_of_blocks` is likewise the epoch before's; the blocks come from `block` (`idx_block_epoch_no`).
- **The newest epoch, worked out in its first hour** of being paid (3,600 slots), is worked out again 10 minutes on: db-sync inserts an epoch's rewards bit by bit until they're paid, and takes back at payday those owed to keys deregistered since. Koios's servers hold values cached at either stage, low or high: OctasPool's epoch 642 is 2,347, 14,373, 19,172 and 19,269 ₳ on four of them; db-sync's, final, is 19,172 ₳, and the 19,269 has about 98 ₳ more paid to members.
- **Better than Koios's:** its cache leaves every other epoch's `deleg_rewards` null on most of its servers, and two answers a minute apart differ; here every epoch has one. A pool that made blocks and was paid nothing (a pledge not met) paid `"0"`, where Koios says null. Koios lists a pool's newest 18 epochs with stake, however old; this lists those of the 18 newest it had stake in.

**`tx_info` reads its parts at once,** pipelined on one connection: two round trips to home, not six.

**Known slow cases:**
- `drep_info` reads `delegation_vote` whole, for every account's latest vote delegation: 260 ms for the DRep with the most delegators, then kept.
- **A pool's first look holds up whoever asks,** for up to the 3 s above. On a cold disk, a pool of 2,000 delegators took 1.6 s and the largest (35,000) took 7 s. Most of that is each delegator's reward history: 6.2 s cold and 1.1 s warm for the largest. The wallet asks for its own pool's details as Home first loads, for a ticker.
- **A credential at very many addresses costs one lookup per address:** 160 ms for one at 95,000.
- **A deep page of `account_txs` or `credential_txs` joins every newer transaction too,** so the deeper it starts, the more it costs, which is why none starts more than 10,000 in: for a busy key, 60 ms for that deepest page against 30 ms for its first (warm, at home, 2026-10-12).
- **A shared answer shows it was asked for.** A kept `drep_info` comes back in under a millisecond instead of 200–400 ms, so a prober could tell someone asked about that DRep in the last 10 minutes. Sharing answers is what keeps home's load flat, so this stands, as it does for every kept answer.

## The submit part

| Route | Upstream | The server's own checks |
|---|---|---|
| `POST /api/v1/submittx` | cardano-submit-api, `POST /api/submit/tx` | the body is `application/cbor` (415 if not) and at most 16 KiB, the ledger's `max_tx_size` (413 if more); at most 4 in flight (503 past it) |
| `POST /api/v1/ogmios` | Ogmios, `POST /` | `application/json` (415 if not: a `text/plain` POST needs no CORS preflight, so a web page could send one); a JSON-RPC 2.0 `evaluateTransaction` and no other method (400); at most 64 KiB; at most 2 in flight |

- **Answers pass through untouched,** status and body. Koios fronts the same two services, so the error strings the wallet classifies stay what they are. They matched Koios's byte for byte on 2026-10-08.
- **No connection** to home (refused, or none within 3 s) is a 503 with `Retry-After`: nothing reached the node, so the wallet sends through Koios at once.
- **No answer** on a connection that opened is a 502, or a 504 after 30 s: to the wallet, either one means "maybe sent". Each request opens a fresh connection, so one that died with the tunnel can't hold a submit for the full 30 s.
- **It depends on the node and Ogmios alone,** so db-sync can be down. Ogmios's `/health` gates both paths (below), so an Ogmios restart sends submits to Koios for its few seconds.
- **Only while the node is synced.** A node catching up after a restart refuses a valid spend of anything newer than its tip as spent, and Ogmios evaluates one as an unknown input: both answers the wallet would take as the node's own. So Ogmios's `/health` is read every 2 s, as db-sync's and Kupo's tips are, and while the node's tip is more than 3 minutes old, Ogmios can't reach the node (it replays its ledger after a restart), or `/health` has failed two reads in a row, both paths answer 503 `behind` with `Retry-After`, and the wallet goes to Koios at once. It counts the tip's own slot, not `networkSynchronization` (a step of its last decimal is about 48 minutes) or `lastTipUpdate` (a node catching up moves its tip every moment). Without an Ogmios configured, the node's sync is unknown, and the submit part answers 503.
- **Nothing is cached or logged:** not a transaction, not its ID, not an upstream's URL. reqwest's own error messages carry the URL, so errors are logged by kind only.

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
- **The address** is the exact bech32. The contract has outputs in both enterprise and staked form.
- **A point is a slot and its time,** with no block height: Kupo has none. Every row is from Shelley on, where a slot is a second, so its time is the slot plus 1,591,566,291.
- **`made_by.inputs`** is `null` when Kupo answered.

## The SQL

**Every query starts from the credential's own outputs, in a `MATERIALIZED` CTE.** Left to itself, the planner can start from every transaction since a cursor instead: for two days of mainnet that's 880,000 transactions and 3.5 s, against 9.5 ms this way.

**Every value is cast or encoded to a plain type in SQL,** so db-sync's domain types never reach the driver.

**The role it reads with is read-only:** SELECT only, `default_transaction_read_only`, a 60 s timeout.
