//! Where a chain's transactions land, simulated: a Monte Carlo of the wallet
//! sending a Lovejoin chain into a mempool that blocks of each kind drain.
//!
//! The rules are CIP-164's (Linear Leios), as Musashi runs them:
//! - A slot has an RB with chance f (0.05: one every 20 s on average).
//! - An RB carries either transactions or the certificate of the EB the RB
//!   before it announced, never both. It certifies only when it comes at
//!   least 14 slots after that RB (3·L_hdr + L_vote + L_diff), and the vote
//!   reached its quorum.
//! - Every RB may announce an EB of what's left in the mempool after its own
//!   transactions. An EB's transactions are checked against the ledger after
//!   the RB that announced it, so a chain may run from an RB into its EB, and
//!   through an EB in order.
//! - An EB that isn't certified is dropped, and its transactions stay in the
//!   mempool, still valid, for the next block of either kind (the w43
//!   prototype keeps them: it holds the announced EB as a second view of the
//!   mempool).
//! - A block takes the longest prefix of the mempool that fits it, by bytes
//!   and by steps (a node forges from its mempool in order).
//!
//! The wallet sends a chain as `pumpChain` does: at most `window` of it in
//! flight, looking every 5 s for what's on the ledger before sending more.
//! "On the ledger" is an RB's body or a certified EB, never an announced one.
//!
//! What it leaves out: forks and slot battles, a node's mempool differing
//! from the producer's, and votes failing for any reason but `quorum`.

use crate::limits::{Capacity, Network};
use std::collections::VecDeque;

/// A small, seeded generator (xorshift64*), so a run gives the same numbers
/// twice.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed.max(1))
    }

    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// Uniform in [0, 1).
    pub fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// What a run is made of.
#[derive(Debug, Clone)]
pub struct Scenario {
    pub network: Network,
    /// What the node's mempool holds: two blocks of each kind (Musashi's
    /// answers 4,178,176 bytes, `query tx-mempool info`, 2026-10-28).
    pub mempool: Capacity,
    /// Everyone else's transactions, in bytes a second, each `load_tx_bytes`
    /// long and running no script.
    pub load_bytes_per_s: f64,
    pub load_tx_bytes: u64,
    /// The chain, in the order it's sent.
    pub chain: Vec<Capacity>,
    /// The most of it in flight at once: the wallet's 4 today.
    pub window: usize,
    /// How often the wallet looks at the ledger, in seconds.
    pub look_s: u64,
    /// The chance an EB's vote reaches its quorum, on time.
    pub quorum: f64,
}

/// Where one run's chain went.
#[derive(Debug, Clone, Default)]
pub struct Outcome {
    /// Seconds from its first send until its last transaction is on the
    /// ledger; None if it wasn't within the horizon.
    pub seconds: Option<u64>,
    pub in_rb: usize,
    pub in_eb: usize,
    /// Of the chain's transactions, how many sat in an EB that was dropped.
    pub in_dropped_eb: usize,
    /// The RBs from its first send to its end.
    pub rbs: usize,
    /// A line per block that carried any of it, when asked for.
    pub trace: Vec<String>,
}

#[derive(Debug, Clone, Copy)]
struct Tx {
    bytes: u64,
    steps: u64,
    mem: u64,
    /// Its place in our chain, if it's ours.
    ours: Option<usize>,
}

#[derive(Debug, Clone, Copy, Default)]
struct Used {
    bytes: u64,
    steps: u64,
    mem: u64,
}

impl Used {
    fn add(&mut self, tx: &Tx) {
        self.bytes += tx.bytes;
        self.steps += tx.steps;
        self.mem += tx.mem;
    }

    fn fits(&self, tx: &Tx, room: Capacity) -> bool {
        self.bytes + tx.bytes <= room.bytes && self.steps + tx.steps <= room.steps && self.mem + tx.mem <= room.mem
    }
}

/// How many from the front of `pool` (after its first `skip`) fit `room`.
fn prefix(pool: &VecDeque<Tx>, skip: usize, room: Capacity) -> usize {
    let mut used = Used::default();
    let mut n = 0;
    for tx in pool.iter().skip(skip) {
        if !used.fits(tx, room) {
            break;
        }
        used.add(tx);
        n += 1;
    }
    n
}

