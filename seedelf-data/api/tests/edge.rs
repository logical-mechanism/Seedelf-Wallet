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
use seedelf_data_api::messaging::Relay;
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
    let edge = Arc::new(Edge::new(
        true,
        vec![WALLET.to_string()],
        Egress::new(ceiling, None),
    ));
    seedelf_data_api::app(
        state,
        submit,
        edge,
        Arc::new(Relay::new(None)),
        &[WALLET.to_string()],
    )
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
async fn a_web_pages_requests_are_refused() {
    let app = app(None);
    // An <img> or a no-cors fetch: the browser would download the answer
    // and hide it from the page, so any site's visitors could spend traffic.
    let mut image = from("203.0.113.7", Method::GET, "/api/v1/pool_list");
    image
        .headers_mut()
        .insert("sec-fetch-mode", "no-cors".parse().unwrap());
    let response = app.clone().oneshot(image).await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    let mut elsewhere = from("203.0.113.7", Method::GET, "/api/v1/tip");
    elsewhere
        .headers_mut()
        .insert(header::ORIGIN, "https://example.com".parse().unwrap());
    let response = app.clone().oneshot(elsewhere).await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    // The wallet's own fetch passes, and a browser tab can still read /health.
    let mut wallet = from("203.0.113.7", Method::GET, "/api/v1/tip");
    wallet
        .headers_mut()
        .insert("sec-fetch-mode", "cors".parse().unwrap());
    let response = app.clone().oneshot(wallet).await.unwrap();
    assert_ne!(response.status(), StatusCode::FORBIDDEN);
    let mut tab = from("203.0.113.7", Method::GET, "/health");
    tab.headers_mut()
        .insert("sec-fetch-mode", "navigate".parse().unwrap());
    let response = app.clone().oneshot(tab).await.unwrap();
    assert_ne!(response.status(), StatusCode::FORBIDDEN);

    // An evaluation that isn't JSON needs no preflight: refused before Ogmios.
    let mut plain = from("203.0.113.7", Method::POST, "/api/v1/ogmios");
    plain
        .headers_mut()
        .insert(header::CONTENT_TYPE, "text/plain".parse().unwrap());
    let response = app.oneshot(plain).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
}

#[tokio::test]
async fn no_answer_is_kept_in_a_browsers_cache_but_the_preflight_is() {
    // The wallet asks with `cache: "default"` so Chrome reuses the preflight
    // (web wallet 1.4.0); every answer, a refusal or a 429 too, says not to
    // keep it.
    let app = app(None);
    for path in [
        "/health",
        "/api/v1/tip",
        "/seedelf/v1/mainnet/names",
        "/nowhere",
    ] {
        let response = app
            .clone()
            .oneshot(from("203.0.113.9", Method::GET, path))
            .await
            .unwrap();
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "no-store",
            "{path}"
        );
    }
    let mut elsewhere = from("203.0.113.9", Method::GET, "/api/v1/tip");
    elsewhere
        .headers_mut()
        .insert(header::ORIGIN, "https://example.com".parse().unwrap());
    let response = app.clone().oneshot(elsewhere).await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    for _ in 0..75 {
        let _ = app
            .clone()
            .oneshot(from("203.0.113.10", Method::POST, "/api/v1/account_info"))
            .await
            .unwrap();
    }
    let response = app
        .clone()
        .oneshot(from("203.0.113.10", Method::POST, "/api/v1/account_info"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");

    // A preflight carries its own lifetime, for a submit's CBOR as for JSON.
    let mut preflight = from("203.0.113.9", Method::OPTIONS, "/api/v1/submittx");
    preflight
        .headers_mut()
        .insert("access-control-request-method", "POST".parse().unwrap());
    preflight.headers_mut().insert(
        "access-control-request-headers",
        "content-type".parse().unwrap(),
    );
    let response = app.oneshot(preflight).await.unwrap();
    assert!(response.status().is_success());
    assert_eq!(response.headers()["access-control-max-age"], "86400");
    assert!(!response.headers().contains_key(header::CACHE_CONTROL));
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
    assert_eq!(body(response).await["error"], "over the traffic allowance");

    let response = app
        .oneshot(from("203.0.113.7", Method::GET, "/health"))
        .await
        .unwrap();
    assert_eq!(body(response).await["egress"], "over");
}

/// The edge reads a request's body itself, within its deadline, and no
/// more than its route takes (the 1.10.0 gate's FI-4): past that, a 413
/// before the route sees it, in the edge's own words, with CORS and its
/// connection closed. One within it is the route's to judge, as before.
#[tokio::test]
async fn a_body_past_what_its_route_takes_is_refused_at_the_edge() {
    let app = app(None);
    let posted = |path: &str, bytes: usize| {
        let mut request = from("203.0.113.7", Method::POST, path);
        *request.body_mut() = Body::from(vec![b'{'; bytes]);
        request
    };
    for (path, most) in [
        ("/api/v1/ogmios", 64 * 1024),
        ("/api/v1/submittx", 16 * 1024),
        ("/api/v1/credential_utxos", 16 * 1024),
        ("/messaging/v1/mainnet/envelopes", 8 + 32_768),
        ("/messaging/v1/mainnet/certificates", 8 + 304),
        ("/messaging/v1/mainnet/withdrawals", 8 + 98),
    ] {
        let response = app.clone().oneshot(posted(path, most + 1)).await.unwrap();
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE, "{path}");
        assert_eq!(response.headers()["access-control-allow-origin"], WALLET);
        assert_eq!(response.headers()[header::CONNECTION], "close");
        assert_eq!(
            body(response).await["error"],
            "the body is larger than this route takes"
        );
        // At its most the route has it.
        let response = app.clone().oneshot(posted(path, most)).await.unwrap();
        assert_ne!(response.status(), StatusCode::PAYLOAD_TOO_LARGE, "{path}");
    }
}

