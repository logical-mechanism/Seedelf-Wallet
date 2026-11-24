//! The edge and the listener over real sockets (the 1.10.0 gate's relay
//! round, FI-1 to FI-4 and FI-6, after the verification of an outside
//! review of the relay server): the kernel's deadline on what a connection
//! sends, an answer counted in flight until it's read, the totals over
//! every address and the cap on connections, bodies only where a route
//! takes one, and the answers compressed at once.
//!
//! The server runs as `main.rs` runs it (`serve::listen`, `serve::serve`,
//! `app`), on a local port, with no source and nothing read from the
//! environment; where a test needs a data answer of its own size, its route
//! goes through the same layers (`layered`). The pools are filled through
//! their saved file's format, so no post is needed. The clients are plain
//! sockets that name themselves in `X-Forwarded-For` from loopback, as
//! Caddy names a client. Debug build: no timing here is a claim about
//! production, only the deadlines.

use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::Router;
use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Request, header};
use axum::routing::get;
use http_body::Body as _;
use http_body_util::BodyExt;
use seedelf_data_api::chain::Chain;
use seedelf_data_api::edge::{Caps, Edge, Egress, Part};
use seedelf_data_api::messaging::price::Prices;
use seedelf_data_api::messaging::window::Limits;
use seedelf_data_api::messaging::{Config, Relay};
use seedelf_data_api::serve::{self, USER_TIMEOUT};
use seedelf_data_api::state::AppState;
use seedelf_data_api::submit::Submit;
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpSocket, TcpStream};
use tower::ServiceExt;

const WALLET: &str = "chrome-extension://jfekiogplaamnceifeehipmomhojngcb";

/// A full page of the long pool: eight 32 KiB envelopes and their framing.
const PAGE: u64 = 16 + 8 * (4 + 32_768);

/// A full page of the short pool: 512 short envelopes, the largest a page is.
const SHORT_PAGE: u64 = 16 + 512 * (4 + 512);

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

/// A pool's file in the snapshot's format (pool.rs, `Snapshot::encode`):
/// `count` envelopes of `size` bytes, kept now.
fn write_pool(dir: &Path, name: &str, size: usize, count: u32) {
    let first = 1_000_000u64;
    let mut out = vec![1u8];
    out.extend_from_slice(&(first + u64::from(count)).to_be_bytes());
    out.extend_from_slice(&(first - 1).to_be_bytes());
    out.extend_from_slice(&count.to_be_bytes());
    for i in 0..count {
        out.extend_from_slice(&(first + u64::from(i)).to_be_bytes());
        out.extend_from_slice(&unix_now().to_be_bytes());
        out.extend_from_slice(&(size as u32).to_be_bytes());
        let mut envelope = vec![1u8; size];
        envelope[1..5].copy_from_slice(&i.to_be_bytes());
        out.extend_from_slice(&envelope);
    }
    std::fs::write(dir.join(format!("messaging-{name}.pool")), out).unwrap();
}

