//! What a block of each kind may hold and how often blocks come: every
//! capacity figure in the harness is computed from these.
//!
//! - **Mainnet** is Praos: one kind of block, every 20 s on average.
//! - **Musashi** is Linear Leios (CIP-164) as the testnet runs it: a ranking
//!   block (RB) is mainnet's block, and each may announce an endorser block
//!   (EB) that the next RB certifies, if it comes late enough. Its limits now
//!   are what the node answered (`musashi/protocol-parameters.json`, written
//!   by `live params`); its genesis (the 2026-10-18 respin) had EBs of
//!   260,000 bytes, since raised to 2,000,000.
//! - **CIP-164** is the same protocol at the parameters the CIP's own
//!   simulations used (its Table 7): what a mainnet Leios might be set to.

use anyhow::{Context, Result};
use serde_json::Value;

/// What one block (or one transaction) may hold.
#[derive(Debug, Clone, Copy)]
pub struct Capacity {
    pub bytes: u64,
    pub mem: u64,
    pub steps: u64,
    /// Reference scripts' bytes, summed over what's in it.
    pub ref_script_bytes: u64,
}

/// An endorser block: what its transactions may hold, and how long the
/// protocol waits before the next RB may certify it.
#[derive(Debug, Clone, Copy)]
pub struct Endorser {
    pub txs: Capacity,
    /// The EB's own body: a hash and a size for each transaction.
    pub references_bytes: u64,
    pub l_hdr_ms: u64,
    pub l_vote_ms: u64,
    pub l_diff_ms: u64,
}

impl Endorser {
    /// CIP-164's rule: the RB that certifies an EB comes at least
    /// ⌈(3·L_hdr + L_vote + L_diff) / slot⌉ slots after the RB that announced
    /// it. One that comes sooner can't, and the EB is dropped.
    pub fn certify_gap_slots(&self, slot_ms: u64) -> u64 {
        (3 * self.l_hdr_ms + self.l_vote_ms + self.l_diff_ms).div_ceil(slot_ms)
    }
}

/// A network's blocks.
#[derive(Debug, Clone, Copy)]
pub struct Network {
    pub name: &'static str,
    pub slot_ms: u64,
    /// The chance a slot has a block (Praos's active slot coefficient, f).
    pub active_slots: f64,
    pub rb: Capacity,
    pub eb: Option<Endorser>,
    pub tx: Capacity,
    /// The chance an EB the timing allows is certified: that its committee's
    /// votes reach the quorum, and the EB itself got round, in time. 1 for an
    /// ideal network; what Musashi did is [`observed_votes`].
    pub vote_success: f64,
}

impl Network {
    /// The chance an announced EB is certified: that no RB comes in the
    /// gap's first slots, and that its vote succeeds.
    pub fn certified_share(&self) -> f64 {
        match self.eb {
            None => 0.0,
            Some(eb) => self.timing_share(eb) * self.vote_success,
        }
    }

    /// The chance the next RB comes late enough to certify an EB.
    fn timing_share(&self, eb: Endorser) -> f64 {
        (1.0 - self.active_slots).powi(eb.certify_gap_slots(self.slot_ms) as i32 - 1)
    }

    /// Seconds between RBs, on average.
    pub fn rb_seconds(&self) -> f64 {
        self.slot_ms as f64 / 1000.0 / self.active_slots
    }

    /// How many transactions of one kind the chain takes a second when every
    /// block is full of them. A certifying RB carries no transactions (CIP-164:
    /// "no further transactions are allowed in the RB"), so of each RB's
    /// interval, a share `p` gets an EB's worth and the rest an RB's.
    pub fn per_second(&self, one: Capacity) -> f64 {
        let in_rb = fit(self.rb, one) as f64;
        let per_rb = match self.eb {
            None => in_rb,
            Some(eb) => {
                let p = self.certified_share();
                (1.0 - p) * in_rb + p * fit(eb.txs, one) as f64
            }
        };
        per_rb / self.rb_seconds()
    }
}

/// How many of `one` fit in `room`, by whichever limit binds first.
pub fn fit(room: Capacity, one: Capacity) -> u64 {
    let by = |room: u64, one: u64| if one == 0 { u64::MAX } else { room / one };
    by(room.bytes, one.bytes)
        .min(by(room.mem, one.mem))
        .min(by(room.steps, one.steps))
        .min(by(room.ref_script_bytes, one.ref_script_bytes))
}

/// Which limit binds when `room` is filled with `one`.
pub fn binding(room: Capacity, one: Capacity) -> &'static str {
    let n = fit(room, one);
    let by = |room: u64, one: u64| if one == 0 { u64::MAX } else { room / one };
    if by(room.steps, one.steps) == n {
        "steps"
    } else if by(room.bytes, one.bytes) == n {
        "bytes"
    } else if by(room.mem, one.mem) == n {
        "memory"
    } else {
        "reference scripts"
    }
}

