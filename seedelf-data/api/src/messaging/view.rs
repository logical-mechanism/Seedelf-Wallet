//! The relay's view of the chain, for §21.7's check 8 (chunk 55's call 6,
//! the owner, 2026-11-26): a certificate is listed only if its (g_S, u_S) is
//! the datum register of the contract UTxO that holds its Seedelf token now.
//! Without it anyone could fill the list for good with certificates for
//! registers they made up, since a certificate needs only a key pair.
//!
//! - **Mainnet: the data layer's own view** ([`Index`]). The names answer
//!   (`private::names_answer`), every Seedelf name unspent at the contract at
//!   a source's tip with the row that holds it, is made once a tip and kept
//!   with it, and it's what the wallet's pay-by-name reads. The relay reads
//!   every register from it once a tip, into memory, so a post reads nothing
//!   of its own. The sweep (`messaging::sweep`) drops each listed
//!   certificate whose Seedelf isn't at its register any more, a removal
//!   entry taking its place, and each withdrawn digest whose Seedelf it's
//!   found elsewhere three sweeps in a row.
//! - **Preprod: Koios's view, asked at post time** ([`Koios`]). The data
//!   layer has no preprod chain. Koios's `asset_utxos` for the one Seedelf,
//!   as seedelf-koios's `nft_utxo` asks it, within 5 s and never retried, at
//!   most 4 at once, and each answer kept a minute, so a repeated post asks
//!   once. A slow re-check (`Relay::recheck_step`) asks again about each
//!   Seedelf the list knows, once a day at most and one every 2 s, through
//!   the same client, places and answers, and drops what's moved, once a
//!   second ask at least 10 minutes on finds it elsewhere too: Koios
//!   learns nothing it didn't at the post.
//!
//!   **Within a day's budget** ([`KOIOS_BUDGET`]): at most 4,000 requests a
//!   day, below the public tier's 5,000 for one address, of which the
//!   re-check never takes the last 1,000, kept for posts, so a round takes
//!   as many days as the budget needs. A 429 stops every request for its
//!   `Retry-After`, or an hour, and so does a run of 5 failures.
//!
//! A view that can't be read now is [`Unreadable`]: the post is a 503, and
//! no certificate is ever listed unchecked.
//!
//! **What Koios learns:** that the relay asked, from the relay's own
//! address, about one Seedelf name on preprod, and when; never who posted,
//! nor the certificate. Whoever also sees that wallet's own reads of Koios
//! (on preprod it reads Koios alone) could match the two by their times.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::body::Bytes;
use serde::Deserialize;
use serde::de::IgnoredAny;
use tracing::warn;

use crate::constants::{CONTRACT_HASH, SEEDELF_POLICY};
use crate::lovejoin::datum::register_of;
use crate::state::{AppState, Throttle};

/// A datum register, `g_S ‖ u_S`, each point compressed.
pub type Register = [u8; 96];

/// The relay can't read the chain now: §21.7's 503 `can't check the chain
/// now`, with the seconds its `Retry-After` gives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Unreadable {
    pub retry_after: u64,
}

impl Unreadable {
    /// The view didn't answer: a minute.
    pub const NOW: Unreadable = Unreadable { retry_after: 60 };
}

/// Each view of the chain read gets the next number (`List::judge`'s
/// `view`): a names answer read into registers, an answer from Koios. A
/// view read again, the same tip's answer or a kept one, keeps its number,
/// so an absence on it is counted once.
static VIEWS: AtomicU64 = AtomicU64::new(1);

fn new_view() -> u64 {
    VIEWS.fetch_add(1, Ordering::Relaxed)
}

/// Where a pool reads the chain.
pub enum View {
    /// Nowhere: every certificate post is a 503, never listed unchecked. A
    /// relay made without views (a test's) is so.
    Nowhere,
    Index(Index),
    Koios(Koios),
}

impl View {
    /// Mainnet's: the private index's names answer.
    pub fn index(state: Arc<AppState>) -> Self {
        View::Index(Index {
            state,
            read: tokio::sync::Mutex::new(None),
        })
    }

    /// Preprod's: Koios at `base`, its API (`…/api/v1`), with the deadline,
    /// the places at once and the minute's answers as [`Koios::new`] gives.
    pub fn koios(base: &str) -> anyhow::Result<Self> {
        Ok(View::Koios(Koios::new(base)?))
    }

