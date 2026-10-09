//! `tx_info`: what transactions did, in the two shapes the wallet asks for.
//!
//! - **Activity** (`txInfo`): inputs and outputs with their tokens, the fee,
//!   metadata, withdrawals, certificates and votes.
//! - **What was spent** (`txSpends`): inputs alone, each with its credential and outpoint.
//!
//! **What's left out:** collateral, reference inputs, mints, scripts, datums
//! and proposals, which the wallet never reads from `tx_info`; and among
//! certificates, all but the seven kinds a wallet's own account makes
//! (stake registration, deregistration and delegation, vote delegation, and a
//! DRep's registration, update and retirement).

use std::collections::HashMap;
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{RawQuery, State};
use axum::http::HeaderMap;
use axum::response::Response;
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use serde_json::{Value, json};

use super::query::{NOT_ASKED, Query};
use super::utxos::Asset;
use super::{array, body, distinct};
use crate::ids::{cc_hot_id, drep_shown, hex_bytes};
use crate::state::{ApiError, AppState, json as answer};

/// Transactions in one `tx_info` (`koios.ts`'s `TXS_PER_REQUEST`, Activity's `PAGE`).
const MAX_TXS: usize = 20;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TxInfoBody {
    _tx_hashes: Vec<String>,
    _inputs: bool,
    _metadata: bool,
    _assets: bool,
    _withdrawals: bool,
    _certs: bool,
    _scripts: bool,
    _bytecode: bool,
    _governance: Option<bool>,
}

/// What a request asks for beyond inputs and outputs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Parts {
    assets: bool,
    metadata: bool,
    withdrawals: bool,
    certs: bool,
    governance: bool,
}

impl TxInfoBody {
    /// The wallet's two shapes, and only those.
    fn parts(&self) -> Option<Parts> {
        let flags = (
            self._inputs,
            self._metadata,
            self._assets,
            self._withdrawals,
            self._certs,
            self._scripts,
            self._bytecode,
            self._governance,
        );
        match flags {
            (true, true, true, true, true, false, false, Some(true)) => Some(Parts {
                assets: true,
                metadata: true,
                withdrawals: true,
                certs: true,
                governance: true,
            }),
            (true, false, false, false, false, false, false, None) => Some(Parts {
                assets: false,
                metadata: false,
                withdrawals: false,
                certs: false,
                governance: false,
            }),
            _ => None,
        }
    }
}

#[derive(Serialize)]
struct PaymentAddr {
    bech32: String,
    cred: Option<String>,
}

#[derive(Serialize)]
struct TxOut {
    payment_addr: PaymentAddr,
    stake_addr: Option<String>,
    tx_hash: String,
    tx_index: i32,
    value: String,
    datum_hash: Option<String>,
    asset_list: Vec<Asset>,
}

#[derive(Serialize)]
struct Withdrawal {
    amount: String,
    stake_addr: String,
}

#[derive(Serialize)]
struct Certificate {
    index: Option<i32>,
    #[serde(rename = "type")]
    kind: String,
    info: Value,
}

#[derive(Serialize)]
struct Vote {
    proposal_tx_hash: String,
    proposal_index: i32,
    voter_role: String,
    voter: Option<String>,
    voter_hex: Option<String>,
    vote: String,
}

#[derive(Serialize)]
struct TxInfo {
    tx_hash: String,
    block_hash: String,
    block_height: Option<i64>,
    epoch_no: Option<i64>,
    epoch_slot: Option<i64>,
    absolute_slot: Option<i64>,
    tx_timestamp: i64,
    tx_block_index: i64,
    tx_size: i64,
    total_output: String,
    fee: String,
    treasury_donation: String,
    deposit: Option<String>,
    invalid_before: Option<String>,
    invalid_after: Option<String>,
    valid_contract: bool,
    inputs: Vec<TxOut>,
    outputs: Vec<TxOut>,
    withdrawals: Vec<Withdrawal>,
    metadata: Option<Box<RawValue>>,
    certificates: Vec<Certificate>,
    voting_procedures: Vec<Vote>,
}

