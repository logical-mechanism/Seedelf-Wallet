//! `account_addresses`, `account_info`, `account_reward_history`,
//! `account_update_history` and `account_txs`: a stake key's addresses,
//! standing, rewards, certificates and transactions; and `credential_txs`,
//! an account's transactions by its payment keys. About one user each, so
//! never cached.
//!
//! **A stake key's addresses come from `address.stake_address_id`,** which
//! db-sync indexes. Koios gathers them from `tx_out.stake_address_id`, which
//! it indexes itself and the home db-sync doesn't: 6.7 s that way for an
//! account with 259 addresses, 2 ms this way, the same 259.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{RawQuery, State};
use axum::http::HeaderMap;
use axum::response::Response;
use serde::{Deserialize, Serialize};
use tokio_postgres::types::ToSql;

use super::query::{NOT_ASKED, Query, natural};
use super::utxos::{MAX_CREDENTIALS, list};
use super::{array, body, distinct};
use crate::ids::{drep_shown, hex_bytes, stake_bytes};
use crate::state::{ApiError, AppState, json};

/// Stake addresses in one `account_addresses`: the wallet probes 20 at a time (`INDEX_PROBE`).
const MAX_STAKE_ADDRESSES: usize = 20;

/// Stake addresses in one `account_info`: the wallet asks about its own, one.
/// Each sums its whole unspent set, so no more than the wallet sends.
const MAX_ACCOUNTS: usize = 1;

/// The most outputs `account_txs` gathers for one stake key, and
/// `credential_txs` for its credentials together. Any may be asked about,
/// and a key with 507,000 outputs took 2.3 s a page; no wallet comes near
/// this many. Past it, a 503, and the wallet reads Koios.
const MAX_OUTPUTS: i64 = 200_000;

/// The most of an account's transactions one `account_txs` or `credential_txs` gives.
const MAX_TXS: i64 = 1000;

/// The deepest page of `account_txs` or `credential_txs`: Activity's 500th
/// *Load more*, far past what anyone reads. A page joins every newer
/// transaction too, so its cost grows with its offset: one past the end of
/// a long list would join the whole history, as every page did before
/// [`txs`] took the newest ids. Deeper, a 503, and the wallet reads that
/// page alone from Koios.
const MAX_OFFSET: i64 = 10_000;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AddressesBody {
    _stake_addresses: Vec<String>,
    _empty: bool,
}

fn stake_list(items: &[String], max: usize) -> Result<Vec<Vec<u8>>, ApiError> {
    if items.is_empty() || items.len() > max || !distinct(items) {
        return Err(NOT_ASKED);
    }
    items
        .iter()
        .map(|item| stake_bytes(item).ok_or(NOT_ASKED))
        .collect()
}

#[derive(Serialize)]
struct AddressesRow {
    stake_address: String,
    addresses: Vec<String>,
}

/// Every address each stake key has ever been part of, empty ones included,
/// in Koios's order (by the address's text). A key no address has used has no row.
const ADDRESSES: &str = "select sa.view::text, json_agg(a.address::text order by a.address)::text \
     from stake_address sa join address a on a.stake_address_id = sa.id \
     where sa.hash_raw = any($1::bytea[]) group by sa.id, sa.view order by sa.id";

