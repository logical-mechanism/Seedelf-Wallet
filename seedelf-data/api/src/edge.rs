//! What stands between the internet and the API on the VPS (chunk 26's
//! *Tunnel and VPS*): buckets per IP, charged for requests and for the bytes
//! sent back; caps on requests in flight, each address's and every
//! address's; a deadline on a request's body, and no body at all on a route
//! that takes none, so no request is held open for good; a monthly egress
//! ceiling, shared out by day; requests a web page could make refused; and
//! CORS for the wallet's own origins. Caddy in front does TLS and its own
//! timeouts (deploy/edge/Caddyfile), and the listener its kernel deadline
//! (serve.rs), so every limit on what a client may ask is here, in code
//! anyone can audit.
//!
//! **In flight** means from when the edge lets a request in until its
//! answer has been read: handed to the connection whole, and the
//! connection asking again or ending (`Sent`, `serve::Line`). So answers
//! nobody reads count against the caps as bodies that stall do. Each
//! address has a cap in each part, and each part a total over every
//! address ([`Caps`]); the data routes also have a total on the bytes of
//! the answers they hold, and a cap on the answers compressed at once.
//! Past a total the edge answers 503 `busy`, which costs the address
//! nothing; `/health` is outside every total.
//!
//! **IPs exist only in memory:** a bucket per address while it's refilling,
//! dropped once full. Nothing here logs one.
//!
//! **Messaging is apart** (web wallet chunk 54's 54c): the relay's routes,
//! `/messaging/…`, have buckets, caps and totals of their own, so catching
//! up on messages never makes the wallet's other reads wait, and a traffic
//! ceiling of their own inside the API's, so a flood of messages can spend
//! messaging's allowance but never the rest's. The last part of each day's
//! share of that allowance is a reserve (`Reserve`): only posts and short
//! pages spend it, so a spent day stops fresh syncs before it stops
//! conversations. And it has an off switch of its own
//! (`Edge::with_messaging_off`): every relay route answers 410 Gone, and the
//! rest go on.

use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::net::{IpAddr, Ipv6Addr, SocketAddr};
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::body::{Body, Bytes, HttpBody, to_bytes};
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use http_body::{Frame, SizeHint};
use serde::{Deserialize, Serialize};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tracing::warn;

use crate::serve::{Line, Peer};

/// A bucket holds this many units, and refills this many a second. A
/// wallet paces its own requests under it (its data layer client keeps to
/// 80 units every 10 s, weighed as `weight` does), so only a scraper, a
/// loop or several wallets behind one address ever wait.
pub const CAPACITY: f64 = 300.0;
pub const REFILL: f64 = 10.0;

/// Every this many bytes sent back costs a unit more, after the answer: a
/// cheap request for a large answer costs what it sends. A bucket can go
/// below empty this way, and its client then waits until it's refilled.
pub const BYTES_PER_UNIT: f64 = 16.0 * 1024.0;

/// At most this many addresses have a bucket at once. Past it, refilled
/// buckets are dropped on the spot (at most once a second); if none are, a
/// new client is a 503.
const MAX_BUCKETS: usize = 200_000;

/// A request's body arrives whole within this long, or the request is
/// answered 408 and its connection closed. Without it a post whose body
/// stopped half way held its connection from Caddy for as long as its
/// sender liked. The largest body, 64 KiB, fits at 52 kbit/s. Not shorter:
/// the wallet reads the edge's 408 as an answer it can't be sure of.
pub const BODY_DEADLINE: Duration = Duration::from_secs(10);

/// The largest body any route takes: an evaluation's.
pub const MAX_BODY: usize = crate::submit::MAX_EVALUATE_BYTES;

/// At most this many requests from one address are in flight at once on
/// the relay's routes, and on the rest ([`IN_FLIGHT_DATA`]), counted until
/// each answer has been read [choice]. One wallet's reads fan out to under
/// 20 at once, each answered in moments, so only requests held open reach
/// a cap: bodies that stall, and answers nobody reads. Every wallet behind
/// one address (a household, a carrier's NAT) shares its caps, which is why
/// the data routes' is the wider: a 429 there sends that part of each of
/// them to Koios for 5 minutes. The relay's stays at 16 or more: an answer
/// Caddy has read whole is counted until Caddy's connection asks again, and
/// Caddy keeps a few idle for up to 2 minutes.
pub const IN_FLIGHT_MESSAGING: u32 = 16;
pub const IN_FLIGHT_DATA: u32 = 64;

/// What an answer's body holds ahead of what it has handed the connection:
/// a compressed answer's encoder finishes, and its input is freed, unless
/// its output is past about this.
const READ_AHEAD: usize = 256 * 1024;

/// The most an answer hands the connection at once.
const SLICE: usize = 16 * 1024;

/// How far an answer's body goes ahead of what the connection's socket has
/// taken: with the kernel's 64 KiB (serve.rs), what a stalled connection
/// holds besides its answer's own buffer.
const AHEAD_OF_SOCKET: u64 = 32 * 1024;

/// The edge's numbers [choice]: what one address may have in flight in each
/// part, every address together in each part, the bytes of the data
/// routes' answers held at once, and the answers compressed at once. With
/// them one part fills only with about 32 IPv4 addresses holding requests
/// open, and then refuses at once, while the other goes on; the worst case,
/// every place at its worst at once, is under 0.9 GB above the API's own.
/// The owner's to tune (config.rs).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Caps {
    /// One address's requests in flight on the relay's routes.
    pub messaging_address: u32,
    /// One address's on the rest.
    pub data_address: u32,
    /// Every address's on the relay's routes.
    pub messaging: u32,
    /// Every address's on the rest, `/health` aside.
    pub data: u32,
    /// The bytes of the data routes' answers held, not yet handed to a
    /// connection: at least 8 times the largest answer.
    pub answer_bytes: u64,
    /// Answers compressed at once: past it, an answer goes out whole,
    /// uncompressed. Each holds its encoder (about 0.7 MB for gzip) and its
    /// input.
    pub compressing: u32,
}

impl Caps {
    pub const DEFAULT: Caps = Caps {
        messaging_address: IN_FLIGHT_MESSAGING,
        data_address: IN_FLIGHT_DATA,
        messaging: 512,
        data: 2048,
        answer_bytes: 256 << 20,
        compressing: 64,
    };

    fn address(&self, part: Part) -> u32 {
        match part {
            Part::Data => self.data_address,
            Part::Messaging => self.messaging_address,
        }
    }

    fn total(&self, part: Part) -> u32 {
        match part {
            Part::Data => self.data,
            Part::Messaging => self.messaging,
        }
    }
}

/// What a request costs: answers that are the same for everyone are kept,
/// and cost home nothing; one user's query is live SQL; a submit or an
/// evaluation reaches the node.
pub fn weight(path: &str) -> f64 {
    const SHARED: [&str; 5] = [
        "tip",
        "epoch_params",
        "totals",
        "pool_list",
        "proposal_list",
    ];
    match path.strip_prefix("/api/v1/") {
        Some("submittx" | "ogmios") => 10.0,
        Some(route) if SHARED.contains(&route) => 1.0,
        Some(_) => 4.0,
        None => 1.0,
    }
}

/// The most body a request to `path` by `method` may have, if its route
/// takes one: the relay's posts, an envelope's and a certificate's, a
/// submit, an evaluation, and the public routes' POSTs. Every other request
/// that has a body is refused unread, so no route holds a body open at a
/// GET's price.
pub fn body_limit(method: &Method, path: &str) -> Option<usize> {
    if method != Method::POST {
        return None;
    }
    let relay = |route: &str| {
        path.strip_prefix("/messaging/v1/")
            .and_then(|rest| rest.strip_suffix(route))
            .is_some_and(|pool| !pool.is_empty() && !pool.contains('/'))
    };
    match path {
        // A post: a nonce and the largest envelope, or a nonce and the
        // longest certificate. An unknown pool's is the route's to answer,
        // 404.
        _ if relay("/envelopes") => Some(crate::messaging::MAX_POST),
        _ if relay("/certificates") => Some(crate::messaging::MAX_CERTIFICATE_POST),
        // Exactly a nonce and a withdrawal: the route refuses any other length.
        _ if relay("/withdrawals") => Some(crate::messaging::MAX_WITHDRAWAL_POST),
        "/api/v1/ogmios" => Some(crate::submit::MAX_EVALUATE_BYTES),
        "/api/v1/submittx" => Some(crate::submit::MAX_TX_BYTES),
        _ if crate::public::POSTS.contains(&path) => Some(crate::public::MAX_BODY),
        _ => None,
    }
}

/// Who a request is from, for its bucket: an IPv6 address by its /64,
/// which one machine holds whole. The relay counts posts by a wider key of
/// its own (`messaging::address_key`).
pub fn client_key(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => IpAddr::V4(v4),
            None => {
                let s = v6.segments();
                IpAddr::V6(Ipv6Addr::new(s[0], s[1], s[2], s[3], 0, 0, 0, 0))
            }
        },
        v4 => v4,
    }
}

struct Bucket {
    tokens: f64,
    at: Instant,
}

impl Bucket {
    fn refilled(&self, now: Instant) -> bool {
        self.tokens + now.saturating_duration_since(self.at).as_secs_f64() * REFILL >= CAPACITY
    }
}

