//! `tip`, `tx_status`, `epoch_params` and `totals`: the chain's state, in Koios's shapes.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{RawQuery, State};
use axum::http::HeaderMap;
use axum::response::Response;
use serde::{Deserialize, Serialize};

use super::query::{NOT_ASKED, Query};
use super::{array, body, distinct};
use crate::ids::hex_bytes;
use crate::state::{ApiError, AppState, json};

/// Transactions in one `tx_status`. The wallet asks about what it's waiting
/// for, which is a handful; a longer list must be split.
const MAX_STATUSES: usize = 100;

#[derive(Serialize)]
struct TipRow {
    hash: String,
    epoch_no: i64,
    era: Option<&'static str>,
    abs_slot: i64,
    epoch_slot: i64,
    block_height: i64,
    block_no: i64,
    block_time: i64,
}

/// The newest block, as the server last read it (every 2 s): no query.
pub async fn tip(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
) -> Result<Response, ApiError> {
    Query::none(raw.as_deref())?;
    let tip = state.fresh_tip()?;
    Ok(json(array(&[TipRow {
        hash: tip.hash,
        epoch_no: tip.epoch,
        era: tip.era,
        abs_slot: tip.slot,
        epoch_slot: tip.epoch_slot,
        block_height: tip.height,
        block_no: tip.height,
        block_time: tip.time,
    }])?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct HashesBody {
    _tx_hashes: Vec<String>,
}

#[derive(Serialize)]
struct StatusRow {
    tx_hash: String,
    num_confirmations: Option<i64>,
}

/// Each hash as asked, in order, with the blocks made since its block's (0 in
/// the newest), or null when db-sync knows no such transaction.
const STATUSES: &str = "select h.hash, (select max(block_no) from block)::bigint - b.block_no::bigint \
     from unnest($1::text[]) with ordinality as h(hash, n) \
     left join tx t on t.hash = decode(h.hash, 'hex') \
     left join block b on b.id = t.block_id \
     order by h.n";

/// How many blocks each transaction has behind it; null until it's on chain.
pub async fn tx_status(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    Query::none(raw.as_deref())?;
    let request: HashesBody = body(&headers, &bytes)?;
    let hashes = request._tx_hashes;
    if hashes.is_empty()
        || hashes.len() > MAX_STATUSES
        || !distinct(&hashes)
        || hashes.iter().any(|h| hex_bytes(h, 32).is_none())
    {
        return Err(NOT_ASKED);
    }
    state.fresh_tip()?;
    let client = state.chain.public().await?;
    let rows = client
        .query(STATUSES, &[&hashes])
        .await
        .map_err(anyhow::Error::from)?;
    let statuses = rows
        .iter()
        .map(|row| {
            Ok(StatusRow {
                tx_hash: row.try_get(0)?,
                num_confirmations: row.try_get(1)?,
            })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(json(array(&statuses)?))
}

/// The newest epoch's parameters, each column as Koios's `epoch_params` types
/// it: lovelace as text, the rest as numbers. `nonce` and `block_hash` are
/// what Koios takes from its epoch cache: the epoch's nonce, and the hash of
/// its first block, where these parameters start.
const PARAMS: &str = "select (jsonb_build_object( \
       'epoch_no', ep.epoch_no, 'era', null, \
       'min_fee_a', ep.min_fee_a, 'min_fee_b', ep.min_fee_b, \
       'max_block_size', ep.max_block_size, 'max_tx_size', ep.max_tx_size, \
       'max_bh_size', ep.max_bh_size, 'key_deposit', ep.key_deposit::text, \
       'pool_deposit', ep.pool_deposit::text, 'max_epoch', ep.max_epoch, \
       'optimal_pool_count', ep.optimal_pool_count, 'influence', ep.influence, \
       'monetary_expand_rate', ep.monetary_expand_rate, \
       'treasury_growth_rate', ep.treasury_growth_rate, \
       'decentralisation', ep.decentralisation, \
       'extra_entropy', encode(ep.extra_entropy, 'hex'), \
       'protocol_major', ep.protocol_major, 'protocol_minor', ep.protocol_minor, \
       'min_utxo_value', ep.min_utxo_value::text, 'min_pool_cost', ep.min_pool_cost::text, \
       'nonce', encode(ep.nonce, 'hex'), 'block_hash', encode(b.hash, 'hex'), \
       'cost_models', cm.costs, 'price_mem', ep.price_mem, 'price_step', ep.price_step) \
     || jsonb_build_object( \
       'max_tx_ex_mem', ep.max_tx_ex_mem, 'max_tx_ex_steps', ep.max_tx_ex_steps, \
       'max_block_ex_mem', ep.max_block_ex_mem, 'max_block_ex_steps', ep.max_block_ex_steps, \
       'max_val_size', ep.max_val_size, 'collateral_percent', ep.collateral_percent, \
       'max_collateral_inputs', ep.max_collateral_inputs, \
       'coins_per_utxo_size', ep.coins_per_utxo_size::text, \
       'pvt_motion_no_confidence', ep.pvt_motion_no_confidence, \
       'pvt_committee_normal', ep.pvt_committee_normal, \
       'pvt_committee_no_confidence', ep.pvt_committee_no_confidence, \
       'pvt_hard_fork_initiation', ep.pvt_hard_fork_initiation, \
       'dvt_motion_no_confidence', ep.dvt_motion_no_confidence, \
       'dvt_committee_normal', ep.dvt_committee_normal, \
       'dvt_committee_no_confidence', ep.dvt_committee_no_confidence, \
       'dvt_update_to_constitution', ep.dvt_update_to_constitution, \
       'dvt_hard_fork_initiation', ep.dvt_hard_fork_initiation, \
       'dvt_p_p_network_group', ep.dvt_p_p_network_group, \
       'dvt_p_p_economic_group', ep.dvt_p_p_economic_group, \
       'dvt_p_p_technical_group', ep.dvt_p_p_technical_group, \
       'dvt_p_p_gov_group', ep.dvt_p_p_gov_group, \
       'dvt_treasury_withdrawal', ep.dvt_treasury_withdrawal, \
       'committee_min_size', ep.committee_min_size, \
       'committee_max_term_length', ep.committee_max_term_length, \
       'gov_action_lifetime', ep.gov_action_lifetime, \
       'gov_action_deposit', ep.gov_action_deposit::text, \
       'drep_deposit', ep.drep_deposit::text, 'drep_activity', ep.drep_activity, \
       'pvtpp_security_group', ep.pvtpp_security_group, \
       'min_fee_ref_script_cost_per_byte', ep.min_fee_ref_script_cost_per_byte \
     ))::text, ep.protocol_major::int, ep.protocol_minor::int \
     from epoch_param ep \
     left join cost_model cm on cm.id = ep.cost_model_id \
     left join block b on b.id = ep.block_id \
     order by ep.epoch_no desc limit 1";

/// The newest epoch's protocol parameters: one row, which the WebAssembly
/// reads as is. Kept for a block, not an epoch: the query takes a millisecond,
/// and an epoch's first blocks can't then be answered with the last one's fees.
pub async fn epoch_params(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
) -> Result<Response, ApiError> {
    let mut q = Query::parse(raw.as_deref())?;
    q.exactly("limit", "1")?;
    q.end()?;
    let tip = state.fresh_tip()?;
    let answer = state
        .cached_bytes(&tip, "epoch_params", || async {
            let client = state.chain.public().await?;
            let row = client
                .query_one(PARAMS, &[])
                .await
                .map_err(anyhow::Error::from)?;
            let text: String = row.try_get(0).map_err(anyhow::Error::from)?;
            let mut params: serde_json::Value =
                serde_json::from_str(&text).map_err(anyhow::Error::from)?;
            let (major, minor): (i32, i32) = (
                row.try_get(1).map_err(anyhow::Error::from)?,
                row.try_get(2).map_err(anyhow::Error::from)?,
            );
            params["era"] = crate::chain::era(major, minor).into();
            array(&[params])
        })
        .await?;
    Ok(json(answer))
}

#[derive(Serialize)]
struct SupplyRow {
    epoch_no: i64,
    supply: String,
}

/// The newest epoch's supply as Koios's `totals` counts it: every pot but the reserves.
const SUPPLY: &str = "select epoch_no::bigint, (treasury + rewards + utxo + deposits_stake \
       + deposits_drep + deposits_proposal + fees)::text \
     from ada_pots order by epoch_no desc limit 1";

/// The supply of ADA, the newest epoch's: what a pool's saturation is
/// measured against. Kept for a block, as `epoch_params` is.
pub async fn totals(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
) -> Result<Response, ApiError> {
    let mut q = Query::parse(raw.as_deref())?;
    q.exactly("select", "epoch_no,supply")?;
    q.exactly("order", "epoch_no.desc")?;
    q.exactly("limit", "1")?;
    q.end()?;
    let tip = state.fresh_tip()?;
    let answer = state
        .cached_bytes(&tip, "totals", || async {
            let client = state.chain.public().await?;
            let rows = client
                .query(SUPPLY, &[])
                .await
                .map_err(anyhow::Error::from)?;
            let rows = rows
                .iter()
                .map(|row| {
                    Ok(SupplyRow {
                        epoch_no: row.try_get(0)?,
                        supply: row.try_get(1)?,
                    })
                })
                .collect::<anyhow::Result<Vec<_>>>()?;
            array(&rows)
        })
        .await?;
    Ok(json(answer))
}
