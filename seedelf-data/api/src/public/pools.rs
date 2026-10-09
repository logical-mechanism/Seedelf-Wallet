//! `pool_list` and `pool_info`: the stake pools, for the pool browser and a
//! pool's details. The same for everyone, so both are cached.
//!
//! **A pool's state** is Koios's `pool_info_cache` rule, worked out per
//! request: its latest registration or update, and a retirement announced
//! after it. None is `registered`; one for a later epoch is `retiring`; one
//! that has taken effect is `retired`.
//!
//! **Live stake** is Koios's too: every account whose latest delegation is
//! to the pool, still registered since, not left dangling by a retirement,
//! and in the current epoch's stake snapshot; each counts its unspent outputs
//! and the rewards it can withdraw. Koios keeps a stake distribution cache
//! for this; here it's summed per pool. Rewards change only at an epoch's
//! start, so each account's sum is kept for the epoch ([`Rewards`]): the
//! first look at the largest pool (35,000 delegators) reads them all, and
//! later ones only the accounts new to it.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::Semaphore;

use axum::body::Bytes;
use axum::extract::{RawQuery, State};
use axum::http::HeaderMap;
use axum::response::Response;
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;

use super::query::{NOT_ASKED, Query, natural};
use super::{body, distinct};
use crate::ids::pool_bytes;
use crate::state::{ApiError, AppState, json, to_json};

/// How long the pool list is kept. Pools register and retire a few times an epoch.
const LIST_KEEP: Duration = Duration::from_secs(3600);

/// How long one pool's details are kept: its live stake moves with every block, slowly.
const INFO_KEEP: Duration = Duration::from_secs(600);

/// How long a pool whose live figures couldn't be worked out gets the snapshot instead.
const FAILED_KEEP: Duration = Duration::from_secs(300);

/// Pools whose live figures are worked out at once, at most.
const REFRESHING: usize = 2;

/// Rows in a page of the pool list, as the wallet asks for them.
const PAGE: usize = 1000;

/// Pools in one `pool_info`: the wallet asks about one.
const MAX_POOLS: usize = 5;

/// What `koios.ts` selects (`POOL_COLUMNS`, `POOL_INFO_COLUMNS`).
const LIST_COLUMNS: &str =
    "pool_id_bech32,ticker,margin,fixed_cost,pledge,active_stake,retiring_epoch";
const INFO_COLUMNS: &str = "pool_id_bech32,meta_json,margin,fixed_cost,pledge,live_pledge,live_stake,\
     live_saturation,live_delegators,block_count,pool_status,retiring_epoch";

/// Accounts' reward sums kept at most: past it, the epoch's are dropped and read again.
const MAX_REWARDS: usize = 2_000_000;

/// Each account's rewards spendable by an epoch, by `stake_address.id`.
#[derive(Default)]
pub struct Rewards(Mutex<(i64, HashMap<i64, i128>)>);

impl Rewards {
    /// The sums for `accounts` at `epoch` that are known, and the accounts whose aren't.
    fn known(&self, epoch: i64, accounts: &[i64]) -> (HashMap<i64, i128>, Vec<i64>) {
        let mut held = self.0.lock().expect("rewards lock");
        // Only ever forward: a read begun before an epoch's start mustn't
        // wipe the sums already kept for the new one.
        if held.0 > epoch {
            return (HashMap::new(), accounts.to_vec());
        }
        if held.0 < epoch {
            *held = (epoch, HashMap::new());
        }
        let mut known = HashMap::new();
        let mut missing = Vec::new();
        for account in accounts {
            match held.1.get(account) {
                Some(sum) => {
                    known.insert(*account, *sum);
                }
                None => missing.push(*account),
            }
        }
        (known, missing)
    }

    fn keep(&self, epoch: i64, sums: &HashMap<i64, i128>) {
        let mut held = self.0.lock().expect("rewards lock");
        if held.0 != epoch {
            return;
        }
        if held.1.len() + sums.len() > MAX_REWARDS {
            held.1.clear();
        }
        held.1.extend(sums);
    }
}

#[derive(Serialize)]
struct ListRow {
    pool_id_bech32: String,
    ticker: Option<String>,
    margin: Option<f64>,
    fixed_cost: Option<String>,
    pledge: Option<String>,
    active_stake: Option<String>,
    retiring_epoch: Option<i32>,
}

