//! Seedelf Messaging's relay (web wallet chunk 54's 54c; the protocol's
//! docs/protocol.md §10 and §17). It keeps envelopes 36 hours and hands
//! every reader all of them: it can't read one or tell whom it's for, and
//! it keeps no recipient, sender, account or key.
//!
//! - `POST /messaging/v1/{pool}/envelopes`: `nonce (8) ‖ envelope`, as
//!   `application/octet-stream`. Checked (the shape, then the price and the
//!   address's window, then room, then the points), then kept.
//! - `GET /messaging/v1/{pool}/envelopes?after=<cursor>`: a page of what
//!   came after the cursor, in the binary format `Page::encode` writes.
//!
//! Beside each pool, its list of certificates (chunk 55's 55c; §21.7): the
//! certificate that binds a Seedelf's messaging register to its datum's,
//! one per Seedelf a wallet takes messages for, kept until it stops being
//! good, and read whole by every wallet.
//!
//! - `POST /messaging/v1/{pool}/certificates`: `nonce (8) ‖ certificate`.
//!   Checked (the shape, already held, the price and the window as for a
//!   512-byte envelope, the stamp, room, then the points and the proof),
//!   then listed.
//! - `GET /messaging/v1/{pool}/certificates?after=<cursor>`: a page of the
//!   list's entries after the cursor, as `list::encode` writes it.
//! - `POST /messaging/v1/{pool}/withdrawals`: `nonce (8) ‖ withdrawal`, its
//!   owner's messaging key taking one certificate down (chunk 55's call 9).
//!
//! A certificate is listed only for its Seedelf's register now, in the
//! pool's view of the chain (`view`, §21.7's check 8): mainnet's the private
//! index's own, preprod's Koios's at post time. What stops being good as the
//! chain moves is dropped: on mainnet by a sweep, on preprod by a slow
//! re-check, one Seedelf every 2 s, each at most once a day, within Koios's
//! day's budget, and dropped only once a second ask confirms it. Neither
//! runs for a pool the off switch stops.
//!
//! A pool per network (`mainnet`, `preprod`), each with its own prices,
//! cap and traffic. (They were made two when one key, the Seedelf key, read
//! Messages on both networks; since chunk 55 Messages has a key for each.)
//! What an address posted is counted in memory, to price its next post
//! (`price`) and to bound what it has in the pool (`window`), and so is what
//! it was sent in pages over the last day (`reading`), and of messaging's
//! reserve, both pools together: never logged or saved. A certificate is
//! counted in them as a short envelope. The pools and their lists are saved
//! to the state directory every minute and at shutdown, so a deploy keeps
//! what's waiting.

pub mod certificate;
pub mod check;
pub mod list;
pub mod pool;
pub mod price;
pub mod reading;
pub mod view;
pub mod window;

use std::collections::HashMap;
use std::io::Write;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
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

use crate::edge::{Client, Reserved, Stopped};
use certificate::Unwithdrawn;
use check::{NONCE_LEN, SIZES};
use list::{Key, List, Listed, Recheck, RoundAt, Unlisted};
use pool::{Full, Held, Kept, LENGTH_LEN, PAGE_BYTES, PAGE_HEADER, PAGE_VERSION, Page, Snapshot};
use price::{Asked, Counts, Prices};
use reading::{Reading, Reads};
use view::{Asker, Unasked, Unreadable, View};
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
    /// Its list of certificates.
    pub list: Listing,
}

/// A pool's list of certificates (§21.7).
#[derive(Debug, Clone, Copy)]
pub struct Listing {
    /// The network byte its certificates carry (§21.2):
    /// `certificate::NETWORK_PREPROD` or `NETWORK_MAINNET`.
    pub network: u8,
    /// The most bytes its entries hold, certificates' and removals', their
    /// framing aside. Past it a certificate is refused, and none is ever
    /// pushed out for it.
    pub cap: usize,
}

/// A certificate is priced and counted as an envelope of this many bytes
/// from its address, in the price and in the window (§21.7's check 4)
/// [choice].
const CERTIFICATE_AS: usize = SIZES[0];

/// The pools, and what they price by (protocol.md §17). The base costs a
/// browser about 0.1 s of WebAssembly (2¹⁸ SHA-256 attempts at about 425 ns
/// each, measured in Node 24), the ceiling about 7 s (2²⁴). Preprod is for
/// testing: a lower base, and a smaller cap.
///
/// The window is the owner's to tune: 1,000 envelopes is about a second of
/// every reader's trial scan, 4,096 units 2 MiB of every reader's download.
/// The same on both pools, so a wallet meets the same limits on preprod.
///
/// The lists' caps are §21.7's [choice], 55c's to tune: 64 MiB on mainnet,
/// about 220,000 certificates, and 8 MiB on preprod.
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
        list: Listing {
            network: certificate::NETWORK_MAINNET,
            cap: 64 << 20,
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
        list: Listing {
            network: certificate::NETWORK_PREPROD,
            cap: 8 << 20,
        },
    },
];

/// Counted for a request with no address, which none from Caddy is.
const NO_ADDRESS: IpAddr = IpAddr::V4(Ipv4Addr::UNSPECIFIED);

/// What one address may read of messaging's reserve in a day, both pools
/// together [choice] (the 1.10.0 gate's FI-5): every wallet downloads every
/// envelope, and a busy pool's day (protocol.md §10: about 10,000 short
/// ones) is about 5 MB, so this is about three days of one. Past it, the
/// day's 429 (`NotRead::Day`), so one address can't spend what's kept for
/// conversations under way. The owner's to tune:
/// `DATA_MESSAGING_RESERVE_READ_MIB_DAY` (config.rs).
pub const RESERVE_READ: u64 = 16 << 20;

/// An `already` answer's expiry is rounded down to this many seconds, so it
/// doesn't say the second the envelope came (the 1.10.0 gate's FI-12). A
/// new one's is exact: the wallet sets its clock by it.
const ALREADY_ROUNDED: i64 = 600;

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
    /// Its certificates. Taken after `window` when both are, never before,
    /// and never with `held`.
    list: Mutex<List>,
    /// Envelopes' and certificates' alike.
    counts: Mutex<Counts>,
    /// Taken before `held`, or `list`, when both are, never after.
    window: Mutex<Window>,
    /// What each address was sent of it in the last day, envelopes' pages
    /// and the list's together. Taken alone, never with another lock held.
    reads: Mutex<Reads>,
    /// What each address was sent of messaging's reserve in the last day:
    /// one table for both pools. Taken alone, never with another lock held.
    reserve: Arc<Mutex<Reads>>,
    /// Where its envelopes are saved.
    file: Option<Files>,
    /// Its file was there at start but couldn't be read: until a save of
    /// the pool succeeds, no clean mark is written beside it.
    unread: AtomicBool,
    /// Where its list is saved, a file of its own, and the same for it.
    list_file: Option<Files>,
    list_unread: AtomicBool,
    /// Where it reads the chain for §21.7's check 8: [`View::Nowhere`] until
    /// `Relay::with_view` gives it one, and every certificate post is then a
    /// 503.
    view: View,
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

/// Why a certificate whose checks passed wasn't listed.
#[derive(Debug, PartialEq, Eq)]
enum NotListed {
    /// The address's window, filled meanwhile: in this many seconds.
    Window(u64),
    /// Its Seedelf's two, or the list's cap, reached meanwhile.
    Room(Unlisted),
}

/// Why a page wasn't sent.
#[derive(Debug, PartialEq, Eq)]
enum NotRead {
    /// The address has read its day's budget of this pool, or, while
    /// messaging's traffic for the day is down to its reserve, its share of
    /// the reserve: again in this many seconds. Both are the day's 429
    /// (`DAY_READ`), which 1.10.0 holds the pool's pages for; a 503 it
    /// would take as the relay out of reach, and ask again at every sync.
    Day(u64),
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
    /// the page holds what fits and says more follows, or an envelope longer
    /// than that alone; and the page counts against the address's share of
    /// the reserve, both pools together, which refuses it once read, until
    /// the share frees or the day rolls (`reserve_wait`). A page refused
    /// before it's encoded is counted against nothing; one the reserve
    /// refuses here, as when two of an address's pages pass its first
    /// check at once, is already counted in the day's reading: one page.
    fn read(
        &self,
        after: Option<u64>,
        address: IpAddr,
        short: Option<usize>,
        now: i64,
        instant: Instant,
    ) -> Result<Vec<u8>, NotRead> {
        self.counted(address, short, now, instant, |short| {
            let page = {
                let mut held = self.held.lock().expect("pool lock");
                match short {
                    None => held.page(after, PAGE_BYTES, now),
                    Some(most) => held.page_within(after, most, now),
                }
            };
            let prices = {
                let counts = self.counts.lock().expect("counts lock");
                let window = self.window.lock().expect("window lock");
                prices(&counts, &window, address, instant)
            };
            encode(&page, prices)
        })
    }

