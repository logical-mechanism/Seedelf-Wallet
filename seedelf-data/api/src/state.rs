//! What the server holds: db-sync's and Kupo's tips, each watched every 2 s,
//! and answers cached until their source's tip moves. Every answer here is
//! the same for everyone who asks, so one query per block serves them all.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::body::Bytes;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use tokio::sync::OnceCell;
use tracing::{info, warn};

use crate::chain::{Block, Chain, Tip};
use crate::constants::slot_time;
use crate::decimals::Decimals;
use crate::kupo::Kupo;
use crate::public::pools::Rewards;
use crate::source::{self, Source, Upstream};

/// A tip older than this is behind, and its part answers 503 so the wallet
/// goes to Koios. Mainnet makes a block every 20 s on average, and a 3 min gap
/// comes about once in 10,000.
pub const MAX_AGE_SECS: i64 = 180;

/// How often db-sync's and Kupo's tips are read.
pub const WATCH_EVERY: Duration = Duration::from_secs(2);

/// A tip read that takes longer than this has failed: a tunnel that drops
/// packets doesn't close sockets, so nothing else would end it soon.
pub const TIP_TIMEOUT: Duration = Duration::from_secs(2);

/// A source whose tip fails this many reads in a row is down: its part
/// answers 503 at once (the private index goes to the other source), rather
/// than letting every request wait on a timeout. One failed read is a blip.
pub const FAILED_READS: u32 = 2;

/// Answers held for one source's tip, at most, by count and by size: past
/// either, nothing more is kept until it moves. A `since` answer from an old
/// cursor can be hundreds of KB, and anyone can ask for one.
const MAX_CACHED: usize = 4096;
const MAX_CACHED_BYTES: usize = 64 << 20;

/// What every wallet reads: always kept, whatever the budget holds, so no
/// flood of other requests can push them out.
const ALWAYS_KEPT: [&str; 5] = [
    "contract/snapshot",
    "lovejoin/snapshot",
    "names",
    "epoch_params",
    "totals",
];

/// A failure logged at most once in this long, per kind: a source that's
/// down fails every request, and one line says it.
const LOG_EVERY_SECS: i64 = 10;

/// Answers held for a time, at most (`lasting`).
const MAX_LASTING: usize = 4096;

pub struct AppState {
    pub chain: Chain,
    /// The private index's second source, when there is one.
    pub kupo: Option<Kupo>,
    pub decimals: Decimals,
    /// Accounts' reward sums for the epoch, for pools' live stake.
    pub rewards: Rewards,
    tip: RwLock<Option<Tip>>,
    /// db-sync's tip failed [`FAILED_READS`] reads in a row: the public routes
    /// answer 503 at once, and the private index reads Kupo.
    db_failing: AtomicBool,
    kupo_tip: RwLock<Option<Block>>,
    /// The same for Kupo: the private index reads db-sync alone.
    kupo_failing: AtomicBool,
    /// Answers made from db-sync, for its tip; the private index's made from Kupo, for Kupo's.
    cache: Mutex<Cached>,
    kupo_cache: Mutex<Cached>,
    lasting: Mutex<HashMap<String, (Instant, Bytes)>>,
    /// Answers being worked out in the background, so one isn't started twice.
    working: Mutex<HashSet<String>>,
}

/// Answers kept for one source's tip, dropped when it moves. Each is a cell
/// filled once: requests that miss together wait on one read, not one each.
#[derive(Default)]
struct Cached {
    tip: String,
    answers: HashMap<String, Arc<OnceCell<Bytes>>>,
    bytes: usize,
}

impl Cached {
    fn set_tip(&mut self, hash: &str) {
        if self.tip != hash {
            self.tip = hash.to_string();
            self.answers.clear();
            self.bytes = 0;
        }
    }

