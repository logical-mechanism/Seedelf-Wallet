//! `pool_history`: a pool's last 18 epochs, for its return on stake (web
//! wallet chunk 37), in Koios's columns: each epoch's active stake, the
//! blocks it made, and what it paid its stake after its fees.
//!
//! **Every pool's epoch at once, kept.** db-sync's `reward` (457M rows) has
//! an index on `pool_id` and one on `earned_epoch`, none on both: one pool
//! over 18 epochs is read through the epochs and filtered, 21M rows for 0.6M
//! (3.2 s from a cold disk, 1.1 s warm, measured 2026-10-15), as much as
//! every pool's. One epoch for every pool is 0.18 s. So each epoch's every
//! pool is worked out once and kept for the server's life ([`History`]):
//! the 18 newest whose rewards are final, the oldest dropped as an epoch
//! turns. A pool's look is then a lookup.
//!
//! **Koios's `grest.get_pool_history_data_bulk`** (koios-artifacts,
//! CC-BY-4.0) is what each row follows: the stake from the epoch's snapshot,
//! the blocks by slot leader, the members' and leader's rewards earned in
//! it, and the terms active then for the pool's fees. Two differences: no
//! epoch here is ever left without its rewards, which Koios's cache leaves
//! for every other epoch; and a pool that made blocks and was paid nothing
//! (a pledge not met) paid `"0"`, where Koios says null.
//!
//! **The stake comes from `pool_stat`,** a step ahead of `epoch_stake`: its
//! row for epoch E − 1 is `epoch_stake`'s sum for E, which Koios reads
//! (checked 2026-10-15), without reading an epoch's 1.3M `epoch_stake` rows.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::{RawQuery, State};
use axum::response::Response;
use serde::Serialize;
use tracing::warn;

use super::query::{NOT_ASKED, Query};
use crate::ids::pool_bytes;
use crate::state::{ApiError, AppState, Throttle, failure, json, to_json};

/// Epochs in a history: what `koios.ts` asks for (`POOL_EPOCHS`), about 90 days.
pub const EPOCHS: i64 = 18;

/// How many epochs back the newest is: an epoch's rewards are paid at the
/// start of the one two after it, and db-sync's are final then.
const NEWEST: i64 = 2;

/// What `koios.ts` selects (`POOL_HISTORY_COLUMNS`).
const COLUMNS: &str = "epoch_no,active_stake,block_cnt,deleg_rewards";

/// The newest epoch worked out this soon after its rewards were paid (slots
/// into the epoch) is worked out again a while later: db-sync may still be
/// finishing them.
const SETTLING_SLOTS: i64 = 3600;

/// How long an epoch worked out while settling is kept.
const SETTLING_KEEP: Duration = Duration::from_secs(600);

/// How long a request waits for epochs still being worked out (after a
/// start, or as an epoch turns): past it, it answers with those done.
const BUDGET: Duration = Duration::from_secs(3);

/// How often the window is filled behind the requests, the first time once db-sync's tip has been read.
const FILL_EVERY: Duration = Duration::from_secs(60);
const FIRST_FILL: Duration = Duration::from_secs(5);

/// One pool's epoch.
#[derive(Clone, Debug, PartialEq)]
struct Paid {
    /// Lovelace, as db-sync writes it.
    stake: String,
    blocks: i64,
    /// What it paid its stake after its fees (lovelace): none without its terms.
    deleg: Option<i128>,
}

/// Every pool's epoch, by key hash (`pool_hash.hash_raw`).
type Pools = HashMap<Vec<u8>, Paid>;

struct Held {
    pools: Arc<Pools>,
    /// Kept until then, or for good.
    until: Option<Instant>,
}

/// The epochs worked out, by epoch.
#[derive(Default)]
pub struct History {
    epochs: Mutex<BTreeMap<i64, Held>>,
    /// One fill at a time: the others wait, then find nothing left.
    filling: tokio::sync::Mutex<()>,
}

/// The epochs a history holds when the current epoch is `current`, newest first.
fn window(current: i64) -> impl Iterator<Item = i64> {
    (current - NEWEST - EPOCHS + 1..=current - NEWEST).rev()
}

impl History {
    /// The window's epochs not held, or held past their time, newest first.
    fn missing(&self, current: i64, now: Instant) -> Vec<i64> {
        let held = self.epochs.lock().expect("history lock");
        window(current)
            .filter(|epoch| {
                held.get(epoch)
                    .is_none_or(|h| h.until.is_some_and(|until| now >= until))
            })
            .collect()
    }

    /// Keeps an epoch, and drops those older than the window.
    fn keep(&self, current: i64, epoch: i64, pools: Pools, until: Option<Instant>) {
        let mut held = self.epochs.lock().expect("history lock");
        held.retain(|e, _| *e > current - NEWEST - EPOCHS);
        let pools = Arc::new(pools);
        held.insert(epoch, Held { pools, until });
    }