const TXS: &str = "select t.id, encode(t.hash, 'hex'), encode(b.hash, 'hex'), b.block_no::bigint, \
       b.epoch_no::bigint, b.epoch_slot_no::bigint, b.slot_no::bigint, extract(epoch from b.time)::bigint, \
       t.block_index::bigint, t.size::bigint, t.out_sum::text, t.fee::text, t.treasury_donation::text, \
       t.deposit::text, t.invalid_before::text, t.invalid_hereafter::text, t.valid_contract \
     from tx t join block b on b.id = t.block_id where t.hash = any($1::bytea[]) order by t.id";

/// The outputs the transactions made and the ones they spent, with tokens when `$2`.
const OUTS: &str = "select o.tx_id, o.consumed_by_tx_id, a.address::text, encode(a.payment_cred, 'hex'), \
       sa.view::text, encode(t.hash, 'hex'), o.index::int, o.value::text, encode(o.data_hash, 'hex'), \
       case when $2::bool then \
         (select coalesce(json_agg(json_build_array(encode(m.policy, 'hex'), encode(m.name, 'hex'), \
                 m.fingerprint::text, mto.quantity::text) order by mto.id), '[]')::text \
            from ma_tx_out mto join multi_asset m on m.id = mto.ident where mto.tx_out_id = o.id) \
       else '[]' end \
     from tx_out o join tx t on t.id = o.tx_id join address a on a.id = o.address_id \
     left join stake_address sa on sa.id = o.stake_address_id \
     where o.tx_id = any($1::bigint[]) or o.consumed_by_tx_id = any($1::bigint[]) \
     order by t.hash, o.index";

const WITHDRAWALS: &str = "select w.tx_id, w.amount::text, sa.view::text \
     from withdrawal w join stake_address sa on sa.id = w.addr_id \
     where w.tx_id = any($1::bigint[]) order by w.id";

/// Each transaction's metadata, by label, as db-sync's JSON of it.
const METADATA: &str = "select tx_id, json_object_agg(key::text, json order by key)::text \
     from tx_metadata where tx_id = any($1::bigint[]) group by tx_id";

/// The seven kinds of certificate a wallet's own account makes, as one shape:
/// the stake address, a deposit, the pool, the DRep, its anchor.
const CERTS: &str = "\
     select sr.tx_id, sr.cert_index, 'stake_registration' as kind, sa.view::text as stake, \
       sr.deposit::text as deposit, null::text as pool, null::bytea as pool_raw, \
       null::bytea as drep_raw, null::bool as drep_script, null::text as drep_view, \
       null::text as meta_url, null::bytea as meta_hash \
     from stake_registration sr join stake_address sa on sa.id = sr.addr_id where sr.tx_id = any($1::bigint[]) \
     union all \
     select sd.tx_id, sd.cert_index, 'stake_deregistration', sa.view::text, null, null, null, null, null, null, null, null \
     from stake_deregistration sd join stake_address sa on sa.id = sd.addr_id where sd.tx_id = any($1::bigint[]) \
     union all \
     select d.tx_id, d.cert_index, 'pool_delegation', sa.view::text, null, ph.view::text, ph.hash_raw, null, null, null, null, null \
     from delegation d join stake_address sa on sa.id = d.addr_id join pool_hash ph on ph.id = d.pool_hash_id \
     where d.tx_id = any($1::bigint[]) \
     union all \
     select dv.tx_id, dv.cert_index, 'vote_delegation', sa.view::text, null, null, null, dh.raw, dh.has_script, dh.view::text, null, null \
     from delegation_vote dv join stake_address sa on sa.id = dv.addr_id join drep_hash dh on dh.id = dv.drep_hash_id \
     where dv.tx_id = any($1::bigint[]) \
     union all \
     select dr.tx_id, dr.cert_index, \
       case when dr.deposit is null then 'drep_update' when dr.deposit >= 0 then 'drep_registration' else 'drep_retire' end, \
       null, case when dr.deposit >= 0 then dr.deposit::text end, null, null, dh.raw, dh.has_script, dh.view::text, \
       case when dr.deposit is null or dr.deposit >= 0 then va.url::text end, \
       case when dr.deposit is null or dr.deposit >= 0 then va.data_hash end \
     from drep_registration dr join drep_hash dh on dh.id = dr.drep_hash_id \
     left join voting_anchor va on va.id = dr.voting_anchor_id where dr.tx_id = any($1::bigint[]) \
     order by 1, 2";

