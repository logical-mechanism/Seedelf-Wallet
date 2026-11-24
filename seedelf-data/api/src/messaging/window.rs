//! What one address may have in a pool (docs/protocol.md §17.4): the posts
//! the pool kept from it over its 36 hours, as envelopes and as units, in
//! hourly buckets. A post that would take an address past its pool's
//! `Limits` is refused, whatever work it carries, until enough of its
//! oldest buckets age out. The price slows a sender; this bounds what one
//! sender can make every reader download and scan.
//!
//! **Counts, never envelopes:** an address's entry is how many envelopes
//! and units the pool kept from it in each hour, nothing of which ones.
//! They live in memory only: never in the pool's snapshot, so a restart
//! starts them empty, and nothing logs them. A bucket goes once everything
//! posted in its hour has expired from the pool, an address with its last
//! bucket. The address is the relay's key (`super::address_key`).

use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;
use std::time::{Duration, Instant};

use super::pool::KEPT_FOR;

/// At most this many addresses are counted at once, as the prices count
/// (price.rs). Past it, the aged-out ones are dropped (at most once a
/// second); if none are, a new address's post is refused for a minute.
const MAX_ADDRESSES: usize = 200_000;

/// A bucket's hour.
const HOUR: u64 = 3600;

/// The most one address may have kept in a pool over its 36 hours.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// Envelopes, whatever their size: each costs every reader a trial scan.
    pub envelopes: u32,
    /// Units of 512 bytes (`units`): each costs every reader bytes.
    pub units: u32,
}

/// An envelope's units in the window: its size in 512 bytes, 1 to 64,
/// whatever the price counts (`super::price::units`).
pub fn units(size: usize) -> u32 {
    (size / 512).max(1) as u32
}

/// What the pool kept from an address in one hour.
#[derive(Debug, Clone, Copy)]
struct Bucket {
    /// Hours since the window began.
    hour: u64,
    envelopes: u32,
    units: u32,
}

pub struct Window {
    limits: Limits,
    /// Hour 0's start.
    origin: Instant,
    addresses: HashMap<IpAddr, VecDeque<Bucket>>,
    /// When the addresses were last cleared because there were too many.
    swept: Option<Instant>,
}

impl Window {
    pub fn new(limits: Limits, now: Instant) -> Self {
        Window {
            limits,
            origin: now,
            addresses: HashMap::new(),
            swept: None,
        }
    }

    /// Whether a post of `size` bytes from `address` fits what it has in
    /// the window: `None` when it does, else the seconds until enough of its
    /// oldest buckets have aged out, if it posts nothing meanwhile. At most
    /// 37 hours: the window's 36 and the hour a bucket spans.
    pub fn wait(&self, address: IpAddr, size: usize, now: Instant) -> Option<u64> {
        let added = units(size);
        let live: Vec<&Bucket> = self
            .addresses
            .get(&address)
            .into_iter()
            .flatten()
            .filter(|bucket| self.live(bucket, now))
            .collect();
        let mut envelopes: u32 = live.iter().map(|b| b.envelopes).sum();
        let mut held: u32 = live.iter().map(|b| b.units).sum();
        if self.fits(envelopes, held, added) {
            return None;
        }
        for bucket in live {
            envelopes -= bucket.envelopes;
            held -= bucket.units;
            if self.fits(envelopes, held, added) {
                let gone = self.ages_out(bucket).saturating_duration_since(now);
                return Some(ceil_secs(gone).clamp(1, KEPT_FOR as u64 + HOUR));
            }
        }
        // Limits below a single post: never, so the most there is.
        Some(KEPT_FOR as u64 + HOUR)
    }

    /// Counts a post the pool kept.
    pub fn record(&mut self, address: IpAddr, size: usize, now: Instant) {
        let hour = self.hour(now);
        let added = units(size);
        let (origin, buckets) = (self.origin, self.addresses.entry(address).or_default());
        while buckets
            .front()
            .is_some_and(|bucket| !live_at(origin, bucket, now))
        {
            buckets.pop_front();
        }
        match buckets.back_mut() {
            Some(last) if last.hour == hour => {
                last.envelopes = last.envelopes.saturating_add(1);
                last.units = last.units.saturating_add(added);
            }
            _ => buckets.push_back(Bucket {
                hour,
                envelopes: 1,
                units: added,
            }),
        }
    }