/// Every registered pool (not retiring, not retired), by ID, with its latest
/// terms, its ticker, and its active stake: `pool_stat` for the latest epoch
/// before this one that has it, as Koios takes it.
const LIST: &str = "with cur as materialized (select max(epoch_no) as no from epoch_param), \
     latest as materialized ( \
       select distinct on (pu.hash_id) pu.id, pu.hash_id, pu.registered_tx_id, pu.margin, pu.fixed_cost, \
         pu.pledge, pu.meta_id \
       from pool_update pu order by pu.hash_id, pu.registered_tx_id desc, pu.cert_index desc), \
     retiring as materialized ( \
       select distinct on (pr.hash_id) pr.hash_id, pr.announced_tx_id \
       from pool_retire pr order by pr.hash_id, pr.announced_tx_id desc, pr.cert_index desc), \
     active as materialized ( \
       select distinct on (ps.pool_hash_id) ps.pool_hash_id, ps.stake \
       from pool_stat ps, cur where ps.epoch_no < cur.no and ps.epoch_no > cur.no - 3 \
       order by ps.pool_hash_id, ps.epoch_no desc) \
     select ph.view::text, o.ticker_name::text, l.margin, l.fixed_cost::text, l.pledge::text, a.stake::text \
     from latest l join pool_hash ph on ph.id = l.hash_id \
     left join retiring r on r.hash_id = l.hash_id and r.announced_tx_id > l.registered_tx_id \
     left join active a on a.pool_hash_id = l.hash_id \
     left join lateral (select ticker_name from off_chain_pool_data where pmr_id = l.meta_id \
                        order by id desc limit 1) o on true \
     where r.hash_id is null order by ph.view";

