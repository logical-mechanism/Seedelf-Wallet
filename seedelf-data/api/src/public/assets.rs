//! `asset_nft_address` and `asset_info`: who holds an NFT (an ADA Handle's
//! address), and a token's metadata (an NFT's image). Each names what one
//! user is looking at, so neither is cached.
//!
//! Koios answers both from its asset cache (a token's supply, its latest
//! mint); here they're read from `ma_tx_mint` per request, which db-sync
//! indexes by token.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{RawQuery, State};
use axum::http::HeaderMap;
use axum::response::Response;
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;

use super::query::{NOT_ASKED, Query};
use super::{array, body};
use crate::ids::{hex_any, hex_bytes};
use crate::state::{ApiError, AppState, json};

/// The longest asset name: 32 bytes.
const MAX_NAME: usize = 32;

fn token(policy: &str, name: &str) -> Result<(Vec<u8>, Vec<u8>), ApiError> {
    let policy = hex_bytes(policy, 28).ok_or(NOT_ASKED)?;
    let name = hex_any(name)
        .filter(|name| name.len() <= MAX_NAME)
        .ok_or(NOT_ASKED)?;
    Ok((policy, name))
}

#[derive(Serialize)]
struct HolderRow {
    payment_address: String,
    stake_address: Option<String>,
}

/// Where an NFT (a token whose supply is exactly 1) sits, by Koios's rule:
/// its unspent output, or, once it has ever been burned, the last output
/// that held it. Its outputs are gathered first, then each is looked up on
/// its own (`offset 0`). Left to itself, the planner walked every output
/// there is, newest first, until it met one of them, and a join ordered by
/// `tx_out.id` still let it: a handle last moved five months ago took 2.5 s,
/// some past the 10 s cap. This way, under 25 ms cold.
const HOLDER: &str = "with token as materialized ( \
       select m.id, (select sum(quantity) from ma_tx_mint where ident = m.id) as supply, \
         exists (select 1 from ma_tx_mint where ident = m.id and quantity < 0) as burned \
       from multi_asset m where m.policy = $1::bytea and m.name = $2::bytea), \
     outs as materialized ( \
       select mto.tx_out_id as id, t.burned from token t join ma_tx_out mto on mto.ident = t.id \
       where t.supply = 1), \
     held as ( \
       select outs.id from outs cross join lateral ( \
         select 1 from tx_out o where o.id = outs.id \
           and (outs.burned or o.consumed_by_tx_id is null) offset 0) x \
       order by outs.id desc limit 1) \
     select a.address::text, sa.view::text from held h join tx_out o on o.id = h.id \
     join address a on a.id = o.address_id left join stake_address sa on sa.id = o.stake_address_id";