/// Preprod's pool with nothing to solve, for posts that test the edge.
static FREE: [Config; 1] = [Config {
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

/// What a test's server is.
#[derive(Clone, Copy)]
enum Pools {
    /// Both pools hold one full page of eight 32 KiB envelopes.
    Long,
    /// Mainnet's holds 512 short envelopes, a page of 264,208 bytes.
    Short,
    /// Only preprod, empty, and free to post to.
    Free,
}

struct Setup {
    pools: Pools,
    caps: Caps,
    user_timeout: Duration,
    connections: usize,
    /// Routes of the test's own, behind the app's layers, instead of the app.
    routes: Option<Router>,
}

impl Setup {
    fn new(pools: Pools) -> Self {
        Setup {
            pools,
            caps: Caps::DEFAULT,
            user_timeout: USER_TIMEOUT,
            connections: serve::CONNECTIONS,
            routes: None,
        }
    }
}

struct Server {
    addr: SocketAddr,
    edge: Arc<Edge>,
    dir: PathBuf,
    _stop: tokio::sync::oneshot::Sender<()>,
    served: tokio::task::JoinHandle<std::io::Result<()>>,
}

impl Server {
    fn port(&self) -> u16 {
        self.addr.port()
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.served.abort();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

async fn start(name: &str, setup: Setup) -> Server {
    let dir =
        std::env::temp_dir().join(format!("seedelf-connections-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let edge = Arc::new(
        Edge::new(true, vec![WALLET.to_string()], Egress::new(None, None))
            .with_messaging_egress(Egress::new(None, None))
            .with_caps(setup.caps),
    );
    let app = match setup.routes {
        Some(routes) => seedelf_data_api::layered(routes, edge.clone(), &[WALLET.to_string()]),
        None => {
            let relay = match setup.pools {
                Pools::Long => {
                    write_pool(&dir, "mainnet", 32_768, 8);
                    write_pool(&dir, "preprod", 32_768, 8);
                    Relay::new(Some(&dir))
                }
                Pools::Short => {
                    write_pool(&dir, "mainnet", 512, 512);
                    Relay::new(Some(&dir))
                }
                Pools::Free => Relay::with_pools(None, &FREE),
            };
            let state = Arc::new(AppState::new(
                Chain::connect("postgresql://nobody@127.0.0.1:1/nothing").unwrap(),
            ));
            let submit = Arc::new(Submit::new(None, None).unwrap());
            seedelf_data_api::app(
                state,
                submit,
                edge.clone(),
                Arc::new(relay),
                &[WALLET.to_string()],
            )
        }
    };
    let listener = serve::listen_with("127.0.0.1:0".parse().unwrap(), setup.user_timeout).unwrap();
    let addr = listener.local_addr().unwrap();
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let served = tokio::spawn(serve::serve_with(
        listener,
        app,
        async move {
            let _ = stopped.await;
        },
        setup.connections,
    ));
    Server {
        addr,
        edge,
        dir,
        _stop: stop,
        served,
    }
}

/// A client socket, its receive buffer `receive` if given (the kernel
/// doubles it and stops tuning it).
async fn connect(addr: SocketAddr, receive: Option<u32>) -> TcpStream {
    let socket = TcpSocket::new_v4().unwrap();
    if let Some(size) = receive {
        socket.set_recv_buffer_size(size).unwrap();
    }
    let stream = socket.connect(addr).await.unwrap();
    stream.set_nodelay(true).unwrap();
    stream
}

/// A GET as Caddy passes it on, from the wallet: the client in
/// X-Forwarded-For.
fn get_from(path: &str, client: &str) -> String {
    format!(
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Forwarded-For: {client}\r\nOrigin: {WALLET}\r\n\r\n"
    )
}

fn page_of(pool: &str, client: &str) -> String {
    get_from(&format!("/messaging/v1/{pool}/envelopes"), client)
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// The answer in `got` if it's all there: its head and its body, by its
/// Content-Length or its chunks.
fn parsed(got: &[u8]) -> Option<(String, Vec<u8>)> {
    let at = find(got, b"\r\n\r\n")?;
    let head = String::from_utf8_lossy(&got[..at]).into_owned();
    let lower = head.to_ascii_lowercase();
    let rest = &got[at + 4..];
    if let Some(length) = lower
        .lines()
        .find_map(|l| l.strip_prefix("content-length:"))
        .map(|v| v.trim().parse::<usize>().unwrap())
    {
        return (rest.len() >= length).then(|| (head, rest[..length].to_vec()));
    }
    assert!(lower.contains("transfer-encoding: chunked"), "{head}");
    let (mut body, mut from) = (Vec::new(), 0);
    loop {
        let line = find(&rest[from..], b"\r\n")?;
        let size_text = String::from_utf8_lossy(&rest[from..from + line]).into_owned();
        let size = usize::from_str_radix(size_text.split(';').next().unwrap().trim(), 16).unwrap();
        let data = from + line + 2;
        if rest.len() < data + size + 2 {
            return None;
        }
        if size == 0 {
            return Some((head, body));
        }
        body.extend_from_slice(&rest[data..data + size]);
        from = data + size + 2;
    }
}

/// The whole of an answer whose first bytes are `got`.
async fn whole(stream: &mut TcpStream, mut got: Vec<u8>) -> (String, Vec<u8>) {
    let mut chunk = vec![0u8; 64 * 1024];
    loop {
        if let Some(answer) = parsed(&got) {
            return answer;
        }
        let n = tokio::time::timeout(Duration::from_secs(20), stream.read(&mut chunk))
            .await
            .expect("more of the answer within 20 s")
            .unwrap();
        assert!(n > 0, "closed before the answer was whole");
        got.extend_from_slice(&chunk[..n]);
    }
}

/// An answer's status, Retry-After and JSON body, read whole.
async fn answer(stream: &mut TcpStream) -> (u16, Option<String>, Value, String) {
    let (head, body) = whole(stream, Vec::new()).await;
    let status = head[9..12].parse().unwrap();
    let retry = head.lines().find_map(|line| {
        let line = line.to_ascii_lowercase();
        line.strip_prefix("retry-after:")
            .map(|v| v.trim().to_string())
    });
    let json = serde_json::from_slice(&body).unwrap_or(Value::Null);
    (status, retry, json, head)
}

/// Reads at most `most` of what's arrived on `stream`, waiting up to 10 s
/// for the first of it.
async fn first_bytes(stream: &mut TcpStream, most: usize) -> Vec<u8> {
    let mut buf = vec![0u8; most];
    let n = tokio::time::timeout(Duration::from_secs(10), stream.read(&mut buf))
        .await
        .expect("an answer within 10 s")
        .unwrap();
    buf.truncate(n);
    buf
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

/// The server's established sockets on `port`, from /proc/net/tcp.
fn server_sockets(port: u16) -> usize {
    let text = std::fs::read_to_string("/proc/net/tcp").unwrap();
    text.lines()
        .skip(1)
        .filter(|line| {
            let f: Vec<&str> = line.split_whitespace().collect();
            f.len() > 3
                && f[3] == "01"
                && u16::from_str_radix(f[1].rsplit(':').next().unwrap(), 16).unwrap() == port
        })
        .count()
}

/// A stranger's address, one of many.
fn client(i: u32) -> String {
    format!("10.{}.{}.{}", (i >> 16) & 0xff, (i >> 8) & 0xff, i & 0xff)
}

/// The test's own data routes: `/test/plain/{bytes}`, JSON of that size
/// that gzip shrinks to almost nothing, and `/test/hex/{bytes}`, JSON of
/// hex that it only halves. Paths outside `/api/v1/` cost 1 unit each.
fn data_routes() -> Router {
    let hex: Arc<String> = Arc::new({
        let mut x: u64 = 0x9e37_79b9_7f4a_7c15;
        (0..8 << 20)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                char::from_digit((x & 15) as u32, 16).unwrap()
            })
            .collect()
    });
    let plain = |axum::extract::Path(bytes): axum::extract::Path<usize>| async move {
        axum::Json(serde_json::json!({ "rows": "ab".repeat(bytes / 2) }))
    };
    let hexed = move |axum::extract::Path(bytes): axum::extract::Path<usize>| {
        let hex = hex.clone();
        async move { axum::Json(serde_json::json!({ "rows": &hex[..bytes] })) }
    };
    Router::new()
        .route("/test/plain/{bytes}", get(plain))
        .route("/test/hex/{bytes}", get(hexed))
}

// ---------------------------------------------------------------- FI-1

/// Every connection the listener accepts has a small send buffer and the
/// kernel's deadline on what it sends, set once on the listener.
#[tokio::test]
async fn every_accepted_socket_has_a_small_send_buffer_and_the_kernels_deadline() {
    for (listener, deadline) in [
        (
            serve::listen("127.0.0.1:0".parse().unwrap()).unwrap(),
            USER_TIMEOUT,
        ),
        (
            serve::listen_with("127.0.0.1:0".parse().unwrap(), Duration::from_secs(3)).unwrap(),
            Duration::from_secs(3),
        ),
    ] {
        let _client = TcpStream::connect(listener.local_addr().unwrap())
            .await
            .unwrap();
        let (accepted, _) = listener.accept().await.unwrap();
        let socket = socket2::SockRef::from(&accepted);
        // The kernel doubles what's asked.
        assert_eq!(socket.send_buffer_size().unwrap(), 2 * 32 * 1024);
        assert_eq!(socket.tcp_user_timeout().unwrap(), Some(deadline));
    }
    assert_eq!(USER_TIMEOUT, Duration::from_secs(60));
}

/// A page nobody reads, wherever it waits, is ended by the kernel once its
/// reader has taken nothing for the deadline (3 s here), and its place in
/// flight with it; a reader that reads gets whole pages on the same
/// listener.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_page_nobody_reads_is_ended_by_the_kernel_and_its_place_freed() {
    let mut setup = Setup::new(Pools::Long);
    setup.user_timeout = Duration::from_secs(3);
    let server = start("user-timeout", setup).await;
    let mut reader = connect(server.addr, None).await;
    for i in 0..4 {
        reader
            .write_all(page_of("mainnet", &client(i)).as_bytes())
            .await
            .unwrap();
        let (head, body) = whole(&mut reader, Vec::new()).await;
        assert!(head.starts_with("HTTP/1.1 200 "), "{head}");
        assert_eq!(body.len() as u64, PAGE);
    }
    drop(reader);
    assert!(
        eventually(
            || server_sockets(server.port()) == 0,
            Duration::from_secs(3)
        )
        .await
    );
    let mut stalled = Vec::new();
    for i in 0..16 {
        let mut stream = connect(server.addr, Some(4096)).await;
        stream
            .write_all(page_of("preprod", &client(100 + i)).as_bytes())
            .await
            .unwrap();
        stalled.push(stream);
    }
    let edge = server.edge.clone();
    assert!(
        eventually(
            || edge.in_flight(Part::Messaging) == 16,
            Duration::from_secs(3)
        )
        .await
    );
    let start = Instant::now();
    assert!(
        eventually(
            || server_sockets(server.port()) == 0,
            Duration::from_secs(8)
        )
        .await,
        "{} server sockets left {:?} on",
        server_sockets(server.port()),
        start.elapsed()
    );
    assert!(
        eventually(
            || edge.in_flight(Part::Messaging) == 0,
            Duration::from_secs(2)
        )
        .await
    );
    drop(stalled);
}

/// The deadline is on progress, not on an answer: a reader that takes a
/// little at a time, well within it, gets a 1 MiB answer whole.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_slow_reader_that_keeps_reading_gets_its_answer_whole() {
    let mut setup = Setup::new(Pools::Free);
    setup.user_timeout = Duration::from_secs(3);
    setup.routes = Some(data_routes());
    let server = start("slow-reader", setup).await;
    let mut stream = connect(server.addr, None).await;
    stream
        .write_all(get_from("/test/plain/1048576", &client(1)).as_bytes())
        .await
        .unwrap();
    let mut got = Vec::new();
    let mut chunk = vec![0u8; 32 * 1024];
    let started = Instant::now();
    loop {
        if let Some((head, body)) = parsed(&got) {
            assert!(head.starts_with("HTTP/1.1 200 "), "{head}");
            assert!(body.len() >= 1 << 20);
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
        let n = tokio::time::timeout(Duration::from_secs(10), stream.read(&mut chunk))
            .await
            .expect("more within 10 s")
            .unwrap();
        assert!(
            n > 0,
            "cut after {} bytes, {:?} on",
            got.len(),
            started.elapsed()
        );
        got.extend_from_slice(&chunk[..n]);
    }
    assert!(
        started.elapsed() > Duration::from_secs(5),
        "{:?}",
        started.elapsed()
    );
}

// ---------------------------------------------------------------- FI-2

/// A page nobody reads stays in flight, and only so much of it is counted
/// as sent: what its socket took, and 32 KiB and a slice ahead. Read
/// whole, it's counted whole, and stays in flight until its connection
/// asks again or closes.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_page_nobody_reads_stays_in_flight_until_it_is_read() {
    let server = start("in-flight", Setup::new(Pools::Long)).await;
    let edge = server.edge.clone();
    let mut stream = connect(server.addr, Some(4096)).await;
    stream
        .write_all(page_of("preprod", "203.0.113.7").as_bytes())
        .await
        .unwrap();
    for wait in [1, 4] {
        tokio::time::sleep(Duration::from_secs(wait)).await;
        assert_eq!(edge.in_flight(Part::Messaging), 1);
    }
    // What the sockets took (the reader's 8 KiB, the kernel's 64 KiB at
    // most), 32 KiB ahead of it, and a 16 KiB slice: 96 KiB on Linux 7.0.
    let counted = edge.messaging_egress.used();
    println!("a stalled page with a 4 KiB receive buffer: {counted} bytes counted of {PAGE}");
    assert!(counted <= 120 * 1024, "{counted}");
    let (head, body) = whole(&mut stream, Vec::new()).await;
    assert!(
        head.to_ascii_lowercase()
            .contains(&format!("content-length: {PAGE}")),
        "{head}"
    );
    assert_eq!(body.len() as u64, PAGE);
    assert_eq!(edge.messaging_egress.used(), PAGE);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(edge.in_flight(Part::Messaging), 1);
    // Asked again on the same connection: the first is read; the second
    // is in flight until it's read and the connection closes.
    stream
        .write_all(page_of("preprod", "203.0.113.7").as_bytes())
        .await
        .unwrap();
    let (_, body) = whole(&mut stream, Vec::new()).await;
    assert_eq!(body.len() as u64, PAGE);
    assert!(
        eventually(
            || edge.in_flight(Part::Messaging) == 1,
            Duration::from_secs(1)
        )
        .await
    );
    drop(stream);
    assert!(
        eventually(
            || edge.in_flight(Part::Messaging) == 0,
            Duration::from_secs(2)
        )
        .await
    );
}

/// A model of Caddy's side of the proxy whose client takes nothing: it
/// reads 36 KiB and stops. The page stays in flight, and most of it is
/// counted as sent, since Caddy's socket and the kernel take that much.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn through_a_proxy_that_stops_most_of_a_page_is_counted() {
    let server = start("proxy", Setup::new(Pools::Long)).await;
    let edge = server.edge.clone();
    let mut stream = connect(server.addr, None).await;
    stream
        .write_all(page_of("preprod", "203.0.113.7").as_bytes())
        .await
        .unwrap();
    let mut taken = vec![0u8; 36 * 1024];
    tokio::time::timeout(Duration::from_secs(5), stream.read_exact(&mut taken))
        .await
        .unwrap()
        .unwrap();
    tokio::time::sleep(Duration::from_secs(2)).await;
    let counted = edge.messaging_egress.used();
    println!("a proxy that took 36 KiB and stopped: {counted} bytes counted of {PAGE}");
    assert_eq!(edge.in_flight(Part::Messaging), 1);
    assert!((100_000..=PAGE).contains(&counted), "{counted}");
    drop(stream);
}

/// A data answer is charged to its address's bucket whole as soon as it's
/// pulled, however little its reader takes: a stalled 2 MB answer costs
/// its 128 units at once.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_large_answer_charges_its_bucket_whole_at_once() {
    let mut setup = Setup::new(Pools::Free);
    setup.routes = Some(data_routes());
    let server = start("bucket", setup).await;
    let edge = server.edge.clone();
    let me: IpAddr = "203.0.113.7".parse().unwrap();
    let mut stream = connect(server.addr, Some(4096)).await;
    stream
        .write_all(get_from("/test/plain/2000000", "203.0.113.7").as_bytes())
        .await
        .unwrap();
    assert!(eventually(|| edge.egress.used() > 0, Duration::from_secs(5)).await);
    assert!(edge.egress.used() < 200_000);
    // 300 less 1 for the request and 2 MB / 16 KiB for its answer: 171.
    assert!(edge.take_in(Part::Data, me, 200.0, Instant::now()).is_err());
    assert_eq!(edge.in_flight(Part::Data), 1);
    drop(stream);
}

/// A compressed answer's encoder, and its input, are freed once the
/// encoder is done, while its reader still stalls: its place among the
/// compressions with them, its place in flight kept.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_compressed_answer_frees_its_encoder_while_its_reader_stalls() {
    let mut setup = Setup::new(Pools::Free);
    setup.routes = Some(data_routes());
    let server = start("encoder", setup).await;
    let edge = server.edge.clone();
    let mut stream = connect(server.addr, Some(4096)).await;
    // About 100 KB compressed: all of it pulled, not all of it handed.
    let request = get_from("/test/hex/200000", "203.0.113.7")
        .replace("\r\n\r\n", "\r\nAccept-Encoding: gzip\r\n\r\n");
    stream.write_all(request.as_bytes()).await.unwrap();
    let first = first_bytes(&mut stream, 512).await;
    let head = String::from_utf8_lossy(&first).to_ascii_lowercase();
    assert!(head.contains("content-encoding: gzip"), "{head}");
    assert!(eventually(|| edge.compressing() == 0, Duration::from_secs(5)).await);
    assert_eq!(edge.in_flight(Part::Data), 1);
    drop(stream);
}

