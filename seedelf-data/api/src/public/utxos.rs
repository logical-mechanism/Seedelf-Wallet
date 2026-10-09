//! `credential_utxos`, `address_utxos`, `utxo_info` and `datum_info`: Koios's
//! UTxO rows, which the wallet's WebAssembly parses (`seedelf-koios`'s
//! `UtxoResponse`), so every field it requires is here, in Koios's names and types.
//!
//! **What's left out:** the JSON of an inline datum or a reference script
//! (`value`, sent as null). The wallet cuts both the moment it reads a row
//! (`koios.ts`'s `trimmed`): registers come from the datum's bytes, and a
//! datum anyone can nest thousands of levels deep needn't cross the network.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{RawQuery, State};
use axum::http::HeaderMap;
use axum::response::Response;
use serde::{Deserialize, Serialize};

use super::query::{NOT_ASKED, Query, after, natural};
use super::{array, body, distinct};
use crate::constants::{CONTRACT_HASH, MIXBOX_HASH};
use crate::ids::{address_bytes, hex_bytes};
use crate::state::{ApiError, AppState, json};

/// Rows in a page, as the wallet asks for them.
const PAGE: i64 = 1000;

/// Payment credentials in one `credential_utxos` (`koios.ts`'s `CREDENTIALS_PER_REQUEST`).
const MAX_CREDENTIALS: usize = 75;

/// Addresses in one `address_utxos`: the order addresses a swap's fills left something at.
const MAX_ADDRESSES: usize = 20;

/// Outpoints in one `utxo_info`, and datum hashes in one `datum_info` (`REFS_PER_REQUEST`).
const MAX_REFS: usize = 60;

/// The most unspent outputs one listing gathers. Any credential or address
/// may be asked about, and one with 220,000 outputs read 2.4 GB from disk
/// for every page; no wallet comes near this many. Past it, the answer is a
/// 503, and the wallet reads Koios. The contract's and the mix box's
/// listings are kept a block for everyone, so they have no cap.
const MAX_GATHERED: i64 = 20_000;

#[derive(Serialize)]
pub struct Utxo {
    tx_hash: String,
    tx_index: i32,
    address: String,
    value: String,
    stake_address: Option<String>,
    payment_cred: Option<String>,
    epoch_no: Option<i64>,
    block_height: Option<i64>,
    block_time: i64,
    datum_hash: Option<String>,
    inline_datum: Option<InlineDatum>,
    reference_script: Option<Script>,
    asset_list: Vec<Asset>,
    is_spent: bool,
}

#[derive(Serialize)]
struct InlineDatum {
    bytes: String,
    /// Always null: see the module's note.
    value: (),
}

#[derive(Serialize)]
struct Script {
    hash: Option<String>,
    bytes: Option<String>,
    /// Always null: see the module's note.
    value: (),
    #[serde(rename = "type")]
    kind: Option<String>,
    size: Option<i64>,
}

#[derive(Serialize)]
pub struct Asset {
    pub policy_id: String,
    pub asset_name: String,
    pub fingerprint: String,
    pub decimals: u8,
    pub quantity: String,
}

/// Where a listing's outputs come from: the CTE `outs`, gathered first and on
/// its own (`chain.rs`'s lesson). `$1` is always an array of bytes.
#[derive(Clone, Copy)]
enum Outs {
    /// Unspent, at these payment credentials.
    Credentials,
    /// Unspent, at these addresses' bytes (`address.raw`, hash-indexed; `address.address` isn't indexed).
    Addresses,
    /// The outputs named, spent or not: `$1` their transactions' hashes, `$2` their indexes.
    Refs,
}

const OUT_COLUMNS: &str = "o.id, o.tx_id, o.index, o.address_id, o.stake_address_id, o.value, \
     o.data_hash, o.inline_datum_id, o.reference_script_id, o.consumed_by_tx_id";

/// Each address's unspent outputs, read on their own (`a` is the address).
/// `offset 0` keeps the planner from folding this into a join. db-sync's
/// statistics put 243 unspent outputs at every address (they count 44,000
/// distinct addresses in `tx_out`, of 54 million), so for a credential at
/// many addresses it read every unspent output on the chain instead, 26 GB a
/// page: 4.1 s for a credential at 95,000 addresses, 160 ms this way, and 4 ms
/// for a wallet's own, 0.3 ms this way.
const UNSPENT_AT: &str = "cross join lateral (select o.* from tx_out o \
     where o.address_id = a.id and o.consumed_by_tx_id is null offset 0) o";

