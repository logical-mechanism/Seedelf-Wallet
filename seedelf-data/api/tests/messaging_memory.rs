//! What a kept envelope costs the relay's memory (the gate review of
//! Seedelf Messaging, 54g). A pool's cap counts envelope bytes, so the heap
//! must grow by about what the pool says it holds: an envelope kept as a
//! view of the HTTP read buffer it arrived in would pin 8 to 132 KiB for its
//! 512 counted bytes.
//!
//! The whole process's live heap is counted, so this test has a binary of
//! its own. The server runs here, on a local port, with no source and
//! nothing read from the environment; posts come over real TCP, on one
//! connection kept alive, as Caddy sends them.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use seedelf_data_api::chain::Chain;
use seedelf_data_api::edge::{Edge, Egress};
use seedelf_data_api::messaging::price::Prices;
use seedelf_data_api::messaging::window::Limits;
use seedelf_data_api::messaging::{Config, Relay};
use seedelf_data_api::state::AppState;
use seedelf_data_api::submit::Submit;
use serde_json::Value;

/// The system's allocator, counting the bytes that are live.
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

const POSTS: u32 = 1000;

/// The edge's bucket lets one address post 75 at once; the posts go round
/// these, as if from a few wallets, so no table of addresses grows with them.
const ADDRESSES: u32 = 16;

/// Preprod's pool, with nothing to solve: the price doesn't touch what's
/// kept, and a thousand solved stamps would take the test minutes.
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

/// A post with any nonce of the vectors' 512-byte envelope: valid points,
/// which the relay checks, and a ciphertext it doesn't read.
fn first_post() -> Vec<u8> {
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
    body
}

/// A post of an envelope of its own: the first with its ciphertext changed.
fn post(first: &[u8], i: u32) -> Vec<u8> {
    let mut body = first.to_vec();
    body[8 + 200..8 + 204].copy_from_slice(&i.to_be_bytes());
    body
}

fn address(i: u32) -> String {
    format!("203.0.113.{}", 1 + i % ADDRESSES)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_kept_envelope_costs_the_heap_about_its_own_bytes() {
    let state = Arc::new(AppState::new(
        Chain::connect("postgresql://nobody@127.0.0.1:1/nothing").unwrap(),
    ));
    let submit = Arc::new(Submit::new(None, None).unwrap());
    let edge = Arc::new(Edge::new(true, vec![], Egress::new(None, None)));
    let relay = Arc::new(Relay::with_pools(None, &POOL));
    let app = seedelf_data_api::app(state, submit, edge, relay.clone(), &[]);
    // Served as main.rs serves it: its listener's socket options, its caps
    // on connections, and its record of each (serve.rs).
    let listener = seedelf_data_api::serve::listen("127.0.0.1:0".parse().unwrap()).unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        seedelf_data_api::serve::serve(listener, app, std::future::pending())
            .await
            .unwrap();
    });
    let url = format!("http://127.0.0.1:{port}/messaging/v1/preprod/envelopes");
    // One connection, kept alive: each post waits for the last one's answer.
    let client = reqwest::Client::builder()
        .pool_max_idle_per_host(1)
        .build()
        .unwrap();
    let send = async |i: u32, body: Vec<u8>| {
        let response = client
            .post(&url)
            .header("x-forwarded-for", address(i))
            .header("content-type", "application/octet-stream")
            .body(body)
            .send()
            .await
            .unwrap();
        let status = response.status();
        let answer = response.text().await.unwrap();
        assert_eq!(status, 200, "{answer}");
        assert!(answer.contains("\"new\""), "{answer}");
    };
    let held = || {
        let health = relay.health();
        (
            health["preprod"]["envelopes"].as_u64().unwrap(),
            health["preprod"]["bytes"].as_u64().unwrap(),
        )
    };

    // A few posts first, so what a first request allocates once isn't
    // counted. Each body is made and freed inside the count, so only what
    // the relay keeps of it is left.
    let first = first_post();
    let warm = 2 * ADDRESSES;
    for i in 0..warm {
        send(i, post(&first, i)).await;
    }
    tokio::time::sleep(Duration::from_millis(300)).await;
    let (envelopes_before, bytes_before) = held();
    let before = LIVE.load(Ordering::Relaxed);

    for i in warm..warm + POSTS {
        send(i, post(&first, i)).await;
    }
    tokio::time::sleep(Duration::from_millis(300)).await;
    let after = LIVE.load(Ordering::Relaxed);

    let (envelopes, bytes) = held();
    let (kept, counted) = (envelopes - envelopes_before, bytes - bytes_before);
    assert_eq!((kept, counted), (u64::from(POSTS), u64::from(POSTS) * 512));
    let grown = after.saturating_sub(before) as u64;
    println!(
        "kept {kept} envelopes = {counted} counted bytes; the heap grew {grown} bytes = {} an envelope ({:.2} times its size)",
        grown / kept,
        grown as f64 / counted as f64,
    );
    assert!(
        grown < 2 * counted,
        "the heap grew {grown} bytes for {counted} counted: {:.1} times what the pool's cap counts",
        grown as f64 / counted as f64,
    );
    server.abort();
}
