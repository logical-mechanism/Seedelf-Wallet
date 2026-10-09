//! The private index's routes, `/seedelf/v1/mainnet/…`. Every answer is the
//! same for whoever asks: none names a UTxO, a register or an owner, and the
//! wallet keeps deciding for itself which rows are its own.
//!
//! How a wallet reads it, with every cursor from the server ([`crate::cursor`]):
//!
//! 1. **First time, or a restore:** `…/snapshot` gives the rows unspent as of
//!    a stable cursor `C`. They are the wallet's settled view.
//! 2. **Every read after:** `…/since/{C}` gives `created`, the rows made after
//!    `C` (each with its `spent` if it's gone since), and `spent`, the rows
//!    made by `C` and spent after it. The settled view plus `created` minus
//!    every spend is the view at the tip.
//! 3. Its `cursor` is the new stable point `C'`. Applying only the entries
//!    at or below `C'` to the settled view gives the settled view as of `C'`.
//!    Everything above `C'` is recomputed from the next answer, so a fork
//!    above a cursor never needs undoing.
//! 4. `reset: true` means the cursor's own block was rolled back: start again at 1.

use std::sync::{Arc, LazyLock};

use axum::Router;
use axum::extract::{Path, State};
use axum::response::Response;
use axum::routing::get;
use serde::Serialize;

use crate::chain::Tip;
use crate::constants::{CONTRACT_HASH, MIXBOX_HASH, bytes};
use crate::cursor::{Cursor, CursorError, stable_height};
use crate::row::{Row, Spent};
use crate::state::{ApiError, AppState, json};

static CONTRACT: LazyLock<Vec<u8>> = LazyLock::new(|| bytes(CONTRACT_HASH));
static MIXBOX: LazyLock<Vec<u8>> = LazyLock::new(|| bytes(MIXBOX_HASH));

/// The two credentials the private index watches.
#[derive(Clone, Copy)]
enum Watched {
    Contract,
    Lovejoin,
}

impl Watched {
    fn cred(self) -> &'static [u8] {
        match self {
            Watched::Contract => &CONTRACT,
            Watched::Lovejoin => &MIXBOX,
        }
    }

    /// A Lovejoin box carries its making; a contract row doesn't need one.
    fn provenance(self) -> bool {
        matches!(self, Watched::Lovejoin)
    }

    fn key(self) -> &'static str {
        match self {
            Watched::Contract => "contract",
            Watched::Lovejoin => "lovejoin",
        }
    }
}

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/seedelf/v1/mainnet/contract/snapshot",
            get(contract_snapshot),
        )
        .route(
            "/seedelf/v1/mainnet/contract/since/{cursor}",
            get(contract_since),
        )
        .route("/seedelf/v1/mainnet/names", get(names))
        .route("/seedelf/v1/mainnet/lovejoin/pool", get(lovejoin_pool))
        .route(
            "/seedelf/v1/mainnet/lovejoin/since/{cursor}",
            get(lovejoin_since),
        )
}

#[derive(Serialize)]
struct TipView {
    block: i64,
    slot: i64,
    hash: String,
    time: i64,
}

impl From<&Tip> for TipView {
    fn from(tip: &Tip) -> Self {
        TipView {
            block: tip.height,
            slot: tip.slot,
            hash: tip.hash.clone(),
            time: tip.time,
        }
    }
}