const SHELLEY: &str = include_str!("../musashi/shelley-genesis.json");
const ALONZO: &str = include_str!("../musashi/alonzo-genesis.json");
const CONWAY: &str = include_str!("../musashi/conway-genesis.json");
const DIJKSTRA: &str = include_str!("../musashi/dijkstra-genesis.json");
const NOW: &str = include_str!("../musashi/protocol-parameters.json");
const BLOCKS: &str = include_str!("../musashi/blocks-41261-41760.json");

/// The genesis files as bundled.
pub struct Genesis {
    pub shelley: Value,
    pub alonzo: Value,
    pub conway: Value,
    pub dijkstra: Value,
}

pub fn genesis() -> Result<Genesis> {
    Ok(Genesis {
        shelley: serde_json::from_str(SHELLEY)?,
        alonzo: serde_json::from_str(ALONZO)?,
        conway: serde_json::from_str(CONWAY)?,
        dijkstra: serde_json::from_str(DIJKSTRA)?,
    })
}

fn u(v: &Value, path: &[&str]) -> Result<u64> {
    let mut at = v;
    for key in path {
        at = &at[*key];
    }
    at.as_u64().with_context(|| format!("genesis has no {}", path.join(".")))
}

/// Musashi's limits as the node answered them (`live params`), with its
/// slots from the genesis.
pub fn musashi() -> Result<Network> {
    let g = genesis()?;
    let now: Value = serde_json::from_str(NOW)?;
    Ok(Network {
        name: "Musashi (Leios, epoch 43)",
        slot_ms: (g.shelley["slotLength"].as_f64().context("slotLength")? * 1000.0) as u64,
        active_slots: g.shelley["activeSlotsCoeff"].as_f64().context("activeSlotsCoeff")?,
        rb: Capacity {
            bytes: u(&now, &["maxBlockBodySize"])?,
            mem: u(&now, &["maxBlockExecutionUnits", "memory"])?,
            steps: u(&now, &["maxBlockExecutionUnits", "steps"])?,
            ref_script_bytes: u(&now, &["maxRefScriptSizePerBlock"])?,
        },
        eb: Some(Endorser {
            txs: Capacity {
                bytes: u(&now, &["maxEndorserBlockTxsSize"])?,
                mem: u(&now, &["maxEndorserBlockExecutionUnits", "memory"])?,
                steps: u(&now, &["maxEndorserBlockExecutionUnits", "steps"])?,
                ref_script_bytes: u(&now, &["maxRefScriptSizePerEndorserBlock"])?,
            },
            references_bytes: u(&now, &["maxEndorserBlockReferencesSize"])?,
            l_hdr_ms: u(&now, &["leiosAnnouncementPeriodLength"])?,
            l_vote_ms: u(&now, &["leiosVotePeriodLength"])?,
            l_diff_ms: u(&now, &["leiosDiffusionPeriodLength"])?,
        }),
        tx: Capacity {
            bytes: u(&now, &["maxTxSize"])?,
            mem: u(&now, &["maxTxExecutionUnits", "memory"])?,
            steps: u(&now, &["maxTxExecutionUnits", "steps"])?,
            ref_script_bytes: u(&now, &["maxRefScriptSizePerTx"])?,
        },
        vote_success: 1.0,
    })
}

/// Musashi as it ran: its limits now, and the share of EBs the timing allowed
/// that were certified over 500 blocks of IO's load ([`observed_votes`]).
pub fn musashi_observed() -> Result<Network> {
    let (eligible, certified) = observed_votes()?;
    Ok(Network {
        name: "Musashi as observed (blocks 41261-41760)",
        vote_success: certified as f64 / eligible as f64,
        ..musashi()?
    })
}

/// Of the EBs announced in KleioScan's 500 blocks (41261 to 41760, read
/// 2026-10-28 under IO's load): how many the next RB came late enough to
/// certify, and how many it did.
pub fn observed_votes() -> Result<(usize, usize)> {
    let doc: Value = serde_json::from_str(BLOCKS)?;
    let blocks = doc["blocks"].as_array().context("blocks")?;
    let gap = musashi()?.eb.expect("Leios").certify_gap_slots(1000);
    let (mut eligible, mut certified) = (0, 0);
    for pair in blocks.windows(2) {
        let (a, b) = (&pair[0], &pair[1]);
        if a["eb_announcement_size"].is_null() || b["block_no"].as_u64() != a["block_no"].as_u64().map(|n| n + 1) {
            continue;
        }
        if b["slot_no"].as_u64().unwrap_or(0) - a["slot_no"].as_u64().unwrap_or(0) >= gap {
            eligible += 1;
            certified += usize::from(b["has_leios_cert"].as_bool() == Some(true));
        }
    }
    Ok((eligible, certified))
}

