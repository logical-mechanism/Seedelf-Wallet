# Chunk 30 · Rewards history

The owner picked it on 2026-10-12, from [post-release-roadmap.md](../../post-release-roadmap.md)'s *Kept in mind* ("Small ones: … rewards history (chunk 13)"): "Rewards history on the Staking and governance page. Mainnet needs a new data-layer route; preprod has Koios's account_rewards."

**Status: ✅ built 2026-10-12** on `web-wallet/rewards-history`, from `main` after #301. One PR: the plan, the build and the docs together, so this file went straight to the archive. What still holds is in [architecture.md](../../architecture.md) (*Staking*: the request), [flows.md](../../flows.md) (*Staking and voting*: the page), [privacy.md](../../privacy.md) (*What Koios learns*) and [seedelf-data's README](../../../../../seedelf-data/README.md) (the route). The privacy policy is unchanged: its staking row already says "your rewards" go to the Cardano server as the stake address, and nothing is kept.

## What Koios has

- **`account_rewards` is deprecated,** and preprod's refuses an `order` (`column record.earned_epoch does not exist`: its rows are nested, one per stake key). **`account_reward_history` replaces it,** on both networks: flat rows, `earned_epoch`, `spendable_epoch`, `amount` (text), `type`, `pool_id_bech32` (null for a reward no pool paid).
- **Rows come from db-sync's `reward` (`member`, `leader`, `refund`) and `reward_rest` (`reserves`, `treasury`, `proposal_refund`).** The next epoch's are listed before they're paid: db-sync inserts them during the epoch before (preprod at epoch 318 listed epoch 319's), and its docs say some may be missing until then. What `account_info` counts as paid is `spendable_epoch` at or before the current epoch.
- **The public 12-word test account** has 87, all `member`, from two pools (LOGIC and GRADA), epochs 223 to 319 (`tests/fixtures/rewards-preprod.json`, recorded 2026-10-12 by `record-rewards.mjs`).

## The request

One each time the page opens, 1,000 rows a request (Koios's most), newest first:

```text
POST account_reward_history?select=earned_epoch,spendable_epoch,amount,type,pool_id_bech32
     &order=spendable_epoch.desc,earned_epoch.desc,type.asc,pool_id_bech32.asc,amount.asc&offset=0&limit=1000
{"_stake_addresses":["stake1…"]}
```

- **Read whole, not a page at a time:** a pool pays a member once an epoch, so an account staked since Shelley has about 400, one request, and the page can total them. A pool operator's reward account can pass 1,000 (the one 13 mainnet pools pay has 5,766); the next request is made then, as the pool list's is. One call reads every page from the same server (`data-layer.ts`).
- **The order is total,** so no row is on two pages: an operator's account can take several pools' rewards in one epoch, and two treasury withdrawals could pay it in one.
- **Only when asked:** opening Staking costs what it did. The history is a page of its own, read each time it opens and kept nowhere.
- **Koios cost:** 1 request a visit; at the data layer's edge, 4 units, and one more each 16 KB it sends.

## The data layer (mainnet)

A 22nd public route, `POST /api/v1/account_reward_history` (`api/src/public/account.rs`): Koios's path and JSON, taking exactly the request above (one stake key, that select and order, `limit=1000`, an `offset` that's a multiple of 1,000, up to 100,000). About one user, so never kept.

- **The SQL** follows Koios's `grest.account_reward_history` (CC-BY-4.0): `reward` joined to `pool_hash`, whose `view` is the bech32 Koios makes, union all `reward_rest` with no pool, both by `addr_id` (db-sync's `idx_reward_addr_id`, home's `idx_reward_rest_addr_id`), sorted in SQL as the order says (ascending puts a null pool last, as PostgREST does).
- **Checked against mainnet Koios on 2026-10-12,** every page, row for row: the reward account 13 pools pay (5,766 rows), one 34 pools pay (2,513, pools' deposits back among them), a member the reserves and the treasury paid too (457), and a key never paid (none). All four from home in 0.5 s.
- **Deploy it before the wallet ships:** an API without the route answers 404, and any failure holds the wallet's public part on Koios for 5 minutes.

## The wallet

- **koios.ts `rewardHistory`,** and `DataLayerKoios`'s override, as every public read.
- **staking.ts `rewardHistory`** (the `reward-history` request): the active account's stake key; each row checked (whole epochs, an amount in lovelace, a `pool1` ID, or the row is left out, since the page adds them up) and its kind read from `type` (`other` for one the wallet doesn't know); each pool named from the device alone (`poolsKnown`: this session's pool details, then the pool list), never asked for.
- **Staking:** **Rewards history** under the rewards while the key is registered, and under *Not staking* when it was ever paid (`StakeInfo.rewarded`: rewards available plus withdrawals over 0, from the reading's own `account_info`), so stopping doesn't hide them.
- **The page** (`Rewards.tsx`): what's been paid in all; **Next epoch**, the rows later than now (`epochAt`); then each year, newest first, on this device's calendar, its total on its heading; 50 rows at first, **Show more** for 50 more, asking no one. A row: the day its epoch started, then "Epoch 319 · LOGIC", the pool by its ticker or its ID cut short (whole on hover), "LOGIC, as its operator", "LOGIC's deposit back", "From the reserves", "From the treasury", "A governance action's deposit back", or "Other". The title's ⓘ says a pool pays at an epoch's start, for the epoch two before. A note says it's read from the server, which already knows the account, each time the page opens.
- **Hidden balances** hide every amount, the totals too.
- **15 new strings,** none critical (no warning, privacy note or alert); Spanish and Japanese machine-translated, as recorded in the provenance files.

## Tests

- **Data layer:** `public_grammar.rs` takes the one request and refuses every other (another page size, an offset off the thousands or past 100,000, two keys, `_epoch_no`, another select or order); `live_public.rs` reads the four keys above whole and checks the pages make one list in the order, Koios's five columns, a pool exactly on a pool's rows, and what's been paid against `account_info`.
- **Wallet:** `staking.test.ts`: the exact request, 87 rows, tickers from the session and the pool list with no `pool_info`, a second page past 1,000, the rows left out, the active account's key, and `rewarded`; `data-layer.test.ts`: every page on the data layer, or all again on Koios when one fails, and its weight; `rewards-screen.test.ts`: the totals, the years, next epoch's apart, the first 50, who paid each, hidden amounts, nothing yet, and where Staking offers it; `e2e/extension.spec.ts`: opening Staking asks nothing about rewards, the history asks once, Show more asks no one, and it's read again each time it opens.

## Left for later

- **A CSV of the rewards,** for taxes, as Activity has one. The rows already hold what one needs (the earned and paid epochs, the amount, the pool).
