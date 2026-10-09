//! The public side: Koios's paths and JSON under `/api/v1/`, so falling back
//! to Koios is a change of base URL. Each route takes exactly what
//! `koios.ts` sends it and answers with Koios's names and types for what the
//! wallet reads; anything else is a 400 ([`query`]). Mainnet only.
//!
//! The SQL is this server's own, read from db-sync's tables with the
//! read-only role. It's written after Koios's `grest` functions
//! ([koios-artifacts](https://github.com/cardano-community/koios-artifacts),
//! CC-BY-4.0), which the home Postgres doesn't have, and measured against
//! db-sync's own indexes. Koios's caches (asset, pool, stake distribution)
//! aren't there either: each route says what it uses instead.
//!
//! Answers about one user are never cached. Answers the same for everyone
//! are, and say for how long.

pub mod account;
pub mod assets;
pub mod governance;
pub mod ledger;
pub mod pools;
pub mod query;
pub mod tx;
pub mod utxos;

use std::collections::HashSet;
use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::DefaultBodyLimit;
use axum::http::{HeaderMap, header};
use axum::routing::{get, post};
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::state::{ApiError, AppState, to_json};
use query::NOT_ASKED;

/// The most a request's body can be: the wallet's largest is 75 credentials, about 4.5 KB.
pub const MAX_BODY: usize = 16 * 1024;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/v1/credential_utxos", post(utxos::credential_utxos))
        .route("/api/v1/address_utxos", post(utxos::address_utxos))
        .route("/api/v1/utxo_info", post(utxos::utxo_info))
        .route("/api/v1/datum_info", post(utxos::datum_info))
        .route("/api/v1/tip", get(ledger::tip))
        .route("/api/v1/tx_status", post(ledger::tx_status))
        .route("/api/v1/epoch_params", get(ledger::epoch_params))
        .route("/api/v1/totals", get(ledger::totals))
        .route(
            "/api/v1/account_addresses",
            post(account::account_addresses),
        )
        .route("/api/v1/account_info", post(account::account_info))
        .route("/api/v1/account_txs", post(account::account_txs))
        .route("/api/v1/tx_info", post(tx::tx_info))
        .route("/api/v1/pool_list", get(pools::pool_list))
        .route("/api/v1/pool_info", post(pools::pool_info))
        .route("/api/v1/drep_info", post(governance::drep_info))
        .route("/api/v1/drep_metadata", post(governance::drep_metadata))
        .route("/api/v1/proposal_list", get(governance::proposal_list))
        .route("/api/v1/vote_list", get(governance::vote_list))
        .route("/api/v1/asset_nft_address", get(assets::asset_nft_address))
        .route("/api/v1/asset_info", post(assets::asset_info))
        .layer(DefaultBodyLimit::max(MAX_BODY))
}

/// A POST's JSON body, in the one shape its route takes (`deny_unknown_fields`).
fn body<T: DeserializeOwned>(headers: &HeaderMap, bytes: &[u8]) -> Result<T, ApiError> {
    let json = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"));
    if !json {
        return Err(ApiError::Bad("a body is application/json"));
    }
    serde_json::from_slice(bytes).map_err(|_| NOT_ASKED)
}

/// Rows as Koios answers them: a JSON array.
fn array<T: Serialize>(rows: &[T]) -> Result<Bytes, ApiError> {
    to_json(&rows)
}

/// No item twice: the wallet never asks twice in one request.
fn distinct(items: &[String]) -> bool {
    items.iter().collect::<HashSet<_>>().len() == items.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;
    use serde::Deserialize;

    #[derive(Deserialize, Debug)]
    #[serde(deny_unknown_fields)]
    struct Shape {
        _tx_hashes: Vec<String>,
    }

    #[test]
    fn a_body_is_json_in_its_one_shape() {
        let mut headers = HeaderMap::new();
        assert!(body::<Shape>(&headers, br#"{"_tx_hashes":[]}"#).is_err());
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        assert!(body::<Shape>(&headers, br#"{"_tx_hashes":["a"]}"#).is_ok());
        assert!(body::<Shape>(&headers, br#"{"_tx_hashes":["a"],"_extra":1}"#).is_err());
        assert!(body::<Shape>(&headers, br#"{"_tx_hashes":"a"}"#).is_err());
    }
}
