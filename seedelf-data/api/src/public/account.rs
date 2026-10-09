//! `account_addresses`, `account_info` and `account_txs`: a stake key's
//! addresses, standing and transactions. About one user each, so never cached.
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

use super::query::{NOT_ASKED, Query, natural};
use super::{array, body, distinct};
use crate::ids::{drep_shown, stake_bytes};
use crate::state::{ApiError, AppState, json};

/// Stake addresses in one `account_addresses`: the wallet probes 20 at a time (`INDEX_PROBE`).
const MAX_STAKE_ADDRESSES: usize = 20;

/// Stake addresses in one `account_info`: the wallet asks about its own, one.
/// Each sums its whole unspent set, so no more than the wallet sends.
const MAX_ACCOUNTS: usize = 1;

/// The most outputs `account_txs` gathers for one stake key. Any key may be
/// asked about, and one with 507,000 outputs took 2.3 s a page; no wallet
/// comes near this many. Past it, a 503, and the wallet reads Koios.
const MAX_OUTPUTS: i64 = 200_000;

/// The most of an account's transactions one `account_txs` gives.
const MAX_TXS: i64 = 1000;

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

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TxsBody {
    _stake_address: String,
    _after_block_height: Option<i64>,
}

#[derive(Serialize)]
struct TxRow {
    tx_hash: String,
    epoch_no: i64,
    block_height: i64,
    block_time: i64,
}

/// Every transaction that made or spent an output at one of the stake key's
/// addresses, in blocks from `$2` on (Koios's `_after_block_height` takes
/// that block too), newest first, a page of them.
///
/// A transaction's id rises with its block, so the query never joins the
/// whole history (2.3 s a page for 221,000 transactions, 0.5 s this way):
/// - `from`: blocks from `$2` on are transactions from the first one in the
///   first block there with any (Koios's own `_tx_id_min`);
/// - `top`: the page and everything before it are among the `$3 + $4`
///   newest ids, widened to the whole of the oldest block they reach, so
///   that block's transactions sort by hash as Koios's do.
///
/// The last column says whether the key's outputs passed [`MAX_OUTPUTS`].
fn txs() -> String {
    format!(
        "with addrs as materialized ( \
           select a.id from stake_address sa join address a on a.stake_address_id = sa.id \
           where sa.hash_raw = $1::bytea), \
         outs as materialized ( \
           select o.tx_id, o.consumed_by_tx_id from tx_out o \
           where o.address_id in (select id from addrs) limit {gather}), \
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
        gather = MAX_OUTPUTS + 1,
        max = MAX_OUTPUTS,
    )
}

/// Whether a stake key's outputs pass [`MAX_OUTPUTS`], for a page that came back empty.
fn too_many() -> String {
    format!(
        "select count(*) > {MAX_OUTPUTS} from ( \
           select 1 from stake_address sa join address a on a.stake_address_id = sa.id \
           join tx_out o on o.address_id = a.id where sa.hash_raw = $1::bytea \
           limit {}) gathered",
        MAX_OUTPUTS + 1
    )
}

/// An account's transactions, newest first: a page of them by `offset` and
/// `limit`, or, with `_after_block_height`, every one from that block on (at most 1,000).
pub async fn account_txs(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    let request: TxsBody = body(&headers, &bytes)?;
    let key = stake_bytes(&request._stake_address).ok_or(NOT_ASKED)?;
    let mut q = Query::parse(raw.as_deref())?;
    q.exactly("order", "block_height.desc,tx_hash.asc")?;
    let (from, offset) = match request._after_block_height {
        Some(height) if height >= 0 => (height, 0),
        Some(_) => return Err(NOT_ASKED),
        None => (0, natural(&q.value("offset")?)?),
    };
    let limit = natural(&q.value("limit")?)?;
    q.end()?;
    let wanted = if request._after_block_height.is_some() {
        MAX_TXS
    } else {
        // Activity's pages are 20.
        20
    };
    if limit != wanted || offset > 1_000_000 {
        return Err(NOT_ASKED);
    }
    state.fresh_tip()?;
    let client = state.chain.public().await?;
    let rows = client
        .query(&txs(), &[&key, &from, &offset, &limit])
        .await
        .map_err(anyhow::Error::from)?;
    // Past the cap, the gathered outputs may have lost the page's rows, so
    // an empty page is only the end once the count says so.
    let over = match rows.first() {
        Some(row) => row.try_get::<_, bool>(4).map_err(anyhow::Error::from)?,
        None => client
            .query_one(&too_many(), &[&key])
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
