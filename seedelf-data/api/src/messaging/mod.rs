//! Seedelf Messaging's relay (web wallet chunk 54's 54c; the protocol's
//! docs/protocol.md §10 and §17). It keeps envelopes 36 hours and hands
//! every reader all of them: it can't read one or tell whom it's for, and
//! it keeps no recipient, sender, account or key.
//!
//! - `POST /messaging/v1/{pool}/envelopes`: `nonce (8) ‖ envelope`, as
//!   `application/octet-stream`. Checked (the shape, then the price and the
//!   address's window, then the points), then kept.
//! - `GET /messaging/v1/{pool}/envelopes?after=<cursor>`: a page of what
//!   came after the cursor, in the binary format `Page::encode` writes.
//!
//! A pool per network (`mainnet`, `preprod`): the Seedelf key is the same on
//! both, so one pool would show a preprod message to the mainnet wallet.
//! What an address posted is counted in memory, to price its next post
//! (`price`) and to bound what it has in the pool (`window`), and so is what
//! it was sent in pages over the last day (`reading`): never logged or
//! saved. The pools are saved to the state directory every minute and at
//! shutdown, so a deploy keeps what's waiting.

pub mod check;
pub mod pool;
pub mod price;
pub mod reading;
pub mod window;

use std::io::Write;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::Router;
use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Extension, Path as UrlPath, RawQuery, State};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde_json::{Value, json};
use tracing::warn;

use crate::edge::{Client, Reserved};
use check::{NONCE_LEN, SIZES};
use pool::{Full, Held, Kept, LENGTH_LEN, PAGE_BYTES, PAGE_HEADER, PAGE_VERSION, Page, Snapshot};
use price::{Asked, Counts, Prices};
use reading::{Reading, Reads};
use window::{Limits, Window};

/// A pool's numbers.
pub struct Config {
    pub name: &'static str,
    /// The most envelope bytes it holds; past it, posts wait for room.
    pub cap: usize,
    pub prices: Prices,
    /// The most one address may have in it, whatever work it does
    /// (`window`).
    pub window: Limits,
}

/// The pools, and what they price by (protocol.md §17). The base costs a
/// browser about 0.1 s of WebAssembly (2¹⁸ SHA-256 attempts at about 425 ns
/// each, measured in Node 24), the ceiling about 7 s (2²⁴). Preprod is for
/// testing: a lower base, and a smaller cap.
///
/// The window is the owner's to tune: 1,000 envelopes is about a second of
/// every reader's trial scan, 4,096 units 2 MiB of every reader's download.
/// The same on both pools, so a wallet meets the same limits on preprod.
pub const POOLS: [Config; 2] = [
    Config {
        name: "mainnet",
        cap: 64 << 20,
        prices: Prices {
            base: 18,
            per_bit: 32.0,
            quiet: 1000.0,
            ceiling: 24,
            half_life: Duration::from_secs(600),
        },
        window: Limits {
            envelopes: 1000,
            units: 4096,
        },
    },
    Config {
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
            envelopes: 1000,
            units: 4096,
        },
    },
];

/// Counted for a request with no address, which none from Caddy is.
const NO_ADDRESS: IpAddr = IpAddr::V4(Ipv4Addr::UNSPECIFIED);

/// Who the relay counts a post or a page as, for its prices and its
/// window: an IPv4 address whole, an IPv6 address by its /56, so the /64s
/// of one server's or one home's allocation are one address. The edge's
/// buckets take a /64 (`edge::client_key`).
pub fn address_key(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => IpAddr::V4(v4),
            None => {
                let s = v6.segments();
                IpAddr::V6(Ipv6Addr::new(s[0], s[1], s[2], s[3] & 0xff00, 0, 0, 0, 0))
            }
        },
        v4 => v4,
    }
}

pub struct Pool {
    pub config: &'static Config,
    held: Mutex<Held>,
    counts: Mutex<Counts>,
    /// Taken before `held` when both are, never after.
    window: Mutex<Window>,
    /// What each address was sent of it in the last day. Taken alone, never
    /// with another lock held.
    reads: Mutex<Reads>,
    /// Where it's saved, and the mark a clean shutdown leaves beside it.
    file: Option<(PathBuf, PathBuf)>,
}

/// Why a post whose checks passed wasn't kept: try again in this many
/// seconds.
#[derive(Debug, PartialEq, Eq)]
enum NotKept {
    /// The address's window, filled meanwhile by its other posts.
    Window(u64),
    /// The pool's cap.
    Full(u64),
}

/// Why a page wasn't sent.
#[derive(Debug, PartialEq, Eq)]
enum NotRead {
    /// The address has read its day's budget of this pool: again in this
    /// many seconds.
    Day(u64),
    /// Messaging's traffic for the day is down to its reserve, and the page
    /// is longer than the reserve sends.
    Reserve,
}