    /// What `/health` names it by.
    pub fn name(&self) -> &'static str {
        match self {
            View::Nowhere => "none",
            View::Index(_) => "index",
            View::Koios(_) => "koios",
        }
    }

    /// The register of the contract UTxO that holds the Seedelf named `name`
    /// now: none where no contract UTxO does, more than one does, or its
    /// datum isn't a register.
    pub async fn register(&self, name: &[u8]) -> Result<Option<Register>, Unreadable> {
        match self {
            View::Nowhere => Err(Unreadable::NOW),
            View::Index(index) => Ok(index.registers().await?.of(name)),
            View::Koios(koios) => koios.register(name).await,
        }
    }

    /// Koios's client, which preprod's re-check asks through.
    pub fn as_koios(&self) -> Option<&Koios> {
        match self {
            View::Koios(koios) => Some(koios),
            View::Nowhere | View::Index(_) => None,
        }
    }

    /// Forgets what it keeps past its time: Koios's answers past their
    /// minute, so no name is held longer (`Relay::tidy`, every minute).
    pub fn tidy(&self) {
        if let View::Koios(koios) = self {
            koios.forget();
        }
    }

    /// Every Seedelf's register now, for the sweep: the index's alone.
    pub async fn every(&self) -> Option<Result<Arc<Registers>, Unreadable>> {
        match self {
            View::Index(index) => Some(index.registers().await),
            View::Nowhere | View::Koios(_) => None,
        }
    }
}

/// Every Seedelf's register at one tip.
#[derive(Debug, Default)]
pub struct Registers {
    /// By asset name: none where it isn't a register, or two rows hold it.
    by_name: HashMap<Vec<u8>, Option<Register>>,
    /// This view's number: the next at each names answer read.
    view: u64,
}

impl Registers {
    /// Its view's number (`List::sweep`'s `view`).
    pub fn view(&self) -> u64 {
        self.view
    }

    /// The register `name` is at.
    pub fn of(&self, name: &[u8]) -> Option<Register> {
        self.by_name.get(name).copied().flatten()
    }

    /// Whether the Seedelf `name` is at `register`.
    pub fn holds(&self, name: &[u8], register: &[u8]) -> bool {
        self.of(name).is_some_and(|held| held[..] == *register)
    }

    /// How many names it knows.
    pub fn len(&self) -> usize {
        self.by_name.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_name.is_empty()
    }

    /// Every Seedelf token under the Seedelf policy in the names answer's
    /// rows (`private::names`), each with its row's inline datum read as a
    /// register. Every asset of a row is read, not only the name it's
    /// listed under. Nothing if the JSON isn't a names answer.
    pub fn from_names(json: &[u8]) -> Option<Self> {
        #[derive(Deserialize)]
        struct Names {
            names: Vec<Name>,
        }
        #[derive(Deserialize)]
        struct Name {
            row: Row,
        }
        #[derive(Deserialize)]
        struct Row {
            #[serde(default)]
            assets: Vec<(String, String, IgnoredAny, IgnoredAny)>,
            #[serde(default)]
            datum: Option<String>,
        }
        let names: Names = serde_json::from_slice(json).ok()?;
        let mut registers = Registers {
            by_name: HashMap::new(),
            view: new_view(),
        };
        for Name { row } in names.names {
            let register = row
                .datum
                .as_deref()
                .and_then(hex)
                .and_then(|datum| register_of(&datum));
            for (policy, name, ..) in row.assets {
                if policy != SEEDELF_POLICY {
                    continue;
                }
                let Some(name) = hex(&name) else { continue };
                // Two rows with one name (which the policy never mints) say
                // nothing of either.
                let held = match registers.by_name.contains_key(&name) {
                    true => None,
                    false => register,
                };
                registers.by_name.insert(name, held);
            }
        }
        Some(registers)
    }
}

/// Mainnet's view: the names answer, read into memory once a tip.
pub struct Index {
    state: Arc<AppState>,
    /// The answer last read, and its registers: the same answer (its tip's,
    /// kept in the state's cache) is the same registers.
    read: tokio::sync::Mutex<Option<(Bytes, Arc<Registers>)>>,
}

