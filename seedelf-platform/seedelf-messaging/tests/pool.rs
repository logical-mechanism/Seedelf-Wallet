//! The local message pool (Phase 1H): 10 recipients, 1,000 envelopes mixed in
//! one collection of plain bytes. Each recipient scans every header with only
//! their own key, and reads exactly their messages. Timings live in
//! examples/pool_bench.rs, not here.

use seedelf_messaging::{
    Envelope, Error, Register, SecretKey, decrypt_message, encrypt_message, rerandomize_register,
};

const RECIPIENTS: usize = 10;
const MESSAGES: usize = 1_000;

#[test]
fn each_recipient_finds_and_reads_exactly_their_messages() {
    let keys: Vec<SecretKey> = (0..RECIPIENTS).map(|_| SecretKey::generate()).collect();
    // What senders know: each recipient's public register. Half are already
    // re-randomized, as a Seedelf datum's is.
    let registers: Vec<Register> = keys
        .iter()
        .enumerate()
        .map(|(i, key)| match i % 2 {
            0 => key.register(),
            _ => rerandomize_register(&key.register()),
        })
        .collect();

    // The pool: bytes and nothing else. No key, no recipient list, no index.
    let mut pool: Vec<Vec<u8>> = Vec::with_capacity(MESSAGES);
    let mut sent: Vec<Vec<Vec<u8>>> = vec![Vec::new(); RECIPIENTS];
    for i in 0..MESSAGES {
        let to = (i * 7 + i / 13) % RECIPIENTS;
        let plaintext = format!("message {i} for recipient {to}").into_bytes();
        pool.push(
            encrypt_message(&registers[to], &plaintext)
                .unwrap()
                .to_bytes(),
        );
        sent[to].push(plaintext);
    }
    assert!(sent.iter().all(|messages| !messages.is_empty()));

    // A client downloads the pool and parses it once.
    let envelopes: Vec<Envelope> = pool
        .iter()
        .map(|bytes| Envelope::from_bytes(bytes).unwrap())
        .collect();

    let mut claimed = vec![0usize; MESSAGES];
    for (who, key) in keys.iter().enumerate() {
        let mut read = Vec::new();
        for (i, envelope) in envelopes.iter().enumerate() {
            let matched = envelope.is_for(key);
            match decrypt_message(key, envelope) {
                Ok(plaintext) => {
                    assert!(matched);
                    claimed[i] += 1;
                    read.push(plaintext);
                }
                Err(Error::NotForThisKey) => assert!(!matched),
                Err(other) => panic!("envelope {i} for recipient {who}: {other}"),
            }
        }
        // Everything sent to them, in order, and nothing else.
        assert_eq!(read, sent[who], "recipient {who}");
    }
    // Every envelope was read by exactly one recipient.
    assert!(claimed.iter().all(|&count| count == 1));
}