/// Which addresses have used each stake key, empty ones too (`_empty: true`,
/// the only way the wallet asks).
pub async fn account_addresses(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    Query::none(raw.as_deref())?;
    let request: AddressesBody = body(&headers, &bytes)?;
    if !request._empty {
        return Err(NOT_ASKED);
    }
    let keys = stake_list(&request._stake_addresses, MAX_STAKE_ADDRESSES)?;
    state.fresh_tip()?;
    let client = state.chain.public().await?;
    let rows = client
        .query(ADDRESSES, &[&keys])
        .await
        .map_err(anyhow::Error::from)?;
    let rows = rows
        .iter()
        .map(|row| {
            Ok(AddressesRow {
                stake_address: row.try_get(0)?,
                addresses: serde_json::from_str(row.try_get::<_, &str>(1)?)?,
            })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(json(array(&rows)?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct InfoBody {
    _stake_addresses: Vec<String>,
}

#[derive(Serialize)]
struct InfoRow {
    stake_address: String,
    status: &'static str,
    delegated_pool: Option<String>,
    delegated_drep: Option<String>,
    total_balance: String,
    utxo: String,
    rewards: String,
    withdrawals: String,
    rewards_available: String,
    deposit: String,
    reserves: String,
    treasury: String,
    proposal_refund: String,
}

/// Koios's `account_info`, rule for rule:
///
/// - **registered:** a registration with no deregistration after it; its deposit.
/// - **the pool:** the latest delegation, unless the key was deregistered
///   since or the pool has retired since (and wasn't registered again before
///   its retirement took effect): a dangling delegation names no pool.
/// - **the DRep:** the latest vote delegation, unless the key was deregistered
///   since or the DRep retired since.
/// - **the amounts:** rewards and `reward_rest` spendable by the current epoch, less every withdrawal.
///
/// The account's DRep is found through `delegation_vote_addr_id_idx`, one of
/// Koios's indexes added at home (`deploy/home/db-sync-indexes.sql`). Without
/// it, the table was read whole: 16 of the query's 16.3 ms, against 0.1–0.4 ms.
const INFO: &str = "with sa as materialized (select id, view from stake_address where hash_raw = any($1::bytea[])), \
     cur as materialized (select max(epoch_no) as no from epoch_param) \
     select sa.view::text as stake_address, \
       reg.deposit is not null as registered, coalesce(reg.deposit, 0)::text as deposit, \
       case when latest.id is not null \
             and not exists (select 1 from stake_deregistration sd where sd.addr_id = sa.id and sd.tx_id > latest.tx_id) \
             and not exists ( \
               select 1 from pool_retire pr join tx dt on dt.id = latest.tx_id join block db on db.id = dt.block_id \
               where pr.hash_id = latest.pool_hash_id and pr.retiring_epoch <= cur.no and pr.retiring_epoch > db.epoch_no \
                 and not exists ( \
                   select 1 from pool_update pu where pu.hash_id = latest.pool_hash_id \
                     and pu.registered_tx_id >= pr.announced_tx_id \
                     and pu.registered_tx_id <= (select max(t.id) from tx t where t.block_id = \
                       (select max(b.id) from block b where b.epoch_no = pr.retiring_epoch - 1 and b.tx_count > 0)))) \
            then latest.view::text end as delegated_pool, \
       (vote.id is not null \
             and not exists (select 1 from stake_deregistration sd where sd.addr_id = sa.id and sd.tx_id > vote.tx_id) \
             and not exists (select 1 from drep_registration dr where dr.drep_hash_id = vote.drep_hash_id \
                               and dr.tx_id > vote.tx_id and dr.deposit < 0)) as voting, \
       vote.raw as drep_raw, coalesce(vote.has_script, false) as drep_script, vote.dview::text as drep_view, \
       coalesce((select sum(o.value) from tx_out o where o.stake_address_id = sa.id \
                   and o.consumed_by_tx_id is null), 0)::text as utxo, \
       coalesce((select sum(r.amount) from reward r where r.addr_id = sa.id \
                   and r.spendable_epoch <= cur.no), 0)::text as rewards, \
       coalesce((select sum(w.amount) from withdrawal w where w.addr_id = sa.id), 0)::text as withdrawals, \
       rest.reserves::text as reserves, rest.treasury::text as treasury, \
       rest.proposal_refund::text as proposal_refund \
     from sa cross join cur \
     left join lateral ( \
       select sr.deposit from stake_registration sr where sr.addr_id = sa.id \
         and not exists (select 1 from stake_deregistration sd where sd.addr_id = sr.addr_id and sd.tx_id > sr.tx_id) \
       order by sr.tx_id desc limit 1) reg on true \
     left join lateral ( \
       select d.id, d.tx_id, d.pool_hash_id, ph.view from delegation d join pool_hash ph on ph.id = d.pool_hash_id \
       where d.addr_id = sa.id order by d.id desc limit 1) latest on true \
     left join lateral ( \
       select dv.id, dv.tx_id, dv.drep_hash_id, dh.raw, dh.has_script, dh.view as dview \
       from delegation_vote dv join drep_hash dh on dh.id = dv.drep_hash_id \
       where dv.addr_id = sa.id order by dv.id desc limit 1) vote on true \
     left join lateral ( \
       select coalesce(sum(amount) filter (where type = 'reserves'), 0) as reserves, \
              coalesce(sum(amount) filter (where type = 'treasury'), 0) as treasury, \
              coalesce(sum(amount) filter (where type = 'proposal_refund'), 0) as proposal_refund \
       from reward_rest rr where rr.addr_id = sa.id and rr.spendable_epoch <= cur.no) rest on true \
     order by sa.id";

/// A lovelace sum, read as text and added here: a sum can pass i64.
fn lovelace(row: &tokio_postgres::Row, column: &str) -> anyhow::Result<i128> {
    let text: String = row.try_get(column)?;
    Ok(text.parse()?)
}

/// A stake key's standing: registered or not, its pool and DRep, and what it can withdraw.
pub async fn account_info(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    Query::none(raw.as_deref())?;
    let request: InfoBody = body(&headers, &bytes)?;
    let keys = stake_list(&request._stake_addresses, MAX_ACCOUNTS)?;
    state.fresh_tip()?;
    let client = state.chain.public().await?;
    let rows = client
        .query(INFO, &[&keys])
        .await
        .map_err(anyhow::Error::from)?;
    let rows = rows
        .iter()
        .map(|row| {
            let [utxo, rewards, withdrawals, reserves, treasury, refund] = [
                "utxo",
                "rewards",
                "withdrawals",
                "reserves",
                "treasury",
                "proposal_refund",
            ]
            .map(|column| lovelace(row, column));
            let (utxo, rewards, withdrawals) = (utxo?, rewards?, withdrawals?);
            let (reserves, treasury, refund) = (reserves?, treasury?, refund?);
            let voting: bool = row.try_get("voting")?;
            let drep_raw: Option<Vec<u8>> = row.try_get("drep_raw")?;
            let drep_view: Option<String> = row.try_get("drep_view")?;
            Ok(InfoRow {
                stake_address: row.try_get("stake_address")?,
                status: if row.try_get("registered")? {
                    "registered"
                } else {
                    "not registered"
                },
                delegated_pool: row.try_get("delegated_pool")?,
                delegated_drep: match (voting, drep_view) {
                    (true, Some(view)) => Some(drep_shown(
                        drep_raw.as_deref(),
                        row.try_get("drep_script")?,
                        &view,
                    )),
                    _ => None,
                },
                // Koios's sums, as it adds them: the total leaves out proposal refunds.
                total_balance: (utxo + rewards + reserves + treasury - withdrawals).to_string(),
                utxo: utxo.to_string(),
                rewards: rewards.to_string(),
                withdrawals: withdrawals.to_string(),
                rewards_available: (rewards + reserves + treasury + refund - withdrawals)
                    .to_string(),
                deposit: row.try_get("deposit")?,
                reserves: reserves.to_string(),
                treasury: treasury.to_string(),
                proposal_refund: refund.to_string(),
            })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(json(array(&rows)?))
}

/// The columns a rewards history asks for, in its order: every row's, but its stake address.
const REWARD_COLUMNS: &str = "earned_epoch,spendable_epoch,amount,type,pool_id_bech32";

/// Oldest first, by every column: an operator's reward account can take
/// several pools' rewards in one epoch, and two treasury withdrawals could
/// pay it in one. Oldest first is what keeps the pages still while db-sync
/// changes an account's rows: those it adds as an epoch goes on (next
/// epoch's rewards, and refunds at an epoch's start) and those it takes back
/// (a key deregistered before it was paid) are among the newest, at the end.
/// Newest first, a row added mid-read pushed one already read onto the next
/// page too, and one taken back pulled one not yet read onto a page read.
const REWARD_ORDER: &str =
    "spendable_epoch.asc,earned_epoch.asc,type.asc,pool_id_bech32.asc,amount.asc";

/// A page of a rewards history: Koios's most. A member's reward comes once
/// an epoch, so an account staked since Shelley has about 400.
const REWARD_PAGE: i64 = 1000;

/// The furthest page: the reward account of a hundred pools, every epoch since Shelley.
const MAX_REWARD_OFFSET: i64 = 100_000;

#[derive(Serialize)]
struct RewardRow {
    earned_epoch: i64,
    spendable_epoch: i64,
    amount: String,
    r#type: String,
    pool_id_bech32: Option<String>,
}

/// Koios's `account_reward_history`: every reward paid to the stake key,
/// from `reward` (a pool's: `member`, `leader`, `refund`), whose pool's
/// bech32 is `pool_hash.view`, and `reward_rest` (no pool's: `reserves`,
/// `treasury`, `proposal_refund`). The next epoch's are there before they're
/// paid. Both are read by `addr_id`: db-sync's `idx_reward_addr_id` and
/// home's `idx_reward_rest_addr_id` (`deploy/home/db-sync-indexes.sql`).
///
/// Sorted as [`REWARD_ORDER`] says, in SQL, as PostgREST sorts Koios's: by
/// the text of `type` and `amount`, and a row with no pool after those with
/// one (ascending puts nulls last, in both).
const REWARDS: &str = "with sa as materialized (select id from stake_address where hash_raw = $1::bytea) \
     select earned_epoch, spendable_epoch, amount, type, pool from ( \
       select r.earned_epoch::bigint as earned_epoch, r.spendable_epoch::bigint as spendable_epoch, \
         r.amount::text as amount, r.type::text as type, ph.view::text as pool \
       from sa join reward r on r.addr_id = sa.id join pool_hash ph on ph.id = r.pool_id \
       union all \
       select rr.earned_epoch::bigint, rr.spendable_epoch::bigint, rr.amount::text, rr.type::text, null::text \
       from sa join reward_rest rr on rr.addr_id = sa.id) rewards \
     order by spendable_epoch, earned_epoch, type, pool, amount \
     offset $2::bigint limit $3::bigint";

/// A stake key's rewards history, oldest first, a page of 1,000: Staking's
/// *Rewards history* (web wallet chunk 30), read only when it's opened.
pub async fn account_reward_history(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    let mut q = Query::parse(raw.as_deref())?;
    q.exactly("select", REWARD_COLUMNS)?;
    q.exactly("order", REWARD_ORDER)?;
    let offset = natural(&q.value("offset")?)?;
    let limit = natural(&q.value("limit")?)?;
    q.end()?;
    if limit != REWARD_PAGE || offset % REWARD_PAGE != 0 || offset > MAX_REWARD_OFFSET {
        return Err(NOT_ASKED);
    }
    let request: InfoBody = body(&headers, &bytes)?;
    let keys = stake_list(&request._stake_addresses, MAX_ACCOUNTS)?;
    state.fresh_tip()?;
    let client = state.chain.public().await?;
    let rows = client
        .query(REWARDS, &[&keys[0], &offset, &limit])
        .await
        .map_err(anyhow::Error::from)?;
    let rows = rows
        .iter()
        .map(|row| {
            Ok(RewardRow {
                earned_epoch: row.try_get(0)?,
                spendable_epoch: row.try_get(1)?,
                amount: row.try_get(2)?,
                r#type: row.try_get(3)?,
                pool_id_bech32: row.try_get(4)?,
            })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(json(array(&rows)?))
}

/// The columns a delegation history asks for, in its order: every row's but
/// its stake address and `epoch_slot`.
const UPDATE_COLUMNS: &str = "action_type,tx_hash,epoch_no,absolute_slot,block_time";

/// Every kind of row but Koios's fifth: the wallet withdraws an account's
/// rewards with nearly every payment, so withdrawals would swamp the list,
/// and Activity has them.
const UPDATE_KINDS: &str = "neq.withdrawal";

/// Oldest first, by every column it takes: a slot holds one block, and a
/// transaction's certificates of one kind for the key are one row
/// ([`UPDATES`]), so no two rows tie. Oldest first keeps the pages still
/// while the key acts again: its next certificate lands at the end, as a
/// rewards history's next rewards do.
const UPDATE_ORDER: &str = "absolute_slot.asc,tx_hash.asc,action_type.asc";

/// A page of a delegation history: Koios's most. Most keys have a few rows,
/// a registration and a delegation or two.
const UPDATE_PAGE: i64 = 1000;

/// The furthest page, as a rewards history's: mainnet's busiest key has
/// 1,289 rows, 1,282 of them pool delegations (2026-10-14).
const MAX_UPDATE_OFFSET: i64 = 100_000;

#[derive(Serialize)]
struct UpdateRow {
    action_type: String,
    tx_hash: String,
    epoch_no: i64,
    absolute_slot: i64,
    block_time: i64,
}

/// Koios's `account_update_history` (CC-BY-4.0), less its withdrawals: the
/// stake key's registrations (`stake_registration`), deregistrations
/// (`stake_deregistration`), pool delegations (`delegation`) and vote
/// delegations (`delegation_vote`), each with its transaction's hash and its
/// block's epoch, slot and time. Combined with `union`, as Koios's are, so a
/// transaction's certificates of one kind for the key are one row: on
/// mainnet a transaction can delegate one key twice, and Koios lists it
/// once. Koios's union also keeps the key apart, which one key needs no
/// column for (`hash_raw` is unique).
///
/// Each kind is read by `addr_id`: db-sync's `idx_stake_registration_addr_id`,
/// `idx_stake_deregistration_addr_id` and `idx_delegation_addr_id` (the
/// planner takes home's `idx_delegation_addr_id_tx_id`, read from the index
/// alone), and home's `delegation_vote_addr_id_idx`
/// (`deploy/home/db-sync-indexes.sql`); then each row's `tx` and `block` by
/// their keys. Mainnet's busiest key, 1,289 rows: 117 ms from a cold disk,
/// 5 ms warm, at home (2026-10-14).
///
/// Sorted as [`UPDATE_ORDER`] says, in SQL, as PostgREST sorts Koios's: by
/// the hash's hex and the kind's name as text. Both sort the same under any
/// collation: lowercase hex of one length, and four names that differ first
/// at a letter.
const UPDATES: &str = "with sa as materialized (select id from stake_address where hash_raw = $1::bytea), \
     actions as ( \
       select 'registration'::text as action_type, sr.tx_id from sa join stake_registration sr on sr.addr_id = sa.id \
       union select 'deregistration'::text, sd.tx_id from sa join stake_deregistration sd on sd.addr_id = sa.id \
       union select 'delegation_pool'::text, d.tx_id from sa join delegation d on d.addr_id = sa.id \
       union select 'delegation_drep'::text, dv.tx_id from sa join delegation_vote dv on dv.addr_id = sa.id) \
     select a.action_type, encode(t.hash, 'hex') as tx_hash, b.epoch_no::bigint as epoch_no, \
       b.slot_no::bigint as absolute_slot, extract(epoch from b.time)::bigint as block_time \
     from actions a join tx t on t.id = a.tx_id join block b on b.id = t.block_id \
     order by absolute_slot, tx_hash, action_type \
     offset $2::bigint limit $3::bigint";

/// A stake key's certificates, oldest first, a page of 1,000: Staking's
/// *Delegation history* (web wallet chunk 36), read only when it's opened.
pub async fn account_update_history(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    let mut q = Query::parse(raw.as_deref())?;
    q.exactly("select", UPDATE_COLUMNS)?;
    q.exactly("action_type", UPDATE_KINDS)?;
    q.exactly("order", UPDATE_ORDER)?;
    let offset = natural(&q.value("offset")?)?;
    let limit = natural(&q.value("limit")?)?;
    q.end()?;
    if limit != UPDATE_PAGE || offset % UPDATE_PAGE != 0 || offset > MAX_UPDATE_OFFSET {
        return Err(NOT_ASKED);
    }
    let request: InfoBody = body(&headers, &bytes)?;
    let keys = stake_list(&request._stake_addresses, MAX_ACCOUNTS)?;
    state.fresh_tip()?;
    let client = state.chain.public().await?;
    let rows = client
        .query(UPDATES, &[&keys[0], &offset, &limit])
        .await
        .map_err(anyhow::Error::from)?;
    let rows = rows
        .iter()
        .map(|row| {
            Ok(UpdateRow {
                action_type: row.try_get(0)?,
                tx_hash: row.try_get(1)?,
                epoch_no: row.try_get(2)?,
                absolute_slot: row.try_get(3)?,
                block_time: row.try_get(4)?,
            })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(json(array(&rows)?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TxsBody {
    _stake_address: String,
    _after_block_height: Option<i64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CredentialTxsBody {
    _payment_credentials: Vec<String>,
    _after_block_height: Option<i64>,
}

#[derive(Serialize)]
struct TxRow {
    tx_hash: String,
    epoch_no: i64,
    block_height: i64,
    block_time: i64,
}

/// Whose outputs a listing of transactions gathers: `$1` names them.
#[derive(Clone, Copy)]
enum Whose {
    /// A stake key's (`$1::bytea`): at every address it's part of.
    Stake,
    /// Payment credentials' (`$1::bytea[]`): at every address with one of
    /// them, whatever its staking part, as the wallet's balance counts them.
    /// Gathered address by address, never all the addresses first: a busy
    /// script's credential sits at millions of them, and `MAX_OUTPUTS`
    /// outputs reach at most as many addresses.
    Credentials,
}

impl Whose {
    /// Where its outputs are, for a count of them from `tx_out`'s index
    /// alone, with no row read ([`too_many`]).
    fn at(self) -> &'static str {
        match self {
            Whose::Stake => {
                "stake_address sa join address a on a.stake_address_id = sa.id \
                 join tx_out o on o.address_id = a.id where sa.hash_raw = $1::bytea"
            }
            Whose::Credentials => {
                "address a join tx_out o on o.address_id = a.id where a.payment_cred = any($1::bytea[])"
            }
        }
    }

    /// The `outs` CTE, with any it reads: `limit` outputs at most.
    ///
    /// Credentials' outputs are gathered only once a count from the index
    /// says they're within the cap (`gate`), in the same query: a busy
    /// script's credential is refused in 0.1 s rather than 4.9 s gathering
    /// its outputs to find out, at no round trip more. A stake key's are
    /// gathered as before credentials were, so `account_txs` is unchanged.
    fn outs(self, limit: i64) -> String {
        match self {
            Whose::Stake => format!(
                "addrs as materialized ( \
                   select a.id from stake_address sa join address a on a.stake_address_id = sa.id \
                   where sa.hash_raw = $1::bytea), \
                 outs as materialized ( \
                   select o.tx_id, o.consumed_by_tx_id from tx_out o \
                   where o.address_id in (select id from addrs) limit {limit})"
            ),
            Whose::Credentials => format!(
                "gate as materialized (select ({count}) as over), \
                 outs as materialized ( \
                   select o.tx_id, o.consumed_by_tx_id from address a cross join lateral ( \
                     select o.tx_id, o.consumed_by_tx_id from tx_out o where o.address_id = a.id offset 0) o \
                   where a.payment_cred = any($1::bytea[]) and not (select over from gate) limit {limit})",
                count = too_many(self),
            ),
        }
    }
}

/// Every transaction that made or spent an output of `whose`, in blocks
/// from `$2` on (Koios's `_after_block_height` takes that block too), newest
/// first, a page of them.
///
/// A transaction's id rises with its block, so a page joins only its own ids
/// and the newer ones, never the whole history (2.3 s a page for 221,000
/// transactions, 0.5 s this way; no page starts past [`MAX_OFFSET`]):
/// - `from`: blocks from `$2` on are transactions from the first one in the
///   first block there with any (Koios's own `_tx_id_min`);
/// - `top`: the page and everything before it are among the `$3 + $4`
///   newest ids, widened to the whole of the oldest block they reach, so
///   that block's transactions sort by hash as Koios's do.
///
/// The last column says whether the outputs passed [`MAX_OUTPUTS`].
fn txs(whose: Whose) -> String {
    format!(
        "with {outs}, \
         first as (select min(t.id) as id from tx t where t.block_id = ( \
           select b.id from block b where b.block_no >= $2::bigint and b.tx_count > 0 \
           order by b.block_no limit 1)), \
         ids as materialized ( \
           select tx_id as id from outs where tx_id >= (select id from first) \
           union select consumed_by_tx_id from outs where consumed_by_tx_id >= (select id from first)), \
         top as (select id from ids order by id desc limit $3::bigint + $4::bigint), \
         wanted as (select ids.id from ids where ids.id >= ( \
           select min(t2.id) from tx t2 where t2.block_id = ( \
             select t1.block_id from tx t1 where t1.id = (select min(id) from top)))) \
         select encode(t.hash, 'hex'), b.epoch_no::bigint, b.block_no::bigint, \
           extract(epoch from b.time)::bigint, (select count(*) from outs) > {max} as over \
         from wanted join tx t on t.id = wanted.id join block b on b.id = t.block_id \
         order by b.block_no desc, t.hash offset $3::bigint limit $4::bigint",
        outs = whose.outs(MAX_OUTPUTS + 1),
        max = MAX_OUTPUTS,
    )
}

/// Whether the outputs of `whose` pass [`MAX_OUTPUTS`], counted from
/// `tx_out`'s index alone, with no row read: asked when a page came back
/// empty, which past the cap may have lost its rows, or, for credentials,
/// was never gathered (`gate`).
fn too_many(whose: Whose) -> String {
    format!(
        "select count(*) > {MAX_OUTPUTS} from (select 1 from {} limit {}) gathered",
        whose.at(),
        MAX_OUTPUTS + 1
    )
}

/// A stake key's transactions, newest first: a page of them by `offset` and
/// `limit`, or, with `_after_block_height`, every one from that block on (at most 1,000).
pub async fn account_txs(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    let request: TxsBody = body(&headers, &bytes)?;
    let key = stake_bytes(&request._stake_address).ok_or(NOT_ASKED)?;
    listing(
        &state,
        raw.as_deref(),
        Whose::Stake,
        &key,
        request._after_block_height,
    )
    .await
}

/// Payment credentials' transactions, newest first, paged as `account_txs`
/// is: Public activity, read by the account's payment keys since web wallet
/// chunk 28, so that it lists what the balance counts.
pub async fn credential_txs(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    let request: CredentialTxsBody = body(&headers, &bytes)?;
    let creds = list(&request._payment_credentials, MAX_CREDENTIALS, |c| {
        hex_bytes(c, 28)
    })?;
    listing(
        &state,
        raw.as_deref(),
        Whose::Credentials,
        &creds,
        request._after_block_height,
    )
    .await
}

/// A page of transactions of `whose` (`key`, the query's `$1`), as the
/// wallet asks: `offset` and `limit` 20, or `_after_block_height` and 1,000.
async fn listing(
    state: &AppState,
    raw: Option<&str>,
    whose: Whose,
    key: &(dyn ToSql + Sync),
    after: Option<i64>,
) -> Result<Response, ApiError> {
    let mut q = Query::parse(raw)?;
    q.exactly("order", "block_height.desc,tx_hash.asc")?;
    let (from, offset) = match after {
        Some(height) if height >= 0 => (height, 0),
        Some(_) => return Err(NOT_ASKED),
        None => (0, natural(&q.value("offset")?)?),
    };
    let limit = natural(&q.value("limit")?)?;
    q.end()?;
    let wanted = if after.is_some() {
        MAX_TXS
    } else {
        // Activity's pages are 20.
        20
    };
    if limit != wanted {
        return Err(NOT_ASKED);
    }
    // A page the wallet asks, too deep to answer here: a 503 sends this one
    // request to Koios, where a 400 would hold all its public reads there
    // for 5 minutes.
    if offset > MAX_OFFSET {
        return Err(ApiError::Heavy);
    }
    state.fresh_tip()?;
    let client = state.chain.public().await?;
    let rows = client
        .query(&txs(whose), &[key, &from, &offset, &limit])
        .await
        .map_err(anyhow::Error::from)?;
    // Past the cap, the gathered outputs may have lost the page's rows, so
    // an empty page is only the end once the count says so.
    let over = match rows.first() {
        Some(row) => row.try_get::<_, bool>(4).map_err(anyhow::Error::from)?,
        None => client
            .query_one(&too_many(whose), &[key])
            .await
            .map_err(anyhow::Error::from)?
            .try_get(0)
            .map_err(anyhow::Error::from)?,
    };
    if over {
        return Err(ApiError::Heavy);
    }
    let rows = rows
        .iter()
        .map(|row| {
            Ok(TxRow {
                tx_hash: row.try_get(0)?,
                epoch_no: row.try_get(1)?,
                block_height: row.try_get(2)?,
                block_time: row.try_get(3)?,
            })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(json(array(&rows)?))
}