/// Caddy keeps idle connections, and reuses the newest first: what an
/// answer read whole left parked goes when its connection is asked again
/// (for anyone) or closes.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn parked_counts_go_when_a_connection_asks_again_or_closes() {
    let server = start("parked", Setup::new(Pools::Long)).await;
    let edge = server.edge.clone();
    let mut pool = Vec::new();
    for i in 0..3 {
        let mut stream = connect(server.addr, None).await;
        stream
            .write_all(page_of("preprod", &client(i)).as_bytes())
            .await
            .unwrap();
        let (_, body) = whole(&mut stream, Vec::new()).await;
        assert_eq!(body.len() as u64, PAGE);
        pool.push(stream);
    }
    assert!(
        eventually(
            || edge.in_flight(Part::Messaging) == 3,
            Duration::from_secs(1)
        )
        .await
    );
    // The newest asked again, for another client.
    let newest = pool.last_mut().unwrap();
    newest
        .write_all(page_of("preprod", &client(9)).as_bytes())
        .await
        .unwrap();
    whole(newest, Vec::new()).await;
    assert!(
        eventually(
            || edge.in_flight(Part::Messaging) == 3,
            Duration::from_secs(1)
        )
        .await
    );
    drop(pool.remove(0));
    assert!(
        eventually(
            || edge.in_flight(Part::Messaging) == 2,
            Duration::from_secs(2)
        )
        .await
    );
    drop(pool);
    assert!(
        eventually(
            || edge.in_flight(Part::Messaging) == 0,
            Duration::from_secs(2)
        )
        .await
    );
}

