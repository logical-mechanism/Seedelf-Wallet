//! The whole app behind its edge, offline: CORS for the wallet's origin
//! only, a bucket per client that Caddy names, and the month's ceiling. No
//! source is up, so every route answers at once without a query.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::ConnectInfo;
use axum::http::{Method, Request, StatusCode, header};
use seedelf_data_api::chain::Chain;
use seedelf_data_api::edge::{Edge, Egress};
use seedelf_data_api::state::AppState;
use seedelf_data_api::submit::Submit;
use serde_json::Value;
use tower::ServiceExt;

const WALLET: &str = "chrome-extension://jfekiogplaamnceifeehipmomhojngcb";

fn app(ceiling: Option<u64>) -> Router {
    let state = Arc::new(AppState::new(
        Chain::connect("postgresql://nobody@127.0.0.1:1/nothing").unwrap(),
    ));
    let submit = Arc::new(Submit::new(None, None).unwrap());
    let edge = Arc::new(Edge::new(true, Egress::new(ceiling, None)));
    seedelf_data_api::app(state, submit, edge, &[WALLET.to_string()])
}

/// A request as Caddy passes it on: from loopback, naming the client.
fn from(client: &str, method: Method, path: &str) -> Request<Body> {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("x-forwarded-for", client)
        .header(header::ORIGIN, WALLET)
        .body(Body::empty())
        .unwrap();
    request.extensions_mut().insert(ConnectInfo(
        "127.0.0.1:50000".parse::<SocketAddr>().unwrap(),
    ));
    request
}

async fn body(response: axum::response::Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), 1 << 20).await.unwrap()).unwrap()
}

#[tokio::test]
async fn only_the_wallets_origin_may_read() {
    let app = app(None);
    let mut preflight = from("203.0.113.7", Method::OPTIONS, "/api/v1/credential_utxos");
    preflight
        .headers_mut()
        .insert("access-control-request-method", "POST".parse().unwrap());
    preflight.headers_mut().insert(
        "access-control-request-headers",
        "content-type".parse().unwrap(),
    );
    let response = app.clone().oneshot(preflight).await.unwrap();
    assert!(response.status().is_success());
    assert_eq!(response.headers()["access-control-allow-origin"], WALLET);

    let mut elsewhere = from("203.0.113.7", Method::GET, "/api/v1/tip");
    elsewhere
        .headers_mut()
        .insert(header::ORIGIN, "https://example.com".parse().unwrap());
    let response = app.oneshot(elsewhere).await.unwrap();
    assert!(
        !response
            .headers()
            .contains_key("access-control-allow-origin")
    );
}

#[tokio::test]
async fn a_client_over_its_bucket_waits_and_the_wallet_can_read_why() {
    let app = app(None);
    // 75 live queries empty a bucket; none runs, with no source up.
    for _ in 0..75 {
        let response = app
            .clone()
            .oneshot(from("203.0.113.7", Method::POST, "/api/v1/account_info"))
            .await
            .unwrap();
        assert_ne!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    }
    let response = app
        .clone()
        .oneshot(from("203.0.113.7", Method::POST, "/api/v1/account_info"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(response.headers()[header::RETRY_AFTER], "1");
    assert_eq!(response.headers()["access-control-allow-origin"], WALLET);
    assert_eq!(
        response.headers()["access-control-expose-headers"],
        "retry-after"
    );
    assert_eq!(body(response).await["error"], "slow down");

    // Another client behind the same Caddy has its own bucket.
    let response = app
        .oneshot(from("203.0.113.8", Method::POST, "/api/v1/account_info"))
        .await
        .unwrap();
    assert_ne!(response.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn past_the_months_ceiling_only_health_answers() {
    let app = app(Some(1));
    // The first answer's bytes pass the ceiling of one.
    let response = app
        .clone()
        .oneshot(from("203.0.113.7", Method::GET, "/api/v1/tip"))
        .await
        .unwrap();
    to_bytes(response.into_body(), 1 << 20).await.unwrap();

    let response = app
        .clone()
        .oneshot(from("203.0.113.7", Method::GET, "/api/v1/tip"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body(response).await["error"], "over this month's traffic");

    let response = app
        .oneshot(from("203.0.113.7", Method::GET, "/health"))
        .await
        .unwrap();
    assert_eq!(body(response).await["egress"], "over");
}