    /// The cell for `key` at `tip`: the one there, a new one if there's
    /// room, or none (an old tip, or a full cache).
    fn cell(&mut self, tip: &str, key: &str) -> Option<Arc<OnceCell<Bytes>>> {
        if self.tip != tip {
            return None;
        }
        if let Some(cell) = self.answers.get(key) {
            return Some(cell.clone());
        }
        let room = self.answers.len() < MAX_CACHED && self.bytes < MAX_CACHED_BYTES;
        (room || ALWAYS_KEPT.contains(&key)).then(|| {
            let cell = Arc::new(OnceCell::new());
            self.answers.insert(key.to_string(), cell.clone());
            cell
        })
    }
}

impl AppState {
    pub fn new(chain: Chain) -> Self {
        AppState {
            chain,
            kupo: None,
            decimals: Decimals::default(),
            rewards: Rewards::default(),
            tip: RwLock::new(None),
            db_failing: AtomicBool::new(false),
            kupo_tip: RwLock::new(None),
            kupo_failing: AtomicBool::new(false),
            cache: Mutex::new(Cached::default()),
            kupo_cache: Mutex::new(Cached::default()),
            lasting: Mutex::new(HashMap::new()),
            working: Mutex::new(HashSet::new()),
        }
    }

    /// Tokens' decimals from the registry, for `asset_list`s.
    pub fn with_decimals(mut self, decimals: Decimals) -> Self {
        self.decimals = decimals;
        self
    }

    /// Kupo, the private index's second source.
    pub fn with_kupo(mut self, kupo: Option<Kupo>) -> Self {
        self.kupo = kupo;
        self
    }

    /// Takes a newly read tip; a new block drops every cached answer.
    pub fn set_tip(&self, tip: Tip) {
        self.db_failing.store(false, Ordering::Relaxed);
        let mut held = self.tip.write().expect("tip lock");
        if held.as_ref().map(|t| &t.hash) != Some(&tip.hash) {
            self.cache.lock().expect("cache lock").set_tip(&tip.hash);
            *held = Some(tip);
        }
    }

    pub fn tip(&self) -> Option<Tip> {
        self.tip.read().expect("tip lock").clone()
    }

    /// Takes Kupo's newly read tip; a new block drops the answers made from it.
    pub fn set_kupo_tip(&self, tip: Block) {
        self.kupo_failing.store(false, Ordering::Relaxed);
        let mut held = self.kupo_tip.write().expect("tip lock");
        if held.as_ref() != Some(&tip) {
            self.kupo_cache
                .lock()
                .expect("cache lock")
                .set_tip(&tip.hash);
            *held = Some(tip);
        }
    }

    pub fn kupo_tip(&self) -> Option<Block> {
        self.kupo_tip.read().expect("tip lock").clone()
    }

    /// db-sync's tip, if it's fresh enough to answer from and still reads.
    pub fn fresh_tip(&self) -> Result<Tip, ApiError> {
        let tip = self.tip().ok_or(ApiError::Behind)?;
        if age(&tip) > MAX_AGE_SECS || self.db_failing.load(Ordering::Relaxed) {
            return Err(ApiError::Behind);
        }
        Ok(tip)
    }

    /// The private index's sources that can answer now, best first, each with
    /// its tip: each while its tip reads and is fresh, db-sync first unless
    /// Kupo is well ahead of it.
    pub fn private_sources(&self) -> Vec<(Source, Block)> {
        let db_sync = self.fresh_tip().ok().map(|tip| {
            (
                Source::DbSync(self.chain.clone()),
                Block {
                    slot: tip.slot,
                    hash: tip.hash,
                },
            )
        });
        let kupo = self.kupo.clone().zip(self.kupo_tip().filter(|tip| {
            block_age(tip) <= MAX_AGE_SECS && !self.kupo_failing.load(Ordering::Relaxed)
        }));
        source::order(db_sync, kupo.map(|(kupo, tip)| (Source::Kupo(kupo), tip)))
    }

    /// The answer for `key` at `tip`, from the cache or made by `make` and kept.
    pub async fn cached<F, Fut, T>(&self, tip: &Tip, key: &str, make: F) -> Result<Bytes, ApiError>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, ApiError>>,
        T: Serialize,
    {
        self.cached_bytes(tip, key, || async { to_json(&make().await?) })
            .await
    }

