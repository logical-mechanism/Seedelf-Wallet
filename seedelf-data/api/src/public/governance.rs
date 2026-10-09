//! `drep_info`, `drep_metadata`, `proposal_list` and `vote_list`: DReps,
//! their profiles, the live governance actions, and the account's own
//! DRep's votes. A DRep's answers and the action list are the same for
//! everyone and are kept; a DRep's votes name the account's own DRep, so they aren't.

use std::sync::Arc;
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::{RawQuery, State};
use axum::http::HeaderMap;
use axum::response::Response;
use serde::Deserialize;
use serde_json::{Map, Value, json};

use super::query::{NOT_ASKED, Query, natural};
use super::{array, body, distinct};
use crate::ids::{Drep, decode, drep_id, gov_action_id, gov_action_parts};
use crate::state::{ApiError, AppState, json as answer, to_json};

/// How long a DRep's standing or profile is kept.
const DREP_KEEP: Duration = Duration::from_secs(600);

/// How long the live governance actions are kept.
const PROPOSALS_KEEP: Duration = Duration::from_secs(300);

/// DReps in one `drep_info` or `drep_metadata`: the wallet asks about one.
const MAX_DREPS: usize = 5;

/// Actions in one `vote_list` (`koios.ts`'s `VOTES_PER_REQUEST`).
const MAX_VOTED: usize = 40;

/// Rows in a page of the action list.
const PAGE: usize = 1000;

/// What `koios.ts` selects (`DREP_INFO_COLUMNS`, `DREP_STANDING_COLUMNS`).
const INFO_COLUMNS: &str =
    "drep_id,drep_status,active,expires_epoch_no,amount,live_delegator_count";
const STANDING_COLUMNS: &str = "drep_id,drep_status,active,expires_epoch_no,amount,live_delegator_count,deposit,meta_url,meta_hash";

/// `DREP_PROFILE_COLUMNS` and `DREP_NAME_COLUMNS`: PostgREST names `meta_json->body->givenName` `givenName`.
const PROFILE_COLUMNS: &str = "drep_id,is_valid,meta_json->body->givenName";
const NAME_COLUMNS: &str = "drep_id,meta_json->body->givenName";

const LIVE: [(&str, &str); 4] = [
    ("ratified_epoch", "is.null"),
    ("enacted_epoch", "is.null"),
    ("dropped_epoch", "is.null"),
    ("expired_epoch", "is.null"),
];
const PROPOSAL_COLUMNS: &str = "proposal_id,proposal_tx_hash,proposal_index,proposal_type,proposed_epoch,\
     expiration,deposit,meta_url,meta_hash,meta_is_valid,title:meta_json->body->>title,\
     abstract:meta_json->body->>abstract,block_time,withdrawal";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DrepsBody {
    _drep_ids: Vec<String>,
}

/// The DReps asked for, parsed, with the text each was asked by.
fn dreps(headers: &HeaderMap, bytes: &[u8]) -> Result<Vec<(String, Drep)>, ApiError> {
    let request: DrepsBody = body(headers, bytes)?;
    let ids = request._drep_ids;
    if ids.is_empty() || ids.len() > MAX_DREPS || !distinct(&ids) {
        return Err(NOT_ASKED);
    }
    ids.into_iter()
        .map(|id| {
            let drep = Drep::parse(&id).ok_or(NOT_ASKED)?;
            Ok((id, drep))
        })
        .collect()
}

/// A DRep as kept answers know it: by its bytes, so its CIP-105 and CIP-129
/// IDs share one answer. Each is made from the DRep, never from the text asked.
fn drep_key(drep: &Drep) -> String {
    match drep {
        Drep::Credential { raw, script } => {
            let hex: String = raw.iter().map(|b| format!("{b:02x}")).collect();
            format!("{}{hex}", if *script { "script/" } else { "key/" })
        }
        Drep::Predefined(name) => (*name).to_string(),
    }
}

/// A DRep's `drep_hash.id`, if db-sync knows it.
const DREP_HASH: &str = "select id from drep_hash where raw = $1::bytea and has_script = $2::bool";
const PREDEFINED_HASH: &str = "select id from drep_hash where raw is null and view = $1::text";

async fn drep_hash_id(
    client: &deadpool_postgres::Object,
    drep: &Drep,
) -> Result<Option<i64>, ApiError> {
    let row = match drep {
        Drep::Credential { raw, script } => client.query_opt(DREP_HASH, &[raw, script]).await,
        Drep::Predefined(view) => client.query_opt(PREDEFINED_HASH, &[view]).await,
    }
    .map_err(anyhow::Error::from)?;
    Ok(row.map(|row| row.get(0)))
}

