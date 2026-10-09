//! Seedelf Wallet's data layer (web wallet chunk 26): the API in front of the
//! home db-sync, Kupo and node: the private index of the Seedelf contract and
//! Lovejoin's mix box, the Koios-equivalent public routes, and the submit
//! part. See `seedelf-data/README.md`.

pub mod chain;
pub mod config;
pub mod constants;
pub mod cursor;
pub mod decimals;
pub mod edge;
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

use crate::edge::Edge;
use crate::state::{AppState, age, block_age};
use crate::submit::Submit;

/// Every route, compressed, behind the edge's limits, with CORS outermost so
/// the wallet can read a 429 too. Nothing here logs a request: no address,
/// path or body.
pub fn app(
    state: Arc<AppState>,
    submit: Arc<Submit>,
    edge: Arc<Edge>,
    origins: &[String],
) -> Router {
    Router::new()
        .route("/health", get(health))
        .with_state((state.clone(), edge.clone()))
        .merge(private::routes().with_state(state.clone()))
        .merge(public::routes().with_state(state))
        .merge(submit::routes().with_state(submit))
        .layer(CompressionLayer::new())
        .layer(axum::middleware::from_fn_with_state(edge, edge::limit))
        .layer(edge::cors(origins))
}

/// Each part's state, and each source's tip and age. 200 while the private
/// index and the public routes both answer; 503 when either can't (though
/// the private index may still answer from Kupo while db-sync is down), or
/// when the month's traffic is over its ceiling.
async fn health(State((state, edge)): State<(Arc<AppState>, Arc<Edge>)>) -> Response {
    let db_sync = state.tip();
    let public = state.fresh_tip().is_ok();
    let private = state.private_sources().into_iter().next();
    let kupo = state.kupo_tip();
    let egress_over = edge.egress.over();
    let ok = public && private.is_some() && !egress_over;
    let body = serde_json::json!({
        "network": "mainnet",
        "private": if private.is_some() { "ok" } else { "down" },
        "source": private.map(|(source, _)| source.upstream().name()),
        "public": if public { "ok" } else { "down" },
        "egress": if egress_over { "over" } else { "ok" },
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
