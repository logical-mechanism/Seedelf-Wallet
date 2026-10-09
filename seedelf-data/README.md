# seedelf-data

Seedelf Wallet's data layer: the API in front of the home db-sync. **Mainnet only.** The plan, and every decision behind it, is web wallet chunk 26, [docs/plans/chunk-26-data-layer.md](../seedelf-platform/seedelf-web-wallet/docs/plans/chunk-26-data-layer.md).

**Its own Cargo workspace,** apart from `seedelf-platform/`, so nothing here moves the CLI's `Cargo.lock`. It pins the same Rust (`rust-toolchain.toml`).

## What's built

- **The private index** of the Seedelf contract and Lovejoin's mix box, read from db-sync. Every answer is the same for whoever asks: none names a UTxO, a register or an owner. The wallet keeps deciding which rows are its own.
- **The submit part:** Koios's `/api/v1/submittx` and `/api/v1/ogmios` paths, passed to the home cardano-submit-api and Ogmios.
- **The public routes:** the other 20 Koios endpoints the wallet uses, under Koios's own `/api/v1/` paths and JSON, taking only the requests `koios.ts` makes.

**Still to come:**
- Kupo as the private index's second source;
- the VPS layer: rate limits, CORS, TLS.

## Run it locally

```bash
cp .env.example .env     # then fill it in; git ignores it
cargo run -p seedelf-data-api
curl http://127.0.0.1:8099/health
```

**Listening:** it listens on loopback (`DATA_LISTEN`, `127.0.0.1:8099` by default). Nothing limits it yet, so don't expose it.

**Logging:** it logs its start and failed queries only. It never logs a request's address, path or body.

## Reference code

`_reference/` holds shallow clones to read and optimise against. Git ignores it, and its own README says what's where. To recreate it:

```bash
mkdir -p _reference && cd _reference
for r in cardano-community/koios-artifacts blockfrost/blockfrost-backend-ryo \
         IntersectMBO/cardano-db-sync cardano-community/guild-operators; do
  git clone --depth 1 "https://github.com/$r.git"
done
```

- **koios-artifacts** is the public routes' starting point. It's CC-BY-4.0, so credit it wherever its SQL is used.
- **blockfrost-backend-ryo** is a second set of db-sync queries to compare query plans against.

**Token decimals** need a checkout of the token registry (about 500 MB), wherever it's kept:

```bash
git clone --depth 1 https://github.com/cardano-foundation/cardano-token-registry.git
python3 scripts/token-decimals.py cardano-token-registry > token-decimals.json
```

## Tests

