//! db-sync, the private index's first source (the owner, 2026-10-08).
//!
//! Every query starts from one credential's own outputs, gathered first in a
//! `MATERIALIZED` CTE: left to itself, the planner can start from every
//! transaction since the cursor instead (880,000 of them for two days on
//! mainnet: 3.5 s, against 9.5 ms this way). Every value is cast or encoded
//! to a plain type in SQL, so db-sync's domain types never reach the driver.

use std::str::FromStr;
use std::time::Duration;

use anyhow::{Context, Result};
use deadpool_postgres::{
    Manager, ManagerConfig, Object, Pool, PoolError, RecyclingMethod, Runtime,
};
use tokio_postgres::NoTls;

use crate::row::{Row, Spent, read_row, read_spend};
use crate::state::ApiError;

/// The newest block db-sync holds.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tip {
    pub height: i64,
    pub slot: i64,
    pub hash: String,
    /// Unix seconds.
    pub time: i64,
    pub epoch: i64,
    pub epoch_slot: i64,
    /// The era its protocol version names (CIP-59), as Koios names it.
    pub era: Option<&'static str>,
}

/// CIP-59's eras by protocol version, as Koios's `grest.era_map` holds them:
/// an exact major and minor, or no era.
pub fn era(major: i32, minor: i32) -> Option<&'static str> {
    Some(match (major, minor) {
        (0 | 1, 0) => "Byron",
        (2, 0) => "Shelley",
        (3, 0) => "Allegra",
        (4, 0) => "Mary",
        (5 | 6, 0) => "Alonzo",
        (7 | 8, 0) => "Babbage",
        (9..=11, 0) => "Conway",
        _ => return None,
    })
}

/// Connections for the private index and the tip; the public routes have their
/// own, so a burst of them never holds the private index up. The role allows
/// 10 in all, and leaves one for a person.
const PRIVATE_CONNECTIONS: usize = 3;
const PUBLIC_CONNECTIONS: usize = 6;

/// How long a query waits for a connection before its route answers 503: past
/// it, the wallet does better going to Koios than queueing here.
const WAIT: Duration = Duration::from_secs(2);

/// What every connection runs with. JIT compiles a plan whose estimates are
/// large (db-sync's `ma_tx_out` makes most of them so), and that took 76 of a
/// UTxO query's 80 ms; without it, 3 ms.
const OPTIONS: &str = "-c jit=off";

/// A public query that runs longer than this is cancelled: none should take a
/// second, and one that does is a request to refuse, not to wait for.
const PUBLIC_OPTIONS: &str = "-c jit=off -c statement_timeout=10s";

/// A block, as a cursor names it: db-sync's own id for it, and its hash.
pub struct Block {
    pub id: i64,
    pub hash: String,
}

#[derive(Clone)]
pub struct Chain {
    pool: Pool,
    public: Pool,
}

const TIP: &str = "select b.block_no::bigint, b.slot_no::bigint, encode(b.hash, 'hex'), \
     extract(epoch from b.time)::bigint, b.epoch_no::bigint, b.epoch_slot_no::bigint, \
     ep.protocol_major::int, ep.protocol_minor::int \
     from (select * from block where block_no is not null order by id desc limit 1) b \
     left join epoch_param ep on ep.epoch_no = b.epoch_no";

const BLOCK_AT: &str = "select id, encode(hash, 'hex') from block where block_no = $1::bigint";

/// `$1`: the payment credential.
const OUTS: &str = "with outs as materialized ( \
     select o.id, o.tx_id, o.index, o.address_id, o.value, o.inline_datum_id, \
            o.reference_script_id, o.consumed_by_tx_id \
     from address a join tx_out o on o.address_id = a.id \
     where a.payment_cred = $1::bytea)";

const JOINS: &str = "from outs o \
     join tx t on t.id = o.tx_id \
     join block b on b.id = t.block_id \
     join address a on a.id = o.address_id \
     left join datum d on d.id = o.inline_datum_id \
     left join tx ct on ct.id = o.consumed_by_tx_id \
     left join block cb on cb.id = ct.block_id";

const SPEND_COLUMNS: &str = "encode(ct.hash, 'hex') as spent_by, cb.block_no::bigint as spent_block, \
     cb.slot_no::bigint as spent_slot, extract(epoch from cb.time)::bigint as spent_time";

/// The row's columns. `provenance` is the bool parameter that asks for a
/// Lovejoin box's making: its transaction's inputs and their credentials.
fn row_columns(provenance: &str) -> String {
    format!(
        "encode(t.hash, 'hex') || '#' || o.index::text as ref, \
         a.address::text as address, o.value::text as lovelace, \
         encode(d.bytes, 'hex') as datum, (o.reference_script_id is not null) as script, \
         b.block_no::bigint as block, b.slot_no::bigint as slot, \
         extract(epoch from b.time)::bigint as time, \
         (select coalesce(json_agg(json_build_array(encode(m.policy, 'hex'), encode(m.name, 'hex'), \
                 mto.quantity::text) order by m.policy, m.name), '[]'::json)::text \
            from ma_tx_out mto join multi_asset m on m.id = mto.ident \
            where mto.tx_out_id = o.id) as assets, \
         case when {provenance}::bool then \
           (select json_agg(json_build_array(encode(ia.payment_cred, 'hex'), \
                   encode(substring(isa.hash_raw from 2), 'hex')) order by i.id)::text \
              from tx_out i join address ia on ia.id = i.address_id \
              left join stake_address isa on isa.id = i.stake_address_id \
              where i.consumed_by_tx_id = t.id) \
         end as inputs"
    )
}

