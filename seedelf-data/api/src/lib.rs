//! Seedelf Wallet's data layer (web wallet chunk 26): the API in front of the
//! home db-sync, Kupo and node: the private index of the Seedelf contract and
//! Lovejoin's mix box, the Koios-equivalent public routes, and the submit
//! part. See `seedelf-data/README.md`.

pub mod chain;
pub mod config;
pub mod constants;
pub mod cursor;
pub mod decimals;
pub mod ids;
pub mod kupo;
pub mod private;
pub mod public;
pub mod row;
pub mod source;
pub mod state;
pub mod submit;

use std::sync::Arc;

use axum::Router;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use tower_http::compression::CompressionLayer;

use crate::state::{AppState, MAX_AGE_SECS, age, block_age};
use crate::submit::Submit;

/// Every route, compressed. Nothing here logs a request: no address, path or body.
pub fn app(state: Arc<AppState>, submit: Arc<Submit>) -> Router {
    Router::new()
        .route("/health", get(health))
        .merge(private::routes())
        .merge(public::routes())
        .with_state(state)
        .merge(submit::routes().with_state(submit))
        .layer(CompressionLayer::new())
}

/// Each part's state, and each source's tip and age. 200 while the private
/// index and the public routes both answer; 503 when either can't, though
/// the private index may still answer from Kupo while db-sync is down.
async fn health(State(state): State<Arc<AppState>>) -> Response {
    let db_sync = state.tip();
    let public = db_sync.as_ref().is_some_and(|tip| age(tip) <= MAX_AGE_SECS);
    let private = state.private_sources().into_iter().next();
    let kupo = state.kupo_tip();
    let ok = public && private.is_some();
    let body = serde_json::json!({
        "network": "mainnet",
        "private": if private.is_some() { "ok" } else { "down" },
        "source": private.map(|(source, _)| source.upstream().name()),
        "public": if public { "ok" } else { "down" },
        "db_sync": db_sync.map(|tip| serde_json::json!({
            "block": tip.height, "slot": tip.slot, "hash": tip.hash, "age": age(&tip),
        })),
        "kupo": kupo.map(|tip| serde_json::json!({
            "slot": tip.slot, "hash": tip.hash, "age": block_age(&tip),
        })),
    });
    let status = if ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (status, axum::Json(body)).into_response()
}
