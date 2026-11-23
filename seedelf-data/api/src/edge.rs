//! What stands between the internet and the API on the VPS (chunk 26's
//! *Tunnel and VPS*): buckets per IP, charged for requests and for the bytes
//! sent back; a cap on each address's requests in flight, and a deadline on
//! a request's body, so no request is held open for good; a monthly egress
//! ceiling, shared out by day; requests a web page could make refused; and
//! CORS for the wallet's own origins. Caddy in front does TLS and its own
//! timeouts (deploy/edge/Caddyfile), so every limit on what a client may
//! ask is here, in code anyone can audit.
//!
//! **IPs exist only in memory:** a bucket per address while it's refilling,
//! dropped once full. Nothing here logs one.
//!
//! **Messaging is apart** (web wallet chunk 54's 54c): the relay's routes,
//! `/messaging/…`, have buckets of their own, so catching up on messages
//! never makes the wallet's other reads wait, and a traffic ceiling of their
//! own inside the API's, so a flood of messages can spend messaging's
//! allowance but never the rest's. The last part of each day's share of that
//! allowance is a reserve (`Reserve`): only posts and short pages spend it,
//! so a spent day stops fresh syncs before it stops conversations. And it
//! has an off switch of its own (`Edge::with_messaging_off`): every relay
//! route answers 410 Gone, and the rest go on.

use std::collections::HashMap;
use std::io::Write;
use std::net::{IpAddr, Ipv6Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::body::{Body, HttpBody, to_bytes};
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use http_body_util::BodyExt;
use serde::{Deserialize, Serialize};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tracing::warn;

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
/// sender liked. The largest body, 64 KiB, fits at 52 kbit/s.
pub const BODY_DEADLINE: Duration = Duration::from_secs(10);

/// The largest body any route takes: an evaluation's. The edge reads no more
/// than this before a route sees the request; each route's own limit, which
/// may be less, still answers its own 413.
pub const MAX_BODY: usize = crate::submit::MAX_EVALUATE_BYTES;

/// At most this many requests from one address are in flight at once on
/// the relay's routes, and on the rest ([`IN_FLIGHT_DATA`]): from when the
/// edge lets one in until its answer is handed over [choice]. One wallet's
/// reads fan out to under 20 at once, each answered in moments, so only
/// requests held open reach a cap: bodies that stall, and answers nobody
/// reads. The bucket alone would let one address hold 100 for a body's
/// deadline. Every wallet behind one address (a household, a carrier's NAT)
/// shares its caps, which is why the data routes' is the wider: a 429 there
/// sends that part of each of them to Koios for 5 minutes.
pub const IN_FLIGHT_MESSAGING: u32 = 32;
pub const IN_FLIGHT_DATA: u32 = 128;

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

    /// The most requests one address may have in flight in this part.
    pub fn in_flight(self) -> u32 {
        match self {
            Part::Data => IN_FLIGHT_DATA,
            Part::Messaging => IN_FLIGHT_MESSAGING,
        }
    }
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
    /// Each address's requests in flight, by its bucket's key: an entry
    /// only while it has one.
    flying: Mutex<HashMap<IpAddr, u32>>,
    messaging_flying: Mutex<HashMap<IpAddr, u32>>,
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
    /// Seedelf Messaging stopped (`DATA_MESSAGING_OFF`): every relay route
    /// answers 410 Gone.
    messaging_off: bool,
}

impl Edge {
    pub fn new(trust_proxy: bool, origins: Vec<String>, egress: Egress) -> Self {
        Edge {
            buckets: Mutex::new(Buckets::default()),
            messaging_buckets: Mutex::new(Buckets::default()),
            flying: Mutex::new(HashMap::new()),
            messaging_flying: Mutex::new(HashMap::new()),
            trust_proxy,
            origins,
            egress,
            messaging_egress: Egress::new(None, None),
            reserve: Reserve::DEFAULT,
            messaging_off: false,
        }
    }