/// Keeps only the columns selected, by the names PostgREST gives them.
fn selected(row: &Value, columns: &str) -> Value {
    let mut out = Map::new();
    for column in columns.split(',') {
        let key = column.rsplit("->").next().unwrap_or(column);
        out.insert(
            key.to_string(),
            row.get(key).cloned().unwrap_or(Value::Null),
        );
    }
    Value::Object(out)
}

/// Koios's `drep_info`, for one DRep (`$1`, its `drep_hash.id`):
///
/// - **its state:** the latest registration, update or retirement; a
///   retirement makes it `deregistered`, no row at all `not_registered`;
/// - **active:** its last registration, update or vote is within the
///   `drep_activity` epochs, or the ledger's `active_until` is later;
/// - **its delegators:** accounts whose latest vote delegation is to it, made
///   since its last registration, not deregistered since. `delegation_vote`
///   isn't indexed by account or DRep at home, so this reads it whole: 250 ms
///   for the DRep with the most, kept 10 minutes.
const DREP_STATE: &str = "with cur as materialized ( \
       select ep.epoch_no::bigint as no, ep.drep_activity::bigint as activity \
       from epoch_param ep order by ep.epoch_no desc limit 1), \
     last_reg as materialized ( \
       select dr.tx_id, dr.deposit from drep_registration dr \
       where dr.drep_hash_id = $1::bigint and dr.deposit >= 0 order by dr.tx_id desc limit 1), \
     last_row as materialized ( \
       select dr.tx_id, dr.deposit, dr.voting_anchor_id from drep_registration dr \
       where dr.drep_hash_id = $1::bigint order by dr.tx_id desc limit 1), \
     acts as materialized ( \
       select max(tx_id) as tx_id from ( \
         select tx_id from last_reg \
         union all select max(dr.tx_id) from drep_registration dr \
           where dr.drep_hash_id = $1::bigint and dr.deposit is null \
         union all select max(vp.tx_id) from voting_procedure vp where vp.drep_voter = $1::bigint) a), \
     latest as materialized ( \
       select distinct on (dv.addr_id) dv.addr_id, dv.tx_id, dv.drep_hash_id \
       from delegation_vote dv order by dv.addr_id, dv.tx_id desc) \
     select dh.raw, dh.has_script, dh.view::text, \
       exists (select 1 from last_row) as has_row, lr.deposit < 0 as retired, \
       (select deposit::text from last_reg) as deposit, \
       (select b.epoch_no::bigint from acts a join tx t on t.id = a.tx_id join block b on b.id = t.block_id) \
         as last_epoch, \
       cur.no, cur.activity, \
       (select dd.amount::text from drep_distr dd where dd.hash_id = $1::bigint and dd.epoch_no = cur.no) as amount, \
       (select dd.active_until::bigint from drep_distr dd where dd.hash_id = $1::bigint and dd.epoch_no = cur.no) \
         as active_until, \
       va.url::text, encode(va.data_hash, 'hex'), \
       (select count(*) from latest l where l.drep_hash_id = $1::bigint \
          and (not exists (select 1 from last_reg) or l.tx_id >= (select tx_id from last_reg)) \
          and not exists (select 1 from stake_deregistration sd where sd.addr_id = l.addr_id and sd.tx_id > l.tx_id)) \
     from drep_hash dh cross join cur \
     left join last_row lr on true \
     left join voting_anchor va on va.id = lr.voting_anchor_id \
     where dh.id = $1::bigint";