    /// Lists a certificate whose checks have passed, as [`Pool::keep`]
    /// keeps an envelope: its address's window is checked again and
    /// counted with the insert, as a short envelope's, and so are its
    /// Seedelf's two and the list's cap, so posts at once can't pass them
    /// together; one listed meanwhile is "already".
    fn list(
        &self,
        digest: [u8; 32],
        key: Key,
        certificate: &[u8],
        address: IpAddr,
        instant: Instant,
    ) -> Result<Listed, NotListed> {
        let mut window = self.window.lock().expect("window lock");
        let mut list = self.list.lock().expect("list lock");
        if list.already(&key) {
            return Ok(Listed::Already);
        }
        if let Some(secs) = window.wait(address, CERTIFICATE_AS, instant) {
            return Err(NotListed::Window(secs));
        }
        let listed = list
            .insert(digest, key, certificate, self.config.list.cap)
            .map_err(NotListed::Room)?;
        if listed == Listed::New {
            window.record(address, CERTIFICATE_AS, instant);
        }
        Ok(listed)
    }

    /// The list's page after `after` for `address`, as [`Pool::read`]
    /// makes the pool's: counted in the same day's reading, and in the
    /// reserve, cut to what it sends (§21.7, "as §17.5's pages are")
    /// [choice]. Its price is a certificate's: a short envelope's.
    fn read_list(
        &self,
        after: Option<u64>,
        address: IpAddr,
        short: Option<usize>,
        now: i64,
        instant: Instant,
    ) -> Result<Vec<u8>, NotRead> {
        self.counted(address, short, now, instant, |short| {
            let page = {
                let list = self.list.lock().expect("list lock");
                match short {
                    None => list.page(after, list::PAGE_BYTES),
                    Some(most) => list.page_within(after, most),
                }
            };
            let price = {
                let counts = self.counts.lock().expect("counts lock");
                let window = self.window.lock().expect("window lock");
                prices(&counts, &window, address, instant)[0]
            };
            list::encode(&page, price)
        })
    }

    /// A page that `make` makes, `short` the reserve's longest if
    /// messaging is down to it, counted against `address`'s reading for the
    /// day and, in the reserve, its share of the reserve, as
    /// [`Pool::read`] says.
    fn counted(
        &self,
        address: IpAddr,
        short: Option<usize>,
        now: i64,
        instant: Instant,
        make: impl FnOnce(Option<usize>) -> Vec<u8>,
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
        if short.is_some()
            && let Some(secs) = self
                .reserve
                .lock()
                .expect("reserve lock")
                .wait(address, instant)
        {
            return Err(NotRead::Day(reserve_wait(secs, now)));
        }
        let bytes = make(short);
        self.reads
            .lock()
            .expect("reads lock")
            .take(address, bytes.len(), instant)
            .map_err(NotRead::Day)?;
        if short.is_some() {
            self.reserve
                .lock()
                .expect("reserve lock")
                .take(address, bytes.len(), instant)
                .map_err(|secs| NotRead::Day(reserve_wait(secs, now)))?;
        }
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
    /// The pools the off switch stops (`DATA_MESSAGING_OFF`), as the edge
    /// holds them: each route checks its pool's name too, decoded, so no
    /// spelling of a path walks past the edge's check.
    stopped: Stopped,
}

impl Relay {
    /// The pools, each from its file in `dir` if one is there.
    pub fn new(dir: Option<&Path>) -> Self {
        Self::with_pools(dir, &POOLS)
    }

    /// [`Relay::new`] with other pools than [`POOLS`]: a test's.
    pub fn with_pools(dir: Option<&Path>, pools: &'static [Config]) -> Self {
        let now = Instant::now();
        let reserve = Arc::new(Mutex::new(Reads::new(RESERVE_READ, now)));
        let pools = pools
            .iter()
            .map(|config| {
                let file = dir.map(|dir| Files::pool(dir, config.name));
                let (held, unread) = load(config.name, file.as_ref());
                let list_file = dir.map(|dir| Files::list(dir, config.name));
                let (list, list_unread) = load_list(config, list_file.as_ref());
                Pool {
                    config,
                    held: Mutex::new(held),
                    list: Mutex::new(list),
                    counts: Mutex::new(Counts::new(config.prices, now)),
                    window: Mutex::new(Window::new(config.window, now)),
                    reads: Mutex::new(Reads::new(Reading::DEFAULT.budget(config.cap), now)),
                    reserve: reserve.clone(),
                    file,
                    unread: AtomicBool::new(unread),
                    list_file,
                    list_unread: AtomicBool::new(list_unread),
                    view: View::Nowhere,
                }
            })
            .collect();
        Relay {
            pools,
            saving: Mutex::new(()),
            stopped: Stopped::none(),
        }
    }

