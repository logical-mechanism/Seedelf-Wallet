//! Seedelf and Lovejoin on Musashi, the Leios testnet: numbers only, for
//! throughput and for what the wallet's transaction building would need to
//! change under Leios. 1.7.0's item 8; see README.md.
//!
//! ```text
//! cargo run --release -- numbers     # the wallet's transactions, measured, and what a block takes
//! cargo run --release -- dijkstra    # what Dijkstra refuses in them, and the mend
//! cargo run --release -- model       # where a chain's transactions land, simulated
//! cargo run --release -- trace       # one simulated chain, block by block
//! cargo run --release -- live ...    # against the Musashi relay (live.rs)
//! ```

mod dijkstra;
mod limits;
mod live;
mod measure;
mod model;
mod params;
mod synth;

use anyhow::{Result, bail};
use limits::{Capacity, Network, binding, fit};

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("numbers") => numbers(),
        Some("dijkstra") => dijkstra_report(),
        Some("model") => model_report(args.get(1).and_then(|r| r.parse().ok()).unwrap_or(1000)),
        Some("trace") => trace(),
        Some("live") => live::run(&args[1..]),
        _ => bail!("usage: seedelf-leios numbers | dijkstra | model [runs] | trace | live <step>"),
    }
}

fn ada(lovelace: u64) -> String {
    format!("{:.6}", lovelace as f64 / 1e6)
}

fn networks() -> Result<Vec<Network>> {
    Ok(vec![limits::mainnet(), limits::musashi()?, limits::cip164()])
}

fn numbers() -> Result<()> {
    let p = params::musashi()?;
    let musashi = limits::musashi()?;
    let eb = musashi.eb.expect("Leios");
    println!("# Musashi, from its genesis (respin of 2026-10-18)\n");
    println!(
        "- An RB every {:.0} s on average (f = {}); an RB may hold {} bytes, {} memory, {} steps.",
        musashi.rb_seconds(),
        musashi.active_slots,
        musashi.rb.bytes,
        musashi.rb.mem,
        musashi.rb.steps
    );
    println!(
        "- An EB may hold {} bytes of transactions ({} of references), {} memory, {} steps: {:.1}x an RB's bytes, {:.0}x its steps.",
        eb.txs.bytes,
        eb.references_bytes,
        eb.txs.mem,
        eb.txs.steps,
        eb.txs.bytes as f64 / musashi.rb.bytes as f64,
        eb.txs.steps as f64 / musashi.rb.steps as f64
    );
    println!(
        "- The RB after may certify it only {} slots on (3 x {} ms + {} ms + {} ms): {:.1}% of EBs are, the rest are dropped.",
        eb.certify_gap_slots(musashi.slot_ms),
        eb.l_hdr_ms,
        eb.l_vote_ms,
        eb.l_diff_ms,
        musashi.certified_share() * 100.0
    );
    println!(
        "- A transaction may use {} bytes, {} memory, {} steps: mainnet's limits, so a mix is still at most four boxes wide.\n",
        musashi.tx.bytes, musashi.tx.mem, musashi.tx.steps
    );

    let set = measure::all(&p)?;
    println!("# The wallet's transactions, built by core and measured with its evaluator\n");
    println!("| Transaction | Size (B) | Memory | Steps | Fee (ADA) | Ref. scripts (B) |");
    println!("|---|---:|---:|---:|---:|---:|");
    let mut rows: Vec<&measure::Measured> = set.txs.iter().collect();
    for (_, chain) in &set.chains {
        rows.extend(chain.iter());
    }
    for m in &rows {
        let (mem, steps) = m.units();
        println!(
            "| {} | {} | {} | {} | {} | {} |",
            m.kind,
            m.size(),
            mem,
            steps,
            ada(m.fee()),
            m.ref_script_bytes()
        );
    }

    println!("\n# How many fit a block, full of one kind\n");
    println!(
        "Per second when every block is full of it: an RB's worth for each RB that doesn't certify, an EB's for each that does ({:.1}%).\n",
        musashi.certified_share() * 100.0
    );
    println!("| Transaction | Mainnet RB | Musashi EB | CIP-164 EB | Binds (Musashi EB) | Mainnet /s | Musashi /s | CIP-164 /s | Musashi vs mainnet |");
    println!("|---|---:|---:|---:|---|---:|---:|---:|---:|");
    let nets = networks()?;
    // Every mix of a width is the same shape: the first stands for them, and
    // one deposit for both chains.
    let mut kinds: Vec<&measure::Measured> = set.txs.iter().collect();
    for (i, (_, chain)) in set.chains.iter().enumerate() {
        kinds.extend(chain.iter().skip(if i == 0 { 0 } else { 1 }).take(if i == 0 { 2 } else { 1 }));
    }
    for m in kinds {
        let one = m.capacity();
        let kind = m.kind.replace("mix 1, ", "mix, ");
        let per_s: Vec<f64> = nets.iter().map(|n| n.per_second(one)).collect();
        println!(
            "| {} | {} | {} | {} | {} | {:.3} | {:.3} | {:.3} | {:.1}x |",
            kind,
            fit(nets[0].rb, one),
            fit(eb.txs, one),
            fit(nets[2].eb.expect("Leios").txs, one),
            binding(eb.txs, one),
            per_s[0],
            per_s[1],
            per_s[2],
            per_s[1] / per_s[0]
        );
    }

    println!("\n# The chains: a deposit, then one box fanned out two waves deep\n");
    println!("| Chain | Txs | Bytes | Steps | Of one RB's steps | Of one Musashi EB's steps |");
    println!("|---|---:|---:|---:|---:|---:|");
    for (width, chain) in &set.chains {
        let bytes: u64 = chain.iter().map(|m| m.size()).sum();
        let steps: u64 = chain.iter().map(|m| m.units().1).sum();
        println!(
            "| {width} wide: deposit + {} mixes | {} | {} | {} | {:.0}% | {:.1}% |",
            chain.len() - 1,
            chain.len(),
            bytes,
            steps,
            steps as f64 * 100.0 / musashi.rb.steps as f64,
            steps as f64 * 100.0 / eb.txs.steps as f64
        );
    }
    Ok(())
}