/// Every column of Koios's `drep_info` the wallet selects, by Koios's rules.
async fn drep_state(client: &deadpool_postgres::Object, id: i64) -> Result<Value, ApiError> {
    let row = client
        .query_one(DREP_STATE, &[&id])
        .await
        .map_err(anyhow::Error::from)?;
    let read = |error: tokio_postgres::Error| ApiError::from(anyhow::Error::from(error));
    let raw: Option<Vec<u8>> = row.try_get(0).map_err(read)?;
    let script: bool = row.try_get(1).map_err(read)?;
    let view: String = row.try_get(2).map_err(read)?;
    let has_row: bool = row.try_get(3).map_err(read)?;
    let retired: Option<bool> = row.try_get(4).map_err(read)?;
    let deposit: Option<String> = row.try_get(5).map_err(read)?;
    let last_epoch: Option<i64> = row.try_get(6).map_err(read)?;
    let epoch: i64 = row.try_get(7).map_err(read)?;
    let activity: i64 = row.try_get(8).map_err(read)?;
    let amount: Option<String> = row.try_get(9).map_err(read)?;
    let active_until: Option<i64> = row.try_get(10).map_err(read)?;
    let predefined = raw.is_none();
    let retired = retired == Some(true);
    let status = if predefined {
        "registered"
    } else if !has_row {
        "not_registered"
    } else if retired {
        "deregistered"
    } else {
        "registered"
    };
    let recent = last_epoch.map(|last| epoch - last <= activity);
    let until = active_until.unwrap_or(0);
    let active = predefined || (!retired && (recent == Some(true) || until > epoch));
    let expires = (!retired).then(|| {
        let own = last_epoch.map(|last| last + activity);
        own.map_or(until, |own| own.max(until))
    });
    Ok(json!({
        "drep_id": match &raw {
            Some(raw) => drep_id(raw, script),
            None => view,
        },
        "drep_status": status,
        "active": active,
        "expires_epoch_no": expires,
        "amount": amount.unwrap_or_else(|| "0".into()),
        "live_delegator_count": row.try_get::<_, i64>(13).map_err(read)?,
        "deposit": if retired || predefined { None } else { deposit },
        "meta_url": row.try_get::<_, Option<String>>(11).map_err(read)?,
        "meta_hash": row.try_get::<_, Option<String>>(12).map_err(read)?,
    }))
}

/// A DRep's profile: the latest registration's or update's anchor, and what
/// db-sync fetched from it. A predefined DRep, or one never registered, has none.
const PROFILE: &str = "select o.json::text, o.is_valid \
     from (select dr.voting_anchor_id from drep_registration dr where dr.drep_hash_id = $1::bigint \
           order by dr.tx_id desc limit 1) lr \
     left join lateral (select json, is_valid from off_chain_vote_data \
                        where voting_anchor_id = lr.voting_anchor_id order by id desc limit 1) o on true";

async fn drep_profile(
    client: &deadpool_postgres::Object,
    id: i64,
    drep: &Drep,
) -> Result<Option<Value>, ApiError> {
    let Drep::Credential { raw, script } = drep else {
        return Ok(None);
    };
    let Some(row) = client
        .query_opt(PROFILE, &[&id])
        .await
        .map_err(anyhow::Error::from)?
    else {
        return Ok(None);
    };
    let read = |error: tokio_postgres::Error| ApiError::from(anyhow::Error::from(error));
    let meta: Option<String> = row.try_get(0).map_err(read)?;
    let meta: Option<Value> = meta
        .map(|text| serde_json::from_str(&text))
        .transpose()
        .map_err(anyhow::Error::from)?;
    let given = meta
        .as_ref()
        .and_then(|m| m.get("body"))
        .and_then(|b| b.get("givenName"))
        .cloned()
        .unwrap_or(Value::Null);
    Ok(Some(json!({
        "drep_id": drep_id(raw, *script),
        "is_valid": row.try_get::<_, Option<bool>>(1).map_err(read)?,
        "givenName": given,
    })))
}

/// A DRep's standing: active or not, its voting power and delegators, and
/// (for the account's own) its deposit and profile anchor.
pub async fn drep_info(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    let mut q = Query::parse(raw.as_deref())?;
    let columns = q.value("select")?;
    q.end()?;
    if columns != INFO_COLUMNS && columns != STANDING_COLUMNS {
        return Err(NOT_ASKED);
    }
    let dreps = dreps(&headers, &bytes)?;
    let tip = state.fresh_tip()?;
    let mut rows = Vec::new();
    for (_, drep) in dreps {
        // By epoch: a DRep's activity and expiry turn at an epoch's start.
        let key = format!("drep_info/{}/{}", tip.epoch, drep_key(&drep));
        let kept = state
            .lasting(&key, DREP_KEEP, || async {
                let client = state.chain.public().await?;
                match drep_hash_id(&client, &drep).await? {
                    Some(id) => to_json(&drep_state(&client, id).await?),
                    None => Ok(Bytes::new()),
                }
            })
            .await?;
        if !kept.is_empty() {
            let row: Value = serde_json::from_slice(&kept).map_err(anyhow::Error::from)?;
            rows.push(selected(&row, &columns));
        }
    }
    Ok(answer(array(&rows)?))
}

