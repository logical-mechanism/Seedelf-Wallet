//! The submit part: Koios's `/submittx` and `/ogmios` paths, in front of the
//! home cardano-submit-api and Ogmios. Koios fronts the same two services, so
//! an answer passes through untouched, status and body, and the error strings
//! the wallet classifies stay exactly what they are (checked byte for byte,
//! 2026-10-08). It depends on the node alone: db-sync can be down.
//!
//! It answers only while the node is synced. A node catching up after a
//! restart refuses a valid spend of anything newer than its tip as spent, and
//! Ogmios evaluates one as an unknown input, both answers the wallet would
//! take as the node's word. So while Ogmios's `/health` says the node is
//! behind, both paths answer 503 and the wallet goes to Koios at once.
//!
//! Nothing here is cached or logged: not a transaction, not its ID, not an error's URL.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use anyhow::{Context, anyhow, bail};

use axum::Router;
use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use tokio::sync::Semaphore;
use tracing::{info, warn};

use crate::kupo::kind;
use crate::state::{FAILED_READS, MAX_AGE_SECS, TIP_TIMEOUT, WATCH_EVERY, slot_age};

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
    /// What Ogmios last said of the node: none until it's first read.
    node: RwLock<Option<Node>>,
    /// Ogmios's `/health` failed [`FAILED_READS`] reads in a row: the node's
    /// sync is unknown, so the submit part answers 503.
    node_failing: AtomicBool,
}

/// What Ogmios's `/health` says of the node.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Node {
    /// The node's tip, or `None` at the chain's origin.
    pub slot: Option<i64>,
    /// Whether Ogmios reaches the node: not while it replays its ledger after a restart.
    pub connected: bool,
}

impl Node {
    /// Ogmios's `/health` answer, whatever its status: the body says what it found.
    pub fn from_health(body: &[u8]) -> anyhow::Result<Node> {
        let health: serde_json::Value =
            serde_json::from_slice(body).context("Ogmios's health isn't JSON")?;
        let connected = health
            .get("connectionStatus")
            .and_then(|status| status.as_str())
            .context("Ogmios's health has no connectionStatus")?
            == "connected";
        // `"origin"` before the node's first block, `{ slot, id, height }` after it.
        let slot = match health.get("lastKnownTip") {
            Some(serde_json::Value::String(origin)) if origin == "origin" => None,
            Some(tip) => Some(
                tip.get("slot")
                    .and_then(|slot| slot.as_i64())
                    .context("Ogmios's tip has no slot")?,
            ),
            None => bail!("Ogmios's health has no lastKnownTip"),
        };
        Ok(Node { slot, connected })
    }