/// One address with 16 pages it never reads: the 17th is the edge's
/// "too many requests at once", which the wallet reads as a second's wait.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_17th_stalled_page_from_one_address_is_too_many_at_once() {
    let server = start("seventeen", Setup::new(Pools::Long)).await;
    let edge = server.edge.clone();
    let mut held = Vec::new();
    for _ in 0..16 {
        let mut stream = connect(server.addr, Some(4096)).await;
        stream
            .write_all(page_of("mainnet", "203.0.113.7").as_bytes())
            .await
            .unwrap();
        assert!(
            first_bytes(&mut stream, 64)
                .await
                .starts_with(b"HTTP/1.1 200 ")
        );
        held.push(stream);
    }
    assert_eq!(edge.in_flight(Part::Messaging), 16);
    let mut more = connect(server.addr, None).await;
    more.write_all(page_of("mainnet", "203.0.113.7").as_bytes())
        .await
        .unwrap();
    let (status, retry, json, head) = answer(&mut more).await;
    assert_eq!(status, 429, "{head}");
    assert_eq!(json["error"], "too many requests at once");
    assert_eq!(retry.as_deref(), Some("1"));
    assert!(
        head.to_ascii_lowercase()
            .contains("access-control-allow-origin")
    );
    drop(held);
}

/// Answers keep their length: a full page of short envelopes, the largest
/// a page is, says it in Content-Length, unchunked.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_full_page_keeps_its_content_length() {
    let server = start("length", Setup::new(Pools::Short)).await;
    let mut stream = connect(server.addr, None).await;
    stream
        .write_all(page_of("mainnet", "203.0.113.7").as_bytes())
        .await
        .unwrap();
    let (head, body) = whole(&mut stream, Vec::new()).await;
    let head = head.to_ascii_lowercase();
    assert!(head.contains("content-length: 264208"), "{head}");
    assert!(!head.contains("transfer-encoding"), "{head}");
    assert_eq!(body.len() as u64, SHORT_PAGE);
}