impl Outs {
    /// `capped`: at most one past [`MAX_GATHERED`], so a listing that big can be refused.
    fn cte(self, capped: bool) -> String {
        let cap = if capped {
            format!("limit {}", MAX_GATHERED + 1)
        } else {
            String::new()
        };
        match self {
            Outs::Credentials => format!(
                "select {OUT_COLUMNS} from address a {UNSPENT_AT} \
                 where a.payment_cred = any($1::bytea[]) {cap}"
            ),
            Outs::Addresses => format!(
                "select {OUT_COLUMNS} from address a {UNSPENT_AT} \
                 where a.raw = any($1::bytea[]) {cap}"
            ),
            Outs::Refs => format!(
                "select {OUT_COLUMNS} from unnest($1::bytea[], $2::int[]) as r(hash, idx) \
                 join tx t on t.hash = r.hash join tx_out o on o.tx_id = t.id and o.index = r.idx"
            ),
        }
    }
}

/// A page's rows. `paged`: ordered by outpoint from after `$2`/`$3` (both
/// null for the first page), at most [`PAGE`], and in blocks after `$4`
/// (null for any). Otherwise every row `outs` found, in the order db-sync
/// made them. Each row says whether `outs` passed [`MAX_GATHERED`].
///
/// `block` is joined for the page's own rows only: for every gathered row it
/// was 40% of a large listing's reads. A block after height `$4` is one with
/// a larger id than the last block at or below it, since db-sync numbers
/// blocks in chain order. Mainnet has no block 0 (its first is 1), so `gt.0`
/// is every block.
fn listing(outs: Outs, paged: bool, capped: bool) -> String {
    let (filter, order, limit) = if paged {
        (
            "where ($2::bytea is null or (t.hash, o.index::int) > ($2::bytea, $3::int)) \
             and ($4::bigint is null or t.block_id > coalesce( \
                  (select id from block where block_no <= $4::bigint order by block_no desc limit 1), 0))",
            "t.hash, o.index",
            format!("limit {PAGE}"),
        )
    } else {
        ("", "o.id", String::new())
    };
    format!(
        "with outs as materialized ({cte}), \
         page as ( \
           select o.*, t.hash as tx_hash, t.block_id \
           from outs o join tx t on t.id = o.tx_id \
           {filter} order by {order} {limit}) \
         select encode(p.tx_hash, 'hex') as tx_hash, p.index::int as tx_index, \
           a.address::text as address, p.value::text as value, sa.view::text as stake_address, \
           encode(a.payment_cred, 'hex') as payment_cred, b.epoch_no::bigint as epoch_no, \
           b.block_no::bigint as block_height, extract(epoch from b.time)::bigint as block_time, \
           encode(p.data_hash, 'hex') as datum_hash, encode(d.bytes, 'hex') as datum, \
           encode(s.hash, 'hex') as script_hash, encode(s.bytes, 'hex') as script_bytes, \
           s.type::text as script_type, s.serialised_size::bigint as script_size, \
           (p.reference_script_id is not null) as has_script, \
           (p.consumed_by_tx_id is not null) as is_spent, \
           (select coalesce(json_agg(json_build_array(encode(m.policy, 'hex'), encode(m.name, 'hex'), \
                   m.fingerprint::text, mto.quantity::text) order by mto.id), '[]')::text \
              from ma_tx_out mto join multi_asset m on m.id = mto.ident \
              where mto.tx_out_id = p.id) as assets, \
           {over} as over \
         from page p join block b on b.id = p.block_id join address a on a.id = p.address_id \
         left join stake_address sa on sa.id = p.stake_address_id \
         left join datum d on d.id = p.inline_datum_id \
         left join script s on s.id = p.reference_script_id \
         order by {outer}",
        cte = outs.cte(capped),
        // The cap's count, only where there's a cap: the contract's listing has none.
        over = if capped {
            format!("(select count(*) from outs) > {MAX_GATHERED}")
        } else {
            "false".to_string()
        },
        outer = if paged { "p.tx_hash, p.index" } else { "p.id" },
    )
}

