//! The submit part against the real cardano-submit-api and Ogmios, through
//! `seedelf-data/.env`. Ignored by default: `cargo test -- --ignored`.
//!
//! Free by construction: nothing sent can ever land. Either it isn't a
//! transaction, or it's one already on chain, whose inputs are spent.

use std::sync::Arc;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode, header};
use seedelf_data_api::submit::{MAX_TX_BYTES, Submit, routes};
use tower::ServiceExt;

/// The Seedelf contract's first transaction (block 11,305,805): on chain since January 2025.
const ON_CHAIN: &str = "1e491b15714b141f1bc8cbd3d5a4a801d5066ddd66d3d922492106790b506507";

fn env() {
    let _ = dotenvy::from_path(concat!(env!("CARGO_MANIFEST_DIR"), "/../.env"));
}

fn app() -> Router {
    env();
    let submit = Submit::new(
        std::env::var("MAINNET_SUBMIT_API_URL").ok(),
        std::env::var("MAINNET_OGMIOS_URL").ok(),
    )
    .unwrap();
    routes().with_state(Arc::new(submit))
}

/// The on-chain transaction's CBOR, from db-sync's `tx_cbor`.
async fn on_chain_cbor() -> Vec<u8> {
    env();
    let url = std::env::var("MAINNET_DATABASE_URL").unwrap();
    let (client, connection) = tokio_postgres::connect(&url, tokio_postgres::NoTls)
        .await
        .unwrap();
    tokio::spawn(connection);
    let hash: Vec<u8> = (0..ON_CHAIN.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&ON_CHAIN[i..i + 2], 16).unwrap())
        .collect();
    let row = client
        .query_one(
            "select c.bytes from tx_cbor c join tx t on t.id = c.tx_id where t.hash = $1::bytea",
            &[&hash],
        )
        .await
        .unwrap();
    row.get(0)
}

async fn send(app: Router, path: &str, kind: &str, body: Vec<u8>) -> (StatusCode, String) {
    let request = Request::post(path)
        .header(header::CONTENT_TYPE, kind)
        .body(Body::from(body))
        .unwrap();
    let response = app.oneshot(request).await.unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    (status, String::from_utf8_lossy(&body).into_owned())
}

#[tokio::test]
#[ignore = "live submit-api"]
async fn bytes_that_arent_a_transaction_are_refused_as_koios_refuses_them() {
    let (status, body) = send(
        app(),
        "/api/v1/submittx",
        "application/cbor",
        vec![0x82, 1, 2],
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        body.contains("TxSubmitFail") && body.contains("DecoderErrorDeserialiseFailure"),
        "{body}"
    );
}

#[tokio::test]
#[ignore = "live submit-api"]
async fn a_transaction_already_on_chain_is_refused_as_spent() {
    let cbor = on_chain_cbor().await;
    let (status, body) = send(app(), "/api/v1/submittx", "application/cbor", cbor).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.contains("All inputs are spent"), "{body}");
}

#[tokio::test]
#[ignore = "live Ogmios"]
async fn ogmios_evaluates_and_answers_as_it_does() {
    let cbor = on_chain_cbor().await;
    let hex: String = cbor.iter().map(|b| format!("{b:02x}")).collect();
    let call = serde_json::json!({
        "jsonrpc": "2.0", "method": "evaluateTransaction",
        "params": { "transaction": { "cbor": hex } }
    });
    let (_, body) = send(
        app(),
        "/api/v1/ogmios",
        "application/json",
        serde_json::to_vec(&call).unwrap(),
    )
    .await;
    let answer: serde_json::Value = serde_json::from_str(&body).expect("Ogmios's JSON");
    // Its inputs are spent, so Ogmios can't evaluate it: a JSON-RPC error, passed through.
    assert_eq!(answer["jsonrpc"], "2.0");
    assert!(answer.get("error").is_some(), "{body}");
}

#[tokio::test]
#[ignore = "live submit-api"]
async fn what_the_server_refuses_itself() {
    let (status, _) = send(app(), "/api/v1/submittx", "application/json", vec![0x84]).await;
    assert_eq!(status, StatusCode::UNSUPPORTED_MEDIA_TYPE);
    let (status, _) = send(
        app(),
        "/api/v1/submittx",
        "application/cbor",
        vec![0; MAX_TX_BYTES + 1],
    )
    .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    let submit =
        serde_json::json!({ "jsonrpc": "2.0", "method": "submitTransaction", "params": {} });
    let (status, body) = send(
        app(),
        "/api/v1/ogmios",
        "application/json",
        serde_json::to_vec(&submit).unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.contains("only evaluateTransaction"), "{body}");
}