const WARM_UP_S: u64 = 900;
const HORIZON_S: u64 = 4 * 3600;

/// One run: everyone's load alone for a while, then the chain sent into it.
pub fn run(s: &Scenario, rng: &mut Rng, traced: bool) -> Outcome {
    let mut pool: VecDeque<Tx> = VecDeque::new();
    let mut held = Used::default();
    let mut out = Outcome::default();
    // The EB announced by the last RB: when, and how many from the front.
    let mut announced: Option<(u64, usize)> = None;
    let mut load_due = 0.0;
    let gap = s.network.eb.map(|eb| eb.certify_gap_slots(s.network.slot_ms));
    let mut sent = 0;
    let mut landed = vec![false; s.chain.len()];
    let mut seen = 0;
    let start = WARM_UP_S;
    let name = |i: usize| if i == 0 { "deposit".to_string() } else { format!("mix {i}") };

    for t in 0..start + HORIZON_S {
        // Everyone else's transactions, refused once the mempool is full.
        if s.load_bytes_per_s > 0.0 {
            load_due += s.load_bytes_per_s / s.load_tx_bytes as f64;
            while load_due >= 1.0 {
                load_due -= 1.0;
                let tx = Tx {
                    bytes: s.load_tx_bytes,
                    steps: 0,
                    mem: 0,
                    ours: None,
                };
                if held.fits(&tx, s.mempool) {
                    held.add(&tx);
                    pool.push_back(tx);
                }
            }
        }
        // The wallet: looks every few seconds, and sends what its window
        // allows, as soon as the mempool takes it.
        if t >= start {
            if (t - start) % s.look_s == 0 {
                seen = landed.iter().filter(|l| **l).count();
            }
            while sent < s.chain.len() && sent - seen < s.window {
                let c = s.chain[sent];
                let tx = Tx {
                    bytes: c.bytes,
                    steps: c.steps,
                    mem: c.mem,
                    ours: Some(sent),
                };
                if !held.fits(&tx, s.mempool) {
                    break;
                }
                held.add(&tx);
                pool.push_back(tx);
                sent += 1;
            }
        }
        if rng.unit() >= s.network.active_slots {
            continue;
        }
        // An RB.
        if t >= start {
            out.rbs += 1;
        }
        let mut lines = Vec::new();
        let certifies = match (announced, gap) {
            (Some((at, _)), Some(gap)) => t - at >= gap && rng.unit() < s.quorum,
            _ => false,
        };
        let mut take = |n: usize, via_eb: bool, pool: &mut VecDeque<Tx>, held: &mut Used, out: &mut Outcome, lines: &mut Vec<String>| {
            let mut ours = Vec::new();
            for _ in 0..n {
                let tx = pool.pop_front().expect("counted");
                held.bytes -= tx.bytes;
                held.steps -= tx.steps;
                held.mem -= tx.mem;
                if let Some(i) = tx.ours {
                    landed[i] = true;
                    if via_eb {
                        out.in_eb += 1;
                    } else {
                        out.in_rb += 1;
                    }
                    ours.push(name(i));
                }
            }
            if !ours.is_empty() {
                lines.push(format!("{} {}", if via_eb { "certified EB:" } else { "in the RB:" }, ours.join(", ")));
            }
        };
        if certifies {
            let (_, n) = announced.take().expect("certifies");
            take(n, true, &mut pool, &mut held, &mut out, &mut lines);
        } else {
            if let Some((_, n)) = announced.take() {
                let dropped = pool.iter().take(n).filter(|tx| tx.ours.is_some()).count();
                out.in_dropped_eb += dropped;
                if dropped > 0 {
                    lines.push(format!("EB dropped ({dropped} of ours back to the mempool)"));
                }
            }
            let n = prefix(&pool, 0, s.network.rb);
            take(n, false, &mut pool, &mut held, &mut out, &mut lines);
        }
        if let Some(eb) = s.network.eb {
            let n = prefix(&pool, 0, eb.txs);
            if n > 0 {
                let ours: Vec<String> = pool.iter().take(n).filter_map(|tx| tx.ours.map(name)).collect();
                if !ours.is_empty() {
                    lines.push(format!("announces an EB with {}", ours.join(", ")));
                }
                announced = Some((t, n));
            }
        }
        if traced && t >= start && !lines.is_empty() {
            out.trace.push(format!(
                "t+{:>4}s RB{}: {}",
                t - start,
                if certifies { " (certifying)" } else { "" },
                lines.join("; ")
            ));
        }
        if t >= start && landed.iter().all(|l| *l) {
            out.seconds = Some(t - start);
            return out;
        }
    }
    out
}