/// Every registered pool, 1,000 a page by `offset`. One listing is kept for
/// an hour and every page is cut from it, so a browser's pages always agree.
pub async fn pool_list(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
) -> Result<Response, ApiError> {
    let mut q = Query::parse(raw.as_deref())?;
    q.exactly("pool_status", "eq.registered")?;
    q.exactly("select", LIST_COLUMNS)?;
    q.exactly("order", "pool_id_bech32.asc")?;
    let offset = natural(&q.value("offset")?)? as usize;
    q.exactly("limit", &PAGE.to_string())?;
    q.end()?;
    if !offset.is_multiple_of(PAGE) {
        return Err(NOT_ASKED);
    }
    let tip = state.fresh_tip()?;
    // Kept as one row a line, so a page is cut without reading the JSON again,
    // and by epoch: the active stake is the epoch's.
    let lines = state
        .lasting(&format!("pool_list/{}", tip.epoch), LIST_KEEP, || async {
            let client = state.chain.public().await?;
            let rows = client.query(LIST, &[]).await.map_err(anyhow::Error::from)?;
            let mut lines = Vec::new();
            for row in &rows {
                let row = ListRow {
                    pool_id_bech32: row.try_get(0).map_err(anyhow::Error::from)?,
                    ticker: row.try_get(1).map_err(anyhow::Error::from)?,
                    margin: row.try_get(2).map_err(anyhow::Error::from)?,
                    fixed_cost: row.try_get(3).map_err(anyhow::Error::from)?,
                    pledge: row.try_get(4).map_err(anyhow::Error::from)?,
                    active_stake: row.try_get(5).map_err(anyhow::Error::from)?,
                    retiring_epoch: None,
                };
                lines.push(serde_json::to_string(&row).map_err(anyhow::Error::from)?);
            }
            Ok(Bytes::from(lines.join("\n")))
        })
        .await?;
    let text = std::str::from_utf8(&lines).map_err(anyhow::Error::from)?;
    let page: Vec<&str> = text
        .split('\n')
        .filter(|line| !line.is_empty())
        .skip(offset)
        .take(PAGE)
        .collect();
    Ok(json(Bytes::from(format!("[{}]", page.join(",")))))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct InfoBody {
    _pool_bech32_ids: Vec<String>,
}

#[derive(Serialize)]
struct InfoRow {
    pool_id_bech32: String,
    meta_json: Option<Box<RawValue>>,
    margin: Option<f64>,
    fixed_cost: Option<String>,
    pledge: Option<String>,
    live_pledge: Option<String>,
    live_stake: Option<String>,
    live_saturation: Option<serde_json::Number>,
    live_delegators: i64,
    block_count: i64,
    pool_status: &'static str,
    retiring_epoch: Option<i32>,
}

/// A pool's latest terms and state, its metadata as fetched, the blocks it
/// has made, its owners, and what saturation is measured against: the
/// current epoch's supply over its optimal pool count.
const POOL: &str = "with cur as materialized (select max(epoch_no) as no from epoch_param) \
     select ph.id, ph.view::text, l.margin, l.fixed_cost::text, l.pledge::text, r.retiring_epoch::int, \
       o.json::text, \
       (select count(*) from block b where b.slot_leader_id in \
          (select sl.id from slot_leader sl where sl.pool_hash_id = ph.id)) as blocks, \
       array(select po.addr_id from pool_owner po where po.pool_update_id = l.id) as owners, \
       cur.no::bigint, \
       (select ep.optimal_pool_count::bigint from epoch_param ep where ep.epoch_no = cur.no), \
       (select (ap.treasury + ap.rewards + ap.utxo + ap.deposits_stake + ap.deposits_drep \
                + ap.deposits_proposal + ap.fees)::text from ada_pots ap where ap.epoch_no = cur.no) \
     from pool_hash ph cross join cur \
     join lateral (select pu.* from pool_update pu where pu.hash_id = ph.id \
                   order by pu.registered_tx_id desc, pu.cert_index desc limit 1) l on true \
     left join lateral (select pr.retiring_epoch from pool_retire pr \
                        where pr.hash_id = ph.id and pr.announced_tx_id > l.registered_tx_id \
                        order by pr.announced_tx_id desc, pr.cert_index desc limit 1) r on true \
     left join lateral (select json from off_chain_pool_data where pmr_id = l.meta_id \
                        order by id desc limit 1) o on true \
     where ph.hash_raw = $1::bytea";

/// The pool's live delegators (`$1`, its `pool_hash.id`), each with all it
/// holds but its rewards: unspent outputs, instant rewards and refunds, less
/// what it has withdrawn. A delegator is one whose latest delegation is to
/// the pool, not since deregistered, and in this epoch's stake: Koios's
/// `pool_delegators_list` adds back every such account its cache lacks.
/// `epoch_stake` already leaves out what a pool's retirement dropped.
const DELEGATORS: &str = "with cur as materialized (select max(epoch_no) as no from epoch_param), \
     latest as materialized ( \
       select d.addr_id from delegation d \
       where d.pool_hash_id = $1::bigint \
         and not exists (select 1 from delegation d2 where d2.addr_id = d.addr_id and d2.id > d.id) \
         and not exists (select 1 from stake_deregistration sd where sd.addr_id = d.addr_id and sd.tx_id > d.tx_id) \
         and exists (select 1 from epoch_stake es where es.addr_id = d.addr_id and es.epoch_no = (select no from cur))) \
     select l.addr_id, \
       (coalesce((select sum(o.value) from tx_out o where o.stake_address_id = l.addr_id \
                    and o.consumed_by_tx_id is null), 0) \
        + coalesce((select sum(rr.amount) from reward_rest rr where rr.addr_id = l.addr_id \
                      and rr.spendable_epoch <= (select no from cur)), 0) \
        - coalesce((select sum(w.amount) from withdrawal w where w.addr_id = l.addr_id), 0))::text \
     from latest l";

/// Rewards spendable by an epoch (`$2`), for the accounts that have any (`$1`).
const REWARDS: &str = "select addr_id, sum(amount)::text from reward \
     where addr_id = any($1::bigint[]) and spendable_epoch <= $2::bigint group by addr_id";

/// The current epoch's stake snapshot of a pool (`$1`) at epoch `$2`:
/// its active stake and delegators, and its owners' (`$3`) stake in it.
const SNAPSHOT: &str = "select ps.stake::text, ps.number_of_delegators::bigint, \
       (select coalesce(sum(es.amount), 0)::text from epoch_stake es \
          where es.epoch_no = $2::bigint and es.pool_id = $1::bigint and es.addr_id = any($3::bigint[])) \
     from pool_stat ps where ps.pool_hash_id = $1::bigint and ps.epoch_no = $2::bigint";

/// How long a request waits for a pool's live figures before it answers with
/// the epoch's snapshot instead. The live ones go on being worked out and are
/// kept, so the next look has them: a large pool's first, read from a cold
/// disk, took 12 s, and a wallet shouldn't wait that, nor give up on this server for it.
const LIVE_BUDGET: Duration = Duration::from_secs(3);

/// Koios's `ROUND(stake / limit * 100, 2)`, half away from zero.
fn saturation(stake: i128, limit: i128) -> Option<serde_json::Number> {
    if limit <= 0 {
        return None;
    }
    let hundredths = (stake * 10_000 * 2 + limit) / (limit * 2);
    serde_json::Number::from_f64(hundredths as f64 / 100.0)
}

/// A pool as `POOL` reads it.
#[derive(Clone)]
struct Pool {
    id: i64,
    view: String,
    margin: Option<f64>,
    fixed_cost: Option<String>,
    pledge: Option<String>,
    retiring: Option<i32>,
    meta: Option<String>,
    blocks: i64,
    owners: HashSet<i64>,
    epoch: i64,
    /// What saturation is measured against: the epoch's supply over its optimal pool count.
    limit: Option<i128>,
}

impl Pool {
    fn status(&self) -> &'static str {
        match self.retiring {
            None => "registered",
            Some(at) if i64::from(at) > self.epoch => "retiring",
            Some(_) => "retired",
        }
    }
}

