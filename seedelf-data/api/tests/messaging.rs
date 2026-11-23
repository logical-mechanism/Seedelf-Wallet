//! The relay through the whole app, offline (web wallet chunk 54's 54c):
//! posts with real envelopes and real proof of work, pages read back, every
//! refusal, an address's window, its own buckets and allowance at the edge,
//! and a restart that keeps the pools. No source is up, and none is needed:
//! the relay reads no chain.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::ConnectInfo;
use axum::http::{Method, Request, StatusCode, header};
use axum::response::Response;
use seedelf_data_api::chain::Chain;
use seedelf_data_api::edge::{Edge, Egress, Part};
use seedelf_data_api::messaging::check::{stamp_bits, stamp_digest};
use seedelf_data_api::messaging::price::Prices;
use seedelf_data_api::messaging::reading::Reading;
use seedelf_data_api::messaging::window::Limits;
use seedelf_data_api::messaging::{Config, Relay};
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

/// The app with `relay`, and 1 MB of messaging's traffic for today.
fn relayed(relay: Relay) -> Relayed {
    relayed_with_share(relay, 1_000_000)
}

/// The app with `relay`, and `share` bytes of messaging's traffic for today:
/// the same on every day of the month, which a month's ceiling isn't (a
/// megabyte a month is 32 KB a day on the 1st, less than two of these
/// tests read).
fn relayed_with_share(relay: Relay, share: u64) -> Relayed {
    relayed_as(relay, share, false)
}