impl Index {
    pub async fn registers(&self) -> Result<Arc<Registers>, Unreadable> {
        static FAILED: Throttle = Throttle::new();
        // The private index logs its own sources' failures.
        let Ok(answer) = crate::private::names_answer(&self.state).await else {
            if FAILED.due() {
                warn!("the relay's chain check couldn't read the private index");
            }
            return Err(Unreadable::NOW);
        };
        let mut read = self.read.lock().await;
        if let Some((bytes, registers)) = read.as_ref()
            && bytes.as_ptr() == answer.as_ptr()
            && bytes.len() == answer.len()
        {
            return Ok(registers.clone());
        }
        let registers = Arc::new(Registers::from_names(&answer).ok_or(Unreadable::NOW)?);
        *read = Some((answer, registers.clone()));
        Ok(registers)
    }
}

/// A Koios request's deadline, its wait for a place included: past it, the
/// post is a 503. Never retried.
pub const KOIOS_DEADLINE: Duration = Duration::from_secs(5);

/// At most this many requests to Koios at once [choice]: Koios's public
/// tier counts the relay's address as one client.
pub const KOIOS_AT_ONCE: usize = 4;

/// How long an answer is kept [choice]: a repeated post, or a Seedelf's
/// second certificate, asks Koios once. A Seedelf minted or moved within
/// it is seen when it's over.
pub const KOIOS_KEPT: Duration = Duration::from_secs(60);

/// At most this many answers are kept.
const KOIOS_KEPT_MOST: usize = 4096;

/// The most of an answer read: one Seedelf's row is a few KiB.
const KOIOS_ANSWER_MOST: usize = 256 * 1024;

/// What the relay asks of Koios in a day, Unix days.
#[derive(Debug, Clone, Copy)]
pub struct Budget {
    /// Requests, at most.
    pub a_day: u32,
    /// Of them, the last this many are posts' alone: the re-check stops
    /// short of them, so a post always has its check.
    pub for_posts: u32,
}

/// The relay's budget [choice]: Koios's public tier allows one address
/// 5,000 requests a day, and the relay keeps under it, leaving the rest to
/// whatever else shares the droplet's address. The re-check takes at most
/// 3,000, so a round of more Seedelfs than that takes days.
pub const KOIOS_BUDGET: Budget = Budget {
    a_day: 4_000,
    for_posts: 1_000,
};

/// A run of this many failures in a row (no answer within the deadline, a
/// status but 2xx or 429, an answer that isn't one) stops every request
/// for [`KOIOS_BACK_OFF`] [choice]: a Koios that's down isn't asked again
/// every post.
pub const KOIOS_FAILURES: u32 = 5;

/// How long every request stops after such a run, or after a 429 that
/// names no `Retry-After` [choice], in seconds.
pub const KOIOS_BACK_OFF: u64 = 3600;

/// The longest a 429's `Retry-After` stops requests for, in seconds: a
/// day.
const KOIOS_BACK_OFF_MOST: u64 = 86_400;

/// An answer kept: when it came, the register it gave, and its view's
/// number.
type Kept = (Instant, Option<Register>, u64);

/// Who asks Koios: a post's check 8, or the re-check, which takes only
/// what the budget leaves posts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Asker {
    Post,
    Recheck,
}

/// Why Koios gave no answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unasked {
    /// It wasn't asked: the day's budget is spent, or every request is
    /// stopped, for this many seconds more.
    Waiting(u64),
    /// It was asked and didn't answer.
    Failed,
}

impl From<Unasked> for Unreadable {
    fn from(unasked: Unasked) -> Self {
        match unasked {
            Unasked::Waiting(secs) => Unreadable {
                retry_after: secs.max(1),
            },
            Unasked::Failed => Unreadable::NOW,
        }
    }
}

/// What a request to Koios came to, for the budget.
enum Failure {
    /// Not sent.
    Waiting(u64),
    /// A 429, and its `Retry-After` in seconds if it named one.
    Limited(Option<u64>),
    Other,
}

/// What's been asked today, and how it went.
#[derive(Debug, Default)]
struct Spent {
    /// Its Unix day.
    day: i64,
    asked: u32,
    /// Failures in a row.
    failures: u32,
    /// Every request stops until then, Unix seconds.
    until: i64,
}

/// Preprod's view: Koios, asked at each post.
pub struct Koios {
    http: reqwest::Client,
    /// `…/asset_utxos`.
    url: String,
    deadline: Duration,
    keep_for: Duration,
    gate: tokio::sync::Semaphore,
    kept: Mutex<HashMap<Vec<u8>, Kept>>,
    budget: Budget,
    spent: Mutex<Spent>,
}