/// A DRep's name from its CIP-119 profile, and whether the profile matched its hash.
pub async fn drep_metadata(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    let mut q = Query::parse(raw.as_deref())?;
    let columns = q.value("select")?;
    q.end()?;
    if columns != PROFILE_COLUMNS && columns != NAME_COLUMNS {
        return Err(NOT_ASKED);
    }
    let dreps = dreps(&headers, &bytes)?;
    state.fresh_tip()?;
    let mut rows = Vec::new();
    for (_, drep) in dreps {
        let kept = state
            .lasting(
                &format!("drep_metadata/{}", drep_key(&drep)),
                DREP_KEEP,
                || async {
                    let client = state.chain.public().await?;
                    let Some(id) = drep_hash_id(&client, &drep).await? else {
                        return Ok(Bytes::new());
                    };
                    match drep_profile(&client, id, &drep).await? {
                        Some(profile) => to_json(&profile),
                        None => Ok(Bytes::new()),
                    }
                },
            )
            .await?;
        if !kept.is_empty() {
            let row: Value = serde_json::from_slice(&kept).map_err(anyhow::Error::from)?;
            rows.push(selected(&row, &columns));
        }
    }
    Ok(answer(array(&rows)?))
}

/// Every live governance action: none ratified, enacted, dropped or expired.
/// Only the anchor's title and abstract are taken from its metadata, as the wallet selects them.
const PROPOSALS: &str = "select tx.hash, gap.index::int, gap.type::text, b.epoch_no::int, gap.expiration::int, \
       gap.deposit::text, va.url::text, encode(va.data_hash, 'hex'), o.is_valid, \
       o.json -> 'body' ->> 'title', o.json -> 'body' ->> 'abstract', extract(epoch from b.time)::bigint, \
       (select coalesce(json_agg(json_build_object('stake_address', sa.view, 'amount', tw.amount::text) \
                 order by tw.id), '[]') \
          from treasury_withdrawal tw join stake_address sa on sa.id = tw.stake_address_id \
          where tw.gov_action_proposal_id = gap.id)::text \
     from gov_action_proposal gap join tx on tx.id = gap.tx_id join block b on b.id = tx.block_id \
     left join voting_anchor va on va.id = gap.voting_anchor_id \
     left join lateral (select json, is_valid from off_chain_vote_data where voting_anchor_id = va.id \
                        order by id desc limit 1) o on true \
     where gap.ratified_epoch is null and gap.enacted_epoch is null \
       and gap.dropped_epoch is null and gap.expired_epoch is null";