impl Pool {
    /// Keeps a post whose checks have passed. Its address's window is
    /// checked again and counted with the insert, so posts from one address
    /// at once can't pass it together; a copy kept meanwhile is still
    /// "already".
    fn keep(
        &self,
        digest: [u8; 32],
        envelope: &[u8],
        address: IpAddr,
        now: i64,
        instant: Instant,
    ) -> Result<Kept, NotKept> {
        let size = envelope.len();
        let mut window = self.window.lock().expect("window lock");
        let mut held = self.held.lock().expect("pool lock");
        held.expire(now);
        if held.already(&digest).is_none()
            && let Some(secs) = window.wait(address, size, instant)
        {
            return Err(NotKept::Window(secs));
        }
        let kept = held
            .insert(digest, envelope, now, self.config.cap)
            .map_err(|Full(secs)| NotKept::Full(secs))?;
        if let Kept::New { .. } = kept {
            window.record(address, size, instant);
        }
        Ok(kept)
    }

    /// The page after `after` for `address`, as the bytes to send
    /// (`encode`), counted against the address's reading for the day
    /// (`reading`). `short`, when messaging's traffic for the day is down to
    /// its reserve (`edge::Reserved`): the most bytes a page may be now, so
    /// the page holds what fits and says more follows; only an envelope
    /// longer than that by itself is refused. A page that's refused is
    /// counted against nothing.
    fn read(
        &self,
        after: Option<u64>,
        address: IpAddr,
        short: Option<usize>,
        now: i64,
        instant: Instant,
    ) -> Result<Vec<u8>, NotRead> {
        // A first look, before the page is made.
        if let Some(secs) = self
            .reads
            .lock()
            .expect("reads lock")
            .wait(address, instant)
        {
            return Err(NotRead::Day(secs));
        }
        let page = {
            let mut held = self.held.lock().expect("pool lock");
            match short {
                None => held.page(after, PAGE_BYTES, now),
                Some(most) => held.page_within(after, most, now).ok_or(NotRead::Reserve)?,
            }
        };
        let prices = {
            let counts = self.counts.lock().expect("counts lock");
            let window = self.window.lock().expect("window lock");
            prices(&counts, &window, address, instant)
        };
        let bytes = encode(&page, prices);
        self.reads
            .lock()
            .expect("reads lock")
            .take(address, bytes.len(), instant)
            .map_err(NotRead::Day)?;
        Ok(bytes)
    }

    /// The most page bytes one address is sent of this pool in a day.
    pub fn reading(&self) -> u64 {
        self.reads.lock().expect("reads lock").budget()
    }
}

pub struct Relay {
    pools: Vec<Pool>,
    /// One save at a time: the minute's, on a blocking thread, can meet the
    /// shutdown's, and two would write the same partial file.
    saving: Mutex<()>,
}

impl Relay {
    /// The pools, each from its file in `dir` if one is there.
    pub fn new(dir: Option<&Path>) -> Self {
        Self::with_pools(dir, &POOLS)
    }

    /// [`Relay::new`] with other pools than [`POOLS`]: a test's.
    pub fn with_pools(dir: Option<&Path>, pools: &'static [Config]) -> Self {
        let now = Instant::now();
        let pools = pools
            .iter()
            .map(|config| {
                let file = dir.map(|dir| {
                    (
                        dir.join(format!("messaging-{}.pool", config.name)),
                        dir.join(format!("messaging-{}.clean", config.name)),
                    )
                });
                Pool {
                    config,
                    held: Mutex::new(load(config.name, file.as_ref())),
                    counts: Mutex::new(Counts::new(config.prices, now)),
                    window: Mutex::new(Window::new(config.window, now)),
                    reads: Mutex::new(Reads::new(Reading::DEFAULT.budget(config.cap), now)),
                    file,
                }
            })
            .collect();
        Relay {
            pools,
            saving: Mutex::new(()),
        }
    }

    /// With another day's reading for each address than
    /// [`Reading::DEFAULT`]: the environment's, or a test's. Every reader's
    /// day starts again, so this is for a relay that hasn't served yet.
    pub fn with_reading(self, reading: Reading) -> Self {
        let now = Instant::now();
        for pool in &self.pools {
            *pool.reads.lock().expect("reads lock") =
                Reads::new(reading.budget(pool.config.cap), now);
        }
        self
    }

    pub fn pool(&self, name: &str) -> Option<&Pool> {
        self.pools.iter().find(|pool| pool.config.name == name)
    }

    /// Drops what's expired, the counts that have decayed away, and the
    /// window's buckets and the readers' hours that have aged out.
    pub fn tidy(&self) {
        let (now, instant) = (unix_now(), Instant::now());
        for pool in &self.pools {
            pool.held.lock().expect("pool lock").expire(now);
            pool.counts.lock().expect("counts lock").forget(instant);
            pool.window.lock().expect("window lock").forget(instant);
            pool.reads.lock().expect("reads lock").forget(instant);
        }
    }

