//! What stalled answers hold in the API's heap (the 1.10.0 gate's FI-1, FI-2
//! and FI-6): the kernel's deadline frees what pages nobody reads held, and
//! a compressed answer frees its input once its encoder is done, while its
//! reader still stalls. Apart from tests/connections.rs, since the heap is
//! counted by this binary's allocator, and its tests take one lock so no
//! two measure at once.
//!
//! The server runs as `main.rs` runs it (`serve::listen_with`,
//! `serve::serve`, `app` or `layered`), on a local port, with no source;
//! the clients are plain sockets that name themselves in `X-Forwarded-For`
//! from loopback, as Caddy does. Debug build: the figures are a debug
//! build's, and only their proportions are asserted.

use std::alloc::{GlobalAlloc, Layout, System};
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::Router;
use axum::routing::get;
use seedelf_data_api::chain::Chain;
use seedelf_data_api::edge::{Edge, Egress, Part};
use seedelf_data_api::messaging::Relay;
use seedelf_data_api::serve;
use seedelf_data_api::state::AppState;
use seedelf_data_api::submit::Submit;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpSocket, TcpStream};

struct Counting;

static LIVE: AtomicUsize = AtomicUsize::new(0);

// SAFETY: every call goes to the system's allocator unchanged; the count
// beside it is only read.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        // SAFETY: the caller's contract is the system allocator's.
        let pointer = unsafe { System.alloc(layout) };
        if !pointer.is_null() {
            LIVE.fetch_add(layout.size(), Ordering::Relaxed);
        }
        pointer
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        // SAFETY: the caller's contract is the system allocator's.
        unsafe { System.dealloc(pointer, layout) };
        LIVE.fetch_sub(layout.size(), Ordering::Relaxed);
    }

    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        // SAFETY: the caller's contract is the system allocator's.
        let moved = unsafe { System.realloc(pointer, layout, size) };
        if !moved.is_null() {
            LIVE.fetch_add(size, Ordering::Relaxed);
            LIVE.fetch_sub(layout.size(), Ordering::Relaxed);
        }
        moved
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

/// One measuring test at a time.
static ONE_AT_A_TIME: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn live() -> i64 {
    LIVE.load(Ordering::Relaxed) as i64
}

/// The heap once it reads the same three times running, 100 ms apart.
async fn settled() -> i64 {
    let mut last = live();
    let mut same = 0;
    for _ in 0..100 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let now = live();
        if (now - last).abs() < 4096 {
            same += 1;
            if same >= 3 {
                return now;
            }
        } else {
            same = 0;
        }
        last = now;
    }
    last
}

/// A pool's file in the snapshot's format: eight 32 KiB envelopes, one
/// full page, kept now.
fn write_pool(dir: &Path, name: &str) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let first = 1_000_000u64;
    let mut out = vec![1u8];
    out.extend_from_slice(&(first + 8).to_be_bytes());
    out.extend_from_slice(&(first - 1).to_be_bytes());
    out.extend_from_slice(&8u32.to_be_bytes());
    for i in 0..8u32 {
        out.extend_from_slice(&(first + u64::from(i)).to_be_bytes());
        out.extend_from_slice(&now.to_be_bytes());
        out.extend_from_slice(&32_768u32.to_be_bytes());
        let mut envelope = vec![1u8; 32_768];
        envelope[1..5].copy_from_slice(&i.to_be_bytes());
        out.extend_from_slice(&envelope);
    }
    std::fs::write(dir.join(format!("messaging-{name}.pool")), out).unwrap();
}

async fn connect(addr: SocketAddr, receive: Option<u32>) -> TcpStream {
    let socket = TcpSocket::new_v4().unwrap();
    if let Some(size) = receive {
        socket.set_recv_buffer_size(size).unwrap();
    }
    let stream = socket.connect(addr).await.unwrap();
    stream.set_nodelay(true).unwrap();
    stream
}

fn get_from(path: &str, client: &str, encoding: &str) -> String {
    format!(
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Forwarded-For: {client}\r\nAccept-Encoding: {encoding}\r\n\r\n"
    )
}

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

/// `app` served as main.rs serves it, with the kernel's deadline at
/// `user_timeout`.
fn spawn(
    app: Router,
    user_timeout: Duration,
) -> (SocketAddr, tokio::task::JoinHandle<std::io::Result<()>>) {
    let listener = serve::listen_with("127.0.0.1:0".parse().unwrap(), user_timeout).unwrap();
    let addr = listener.local_addr().unwrap();
    (
        addr,
        tokio::spawn(serve::serve(listener, app, std::future::pending())),
    )
}