#[derive(Default)]
struct Buckets {
    map: HashMap<IpAddr, Bucket>,
    /// When the map was last cleared of refilled buckets because it was full.
    swept: Option<Instant>,
}

/// A part's requests in flight: each address's, by its bucket's key (an
/// entry only while it has one), and every address's but `/health`'s.
#[derive(Default)]
struct Flying {
    by_address: HashMap<IpAddr, u32>,
    total: u32,
}

/// Which routes a request is for: each part has its own buckets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Part {
    /// Everything but the relay.
    Data,
    /// The relay's routes, `/messaging/…`.
    Messaging,
}

impl Part {
    pub fn of(path: &str) -> Part {
        if path.starts_with("/messaging/") {
            Part::Messaging
        } else {
            Part::Data
        }
    }
}

/// Why a request wasn't let in flight.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Crowded {
    /// Its address has its part's cap in flight: 429, a second's wait.
    Address,
    /// Every address together has the part's total: 503 `busy`.
    Everyone,
}

/// The client's address, as the edge read it, for the relay's prices.
#[derive(Debug, Clone, Copy)]
pub struct Client(pub IpAddr);

/// Said to the relay with a request while messaging's traffic for the day
/// is down to its reserve: no page longer than this many bytes is sent now.
#[derive(Debug, Clone, Copy)]
pub struct Reserved(pub usize);

/// The reserve of each day's share of messaging's traffic: what's kept for
/// conversations under way once the rest is spent.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Reserve {
    /// The part of a day's share that's kept: from 0, no reserve, to 1.
    pub part: f64,
    /// The longest page sent from it, in bytes.
    pub page: usize,
}

impl Reserve {
    /// The last tenth of a day's share, for posts and for pages of at most
    /// 16 KiB [choice]: a wallet that's caught up reads a few envelopes at
    /// a time (31 short ones, or one of 8 KiB, fit), and a fresh sync reads
    /// 256 KiB a page. So a day spent by readers stops fresh syncs first
    /// and the conversations under way last. The owner's to tune:
    /// `DATA_MESSAGING_RESERVE_PERCENT` and
    /// `DATA_MESSAGING_RESERVE_PAGE_KIB` (config.rs).
    pub const DEFAULT: Reserve = Reserve {
        part: 0.10,
        page: 16 * 1024,
    };
}

pub struct Edge {
    buckets: Mutex<Buckets>,
    messaging_buckets: Mutex<Buckets>,
    flying: Mutex<Flying>,
    messaging_flying: Mutex<Flying>,
    caps: Caps,
    /// The bytes of the data routes' answers held now (`Caps::answer_bytes`).
    answering: AtomicU64,
    /// Answers being compressed now (`Caps::compressing`).
    compressing: AtomicU32,
    /// Caddy on loopback names the client in `X-Forwarded-For`.
    trust_proxy: bool,
    /// The wallet's origins: a request from any other is refused.
    origins: Vec<String>,
    /// Every route's traffic, messaging's included.
    pub egress: Egress,
    /// The relay's traffic alone.
    pub messaging_egress: Egress,
    /// What's kept of each day's share of the relay's traffic.
    reserve: Reserve,
    /// The relay's pools stopped (`DATA_MESSAGING_OFF`): their routes answer
    /// 410 Gone, and every relay route does once all are.
    stopped: Stopped,
}

/// Which of the relay's pools Seedelf Messaging is stopped for
/// (`DATA_MESSAGING_OFF`, deploy/README.md's *Stopping Messages*): none,
/// some, or every one. Held in [`crate::messaging::POOLS`]'s order, each
/// once.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Stopped(Vec<&'static str>);

impl Stopped {
    /// Stopped for none.
    pub fn none() -> Self {
        Stopped(Vec::new())
    }

    /// Stopped for every pool: `DATA_MESSAGING_OFF=true`.
    pub fn all() -> Self {
        Stopped(
            crate::messaging::POOLS
                .iter()
                .map(|pool| pool.name)
                .collect(),
        )
    }

    /// Stopped for each pool `names` names, each a pool's name and named
    /// once; or the name that isn't one, or is named twice.
    pub fn of<'a>(names: impl IntoIterator<Item = &'a str>) -> Result<Self, &'a str> {
        let mut named: Vec<&'static str> = Vec::new();
        for name in names {
            let pool = crate::messaging::POOLS
                .iter()
                .map(|pool| pool.name)
                .find(|pool| *pool == name)
                .ok_or(name)?;
            if named.contains(&pool) {
                return Err(name);
            }
            named.push(pool);
        }
        Ok(Stopped(
            crate::messaging::POOLS
                .iter()
                .map(|pool| pool.name)
                .filter(|pool| named.contains(pool))
                .collect(),
        ))
    }

    /// Whether the pool `name` is stopped.
    pub fn pool(&self, name: &str) -> bool {
        self.0.contains(&name)
    }

    /// Whether every pool is: then every route under `/messaging/` answers
    /// 410, as `true` always made it.
    pub fn every(&self) -> bool {
        crate::messaging::POOLS
            .iter()
            .all(|pool| self.pool(pool.name))
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// The pools stopped, comma-separated, as the variable names them:
    /// for the start's log line.
    pub fn names(&self) -> String {
        self.0.join(",")
    }

    /// Whether a request to `path`, under `/messaging/`, is a stopped
    /// pool's: every one is once all are; else one under
    /// `/messaging/v1/{pool}/` for a pool that's stopped. A path that names
    /// no pool is then the routes' to answer, as with none stopped.
    fn stops(&self, path: &str) -> bool {
        if self.every() {
            return true;
        }
        path.strip_prefix("/messaging/v1/")
            .and_then(|rest| rest.split_once('/'))
            .is_some_and(|(pool, _)| self.pool(pool))
    }
}

impl Edge {
    pub fn new(trust_proxy: bool, origins: Vec<String>, egress: Egress) -> Self {
        Edge {
            buckets: Mutex::new(Buckets::default()),
            messaging_buckets: Mutex::new(Buckets::default()),
            flying: Mutex::new(Flying::default()),
            messaging_flying: Mutex::new(Flying::default()),
            caps: Caps::DEFAULT,
            answering: AtomicU64::new(0),
            compressing: AtomicU32::new(0),
            trust_proxy,
            origins,
            egress,
            messaging_egress: Egress::new(None, None),
            reserve: Reserve::DEFAULT,
            stopped: Stopped::none(),
        }
    }

    /// Seedelf Messaging stopped for every pool, or for none: the relay's
    /// off switch as `true` or `false` sets it ([`Edge::with_stopped`]).
    pub fn with_messaging_off(self, off: bool) -> Self {
        self.with_stopped(if off { Stopped::all() } else { Stopped::none() })
    }

    /// The relay's off switch (`DATA_MESSAGING_OFF`, deploy/README.md's
    /// *Stopping Messages*), for the pools `stopped` names. A stopped pool's
    /// routes, `/messaging/v1/{pool}/…`, answer 410 Gone, which tells the
    /// wallet Messages is stopped on that network (protocol.md's freeze of
    /// `/messaging/v1/`): it posts nothing there, solves nothing, and asks
    /// again now and then. A post is refused unread, so nothing is kept;
    /// the pools' files wait on disk, and what they hold expires as ever.
    /// The other pool's routes answer as ever; once every pool is stopped,
    /// every route under `/messaging/` answers 410.
    pub fn with_stopped(mut self, stopped: Stopped) -> Self {
        self.stopped = stopped;
        self
    }

    /// Whether Seedelf Messaging is stopped for every pool.
    pub fn messaging_off(&self) -> bool {
        self.stopped.every()
    }

    /// The pools Seedelf Messaging is stopped for.
    pub fn stopped(&self) -> &Stopped {
        &self.stopped
    }

    /// The relay's own ceiling, inside the API's.
    pub fn with_messaging_egress(mut self, egress: Egress) -> Self {
        self.messaging_egress = egress;
        self
    }

    /// Another reserve of the relay's day than [`Reserve::DEFAULT`].
    pub fn with_reserve(mut self, reserve: Reserve) -> Self {
        self.reserve = reserve;
        self
    }

    /// Other caps than [`Caps::DEFAULT`]: the environment's, or a test's.
    pub fn with_caps(mut self, caps: Caps) -> Self {
        self.caps = caps;
        self
    }

    pub fn caps(&self) -> Caps {
        self.caps
    }

    /// Whether messaging's traffic for the day is down to its reserve: only
    /// with a ceiling of its own, since without one there's no day's share.
    pub fn reserved(&self) -> bool {
        self.messaging_egress
            .today()
            .is_some_and(|(spent, share)| spent as f64 >= share as f64 * (1.0 - self.reserve.part))
    }

    fn buckets_of(&self, part: Part) -> &Mutex<Buckets> {
        match part {
            Part::Data => &self.buckets,
            Part::Messaging => &self.messaging_buckets,
        }
    }

    fn flying_of(&self, part: Part) -> &Mutex<Flying> {
        match part {
            Part::Data => &self.flying,
            Part::Messaging => &self.messaging_flying,
        }
    }

