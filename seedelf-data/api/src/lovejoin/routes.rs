//! The token pools' routes, under `/seedelf/v1/mainnet/lovejoin/`, beside
//! the classic pool's, which they leave as they were (web wallet chunk 34's
//! 34c). Every answer is the same for whoever asks: no request names a pool.
//!
//! - `pools`: every shown pool ([`super::standard`]), as of a stable cursor:
//!   its reference UTxO, the seed its launch spent, its two reference
//!   scripts, where its launch is, and its crowd; and the classic pool's crowd.
//! - `tokens` and `tokens/since/{cursor}`: the boxes of every shown pool,
//!   read as `lovejoin/pool` and `lovejoin/since` are, each with its making.
//!   Each answer names the pools it covers (their `mix_box` hashes): those
//!   shown as of its cursor, or of `from`'s.
//!
//! db-sync alone answers: Kupo indexes neither the holder nor the token
//! pools (adding a pattern would roll it back). While db-sync can't answer,
//! these say 503 and the wallet reads the token pools from Koios; the
//! classic pool's routes go on answering from Kupo.

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

use super::crowd::Crowd;
use super::standard::{Pool, hex};
use crate::chain::{Block, Chain};
use crate::cursor::{Cursor, CursorError};
use crate::private::{READ_TIMEOUT, TipView, stable};
use crate::row::{Point, Row, Spent};
use crate::source::{Source, Upstream};
use crate::state::{ApiError, AppState, Throttle, failure, json, to_json};

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/seedelf/v1/mainnet/lovejoin/pools", get(pools))
        .route("/seedelf/v1/mainnet/lovejoin/tokens", get(tokens))
        .route(
            "/seedelf/v1/mainnet/lovejoin/tokens/since/{cursor}",
            get(tokens_since),
        )
}

/// How long a cursor's pool list is kept: it can't change, and the cursor
/// moves every 200 slots.
const KEEP_POOLS: Duration = Duration::from_secs(3600);

#[derive(Serialize)]
struct LaunchView {
    tx: String,
    block: i64,
    /// Its place in its block.
    index: i64,
    #[serde(flatten)]
    at: Point,
}

#[derive(Serialize)]
struct ScriptRow {
    #[serde(flatten)]
    row: Row,
    /// The reference script's hash: the wallet derives the bytes itself.
    script_hash: String,
}

#[derive(Serialize)]
struct PoolView {
    id: String,
    seed: String,
    reference: Row,
    /// Its `mix_box` and `mix_logic`, as its launch put them at the holder.
    scripts: Vec<ScriptRow>,
    launch: LaunchView,
    crowd: Crowd,
}

#[derive(Serialize)]
struct ClassicView {
    crowd: Crowd,
}

#[derive(Serialize)]
struct Pools {
    network: &'static str,
    cursor: String,
    classic: ClassicView,
    pools: Vec<PoolView>,
}