impl Chain {
    pub fn connect(url: &str) -> Result<Self> {
        let pool = |options: &str, size: usize| -> Result<Pool> {
            let mut config =
                tokio_postgres::Config::from_str(url).context("MAINNET_DATABASE_URL")?;
            config.options(options);
            let manager = Manager::from_config(
                config,
                NoTls,
                ManagerConfig {
                    recycling_method: RecyclingMethod::Fast,
                },
            );
            Ok(Pool::builder(manager)
                .max_size(size)
                .wait_timeout(Some(WAIT))
                .runtime(Runtime::Tokio1)
                .build()?)
        };
        Ok(Chain {
            pool: pool(OPTIONS, PRIVATE_CONNECTIONS)?,
            public: pool(PUBLIC_OPTIONS, PUBLIC_CONNECTIONS)?,
        })
    }

    /// A connection for a public route: 503 when all are busy, so the wallet goes to Koios.
    pub async fn public(&self) -> Result<Object, ApiError> {
        self.public.get().await.map_err(|error| match error {
            PoolError::Timeout(_) => ApiError::Busy,
            error => ApiError::Unavailable(error.into()),
        })
    }

    pub async fn tip(&self) -> Result<Tip> {
        let client = self.pool.get().await?;
        let row = client.query_one(TIP, &[]).await?;
        let version: (Option<i32>, Option<i32>) = (row.try_get(6)?, row.try_get(7)?);
        Ok(Tip {
            height: row.try_get(0)?,
            slot: row.try_get(1)?,
            hash: row.try_get(2)?,
            time: row.try_get(3)?,
            epoch: row.try_get(4)?,
            epoch_slot: row.try_get(5)?,
            era: match version {
                (Some(major), Some(minor)) => era(major, minor),
                _ => None,
            },
        })
    }

    /// The canonical block at `height`, if db-sync has one.
    pub async fn block_at(&self, height: i64) -> Result<Option<Block>> {
        let client = self.pool.get().await?;
        let row = client.query_opt(BLOCK_AT, &[&height]).await?;
        row.map(|row| {
            Ok(Block {
                id: row.try_get(0)?,
                hash: row.try_get(1)?,
            })
        })
        .transpose()
    }

    /// The rows at `cred` unspent as of block `at` (db-sync's block id).
    pub async fn unspent_as_of(&self, cred: &[u8], at: i64, provenance: bool) -> Result<Vec<Row>> {
        let sql = format!(
            "{OUTS} select {} {JOINS} \
             where t.block_id <= $2 and (o.consumed_by_tx_id is null or ct.block_id > $2) \
             order by o.id",
            row_columns("$3")
        );
        let client = self.pool.get().await?;
        let rows = client.query(&sql, &[&cred, &at, &provenance]).await?;
        rows.iter().map(|row| read_row(row, false)).collect()
    }

    /// The rows at `cred` made after block `after`, each with its spend if it's been spent since.
    pub async fn created_since(
        &self,
        cred: &[u8],
        after: i64,
        provenance: bool,
    ) -> Result<Vec<Row>> {
        let sql = format!(
            "{OUTS} select {}, {SPEND_COLUMNS} {JOINS} where t.block_id > $2 order by o.id",
            row_columns("$3")
        );
        let client = self.pool.get().await?;
        let rows = client.query(&sql, &[&cred, &after, &provenance]).await?;
        rows.iter().map(|row| read_row(row, true)).collect()
    }

    /// The rows at `cred` made by block `after` and spent after it.
    pub async fn spent_since(&self, cred: &[u8], after: i64) -> Result<Vec<Spent>> {
        let sql = format!(
            "{OUTS} select encode(t.hash, 'hex') || '#' || o.index::text as ref, {SPEND_COLUMNS} \
             {JOINS} where t.block_id <= $2 and ct.block_id > $2 order by ct.id, o.id"
        );
        let client = self.pool.get().await?;
        let rows = client.query(&sql, &[&cred, &after]).await?;
        rows.iter()
            .map(|row| {
                Ok(Spent {
                    reference: row.try_get("ref")?,
                    spend: read_spend(row)?.context("a spent row without its spend")?,
                })
            })
            .collect()
    }

    /// The rows at `cred` unspent now, at db-sync's tip.
    pub async fn unspent_now(&self, cred: &[u8], provenance: bool) -> Result<Vec<Row>> {
        let sql = format!(
            "{OUTS} select {} {JOINS} where o.consumed_by_tx_id is null order by o.id",
            row_columns("$2")
        );
        let client = self.pool.get().await?;
        let rows = client.query(&sql, &[&cred, &provenance]).await?;
        rows.iter().map(|row| read_row(row, false)).collect()
    }
}