/// Pages one after another on one connection, as Caddy sends its clients'
/// requests: each arrives whole, and nothing stays in flight once it closes.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pages_read_back_to_back_on_one_connection_all_arrive_whole() {
    let server = start("back-to-back", Setup::new(Pools::Long)).await;
    let edge = server.edge.clone();
    let mut stream = connect(server.addr, None).await;
    for i in 0..64 {
        stream
            .write_all(page_of("mainnet", &client(i)).as_bytes())
            .await
            .unwrap();
        let (head, body) = whole(&mut stream, Vec::new()).await;
        assert!(head.starts_with("HTTP/1.1 200 "), "{i}: {head}");
        assert_eq!(body.len() as u64, PAGE, "{i}");
    }
    assert_eq!(edge.messaging_egress.used(), 64 * PAGE);
    drop(stream);
    assert!(
        eventually(
            || edge.in_flight(Part::Messaging) == 0,
            Duration::from_secs(2)
        )
        .await
    );
}

// ---------------------------------------------------------------- FI-3

/// Past the relay's total over every address, a request is the edge's 503
/// `busy`, at once, whatever its address holds; `/health` and the data
/// routes answer as ever.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn past_the_relays_total_a_request_is_busy_and_the_rest_go_on() {
    let mut setup = Setup::new(Pools::Long);
    setup.caps.messaging = 4;
    let server = start("relay-total", setup).await;
    let edge = server.edge.clone();
    let mut held = Vec::new();
    for i in 0..4 {
        let mut stream = connect(server.addr, Some(4096)).await;
        stream
            .write_all(page_of("mainnet", &client(i)).as_bytes())
            .await
            .unwrap();
        held.push(stream);
    }
    assert!(
        eventually(
            || edge.in_flight(Part::Messaging) == 4,
            Duration::from_secs(3)
        )
        .await
    );
    let mut more = connect(server.addr, None).await;
    let asked = Instant::now();
    more.write_all(page_of("mainnet", "198.51.100.1").as_bytes())
        .await
        .unwrap();
    let (status, retry, json, head) = answer(&mut more).await;
    assert!(asked.elapsed() < Duration::from_secs(2));
    assert_eq!(
        (status, json["error"].as_str()),
        (503, Some("busy")),
        "{head}"
    );
    assert_eq!(retry.as_deref(), Some("30"));
    assert!(
        head.to_ascii_lowercase()
            .contains("access-control-allow-origin")
    );
    for path in ["/health", "/api/v1/tip"] {
        let mut stream = connect(server.addr, None).await;
        stream
            .write_all(get_from(path, "198.51.100.1").as_bytes())
            .await
            .unwrap();
        let (_, _, json, head) = answer(&mut stream).await;
        assert_ne!(json["error"], "busy", "{path}: {head}");
    }
    drop(held);
}