    /// A pool's rows, newest first: each epoch of the window held that it had stake in.
    fn rows(&self, current: i64, raw: &[u8]) -> Vec<Row> {
        let held = self.epochs.lock().expect("history lock");
        window(current)
            .filter_map(|epoch| {
                let paid = held.get(&epoch)?.pools.get(raw)?;
                Some(Row {
                    epoch_no: epoch,
                    active_stake: paid.stake.clone(),
                    block_cnt: paid.blocks,
                    deleg_rewards: paid.deleg.map(|lovelace| lovelace.to_string()),
                })
            })
            .collect()
    }
}

/// One epoch of the answer, as Koios's `pool_history` gives it.
#[derive(Serialize, Debug, PartialEq)]
struct Row {
    epoch_no: i64,
    active_stake: String,
    block_cnt: i64,
    deleg_rewards: Option<String>,
}

/// Every pool with stake in an epoch (`$1`): its key hash, its stake (from
/// `pool_stat` a step ahead), the blocks it made, its members' and leader's
/// rewards earned in it, and its terms active then, as Koios takes them.
const EPOCH: &str = "with stake as materialized ( \
       select pool_hash_id, stake from pool_stat \
       where epoch_no = $1::bigint - 1 and number_of_delegators > 0), \
     blocks as materialized ( \
       select sl.pool_hash_id, count(*) as made from block b join slot_leader sl on sl.id = b.slot_leader_id \
       where b.epoch_no = $1::bigint and sl.pool_hash_id is not null group by sl.pool_hash_id), \
     paid as materialized ( \
       select pool_id, sum(amount) filter (where type = 'member') as member, \
         sum(amount) filter (where type = 'leader') as leader \
       from reward where earned_epoch = $1::bigint and type in ('member', 'leader') group by pool_id) \
     select ph.hash_raw, s.stake::text, coalesce(b.made, 0), p.member::text, p.leader::text, \
       t.margin, t.fixed_cost::text \
     from stake s join pool_hash ph on ph.id = s.pool_hash_id \
     left join blocks b on b.pool_hash_id = s.pool_hash_id \
     left join paid p on p.pool_id = s.pool_hash_id \
     left join lateral (select pu.margin, pu.fixed_cost from pool_update pu \
                        where pu.hash_id = s.pool_hash_id and pu.active_epoch_no <= $1::bigint \
                        order by pu.active_epoch_no desc, pu.id desc limit 1) t on true";

/// What a pool paid its stake for an epoch, Koios's `deleg_rewards`: its
/// members' rewards and its leader's, less the pool's fees (its cost, then
/// its margin of what's left), or the members' alone when the leader's don't
/// cover the cost. In floating point and rounded half to even, as Postgres
/// works Koios's out (a `numeric` times a `double precision` margin).
fn deleg_rewards(
    blocks: i64,
    member: i128,
    leader: i128,
    terms: Option<(f64, i128)>,
) -> Option<i128> {
    if blocks == 0 || member + leader == 0 {
        return Some(0);
    }
    let (margin, cost) = terms?;
    if leader < cost {
        return Some(member);
    }
    let fees = cost as f64 + (member + leader - cost) as f64 * margin;
    Some((member as f64 + (leader as f64 - fees)).round_ties_even() as i128)
}

/// Every pool's epoch, from db-sync.
async fn read_epoch(state: &AppState, epoch: i64) -> Result<Pools, ApiError> {
    let client = state.chain.public().await?;
    let rows = client
        .query(EPOCH, &[&epoch])
        .await
        .map_err(anyhow::Error::from)?;
    let read = |error: tokio_postgres::Error| ApiError::from(anyhow::Error::from(error));
    let lovelace = |text: Option<String>| -> Result<i128, ApiError> {
        Ok(text
            .map(|t| t.parse())
            .transpose()
            .map_err(anyhow::Error::from)?
            .unwrap_or(0))
    };
    let mut pools = HashMap::with_capacity(rows.len());
    for row in &rows {
        let blocks: i64 = row.try_get(2).map_err(read)?;
        let member = lovelace(row.try_get(3).map_err(read)?)?;
        let leader = lovelace(row.try_get(4).map_err(read)?)?;
        let margin: Option<f64> = row.try_get(5).map_err(read)?;
        let cost: Option<String> = row.try_get(6).map_err(read)?;
        let terms = match (margin, cost) {
            (Some(margin), Some(cost)) => Some((margin, lovelace(Some(cost))?)),
            _ => None,
        };
        pools.insert(
            row.try_get(0).map_err(read)?,
            Paid {
                stake: row.try_get(1).map_err(read)?,
                blocks,
                deleg: deleg_rewards(blocks, member, leader, terms),
            },
        );
    }
    Ok(pools)
}

/// Works out every epoch the window lacks, newest first, one at a time.
pub async fn fill(state: &AppState) -> Result<(), ApiError> {
    let _one = state.history.filling.lock().await;
    let tip = state.fresh_tip()?;
    for epoch in state.history.missing(tip.epoch, Instant::now()) {
        let pools = read_epoch(state, epoch).await?;
        let settling = epoch == tip.epoch - NEWEST && tip.epoch_slot < SETTLING_SLOTS;
        let until = settling.then(|| Instant::now() + SETTLING_KEEP);
        state.history.keep(tip.epoch, epoch, pools, until);
    }
    Ok(())
}