/// A pool's stake, its owners' share of it, and its delegators.
struct Figures {
    stake: i128,
    pledged: i128,
    delegators: i64,
}

async fn read_pool(state: &AppState, raw: &[u8]) -> Result<Option<Pool>, ApiError> {
    let client = state.chain.public().await?;
    let Some(row) = client
        .query_opt(POOL, &[&raw])
        .await
        .map_err(anyhow::Error::from)?
    else {
        return Ok(None);
    };
    let read = |error: tokio_postgres::Error| ApiError::from(anyhow::Error::from(error));
    let optimal: Option<i64> = row.try_get(10).map_err(read)?;
    let supply: Option<String> = row.try_get(11).map_err(read)?;
    let limit = match (supply, optimal) {
        (Some(supply), Some(optimal)) if optimal > 0 => {
            Some(supply.parse::<i128>().map_err(anyhow::Error::from)? / i128::from(optimal))
        }
        _ => None,
    };
    Ok(Some(Pool {
        id: row.try_get(0).map_err(read)?,
        view: row.try_get(1).map_err(read)?,
        margin: row.try_get(2).map_err(read)?,
        fixed_cost: row.try_get(3).map_err(read)?,
        pledge: row.try_get(4).map_err(read)?,
        retiring: row.try_get(5).map_err(read)?,
        meta: row.try_get(6).map_err(read)?,
        blocks: row.try_get(7).map_err(read)?,
        owners: row
            .try_get::<_, Vec<i64>>(8)
            .map_err(read)?
            .into_iter()
            .collect(),
        epoch: row.try_get(9).map_err(read)?,
        limit,
    }))
}

/// The pool's live figures: every live delegator's balance, rewards from [`Rewards`].
async fn live(state: &AppState, pool: &Pool) -> Result<Figures, ApiError> {
    let client = state.chain.public().await?;
    let read = |error: tokio_postgres::Error| ApiError::from(anyhow::Error::from(error));
    let mut held: HashMap<i64, i128> = HashMap::new();
    for row in client.query(DELEGATORS, &[&pool.id]).await.map_err(read)? {
        let account: i64 = row.try_get(0).map_err(read)?;
        let text: String = row.try_get(1).map_err(read)?;
        held.insert(account, text.parse().map_err(anyhow::Error::from)?);
    }
    let accounts: Vec<i64> = held.keys().copied().collect();
    let (mut rewards, missing) = state.rewards.known(pool.epoch, &accounts);
    if !missing.is_empty() {
        let mut read_now = HashMap::new();
        for row in client
            .query(REWARDS, &[&missing, &pool.epoch])
            .await
            .map_err(read)?
        {
            let account: i64 = row.try_get(0).map_err(read)?;
            let text: String = row.try_get(1).map_err(read)?;
            read_now.insert(account, text.parse::<i128>().map_err(anyhow::Error::from)?);
        }
        // An account with no rewards at all has no row: it's 0, and known.
        for account in &missing {
            read_now.entry(*account).or_insert(0);
        }
        state.rewards.keep(pool.epoch, &read_now);
        rewards.extend(read_now);
    }
    let balance =
        |account: &i64| (held[account] + rewards.get(account).copied().unwrap_or(0)).max(0);
    Ok(Figures {
        stake: accounts.iter().map(balance).sum(),
        pledged: accounts
            .iter()
            .filter(|a| pool.owners.contains(a))
            .map(balance)
            .sum(),
        delegators: accounts.len() as i64,
    })
}