/// One row of Koios's answer, as seedelf-koios's `UtxoResponse` reads it:
/// only what the check needs. A field not named here (the datum's JSON,
/// a reference script's) is skipped without serde_json's depth limit, so a
/// datum nested deeper than 128 levels can't make the answer unreadable.
#[derive(Deserialize)]
struct AssetUtxo {
    #[serde(default)]
    payment_cred: Option<String>,
    #[serde(default)]
    inline_datum: Option<InlineDatum>,
    #[serde(default)]
    is_spent: bool,
}

#[derive(Deserialize)]
struct InlineDatum {
    bytes: String,
}

impl Koios {
    /// Koios at `base`, `https://` alone: within [`KOIOS_DEADLINE`],
    /// [`KOIOS_AT_ONCE`] at once, answers kept [`KOIOS_KEPT`], and no
    /// redirect followed.
    pub fn new(base: &str) -> anyhow::Result<Self> {
        anyhow::ensure!(
            base.starts_with("https://"),
            "Koios is reached over https:// alone"
        );
        Self::build(base, KOIOS_DEADLINE, KOIOS_KEPT, true)
    }

    /// [`Koios::new`] with another deadline and another time answers are
    /// kept, over plain HTTP too: a test's, for a Koios on loopback.
    pub fn with(base: &str, deadline: Duration, keep_for: Duration) -> anyhow::Result<Self> {
        Self::build(base, deadline, keep_for, false)
    }

    fn build(
        base: &str,
        deadline: Duration,
        keep_for: Duration,
        https: bool,
    ) -> anyhow::Result<Self> {
        Ok(Koios {
            http: reqwest::Client::builder()
                .connect_timeout(deadline)
                .timeout(deadline)
                .redirect(reqwest::redirect::Policy::none())
                .https_only(https)
                .build()?,
            url: format!("{}/asset_utxos", base.trim_end_matches('/')),
            deadline,
            keep_for,
            gate: tokio::sync::Semaphore::new(KOIOS_AT_ONCE),
            kept: Mutex::new(HashMap::new()),
            budget: KOIOS_BUDGET,
            spent: Mutex::new(Spent::default()),
        })
    }

    /// With another day's budget than [`KOIOS_BUDGET`]: a test's.
    pub fn with_budget(mut self, budget: Budget) -> Self {
        self.budget = budget;
        self
    }

    fn kept(&self, name: &[u8]) -> Option<(Option<Register>, u64)> {
        let kept = self.kept.lock().expect("kept lock");
        let (at, answer, view) = kept.get(name)?;
        (at.elapsed() < self.keep_for).then_some((*answer, *view))
    }

    /// Drops every answer past its time.
    fn forget(&self) {
        let keep_for = self.keep_for;
        self.kept
            .lock()
            .expect("kept lock")
            .retain(|_, (at, ..)| at.elapsed() < keep_for);
    }

    /// Takes one request of the day's budget for `asker` at `now`, Unix
    /// seconds, or says how long to wait: every request stopped, or the
    /// day's share spent until the day ends.
    fn take(&self, asker: Asker, now: i64) -> Result<(), Failure> {
        let mut spent = self.spent.lock().expect("spent lock");
        if now < spent.until {
            return Err(Failure::Waiting((spent.until - now) as u64));
        }
        let day = now.div_euclid(86_400);
        // A clock set back never gives a day's budget again.
        if day > spent.day {
            spent.day = day;
            spent.asked = 0;
        }
        let most = match asker {
            Asker::Post => self.budget.a_day,
            Asker::Recheck => self.budget.a_day.saturating_sub(self.budget.for_posts),
        };
        if spent.asked >= most {
            return Err(Failure::Waiting(((day + 1) * 86_400 - now) as u64));
        }
        spent.asked += 1;
        Ok(())
    }

