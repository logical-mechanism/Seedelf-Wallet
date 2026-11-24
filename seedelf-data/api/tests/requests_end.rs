//! Requests end (the gate review of Seedelf Messaging, 54g): a request
//! whose body stops half way is answered and its connection closed, one
//! address holds only so many open at once, and a stop of the server waits
//! for what's under way only so long, then drops what's still open and
//! returns, so the pools are saved and marked clean.
//!
//! The server runs here as `main.rs` runs it, on a local port, with no
//! source and nothing read from the environment. The clients are plain
//! sockets, since no HTTP client stops half way. These tests wait out the
//! real deadlines: about 10 s each, side by side.

use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::Router;
use seedelf_data_api::chain::Chain;
use seedelf_data_api::edge::{Edge, Egress, IN_FLIGHT_MESSAGING, Part};
use seedelf_data_api::messaging::price::Prices;
use seedelf_data_api::messaging::window::Limits;
use seedelf_data_api::messaging::{Config, Relay};
use seedelf_data_api::state::AppState;
use seedelf_data_api::submit::Submit;
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;

/// Preprod's pool, with nothing to solve: the price isn't what's tested.
static POOL: [Config; 1] = [Config {
    name: "preprod",
    cap: 8 << 20,
    prices: Prices {
        base: 0,
        per_bit: f64::MAX,
        quiet: f64::MAX,
        ceiling: 24,
        half_life: Duration::from_secs(600),
    },
    window: Limits {
        envelopes: 1000,
        units: 4096,
    },
}];

/// The server as `main.rs` serves it.
async fn serve_as_main<F>(listener: TcpListener, app: Router, signal: F) -> std::io::Result<()>
where
    F: Future<Output = ()> + Send + 'static,
{
    seedelf_data_api::serve::serve(listener, app, signal).await
}

struct Server {
    port: u16,
    relay: Arc<Relay>,
    edge: Arc<Edge>,
    /// Sent to stop the server, as a SIGTERM does.
    stop: tokio::sync::oneshot::Sender<()>,
    served: JoinHandle<std::io::Result<()>>,
}

async fn server(dir: Option<&std::path::Path>) -> Server {
    let state = Arc::new(AppState::new(
        Chain::connect("postgresql://nobody@127.0.0.1:1/nothing").unwrap(),
    ));
    let submit = Arc::new(Submit::new(None, None).unwrap());
    let edge = Arc::new(Edge::new(true, vec![], Egress::new(None, None)));
    let relay = Arc::new(Relay::with_pools(dir, &POOL));
    let app = seedelf_data_api::app(state, submit, edge.clone(), relay.clone(), &[]);
    let listener = seedelf_data_api::serve::listen("127.0.0.1:0".parse().unwrap()).unwrap();
    let port = listener.local_addr().unwrap().port();
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let served = tokio::spawn(serve_as_main(listener, app, async move {
        let _ = stopped.await;
    }));
    Server {
        port,
        relay,
        edge,
        stop,
        served,
    }
}

/// A post of the vectors' 512-byte envelope with its ciphertext changed:
/// 520 bytes, any nonce.
fn post(i: u32) -> Vec<u8> {
    let v: Value = serde_json::from_str(include_str!(
        "../../../seedelf-platform/seedelf-messaging/tests/vectors/messaging_relay_v1.json"
    ))
    .unwrap();
    assert_eq!(v["posts"][0]["name"], "512 bytes");
    let hex = v["posts"][0]["envelope"].as_str().unwrap();
    let mut body = vec![0u8; 8];
    body.extend(
        (0..hex.len())
            .step_by(2)
            .map(|k| u8::from_str_radix(&hex[k..k + 2], 16).unwrap()),
    );
    body[8 + 200..8 + 204].copy_from_slice(&i.to_be_bytes());
    body
}

/// A post's head as Caddy sends it, for a body of 520 bytes from `client`.
fn head(client: &str) -> String {
    format!(
        "POST /messaging/v1/preprod/envelopes HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Forwarded-For: {client}\r\nContent-Type: application/octet-stream\r\nContent-Length: 520\r\n\r\n"
    )
}

async fn connect(port: u16) -> TcpStream {
    let stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    stream.set_nodelay(true).unwrap();
    stream
}

/// What comes back on `stream` until the server closes it, or `within`
/// passes: the bytes, and whether the server closed.
async fn until_closed(stream: &mut TcpStream, within: Duration) -> (String, bool) {
    let mut got = Vec::new();
    let mut chunk = [0u8; 2048];
    let end = tokio::time::Instant::now() + within;
    loop {
        match tokio::time::timeout_at(end, stream.read(&mut chunk)).await {
            // Closed, cleanly or not.
            Ok(Ok(0)) | Ok(Err(_)) => return (String::from_utf8_lossy(&got).into_owned(), true),
            Ok(Ok(n)) => got.extend_from_slice(&chunk[..n]),
            Err(_) => return (String::from_utf8_lossy(&got).into_owned(), false),
        }
    }
}

