//! What the token pools read from db-sync: the holder's candidates, what
//! their launches did, and every output ever at the shown pools' `mix_box`
//! for the crowd. Each starts from one credential's outputs, gathered first
//! in a `MATERIALIZED` CTE, as every private query does (`crate::chain`).

use std::collections::HashMap;

use anyhow::{Context, Result};
use tokio_postgres::types::ToSql;

use super::crowd::Output;
use super::standard::Launch;
use crate::chain::{Chain, row_columns};
use crate::row::{Row, read_row};

/// An output at the holder holding a token named `lovejoin`, and where its
/// transaction sits: one this module checks.
#[derive(Debug, Clone)]
pub struct Found {
    /// Its db-sync id: later blocks' outputs have higher ones.
    pub id: i64,
    pub row: Row,
    /// Its transaction's db-sync id.
    pub tx_id: i64,
    pub tx: String,
    pub block: i64,
    pub index: i64,
    pub slot: i64,
}

/// How far a read gathered the holder's outputs by its block: the highest
/// output id and transaction id of any output there, a candidate or not. A
/// later block's outputs and transactions have higher ids than an earlier
/// one's, so a read on gathers only what's above both (1.6.0's release
/// review, 321-lj-rust-data#0).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Gathered {
    pub id: i64,
    pub tx: i64,
}

impl Gathered {
    /// As far as `found`'s output.
    pub fn of(found: &Found) -> Gathered {
        Gathered {
            id: found.id,
            tx: found.tx_id,
        }
    }

    /// The further of the two, field by field.
    pub fn max(self, other: Gathered) -> Gathered {
        Gathered {
            id: self.id.max(other.id),
            tx: self.tx.max(other.tx),
        }
    }
}

/// `found`'s query: `$1` the holder, `$2` the slot, `$3` the name, `$4` and
/// `$5` the output id and transaction id read on from.
fn found_sql() -> String {
    format!(
        "with outs as materialized ( \
           select o.id, o.tx_id, o.index, o.address_id, o.value, o.inline_datum_id, \
                  o.reference_script_id, o.consumed_by_tx_id \
           from address a join tx_out o on o.address_id = a.id \
           where a.payment_cred = $1::bytea and o.id > $4 and o.tx_id > $5) \
         select {}, o.id::bigint as out_id, t.id::bigint as tx_id, encode(t.hash, 'hex') as tx, \
                b.block_no::bigint as block, t.block_index::bigint as block_index \
         from outs o \
         join tx t on t.id = o.tx_id \
         join block b on b.id = t.block_id \
         join address a on a.id = o.address_id \
         left join datum d on d.id = o.inline_datum_id \
         where b.slot_no <= $2 and exists ( \
           select 1 from ma_tx_out mto join multi_asset m on m.id = mto.ident \
           where mto.tx_out_id = o.id and m.name = $3::bytea) \
         order by o.id",
        row_columns("false")
    )
}

/// How far `found`'s query gathered, before it looks at what an output holds:
/// `$1` the holder, `$2` the slot, `$3` and `$4` the output id and
/// transaction id read on from.
const GATHERED: &str = "with outs as materialized ( \
       select o.id, o.tx_id \
       from address a join tx_out o on o.address_id = a.id \
       where a.payment_cred = $1::bytea and o.id > $3 and o.tx_id > $4) \
     select max(o.id)::bigint as id, max(o.tx_id)::bigint as tx \
     from outs o \
     join tx t on t.id = o.tx_id \
     join block b on b.id = t.block_id \
     where b.slot_no <= $2";

/// Every output at `holder` holding a token named `name`, made by the block at
/// slot `at`, of those above `after`, and how far the read gathered, never
/// short of `after`. Only those are gathered: a read on, at each new cursor,
/// no longer gathers every output ever at the holder first, whatever anyone
/// sends there (1.6.0's release review, DATA-4), nor every one since the last
/// candidate (321-lj-rust-data#0).
pub async fn found(
    chain: &Chain,
    holder: &[u8],
    name: &[u8],
    at: i64,
    after: Gathered,
) -> Result<(Vec<Found>, Gathered)> {
    let sql = found_sql();
    let client = chain.private().await?;
    // On one connection, pipelined: one round trip to home.
    let candidates: &[&(dyn ToSql + Sync)] = &[&holder, &at, &name, &after.id, &after.tx];
    let all: &[&(dyn ToSql + Sync)] = &[&holder, &at, &after.id, &after.tx];
    let (rows, gathered) = tokio::try_join!(
        client.query(&sql, candidates),
        client.query_one(GATHERED, all),
    )?;
    let found = rows
        .iter()
        .map(|row| {
            let row_view = read_row(row, false)?;
            Ok(Found {
                id: row.try_get("out_id")?,
                slot: row_view.created.slot,
                row: row_view,
                tx_id: row.try_get("tx_id")?,
                tx: row.try_get("tx")?,
                block: row.try_get("block")?,
                index: row.try_get("block_index")?,
            })
        })
        .collect::<Result<_>>()?;
    // Nothing new gathered is as far as `after`.
    let gathered = after.max(Gathered {
        id: gathered.try_get::<_, Option<i64>>("id")?.unwrap_or(0),
        tx: gathered.try_get::<_, Option<i64>>("tx")?.unwrap_or(0),
    });
    Ok((found, gathered))
}