/// [`relayed_with_share`], with messaging `off` (`DATA_MESSAGING_OFF`) or on.
fn relayed_as(relay: Relay, share: u64, off: bool) -> Relayed {
    let state = Arc::new(AppState::new(
        Chain::connect("postgresql://nobody@127.0.0.1:1/nothing").unwrap(),
    ));
    let submit = Arc::new(Submit::new(None, None).unwrap());
    let edge = Arc::new(
        Edge::new(true, vec![WALLET.to_string()], Egress::new(None, None))
            .with_messaging_egress(Egress::with_share_today(share))
            .with_messaging_off(off),
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

/// A post with nonce 0, unsolved: what a wallet sends to learn a wait.
fn nonce_zero(envelope: &[u8]) -> Vec<u8> {
    [&0u64.to_be_bytes()[..], envelope].concat()
}

/// Preprod's pool with a window a test reaches: 3 envelopes or 70 units,
/// which a lone 32 KiB envelope (64) fits.
static SMALL_WINDOW: [Config; 1] = [Config {
    name: "preprod",
    cap: 8 << 20,
    prices: Prices {
        base: 16,
        per_bit: 32.0,
        quiet: 200.0,
        ceiling: 24,
        half_life: Duration::from_secs(600),
    },
    window: Limits {
        envelopes: 3,
        units: 70,
    },
}];

/// A price a test passes in a few posts: a bit more for every 0.8 of the
/// address's recent units, from a base of 1, to a ceiling of 3. A lone
/// short post costs 2 bits and the next 3; the third, and anything longer
/// than a short one, is past the ceiling.
const LOW_PRICES: Prices = Prices {
    base: 1,
    per_bit: 0.8,
    quiet: 1e12,
    ceiling: 3,
    half_life: Duration::from_secs(600),
};

/// Preprod's pool at `LOW_PRICES`, with its own window.
static LOW_CEILING: [Config; 1] = [Config {
    name: "preprod",
    cap: 8 << 20,
    prices: LOW_PRICES,
    window: Limits {
        envelopes: 1000,
        units: 4096,
    },
}];

/// The same with a window of two envelopes, which the third post passes
/// as it passes the ceiling.
static LOW_CEILING_TWO: [Config; 1] = [Config {
    name: "preprod",
    cap: 8 << 20,
    prices: LOW_PRICES,
    window: Limits {
        envelopes: 2,
        units: 4096,
    },
}];

/// Preprod's pool with room for two short envelopes, 1 bit a post, and a
/// window of three.
static TWO_SHORT: [Config; 1] = [Config {
    name: "preprod",
    cap: 1024,
    prices: Prices {
        base: 1,
        per_bit: 1000.0,
        quiet: 1e12,
        ceiling: 24,
        half_life: Duration::from_secs(600),
    },
    window: Limits {
        envelopes: 3,
        units: 4096,
    },
}];

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
    let (status, body, _) = post_waiting(app, client, body).await;
    (status, body)
}

/// A post's answer and its `Retry-After`, if it has one.
async fn post_waiting(
    app: &Router,
    client: &str,
    body: Vec<u8>,
) -> (StatusCode, Value, Option<u64>) {
    let response = send(app, request(client, Method::POST, ENVELOPES, body)).await;
    let status = response.status();
    let retry = response
        .headers()
        .get(header::RETRY_AFTER)
        .map(|value| value.to_str().unwrap().parse().unwrap());
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap(), retry)
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
    // What's kept is what the vectors keep, in order: the four sizes, and
    // the two whose tag is 32 bytes no check reads.
    let kept: Vec<Vec<u8>> = v["posts"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|case| case["error"].is_null())
        .map(|case| hex(case["envelope"].as_str().unwrap()))
        .collect();
    assert_eq!(kept.len(), 6);
    assert_eq!(page(&app, "198.51.100.1", None).await.envelopes, kept);
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

/// The relay's off switch (DESIGN-protocol v3 §3.8; round two's
/// versions-upgrade#1): with `DATA_MESSAGING_OFF` true, every route under
/// /messaging/ is a 410 Gone, which tells the wallet Messages is stopped,
/// with CORS so it can read it. A post is refused unread, so nothing is
/// kept. The rest of the API answers as ever, and /health says the relay is
/// off.
#[tokio::test]
async fn with_messaging_off_every_relay_route_is_gone_and_nothing_is_kept() {
    let Relayed { app, relay, .. } = relayed_as(Relay::new(None), 1_000_000, true);
    let routes = [
        (Method::GET, ENVELOPES.to_string(), vec![]),
        (Method::GET, format!("{ENVELOPES}?after=5"), vec![]),
        (
            Method::POST,
            ENVELOPES.to_string(),
            post_body(&short(1), 16),
        ),
        (
            Method::POST,
            "/messaging/v1/mainnet/envelopes".to_string(),
            nonce_zero(&short(2)),
        ),
        (
            Method::GET,
            "/messaging/v1/elsewhere/envelopes".to_string(),
            vec![],
        ),
        (
            Method::GET,
            "/messaging/v2/preprod/envelopes".to_string(),
            vec![],
        ),
    ];
    for (method, path, body) in routes {
        let response = send(&app, request("203.0.113.7", method, &path, body)).await;
        assert_eq!(response.status(), StatusCode::GONE, "{path}");
        assert_eq!(
            response.headers()["access-control-allow-origin"],
            WALLET,
            "{path}"
        );
        let bytes = to_bytes(response.into_body(), 1 << 10).await.unwrap();
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            body,
            serde_json::json!({ "error": "messaging is stopped" }),
            "{path}"
        );
    }
    assert_eq!(relay.health()["preprod"]["envelopes"], 0);
    assert_eq!(relay.health()["mainnet"]["envelopes"], 0);
    // The wallet's post is preceded by a preflight, which CORS answers
    // before the edge, so the post's 410 is read too.
    let preflight = Request::builder()
        .method(Method::OPTIONS)
        .uri(ENVELOPES)
        .header(header::ORIGIN, WALLET)
        .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
        .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "content-type")
        .body(Body::empty())
        .unwrap();
    let response = send(&app, preflight).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["access-control-allow-origin"], WALLET);
    // The rest of the API answers as ever.
    let response = send(
        &app,
        request("203.0.113.7", Method::GET, "/api/v1/tip", vec![]),
    )
    .await;
    assert_ne!(response.status(), StatusCode::GONE);
    // A web page's request is the edge's 403, as on every route.
    let mut elsewhere = request("203.0.113.9", Method::GET, ENVELOPES, vec![]);
    elsewhere
        .headers_mut()
        .insert(header::ORIGIN, "https://example.com".parse().unwrap());
    assert_eq!(send(&app, elsewhere).await.status(), StatusCode::FORBIDDEN);
    // /health says the relay is off.
    let response = send(&app, request("203.0.113.7", Method::GET, "/health", vec![])).await;
    let health: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 1 << 20).await.unwrap()).unwrap();
    assert_eq!(health["messaging"]["relay"], "off");
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

