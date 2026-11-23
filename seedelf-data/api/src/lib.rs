//! Seedelf Wallet's data layer (web wallet chunk 26): the API in front of the
//! home db-sync, Kupo and node: the private index of the Seedelf contract and
//! Lovejoin's mix box, the Koios-equivalent public routes, and the submit
//! part. Beside them, Seedelf Messaging's relay (chunk 54's 54c), which
//! reads no chain. See `seedelf-data/README.md`.

pub mod chain;
pub mod config;
pub mod constants;
pub mod cursor;
pub mod decimals;
pub mod edge;
pub mod ids;
pub mod kupo;
pub mod lovejoin;
pub mod messaging;
pub mod private;
pub mod public;
pub mod row;
pub mod serve;
pub mod source;
pub mod state;
pub mod submit;

use std::sync::Arc;

use axum::Router;
use axum::extract::State;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use tower_http::compression::CompressionLayer;
use tower_http::compression::predicate::{DefaultPredicate, NotForContentType, Predicate};
use tower_http::set_header::SetResponseHeaderLayer;

use crate::edge::Edge;
use crate::messaging::Relay;
use crate::state::{AppState, age, block_age, slot_age};
use crate::submit::Submit;

/// Every route, compressed, behind the edge's limits, with CORS outermost so
/// the wallet can read a 429 too. Nothing here logs a request: no address,
/// path or body.
///
/// Every answer but a preflight says `Cache-Control: no-store`. The wallet
/// asks with `cache: "default"`, so Chrome reuses a preflight (`edge::cors`'s
/// max-age) instead of making one before every POST; this keeps the answers
/// themselves out of the browser's cache, which would otherwise hold some
/// that name what's private (an ADA Handle, a DRep ID).
///
/// The relay's pages aren't compressed: they're ciphertext, which doesn't.
pub fn app(
    state: Arc<AppState>,
    submit: Arc<Submit>,
    edge: Arc<Edge>,
    relay: Arc<Relay>,
    origins: &[String],
) -> Router {
    let compress =
        DefaultPredicate::new().and(NotForContentType::const_new("application/octet-stream"));
    Router::new()
        .route("/health", get(health))
        .with_state((state.clone(), edge.clone(), submit.clone(), relay.clone()))
        .merge(private::routes().with_state(state.clone()))
        .merge(public::routes().with_state(state))
        .merge(submit::routes().with_state(submit))
        .merge(messaging::routes().with_state(relay))
        .layer(CompressionLayer::new().compress_when(compress))
        .layer(axum::middleware::from_fn_with_state(edge, edge::limit))
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        ))
        .layer(edge::cors(origins))
}

/// What `/health` reads: every part.
type Parts = (Arc<AppState>, Arc<Edge>, Arc<Submit>, Arc<Relay>);

/// Each part's state, and each source's tip and age. 200 while the private
/// index and the public routes both answer; 503 when either can't (though
/// the private index may still answer from Kupo while db-sync is down), or
/// when the month's traffic is over its ceiling. The submit part's state is
/// said, not counted: the deploy compares this status with the one before.
/// So is the relay's: whether it's stopped, messaging over its own
/// allowance, whether it has a ceiling of its own at all and how much of
/// today's share is left, whether it's down to its reserve, and each pool's
/// size. Nothing here is of any one client: no address, and no count of
/// one.
async fn health(State((state, edge, submit, relay)): State<Parts>) -> Response {
    let db_sync = state.tip();
    let public = state.fresh_tip().is_ok();
    let private = state.private_sources().into_iter().next();
    let kupo = state.kupo_tip();
    let egress_over = edge.egress.over();
    let node = submit.node();
    let ok = public && private.is_some() && !egress_over;
    let body = serde_json::json!({
        "network": "mainnet",
        "private": if private.is_some() { "ok" } else { "down" },
        "source": private.map(|(source, _)| source.upstream().name()),
        "public": if public { "ok" } else { "down" },
        "submit": if submit.synced() { "ok" } else { "down" },
        "egress": if egress_over { "over" } else { "ok" },
        "messaging": {
            // off: `DATA_MESSAGING_OFF`, and every relay route answers 410 Gone.
            "relay": if edge.messaging_off() { "off" } else { "on" },
            "egress": if edge.messaging_egress.over() { "over" } else { "ok" },
            // false: `DATA_MESSAGING_GB_MONTH` isn't set, so the relay spends the API's own allowance.
            "ceiling": edge.messaging_egress.has_ceiling(),
            // The percent of today's share still unspent, rounded down: null without a ceiling.
            "day_left": edge.messaging_egress.today().map(|(spent, share)| {
                (share - spent).saturating_mul(100).checked_div(share).unwrap_or(0)
            }),
            // true: only posts and short pages are answered until tomorrow's share (`edge::Reserve`).
            "reserve": edge.reserved(),
            "pools": relay.health(),
        },
        "db_sync": db_sync.map(|tip| serde_json::json!({
            "block": tip.height, "slot": tip.slot, "hash": tip.hash, "age": age(&tip),
        })),
        "kupo": kupo.map(|tip| serde_json::json!({
            "slot": tip.slot, "hash": tip.hash, "age": block_age(&tip),
        })),
        "node": node.map(|node| serde_json::json!({
            "slot": node.slot, "age": node.slot.map(slot_age), "connected": node.connected,
        })),
    });
    let status = if ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (status, axum::Json(body)).into_response()
}
