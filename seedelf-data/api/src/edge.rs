//! What stands between the internet and the API on the VPS (chunk 26's
//! *Tunnel and VPS*): buckets per IP, charged for requests and for the bytes
//! sent back; a monthly egress ceiling, shared out by day; requests a web
//! page could make refused; and CORS for the wallet's own origins. Caddy in
//! front does TLS and nothing else, so every limit is here, in code anyone
//! can audit.
//!
//! **IPs exist only in memory:** a bucket per address while it's refilling,
//! dropped once full. Nothing here logs one.

use std::collections::HashMap;
use std::io::Write;
use std::net::{IpAddr, Ipv6Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::body::Body;
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

/// Who a request is from, for its bucket: an IPv6 address by its /64, which
/// one machine holds whole.
fn bucket_key(ip: IpAddr) -> IpAddr {
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

pub struct Edge {
    buckets: Mutex<Buckets>,
    /// Caddy on loopback names the client in `X-Forwarded-For`.
    trust_proxy: bool,
    /// The wallet's origins: a request from any other is refused.
    origins: Vec<String>,
    pub egress: Egress,
}

impl Edge {
    pub fn new(trust_proxy: bool, origins: Vec<String>, egress: Egress) -> Self {
        Edge {
            buckets: Mutex::new(Buckets::default()),
            trust_proxy,
            origins,
            egress,
        }
    }

    /// Takes `weight` from `ip`'s bucket, or says how many seconds until it can.
    pub fn take(&self, ip: IpAddr, weight: f64, now: Instant) -> Result<(), Refusal> {
        let mut buckets = self.buckets.lock().expect("buckets lock");
        let key = bucket_key(ip);
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
        let mut buckets = self.buckets.lock().expect("buckets lock");
        if let Some(bucket) = buckets.map.get_mut(&bucket_key(ip)) {
            bucket.tokens = (bucket.tokens - bytes as f64 / BYTES_PER_UNIT).max(-CAPACITY);
        }
    }

    /// Forgets every bucket that has refilled: its address is gone from memory.
    pub fn sweep(&self, now: Instant) {
        let mut buckets = self.buckets.lock().expect("buckets lock");
        buckets.map.retain(|_, b| !b.refilled(now));
    }

    pub fn buckets(&self) -> usize {
        self.buckets.lock().expect("buckets lock").map.len()
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

/// The limits, in front of every route. `/health` is exempt from the page
/// check and the egress ceiling, so a monitor (or a browser tab) can always read it.
pub async fn limit(State(edge): State<Arc<Edge>>, request: Request, next: Next) -> Response {
    let path = request.uri().path();
    let health = path == "/health";
    if !health && edge.made_by_a_page(&request) {
        let body = axum::Json(serde_json::json!({ "error": "only Seedelf Wallet reads this" }));
        return (StatusCode::FORBIDDEN, body).into_response();
    }
    if !health && edge.egress.over() {
        return refuse(
            StatusCode::SERVICE_UNAVAILABLE,
            "over the traffic allowance",
            3600,
        );
    }
    // A request with no address (none reaches the server so) takes no bucket.
    let ip = edge.client(&request);
    if let Some(ip) = ip {
        match edge.take(ip, weight(path), Instant::now()) {
            Ok(()) => {}
            Err(Refusal::Wait(secs)) => {
                return refuse(StatusCode::TOO_MANY_REQUESTS, "slow down", secs);
            }
            Err(Refusal::Full) => return refuse(StatusCode::SERVICE_UNAVAILABLE, "busy", 30),
        }
    }
    let response = next.run(request).await;
    let (parts, body) = response.into_parts();
    let edge = edge.clone();
    let body = body.map_frame(move |frame| {
        if let Some(data) = frame.data_ref() {
            edge.egress.add(data.len() as u64);
            if let Some(ip) = ip {
                edge.charge(ip, data.len());
            }
        }
        frame
    });
    Response::from_parts(parts, Body::new(body))
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
        let now = unix_now();
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
            held: Mutex::new(kept),
            file,
        };
        egress.roll(now);
        egress
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
        assert_eq!(bucket_key(a), bucket_key(b));
        assert_ne!(
            bucket_key(a),
            bucket_key("2001:db8:1:3::1".parse().unwrap())
        );
        let mapped: IpAddr = "::ffff:203.0.113.7".parse().unwrap();
        assert_eq!(bucket_key(mapped), "203.0.113.7".parse::<IpAddr>().unwrap());
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