    /// Counts one more request from `ip` in flight in `part`, until what's
    /// returned is dropped, or refuses it: its address has the part's cap
    /// in flight already, or every address together has the part's total.
    pub fn enter(self: &Arc<Self>, part: Part, ip: IpAddr) -> Result<InFlight, Crowded> {
        self.enter_as(part, ip, true)
    }

    /// [`Edge::enter`], counted in the part's total or not (`/health`).
    fn enter_as(
        self: &Arc<Self>,
        part: Part,
        ip: IpAddr,
        total: bool,
    ) -> Result<InFlight, Crowded> {
        let key = client_key(ip);
        let mut flying = self.flying_of(part).lock().expect("flying lock");
        let mine = flying.by_address.get(&key).copied().unwrap_or(0);
        if mine >= self.caps.address(part) {
            return Err(Crowded::Address);
        }
        if total && flying.total >= self.caps.total(part) {
            return Err(Crowded::Everyone);
        }
        flying.by_address.insert(key, mine + 1);
        if total {
            flying.total += 1;
        }
        Ok(InFlight {
            edge: self.clone(),
            part,
            key,
            total,
        })
    }

    /// How many requests are in flight in `part`, from every address,
    /// `/health`'s included.
    pub fn in_flight(&self, part: Part) -> u32 {
        let flying = self.flying_of(part).lock().expect("flying lock");
        flying.by_address.values().sum()
    }

    /// The bytes of the data routes' answers held now, not yet handed to a
    /// connection.
    pub fn answer_bytes(&self) -> u64 {
        self.answering.load(Ordering::Relaxed)
    }

    /// How many answers are being compressed now.
    pub fn compressing(&self) -> u32 {
        self.compressing.load(Ordering::Relaxed)
    }

    /// A place among the answers compressed at once, if there's one.
    fn compress(self: &Arc<Self>) -> Option<Compressing> {
        let mut now = self.compressing.load(Ordering::Relaxed);
        loop {
            if now >= self.caps.compressing {
                return None;
            }
            match self.compressing.compare_exchange_weak(
                now,
                now + 1,
                Ordering::AcqRel,
                Ordering::Relaxed,
            ) {
                Ok(_) => return Some(Compressing(self.clone())),
                Err(seen) => now = seen,
            }
        }
    }

    /// Takes `weight` from `ip`'s bucket, or says how many seconds until it can.
    pub fn take(&self, ip: IpAddr, weight: f64, now: Instant) -> Result<(), Refusal> {
        self.take_in(Part::Data, ip, weight, now)
    }

    /// [`Edge::take`] from `part`'s buckets.
    pub fn take_in(
        &self,
        part: Part,
        ip: IpAddr,
        weight: f64,
        now: Instant,
    ) -> Result<(), Refusal> {
        let mut buckets = self.buckets_of(part).lock().expect("buckets lock");
        let key = client_key(ip);
        if !buckets.map.contains_key(&key) && buckets.map.len() >= MAX_BUCKETS {
            let recently = buckets
                .swept
                .is_some_and(|at| now.saturating_duration_since(at) < Duration::from_secs(1));
            if !recently {
                buckets.map.retain(|_, b| !b.refilled(now));
                buckets.swept = Some(now);
            }
            if buckets.map.len() >= MAX_BUCKETS {
                return Err(Refusal::Full);
            }
        }
        let bucket = buckets.map.entry(key).or_insert(Bucket {
            tokens: CAPACITY,
            at: now,
        });
        let elapsed = now.saturating_duration_since(bucket.at).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * REFILL).min(CAPACITY);
        bucket.at = now;
        if bucket.tokens >= weight {
            bucket.tokens -= weight;
            Ok(())
        } else {
            Err(Refusal::Wait(
                ((weight - bucket.tokens) / REFILL).ceil().max(1.0) as u64,
            ))
        }
    }

    /// Charges `ip`'s bucket for `bytes` sent back to it; it may go below empty,
    /// to at most a full bucket's worth.
    pub fn charge(&self, ip: IpAddr, bytes: usize) {
        self.charge_in(Part::Data, ip, bytes);
    }

    /// [`Edge::charge`] to `part`'s buckets.
    pub fn charge_in(&self, part: Part, ip: IpAddr, bytes: usize) {
        let mut buckets = self.buckets_of(part).lock().expect("buckets lock");
        if let Some(bucket) = buckets.map.get_mut(&client_key(ip)) {
            bucket.tokens = (bucket.tokens - bytes as f64 / BYTES_PER_UNIT).max(-CAPACITY);
        }
    }

    /// Forgets every bucket that has refilled: its address is gone from memory.
    pub fn sweep(&self, now: Instant) {
        for part in [Part::Data, Part::Messaging] {
            let mut buckets = self.buckets_of(part).lock().expect("buckets lock");
            buckets.map.retain(|_, b| !b.refilled(now));
        }
    }

    pub fn buckets(&self) -> usize {
        self.buckets.lock().expect("buckets lock").map.len()
    }

    pub fn messaging_buckets(&self) -> usize {
        self.messaging_buckets
            .lock()
            .expect("buckets lock")
            .map
            .len()
    }

    /// The client's address: the peer's, or Caddy's last `X-Forwarded-For`
    /// entry (the address Caddy itself saw) when the peer is Caddy on loopback.
    fn client(&self, request: &Request) -> Option<IpAddr> {
        let extensions = request.extensions();
        let peer = match extensions.get::<ConnectInfo<Peer>>() {
            Some(ConnectInfo(peer)) => peer.addr,
            None => extensions.get::<ConnectInfo<SocketAddr>>()?.0,
        }
        .ip();
        if !(self.trust_proxy && peer.is_loopback()) {
            return Some(peer);
        }
        let forwarded = request
            .headers()
            .get_all("x-forwarded-for")
            .iter()
            .filter_map(|value| value.to_str().ok())
            .flat_map(|value| value.split(','))
            .next_back()
            .and_then(|ip| ip.trim().parse().ok());
        Some(forwarded.unwrap_or(peer))
    }

    /// A request a web page made rather than the wallet: a browser's fetch
    /// that isn't CORS (an image, a `no-cors` fetch, a page load), or one from
    /// an origin that isn't the wallet's. The browser would hide the answer
    /// from the page, but it would still be sent: any site's visitors could
    /// spend the month's traffic. The wallet's own fetches are CORS, from its
    /// origin; a request with neither header (curl, a monitor) passes.
    fn made_by_a_page(&self, request: &Request) -> bool {
        let header = |name: &str| {
            request
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
        };
        let not_cors = header("sec-fetch-mode").is_some_and(|mode| mode != "cors");
        let elsewhere = !self.origins.is_empty()
            && header("origin").is_some_and(|origin| !self.origins.iter().any(|o| o == origin));
        not_cors || elsewhere
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    /// Over the limit: try again in this many seconds.
    Wait(u64),
    /// Too many addresses at once.
    Full,
}

/// A request in flight, counted for its address and its part
/// ([`Edge::enter`]) until this is dropped.
pub struct InFlight {
    edge: Arc<Edge>,
    part: Part,
    key: IpAddr,
    /// Counted in the part's total.
    total: bool,
}

impl Drop for InFlight {
    fn drop(&mut self) {
        let mut flying = self
            .edge
            .flying_of(self.part)
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(count) = flying.by_address.get_mut(&self.key) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                flying.by_address.remove(&self.key);
            }
        }
        if self.total {
            flying.total = flying.total.saturating_sub(1);
        }
    }
}

/// A place among the answers compressed at once, until this is dropped.
struct Compressing(Arc<Edge>);

impl Drop for Compressing {
    fn drop(&mut self) {
        self.0.compressing.fetch_sub(1, Ordering::AcqRel);
    }
}

/// Whether a request's `Accept-Encoding` lets its answer be compressed:
/// gzip is the one encoding the API compresses with.
fn asks_compression(headers: &HeaderMap) -> bool {
    headers
        .get_all(header::ACCEPT_ENCODING)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .filter_map(|item| item.split(';').next())
        .map(str::trim)
        .any(|name| {
            name.eq_ignore_ascii_case("gzip") || name.eq_ignore_ascii_case("x-gzip") || name == "*"
        })
}