    /// What a request sent at `now` came to: an answer ends a run of
    /// failures; a 429 stops every request for its `Retry-After`, or
    /// [`KOIOS_BACK_OFF`]; [`KOIOS_FAILURES`] in a row stop them for
    /// [`KOIOS_BACK_OFF`].
    fn went(&self, outcome: Result<(), &Failure>, now: i64) {
        static STOPPED: Throttle = Throttle::new();
        let mut spent = self.spent.lock().expect("spent lock");
        let stop = match outcome {
            Ok(()) => {
                spent.failures = 0;
                None
            }
            Err(Failure::Limited(after)) => {
                spent.failures = 0;
                Some(after.unwrap_or(KOIOS_BACK_OFF).min(KOIOS_BACK_OFF_MOST))
            }
            Err(Failure::Waiting(_)) => None,
            Err(Failure::Other) => {
                spent.failures += 1;
                (spent.failures >= KOIOS_FAILURES).then(|| {
                    spent.failures = 0;
                    KOIOS_BACK_OFF
                })
            }
        };
        if let Some(secs) = stop {
            spent.until = spent.until.max(now + secs as i64);
            if STOPPED.due() {
                warn!(
                    secs,
                    "Koios preprod refused or failed, so the relay asks it nothing for a while"
                );
            }
        }
    }

    /// How many answers it holds: a test's.
    pub fn kept_answers(&self) -> usize {
        self.kept.lock().expect("kept lock").len()
    }

    fn keep(&self, name: &[u8], answer: (Option<Register>, u64)) {
        if self.keep_for.is_zero() {
            return;
        }
        let mut kept = self.kept.lock().expect("kept lock");
        if kept.len() >= KOIOS_KEPT_MOST {
            let keep_for = self.keep_for;
            kept.retain(|_, (at, ..)| at.elapsed() < keep_for);
        }
        if kept.len() < KOIOS_KEPT_MOST || kept.contains_key(name) {
            kept.insert(name.to_vec(), (Instant::now(), answer.0, answer.1));
        }
    }

    /// The register `name` is at, for a post's check 8: [`Koios::answer`]
    /// now.
    pub async fn register(&self, name: &[u8]) -> Result<Option<Register>, Unreadable> {
        match self.answer(name, Asker::Post, unix_now()).await {
            Ok((register, _)) => Ok(register),
            Err(unasked) => Err(unasked.into()),
        }
    }

    /// The register `name` is at, and its view's number, from a kept
    /// answer or from Koios within the deadline, if `asker` has the day's
    /// budget for it at `now`, Unix seconds, and requests aren't stopped.
    /// Only an answer is kept, never a failure. Only a request that went
    /// counts toward a run of failures: a wait for a place that times out
    /// is the relay's own.
    pub async fn answer(
        &self,
        name: &[u8],
        asker: Asker,
        now: i64,
    ) -> Result<(Option<Register>, u64), Unasked> {
        if let Some(answer) = self.kept(name) {
            return Ok(answer);
        }
        let mut sent = false;
        let asked = tokio::time::timeout(self.deadline, async {
            let _place = self.gate.acquire().await.map_err(|_| Failure::Other)?;
            // Asked by another post while this one waited for a place.
            if let Some(answer) = self.kept(name) {
                return Ok(answer);
            }
            self.take(asker, now)?;
            sent = true;
            let answer = self.ask(name).await;
            self.went(answer.as_ref().map(|_| ()), now);
            Ok((answer?, new_view()))
        })
        .await;
        let failed = match asked {
            Ok(Ok(answer)) => {
                self.keep(name, answer);
                return Ok(answer);
            }
            Ok(Err(Failure::Waiting(secs))) => return Err(Unasked::Waiting(secs)),
            Ok(Err(_)) => true,
            Err(_) => {
                if sent {
                    self.went(Err(&Failure::Other), now);
                }
                sent
            }
        };
        static FAILED: Throttle = Throttle::new();
        if failed && FAILED.due() {
            warn!("the relay's chain check couldn't read Koios preprod");
        }
        // A failure that stopped every request: its wait, for the answer's
        // `Retry-After`.
        let until = self.spent.lock().expect("spent lock").until;
        if until > now {
            return Err(Unasked::Waiting((until - now) as u64));
        }
        Err(Unasked::Failed)
    }