const INPUTS: &str = "select o.consumed_by_tx_id::bigint as launch, encode(t.hash, 'hex') as tx, \
     o.index::bigint as index \
     from tx_out o join tx t on t.id = o.tx_id \
     where o.consumed_by_tx_id = any($1::bigint[]) order by o.id";

const REGISTERS: &str = "select sr.tx_id::bigint as launch, encode(sa.hash_raw, 'hex') as stake \
     from stake_registration sr join stake_address sa on sa.id = sr.addr_id \
     where sr.tx_id = any($1::bigint[])";

/// What each of `found`'s transactions did: what it spent, the reference
/// scripts it put at `holder`, the script credentials it registered.
pub async fn launches(
    chain: &Chain,
    holder: &[u8],
    found: &[&Found],
) -> Result<HashMap<i64, Launch>> {
    let ids: Vec<i64> = found.iter().map(|f| f.tx_id).collect();
    let scripts = format!(
        "select o.tx_id::bigint as launch, {}, encode(s.hash, 'hex') as script_hash \
         from tx_out o \
         join tx t on t.id = o.tx_id \
         join block b on b.id = t.block_id \
         join address a on a.id = o.address_id \
         join script s on s.id = o.reference_script_id \
         left join datum d on d.id = o.inline_datum_id \
         where o.tx_id = any($1::bigint[]) and a.payment_cred = $2::bytea \
         order by o.id",
        row_columns("false")
    );
    let client = chain.private().await?;
    // On one connection, pipelined: one round trip to home.
    let by_id: &[&(dyn ToSql + Sync)] = &[&ids];
    let at_holder: &[&(dyn ToSql + Sync)] = &[&ids, &holder];
    let (inputs, scripts, registers) = tokio::try_join!(
        client.query(INPUTS, by_id),
        client.query(&scripts, at_holder),
        client.query(REGISTERS, by_id),
    )?;
    let mut launches: HashMap<i64, Launch> = found
        .iter()
        .map(|f| {
            (
                f.tx_id,
                Launch {
                    tx: f.tx.clone(),
                    block: f.block,
                    index: f.index,
                    slot: f.slot,
                    inputs: Vec::new(),
                    scripts: Vec::new(),
                    registers: Vec::new(),
                },
            )
        })
        .collect();
    for row in &inputs {
        let launch: i64 = row.try_get("launch")?;
        let tx: [u8; 32] = hex32(row.try_get("tx")?)?;
        let index: i64 = row.try_get("index")?;
        if let Some(l) = launches.get_mut(&launch) {
            l.inputs.push((tx, index as u64));
        }
    }
    for row in &scripts {
        let launch: i64 = row.try_get("launch")?;
        let hash = hex28(row.try_get("script_hash")?)?;
        if let Some(l) = launches.get_mut(&launch) {
            l.scripts.push((read_row(row, false)?, hash));
        }
    }
    for row in &registers {
        let launch: i64 = row.try_get("launch")?;
        // A script's reward account on mainnet: 0xf1, then its hash.
        let stake: &str = row.try_get("stake")?;
        if let (Some(l), Some(cred)) = (launches.get_mut(&launch), stake.strip_prefix("f1")) {
            l.registers.push(hex28(cred)?);
        }
    }
    Ok(launches)
}

