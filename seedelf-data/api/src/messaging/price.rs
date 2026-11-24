//! What a post costs (docs/protocol.md §10 and §17): proof of work, priced
//! by traffic. A light base, which rises with what the sending address has
//! posted lately, and with what everyone has, to a ceiling past which a post
//! is refused rather than priced.
//!
//! **What's counted:** units (`units`): an envelope of 512 or 2,048 bytes
//! is 1, so a short message padded to 2 KiB costs what a short one does;
//! 8,192 bytes are 16 and 32,768 are 64. They decay by half every
//! `half_life`. One count per address (the relay's key,
//! `super::address_key`: an IPv6 address by its /56), one for everyone.
//! Kept posts are counted in both; a post refused at its points in its
//! address's alone (`Counts::count_refused`).
//! They live in memory only, an address's while its count is above a
//! hundredth of a unit, and nothing logs them.

use std::collections::HashMap;
use std::net::IpAddr;
use std::time::{Duration, Instant};

/// At most this many addresses are counted at once. Past it, the decayed
/// ones are dropped (at most once a second); if none are, a new address's
/// post is refused for a minute.
const MAX_ADDRESSES: usize = 200_000;

/// A count below this is gone.
const FORGOTTEN: f64 = 0.01;

/// The numbers a pool prices by.
#[derive(Debug, Clone, Copy)]
pub struct Prices {
    /// The bits a lone short post costs.
    pub base: u32,
    /// An address's recent units for each bit more.
    pub per_bit: f64,
    /// Everyone's recent units before the floor rises: a bit more for every
    /// doubling past it.
    pub quiet: f64,
    /// The most bits asked. A post that would cost more is refused.
    pub ceiling: u32,
    /// The counts halve this often.
    pub half_life: Duration,
}

/// What a post is asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Asked {
    /// Proof of work of at least this many bits.
    Bits(u32),
    /// Nothing: try again in this many seconds.
    Refused(u64),
}

/// An envelope's units in the price (the 1.10.0 gate's O7): 1 for 512 and
/// 2,048 bytes, 16 for 8,192 and 64 for 32,768. Padding short chat to 2 KiB
/// costs nothing more, and long posts cost what they did. The window
/// counts its own, 512 bytes each (`super::window::units`).
pub fn units(size: usize) -> f64 {
    if size <= 2048 {
        1.0
    } else {
        (size / 512) as f64
    }
}

#[derive(Clone, Copy)]
struct Count {
    units: f64,
    at: Instant,
}

impl Count {
    fn at(&self, now: Instant, half_life: Duration) -> f64 {
        let elapsed = now.saturating_duration_since(self.at).as_secs_f64();
        self.units * 0.5f64.powf(elapsed / half_life.as_secs_f64())
    }
}

pub struct Counts {
    prices: Prices,
    addresses: HashMap<IpAddr, Count>,
    everyone: Count,
    /// When the addresses were last cleared because there were too many.
    swept: Option<Instant>,
}

impl Counts {
    pub fn new(prices: Prices, now: Instant) -> Self {
        Counts {
            prices,
            addresses: HashMap::new(),
            everyone: Count {
                units: 0.0,
                at: now,
            },
            swept: None,
        }
    }

    pub fn prices(&self) -> Prices {
        self.prices
    }

    /// What a post of `size` bytes from `address` (its key: see the module)
    /// is asked for now, its own units counted.
    pub fn ask(&self, address: IpAddr, size: usize, now: Instant) -> Asked {
        let mine = self.mine(address, now);
        let everyone = self.everyone.at(now, self.prices.half_life);
        let bits = self.bits(mine, everyone, units(size));
        if bits <= self.prices.ceiling {
            return Asked::Bits(bits);
        }
        Asked::Refused(self.wait(mine, everyone, units(size)))
    }

    /// Counts a post that was kept.
    pub fn record(&mut self, address: IpAddr, size: usize, now: Instant) {
        let half_life = self.prices.half_life;
        let added = units(size);
        self.everyone = Count {
            units: self.everyone.at(now, half_life) + added,
            at: now,
        };
        let mine = self.mine(address, now);
        self.addresses.insert(
            address,
            Count {
                units: mine + added,
                at: now,
            },
        );
    }

    /// Counts a post refused at its points against its address alone (the
    /// 1.10.0 gate's FI-10): its next post costs more, so one solved stamp
    /// pays for only so many point checks, while everyone's count, which
    /// sets the floor every sender pays, is left as it was. A new address
    /// isn't counted while the table is full.
    pub fn count_refused(&mut self, address: IpAddr, size: usize, now: Instant) {
        if !self.addresses.contains_key(&address) && self.addresses.len() >= MAX_ADDRESSES {
            return;
        }
        let units = self.mine(address, now) + units(size);
        self.addresses.insert(address, Count { units, at: now });
    }

    /// Whether the address's own units alone, the floor aside, would refuse
    /// a post of `size` now: which of the two a refusal names (the 1.10.0
    /// gate's FI-11).
    pub fn refused_by_own(&self, address: IpAddr, size: usize, now: Instant) -> bool {
        let own = ((self.mine(address, now) + units(size)) / self.prices.per_bit).floor();
        f64::from(self.prices.base) + own > f64::from(self.prices.ceiling)
    }