    /// Writes every pool that changed to its file. `clean` at shutdown,
    /// once nothing more comes in: the mark beside it says the file holds
    /// everything.
    pub fn save(&self, clean: bool) {
        let _one = self.saving.lock().expect("saving lock");
        for pool in &self.pools {
            let Some((file, mark)) = &pool.file else {
                continue;
            };
            let snapshot = {
                let mut held = pool.held.lock().expect("pool lock");
                held.changed.then(|| held.snapshot())
            };
            if let Some(snapshot) = snapshot
                && let Err(error) = write(file, &snapshot.encode())
            {
                warn!(pool = pool.config.name, kind = %error.kind(), "a messaging pool couldn't be saved");
                pool.held.lock().expect("pool lock").changed = true;
                continue;
            }
            if clean && let Err(error) = write(mark, b"") {
                warn!(pool = pool.config.name, kind = %error.kind(), "a messaging pool's clean mark couldn't be written");
            }
        }
    }

    /// Each pool's size, for `/health`: anyone can download the pools, so
    /// this says nothing new.
    pub fn health(&self) -> Value {
        self.pools
            .iter()
            .map(|pool| {
                let held = pool.held.lock().expect("pool lock");
                (
                    pool.config.name.to_string(),
                    json!({ "envelopes": held.len(), "bytes": held.bytes() }),
                )
            })
            .collect::<serde_json::Map<_, _>>()
            .into()
    }
}

/// A pool from its file: everything in it, after a clean shutdown; after
/// anything else, everything too, but each earlier cursor is told it may
/// have missed something. No file, or one that isn't a pool, is an empty
/// pool. The clean mark is removed as it's read, so a crash later doesn't
/// find it.
fn load(name: &str, file: Option<&(PathBuf, PathBuf)>) -> Held {
    let (now, micros) = (unix_now(), unix_micros());
    let Some((file, mark)) = file else {
        return Held::new(micros);
    };
    let clean = std::fs::remove_file(mark).is_ok();
    match std::fs::read(file) {
        Ok(bytes) => match Snapshot::decode(&bytes) {
            Some(snapshot) => Held::restore(snapshot, clean, name, now, micros),
            None => {
                warn!(
                    pool = name,
                    "a messaging pool's file isn't one, so it starts empty"
                );
                Held::new(micros)
            }
        },
        // None yet: one is written at the next save, changed or not, so a
        // clean restart reads back where the numbering stood and tells no
        // reader of a gap. Without it, a pool that never kept anything
        // started as new at every restart (the gate review's relay-server#7).
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut held = Held::new(micros);
            held.changed = true;
            held
        }
        Err(error) => {
            warn!(pool = name, kind = %error.kind(), "a messaging pool's file couldn't be read, so it starts empty");
            Held::new(micros)
        }
    }
}

/// Written whole, then renamed into place.
fn write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let partial = path.with_extension("partial");
    let mut file = std::fs::File::create(&partial)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    std::fs::rename(&partial, path)
}

/// Every minute: tidy, and save what changed.
pub async fn keep(relay: Arc<Relay>) {
    let mut every = tokio::time::interval(Duration::from_secs(60));
    every.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        every.tick().await;
        let relay = relay.clone();
        let _ = tokio::task::spawn_blocking(move || {
            relay.tidy();
            relay.save(false);
        })
        .await;
    }
}

/// The relay's routes. A body is at most a nonce and the largest envelope.
pub fn routes() -> Router<Arc<Relay>> {
    Router::new()
        .route("/messaging/v1/{pool}/envelopes", get(page).post(post))
        .layer(DefaultBodyLimit::max(NONCE_LEN + SIZES[3]))
}

/// What the edge's bucket charges a messaging request, before its answer's
/// bytes: a post is checked and kept, a page is read from memory.
pub fn weight(post: bool) -> f64 {
    if post { 4.0 } else { 1.0 }
}

