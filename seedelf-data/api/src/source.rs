//! Where the private index reads from: db-sync first (the owner, 2026-10-08:
//! "the db sync queries will be more than enough for now"), and Kupo when
//! db-sync is down or behind. Both give the same rows in the same order, and
//! the same cursors, so a wallet never sees a switch.

use anyhow::Result;

use crate::chain::{Block, Chain};
use crate::kupo::Kupo;
use crate::row::{Row, Spent};

/// db-sync counts as behind Kupo past this many slots: about 3 blocks (chunk 26's
/// health table). Short of it, either answers; past it, Kupo's answer is fresher.
pub const BEHIND_SLOTS: i64 = 60;

/// One of the private index's two sources.
#[derive(Clone)]
pub enum Source {
    DbSync(Chain),
    Kupo(Kupo),
}

/// Which source an answer came from: each keeps its answers for its own tip.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Upstream {
    DbSync,
    Kupo,
}

impl Upstream {
    pub fn name(self) -> &'static str {
        match self {
            Upstream::DbSync => "db-sync",
            Upstream::Kupo => "kupo",
        }
    }
}

/// The sources that can answer, best first: db-sync unless Kupo is
/// [`BEHIND_SLOTS`] ahead of it. Each is given only while its tip is fresh.
pub fn order<T>(db_sync: Option<(T, Block)>, kupo: Option<(T, Block)>) -> Vec<(T, Block)> {
    match (db_sync, kupo) {
        (Some(db), Some(kupo)) if kupo.1.slot > db.1.slot + BEHIND_SLOTS => vec![kupo, db],
        (db, kupo) => db.into_iter().chain(kupo).collect(),
    }
}

impl Source {
    pub fn upstream(&self) -> Upstream {
        match self {
            Source::DbSync(_) => Upstream::DbSync,
            Source::Kupo(_) => Upstream::Kupo,
        }
    }

    /// The newest block at or before `slot`.
    pub async fn block_before(&self, slot: i64) -> Result<Option<Block>> {
        match self {
            Source::DbSync(chain) => chain.block_before(slot).await,
            Source::Kupo(kupo) => kupo.block_before(slot).await,
        }
    }

    /// The rows at `cred` (hex) unspent as of the block at slot `at`.
    pub async fn unspent_as_of(&self, cred: &str, at: i64, provenance: bool) -> Result<Vec<Row>> {
        match self {
            Source::DbSync(chain) => chain.unspent_as_of(&bytes(cred), at, provenance).await,
            Source::Kupo(kupo) => kupo.unspent_as_of(cred, at, provenance).await,
        }
    }

    /// The rows at `cred` made after slot `after` (each with its spend), and
    /// the rows made by then and spent after it.
    pub async fn since(
        &self,
        cred: &str,
        after: i64,
        provenance: bool,
    ) -> Result<(Vec<Row>, Vec<Spent>)> {
        match self {
            Source::DbSync(chain) => chain.since(&bytes(cred), after, provenance).await,
            Source::Kupo(kupo) => kupo.since(cred, after, provenance).await,
        }
    }

    /// The rows at `cred` unspent at the source's tip.
    pub async fn unspent_now(&self, cred: &str, provenance: bool) -> Result<Vec<Row>> {
        match self {
            Source::DbSync(chain) => chain.unspent_now(&bytes(cred), provenance).await,
            Source::Kupo(kupo) => kupo.unspent_now(cred, provenance).await,
        }
    }
}

fn bytes(cred: &str) -> Vec<u8> {
    crate::constants::bytes(cred)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(slot: i64) -> Block {
        Block {
            slot,
            hash: String::new(),
        }
    }

    fn names(order: Vec<(&str, Block)>) -> Vec<&str> {
        order.into_iter().map(|(name, _)| name).collect()
    }

    #[test]
    fn db_sync_comes_first_unless_kupo_is_well_ahead() {
        let db = || Some(("db", at(1000)));
        assert_eq!(names(order(db(), Some(("kupo", at(1060))))), ["db", "kupo"]);
        assert_eq!(names(order(db(), Some(("kupo", at(1061))))), ["kupo", "db"]);
        // Kupo behind db-sync: db-sync, and Kupo after it.
        assert_eq!(names(order(db(), Some(("kupo", at(900))))), ["db", "kupo"]);
    }

    #[test]
    fn a_stale_source_isnt_offered() {
        assert_eq!(names(order(None, Some(("kupo", at(1))))), ["kupo"]);
        assert_eq!(names(order(Some(("db", at(1))), None)), ["db"]);
        assert!(order::<&str>(None, None).is_empty());
    }
}