    /// Whether `address` can be counted: one more address is room for, or
    /// it's counted already. Drops the decayed when there isn't room.
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

    /// Drops every address whose count has decayed away.
    pub fn forget(&mut self, now: Instant) {
        let half_life = self.prices.half_life;
        self.addresses
            .retain(|_, count| count.at(now, half_life) >= FORGOTTEN);
    }

    pub fn addresses(&self) -> usize {
        self.addresses.len()
    }

    fn mine(&self, address: IpAddr, now: Instant) -> f64 {
        self.addresses
            .get(&address)
            .map_or(0.0, |count| count.at(now, self.prices.half_life))
    }

    /// base + one bit for every `per_bit` of the address's units, this
    /// post's included, + the floor: one bit for every doubling of
    /// everyone's units past `quiet`.
    fn bits(&self, mine: f64, everyone: f64, added: f64) -> u32 {
        let Prices {
            base,
            per_bit,
            quiet,
            ..
        } = self.prices;
        let own = ((mine + added) / per_bit).floor();
        let all = everyone + added;
        let floor = if all < quiet {
            0.0
        } else {
            (all / quiet).log2().floor() + 1.0
        };
        // Both are small, whole and at least 0; the sum is capped well
        // past any ceiling.
        base.saturating_add((own + floor).min(1024.0) as u32)
    }

