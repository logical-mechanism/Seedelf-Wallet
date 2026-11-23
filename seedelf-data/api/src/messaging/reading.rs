//! What one address may read of a pool in a day (docs/protocol.md §17.5):
//! the bytes of the pages it was sent over the last 24 hours, in hourly
//! buckets. A post costs work and has its window; a page costs nothing, and
//! with no budget one address could ask for the first page all day and
//! spend messaging's whole traffic allowance, which every reader and writer
//! shares. Past its budget an address's pages are refused until enough of
//! its oldest hours age out.
//!
//! **Counts, never pages:** an address's entry is how many bytes it was
//! sent in each hour, nothing of which pages or cursors. In memory only,
//! never in the pool's file, so a restart starts every reader's day again,
//! and nothing logs them. An hour goes 24 hours after it ends, an address
//! with its last hour. The address is the relay's key
//! (`super::address_key`), as the posts' window takes it.

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::net::IpAddr;
use std::time::{Duration, Instant};

/// At most this many addresses are counted at once, as the posts' tables
/// count (window.rs). A full table never refuses a reader, whom no work
/// tells from a flood's addresses: the address seen least recently goes,
/// and its day starts again.
const MAX_ADDRESSES: usize = 200_000;

/// A bucket's hour.
const HOUR: u64 = 3600;

/// How long an hour's reading counts after the hour ends.
const DAY: u64 = 24 * HOUR;

/// The numbers a day's reading is worked out from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Reading {
    /// The least one address may read of any pool in a day, in bytes.
    pub floor: u64,
    /// And at least this many times what the pool holds at most.
    pub pools: u64,
}

impl Reading {
    /// 256 MiB, and eight times the pool's cap where that's more: 512 MiB
    /// of mainnet's pool, 256 MiB of preprod's [choice]. An honest reader
    /// downloads each envelope once, so a full pool turning over costs it
    /// the cap in 36 hours; eight caps leave room for the wallets that
    /// share an address and for a fresh sync or two each. The owner's to
    /// tune: `DATA_MESSAGING_READ_MIB_DAY` and
    /// `DATA_MESSAGING_READ_POOLS_DAY` (config.rs).
    pub const DEFAULT: Reading = Reading {
        floor: 256 << 20,
        pools: 8,
    };

    /// The most page bytes one address is sent in a day of a pool that
    /// holds at most `cap`.
    pub fn budget(&self, cap: usize) -> u64 {
        self.floor.max(self.pools.saturating_mul(cap as u64))
    }
}

/// What an address was sent in one hour.
#[derive(Debug, Clone, Copy)]
struct Hour {
    /// Hours since the table began.
    hour: u64,
    bytes: u64,
}

struct Reader {
    /// The oldest first.
    hours: VecDeque<Hour>,
    /// Its place in `Reads::seen`.
    seen: u64,
}

pub struct Reads {
    /// The most page bytes one address is sent in a day.
    budget: u64,
    /// Hour 0's start.
    origin: Instant,
    /// The most addresses counted at once.
    most: usize,
    readers: HashMap<IpAddr, Reader>,
    /// Every reader by when it was last seen, the least recent first.
    seen: BTreeMap<u64, IpAddr>,
    /// What the next reader seen is given.
    turn: u64,
}

impl Reads {
    pub fn new(budget: u64, now: Instant) -> Self {
        Self::with_room(budget, MAX_ADDRESSES, now)
    }

    /// [`Reads::new`] counting at most `most` addresses: a test's.
    pub fn with_room(budget: u64, most: usize, now: Instant) -> Self {
        Reads {
            budget,
            origin: now,
            most: most.max(1),
            readers: HashMap::new(),
            seen: BTreeMap::new(),
            turn: 0,
        }
    }

    pub fn budget(&self) -> u64 {
        self.budget
    }

    /// Whether `address` may be sent a page now: `None` while what it was
    /// sent in the last day is under the budget, else the seconds until
    /// enough of its oldest hours have aged out, if it reads nothing
    /// meanwhile. At most 25 hours: the day and the hour a bucket spans.
    ///
    /// An address that's refused is still seen, so one that keeps asking
    /// isn't the first to go from a full table.
    pub fn wait(&mut self, address: IpAddr, now: Instant) -> Option<u64> {
        if self.budget == 0 {
            return Some(DAY + HOUR);
        }
        let origin = self.origin;
        let reader = self.readers.get(&address)?;
        let live = || {
            reader
                .hours
                .iter()
                .filter(|hour| live_at(origin, hour, now))
        };
        let mut read: u64 = live().map(|hour| hour.bytes).sum();
        if read < self.budget {
            return None;
        }
        let mut wait = DAY + HOUR;
        for hour in live() {
            read -= hour.bytes;
            if read < self.budget {
                let gone = ages_out(origin, hour).saturating_duration_since(now);
                wait = ceil_secs(gone).clamp(1, DAY + HOUR);
                break;
            }
        }
        self.see(address);
        Some(wait)
    }