#[derive(Serialize)]
struct Snapshot {
    network: &'static str,
    tip: TipView,
    cursor: String,
    rows: Vec<Row>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Since {
    Changes {
        network: &'static str,
        tip: TipView,
        from: String,
        cursor: String,
        created: Vec<Row>,
        spent: Vec<Spent>,
    },
    Reset {
        network: &'static str,
        tip: TipView,
        reset: bool,
        cursor: String,
    },
}

#[derive(Serialize)]
struct Name {
    name: String,
    row: Row,
}

#[derive(Serialize)]
struct Names {
    network: &'static str,
    tip: TipView,
    names: Vec<Name>,
}

async fn contract_snapshot(State(state): State<Arc<AppState>>) -> Result<Response, ApiError> {
    snapshot(&state, Watched::Contract).await
}

async fn lovejoin_pool(State(state): State<Arc<AppState>>) -> Result<Response, ApiError> {
    snapshot(&state, Watched::Lovejoin).await
}

async fn contract_since(
    State(state): State<Arc<AppState>>,
    Path(cursor): Path<String>,
) -> Result<Response, ApiError> {
    since(&state, Watched::Contract, &cursor).await
}

async fn lovejoin_since(
    State(state): State<Arc<AppState>>,
    Path(cursor): Path<String>,
) -> Result<Response, ApiError> {
    since(&state, Watched::Lovejoin, &cursor).await
}

/// The stable cursor for `tip`: its height, and db-sync's id and hash for the block there.
async fn stable(state: &AppState, tip: &Tip) -> Result<(Cursor, i64), ApiError> {
    let height = stable_height(tip.height);
    let block = state
        .chain
        .block_at(height)
        .await?
        .ok_or_else(|| anyhow::anyhow!("no block at the stable height {height}"))?;
    Ok((
        Cursor {
            height,
            hash: block.hash,
        },
        block.id,
    ))
}

async fn snapshot(state: &AppState, watched: Watched) -> Result<Response, ApiError> {
    let tip = state.fresh_tip()?;
    let key = format!("{}/snapshot", watched.key());
    let answer = state
        .cached(&tip, &key, || async {
            let (cursor, at) = stable(state, &tip).await?;
            let rows = state
                .chain
                .unspent_as_of(watched.cred(), at, watched.provenance())
                .await?;
            Ok(Snapshot {
                network: "mainnet",
                tip: (&tip).into(),
                cursor: cursor.to_string(),
                rows,
            })
        })
        .await?;
    Ok(json(answer))
}

async fn since(state: &AppState, watched: Watched, cursor: &str) -> Result<Response, ApiError> {
    let from: Cursor = cursor.parse().map_err(|error| {
        ApiError::BadCursor(match error {
            CursorError::Malformed => "a cursor is <height>.<block hash>",
            CursorError::NotQuantised => "not a cursor this server hands out",
        })
    })?;
    let tip = state.fresh_tip()?;
    let key = format!("{}/since/{from}", watched.key());
    let answer = state
        .cached(&tip, &key, || async {
            let (cursor, _) = stable(state, &tip).await?;
            let block = if from.height <= tip.height {
                state.chain.block_at(from.height).await?
            } else {
                None
            };
            let Some(block) = block.filter(|block| block.hash == from.hash) else {
                return Ok(Since::Reset {
                    network: "mainnet",
                    tip: (&tip).into(),
                    reset: true,
                    cursor: cursor.to_string(),
                });
            };
            let created = state
                .chain
                .created_since(watched.cred(), block.id, watched.provenance())
                .await?;
            let spent = state.chain.spent_since(watched.cred(), block.id).await?;
            Ok(Since::Changes {
                network: "mainnet",
                tip: (&tip).into(),
                from: from.to_string(),
                cursor: cursor.to_string(),
                created,
                spent,
            })
        })
        .await?;
    Ok(json(answer))
}

/// Every Seedelf name unspent at the tip, with the row that holds it. One
/// bucket, the whole list, while it's small (the plan's `names/{bucket}`).
async fn names(State(state): State<Arc<AppState>>) -> Result<Response, ApiError> {
    let tip = state.fresh_tip()?;
    let answer = state
        .cached(&tip, "names", || async {
            let rows = state
                .chain
                .unspent_now(Watched::Contract.cred(), false)
                .await?;
            let mut seen = std::collections::HashSet::new();
            let names = rows
                .into_iter()
                .filter_map(|row| {
                    let name = row.seedelf_name()?.to_string();
                    seen.insert(name.clone()).then_some(Name { name, row })
                })
                .collect();
            Ok(Names {
                network: "mainnet",
                tip: (&tip).into(),
                names,
            })
        })
        .await?;
    Ok(json(answer))
}