    /// With the off switch's pools (main.rs gives the edge the same): their
    /// routes answer 410 here too, by the pool's name as the route decodes it.
    pub fn with_stopped(mut self, stopped: Stopped) -> Self {
        self.stopped = stopped;
        self
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

    /// With another share of messaging's reserve for each address than
    /// [`RESERVE_READ`], in bytes a day, both pools together: the
    /// environment's, or a test's. For a relay that hasn't served yet.
    pub fn with_reserve_read(mut self, bytes: u64) -> Self {
        let reserve = Arc::new(Mutex::new(Reads::new(bytes, Instant::now())));
        for pool in &mut self.pools {
            pool.reserve = reserve.clone();
        }
        self
    }

    /// With `view` as the pool `pool`'s view of the chain (§21.7's check
    /// 8): mainnet's the index's, preprod's Koios's (main.rs).
    pub fn with_view(mut self, pool: &str, view: View) -> Self {
        if let Some(at) = self.pools.iter_mut().find(|p| p.config.name == pool) {
            at.view = view;
        }
        self
    }

    pub fn pool(&self, name: &str) -> Option<&Pool> {
        self.pools.iter().find(|pool| pool.config.name == name)
    }

    /// The mainnet sweep (§21.7, "A certificate stays while it's good"):
    /// for each pool whose view knows every Seedelf's register at once, the
    /// index's, drops each listed certificate whose Seedelf isn't at its
    /// register now, a removal entry taking its place, and forgets each
    /// withdrawn digest whose Seedelf isn't either, found elsewhere on three
    /// views in a row, since the chain check refuses those bytes now. A
    /// view that can't be read drops nothing, and neither does one that
    /// holds no Seedelf at all, which on mainnet is a broken read [choice],
    /// nor a pool the off switch stops. How many certificates went.
    pub async fn sweep_once(&self) -> usize {
        let mut dropped = 0;
        for pool in &self.pools {
            if self.stopped.pool(pool.config.name) {
                continue;
            }
            let Some(Ok(registers)) = pool.view.every().await else {
                continue;
            };
            if registers.is_empty() {
                continue;
            }
            let mut list = pool.list.lock().expect("list lock");
            dropped += list.sweep(
                pool.config.name,
                unix_day(),
                registers.view(),
                |name, register| registers.holds(name, register),
            );
        }
        dropped
    }

    /// One step of preprod's slow re-check (§21.7) at `now`, Unix seconds,
    /// for each pool whose view is Koios's and that the off switch doesn't
    /// stop: one Seedelf the list knows, listed or withdrawn, asked of
    /// Koios through the view's own client, places, minute's answers and
    /// day's budget, of which it takes only what posts leave
    /// (`Asker::Recheck`). Whether it asked: false once nothing is due, or
    /// while every request to Koios waits.
    ///
    /// - **A round** walks every Seedelf the list knows by key, smallest
    ///   first, its place saved with the list (`list::Recheck`), so a
    ///   restart goes on from it; the next begins once it's over and a day
    ///   after it began, so each is asked at most once a day, and a round
    ///   the budget can't finish in a day goes on the next.
    /// - **Found there**, it's judged present (`List::judge`). **Found
    ///   elsewhere**, it's asked again at least [`RECHECK_CONFIRM`] later,
    ///   before the round's next, and only an answer then that finds it
    ///   elsewhere too drops its certificates, and counts toward forgetting
    ///   its withdrawn digests: one answer from a Koios that's behind drops
    ///   nothing.
    /// - **No answer**, its place holds, and it's asked again at the next
    ///   step; a second failure in a row passes it, for the next round. A
    ///   day's budget spent, or Koios's requests stopped, asks nothing.
    pub async fn recheck_step(&self, rounds: &mut HashMap<&'static str, Round>, now: i64) -> bool {
        let today = now.div_euclid(86_400) as u32;
        for pool in &self.pools {
            let Some(koios) = pool.view.as_koios() else {
                continue;
            };
            let name = pool.config.name;
            if self.stopped.pool(name) {
                continue;
            }
            let round = rounds.entry(name).or_default();
            // A second ask that's due, for a Seedelf found elsewhere.
            let due = round
                .elsewhere
                .iter()
                .find(|(_, (at, _))| now - *at >= RECHECK_CONFIRM)
                .map(|(key, _)| *key);
            if let Some(key) = due {
                let Some((seedelf, register)) = pool.list.lock().expect("list lock").seedelf(&key)
                else {
                    round.elsewhere.remove(&key);
                    continue;
                };
                match koios.answer(&seedelf, Asker::Recheck, now).await {
                    Ok((at, view)) => {
                        round.elsewhere.remove(&key);
                        let present = at == Some(register);
                        let mut list = pool.list.lock().expect("list lock");
                        list.judge(name, &key, present, today, view);
                    }
                    Err(Unasked::Waiting(_)) => continue,
                    // Asked again at the next step; failed twice, left for
                    // the next round, judged neither way.
                    Err(Unasked::Failed) => {
                        if let Some((_, failed)) = round.elsewhere.get_mut(&key)
                            && std::mem::replace(failed, true)
                        {
                            round.elsewhere.remove(&key);
                        }
                    }
                }
                return true;
            }
            let (key, seedelf, register) = {
                let mut list = pool.list.lock().expect("list lock");
                let mut state = list.recheck();
                if state.at == RoundAt::Done {
                    if state.began != 0 && now - state.began < RECHECK_ROUND {
                        continue;
                    }
                    state = Recheck {
                        began: now,
                        at: RoundAt::Start,
                    };
                }
                let after = match state.at {
                    RoundAt::After(key) => Some(key),
                    RoundAt::Start | RoundAt::Done => None,
                };
                let Some(key) = list.seedelf_after(after.as_ref()) else {
                    list.set_recheck(Recheck {
                        at: RoundAt::Done,
                        ..state
                    });
                    continue;
                };
                list.set_recheck(state);
                let (seedelf, register) = list.seedelf(&key).expect("a Seedelf the list knows");
                (key, seedelf, register)
            };
            let passed = match koios.answer(&seedelf, Asker::Recheck, now).await {
                Ok((at, view)) => {
                    if at == Some(register) {
                        let mut list = pool.list.lock().expect("list lock");
                        list.judge(name, &key, true, today, view);
                    } else {
                        round.elsewhere.entry(key).or_insert((now, false));
                    }
                    true
                }
                Err(Unasked::Waiting(_)) => continue,
                Err(Unasked::Failed) => round.failed.replace(key) == Some(key),
            };
            if passed {
                round.failed = None;
                let mut list = pool.list.lock().expect("list lock");
                let began = list.recheck().began;
                list.set_recheck(Recheck {
                    began,
                    at: RoundAt::After(key),
                });
            }
            return true;
        }
        false
    }

    /// Drops what's expired, the lists' removals past their week, Koios's
    /// answers past their minute, the counts that have decayed away, and the
    /// window's buckets and the readers' hours that have aged out.
    pub fn tidy(&self) {
        let (now, instant) = (unix_now(), Instant::now());
        for pool in &self.pools {
            pool.held.lock().expect("pool lock").expire(now);
            pool.list.lock().expect("list lock").compact(unix_day());
            pool.view.tidy();
            pool.counts.lock().expect("counts lock").forget(instant);
            pool.window.lock().expect("window lock").forget(instant);
            pool.reads.lock().expect("reads lock").forget(instant);
        }
        if let Some(pool) = self.pools.first() {
            pool.reserve.lock().expect("reserve lock").forget(instant);
        }
    }

    /// Writes every pool, and every list, that changed to its file. `clean`
    /// at shutdown, once nothing more comes in: the mark beside it says the
    /// file holds everything. A pool or list whose file couldn't be read at
    /// start, and hasn't been saved since, gets no mark: the file there
    /// isn't what it held, so the next start tells every earlier cursor of
    /// a gap (the 1.10.0 gate's FI-7).
    pub fn save(&self, clean: bool) {
        let _one = self.saving.lock().expect("saving lock");
        for pool in &self.pools {
            let name = pool.config.name;
            if let Some(files) = &pool.file {
                let snapshot = {
                    let mut held = pool.held.lock().expect("pool lock");
                    held.changed.then(|| held.snapshot())
                };
                let bytes = snapshot.map(|snapshot| snapshot.encode());
                if !save_to(files, &pool.unread, bytes, clean, name, "envelopes") {
                    pool.held.lock().expect("pool lock").changed = true;
                }
            }
            save_list(pool, clean);
        }
    }

    /// Writes the pool `name`'s list now, if it changed, apart from the
    /// minute's save: a taken withdrawal's, before its answer, so a crash
    /// after it can't bring the certificate back. Whether the list's file
    /// holds it now: a relay that saves nothing, a test's, always does.
    pub fn save_list(&self, name: &str) -> bool {
        let _one = self.saving.lock().expect("saving lock");
        self.pool(name).is_some_and(|pool| save_list(pool, false))
    }

    /// Each pool's size and its list's, for `/health`: anyone can download
    /// them, so this says nothing new.
    pub fn health(&self) -> Value {
        self.pools
            .iter()
            .map(|pool| {
                let (envelopes, bytes) = {
                    let held = pool.held.lock().expect("pool lock");
                    (held.len(), held.bytes())
                };
                let (certificates, withdrawn) = {
                    let list = pool.list.lock().expect("list lock");
                    (list.certificates(), list.withdrawals())
                };
                (
                    pool.config.name.to_string(),
                    json!({
                        "envelopes": envelopes,
                        "bytes": bytes,
                        "certificates": certificates,
                        "withdrawn": withdrawn,
                        "chain": pool.view.name(),
                    }),
                )
            })
            .collect::<serde_json::Map<_, _>>()
            .into()
    }
}

/// Writes `pool`'s list to its file if it changed, as [`Relay::save`] does.
/// A list whose file couldn't be read at start and couldn't be moved aside
/// is never written: the file there is kept as it is (`load_list`).
/// Whether what it holds is saved: always, with no file to save to; never
/// for that list, or a write that failed.
fn save_list(pool: &Pool, clean: bool) -> bool {
    let Some(files) = &pool.list_file else {
        return true;
    };
    if pool.list_unread.load(Ordering::Relaxed) {
        return false;
    }
    let snapshot = {
        let mut list = pool.list.lock().expect("list lock");
        list.changed.then(|| list.snapshot())
    };
    let bytes = snapshot.map(|snapshot| snapshot.encode());
    let saved = save_to(
        files,
        &pool.list_unread,
        bytes,
        clean,
        pool.config.name,
        "certificates",
    );
    if !saved {
        pool.list.lock().expect("list lock").changed = true;
    }
    saved
}

/// Where a pool's envelopes, or its list, are saved: the file, the partial
/// it's written to before it's renamed into place, the clean mark a
/// shutdown leaves beside it, and the mark's partial.
struct Files {
    file: PathBuf,
    partial: PathBuf,
    mark: PathBuf,
    mark_partial: PathBuf,
}

impl Files {
    /// The pool's: `messaging-<pool>.pool`, `.partial`, `.clean` and
    /// `.clean.partial`.
    fn pool(dir: &Path, name: &str) -> Self {
        let file = dir.join(format!("messaging-{name}.pool"));
        let mark = dir.join(format!("messaging-{name}.clean"));
        Files {
            partial: pool_partial(&file),
            mark_partial: mark_partial(&mark),
            file,
            mark,
        }
    }