const VOTES: &str = "select vp.tx_id, encode(ptx.hash, 'hex'), gap.index::int, vp.voter_role::text, \
       dh.raw, coalesce(dh.has_script, false), dh.view::text, ph.view::text, ph.hash_raw, \
       ch.raw, coalesce(ch.has_script, false), vp.vote::text \
     from voting_procedure vp join gov_action_proposal gap on gap.id = vp.gov_action_proposal_id \
     join tx ptx on ptx.id = gap.tx_id \
     left join drep_hash dh on dh.id = vp.drep_voter \
     left join pool_hash ph on ph.id = vp.pool_voter \
     left join committee_hash ch on ch.id = vp.committee_voter \
     where vp.tx_id = any($1::bigint[]) order by vp.id";

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// A certificate's `info`, with Koios's keys for its kind.
fn cert_info(row: &tokio_postgres::Row) -> anyhow::Result<(String, Value)> {
    let kind: String = row.try_get(2)?;
    let stake: Option<String> = row.try_get(3)?;
    let deposit: Option<String> = row.try_get(4)?;
    let pool: Option<String> = row.try_get(5)?;
    let pool_raw: Option<Vec<u8>> = row.try_get(6)?;
    let drep_raw: Option<Vec<u8>> = row.try_get(7)?;
    let drep_script: Option<bool> = row.try_get(8)?;
    let drep_view: Option<String> = row.try_get(9)?;
    let meta_url: Option<String> = row.try_get(10)?;
    let meta_hash: Option<Vec<u8>> = row.try_get(11)?;
    let drep_id = drep_view
        .as_deref()
        .map(|view| drep_shown(drep_raw.as_deref(), drep_script.unwrap_or(false), view));
    let drep_hex = drep_raw.as_deref().map(hex);
    let meta_hash = meta_hash.as_deref().map(hex);
    let info = match kind.as_str() {
        "stake_registration" => json!({ "stake_address": stake, "deposit": deposit }),
        "stake_deregistration" => json!({ "stake_address": stake }),
        "pool_delegation" => json!({
            "stake_address": stake,
            "pool_id_bech32": pool,
            "pool_id_hex": pool_raw.as_deref().map(hex),
        }),
        "vote_delegation" => {
            json!({ "stake_address": stake, "drep_id": drep_id, "drep_hex": drep_hex })
        }
        "drep_registration" => json!({
            "drep_id": drep_id, "drep_hex": drep_hex, "deposit": deposit,
            "meta_url": meta_url, "meta_hash": meta_hash,
        }),
        "drep_update" => json!({
            "drep_id": drep_id, "drep_hex": drep_hex, "meta_url": meta_url, "meta_hash": meta_hash,
        }),
        _ => json!({ "drep_id": drep_id, "drep_hex": drep_hex }),
    };
    Ok((kind, info))
}