/// The gate review's relay-server#7: a pool is written only once it has
/// changed, so one that never kept an envelope had no file. A clean
/// restart then started it as new, numbering above every cursor it gave
/// out, and every reader was told of a gap ("the server dropped some").
/// A start without the clean mark still tells of one, since it can't know.
#[tokio::test]
async fn a_pool_that_never_kept_anything_tells_no_cursor_of_a_gap_after_a_clean_restart() {
    let dir = std::env::temp_dir().join(format!("seedelf-relay-never-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let reader = "203.0.113.9";
    let mut cursor = None;
    // Two clean restarts, each read from the cursor the last run gave.
    for run in 0..3 {
        let Relayed { app, relay, .. } = relayed(Relay::new(Some(&dir)));
        let page = page(&app, reader, cursor).await;
        assert_eq!((page.flags, page.envelopes.len()), (0, 0), "run {run}");
        cursor = Some(page.cursor);
        relay.save(true);
    }
    // Saved without the mark, as the minute's save is: then a crash.
    {
        let Relayed { relay, .. } = relayed(Relay::new(Some(&dir)));
        relay.save(false);
    }
    let Relayed { app, .. } = relayed(Relay::new(Some(&dir)));
    assert_eq!(page(&app, reader, cursor).await.flags, 2);
    // A reader who starts now is told of none.
    assert_eq!(page(&app, reader, None).await.flags, 0);
    std::fs::remove_dir_all(&dir).unwrap();
}

/// The relay review's medium (gate 54g): a start without the clean mark
/// numbers on far above the file's `next`, and that was kept in memory
/// alone, so nothing saved it. Two such starts before a save numbered from
/// the same place: a reader that had read the first one's envelope then
/// skipped the second one's, told of no gap. Each start's first minute, at
/// once (`messaging::keep`), saves where the numbering stands.
#[tokio::test]
async fn two_starts_after_a_crash_before_a_save_never_hand_out_a_number_twice() {
    let dir = std::env::temp_dir().join(format!("seedelf-relay-twice-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let reader = "203.0.113.9";
    // Saved with an envelope, as the minute's save is, then a crash.
    {
        let Relayed { app, relay, .. } = relayed(Relay::new(Some(&dir)));
        post(&app, "203.0.113.7", post_body(&short(1), 16)).await;
        relay.save(false);
    }
    // Started again: its first minute's save, an envelope the reader reads,
    // and a crash before the next save.
    let cursor = {
        let Relayed { app, relay, .. } = relayed(Relay::new(Some(&dir)));
        relay.save(false);
        let (status, _) = post(&app, "203.0.113.7", post_body(&short(2), 16)).await;
        assert_eq!(status, StatusCode::OK);
        let read = page(&app, reader, None).await;
        assert_eq!(read.envelopes, vec![short(1), short(2)]);
        read.cursor
    };
    // Started again from the same file: the reader gets what's kept now,
    // and is told the second envelope is gone.
    let Relayed { app, .. } = relayed(Relay::new(Some(&dir)));
    let (status, _) = post(&app, "203.0.113.7", post_body(&short(3), 16)).await;
    assert_eq!(status, StatusCode::OK);
    let after = page(&app, reader, Some(cursor)).await;
    assert_eq!((after.flags, after.envelopes), (2, vec![short(3)]));
    std::fs::remove_dir_all(&dir).unwrap();
}

/// The same review's low: after a start without the clean mark, a quiet
/// run (nothing kept) gave out cursors above the file's numbers and saved
/// nothing, so the clean restart after it told every reader holding one of
/// a gap that wasn't there.
#[tokio::test]
async fn a_clean_restart_after_a_quiet_run_since_a_crash_tells_no_reader_of_a_gap() {
    let dir = std::env::temp_dir().join(format!("seedelf-relay-quiet-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let reader = "203.0.113.9";
    {
        let Relayed { app, relay, .. } = relayed(Relay::new(Some(&dir)));
        post(&app, "203.0.113.7", post_body(&short(1), 16)).await;
        relay.save(false);
    }
    // Started again: nothing comes, a reader catches up, and the server
    // stops cleanly.
    let cursor = {
        let Relayed { app, relay, .. } = relayed(Relay::new(Some(&dir)));
        relay.save(false);
        let first = page(&app, reader, None).await;
        assert_eq!(first.envelopes, vec![short(1)]);
        let caught_up = page(&app, reader, Some(first.cursor)).await;
        assert!(caught_up.envelopes.is_empty());
        relay.save(true);
        caught_up.cursor
    };
    let Relayed { app, .. } = relayed(Relay::new(Some(&dir)));
    let after = page(&app, reader, Some(cursor)).await;
    assert_eq!((after.flags, after.envelopes.len()), (0, 0));
    // And what comes next is numbered above that cursor.
    let (status, _) = post(&app, "203.0.113.7", post_body(&short(2), 16)).await;
    assert_eq!(status, StatusCode::OK);
    let next = page(&app, reader, Some(after.cursor)).await;
    assert_eq!((next.flags, next.envelopes), (0, vec![short(2)]));
    std::fs::remove_dir_all(&dir).unwrap();
}

#[tokio::test]
async fn an_address_past_its_window_waits_for_its_oldest_to_age_out() {
    let Relayed { app, .. } = relayed(Relay::with_pools(None, &SMALL_WINDOW));
    let me = "203.0.113.7";
    for i in 0..3 {
        let (status, body) = post(&app, me, post_body(&short(i), 16)).await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }
    // The page says so before any work: every size reads 0.
    assert_eq!(page(&app, me, None).await.prices, [0; 4]);
    // A paid post is refused, told to wait until this hour's posts have
    // been 36 hours in the pool: past 36 hours, at most 37.
    let (status, body, retry) = post_waiting(&app, me, post_body(&short(3), 16)).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        body["error"],
        "this address's share of the pool is full for now"
    );
    let retry = retry.unwrap();
    assert!((36 * 3600 + 1..=37 * 3600).contains(&retry), "{retry}");
    // Nonce 0, unsolved, learns the same wait.
    let (status, _, zero) = post_waiting(&app, me, nonce_zero(&short(3))).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert!(zero.unwrap().abs_diff(retry) <= 1);
    // What it holds is still "already", whatever the stamp.
    let (status, body) = post(&app, me, nonce_zero(&short(0))).await;
    assert_eq!((status, &body["kept"]), (StatusCode::OK, &"already".into()));
    // Another address posts as before.
    let other = "198.51.100.1";
    assert_eq!(page(&app, other, None).await.prices, [16, 16, 16, 18]);
    let (status, _) = post(&app, other, post_body(&short(3), 16)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(page(&app, other, None).await.envelopes.len(), 4);
}

#[tokio::test]
async fn the_window_counts_units_and_the_page_says_which_sizes_wait() {
    let Relayed { app, .. } = relayed(Relay::with_pools(None, &SMALL_WINDOW));
    let me = "203.0.113.7";
    assert_eq!(page(&app, me, None).await.prices, [16, 16, 16, 18]);
    let (status, _) = post(&app, me, post_body(&envelope("32,768 bytes"), 18)).await;
    assert_eq!(status, StatusCode::OK);
    // 64 of its 70 units held: 512 bytes and 2 KiB fit, 8 and 32 KiB wait.
    assert_eq!(page(&app, me, None).await.prices, [18, 18, 0, 0]);
    let (status, _, retry) = post_waiting(&app, me, nonce_zero(&envelope("8,192 bytes"))).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert!(retry.unwrap() > 36 * 3600);
    let (status, _) = post(&app, me, post_body(&envelope("2,048 bytes"), 18)).await;
    assert_eq!(status, StatusCode::OK);
    // 68 units: only a short one fits now.
    assert_eq!(page(&app, me, None).await.prices, [18, 0, 0, 0]);
}

/// §17.2's row 4 and §17.4 through the app (the gate review's
/// relay-server#9 and tests-ci#7): past the price's ceiling a post is a 429
/// whose `Retry-After` is when the address's count will have decayed
/// enough, in 15 s steps and at most an hour, and a page says 0 for each
/// size past it.
#[tokio::test]
async fn past_the_prices_ceiling_a_post_waits_and_the_page_says_0() {
    let Relayed { app, .. } = relayed(Relay::with_pools(None, &LOW_CEILING));
    let me = "203.0.113.7";
    // A short post costs 2 bits; anything longer is past the ceiling now.
    assert_eq!(page(&app, me, None).await.prices, [2, 0, 0, 0]);
    // A longer one never fits, however long it waits: an hour, the most.
    let (status, body, retry) = post_waiting(&app, me, nonce_zero(&envelope("2,048 bytes"))).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(body["error"], "too many posts from this address for now");
    assert_eq!(retry, Some(3600));
    for i in 0..2 {
        let (status, body) = post(&app, me, post_body(&short(i), 3)).await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }
    // Two kept: the third short one is past the ceiling, until two units
    // have decayed under 1.4, about five minutes at a 10-minute half-life.
    assert_eq!(page(&app, me, None).await.prices, [0; 4]);
    let (status, body, retry) = post_waiting(&app, me, post_body(&short(2), 3)).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(body["error"], "too many posts from this address for now");
    let retry = retry.unwrap();
    assert_eq!(retry % 15, 0, "{retry}");
    assert!((300..=330).contains(&retry), "{retry}");
    // Nonce 0, unsolved, learns the same wait, a step at most apart.
    let (_, _, zero) = post_waiting(&app, me, nonce_zero(&short(2))).await;
    assert!(zero.unwrap().abs_diff(retry) <= 15, "{zero:?} {retry}");
    // Another address is priced as ever.
    assert_eq!(page(&app, "198.51.100.1", None).await.prices, [2, 0, 0, 0]);
}

/// §17.4: "When the price refuses too, the 429 waits for the later of the
/// two": the window's, past 36 hours, not the price's five minutes.
#[tokio::test]
async fn when_the_price_and_the_window_both_refuse_the_429_waits_for_the_later() {
    let Relayed { app, .. } = relayed(Relay::with_pools(None, &LOW_CEILING_TWO));
    let me = "203.0.113.7";
    for i in 0..2 {
        let (status, body) = post(&app, me, post_body(&short(i), 3)).await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }
    let (status, body, retry) = post_waiting(&app, me, post_body(&short(2), 3)).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(body["error"], "too many posts from this address for now");
    let retry = retry.unwrap();
    assert!((36 * 3600 + 1..=37 * 3600).contains(&retry), "{retry}");
}

/// §17.2's row 7 through the app: a full pool is a 503 whose `Retry-After`
/// is when its oldest expire, at most an hour, for every address; what's
/// held is still "already"; and a post refused for room isn't counted
/// against its address (§17.4, "Only kept posts are counted").
#[tokio::test]
async fn a_full_pool_is_a_503_until_its_oldest_expire() {
    let Relayed { app, relay, .. } = relayed(Relay::with_pools(None, &TWO_SHORT));
    let me = "203.0.113.7";
    for i in 0..2 {
        let (status, body) = post(&app, me, post_body(&short(i), 1)).await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }
    for (client, i) in [(me, 2), ("198.51.100.1", 3)] {
        let (status, body, retry) = post_waiting(&app, client, post_body(&short(i), 1)).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{client}");
        assert_eq!(body["error"], "the pool is full");
        // The oldest came now: 36 hours off, so ask again within the hour.
        assert_eq!(retry, Some(3600));
    }
    let (status, body) = post(&app, me, nonce_zero(&short(0))).await;
    assert_eq!((status, &body["kept"]), (StatusCode::OK, &"already".into()));
    // Two of the window's three are held, so a third of any size still fits.
    assert_eq!(page(&app, me, None).await.prices, [1; 4]);
    assert_eq!(relay.health()["preprod"]["bytes"], 1024);
}

/// §17.4, "Only kept posts are counted": a 402, a 400 for a bad point and
/// an "already" leave the address's price and its window as they were. The
/// window holds two, so after one kept post any of them counted in it would
/// fill it, and the page would say 0 for every size.
#[tokio::test]
async fn only_kept_posts_are_counted() {
    let Relayed { app, .. } = relayed(Relay::with_pools(None, &LOW_CEILING_TWO));
    let me = "203.0.113.7";
    let (status, _) = post(&app, me, post_body(&short(1), 2)).await;
    assert_eq!(status, StatusCode::OK);
    // One kept: a short post costs 3 bits now, the most, and fits the window.
    assert_eq!(page(&app, me, None).await.prices, [3, 0, 0, 0]);
    let (status, _) = post(&app, me, unpaid(&short(2))).await;
    assert_eq!(status, StatusCode::PAYMENT_REQUIRED);
    let (status, _) = post(&app, me, post_body(&envelope("c is outside G1"), 3)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, body) = post(&app, me, unpaid(&short(1))).await;
    assert_eq!((status, &body["kept"]), (StatusCode::OK, &"already".into()));
    // None of them counted: had one, a short post would be past the ceiling
    // or the window.
    assert_eq!(page(&app, me, None).await.prices, [3, 0, 0, 0]);
    let (status, _) = post(&app, me, post_body(&short(2), 3)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(page(&app, me, None).await.prices, [0; 4]);
}

/// The pool's name is in the stamp (§17.1, §17.3): work done for preprod's
/// pool is no work at mainnet's, and mainnet's takes its own as preprod's
/// does.
#[tokio::test]
async fn mainnets_pool_takes_its_own_stamps_and_not_preprods() {
    let Relayed { app, relay, .. } = relayed(Relay::new(None));
    let mainnet = "/messaging/v1/mainnet/envelopes";
    let bytes = short(1);
    // Solved for preprod at mainnet's base: no work at mainnet.
    let response = send(
        &app,
        request("203.0.113.7", Method::POST, mainnet, post_body(&bytes, 18)),
    )
    .await;
    assert_eq!(response.status(), StatusCode::PAYMENT_REQUIRED);
    let body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 1 << 20).await.unwrap()).unwrap();
    assert_eq!(body["price"], 18);
    // Solved for mainnet: kept there, and in mainnet's pool alone.
    let digest = stamp_digest("mainnet", &bytes);
    let nonce = (0u64..).find(|&n| stamp_bits(&digest, n) >= 18).unwrap();
    let solved = [&nonce.to_be_bytes()[..], &bytes].concat();
    let response = send(&app, request("203.0.113.7", Method::POST, mainnet, solved)).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 1 << 20).await.unwrap()).unwrap();
    assert_eq!(body["kept"], "new");
    assert_eq!(relay.health()["mainnet"]["envelopes"], 1);
    assert_eq!(relay.health()["preprod"]["envelopes"], 0);
}

#[tokio::test]
async fn an_ipv6_56_is_one_address() {
    let Relayed { app, .. } = relayed(Relay::with_pools(None, &SMALL_WINDOW));
    // Three /64s of one /56 fill one window.
    for (i, client) in [
        "2001:db8:0:100::1",
        "2001:db8:0:1a0::2",
        "2001:db8:0:1ff:ffff::3",
    ]
    .into_iter()
    .enumerate()
    {
        let (status, _) = post(&app, client, post_body(&short(i as u32), 16)).await;
        assert_eq!(status, StatusCode::OK, "{client}");
    }
    // A fourth is the same address.
    let fourth = "2001:db8:0:150::4";
    assert_eq!(page(&app, fourth, None).await.prices, [0; 4]);
    let (status, _, _) = post_waiting(&app, fourth, post_body(&short(3), 16)).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    // The next /56 is another.
    let (status, _) = post(&app, "2001:db8:0:200::1", post_body(&short(3), 16)).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn the_window_is_never_saved_and_a_restart_starts_it_empty() {
    let dir = std::env::temp_dir().join(format!("seedelf-relay-window-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let me = "203.0.113.7";
    {
        let Relayed { app, relay, .. } = relayed(Relay::with_pools(Some(&dir), &SMALL_WINDOW));
        for i in 0..3 {
            post(&app, me, post_body(&short(i), 16)).await;
        }
        assert_eq!(page(&app, me, None).await.prices, [0; 4]);
        relay.save(true);
    }
    // The file holds the envelopes and nothing more: its header, then each
    // one's number, time, length and bytes.
    let file = std::fs::read(dir.join("messaging-preprod.pool")).unwrap();
    assert_eq!(file.len(), 21 + 3 * (20 + 512));
    let Relayed { app, relay, .. } = relayed(Relay::with_pools(Some(&dir), &SMALL_WINDOW));
    assert_eq!(relay.health()["preprod"]["envelopes"], 3);
    // The window starts empty, as the prices do.
    assert_eq!(page(&app, me, None).await.prices, [16, 16, 16, 18]);
    let (status, _) = post(&app, me, post_body(&short(3), 16)).await;
    assert_eq!(status, StatusCode::OK);
    std::fs::remove_dir_all(&dir).unwrap();
}

/// A GET's status, its error's words (none for a page) and its
/// `Retry-After`.
async fn read(app: &Router, client: &str, after: Option<u64>) -> (StatusCode, Value, Option<u64>) {
    let path = match after {
        Some(after) => format!("{ENVELOPES}?after={after}"),
        None => ENVELOPES.to_string(),
    };
    let response = send(app, request(client, Method::GET, &path, vec![])).await;
    let status = response.status();
    let retry = response
        .headers()
        .get(header::RETRY_AFTER)
        .map(|value| value.to_str().unwrap().parse().unwrap());
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    let error = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, error, retry)
}

/// The gate review's relay-server#2: reading costs no work, so readers who
/// ask for long pages again and again could spend the day's share of
/// messaging's traffic, and every wallet's messages stopped with it. The
/// last tenth of the share is kept for short pages and posts.
#[tokio::test]
async fn a_day_spent_on_long_pages_stops_fresh_syncs_before_conversations() {
    let share = 2_000_000;
    let Relayed { app, edge, .. } = relayed_with_share(Relay::new(None), share);
    // A reader who is caught up, and holds its cursor.
    let reader = "203.0.113.9";
    let cursor = page(&app, reader, None).await.cursor;
    // One long envelope: a first page of 32,788 bytes, past 16 KiB.
    let (status, _) = post(
        &app,
        "203.0.113.7",
        post_body(&envelope("32,768 bytes"), 18),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let cursor = page(&app, reader, Some(cursor)).await.cursor;

    // Readers with no cursor ask for the first page until one is refused
    // for the traffic: each from an address of its own, until its bucket
    // makes it wait.
    let mut refused = None;
    'readers: for i in 1..=64 {
        let client = format!("198.51.100.{i}");
        loop {
            let (status, error, retry) = read(&app, &client, None).await;
            match status {
                StatusCode::OK => {}
                StatusCode::TOO_MANY_REQUESTS => continue 'readers,
                _ => {
                    refused = Some((status, error, retry));
                    break 'readers;
                }
            }
        }
    }
    let (refusal, error, retry) = refused.expect("the long pages are refused in the end");

    // The reader who is caught up still reads, and a post is still kept...
    let (status, why, _) = read(&app, reader, Some(cursor)).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "long pages spent the day for a reader who is caught up: {why}"
    );
    assert_eq!(refusal, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        error["error"],
        "messaging is near its traffic allowance: short pages only for now"
    );
    assert_eq!(retry, Some(3600));
    assert!(!edge.messaging_egress.over());
    let (status, body) = post(&app, reader, post_body(&short(1), 16)).await;
    assert_eq!((status, &body["kept"]), (StatusCode::OK, &"new".into()));
    // ...and reads the short message that came, a page of 532 bytes.
    let next = page(&app, reader, Some(cursor)).await;
    assert_eq!(next.envelopes, vec![short(1)]);
    // /health says the relay is down to its reserve, and still has a
    // ceiling of its own.
    let response = send(&app, request(reader, Method::GET, "/health", vec![])).await;
    let health: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 1 << 20).await.unwrap()).unwrap();
    assert_eq!(health["messaging"]["relay"], "on");
    assert_eq!(health["messaging"]["egress"], "ok");
    assert_eq!(health["messaging"]["ceiling"], true);
    assert_eq!(health["messaging"]["reserve"], true);
    assert!(health["messaging"]["day_left"].as_u64().unwrap() <= 10);

    // Once the share is gone, everything waits for tomorrow's.
    edge.messaging_egress.add(share);
    let (status, error, retry) = read(&app, reader, Some(next.cursor)).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(error["error"], "messaging is over its traffic allowance");
    assert_eq!(retry, Some(3600));
}

/// The other half of relay-server#2: what one address reads of a pool in a
/// day is bounded, whatever the day's share has left.
#[tokio::test]
async fn an_address_past_its_days_reading_waits_and_the_others_read_on() {
    // A day's reading of 40,000 bytes, which a second long page passes.
    let relay = Relay::with_pools(None, &SMALL_WINDOW).with_reading(Reading {
        floor: 40_000,
        pools: 0,
    });
    let Relayed { app, .. } = relayed(relay);
    let (status, _) = post(
        &app,
        "203.0.113.7",
        post_body(&envelope("32,768 bytes"), 18),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let me = "203.0.113.9";
    // 32,788 bytes, then 65,576: the page that passes the budget is sent.
    let first = page(&app, me, None).await;
    assert_eq!(first.envelopes.len(), 1);
    assert_eq!(page(&app, me, None).await.envelopes.len(), 1);
    // The third isn't, nor is an empty page from its cursor: a 429 that
    // says how long, until this hour's reading is a day old.
    for after in [None, Some(first.cursor)] {
        let (status, error, retry) = read(&app, me, after).await;
        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(
            error["error"],
            "this address has read its share of the pool for the day"
        );
        let retry = retry.unwrap();
        assert!((24 * 3600 + 1..=25 * 3600).contains(&retry), "{retry}");
    }
    // Its posts go on: reading is counted apart from posting.
    let (status, body) = post(&app, me, post_body(&short(1), 16)).await;
    assert_eq!((status, &body["kept"]), (StatusCode::OK, &"new".into()));
    // Another address reads, and the pool's size is still said to all.
    assert_eq!(page(&app, "198.51.100.1", None).await.envelopes.len(), 2);
    // The address is the relay's, as for posts: an IPv6 /56 is one reader.
    for client in ["2001:db8:0:100::1", "2001:db8:0:1a0::2"] {
        assert_eq!(read(&app, client, None).await.0, StatusCode::OK);
    }
    let (status, _, _) = read(&app, "2001:db8:0:1ff:ffff::3", None).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    let (status, _, _) = read(&app, "2001:db8:0:200::1", None).await;
    assert_eq!(status, StatusCode::OK);
}
