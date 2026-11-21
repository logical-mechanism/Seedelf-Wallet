//! The relay through the whole app, offline (web wallet chunk 54's 54c):
//! posts with real envelopes and real proof of work, pages read back, every
//! refusal, its own buckets and allowance at the edge, and a restart that
//! keeps the pools. No source is up, and none is needed: the relay reads no
//! chain.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::ConnectInfo;
use axum::http::{Method, Request, StatusCode, header};
use axum::response::Response;
use seedelf_data_api::chain::Chain;
use seedelf_data_api::edge::{Edge, Egress, Part};
use seedelf_data_api::messaging::Relay;
use seedelf_data_api::messaging::check::{stamp_bits, stamp_digest};
use seedelf_data_api::state::AppState;
use seedelf_data_api::submit::Submit;
use serde_json::Value;
use tower::ServiceExt;

const WALLET: &str = "chrome-extension://jfekiogplaamnceifeehipmomhojngcb";
const ENVELOPES: &str = "/messaging/v1/preprod/envelopes";

struct Relayed {
    app: Router,
    edge: Arc<Edge>,
    relay: Arc<Relay>,
}

fn relayed(relay: Relay) -> Relayed {
    let state = Arc::new(AppState::new(
        Chain::connect("postgresql://nobody@127.0.0.1:1/nothing").unwrap(),
    ));
    let submit = Arc::new(Submit::new(None, None).unwrap());
    let edge = Arc::new(
        Edge::new(true, vec![WALLET.to_string()], Egress::new(None, None))
            .with_messaging_egress(Egress::new(Some(1_000_000), None)),
    );
    let relay = Arc::new(relay);
    let app = seedelf_data_api::app(
        state,
        submit,
        edge.clone(),
        relay.clone(),
        &[WALLET.to_string()],
    );
    Relayed { app, edge, relay }
}

/// The relay's vectors: real envelopes of each size, from seedelf-messaging.
fn vectors() -> Value {
    serde_json::from_str(include_str!(
        "../../../seedelf-platform/seedelf-messaging/tests/vectors/messaging_relay_v1.json"
    ))
    .unwrap()
}

fn hex(hex: &str) -> Vec<u8> {
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
        .collect()
}