    /// Counts a page of `bytes` sent to `address`, unless its day is spent
    /// meanwhile: the budget is looked at again here, with the count, so
    /// pages asked at once can't pass it together. An address reads at
    /// most one page past its budget.
    pub fn take(&mut self, address: IpAddr, bytes: usize, now: Instant) -> Result<(), u64> {
        if let Some(secs) = self.wait(address, now) {
            return Err(secs);
        }
        if !self.readers.contains_key(&address) && self.readers.len() >= self.most {
            // No reader is refused for the table's sake: the one seen least
            // recently makes room.
            if let Some((_, gone)) = self.seen.pop_first() {
                self.readers.remove(&gone);
            }
        }
        let (origin, hour) = (self.origin, self.hour(now));
        let reader = self.readers.entry(address).or_insert_with(|| Reader {
            hours: VecDeque::new(),
            // Never in `seen`: `see` below puts it there.
            seen: u64::MAX,
        });
        while reader
            .hours
            .front()
            .is_some_and(|hour| !live_at(origin, hour, now))
        {
            reader.hours.pop_front();
        }
        let bytes = bytes as u64;
        match reader.hours.back_mut() {
            Some(last) if last.hour == hour => last.bytes = last.bytes.saturating_add(bytes),
            _ => reader.hours.push_back(Hour { hour, bytes }),
        }
        self.see(address);
        Ok(())
    }

    /// Drops every hour that has aged out, and every address left with
    /// none.
    pub fn forget(&mut self, now: Instant) {
        let origin = self.origin;
        let seen = &mut self.seen;
        self.readers.retain(|_, reader| {
            reader.hours.retain(|hour| live_at(origin, hour, now));
            if reader.hours.is_empty() {
                seen.remove(&reader.seen);
            }
            !reader.hours.is_empty()
        });
    }

    pub fn addresses(&self) -> usize {
        self.readers.len()
    }

    /// Marks `address`, if it's counted, as the reader seen last.
    fn see(&mut self, address: IpAddr) {
        if let Some(reader) = self.readers.get_mut(&address) {
            self.seen.remove(&reader.seen);
            reader.seen = self.turn;
            self.seen.insert(self.turn, address);
            self.turn += 1;
        }
    }

    fn hour(&self, now: Instant) -> u64 {
        now.saturating_duration_since(self.origin).as_secs() / HOUR
    }
}

/// When an hour's reading stops counting: the hour's end, and a day.
fn ages_out(origin: Instant, hour: &Hour) -> Instant {
    origin + Duration::from_secs((hour.hour + 1) * HOUR + DAY)
}

fn live_at(origin: Instant, hour: &Hour, now: Instant) -> bool {
    now < ages_out(origin, hour)
}

