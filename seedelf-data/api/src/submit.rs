//! The submit part: Koios's `/submittx` and `/ogmios` paths, in front of the
//! home cardano-submit-api and Ogmios. Koios fronts the same two services, so
//! an answer passes through untouched, status and body, and the error strings
//! the wallet classifies stay exactly what they are (checked byte for byte,
//! 2026-10-08). It depends on the node alone: db-sync can be down.
//!
//! Nothing here is cached or logged: not a transaction, not its ID, not an error's URL.

use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use tokio::sync::Semaphore;
use tracing::warn;

/// The ledger's `max_tx_size`: nothing larger can be a transaction.
pub const MAX_TX_BYTES: usize = 16 * 1024;

/// An evaluation carries the transaction in hex and, for a Lovejoin chain, the unsent outputs it spends.
pub const MAX_EVALUATE_BYTES: usize = 64 * 1024;

/// At most this many submits and evaluations wait on home at once; past it, 503 at once.
const SUBMITS_IN_FLIGHT: usize = 4;
const EVALUATIONS_IN_FLIGHT: usize = 2;

/// As long as the wallet waits for a submit (`SUBMIT_TIMEOUT_MS`).
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(30);

/// A connection that takes longer than this won't come: home is unreachable,
/// and the wallet should resend through Koios now, not in 30 s.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

pub struct Submit {
    http: reqwest::Client,
    submit_api: Option<String>,
    ogmios: Option<String>,
    submits: Arc<Semaphore>,
    evaluations: Arc<Semaphore>,
}

impl Submit {
    pub fn new(submit_api: Option<String>, ogmios: Option<String>) -> anyhow::Result<Self> {
        Ok(Submit {
            http: reqwest::Client::builder()
                .timeout(UPSTREAM_TIMEOUT)
                .connect_timeout(CONNECT_TIMEOUT)
                // A fresh connection for each: a kept one that died with the
                // tunnel would hold a submit for the full 30 s.
                .pool_max_idle_per_host(0)
                .build()?,
            submit_api: submit_api.map(|url| url.trim_end_matches('/').to_string()),
            ogmios: ogmios.map(|url| url.trim_end_matches('/').to_string()),
            submits: Arc::new(Semaphore::new(SUBMITS_IN_FLIGHT)),
            evaluations: Arc::new(Semaphore::new(EVALUATIONS_IN_FLIGHT)),
        })
    }
}

pub fn routes() -> Router<Arc<Submit>> {
    Router::new()
        .route(
            "/api/v1/submittx",
            post(submittx).layer(DefaultBodyLimit::max(MAX_TX_BYTES)),
        )
        .route(
            "/api/v1/ogmios",
            post(ogmios).layer(DefaultBodyLimit::max(MAX_EVALUATE_BYTES)),
        )
}

fn refuse(status: StatusCode, error: &'static str) -> Response {
    let mut response = (status, axum::Json(serde_json::json!({ "error": error }))).into_response();
    if status == StatusCode::SERVICE_UNAVAILABLE {
        response
            .headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from_static("5"));
    }
    response
}

/// Raw transaction bytes, `Content-Type: application/cbor`, as the wallet sends Koios.
async fn submittx(State(submit): State<Arc<Submit>>, headers: HeaderMap, body: Bytes) -> Response {
    if !is_type(&headers, "application/cbor") {
        return refuse(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "a transaction is application/cbor",
        );
    }
    let Some(base) = submit.submit_api.as_deref() else {
        return refuse(StatusCode::SERVICE_UNAVAILABLE, "no submit-api configured");
    };
    let Ok(_slot) = submit.submits.clone().try_acquire_owned() else {
        return refuse(StatusCode::SERVICE_UNAVAILABLE, "busy");
    };
    let request = submit
        .http
        .post(format!("{base}/api/submit/tx"))
        .header(header::CONTENT_TYPE, "application/cbor")
        .body(body);
    pass_through(request, "submit-api").await
}