/// Keeps the window filled behind the requests, every minute, for as long
/// as the server runs: its 18 epochs after a start (a few seconds), then one
/// as each epoch turns.
pub async fn keep_filled(state: Arc<AppState>) {
    static FAILED: Throttle = Throttle::new();
    let mut every = tokio::time::interval_at(tokio::time::Instant::now() + FIRST_FILL, FILL_EVERY);
    every.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        every.tick().await;
        // Behind or busy, it's filled at the next tick, or by the next request.
        if let Err(ApiError::Unavailable(error)) = fill(&state).await
            && FAILED.due()
        {
            warn!(
                error = failure(&error),
                "a pool history epoch couldn't be read"
            );
        }
    }
}

/// A pool's last 18 epochs, newest first; none for a pool db-sync doesn't know.
pub async fn pool_history(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
) -> Result<Response, ApiError> {
    let mut q = Query::parse(raw.as_deref())?;
    let pool = q.value("_pool_bech32")?;
    q.exactly("select", COLUMNS)?;
    q.exactly("order", "epoch_no.desc")?;
    q.exactly("limit", &EPOCHS.to_string())?;
    q.end()?;
    let raw = pool_bytes(&pool).ok_or(NOT_ASKED)?;
    let tip = state.fresh_tip()?;
    if !state.history.missing(tip.epoch, Instant::now()).is_empty() {
        // Worked out behind the request, which goes on if the request stops waiting.
        let filling = tokio::spawn({
            let state = state.clone();
            async move { fill(&state).await }
        });
        if let Ok(Ok(Err(error))) = tokio::time::timeout(BUDGET, filling).await {
            return Err(error);
        }
    }
    Ok(json(to_json(&state.history.rows(tip.epoch, &raw))?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deleg_rewards_are_koioss() {
        // OctasPool's epoch 659 on mainnet Koios: deleg_rewards 13897448406, pool_fees 466212952 and
        // member_rewards 13779548001 (so the leader's 584113357), at a 0.9% margin and a 340 ₳ cost.
        assert_eq!(
            deleg_rewards(51, 13_779_548_001, 584_113_357, Some((0.009, 340_000_000))),
            Some(13_897_448_406)
        );
        // No blocks, nothing paid; blocks and nothing paid (a pledge not met), nothing paid, where Koios says null.
        assert_eq!(deleg_rewards(0, 0, 0, None), Some(0));
        assert_eq!(deleg_rewards(3, 0, 0, Some((0.01, 340_000_000))), Some(0));
        // The leader's under the cost: the pool keeps them, and the members' are all its stake was paid.
        assert_eq!(
            deleg_rewards(1, 500, 100, Some((0.01, 340_000_000))),
            Some(500)
        );
        // Paid with no terms to take fees by: not known.
        assert_eq!(deleg_rewards(1, 500, 400_000_000, None), None);
    }

    fn paid(stake: &str) -> Pools {
        HashMap::from([(
            vec![1; 28],
            Paid {
                stake: stake.into(),
                blocks: 2,
                deleg: Some(5),
            },
        )])
    }

    #[test]
    fn the_window_is_the_18_epochs_whose_rewards_are_final() {
        assert_eq!(
            window(661).collect::<Vec<_>>(),
            (642..=659).rev().collect::<Vec<_>>()
        );
        let history = History::default();
        let now = Instant::now();
        assert_eq!(
            history.missing(661, now),
            (642..=659).rev().collect::<Vec<_>>()
        );
        for epoch in 642..=659 {
            history.keep(661, epoch, paid("1"), None);
        }
        assert!(history.missing(661, now).is_empty());
        // An epoch turns: the new newest is missing, and the oldest goes.
        assert_eq!(history.missing(662, now), [660]);
        history.keep(662, 660, paid("2"), None);
        assert!(!history.epochs.lock().unwrap().contains_key(&642));
        assert_eq!(history.rows(662, &[1; 28]).len(), 18);
    }

    #[test]
    fn an_epoch_worked_out_while_settling_is_worked_out_again() {
        let history = History::default();
        let now = Instant::now();
        for epoch in 642..=659 {
            history.keep(661, epoch, paid("1"), None);
        }
        history.keep(661, 659, paid("1"), Some(now + SETTLING_KEEP));
        assert!(history.missing(661, now).is_empty());
        assert_eq!(history.missing(661, now + SETTLING_KEEP), [659]);
    }

    #[test]
    fn a_pools_rows_are_its_epochs_newest_first() {
        let history = History::default();
        history.keep(661, 659, paid("7"), None);
        history.keep(661, 657, paid("5"), None);
        assert_eq!(
            history.rows(661, &[1; 28]),
            [
                Row {
                    epoch_no: 659,
                    active_stake: "7".into(),
                    block_cnt: 2,
                    deleg_rewards: Some("5".into()),
                },
                Row {
                    epoch_no: 657,
                    active_stake: "5".into(),
                    block_cnt: 2,
                    deleg_rewards: Some("5".into()),
                },
            ]
        );
        assert!(history.rows(661, &[2; 28]).is_empty());
    }
}
