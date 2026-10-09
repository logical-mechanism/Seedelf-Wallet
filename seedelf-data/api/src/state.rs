//! What the server holds: db-sync's tip, watched every 2 s, and answers
//! cached until the tip moves. Every answer here is the same for everyone who
//! asks, so one query per block serves them all.

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::body::Bytes;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use tracing::{info, warn};

use crate::chain::{Chain, Tip};
use crate::decimals::Decimals;

/// A tip older than this is behind, and its part answers 503 so the wallet
/// goes to Koios. Mainnet makes a block every 20 s on average, and a 3 min gap
/// comes about once in 10,000.
pub const MAX_AGE_SECS: i64 = 180;

/// How often db-sync's tip is read.
pub const WATCH_EVERY: Duration = Duration::from_secs(2);

/// Answers held for one tip, at most: past this, nothing more is kept until it moves.
const MAX_CACHED: usize = 1024;

/// Answers held for a time, at most (`lasting`).
const MAX_LASTING: usize = 4096;

pub struct AppState {
    pub chain: Chain,
    pub decimals: Decimals,
    tip: RwLock<Option<Tip>>,
    cache: Mutex<Cached>,
    lasting: Mutex<HashMap<String, (Instant, Bytes)>>,
}

#[derive(Default)]
struct Cached {
    tip: String,
    answers: HashMap<String, Bytes>,
}

impl AppState {
    pub fn new(chain: Chain) -> Self {
        AppState {
            chain,
            decimals: Decimals::default(),
            tip: RwLock::new(None),
            cache: Mutex::new(Cached::default()),
            lasting: Mutex::new(HashMap::new()),
        }
    }

    /// Tokens' decimals from the registry, for `asset_list`s.
    pub fn with_decimals(mut self, decimals: Decimals) -> Self {
        self.decimals = decimals;
        self
    }

    /// Takes a newly read tip; a new block drops every cached answer.
    pub fn set_tip(&self, tip: Tip) {
        let mut held = self.tip.write().expect("tip lock");
        if held.as_ref().map(|t| &t.hash) != Some(&tip.hash) {
            let mut cache = self.cache.lock().expect("cache lock");
            cache.tip = tip.hash.clone();
            cache.answers.clear();
            *held = Some(tip);
        }
    }

    pub fn tip(&self) -> Option<Tip> {
        self.tip.read().expect("tip lock").clone()
    }

    /// The tip, if it's fresh enough to answer from.
    pub fn fresh_tip(&self) -> Result<Tip, ApiError> {
        let tip = self.tip().ok_or(ApiError::Behind)?;
        if age(&tip) > MAX_AGE_SECS {
            return Err(ApiError::Behind);
        }
        Ok(tip)
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
        if let Some(hit) = self.lookup(&tip.hash, key) {
            return Ok(hit);
        }
        let bytes = make().await?;
        let mut cache = self.cache.lock().expect("cache lock");
        if cache.tip == tip.hash && cache.answers.len() < MAX_CACHED {
            cache.answers.insert(key.to_string(), bytes.clone());
        }
        Ok(bytes)
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
        let now = Instant::now();
        if let Some((until, hit)) = self.lasting.lock().expect("lasting lock").get(key)
            && now < *until
        {
            return Ok(hit.clone());
        }
        let bytes = make().await?;
        let mut lasting = self.lasting.lock().expect("lasting lock");
        if lasting.len() >= MAX_LASTING {
            lasting.retain(|_, (until, _)| now < *until);
        }
        if lasting.len() < MAX_LASTING {
            lasting.insert(key.to_string(), (now + keep, bytes.clone()));
        }
        Ok(bytes)
    }

    fn lookup(&self, tip: &str, key: &str) -> Option<Bytes> {
        let cache = self.cache.lock().expect("cache lock");
        (cache.tip == tip).then(|| cache.answers.get(key).cloned())?
    }
}

/// `value` as JSON.
pub fn to_json<T: Serialize>(value: &T) -> Result<Bytes, ApiError> {
    Ok(Bytes::from(
        serde_json::to_vec(value).map_err(anyhow::Error::from)?,
    ))
}

/// Seconds since the tip's block was made.
pub fn age(tip: &Tip) -> i64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64);
    now - tip.time
}

/// Reads db-sync's tip every [`WATCH_EVERY`], for as long as the server runs.
pub async fn watch_tip(state: std::sync::Arc<AppState>) {
    let mut every = tokio::time::interval(WATCH_EVERY);
    every.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut failing = false;
    loop {
        every.tick().await;
        match state.chain.tip().await {
            Ok(tip) => {
                if failing {
                    info!("db-sync's tip reads again");
                    failing = false;
                }
                state.set_tip(tip);
            }
            Err(error) => {
                if !failing {
                    warn!(%error, "db-sync's tip couldn't be read");
                    failing = true;
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
            ApiError::Unavailable(error) => {
                warn!(%error, "a query failed");
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