/// Past the data routes' total, a data request is `busy`, while a relay
/// page still answers and `/health` answers too: each part has its own.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn past_the_data_routes_total_a_request_is_busy_while_the_relay_answers() {
    let mut setup = Setup::new(Pools::Long);
    setup.caps.data = 4;
    let server = start("data-total", setup).await;
    let edge = server.edge.clone();
    let mut held = Vec::new();
    for i in 0..4 {
        let mut stream = connect(server.addr, None).await;
        let head = format!(
            "POST /api/v1/credential_utxos HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Forwarded-For: {}\r\n\
             Content-Type: application/json\r\nContent-Length: 100\r\n\r\n{{",
            client(i)
        );
        stream.write_all(head.as_bytes()).await.unwrap();
        held.push(stream);
    }
    assert!(eventually(|| edge.in_flight(Part::Data) == 4, Duration::from_secs(3)).await);
    let mut more = connect(server.addr, None).await;
    more.write_all(get_from("/api/v1/tip", "198.51.100.1").as_bytes())
        .await
        .unwrap();
    let (status, retry, json, _) = answer(&mut more).await;
    assert_eq!((status, json["error"].as_str()), (503, Some("busy")));
    assert_eq!(retry.as_deref(), Some("30"));
    let mut page = connect(server.addr, None).await;
    page.write_all(page_of("mainnet", "198.51.100.1").as_bytes())
        .await
        .unwrap();
    let (head, body) = whole(&mut page, Vec::new()).await;
    assert!(head.starts_with("HTTP/1.1 200 "), "{head}");
    assert_eq!(body.len() as u64, PAGE);
    let mut health = connect(server.addr, None).await;
    health
        .write_all(get_from("/health", "198.51.100.1").as_bytes())
        .await
        .unwrap();
    let (_, _, json, head) = answer(&mut health).await;
    assert!(json["messaging"].is_object(), "{head}");
    drop(held);
}