    /// The list's: `messaging-<pool>.list`, `.list.partial`, `.list.clean`
    /// and `.list.clean.partial`, none of them a name of the pool's.
    fn list(dir: &Path, name: &str) -> Self {
        let file = format!("messaging-{name}.list");
        Files {
            file: dir.join(&file),
            partial: dir.join(format!("{file}.partial")),
            mark: dir.join(format!("{file}.clean")),
            mark_partial: dir.join(format!("{file}.clean.partial")),
        }
    }
}

/// What a start finds of a file.
enum Found {
    /// Its bytes, and whether a clean shutdown marked it.
    Saved(Vec<u8>, bool),
    /// None yet.
    Nothing,
    /// One that's there but can't be read.
    Unreadable(std::io::ErrorKind),
}

/// Reads a file at start. The clean mark is removed as it's read, so a
/// crash later doesn't find it, and so is what a save that failed may have
/// left.
fn found(files: &Files) -> Found {
    // Up to a pool's size, which a build before the 1.10.0 gate's FI-9 left
    // when a save failed.
    let _ = std::fs::remove_file(&files.partial);
    let _ = std::fs::remove_file(&files.mark_partial);
    let clean = std::fs::remove_file(&files.mark).is_ok();
    match std::fs::read(&files.file) {
        Ok(bytes) => Found::Saved(bytes, clean),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Found::Nothing,
        Err(error) => Found::Unreadable(error.kind()),
    }
}

/// A pool from its file: everything in it, after a clean shutdown; after
/// anything else, everything too, but each earlier cursor is told it may
/// have missed something. No file is an empty pool. A file that's there
/// but can't be read, or isn't a pool, is an empty pool too, and is left as
/// it is (`true`, unread: no clean mark goes beside it until a save
/// replaces it).
fn load(name: &str, files: Option<&Files>) -> (Held, bool) {
    let (now, micros) = (unix_now(), unix_micros());
    let Some(files) = files else {
        return (Held::new(micros), false);
    };
    let held = match found(files) {
        Found::Saved(bytes, clean) => match Snapshot::decode(&bytes) {
            Some(snapshot) => Held::restore(snapshot, clean, name, now, micros),
            None => {
                warn!(
                    pool = name,
                    "a messaging pool's file isn't one, so it starts empty"
                );
                return (Held::new(micros), true);
            }
        },
        // None yet: one is written at the next save, changed or not, so a
        // clean restart reads back where the numbering stood and tells no
        // reader of a gap. Without it, a pool that never kept anything
        // started as new at every restart (the gate review's relay-server#7).
        Found::Nothing => {
            let mut held = Held::new(micros);
            held.changed = true;
            held
        }
        Found::Unreadable(kind) => {
            warn!(pool = name, %kind, "a messaging pool's file couldn't be read, so it starts empty");
            return (Held::new(micros), true);
        }
    };
    (held, false)
}

/// A pool's list from its file, as [`load`] reads the pool's: what it
/// held, and every earlier cursor told of a gap unless a clean shutdown
/// marked it; an empty list where there's no file. A file that can't be
/// read, or isn't a list this pool's could be, is moved aside, as
/// `messaging-<pool>.list.unreadable.<Unix seconds>`, never overwritten,
/// and the list starts empty, a new one every earlier cursor is a gap in.
/// If it can't be moved, it's left as it is and the list is never saved
/// over it (`true`).
fn load_list(config: &Config, files: Option<&Files>) -> (List, bool) {
    let micros = unix_micros();
    let Some(files) = files else {
        return (List::new(micros), false);
    };
    let (name, network) = (config.name, config.list.network);
    match found(files) {
        Found::Saved(bytes, clean) => {
            if let Some(list) = list::Snapshot::decode(&bytes)
                .and_then(|snapshot| List::restore(snapshot, clean, name, network, micros))
            {
                return (list, false);
            }
            warn!(pool = name, "a messaging pool's list file isn't one");
        }
        // As for the pool: written at the next save, so a clean restart
        // reads back where the numbering stood.
        Found::Nothing => {
            let mut list = List::new(micros);
            list.changed = true;
            return (list, false);
        }
        Found::Unreadable(kind) => {
            warn!(pool = name, %kind, "a messaging pool's list file couldn't be read");
        }
    }
    let aside = files
        .file
        .with_file_name(format!("messaging-{name}.list.unreadable.{}", unix_now()));
    match std::fs::rename(&files.file, &aside) {
        Ok(()) => {
            warn!(pool = name, aside = %aside.display(), "so it's moved aside, and the list starts empty");
            let mut list = List::new(micros);
            list.changed = true;
            (list, false)
        }
        Err(error) => {
            warn!(pool = name, kind = %error.kind(), "and it can't be moved aside, so the list starts empty and is never saved over it");
            (List::new(micros), true)
        }
    }
}

/// Writes `bytes`, when there are any (what changed since the last save),
/// then, at a clean shutdown, the mark beside them, for a pool's envelopes
/// or its list (`part`). A file that couldn't be read at start, and hasn't
/// been written since (`unread`), gets no mark. `false` when the write
/// failed, so what it holds is still to save.
fn save_to(
    files: &Files,
    unread: &AtomicBool,
    bytes: Option<Vec<u8>>,
    clean: bool,
    pool: &str,
    part: &str,
) -> bool {
    if let Some(bytes) = bytes {
        if let Err(error) = write(&files.file, &files.partial, &bytes) {
            warn!(pool, part, kind = %error.kind(), "a messaging pool's file couldn't be saved");
            return false;
        }
        // The file is the pool's, or the list's, now, whole.
        unread.store(false, Ordering::Relaxed);
    }
    if !clean {
        return true;
    }
    if unread.load(Ordering::Relaxed) {
        warn!(
            pool,
            part, "a messaging pool's file couldn't be read at start, so it isn't marked clean"
        );
        return true;
    }
    if let Err(error) = write(&files.mark, &files.mark_partial, b"") {
        warn!(pool, part, kind = %error.kind(), "a messaging pool's clean mark couldn't be written");
    }
    true
}

/// Where a pool's file is written before it's renamed into place:
/// `messaging-<pool>.partial`.
fn pool_partial(file: &Path) -> PathBuf {
    file.with_extension("partial")
}

/// And its clean mark's, a name of its own: `messaging-<pool>.clean.partial`.
fn mark_partial(mark: &Path) -> PathBuf {
    mark.with_extension("clean.partial")
}

/// Written whole to `partial`, then renamed into place. Nothing is left
/// behind when that fails, to fill a disk that's nearly full.
fn write(path: &Path, partial: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let written = std::fs::File::create(partial).and_then(|mut file| {
        file.write_all(bytes)?;
        file.sync_all()?;
        std::fs::rename(partial, path)
    });
    if written.is_err() {
        let _ = std::fs::remove_file(partial);
    }
    written
}

/// How often the mainnet sweep runs [choice]: the names answer it reads is
/// kept a tip, so most sweeps read nothing new.
pub const SWEEP_EVERY: Duration = Duration::from_secs(120);

/// Every [`SWEEP_EVERY`]: drop what's no longer good on mainnet's view of
/// the chain (`Relay::sweep_once`).
pub async fn sweep(relay: Arc<Relay>) {
    let mut every = tokio::time::interval(SWEEP_EVERY);
    every.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        every.tick().await;
        relay.sweep_once().await;
    }
}

/// One step of preprod's re-check this often [choice]: at most one request
/// to Koios every 2 s.
pub const RECHECK_EVERY: Duration = Duration::from_secs(2);

/// A round of the re-check starts at most this often, in seconds: each
/// Seedelf is asked about at most once a day.
pub const RECHECK_ROUND: i64 = 24 * 3600;

/// A Seedelf the re-check found elsewhere is asked again at least this
/// long after, in seconds [choice], and only that answer drops anything:
/// Koios a block or a few behind has caught up by then.
pub const RECHECK_CONFIRM: i64 = 600;

/// What a pool's re-check holds in memory alone (its round's place is the
/// list's, `list::Recheck`): each Seedelf found elsewhere once, by key,
/// when, and whether its second ask has failed once, waiting for that ask;
/// and the Seedelf whose ask failed once, asked again before its place
/// passes it.
#[derive(Default)]
pub struct Round {
    elsewhere: HashMap<[u8; 32], (i64, bool)>,
    failed: Option<[u8; 32]>,
}

/// Every [`RECHECK_EVERY`]: a step of preprod's re-check
/// (`Relay::recheck_step`).
pub async fn recheck(relay: Arc<Relay>) {
    let mut every = tokio::time::interval(RECHECK_EVERY);
    every.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut rounds = HashMap::new();
    loop {
        every.tick().await;
        relay.recheck_step(&mut rounds, unix_now()).await;
    }
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

/// The most a post's body is: a nonce and the largest envelope.
pub const MAX_POST: usize = NONCE_LEN + SIZES[3];

/// The most a certificate post's body is: a nonce and the longest
/// certificate, 312 bytes.
pub const MAX_CERTIFICATE_POST: usize = NONCE_LEN + certificate::MAX_LEN;

/// A withdrawal post's body: a nonce and a withdrawal, exactly 106 bytes.
pub const MAX_WITHDRAWAL_POST: usize = NONCE_LEN + certificate::WITHDRAWAL_LEN;

/// The relay's routes. A body is at most a nonce and the largest envelope,
/// or, for the list, a nonce and the longest certificate, or a nonce and a
/// withdrawal.
pub fn routes() -> Router<Arc<Relay>> {
    Router::new()
        .route("/messaging/v1/{pool}/envelopes", get(page).post(post))
        .layer(DefaultBodyLimit::max(MAX_POST))
        .merge(
            Router::new()
                .route(
                    "/messaging/v1/{pool}/certificates",
                    get(list_page).post(post_certificate),
                )
                .layer(DefaultBodyLimit::max(MAX_CERTIFICATE_POST)),
        )
        .merge(
            Router::new()
                .route(
                    "/messaging/v1/{pool}/withdrawals",
                    axum::routing::post(post_withdrawal),
                )
                .layer(DefaultBodyLimit::max(MAX_WITHDRAWAL_POST)),
        )
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
    if relay.stopped.pool(&name) {
        return stopped();
    }
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
        return kept("already", rounded_down(expires));
    }
    let address = client.map_or(NO_ADDRESS, |Extension(Client(ip))| address_key(ip));
    let size = envelope.len();
    let bits = match price(pool, address, size, instant) {
        Ok(bits) => bits,
        Err(unpriced) => return unpriced.answer(),
    };
    if check::stamp_bits(&digest, nonce) < bits {
        return more_work(bits);
    }
    // Room before the points: a post to a full pool waits, however often
    // it comes, without its points checked again. The keep looks again,
    // and is what counts.
    let room = {
        let mut held = pool.held.lock().expect("pool lock");
        held.expire(now);
        held.room(size, pool.config.cap, now)
    };
    if let Err(Full(secs)) = room {
        return refuse(StatusCode::SERVICE_UNAVAILABLE, "the pool is full", secs);
    }
    if let Err(refused) = check::check_points(envelope) {
        // Counted against its address alone: its next post costs more, so
        // one solved stamp pays for only so many point checks.
        pool.counts
            .lock()
            .expect("counts lock")
            .count_refused(address, size, instant);
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
        Ok(Kept::Already { expires }) => kept("already", rounded_down(expires)),
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
    if relay.stopped.pool(&name) {
        return stopped();
    }
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
    };
    octets(page)
}

/// Why a post isn't priced (§17.2's row 4).
#[derive(Debug, PartialEq, Eq)]
enum Unpriced {
    /// Its address is new to a table that's full: 503 `busy`.
    Busy,
    /// Past the price's ceiling, by the address's `own` count or everyone's
    /// floor alone, or past its window too: again in `secs`.
    Ceiling { own: bool, secs: u64 },
    /// Past the address's window: again in this many seconds.
    Window(u64),
}

impl Unpriced {
    fn answer(self) -> Response {
        match self {
            Unpriced::Busy => refuse(StatusCode::SERVICE_UNAVAILABLE, "busy", 60),
            Unpriced::Ceiling { own, secs } => {
                // Which count took the price past its ceiling: the
                // address's own, or everyone's floor alone.
                let error = if own {
                    "too many posts from this address for now"
                } else {
                    "too many posts to this pool for now"
                };
                refuse(StatusCode::TOO_MANY_REQUESTS, error, secs)
            }
            Unpriced::Window(secs) => refuse(StatusCode::TOO_MANY_REQUESTS, WINDOW_FULL, secs),
        }
    }
}

/// §17.2's row 4, for an envelope of `size` bytes or a certificate,
/// counted as a short envelope: the bits a post from `address` is asked,
/// its price within its ceiling and the post within the address's window;
/// or why not, a 429 with how long to wait, or a 503 `busy` for an address
/// new to a full table. The window comes with the price, before the stamp:
/// a post with any nonce, 0 say, learns how long to wait without solving.
/// When both refuse, the 429 waits for the later.
fn price(pool: &Pool, address: IpAddr, size: usize, instant: Instant) -> Result<u32, Unpriced> {
    let (asked, own) = {
        let mut counts = pool.counts.lock().expect("counts lock");
        if !counts.room_for(address, instant) {
            return Err(Unpriced::Busy);
        }
        let asked = counts.ask(address, size, instant);
        let own =
            matches!(asked, Asked::Refused(_)) && counts.refused_by_own(address, size, instant);
        (asked, own)
    };
    let wait = {
        let mut window = pool.window.lock().expect("window lock");
        if !window.room_for(address, instant) {
            return Err(Unpriced::Busy);
        }
        window.wait(address, size, instant)
    };
    match (asked, wait) {
        (Asked::Refused(secs), wait) => Err(Unpriced::Ceiling {
            own,
            secs: secs.max(wait.unwrap_or(0)),
        }),
        (_, Some(secs)) => Err(Unpriced::Window(secs)),
        (Asked::Bits(bits), None) => Ok(bits),
    }
}

/// A 402: the stamp shows less than the price.
fn more_work(bits: u32) -> Response {
    let body = json!({ "error": "more proof of work", "price": bits });
    (StatusCode::PAYMENT_REQUIRED, axum::Json(body)).into_response()
}

/// A certificate post (§21.7): checked in its table's order, cheapest first,
/// the first that fails answering.
///
/// 1. A nonce: 400.
/// 2. The shape (§21.4's check 1): 400.
/// 3. Already held, a certificate for the same Seedelf, register and m_S:
///    200 `already`, whatever the stamp, so a wallet that posts its own
///    again after a restart, or with a fresh aux, isn't asked to pay.
///    - 3′. Not withdrawn: its listing digest isn't one a withdrawal took
///      down, else 409 `withdrawn`, so whoever kept a certificate's bytes
///      can't list it again after its owner withdrew it ("A withdrawal
///      lasts").
/// 4. The price and the window, a short envelope's from the same address:
///    429, as an envelope's.
/// 5. The stamp, over the listing digest: 402 with the price.
/// 6. Room: 409 when its Seedelf has two already, 503 when the list is full.
///    A certificate held is never pushed out for another.
/// 7. The points and the proof (§21.4's checks 2 to 5), the costly check,
///    so a sender pays its work, and a full list refuses, before the relay
///    spends on them: 400, counted against the address's own price, as an
///    envelope's bad point is.
/// 8. The chain (chunk 55's call 6): (g_S, u_S) is the datum register of
///    the contract UTxO that holds N, in the pool's view (`view`): mainnet's
///    the data layer's own, preprod's Koios's at post time. Last, after the
///    proof, as it reads another part or another server. Else 409 `not this
///    Seedelf's register now`, counted against the address's own price as
///    row 7's is [choice]; and a 503 `can't check the chain now` when the
///    view can't be read, its `Retry-After` 60, or on preprod however long
///    Koios's day's budget or its back-off still has to run. A certificate
///    is never listed unchecked.
///
/// From row 7 on, a post is counted against its address whatever comes of
/// it, a request dropped while the chain is read too (`Counted`).
async fn post_certificate(
    State(relay): State<Arc<Relay>>,
    UrlPath(name): UrlPath<String>,
    client: Option<Extension<Client>>,
    body: Bytes,
) -> Response {
    let Some(pool) = relay.pool(&name) else {
        return no_such_pool();
    };
    if relay.stopped.pool(&name) {
        return stopped();
    }
    if body.len() < NONCE_LEN {
        return bad("a post is a nonce, then a certificate");
    }
    let nonce = u64::from_be_bytes(body[..NONCE_LEN].try_into().expect("8 bytes"));
    // Borrowed from the request's body: the list keeps a copy of its own.
    let bytes = &body[NONCE_LEN..];
    let shape =
        match certificate::check_shape(bytes, pool.config.list.network, &certificate::POLICY) {
            Ok(shape) => shape,
            Err(refused) => return bad(refused.reason()),
        };
    let key = Key::of(&shape);
    let digest = certificate::listing_digest(pool.config.name, bytes);
    {
        let list = pool.list.lock().expect("list lock");
        // The bytes held for this listing, which may be another posting's:
        // a withdrawal names them by their digest.
        if let Some(held) = list.held(&key) {
            return listed(
                "already",
                &certificate::listing_digest(pool.config.name, &held),
            );
        }
        if list.withdrawn(&digest) {
            return unlisted(Unlisted::Withdrawn);
        }
        if list.too_often(&key.seedelf) {
            return unlisted(Unlisted::TooOften);
        }
    }
    let address = client.map_or(NO_ADDRESS, |Extension(Client(ip))| address_key(ip));
    let instant = Instant::now();
    let bits = match price(pool, address, CERTIFICATE_AS, instant) {
        Ok(bits) => bits,
        Err(unpriced) => return unpriced.answer(),
    };
    if check::stamp_bits(&digest, nonce) < bits {
        return more_work(bits);
    }
    // Room before the proof, as an envelope's before its points. The list
    // looks again as it lists, and that's what counts.
    let room = pool
        .list
        .lock()
        .expect("list lock")
        .room(&key, bytes.len(), pool.config.list.cap);
    if let Err(unlisted_) = room {
        return unlisted(unlisted_);
    }
    // From here every post is counted against its address, whatever comes
    // of it: a kept one as kept, every other as refused, one whose client
    // hangs up while the chain is read too. So one solved stamp pays for
    // only so many proofs and reads of the chain.
    let counted = Counted::new(pool, address, instant);
    if let Err(why) = certificate::check_proof(&shape) {
        return bad(why.reason());
    }
    match pool.view.register(shape.name()).await {
        Ok(Some(register)) if register[..] == *shape.register() => {}
        Ok(_) => {
            let body = json!({ "error": "not this Seedelf's register now" });
            return (StatusCode::CONFLICT, axum::Json(body)).into_response();
        }
        Err(Unreadable { retry_after }) => {
            return refuse(
                StatusCode::SERVICE_UNAVAILABLE,
                "can't check the chain now",
                retry_after,
            );
        }
    }
    match pool.list(digest, key, bytes, address, instant) {
        Ok(Listed::New) => {
            counted.kept();
            listed("new", &digest)
        }
        Ok(Listed::Already) => {
            let held = pool.list.lock().expect("list lock").held(&key);
            let held = held.map_or(digest, |held| {
                certificate::listing_digest(pool.config.name, &held)
            });
            listed("already", &held)
        }
        Err(NotListed::Window(secs)) => refuse(StatusCode::TOO_MANY_REQUESTS, WINDOW_FULL, secs),
        Err(NotListed::Room(unlisted_)) => unlisted(unlisted_),
    }
}

/// A list post past its stamp, counted against its address however it
/// ends: as kept once [`Counted::kept`] says so, as refused otherwise,
/// whether it answers or its request is dropped mid-way (a client that
/// hangs up while the chain is read, or a save is made, still pays for the
/// proof and the read).
struct Counted<'a> {
    pool: &'a Pool,
    address: IpAddr,
    instant: Instant,
    kept: bool,
}

