//! The relay under load on two cores, the droplet's size (web wallet chunk
//! 54's 54c), its envelopes and its list of certificates (chunk 55's 55c).
//! Not part of the suite: it does nothing unless `RELAY_LOAD=1`,
//! and it's meant for a release build pinned to two cores:
//!
//! ```text
//! RELAY_LOAD=1 taskset -c 0,1 cargo test --release --locked --test messaging_load -- --nocapture
//! ```
//!
//! The server runs here, on a local port, with no source and nothing read
//! from any `.env`; its clients run in the same process, on the same two
//! cores, so the figures are a floor. Posts carry real proof of work, solved
//! before the clock starts, each from an address of its own as Caddy names
//! it. Each certificate is a real one, so each post's proof is checked.

use std::sync::Arc;
use std::time::{Duration, Instant};

use seedelf_data_api::chain::Chain;
use seedelf_data_api::edge::{Edge, Egress};
use seedelf_data_api::messaging::certificate::listing_digest;
use seedelf_data_api::messaging::check::{stamp_bits, stamp_digest};
use seedelf_data_api::messaging::price::Prices;
use seedelf_data_api::messaging::window::Limits;
use seedelf_data_api::messaging::{Config, Relay};
use seedelf_data_api::state::AppState;
use seedelf_data_api::submit::Submit;
use serde_json::Value;

mod common;
use common::{KoiosMock, Made};
use seedelf_data_api::messaging::view::{KOIOS_DEADLINE, KOIOS_KEPT, Koios, View};

const WALLET: &str = "chrome-extension://jfekiogplaamnceifeehipmomhojngcb";
const POSTS: u32 = 3000;
const READERS: u32 = 200;
const CONCURRENCY: usize = 64;

/// Preprod's pool, but a floor that never rises: a burst of thousands of
/// posts in seconds is a flood, which the floor prices, and this measures
/// the relay's work, not the price.
static POOL: [Config; 1] = [Config {
    name: "preprod",
    cap: 64 << 20,
    prices: Prices {
        base: 16,
        per_bit: 32.0,
        quiet: f64::MAX,
        ceiling: 24,
        half_life: Duration::from_secs(600),
    },
    // Each post comes from an address of its own.
    window: Limits {
        envelopes: 1000,
        units: 4096,
    },
    list: seedelf_data_api::messaging::POOLS[1].list,
}];

fn short(i: u32) -> Vec<u8> {
    let v: Value = serde_json::from_str(include_str!(
        "../../../seedelf-platform/seedelf-messaging/tests/vectors/messaging_relay_v1.json"
    ))
    .unwrap();
    let hex = v["posts"][0]["envelope"].as_str().unwrap();
    assert_eq!(v["posts"][0]["name"], "512 bytes");
    let mut bytes: Vec<u8> = (0..hex.len())
        .step_by(2)
        .map(|k| u8::from_str_radix(&hex[k..k + 2], 16).unwrap())
        .collect();
    bytes[200..204].copy_from_slice(&i.to_be_bytes());
    bytes
}

/// Seedelf `i`, a 32-byte name of its own at a register of its own.
fn seedelf(i: u32) -> Made {
    let name = [&[0x5e; 28][..], &i.to_be_bytes()].concat();
    Made::preprod(&name, 1 + u64::from(i), 3)
}

/// Its long certificate, 304 bytes.
fn certificate(i: u32) -> Vec<u8> {
    seedelf(i).bytes()
}

/// Posts of `make`'s bytes, each paid at preprod's base over its `digest`,
/// solved on every core there is.
fn solved(count: u32, make: fn(u32) -> Vec<u8>, digest: fn(&[u8]) -> [u8; 32]) -> Vec<Vec<u8>> {
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get()) as u32;
    let handles: Vec<_> = (0..threads)
        .map(|t| {
            std::thread::spawn(move || {
                (0..count)
                    .filter(|i| i % threads == t)
                    .map(|i| {
                        let bytes = make(i);
                        let digest = digest(&bytes);
                        let nonce = (0u64..).find(|&n| stamp_bits(&digest, n) >= 16).unwrap();
                        (i, [&nonce.to_be_bytes()[..], &bytes].concat())
                    })
                    .collect::<Vec<_>>()
            })
        })
        .collect();
    let mut all: Vec<(u32, Vec<u8>)> = handles
        .into_iter()
        .flat_map(|h| h.join().unwrap())
        .collect();
    all.sort_by_key(|(i, _)| *i);
    all.into_iter().map(|(_, post)| post).collect()
}