/// The epoch's snapshot of the pool, in place of live figures still being worked out.
async fn snapshot(state: &AppState, pool: &Pool) -> Result<Figures, ApiError> {
    let client = state.chain.public().await?;
    let owners: Vec<i64> = pool.owners.iter().copied().collect();
    let row = client
        .query_opt(SNAPSHOT, &[&pool.id, &pool.epoch, &owners])
        .await
        .map_err(anyhow::Error::from)?;
    let read = |error: tokio_postgres::Error| ApiError::from(anyhow::Error::from(error));
    let Some(row) = row else {
        return Ok(Figures {
            stake: 0,
            pledged: 0,
            delegators: 0,
        });
    };
    let number = |text: String| text.parse::<i128>().map_err(anyhow::Error::from);
    Ok(Figures {
        stake: number(row.try_get(0).map_err(read)?)?,
        delegators: row.try_get(1).map_err(read)?,
        pledged: number(row.try_get(2).map_err(read)?)?,
    })
}

fn info_row(pool: &Pool, figures: &Figures) -> Result<InfoRow, ApiError> {
    let retired = pool.status() == "retired";
    Ok(InfoRow {
        pool_id_bech32: pool.view.clone(),
        meta_json: pool
            .meta
            .clone()
            .map(RawValue::from_string)
            .transpose()
            .map_err(anyhow::Error::from)?,
        margin: pool.margin,
        fixed_cost: pool.fixed_cost.clone(),
        pledge: pool.pledge.clone(),
        live_pledge: (!retired).then(|| figures.pledged.to_string()),
        live_stake: (!retired).then(|| figures.stake.to_string()),
        live_saturation: if retired {
            None
        } else {
            pool.limit
                .and_then(|limit| saturation(figures.stake, limit))
        },
        live_delegators: figures.delegators,
        block_count: pool.blocks,
        pool_status: pool.status(),
        retiring_epoch: pool.retiring,
    })
}

/// Works a pool's row out with its live figures and keeps it. One db-sync
/// doesn't know isn't kept: anyone can ask about made-up pools. One whose
/// figures can't be worked out is remembered a while, so its next looks go
/// straight to the snapshot rather than try again.
async fn refresh(state: &AppState, key: &str, raw: &[u8]) -> Result<(), ApiError> {
    let worked = async {
        if let Some(pool) = read_pool(state, raw).await? {
            let row = to_json(&info_row(&pool, &live(state, &pool).await?)?)?;
            state.keep(key, INFO_KEEP, row);
        }
        Ok(())
    }
    .await;
    if worked.is_err() {
        state.keep(&failed(key), FAILED_KEEP, Bytes::from_static(b"1"));
    }
    worked
}

/// Where a pool's failed refresh is remembered.
fn failed(key: &str) -> String {
    format!("{key}/failed")
}

/// A pool's row with the epoch's snapshot in place of its live figures.
async fn from_snapshot(state: &AppState, raw: &[u8]) -> Result<Option<Bytes>, ApiError> {
    match read_pool(state, raw).await? {
        Some(pool) => Ok(Some(to_json(&info_row(
            &pool,
            &snapshot(state, &pool).await?,
        )?)?)),
        None => Ok(None),
    }
}

