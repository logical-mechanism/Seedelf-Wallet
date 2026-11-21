//! Timings for the local message pool (Phase 1H). Not a test: correctness is
//! tests/pool.rs. Run it optimized:
//!
//! ```text
//! cargo run --release -p seedelf-messaging --example pool_bench -- [messages] [recipients]
//! ```
//!
//! Defaults: 1,000 messages to 10 recipients. Each figure is the mean over
//! the run's operations, wall clock, one thread.

use std::hint::black_box;
use std::time::{Duration, Instant};

use blstrs::{G1Affine, G2Affine, pairing};
use group::prime::PrimeCurveAffine;
use seedelf_messaging::{
    ENVELOPE_OVERHEAD, Envelope, SecretKey, decrypt_message, encrypt_message, rerandomize_register,
};

const PLAINTEXT_LEN: usize = 256;

fn per_op(total: Duration, count: usize) -> String {
    format!("{:>9.1} µs", total.as_secs_f64() * 1e6 / count as f64)
}

fn main() {
    let mut args = std::env::args().skip(1);
    let messages: usize = args
        .next()
        .map_or(1_000, |a| a.parse().expect("messages: a number"));
    let recipients: usize = args
        .next()
        .map_or(10, |a| a.parse().expect("recipients: a number"));
    assert!(recipients > 0 && messages >= recipients);

    // Keys and their root registers.
    let start = Instant::now();
    let keys: Vec<SecretKey> = (0..recipients).map(|_| SecretKey::generate()).collect();
    let registers: Vec<_> = keys.iter().map(SecretKey::register).collect();
    let key_time = start.elapsed();

    // Re-randomization alone.
    let start = Instant::now();
    for i in 0..messages {
        black_box(rerandomize_register(&registers[i % recipients]));
    }
    let rerandomize_time = start.elapsed();

    // Encryption, to bytes.
    let plaintext = vec![0x5au8; PLAINTEXT_LEN];
    let start = Instant::now();
    let pool: Vec<Vec<u8>> = (0..messages)
        .map(|i| {
            encrypt_message(&registers[i % recipients], &plaintext)
                .expect("encrypts")
                .to_bytes()
        })
        .collect();
    let encrypt_time = start.elapsed();

    // Parsing: lengths, versions and three subgroup checks per envelope.
    let start = Instant::now();
    let envelopes: Vec<Envelope> = pool
        .iter()
        .map(|bytes| Envelope::from_bytes(bytes).expect("parses"))
        .collect();
    let parse_time = start.elapsed();

    // Discovery: one recipient tests every header.
    let me = &keys[0];
    let start = Instant::now();
    let mine: Vec<&Envelope> = envelopes.iter().filter(|e| e.is_for(me)).collect();
    let scan_time = start.elapsed();

    // Decryption of what matched (it checks the register again first).
    let start = Instant::now();
    for envelope in &mine {
        black_box(decrypt_message(me, envelope).expect("decrypts"));
    }
    let decrypt_time = start.elapsed();

    // For comparison only: one pairing, what each decryption of the pairing
    // design would have added (docs/construction.md §3).
    let (g1, g2) = (G1Affine::generator(), G2Affine::generator());
    let rounds = 100;
    let start = Instant::now();
    for _ in 0..rounds {
        black_box(pairing(black_box(&g1), black_box(&g2)));
    }
    let pairing_time = start.elapsed();

    println!("{messages} messages to {recipients} recipients, {PLAINTEXT_LEN}-byte plaintexts");
    println!(
        "key + root register        {}",
        per_op(key_time, recipients)
    );
    println!(
        "re-randomize a register    {}",
        per_op(rerandomize_time, messages)
    );
    println!(
        "encrypt (to bytes)         {}",
        per_op(encrypt_time, messages)
    );
    println!(
        "parse an envelope          {}",
        per_op(parse_time, messages)
    );
    println!(
        "discovery, per header      {}   ({} headers in {:.1} ms, {} matched)",
        per_op(scan_time, messages),
        messages,
        scan_time.as_secs_f64() * 1e3,
        mine.len()
    );
    println!(
        "decrypt a matched message  {}",
        per_op(decrypt_time, mine.len())
    );
    println!(
        "one pairing (not used)     {}",
        per_op(pairing_time, rounds)
    );
    println!(
        "envelope size              {} bytes ({} + plaintext)",
        ENVELOPE_OVERHEAD + PLAINTEXT_LEN,
        ENVELOPE_OVERHEAD
    );
}