fn ceil_secs(duration: Duration) -> u64 {
    duration.as_secs() + u64::from(duration.subsec_nanos() > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIB: u64 = 1 << 20;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    fn hours(n: u64) -> Duration {
        Duration::from_secs(n * HOUR)
    }

    #[test]
    fn a_days_reading_is_the_floor_or_eight_pools() {
        let reading = Reading::DEFAULT;
        // Mainnet's 64 MiB pool, preprod's 8 MiB.
        assert_eq!(reading.budget(64 << 20), 512 * MIB);
        assert_eq!(reading.budget(8 << 20), 256 * MIB);
        // The pools as they are (`super::super::POOLS`).
        for pool in &crate::messaging::POOLS {
            let budget = reading.budget(pool.cap);
            assert!(budget >= 256 * MIB && budget >= 8 * pool.cap as u64);
        }
        let other = Reading {
            floor: 10 * MIB,
            pools: 0,
        };
        assert_eq!(other.budget(64 << 20), 10 * MIB);
    }

    #[test]
    fn an_address_reads_its_budget_and_one_page_past_it() {
        let start = Instant::now();
        let mut reads = Reads::new(1000, start);
        let me = ip("203.0.113.7");
        assert_eq!(reads.wait(me, start), None);
        assert_eq!(reads.take(me, 600, start), Ok(()));
        // 600 of 1,000: the next page goes, whatever its size...
        assert_eq!(reads.wait(me, start), None);
        assert_eq!(reads.take(me, 600, start), Ok(()));
        // ...and at 1,200 nothing more does, not even an empty page.
        assert!(reads.wait(me, start).is_some());
        assert!(reads.take(me, 16, start).is_err());
        // Another address has its own day.
        assert_eq!(reads.wait(ip("203.0.113.8"), start), None);
        // Exactly the budget is spent too.
        let mut reads = Reads::new(1000, start);
        reads.take(me, 1000, start).unwrap();
        assert!(reads.wait(me, start).is_some());
    }

    #[test]
    fn a_refusal_says_when_enough_of_the_oldest_hours_age_out() {
        let start = Instant::now();
        let mut reads = Reads::new(1000, start);
        let me = ip("203.0.113.7");
        // 300 in hour 0, 800 in hour 2: past the budget by 100.
        reads
            .take(me, 300, start + Duration::from_secs(1800))
            .unwrap();
        reads.take(me, 800, start + hours(2)).unwrap();
        // At 3 h, hour 0's reading counts until 1 h + 24 h: 22 hours on.
        let now = start + hours(3);
        assert_eq!(reads.wait(me, now), Some(22 * HOUR));
        // A second before, still refused; then it reads again.
        let then = now + hours(22);
        assert!(reads.wait(me, then - Duration::from_secs(1)).is_some());
        assert_eq!(reads.wait(me, then), None);
        // Hour 2's 800 still count: 300 more is past the budget again, and
        // the wait is for hour 2's, at 3 h + 24 h.
        reads.take(me, 300, then).unwrap();
        assert_eq!(reads.wait(me, then), Some(2 * HOUR));
        // All in one hour: at most 25 hours, and part of a second counts as
        // one.
        let mut reads = Reads::new(1000, start);
        let now = start + Duration::from_millis(1500);
        reads.take(me, 1000, now).unwrap();
        assert_eq!(reads.wait(me, now), Some(DAY + HOUR - 1));
        assert_eq!(reads.wait(me, start), Some(DAY + HOUR));
    }

    #[test]
    fn hours_age_out_and_an_address_goes_with_its_last() {
        let start = Instant::now();
        let mut reads = Reads::new(1000, start);
        let (me, other) = (ip("203.0.113.7"), ip("203.0.113.8"));
        reads.take(me, 100, start).unwrap();
        reads.take(me, 100, start + hours(5)).unwrap();
        reads.take(other, 100, start + hours(5)).unwrap();
        // Each hour is one bucket.
        reads
            .take(me, 100, start + hours(5) + Duration::from_secs(10))
            .unwrap();
        assert_eq!(reads.readers[&me].hours.len(), 2);
        assert_eq!(reads.readers[&me].hours[1].bytes, 200);
        // Hour 0's lasts until 25 hours, not a second less.
        reads.forget(start + hours(25) - Duration::from_secs(1));
        assert_eq!(reads.readers[&me].hours.len(), 2);
        reads.forget(start + hours(25));
        assert_eq!(reads.readers[&me].hours.len(), 1);
        assert_eq!((reads.addresses(), reads.seen.len()), (2, 2));
        // Hour 5's go at 30 hours, and both addresses with them.
        reads.forget(start + hours(30));
        assert_eq!((reads.addresses(), reads.seen.len()), (0, 0));
        assert_eq!(reads.wait(me, start + hours(30)), None);
    }

    #[test]
    fn a_full_table_drops_the_reader_seen_least_recently_and_refuses_none() {
        let start = Instant::now();
        let mut reads = Reads::with_room(1000, 3, start);
        let reader = |i: u8| IpAddr::from([203, 0, 113, i]);
        for i in 1..=3 {
            reads.take(reader(i), 1000, start).unwrap();
        }
        // The first asks again and is refused: seen, so no longer the least
        // recent.
        assert!(reads.wait(reader(1), start).is_some());
        // A fourth reader is never refused: the second, seen least
        // recently, makes room.
        assert_eq!(reads.take(reader(4), 10, start), Ok(()));
        assert_eq!((reads.addresses(), reads.seen.len()), (3, 3));
        assert!(reads.wait(reader(1), start).is_some());
        assert!(reads.wait(reader(3), start).is_some());
        // The one that went starts its day again.
        assert_eq!(reads.wait(reader(2), start), None);
        // And so on, however many come: the table never passes its bound.
        for i in 5..=200 {
            assert_eq!(reads.take(reader(i), 10, start), Ok(()));
        }
        assert_eq!((reads.addresses(), reads.seen.len()), (3, 3));
    }

    #[test]
    fn the_table_holds_as_many_addresses_as_the_posts_tables() {
        let start = Instant::now();
        let mut reads = Reads::new(1000, start);
        for i in 0..MAX_ADDRESSES as u32 + 10 {
            reads
                .take(IpAddr::from(i.to_be_bytes()), 16, start)
                .unwrap();
        }
        assert_eq!(reads.addresses(), MAX_ADDRESSES);
        assert_eq!(reads.seen.len(), MAX_ADDRESSES);
        // The first ten went, the rest are counted.
        assert!(
            !reads
                .readers
                .contains_key(&IpAddr::from(9u32.to_be_bytes()))
        );
        assert!(
            reads
                .readers
                .contains_key(&IpAddr::from(10u32.to_be_bytes()))
        );
    }
}