/// The vectors' envelope by name.
fn envelope(name: &str) -> Vec<u8> {
    let v = vectors();
    let post = v["posts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == name)
        .unwrap()
        .clone();
    hex(post["envelope"].as_str().unwrap())
}

/// A valid 512-byte envelope of its own: the vectors' with its ciphertext
/// changed, which the relay doesn't read.
fn short(i: u32) -> Vec<u8> {
    let mut bytes = envelope("512 bytes");
    bytes[200..204].copy_from_slice(&i.to_be_bytes());
    bytes
}

/// A post with at least `bits` of work.
fn post_body(envelope: &[u8], bits: u32) -> Vec<u8> {
    let digest = stamp_digest("preprod", envelope);
    let nonce = (0u64..).find(|&n| stamp_bits(&digest, n) >= bits).unwrap();
    [&nonce.to_be_bytes()[..], envelope].concat()
}

/// A post with too little work for any price: a nonce that shows none.
fn unpaid(envelope: &[u8]) -> Vec<u8> {
    let digest = stamp_digest("preprod", envelope);
    let nonce = (0u64..).find(|&n| stamp_bits(&digest, n) == 0).unwrap();
    [&nonce.to_be_bytes()[..], envelope].concat()
}

/// A request as Caddy passes it on, from the wallet, from `client`.
fn request(client: &str, method: Method, path: &str, body: Vec<u8>) -> Request<Body> {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("x-forwarded-for", client)
        .header(header::ORIGIN, WALLET)
        .header("sec-fetch-mode", "cors")
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(Body::from(body))
        .unwrap();
    request.extensions_mut().insert(ConnectInfo(
        "127.0.0.1:50000".parse::<SocketAddr>().unwrap(),
    ));
    request
}

async fn send(app: &Router, request: Request<Body>) -> Response {
    app.clone().oneshot(request).await.unwrap()
}

async fn post(app: &Router, client: &str, body: Vec<u8>) -> (StatusCode, Value) {
    let response = send(app, request(client, Method::POST, ENVELOPES, body)).await;
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

struct Page {
    flags: u8,
    cursor: u64,
    prices: [u8; 4],
    envelopes: Vec<Vec<u8>>,
}

/// A page, parsed from its format (src/messaging/mod.rs, `encode`).
async fn page(app: &Router, client: &str, after: Option<u64>) -> Page {
    let path = match after {
        Some(after) => format!("{ENVELOPES}?after={after}"),
        None => ENVELOPES.to_string(),
    };
    let response = send(app, request(client, Method::GET, &path, vec![])).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "application/octet-stream"
    );
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    assert_eq!(bytes[0], 1);
    let count = u16::from_be_bytes([bytes[14], bytes[15]]) as usize;
    let mut at = 16;
    let mut envelopes = vec![];
    for _ in 0..count {
        let len = u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
        envelopes.push(bytes[at + 4..at + 4 + len].to_vec());
        at += 4 + len;
    }
    assert_eq!(at, bytes.len());
    Page {
        flags: bytes[1],
        cursor: u64::from_be_bytes(bytes[2..10].try_into().unwrap()),
        prices: bytes[10..14].try_into().unwrap(),
        envelopes,
    }
}

#[tokio::test]
async fn a_post_is_kept_and_every_reader_gets_it() {
    let Relayed { app, .. } = relayed(Relay::new(None));
    // A reader starts: nothing yet, and what a post costs from its address.
    let start = page(&app, "203.0.113.9", None).await;
    assert!(start.envelopes.is_empty());
    assert_eq!(start.prices, [16, 16, 16, 18]);

    let sizes = ["512 bytes", "2,048 bytes", "8,192 bytes", "32,768 bytes"];
    for (name, price) in sizes.iter().zip(start.prices) {
        let (status, body) = post(
            &app,
            "203.0.113.7",
            post_body(&envelope(name), price.into()),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{name}: {body}");
        assert_eq!(body["kept"], "new");
        assert!(body["expires"].as_i64().unwrap() > 1_700_000_000);
    }

    let read = page(&app, "203.0.113.9", Some(start.cursor)).await;
    assert_eq!(read.flags, 0);
    let expected: Vec<Vec<u8>> = sizes.iter().map(|name| envelope(name)).collect();
    assert_eq!(read.envelopes, expected);
    // Caught up.
    let again = page(&app, "203.0.113.9", Some(read.cursor)).await;
    assert!(again.envelopes.is_empty());
    assert_eq!(again.cursor, read.cursor);
    // A reader with no cursor gets everything, told of no gap.
    let fresh = page(&app, "198.51.100.1", None).await;
    assert_eq!((fresh.flags, fresh.envelopes.len()), (0, 4));
}

#[tokio::test]
async fn too_little_work_is_told_the_price_and_the_same_bytes_are_kept_once() {
    let Relayed { app, .. } = relayed(Relay::new(None));
    let bytes = short(1);
    let (status, body) = post(&app, "203.0.113.7", unpaid(&bytes)).await;
    assert_eq!(status, StatusCode::PAYMENT_REQUIRED);
    assert_eq!(body["price"], 16);
    let (status, body) = post(&app, "203.0.113.7", post_body(&bytes, 16)).await;
    assert_eq!((status, &body["kept"]), (StatusCode::OK, &"new".into()));
    // The same bytes again: already held, whatever the stamp.
    let (status, again) = post(&app, "203.0.113.7", unpaid(&bytes)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(again["kept"], "already");
    assert_eq!(again["expires"], body["expires"]);
    assert_eq!(page(&app, "203.0.113.9", None).await.envelopes.len(), 1);
}

#[tokio::test]
async fn what_isnt_a_session_envelope_is_refused() {
    let Relayed { app, .. } = relayed(Relay::new(None));
    let v = vectors();
    for (i, case) in v["posts"].as_array().unwrap().iter().enumerate() {
        let bytes = hex(case["envelope"].as_str().unwrap());
        // Paid for, from an address of its own (each one's first post), so only the envelope can be
        // refused: 18 bits for the largest size, 16 for the rest.
        let bits = if bytes.len() == 32768 { 18 } else { 16 };
        let client = format!("203.0.113.{i}");
        let (status, body) = post(&app, &client, post_body(&bytes, bits)).await;
        match case["error"].as_str() {
            None => assert_eq!(status, StatusCode::OK, "{}", case["name"]),
            Some(_) => {
                assert_eq!(status, StatusCode::BAD_REQUEST, "{}", case["name"]);
                assert!(body["error"].is_string());
            }
        }
    }
    // A body shorter than a nonce.
    let (status, _) = post(&app, "203.0.113.7", vec![0; 7]).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // Only the four sizes are kept.
    assert_eq!(page(&app, "203.0.113.9", None).await.envelopes.len(), 4);
}

#[tokio::test]
async fn the_shape_is_refused_before_the_price_and_the_points_after_it() {
    let Relayed { app, .. } = relayed(Relay::new(None));
    let mut version = short(1);
    version[0] = 2;
    let (status, _) = post(&app, "203.0.113.7", unpaid(&version)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // A bad point costs a sender its work first: checking points costs the relay.
    let bad_point = envelope("p is outside G1");
    let (status, _) = post(&app, "203.0.113.7", unpaid(&bad_point)).await;
    assert_eq!(status, StatusCode::PAYMENT_REQUIRED);
}

#[tokio::test]
async fn a_body_past_the_largest_post_or_an_unknown_pool_is_refused() {
    let Relayed { app, .. } = relayed(Relay::new(None));
    let response = send(
        &app,
        request(
            "203.0.113.7",
            Method::POST,
            ENVELOPES,
            vec![0; 8 + 32768 + 1],
        ),
    )
    .await;
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    let response = send(
        &app,
        request(
            "203.0.113.7",
            Method::GET,
            "/messaging/v1/mainnet-or-so/envelopes",
            vec![],
        ),
    )
    .await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    for query in ["?after=", "?after=-1", "?since=1", "?after=1&x=2"] {
        let path = format!("{ENVELOPES}{query}");
        let response = send(&app, request("203.0.113.7", Method::GET, &path, vec![])).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{query}");
    }
}

#[tokio::test]
async fn the_wallet_reads_pages_uncompressed_and_with_cors() {
    let Relayed { app, .. } = relayed(Relay::new(None));
    for i in 0..4 {
        post(&app, "203.0.113.7", post_body(&short(i), 16)).await;
    }
    let mut asking = request("203.0.113.9", Method::GET, ENVELOPES, vec![]);
    asking
        .headers_mut()
        .insert(header::ACCEPT_ENCODING, "br, gzip".parse().unwrap());
    let response = send(&app, asking).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["access-control-allow-origin"], WALLET);
    assert!(!response.headers().contains_key(header::CONTENT_ENCODING));
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    // A page from elsewhere is refused, as every route's is.
    let mut elsewhere = request("203.0.113.9", Method::GET, ENVELOPES, vec![]);
    elsewhere
        .headers_mut()
        .insert(header::ORIGIN, "https://example.com".parse().unwrap());
    assert_eq!(send(&app, elsewhere).await.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn messaging_spends_its_own_allowance_and_buckets_never_the_rest() {
    let Relayed { app, edge, .. } = relayed(Relay::new(None));
    // Its bucket emptied: messaging waits, the wallet's other reads don't.
    let ip = "203.0.113.7".parse().unwrap();
    edge.take_in(Part::Messaging, ip, 1.0, std::time::Instant::now())
        .unwrap();
    edge.charge_in(Part::Messaging, ip, 16 << 20);
    let response = send(&app, request("203.0.113.7", Method::GET, ENVELOPES, vec![])).await;
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    let response = send(
        &app,
        request("203.0.113.7", Method::GET, "/api/v1/tip", vec![]),
    )
    .await;
    assert_ne!(response.status(), StatusCode::TOO_MANY_REQUESTS);

    // Its allowance spent: every messaging route is refused, nothing else is.
    edge.messaging_egress.add(1_000_000);
    let response = send(
        &app,
        request("198.51.100.1", Method::GET, ENVELOPES, vec![]),
    )
    .await;
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 1 << 20).await.unwrap()).unwrap();
    assert_eq!(body["error"], "messaging is over its traffic allowance");
    let (status, _) = post(&app, "198.51.100.1", post_body(&short(1), 16)).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    let response = send(
        &app,
        request("198.51.100.1", Method::GET, "/api/v1/tip", vec![]),
    )
    .await;
    let body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 1 << 20).await.unwrap()).unwrap();
    assert_ne!(body["error"], "over the traffic allowance");
    assert!(!edge.egress.over());
    // /health says so, and still answers.
    let response = send(
        &app,
        request("198.51.100.1", Method::GET, "/health", vec![]),
    )
    .await;
    let body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 1 << 20).await.unwrap()).unwrap();
    assert_eq!(body["messaging"]["egress"], "over");
}