/// Past the bytes of data answers held, an answer whose length is known is
/// `busy` rather than sent: three stalled 1 MiB answers under a 3 MiB
/// total, and the fourth is refused.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn past_the_data_answers_held_an_answer_is_busy() {
    let mut setup = Setup::new(Pools::Free);
    setup.caps.data = 4;
    setup.caps.answer_bytes = 3 << 20;
    setup.routes = Some(data_routes());
    let server = start("answer-bytes", setup).await;
    let edge = server.edge.clone();
    let mut held = Vec::new();
    for i in 0..3 {
        let mut stream = connect(server.addr, Some(4096)).await;
        stream
            .write_all(get_from("/test/plain/1048576", &client(i)).as_bytes())
            .await
            .unwrap();
        assert!(
            first_bytes(&mut stream, 64)
                .await
                .starts_with(b"HTTP/1.1 200 ")
        );
        held.push(stream);
    }
    assert!(edge.answer_bytes() > 2 << 20, "{}", edge.answer_bytes());
    let mut more = connect(server.addr, None).await;
    more.write_all(get_from("/test/plain/1048576", &client(9)).as_bytes())
        .await
        .unwrap();
    let (status, retry, json, _) = answer(&mut more).await;
    assert_eq!((status, json["error"].as_str()), (503, Some("busy")));
    assert_eq!(retry.as_deref(), Some("30"));
    drop(held);
    assert!(eventually(|| edge.answer_bytes() == 0, Duration::from_secs(2)).await);
}

/// Past the cap on connections, a new one is closed at once, while a
/// request on one already open is answered.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn past_the_cap_on_connections_a_new_one_is_closed_at_once() {
    let mut setup = Setup::new(Pools::Long);
    setup.connections = 8;
    let server = start("connections", setup).await;
    let mut open = Vec::new();
    for _ in 0..8 {
        open.push(connect(server.addr, None).await);
    }
    assert!(
        eventually(
            || server_sockets(server.port()) == 8,
            Duration::from_secs(3)
        )
        .await
    );
    let mut ninth = connect(server.addr, None).await;
    let mut byte = [0u8; 1];
    let read = tokio::time::timeout(Duration::from_secs(2), ninth.read(&mut byte))
        .await
        .expect("closed at once");
    assert!(matches!(read, Ok(0) | Err(_)), "{read:?}");
    let first = &mut open[0];
    first
        .write_all(page_of("mainnet", "203.0.113.7").as_bytes())
        .await
        .unwrap();
    let (head, body) = whole(first, Vec::new()).await;
    assert!(head.starts_with("HTTP/1.1 200 "), "{head}");
    assert_eq!(body.len() as u64, PAGE);
}

// ---------------------------------------------------------------- FI-4

/// A request with a body on a route that takes none, by any method, is
/// answered at once, unread, and leaves its address's bucket and places in
/// flight as they were. Each declares 64 KiB and sends a byte.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_body_on_a_route_that_takes_none_is_answered_at_once_unread() {
    let server = start("no-body", Setup::new(Pools::Long)).await;
    let edge = server.edge.clone();
    for (method, path) in [
        ("POST", "/health"),
        ("POST", "/api/v1/tip"),
        ("POST", "/nowhere"),
        ("PUT", "/messaging/v1/mainnet/envelopes"),
        ("GET", "/messaging/v1/mainnet/envelopes"),
    ] {
        let mut stream = connect(server.addr, None).await;
        let head = format!(
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Forwarded-For: 203.0.113.7\r\n\
             Origin: {WALLET}\r\nContent-Type: application/json\r\nContent-Length: 65536\r\n\r\nX"
        );
        let asked = Instant::now();
        stream.write_all(head.as_bytes()).await.unwrap();
        let (status, _, json, head) = answer(&mut stream).await;
        assert!(asked.elapsed() < Duration::from_secs(1), "{method} {path}");
        assert_eq!(status, 400, "{method} {path}: {head}");
        assert_eq!(json["error"], "this route takes no body");
        let head = head.to_ascii_lowercase();
        assert!(head.contains("connection: close"), "{head}");
        assert!(head.contains("access-control-allow-origin"), "{head}");
    }
    assert_eq!((edge.buckets(), edge.messaging_buckets()), (0, 0));
    assert_eq!(
        (edge.in_flight(Part::Data), edge.in_flight(Part::Messaging)),
        (0, 0)
    );
}

/// A body whose declared length is past what its route takes is a 413 in
/// the edge's words, with CORS, at once and unread: a post past the
/// largest envelope, and a data route's past 16 KiB.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_declared_length_past_the_route_is_refused_before_it_is_read() {
    let server = start("too-long", Setup::new(Pools::Free)).await;
    for (path, length) in [
        ("/messaging/v1/preprod/envelopes", 8 + 32_768 + 1),
        ("/api/v1/credential_utxos", 16 * 1024 + 1),
    ] {
        let mut stream = connect(server.addr, None).await;
        let head = format!(
            "POST {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Forwarded-For: 203.0.113.7\r\n\
             Origin: {WALLET}\r\nContent-Type: application/octet-stream\r\nContent-Length: {length}\r\n\r\nX"
        );
        let asked = Instant::now();
        stream.write_all(head.as_bytes()).await.unwrap();
        let (status, _, json, head) = answer(&mut stream).await;
        assert!(asked.elapsed() < Duration::from_secs(1), "{path}");
        assert_eq!(status, 413, "{path}: {head}");
        assert_eq!(json["error"], "the body is larger than this route takes");
        assert!(
            head.to_ascii_lowercase()
                .contains("access-control-allow-origin")
        );
    }
    assert_eq!(server.edge.buckets() + server.edge.messaging_buckets(), 0);
}