fn read_utxo(row: &tokio_postgres::Row, state: &AppState) -> anyhow::Result<Utxo> {
    let assets: Vec<[String; 4]> = serde_json::from_str(row.try_get::<_, &str>("assets")?)?;
    let datum: Option<String> = row.try_get("datum")?;
    Ok(Utxo {
        tx_hash: row.try_get("tx_hash")?,
        tx_index: row.try_get("tx_index")?,
        address: row.try_get("address")?,
        value: row.try_get("value")?,
        stake_address: row.try_get("stake_address")?,
        payment_cred: row.try_get("payment_cred")?,
        epoch_no: row.try_get("epoch_no")?,
        block_height: row.try_get("block_height")?,
        block_time: row.try_get("block_time")?,
        datum_hash: row.try_get("datum_hash")?,
        inline_datum: datum.map(|bytes| InlineDatum { bytes, value: () }),
        reference_script: if row.try_get("has_script")? {
            Some(Script {
                hash: row.try_get("script_hash")?,
                bytes: row.try_get("script_bytes")?,
                value: (),
                kind: row.try_get("script_type")?,
                size: row.try_get("script_size")?,
            })
        } else {
            None
        },
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
        is_spent: row.try_get("is_spent")?,
    })
}

/// Where a page starts: after the outpoint the wallet's `paged` names, in
/// blocks after a height. Both optional, in that order, then the fixed order and limit.
struct Page {
    after: Option<(Vec<u8>, i32)>,
    above: Option<i64>,
}

impl Page {
    fn parse(raw: Option<&str>, filter: bool) -> Result<Page, ApiError> {
        let mut q = Query::parse(raw)?;
        let above = match filter.then(|| q.optional("block_height")).flatten() {
            Some(value) => Some(after(&value, "gt.")?),
            None => None,
        };
        let after = match q.optional("or") {
            Some(value) => Some(outpoint_after(&value)?),
            None => None,
        };
        q.exactly("order", "tx_hash.asc,tx_index.asc")?;
        q.exactly("limit", &PAGE.to_string())?;
        q.end()?;
        Ok(Page { after, above })
    }
}