/// Many runs of one scenario, summed up.
#[derive(Debug, Clone)]
pub struct Summary {
    pub runs: usize,
    pub finished: usize,
    pub mean_s: f64,
    pub p50_s: u64,
    pub p90_s: u64,
    pub mean_in_eb: f64,
    pub mean_in_rb: f64,
    pub mean_in_dropped_eb: f64,
    pub mean_rbs: f64,
}

pub fn many(s: &Scenario, runs: usize, seed: u64) -> Summary {
    let mut rng = Rng::new(seed);
    let outcomes: Vec<Outcome> = (0..runs).map(|_| run(s, &mut rng, false)).collect();
    let mut times: Vec<u64> = outcomes.iter().filter_map(|o| o.seconds).collect();
    times.sort_unstable();
    let finished = times.len();
    let pct = |p: f64| times.get(((finished as f64 * p) as usize).min(finished.saturating_sub(1))).copied().unwrap_or(0);
    let mean = |f: &dyn Fn(&Outcome) -> f64| outcomes.iter().map(f).sum::<f64>() / runs as f64;
    Summary {
        runs,
        finished,
        mean_s: if finished > 0 { times.iter().sum::<u64>() as f64 / finished as f64 } else { f64::NAN },
        p50_s: pct(0.5),
        p90_s: pct(0.9),
        mean_in_eb: mean(&|o| o.in_eb as f64),
        mean_in_rb: mean(&|o| o.in_rb as f64),
        mean_in_dropped_eb: mean(&|o| o.in_dropped_eb as f64),
        mean_rbs: mean(&|o| o.rbs as f64),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::limits;

    fn mix(steps: u64) -> Capacity {
        Capacity {
            bytes: 4_000,
            mem: 1_900_000,
            steps,
            ref_script_bytes: 0,
        }
    }

    fn scenario(network: Network, chain: Vec<Capacity>, window: usize) -> Scenario {
        Scenario {
            network,
            mempool: Capacity {
                bytes: 4_178_176,
                mem: u64::MAX,
                steps: u64::MAX,
                ref_script_bytes: u64::MAX,
            },
            load_bytes_per_s: 0.0,
            load_tx_bytes: 500,
            chain,
            window,
            look_s: 5,
            quorum: 1.0,
        }
    }

    /// On an idle Praos chain, two 4-box mixes go a block: five take three.
    #[test]
    fn praos_takes_two_four_box_mixes_a_block() {
        let s = scenario(limits::mainnet(), vec![mix(9_882_068_838); 5], usize::MAX);
        let o = many(&s, 200, 7);
        assert_eq!(o.finished, 200);
        assert_eq!(o.mean_in_eb, 0.0);
        assert!((o.mean_rbs - 3.0).abs() < 1e-9, "{}", o.mean_rbs);
    }

    /// On Musashi, what an RB can't take goes in its EB, certified or carried
    /// by the next RB: never more blocks than Praos, often fewer.
    #[test]
    fn musashi_never_takes_more_blocks_than_praos() {
        let s = scenario(limits::musashi().unwrap(), vec![mix(9_882_068_838); 5], usize::MAX);
        let o = many(&s, 500, 7);
        assert_eq!(o.finished, 500);
        assert!(o.mean_rbs <= 3.0 && o.mean_rbs >= 2.0, "{}", o.mean_rbs);
        assert!(o.mean_in_eb > 0.0);
    }
}