/// The limits, in front of every route. `/health` is exempt from the page
/// check, the egress ceiling and the totals, so a monitor (or a browser tab,
/// or the deploy's own check) can always read it.
pub async fn limit(State(edge): State<Arc<Edge>>, mut request: Request, next: Next) -> Response {
    let (health, part, weight, takes, submit) = {
        let path = request.uri().path();
        let part = Part::of(path);
        let weight = match part {
            Part::Data => weight(path),
            Part::Messaging => crate::messaging::weight(request.method() == Method::POST),
        };
        let submit = matches!(path, "/api/v1/submittx" | "/api/v1/ogmios");
        (
            path == "/health",
            part,
            weight,
            body_limit(request.method(), path),
            submit,
        )
    };
    if !health && edge.made_by_a_page(&request) {
        let body = axum::Json(serde_json::json!({ "error": "only Seedelf Wallet reads this" }));
        return (StatusCode::FORBIDDEN, body).into_response();
    }
    // A relay path spelled with a percent-encoding is refused: the routes
    // decode a pool's name, and the off switch's check below reads the path
    // as sent, so `pre%70rod` would walk past it. The wallet never sends
    // one.
    if part == Part::Messaging && request.uri().path().contains('%') {
        let body = axum::Json(serde_json::json!({ "error": "encoded paths aren't taken here" }));
        return (StatusCode::BAD_REQUEST, body).into_response();
    }
    // Before every other limit, so a wallet learns it whatever its bucket
    // or the day's traffic, and before the body is read, so a post's is
    // never looked at.
    if part == Part::Messaging && edge.stopped.stops(request.uri().path()) {
        let body = axum::Json(serde_json::json!({ "error": "messaging is stopped" }));
        return (StatusCode::GONE, body).into_response();
    }
    if !health && edge.egress.over() {
        return refuse(
            StatusCode::SERVICE_UNAVAILABLE,
            "over the traffic allowance",
            3600,
        );
    }
    if part == Part::Messaging && edge.messaging_egress.over() {
        return refuse(
            StatusCode::SERVICE_UNAVAILABLE,
            "messaging is over its traffic allowance",
            3600,
        );
    }
    // A body on a route that takes none, or one longer than its route
    // takes by its own length, is refused unread, before the address is
    // counted or charged: no request holds a body open but a route's own,
    // at its own price.
    let has_body = !request.body().is_end_stream();
    if has_body {
        let Some(most) = takes else {
            return refuse_unread(StatusCode::BAD_REQUEST, "this route takes no body");
        };
        if request.body().size_hint().lower() > most as u64 {
            return too_large();
        }
    }
    if part == Part::Data && !health && edge.answer_bytes() >= edge.caps.answer_bytes {
        return refuse(StatusCode::SERVICE_UNAVAILABLE, "busy", 30);
    }
    // A request with no address (none reaches the server so) takes no bucket
    // and no place in flight.
    let ip = edge.client(&request);
    let mut flying = None;
    if let Some(ip) = ip {
        // Before the bucket: a request refused here costs its address nothing.
        match edge.enter_as(part, ip, !health) {
            Ok(entered) => flying = Some(entered),
            Err(Crowded::Address) => {
                return refuse(
                    StatusCode::TOO_MANY_REQUESTS,
                    "too many requests at once",
                    1,
                );
            }
            Err(Crowded::Everyone) => return refuse(StatusCode::SERVICE_UNAVAILABLE, "busy", 30),
        }
        match edge.take_in(part, ip, weight, Instant::now()) {
            Ok(()) => {}
            Err(Refusal::Wait(secs)) => {
                return refuse(StatusCode::TOO_MANY_REQUESTS, "slow down", secs);
            }
            Err(Refusal::Full) => return refuse(StatusCode::SERVICE_UNAVAILABLE, "busy", 30),
        }
        request.extensions_mut().insert(Client(ip));
    }
    if part == Part::Messaging && edge.reserved() {
        request.extensions_mut().insert(Reserved(edge.reserve.page));
    }
    // At most so many answers are compressed at once: past it, the answer
    // goes out whole, as if the client had asked for no encoding. The
    // place is kept only by an answer that comes back compressed.
    let compressing = if asks_compression(request.headers()) {
        let place = edge.compress();
        if place.is_none() {
            request.headers_mut().remove(header::ACCEPT_ENCODING);
        }
        place
    } else {
        None
    };
    let line = request
        .extensions()
        .get::<ConnectInfo<Peer>>()
        .map(|ConnectInfo(peer)| peer.line.clone());
    // A body is read here, whole and within its deadline, and handed on in
    // one piece: no route waits on a client that stopped half way.
    if has_body && let Some(most) = takes {
        let (parts, body) = request.into_parts();
        let body = match tokio::time::timeout(BODY_DEADLINE, to_bytes(body, most)).await {
            Ok(Ok(body)) => body,
            Ok(Err(error)) => return unread(error),
            Err(_) => return late(),
        };
        request = Request::from_parts(parts, Body::from(body));
    }
    let response = next.run(request).await;
    let (parts, body) = response.into_parts();
    let compressing = compressing.filter(|_| parts.headers.contains_key(header::CONTENT_ENCODING));
    // A data answer whose whole length is known is counted at once; past the
    // total it isn't sent. A submit's is a few bytes, and its wallet would
    // take a refusal as never sent.
    let known = match part {
        Part::Data => body.size_hint().exact(),
        Part::Messaging => None,
    };
    if let Some(bytes) = known
        && !submit
        && edge.answer_bytes().saturating_add(bytes) > edge.caps.answer_bytes
    {
        return refuse(StatusCode::SERVICE_UNAVAILABLE, "busy", 30);
    }
    let sent = Sent::new(body, edge, part, ip, flying, line, compressing, known);
    Response::from_parts(parts, Body::new(sent))
}

/// Every answer's body as the edge hands it on. It pulls from the route's
/// answer up to [`READ_AHEAD`] ahead, charging the address's bucket for
/// each piece as it's pulled, and drops the answer once it ends (and with
/// it an encoder and its input). It hands the connection at most [`SLICE`]
/// at a time, and only [`AHEAD_OF_SOCKET`] ahead of what the connection's
/// socket has taken (`serve::Line`), counting the month's traffic as it
/// does. Handed whole, its request stays in flight, parked on the
/// connection, until the connection asks again or ends. Without a
/// connection's record (a test's), it hands whatever it has.
pub struct Sent {
    /// The route's answer, until it ends.
    inner: Option<Body>,
    /// What's been pulled and not yet handed, the oldest first.
    ahead: VecDeque<Bytes>,
    /// Its bytes.
    held: usize,
    /// The answer's trailers, if it has any, handed after its data.
    trailers: Option<HeaderMap>,
    /// What's been handed, in bytes.
    handed: u64,
    /// The connection's record, and what its socket had taken when this
    /// answer began.
    line: Option<(Arc<Line>, u64)>,
    /// The request's place in flight, until it's parked.
    flying: Option<InFlight>,
    edge: Arc<Edge>,
    part: Part,
    ip: Option<IpAddr>,
    /// What this answer adds to the data routes' answer bytes now.
    counted: u64,
    /// Its whole length was counted from the start: an answer of known
    /// length, whole in memory.
    known: bool,
    /// Its place among the answers compressed at once, until its encoder
    /// is done.
    compressing: Option<Compressing>,
}

impl Sent {
    #[allow(clippy::too_many_arguments)]
    fn new(
        inner: Body,
        edge: Arc<Edge>,
        part: Part,
        ip: Option<IpAddr>,
        flying: Option<InFlight>,
        line: Option<Arc<Line>>,
        compressing: Option<Compressing>,
        known: Option<u64>,
    ) -> Self {
        let mut sent = Sent {
            inner: Some(inner),
            ahead: VecDeque::new(),
            held: 0,
            trailers: None,
            handed: 0,
            line: line.map(|line| {
                let start = line.written();
                (line, start)
            }),
            flying,
            edge,
            part,
            ip,
            counted: 0,
            known: known.is_some(),
            compressing,
        };
        if let Some(bytes) = known {
            sent.count(bytes);
        }
        sent
    }

    /// Adds `bytes` to the data routes' answer bytes.
    fn count(&mut self, bytes: u64) {
        if self.part == Part::Data {
            self.edge.answering.fetch_add(bytes, Ordering::Relaxed);
            self.counted += bytes;
        }
    }

    /// The route's answer has ended: it, and its place among the
    /// compressions, go.
    fn ended(&mut self) {
        self.inner = None;
        self.compressing = None;
    }

    /// Pulls what the route's answer has ready, up to [`READ_AHEAD`] ahead.
    /// Past the data routes' answer bytes, a compressed answer pulls only
    /// when it holds nothing.
    fn pull(&mut self, cx: &mut Context<'_>) -> Result<(), axum::Error> {
        while let Some(inner) = self.inner.as_mut() {
            let over = self.part == Part::Data
                && !self.known
                && self.edge.answer_bytes() >= self.edge.caps.answer_bytes;
            if self.held >= READ_AHEAD || (over && self.held > 0) {
                break;
            }
            match Pin::new(inner).poll_frame(cx) {
                Poll::Pending => break,
                Poll::Ready(None) => self.ended(),
                Poll::Ready(Some(Err(error))) => {
                    self.ended();
                    return Err(error);
                }
                Poll::Ready(Some(Ok(frame))) => {
                    match frame.into_data() {
                        Ok(data) => {
                            if let Some(ip) = self.ip {
                                self.edge.charge_in(self.part, ip, data.len());
                            }
                            if !self.known {
                                self.count(data.len() as u64);
                            }
                            self.held += data.len();
                            if !data.is_empty() {
                                self.ahead.push_back(data);
                            }
                        }
                        Err(frame) => {
                            if let Ok(trailers) = frame.into_trailers() {
                                self.trailers = Some(trailers);
                            }
                        }
                    }
                    if self.inner.as_ref().is_some_and(HttpBody::is_end_stream) {
                        self.ended();
                    }
                }
            }
        }
        Ok(())
    }

    /// Whether the connection has taken enough to be handed more; if not,
    /// it's woken at the socket's next write.
    fn may_hand(&self, cx: &mut Context<'_>) -> bool {
        let Some((line, start)) = &self.line else {
            return true;
        };
        let allowed = |written: u64| written.saturating_sub(*start) + AHEAD_OF_SOCKET;
        if self.handed <= allowed(line.written()) {
            return true;
        }
        line.wake_on_write(cx.waker());
        // Taken meanwhile: no wake comes for that.
        self.handed <= allowed(line.written())
    }