/// One whole answer on a connection that stays open: its head and body,
/// which has a length or comes in chunks.
async fn answer(stream: &mut TcpStream) -> String {
    let mut got = Vec::new();
    let mut chunk = [0u8; 2048];
    loop {
        let n = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut chunk))
            .await
            .expect("an answer within 5 s")
            .unwrap();
        assert!(n > 0, "the server closed the connection");
        got.extend_from_slice(&chunk[..n]);
        let text = String::from_utf8_lossy(&got);
        let Some(at) = text.find("\r\n\r\n") else {
            continue;
        };
        let head = text[..at].to_ascii_lowercase();
        let length = head
            .lines()
            .find_map(|line| line.strip_prefix("content-length:"))
            .map(|length| length.trim().parse::<usize>().unwrap());
        let whole = match length {
            Some(length) => got.len() >= at + 4 + length,
            None => {
                assert!(head.contains("transfer-encoding: chunked"), "{head}");
                text.ends_with("0\r\n\r\n")
            }
        };
        if whole {
            return text.into_owned();
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_post_whose_body_stalls_is_answered_408_and_its_connection_closed() {
    let server = server(None).await;
    let body = post(1);
    let mut stalled = connect(server.port).await;
    stalled
        .write_all(head("203.0.113.7").as_bytes())
        .await
        .unwrap();
    stalled.write_all(&body[..100]).await.unwrap();
    stalled.flush().await.unwrap();
    let sent = Instant::now();

    let (answer, closed) = until_closed(&mut stalled, Duration::from_secs(15)).await;
    let took = sent.elapsed();
    assert!(
        closed,
        "15 s on, a post whose body stopped at 100 of 520 bytes is still open, waiting: {answer:?}"
    );
    assert!(answer.starts_with("HTTP/1.1 408 "), "{answer}");
    assert!(
        answer.contains("the request's body didn't arrive in time"),
        "{answer}"
    );
    // Not before its 10 s, either: a slow sender has that long.
    assert!(took >= Duration::from_millis(9_500), "{took:?}");
    // Nothing of it was kept, and nothing is left in flight.
    assert_eq!(server.relay.health()["preprod"]["envelopes"], 0);
    // The rest of the body has nowhere to go.
    let _ = stalled.write_all(&body[100..]).await;
    let mut more = [0u8; 16];
    assert!(matches!(stalled.read(&mut more).await, Ok(0) | Err(_)));

    // A whole post from the same address is kept as ever.
    let mut whole = connect(server.port).await;
    whole
        .write_all(head("203.0.113.7").as_bytes())
        .await
        .unwrap();
    whole.write_all(&body).await.unwrap();
    let kept = self::answer(&mut whole).await;
    assert!(
        kept.starts_with("HTTP/1.1 200 ") && kept.contains("\"new\""),
        "{kept}"
    );
    let _ = (server.stop, server.edge);
    server.served.abort();
}

/// Whether `what` holds within `within`, looking every 20 ms.
async fn eventually(what: impl Fn() -> bool, within: Duration) -> bool {
    let end = tokio::time::Instant::now() + within;
    while tokio::time::Instant::now() < end {
        if what() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    what()
}

/// The gate review's relay-server#3, its first case: one address opens
/// posts and stalls each one's body. Each ends at its body's deadline, and
/// until then the address holds at most [`IN_FLIGHT_MESSAGING`] open, keyed as its
/// bucket is: the next is a 429 at once, which costs its bucket nothing,
/// while another address posts as ever.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_address_holds_only_so_many_requests_open_and_the_next_is_429() {
    let server = server(None).await;
    let body = post(1);
    let mut stalled = Vec::new();
    for _ in 0..IN_FLIGHT_MESSAGING {
        let mut stream = connect(server.port).await;
        stream
            .write_all(head("203.0.113.7").as_bytes())
            .await
            .unwrap();
        stream.write_all(&body[..100]).await.unwrap();
        stalled.push(stream);
    }
    let edge = server.edge.clone();
    assert!(
        eventually(
            || edge.in_flight(Part::Messaging) == IN_FLIGHT_MESSAGING,
            Duration::from_secs(5)
        )
        .await,
        "{} of {IN_FLIGHT_MESSAGING} stalled posts in flight",
        edge.in_flight(Part::Messaging)
    );
    // One more from the address, whole, is refused at once.
    let mut more = connect(server.port).await;
    more.write_all(head("203.0.113.7").as_bytes())
        .await
        .unwrap();
    more.write_all(&body).await.unwrap();
    let refused = answer(&mut more).await;
    assert!(refused.starts_with("HTTP/1.1 429 "), "{refused}");
    assert!(refused.contains("too many requests at once"), "{refused}");
    assert!(
        refused.to_ascii_lowercase().contains("retry-after: 1\r\n"),
        "{refused}"
    );
    // Another address posts as ever.
    let mut other = connect(server.port).await;
    other
        .write_all(head("203.0.113.8").as_bytes())
        .await
        .unwrap();
    other.write_all(&post(2)).await.unwrap();
    let kept = answer(&mut other).await;
    assert!(
        kept.starts_with("HTTP/1.1 200 ") && kept.contains("\"new\""),
        "{kept}"
    );
    // The stalled ones end at their deadline, and their places with them.
    for stream in &mut stalled {
        let (answer, closed) = until_closed(stream, Duration::from_secs(15)).await;
        assert!(closed && answer.starts_with("HTTP/1.1 408 "), "{answer}");
    }
    // The other address's kept post is in flight until its connection asks
    // again or closes: an answer is counted until it's read (the 1.10.0
    // gate's FI-2).
    assert!(
        eventually(
            || edge.in_flight(Part::Messaging) == 1,
            Duration::from_secs(2)
        )
        .await
    );
    drop(other);
    assert!(
        eventually(
            || edge.in_flight(Part::Messaging) == 0,
            Duration::from_secs(2)
        )
        .await
    );
    // Then the address posts again.
    let mut again = connect(server.port).await;
    again
        .write_all(head("203.0.113.7").as_bytes())
        .await
        .unwrap();
    again.write_all(&post(3)).await.unwrap();
    let kept = answer(&mut again).await;
    assert!(
        kept.starts_with("HTTP/1.1 200 ") && kept.contains("\"new\""),
        "{kept}"
    );
    let _ = server.stop;
    server.served.abort();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_stop_waits_ten_seconds_then_drops_what_is_open_and_the_pools_are_saved_clean() {
    let dir = std::env::temp_dir().join(format!("seedelf-relay-stop-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let server = server(Some(&dir)).await;
    let port = server.port;

    // A connection kept alive and idle, after one post.
    let mut idle = connect(port).await;
    idle.write_all(head("203.0.113.1").as_bytes())
        .await
        .unwrap();
    idle.write_all(&post(1)).await.unwrap();
    assert!(answer(&mut idle).await.starts_with("HTTP/1.1 200 "));
    // A request whose head stops half way: nothing but the stop ends it.
    let mut half = connect(port).await;
    half.write_all(&head("203.0.113.2").as_bytes()[..60])
        .await
        .unwrap();
    half.flush().await.unwrap();
    // A post under way: its head and 100 bytes of its body are in.
    let mut under_way = connect(port).await;
    let body = post(3);
    under_way
        .write_all(head("203.0.113.3").as_bytes())
        .await
        .unwrap();
    under_way.write_all(&body[..100]).await.unwrap();
    under_way.flush().await.unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;

    // The signal.
    server.stop.send(()).unwrap();
    let signalled = Instant::now();
    let mut served = server.served;
    // The idle connection is closed at once, and no new one is taken.
    let (_, closed) = until_closed(&mut idle, Duration::from_secs(2)).await;
    assert!(closed, "the idle connection stays open after the signal");
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(TcpStream::connect(("127.0.0.1", port)).await.is_err());
    assert!(!served.is_finished());
    // The post under way is given its time: its body ends a second on, and
    // it's kept.
    tokio::time::sleep(Duration::from_secs(1)).await;
    under_way.write_all(&body[100..]).await.unwrap();
    let (kept, closed) = until_closed(&mut under_way, Duration::from_secs(5)).await;
    assert!(
        kept.starts_with("HTTP/1.1 200 ") && kept.contains("\"new\""),
        "{kept}"
    );
    assert!(closed);

    // The half request is still open; the server returns once the stop's
    // 10 s have passed, having dropped it.
    let result = tokio::time::timeout_at(
        tokio::time::Instant::from_std(signalled + Duration::from_secs(15)),
        &mut served,
    )
    .await;
    let took = signalled.elapsed();
    assert!(
        result.is_ok(),
        "15 s after the signal the server still waits on a request whose head stopped half way"
    );
    result.unwrap().unwrap().unwrap();
    assert!(took >= Duration::from_millis(9_500), "{took:?}");
    let (nothing, closed) = until_closed(&mut half, Duration::from_secs(2)).await;
    assert!(closed && nothing.is_empty(), "{nothing:?}");

    // Nothing more can come in, so the pools are saved and marked clean, as
    // main.rs does next: both posts are in the file.
    server.relay.save(true);
    assert!(dir.join("messaging-preprod.clean").exists());
    let file = std::fs::read(dir.join("messaging-preprod.pool")).unwrap();
    assert_eq!(file.len(), 21 + 2 * (20 + 512));
    let _ = server.edge;
    served.abort();
    std::fs::remove_dir_all(&dir).unwrap();
}