    /// At the chain's tip: connected, with a tip at most [`MAX_AGE_SECS`] old,
    /// as db-sync's and Kupo's must be for the reads. Not `networkSynchronization`:
    /// it has 5 decimal places of the time since mainnet began, a step of about
    /// 48 minutes. Nor `lastTipUpdate`: it's when Ogmios last saw the tip move,
    /// which a node catching up does every moment, however far behind it is.
    pub fn synced(&self) -> bool {
        self.connected && self.slot.is_some_and(|slot| slot_age(slot) <= MAX_AGE_SECS)
    }
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
            node: RwLock::new(None),
            node_failing: AtomicBool::new(false),
        })
    }

    /// What Ogmios last said of the node.
    pub fn node(&self) -> Option<Node> {
        *self.node.read().expect("node lock")
    }

    /// Takes what Ogmios just said of the node.
    pub fn set_node(&self, node: Node) {
        self.node_failing.store(false, Ordering::Relaxed);
        *self.node.write().expect("node lock") = Some(node);
    }

    /// Whether the node can take a transaction now: Ogmios's `/health` reads,
    /// and says the node is at the chain's tip. Without an Ogmios it's unknown,
    /// and it can't.
    pub fn synced(&self) -> bool {
        !self.node_failing.load(Ordering::Relaxed) && self.node().is_some_and(|node| node.synced())
    }

    /// Reads Ogmios's `/health` once, and keeps what it says.
    pub async fn read_node(&self) -> anyhow::Result<Node> {
        let base = self.ogmios.as_deref().context("no Ogmios configured")?;
        // Errors by kind only: reqwest's own carry the URL, which names home.
        let answer = self
            .http
            .get(format!("{base}/health"))
            .send()
            .await
            .map_err(|error| anyhow!("Ogmios is unreachable ({})", kind(&error)))?;
        let body = answer
            .bytes()
            .await
            .map_err(|error| anyhow!("Ogmios's answer broke off ({})", kind(&error)))?;
        let node = Node::from_health(&body)?;
        self.set_node(node);
        Ok(node)
    }

    /// One of [`watch_node`]'s reads: `failed` counts the reads that failed in a row.
    async fn watch_once(&self, failed: &mut u32) {
        let read = tokio::time::timeout(TIP_TIMEOUT, self.read_node()).await;
        match read.unwrap_or_else(|_| Err(anyhow!("Ogmios timed out"))) {
            Ok(_) => {
                if *failed >= FAILED_READS {
                    info!("Ogmios's health reads again");
                }
                *failed = 0;
            }
            Err(error) => {
                *failed += 1;
                if *failed == FAILED_READS {
                    self.node_failing.store(true, Ordering::Relaxed);
                    warn!(%error, "Ogmios's health couldn't be read");
                }
            }
        }
    }
}