/// Who holds an NFT: an ADA Handle's address, by its name.
pub async fn asset_nft_address(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
) -> Result<Response, ApiError> {
    let mut q = Query::parse(raw.as_deref())?;
    let policy = q.value("_asset_policy")?;
    let name = q.value("_asset_name")?;
    q.end()?;
    let (policy, name) = token(&policy, &name)?;
    state.fresh_tip()?;
    let client = state.chain.public().await?;
    let rows = client
        .query(HOLDER, &[&policy, &name])
        .await
        .map_err(anyhow::Error::from)?;
    let rows = rows
        .iter()
        .map(|row| {
            Ok(HolderRow {
                payment_address: row.try_get(0)?,
                stake_address: row.try_get(1)?,
            })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(json(array(&rows)?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AssetsBody {
    _asset_list: Vec<[String; 2]>,
}

#[derive(Serialize)]
struct MetadataRow {
    minting_tx_metadata: Option<Box<RawValue>>,
    cip68_metadata: Option<Box<RawValue>>,
}

/// CIP-67's labels, by the four bytes a name starts with, as Koios reads them.
fn cip67_label(name: &[u8]) -> Option<u16> {
    match name.get(..4)? {
        [0x00, 0x06, 0x43, 0xb0] => Some(100),
        [0x00, 0x0d, 0xe1, 0x40] => Some(222),
        [0x00, 0x14, 0xdf, 0x10] => Some(333),
        [0x00, 0x1b, 0xc2, 0x80] => Some(444),
        [0x00, 0x1f, 0x4d, 0x70] => Some(500),
        _ => None,
    }
}

/// A minted token's metadata, by Koios's rule: the metadata of its latest
/// minting transaction that carried any, or else of its latest mint.
///
/// Mints are read newest first along `unique_ma_tx_mint` (token, tx), and
/// only the latest 10,000: a token minted 573,000 times took past 20 s read
/// whole, and 0.1 s this way. Only a token whose metadata is older than its
/// last 10,000 mints would differ from Koios, and no NFT is minted so often.
const MINTED: &str = "with token as materialized ( \
       select m.id from multi_asset m where m.policy = $1::bytea and m.name = $2::bytea), \
     recent as materialized ( \
       select mtm.tx_id from ma_tx_mint mtm where mtm.ident = (select id from token) and mtm.quantity > 0 \
       order by mtm.ident desc, mtm.tx_id desc limit 10000), \
     chosen as (select coalesce( \
       (select r.tx_id from recent r where exists (select 1 from tx_metadata tm where tm.tx_id = r.tx_id) \
          order by r.tx_id desc limit 1), \
       (select max(tx_id) from recent)) as tx_id) \
     select c.tx_id is not null, \
       (select json_object_agg(tm.key::text, tm.json order by tm.key)::text \
          from tx_metadata tm where tm.tx_id = c.tx_id) \
     from chosen c";

/// A CIP-68 reference token's datum (`$1` its policy, `$2` its name): the
/// last output that held it, its datum as db-sync's JSON of it.
const REFERENCE: &str = "select d.value::text from multi_asset m \
     join lateral (select max(tx_out_id) as id from ma_tx_out where ident = m.id) last on true \
     join tx_out o on o.id = last.id join datum d on d.hash = o.data_hash \
     where m.policy = $1::bytea and m.name = $2::bytea";

/// A token's metadata for its image: CIP-25's from its minting transaction,
/// CIP-68's from its reference token's datum, keyed by the token's label.
pub async fn asset_info(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    let mut q = Query::parse(raw.as_deref())?;
    q.exactly("select", "minting_tx_metadata,cip68_metadata")?;
    q.end()?;
    let request: AssetsBody = body(&headers, &bytes)?;
    let [[policy, name]] = request._asset_list.as_slice() else {
        return Err(NOT_ASKED);
    };
    let (policy, name) = token(policy, name)?;
    state.fresh_tip()?;
    let client = state.chain.public().await?;
    let read = |error: tokio_postgres::Error| ApiError::from(anyhow::Error::from(error));
    let row = client
        .query_one(MINTED, &[&policy, &name])
        .await
        .map_err(read)?;
    if !row.try_get::<_, bool>(0).map_err(read)? {
        return Ok(json(array::<MetadataRow>(&[])?));
    }
    let minted: Option<String> = row.try_get(1).map_err(read)?;
    let cip68 = match cip67_label(&name) {
        Some(label) => {
            let mut reference = vec![0x00, 0x06, 0x43, 0xb0];
            reference.extend_from_slice(&name[4..]);
            let datum = client
                .query_opt(REFERENCE, &[&policy, &reference])
                .await
                .map_err(read)?;
            match datum {
                Some(row) => row
                    .try_get::<_, Option<String>>(0)
                    .map_err(read)?
                    .map(|value| format!("{{\"{label}\":{value}}}")),
                None => None,
            }
        }
        None => None,
    };
    let raw = |text: Option<String>| -> Result<Option<Box<RawValue>>, ApiError> {
        Ok(text
            .map(RawValue::from_string)
            .transpose()
            .map_err(anyhow::Error::from)?)
    };
    Ok(json(array(&[MetadataRow {
        minting_tx_metadata: raw(minted)?,
        cip68_metadata: raw(cip68)?,
    }])?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cip67_labels_are_read_from_the_prefix() {
        assert_eq!(cip67_label(&[0x00, 0x0d, 0xe1, 0x40, 0x61]), Some(222));
        assert_eq!(cip67_label(&[0x00, 0x06, 0x43, 0xb0]), Some(100));
        assert_eq!(cip67_label(&[0x61, 0x62]), None);
        assert_eq!(cip67_label(&[]), None);
    }

    #[test]
    fn a_token_is_a_policy_and_a_short_name() {
        let policy = "ab".repeat(28);
        assert!(token(&policy, "").is_ok());
        assert!(token(&policy, &"00".repeat(32)).is_ok());
        assert!(token(&policy, &"00".repeat(33)).is_err());
        assert!(token("ab", "").is_err());
    }
}