impl<'a> Counted<'a> {
    fn new(pool: &'a Pool, address: IpAddr, instant: Instant) -> Self {
        Counted {
            pool,
            address,
            instant,
            kept: false,
        }
    }

    /// Counted as kept.
    fn kept(mut self) {
        self.kept = true;
        self.pool.counts.lock().expect("counts lock").record(
            self.address,
            CERTIFICATE_AS,
            self.instant,
        );
    }
}

impl Drop for Counted<'_> {
    fn drop(&mut self) {
        if !self.kept {
            self.pool.counts.lock().expect("counts lock").count_refused(
                self.address,
                CERTIFICATE_AS,
                self.instant,
            );
        }
    }
}

/// A withdrawal post (§21.7, "Posting one"): checked in its table's order,
/// cheapest first, the first that fails answering.
///
/// 1. The body is a nonce and a withdrawal, 106 bytes: 400.
/// 2. The shape: version 1, the pool's network, c and z below q: 400.
/// 3. The digest names a certificate the list holds: 404 `no such
///    certificate`, which tells a poster only what the list shows.
/// 4. The price and the window, a short envelope's from the same address:
///    429, as an envelope's.
/// 5. The stamp, over SHA-256(`…|unlisting-stamp|` ‖ len(pool) ‖ pool ‖
///    withdrawal): 402 with the price.
/// 6. The proof of x_m on the held certificate's messaging register: 400,
///    counted against the address's own price.
///
/// Taken, the certificate goes, a removal entry for its digest takes its
/// place, the digest is kept so the same bytes are never listed again, and
/// the list is saved before the answer, so a crash after it can't bring the
/// certificate back for its wallet to think withdrawn; then the post is
/// counted as a kept short envelope [choice]: 200 `{"withdrawn": true}`. A
/// save that fails puts the certificate back in memory (`List::unwithdraw`)
/// and answers 503 `can't save now`, `Retry-After` 60. One taken meanwhile
/// by another post of it is a 404 too. From row 6 on, a post is counted
/// against its address whatever comes of it (`Counted`).
async fn post_withdrawal(
    State(relay): State<Arc<Relay>>,
    UrlPath(name): UrlPath<String>,
    client: Option<Extension<Client>>,
    body: Bytes,
) -> Response {
    let Some(pool) = relay.pool(&name) else {
        return no_such_pool();
    };
    if relay.stopped.pool(&name) {
        return stopped();
    }
    if body.len() != MAX_WITHDRAWAL_POST {
        return bad(Unwithdrawn::InvalidLength.reason());
    }
    let nonce = u64::from_be_bytes(body[..NONCE_LEN].try_into().expect("8 bytes"));
    let bytes = &body[NONCE_LEN..];
    let withdrawal = match certificate::check_withdrawal_shape(bytes, pool.config.list.network) {
        Ok(withdrawal) => withdrawal,
        Err(refused) => return bad(refused.reason()),
    };
    let Some(held) = pool
        .list
        .lock()
        .expect("list lock")
        .certificate(withdrawal.digest())
    else {
        return no_such_certificate();
    };
    let address = client.map_or(NO_ADDRESS, |Extension(Client(ip))| address_key(ip));
    let instant = Instant::now();
    let bits = match price(pool, address, CERTIFICATE_AS, instant) {
        Ok(bits) => bits,
        Err(unpriced) => return unpriced.answer(),
    };
    if check::stamp_bits(
        &certificate::unlisting_digest(pool.config.name, bytes),
        nonce,
    ) < bits
    {
        return more_work(bits);
    }
    let shape = certificate::check_shape(&held, pool.config.list.network, &certificate::POLICY)
        .expect("a listed certificate's shape");
    let counted = Counted::new(pool, address, instant);
    if let Err(refused) = certificate::check_withdrawal_proof(&withdrawal, &shape) {
        return bad(refused.reason());
    }
    let taken = {
        let mut window = pool.window.lock().expect("window lock");
        let taken = pool
            .list
            .lock()
            .expect("list lock")
            .withdraw(withdrawal.digest(), unix_day());
        if taken {
            window.record(address, CERTIFICATE_AS, instant);
        }
        taken
    };
    if !taken {
        // Taken meanwhile by another post of it: counted as refused, as
        // every post that reaches the proof is counted.
        return no_such_certificate();
    }
    // Saved before the answer, so a crash after it can't bring the
    // certificate back for its wallet to think withdrawn.
    let saving = relay.clone();
    let saved = tokio::task::spawn_blocking(move || saving.save_list(&name))
        .await
        .unwrap_or(false);
    if !saved {
        pool.list
            .lock()
            .expect("list lock")
            .unwithdraw(pool.config.name, &held);
        return refuse(StatusCode::SERVICE_UNAVAILABLE, "can't save now", 60);
    }
    counted.kept();
    axum::Json(json!({ "withdrawn": true })).into_response()
}