/// Reads Ogmios's `/health` every [`WATCH_EVERY`], as db-sync's and Kupo's
/// tips are read, while there's an Ogmios.
pub async fn watch_node(submit: Arc<Submit>) {
    if submit.ogmios.is_none() {
        return;
    }
    let mut every = tokio::time::interval(WATCH_EVERY);
    every.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut failed = 0;
    let mut synced = true;
    loop {
        every.tick().await;
        submit.watch_once(&mut failed).await;
        // Said as it changes: a node catching up is behind for minutes, and one line says so.
        if submit.synced() != synced {
            synced = !synced;
            if synced {
                info!("the node is synced: submits go to it again");
            } else {
                warn!("the node isn't synced: submits answer 503, for Koios");
            }
        }
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
    if submit.ogmios.is_none() {
        return refuse(StatusCode::SERVICE_UNAVAILABLE, "no Ogmios configured");
    }
    if !submit.synced() {
        return refuse(StatusCode::SERVICE_UNAVAILABLE, "behind");
    }
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
    if !submit.synced() {
        return refuse(StatusCode::SERVICE_UNAVAILABLE, "behind");
    }
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

/// The upstream's answer as it came, or 502/504 when there's none. A
/// connection that never opened is a 503: nothing reached home, so the wallet
/// sends the transaction through Koios at once, where a 502 or a 504 leaves it
/// maybe sent. An error is logged by kind only: reqwest's own message carries
/// the upstream's URL.
async fn pass_through(request: reqwest::RequestBuilder, upstream: &'static str) -> Response {
    let answer = match request.send().await {
        Ok(answer) => answer,
        Err(error) => {
            // A connect timeout is a timeout too: asked first, it's what it is.
            let (status, kind) = if error.is_connect() {
                (StatusCode::SERVICE_UNAVAILABLE, "unreachable")
            } else if error.is_timeout() {
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
    use std::sync::Mutex;
    use std::sync::atomic::AtomicUsize;
    use std::time::{SystemTime, UNIX_EPOCH};

    use axum::body::Body;
    use axum::http::Request;
    use axum::routing::get;
    use tower::ServiceExt;

    use super::*;
    use crate::constants::SHELLEY_OFFSET;

    /// Home's Ogmios's `/health`, 2026-10-10, its metrics cut.
    const HEALTH: &str = r#"{"startTime":"2026-10-09T03:04:56.432435169Z","lastKnownTip":{"slot":200105072,"id":"8ef10441546e60533336bfdbc0a1088faf85d914bd4d0b4879a551220fc7d505","height":14052026},"lastTipUpdate":"2026-10-10T22:29:23.733303543Z","networkSynchronization":1.00000,"currentEra":"conway","connectionStatus":"connected","currentEpoch":660,"slotInEpoch":348272,"version":"v6.14.0 (8d5799df)","network":"mainnet"}"#;

    fn now_slot() -> i64 {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        now - SHELLEY_OFFSET
    }

    fn health(slot: i64, status: &str) -> String {
        serde_json::json!({
            "lastKnownTip": { "slot": slot, "id": "00", "height": 1 },
            "networkSynchronization": 0.99,
            "connectionStatus": status,
        })
        .to_string()
    }

    fn synced() -> Node {
        Node {
            slot: Some(now_slot() - 5),
            connected: true,
        }
    }

    /// Home's submit-api and Ogmios on loopback: `/health` says what `health`
    /// holds, and every submit or evaluation that reaches it is counted.
    async fn home(health: Arc<Mutex<String>>, reached: Arc<AtomicUsize>) -> String {
        let counted = |answer: &'static str| {
            let reached = reached.clone();
            post(move || async move {
                reached.fetch_add(1, Ordering::SeqCst);
                (StatusCode::ACCEPTED, answer)
            })
        };
        let app = Router::new()
            .route(
                "/health",
                get(move || async move { health.lock().unwrap().clone() }),
            )
            .route("/api/submit/tx", counted("\"a txid\""))
            .route("/", counted(r#"{"jsonrpc":"2.0","result":[]}"#));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await });
        url
    }

    async fn both_paths(app: &Router) -> Vec<Response> {
        let mut answers = Vec::new();
        for (path, kind, body) in [
            ("/api/v1/submittx", "application/cbor", b"\x84".to_vec()),
            (
                "/api/v1/ogmios",
                "application/json",
                br#"{"jsonrpc":"2.0","method":"evaluateTransaction","params":{"transaction":{"cbor":"84"}}}"#.to_vec(),
            ),
        ] {
            let request = Request::post(path)
                .header(header::CONTENT_TYPE, kind)
                .body(Body::from(body))
                .unwrap();
            answers.push(app.clone().oneshot(request).await.unwrap());
        }
        answers
    }

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

    /// A home that refuses the connection: nothing reached the node, so the
    /// wallet goes to Koios at once (503), never "maybe sent" (502).
    #[tokio::test]
    async fn no_connection_to_home_is_a_503() {
        use axum::body::Body;
        use axum::http::Request;
        use tower::ServiceExt;

        let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", closed.local_addr().unwrap());
        drop(closed);
        let submit = Submit::new(Some(url.clone()), Some(url)).unwrap();
        submit.set_node(synced());
        let app = routes().with_state(Arc::new(submit));
        for (path, kind, body) in [
            ("/api/v1/submittx", "application/cbor", b"\x84".to_vec()),
            (
                "/api/v1/ogmios",
                "application/json",
                br#"{"jsonrpc":"2.0","method":"evaluateTransaction","params":{"transaction":{"cbor":"84"}}}"#.to_vec(),
            ),
        ] {
            let answer = app
                .clone()
                .oneshot(
                    Request::post(path)
                        .header(header::CONTENT_TYPE, kind)
                        .body(Body::from(body))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(answer.status(), StatusCode::SERVICE_UNAVAILABLE, "{path}");
            assert!(answer.headers().contains_key(header::RETRY_AFTER), "{path}");
            // The connection's 503, not the node gate's.
            let body = axum::body::to_bytes(answer.into_body(), 1024).await.unwrap();
            assert_eq!(&body[..], br#"{"error":"unreachable"}"#, "{path}");
        }
    }

    #[test]
    fn ogmios_health_says_where_the_node_is() {
        assert_eq!(
            Node::from_health(HEALTH.as_bytes()).unwrap(),
            Node {
                slot: Some(200_105_072),
                connected: true
            }
        );
        let replaying = br#"{"lastKnownTip":"origin","connectionStatus":"disconnected"}"#;
        assert_eq!(
            Node::from_health(replaying).unwrap(),
            Node {
                slot: None,
                connected: false
            }
        );
        for broken in [
            &b"not json"[..],
            br#"{}"#,
            br#"{"connectionStatus":"connected"}"#,
            br#"{"connectionStatus":"connected","lastKnownTip":{"id":"00"}}"#,
        ] {
            assert!(Node::from_health(broken).is_err());
        }
    }

    #[test]
    fn synced_is_connected_with_a_fresh_tip() {
        assert!(synced().synced());
        let node = |slot, connected| Node { slot, connected };
        // Catching up after a restart: connected, its tip 181 s old.
        assert!(!node(Some(now_slot() - MAX_AGE_SECS - 1), true).synced());
        // Replaying its ledger: Ogmios can't reach it.
        assert!(!node(Some(now_slot() - 5), false).synced());
        assert!(!node(None, true).synced());
        // What Ogmios said on 2026-10-10 is long behind now.
        assert!(!Node::from_health(HEALTH.as_bytes()).unwrap().synced());
    }

    /// The node catching up: neither path reaches home, and the wallet goes
    /// to Koios at once (503). Synced, both pass through.
    #[tokio::test]
    async fn a_node_that_isnt_synced_sends_the_wallet_to_koios() {
        let reached = Arc::new(AtomicUsize::new(0));
        let url = home(Arc::new(Mutex::new(String::new())), reached.clone()).await;
        let submit = Arc::new(Submit::new(Some(url.clone()), Some(url)).unwrap());
        let app = routes().with_state(submit.clone());
        let behind = Node {
            slot: Some(now_slot() - 600),
            connected: true,
        };
        let replaying = Node {
            slot: Some(now_slot() - 5),
            connected: false,
        };
        // Before Ogmios is first read, then behind, then replaying its ledger.
        for node in [None, Some(behind), Some(replaying)] {
            if let Some(node) = node {
                submit.set_node(node);
            }
            for answer in both_paths(&app).await {
                assert_eq!(answer.status(), StatusCode::SERVICE_UNAVAILABLE, "{node:?}");
                assert!(answer.headers().contains_key(header::RETRY_AFTER));
                let body = axum::body::to_bytes(answer.into_body(), 1024)
                    .await
                    .unwrap();
                assert_eq!(&body[..], br#"{"error":"behind"}"#);
            }
        }
        assert_eq!(reached.load(Ordering::SeqCst), 0);

        submit.set_node(synced());
        for answer in both_paths(&app).await {
            assert_eq!(answer.status(), StatusCode::ACCEPTED);
        }
        assert_eq!(reached.load(Ordering::SeqCst), 2);
    }

    /// Ogmios's `/health` is what says so, and one that stops reading closes
    /// the gate after [`FAILED_READS`] reads, whatever it said last.
    #[tokio::test]
    async fn the_node_is_read_from_ogmios() {
        let said = Arc::new(Mutex::new(health(now_slot() - 5, "connected")));
        let url = home(said.clone(), Arc::new(AtomicUsize::new(0))).await;
        let submit = Submit::new(None, Some(url)).unwrap();
        let mut failed = 0;
        submit.watch_once(&mut failed).await;
        assert!(submit.synced());

        *said.lock().unwrap() = health(now_slot() - 600, "connected");
        submit.watch_once(&mut failed).await;
        assert!(!submit.synced());

        *said.lock().unwrap() = health(now_slot() - 5, "connected");
        submit.watch_once(&mut failed).await;
        assert!(submit.synced());
        *said.lock().unwrap() = "Bad Gateway".into();
        submit.watch_once(&mut failed).await;
        assert!(submit.synced(), "one failed read is a blip");
        submit.watch_once(&mut failed).await;
        assert!(!submit.synced());
        assert_eq!(failed, FAILED_READS);

        *said.lock().unwrap() = health(now_slot() - 5, "connected");
        submit.watch_once(&mut failed).await;
        assert!(submit.synced());
        assert_eq!(failed, 0);
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