    /// Whether `address` can be counted: one more address is room for, or
    /// it's counted already. Drops the aged-out when there isn't room.
    pub fn room_for(&mut self, address: IpAddr, now: Instant) -> bool {
        if self.addresses.contains_key(&address) || self.addresses.len() < MAX_ADDRESSES {
            return true;
        }
        let recently = self
            .swept
            .is_some_and(|at| now.saturating_duration_since(at) < Duration::from_secs(1));
        if !recently {
            self.forget(now);
            self.swept = Some(now);
        }
        self.addresses.len() < MAX_ADDRESSES
    }

    /// Drops every bucket that has aged out, and every address left with
    /// none.
    pub fn forget(&mut self, now: Instant) {
        let origin = self.origin;
        self.addresses.retain(|_, buckets| {
            buckets.retain(|bucket| live_at(origin, bucket, now));
            !buckets.is_empty()
        });
    }

    pub fn addresses(&self) -> usize {
        self.addresses.len()
    }

    fn fits(&self, envelopes: u32, units: u32, added: u32) -> bool {
        envelopes.saturating_add(1) <= self.limits.envelopes
            && units.saturating_add(added) <= self.limits.units
    }

    fn hour(&self, now: Instant) -> u64 {
        now.saturating_duration_since(self.origin).as_secs() / HOUR
    }

    fn live(&self, bucket: &Bucket, now: Instant) -> bool {
        live_at(self.origin, bucket, now)
    }

    fn ages_out(&self, bucket: &Bucket) -> Instant {
        ages_out(self.origin, bucket)
    }
}

/// When everything posted in a bucket's hour has expired from the pool:
/// the hour's end, and 36 hours.
fn ages_out(origin: Instant, bucket: &Bucket) -> Instant {
    origin + Duration::from_secs((bucket.hour + 1) * HOUR + KEPT_FOR as u64)
}

fn live_at(origin: Instant, bucket: &Bucket, now: Instant) -> bool {
    now < ages_out(origin, bucket)
}

