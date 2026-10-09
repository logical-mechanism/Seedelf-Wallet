# Chunk 26b · The wallet's side of the data layer

Step 4 of [chunk 26](chunk-26-data-layer.md#order-of-work): Seedelf Wallet reads mainnet through `seedelf-data`, falling back to Koios one part at a time. Preprod doesn't change.

**Status: 📝 planned (2026-10-09).** Branch `web-wallet/data-layer-wallet`, from `main` once #289 (the API) has merged.

**Read first:**
- the parent plan's [The wallet's side](chunk-26-data-layer.md#the-wallets-side), the contract this builds to;
- its [What the browser keeps](chunk-26-data-layer.md#what-the-browser-keeps) and [What it takes off the per-user side](chunk-26-data-layer.md#what-it-takes-off-the-per-user-side);
- [seedelf-data/README.md](../../../../seedelf-data/README.md), for what each route answers.

## The VPS comes after, and nothing here waits on it

The owner's call (2026-10-09): **the VPS comes last**, on DigitalOcean. It gets a write-up of its own, with a manual deploy action.

- **Built and tested against the local API from a dev build:** `cargo run -p seedelf-data-api` on this machine, against the home server.
- **The store build carries no data-layer origin** until the VPS chunk sets one. So this chunk can merge, and even ship in a release, without changing what any user's wallet does.
- **Then the VPS chunk does the rest:**
  - one constant, the API's real `https://` origin;
  - the CSP test's expected strings;
  - the privacy policy and the user-facing docs ([Docs](#docs-now-and-at-the-vps)).

## The owner's calls this builds on

**From chunk 26 (2026-10-08):**
- mainnet only;
- every endpoint moves, and Koios is the fallback;
- one Koios-only switch in Settings, the data layer by default;
- fallback is per part: the private index, the public side and submits each go to Koios on their own;
- the private state is kept across a lock, sealed, and a full download happens only on a restore;
- the ownership check stays in the wallet;
- giveme.my is unchanged.

**From 2026-10-09:**
- the watches move onto the private index's feed here, not before;
- Home's first reading must not wait seconds on `pool_info` for a ticker.

## How it fits together today

All paths in this section are under `extension/src/`.

- **One place makes every Koios client:** `background/sw.ts:173`, a closure handed to every service as `koios: (network) => Koios`. Nothing else reaches Koios:
  - the WebAssembly uses only `seedelf-koios`'s types;
  - the other `fetch`es are giveme.my, Minswap, CoinGecko and the IPFS gateway.
- **Origins come from `networks.ts`:**
  - `networkOrigins()` feeds both the manifest's `host_permissions` and the CSP's `connect-src`;
  - `corsOrigins()` (Minswap) feeds `connect-src` only, with no host permission, because those services answer with CORS headers.
  - The API answers CORS for the wallet's origin (`DATA_ORIGINS`), so **its origin belongs with `corsOrigins`**: no new host permission, and nothing more asked at install.
- **`tests/manifest.test.ts` pins the exact `connect-src` and host lists** for each build kind. With no origin set they stay as they are.
- **Builds:** `vite.config.ts` reads only `VITE_ENABLE_MAINNET` and `VITE_STORE_BUILD`. There's no dev-only origin mechanism yet.
- **The private side** (`background/contract-scan.ts`):
  - **What's kept:** the view sits in `chrome.storage.session` (`seedelf.contract.<network>`), unsealed and wiped on lock. It holds your rows, a `seedelfs` name map, the highest block seen, and when the last full read was.
  - **When it's read in full:** after every unlock, every 30 minutes, and after `forgetContractView`. In between, a catch-up reads from `block_height − 2`.
  - **Its blind spot:** a catch-up drops only your own spends. A spend made on another device, or someone else's Seedelf removed, stays in the view until the next full read.
- **The WebAssembly parses every row as Koios's `UtxoResponse`** (`seedelf-koios/src/koios.rs:181`).
  - **It requires** `payment_cred`, `epoch_no`, `block_height`, `block_time` and `is_spent`, and each asset's `decimals` and `fingerprint`.
  - **It only reads** `payment_cred` (the contract and mix-box checks, the signer count), `reference_script`'s presence, `datum_hash`, and `is_spent` for DEX orders.
  - The rest must be there for a row to parse.
- **The 15 s confirmation watch is Home's** (`ui/screens/Home.tsx`, `WATCH_EVERY_MS`). Elsewhere:
  - Lovejoin checks a chain every 5 s;
  - a session's steps run at most every 15 s;
  - the worker's alarm runs every minute.
- **Sealed records** (`background/private-store.ts`): XChaCha20-Poly1305 under a key HKDF'd from the vault's entropy, padded to 1 KiB or the next power of two, named in `PRIVATE_RECORDS`.

## Choices made here (the owner can overturn any)

1. **One origin constant, with an override for dev and e2e.**
   - `networks.ts` gets `data?: string` on mainnet only, left empty until the VPS chunk.
   - `VITE_DATA_ORIGIN` overrides it in dev and e2e builds, through a `define`.
   - `scripts/package.mjs` refuses to package a store build made with the override, as it refuses one without Koios.
2. **The fallback lives in the factory, per method, per part.**
   - The closure at `sw.ts:173` becomes a factory that returns today's `Koios` on preprod, with no origin, or with the switch on.
   - Otherwise it returns a wrapper with the same methods. Each method runs on the data layer, and on a failure that calls for it, runs again **from its start** on Koios.
   - So a paged read never mixes pages from two backends.
   - The failed part stays on Koios for 5 minutes, remembered in `chrome.storage.session` as Koios's 429 hold is.
3. **The private index's rows become `UtxoResponse`s in TypeScript,** so no builder changes. A new adapter fills:
   - `payment_cred` from the route (contract or mix box);
   - `epoch_no` from the slot (Shelley's 432,000-slot epochs);
   - `block_time` from `created.time`;
   - `block_height` as 0, since nothing on the private side reads it once the catch-up cursor is gone;
   - `is_spent` as false;
   - `inline_datum.bytes` from `datum`;
   - a `reference_script` when `script` is set;
   - each asset's `fingerprint`, worked out locally (CIP-14, as `ui/tokens.ts` does when one is missing).
4. **The API adds decimals to each row's assets.** This is a small server change, in this chunk.
   - **Why:** a token missing from the bundled list gets its decimals only from Koios's rows today. Without this it would show as an NFT-like whole number.
   - **How:** both sources fill decimals from the registry file the API already loads, so db-sync and Kupo stay byte-identical.
   - The alternative, `asset_info` per token, would tell the server which tokens a wallet holds.
5. **Watches read the feed every 5 s while one is open.**
   - The answer is shared and kept for a block, so each check costs one unit at the edge and nothing at home.
   - The service learns that someone is watching, as chunk 26's [What the service learns](chunk-26-data-layer.md#what-the-service-learns) accepts.
6. **Home's reading never waits for a ticker.**
   - `readStake` gives the pool by ID when no ticker is known on the device, and asks `pool_info` behind the reading. The next render shows the ticker.
   - This was measured in the first-load pass: a pool nobody looked at in 10 minutes held Home up to 3 s.
   - The first-load pass suggested `pool_list` for the ticker. Its three pages come to about 600 KB, too much for one ticker on a fresh restore.

## The steps

### 1. The origin, the switch and the CSP

- **Config:**
  - `networks.ts`: `data` on mainnet, unset;
  - `vite.config.ts`: `VITE_DATA_ORIGIN` → `__DATA_ORIGIN__`, which wins over the constant only outside a store build;
  - `corsOrigins()` takes the data origin when there is one;
  - `package.mjs` refuses the override.
- **`tests/manifest.test.ts`:** today's strings stand with no origin. New cases cover an origin set: it's in `connect-src`, never in `host_permissions`, and a store build refuses the override.
- **The switch:**
  - a `koiosOnly` preference, default `false`, in `shared/preferences.ts` and checked in `background/preferences.ts`'s `get` and `set`;
  - a row in Settings' Privacy section, mainnet only and hidden on preprod: "Read Cardano through Koios only";
  - its keys in `en`, `es` and `ja`.
  - The factory reads the switch at each request, as `prices.ts` reads `currency`.
- **Locally:** run the API with the dev build's pinned extension ID in `DATA_ORIGINS`, and build with `VITE_DATA_ORIGIN=http://127.0.0.1:8099`.

### 2. The public side and submits, through the factory

- **Two clients under one face:**
  - `new Koios(<origin>/api/v1, …, DATA_LIMIT)` and today's `Koios`;
  - `DATA_LIMIT` is a `RateLimit` sized under the edge's bucket (300 units, 10 a second; 1 for shared answers, 4 for live SQL, 10 for a submit), with Koios's `KOIOS_LIMIT` untouched;
  - reads time out at 10 s on the data layer, against Koios's 45 s.
- **What sends a read to Koios** (marking `public` down for 5 minutes):
  - no answer;
  - a timeout;
  - any 5xx;
  - a 429, whose `Retry-After` becomes the part's hold, if longer;
  - a 403, meaning the API doesn't know this wallet's origin;
  - a 400 `not a request Seedelf Wallet makes`, which is a bug between `koios.ts` and the API, logged in dev builds.
- **"Too large for this server"** (a 503 with no `Retry-After`) goes to Koios for that call only, without marking the part down.
- **Submits are their own part, and the rule is whether the transaction could have reached the node:**
  - **Straight to Koios** when it can't have:
    - no connection to the API at all;
    - a 429;
    - a 503 at the in-flight cap;
    - a 403.
  - **Maybe sent** when it might have: a 502, a 504, or a timeout once the request has gone out.
    - That's the existing maybe-sent path in `pending.ts`. Its resend goes through the factory, so through Koios if the part is down, which is safe: it's the same signed transaction.
    - The data layer's submit timeout is 35 s, so the API's own 504 at 30 s arrives first.
- **`ogmios`** only reads, so it falls back to Koios on any failure.
- **The errors users see don't change.** A data-layer failure isn't shown; it falls back. Only Koios's own failures reach the screens, in today's words, which name Koios correctly.

### 3. Home's pool ticker

`staking.ts`'s `readStake` stops awaiting `poolRef`, as [choice 6](#choices-made-here-the-owner-can-overturn-any) says. Its tests and Home's staking card show the ID until the ticker arrives.

### 4. The private index: the contract

- **`background/private-index.ts`:**
  - the client for `contract/snapshot`, `contract/since/{cursor}`, `names`, `lovejoin/pool` and `lovejoin/since/{cursor}`;
  - its own part (`private`), with the same fallback rules and `DATA_LIMIT`.
- **The adapter** ([choice 3](#choices-made-here-the-owner-can-overturn-any)). A test parses its output through the WebAssembly's own `UtxoResponse`.
- **The sealed state:**
  - a record `contract.mainnet` in `PRIVATE_RECORDS`;
  - it holds the settled cursor, your settled rows as the API gave them, and the refs already checked;
  - it's written after each answer that moved the cursor.
- **An unlock or refresh:**
  1. Open the record.
  2. `since(cursor)`.
  3. Check only the `created` rows not yet checked, a batch of 200 a queue turn as today.
  4. Build the view at the tip: the settled rows, plus what's created, minus every spend.
  5. Fold only the entries at or below the answer's `cursor` into the record. Everything above is recomputed from the next answer.
  - **A `reset`:** snapshot, check every row, then `since(snapshot's cursor)`.
- **A restore** has no record, so it takes the snapshot path.
  - The contract holds about 32 unspent rows today, so a progress bar waits until it's needed.
  - The parent plan's 1M-row measurement is in [Verification](#verification).
- **`readContractView` keeps its signature,** so its callers don't change: balances, transfer, `script-spend`, send and sessions.
  - It reads the private index when the part is up, and today's Koios scan when it's down.
  - **The Koios scan never moves the sealed cursor:** once the data layer is back, `since(cursor)` catches up.
  - `forgetContractView` becomes "read the feed again".
  - The `block_height` catch-up stays only for the Koios path.
- **Names:**
  - The `seedelfs` map comes from the `names` route (shared, kept a block) instead of from a full read's rows.
  - `transfer.lookup` asks it, and `withdraw.ts`'s Remove keeps finding your own Seedelf in the map.
  - This closes today's blind spot: another device's spends and removed names now show at once.
- **The UTxOs screen's "Block" line** shows the date and time for a private coin, since rows carry no height. Its key changes in all three languages.

### 5. Lovejoin

- **The pool:**
  - `lovejoin.ts`'s `listing` reads `lovejoin/pool` instead of `credential_utxos(mixBox)`;
  - the pool is small, so one snapshot per look is enough;
  - the adapter fills `payment_cred` with the mix box, which `PoolBox::from_row` checks.
- **Where a box came from:**
  - `madeBy` reads `made_by` from the row instead of `tx_info`;
  - `mixed` maps directly;
  - `inputs` are matched against your accounts' keys as today;
  - this removes the one request that told Koios which boxes are yours.
- **`inputs: null`** means Kupo answered. The box stays in `asking`, as one Koios didn't answer does today, and is looked up again on the next look.
- **Ordering:** `backOrder`, `ripeAt` and `waitedAt` use `created.time` where they use `block_time` today.

### 6. Watches onto the feed

| Watch | Today | On the feed |
|---|---|---|
| A private spend (Home) | `tx_status` every 15 s | its inputs in `spent`, `by` its hash |
| A move-in, an account-paid mint, an account send to a Seedelf, a session's way back | `tx_status` | its rows in `created` |
| A session's way out | `tx_status` | the contract rows it spends, in `spent` |
| A Lovejoin chain, a withdraw, a box coming back | `tx_status` every 5 s | mix-box rows in `lovejoin/since` |
| An expiry | `tip` | the answer's `tip.slot` |

- **Polled every 5 s** while a watch is open ([choice 5](#choices-made-here-the-owner-can-overturn-any)).
- **Still `tx_status`**, now on the public side: anything that touches only key addresses. That's account sends, staking and DRep transactions, collateral, swap legs, a session's funding reaching its key address, and a public mix's deposit.
- **A watch whose part is down** asks `tx_status` as today. Maybe-sent logic doesn't change.

### 7. Tests

- **Unit:**
  - every fallback trigger and the 5-minute hold;
  - a paged read restarting on Koios;
  - the submit rules (Koios versus maybe sent);
  - the adapter through the WebAssembly's parser;
  - the sealed state across a lock;
  - applying `since`, including entries above the cursor, a `reset`, and the Koios scan leaving the cursor alone;
  - `names`;
  - `made_by` with `inputs: null`;
  - each watch on the feed.
  - `tests/fakes.ts` dispatches on a path's last segment, so it can serve the new routes beside Koios's.
- **e2e:**
  - Today's specs are preprod and unaffected, their `credential_utxos` counts included.
  - The data layer's specs run on mainnet (`test.use({ network: "mainnet" })`), on a build made with `VITE_DATA_ORIGIN` set to a test host.
  - Its fake is a new fixture file, since sessions never open `e2e/support.ts` (it holds the test vectors' secrets).
  - CI gains that build and its pass in `.github/workflows/web-wallet.yml`.
- **The API:**
  - decimals in the row (the README's *A row*, the live tests' parity checks);
  - the dev build's origin in `DATA_ORIGINS` for local runs.

### Docs: now, and at the VPS

- **In this chunk,** where developers read:
  - `architecture.md` (*Chain data*, *Networks*, the CSP);
  - `development.md` (the dev build against the local API; the network-panel checklist);
  - the root `CLAUDE.md`'s "Koios is the sole data layer".
  - Each says the store build doesn't use the data layer yet.
- **In the VPS chunk, the PR that gives the store build its origin,** where users read, all before it ships:
  - the privacy policy, with a dated *Changes* entry, the *In short*, the data table, and *The services the extension talks to*;
  - `privacy.md`;
  - `store/README.md` (descriptions, the remote-code and data-usage answers);
  - the root README's *De-Anonymizing Via IP Tracking* and *Data Layer Reliance*.
- **Nothing in the store build changes until then,** so nothing user-facing is untrue in between.

## Verification

All of it is free. There's no preprod for the data layer, and no real-money tests.

- **Private parity:** on the owner's own wallets, a dev build's owned set, names and balances equal the Koios scan's, with the switch off and on.
- **Fallback, locally:**
  - stop the API mid-use;
  - start it with a wrong `DATA_ORIGINS` (403s);
  - start it with db-sync unreachable (the private index answers from Kupo, the public side 503s);
  - hammer it to a 429.
  - Each part moves to Koios on its own and comes back after 5 minutes.
- **Restore** on a fresh profile, and an unlock after a lock: one `since` request, not a full read.
- **Scale:** the parent plan's synthetic 1M-row contract in the WebAssembly's test harness, measuring the ownership check per row, a restore's time and peak memory, and `since`'s size after a day and a month.
- **Spends:** in the owner's ordinary use, after merge. The e2e fakes can't complete private spends (giveme.my's signature).

## What a wallet asks, before and after (mainnet)

| | Today, through Koios | With the data layer |
|---|---|---|
| An unlock | a full contract scan, every row checked | one shared `since`, only new rows checked |
| Every 30 minutes | another full scan | nothing more |
| Paying a Seedelf by name | the kept view, or a catch-up scan | one shared `names` |
| A Lovejoin look | the whole mix box, plus `tx_info` per box of unknown origin | one shared `lovejoin/pool` |
| A private spend's confirmation | `tx_status` every 15 s | the shared feed every 5 s |

## Left for the VPS chunk

- the droplet, WireGuard, nftables, Caddy, DNS and `/health`, from [seedelf-data/deploy/README.md](../../../../seedelf-data/deploy/README.md);
- **a manual deploy workflow:** build with the pinned toolchain, ship the binary, restart, check `/health`, roll back;
- **CI for `seedelf-data/`,** which has none today;
- the store build's origin and the user-facing docs above;
- home's egress through the tunnel, then the drills.