    /// Seconds until the counts have decayed enough for this post, if no
    /// other comes meanwhile: in 15 s steps, at most an hour.
    fn wait(&self, mine: f64, everyone: f64, added: f64) -> u64 {
        let half_life = self.prices.half_life.as_secs_f64();
        (1..=240u64)
            .map(|step| step * 15)
            .find(|&secs| {
                let left = 0.5f64.powf(secs as f64 / half_life);
                self.bits(mine * left, everyone * left, added) <= self.prices.ceiling
            })
            .unwrap_or(3600)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRICES: Prices = Prices {
        base: 18,
        per_bit: 32.0,
        quiet: 1000.0,
        ceiling: 24,
        half_life: Duration::from_secs(600),
    };

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn a_lone_short_post_costs_the_base_and_size_counts() {
        let now = Instant::now();
        let counts = Counts::new(PRICES, now);
        let me = ip("203.0.113.7");
        assert_eq!(counts.ask(me, 512, now), Asked::Bits(18));
        assert_eq!(counts.ask(me, 2048, now), Asked::Bits(18));
        assert_eq!(counts.ask(me, 8192, now), Asked::Bits(18));
        // 32 KiB is 64 units: two bits.
        assert_eq!(counts.ask(me, 32768, now), Asked::Bits(20));
    }

    /// The 1.10.0 gate's O7: 2 KiB counts as 512 bytes, so a chat padded to
    /// 2 KiB meets the address's price as fast as short chat did, and
    /// longer posts count as before.
    #[test]
    fn a_2_kib_post_counts_as_a_short_one() {
        assert_eq!([512, 2048, 8192, 32768].map(units), [1.0, 1.0, 16.0, 64.0]);
        let now = Instant::now();
        let me = ip("203.0.113.7");
        let burst = |size: usize| {
            let mut counts = Counts::new(PRICES, now);
            let mut kept = 0;
            while let Asked::Bits(_) = counts.ask(me, size, now) {
                counts.record(me, size, now);
                kept += 1;
            }
            kept
        };
        assert_eq!(burst(2048), burst(512));
        assert_eq!(burst(512), 223);
        assert_eq!(burst(8192), 13);
        assert_eq!(burst(32768), 3);
    }

    /// The 1.10.0 gate's FI-10: a post refused at its points raises its own
    /// address's price, and nobody else's: the floor stays where it was.
    #[test]
    fn a_post_refused_at_its_points_counts_against_its_address_alone() {
        let now = Instant::now();
        let mut counts = Counts::new(PRICES, now);
        let me = ip("203.0.113.7");
        let stranger = ip("198.51.100.1");
        // Thousands of them, from many addresses: past `quiet` many times.
        for i in 0..5000u32 {
            counts.count_refused(IpAddr::from(i.to_be_bytes()), 512, now);
        }
        let sizes = [512, 2048, 8192, 32768];
        assert_eq!(
            sizes.map(|size| counts.ask(stranger, size, now)),
            [
                Asked::Bits(18),
                Asked::Bits(18),
                Asked::Bits(18),
                Asked::Bits(20)
            ]
        );
        // The address's own: a bit more for each 32.
        for _ in 0..32 {
            counts.count_refused(me, 512, now);
        }
        assert_eq!(counts.ask(me, 512, now), Asked::Bits(19));
        assert_eq!(counts.addresses(), 5001);
    }

    /// The 1.10.0 gate's FI-11: a refusal says whether the address's own
    /// count would refuse it, or only everyone's floor.
    #[test]
    fn a_refusal_knows_whether_the_address_alone_would_be_refused() {
        let now = Instant::now();
        let mut counts = Counts::new(PRICES, now);
        let me = ip("203.0.113.7");
        for _ in 0..223 {
            counts.record(me, 512, now);
        }
        assert!(matches!(counts.ask(me, 512, now), Asked::Refused(_)));
        assert!(counts.refused_by_own(me, 512, now));
        // Everyone's floor alone: a fresh address, refused, by no count of its own.
        let mut busy = Counts::new(PRICES, now);
        busy.everyone = Count {
            units: 1000.0 * 64.0,
            at: now,
        };
        let fresh = ip("198.51.100.1");
        assert!(matches!(busy.ask(fresh, 512, now), Asked::Refused(_)));
        assert!(!busy.refused_by_own(fresh, 512, now));
    }

    #[test]
    fn an_address_pays_more_for_each_burst_then_is_refused() {
        let now = Instant::now();
        let mut counts = Counts::new(PRICES, now);
        let me = ip("203.0.113.7");
        let mut asked = vec![];
        for _ in 0..240 {
            let price = counts.ask(me, 512, now);
            asked.push(price);
            if let Asked::Bits(_) = price {
                counts.record(me, 512, now);
            }
        }
        // 31 posts at the base, then a bit more for each 32, to the ceiling.
        assert_eq!(asked[0], Asked::Bits(18));
        assert_eq!(asked[30], Asked::Bits(18));
        assert_eq!(asked[31], Asked::Bits(19));
        assert_eq!(asked[222], Asked::Bits(24));
        assert!(matches!(asked[223], Asked::Refused(_)));
        // Another address pays the base.
        assert_eq!(counts.ask(ip("203.0.113.8"), 512, now), Asked::Bits(18));
    }

    #[test]
    fn a_refusal_says_how_long_and_the_price_decays() {
        let now = Instant::now();
        let mut counts = Counts::new(PRICES, now);
        let me = ip("203.0.113.7");
        for _ in 0..223 {
            counts.record(me, 512, now);
        }
        let Asked::Refused(secs) = counts.ask(me, 512, now) else {
            panic!("refused")
        };
        // 224 units to below 224: a moment; to the base, about 10 half-lives.
        assert_eq!(secs, 15);
        assert!(matches!(
            counts.ask(me, 512, now + Duration::from_secs(secs)),
            Asked::Bits(24)
        ));
        assert_eq!(
            counts.ask(me, 512, now + Duration::from_secs(600 * 10)),
            Asked::Bits(18)
        );
    }

    #[test]
    fn an_ipv6_allocation_is_counted_by_its_56_by_the_caller() {
        // The relay keys every count with its own key: one /56, one count.
        let now = Instant::now();
        let mut counts = Counts::new(PRICES, now);
        let key = crate::messaging::address_key(ip("2001:db8:1:200::1"));
        for _ in 0..64 {
            counts.record(key, 512, now);
        }
        let neighbour = crate::messaging::address_key(ip("2001:db8:1:2ff:ffff::9"));
        assert_eq!(counts.ask(neighbour, 512, now), Asked::Bits(20));
        let other = crate::messaging::address_key(ip("2001:db8:1:300::1"));
        assert_eq!(counts.ask(other, 512, now), Asked::Bits(18));
    }

    #[test]
    fn many_addresses_raise_the_floor_for_everyone() {
        let now = Instant::now();
        let mut counts = Counts::new(PRICES, now);
        // 999 units from 999 addresses: quiet.
        for i in 0..999u32 {
            counts.record(IpAddr::from(i.to_be_bytes()), 512, now);
        }
        let stranger = ip("198.51.100.1");
        assert_eq!(counts.ask(stranger, 512, now), Asked::Bits(19));
        for i in 999..1999u32 {
            counts.record(IpAddr::from(i.to_be_bytes()), 512, now);
        }
        // 2,000 units: two doublings' worth past nothing, so two bits.
        assert_eq!(counts.ask(stranger, 512, now), Asked::Bits(20));
        // A day later the floor is gone.
        assert_eq!(
            counts.ask(stranger, 512, now + Duration::from_secs(86_400)),
            Asked::Bits(18)
        );
    }

    #[test]
    fn decayed_addresses_are_forgotten() {
        let now = Instant::now();
        let mut counts = Counts::new(PRICES, now);
        counts.record(ip("203.0.113.7"), 512, now);
        counts.forget(now + Duration::from_secs(600 * 6));
        assert_eq!(counts.addresses(), 1);
        counts.forget(now + Duration::from_secs(600 * 7));
        assert_eq!(counts.addresses(), 0);
    }

    #[test]
    fn a_full_table_drops_the_decayed_then_refuses() {
        let now = Instant::now();
        let mut counts = Counts::new(PRICES, now);
        for i in 0..MAX_ADDRESSES as u32 {
            counts.addresses.insert(
                IpAddr::from(i.to_be_bytes()),
                Count {
                    units: 1.0,
                    at: now,
                },
            );
        }
        let new = ip("2001:db8::1");
        assert!(counts.room_for(ip("0.0.0.1"), now));
        assert!(!counts.room_for(new, now));
        // An hour and a half later every count has decayed away.
        assert!(counts.room_for(new, now + Duration::from_secs(5400)));
    }
}