fn dijkstra_report() -> Result<()> {
    let p = params::musashi()?;
    let set = measure::all(&p)?;
    println!("# What a Dijkstra node (protocol version 12) refuses in the wallet's transactions\n");
    println!("| Transaction | Refused as built | Mended: bytes | Mended: fee (lovelace) | Scripts after the mend |");
    println!("|---|---|---:|---:|---|");
    let mut rows: Vec<&measure::Measured> = set.txs.iter().collect();
    for (_, chain) in &set.chains {
        rows.extend(chain.iter());
    }
    for m in rows {
        let why = dijkstra::refusals(&m.tx)?;
        let refused = if why.is_empty() { "no".to_string() } else { why.join("; ") };
        if m.redeemers() == 0 {
            println!("| {} | {refused} | | | runs no script |", m.kind);
            continue;
        }
        match m.change {
            None => println!(
                "| {} | {refused} | | | can't be mended after the fact: its proofs bind every output, so core must build it so |",
                m.kind
            ),
            Some(change) => {
                let mended = dijkstra::mend(&m.tx, &p, change, m.signers, &m.known)?;
                let again = dijkstra::refusals(&mended.tx)?;
                println!(
                    "| {} | {refused} | {:+} | {:+} | {} |",
                    m.kind,
                    mended.size_after as i64 - mended.size_before as i64,
                    mended.fee_after as i64 - mended.fee_before as i64,
                    if again.is_empty() { "pass, as declared" } else { "still refused" }
                );
            }
        }
    }
    Ok(())
}

/// The measured chains as the model takes them.
fn chains() -> Result<Vec<(usize, Vec<Capacity>)>> {
    let p = params::musashi()?;
    let (_, pool) = measure::launch(&p, 5_000_000)?;
    [3, 4]
        .into_iter()
        .map(|width| {
            let (chain, _, _) = measure::lovejoin_chain(&p, &pool, width, 2)?;
            Ok((width, chain.iter().map(|m| m.capacity()).collect()))
        })
        .collect()
}