```bash
cargo test                                    # offline
cargo test -- --ignored --test-threads=1      # against the real db-sync in .env
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

**One test at a time:** the database role allows 10 connections, and a running server holds some of them.

**What the live tests check:**

- **The public routes,** by what must hold however the chain moves:
  - the contract's and mix box's `credential_utxos` equal the private index;
  - a page after any outpoint is the rest;
  - every `tx_info` balances: inputs and withdrawals against outputs, fee, deposit and donation;
  - the pool list's pages make one sorted list;
  - an NFT's `asset_info` equals Koios's recorded answer.

- **The private index:** from cursors a day, two days, a month back, and from before the contract existed, the snapshot plus the delta replays exactly to the rows unspent at the tip, for both credentials.
- **The submit part,** at no cost, since nothing sent can ever land: bytes that aren't a transaction, the contract's first transaction resubmitted (`All inputs are spent`), and Ogmios's error for evaluating it, each passed through as the service gave it. It also covers what the server refuses itself.

**Checked against Kupo (2026-10-09):** the API's view of the tip matched Kupo's unspent set, 32 of 32 for the contract and 41 of 41 for the mix box. Kupo is a source independent of db-sync, so this is the end-to-end check. It held from the current cursor and from one two days back: 43 rows created there, and 91 boxes created and 41 spent.

## The private index

All routes are under `/seedelf/v1/mainnet/`.

| Route | Answer |
|---|---|
| `contract/snapshot` | the contract's rows unspent as of the stable `cursor` |
| `contract/since/{cursor}` | what changed after `cursor`: `created` (each with its `spent`, if it's gone since) and `spent` (older rows spent after it), plus the new stable `cursor` |
| `names` | every Seedelf name unspent at the tip, with the row that holds it |
| `lovejoin/pool` and `lovejoin/since/{cursor}` | the same for the mix box. Each box carries `made_by`: whether its transaction spent a box itself, and each input's payment and stake credentials |
| `/health` | db-sync's tip and its age: 200 while the private index and the public routes answer, 503 when it's behind |

**How a wallet reads it:**

1. **A snapshot gives the settled view** as of a stable cursor `C`.
2. **`since/C` gives the changes after it.** The settled view plus `created` minus every spend is the view at the tip.
3. **The answer's `cursor` is the new settled point `C'`.** Apply only the entries at or below `C'` to the settled view. Everything above it is recomputed from the next answer, so a fork above a cursor never needs undoing.
4. **`reset: true`** means the cursor's own block was rolled back: start again from a snapshot.

**What a cursor is:** `<height>.<block hash>`, always at least 10 blocks below the tip, at a multiple of 10. The server refuses any other height. Deep cursors almost never roll back. Shared cursors mean a request shows only roughly when its wallet last read, and that one answer serves everyone at that point.

**Caching:** answers are kept until db-sync's tip moves. They're read every 2 s, so one set of queries per block serves every request. A tip older than 3 minutes makes every route answer 503 with `Retry-After`, so the wallet goes to Koios.

## The public routes

Koios's paths and JSON, so a wallet falls back by changing its base URL. The code is `src/public/`.

| Route | What the wallet asks | Kept |
|---|---|---|
| `credential_utxos` | up to 75 payment credentials' unspent outputs, 1,000 a page by outpoint, optionally only blocks after a height | a block, for the contract's or mix box's; otherwise never |
| `address_utxos` | up to 20 addresses' unspent outputs, paged the same way | never |
| `utxo_info` | up to 60 outputs, spent or not | never |
| `datum_info` | up to 60 datums' CBOR | never |
| `tip` | the newest block | read every 2 s |
| `tx_status` | up to 100 transactions' confirmations | never |
| `epoch_params` | the newest epoch's parameters | a block |
| `totals` | the newest epoch's supply | a block |
| `account_addresses` | up to 75 stake keys' addresses, empty ones too | never |
| `account_info` | up to 10 stake keys' standing | never |
| `account_txs` | one stake key's transactions: a page of 20, or up to 1,000 from a block on | never |
| `tx_info` | up to 20 transactions, in Activity's shape or inputs alone | never |
| `pool_list` | the registered pools, 1,000 a page | an hour |
| `pool_info` | up to 5 pools' details and live stake | 10 minutes |
| `drep_info` | up to 5 DReps' standing | 10 minutes |
| `drep_metadata` | up to 5 DReps' profile names | 10 minutes |
| `proposal_list` | the live governance actions | 5 minutes |
| `vote_list` | one DRep's votes on up to 40 actions | never |
| `asset_nft_address` | the address holding one NFT (an ADA Handle) | never |
| `asset_info` | one token's CIP-25 and CIP-68 metadata | never |

**Only the wallet's requests.** Each route takes exactly the query string and body `koios.ts` sends: its parameters, in its order, at its sizes. Anything else is a 400, `{"error":"not a request Seedelf Wallet makes"}`, before any query runs, so no caller can compose an expensive one.

**Answers about one user are never cached.** Answers that are the same for everyone are kept for the time above.

**Koios's names and types,** for every field the wallet reads. **What it never reads is left out:**
- the JSON of a datum or a script (`value` is null): `trimmed()` drops both, registers come from the bytes, and anyone can nest a datum thousands of levels deep;
- from `tx_info`: collateral, reference inputs, mints, scripts and proposals, and every certificate but the seven an account's own transactions make.

**The SQL is the API's own.** The home Postgres has no `grest` schema and no pg_cardano, and the API reads with the read-only role, so nothing at home is installed or changed.
- It follows Koios's `grest` functions ([koios-artifacts](https://github.com/cardano-community/koios-artifacts), CC-BY-4.0) rule for rule: an account's standing, a pool's state and live stake, a DRep's activity and delegators, a token's minting metadata.
- **Where Koios relies on an index it adds, the query goes another way.** A stake key's addresses come from `address.stake_address_id`: 2 ms, against 6.7 s through `tx_out.stake_address_id`, which db-sync doesn't index. An address is found by its bytes (`address.raw`), not its text.
- **IDs are made in Rust:** CIP-129 DRep, committee and governance action IDs (`src/ids.rs`).

**What stands in for Koios's caches:**
- **Token decimals** come from the Cardano token registry, Koios's own source: a file made by `scripts/token-decimals.py` from a checkout of it (`MAINNET_TOKEN_DECIMALS`). Without the file, every token is 0. Refresh it the way the wallet refreshes its token list.
- **A pool's state** is worked out per request from its latest update and any retirement after it.
- **A pool's live stake** is summed over its live delegators. Their reward sums change only at an epoch's start, so each account's is kept in memory for the epoch.
  - A first look at a large pool, read from a cold disk, took 12 s. So a request waits at most 3 s for the live figures, then answers with the epoch's snapshot (`pool_stat`) while they're finished in the background and kept.
  - Once a pool's figures are 10 minutes old, the next look gets them at once while fresh ones are worked out behind it.
- **A token's supply and latest mint** are read from `ma_tx_mint`, which db-sync indexes by token.

**Every connection runs with `jit = off`.** JIT compiled plans whose estimates db-sync's `ma_tx_out` inflates: 76 of a UTxO query's 80 ms.

**The public routes have their own connections:** 6, beside the private index's 3, so a burst of them never holds the private index up.
- A query that waits 2 s for a connection, or runs past 10 s, answers 503, so the wallet goes to Koios rather than queueing.
- A failed query logs only its SQLSTATE: a Postgres message can quote a value the request sent.

**Known slow cases:**
- `account_txs` for an account with a very long history: 1.8 s a page for one with 189,000 transactions.
- `account_info` reads `delegation_vote` whole, which isn't indexed by account at home: 19 of its 20 ms.
- `drep_info` reads it whole too, for a DRep's delegators: 250 ms for the DRep with the most, then kept.

## The submit part

| Route | Upstream | The server's own checks |
|---|---|---|
| `POST /api/v1/submittx` | cardano-submit-api, `POST /api/submit/tx` | the body is `application/cbor` (415 if not) and at most 16 KiB, the ledger's `max_tx_size` (413 if more); at most 4 in flight (503 past it) |
| `POST /api/v1/ogmios` | Ogmios, `POST /` | a JSON-RPC 2.0 `evaluateTransaction` and no other method (400); at most 64 KiB; at most 2 in flight |

- **Answers pass through untouched,** status and body. Koios fronts the same two services, so the error strings the wallet classifies stay what they are. They matched Koios's byte for byte on 2026-10-08.
- **No answer** is a 502 (unreachable) or a 504 (timed out after 30 s): to the wallet, either one means "maybe sent".
- **It depends on the node alone,** so db-sync can be down.
- **Nothing is cached or logged:** not a transaction, not its ID, not an upstream's URL. reqwest's own error messages carry the URL, so errors are logged by kind only.

## A row

```json
{
  "ref": "<tx hash>#<index>",
  "address": "addr1…",
  "lovelace": "1749860",
  "assets": [["<policy>", "<name>", "1"]],
  "datum": "d8799f5830…",
  "script": true,
  "created": { "block": 11330824, "slot": 144889937, "time": 1736456228 },
  "spent": { "block": 14044000, "slot": 199943000, "time": 1791509291, "by": "<tx hash>" },
  "made_by": { "mixed": true, "inputs": [["<payment cred>", "<stake cred or null>"]] }
}
```

- **Omitted when empty:** `assets`, `datum`, `script`, `spent` and `made_by` (Lovejoin only).
- **`datum`** is the inline datum's raw CBOR. The wallet's own parser decides what it means.
- **The address** is the exact bech32. The contract has outputs in both enterprise and staked form.

## The SQL

**Every query starts from the credential's own outputs, in a `MATERIALIZED` CTE.** Left to itself, the planner can start from every transaction since a cursor instead: for two days of mainnet that's 880,000 transactions and 3.5 s, against 9.5 ms this way.

**Every value is cast or encoded to a plain type in SQL,** so db-sync's domain types never reach the driver.

**The role it reads with is read-only:** SELECT only, `default_transaction_read_only`, a 60 s timeout.