    /// [`Self::cached`], for an answer `make` has already written.
    pub async fn cached_bytes<F, Fut>(
        &self,
        tip: &Tip,
        key: &str,
        make: F,
    ) -> Result<Bytes, ApiError>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<Bytes, ApiError>>,
    {
        self.cached_in(Upstream::DbSync, &tip.hash, key, make).await
    }

    /// The answer for `key` made from `upstream` at its tip `tip`, from that
    /// source's cache or made by `make` and kept until its tip moves.
    pub async fn cached_in<F, Fut>(
        &self,
        upstream: Upstream,
        tip: &str,
        key: &str,
        make: F,
    ) -> Result<Bytes, ApiError>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<Bytes, ApiError>>,
    {
        let cache = match upstream {
            Upstream::DbSync => &self.cache,
            Upstream::Kupo => &self.kupo_cache,
        };
        let cell = cache.lock().expect("cache lock").cell(tip, key);
        let Some(cell) = cell else {
            return make().await;
        };
        // A failed or abandoned read leaves the cell empty, for the next request to fill.
        let bytes = cell
            .get_or_try_init(|| async {
                let bytes = make().await?;
                let mut cache = cache.lock().expect("cache lock");
                if cache.tip == tip {
                    cache.bytes += bytes.len();
                }
                Ok::<_, ApiError>(bytes)
            })
            .await?;
        Ok(bytes.clone())
    }

    /// The answer for `key` made within `keep`, whatever the tip has done
    /// since: for what changes slowly (an epoch's parameters, the pools).
    pub async fn lasting<F, Fut>(
        &self,
        key: &str,
        keep: Duration,
        make: F,
    ) -> Result<Bytes, ApiError>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<Bytes, ApiError>>,
    {
        if let Some(hit) = self.kept(key) {
            return Ok(hit);
        }
        let bytes = make().await?;
        // An empty answer is "not found": anyone can ask about made-up IDs,
        // so those aren't kept, or they'd crowd out the real ones.
        if !bytes.is_empty() {
            self.keep(key, keep, bytes.clone());
        }
        Ok(bytes)
    }

    /// A [`Self::lasting`] answer still within its time, if there is one.
    pub fn kept(&self, key: &str) -> Option<Bytes> {
        let lasting = self.lasting.lock().expect("lasting lock");
        let (until, hit) = lasting.get(key)?;
        (Instant::now() < *until).then(|| hit.clone())
    }

    /// Keeps `bytes` as [`Self::lasting`]'s answer for `key`, for `keep`.
    /// When full, the answer due to expire soonest makes room.
    pub fn keep(&self, key: &str, keep: Duration, bytes: Bytes) {
        let now = Instant::now();
        let mut lasting = self.lasting.lock().expect("lasting lock");
        if lasting.len() >= MAX_LASTING && !lasting.contains_key(key) {
            lasting.retain(|_, (until, _)| now < *until);
            if lasting.len() >= MAX_LASTING {
                let soonest = lasting
                    .iter()
                    .min_by_key(|(_, (until, _))| *until)
                    .map(|(key, _)| key.clone());
                if let Some(soonest) = soonest {
                    lasting.remove(&soonest);
                }
            }
        }
        lasting.insert(key.to_string(), (now + keep, bytes));
    }

    /// A [`Self::lasting`] answer past its time by at most `within`: to answer
    /// at once while a fresh one is worked out behind it, never with one so old
    /// it misleads (a pool that has since announced its retirement).
    pub fn kept_stale(&self, key: &str, within: Duration) -> Option<Bytes> {
        let lasting = self.lasting.lock().expect("lasting lock");
        let (until, hit) = lasting.get(key)?;
        (Instant::now() < *until + within).then(|| hit.clone())
    }

