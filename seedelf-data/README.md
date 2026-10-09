# seedelf-data

Seedelf Wallet's data layer: the API in front of the home db-sync. **Mainnet only.** The plan, and every decision behind it, is web wallet chunk 26, [docs/plans/chunk-26-data-layer.md](../seedelf-platform/seedelf-web-wallet/docs/plans/chunk-26-data-layer.md).

**Its own Cargo workspace,** apart from `seedelf-platform/`, so nothing here moves the CLI's `Cargo.lock`. It pins the same Rust (`rust-toolchain.toml`).

## What's built

- **The private index** of the Seedelf contract and Lovejoin's mix box, read from db-sync. Every answer is the same for whoever asks: none names a UTxO, a register or an owner. The wallet keeps deciding which rows are its own.
- **The submit part:** Koios's `/api/v1/submittx` and `/api/v1/ogmios` paths, passed to the home cardano-submit-api and Ogmios.

**Still to come:**
- the Koios-equivalent public routes (`/api/v1/…`);
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

## Tests

```bash
cargo test                  # offline
cargo test -- --ignored     # against the real db-sync in .env
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

**What the live tests check:**

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
| `/health` | db-sync's tip and its age: 200 while the private index answers, 503 when it's behind |

**How a wallet reads it:**

1. **A snapshot gives the settled view** as of a stable cursor `C`.
2. **`since/C` gives the changes after it.** The settled view plus `created` minus every spend is the view at the tip.
3. **The answer's `cursor` is the new settled point `C'`.** Apply only the entries at or below `C'` to the settled view. Everything above it is recomputed from the next answer, so a fork above a cursor never needs undoing.
4. **`reset: true`** means the cursor's own block was rolled back: start again from a snapshot.

**What a cursor is:** `<height>.<block hash>`, always at least 10 blocks below the tip, at a multiple of 10. The server refuses any other height. Deep cursors almost never roll back. Shared cursors mean a request shows only roughly when its wallet last read, and that one answer serves everyone at that point.

**Caching:** answers are kept until db-sync's tip moves. They're read every 2 s, so one set of queries per block serves every request. A tip older than 3 minutes makes every route answer 503 with `Retry-After`, so the wallet goes to Koios.

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