    /// `POST asset_utxos {"_asset_list": [[policy, name]], "_extended":
    /// true}`, as seedelf-koios's `nft_utxo` asks it.
    async fn ask(&self, name: &[u8]) -> Result<Option<Register>, Failure> {
        let body = serde_json::json!({
            "_asset_list": [[SEEDELF_POLICY, hex_of(name)]],
            "_extended": true,
        });
        let mut response = self
            .http
            .post(&self.url)
            .header(reqwest::header::ACCEPT, "application/json")
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body.to_string())
            .send()
            .await
            .map_err(|_| Failure::Other)?;
        if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let after = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.trim().parse().ok());
            return Err(Failure::Limited(after));
        }
        if !response.status().is_success() {
            return Err(Failure::Other);
        }
        let mut answer = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| Failure::Other)? {
            answer.extend_from_slice(&chunk);
            if answer.len() > KOIOS_ANSWER_MOST {
                return Err(Failure::Other);
            }
        }
        let rows: Vec<AssetUtxo> = serde_json::from_slice(&answer).map_err(|_| Failure::Other)?;
        Ok(register_of_rows(&rows))
    }
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

/// The register of the one unspent row that holds the token, at the
/// contract, under an inline datum that's a register; none otherwise. More
/// than one row is none, as `nft_utxo` takes it.
fn register_of_rows(rows: &[AssetUtxo]) -> Option<Register> {
    let mut unspent = rows.iter().filter(|row| !row.is_spent);
    let (Some(row), None) = (unspent.next(), unspent.next()) else {
        return None;
    };
    if row.payment_cred.as_deref() != Some(CONTRACT_HASH) {
        return None;
    }
    register_of(&hex(&row.inline_datum.as_ref()?.bytes)?)
}

fn hex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(text.get(i..i + 2)?, 16).ok())
        .collect()
}