    /// Marks `key` as being worked out until the guard is dropped, however
    /// the work ends; `None` if it already is.
    pub fn start(self: &Arc<Self>, key: &str) -> Option<Working> {
        let fresh = self
            .working
            .lock()
            .expect("working lock")
            .insert(key.to_string());
        fresh.then(|| Working {
            state: self.clone(),
            key: key.to_string(),
        })
    }

    #[cfg(test)]
    fn lookup(&self, tip: &str, key: &str) -> Option<Bytes> {
        let cache = self.cache.lock().expect("cache lock");
        (cache.tip == tip).then(|| cache.answers.get(key)?.get().cloned())?
    }
}

/// `value` as JSON.
pub fn to_json<T: Serialize>(value: &T) -> Result<Bytes, ApiError> {
    Ok(Bytes::from(
        serde_json::to_vec(value).map_err(anyhow::Error::from)?,
    ))
}

/// An answer being worked out ([`AppState::start`]): dropped, it no longer is.
pub struct Working {
    state: Arc<AppState>,
    key: String,
}

impl Drop for Working {
    fn drop(&mut self) {
        if let Ok(mut working) = self.state.working.lock() {
            working.remove(&self.key);
        }
    }
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

/// Seconds since the tip's block was made.
pub fn age(tip: &Tip) -> i64 {
    now() - tip.time
}

/// Seconds since a block was made, from its slot.
pub fn block_age(block: &Block) -> i64 {
    now() - slot_time(block.slot)
}

/// Reads db-sync's tip every [`WATCH_EVERY`], for as long as the server runs.
pub async fn watch_tip(state: Arc<AppState>) {
    let mut every = tokio::time::interval(WATCH_EVERY);
    every.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut failed = 0;
    loop {
        every.tick().await;
        let read = tokio::time::timeout(TIP_TIMEOUT, state.chain.tip()).await;
        match read.unwrap_or_else(|_| Err(anyhow::anyhow!("timed out"))) {
            Ok(tip) => {
                if failed >= FAILED_READS {
                    info!("db-sync's tip reads again");
                }
                failed = 0;
                state.set_tip(tip);
            }
            Err(error) => {
                failed += 1;
                if failed == FAILED_READS {
                    state.db_failing.store(true, Ordering::Relaxed);
                    warn!(error = failure(&error), "db-sync's tip couldn't be read");
                }
            }
        }
    }
}

/// Reads Kupo's tip every [`WATCH_EVERY`], while there's a Kupo.
pub async fn watch_kupo(state: Arc<AppState>) {
    let Some(kupo) = state.kupo.clone() else {
        return;
    };
    let mut every = tokio::time::interval(WATCH_EVERY);
    every.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut failed = 0;
    loop {
        every.tick().await;
        let read = tokio::time::timeout(TIP_TIMEOUT, kupo.tip()).await;
        match read.unwrap_or_else(|_| Err(anyhow::anyhow!("Kupo timed out"))) {
            Ok(tip) => {
                if failed >= FAILED_READS {
                    info!("Kupo's tip reads again");
                }
                failed = 0;
                state.set_kupo_tip(tip);
            }
            Err(error) => {
                failed += 1;
                if failed == FAILED_READS {
                    state.kupo_failing.store(true, Ordering::Relaxed);
                    warn!(%error, "Kupo's tip couldn't be read");
                }
            }
        }
    }
}

/// Why a request got no answer. Nothing here carries the request itself.
#[derive(Debug)]
pub enum ApiError {
    /// What this server doesn't take: a cursor it wouldn't have handed out,
    /// or a request the wallet never makes. 400.
    Bad(&'static str),
    /// db-sync's tip is missing or old: 503, so the wallet goes to Koios.
    Behind,
    /// Every connection is in use: 503 at once, rather than a queue.
    Busy,
    /// More than this server reads for one request (a credential with tens of
    /// thousands of outputs): 503, and the wallet reads Koios.
    Heavy,
    /// db-sync couldn't answer: 503.
    Unavailable(anyhow::Error),
}

impl From<anyhow::Error> for ApiError {
    fn from(error: anyhow::Error) -> Self {
        ApiError::Unavailable(error)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, error) = match self {
            ApiError::Bad(why) => (StatusCode::BAD_REQUEST, why),
            ApiError::Behind => (StatusCode::SERVICE_UNAVAILABLE, "behind"),
            ApiError::Busy => (StatusCode::SERVICE_UNAVAILABLE, "busy"),
            ApiError::Heavy => (StatusCode::SERVICE_UNAVAILABLE, "too large for this server"),
            ApiError::Unavailable(error) => {
                static FAILED: Throttle = Throttle::new();
                if FAILED.due() {
                    warn!(error = failure(&error), "a query failed");
                }
                (StatusCode::SERVICE_UNAVAILABLE, "unavailable")
            }
        };
        let mut response =
            (status, axum::Json(serde_json::json!({ "error": error }))).into_response();
        if status == StatusCode::SERVICE_UNAVAILABLE {
            response
                .headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from_static("30"));
        }
        response
    }
}