fn read_vote(row: &tokio_postgres::Row) -> anyhow::Result<Vote> {
    let drep_raw: Option<Vec<u8>> = row.try_get(4)?;
    let drep_script: bool = row.try_get(5)?;
    let drep_view: Option<String> = row.try_get(6)?;
    let pool_view: Option<String> = row.try_get(7)?;
    let pool_raw: Option<Vec<u8>> = row.try_get(8)?;
    let cc_raw: Option<Vec<u8>> = row.try_get(9)?;
    let cc_script: bool = row.try_get(10)?;
    // Koios's order: a DRep's ID, a predefined DRep's name, a committee member's, a pool's.
    let voter = match (&drep_raw, drep_view, &cc_raw) {
        (Some(raw), _, _) => Some(drep_shown(Some(raw), drep_script, "")),
        (None, Some(view), _) => Some(view),
        (None, None, Some(raw)) => Some(cc_hot_id(raw, cc_script)),
        (None, None, None) => pool_view,
    };
    let voter_hex = cc_raw.or(drep_raw).or(pool_raw).as_deref().map(hex);
    Ok(Vote {
        proposal_tx_hash: row.try_get(1)?,
        proposal_index: row.try_get(2)?,
        voter_role: row.try_get(3)?,
        voter,
        voter_hex,
        vote: row.try_get(11)?,
    })
}

/// The transactions asked for, in the order db-sync made them; one it doesn't know has no row.
pub async fn tx_info(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    Query::none(raw.as_deref())?;
    let request: TxInfoBody = body(&headers, &bytes)?;
    let parts = request.parts().ok_or(NOT_ASKED)?;
    let hashes = &request._tx_hashes;
    if hashes.is_empty() || hashes.len() > MAX_TXS || !distinct(hashes) {
        return Err(NOT_ASKED);
    }
    let hashes = hashes
        .iter()
        .map(|h| hex_bytes(h, 32).ok_or(NOT_ASKED))
        .collect::<Result<Vec<_>, _>>()?;
    state.fresh_tip()?;
    let client = state.chain.public().await?;
    let db = |error: tokio_postgres::Error| ApiError::from(anyhow::Error::from(error));

    let mut txs = Vec::new();
    let mut at = HashMap::new();
    for row in client.query(TXS, &[&hashes]).await.map_err(db)? {
        let id: i64 = row.try_get(0).map_err(db)?;
        at.insert(id, txs.len());
        txs.push(read_tx(&row).map_err(ApiError::from)?);
    }
    let ids: Vec<i64> = at.keys().copied().collect();
    if ids.is_empty() {
        return Ok(answer(array::<TxInfo>(&[])?));
    }

    for row in client
        .query(OUTS, &[&ids, &parts.assets])
        .await
        .map_err(db)?
    {
        let made: i64 = row.try_get(0).map_err(db)?;
        let spent: Option<i64> = row.try_get(1).map_err(db)?;
        let out = read_out(&row, &state).map_err(ApiError::from)?;
        // A request can hold a transaction and the one that spends its output: that output is in both.
        match (at.get(&made), spent.and_then(|id| at.get(&id))) {
            (Some(&maker), Some(&spender)) => {
                txs[spender]
                    .inputs
                    .push(read_out(&row, &state).map_err(ApiError::from)?);
                txs[maker].outputs.push(out);
            }
            (Some(&maker), None) => txs[maker].outputs.push(out),
            (None, Some(&spender)) => txs[spender].inputs.push(out),
            (None, None) => {}
        }
    }
    for tx in &mut txs {
        tx.outputs.sort_by_key(|o| o.tx_index);
    }

    if parts.withdrawals {
        for row in client.query(WITHDRAWALS, &[&ids]).await.map_err(db)? {
            let id: i64 = row.try_get(0).map_err(db)?;
            txs[at[&id]].withdrawals.push(Withdrawal {
                amount: row.try_get(1).map_err(db)?,
                stake_addr: row.try_get(2).map_err(db)?,
            });
        }
    }
    if parts.metadata {
        for row in client.query(METADATA, &[&ids]).await.map_err(db)? {
            let id: i64 = row.try_get(0).map_err(db)?;
            let text: String = row.try_get(1).map_err(db)?;
            txs[at[&id]].metadata = Some(RawValue::from_string(text).map_err(anyhow::Error::from)?);
        }
    }
    if parts.certs {
        for row in client.query(CERTS, &[&ids]).await.map_err(db)? {
            let id: i64 = row.try_get(0).map_err(db)?;
            let (kind, info) = cert_info(&row).map_err(ApiError::from)?;
            txs[at[&id]].certificates.push(Certificate {
                index: row.try_get(1).map_err(db)?,
                kind,
                info,
            });
        }
    }
    if parts.governance {
        for row in client.query(VOTES, &[&ids]).await.map_err(db)? {
            let id: i64 = row.try_get(0).map_err(db)?;
            txs[at[&id]]
                .voting_procedures
                .push(read_vote(&row).map_err(ApiError::from)?);
        }
    }
    Ok(answer(array(&txs)?))
}