fn address(i: u32) -> String {
    let [a, b, c, d] = (0x0a00_0000 + i).to_be_bytes();
    format!("{a}.{b}.{c}.{d}")
}

fn percentile(times: &mut [Duration], p: f64) -> Duration {
    times.sort();
    times[((times.len() - 1) as f64 * p) as usize]
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_relay_under_load() {
    if std::env::var("RELAY_LOAD").as_deref() != Ok("1") {
        return;
    }
    let posts = Arc::new(solved(POSTS, short, |e| stamp_digest("preprod", e)));
    let certificates = Arc::new(solved(POSTS, certificate, |c| listing_digest("preprod", c)));

    let state = Arc::new(AppState::new(
        Chain::connect("postgresql://nobody@127.0.0.1:1/nothing").unwrap(),
    ));
    let submit = Arc::new(Submit::new(None, None).unwrap());
    let edge = Arc::new(Edge::new(
        true,
        vec![WALLET.to_string()],
        Egress::new(None, None),
    ));
    // Preprod's chain check reads a Koios on loopback that holds every
    // Seedelf posted: at most four requests to it at once, as to Koios, so
    // the certificates' figures are the check's too.
    let koios = KoiosMock::start();
    for i in 0..POSTS {
        let made = seedelf(i);
        koios.hold(&made.name, &made.register());
    }
    let view = View::Koios(Koios::with(&koios.url, KOIOS_DEADLINE, KOIOS_KEPT).unwrap());
    let relay = Arc::new(Relay::with_pools(None, &POOL).with_view("preprod", view));
    let app = seedelf_data_api::app(state, submit, edge, relay.clone(), &[WALLET.to_string()]);
    // Served as main.rs serves it: its listener's socket options, its caps
    // on connections, and its record of each (serve.rs).
    let listener = seedelf_data_api::serve::listen("127.0.0.1:0".parse().unwrap()).unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        seedelf_data_api::serve::serve(listener, app, std::future::pending())
            .await
            .unwrap();
    });
    let url = format!("http://127.0.0.1:{port}/messaging/v1/preprod/envelopes");
    let client = reqwest::Client::builder()
        .pool_max_idle_per_host(CONCURRENCY)
        .build()
        .unwrap();

    // Posts: each from its own address, CONCURRENCY at once.
    let gate = Arc::new(tokio::sync::Semaphore::new(CONCURRENCY));
    let start = Instant::now();
    let mut tasks = vec![];
    for i in 0..POSTS {
        let (client, url, posts, gate) = (client.clone(), url.clone(), posts.clone(), gate.clone());
        tasks.push(tokio::spawn(async move {
            let _permit = gate.acquire().await.unwrap();
            let sent = Instant::now();
            let response = client
                .post(&url)
                .header("x-forwarded-for", address(i))
                .header("content-type", "application/octet-stream")
                .body(posts[i as usize].clone())
                .send()
                .await
                .unwrap();
            assert_eq!(
                response.status(),
                200,
                "{}",
                response.text().await.unwrap_or_default()
            );
            response.bytes().await.unwrap();
            sent.elapsed()
        }));
    }
    let mut times = vec![];
    for task in tasks {
        times.push(task.await.unwrap());
    }
    let took = start.elapsed();
    println!(
        "posts: {POSTS} in {:.2} s = {:.0}/s; p50 {:.2} ms, p99 {:.2} ms",
        took.as_secs_f64(),
        f64::from(POSTS) / took.as_secs_f64(),
        percentile(&mut times, 0.5).as_secs_f64() * 1e3,
        percentile(&mut times, 0.99).as_secs_f64() * 1e3,
    );
    assert_eq!(relay.health()["preprod"]["envelopes"], POSTS);

    // Readers: each a fresh sync of the whole pool, page by page.
    let start = Instant::now();
    let mut tasks = vec![];
    for i in 0..READERS {
        let (client, url, gate) = (client.clone(), url.clone(), gate.clone());
        tasks.push(tokio::spawn(async move {
            let _permit = gate.acquire().await.unwrap();
            let (mut after, mut pages, mut bytes, mut envelopes) = (None::<u64>, 0, 0, 0);
            loop {
                let mut request = client
                    .get(&url)
                    .header("x-forwarded-for", address(100_000 + i));
                if let Some(after) = after {
                    request = request.query(&[("after", after)]);
                }
                let body = request.send().await.unwrap().bytes().await.unwrap();
                pages += 1;
                bytes += body.len();
                envelopes += u16::from_be_bytes([body[14], body[15]]) as usize;
                after = Some(u64::from_be_bytes(body[2..10].try_into().unwrap()));
                if body[1] & 1 == 0 {
                    break;
                }
            }
            assert_eq!(envelopes, POSTS as usize);
            (pages, bytes)
        }));
    }
    let (mut pages, mut bytes) = (0, 0);
    for task in tasks {
        let (p, b) = task.await.unwrap();
        pages += p;
        bytes += b;
    }
    let took = start.elapsed();
    println!(
        "fresh syncs: {READERS} of {:.2} MB each in {:.2} s = {:.0} pages/s, {:.0} MB/s",
        bytes as f64 / f64::from(READERS) / 1e6,
        took.as_secs_f64(),
        f64::from(pages) / took.as_secs_f64(),
        bytes as f64 / took.as_secs_f64() / 1e6,
    );

    // Certificates: each from its own address, each one's proof checked
    // (§21.7's row 7), CONCURRENCY at once.
    let url = format!("http://127.0.0.1:{port}/messaging/v1/preprod/certificates");
    let start = Instant::now();
    let mut tasks = vec![];
    for i in 0..POSTS {
        let (client, url, certificates, gate) = (
            client.clone(),
            url.clone(),
            certificates.clone(),
            gate.clone(),
        );
        tasks.push(tokio::spawn(async move {
            let _permit = gate.acquire().await.unwrap();
            let sent = Instant::now();
            let response = client
                .post(&url)
                .header("x-forwarded-for", address(200_000 + i))
                .header("content-type", "application/octet-stream")
                .body(certificates[i as usize].clone())
                .send()
                .await
                .unwrap();
            assert_eq!(
                response.status(),
                200,
                "{}",
                response.text().await.unwrap_or_default()
            );
            response.bytes().await.unwrap();
            sent.elapsed()
        }));
    }
    let mut times = vec![];
    for task in tasks {
        times.push(task.await.unwrap());
    }
    let took = start.elapsed();
    println!(
        "certificates: {POSTS} in {:.2} s = {:.0}/s; p50 {:.2} ms, p99 {:.2} ms",
        took.as_secs_f64(),
        f64::from(POSTS) / took.as_secs_f64(),
        percentile(&mut times, 0.5).as_secs_f64() * 1e3,
        percentile(&mut times, 0.99).as_secs_f64() * 1e3,
    );
    assert_eq!(relay.health()["preprod"]["certificates"], POSTS);

    // Readers of the list: each a fresh read of all of it, page by page.
    let start = Instant::now();
    let mut tasks = vec![];
    for i in 0..READERS {
        let (client, url, gate) = (client.clone(), url.clone(), gate.clone());
        tasks.push(tokio::spawn(async move {
            let _permit = gate.acquire().await.unwrap();
            let (mut after, mut pages, mut bytes, mut entries) = (None::<u64>, 0, 0, 0);
            loop {
                let mut request = client
                    .get(&url)
                    .header("x-forwarded-for", address(300_000 + i));
                if let Some(after) = after {
                    request = request.query(&[("after", after)]);
                }
                let body = request.send().await.unwrap().bytes().await.unwrap();
                pages += 1;
                bytes += body.len();
                entries += u16::from_be_bytes([body[11], body[12]]) as usize;
                after = Some(u64::from_be_bytes(body[2..10].try_into().unwrap()));
                if body[1] & 1 == 0 {
                    break;
                }
            }
            assert_eq!(entries, POSTS as usize);
            (pages, bytes)
        }));
    }
    let (mut pages, mut bytes) = (0, 0);
    for task in tasks {
        let (p, b) = task.await.unwrap();
        pages += p;
        bytes += b;
    }
    let took = start.elapsed();
    println!(
        "list reads: {READERS} of {:.2} MB each in {:.2} s = {:.0} pages/s, {:.0} MB/s",
        bytes as f64 / f64::from(READERS) / 1e6,
        took.as_secs_f64(),
        f64::from(pages) / took.as_secs_f64(),
        bytes as f64 / took.as_secs_f64() / 1e6,
    );
}