#[tokio::test]
async fn the_pages_bytes_count_toward_messagings_allowance() {
    let Relayed { app, edge, .. } = relayed(Relay::new(None));
    post(
        &app,
        "203.0.113.7",
        post_body(&envelope("32,768 bytes"), 18),
    )
    .await;
    let before = edge.messaging_egress.used();
    page(&app, "203.0.113.9", None).await;
    let read = edge.messaging_egress.used() - before;
    // The page: its header, a length, and the envelope.
    assert_eq!(read, 16 + 4 + 32768);
    assert!(edge.egress.used() >= read);
}

#[tokio::test]
async fn a_restart_keeps_the_pools() {
    let dir = std::env::temp_dir().join(format!("seedelf-relay-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let cursor = {
        let Relayed { app, relay, .. } = relayed(Relay::new(Some(&dir)));
        let start = page(&app, "203.0.113.9", None).await;
        post(&app, "203.0.113.7", post_body(&short(1), 16)).await;
        let read = page(&app, "203.0.113.9", Some(start.cursor)).await;
        post(&app, "203.0.113.7", post_body(&short(2), 16)).await;
        relay.save(true);
        assert!(dir.join("messaging-preprod.clean").exists());
        read.cursor
    };
    let Relayed { app, relay, .. } = relayed(Relay::new(Some(&dir)));
    // The clean mark is read once, then gone.
    assert!(!dir.join("messaging-preprod.clean").exists());
    assert_eq!(relay.health()["preprod"]["envelopes"], 2);
    assert_eq!(relay.health()["mainnet"]["envelopes"], 0);
    let after = page(&app, "203.0.113.9", Some(cursor)).await;
    assert_eq!((after.flags, after.envelopes), (0, vec![short(2)]));
    // Held across the restart: a re-post is "already".
    let (_, body) = post(&app, "203.0.113.7", unpaid(&short(1))).await;
    assert_eq!(body["kept"], "already");
    std::fs::remove_dir_all(&dir).unwrap();
}