fn mempool_of(n: &Network) -> Capacity {
    match n.eb {
        // Musashi's node holds 4,178,176 bytes: about 16 EBs. Steps in the
        // same proportion.
        Some(eb) => Capacity {
            bytes: eb.txs.bytes * 4_178_176 / 260_000,
            mem: eb.txs.mem * 4_178_176 / 260_000,
            steps: eb.txs.steps * 4_178_176 / 260_000,
            ref_script_bytes: u64::MAX,
        },
        // A Praos node's holds two blocks.
        None => Capacity {
            bytes: 2 * n.rb.bytes,
            mem: 2 * n.rb.mem,
            steps: 2 * n.rb.steps,
            ref_script_bytes: u64::MAX,
        },
    }
}

fn scenario(n: &Network, chain: &[Capacity], window: usize, load: f64) -> model::Scenario {
    let praos_bytes_per_s = limits::mainnet().rb.bytes as f64 / limits::mainnet().rb_seconds();
    model::Scenario {
        network: *n,
        mempool: mempool_of(n),
        load_bytes_per_s: load * praos_bytes_per_s,
        load_tx_bytes: 500,
        chain: chain.to_vec(),
        window,
        look_s: 5,
        quorum: 1.0,
    }
}

fn model_report(runs: usize) -> Result<()> {
    let chains = chains()?;
    let nets = networks()?;
    println!("# Where a chain lands: {runs} runs a line\n");
    println!("Load is everyone else's, as a multiple of what a Praos chain carries in bytes (4.5 kB/s), in 500-byte transactions that run no script: IO's own load runs at about 2x. The wallet sends at most 4 of a chain at once today; \"all\" sends the whole chain at once.\n");
    println!("| Network | Chain | Window | Load | Done | Mean (s) | p50 (s) | p90 (s) | RBs | In an RB | In an EB | Sat in a dropped EB |");
    println!("|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (width, chain) in &chains {
        for load in [0.0, 1.0, 2.0] {
            for n in &nets {
                for window in [4, usize::MAX] {
                    let s = scenario(n, chain, window, load);
                    let o = model::many(&s, runs, 0x5eed_0e1f ^ (*width as u64) << 8 ^ (load as u64));
                    println!(
                        "| {} | {} wide, {} txs | {} | {:.0}x | {:.0}% | {:.0} | {} | {} | {:.2} | {:.2} | {:.2} | {:.2} |",
                        n.name.split(" (").next().unwrap_or(n.name),
                        width,
                        chain.len(),
                        if window == usize::MAX { "all".into() } else { window.to_string() },
                        load,
                        o.finished as f64 * 100.0 / o.runs as f64,
                        o.mean_s,
                        o.p50_s,
                        o.p90_s,
                        o.mean_rbs,
                        o.mean_in_rb,
                        o.mean_in_eb,
                        o.mean_in_dropped_eb
                    );
                }
            }
        }
    }
    Ok(())
}

fn trace() -> Result<()> {
    let chains = chains()?;
    let musashi = limits::musashi()?;
    for (width, chain) in &chains {
        for load in [0.0, 2.0] {
            let s = scenario(&musashi, chain, usize::MAX, load);
            let mut rng = model::Rng::new(0x1e105 + *width as u64 + load as u64);
            let o = model::run(&s, &mut rng, true);
            println!("\n## Musashi, a {width}-wide chain ({} txs), sent whole, load {load:.0}x\n", chain.len());
            for line in &o.trace {
                println!("    {line}");
            }
            println!(
                "    -> all on the ledger after {} s, {} RBs: {} in an RB, {} in an EB",
                o.seconds.map_or("-".into(), |s| s.to_string()),
                o.rbs,
                o.in_rb,
                o.in_eb
            );
        }
    }
    Ok(())
}