/// One JSON-RPC call, and only `evaluateTransaction`: the wallet's only use of Ogmios.
async fn ogmios(State(submit): State<Arc<Submit>>, headers: HeaderMap, body: Bytes) -> Response {
    // JSON, as the wallet sends it: a text/plain POST needs no CORS
    // preflight, so any web page could make its visitors send one.
    if !is_type(&headers, "application/json") {
        return refuse(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "an evaluation is application/json",
        );
    }
    if let Err(why) = only_evaluate(&body) {
        return refuse(StatusCode::BAD_REQUEST, why);
    }
    let Some(base) = submit.ogmios.as_deref() else {
        return refuse(StatusCode::SERVICE_UNAVAILABLE, "no Ogmios configured");
    };
    let Ok(_slot) = submit.evaluations.clone().try_acquire_owned() else {
        return refuse(StatusCode::SERVICE_UNAVAILABLE, "busy");
    };
    let request = submit
        .http
        .post(format!("{base}/"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(body);
    pass_through(request, "Ogmios").await
}

fn is_type(headers: &HeaderMap, wanted: &str) -> bool {
    headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case(wanted))
}

/// A JSON-RPC 2.0 `evaluateTransaction` call, and nothing else Ogmios offers.
pub fn only_evaluate(body: &[u8]) -> Result<(), &'static str> {
    let call: serde_json::Value =
        serde_json::from_slice(body).map_err(|_| "a JSON-RPC call is JSON")?;
    if call.get("jsonrpc").and_then(|v| v.as_str()) != Some("2.0") {
        return Err("a JSON-RPC 2.0 call");
    }
    if call.get("method").and_then(|v| v.as_str()) != Some("evaluateTransaction") {
        return Err("only evaluateTransaction");
    }
    Ok(())
}

/// The upstream's answer as it came, or 502/504 when there's none. An error is
/// logged by kind only: reqwest's own message carries the upstream's URL.
async fn pass_through(request: reqwest::RequestBuilder, upstream: &'static str) -> Response {
    let answer = match request.send().await {
        Ok(answer) => answer,
        Err(error) => {
            let (status, kind) = if error.is_timeout() {
                (StatusCode::GATEWAY_TIMEOUT, "timed out")
            } else {
                (StatusCode::BAD_GATEWAY, "unreachable")
            };
            warn!(upstream, kind, "no answer");
            return refuse(status, kind);
        }
    };
    let status = StatusCode::from_u16(answer.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let kind = answer.headers().get(header::CONTENT_TYPE).cloned();
    match answer.bytes().await {
        Ok(body) => {
            let mut response = (status, body).into_response();
            if let Some(kind) = kind {
                response.headers_mut().insert(header::CONTENT_TYPE, kind);
            }
            response
        }
        Err(_) => {
            warn!(upstream, "an answer couldn't be read");
            refuse(StatusCode::BAD_GATEWAY, "unreadable")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_evaluate_transaction_goes_to_ogmios() {
        let call = |method: &str| {
            serde_json::to_vec(&serde_json::json!({
                "jsonrpc": "2.0", "method": method, "params": { "transaction": { "cbor": "84" } }
            }))
            .unwrap()
        };
        assert_eq!(only_evaluate(&call("evaluateTransaction")), Ok(()));
        for method in [
            "submitTransaction",
            "queryLedgerState/utxo",
            "acquireLedgerState",
        ] {
            assert_eq!(
                only_evaluate(&call(method)),
                Err("only evaluateTransaction")
            );
        }
        assert_eq!(
            only_evaluate(br#"{"method":"evaluateTransaction"}"#),
            Err("a JSON-RPC 2.0 call")
        );
        assert_eq!(only_evaluate(b"not json"), Err("a JSON-RPC call is JSON"));
    }

    #[test]
    fn a_transaction_must_say_it_is_cbor() {
        let mut headers = HeaderMap::new();
        assert!(!is_type(&headers, "application/cbor"));
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("Application/CBOR; x=y"),
        );
        assert!(is_type(&headers, "application/cbor"));
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        assert!(!is_type(&headers, "application/cbor"));
    }
}
