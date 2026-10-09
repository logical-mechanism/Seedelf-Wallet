//! Seedelf Wallet's data layer (web wallet chunk 26): the API in front of the
//! home db-sync. This first part is the private index of the Seedelf contract
//! and Lovejoin's mix box; the Koios-equivalent public routes and the submit
//! part come next. See `seedelf-data/README.md`.

pub mod chain;
pub mod config;
pub mod constants;
pub mod cursor;
pub mod private;
pub mod row;
pub mod state;

use std::sync::Arc;

use axum::Router;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use tower_http::compression::CompressionLayer;

use crate::state::{AppState, MAX_AGE_SECS, age};

/// Every route, compressed. Nothing here logs a request: no address, path or body.
pub fn app(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .merge(private::routes())
        .layer(CompressionLayer::new())
        .with_state(state)
}

/// db-sync's tip and how old it is: 200 while the private index can answer, 503 when not.
async fn health(State(state): State<Arc<AppState>>) -> Response {
    let Some(tip) = state.tip() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            axum::Json(serde_json::json!({ "network": "mainnet", "private": "down" })),
        )
            .into_response();
    };
    let age = age(&tip);
    let ok = age <= MAX_AGE_SECS;
    let status = if ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    let body = serde_json::json!({
        "network": "mainnet",
        "private": if ok { "ok" } else { "behind" },
        "tip": { "block": tip.height, "slot": tip.slot, "hash": tip.hash, "time": tip.time },
        "age": age,
    });
    (status, axum::Json(body)).into_response()
}