async fn post(
    State(relay): State<Arc<Relay>>,
    UrlPath(name): UrlPath<String>,
    client: Option<Extension<Client>>,
    body: Bytes,
) -> Response {
    let Some(pool) = relay.pool(&name) else {
        return no_such_pool();
    };
    if body.len() < NONCE_LEN {
        return bad("a post is a nonce, then an envelope");
    }
    let nonce = u64::from_be_bytes(body[..NONCE_LEN].try_into().expect("8 bytes"));
    // Borrowed from the request's body: the pool keeps a copy of its own
    // (`Held::insert`), never a view of the buffer the request was read into.
    let envelope = &body[NONCE_LEN..];
    if let Err(refused) = check::check_shape(envelope) {
        return bad(refused.reason());
    }
    let digest = check::stamp_digest(pool.config.name, envelope);
    let (now, instant) = (unix_now(), Instant::now());
    // Already held: a re-post after a restart, whatever its stamp.
    let already = {
        let mut held = pool.held.lock().expect("pool lock");
        held.expire(now);
        held.already(&digest)
    };
    if let Some(expires) = already {
        return kept("already", expires);
    }
    let address = client.map_or(NO_ADDRESS, |Extension(Client(ip))| address_key(ip));
    let size = envelope.len();
    let asked = {
        let mut counts = pool.counts.lock().expect("counts lock");
        if !counts.room_for(address, instant) {
            return refuse(StatusCode::SERVICE_UNAVAILABLE, "busy", 60);
        }
        counts.ask(address, size, instant)
    };
    // The window with the price, before the stamp: a post with any nonce,
    // 0 say, learns how long to wait without solving.
    let wait = {
        let mut window = pool.window.lock().expect("window lock");
        if !window.room_for(address, instant) {
            return refuse(StatusCode::SERVICE_UNAVAILABLE, "busy", 60);
        }
        window.wait(address, size, instant)
    };
    match (asked, wait) {
        (Asked::Refused(secs), wait) => {
            return refuse(
                StatusCode::TOO_MANY_REQUESTS,
                "too many posts from this address for now",
                secs.max(wait.unwrap_or(0)),
            );
        }
        (_, Some(secs)) => return refuse(StatusCode::TOO_MANY_REQUESTS, WINDOW_FULL, secs),
        (Asked::Bits(bits), None) if check::stamp_bits(&digest, nonce) < bits => {
            let body = json!({ "error": "more proof of work", "price": bits });
            return (StatusCode::PAYMENT_REQUIRED, axum::Json(body)).into_response();
        }
        (Asked::Bits(_), None) => {}
    }
    if let Err(refused) = check::check_points(envelope) {
        return bad(refused.reason());
    }
    match pool.keep(digest, envelope, address, now, instant) {
        Ok(Kept::New { expires }) => {
            pool.counts
                .lock()
                .expect("counts lock")
                .record(address, size, instant);
            kept("new", expires)
        }
        Ok(Kept::Already { expires }) => kept("already", expires),
        Err(NotKept::Window(secs)) => refuse(StatusCode::TOO_MANY_REQUESTS, WINDOW_FULL, secs),
        Err(NotKept::Full(secs)) => {
            refuse(StatusCode::SERVICE_UNAVAILABLE, "the pool is full", secs)
        }
    }
}

async fn page(
    State(relay): State<Arc<Relay>>,
    UrlPath(name): UrlPath<String>,
    RawQuery(query): RawQuery,
    client: Option<Extension<Client>>,
    reserved: Option<Extension<Reserved>>,
) -> Response {
    let Some(pool) = relay.pool(&name) else {
        return no_such_pool();
    };
    let after = match query.as_deref() {
        None => None,
        Some(query) => match cursor(query) {
            Some(after) => Some(after),
            None => return bad("the one parameter is after, a cursor"),
        },
    };
    let address = client.map_or(NO_ADDRESS, |Extension(Client(ip))| address_key(ip));
    let short = reserved.map(|Extension(Reserved(most))| most);
    let page = match pool.read(after, address, short, unix_now(), Instant::now()) {
        Ok(page) => page,
        Err(NotRead::Day(secs)) => {
            return refuse(StatusCode::TOO_MANY_REQUESTS, DAY_READ, secs);
        }
        // As long as the edge's own 503 once the day's share is gone.
        Err(NotRead::Reserve) => return refuse(StatusCode::SERVICE_UNAVAILABLE, RESERVE, 3600),
    };
    let mut response = page.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    response
}

/// What a page says a post from `address` costs now, for each of the four
/// sizes: its price in bits, or 0 when the price's ceiling or the address's
/// window refuses it.
fn prices(counts: &Counts, window: &Window, address: IpAddr, now: Instant) -> [u8; 4] {
    SIZES.map(|size| match counts.ask(address, size, now) {
        // At most the ceiling, which is below 256.
        Asked::Bits(bits) if window.wait(address, size, now).is_none() => bits as u8,
        Asked::Bits(_) | Asked::Refused(_) => 0,
    })
}