    /// Counts `bytes` handed to the connection.
    fn hand(&mut self, bytes: usize) {
        self.handed += bytes as u64;
        self.held -= bytes;
        self.edge.egress.add(bytes as u64);
        if self.part == Part::Messaging {
            self.edge.messaging_egress.add(bytes as u64);
        }
        let off = self.counted.min(bytes as u64);
        if off > 0 {
            self.edge.answering.fetch_sub(off, Ordering::Relaxed);
            self.counted -= off;
        }
    }

    fn done(&self) -> bool {
        self.ahead.is_empty()
            && self.trailers.is_none()
            && self.inner.as_ref().is_none_or(HttpBody::is_end_stream)
    }

    /// Handed whole: the request stays in flight, parked on its connection,
    /// until the connection asks again or ends.
    fn finish(&mut self) {
        if let Some(flying) = self.flying.take()
            && let Some((line, _)) = &self.line
        {
            line.park(flying);
        }
    }
}

impl HttpBody for Sent {
    type Data = Bytes;
    type Error = axum::Error;

    fn poll_frame(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, axum::Error>>> {
        let this = self.get_mut();
        if let Err(error) = this.pull(cx) {
            return Poll::Ready(Some(Err(error)));
        }
        if !this.ahead.is_empty() {
            if !this.may_hand(cx) {
                return Poll::Pending;
            }
            let front = this.ahead.front_mut().expect("a piece ahead");
            let slice = if front.len() > SLICE {
                front.split_to(SLICE)
            } else {
                this.ahead.pop_front().expect("a piece ahead")
            };
            this.hand(slice.len());
            if this.done() {
                this.finish();
            }
            return Poll::Ready(Some(Ok(Frame::data(slice))));
        }
        if this.inner.is_some() {
            return Poll::Pending;
        }
        let trailers = this.trailers.take();
        this.finish();
        Poll::Ready(trailers.map(|trailers| Ok(Frame::trailers(trailers))))
    }

    fn is_end_stream(&self) -> bool {
        self.done()
    }

    fn size_hint(&self) -> SizeHint {
        let held = self.held as u64;
        let Some(inner) = &self.inner else {
            return SizeHint::with_exact(held);
        };
        let rest = inner.size_hint();
        let mut hint = SizeHint::new();
        if let Some(upper) = rest.upper() {
            hint.set_upper(upper + held);
        }
        hint.set_lower(rest.lower() + held);
        hint
    }
}

impl Drop for Sent {
    fn drop(&mut self) {
        if self.counted > 0 {
            self.edge
                .answering
                .fetch_sub(self.counted, Ordering::Relaxed);
        }
    }
}

/// The answer to a request whose body didn't arrive within
/// [`BODY_DEADLINE`]: a 408, and its connection closed (hyper closes one
/// whose request it hasn't read whole; the header says so to Caddy).
fn late() -> Response {
    refuse_unread(
        StatusCode::REQUEST_TIMEOUT,
        "the request's body didn't arrive in time",
    )
}

/// A 413: a body longer than its route takes, by its own length or as it
/// was read.
fn too_large() -> Response {
    refuse_unread(
        StatusCode::PAYLOAD_TOO_LARGE,
        "the body is larger than this route takes",
    )
}

/// The answer to a body the edge couldn't read: a 413 past its route's
/// limit, and a 408 for one that broke off, never a 400, which the wallet
/// would read as refused for good.
fn unread(error: axum::Error) -> Response {
    if error.into_inner().is::<http_body_util::LengthLimitError>() {
        too_large()
    } else {
        refuse_unread(
            StatusCode::REQUEST_TIMEOUT,
            "the request's body didn't arrive",
        )
    }
}

/// An answer to a request whose body isn't read, or wasn't whole: its
/// connection closed after it.
fn refuse_unread(status: StatusCode, error: &'static str) -> Response {
    let mut response = (status, axum::Json(serde_json::json!({ "error": error }))).into_response();
    response
        .headers_mut()
        .insert(header::CONNECTION, HeaderValue::from_static("close"));
    response
}

fn refuse(status: StatusCode, error: &'static str, retry_after: u64) -> Response {
    let mut response = (status, axum::Json(serde_json::json!({ "error": error }))).into_response();
    if let Ok(value) = HeaderValue::from_str(&retry_after.to_string()) {
        response.headers_mut().insert(header::RETRY_AFTER, value);
    }
    response
}

/// CORS for the wallet's own origins (`chrome-extension://<id>`), so it reads
/// the API with no host permission: no install warning, and nothing new in
/// the store's host-permission box. `Retry-After` is exposed: the wallet
/// waits as long as a 429 or 503 says.
pub fn cors(origins: &[String]) -> CorsLayer {
    let origins: Vec<HeaderValue> = origins
        .iter()
        .filter_map(|origin| HeaderValue::from_str(origin).ok())
        .collect();
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::CONTENT_TYPE])
        .expose_headers([header::RETRY_AFTER])
        .max_age(Duration::from_secs(86_400))
}

/// The API's own traffic this calendar month (UTC), against a ceiling, so no
/// bill can surprise anyone. Each day gets an equal share of what's left of
/// the month, so a flood costs a day, not the rest of the month. Kept in a
/// file, so a restart doesn't forget it. TLS and headers aren't counted here:
/// the VPS's own meter is for that (deploy/README.md).
pub struct Egress {
    ceiling: Option<u64>,
    bytes: AtomicU64,
    /// The count stops here today: today's share of what was left at its start.
    today_limit: AtomicU64,
    /// Where the count stood when today began (`Kept::day_start`, to read
    /// without its lock).
    today_start: AtomicU64,
    held: Mutex<Kept>,
    file: Option<PathBuf>,
}

/// What's written down: the month and its count, and where today started.
#[derive(Clone, Serialize, Deserialize)]
struct Kept {
    month: String,
    bytes: u64,
    #[serde(default)]
    day: i64,
    #[serde(default)]
    day_start: u64,
}

impl Egress {
    /// `ceiling` in bytes, if there's one; `file` where the count is kept.
    pub fn new(ceiling: Option<u64>, file: Option<PathBuf>) -> Self {
        Self::new_at(ceiling, file, unix_now())
    }