/// §21.7's withdrawal row 3.
fn no_such_certificate() -> Response {
    let body = json!({ "error": "no such certificate" });
    (StatusCode::NOT_FOUND, axum::Json(body)).into_response()
}

/// A page of the list (§21.7), as an envelope page is read (§17.5).
async fn list_page(
    State(relay): State<Arc<Relay>>,
    UrlPath(name): UrlPath<String>,
    RawQuery(query): RawQuery,
    client: Option<Extension<Client>>,
    reserved: Option<Extension<Reserved>>,
) -> Response {
    let Some(pool) = relay.pool(&name) else {
        return no_such_pool();
    };
    if relay.stopped.pool(&name) {
        return stopped();
    }
    let after = match query.as_deref() {
        None => None,
        Some(query) => match cursor(query) {
            Some(after) => Some(after),
            None => return bad("the one parameter is after, a cursor"),
        },
    };
    let address = client.map_or(NO_ADDRESS, |Extension(Client(ip))| address_key(ip));
    let short = reserved.map(|Extension(Reserved(most))| most);
    match pool.read_list(after, address, short, unix_now(), Instant::now()) {
        Ok(page) => octets(page),
        Err(NotRead::Day(secs)) => refuse(StatusCode::TOO_MANY_REQUESTS, DAY_READ, secs),
    }
}

/// A page's answer: its bytes, as `application/octet-stream`.
fn octets(page: Vec<u8>) -> Response {
    let mut response = page.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    response
}

/// A certificate post's answer once listed, or held already, with the
/// listing digest of the certificate the list holds for its Seedelf,
/// register and m_S: the post's own when new, and when already, the held
/// one's, which may be another posting's bytes (a fresh aux) and is what a
/// withdrawal must name. No expiry: the list keeps no times.
fn listed(kept: &str, digest: &[u8; 32]) -> Response {
    let digest: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    axum::Json(json!({ "kept": kept, "digest": digest })).into_response()
}

/// The off switch's answer, as the edge gives it, to a route whose pool it
/// stops: what the edge's check missed, by a spelling of the path.
fn stopped() -> Response {
    let body = json!({ "error": "messaging is stopped" });
    (StatusCode::GONE, axum::Json(body)).into_response()
}