fn read_tx(row: &tokio_postgres::Row) -> anyhow::Result<TxInfo> {
    Ok(TxInfo {
        tx_hash: row.try_get(1)?,
        block_hash: row.try_get(2)?,
        block_height: row.try_get(3)?,
        epoch_no: row.try_get(4)?,
        epoch_slot: row.try_get(5)?,
        absolute_slot: row.try_get(6)?,
        tx_timestamp: row.try_get(7)?,
        tx_block_index: row.try_get(8)?,
        tx_size: row.try_get(9)?,
        total_output: row.try_get(10)?,
        fee: row.try_get(11)?,
        treasury_donation: row.try_get(12)?,
        deposit: row.try_get(13)?,
        invalid_before: row.try_get(14)?,
        invalid_after: row.try_get(15)?,
        valid_contract: row.try_get(16)?,
        inputs: Vec::new(),
        outputs: Vec::new(),
        withdrawals: Vec::new(),
        metadata: None,
        certificates: Vec::new(),
        voting_procedures: Vec::new(),
    })
}

fn read_out(row: &tokio_postgres::Row, state: &AppState) -> anyhow::Result<TxOut> {
    let assets: Vec<[String; 4]> = serde_json::from_str(row.try_get::<_, &str>(9)?)?;
    Ok(TxOut {
        payment_addr: PaymentAddr {
            bech32: row.try_get(2)?,
            cred: row.try_get(3)?,
        },
        stake_addr: row.try_get(4)?,
        tx_hash: row.try_get(5)?,
        tx_index: row.try_get(6)?,
        value: row.try_get(7)?,
        datum_hash: row.try_get(8)?,
        asset_list: assets
            .into_iter()
            .map(|[policy_id, asset_name, fingerprint, quantity]| Asset {
                decimals: state.decimals.of(&policy_id, &asset_name),
                policy_id,
                asset_name,
                fingerprint,
                quantity,
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shape(text: &str) -> Option<Parts> {
        serde_json::from_str::<TxInfoBody>(text).ok()?.parts()
    }

    #[test]
    fn only_the_wallets_two_shapes() {
        let h = "ab".repeat(32);
        let activity = format!(
            r#"{{"_tx_hashes":["{h}"],"_inputs":true,"_metadata":true,"_assets":true,"_withdrawals":true,"_certs":true,"_scripts":false,"_bytecode":false,"_governance":true}}"#
        );
        assert_eq!(shape(&activity).map(|p| p.governance), Some(true));
        let spends = format!(
            r#"{{"_tx_hashes":["{h}"],"_inputs":true,"_metadata":false,"_assets":false,"_withdrawals":false,"_certs":false,"_scripts":false,"_bytecode":false}}"#
        );
        assert_eq!(shape(&spends).map(|p| p.assets), Some(false));
        // Scripts and bytecode are never asked for, nor governance without the rest.
        for bad in [
            activity.replace(r#""_scripts":false"#, r#""_scripts":true"#),
            spends.replace(r#""_bytecode":false"#, r#""_bytecode":true"#),
            spends.replace('}', r#","_governance":true}"#),
            activity.replace(r#","_governance":true"#, ""),
        ] {
            assert_eq!(shape(&bad), None, "{bad}");
        }
    }
}