#[derive(Serialize)]
struct Tokens {
    network: &'static str,
    tip: TipView,
    cursor: String,
    /// The pools the rows are of, by their `mix_box` hashes.
    pools: Vec<String>,
    rows: Vec<Row>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum TokensSince {
    Changes {
        network: &'static str,
        tip: TipView,
        from: String,
        cursor: String,
        pools: Vec<String>,
        created: Vec<Row>,
        spent: Vec<Spent>,
    },
    Reset {
        network: &'static str,
        tip: TipView,
        reset: bool,
    },
}

/// `make`'s answer from db-sync, kept until its tip moves; 503 while it can't answer.
async fn from_db_sync<F, Fut>(state: &AppState, key: &str, make: F) -> Result<Bytes, ApiError>
where
    F: FnOnce(Chain, Block) -> Fut,
    Fut: Future<Output = Result<Bytes, ApiError>>,
{
    let Some((Source::DbSync(chain), tip)) = state
        .private_sources()
        .into_iter()
        .find(|(source, _)| source.upstream() == Upstream::DbSync)
    else {
        return Err(ApiError::Behind);
    };
    let read = state.cached_in(Upstream::DbSync, &tip.hash, key, || {
        make(chain, tip.clone())
    });
    tokio::time::timeout(READ_TIMEOUT, read)
        .await
        .unwrap_or_else(|_| Err(ApiError::Unavailable(anyhow::anyhow!("timed out"))))
}

fn mix_boxes(pools: &[Pool]) -> (Vec<Vec<u8>>, Vec<String>) {
    pools
        .iter()
        .map(|p| (p.derived.mix_box.to_vec(), hex(&p.derived.mix_box)))
        .unzip()
}

/// The shown pools and the crowds as of the block at slot `at`, for `cursor`.
async fn pools_at(
    state: &AppState,
    chain: &Chain,
    cursor: &Cursor,
    at: i64,
) -> Result<Bytes, ApiError> {
    let shown = state.lovejoin.shown(chain, at).await?;
    let (classic, crowds) = state.lovejoin.crowds(chain, &shown, at).await?;
    let pools = shown
        .into_iter()
        .zip(crowds)
        .map(|(p, crowd)| PoolView {
            id: hex(&p.id),
            seed: format!("{}#{}", hex(&p.seed.0), p.seed.1),
            reference: p.reference,
            scripts: p
                .scripts
                .into_iter()
                .zip([p.derived.mix_box, p.derived.mix_logic])
                .map(|(row, hash)| ScriptRow {
                    row,
                    script_hash: hex(&hash),
                })
                .collect(),
            launch: LaunchView {
                tx: p.launch.tx,
                block: p.launch.block,
                index: p.launch.index,
                at: Point::at(p.launch.slot),
            },
            crowd,
        })
        .collect();
    to_json(&Pools {
        network: "mainnet",
        cursor: cursor.to_string(),
        classic: ClassicView { crowd: classic },
        pools,
    })
}

/// The last list worked out, whatever its cursor: answered while the next is.
const LATEST: &str = "lovejoin/pools/latest";

/// How long a list may take to work out, off any request: the holder's
/// candidates and every pool's history grow, and one request's 5 s is no
/// bound on what they cost.
const WORK_BUDGET: Duration = Duration::from_secs(60);

async fn pools(State(state): State<Arc<AppState>>) -> Result<Response, ApiError> {
    let Some((Source::DbSync(chain), tip)) = state
        .private_sources()
        .into_iter()
        .find(|(source, _)| source.upstream() == Upstream::DbSync)
    else {
        return Err(ApiError::Behind);
    };
    let source = Source::DbSync(chain.clone());
    let work = {
        let state = state.clone();
        move |cursor: Cursor, block: Block| async move {
            pools_at(&state, &chain, &cursor, block.slot).await
        }
    };
    let answer = pools_with(&state, &tip, || stable(&source, &tip), work).await?;
    Ok(json(answer))
}

/// [`pools`]' answer at db-sync's tip `tip`, with `stable` reading its stable
/// cursor and `work` working out a cursor's list: db-sync, or a test's.
async fn pools_with<S, SF, W, WF>(
    state: &Arc<AppState>,
    tip: &Block,
    stable: S,
    work: W,
) -> Result<Bytes, ApiError>
where
    S: FnOnce() -> SF,
    SF: Future<Output = Result<(Cursor, Block), ApiError>>,
    W: FnOnce(Cursor, Block) -> WF,
    WF: Future<Output = Result<Bytes, ApiError>> + Send + 'static,
{
    static FAILED: Throttle = Throttle::new();
    // One deadline for the whole request, its cursor's read included: two waits of 5 s each took the wallet's
    // 10 s, and a wallet that gets no answer takes its private part to Koios for 5 minutes (1.6.0's release review,
    // 317-data#0).
    let deadline = tokio::time::Instant::now() + READ_TIMEOUT;
    // Read once a tip, as every other private route's is, not at each request before what's kept is looked at
    // (317-data#2).
    let read = tokio::time::timeout_at(deadline, state.stable_cursor(tip, stable))
        .await
        .unwrap_or_else(|_| Err(ApiError::Unavailable(anyhow::anyhow!("timed out"))));
    let failed = match read {
        // A read that fails or runs late fails as the list would: the cursor moves every 200 slots, so the last
        // list is most often this very cursor's (1.6.0's review of the fixes, R3-15).
        Err(error) => Some(error),
        Ok((cursor, block)) => {
            let key = format!("lovejoin/pools/{cursor}");
            if let Some(answer) = state.kept(&key) {
                return Ok(answer);
            }
            // Worked out once per cursor, in a task of its own, and kept: a request waits for it until its
            // deadline.
            match state.start(&key) {
                Some(working) => {
                    let list = work(cursor, block);
                    let task = {
                        let (state, key) = (state.clone(), key.clone());
                        tokio::spawn(async move {
                            let _working = working;
                            let answer = tokio::time::timeout(WORK_BUDGET, list)
                                .await
                                .unwrap_or_else(|_| {
                                    Err(ApiError::Unavailable(anyhow::anyhow!("timed out")))
                                })?;
                            state.keep(&key, KEEP_POOLS, answer.clone());
                            state.keep(LATEST, KEEP_POOLS, answer.clone());
                            Ok::<_, ApiError>(answer)
                        })
                    };
                    match tokio::time::timeout_at(deadline, task).await {
                        Ok(Ok(Ok(answer))) => return Ok(answer),
                        Ok(Ok(Err(error))) => Some(error),
                        Ok(Err(error)) => Some(ApiError::Unavailable(error.into())),
                        Err(_) => None,
                    }
                }
                // Another request's task is working it out.
                None => None,
            }
        }
    };
    // Meanwhile the last list, and as much when the list or its cursor's read fails: kept for an hour, it's a better
    // answer than a 503 that sends the wallet to Koios (317-data#0). 503 before the first.
    match (state.kept(LATEST), failed) {
        (Some(latest), failed) => {
            if let Some(ApiError::Unavailable(error)) = &failed
                && FAILED.due()
            {
                let error = failure(error);
                warn!(
                    error,
                    "a pool list couldn't be worked out, so the last one answers"
                );
            }
            Ok(latest)
        }
        (None, Some(error)) => Err(error),
        (None, None) => Err(ApiError::Behind),
    }
}

async fn tokens(State(state): State<Arc<AppState>>) -> Result<Response, ApiError> {
    let state = &*state;
    let answer = from_db_sync(state, "lovejoin/tokens", |chain, tip| async move {
        let (cursor, block) = stable(&Source::DbSync(chain.clone()), &tip).await?;
        let shown = state.lovejoin.shown(&chain, block.slot).await?;
        let (creds, pools) = mix_boxes(&shown);
        let rows = if creds.is_empty() {
            Vec::new()
        } else {
            chain.unspent_as_of_any(&creds, block.slot).await?
        };
        to_json(&Tokens {
            network: "mainnet",
            tip: (&tip).into(),
            cursor: cursor.to_string(),
            pools,
            rows: rows
                .into_iter()
                .map(|row| row.with_decimals(&state.decimals))
                .collect(),
        })
    })
    .await?;
    Ok(json(answer))
}

async fn tokens_since(
    State(state): State<Arc<AppState>>,
    Path(cursor): Path<String>,
) -> Result<Response, ApiError> {
    let state = &*state;
    let from: Cursor = cursor.parse().map_err(|error| {
        ApiError::Bad(match error {
            CursorError::Malformed => "a cursor is <slot>.<block hash>",
            CursorError::NotQuantised => "not a cursor this server hands out",
        })
    })?;
    let key = format!("lovejoin/tokens/since/{from}");
    let answer = from_db_sync(state, &key, |chain, tip| async move {
        if tip.slot <= from.slot {
            return Err(ApiError::Behind);
        }
        let source = Source::DbSync(chain.clone());
        let (stable, block) = tokio::try_join!(stable(&source, &tip), async {
            Ok(source.block_before(from.slot).await?)
        })?;
        let Some(block) = block.filter(|block| block.hash == from.hash) else {
            return to_json(&TokensSince::Reset {
                network: "mainnet",
                tip: (&tip).into(),
                reset: true,
            });
        };
        let cursor = if stable.0.slot < from.slot {
            from.clone()
        } else {
            stable.0
        };
        // The pools as of `from`: the same the snapshot that handed it out covered.
        let shown = state.lovejoin.shown(&chain, block.slot).await?;
        let (creds, pools) = mix_boxes(&shown);
        let (created, spent) = if creds.is_empty() {
            (Vec::new(), Vec::new())
        } else {
            chain.since_any(&creds, block.slot).await?
        };
        to_json(&TokensSince::Changes {
            network: "mainnet",
            tip: (&tip).into(),
            from: from.to_string(),
            cursor: cursor.to_string(),
            pools,
            created: created
                .into_iter()
                .map(|row| row.with_decimals(&state.decimals))
                .collect(),
            spent,
        })
    })
    .await?;
    Ok(json(answer))
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use tokio::time::{Instant, sleep};

    use super::*;

    fn state() -> Arc<AppState> {
        Arc::new(AppState::new(
            Chain::connect("postgresql://nobody@127.0.0.1:1/nothing").unwrap(),
        ))
    }

    /// db-sync's tip at slot 1,400, its hash `byte` over.
    fn tip(byte: &str) -> Block {
        Block {
            slot: 1_400,
            hash: byte.repeat(32),
        }
    }

    /// The stable cursor for a tip at slot 1,400, and the block there.
    fn stable_at() -> (Cursor, Block) {
        let hash = "ab".repeat(32);
        (
            Cursor {
                slot: 1_200,
                hash: hash.clone(),
            },
            Block { slot: 1_180, hash },
        )
    }

    const LAST: &[u8] = b"the last list";

    /// 1.6.0's release review, 317-data#0: a cursor read that took most of
    /// its 5 s, then a list still being worked out, kept a request 10 s, when
    /// the wallet gives up, and takes its private part to Koios for 5 minutes.
    #[tokio::test(start_paused = true)]
    async fn a_pool_list_answers_by_one_deadline() {
        let state = state();
        state.keep(LATEST, KEEP_POOLS, Bytes::from_static(LAST));
        let slow = || async {
            sleep(Duration::from_millis(4_900)).await;
            Ok(stable_at())
        };
        let working = |_, _| async {
            sleep(WORK_BUDGET).await;
            to_json(&"the next list")
        };
        let started = Instant::now();
        let answer = pools_with(&state, &tip("aa"), slow, working).await;
        assert_eq!(answer.unwrap(), LAST);
        assert!(started.elapsed() <= READ_TIMEOUT, "{:?}", started.elapsed());
    }

    /// 317-data#0: a list that failed at once answered 503, though the last
    /// one was kept for an hour: the wallet then dropped the crowds and read
    /// the holder from Koios.
    #[tokio::test]
    async fn a_list_that_fails_answers_the_last_one() {
        let failing = |_, _| async { Err(ApiError::Unavailable(anyhow::anyhow!("no"))) };
        let state = state();
        state.keep(LATEST, KEEP_POOLS, Bytes::from_static(LAST));
        let answer = pools_with(&state, &tip("aa"), || async { Ok(stable_at()) }, failing).await;
        assert_eq!(answer.unwrap(), LAST);
        // Before the first, why.
        let answer = pools_with(
            &self::state(),
            &tip("aa"),
            || async { Ok(stable_at()) },
            failing,
        )
        .await;
        assert!(matches!(answer, Err(ApiError::Unavailable(_))));
    }

    /// 1.6.0's review of the fixes, R3-15: the first requests at a new tip
    /// read the stable cursor, and one that found both private connections
    /// busy past the pool's 2 s wait answered 503, though the list for that
    /// very cursor, and the last one, were kept for an hour.
    #[tokio::test]
    async fn a_failed_cursor_read_answers_the_last_list() {
        let state = state();
        let list = |_, _| async { to_json(&"the list") };
        let first = pools_with(&state, &tip("aa"), || async { Ok(stable_at()) }, list).await;
        let busy = || async {
            Err(ApiError::Unavailable(anyhow::anyhow!(
                "no connection within 2 s"
            )))
        };
        let answer = pools_with(&state, &tip("bb"), busy, list).await;
        assert_eq!(answer.unwrap(), first.unwrap());
        // Before the first list, why.
        let answer = pools_with(&self::state(), &tip("bb"), busy, list).await;
        assert!(matches!(answer, Err(ApiError::Unavailable(_))));
    }

    /// R3-15: a cursor read that ran past the request's 5 s answered 503
    /// with the last list kept.
    #[tokio::test(start_paused = true)]
    async fn a_slow_cursor_read_answers_the_last_list() {
        let state = state();
        state.keep(LATEST, KEEP_POOLS, Bytes::from_static(LAST));
        let slow = || async {
            sleep(Duration::from_secs(6)).await;
            Ok(stable_at())
        };
        let list = |_, _| async { to_json(&"the next list") };
        let started = Instant::now();
        let answer = pools_with(&state, &tip("bb"), slow, list).await;
        assert_eq!(answer.unwrap(), LAST);
        assert!(started.elapsed() <= READ_TIMEOUT, "{:?}", started.elapsed());
    }

    /// 317-data#2: the stable cursor was read of db-sync at every request,
    /// before what's kept for it was looked at.
    #[tokio::test]
    async fn the_stable_cursor_is_read_once_a_tip() {
        let state = state();
        let reads = AtomicUsize::new(0);
        let stable = || async {
            reads.fetch_add(1, Ordering::SeqCst);
            Ok(stable_at())
        };
        let list = |_, _| async { to_json(&"a list") };
        for _ in 0..2 {
            pools_with(&state, &tip("aa"), stable, list).await.unwrap();
        }
        assert_eq!(reads.load(Ordering::SeqCst), 1);
        // A new tip: read again.
        pools_with(&state, &tip("bb"), stable, list).await.unwrap();
        assert_eq!(reads.load(Ordering::SeqCst), 2);
    }
}