fn ceil_secs(duration: Duration) -> u64 {
    duration.as_secs() + u64::from(duration.subsec_nanos() > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIMITS: Limits = Limits {
        envelopes: 1000,
        units: 4096,
    };
    const DAY_AND_A_HALF: u64 = KEPT_FOR as u64;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    fn hours(n: u64) -> Duration {
        Duration::from_secs(n * HOUR)
    }

    #[test]
    fn an_address_keeps_at_most_1000_envelopes() {
        let start = Instant::now();
        let mut window = Window::new(LIMITS, start);
        let me = ip("203.0.113.7");
        for i in 0..1000 {
            assert_eq!(window.wait(me, 512, start), None, "{i}");
            window.record(me, 512, start);
        }
        // 1,000 units: far from 4,096, but the 1,001st envelope is refused,
        // a short one or a long one.
        assert!(window.wait(me, 512, start).is_some());
        assert!(window.wait(me, 2048, start).is_some());
        // Another address is its own.
        assert_eq!(window.wait(ip("203.0.113.8"), 512, start), None);
    }

    #[test]
    fn an_address_keeps_at_most_4096_units() {
        let start = Instant::now();
        let mut window = Window::new(LIMITS, start);
        let me = ip("203.0.113.7");
        // 63 envelopes of 32 KiB: 4,032 units. One more fits exactly.
        for _ in 0..63 {
            window.record(me, 32768, start);
        }
        assert_eq!(window.wait(me, 32768, start), None);
        window.record(me, 32768, start);
        // 4,096 units in 64 envelopes: not even a short one now.
        assert!(window.wait(me, 512, start).is_some());
        // Under the limit by 15 units: a 2 KiB envelope fits, an 8 KiB one
        // doesn't.
        let mut window = Window::new(LIMITS, start);
        for _ in 0..63 {
            window.record(me, 32768, start);
        }
        for _ in 0..3 {
            window.record(me, 8192, start);
        }
        window.record(me, 512, start);
        assert_eq!(window.wait(me, 2048, start), None);
        assert!(window.wait(me, 8192, start).is_some());
    }

    #[test]
    fn a_refusal_says_when_the_oldest_bucket_ages_out() {
        let start = Instant::now();
        let mut window = Window::new(LIMITS, start);
        let me = ip("203.0.113.7");
        // 400 in hour 0, 600 in hour 2.
        for _ in 0..400 {
            window.record(me, 512, start + Duration::from_secs(1800));
        }
        for _ in 0..600 {
            window.record(me, 512, start + hours(2));
        }
        // At 3 h, hour 0's bucket ages out at 1 h + 36 h: 34 hours on.
        let now = start + hours(3);
        assert_eq!(window.wait(me, 512, now), Some(34 * HOUR));
        // A second before, still refused; then the post fits.
        let then = now + hours(34);
        assert!(
            window
                .wait(me, 512, then - Duration::from_secs(1))
                .is_some()
        );
        assert_eq!(window.wait(me, 512, then), None);
        // 4,049 units: a short post fits, and a 32 KiB one needs both
        // buckets gone, so it waits for hour 1's, at 2 h + 36 h.
        let mut window = Window::new(LIMITS, start);
        window.record(me, 512, start);
        for _ in 0..63 {
            window.record(me, 32768, start + hours(1));
        }
        window.record(me, 8192, start + hours(1));
        let now = start + hours(1) + Duration::from_secs(600);
        assert_eq!(window.wait(me, 512, now), None);
        assert_eq!(window.wait(me, 32768, now), Some(37 * HOUR - 600));
        // Filled within one hour, the wait is at most 37 hours, and part
        // of a second counts as one.
        let mut window = Window::new(LIMITS, start);
        let now = start + Duration::from_millis(1500);
        for _ in 0..1000 {
            window.record(me, 512, now);
        }
        assert_eq!(window.wait(me, 512, now), Some(DAY_AND_A_HALF + HOUR - 1));
        assert_eq!(window.wait(me, 512, start), Some(DAY_AND_A_HALF + HOUR));
    }

    #[test]
    fn buckets_age_out_and_an_address_goes_with_its_last() {
        let start = Instant::now();
        let mut window = Window::new(LIMITS, start);
        let me = ip("203.0.113.7");
        window.record(me, 512, start);
        window.record(me, 512, start + hours(5));
        window.record(ip("203.0.113.8"), 512, start + hours(5));
        // Each hour is one bucket, both of its posts counted together.
        window.record(me, 512, start + hours(5) + Duration::from_secs(10));
        assert_eq!(window.addresses[&me].len(), 2);
        assert_eq!(window.addresses[&me][1].envelopes, 2);
        // Hour 0's bucket lasts until 37 hours, not a second less.
        window.forget(start + hours(37) - Duration::from_secs(1));
        assert_eq!(window.addresses[&me].len(), 2);
        window.forget(start + hours(37));
        assert_eq!(window.addresses[&me].len(), 1);
        assert_eq!(window.addresses(), 2);
        // A post drops its address's aged-out buckets as it's counted.
        let mut other = Window::new(LIMITS, start);
        other.record(me, 512, start);
        other.record(me, 512, start + hours(40));
        assert_eq!(other.addresses[&me].len(), 1);
        // Hour 5's go at 42 hours, and both addresses with them.
        window.forget(start + hours(42));
        assert_eq!(window.addresses(), 0);
        assert_eq!(window.wait(me, 512, start + hours(42)), None);
    }

    #[test]
    fn a_full_table_drops_the_aged_out_then_refuses() {
        let start = Instant::now();
        let mut window = Window::new(LIMITS, start);
        for i in 0..MAX_ADDRESSES as u32 {
            window.record(IpAddr::from(i.to_be_bytes()), 512, start);
        }
        let new = ip("2001:db8::1");
        assert!(window.room_for(ip("0.0.0.1"), start));
        assert!(!window.room_for(new, start + hours(37) - Duration::from_millis(500)));
        // Swept at most once a second: not again at 37 hours, when every
        // bucket has aged out, but a moment later.
        assert!(!window.room_for(new, start + hours(37)));
        assert!(window.room_for(new, start + hours(37) + Duration::from_millis(500)));
        assert_eq!(window.addresses(), 0);
    }
}