/// A post the wallet's size whose body comes slowly, over 8 s, within the
/// body's deadline, is kept; one with no body to a route that takes one is
/// the route's to answer, as ever.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_slow_post_within_its_deadline_is_kept() {
    let server = start("slow-post", Setup::new(Pools::Free)).await;
    let v: Value = serde_json::from_str(include_str!(
        "../../../seedelf-platform/seedelf-messaging/tests/vectors/messaging_relay_v1.json"
    ))
    .unwrap();
    let hex = v["posts"][0]["envelope"].as_str().unwrap();
    let mut body = vec![0u8; 8];
    body.extend(
        (0..hex.len())
            .step_by(2)
            .map(|k| u8::from_str_radix(&hex[k..k + 2], 16).unwrap()),
    );
    let mut stream = connect(server.addr, None).await;
    let head = format!(
        "POST /messaging/v1/preprod/envelopes HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Forwarded-For: 203.0.113.7\r\n\
         Content-Type: application/octet-stream\r\nContent-Length: {}\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes()).await.unwrap();
    for piece in body.chunks(body.len().div_ceil(8)) {
        tokio::time::sleep(Duration::from_secs(1)).await;
        stream.write_all(piece).await.unwrap();
    }
    let (status, _, json, head) = answer(&mut stream).await;
    assert_eq!(
        (status, json["kept"].as_str()),
        (200, Some("new")),
        "{head}"
    );

    let mut stream = connect(server.addr, None).await;
    let head = "POST /api/v1/credential_utxos HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Forwarded-For: 203.0.113.7\r\n\
                Content-Type: application/json\r\nContent-Length: 0\r\n\r\n";
    stream.write_all(head.as_bytes()).await.unwrap();
    let (_, _, json, head) = answer(&mut stream).await;
    assert_ne!(json["error"], "this route takes no body", "{head}");
}

// ---------------------------------------------------------------- FI-6

/// A request through the test's routes, as Caddy passes one on.
fn asked(path: &str, client: &str, encoding: Option<&str>) -> Request<Body> {
    let mut request = Request::get(path)
        .header("x-forwarded-for", client)
        .body(Body::empty())
        .unwrap();
    if let Some(encoding) = encoding {
        request
            .headers_mut()
            .insert(header::ACCEPT_ENCODING, encoding.parse().unwrap());
    }
    request.extensions_mut().insert(ConnectInfo(
        "127.0.0.1:50000".parse::<SocketAddr>().unwrap(),
    ));
    request
}

/// gzip is the one encoding, whatever else a client names; at most so many
/// answers are compressed at once, and past that one goes out whole, as
/// if no encoding had been asked; answers sent uncompressed take no place.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn at_most_so_many_answers_are_compressed_at_once_and_the_rest_go_out_whole() {
    let caps = Caps {
        compressing: 2,
        ..Caps::DEFAULT
    };
    let edge = Arc::new(Edge::new(true, vec![], Egress::new(None, None)).with_caps(caps));
    let app = seedelf_data_api::layered(data_routes(), edge.clone(), &[]);
    let response = app
        .clone()
        .oneshot(asked("/test/plain/4096", &client(0), Some("br, gzip")))
        .await
        .unwrap();
    assert_eq!(response.headers()[header::CONTENT_ENCODING], "gzip");
    response.into_body().collect().await.unwrap();
    for i in 0..300 {
        let encoding = [None, Some("identity"), Some("br")][i % 3];
        let response = app
            .clone()
            .oneshot(asked("/test/plain/4096", &client(1 + i as u32), encoding))
            .await
            .unwrap();
        assert!(!response.headers().contains_key(header::CONTENT_ENCODING));
        response.into_body().collect().await.unwrap();
    }
    assert_eq!(edge.compressing(), 0);
    // Two held at their first frame: their encoders aren't done.
    let mut held = Vec::new();
    for i in 0..2 {
        let response = app
            .clone()
            .oneshot(asked("/test/hex/2000000", &client(400 + i), Some("gzip")))
            .await
            .unwrap();
        assert_eq!(response.headers()[header::CONTENT_ENCODING], "gzip");
        let mut body = response.into_body();
        let frame = body.frame().await.unwrap().unwrap();
        assert!(frame.is_data());
        held.push(body);
    }
    assert_eq!(edge.compressing(), 2);
    let response = app
        .clone()
        .oneshot(asked("/test/hex/2000000", &client(500), Some("gzip")))
        .await
        .unwrap();
    assert!(!response.headers().contains_key(header::CONTENT_ENCODING));
    let whole = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&whole).unwrap();
    assert_eq!(json["rows"].as_str().unwrap().len(), 2_000_000);
    // Once the two end, the next is compressed again.
    for body in &held {
        assert!(!body.is_end_stream());
    }
    drop(held);
    assert_eq!(edge.compressing(), 0);
    let response = app
        .oneshot(asked("/test/hex/4096", &client(600), Some("gzip")))
        .await
        .unwrap();
    assert_eq!(response.headers()[header::CONTENT_ENCODING], "gzip");
}