/// `(tx_hash.gt.H,and(tx_hash.eq.H,tx_index.gt.I))`: the rows after outpoint `H#I`.
fn outpoint_after(value: &str) -> Result<(Vec<u8>, i32), ApiError> {
    let inner = value
        .strip_prefix("(tx_hash.gt.")
        .and_then(|rest| rest.strip_suffix("))"))
        .ok_or(NOT_ASKED)?;
    let (hash, rest) = inner.split_once(",and(tx_hash.eq.").ok_or(NOT_ASKED)?;
    let (again, index) = rest.split_once(",tx_index.gt.").ok_or(NOT_ASKED)?;
    let bytes = hex_bytes(hash, 32).ok_or(NOT_ASKED)?;
    let index = natural(index)?;
    if again != hash || index > i64::from(u16::MAX) {
        return Err(NOT_ASKED);
    }
    Ok((bytes, index as i32))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CredentialsBody {
    _payment_credentials: Vec<String>,
    _extended: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AddressesBody {
    _addresses: Vec<String>,
    _extended: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RefsBody {
    _utxo_refs: Vec<String>,
    _extended: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DatumsBody {
    _datum_hashes: Vec<String>,
}

/// A list of 1 to `max`, each read by `read`, none twice.
fn list<T>(
    items: &[String],
    max: usize,
    read: impl Fn(&str) -> Option<T>,
) -> Result<Vec<T>, ApiError> {
    if items.is_empty() || items.len() > max || !distinct(items) {
        return Err(NOT_ASKED);
    }
    items
        .iter()
        .map(|item| read(item).ok_or(NOT_ASKED))
        .collect()
}

async fn page(
    state: &AppState,
    outs: Outs,
    keys: &[Vec<u8>],
    page: &Page,
    capped: bool,
) -> Result<Bytes, ApiError> {
    let (hash, index) = match &page.after {
        Some((hash, index)) => (Some(hash.clone()), Some(*index)),
        None => (None, None),
    };
    let client = state.chain.public().await?;
    let rows = client
        .query(
            &listing(outs, true, capped),
            &[&keys, &hash, &index, &page.above],
        )
        .await
        .map_err(anyhow::Error::from)?;
    // A capped listing past the cap may have lost the rows a page wanted, so
    // an empty page is only the end once the count says so.
    let over = match rows.first() {
        Some(row) => row
            .try_get::<_, bool>("over")
            .map_err(anyhow::Error::from)?,
        None if capped => {
            let count = format!(
                "select count(*) > {MAX_GATHERED} from ({}) gathered",
                outs.cte(true)
            );
            let row = client
                .query_one(&count, &[&keys])
                .await
                .map_err(anyhow::Error::from)?;
            row.try_get(0).map_err(anyhow::Error::from)?
        }
        None => false,
    };
    if over {
        return Err(ApiError::Heavy);
    }
    let utxos = rows
        .iter()
        .map(|row| read_utxo(row, state))
        .collect::<anyhow::Result<Vec<_>>>()?;
    array(&utxos)
}

/// Every unspent output at the payment credentials, a page at a time.
pub async fn credential_utxos(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    let request: CredentialsBody = body(&headers, &bytes)?;
    if !request._extended {
        return Err(NOT_ASKED);
    }
    let creds = list(&request._payment_credentials, MAX_CREDENTIALS, |c| {
        hex_bytes(c, 28)
    })?;
    let at = Page::parse(raw.as_deref(), true)?;
    let tip = state.fresh_tip()?;
    // The contract's and the mix box's rows are everyone's: one query a block serves them all.
    let shared = request._payment_credentials.len() == 1
        && [CONTRACT_HASH, MIXBOX_HASH].contains(&request._payment_credentials[0].as_str());
    let answer = if shared {
        let key = format!(
            "credential_utxos/{}?{}",
            request._payment_credentials[0],
            raw.as_deref().unwrap_or_default()
        );
        state
            .cached_bytes(&tip, &key, || {
                page(&state, Outs::Credentials, &creds, &at, false)
            })
            .await?
    } else {
        page(&state, Outs::Credentials, &creds, &at, true).await?
    };
    Ok(json(answer))
}

/// Every unspent output at the addresses, a page at a time.
pub async fn address_utxos(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    let request: AddressesBody = body(&headers, &bytes)?;
    if !request._extended {
        return Err(NOT_ASKED);
    }
    let addresses = list(&request._addresses, MAX_ADDRESSES, address_bytes)?;
    let at = Page::parse(raw.as_deref(), false)?;
    state.fresh_tip()?;
    Ok(json(
        page(&state, Outs::Addresses, &addresses, &at, true).await?,
    ))
}

/// The outputs named (`<tx hash>#<index>`), spent or not.
pub async fn utxo_info(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    Query::none(raw.as_deref())?;
    let request: RefsBody = body(&headers, &bytes)?;
    if !request._extended {
        return Err(NOT_ASKED);
    }
    let refs = list(&request._utxo_refs, MAX_REFS, |r| {
        let (hash, index) = r.split_once('#')?;
        let index = natural(index).ok().filter(|i| *i <= i64::from(u16::MAX))?;
        Some((hex_bytes(hash, 32)?, index as i32))
    })?;
    state.fresh_tip()?;
    let (hashes, indexes): (Vec<Vec<u8>>, Vec<i32>) = refs.into_iter().unzip();
    let client = state.chain.public().await?;
    let rows = client
        .query(&listing(Outs::Refs, false, false), &[&hashes, &indexes])
        .await
        .map_err(anyhow::Error::from)?;
    let utxos = rows
        .iter()
        .map(|row| read_utxo(row, &state))
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(json(array(&utxos)?))
}

#[derive(Serialize)]
struct DatumRow {
    datum_hash: String,
    creation_tx_hash: String,
    bytes: String,
}

const DATUMS: &str = "select encode(d.hash, 'hex'), encode(t.hash, 'hex'), encode(d.bytes, 'hex') \
     from datum d join tx t on t.id = d.tx_id where d.hash = any($1::bytea[])";

/// The datums the hashes name, their CBOR: a Plutus V1 order's cancel needs its exact bytes.
pub async fn datum_info(
    State(state): State<Arc<AppState>>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    Query::none(raw.as_deref())?;
    let request: DatumsBody = body(&headers, &bytes)?;
    let hashes = list(&request._datum_hashes, MAX_REFS, |h| hex_bytes(h, 32))?;
    state.fresh_tip()?;
    let client = state.chain.public().await?;
    let rows = client
        .query(DATUMS, &[&hashes])
        .await
        .map_err(anyhow::Error::from)?;
    let datums = rows
        .iter()
        .map(|row| {
            Ok(DatumRow {
                datum_hash: row.try_get(0)?,
                creation_tx_hash: row.try_get(1)?,
                bytes: row.try_get(2)?,
            })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(json(array(&datums)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    const H: &str = "1e491b15714b141f1bc8cbd3d5a4a801d5066ddd66d3d922492106790b506507";

    #[test]
    fn a_page_is_the_wallets_shape_and_nothing_else() {
        let first = Page::parse(Some("order=tx_hash.asc,tx_index.asc&limit=1000"), true).unwrap();
        assert!(first.after.is_none() && first.above.is_none());

        let next = format!(
            "block_height=gt.11305804&or=(tx_hash.gt.{H},and(tx_hash.eq.{H},tx_index.gt.3))\
             &order=tx_hash.asc,tx_index.asc&limit=1000"
        );
        let next = Page::parse(Some(&next), true).unwrap();
        assert_eq!(next.above, Some(11305804));
        assert_eq!(next.after.unwrap().1, 3);

        for bad in [
            "order=tx_hash.asc,tx_index.asc&limit=500".to_string(),
            "limit=1000&order=tx_hash.asc,tx_index.asc".to_string(),
            "order=tx_hash.asc,tx_index.asc&limit=1000&offset=0".to_string(),
            "order=tx_hash.desc,tx_index.asc&limit=1000".to_string(),
            "block_height=gte.1&order=tx_hash.asc,tx_index.asc&limit=1000".to_string(),
            format!(
                "or=(tx_hash.gt.{H},and(tx_hash.eq.{},tx_index.gt.3))&order=tx_hash.asc,tx_index.asc&limit=1000",
                "ab".repeat(32)
            ),
            format!(
                "or=(tx_hash.gt.{H},and(tx_hash.eq.{H},tx_index.gt.-3))&order=tx_hash.asc,tx_index.asc&limit=1000"
            ),
        ] {
            assert!(Page::parse(Some(&bad), true).is_err(), "{bad}");
        }
        // address_utxos takes no height filter.
        assert!(
            Page::parse(
                Some("block_height=gt.1&order=tx_hash.asc,tx_index.asc&limit=1000"),
                false
            )
            .is_err()
        );
    }

    #[test]
    fn lists_are_capped_unique_and_well_formed() {
        let cred = |n: u8| format!("{n:02x}").repeat(28);
        let some: Vec<String> = (0..3).map(cred).collect();
        assert_eq!(list(&some, 75, |c| hex_bytes(c, 28)).unwrap().len(), 3);
        assert!(list(&[], 75, |c| hex_bytes(c, 28)).is_err());
        let many: Vec<String> = (0..76).map(cred).collect();
        assert!(list(&many, 75, |c| hex_bytes(c, 28)).is_err());
        assert!(list(&[cred(1), cred(1)], 75, |c| hex_bytes(c, 28)).is_err());
        assert!(list(&["ab".into()], 75, |c| hex_bytes(c, 28)).is_err());
    }

    #[test]
    fn a_row_has_every_field_the_wallets_parser_requires() {
        let row = Utxo {
            tx_hash: H.into(),
            tx_index: 0,
            address: "addr1…".into(),
            value: "1500000".into(),
            stake_address: None,
            payment_cred: Some("ab".repeat(28)),
            epoch_no: Some(531),
            block_height: Some(11305805),
            block_time: 1736456228,
            datum_hash: None,
            inline_datum: Some(InlineDatum {
                bytes: "d87980".into(),
                value: (),
            }),
            reference_script: None,
            asset_list: vec![],
            is_spent: false,
        };
        let json = serde_json::to_value(&row).unwrap();
        for key in [
            "tx_hash",
            "tx_index",
            "address",
            "value",
            "stake_address",
            "payment_cred",
            "epoch_no",
            "block_height",
            "block_time",
            "datum_hash",
            "inline_datum",
            "reference_script",
            "asset_list",
            "is_spent",
        ] {
            assert!(json.get(key).is_some(), "{key}");
        }
        assert_eq!(
            json["inline_datum"],
            serde_json::json!({"bytes": "d87980", "value": null})
        );
    }
}