/// §21.7's rows 3′ and 6: a 409 `withdrawn` for bytes a withdrawal took
/// down; a 409 when the certificate's Seedelf, at its register, has two
/// already, which only a removal frees; a 503 when the list is full, whose
/// `Retry-After` is an hour, since nothing frees room before a removal does
/// [choice].
fn unlisted(unlisted: Unlisted) -> Response {
    let conflict = |error: &str| {
        let body = json!({ "error": error });
        (StatusCode::CONFLICT, axum::Json(body)).into_response()
    };
    match unlisted {
        Unlisted::Withdrawn => conflict("withdrawn"),
        Unlisted::Two => conflict("two certificates for this Seedelf already"),
        Unlisted::TooOften => conflict(
            "this Seedelf was withdrawn too often at this register: move it to list it again",
        ),
        Unlisted::Full => refuse(StatusCode::SERVICE_UNAVAILABLE, "the list is full", 3600),
    }
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

/// A 429's words when an address has read its day's budget of a pool, or
/// its share of messaging's reserve: the wallet's day's hold.
const DAY_READ: &str = "this address has read its share of the pool for the day";

/// How long an address that has read its share of the reserve waits:
/// until enough of its oldest hours of it age out (`secs`, at most a day
/// and an hour), or until the day rolls, a minute past midnight UTC, when
/// the edge starts the next day's share and the reserve lifts, whichever is
/// first.
fn reserve_wait(secs: u64, now: i64) -> u64 {
    let roll = (86_400 - now.rem_euclid(86_400)) as u64 + 60;
    secs.min(roll).max(1)
}

/// An `already` answer's expiry: never later than the copy's, and to the
/// 10 minutes.
fn rounded_down(expires: i64) -> i64 {
    expires - expires.rem_euclid(ALREADY_ROUNDED)
}

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

/// Today, in Unix days: a removal's day (`list`).
fn unix_day() -> u32 {
    (unix_now() / 86_400) as u32
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

    /// A relay given no view of the chain (`View::Nowhere`) lists nothing:
    /// a good certificate, paid, is a 503 at check 8, never kept unchecked.
    #[tokio::test]
    async fn without_a_view_of_the_chain_no_certificate_is_listed() {
        use tower::ServiceExt;
        let file: Value = serde_json::from_str(include_str!(
            "../../../../seedelf-platform/seedelf-messaging/tests/vectors/messaging_certificate_v1.json"
        ))
        .unwrap();
        let certificate =
            certificate::tests::bytes(file["certificates"][0]["certificate"].as_str().unwrap());
        let digest = certificate::listing_digest("preprod", &certificate);
        let nonce = (0u64..)
            .find(|&n| check::stamp_bits(&digest, n) >= 16)
            .unwrap();
        let relay = Arc::new(Relay::new(None));
        assert_eq!(relay.health()["preprod"]["chain"], "none");
        let request = axum::http::Request::post("/messaging/v1/preprod/certificates")
            .body(axum::body::Body::from(
                [&nonce.to_be_bytes()[..], &certificate].concat(),
            ))
            .unwrap();
        let response = routes()
            .with_state(relay.clone())
            .oneshot(request)
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(response.headers()[header::RETRY_AFTER], "60");
        let bytes = axum::body::to_bytes(response.into_body(), 1 << 10)
            .await
            .unwrap();
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["error"], "can't check the chain now");
        assert_eq!(relay.health()["preprod"]["certificates"], 0);
        // And the sweep, with no view to read, drops nothing.
        assert_eq!(relay.sweep_once().await, 0);
    }

    /// The routes check the off switch by the pool's name as they decode
    /// it, whatever the edge saw: `pre%70rod` is preprod here, and stopped.
    #[tokio::test]
    async fn a_stopped_pool_is_stopped_however_its_name_is_spelled() {
        use tower::ServiceExt;
        let relay = Arc::new(Relay::new(None).with_stopped(Stopped::of(["preprod"]).unwrap()));
        let app = routes().with_state(relay);
        let ask = |method: &str, uri: &str, body: Vec<u8>| {
            axum::http::Request::builder()
                .method(method)
                .uri(uri)
                .body(axum::body::Body::from(body))
                .unwrap()
        };
        for (method, uri, body) in [
            ("GET", "/messaging/v1/pre%70rod/envelopes", vec![]),
            ("GET", "/messaging/v1/preprod/envelopes", vec![]),
            ("POST", "/messaging/v1/pre%70rod/envelopes", vec![0; 520]),
            ("GET", "/messaging/v1/%70reprod/certificates", vec![]),
            ("POST", "/messaging/v1/prepro%64/certificates", vec![0; 281]),
            ("POST", "/messaging/v1/pre%70rod/withdrawals", vec![0; 106]),
        ] {
            let response = app.clone().oneshot(ask(method, uri, body)).await.unwrap();
            assert_eq!(response.status(), StatusCode::GONE, "{method} {uri}");
        }
        // Mainnet's, encoded or not, answers as ever.
        for uri in [
            "/messaging/v1/mainnet/envelopes",
            "/messaging/v1/main%6eet/envelopes",
        ] {
            let response = app.clone().oneshot(ask("GET", uri, vec![])).await.unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{uri}");
        }
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
        list: POOLS[1].list,
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

    /// The reserve (the relay review's low, gate 54g, and the 1.10.0 gate's
    /// FI-5): a page is cut to what the reserve sends, its framing counted,
    /// with the flag that says another follows now, and an envelope longer
    /// than that by itself goes alone, so no reader stops at it. Nothing on
    /// the wire changes: a page is whole envelopes, and `MORE` says go on.
    #[test]
    fn in_the_reserve_a_page_is_cut_short_and_a_longer_envelope_goes_alone() {
        let relay = Relay::with_pools(None, &ONE);
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
        // A 32 KiB envelope is longer by itself: it goes alone, past the
        // reserve's page, and the reader goes on from it.
        keep(3, 32768);
        let alone = pool.read(Some(cursor_of(&second)), me, most, now, instant);
        let alone = alone.unwrap();
        assert_eq!((alone.len(), alone[1]), (16 + 4 + 32768, 0));
        assert_eq!(alone[20..], [3; 32768]);
        let after = pool.read(Some(cursor_of(&alone)), me, most, now, instant);
        assert_eq!(after.unwrap().len(), PAGE_HEADER);
    }

    /// The 1.10.0 gate's FI-5: in the reserve, an address reads at most its
    /// share of it in a day, both pools together, then the reserve's
    /// refusal; another address reads on, and outside the reserve the
    /// share counts nothing.
    #[test]
    fn in_the_reserve_an_address_reads_its_share_of_it_across_both_pools() {
        let relay = Relay::new(None);
        let (mainnet, preprod) = (
            relay.pool("mainnet").unwrap(),
            relay.pool("preprod").unwrap(),
        );
        fill_a_page(mainnet);
        fill_a_page(preprod);
        let me = address_key("203.0.113.7".parse().unwrap());
        let most = Some(16 * 1024);
        let (now, instant) = (unix_now(), Instant::now());
        let mut read = 0u64;
        while let Ok(page) = mainnet.read(None, me, most, now, instant) {
            assert!(page.len() <= 16 * 1024);
            read += page.len() as u64;
        }
        // 16 MiB, and the page that passed it.
        assert!(
            (RESERVE_READ..RESERVE_READ + 16 * 1024).contains(&read),
            "{read}"
        );
        // The day's refusal, until the share frees or the day rolls,
        // whichever is first: within a day and a minute.
        let until_the_roll = (86_400 - now.rem_euclid(86_400)) as u64 + 60;
        for pool in [mainnet, preprod] {
            let Err(NotRead::Day(secs)) = pool.read(None, me, most, now, instant) else {
                panic!("{}: read past its share of the reserve", pool.config.name)
            };
            assert!((1..=until_the_roll).contains(&secs), "{secs}");
        }
        let other = address_key("203.0.113.8".parse().unwrap());
        assert!(mainnet.read(None, other, most, now, instant).is_ok());
        assert!(preprod.read(None, other, most, now, instant).is_ok());
        // Outside the reserve: the day's reading, which the reserve's share
        // left as it was.
        assert!(mainnet.read(None, me, None, now, instant).is_ok());
        assert!(preprod.read(None, me, None, now, instant).is_ok());
        // Another share for every address, as the environment sets it.
        let small = Relay::new(None).with_reserve_read(40_000);
        let pool = small.pool("preprod").unwrap();
        fill_a_page(pool);
        let pages = std::iter::from_fn(|| pool.read(None, me, most, now, instant).ok()).count();
        assert_eq!(pages, 3);
    }

    /// The reserve's refusal waits for the share to free or the day to
    /// roll, whichever is first, a minute past midnight UTC, and at least
    /// a second.
    #[test]
    fn the_reserves_wait_ends_with_the_share_or_the_day() {
        let midnight = 1_800_057_600; // 2027-01-16T00:00:00Z
        assert_eq!(midnight % 86_400, 0);
        assert_eq!(reserve_wait(90_000, midnight - 3600), 3660);
        assert_eq!(reserve_wait(1200, midnight - 3600), 1200);
        assert_eq!(reserve_wait(90_000, midnight), 86_460);
        assert_eq!(reserve_wait(0, midnight - 10), 1);
    }

    /// The 1.10.0 gate's FI-7 (the relay review's R5): a start that found a
    /// pool's file but couldn't read it leaves the file as it was and marks
    /// nothing clean beside it, until a save of the pool succeeds; a start
    /// that found no file has nothing to keep.
    #[test]
    fn a_pool_whose_file_couldnt_be_read_is_marked_clean_only_once_saved() {
        let dir = std::env::temp_dir().join(format!("seedelf-relay-unread-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("messaging-preprod.pool");
        let mark = dir.join("messaging-preprod.clean");
        // A file this build doesn't read: another version's.
        let other = [&[2u8][..], &[0; 20]].concat();
        std::fs::write(&file, &other).unwrap();
        let relay = Relay::with_pools(Some(&dir), &ONE);
        relay.save(false);
        relay.save(true);
        assert!(!mark.exists());
        assert_eq!(std::fs::read(&file).unwrap(), other);
        // A post kept: the save replaces the file, which is the pool's now.
        let pool = relay.pool("preprod").unwrap();
        let bytes = vec![1u8; 512];
        let digest = check::stamp_digest("preprod", &bytes);
        let me: IpAddr = "203.0.113.7".parse().unwrap();
        pool.keep(digest, &bytes, me, unix_now(), Instant::now())
            .unwrap();
        relay.save(true);
        assert!(mark.exists());
        assert!(Snapshot::decode(&std::fs::read(&file).unwrap()).is_some());
        // No file at all: the pool is new, saved and marked as ever.
        std::fs::remove_file(&file).unwrap();
        std::fs::remove_file(&mark).unwrap();
        let fresh = Relay::with_pools(Some(&dir), &ONE);
        fresh.save(true);
        assert!(file.exists() && mark.exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// The 1.10.0 gate's FI-9 (the relay review's N2): a save that fails
    /// leaves no partial file; a pool's file and its mark have partials of
    /// their own names; and a start removes what a failed save left.
    #[test]
    fn a_save_that_fails_leaves_nothing_behind() {
        let dir =
            std::env::temp_dir().join(format!("seedelf-relay-partial-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("messaging-preprod.pool");
        let mark = dir.join("messaging-preprod.clean");
        assert_eq!(pool_partial(&file), dir.join("messaging-preprod.partial"));
        assert_eq!(
            mark_partial(&mark),
            dir.join("messaging-preprod.clean.partial")
        );
        // What a build before this one left beside the pool's file.
        std::fs::write(dir.join("messaging-preprod.partial"), [0u8; 4096]).unwrap();
        std::fs::write(dir.join("messaging-preprod.clean.partial"), b"").unwrap();
        let relay = Relay::with_pools(Some(&dir), &ONE);
        assert!(!pool_partial(&file).exists() && !mark_partial(&mark).exists());
        // A folder where the pool's file goes: the rename fails.
        std::fs::create_dir(&file).unwrap();
        relay.save(true);
        assert!(file.is_dir());
        assert!(!pool_partial(&file).exists());
        // Not saved, so not marked clean, and still to save.
        assert!(!mark.exists());
        assert!(relay.pool("preprod").unwrap().held.lock().unwrap().changed);
        std::fs::remove_dir_all(&dir).unwrap();
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

    /// A certificate's shape for preprod (list.rs's test bytes) and the
    /// key and digest it's listed by.
    fn shaped(seedelf: u32, value: u32) -> (Vec<u8>, Key, [u8; 32]) {
        let bytes = list::tests::shaped(seedelf, value, 0);
        let shape =
            certificate::check_shape(&bytes, certificate::NETWORK_PREPROD, &certificate::POLICY)
                .unwrap();
        let digest = certificate::listing_digest("preprod", &bytes);
        (bytes.clone(), Key::of(&shape), digest)
    }

    /// A list page's flags, cursor, price and entries (kind, bytes).
    fn entries(page: &[u8]) -> (u8, u64, u8, Vec<(u8, Vec<u8>)>) {
        let count = u16::from_be_bytes([page[11], page[12]]) as usize;
        let (mut at, mut out) = (list::PAGE_HEADER, vec![]);
        for _ in 0..count {
            let len = u16::from_be_bytes([page[at + 1], page[at + 2]]) as usize;
            out.push((page[at], page[at + 3..at + 3 + len].to_vec()));
            at += 3 + len;
        }
        assert_eq!(at, page.len());
        let cursor = u64::from_be_bytes(page[2..10].try_into().unwrap());
        (page[1], cursor, page[10], out)
    }

    /// A removal entry through the route (the test-only drop stands for
    /// the chain check and withdrawals, which come later): kind 2 and the
    /// listing digest, after the certificates, to a reader who read the
    /// one it names and to one who starts now; and its Seedelf has room for
    /// another, posted through the route.
    #[tokio::test]
    async fn a_removal_is_read_through_the_route_as_kind_2_and_its_digest() {
        use tower::ServiceExt;
        let relay = Arc::new(Relay::new(None));
        let pool = relay.pool("preprod").unwrap();
        let (a, b, c) = (shaped(1, 1), shaped(1, 2), shaped(2, 1));
        for (bytes, key, digest) in [&a, &b, &c] {
            let listed = pool.list(*digest, *key, bytes, NO_ADDRESS, Instant::now());
            assert_eq!(listed, Ok(Listed::New));
        }
        let app = routes().with_state(relay.clone());
        let get = |after: Option<u64>| {
            let uri = match after {
                Some(after) => format!("/messaging/v1/preprod/certificates?after={after}"),
                None => "/messaging/v1/preprod/certificates".to_string(),
            };
            let app = app.clone();
            async move {
                let response = app
                    .oneshot(
                        axum::http::Request::get(uri)
                            .body(axum::body::Body::empty())
                            .unwrap(),
                    )
                    .await
                    .unwrap();
                assert_eq!(response.status(), StatusCode::OK);
                let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
                    .await
                    .unwrap();
                entries(&bytes)
            }
        };
        let (_, cursor, price, read) = get(None).await;
        assert_eq!(price, 16);
        assert_eq!(read.len(), 3);
        assert!(pool.list.lock().unwrap().withdraw(&b.2, 20_833));
        // The reader who read it: one entry, the removal.
        let (flags, _, _, after) = get(Some(cursor)).await;
        assert_eq!((flags, after), (0, vec![(list::REMOVAL, b.2.to_vec())]));
        // A reader who starts now: the two held, then the removal.
        let (_, _, _, fresh) = get(None).await;
        assert_eq!(
            fresh,
            vec![
                (list::CERTIFICATE, a.0.clone()),
                (list::CERTIFICATE, c.0.clone()),
                (list::REMOVAL, b.2.to_vec()),
            ]
        );
        // The Seedelf has room for another m_S again, and it's the last entry.
        let d = shaped(1, 3);
        let listed = pool.list(d.2, d.1, &d.0, NO_ADDRESS, Instant::now());
        assert_eq!(listed, Ok(Listed::New));
        let (_, _, _, last) = get(Some(cursor)).await;
        assert_eq!(last.last().unwrap(), &(list::CERTIFICATE, d.0.clone()));
        assert_eq!(relay.health()["preprod"]["certificates"], 3);
    }

    /// Certificates listed at once from one address: the window is looked
    /// at again with the insert, as an envelope's is, and so are the
    /// Seedelf's two and the cap, so they can't pass them together; one
    /// listed meanwhile is "already".
    #[test]
    fn certificates_at_once_are_counted_as_listed_so_only_one_passes() {
        let relay = Relay::with_pools(None, &ONE);
        let pool = relay.pool("preprod").unwrap();
        let me: IpAddr = "203.0.113.7".parse().unwrap();
        let now = Instant::now();
        let (a, b) = (shaped(1, 1), shaped(2, 1));
        assert_eq!(
            pool.window.lock().unwrap().wait(me, CERTIFICATE_AS, now),
            None
        );
        assert_eq!(pool.list(a.2, a.1, &a.0, me, now), Ok(Listed::New));
        assert!(matches!(
            pool.list(b.2, b.1, &b.0, me, now),
            Err(NotListed::Window(secs)) if secs > 36 * 3600
        ));
        assert_eq!(pool.list(a.2, a.1, &a.0, me, now), Ok(Listed::Already));
        // A Seedelf's two, reached meanwhile from other addresses.
        let other = |i: u8| IpAddr::from([198, 51, 100, i]);
        let (c, d) = (shaped(1, 2), shaped(1, 3));
        assert_eq!(pool.list(c.2, c.1, &c.0, other(1), now), Ok(Listed::New));
        assert_eq!(
            pool.list(d.2, d.1, &d.0, other(2), now),
            Err(NotListed::Room(Unlisted::Two))
        );
        // A certificate is a short envelope in the window: the address that
        // listed one has no room for an envelope now.
        assert!(pool.window.lock().unwrap().wait(me, 512, now).is_some());
        assert_eq!(relay.health()["preprod"]["certificates"], 2);
    }

    /// In messaging's reserve, a list page holds what fits the reserve's
    /// page, its framing counted, with the flag that more follow, and it
    /// counts against the address's share of the reserve, both pools'.
    #[test]
    fn in_the_reserve_a_list_page_is_cut_short_and_counts_against_the_share() {
        let relay = Relay::new(None).with_reserve_read(40_000);
        let pool = relay.pool("preprod").unwrap();
        {
            let mut held = pool.list.lock().unwrap();
            for i in 0..200 {
                list::tests::listed(&mut held, &list::tests::shaped(i, 0, 0), 1 << 20).unwrap();
            }
        }
        let me = address_key("203.0.113.7".parse().unwrap());
        let (now, instant) = (unix_now(), Instant::now());
        let most = Some(16 * 1024);
        let page = pool.read_list(None, me, most, now, instant).unwrap();
        let (flags, cursor, _, read) = entries(&page);
        assert!(page.len() <= 16 * 1024);
        assert_eq!((flags, read.len()), (pool::MORE, (16 * 1024 - 13) / 276));
        // Outside the reserve, the whole page.
        let whole = pool.read_list(None, me, None, now, instant).unwrap();
        assert_eq!(entries(&whole).3.len(), 200);
        // The share: 40,000 bytes, and the page that passes it.
        let mut after = Some(cursor);
        let mut read = page.len();
        while let Ok(page) = pool.read_list(after, me, most, now, instant) {
            read += page.len();
            after = Some(entries(&page).1);
        }
        assert!((40_000..40_000 + 16 * 1024).contains(&read), "{read}");
        // Spent for envelope pages too, on either pool.
        for name in ["preprod", "mainnet"] {
            let pool = relay.pool(name).unwrap();
            assert!(matches!(
                pool.read(None, me, most, now, instant),
                Err(NotRead::Day(_))
            ));
        }
    }

    /// The list is saved in a file of its own beside the pool's, under
    /// names none of which is the pool's; a save of it that fails leaves
    /// nothing behind, writes no mark, and leaves the list to save again.
    #[test]
    fn the_list_is_saved_apart_from_the_pool_and_a_failed_save_leaves_nothing() {
        let dir = std::env::temp_dir().join(format!("seedelf-relay-list-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let (pool, list) = (Files::pool(&dir, "preprod"), Files::list(&dir, "preprod"));
        let names = |files: &Files| {
            [
                &files.file,
                &files.partial,
                &files.mark,
                &files.mark_partial,
            ]
            .map(|path| path.file_name().unwrap().to_str().unwrap().to_string())
        };
        assert_eq!(
            names(&list),
            [
                "messaging-preprod.list",
                "messaging-preprod.list.partial",
                "messaging-preprod.list.clean",
                "messaging-preprod.list.clean.partial",
            ]
        );
        assert_eq!(
            names(&pool),
            [
                "messaging-preprod.pool",
                "messaging-preprod.partial",
                "messaging-preprod.clean",
                "messaging-preprod.clean.partial",
            ]
        );
        for name in names(&list) {
            assert!(!names(&pool).contains(&name), "{name}");
        }
        // What a failed save left beside the list, removed at start.
        std::fs::write(&list.partial, [0u8; 64]).unwrap();
        std::fs::write(&list.mark_partial, b"").unwrap();
        let relay = Relay::with_pools(Some(&dir), &ONE);
        assert!(!list.partial.exists() && !list.mark_partial.exists());
        let (bytes, key, digest) = shaped(1, 1);
        let at = relay.pool("preprod").unwrap();
        at.list(digest, key, &bytes, NO_ADDRESS, Instant::now())
            .unwrap();
        // A folder where the list's file goes: the rename fails.
        std::fs::create_dir(&list.file).unwrap();
        relay.save(true);
        assert!(list.file.is_dir() && !list.partial.exists() && !list.mark.exists());
        assert!(at.list.lock().unwrap().changed);
        // The pool's own save went on: its file and mark are there.
        assert!(pool.file.is_file() && pool.mark.exists());
        std::fs::remove_dir(&list.file).unwrap();
        relay.save(true);
        assert!(list.file.is_file() && list.mark.exists());
        std::fs::remove_dir_all(&dir).unwrap();
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