/// Musashi at its genesis (the 2026-10-18 respin), before governance raised
/// its EBs' bytes.
pub fn musashi_genesis() -> Result<Network> {
    let g = genesis()?;
    let pp = &g.shelley["protocolParams"];
    let d = &g.dijkstra;
    Ok(Network {
        name: "Musashi at genesis (2026-10-18)",
        slot_ms: (g.shelley["slotLength"].as_f64().context("slotLength")? * 1000.0) as u64,
        active_slots: g.shelley["activeSlotsCoeff"].as_f64().context("activeSlotsCoeff")?,
        rb: Capacity {
            bytes: u(pp, &["maxBlockBodySize"])?,
            mem: u(&g.alonzo, &["maxBlockExUnits", "exUnitsMem"])?,
            steps: u(&g.alonzo, &["maxBlockExUnits", "exUnitsSteps"])?,
            ref_script_bytes: u(d, &["maxRefScriptSizePerBlock"])?,
        },
        eb: Some(Endorser {
            txs: Capacity {
                bytes: u(d, &["maxEndorserBlockTxsSize"])?,
                mem: u(d, &["maxEndorserBlockExecutionUnits", "memory"])?,
                steps: u(d, &["maxEndorserBlockExecutionUnits", "steps"])?,
                ref_script_bytes: u(d, &["maxRefScriptSizePerEndorserBlock"])?,
            },
            references_bytes: u(d, &["maxEndorserBlockReferencesSize"])?,
            l_hdr_ms: u(d, &["leiosAnnouncementPeriodLength"])?,
            l_vote_ms: u(d, &["leiosVotePeriodLength"])?,
            l_diff_ms: u(d, &["leiosDiffusionPeriodLength"])?,
        }),
        tx: Capacity {
            bytes: u(pp, &["maxTxSize"])?,
            mem: u(&g.alonzo, &["maxTxExUnits", "exUnitsMem"])?,
            steps: u(&g.alonzo, &["maxTxExUnits", "exUnitsSteps"])?,
            ref_script_bytes: u(d, &["maxRefScriptSizePerTx"])?,
        },
        vote_success: 1.0,
    })
}

/// Mainnet today (Koios's `epoch_params` for epoch 658, the fixture core's
/// tests read): Praos, no EBs. Its reference-script cap a block is the
/// Conway ledger's fixed 1 MiB, as Musashi's parameter is.
pub fn mainnet() -> Network {
    Network {
        name: "Mainnet (Praos, epoch 658)",
        slot_ms: 1000,
        active_slots: 0.05,
        rb: Capacity {
            bytes: 90_112,
            mem: 72_000_000,
            steps: 20_000_000_000,
            ref_script_bytes: 1_048_576,
        },
        eb: None,
        tx: Capacity {
            bytes: 16_384,
            mem: 16_500_000,
            steps: 10_000_000_000,
            ref_script_bytes: 204_800,
        },
        vote_success: 1.0,
    }
}

/// Leios at CIP-164's simulated parameters (Table 7): 512 kB of references
/// and 12 MB of transactions an EB, 2,000 billion steps and 7,000 million
/// memory units of Plutus, the same 1/4/7 s periods, the RB as mainnet's.
/// Its reference-script cap an EB isn't in the table; Musashi's 1 MiB stands
/// in.
pub fn cip164() -> Network {
    let mainnet = mainnet();
    Network {
        name: "CIP-164 (Leios, the CIP's simulated parameters)",
        eb: Some(Endorser {
            txs: Capacity {
                bytes: 12_000_000,
                mem: 7_000_000_000,
                steps: 2_000_000_000_000,
                ref_script_bytes: 1_048_576,
            },
            references_bytes: 512_000,
            l_hdr_ms: 1000,
            l_vote_ms: 4000,
            l_diff_ms: 7000,
        }),
        ..mainnet
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn musashi_reads_its_genesis() {
        let m = musashi_genesis().unwrap();
        assert_eq!(m.rb.bytes, 90_112);
        assert_eq!(m.rb.steps, 20_000_000_000);
        let eb = m.eb.unwrap();
        assert_eq!(eb.txs.bytes, 260_000);
        assert_eq!(eb.txs.steps, 200_000_000_000);
        assert_eq!(eb.certify_gap_slots(m.slot_ms), 14);
        // No RB in the 13 slots after the announcing one.
        assert!((m.certified_share() - 0.95f64.powi(13)).abs() < 1e-12);
        // Votes: 96 of the 248 EBs the timing allowed.
        assert_eq!(observed_votes().unwrap(), (248, 96));
        // Since raised: the bytes, not the steps.
        let now = musashi().unwrap();
        assert_eq!(now.eb.unwrap().txs.bytes, 2_000_000);
        assert_eq!(now.eb.unwrap().txs.steps, 200_000_000_000);
    }

    #[test]
    fn a_full_block_binds_on_its_tightest_limit() {
        let room = Capacity {
            bytes: 100,
            mem: 1000,
            steps: 50,
            ref_script_bytes: 1000,
        };
        let one = Capacity {
            bytes: 10,
            mem: 10,
            steps: 10,
            ref_script_bytes: 0,
        };
        assert_eq!(fit(room, one), 5);
        assert_eq!(binding(room, one), "steps");
    }
}
