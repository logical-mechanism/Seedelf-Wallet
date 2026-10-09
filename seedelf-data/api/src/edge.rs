//! What stands between the internet and the API on the VPS (chunk 26's
//! *Tunnel and VPS*): buckets per IP, a monthly egress ceiling, and CORS for
//! the wallet's own origins. Caddy in front does TLS and nothing else, so
//! every limit is here, in code anyone can audit.
//!
//! **IPs exist only in memory:** a bucket per address while it's refilling,
//! dropped once full. Nothing here logs one.

use std::collections::HashMap;
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
/// wallet paces its own requests well under it (koios.ts's `RateLimit`
/// keeps to 40 every 10 s), so only a scraper or a loop ever waits.
pub const CAPACITY: f64 = 300.0;
pub const REFILL: f64 = 10.0;

/// At most this many addresses have a bucket at once. Past it, a new one is
/// a 503: the server is under more load than buckets can sort out.
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

pub struct Edge {
    buckets: Mutex<HashMap<IpAddr, Bucket>>,
    /// Caddy on loopback names the client in `X-Forwarded-For`.
    trust_proxy: bool,
    pub egress: Egress,
}

impl Edge {
    pub fn new(trust_proxy: bool, egress: Egress) -> Self {
        Edge {
            buckets: Mutex::new(HashMap::new()),
            trust_proxy,
            egress,
        }
    }

    /// Takes `weight` from `ip`'s bucket, or says how many seconds until it can.
    pub fn take(&self, ip: IpAddr, weight: f64, now: Instant) -> Result<(), Refusal> {
        let mut buckets = self.buckets.lock().expect("buckets lock");
        let key = bucket_key(ip);
        if !buckets.contains_key(&key) && buckets.len() >= MAX_BUCKETS {
            return Err(Refusal::Full);
        }
        let bucket = buckets.entry(key).or_insert(Bucket {
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

    /// Forgets every bucket that has refilled: its address is gone from memory.
    pub fn sweep(&self, now: Instant) {
        let mut buckets = self.buckets.lock().expect("buckets lock");
        buckets.retain(|_, b| {
            b.tokens + now.saturating_duration_since(b.at).as_secs_f64() * REFILL < CAPACITY
        });
    }

    pub fn buckets(&self) -> usize {
        self.buckets.lock().expect("buckets lock").len()
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
}

#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    /// Over the limit: try again in this many seconds.
    Wait(u64),
    /// Too many addresses at once.
    Full,
}

/// The limits, in front of every route but `/health`'s egress check.
pub async fn limit(State(edge): State<Arc<Edge>>, request: Request, next: Next) -> Response {
    let path = request.uri().path();
    let health = path == "/health";
    if !health && edge.egress.over() {
        return refuse(
            StatusCode::SERVICE_UNAVAILABLE,
            "over this month's traffic",
            3600,
        );
    }
    // A request with no address (none reaches the server so) takes no bucket.
    if let Some(ip) = edge.client(&request) {
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
/// bill can surprise anyone. Kept in a file, so a restart doesn't forget it.
/// The node's P2P traffic through the tunnel isn't counted here: the VPS's
/// own meter is for that (deploy/README.md).
pub struct Egress {
    ceiling: Option<u64>,
    bytes: AtomicU64,
    month: Mutex<String>,
    file: Option<PathBuf>,
}

#[derive(Serialize, Deserialize)]
struct Kept {
    month: String,
    bytes: u64,
}

impl Egress {
    /// `ceiling` in bytes, if there's one; `file` where the count is kept.
    pub fn new(ceiling: Option<u64>, file: Option<PathBuf>) -> Self {
        let month = month_of(unix_now());
        let kept = file
            .as_ref()
            .and_then(|path| std::fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice::<Kept>(&bytes).ok())
            .filter(|kept| kept.month == month);
        Egress {
            ceiling,
            bytes: AtomicU64::new(kept.map_or(0, |kept| kept.bytes)),
            month: Mutex::new(month),
            file,
        }
    }

    pub fn add(&self, bytes: u64) {
        self.bytes.fetch_add(bytes, Ordering::Relaxed);
    }

    pub fn used(&self) -> u64 {
        self.bytes.load(Ordering::Relaxed)
    }

    pub fn over(&self) -> bool {
        self.ceiling.is_some_and(|ceiling| self.used() >= ceiling)
    }

    /// Starts the count again in a new month, and writes it down.
    pub fn flush(&self) {
        let month = month_of(unix_now());
        let mut held = self.month.lock().expect("month lock");
        if *held != month {
            self.bytes.store(0, Ordering::Relaxed);
            *held = month;
        }
        let Some(path) = &self.file else { return };
        let kept = Kept {
            month: held.clone(),
            bytes: self.used(),
        };
        let written = serde_json::to_vec(&kept)
            .map_err(std::io::Error::other)
            .and_then(|bytes| {
                let partial = path.with_extension("partial");
                std::fs::write(&partial, bytes)?;
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

/// `YYYY-MM` of a Unix time, in UTC (Howard Hinnant's days-to-civil).
fn month_of(unix: i64) -> String {
    let z = unix.div_euclid(86_400) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edge() -> Edge {
        Edge::new(true, Egress::new(None, None))
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

    #[test]
    fn the_client_is_caddys_last_forwarded_address() {
        let edge = edge();
        let request = |peer: &str, forwarded: Option<&str>| {
            let mut request = Request::new(Body::empty());
            if let Some(forwarded) = forwarded {
                request
                    .headers_mut()
                    .insert("x-forwarded-for", HeaderValue::from_str(forwarded).unwrap());
            }
            request
                .extensions_mut()
                .insert(ConnectInfo(peer.parse::<SocketAddr>().unwrap()));
            request
        };
        let caddy = "127.0.0.1:50000";
        assert_eq!(
            edge.client(&request(caddy, Some("198.51.100.1, 203.0.113.7"))),
            Some("203.0.113.7".parse().unwrap())
        );
        assert_eq!(
            edge.client(&request(caddy, None)),
            Some("127.0.0.1".parse().unwrap())
        );
        // Not from loopback: the header is anyone's to write, so it's ignored.
        assert_eq!(
            edge.client(&request("198.51.100.9:4000", Some("203.0.113.7"))),
            Some("198.51.100.9".parse().unwrap())
        );
        let direct = Edge::new(false, Egress::new(None, None));
        assert_eq!(
            direct.client(&request(caddy, Some("203.0.113.7"))),
            Some("127.0.0.1".parse().unwrap())
        );
    }

    #[test]
    fn months_are_utcs() {
        assert_eq!(month_of(0), "1970-01");
        assert_eq!(month_of(1_791_519_200), "2026-10");
        // 2024-02-29T23:59:59Z, then the next second.
        assert_eq!(month_of(1_709_251_199), "2024-02");
        assert_eq!(month_of(1_709_251_200), "2024-03");
    }

    #[test]
    fn the_month_is_kept_across_a_restart() {
        let dir = std::env::temp_dir().join(format!("seedelf-egress-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("egress.json");
        let egress = Egress::new(Some(100), Some(file.clone()));
        egress.add(60);
        egress.flush();
        let again = Egress::new(Some(100), Some(file.clone()));
        assert_eq!(again.used(), 60);
        assert!(!again.over());
        again.add(40);
        assert!(again.over());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
