# Chunk 26 · The data layer

Branch `web-wallet/data-layer`, from `main`.

**Status: planned (2026-10-08), no code yet.**

**1.4.0's focus** (the owner, 2026-10-08):

- a data layer built only for Seedelf Wallet;
- whatever UX and UI fixes users send in, as a track of their own beside it.

This plan is the data layer's side. The wallet's side, the client that uses it, gets its own plan when it starts. Its contract is fixed in [The wallet's side](#the-wallets-side).

**Why now.** On mainnet the Koios public tier is slow and its limits bite:

- "Couldn't read your balances" after an unlock ([Kept in mind](../post-release-roadmap.md#kept-in-mind));
- the splash reaching its 8 s cap;
- `TIMEOUT_MS` at 45 s, because one `credential_utxos` over an account with real history "can take tens of seconds".

The shape recorded on 2026-10-02 in [post-release-roadmap.md's *The data layer*](../post-release-roadmap.md#the-data-layer) still holds, and this plan builds on it.

**No cloud node, no cloud db-sync: there's no money for it.** So:

- the node, db-sync and Postgres run at the owner's home, for mainnet and preprod, on hardware that's ready;
- a cheap VPS holds the public API and reaches home through a tunnel, which hides the home IP and takes the DoS;
- Koios stays as the fallback for when the house loses power or internet.

## The owner's calls (2026-10-08)

- **All 22 Koios endpoints the wallet uses move** to the data layer. Koios becomes the fallback only.
- **Hardware:** at least 64 GB of RAM and at least 2 TB of NVMe.
- **Settings:** one **Koios-only switch**. The default is the data layer, which falls back to Koios by itself ([private by default](../privacy.md): "default" never means "only").
- **The code lives in this repo**, as a new top-level `seedelf-data/` with its own Cargo workspace, so the CLI's `Cargo.lock` never moves. It's open source, because the no-log promise rests on people being able to audit it.
- **Three parts, each with its own health and its own fallback:**
  1. **the private index**: Seedelf and Lovejoin, purpose-built. "Really important for the private side."
  2. **the public side**: Koios-equivalent endpoints, optimised for us;
  3. **submits**, through **cardano-submit-api**.
- **Private state is kept across a lock.** The full download happens only on a restore from the phrase. "Imagine a million-UTxO DB in a browser, and that is nonsense": the browser holds no chain database ([What the browser keeps](#what-the-browser-keeps)).

**Still holding from 2026-10-02:**

- a Rust service written for this wallet;
- the CLI stays on Koios;
- giveme.my is unchanged;
- **the ownership check stays in the wallet**: the server is never asked "which of these are mine";
- no third-party edge.

## Choices made here (the owner can overturn any)

1. **Kupo feeds the private index.** It isn't strictly required: db-sync holds every contract row. It earns its place three ways.
   - **It makes the private side independent of db-sync.** db-sync does its heaviest work at epoch boundaries, and an upgrade sometimes means a resync of several days. Kupo needs only the node.
   - **It's built for exactly this:**
     - narrow patterns;
     - rollbacks handled for us;
     - `created_after` and `spent_after` filters;
     - the spending transaction's ID on every spent output;
     - inline datums resolved (`?resolve_hashes`).
   - **It's tiny.** For two script hashes its database is MBs and it uses 256 MB–2 GB of RAM. It resyncs from the contracts' deployment in hours, not days.
2. **The public side copies Koios's paths and JSON.** Falling back is then a change of base URL, and the WebAssembly's `UtxoResponse` parser and the e2e fixtures stay valid.
   - Underneath sit Koios's own `grest` SQL functions ([koios-artifacts](https://github.com/cardano-community/koios-artifacts), CC-BY-4.0, credited), on a db-sync set up with Koios's own insert options.
   - "Optimised for us" means:
     - only the parameter shapes the wallet sends;
     - our indexes;
     - cached shared answers;
     - our own SQL wherever a Koios function measures slow.
   - **PostgREST is never run or exposed.**
3. **Every line of custom code lives on the VPS.** Home runs stock software plus SQL: the node, db-sync, Postgres, Kupo, Ogmios and submit-api.
4. **Once synced, home reaches the internet only through the tunnel.** Otherwise the node's P2P traffic, the propagation of submits and db-sync's off-chain metadata fetches would each show strangers the home IP. A peer watching where Seedelf transactions are first seen could pin it down.
5. **The node is pinned to 11.0.1**, which Kupo 2.12 and Ogmios v7.0.0 are tested against. The node is at 11.1.3 now. Move up only when a hard fork needs it, after Kupo and Ogmios pass on preprod.

## The shape

```
 Chrome extension ──HTTPS──▶ VPS (public IP, ours)                       Home (no inbound ports, own VLAN)
 Koios on 503 /              Caddy: TLS, no access log                   cardano-node 11.0.1 ×2 (mainnet, preprod)
 timeout, per part           seedelf-data-api (Rust):                    Kupo 2.12 ×2   (Seedelf + Lovejoin patterns)
                               /seedelf/v1  private index (in memory)    db-sync 13.7 ×2 → Postgres (grest schema)
                               /api/v1      Koios-equivalent, 22 routes  cardano-submit-api ×2, Ogmios v7 ×2
                               buckets, caches, breakers, /health        timers: Koios cache jobs, host_status
                             WireGuard server ◀══ tunnel, dialled out ══ WireGuard client (default route once synced)
```

**The home box never sees a user's IP:** every request reaches it from the VPS. The VPS keeps IPs only in its rate limiter's memory.

## The private index (Seedelf and Lovejoin)

**What it serves.** The current unspent set at two script credentials, and what changed since any point:

- the Seedelf contract, `94bca9c0…a469`, the same on both networks;
- Lovejoin's mixBox: preprod `67ffe4ed…`, mainnet `c145c10f…` ([networks.ts](../../extension/src/networks.ts)).

**Every answer is the same for every user.** Each is cached once and costs home nothing per request. No request ever names a UTxO, a register or an owner.

**The source: Kupo at home**, one instance per network:

- **Connection:** the node's socket.
- **Patterns:** `<contract-hash>/*` and `<mixBox-hash>/*`.
- **`--since`:** the block before the earliest deployment.
  - No deployment slot is recorded anywhere, so find it once from db-sync. Use the reference transactions in [constants.rs](../../../seedelf-core/src/constants.rs) and Lovejoin's deployment transactions (in the gitignored `_reference/Lovejoin/artifacts/`).
  - Record it in [seedelf-contracts/README.md](../../../../seedelf-contracts/README.md) and the data layer's config.
- **Unpruned**, so spent outputs keep their spending transaction. The database stays MBs, and its full history is what a private-history restore could use later.
- **Chain points, not block heights.** Kupo reports a slot and a header hash.
  - The feed's cursors are points.
  - A row's time is exact from its slot (Shelley onwards).
  - The wallet orders private coins by slot; today `coin-control.ts` orders them by `block_height`.

**The builder** lives in `seedelf-data-api`, in memory.

- **Every 2 s** it reads Kupo's `/health` checkpoint.
  - On a new block it pulls `created_after=S&resolve_hashes` and `spent_after=S` for each pattern.
- **What it keeps:**
  - rows, by outref;
  - a change log;
  - Seedelf names, each pointing at its outref.
- **A rollback:** Kupo's `/checkpoints/{slot}` no longer holds the last header hash applied.
  - The builder rebuilds from `?unspent` and records the rollback point.
- **A restart** rebuilds the same way: one call per pattern.

**The compact row** carries what the wallet uses, and nothing else:

- **`ref`**.
- **`address`**, the exact bech32.
  - Both forms sit at the contract: enterprise (`addr…w…`) and staked (`addr…z…`).
  - A spend's local evaluation uses the address bytes.
- **`lovelace`**, and **`assets`** as `[policy, name, quantity]`.
- **The raw inline datum**, in hex.
  - A register is `Constr 0 [G1, G1]`, 103 or 104 bytes; both encodings are on chain.
  - The wallet's own parser stays the authority, and junk UTxOs are handled as they are today.
- **`script`**, when the output carries a reference script. The wallet never spends one.
- **The created point.**

**Dropped:**

- `stake_address` and `epoch_no`, never read for contract rows;
- fingerprints, which the wallet derives locally (CIP-14);
- decimals, which come from the bundled token list (0 for an unknown token, as Koios gives it).

**Size:** a row is about 400 bytes of JSON, against about 1 KB for a trimmed Koios row today. It compresses only to about 60%, because a register's points are random.

**Routes**, under `/seedelf/v1/{network}/`. All are shared and all are cacheable.

| Route | Answer | Notes |
|---|---|---|
| `contract/since/{cursor}` | `{cursor, created: [rows], spent: [{ref, by}], reset?}` | The workhorse: every unlock and refresh. **Cursors are quantised**: to 10 blocks within the last day, to a day before that. Answers are shared per window, and a request shows the last unlock only roughly. `reset` comes with a rollback point if the cursor's block was rolled back. |
| `contract/shards`, then `contract/shard/{id}` | the manifest `{point, shards: [{id, rows, version}]}`, then each shard's rows at its own point | **A restore only.** The set is sharded by the outref's transaction-hash prefix, and a shard is re-cached only when one of its rows changes. **v1 serves one shard** (mainnet's contract is 27 UTxOs, preprod's about 1,000), but the format allows 16 or 256 from the start, so growth needs no wallet change. Afterwards the wallet calls `since(oldest point)` to catch up; duplicates are harmless. |
| `names/{bucket}` | the rows of the Seedelfs whose name hash starts with `bucket` | **Paying a Seedelf**, by its exact full name only (`5eed0e1f` and 56 hex characters), never a prefix search: tags aren't unique. Today a name resolves from the kept view with no request at all. Without a full set kept, a bucket keeps that close: the service learns a bucket, never the payee. v1 has one bucket, the whole list, which is tiny today. |
| `lovejoin/pool` and `lovejoin/since/{cursor}` | the same row and delta shapes, and per box its creating transaction's **provenance**: `mixed`, and `inputs: [[payment_cred, stake_cred]]` | The pool is small, so one snapshot is enough. It replaces the full mixBox `credential_utxos` listing on every look. `mixed` comes from Kupo (the transaction spent a mixBox output). `inputs` come from db-sync, and are `null` while db-sync is down. A box's created point gives the time that `waitedAt`, `backOrder` and `ripeAt` use. |

**Provenance replaces `madeBy`'s `tx_info`** ([lovejoin.ts](../../extension/src/background/lovejoin.ts)). That `tx_info` is the one request that today tells the service which pool boxes are yours. The wallet now matches input credentials against its own account keys locally.

**The server sends every row at the two credentials.** The wallet's own filters stay the authority:

- `registerOf`;
- `PoolBox::from_row`: exactly 10 ₳, no assets, `a ≠ b`, points of prime order.

### What it takes off the per-user side

The feed gives a watch everything it needs to stop asking about one transaction:

- each `spent` entry carries the spending transaction;
- each `created` row carries the creating one;
- every answer carries the tip.

A watch polls the same shared `since` everyone calls.

| Today, per user, through Koios | With the feed |
|---|---|
| `tx_status` of each private spend, every 15 s ([pending.ts](../../extension/src/background/pending.ts)) | its inputs appear in `spent`, `by` its transaction |
| `tip`, for an expiry | the feed's tip |
| `utxo_info` on a maybe-sent spend's own contract inputs | answered locally |
| `tx_status` of a Lovejoin withdraw, and of deposit, mix and back chains | the boxes and contract rows they spend and create |
| `tx_status` and `utxo_info` for a public mix that may have gone through | mostly, through the boxes it created |
| a session's out and back `tx_status` ([sessions.ts](../../extension/src/background/sessions.ts)) | the contract rows they spend and create |
| `madeBy`'s `tx_info` | the pool feed's provenance |

**Still per user, by nature:**

- the submit itself;
- giveme.my's witness on every private spend;
- Ogmios's evaluation of a Lovejoin mix draft and of an account-paid mint draft;
- the one-time accounts' reads during swaps, which are public-side.

**The blind spot closes.** Spends made with the same phrase on another device now show up, which today's catch-up read can't see.

## What the browser keeps

**No chain database, because it doesn't need one.** A contract UTxO's register never changes. So once a row has been checked and isn't yours, the wallet never has to look at it again. The server keeps the index.

**The wallet keeps a few KB**, sealed with the vault the way contacts are, in `chrome.storage.local`:

- the cursor (slot and header hash);
- your own unspent rows, each the full row a spend needs;
- your pending spends;
- Lovejoin's sealed box records, as today.

There's no IndexedDB and no `unlimitedStorage`. Nothing else is kept: Seedelf names come from a bucket when needed, and the Lovejoin pool from its snapshot.

**An unlock:**

1. Decrypt the private state.
2. Call `since(cursor)`.
3. Check only the new rows, in the WebAssembly.
4. Drop the rows that were spent.

Home shows the private balance at once, marked stale until the delta lands. That fixes the private half of "Couldn't read your balances".

**A restore from the phrase:**

1. Fetch the shards.
2. Check every row as it streams in: keep yours, drop the rest.
3. Call `since(oldest point)`.

**At scale, the restore is the cost, not the storage:** one G1 scalar multiplication per row. Measure the WebAssembly's time per row, which sets how long a restore takes on a large contract, and give the restore a progress bar.

**The trade, said plainly:** your own rows are kept at rest, encrypted. That is the second candidate in *Kept in mind*'s balances item, chosen now for the private side. The public side's last reading can follow it in the wallet's chunk.

## Submits

**cardano-submit-api runs at home**, one per network, on the node's socket.

- **It's reached only as the VPS route `POST /api/v1/submittx`:** Koios's path, `Content-Type: application/cbor`, and a 16 KiB body cap (the ledger's `max_tx_size`).
- **Koios fronts the same service,** so the transaction ID and the error strings the wallet classifies match: `BadInputsUTxO`, `OutsideValidityIntervalUTxO`, `FeeTooSmallUTxO` and the rest.
- **Limits:**
  - never cached, and never logged, not even the transaction ID;
  - a bucket per IP;
  - at most 4 in flight to home.
- **It depends on the node alone,** so submits keep working while db-sync resyncs.
- **The transaction spreads from the home node,** whose traffic leaves through the tunnel. The network sees the VPS's IP.
- **Ogmios** (`evaluateTransaction` only) shares this part and its health check, with at most 2 in flight.
- **A "maybe sent" answer** goes through the wallet's existing resend logic. That may resend through Koios if ours is down, which is safe: the same signed transaction can be sent twice.

## The public side: Koios-equivalent, optimised for us

**The 22 routes, under `/api/v1/`.**

- Each accepts exactly the parameter shapes [koios.ts](../../extension/src/background/koios.ts) sends. Anything else is a 400, so no caller can compose an expensive query.
- Each is backed by the `grest` function of the same name.
- **Shared answers are cached:**

  | Answer | Kept |
  |---|---|
  | `tip` | 2 s |
  | `epoch_params`, `totals` | an epoch |
  | `pool_list` | 1 h |
  | `proposal_list` | 5 min |
  | `pool_info`, `drep_info`, `drep_metadata` | 10 min, by ID |
  | the contract's or mixBox's `credential_utxos` (the fallback's shape) | a block |

- **Answers about one user are never cached.**
- **Caps on each request:**
  - a body of at most 16 KB;
  - at most 75 credentials and 60 refs;
  - at most 20 transaction hashes for `tx_info`, and 100 for `tx_status` (which the wallet must start chunking);
  - at most 40 vote IDs.

**db-sync's `insert_options` are Koios's own** (guild-operators' `files/configs/mainnet/db-sync-config.json`):

- `tx_out: {value: "consumed", use_address_table: true}`, and `ledger: "enable"`;
- shelley, multi_asset, metadata and plutus on;
- governance, both off-chain fetchers and `pool_stat` set to `"enable"`;
- `json_type: "text"`;
- `tx_cbor: "disable"`.

`consumed` and the address table can only be set on an empty database. If the box already has a db-sync synced with other options, it has to resync.

**Koios's SQL.**

- Install the pinned koios-artifacts tag's `grest` schema and indexes.
- Run only the cache jobs those 22 functions depend on, as systemd timers. Expect pool-info, active-stake, stake-distribution, epoch-info and asset-info.
- The token-registry job isn't needed: the wallet bundles its list.

**The API's Postgres role:**

- read-only;
- `statement_timeout` of 5 s;
- a pool of about 20 connections.

Postgres runs with `log_statement = none`, so no one's credentials land on disk.

## Home

- **RAM.** With both networks on one 64 GB box, run mainnet db-sync with `ledger_backend: "lsm"`: about 2–3 GB instead of 21. Keep the nodes in memory. Kupo adds less than 2 GB each.
- **Disk.** Mainnet is about 650 GB and growing (db-sync's May 2025 figures: node 203 GB, Postgres 438 GB, ledger files 10 GB). Alert at 75%, and use high-endurance NVMe.
- **Isolation:**
  - its own VLAN: no port forwards, no UPnP, an outbound-only node;
  - Postgres, Kupo, Ogmios and submit-api listen on localhost and `wg0` only;
  - nftables lets in the VPS and nothing else.
- **Power.** A UPS with NUT shuts things down in order: db-sync, Postgres, Kupo, the node. An unclean stop costs a long ledger replay.
- **Status.** A one-row `seedelf.host_status` table gives `/health` the home's state without another channel. A timer fills it with free disk and each service's state.
- **Start mainnet db-sync now: it takes days.** The node, bootstrapped with Mithril, and Kupo take hours.

## Tunnel and VPS

**WireGuard, dialled out from home.**

- The home IP is known only to the VPS and its provider.
- Once synced, home's default route is `wg0`. Measure the node's P2P traffic first: the docs say about 1 GB an hour for a relay, and an outbound-only node uses less.

**The VPS:**

- 2 vCPU and 4 GB, in the region nearest home;
- L3/L4 DDoS filtering that never terminates TLS ([roadmap](../post-release-roadmap.md#dos-protection-on-clearnet--the-owners-question): "an upstream that sees only encrypted bytes");
- traffic for the P2P relay, about 1–2 TB a month;
- **terms that allow blockchain workloads.** Hetzner's don't: it has banned running nodes since 2022.

**Caddy terminates TLS, with no access log.**

- DNS names only the VPS: `https://mainnet.<domain>` and `https://preprod.<domain>`, the domain being the owner's pick.
- **CORS answers the extension's origin only.** The wallet needs a `connect-src` entry and **no new host permission**: no install warning, nothing disabled on update, and the store's nearly full host-permission box unchanged.

**Limits:**

- **Buckets per IP**, in memory, weighted: a cached answer ≪ live SQL < a submit < an evaluation. Over the limit is a 429 with `Retry-After`, as Koios does.
- **Global caps on what's in flight to home.** Past them, a 503 at once, so wallets go to Koios instead of queueing.
- **A monthly egress ceiling** that answers 503, so no bill can surprise anyone.

**Health and breakers, one per part:**

| Part | Healthy when |
|---|---|
| private | Kupo's checkpoint is within 3 blocks of the node's tip, and that tip is under 2 min old |
| public | db-sync's newest block is under 3 min old |
| submit | the node's tip is under 2 min old |

- **A tripped breaker answers 503 for its own part only,** cached answers included: a stale contract set would offer UTxOs already spent.
- `/health` reports all three.

**No logs:**

- no access or body logs;
- error logs never carry an IP or a body;
- metrics are aggregate counters only.

## The wallet's side

**Its own chunk. This contract is what it builds to.**

- **`networks.ts`** gets a `data` origin beside `koios`.
- **Fallback is per part:**
  - The private index falls back to today's Koios `credential_utxos` scan, which gives the same view, only slower.
  - The public side swaps its base URL.
  - Submits fall back to Koios's `/submittx`.
- **What triggers it:** a transport error, a timeout (about 10 s), a 5xx, a 503 or a 429 sends that part to Koios for 5 minutes. A read restarts on Koios rather than mixing pages from two backends.
- **Rate limiting:** `KOIOS_LIMIT` stays for Koios, and the data layer gets a limiter of its own.
- **Private state:**
  - the cursor and your rows, sealed with the vault;
  - the incremental check;
  - the restore, with shards and a progress bar;
  - name buckets in place of the scan's `seedelfs` map;
  - private watches (spends, withdraws, chains, a session's out and back) reading the feed instead of `tx_status`;
  - `madeBy` reading the pool's provenance;
  - private coins ordered by slot.
- **Settings:** the Koios-only switch.
- **The manifest:** the CSP's `connect-src`, which `tests/manifest.test.ts` pins.
- **Tests:** the e2e fakes answer the new origin, and new tests cover the fallback.
- **Docs and the policy, in the same PR, before it ships:**
  - [the privacy policy](../store/privacy-policy.md), with a dated Changes entry;
  - [privacy.md](../privacy.md), [architecture.md](../architecture.md) and [store/README.md](../store/README.md) (`connect-src` only);
  - the root [README](../../../../README.md)'s IP-tracking and *Data Layer Reliance* sections;
  - the root CLAUDE.md's "Koios is the sole data layer".

## What the service learns

This is for the policy, in [the roadmap's words](../post-release-roadmap.md#dos-protection-on-clearnet--the-owners-question).

- **The private index** learns:
  - that an IP uses Seedelf;
  - roughly when it last unlocked;
  - that it's watching for something, while it polls more often;
  - a bucket, when it pays a name.

  It never learns a UTxO, a register, a box, a transaction or an owner.
- **The public side and submits** learn which credentials, transactions and UTxOs an IP asks about, and every transaction it sends. That's what Koios learns today, moved to Logical Mechanism, which also runs giveme.my.
- **IPs exist only in the VPS's memory.**
- **When ours is down, the wallet asks Koios.**
- **The no-log promise is a policy and an open-source audit trail, not a proof.**

## Cost

Monthly and rough; check prices when buying.

| Item | Cost |
|---|---|
| VPS: 2 vCPU, 4 GB, 1–2 TB traffic, DDoS filtering, terms that allow nodes | $6–15 |
| Domain | $0–1 |
| TLS, monitoring (a free uptime check of `/health` only) | $0 |
| Home power, 100–200 W around the clock | $10–30 |
| A UPS (about $150–300, once), and an NVMe replacement (about $150 every few years) | $5–10 amortised |
| **Cash in all** | **about $20–55** |

**The real cost is time:**

- a node upgrade before every hard fork: preprod first, with Kupo and Ogmios checked each time;
- db-sync upgrades once koios-artifacts publishes matching SQL, with a resync now and then, which the private part and submits ride out;
- incidents.

## Order of work

0. **Now:** start mainnet db-sync, and find both contracts' first-output points.
1. **The preprod stack at home:**
   - the node, Kupo, db-sync with `grest` and the cache jobs, submit-api and Ogmios;
   - the Postgres role;
   - the UPS.

   Measure RAM, disk and sync times.
2. **The VPS:** WireGuard, nftables, DNS, Caddy and `/health`. Then home's egress moves to the tunnel.
3. **`seedelf-data/`, in this order:**
   1. the private index (the builder, `since`, shards, names, Lovejoin), then `submittx` and `ogmios`;
   2. the public routes by traffic: `credential_utxos`, `account_addresses`, `account_info`, `tip`, `epoch_params`, `tx_status`, `utxo_info`, `tx_info`, `account_txs`, then the rest;
   3. alongside: `deploy/home`, `deploy/edge` and a runbook. Secrets are never committed.
4. **Mainnet**, with parity checked there.
5. **The wallet's chunk.**
6. **The drills**, then 1.4.0.

## Verification

- **Private parity.** For test wallets on both networks, the private index gives the same owned set and Seedelf names as today's Koios scan. Replaying `since` from many cursors matches a fresh snapshot.
- **Rollbacks.** A reset is forced in a test against a scripted Kupo, then real ones are watched on preprod for a day.
- **Scale.** Build a synthetic contract of 1M rows offline, in the WebAssembly's test harness, and measure:
  - a restore's time and peak memory;
  - shard sizes;
  - `since` sizes after a day and after a month.
- **Public parity.** A harness replays `koios.ts`'s request shapes against Koios and against ours, and compares the fields the wallet reads. **It runs from the VPS**, on that machine's own Koios allowance, never the owner's.
- **Grammar.** Every off-grammar request is refused with a 400.
- **Load,** from a third machine:
  - 429s per IP, 503s past the global caps;
  - the private index served without touching home: Kupo's request count stays flat.
- **Drills.** Each part falls back on its own:
  - stop Kupo: private only;
  - stop db-sync: public only, and submits still work;
  - stop the node: everything;
  - drop the tunnel;
  - cut home power;
  - stop the VPS.
- **Leaks:**
  - no IP or body in any log;
  - no egress from home but `wg0`;
  - DNS and certificate-transparency logs name only the VPS.

## Left for later

- [privacy review §4.7](../archive/plans/privacy-review.md), a URL of your own;
- **a private-history restore**, which unpruned Kupo already keeps the data for;
- the notification centre;
- **view tags**, a contract change and so a new variant, which would cut a restore's checks by about 256×;
- a pruned, match-everything Kupo (about 12 GB on mainnet) for account UTxOs, if db-sync's `credential_utxos` ever measures slow;
- the CLI moving off Koios (not planned).