/// What a failure was, for the log, and nothing of the request: a Postgres
/// error's SQLSTATE (its message can quote a value the request sent: 57014
/// is a query cancelled by the statement timeout), or the error's own words.
pub fn failure(error: &anyhow::Error) -> String {
    let postgres = error
        .chain()
        .find_map(|cause| cause.downcast_ref::<tokio_postgres::Error>());
    // An I/O error says what happened to a connection (refused, reset, timed
    // out) by its kind, which names no address.
    let io = error
        .chain()
        .find_map(|cause| cause.downcast_ref::<std::io::Error>())
        .or_else(|| {
            let mut source = std::error::Error::source(postgres?);
            while let Some(cause) = source {
                if let Some(io) = cause.downcast_ref::<std::io::Error>() {
                    return Some(io);
                }
                source = cause.source();
            }
            None
        });
    match postgres.and_then(|e| e.code()) {
        Some(code) => format!("postgres {}", code.code()),
        None => match (postgres, io) {
            (Some(_), Some(io)) => format!("postgres connection: {}", io.kind()),
            (Some(e), None) if e.is_closed() => "postgres connection closed".into(),
            (Some(_), None) => "postgres".into(),
            (None, _) => error.to_string(),
        },
    }
}

/// Lets a log line through at most once in [`LOG_EVERY_SECS`].
pub struct Throttle(AtomicI64);

impl Throttle {
    pub const fn new() -> Self {
        Throttle(AtomicI64::new(i64::MIN))
    }

    /// Whether to log now; if so, nothing more is for a while.
    pub fn due(&self) -> bool {
        let now = now();
        let last = self.0.load(Ordering::Relaxed);
        now.saturating_sub(last) >= LOG_EVERY_SECS
            && self
                .0
                .compare_exchange(last, now, Ordering::Relaxed, Ordering::Relaxed)
                .is_ok()
    }
}

impl Default for Throttle {
    fn default() -> Self {
        Self::new()
    }
}