/// `after=` and a number: decimal digits, no sign, within a u64.
fn cursor(query: &str) -> Option<u64> {
    let digits = query.strip_prefix("after=")?;
    if digits.is_empty() || digits.len() > 20 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

/// A page's bytes, big-endian:
///
/// ```text
/// version (1) = 1 | flags (1) | cursor (8) | prices (4) | count (2)
///   | count × (length (4) | envelope)
/// ```
///
/// Flags: 1, another page follows now; 2, a gap (see `pool`). Prices: the
/// bits a post from the reader's address would be asked now, for each of
/// the four sizes in order; 0, refused for now.
pub fn encode(page: &Page, prices: [u8; 4]) -> Vec<u8> {
    let size: usize = page.envelopes.iter().map(|e| LENGTH_LEN + e.len()).sum();
    let mut out = Vec::with_capacity(PAGE_HEADER + size);
    out.push(PAGE_VERSION);
    out.push(page.flags);
    out.extend_from_slice(&page.cursor.to_be_bytes());
    out.extend_from_slice(&prices);
    // At most 512 envelopes fit a page: 256 KiB of the smallest.
    out.extend_from_slice(&(page.envelopes.len() as u16).to_be_bytes());
    for envelope in &page.envelopes {
        out.extend_from_slice(&(envelope.len() as u32).to_be_bytes());
        out.extend_from_slice(envelope);
    }
    out
}

/// A 429's words when the window refuses a post.
const WINDOW_FULL: &str = "this address's share of the pool is full for now";

/// A 429's words when an address has read its day's budget of a pool.
const DAY_READ: &str = "this address has read its share of the pool for the day";

/// A 503's words for a page longer than the reserve sends.
const RESERVE: &str = "messaging is near its traffic allowance: short pages only for now";

fn kept(kept: &str, expires: i64) -> Response {
    axum::Json(json!({ "kept": kept, "expires": expires })).into_response()
}

fn bad(error: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        axum::Json(json!({ "error": error })),
    )
        .into_response()
}

fn no_such_pool() -> Response {
    let body = json!({ "error": "no such pool: mainnet or preprod" });
    (StatusCode::NOT_FOUND, axum::Json(body)).into_response()
}