/// The 1.10.0 gate's FI-4: a body on a route that takes none, by any
/// method, is refused unread with a 400, before its address is counted or
/// charged, so no request holds a body open at a GET's price.
#[tokio::test]
async fn a_body_on_a_route_that_takes_none_is_refused_unread() {
    let app = app(None);
    for (method, path) in [
        (Method::POST, "/health"),
        (Method::POST, "/api/v1/tip"),
        (Method::POST, "/seedelf/v1/mainnet/names"),
        (Method::POST, "/nowhere"),
        (Method::PUT, "/messaging/v1/mainnet/envelopes"),
        (Method::GET, "/messaging/v1/mainnet/envelopes"),
        (Method::PUT, "/messaging/v1/mainnet/certificates"),
        (Method::GET, "/messaging/v1/preprod/certificates"),
        (Method::GET, "/messaging/v1/preprod/withdrawals"),
        (Method::GET, "/api/v1/tip"),
        (Method::DELETE, "/api/v1/credential_utxos"),
    ] {
        let mut request = from("203.0.113.7", method.clone(), path);
        *request.body_mut() = Body::from(vec![b'{'; 10]);
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(
            response.status(),
            StatusCode::BAD_REQUEST,
            "{method} {path}"
        );
        assert_eq!(response.headers()["access-control-allow-origin"], WALLET);
        assert_eq!(response.headers()[header::CONNECTION], "close");
        assert_eq!(body(response).await["error"], "this route takes no body");
    }
    // The same without a body: each route's own answer.
    let response = app
        .clone()
        .oneshot(from("203.0.113.7", Method::POST, "/health"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
    let response = app
        .oneshot(from("203.0.113.7", Method::GET, "/health"))
        .await
        .unwrap();
    assert!(
        response
            .headers()
            .contains_key("access-control-allow-origin")
    );
}

/// Every route that takes a body answers a POST with one (FI-4's table
/// beside the routers: none is refused for having one).
#[tokio::test]
async fn every_route_that_takes_a_body_is_given_it() {
    let app = app(None);
    let mut paths: Vec<String> = seedelf_data_api::public::POSTS
        .iter()
        .map(|path| path.to_string())
        .collect();
    paths.extend(
        [
            "/api/v1/submittx",
            "/api/v1/ogmios",
            "/messaging/v1/mainnet/envelopes",
            "/messaging/v1/preprod/envelopes",
            "/messaging/v1/mainnet/certificates",
            "/messaging/v1/preprod/certificates",
            "/messaging/v1/mainnet/withdrawals",
            "/messaging/v1/preprod/withdrawals",
        ]
        .map(String::from),
    );
    for path in paths {
        let mut request = from("203.0.113.7", Method::POST, &path);
        request
            .headers_mut()
            .insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
        *request.body_mut() = Body::from(&b"{}"[..]);
        let response = app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        assert!(
            ![
                StatusCode::METHOD_NOT_ALLOWED,
                StatusCode::NOT_FOUND,
                StatusCode::PAYLOAD_TOO_LARGE
            ]
            .contains(&status),
            "{path}: {status}"
        );
        let words = to_bytes(response.into_body(), 1 << 20).await.unwrap();
        let words = String::from_utf8_lossy(&words);
        assert!(!words.contains("takes no body"), "{path}: {words}");
    }
}

/// The deploy script's sha256, as the runbook's block that installs it by hand
/// pins it (deploy/README.md, "The deploy script": its `want=` line, and the
/// `installed:` line it should print). That block fetches the script from `main`
/// and installs it only if it has this sha256. No Rust here reads a Markdown file
/// (data-layer.yml lets a pull request that changes only Markdown skip this suite),
/// so the value is written here as well: a change to the script fails this test
/// until both are updated.
const RUNBOOK_PINS: &str = "989a99c3754d9e15d921de54b68dd569e8c6c32a3655c3ab7420b36485209d0d";

/// The deploy script is the one the runbook's install block pins, it knows the
/// action the workflow asks for, and the key's comment says so.
#[test]
fn the_deploy_script_is_the_one_the_runbook_pins() {
    use sha2::{Digest, Sha256};
    let script = include_bytes!("../../deploy/edge/seedelf-data-deploy");
    let sum: String = Sha256::digest(script)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    assert_eq!(
        sum, RUNBOOK_PINS,
        "the deploy script changed: put its sha256 in RUNBOOK_PINS and in deploy/README.md's want= and installed: lines"
    );
    // The script knows the action the workflow asks for, and the key's comment says so.
    let script = std::str::from_utf8(script).unwrap();
    assert!(script.contains("messaging off|on preprod|mainnet"));
    let keys = include_str!("../../deploy/edge/deploy-authorized_keys");
    assert!(keys.contains("\"messaging off <pool>\"") && keys.contains("\"messaging on <pool>\""));
    let workflow = include_str!("../../../.github/workflows/data-layer-deploy.yml");
    let sends = workflow
        .lines()
        .find(|line| line.trim_start().starts_with("messaging-off-preprod |"))
        .expect("the case that sends the messaging actions");
    for action in [
        "messaging-off-preprod",
        "messaging-on-preprod",
        "messaging-off-mainnet",
        "messaging-on-mainnet",
    ] {
        assert!(
            workflow.contains(&format!("- {action}\n")),
            "{action} isn't a choice"
        );
        assert!(sends.contains(action), "{action} isn't sent");
    }
}