/// A cached JSON answer.
pub fn json(bytes: Bytes) -> Response {
    ([(header::CONTENT_TYPE, "application/json")], bytes).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tip(hash: &str, time: i64) -> Tip {
        Tip {
            height: 1,
            slot: 1,
            hash: hash.into(),
            time,
            epoch: 1,
            epoch_slot: 1,
            era: Some("Conway"),
        }
    }

    fn state() -> AppState {
        AppState::new(Chain::connect("postgresql://nobody@127.0.0.1:1/nothing").unwrap())
    }

    #[tokio::test]
    async fn answers_are_kept_until_the_tip_moves() {
        let state = state();
        let now = tip("a", i64::MAX / 2);
        state.set_tip(now.clone());
        let first = state.cached(&now, "k", || async { Ok(1) }).await.unwrap();
        let again = state.cached(&now, "k", || async { Ok(2) }).await.unwrap();
        assert_eq!((first.as_ref(), again.as_ref()), (&b"1"[..], &b"1"[..]));

        let next = tip("b", i64::MAX / 2);
        state.set_tip(next.clone());
        let after = state.cached(&next, "k", || async { Ok(3) }).await.unwrap();
        assert_eq!(after.as_ref(), b"3");
    }

    #[tokio::test]
    async fn an_answer_made_for_an_old_tip_isnt_kept() {
        let state = state();
        state.set_tip(tip("new", 0));
        let old = tip("old", 0);
        state.cached(&old, "k", || async { Ok(1) }).await.unwrap();
        assert!(state.lookup("new", "k").is_none());
        assert!(state.lookup("old", "k").is_none());
    }

    #[tokio::test]
    async fn requests_that_miss_together_share_one_read() {
        let state = state();
        let now = tip("a", i64::MAX / 2);
        state.set_tip(now.clone());
        let reads = std::sync::atomic::AtomicUsize::new(0);
        let read = || async {
            reads.fetch_add(1, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(20)).await;
            to_json(&1)
        };
        let (a, b) = tokio::join!(
            state.cached_in(Upstream::DbSync, "a", "k", read),
            state.cached_in(Upstream::DbSync, "a", "k", read),
        );
        assert_eq!(
            (a.unwrap(), b.unwrap()),
            (Bytes::from("1"), Bytes::from("1"))
        );
        assert_eq!(reads.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_failed_read_leaves_the_answer_for_the_next() {
        let state = state();
        state.set_tip(tip("a", i64::MAX / 2));
        let failed = state
            .cached_in(Upstream::DbSync, "a", "k", || async { Err(ApiError::Busy) })
            .await;
        assert!(matches!(failed, Err(ApiError::Busy)));
        let next = state
            .cached_in(Upstream::DbSync, "a", "k", || async { to_json(&2) })
            .await;
        assert_eq!(next.unwrap(), Bytes::from("2"));
    }

    #[test]
    fn a_throttle_lets_one_line_through_a_while() {
        let throttle = Throttle::new();
        assert!(throttle.due());
        assert!(!throttle.due());
    }

    #[test]
    fn work_is_marked_until_its_guard_drops() {
        let state = Arc::new(state());
        let working = state.start("k").unwrap();
        assert!(state.start("k").is_none());
        drop(working);
        assert!(state.start("k").is_some());
    }

    #[test]
    fn a_stale_answer_is_held_a_while() {
        let state = state();
        state.keep("k", Duration::ZERO, Bytes::from_static(b"1"));
        assert!(state.kept("k").is_none());
        let within = Duration::from_secs(60);
        assert_eq!(state.kept_stale("k", within).unwrap().as_ref(), b"1");
        assert!(state.kept_stale("k", Duration::ZERO).is_none());
    }

    #[tokio::test]
    async fn not_found_isnt_kept() {
        let state = state();
        let keep = Duration::from_secs(60);
        state
            .lasting("gone", keep, || async { Ok(Bytes::new()) })
            .await
            .unwrap();
        assert!(state.kept("gone").is_none());
        state
            .lasting("here", keep, || async { to_json(&1) })
            .await
            .unwrap();
        assert!(state.kept("here").is_some());
    }

    #[test]
    fn a_full_store_makes_room() {
        let state = state();
        let bytes = Bytes::from_static(b"1");
        state.keep("soon", Duration::from_secs(1), bytes.clone());
        for i in 1..MAX_LASTING {
            state.keep(&format!("k{i}"), Duration::from_secs(600), bytes.clone());
        }
        state.keep("new", Duration::from_secs(600), bytes);
        assert!(state.kept("new").is_some());
        assert!(state.kept("soon").is_none());
    }

    #[test]
    fn an_old_tip_is_behind() {
        let state = state();
        assert!(matches!(state.fresh_tip(), Err(ApiError::Behind)));
        state.set_tip(tip("a", 0));
        assert!(matches!(state.fresh_tip(), Err(ApiError::Behind)));
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        state.set_tip(tip("b", now - 5));
        assert!(state.fresh_tip().is_ok());
    }
}