/// The live governance actions, the newest proposed first, kept five minutes.
pub async fn proposal_list(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
) -> Result<Response, ApiError> {
    let mut q = Query::parse(raw.as_deref())?;
    for (key, value) in LIVE {
        q.exactly(key, value)?;
    }
    q.exactly("select", PROPOSAL_COLUMNS)?;
    q.exactly("order", "proposed_epoch.desc,proposal_id.asc")?;
    let offset = natural(&q.value("offset")?)? as usize;
    q.exactly("limit", &PAGE.to_string())?;
    q.end()?;
    if !offset.is_multiple_of(PAGE) {
        return Err(NOT_ASKED);
    }
    let tip = state.fresh_tip()?;
    // By epoch: actions are ratified, enacted, dropped and expire at an epoch's start.
    let lines = state
        .lasting(&format!("proposal_list/{}", tip.epoch), PROPOSALS_KEEP, || async {
            let client = state.chain.public().await?;
            let read = |error: tokio_postgres::Error| ApiError::from(anyhow::Error::from(error));
            let mut rows = Vec::new();
            for row in client.query(PROPOSALS, &[]).await.map_err(read)? {
                let hash: Vec<u8> = row.try_get(0).map_err(read)?;
                let index: i32 = row.try_get(1).map_err(read)?;
                let withdrawal: String = row.try_get(12).map_err(read)?;
                let id = gov_action_id(&hash, u8::try_from(index).map_err(anyhow::Error::from)?);
                let epoch: i32 = row.try_get(3).map_err(read)?;
                rows.push((
                    epoch,
                    id.clone(),
                    json!({
                        "proposal_id": id,
                        "proposal_tx_hash": hash.iter().map(|b| format!("{b:02x}")).collect::<String>(),
                        "proposal_index": index,
                        "proposal_type": row.try_get::<_, String>(2).map_err(read)?,
                        "proposed_epoch": epoch,
                        "expiration": row.try_get::<_, Option<i32>>(4).map_err(read)?,
                        "deposit": row.try_get::<_, Option<String>>(5).map_err(read)?,
                        "meta_url": row.try_get::<_, Option<String>>(6).map_err(read)?,
                        "meta_hash": row.try_get::<_, Option<String>>(7).map_err(read)?,
                        "meta_is_valid": row.try_get::<_, Option<bool>>(8).map_err(read)?,
                        "title": row.try_get::<_, Option<String>>(9).map_err(read)?,
                        "abstract": row.try_get::<_, Option<String>>(10).map_err(read)?,
                        "block_time": row.try_get::<_, i64>(11).map_err(read)?,
                        "withdrawal": serde_json::from_str::<Value>(&withdrawal).map_err(anyhow::Error::from)?,
                    }),
                ));
            }
            // The wallet's order: the newest proposed first, then by ID.
            rows.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
            let lines: Vec<String> = rows.into_iter().map(|(_, _, row)| row.to_string()).collect();
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
    Ok(answer(Bytes::from(format!("[{}]", page.join(",")))))
}

/// A DRep's votes on the actions named (`$3` their transactions, `$4` their
/// indexes), the newest first. db-sync doesn't index votes by voter at home;
/// there are 36,000, read in a few milliseconds.
const VOTES: &str = "select ptx.hash, gap.index::int, vp.vote::text, extract(epoch from b.time)::bigint \
     from voting_procedure vp \
     join tx vtx on vtx.id = vp.tx_id join block b on b.id = vtx.block_id \
     join gov_action_proposal gap on gap.id = vp.gov_action_proposal_id join tx ptx on ptx.id = gap.tx_id \
     join drep_hash dh on dh.id = vp.drep_voter \
     where dh.raw = $1::bytea and dh.has_script = $2::bool \
       and (ptx.hash, gap.index::int) in (select * from unnest($3::bytea[], $4::int[])) \
     order by b.time desc, vp.id desc";

/// The account's own DRep's votes on the live actions: a vote cast again replaces the one before.
pub async fn vote_list(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
) -> Result<Response, ApiError> {
    let mut q = Query::parse(raw.as_deref())?;
    let voter = q.value("voter_id")?;
    let actions = q.value("proposal_id")?;
    q.exactly("select", "proposal_id,vote,block_time")?;
    q.exactly("order", "block_time.desc")?;
    q.end()?;
    // Koios matches the voter's CIP-129 ID as text: any other form of it finds nothing there.
    let voter = voter.strip_prefix("eq.").ok_or(NOT_ASKED)?;
    let (raw, script) = match (decode(voter), Drep::parse(voter)) {
        (Some((_, bytes)), Some(Drep::Credential { raw, script })) if bytes.len() == 29 => {
            (raw, script)
        }
        _ => return Err(NOT_ASKED),
    };
    let actions: Vec<String> = actions
        .strip_prefix("in.(")
        .and_then(|rest| rest.strip_suffix(')'))
        .ok_or(NOT_ASKED)?
        .split(',')
        .map(str::to_string)
        .collect();
    if actions.is_empty() || actions.len() > MAX_VOTED || !distinct(&actions) {
        return Err(NOT_ASKED);
    }
    let (hashes, indexes): (Vec<Vec<u8>>, Vec<i32>) = actions
        .iter()
        .map(|id| {
            gov_action_parts(id)
                .map(|(h, i)| (h, i32::from(i)))
                .ok_or(NOT_ASKED)
        })
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .unzip();
    state.fresh_tip()?;
    let client = state.chain.public().await?;
    let read = |error: tokio_postgres::Error| ApiError::from(anyhow::Error::from(error));
    let mut votes = Vec::new();
    for row in client
        .query(VOTES, &[&raw, &script, &hashes, &indexes])
        .await
        .map_err(read)?
    {
        let hash: Vec<u8> = row.try_get(0).map_err(read)?;
        let index: i32 = row.try_get(1).map_err(read)?;
        votes.push(json!({
            "proposal_id": gov_action_id(&hash, u8::try_from(index).map_err(anyhow::Error::from)?),
            "vote": row.try_get::<_, String>(2).map_err(read)?,
            "block_time": row.try_get::<_, i64>(3).map_err(read)?,
        }));
    }
    Ok(answer(array(&votes)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_selection_keeps_postgrests_names() {
        let row = json!({"drep_id": "d", "is_valid": true, "givenName": "Farid", "extra": 1});
        assert_eq!(
            selected(&row, NAME_COLUMNS),
            json!({"drep_id": "d", "givenName": "Farid"})
        );
        assert_eq!(
            selected(&row, PROFILE_COLUMNS),
            json!({"drep_id": "d", "is_valid": true, "givenName": "Farid"})
        );
    }
}
