# Chunk 36 · Delegation history

The owner asked for it on 2026-10-14: "branch off into a … delegation history branch for the public wallet. Then add it in. We can model what lace does here."

**Status: ✅ built 2026-10-14** on `web-wallet/delegation-history`, from `main` after #309. One PR: the build, the data layer's route and the docs together, so this file went straight to the archive, as chunk 30's did. What still holds is in [architecture.md](../../architecture.md) (*Staking*: the requests), [flows.md](../../flows.md) (*Staking and voting*: the page), [privacy.md](../../privacy.md) (*What Koios learns*) and [seedelf-data's README](../../../../../seedelf-data/README.md) (the route). **The privacy policy is unchanged:** its staking row already says your staking goes to the Cardano server as your stake address, and nothing is kept. That's the reading chunk 30 took for the rewards; the owner may want a dated entry anyway.

## What Lace does (2.4.2, `_reference/lace` at `e431933`)

- **Where:** the Staking tab → a staked account's card → the *Your Stake* sheet, whose **Activity** list it is. The card opens it only while the account is delegated to a pool, so a key that stopped has no way to it.
- **What:** Blockfrost's `accounts/{stake}/delegations`, `/registrations` and `/withdrawals`, every page, on each opening, then three requests per row's transaction (`txs/{hash}`, its CBOR, its UTxOs) and one per input of a registration's or deregistration's transaction, for the deposit. Its rewards (`/rewards`, kept on the device) are merged in. Closing the sheet throws it all away.
- **The rows:** *Stake Delegation*, *Stake registration*, *Stake de-registration*, *Withdrawal* and *Reward*, grouped by day, each with the time and an amount (a delegation's fee, the deposit, the deposit back less the fee, the withdrawal). **No row names its pool:** the pool ID is dropped as the row is made (a TODO, LW-13466). **No vote delegation** is listed at all. A row opens the transaction's details: its certificates with the pool or DRep, the deposit, the fee and a link to Cardanoscan.
- **Its bugs, not copied:** a failed transaction fetch leaves the spinner up for good, and its retries replay a settled promise (`from(promise)`, not `defer`), so they never ask again.

## What this wallet does

- **The same idea, on its own page:** **Delegation history**, a row above Stop staking while the stake key is registered, pool or not, and on its own once it isn't but was ever paid (`rewarded`, as Rewards history). Rewards keep their own page (chunk 30).
- **The rows:** *Stake key registered* (−2 ₳), *Staked with LOGIC*, *Voting power to Always abstain* (a DRep by its name in the wallet's list, or *your own DRep*), *Stopped staking* (+2 ₳). Each pool and vote named, which Lace's rows don't; the vote listed, which Lace's aren't.
- **Withdrawals left out,** where Lace lists them: the wallet withdraws the rewards with nearly every payment by default (Settings' *Use staking rewards when spending*), so they'd bury the rest, and Public activity lists them. The page's ⓘ says where they are.
- **By year, newest first, 50 rows at a time,** as Rewards history; a row opens its details, as Activity's do: the pool or the vote, the deposit, the epoch, the time, the transaction's ID with Copy, and View on Cardanoscan.

## The requests

```text
POST account_update_history?select=action_type,tx_hash,epoch_no,absolute_slot,block_time
     &action_type=neq.withdrawal&order=absolute_slot.asc,tx_hash.asc,action_type.asc&offset=0&limit=1000
{"_stake_addresses":["stake1…"]}
```

then `tx_info` for the transactions it lists, Activity's own request (20 a request), for what each certificate names.

- **Koios's `account_update_history`** lists a key's registrations, deregistrations, pool and vote delegations and withdrawals, but not which pool or DRep. The certificates in `tx_info` do (`pool_id_bech32`, `drep_id`, a registration's `deposit`), read by Activity's `stakingOf`, which counts only a certificate naming this stake key.
- **Oldest first,** as the rewards are asked since 1.5.0's release review: a certificate landing while it's read is on the last page. Reversed, a transaction's rows come registration, pool, vote.
- **A deregistration's certificate carries no refund** on Koios or the data layer, so a stop shows the deposit its own registration took: 2 ₳ on both networks since Shelley, and Conway refunds what was paid.
- **Bounded:** the newest 200 transactions are named (`NAMED_TXS`, 10 requests). Mainnet's busiest re-delegator has 1,282 pool delegations (1,289 rows): its older rows say only what they did ("Staked with a pool"). Two requests for nearly every account.
- **Only when asked,** and kept nowhere: opening Staking costs what it did.

## The data layer (mainnet)

A 23rd public route, `POST /api/v1/account_update_history` (`api/src/public/account.rs`), taking exactly the request above (one stake key, that select, filter and order, `limit=1000`, an `offset` that's a multiple of 1,000, up to 100,000). About one user, so never kept.

- **The SQL** follows Koios's `grest.account_update_history` (CC-BY-4.0) less its withdrawal arm: `stake_registration`, `stake_deregistration`, `delegation` and `delegation_vote` by `addr_id`, combined with `union` as Koios's are, so a transaction's certificates of one kind for the key are one row (a mainnet key delegated twice in each of two transactions has 31 rows, not 33, on both), joined to `tx` and `block`, sorted in SQL as the order says.
- **Indexes:** db-sync's `idx_stake_registration_addr_id` and `idx_stake_deregistration_addr_id`, home's `idx_delegation_addr_id_tx_id` (read from the index alone) and `delegation_vote_addr_id_idx`. The busiest key: 117 ms cold, 5 ms warm.
- **Checked against mainnet Koios on 2026-10-14,** every page, row for row, through a local run on home's db-sync: a key that registered and delegated in one transaction then delegated its vote (3 rows), one that stopped and registered again four times (16), one delegated twice in one transaction (31), the busiest re-delegator (1,000 and 289), and a key never registered (none). 3–55 ms a page from home.
- **The live test compares against Koios's recorded answer** (`api/tests/fixtures/account-update-history.json`, each a start of the live answer, since a history only grows at its end), as the NFT metadata's does: the crate's `reqwest` has no TLS, and calling Koios from a test would add one to what the deploy builds.
- **Deploy it before the wallet ships:** an API without the route answers 404, and any failure holds the wallet's public part on Koios for 5 minutes. Once it's deployed, `.prev` lacks the route, so [deploy/README.md](../../../../../seedelf-data/deploy/README.md)'s rollback note needs its line for this build.

## The wallet

- **koios.ts `delegationHistory`,** and `DataLayerKoios`'s override, as every public read; `dataCost` is 4.
- **staking.ts `delegationHistory`** (the `delegation-history` request): the active account's stake key; each row checked (a kind the wallet knows, a hash, whole epoch and time) before its transaction is asked about; named from the transaction; the stop's deposit carried from its registration; a vote to the account's own DRep marked (`ownDrep`, from the key); pools named from the device alone (`poolsKnown`).
- **The page** (`Delegations.tsx`): the note that it's read from the server each time; the years; the rows, an icon, what it did, the day and epoch, the deposit; **Show more**; the details. Hidden balances hide the deposits.
- **16 new strings,** none critical (no warning, privacy note or alert); Spanish and Japanese machine-translated, as recorded in the provenance files.

## Tests

- **Data layer:** `public_grammar.rs` takes the one request and refuses every other (page size, offset, the filter moved or changed, another select or order, newest first, two keys, an extra field); `live_public.rs` reads the five keys whole: one list in the order, no row twice, five columns, four kinds, the time and epoch its slot's, and Koios's recorded answer its start.
- **Wallet:** `staking.test.ts`: the exact request, 12 rows in their order with the stop's deposit and the own DRep, tickers from the session and the pool list with no `pool_info`, past 1,000 a page and 20 transactions a request, rows left out without asking about their transactions, the 200-transaction cap, someone else's certificate in the same transaction ignored, deposits carried oldest first, and the active account's key; `data-layer.test.ts`: every page on the data layer, or all again on Koios when one fails; `delegations-screen.test.ts`: the years, the rows' words, a row with nothing named, hidden amounts, 50 at first, nothing yet, and where Staking offers it; `e2e/extension.spec.ts`: opening Staking asks nothing about it, the page asks twice, a row's details link the transaction, and it's read again each time it opens (ten runs in a row on 2 CPUs on the dev and store builds, all passed).
- **The fixture:** `tests/fixtures/record-delegations.mjs` records the 12-word account's history from preprod (12 certificates in 7 transactions: registered twice, stopped once, two pools, three votes, the newest to its own DRep) and those transactions' certificates. The fakes serve the route in the order asked, and add the certificates to the one transaction Activity's recording holds too (Activity's tests don't notice).

## Left for later

- **A key that registered and stopped without ever being paid** has no row to reach its history: `account_info` alone can't tell it from a key never registered. A probe of `account_update_history` on opening Staking would, at a request a visit.
- **The fee** of each staking transaction, which Lace shows on its rows; the details could carry it from the `tx_info` already read.