    /// [`Egress::new`] as of `now`, a Unix time.
    fn new_at(ceiling: Option<u64>, file: Option<PathBuf>, now: i64) -> Self {
        let read = file.as_ref().and_then(|path| match std::fs::read(path) {
            Ok(bytes) => {
                let kept = serde_json::from_slice::<Kept>(&bytes).ok();
                if kept.is_none() {
                    warn!("the month's traffic couldn't be read, so it counts from zero");
                }
                kept
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => {
                warn!(kind = %error.kind(), "the month's traffic couldn't be read, so it counts from zero");
                None
            }
        });
        let kept = read
            .filter(|kept| kept.month == month_of(now))
            .unwrap_or_else(|| Kept {
                month: month_of(now),
                bytes: 0,
                day: day_of(now),
                day_start: 0,
            });
        let egress = Egress {
            ceiling,
            bytes: AtomicU64::new(kept.bytes),
            today_limit: AtomicU64::new(u64::MAX),
            today_start: AtomicU64::new(0),
            held: Mutex::new(kept),
            file,
        };
        egress.roll(now);
        egress
    }

    /// A ceiling whose share for today is `share` bytes, whatever the day of
    /// the month, kept in no file: a test's. With a fixed ceiling a day's
    /// share is a thirty-first of it on the 1st and all of it on the last,
    /// so a test that spends or keeps under "the day's share" would pass or
    /// fail by the date.
    pub fn with_share_today(share: u64) -> Self {
        // One reading of the clock for both, so midnight can't fall between.
        let now = unix_now();
        Self::new_at(Some(share.saturating_mul(days_left(now))), None, now)
    }

    pub fn add(&self, bytes: u64) {
        self.bytes.fetch_add(bytes, Ordering::Relaxed);
    }

    pub fn used(&self) -> u64 {
        self.bytes.load(Ordering::Relaxed)
    }

    /// Past the month's ceiling, or past today's share of it.
    pub fn over(&self) -> bool {
        self.ceiling.is_some_and(|ceiling| {
            let used = self.used();
            used >= ceiling || used >= self.today_limit.load(Ordering::Relaxed)
        })
    }

    /// Whether there's a ceiling at all.
    pub fn has_ceiling(&self) -> bool {
        self.ceiling.is_some()
    }

    /// What today has spent, and today's share: nothing without a ceiling.
    pub fn today(&self) -> Option<(u64, u64)> {
        self.ceiling?;
        let start = self.today_start.load(Ordering::Relaxed);
        let share = self
            .today_limit
            .load(Ordering::Relaxed)
            .saturating_sub(start);
        Some((self.used().saturating_sub(start).min(share), share))
    }

    /// What's left of today's share, in bytes: nothing without a ceiling.
    pub fn left_today(&self) -> Option<u64> {
        self.today().map(|(spent, share)| share - spent)
    }

    /// Starts a new month's or a new day's count when one has begun, and sets today's share.
    fn roll(&self, now: i64) {
        let mut held = self.held.lock().expect("egress lock");
        let month = month_of(now);
        if held.month != month {
            self.bytes.store(0, Ordering::Relaxed);
            *held = Kept {
                month,
                bytes: 0,
                day: day_of(now),
                day_start: 0,
            };
        } else if held.day != day_of(now) {
            held.day = day_of(now);
            held.day_start = self.used();
        }
        held.bytes = self.used();
        if let Some(ceiling) = self.ceiling {
            let left = ceiling.saturating_sub(held.day_start);
            let share = left / days_left(now).max(1);
            self.today_start.store(held.day_start, Ordering::Relaxed);
            self.today_limit
                .store(held.day_start.saturating_add(share), Ordering::Relaxed);
        }
    }

    /// Rolls the day or month over if it's time, and writes the count down.
    pub fn flush(&self) {
        self.roll(unix_now());
        let Some(path) = &self.file else { return };
        let kept = self.held.lock().expect("egress lock").clone();
        let partial = path.with_extension("partial");
        let written = serde_json::to_vec(&kept)
            .map_err(std::io::Error::other)
            .and_then(|bytes| {
                let mut file = std::fs::File::create(&partial)?;
                file.write_all(&bytes)?;
                file.sync_all()?;
                std::fs::rename(&partial, path)
            });
        if let Err(error) = written {
            // Nothing left behind to fill a disk that's nearly full.
            let _ = std::fs::remove_file(&partial);
            warn!(kind = %error.kind(), "the month's traffic couldn't be written down");
        }
    }
}

/// Every minute: forget refilled buckets, and write the month's traffic down.
pub async fn keep(edge: Arc<Edge>) {
    let mut every = tokio::time::interval(Duration::from_secs(60));
    every.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        every.tick().await;
        edge.sweep(Instant::now());
        edge.egress.flush();
        edge.messaging_egress.flush();
    }
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

fn day_of(unix: i64) -> i64 {
    unix.div_euclid(86_400)
}

/// The UTC date of a Unix time: year, month, day (Howard Hinnant's days-to-civil).
fn civil(unix: i64) -> (i64, i64, i64) {
    let z = day_of(unix) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// `YYYY-MM` of a Unix time, in UTC.
fn month_of(unix: i64) -> String {
    let (year, month, _) = civil(unix);
    format!("{year:04}-{month:02}")
}

/// The days left in the month of a Unix time, today included.
fn days_left(unix: i64) -> u64 {
    let (year, month, day) = civil(unix);
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let length = match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    (length - day + 1) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edge() -> Edge {
        Edge::new(true, vec![], Egress::new(None, None))
    }

    #[test]
    fn a_bucket_empties_then_refills() {
        let edge = edge();
        let ip: IpAddr = "203.0.113.7".parse().unwrap();
        let start = Instant::now();
        for _ in 0..75 {
            assert_eq!(edge.take(ip, 4.0, start), Ok(()));
        }
        assert_eq!(edge.take(ip, 4.0, start), Err(Refusal::Wait(1)));
        assert_eq!(edge.take(ip, 10.0, start), Err(Refusal::Wait(1)));
        // Another address has its own.
        assert_eq!(
            edge.take("203.0.113.8".parse().unwrap(), 4.0, start),
            Ok(())
        );
        let later = start + Duration::from_secs(1);
        assert_eq!(edge.take(ip, 10.0, later), Ok(()));
    }

    #[test]
    fn large_answers_cost_what_they_send() {
        let edge = edge();
        let ip: IpAddr = "203.0.113.7".parse().unwrap();
        let start = Instant::now();
        edge.take(ip, 1.0, start).unwrap();
        // 10 MB sent back: 640 units, past empty, to a full bucket below it.
        edge.charge(ip, 10 << 20);
        assert_eq!(edge.take(ip, 1.0, start), Err(Refusal::Wait(31)));
        // An address with no bucket isn't given one by a charge.
        edge.charge("203.0.113.9".parse().unwrap(), 1 << 20);
        assert_eq!(edge.buckets(), 1);
    }

    #[test]
    fn an_ipv6_machine_is_its_64() {
        let a: IpAddr = "2001:db8:1:2::1".parse().unwrap();
        let b: IpAddr = "2001:db8:1:2:ffff::9".parse().unwrap();
        assert_eq!(client_key(a), client_key(b));
        assert_ne!(
            client_key(a),
            client_key("2001:db8:1:3::1".parse().unwrap())
        );
        let mapped: IpAddr = "::ffff:203.0.113.7".parse().unwrap();
        assert_eq!(client_key(mapped), "203.0.113.7".parse::<IpAddr>().unwrap());
    }

    /// The off switch by pool: a stopped pool's routes, and only its, under
    /// `/messaging/v1/{pool}/`; every route under `/messaging/` once both
    /// are, as `true` makes it; and a name list that isn't one refused.
    #[test]
    fn a_pool_is_stopped_alone_and_every_relay_route_once_both_are() {
        let preprod = Stopped::of(["preprod"]).unwrap();
        for path in [
            "/messaging/v1/preprod/envelopes",
            "/messaging/v1/preprod/certificates",
            "/messaging/v1/preprod/withdrawals",
            "/messaging/v1/preprod/anything",
        ] {
            assert!(preprod.stops(path), "{path}");
        }
        for path in [
            "/messaging/v1/mainnet/envelopes",
            "/messaging/v1/mainnet/certificates",
            "/messaging/v1/mainnet/withdrawals",
            "/messaging/v1/elsewhere/envelopes",
            "/messaging/v1/preprodx/envelopes",
            "/messaging/v2/preprod/envelopes",
            "/messaging/v1/preprod",
        ] {
            assert!(!preprod.stops(path), "{path}");
        }
        assert!(!preprod.every() && preprod.pool("preprod") && !preprod.pool("mainnet"));
        // Both, in either order, are `true`.
        for both in [
            Stopped::of(["preprod", "mainnet"]).unwrap(),
            Stopped::of(["mainnet", "preprod"]).unwrap(),
        ] {
            assert_eq!(both, Stopped::all());
            assert!(both.every());
            assert!(both.stops("/messaging/v1/elsewhere/envelopes"));
            assert!(both.stops("/messaging/v2/preprod/envelopes"));
            assert_eq!(both.names(), "mainnet,preprod");
        }
        assert!(!Stopped::none().stops("/messaging/v1/preprod/envelopes"));
        assert!(Stopped::none().is_empty());
        assert_eq!(Stopped::of(["preprod", "preprod"]), Err("preprod"));
        assert_eq!(Stopped::of(["testnet"]), Err("testnet"));
        assert_eq!(Stopped::of([""]), Err(""));
        // The edge's own: true and false as ever.
        let edge = edge().with_messaging_off(true);
        assert!(edge.messaging_off() && edge.stopped().every());
        let edge = edge.with_messaging_off(false);
        assert!(!edge.messaging_off() && edge.stopped().is_empty());
    }

    #[test]
    fn messaging_has_buckets_of_its_own() {
        let edge = edge();
        let ip: IpAddr = "203.0.113.7".parse().unwrap();
        let start = Instant::now();
        // A sync's worth of pages empties the relay's bucket...
        edge.take_in(Part::Messaging, ip, 1.0, start).unwrap();
        edge.charge_in(Part::Messaging, ip, 8 << 20);
        assert!(edge.take_in(Part::Messaging, ip, 1.0, start).is_err());
        // ...and the wallet's other reads don't wait.
        assert_eq!(edge.take(ip, 4.0, start), Ok(()));
        assert_eq!((edge.buckets(), edge.messaging_buckets()), (1, 1));
        edge.sweep(start + Duration::from_secs(3600));
        assert_eq!((edge.buckets(), edge.messaging_buckets()), (0, 0));
        assert_eq!(Part::of("/messaging/v1/mainnet/envelopes"), Part::Messaging);
        assert_eq!(
            Part::of("/messaging/v1/preprod/certificates"),
            Part::Messaging
        );
        assert_eq!(
            Part::of("/messaging/v1/preprod/withdrawals"),
            Part::Messaging
        );
        assert_eq!(Part::of("/api/v1/tip"), Part::Data);
        assert_eq!(Part::of("/messagingx"), Part::Data);
    }

    /// The data routes' cap is 64 an address, the relay's 16 (the 1.10.0
    /// gate's FI-3). One wallet's reads stay under 20 at once; what's left
    /// is room for the wallets behind one address (a NAT).
    #[test]
    fn each_part_caps_an_addresss_requests_in_flight() {
        let edge = Arc::new(edge());
        let ip: IpAddr = "203.0.113.7".parse().unwrap();
        let mut data: Vec<InFlight> = (0..64)
            .map(|i| {
                edge.enter(Part::Data, ip)
                    .unwrap_or_else(|_| panic!("data {i}"))
            })
            .collect();
        assert_eq!(edge.enter(Part::Data, ip).err(), Some(Crowded::Address));
        let messaging: Vec<InFlight> = (0..16)
            .map(|i| {
                edge.enter(Part::Messaging, ip)
                    .unwrap_or_else(|_| panic!("relay {i}"))
            })
            .collect();
        assert_eq!(
            edge.enter(Part::Messaging, ip).err(),
            Some(Crowded::Address)
        );
        assert_eq!(
            (edge.in_flight(Part::Data), edge.in_flight(Part::Messaging)),
            (64, 16)
        );
        // Another address has a cap of its own.
        assert!(
            edge.enter(Part::Data, "203.0.113.8".parse().unwrap())
                .is_ok()
        );
        // One answered, one more comes in.
        data.pop();
        assert!(edge.enter(Part::Data, ip).is_ok());
        drop(messaging);
        assert_eq!(edge.in_flight(Part::Messaging), 0);
    }

    /// The 1.10.0 gate's FI-3: past a part's total over every address, a
    /// request is refused, whatever its address holds, and the other part
    /// goes on. `/health` is outside the total, but within its address's
    /// cap; an address at its own cap is told that first.
    #[test]
    fn each_part_has_a_total_over_every_address_and_health_is_outside_it() {
        let caps = Caps {
            messaging: 4,
            data: 3,
            data_address: 2,
            ..Caps::DEFAULT
        };
        let edge = Arc::new(edge().with_caps(caps));
        let ip = |i: u8| IpAddr::from([203, 0, 113, i]);
        let relay: Vec<InFlight> = (0..4)
            .map(|i| edge.enter(Part::Messaging, ip(i)).unwrap())
            .collect();
        let new = "198.51.100.1".parse().unwrap();
        assert_eq!(
            edge.enter(Part::Messaging, new).err(),
            Some(Crowded::Everyone)
        );
        let data: Vec<InFlight> = (0..3)
            .map(|i| edge.enter(Part::Data, ip(i)).unwrap())
            .collect();
        assert_eq!(edge.enter(Part::Data, new).err(), Some(Crowded::Everyone));
        let health = edge.enter_as(Part::Data, new, false).unwrap();
        let again = edge.enter_as(Part::Data, new, false).unwrap();
        assert_eq!(
            edge.enter_as(Part::Data, new, false).err(),
            Some(Crowded::Address)
        );
        assert_eq!(edge.in_flight(Part::Data), 5);
        // An address at its own cap, the total full too: its own cap's answer.
        let _second = edge.enter_as(Part::Data, ip(0), false).unwrap();
        assert_eq!(edge.enter(Part::Data, ip(0)).err(), Some(Crowded::Address));
        drop((health, again));
        // One relay request answered: one more, from anyone, comes in.
        drop(relay);
        assert!(edge.enter(Part::Messaging, new).is_ok());
        drop(data);
        assert!(edge.enter(Part::Data, new).is_ok());
    }

    /// The 1.10.0 gate's FI-4: the routes that take a body, and the most
    /// each takes. Every other request with a body is refused unread.
    #[test]
    fn only_the_routes_that_take_a_body_may_send_one() {
        let post = |path: &str| body_limit(&Method::POST, path);
        for pool in ["mainnet", "preprod"] {
            assert_eq!(
                post(&format!("/messaging/v1/{pool}/envelopes")),
                Some(8 + 32_768)
            );
        }
        // An unknown pool's post is its route's to answer, 404.
        assert_eq!(post("/messaging/v1/elsewhere/envelopes"), Some(8 + 32_768));
        // A certificate post: a nonce and the longest certificate (§21.7);
        // a withdrawal's, a nonce and a withdrawal.
        for pool in ["mainnet", "preprod", "elsewhere"] {
            assert_eq!(
                post(&format!("/messaging/v1/{pool}/certificates")),
                Some(8 + 304)
            );
            assert_eq!(
                post(&format!("/messaging/v1/{pool}/withdrawals")),
                Some(8 + 98)
            );
        }
        assert_eq!(post("/api/v1/ogmios"), Some(64 * 1024));
        assert_eq!(post("/api/v1/submittx"), Some(16 * 1024));
        assert_eq!(crate::public::POSTS.len(), 16);
        for path in crate::public::POSTS {
            assert_eq!(post(path), Some(16 * 1024), "{path}");
        }
        for path in [
            "/health",
            "/api/v1/tip",
            "/api/v1/pool_list",
            "/seedelf/v1/mainnet/names",
            "/messaging/v1//envelopes",
            "/messaging/v1/mainnet/x/envelopes",
            "/messaging/v1/mainnet/envelopes/",
            "/messaging/v1//certificates",
            "/messaging/v1/mainnet/x/certificates",
            "/messaging/v1/mainnet/certificates/",
            "/messaging/v1/mainnet/certificate",
            "/messaging/v1//withdrawals",
            "/messaging/v1/mainnet/withdrawals/",
            "/api/v1/credential_utxos/",
            "/nowhere",
        ] {
            assert_eq!(post(path), None, "{path}");
        }
        for method in [Method::GET, Method::PUT, Method::PATCH, Method::DELETE] {
            assert_eq!(
                body_limit(&method, "/messaging/v1/mainnet/envelopes"),
                None,
                "{method}"
            );
            assert_eq!(
                body_limit(&method, "/messaging/v1/mainnet/certificates"),
                None,
                "{method}"
            );
            assert_eq!(
                body_limit(&method, "/messaging/v1/mainnet/withdrawals"),
                None,
                "{method}"
            );
            assert_eq!(body_limit(&method, "/api/v1/credential_utxos"), None);
        }
    }

    /// The 1.10.0 gate's FI-6: at most so many answers are compressed at
    /// once, gzip the one encoding asked for.
    #[test]
    fn at_most_so_many_answers_are_compressed_at_once() {
        let asks = |value: &str| {
            let mut headers = HeaderMap::new();
            headers.insert(header::ACCEPT_ENCODING, value.parse().unwrap());
            asks_compression(&headers)
        };
        assert!(asks("gzip, deflate, br, zstd"));
        assert!(asks("br;q=1.0, GZIP;q=0.5"));
        assert!(asks("*"));
        assert!(!asks("identity"));
        assert!(!asks("br, zstd"));
        assert!(!asks_compression(&HeaderMap::new()));

        let caps = Caps {
            compressing: 2,
            ..Caps::DEFAULT
        };
        let edge = Arc::new(edge().with_caps(caps));
        let first = edge.compress().unwrap();
        let second = edge.compress().unwrap();
        assert!(edge.compress().is_none());
        assert_eq!(edge.compressing(), 2);
        drop(first);
        let third = edge.compress().unwrap();
        drop((second, third));
        assert_eq!(edge.compressing(), 0);
    }

    fn poll(sent: &mut Sent) -> Poll<Option<Result<Frame<Bytes>, axum::Error>>> {
        let mut cx = Context::from_waker(std::task::Waker::noop());
        Pin::new(sent).poll_frame(&mut cx)
    }

    /// Pieces handed until `sent` waits or ends: their bytes.
    fn hand_all(sent: &mut Sent) -> usize {
        let mut handed = 0;
        while let Poll::Ready(Some(frame)) = poll(sent) {
            let data = frame.unwrap().into_data().unwrap();
            assert!(data.len() <= SLICE);
            handed += data.len();
        }
        handed
    }

    /// The 1.10.0 gate's FI-2: an answer is charged to its address's
    /// bucket whole as it's pulled, handed to the connection only 32 KiB
    /// ahead of what its socket has taken, counted as traffic as it's
    /// handed, and in flight, parked, until the connection asks again.
    #[test]
    fn an_answer_goes_as_fast_as_its_connection_takes_it_and_stays_in_flight_until_read() {
        let edge = Arc::new(edge());
        let ip: IpAddr = "203.0.113.7".parse().unwrap();
        let start = Instant::now();
        edge.take_in(Part::Messaging, ip, 1.0, start).unwrap();
        let flying = edge.enter(Part::Messaging, ip).unwrap();
        let line = Arc::new(Line::default());
        let page = 264_208;
        let mut sent = Sent::new(
            Body::from(vec![7u8; page]),
            edge.clone(),
            Part::Messaging,
            Some(ip),
            Some(flying),
            Some(line.clone()),
            None,
            None,
        );
        // Its length is known, so hyper says it in Content-Length.
        assert_eq!(sent.size_hint().exact(), Some(page as u64));
        // Nothing taken yet: 32 KiB ahead, and a slice past it.
        assert_eq!(hand_all(&mut sent), 48 * 1024);
        // The bucket was charged for the whole page as it was pulled.
        assert!(edge.take_in(Part::Messaging, ip, 283.0, start).is_err());
        assert!(edge.take_in(Part::Messaging, ip, 282.0, start).is_ok());
        assert_eq!(edge.messaging_egress.used(), 48 * 1024);
        assert_eq!(sent.size_hint().exact(), Some((page - 48 * 1024) as u64));
        // The socket takes 64 KiB: 64 KiB more.
        line.wrote(64 * 1024);
        assert_eq!(hand_all(&mut sent), 64 * 1024);
        // It takes the rest: the page is handed whole, and stays in flight.
        line.wrote(page);
        hand_all(&mut sent);
        assert!(sent.is_end_stream());
        assert_eq!(edge.messaging_egress.used(), page as u64);
        assert_eq!(edge.egress.used(), page as u64);
        drop(sent);
        assert_eq!(edge.in_flight(Part::Messaging), 1);
        // The connection asks again: the page was read.
        line.asked();
        assert_eq!(edge.in_flight(Part::Messaging), 0);
    }

    /// Without a connection's record (a test's request), an answer is
    /// handed as it's pulled, and its place in flight ends with it.
    #[test]
    fn without_a_connection_an_answer_is_handed_at_once_and_counted_until_handed() {
        let edge = Arc::new(edge());
        let ip: IpAddr = "203.0.113.7".parse().unwrap();
        let flying = edge.enter(Part::Data, ip).unwrap();
        let mut sent = Sent::new(
            Body::from(vec![1u8; 100_000]),
            edge.clone(),
            Part::Data,
            Some(ip),
            Some(flying),
            None,
            None,
            Some(100_000),
        );
        // A data answer of known length is counted whole at once.
        assert_eq!(edge.answer_bytes(), 100_000);
        let Poll::Ready(Some(Ok(frame))) = poll(&mut sent) else {
            panic!("a first slice")
        };
        assert_eq!(frame.into_data().unwrap().len(), SLICE);
        assert_eq!(edge.answer_bytes(), 100_000 - SLICE as u64);
        // Dropped half way, its connection gone: nothing stays counted.
        drop(sent);
        assert_eq!((edge.answer_bytes(), edge.in_flight(Part::Data)), (0, 0));
        // Whole: nothing counted, and nothing in flight.
        let flying = edge.enter(Part::Data, ip).unwrap();
        let mut sent = Sent::new(
            Body::from(vec![1u8; 40_000]),
            edge.clone(),
            Part::Data,
            Some(ip),
            Some(flying),
            None,
            None,
            Some(40_000),
        );
        assert_eq!(hand_all(&mut sent), 40_000);
        assert!(sent.is_end_stream());
        assert_eq!((edge.answer_bytes(), edge.in_flight(Part::Data)), (0, 0));
    }

    #[test]
    fn a_refilled_bucket_is_forgotten() {
        let edge = edge();
        let start = Instant::now();
        edge.take("203.0.113.7".parse().unwrap(), 4.0, start)
            .unwrap();
        edge.sweep(start);
        assert_eq!(edge.buckets(), 1);
        edge.sweep(start + Duration::from_secs(1));
        assert_eq!(edge.buckets(), 0);
    }

    #[test]
    fn requests_cost_what_they_reach() {
        assert_eq!(weight("/seedelf/v1/mainnet/contract/snapshot"), 1.0);
        assert_eq!(weight("/api/v1/tip"), 1.0);
        assert_eq!(weight("/api/v1/credential_utxos"), 4.0);
        assert_eq!(weight("/api/v1/submittx"), 10.0);
        assert_eq!(weight("/api/v1/ogmios"), 10.0);
        assert_eq!(weight("/health"), 1.0);
    }

    fn request(peer: &str, headers: &[(&str, &str)]) -> Request {
        let mut request = Request::new(Body::empty());
        for (name, value) in headers {
            request.headers_mut().append(
                axum::http::HeaderName::from_bytes(name.as_bytes()).unwrap(),
                HeaderValue::from_str(value).unwrap(),
            );
        }
        request
            .extensions_mut()
            .insert(ConnectInfo(peer.parse::<SocketAddr>().unwrap()));
        request
    }

    #[test]
    fn the_client_is_caddys_last_forwarded_address() {
        let edge = edge();
        let caddy = "127.0.0.1:50000";
        let forwarded = |value| [("x-forwarded-for", value)];
        assert_eq!(
            edge.client(&request(caddy, &forwarded("198.51.100.1, 203.0.113.7"))),
            Some("203.0.113.7".parse().unwrap())
        );
        assert_eq!(
            edge.client(&request(caddy, &[])),
            Some("127.0.0.1".parse().unwrap())
        );
        // Not from loopback: the header is anyone's to write, so it's ignored.
        assert_eq!(
            edge.client(&request("198.51.100.9:4000", &forwarded("203.0.113.7"))),
            Some("198.51.100.9".parse().unwrap())
        );
        let direct = Edge::new(false, vec![], Egress::new(None, None));
        assert_eq!(
            direct.client(&request(caddy, &forwarded("203.0.113.7"))),
            Some("127.0.0.1".parse().unwrap())
        );
    }

    #[test]
    fn only_the_wallets_own_fetches_pass() {
        let wallet = "chrome-extension://jfekiogplaamnceifeehipmomhojngcb";
        let edge = Edge::new(true, vec![wallet.into()], Egress::new(None, None));
        let peer = "127.0.0.1:1";
        let from = |headers: &[(&str, &str)]| edge.made_by_a_page(&request(peer, headers));
        assert!(!from(&[("sec-fetch-mode", "cors"), ("origin", wallet)]));
        assert!(!from(&[]));
        assert!(from(&[("sec-fetch-mode", "no-cors")]));
        assert!(from(&[("sec-fetch-mode", "navigate")]));
        assert!(from(&[
            ("sec-fetch-mode", "cors"),
            ("origin", "https://example.com")
        ]));
    }

    #[test]
    fn dates_are_utcs() {
        assert_eq!(month_of(0), "1970-01");
        assert_eq!(month_of(1_791_519_200), "2026-10");
        // 2024-02-29T23:59:59Z, then the next second.
        assert_eq!(month_of(1_709_251_199), "2024-02");
        assert_eq!(month_of(1_709_251_200), "2024-03");
        assert_eq!(civil(1_709_251_199), (2024, 2, 29));
        assert_eq!(days_left(1_709_251_199), 1);
        // 2026-10-09: 23 days left, today included.
        assert_eq!(days_left(1_791_519_200), 23);
    }

    #[test]
    fn the_month_is_kept_across_a_restart() {
        let dir = std::env::temp_dir().join(format!("seedelf-egress-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("egress.json");
        let ceiling = 1_000_000;
        let egress = Egress::new(Some(ceiling), Some(file.clone()));
        egress.add(60);
        egress.flush();
        let again = Egress::new(Some(ceiling), Some(file.clone()));
        assert_eq!(again.used(), 60);
        assert!(!again.over());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// The 1.10.0 gate's FI-9: a write that fails leaves no partial file
    /// behind to fill a disk that's nearly full.
    #[test]
    fn a_count_that_cant_be_written_leaves_nothing_behind() {
        let dir = std::env::temp_dir().join(format!("seedelf-egress-fail-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        // A folder where the count's file would go: its rename fails.
        let file = dir.join("egress.json");
        std::fs::create_dir_all(&file).unwrap();
        let egress = Egress::new(Some(1_000_000), Some(file.clone()));
        egress.add(60);
        egress.flush();
        assert!(file.is_dir());
        assert!(!dir.join("egress.partial").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_last_tenth_of_messagings_day_is_a_reserve() {
        let share = 1_000_000;
        let tenth = edge().with_messaging_egress(Egress::with_share_today(share));
        assert_eq!(tenth.messaging_egress.today(), Some((0, share)));
        assert_eq!(tenth.messaging_egress.left_today(), Some(share));
        assert!(!tenth.reserved());
        // Nine tenths spent, less a byte: not yet.
        tenth.messaging_egress.add(899_999);
        assert!(!tenth.reserved());
        tenth.messaging_egress.add(1);
        assert!(tenth.reserved() && !tenth.messaging_egress.over());
        assert_eq!(tenth.messaging_egress.left_today(), Some(100_000));
        // The rest: over, and what's spent past the share isn't counted as
        // left over.
        tenth.messaging_egress.add(150_000);
        assert!(tenth.reserved() && tenth.messaging_egress.over());
        assert_eq!(tenth.messaging_egress.today(), Some((share, share)));
        assert_eq!(tenth.messaging_egress.left_today(), Some(0));

        // Another reserve: a quarter, or none.
        let quarter = edge()
            .with_messaging_egress(Egress::with_share_today(share))
            .with_reserve(Reserve {
                part: 0.25,
                page: 1024,
            });
        quarter.messaging_egress.add(750_000);
        assert!(quarter.reserved());
        let none = edge()
            .with_messaging_egress(Egress::with_share_today(share))
            .with_reserve(Reserve {
                part: 0.0,
                page: 1024,
            });
        none.messaging_egress.add(999_999);
        assert!(!none.reserved());

        // With no ceiling of its own there's no day's share, so no reserve:
        // the relay spends the API's allowance.
        let unset = edge();
        unset.messaging_egress.add(u64::MAX / 2);
        assert!(!unset.messaging_egress.has_ceiling() && !unset.reserved());
        assert_eq!(unset.messaging_egress.today(), None);
        assert_eq!(unset.messaging_egress.left_today(), None);
        // The API's own traffic has no reserve: only messaging's is asked.
        let data = Edge::new(true, vec![], Egress::with_share_today(share));
        data.egress.add(share);
        assert!(data.egress.over() && !data.reserved());
    }

    #[test]
    fn a_share_for_today_is_the_same_on_every_day_of_the_month() {
        let egress = Egress::with_share_today(1_000_000);
        assert_eq!(egress.today(), Some((0, 1_000_000)));
        egress.add(999_999);
        assert!(!egress.over());
        egress.add(1);
        assert!(egress.over());
    }

    #[test]
    fn a_day_gets_its_share_of_what_is_left() {
        let egress = Egress::new(Some(23_000), None);
        let now = unix_now();
        // Whatever today's date, today's share is what's left over the days left.
        let share = 23_000 / days_left(now);
        egress.add(share - 1);
        assert!(!egress.over());
        egress.add(1);
        assert!(egress.over());
    }
}