/// The block each of `creds` (script hashes) was first registered in, if it was.
pub async fn registered(chain: &Chain, creds: &[[u8; 28]]) -> Result<HashMap<[u8; 28], i64>> {
    let raw: Vec<Vec<u8>> = creds.iter().map(|c| [&[0xf1][..], c].concat()).collect();
    let client = chain.private().await?;
    let rows = client
        .query(
            "select encode(sa.hash_raw, 'hex') as stake, min(b.block_no)::bigint as block \
             from stake_address sa \
             join stake_registration sr on sr.addr_id = sa.id \
             join tx t on t.id = sr.tx_id \
             join block b on b.id = t.block_id \
             where sa.hash_raw = any($1::bytea[]) group by sa.hash_raw",
            &[&raw],
        )
        .await?;
    rows.iter()
        .map(|row| {
            let stake: &str = row.try_get("stake")?;
            let cred = stake
                .strip_prefix("f1")
                .context("not a script's reward account")?;
            Ok((hex28(cred)?, row.try_get("block")?))
        })
        .collect()
}

/// One output ever at a `mix_box`, by the block at slot `at`: its credential
/// (hex), and what the crowd needs of it, with its value and datum to tell a box.
pub struct Ever {
    pub cred: String,
    pub made_by: i64,
    pub lovelace: String,
    pub assets: Vec<[String; 3]>,
    pub datum: Option<Vec<u8>>,
    pub spent_by: Option<i64>,
}

impl Ever {
    pub fn output(&self, is_box: bool) -> Output {
        Output {
            made_by: self.made_by,
            is_box,
            spent_by: self.spent_by,
        }
    }
}

/// Every output ever at any of `creds` by the block at slot `at`.
pub async fn ever(chain: &Chain, creds: &[Vec<u8>], at: i64) -> Result<Vec<Ever>> {
    let client = chain.private().await?;
    let rows = client
        .query(
            "with outs as materialized ( \
               select o.id, o.tx_id, o.address_id, o.value, o.inline_datum_id, o.consumed_by_tx_id \
               from address a join tx_out o on o.address_id = a.id \
               where a.payment_cred = any($1::bytea[])) \
             select encode(a.payment_cred, 'hex') as cred, o.tx_id::bigint as made_by, \
                    o.value::text as lovelace, d.bytes as datum, \
                    (select coalesce(json_agg(json_build_array(encode(m.policy, 'hex'), \
                            encode(m.name, 'hex'), mto.quantity::text)), '[]'::json)::text \
                       from ma_tx_out mto join multi_asset m on m.id = mto.ident \
                       where mto.tx_out_id = o.id) as assets, \
                    case when cb.slot_no <= $2 then o.consumed_by_tx_id::bigint end as spent_by \
             from outs o \
             join tx t on t.id = o.tx_id \
             join block b on b.id = t.block_id \
             join address a on a.id = o.address_id \
             left join datum d on d.id = o.inline_datum_id \
             left join tx ct on ct.id = o.consumed_by_tx_id \
             left join block cb on cb.id = ct.block_id \
             where b.slot_no <= $2",
            &[&creds, &at],
        )
        .await?;
    rows.iter()
        .map(|row| {
            Ok(Ever {
                cred: row.try_get("cred")?,
                made_by: row.try_get("made_by")?,
                lovelace: row.try_get("lovelace")?,
                assets: serde_json::from_str(row.try_get::<_, &str>("assets")?)?,
                datum: row.try_get("datum")?,
                spent_by: row.try_get("spent_by")?,
            })
        })
        .collect()
}

fn hex28(text: &str) -> Result<[u8; 28]> {
    crate::ids::hex_bytes(text, 28)
        .and_then(|b| b.try_into().ok())
        .context("not a 28-byte hash")
}

fn hex32(text: &str) -> Result<[u8; 32]> {
    crate::ids::hex_bytes(text, 32)
        .and_then(|b| b.try_into().ok())
        .context("not a 32-byte hash")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 1.6.0's release review, DATA-4: a read on's ids are bounded where the
    /// holder's outputs are gathered, not after every one of them was.
    #[test]
    fn a_read_on_gathers_only_the_outputs_above_its_ids() {
        let sql = found_sql();
        let (gather, rest) = sql.split_at(sql.find(") select").expect("a gather"));
        assert!(gather.contains("o.id > $4"), "{gather}");
        assert!(!rest.contains("$4"), "{rest}");
        // And above its transaction id, which the holder's index on (address_id, tx_id) can range over: no read on
        // goes through every output ever at the holder (1.6.0's release review, 321-lj-rust-data#0).
        assert!(gather.contains("o.tx_id > $5"), "{gather}");
        assert!(!rest.contains("$5"), "{rest}");
    }
}