    /// Seedelf Messaging stopped, or not: the relay's off switch
    /// (`DATA_MESSAGING_OFF`, deploy/README.md's *Stopping Messages*).
    /// While it's off, every request under `/messaging/` is a 410 Gone,
    /// which tells the wallet Messages is stopped (protocol.md's freeze of
    /// `/messaging/v1/`): it posts nothing, solves nothing, and asks again
    /// now and then. A post is refused unread, so nothing is kept; the
    /// pools' files wait on disk, and what they hold expires as ever.
    pub fn with_messaging_off(mut self, off: bool) -> Self {
        self.messaging_off = off;
        self
    }

    /// Whether Seedelf Messaging is stopped.
    pub fn messaging_off(&self) -> bool {
        self.messaging_off
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

    fn flying_of(&self, part: Part) -> &Mutex<HashMap<IpAddr, u32>> {
        match part {
            Part::Data => &self.flying,
            Part::Messaging => &self.messaging_flying,
        }
    }

    /// Counts one more request from `ip` in flight in `part`, until what's
    /// returned is dropped. `None` when the address has the part's cap
    /// ([`Part::in_flight`]) already.
    pub fn enter(self: &Arc<Self>, part: Part, ip: IpAddr) -> Option<InFlight> {
        let key = client_key(ip);
        let mut flying = self.flying_of(part).lock().expect("flying lock");
        match flying.get_mut(&key) {
            Some(count) if *count >= part.in_flight() => return None,
            Some(count) => *count += 1,
            None => {
                flying.insert(key, 1);
            }
        }
        Some(InFlight {
            edge: self.clone(),
            part,
            key,
        })
    }

    /// How many requests are in flight in `part`, from every address.
    pub fn in_flight(&self, part: Part) -> u32 {
        let flying = self.flying_of(part).lock().expect("flying lock");
        flying.values().sum()
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
        let peer = request
            .extensions()
            .get::<ConnectInfo<SocketAddr>>()?
            .0
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

/// A request in flight, counted for its address ([`Edge::enter`]) until
/// this is dropped.
pub struct InFlight {
    edge: Arc<Edge>,
    part: Part,
    key: IpAddr,
}

impl Drop for InFlight {
    fn drop(&mut self) {
        let mut flying = self
            .edge
            .flying_of(self.part)
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(count) = flying.get_mut(&self.key) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                flying.remove(&self.key);
            }
        }
    }
}

/// The limits, in front of every route. `/health` is exempt from the page
/// check and the egress ceiling, so a monitor (or a browser tab) can always read it.
pub async fn limit(State(edge): State<Arc<Edge>>, mut request: Request, next: Next) -> Response {
    let path = request.uri().path();
    let health = path == "/health";
    let part = Part::of(path);
    let weight = match part {
        Part::Data => weight(path),
        Part::Messaging => crate::messaging::weight(request.method() == Method::POST),
    };
    if !health && edge.made_by_a_page(&request) {
        let body = axum::Json(serde_json::json!({ "error": "only Seedelf Wallet reads this" }));
        return (StatusCode::FORBIDDEN, body).into_response();
    }
    // Before every other limit, so a wallet learns it whatever its bucket
    // or the day's traffic, and before the body is read, so a post's is
    // never looked at.
    if part == Part::Messaging && edge.messaging_off {
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
    // A request with no address (none reaches the server so) takes no bucket
    // and no place in flight.
    let ip = edge.client(&request);
    let mut flying = None;
    if let Some(ip) = ip {
        // Before the bucket: a request refused here costs its address nothing.
        flying = edge.enter(part, ip);
        if flying.is_none() {
            return refuse(
                StatusCode::TOO_MANY_REQUESTS,
                "too many requests at once",
                1,
            );
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
    // A body is read here, whole and within its deadline, and handed on in
    // one piece: no route waits on a client that stopped half way. Its
    // route's own limit, if less, answers as before.
    if !request.body().is_end_stream() {
        let (parts, body) = request.into_parts();
        let body = match tokio::time::timeout(BODY_DEADLINE, to_bytes(body, MAX_BODY)).await {
            Ok(Ok(body)) => body,
            Ok(Err(error)) => return unread(error),
            Err(_) => return late(),
        };
        request = Request::from_parts(parts, Body::from(body));
    }
    let response = next.run(request).await;
    let (parts, body) = response.into_parts();
    let edge = edge.clone();
    let body = body.map_frame(move |frame| {
        // In flight until this body is done with: handed over whole, or
        // dropped with its connection.
        let _ = &flying;
        if let Some(data) = frame.data_ref() {
            edge.egress.add(data.len() as u64);
            if part == Part::Messaging {
                edge.messaging_egress.add(data.len() as u64);
            }
            if let Some(ip) = ip {
                edge.charge_in(part, ip, data.len());
            }
        }
        frame
    });
    Response::from_parts(parts, Body::new(body))
}

/// The answer to a request whose body didn't arrive within
/// [`BODY_DEADLINE`]: a 408, and its connection closed (hyper closes one
/// whose request it hasn't read whole; the header says so to Caddy).
fn late() -> Response {
    let body =
        axum::Json(serde_json::json!({ "error": "the request's body didn't arrive in time" }));
    let mut response = (StatusCode::REQUEST_TIMEOUT, body).into_response();
    response
        .headers_mut()
        .insert(header::CONNECTION, HeaderValue::from_static("close"));
    response
}

/// The answer to a body the edge couldn't read: a 413 past [`MAX_BODY`], as
/// a route's own limit answers, and a 400 for one that broke off.
fn unread(error: axum::Error) -> Response {
    let (status, error) = if error.into_inner().is::<http_body_util::LengthLimitError>() {
        (
            StatusCode::PAYLOAD_TOO_LARGE,
            "the body is larger than any route takes",
        )
    } else {
        (StatusCode::BAD_REQUEST, "the request's body didn't arrive")
    };
    (status, axum::Json(serde_json::json!({ "error": error }))).into_response()
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
        let written = serde_json::to_vec(&kept)
            .map_err(std::io::Error::other)
            .and_then(|bytes| {
                let partial = path.with_extension("partial");
                let mut file = std::fs::File::create(&partial)?;
                file.write_all(&bytes)?;
                file.sync_all()?;
                std::fs::rename(&partial, path)
            });
        if let Err(error) = written {
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
        assert_eq!(Part::of("/api/v1/tip"), Part::Data);
        assert_eq!(Part::of("/messagingx"), Part::Data);
    }

    /// The relay review's low (gate 54g): the data routes' cap is 128 an
    /// address, the relay's 32. One wallet's reads stay under 20 at once;
    /// what's left is room for the wallets behind one address (a NAT).
    #[test]
    fn each_part_caps_an_addresss_requests_in_flight() {
        let edge = Arc::new(edge());
        let ip: IpAddr = "203.0.113.7".parse().unwrap();
        let mut data: Vec<InFlight> = (0..128)
            .map(|i| {
                edge.enter(Part::Data, ip)
                    .unwrap_or_else(|| panic!("data {i}"))
            })
            .collect();
        assert!(edge.enter(Part::Data, ip).is_none());
        let messaging: Vec<InFlight> = (0..32)
            .map(|i| {
                edge.enter(Part::Messaging, ip)
                    .unwrap_or_else(|| panic!("relay {i}"))
            })
            .collect();
        assert!(edge.enter(Part::Messaging, ip).is_none());
        assert_eq!(
            (edge.in_flight(Part::Data), edge.in_flight(Part::Messaging)),
            (128, 32)
        );
        // Another address has a cap of its own.
        assert!(
            edge.enter(Part::Data, "203.0.113.8".parse().unwrap())
                .is_some()
        );
        // One answered, one more comes in.
        data.pop();
        assert!(edge.enter(Part::Data, ip).is_some());
        drop(messaging);
        assert_eq!(edge.in_flight(Part::Messaging), 0);
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