fn hex_of(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const G: [u8; 48] = [0x97; 48];
    const U: [u8; 48] = [0x82; 48];

    fn datum() -> String {
        let cbor = [
            &[0xd8, 0x79, 0x9f, 0x58, 0x30][..],
            &G,
            &[0x58, 0x30],
            &U,
            &[0xff],
        ]
        .concat();
        hex_of(&cbor)
    }

    fn register() -> Register {
        [G, U].concat().try_into().unwrap()
    }

    fn row(cred: &str, datum: Option<String>, spent: bool) -> AssetUtxo {
        AssetUtxo {
            payment_cred: Some(cred.to_string()),
            inline_datum: datum.map(|bytes| InlineDatum { bytes }),
            is_spent: spent,
        }
    }

    #[test]
    fn a_seedelfs_register_is_its_one_contract_rows_datum() {
        let at = |rows: Vec<AssetUtxo>| register_of_rows(&rows);
        assert_eq!(
            at(vec![row(CONTRACT_HASH, Some(datum()), false)]),
            Some(register())
        );
        // At another address, under no datum or one that isn't a register.
        assert_eq!(at(vec![row(&"00".repeat(28), Some(datum()), false)]), None);
        assert_eq!(at(vec![row(CONTRACT_HASH, None, false)]), None);
        assert_eq!(
            at(vec![row(CONTRACT_HASH, Some("d87980".into()), false)]),
            None
        );
        assert_eq!(at(vec![row(CONTRACT_HASH, Some("zz".into()), false)]), None);
        // Nowhere, or in two rows; a spent row aside.
        assert_eq!(at(vec![]), None);
        assert_eq!(
            at(vec![
                row(CONTRACT_HASH, Some(datum()), false),
                row(CONTRACT_HASH, Some(datum()), false)
            ]),
            None
        );
        assert_eq!(
            at(vec![
                row(CONTRACT_HASH, Some(datum()), true),
                row(CONTRACT_HASH, Some(datum()), false)
            ]),
            Some(register())
        );
    }

    /// A Koios row's JSON: what's read of it, and a datum's JSON nested far
    /// past serde_json's 128 levels, which is skipped, not refused.
    #[test]
    fn a_koios_answer_reads_past_a_datum_nested_too_deep_for_serde() {
        let deep = format!("{}1{}", "[".repeat(5000), "]".repeat(5000));
        let answer = format!(
            r#"[{{"tx_hash":"aa","tx_index":0,"payment_cred":"{CONTRACT_HASH}","is_spent":false,
                "inline_datum":{{"bytes":"{}","value":{deep}}},"reference_script":null,
                "asset_list":[{{"policy_id":"{SEEDELF_POLICY}","asset_name":"5eed"}}]}}]"#,
            datum()
        );
        let rows: Vec<AssetUtxo> = serde_json::from_str(&answer).unwrap();
        assert_eq!(register_of_rows(&rows), Some(register()));
    }

    /// Koios is reached over https:// alone, its answers following no
    /// redirect; only the test seam, `with`, takes plain HTTP.
    #[test]
    fn koios_is_https_alone() {
        assert!(Koios::new("http://preprod.koios.rest/api/v1").is_err());
        assert!(Koios::new("preprod.koios.rest/api/v1").is_err());
        assert!(Koios::new("https://preprod.koios.rest/api/v1").is_ok());
        assert!(Koios::with("http://127.0.0.1:1/api/v1", KOIOS_DEADLINE, KOIOS_KEPT).is_ok());
    }

    /// An answer is kept its minute and no longer: the minute's tidy drops
    /// it, so no name is held past it, however few answers have piled up.
    /// With no time to keep, nothing is kept at all.
    #[test]
    fn koios_keeps_no_answer_past_its_time() {
        let koios = Koios::with(
            "http://127.0.0.1:1/api/v1",
            KOIOS_DEADLINE,
            Duration::from_millis(50),
        )
        .unwrap();
        koios.keep(b"alice", (Some(register()), 7));
        koios.keep(b"bob", (None, 8));
        assert_eq!(koios.kept_answers(), 2);
        assert_eq!(koios.kept(b"alice"), Some((Some(register()), 7)));
        std::thread::sleep(Duration::from_millis(80));
        assert_eq!(koios.kept(b"alice"), None);
        View::Koios(koios).tidy();
        let koios = Koios::with(
            "http://127.0.0.1:1/api/v1",
            KOIOS_DEADLINE,
            Duration::from_millis(50),
        )
        .unwrap();
        koios.keep(b"carol", (None, 9));
        std::thread::sleep(Duration::from_millis(80));
        koios.forget();
        assert_eq!(koios.kept_answers(), 0);
        let none =
            Koios::with("http://127.0.0.1:1/api/v1", KOIOS_DEADLINE, Duration::ZERO).unwrap();
        none.keep(b"dave", (None, 10));
        assert_eq!(none.kept_answers(), 0);
    }

    /// The names answer's rows: every Seedelf token in a row has its row's
    /// register, tokens under another policy have none, and a name held
    /// twice says nothing.
    #[test]
    fn every_seedelf_in_the_names_answer_has_its_rows_register() {
        let other = format!("{}{}", "11".repeat(14), "22".repeat(14));
        let json = serde_json::json!({
            "network": "mainnet",
            "tip": { "slot": 1, "hash": "00", "time": 1 },
            "names": [
                { "name": "5eed0001", "row": {
                    "ref": "aa#0", "address": "addr", "lovelace": "1",
                    "assets": [[SEEDELF_POLICY, "5eed0001", "1", 0], [SEEDELF_POLICY, "5eed0002", "1", 0],
                               [other, "5eed0003", "1", 0]],
                    "datum": datum(), "created": { "slot": 1, "time": 1 } } },
                { "name": "5eed0004", "row": {
                    "ref": "bb#0", "address": "addr", "lovelace": "1",
                    "assets": [[SEEDELF_POLICY, "5eed0004", "1", 0]],
                    "created": { "slot": 1, "time": 1 } } },
                { "name": "5eed0005", "row": {
                    "ref": "cc#0", "address": "addr", "lovelace": "1",
                    "assets": [[SEEDELF_POLICY, "5eed0005", "1", 0], [SEEDELF_POLICY, "5eed0001", "1", 0]],
                    "datum": datum(), "created": { "slot": 1, "time": 1 } } },
            ],
        });
        let registers = Registers::from_names(json.to_string().as_bytes()).unwrap();
        let name = |hex_name: &str| hex(hex_name).unwrap();
        assert_eq!(registers.of(&name("5eed0002")), Some(register()));
        assert_eq!(registers.of(&name("5eed0005")), Some(register()));
        assert!(registers.holds(&name("5eed0002"), &register()));
        assert!(!registers.holds(&name("5eed0002"), &[0; 96]));
        // Another policy's token, a row with no datum, and a name in two rows.
        assert_eq!(registers.of(&name("5eed0003")), None);
        assert_eq!(registers.of(&name("5eed0004")), None);
        assert_eq!(registers.of(&name("5eed0001")), None);
        assert_eq!(registers.len(), 4);
        assert!(Registers::from_names(b"[]").is_none());
    }
}