fn refuse(status: StatusCode, error: &str, retry_after: u64) -> Response {
    let mut response = (status, axum::Json(json!({ "error": error }))).into_response();
    if let Ok(value) = HeaderValue::from_str(&retry_after.to_string()) {
        response.headers_mut().insert(header::RETRY_AFTER, value);
    }
    response
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

fn unix_micros() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_micros() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cursor_is_a_plain_number() {
        assert_eq!(cursor("after=0"), Some(0));
        assert_eq!(cursor("after=18446744073709551615"), Some(u64::MAX));
        for bad in [
            "",
            "after=",
            "after=-1",
            "after=+1",
            "after=1e3",
            "after=18446744073709551616",
            "after=1&after=2",
            "before=1",
            "after=0x10",
            "after= 1",
        ] {
            assert_eq!(cursor(bad), None, "{bad}");
        }
    }

    #[test]
    fn the_ceilings_are_within_what_the_crate_solves_and_a_byte() {
        let v = check::tests::vectors();
        let most = v["max_stamp_bits"].as_u64().unwrap() as u32;
        for pool in &POOLS {
            let prices = pool.prices;
            assert!(prices.base <= prices.ceiling && prices.ceiling <= most);
            // The largest envelope alone stays under the ceiling.
            let lone =
                Counts::new(prices, Instant::now()).ask(NO_ADDRESS, SIZES[3], Instant::now());
            assert!(
                matches!(lone, Asked::Bits(bits) if bits < prices.ceiling),
                "{}",
                pool.name
            );
        }
    }

    #[test]
    fn each_pools_window_holds_a_lone_post_of_every_size() {
        let now = Instant::now();
        for pool in &POOLS {
            let window = Window::new(pool.window, now);
            for size in SIZES {
                assert_eq!(window.wait(NO_ADDRESS, size, now), None, "{}", pool.name);
            }
        }
    }

    #[test]
    fn an_ipv6_allocation_is_one_address_by_its_56() {
        let key = |s: &str| address_key(s.parse().unwrap());
        // Every /64 of one /56 is one address...
        assert_eq!(key("2001:db8:0:100::1"), key("2001:db8:0:1ff:ffff::9"));
        assert_eq!(
            key("2001:db8:0:1ab::1"),
            "2001:db8:0:100::".parse::<IpAddr>().unwrap()
        );
        // ...and the next /56 is another.
        assert_ne!(key("2001:db8:0:100::1"), key("2001:db8:0:200::1"));
        assert_ne!(key("2001:db8:0:100::1"), key("2001:db8:1:100::1"));
        // An IPv4 address is whole, mapped or not.
        assert_eq!(key("::ffff:203.0.113.7"), key("203.0.113.7"));
        assert_ne!(key("203.0.113.7"), key("203.0.113.8"));
        // The edge's buckets still take a /64.
        assert_ne!(
            crate::edge::client_key("2001:db8:0:100::1".parse().unwrap()),
            crate::edge::client_key("2001:db8:0:1ff::1".parse().unwrap())
        );
    }

    #[test]
    fn a_page_says_0_for_a_size_the_window_refuses() {
        let now = Instant::now();
        let prices_ = POOLS[0].prices;
        let counts = Counts::new(prices_, now);
        let me: IpAddr = "203.0.113.7".parse().unwrap();
        let mut window = Window::new(
            Limits {
                envelopes: 1000,
                units: 20,
            },
            now,
        );
        assert_eq!(prices(&counts, &window, me, now), [18, 18, 18, 0]);
        window.record(me, 8192, now);
        // 16 units held: 1 and 4 more fit, 16 and 64 don't.
        assert_eq!(prices(&counts, &window, me, now), [18, 18, 0, 0]);
        // The envelope limit refuses every size alike.
        let mut window = Window::new(
            Limits {
                envelopes: 1,
                units: 4096,
            },
            now,
        );
        window.record(me, 512, now);
        assert_eq!(prices(&counts, &window, me, now), [0; 4]);
        // Another address is told the base.
        let other: IpAddr = "203.0.113.8".parse().unwrap();
        assert_eq!(prices(&counts, &window, other, now), [18, 18, 18, 20]);
    }

    /// A pool whose window holds one envelope.
    static ONE: [Config; 1] = [Config {
        name: "preprod",
        cap: 1 << 20,
        prices: POOLS[1].prices,
        window: Limits {
            envelopes: 1,
            units: 4096,
        },
    }];

    #[test]
    fn posts_at_once_are_counted_as_kept_so_only_one_passes_the_window() {
        let relay = Relay::with_pools(None, &ONE);
        let pool = relay.pool("preprod").unwrap();
        let (now, instant) = (unix_now(), Instant::now());
        let me: IpAddr = "203.0.113.7".parse().unwrap();
        let envelope = |i: u8| {
            let bytes = vec![i; 512];
            (check::stamp_digest("preprod", &bytes), bytes)
        };
        // Both passed the window before either was kept...
        assert_eq!(pool.window.lock().unwrap().wait(me, 512, instant), None);
        let ((a, first), (b, second)) = (envelope(1), envelope(2));
        // ...and only the first is.
        assert!(matches!(
            pool.keep(a, &first, me, now, instant),
            Ok(Kept::New { .. })
        ));
        assert!(matches!(
            pool.keep(b, &second, me, now, instant),
            Err(NotKept::Window(secs)) if secs > 36 * 3600
        ));
        // A copy of the first is still "already".
        assert!(matches!(
            pool.keep(a, &first, me, now, instant),
            Ok(Kept::Already { .. })
        ));
        assert_eq!(relay.health()["preprod"]["envelopes"], 1);
    }

    /// §17.2's "503 busy" (the gate review's relay-server#9 and tests-ci#7):
    /// a post from an address new to the pool while its prices, or its
    /// windows, already count 200,000 addresses. One already counted goes
    /// on to its price. Through the route, as the edge hands it on.
    #[tokio::test]
    async fn a_new_address_is_busy_while_a_table_is_full() {
        use tower::ServiceExt;
        let post_from = |ip: IpAddr| {
            let body = [&0u64.to_be_bytes()[..], &[1u8; 512]].concat();
            let mut request = axum::http::Request::post("/messaging/v1/preprod/envelopes")
                .body(axum::body::Body::from(body))
                .unwrap();
            request.extensions_mut().insert(Client(ip));
            request
        };
        for table in ["prices", "window"] {
            let relay = Arc::new(Relay::new(None));
            let pool = relay.pool("preprod").unwrap();
            let now = Instant::now();
            for i in 0..200_000u32 {
                let address = IpAddr::from(i.to_be_bytes());
                match table {
                    "prices" => pool.counts.lock().unwrap().record(address, 512, now),
                    _ => pool.window.lock().unwrap().record(address, 512, now),
                }
            }
            let app = routes().with_state(relay.clone());
            let new: IpAddr = "198.51.100.1".parse().unwrap();
            let response = app.clone().oneshot(post_from(new)).await.unwrap();
            assert_eq!(
                response.status(),
                StatusCode::SERVICE_UNAVAILABLE,
                "{table}"
            );
            assert_eq!(response.headers()[header::RETRY_AFTER], "60", "{table}");
            let bytes = axum::body::to_bytes(response.into_body(), 1 << 10)
                .await
                .unwrap();
            let body: Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(body["error"], "busy", "{table}");
            // A counted address isn't refused for the table's sake.
            let counted = IpAddr::from(7u32.to_be_bytes());
            let response = app.oneshot(post_from(counted)).await.unwrap();
            assert_ne!(
                response.status(),
                StatusCode::SERVICE_UNAVAILABLE,
                "{table}"
            );
            assert_eq!(relay.health()["preprod"]["envelopes"], 0);
        }
    }

    /// A pool holding a full first page: 512 short envelopes, 264,208 bytes
    /// as a page.
    fn fill_a_page(pool: &Pool) {
        let mut held = pool.held.lock().unwrap();
        for i in 0..512u32 {
            let mut bytes = vec![1u8; 512];
            bytes[1..5].copy_from_slice(&i.to_be_bytes());
            let digest = check::stamp_digest(pool.config.name, &bytes);
            held.insert(digest, &bytes, unix_now(), pool.config.cap)
                .unwrap();
        }
    }

    /// The gate review's loop (relay-server#2): one address asks for the
    /// first page as often as the edge's bucket lets it, for a day. With no
    /// budget it read 50,468 pages, 13.33 GB.
    #[test]
    fn one_address_reads_about_its_days_budget_and_no_more() {
        use crate::edge::{Edge, Egress, Part};
        let relay = Relay::new(None);
        let pool = relay.pool("mainnet").unwrap();
        fill_a_page(pool);
        let edge = Edge::new(true, vec![], Egress::new(None, None));
        let me: IpAddr = "203.0.113.7".parse().unwrap();
        let start = Instant::now();
        let (mut pages, mut read) = (0u64, 0u64);
        // A try every 100 ms.
        for tick in 0..24 * 3600 * 10u64 {
            let now = start + Duration::from_millis(tick * 100);
            if edge
                .take_in(Part::Messaging, me, weight(false), now)
                .is_err()
            {
                continue;
            }
            let Ok(page) = pool.read(None, address_key(me), None, unix_now(), now) else {
                continue;
            };
            assert_eq!(page.len(), 16 + 512 * (4 + 512));
            edge.charge_in(Part::Messaging, me, page.len());
            pages += 1;
            read += page.len() as u64;
        }
        // Eight times the pool's cap, 512 MiB: what eight wallets' fresh
        // syncs read. The page that passes it is the last.
        let budget = 8 * pool.config.cap as u64;
        assert_eq!(pool.reading(), budget);
        assert!(
            (budget..budget + 264_208).contains(&read),
            "one address read {pages} pages = {:.2} GB in a day",
            read as f64 / 1e9
        );
        assert_eq!(pages, budget.div_ceil(264_208));
        // It reached its budget within the hour, and waits out the day.
        let day = start + Duration::from_secs(24 * 3600);
        assert_eq!(
            pool.read(None, address_key(me), None, unix_now(), day),
            Err(NotRead::Day(3600))
        );
        // Another address reads, on the same network or not...
        for other in ["203.0.113.8", "2001:db8::1"] {
            let other = address_key(other.parse().unwrap());
            assert!(pool.read(None, other, None, unix_now(), day).is_ok());
        }
        // ...and an IPv6 address is its /56, as for posts.
        let reader = |s: &str| address_key(s.parse().unwrap());
        let spend = |address: IpAddr| {
            while pool.read(None, address, None, unix_now(), day).is_ok() {}
        };
        spend(reader("2001:db8:0:100::1"));
        assert!(matches!(
            pool.read(None, reader("2001:db8:0:1ff::9"), None, unix_now(), day),
            Err(NotRead::Day(_))
        ));
        assert!(
            pool.read(None, reader("2001:db8:0:200::1"), None, unix_now(), day)
                .is_ok()
        );
        // The other pool has a budget of its own.
        let preprod = relay.pool("preprod").unwrap();
        assert_eq!(preprod.reading(), 256 << 20);
        assert!(
            preprod
                .read(None, address_key(me), None, unix_now(), day)
                .is_ok()
        );
        // Once its hour has aged out, 25 hours after it began, it reads again.
        let later = start + Duration::from_secs(25 * 3600);
        assert!(
            pool.read(None, address_key(me), None, unix_now(), later)
                .is_ok()
        );
    }

    /// The reserve (the relay review's low, gate 54g): a page is cut to what
    /// the reserve sends, its framing counted, with the flag that says
    /// another follows now. Only an envelope longer than that by itself is
    /// refused, and a refusal is counted against nothing. Nothing on the
    /// wire changes: a page is whole envelopes, and `MORE` says go on.
    #[test]
    fn in_the_reserve_a_page_is_cut_short_and_refused_only_for_an_envelope_longer_than_it() {
        let relay = Relay::with_pools(None, &ONE).with_reading(Reading {
            floor: 60_000,
            pools: 0,
        });
        let pool = relay.pool("preprod").unwrap();
        let (now, instant) = (unix_now(), Instant::now());
        let me: IpAddr = "203.0.113.7".parse().unwrap();
        let most = Some(16 * 1024);
        // Each from an address of its own: the window holds one.
        let keep = |i: u8, size: usize| {
            let bytes = vec![i; size];
            let digest = check::stamp_digest("preprod", &bytes);
            let from = IpAddr::from([198, 51, 100, i]);
            pool.keep(digest, &bytes, from, now, instant).unwrap();
        };
        let cursor_of = |page: &[u8]| u64::from_be_bytes(page[2..10].try_into().unwrap());
        // Two 8 KiB envelopes: one page of 16,408 bytes, past 16 KiB. In the
        // reserve, the first alone, and more to come.
        keep(1, 8192);
        keep(2, 8192);
        let first = pool.read(None, me, most, now, instant).unwrap();
        assert_eq!((first.len(), first[1]), (16 + 4 + 8192, pool::MORE));
        assert_eq!(first[20..], [1; 8192]);
        let second = pool.read(Some(cursor_of(&first)), me, most, now, instant);
        let second = second.unwrap();
        assert_eq!((second.len(), second[1]), (16 + 4 + 8192, 0));
        assert_eq!(second[20..], [2; 8192]);
        // Outside the reserve, the whole page, as ever.
        let whole = pool.read(None, me, None, now, instant).unwrap();
        assert_eq!((whole.len(), whole[1]), (16 + 2 * (4 + 8192), 0));
        // A 32 KiB envelope is longer by itself: refused, however often,
        // and counted against nothing...
        keep(3, 32768);
        let caught_up = Some(cursor_of(&second));
        for _ in 0..10 {
            assert_eq!(
                pool.read(caught_up, me, most, now, instant),
                Err(NotRead::Reserve)
            );
        }
        // ...so the day holds the 32,832 bytes sent, and the long page is
        // the one that passes 60,000.
        let long = pool.read(caught_up, me, None, now, instant).unwrap();
        assert_eq!(long.len(), 16 + 4 + 32768);
        assert!(matches!(
            pool.read(caught_up, me, None, now, instant),
            Err(NotRead::Day(secs)) if secs > 24 * 3600
        ));
    }

    /// However long the reserve's page: never longer than that, cut only
    /// where the next whole envelope wouldn't fit it (or where any page is
    /// cut, at 256 KiB of envelopes), and the pages one after another hold
    /// every envelope once, in order.
    #[test]
    fn a_page_in_the_reserve_is_never_longer_than_the_reserve_sends() {
        let relay = Relay::new(None).with_reading(Reading {
            floor: 1 << 40,
            pools: 0,
        });
        let pool = relay.pool("mainnet").unwrap();
        {
            let mut held = pool.held.lock().unwrap();
            for i in 0..600u32 {
                let mut bytes = vec![1u8; 512];
                bytes[1..5].copy_from_slice(&i.to_be_bytes());
                let digest = check::stamp_digest("mainnet", &bytes);
                held.insert(digest, &bytes, unix_now(), pool.config.cap)
                    .unwrap();
            }
        }
        let me: IpAddr = "203.0.113.7".parse().unwrap();
        let read = |after: Option<u64>, most: usize| {
            pool.read(after, me, Some(most), unix_now(), Instant::now())
                .unwrap()
        };
        let count = |page: &[u8]| u16::from_be_bytes([page[14], page[15]]) as usize;
        for kib in [1, 2, 16, 64, 255, 256, 257, 512] {
            let most = kib << 10;
            let page = read(None, most);
            let n = count(&page);
            assert_eq!(page.len(), 16 + n * (4 + 512), "{kib} KiB");
            assert!(page.len() <= most, "{kib} KiB: {} bytes", page.len());
            assert_eq!(page[1], pool::MORE, "{kib} KiB");
            assert!(
                page.len() + 4 + 512 > most || n * 512 == PAGE_BYTES,
                "{kib} KiB: cut at {n}"
            );
        }
        // 31 to a page of 16 KiB, then the rest, every one once.
        let (mut after, mut ids) = (None, vec![]);
        loop {
            let page = read(after, 16 << 10);
            for k in 0..count(&page) {
                let at = 16 + k * (4 + 512) + 4;
                ids.push(u32::from_be_bytes(page[at + 1..at + 5].try_into().unwrap()));
            }
            after = Some(u64::from_be_bytes(page[2..10].try_into().unwrap()));
            if page[1] & pool::MORE == 0 {
                break;
            }
        }
        assert_eq!(ids, (0..600).collect::<Vec<_>>());
    }

    #[test]
    fn a_page_is_its_header_then_its_envelopes() {
        let page = Page {
            flags: pool::MORE | pool::GAP,
            cursor: 0x0102_0304_0506_0708,
            envelopes: vec![Bytes::from_static(&[9; 3]), Bytes::from_static(&[7; 2])],
        };
        let bytes = encode(&page, [18, 18, 19, 0]);
        assert_eq!(
            bytes,
            [
                &[1, 3, 1, 2, 3, 4, 5, 6, 7, 8, 18, 18, 19, 0, 0, 2][..],
                &[0, 0, 0, 3, 9, 9, 9, 0, 0, 0, 2, 7, 7],
            ]
            .concat()
        );
        // What the reserve's page counts (`Held::page_within`).
        assert_eq!(bytes.len(), PAGE_HEADER + 2 * LENGTH_LEN + 3 + 2);
        let empty = Page {
            flags: 0,
            cursor: 0,
            envelopes: vec![],
        };
        assert_eq!(encode(&empty, [0; 4]).len(), PAGE_HEADER);
    }
}