/// One pool's row, its live figures kept for 10 minutes. Past them, the old
/// row answers at once while a fresh one is worked out behind it, for 10
/// minutes more at most. Rows are kept by epoch, since a pool's status turns
/// at an epoch's start, and by the pool's bytes, not the text asked.
///
/// At most [`REFRESHING`] pools are worked out at once: each holds a public
/// connection for up to 10 s, and a request naming several slow pools must
/// not hold them all. Past that, a look gets the epoch's snapshot.
async fn one_pool(
    state: &Arc<AppState>,
    epoch: i64,
    raw: &[u8],
) -> Result<Option<Bytes>, ApiError> {
    static REFRESHES: Semaphore = Semaphore::const_new(REFRESHING);
    let hex: String = raw.iter().map(|b| format!("{b:02x}")).collect();
    let key = format!("pool_info/{epoch}/{hex}");
    if let Some(row) = state.kept(&key) {
        return Ok(Some(row));
    }
    let stale = state.kept_stale(&key, INFO_KEEP);
    let free = || REFRESHES.try_acquire().ok();
    let start = || {
        if state.kept(&failed(&key)).is_some() {
            return None;
        }
        let working = state.start(&key)?;
        Some((working, free()?))
    };
    if let Some(row) = stale {
        if let Some((working, permit)) = start() {
            let (state, key, raw) = (state.clone(), key.clone(), raw.to_vec());
            tokio::spawn(async move {
                let _held = (working, permit);
                let _ = refresh(&state, &key, &raw).await;
            });
        }
        return Ok(Some(row));
    }
    // Another request is working it out, it failed lately, or too many are being worked out.
    let Some((working, permit)) = start() else {
        return from_snapshot(state, raw).await;
    };
    let task = {
        let (state, key, raw) = (state.clone(), key.clone(), raw.to_vec());
        tokio::spawn(async move {
            let _held = (working, permit);
            refresh(&state, &key, &raw).await
        })
    };
    match tokio::time::timeout(LIVE_BUDGET, task).await {
        Ok(Ok(Ok(()))) => match state.kept(&key) {
            Some(row) => Ok(Some(row)),
            None => from_snapshot(state, raw).await,
        },
        Ok(Ok(Err(error))) => Err(error),
        Ok(Err(error)) => Err(ApiError::from(anyhow::Error::from(error))),
        Err(_) => from_snapshot(state, raw).await,
    }
}

/// The pools asked for; one db-sync doesn't know has no row.
pub async fn pool_info(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    let mut q = Query::parse(raw.as_deref())?;
    q.exactly("select", INFO_COLUMNS)?;
    q.end()?;
    let request: InfoBody = body(&headers, &bytes)?;
    let ids = &request._pool_bech32_ids;
    if ids.is_empty() || ids.len() > MAX_POOLS || !distinct(ids) {
        return Err(NOT_ASKED);
    }
    let pools = ids
        .iter()
        .map(|id| pool_bytes(id).map(|raw| (id, raw)).ok_or(NOT_ASKED))
        .collect::<Result<Vec<_>, _>>()?;
    let tip = state.fresh_tip()?;
    let mut rows = Vec::new();
    for (_, raw) in pools {
        if let Some(row) = one_pool(&state, tip.epoch, &raw).await? {
            rows.push(String::from_utf8(row.to_vec()).map_err(anyhow::Error::from)?);
        }
    }
    Ok(json(Bytes::from(format!("[{}]", rows.join(",")))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saturation_rounds_as_postgres_does() {
        assert_eq!(saturation(6321, 10_000).unwrap().to_string(), "63.21");
        assert_eq!(saturation(63_215, 100_000).unwrap().to_string(), "63.22");
        assert_eq!(saturation(63_214, 100_000).unwrap().to_string(), "63.21");
        assert_eq!(saturation(0, 10).unwrap().to_string(), "0.0");
        assert!(saturation(1, 0).is_none());
    }

    #[test]
    fn rewards_are_kept_for_their_epoch() {
        let rewards = Rewards::default();
        let (known, missing) = rewards.known(660, &[1, 2]);
        assert!(known.is_empty() && missing == [1, 2]);
        rewards.keep(660, &HashMap::from([(1, 5), (2, 0)]));
        let (known, missing) = rewards.known(660, &[1, 2, 3]);
        assert_eq!((known.len(), missing), (2, vec![3]));
        // A new epoch starts over.
        let (known, _) = rewards.known(661, &[1]);
        assert!(known.is_empty());
        // Sums read for an epoch that has since ended aren't kept.
        rewards.keep(660, &HashMap::from([(1, 5)]));
        assert!(rewards.known(661, &[1]).0.is_empty());
        // Nor does a late read for the old epoch wipe the new one's.
        rewards.keep(661, &HashMap::from([(1, 7)]));
        assert_eq!(rewards.known(660, &[1]).1, [1]);
        assert_eq!(rewards.known(661, &[1]).0[&1], 7);
    }
}
