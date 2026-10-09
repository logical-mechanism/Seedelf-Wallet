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
//!
//! Every answer is read from db-sync, or from Kupo when db-sync is down or
//! behind ([`crate::source`]); a source whose read fails passes the request to the other.

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::response::Response;
use axum::routing::get;
use serde::Serialize;
use tracing::warn;

use crate::chain::Block;
use crate::constants::{CONTRACT_HASH, MIXBOX_HASH, slot_time};
use crate::cursor::{Cursor, CursorError, stable_slot};
use crate::row::{Row, Spent};
use crate::source::Source;
use crate::state::{ApiError, AppState, Throttle, failure, json, to_json};

/// The two credentials the private index watches.
#[derive(Clone, Copy)]
enum Watched {
    Contract,
    Lovejoin,
}

impl Watched {
    fn cred(self) -> &'static str {
        match self {
            Watched::Contract => CONTRACT_HASH,
            Watched::Lovejoin => MIXBOX_HASH,
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
    slot: i64,
    hash: String,
    time: i64,
}

impl From<&Block> for TipView {
    fn from(tip: &Block) -> Self {
        TipView {
            slot: tip.slot,
            hash: tip.hash.clone(),
            time: slot_time(tip.slot),
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
    /// No cursor: the wallet starts again from a snapshot, which gives one.
    Reset {
        network: &'static str,
        tip: TipView,
        reset: bool,
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

/// How long one source has to answer before the other is asked: a read takes
/// milliseconds, so one that takes seconds is stuck behind a dead connection.
const READ_TIMEOUT: Duration = Duration::from_secs(5);

/// `make`'s answer from the first source that gives one, kept in that
/// source's cache until its tip moves. A source that fails passes the request
/// on: a 400 is the request's own fault, and goes back at once.
async fn from_sources<F, Fut>(state: &AppState, key: &str, make: F) -> Result<Bytes, ApiError>
where
    F: Fn(Source, Block) -> Fut,
    Fut: Future<Output = Result<Bytes, ApiError>>,
{
    static PASSED_ON: Throttle = Throttle::new();
    let sources = state.private_sources();
    let count = sources.len();
    for (i, (source, tip)) in sources.into_iter().enumerate() {
        let upstream = source.upstream();
        let read = state.cached_in(upstream, &tip.hash, key, || make(source, tip.clone()));
        let answer = tokio::time::timeout(READ_TIMEOUT, read)
            .await
            .unwrap_or_else(|_| Err(ApiError::Unavailable(anyhow::anyhow!("timed out"))));
        match answer {
            Ok(answer) => return Ok(answer),
            Err(ApiError::Bad(why)) => return Err(ApiError::Bad(why)),
            Err(error) if i + 1 < count => {
                if let ApiError::Unavailable(error) = &error
                    && PASSED_ON.due()
                {
                    let error = failure(error);
                    warn!(
                        source = upstream.name(),
                        error, "a private read failed, so the other source answers"
                    );
                }
            }
            Err(error) => return Err(error),
        }
    }
    Err(ApiError::Behind)
}

/// The stable cursor for `tip`: its grid slot, and the block there.
async fn stable(source: &Source, tip: &Block) -> Result<(Cursor, Block), ApiError> {
    let slot = stable_slot(tip.slot);
    let block = source
        .block_before(slot)
        .await?
        .ok_or_else(|| anyhow::anyhow!("no block at or before the stable slot {slot}"))?;
    Ok((
        Cursor {
            slot,
            hash: block.hash.clone(),
        },
        block,
    ))
}

async fn snapshot(state: &AppState, watched: Watched) -> Result<Response, ApiError> {
    let key = format!("{}/snapshot", watched.key());
    let answer = from_sources(state, &key, |source, tip| async move {
        let (cursor, block) = stable(&source, &tip).await?;
        let rows = source
            .unspent_as_of(watched.cred(), block.slot, watched.provenance())
            .await?;
        to_json(&Snapshot {
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
        ApiError::Bad(match error {
            CursorError::Malformed => "a cursor is <slot>.<block hash>",
            CursorError::NotQuantised => "not a cursor this server hands out",
        })
    })?;
    let key = format!("{}/since/{from}", watched.key());
    let answer = from_sources(state, &key, |source, tip| {
        let from = from.clone();
        async move {
            // A source that hasn't reached the cursor can't say what's after it.
            if tip.slot <= from.slot {
                return Err(ApiError::Behind);
            }
            let (stable, block) = tokio::try_join!(stable(&source, &tip), async {
                Ok(source.block_before(from.slot).await?)
            })?;
            let Some(block) = block.filter(|block| block.hash == from.hash) else {
                return to_json(&Since::Reset {
                    network: "mainnet",
                    tip: (&tip).into(),
                    reset: true,
                });
            };
            // Never back: a source a little behind the one that handed out
            // `from` has a stable cursor below it. Nothing at or below `from`
            // is in the answer, so `from` stays the settled point.
            let cursor = if stable.0.slot < from.slot {
                from.clone()
            } else {
                stable.0
            };
            let (created, spent) = source
                .since(watched.cred(), block.slot, watched.provenance())
                .await?;
            to_json(&Since::Changes {
                network: "mainnet",
                tip: (&tip).into(),
                from: from.to_string(),
                cursor: cursor.to_string(),
                created,
                spent,
            })
        }
    })
    .await?;
    Ok(json(answer))
}

/// Every Seedelf name unspent at the tip, with the row that holds it. One
/// bucket, the whole list, while it's small (the plan's `names/{bucket}`).
async fn names(State(state): State<Arc<AppState>>) -> Result<Response, ApiError> {
    let answer = from_sources(&state, "names", |source, tip| async move {
        let rows = source.unspent_now(Watched::Contract.cred(), false).await?;
        let mut seen = std::collections::HashSet::new();
        let names = rows
            .into_iter()
            .filter_map(|row| {
                let name = row.seedelf_name()?.to_string();
                seen.insert(name.clone()).then_some(Name { name, row })
            })
            .collect();
        to_json(&Names {
            network: "mainnet",
            tip: (&tip).into(),
            names,
        })
    })
    .await?;
    Ok(json(answer))
}