/// FI-1: sixteen pages nobody reads, from sixteen addresses, each with a
/// 4 KiB receive buffer. The kernel ends them at its deadline (3 s here),
/// and what they held in the API's heap is freed with them.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_kernels_deadline_frees_what_stalled_pages_held() {
    let _one = ONE_AT_A_TIME.lock().await;
    let dir =
        std::env::temp_dir().join(format!("seedelf-connections-memory-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    write_pool(&dir, "mainnet");
    write_pool(&dir, "preprod");
    let edge = Arc::new(Edge::new(true, vec![], Egress::new(None, None)));
    let relay = Arc::new(Relay::new(Some(&dir)));
    let state = Arc::new(AppState::new(
        Chain::connect("postgresql://nobody@127.0.0.1:1/nothing").unwrap(),
    ));
    let submit = Arc::new(Submit::new(None, None).unwrap());
    let app = seedelf_data_api::app(state, submit, edge.clone(), relay, &[]);
    let (addr, served) = spawn(app, Duration::from_secs(3));
    // One read whole first, so what's made once isn't counted.
    let mut warm = connect(addr, None).await;
    warm.write_all(get_from("/messaging/v1/mainnet/envelopes", "192.0.2.1", "identity").as_bytes())
        .await
        .unwrap();
    let mut sink = vec![0u8; 400 * 1024];
    let mut got = 0;
    while got < 262_192 {
        got += warm.read(&mut sink).await.unwrap();
    }
    drop(warm);
    assert!(eventually(|| server_sockets(addr.port()) == 0, Duration::from_secs(3)).await);
    let before = settled().await;
    let mut stalled = Vec::new();
    for i in 0..16u8 {
        let mut stream = connect(addr, Some(4096)).await;
        let client = format!("203.0.113.{}", 10 + i);
        stream
            .write_all(get_from("/messaging/v1/preprod/envelopes", &client, "identity").as_bytes())
            .await
            .unwrap();
        stalled.push(stream);
    }
    assert!(
        eventually(
            || edge.in_flight(Part::Messaging) == 16,
            Duration::from_secs(3)
        )
        .await
    );
    tokio::time::sleep(Duration::from_millis(1000)).await;
    let held = live() - before;
    assert!(eventually(|| server_sockets(addr.port()) == 0, Duration::from_secs(8)).await);
    assert!(
        eventually(
            || edge.in_flight(Part::Messaging) == 0,
            Duration::from_secs(2)
        )
        .await
    );
    let after = settled().await - before;
    println!(
        "16 stalled pages held {held} bytes of heap ({} each); after the deadline, {after}",
        held / 16
    );
    assert!(held > 16 * 100_000, "{held}");
    assert!(after < held / 10, "{after} of {held}");
    drop(stalled);
    served.abort();
    let _ = std::fs::remove_dir_all(&dir);
}

/// FI-2 and FI-6: a compressed answer's input is freed once its encoder is
/// done, while its reader stalls, where an answer sent as it is holds all
/// of itself until it's read.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_compressed_answers_input_is_freed_while_its_reader_stalls() {
    let _one = ONE_AT_A_TIME.lock().await;
    let edge = Arc::new(Edge::new(true, vec![], Egress::new(None, None)));
    let routes = Router::new().route(
        "/test/plain",
        get(|| async { axum::Json(serde_json::json!({ "rows": "ab".repeat(1 << 20) })) }),
    );
    let app = seedelf_data_api::layered(routes, edge.clone(), &[]);
    let (addr, served) = spawn(app, serve::USER_TIMEOUT);
    let mut measured = Vec::new();
    for (i, encoding) in ["gzip", "identity"].into_iter().enumerate() {
        let before = settled().await;
        let mut stream = connect(addr, Some(4096)).await;
        let client = format!("203.0.113.{}", 20 + i);
        stream
            .write_all(get_from("/test/plain", &client, encoding).as_bytes())
            .await
            .unwrap();
        let mut head = [0u8; 256];
        let n = stream.read(&mut head).await.unwrap();
        assert!(head[..n].starts_with(b"HTTP/1.1 200 "));
        assert!(eventually(|| edge.compressing() == 0, Duration::from_secs(5)).await);
        let held = settled().await - before;
        assert_eq!(edge.in_flight(Part::Data), 1);
        measured.push(held);
        drop(stream);
        assert!(eventually(|| edge.in_flight(Part::Data) == 0, Duration::from_secs(2)).await);
    }
    println!(
        "a stalled 2 MiB answer of JSON holds {} bytes of heap compressed, {} as it is",
        measured[0], measured[1]
    );
    assert!(measured[0] < 256 * 1024, "{measured:?}");
    assert!(measured[1] > 1 << 20, "{measured:?}");
    served.abort();
}
