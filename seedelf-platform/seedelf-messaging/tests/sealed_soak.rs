//! A soak of plaintext a stranger chose and PROPERLY SEALED to the reader
//! (the 1.10.0 gate's robustness check).
//!
//! Anyone who knows a reader's public register can put any plaintext under a
//! valid AES-GCM tag. It gets past the envelope's authentication and reaches
//! the padding, the parsers of F, of the ratchet header and of the inner
//! message, and `Inbox::receive`'s routing: a panic there is a WebAssembly
//! trap in the wallet, at every sync until the relay drops the envelope.
//!
//! **What it reads.** The first test builds valid first-contact and session
//! messages with the crate's own builders, takes the session vectors'
//! first-contact messages at the full 24 bits, and keeps the reader's records
//! at each point: nothing held, a request of 1, 15 and 16 messages, a request
//! at its share in bytes, fifty requests, a conversation before and after
//! each reply, 2,000 stored skipped keys, a deleted conversation, handles
//! that don't serve. Then, case after case:
//!
//! - a valid message's plaintext with a field changed (a length, a counter,
//!   `t`, the stamp, a point, a proof's scalar, the cid, the type), cut,
//!   lengthened or spliced with another's, its stamp solved again as a
//!   stranger would, padded right or not quite, and sealed validly;
//! - random plaintext of every size, bare or in a message's frame;
//! - the authentic envelopes of a writer that lies about its counters
//!   (1,000, 1,001, 4,096 and 4,097 keys ahead; a false PN or N up to the
//!   counter's end; a third message past a request's share);
//! - a reveal's bytes, changed.
//!
//! The second test is two wallets writing to each other, with messages
//! dropped, delayed, repeated, and re-sealed by a stranger with a change,
//! every record written and read again after each call as the wallet does.
//!
//! **What must hold.** No panic. Nothing a stranger sealed is ever accepted:
//! its envelope isn't the one its message key gives. Each authentic envelope
//! is answered as written beside it. A refusal changes no record (compared
//! for one refusal in 32). The slowest cases are printed, for a hang to show;
//! no time is asserted, since a busy machine would fail it.
//!
//! **Sizes.** By default 2,000 cases and 300 steps: about 15 s on two
//! threads at the test profile, 9 of them the setup. The environment sets a
//! gate run's:
//!
//! - `SOAK_CASES`, `SOAK_WALK`: the cases and the walk's steps;
//! - `SOAK_SEED` (1), `SOAK_THREADS` (2);
//! - `SOAK_OUT`: a folder for the findings as they come and the tallies every
//!   50,000 cases, so a run that is stopped still says what it reached;
//! - `SOAK_EXPORT`: with `SOAK_OUT`, the first that many cases are written
//!   with what the crate answered, for a runner that sends the same bytes
//!   through the built WebAssembly module and compares (see `export`).
//!
//! A gate run keeps the test profile's overflow checks and debug assertions
//! and adds optimization:
//!
//! ```text
//! SOAK_CASES=1000000 SOAK_WALK=50000 cargo test -p seedelf-messaging \
//!     --test sealed_soak --config 'profile.test.opt-level=3' -- --nocapture
//! ```
//!
//! The 1.10.0 gate ran that on 2026-11-24, on the two threads of one core:
//! 10 minutes, the 1,000,000 cases in 9 min 15 s and the 50,000 steps in
//! 5 min 23 s beside them. Before it, as a scratch test, 3,200,000 cases in
//! 61 minutes and 150,000 steps in 27, beside other work. No finding in any.
//!
//! **Two keys.** Every reader's key is its messaging key; a handle is its
//! Seedelf's messaging register, on the hashed base, taken with that key
//! from the Seedelf's chain, name and datum register (another key's, the
//! Seedelf key's), and a writer's is read from the Seedelf's certificate
//! (docs/protocol.md §21).
//!
//! **A finding.** The builders draw from the operating system, so a seed
//! doesn't give the same bytes twice. A finding therefore prints everything
//! it read as one line of JSON: the reader's key, handles and records, the
//! clock, and the envelope or reveal. `SOAK_REPLAY=<a file holding that
//! line>` makes the first test read that one input again and nothing else.
use std::collections::BTreeMap;
use std::io::Write;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use blstrs::{G1Affine, G1Projective, Scalar};
use hkdf::Hkdf;
use serde_json::Value;
use sha2::{Digest, Sha256};

use seedelf_messaging::relay::find_stamp;
use seedelf_messaging::session::{
    Certificate, Chain, Conversation, ConversationId, FirstContact, Handle, Inbox, NETWORK_PREPROD,
    Received, Requests, Reveal, Seedelf, Tombstones, open,
};
use seedelf_messaging::{
    Envelope, Error, Register, SecretKey, decrypt_message, encrypt_message, matches_envelope,
    rerandomize_register,
};

const VECTORS: &str = "tests/vectors/messaging_session_v1.json";

const T: u64 = 1_800_000_000;

/// The stamp work this test's readers ask, where readers ask 2²⁴: a mutant's
/// stamp is solved again in a few hundred attempts.
const BITS: u32 = 8;

const H48: u64 = 48 * 3600;
const SIZES: [usize; 4] = [512, 2048, 8192, 32768];

/// An envelope's size beyond its plaintext's.
const OVERHEAD: usize = 145;

/// q, BLS12-381's scalar field order, big-endian.
const GROUP_ORDER: &str = "73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001";

/// p, BLS12-381's base field modulus, big-endian.
const FIELD_MODULUS: &str = "1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab";

/// A refusal's name in snake case, as the wallet's bindings name it to the
/// worker: `InvalidPadding` is `invalid_padding`.
fn code(error: Error) -> String {
    let name = format!("{error:?}");
    let mut out = String::new();
    for (i, c) in name.split('(').next().unwrap().chars().enumerate() {
        if c.is_ascii_uppercase() && i > 0 {
            out.push('_');
        }
        out.push(c.to_ascii_lowercase());
    }
    out
}

fn env_u64(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

// ---------------------------------------------------------------------------
// A generator, a byte stream another runner can make, and patches
// ---------------------------------------------------------------------------

/// xoshiro256**, seeded through splitmix64.
struct Rng([u64; 4]);

impl Rng {
    fn new(seed: u64) -> Self {
        let mut z = seed;
        let mut next = || {
            z = z.wrapping_add(0x9e37_79b9_7f4a_7c15);
            let mut x = z;
            x = (x ^ (x >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
            x = (x ^ (x >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
            x ^ (x >> 31)
        };
        Rng([next(), next(), next(), next()])
    }

    fn word(&mut self) -> u64 {
        let s = &mut self.0;
        let out = s[1].wrapping_mul(5).rotate_left(7).wrapping_mul(9);
        let t = s[1] << 17;
        s[2] ^= s[0];
        s[3] ^= s[1];
        s[1] ^= s[2];
        s[0] ^= s[3];
        s[2] ^= t;
        s[3] = s[3].rotate_left(45);
        out
    }

    /// A number below `n`, or 0 for `n` = 0.
    fn below(&mut self, n: usize) -> usize {
        if n == 0 {
            0
        } else {
            (self.word() % n as u64) as usize
        }
    }

    fn byte(&mut self) -> u8 {
        self.word() as u8
    }

    fn chance(&mut self, percent: u64) -> bool {
        self.word() % 100 < percent
    }

    fn bytes(&mut self, n: usize) -> Vec<u8> {
        let mut out = vec![0u8; n];
        for chunk in out.chunks_mut(8) {
            let word = self.word().to_le_bytes();
            chunk.copy_from_slice(&word[..chunk.len()]);
        }
        out
    }

    fn pick<'a, X>(&mut self, xs: &'a [X]) -> &'a X {
        &xs[self.below(xs.len())]
    }
}

/// `len` bytes from `seed`: SHA-256("soak" ‖ seed (8, big-endian) ‖ counter
/// (8, big-endian)), block after block. A runner of the export makes the same
/// stream from the seed.
fn stream(seed: u64, len: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(len + 32);
    let mut counter = 0u64;
    while out.len() < len {
        out.extend_from_slice(
            &Sha256::new()
                .chain_update(b"soak")
                .chain_update(seed.to_be_bytes())
                .chain_update(counter.to_be_bytes())
                .finalize(),
        );
        counter += 1;
    }
    out.truncate(len);
    out
}

/// `changed` as patches against `base` cut or zero-filled to its length:
/// `offset:hex,...`.
fn patches(base: &[u8], changed: &[u8]) -> String {
    let mut out = String::new();
    let at = |i: usize| base.get(i).copied().unwrap_or(0);
    let mut i = 0;
    while i < changed.len() {
        if changed[i] == at(i) {
            i += 1;
            continue;
        }
        // A run of differences, taking in gaps of fewer than 6 equal bytes.
        let start = i;
        let mut end = i + 1;
        let mut j = i + 1;
        while j < changed.len() && j < end + 6 {
            if changed[j] != at(j) {
                end = j + 1;
            }
            j += 1;
        }
        if !out.is_empty() {
            out.push(',');
        }
        out.push_str(&format!("{start}:{}", hex::encode(&changed[start..end])));
        i = end;
    }
    out
}

/// A fixed key: SHA-256 of a label with its top two bits cleared, so it's
/// below the group order.
fn key_bytes(label: &str) -> [u8; 32] {
    let mut bytes: [u8; 32] = Sha256::digest(label.as_bytes()).into();
    bytes[0] &= 0x3f;
    bytes
}

/// The Seedelf policy this test's Seedelfs go by: variant 1's.
fn policy() -> [u8; 28] {
    hex::decode("84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255")
        .unwrap()
        .try_into()
        .unwrap()
}

/// The chain this test's Seedelfs live on, and that its reveals are read
/// under: preprod.
fn chain() -> Chain {
    Chain::new(NETWORK_PREPROD, policy()).unwrap()
}

/// The handle a writer writes to `seedelf` at: its certificate, made with
/// its owner's two keys and read back as the relay's list gives it.
fn certified(spend: &SecretKey, messaging: &SecretKey, seedelf: &Seedelf) -> Handle {
    let bytes = Certificate::make(spend, messaging, seedelf)
        .unwrap()
        .to_bytes();
    let certificate = Certificate::from_bytes(seedelf.chain(), &bytes).unwrap();
    assert!(certificate.is_for(seedelf));
    certificate.handle().clone()
}

// ---------------------------------------------------------------------------
// Sealing to a reader as any stranger can
// ---------------------------------------------------------------------------

/// One envelope header to a reader's root register and the AES-256-GCM key
/// and nonce it gives (docs/construction.md §4), so a plaintext costs one
/// AES-GCM pass. Every plaintext goes under the same key and nonce: the
/// reader can't tell, and nothing here is secret.
#[derive(Clone)]
struct Seal {
    header: Vec<u8>,
    key: [u8; 32],
    nonce: [u8; 12],
}

impl Seal {
    fn new(key_bytes: &[u8; 32]) -> Self {
        let key = SecretKey::from_bytes(key_bytes).unwrap();
        let envelope = encrypt_message(&key.register(), b"").unwrap().to_bytes();
        let header = envelope[..129].to_vec();
        let c: G1Affine = Option::from(G1Affine::from_compressed(
            envelope[81..129].try_into().unwrap(),
        ))
        .unwrap();
        let x: Scalar = Option::from(Scalar::from_bytes_be(key_bytes)).unwrap();
        let shared = (G1Projective::from(c) * x).to_compressed();
        let mut okm = [0u8; 44];
        Hkdf::<Sha256>::new(Some(b"Seedelf-Messaging|v1|HKDF-SHA256|salt"), &shared)
            .expand_multi_info(
                &[b"Seedelf-Messaging|v1|AES-256-GCM|key|nonce", &header],
                &mut okm,
            )
            .unwrap();
        let seal = Seal {
            header,
            key: okm[..32].try_into().unwrap(),
            nonce: okm[32..].try_into().unwrap(),
        };
        // The crate's own reader opens what this seals.
        let sealed = seal.seal(b"sealed as the crate seals");
        let opened = decrypt_message(&key, &Envelope::from_bytes(&sealed).unwrap()).unwrap();
        assert_eq!(opened, b"sealed as the crate seals");
        assert!(matches_envelope(&key, &sealed).unwrap());
        seal
    }

    fn seal(&self, plaintext: &[u8]) -> Vec<u8> {
        let sealed = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.key))
            .encrypt(
                Nonce::from_slice(&self.nonce),
                Payload {
                    msg: plaintext,
                    aad: &self.header,
                },
            )
            .unwrap();
        let mut out = self.header.clone();
        out.extend_from_slice(&sealed);
        out
    }
}

// ---------------------------------------------------------------------------
// Readers' contexts: the records a wallet holds when an envelope arrives
// ---------------------------------------------------------------------------

/// A Seedelf's chain, its name and the datum registers it has held, each a
/// handle the reader takes with its messaging key; and `certificates`,
/// other keys' certificates under the name, whose handles the reader lists
/// by mistake.
#[derive(Clone)]
struct HandleDef {
    network: u8,
    policy: [u8; 28],
    name: Vec<u8>,
    registers: Vec<Register>,
    certificates: Vec<Vec<u8>>,
}

impl HandleDef {
    /// The reader's own Seedelf named `name` under [`chain`], at `registers`.
    fn own(name: &[u8], registers: Vec<Register>) -> Self {
        HandleDef {
            network: NETWORK_PREPROD,
            policy: policy(),
            name: name.to_vec(),
            registers,
            certificates: Vec::new(),
        }
    }
}

#[derive(Clone)]
struct Party {
    key_bytes: [u8; 32],
    handles: Vec<HandleDef>,
    seal: Seal,
}

impl Party {
    fn new(key_bytes: [u8; 32], handles: Vec<HandleDef>) -> Self {
        Party {
            seal: Seal::new(&key_bytes),
            key_bytes,
            handles,
        }
    }

    fn key(&self) -> SecretKey {
        SecretKey::from_bytes(&self.key_bytes).unwrap()
    }

    fn handle_list(&self) -> Vec<Handle> {
        let key = self.key();
        let mut list = Vec::new();
        for h in &self.handles {
            let chain = Chain::new(h.network, h.policy).unwrap();
            for register in &h.registers {
                let seedelf = Seedelf::new(chain, &h.name, *register).unwrap();
                list.push(seedelf.handle(&key).unwrap());
            }
            for certificate in &h.certificates {
                let certificate = Certificate::from_bytes(&chain, certificate).unwrap();
                list.push(certificate.handle().clone());
            }
        }
        list
    }
}

/// A reader and its records, as the wallet stores them.
struct Ctx {
    name: String,
    party: Party,
    conversations: Vec<Vec<u8>>,
    requests: Option<Vec<u8>>,
    tombstones: Option<Vec<u8>>,
    bits: u32,
}

impl Ctx {
    /// `inbox`'s records, as `party`'s.
    fn of(name: &str, party: &Party, inbox: &Inbox, bits: u32) -> Self {
        Ctx {
            name: name.to_string(),
            party: party.clone(),
            conversations: inbox
                .conversations()
                .map(|c| c.to_bytes().to_vec())
                .collect(),
            requests: (!inbox.requests().is_empty()).then(|| inbox.requests().to_bytes()),
            tombstones: (!inbox.tombstones().is_empty()).then(|| inbox.tombstones().to_bytes()),
            bits,
        }
    }

    fn inbox(&self) -> Inbox {
        let conversations = self
            .conversations
            .iter()
            .map(|record| Conversation::from_bytes(record).unwrap())
            .collect();
        let requests = self.requests.as_ref().map_or_else(Requests::new, |record| {
            Requests::from_bytes(record).unwrap()
        });
        let tombstones = self
            .tombstones
            .as_ref()
            .map_or_else(Tombstones::new, |record| {
                Tombstones::from_bytes(record).unwrap()
            });
        let mut inbox = Inbox::from_parts(conversations, requests, tombstones).unwrap();
        inbox.set_first_contact_bits(self.bits);
        inbox
    }

    /// Everything a call takes but the envelope, as JSON, every byte string
    /// hex: the shape the wallet's bindings read, and `seal` for a runner
    /// that seals the export's plaintexts.
    fn json(&self) -> Value {
        let handles: Vec<Value> = self
            .party
            .handles
            .iter()
            .map(|h| {
                let registers: Vec<Value> = h
                    .registers
                    .iter()
                    .map(|r| {
                        serde_json::json!({
                            "generator": hex::encode(r.generator_bytes()),
                            "publicValue": hex::encode(r.public_value_bytes()),
                        })
                    })
                    .collect();
                serde_json::json!({
                    "network": h.network,
                    "policy": hex::encode(h.policy),
                    "name": hex::encode(&h.name),
                    "registers": registers,
                    "certificates": h.certificates.iter().map(hex::encode).collect::<Vec<_>>(),
                })
            })
            .collect();
        serde_json::json!({
            "name": self.name,
            "key": hex::encode(self.party.key_bytes),
            "handles": handles,
            "conversations": self.conversations.iter().map(hex::encode).collect::<Vec<_>>(),
            "requests": self.requests.as_ref().map(hex::encode),
            "tombstones": self.tombstones.as_ref().map(hex::encode),
            "bits": self.bits,
            "seal": {
                "header": hex::encode(&self.party.seal.header),
                "key": hex::encode(self.party.seal.key),
                "nonce": hex::encode(self.party.seal.nonce),
            },
        })
    }

    /// The context [`Ctx::json`] wrote.
    fn from_json(value: &Value) -> Self {
        let bytes = |v: &Value| hex::decode(v.as_str().unwrap()).unwrap();
        let record = |v: &Value| (!v.is_null()).then(|| bytes(v));
        let handles = value["handles"]
            .as_array()
            .unwrap()
            .iter()
            .map(|h| HandleDef {
                network: u8::try_from(h["network"].as_u64().unwrap()).unwrap(),
                policy: bytes(&h["policy"]).try_into().unwrap(),
                certificates: h["certificates"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(bytes)
                    .collect(),
                name: bytes(&h["name"]),
                registers: h["registers"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|r| {
                        Register::from_bytes(
                            &bytes(&r["generator"]).try_into().unwrap(),
                            &bytes(&r["publicValue"]).try_into().unwrap(),
                        )
                        .unwrap()
                    })
                    .collect(),
            })
            .collect();
        Ctx {
            name: value["name"].as_str().unwrap().to_string(),
            party: Party::new(bytes(&value["key"]).try_into().unwrap(), handles),
            conversations: value["conversations"]
                .as_array()
                .unwrap()
                .iter()
                .map(bytes)
                .collect(),
            requests: record(&value["requests"]),
            tombstones: record(&value["tombstones"]),
            bits: value["bits"].as_u64().unwrap() as u32,
        }
    }
}

/// What one call read, as the line `SOAK_REPLAY` takes: the context, the
/// clock, and the envelope or the reveal.
fn replay_line(ctx: &Ctx, now: u64, envelope: Option<&[u8]>, reveal: Option<&[u8]>) -> String {
    serde_json::json!({
        "context": ctx.json(),
        "now": now,
        "envelope": envelope.map(hex::encode),
        "reveal": reveal.map(hex::encode),
    })
    .to_string()
}

/// Reads one finding's input again, outside any `catch_unwind`: a panic
/// shows where it is.
fn replay(path: &str) {
    let line = std::fs::read_to_string(path).expect("SOAK_REPLAY names a file");
    let value: Value = serde_json::from_str(line.trim()).expect("one line of JSON");
    let ctx = Ctx::from_json(&value["context"]);
    let now = value["now"].as_u64().unwrap();
    let bytes = |v: &Value| hex::decode(v.as_str().unwrap()).unwrap();
    let mut reader = Reader::new(&ctx);
    println!("replaying in [{}] at {now}", ctx.name);
    if !value["reveal"].is_null() {
        let conversation = reader.inbox.conversations().next().unwrap();
        let answer = check_reveal(conversation, &bytes(&value["reveal"]));
        println!("the reveal's check: {answer}");
        return;
    }
    let envelope = bytes(&value["envelope"]);
    println!(
        "the scan and the opening: {}",
        reader.scan_and_open(&envelope)
    );
    let (outcome, taken) = reader.receive(&ctx, &envelope, now);
    println!("receive: {outcome}");
    if !taken {
        let records = if reader.unchanged() { "no" } else { "A" };
        println!("{records} record changed");
    }
}

/// A valid message's padded plaintext, with the context and time it's read in.
struct Base {
    ctx: usize,
    now: u64,
    padded: Vec<u8>,
}

/// An authentic envelope, with the context and time it's read in and what
/// the reader must answer.
struct Keyed {
    ctx: usize,
    now: u64,
    envelope: Vec<u8>,
    expect: &'static str,
    note: String,
}

#[derive(Default)]
struct Setup {
    ctxs: Vec<Ctx>,
    bases: Vec<Base>,
    keyed: Vec<Keyed>,
    /// A context whose first conversation checks it, and a valid reveal.
    reveals: Vec<(usize, Vec<u8>)>,
    /// Conversation IDs and points for the mutator to put in.
    cids: Vec<[u8; 16]>,
    points: Vec<[u8; 48]>,
}

impl Setup {
    fn snap(&mut self, name: &str, party: &Party, inbox: &Inbox, bits: u32) -> usize {
        self.ctxs.push(Ctx::of(name, party, inbox, bits));
        self.ctxs.len() - 1
    }

    /// An authentic envelope read in `ctx` at `now`: answered as `expect`,
    /// and its plaintext, if `ctx`'s reader opens it, a base to mutate.
    fn authentic(
        &mut self,
        ctx: usize,
        now: u64,
        envelope: &[u8],
        expect: &'static str,
        note: &str,
    ) {
        let key = self.ctxs[ctx].party.key();
        let padded =
            Envelope::from_bytes(envelope).and_then(|parsed| decrypt_message(&key, &parsed));
        if let Ok(padded) = padded {
            self.bases.push(Base { ctx, now, padded });
        }
        self.keyed.push(Keyed {
            ctx,
            now,
            envelope: envelope.to_vec(),
            expect,
            note: note.to_string(),
        });
    }

    /// A message to `reader`, as a base in another reader's context: what a
    /// stranger seals to the wrong side.
    fn base_from(&mut self, ctx: usize, now: u64, envelope: &[u8], reader: &Party) {
        let padded =
            decrypt_message(&reader.key(), &Envelope::from_bytes(envelope).unwrap()).unwrap();
        self.bases.push(Base { ctx, now, padded });
    }
}

fn stamp(inbox: &mut Inbox, cid: ConversationId, bits: u32) {
    let digest = inbox.stamp_digest(cid).unwrap();
    inbox
        .set_stamp(cid, find_stamp(&digest, bits, 0, u64::MAX).unwrap())
        .unwrap();
}

/// Where a stored conversation keeps its count of first-contact bytes sent,
/// its Ns and its PN (docs/protocol.md §16.5).
struct Counters {
    sent: Option<usize>,
    ns: usize,
    pn: usize,
}

fn counters(state: &[u8]) -> Counters {
    let first_len = usize::from(u16::from_be_bytes([state[2], state[3]]));
    let mut at = 4 + first_len + 48 + 32;
    let flags = state[at];
    at += 1;
    at += 32 * usize::from(flags & 1 != 0) + 32 * usize::from(flags & 2 != 0);
    at += 32 + 48 + 48 * usize::from(flags & 4 != 0) + 8 * usize::from(flags & 8 != 0);
    let sent = (flags & 16 != 0).then_some(at);
    at += 4 * usize::from(flags & 16 != 0);
    Counters {
        sent,
        ns: at,
        pn: at + 8,
    }
}

/// `inbox`'s conversation `cid` with one counter of its record overwritten:
/// a writer that lies, with the keys to do it.
fn with_u32(
    inbox: &Inbox,
    cid: ConversationId,
    at: impl Fn(&Counters) -> usize,
    value: u32,
) -> Inbox {
    let mut state = inbox.conversation(cid).unwrap().to_bytes().to_vec();
    let at = at(&counters(&state));
    state[at..at + 4].copy_from_slice(&value.to_be_bytes());
    let conversation = Conversation::from_bytes(&state).expect("the edited record still reads");
    Inbox::from_parts(vec![conversation], Requests::new(), Tombstones::new()).unwrap()
}

/// A compressed encoding of `x`, with the compression flag set.
fn compressed_x(x: u64) -> [u8; 48] {
    let mut bytes = [0u8; 48];
    bytes[40..].copy_from_slice(&x.to_be_bytes());
    bytes[0] |= 0x80;
    bytes
}

fn build() -> Setup {
    let mut s = Setup::default();
    let name = hex::decode(format!("5eed0e1f{}", "b0".repeat(28))).unwrap();
    let alice_name = hex::decode(format!("5eed0e1f{}", "a1".repeat(28))).unwrap();
    let (alice_b, bob_b) = (key_bytes("soak alice"), key_bytes("soak bob"));
    let (alice, bob) = (
        SecretKey::from_bytes(&alice_b).unwrap(),
        SecretKey::from_bytes(&bob_b).unwrap(),
    );
    let carol = SecretKey::from_bytes(&key_bytes("soak carol")).unwrap();
    // Each wallet's Seedelf key, apart from its messaging key.
    let seedelf_key = |label: &str| SecretKey::from_bytes(&key_bytes(label)).unwrap();
    let (alice_x, bob_x, carol_x) = (
        seedelf_key("soak alice's seedelf key"),
        seedelf_key("soak bob's seedelf key"),
        seedelf_key("soak carol's seedelf key"),
    );
    let seedelf = rerandomize_register(&bob_x.register());
    let alice_seedelf = rerandomize_register(&alice_x.register());
    // Two registers under one name, two handles: the base proof is tried
    // against each.
    let bob_party = Party::new(
        bob_b,
        vec![HandleDef::own(&name, vec![bob_x.register(), seedelf])],
    );
    let alice_party = Party::new(
        alice_b,
        vec![HandleDef::own(&alice_name, vec![alice_seedelf])],
    );
    let bob_handles = bob_party.handle_list();
    // What Alice writes to: Bob's Seedelf's handle, from its certificate.
    let bobs_seedelf = Seedelf::new(chain(), &name, seedelf).unwrap();
    let to_bob = certified(&bob_x, &bob, &bobs_seedelf);
    assert_eq!(to_bob, bob_handles[1]);

    // Points for the mutator: four valid ones, then each way of not being one.
    s.points.push(bob.register().generator_bytes());
    s.points.push(to_bob.register().generator_bytes());
    s.points.push(to_bob.register().public_value_bytes());
    s.points.push(carol.register().public_value_bytes());
    let mut identity = [0u8; 48];
    identity[0] = 0xc0;
    s.points.push(identity);
    let decoded = |b: &[u8; 48]| Option::<G1Affine>::from(G1Affine::from_compressed_unchecked(b));
    let outside_g1 = (1u64..).map(compressed_x).find(|b| {
        decoded(b).is_some_and(|p| bool::from(p.is_on_curve()) && !bool::from(p.is_torsion_free()))
    });
    s.points.push(outside_g1.unwrap());
    let off_curve = (1u64..).map(compressed_x).find(|b| decoded(b).is_none());
    s.points.push(off_curve.unwrap());
    let mut modulus: [u8; 48] = hex::decode(FIELD_MODULUS).unwrap().try_into().unwrap();
    modulus[0] |= 0x80;
    s.points.push(modulus);
    s.points.push([0u8; 48]);
    s.points.push([0xff; 48]);

    // Alice writes to Bob's Seedelf: sixteen first-contact messages, a
    // request's whole share.
    let mut a = Inbox::new();
    let cid = a.start(&alice, &to_bob, T).unwrap();
    s.cids.push(cid.0);
    stamp(&mut a, cid, BITS);
    let lengths = [
        9usize, 3000, 20000, 0, 1, 50, 100, 200, 300, 400, 500, 700, 900, 1100, 1200, 1300,
    ];
    let m: Vec<Vec<u8>> = lengths
        .iter()
        .enumerate()
        .map(|(i, &len)| a.send(cid, &vec![b'a' + i as u8; len]).unwrap())
        .collect();
    assert_eq!(a.send(cid, b"a seventeenth"), Err(Error::RequestFull));

    let mut b = Inbox::new();
    b.set_first_contact_bits(BITS);
    let fresh = s.snap("bob, nothing held", &bob_party, &b, BITS);
    for (i, envelope) in m.iter().enumerate() {
        let note = format!("first-contact message {i}, new");
        s.authentic(fresh, T + 60, envelope, "request", &note);
    }
    // The window's edges (docs/protocol.md §5).
    s.authentic(fresh, T - 3600, &m[0], "request", "t an hour ahead");
    let note = "t an hour and a second ahead";
    s.authentic(fresh, T - 3601, &m[0], "outside_window", note);
    s.authentic(fresh, T + H48, &m[0], "request", "t 48 hours old");
    let note = "t 48 hours and a second old";
    s.authentic(fresh, T + H48 + 1, &m[0], "outside_window", note);
    // The same reader asking the full 24 bits: a stamp solved at 8 shows too
    // little, but for one in 2¹⁶.
    let strict = s.snap("bob, nothing held, 24 bits asked", &bob_party, &b, 24);
    let (_, work) = a.conversation(cid).unwrap().stamp().unwrap();
    let expect = if work < 24 {
        "stamp_too_low"
    } else {
        "request"
    };
    let note = "a stamp solved at 8 bits where 24 are asked";
    s.authentic(strict, T + 60, &m[0], expect, note);
    // Handles that don't serve: another key's register under the name, the
    // handle Carol's certificate names, listed by mistake; and another name.
    let carols_seedelf = Seedelf::new(chain(), &name, carol_x.register()).unwrap();
    let carols_certificate = Certificate::make(&carol_x, &carol, &carols_seedelf)
        .unwrap()
        .to_bytes();
    let other_key = Party {
        handles: vec![HandleDef {
            certificates: vec![carols_certificate],
            ..HandleDef::own(&name, Vec::new())
        }],
        ..bob_party.clone()
    };
    let ctx = s.snap(
        "bob, the name holds another key's register",
        &other_key,
        &b,
        BITS,
    );
    let note = "a register of another key";
    s.authentic(ctx, T + 60, &m[0], "invalid_base_proof", note);
    let other_name = Party {
        handles: vec![HandleDef::own(&alice_name, vec![seedelf])],
        ..bob_party.clone()
    };
    let ctx = s.snap("bob, no handle of that name", &other_name, &b, BITS);
    s.authentic(
        ctx,
        T + 60,
        &m[0],
        "unknown_handle",
        "no handle of the name",
    );

    // A request, joined.
    b.receive(&bob, &bob_handles, &m[0], T + 60).unwrap();
    let ctx = s.snap("bob, a request of one message", &bob_party, &b, BITS);
    let note = "the request's own message again";
    s.authentic(ctx, T + 61, &m[0], "key_used_or_deleted", note);
    for i in [1usize, 2, 5, 15] {
        s.authentic(ctx, T + 61, &m[i], "request", &format!("message {i} joins"));
    }
    b.receive(&bob, &bob_handles, &m[1], T + 61).unwrap();
    let two = b.clone();
    let mut full = b.clone();
    for (i, envelope) in m.iter().enumerate().skip(2).take(13) {
        full.receive(&bob, &bob_handles, envelope, T + 62 + i as u64)
            .unwrap();
    }
    let ctx = s.snap(
        "bob, a request of fifteen messages",
        &bob_party,
        &full,
        BITS,
    );
    s.authentic(ctx, T + 90, &m[15], "request", "the sixteenth joins");
    let note = "a held message again";
    s.authentic(ctx, T + 90, &m[7], "key_used_or_deleted", note);
    full.receive(&bob, &bob_handles, &m[15], T + 90).unwrap();
    let ctx = s.snap(
        "bob, a request of sixteen messages",
        &bob_party,
        &full,
        BITS,
    );
    let note = "a full request's message again";
    s.authentic(ctx, T + 91, &m[3], "key_used_or_deleted", note);

    // Bob replies after two messages; Alice doesn't know yet.
    let mut b = two;
    b.accept(&bob, cid).unwrap();
    let r0 = b.send(cid, b"hello Alice").unwrap();
    let held1 = s.snap("bob, replied after two messages", &bob_party, &b, BITS);
    let note = "a first-contact message after the reply";
    s.authentic(held1, T + 100, &m[2], "message", note);
    let note = "the last first-contact message, 13 skipped";
    s.authentic(held1, T + 100, &m[15], "message", note);
    let note = "a read message again";
    s.authentic(held1, T + 100, &m[0], "key_used_or_deleted", note);
    let alice_wait = s.snap("alice, before a reply", &alice_party, &a, BITS);
    s.authentic(alice_wait, T + 120, &r0, "message", "bob's reply");
    s.base_from(alice_wait, T + 120, &m[0], &bob_party);
    a.receive(&alice, &[], &r0, T + 120).unwrap();
    let alice_held = s.snap("alice, after the reply", &alice_party, &a, BITS);
    let note = "bob's reply again";
    s.authentic(alice_held, T + 121, &r0, "key_used_or_deleted", note);
    let session: Vec<Vec<u8>> = [5usize, 200, 1500, 7000]
        .iter()
        .map(|&len| a.send(cid, &vec![b's'; len]).unwrap())
        .collect();
    for (i, envelope) in session.iter().enumerate() {
        let note = format!("session message {i} on a new key");
        s.authentic(held1, T + 180, envelope, "message", &note);
    }
    b.receive(&bob, &[], &session[0], T + 180).unwrap();
    let held2 = s.snap(
        "bob, after alice's first session message",
        &bob_party,
        &b,
        BITS,
    );
    let note = "a session message again";
    s.authentic(held2, T + 181, &session[0], "key_used_or_deleted", note);
    let note = "session message 3, two skipped";
    s.authentic(held2, T + 181, &session[3], "message", note);
    let note = "a skipped first-contact message";
    s.authentic(held2, T + 181, &m[2], "message", note);
    // A skipped key's 48 hours (docs/protocol.md §4.1), to the second.
    let note = "a skipped key at its 48 hours";
    s.authentic(held2, T + 180 + H48, &m[3], "message", note);
    let note = "a skipped key a second past";
    s.authentic(held2, T + 180 + H48 + 1, &m[3], "key_used_or_deleted", note);
    let r1 = b.send(cid, b"and again").unwrap();
    let held3 = s.snap("bob, after a second reply", &bob_party, &b, BITS);
    let note = "bob's second reply, a new key";
    s.authentic(alice_held, T + 200, &r1, "message", note);

    // The reveal: Alice shows Bob her Seedelf.
    let shown = Seedelf::new(chain(), &alice_name, alice_seedelf)
        .unwrap()
        .handle(&alice)
        .unwrap();
    let reveal = a.conversation(cid).unwrap().reveal(&alice, &shown).unwrap();
    let reveal = reveal.to_bytes();
    let reader = b.conversation(cid).unwrap();
    reader
        .verify_reveal(&Reveal::from_bytes(&chain(), &reveal).unwrap())
        .unwrap();
    s.reveals.push((held3, reveal));

    // A writer that lies about its counters, authentically where it can.
    //
    // Ahead on the current chain: Bob's Nr is 1 and Alice's Ns is 4, so a
    // message after k dropped ones skips 3 + k keys. 1,000 is the most
    // stored, 4,096 the most stepped to learn whether one authenticates
    // (docs/protocol.md §16.4).
    {
        let mut ahead = a.clone();
        for k in 0..=4094u32 {
            let envelope = ahead.send(cid, b"k").unwrap();
            let expect = match 3 + k {
                1000 => "message",
                1001 | 4096 => "too_far_ahead",
                4097 => "decryption_failed",
                _ => continue,
            };
            let note = format!("{} keys ahead on the chain", 3 + k);
            s.authentic(held3, T + 300, &envelope, expect, &note);
        }
    }
    // A new ratchet key with a false PN: Alice takes Bob's second reply,
    // then says PN = x and drops N messages.
    let mut stepped = a.clone();
    stepped.receive(&alice, &[], &r1, T + 200).unwrap();
    for (pn, dropped, expect) in [
        (0u32, 0u32, "message"),
        (4, 0, "message"),
        (1001, 0, "message"),
        (1002, 0, "too_far_ahead"),
        (501, 500, "message"),
        (501, 501, "too_far_ahead"),
        (4097, 0, "too_far_ahead"),
        (4098, 0, "decryption_failed"),
        (0x7fff_ffff, 0, "decryption_failed"),
        (u32::MAX, 0, "decryption_failed"),
        (u32::MAX, 1000, "decryption_failed"),
    ] {
        let mut liar = with_u32(&stepped, cid, |c| c.pn, pn);
        for _ in 0..dropped {
            liar.send(cid, b"dropped").unwrap();
        }
        let envelope = liar.send(cid, b"a false PN").unwrap();
        let note = format!("a new key, PN {pn}, N {dropped}");
        s.authentic(held3, T + 300, &envelope, expect, &note);
    }
    // A false N: the header says N = y, under the chain's fifth key.
    for ns in [1001u32, 1002, 4097, 4098, 0x8000_0000, u32::MAX - 1] {
        let mut liar = with_u32(&a, cid, |c| c.ns, ns);
        let envelope = liar.send(cid, b"a false N").unwrap();
        let note = format!("N {ns} under another message's key");
        s.authentic(held3, T + 300, &envelope, "decryption_failed", &note);
    }
    assert_eq!(
        with_u32(&a, cid, |c| c.ns, u32::MAX).send(cid, b"past the counter"),
        Err(Error::ChainExhausted)
    );
    // The same on a new key.
    for ns in [1000u32, 4096, u32::MAX - 1] {
        let mut liar = with_u32(&stepped, cid, |c| c.ns, ns);
        let envelope = liar.send(cid, b"a false N on a new key").unwrap();
        let note = format!("a new key, N {ns} under the first key");
        s.authentic(held3, T + 300, &envelope, "decryption_failed", &note);
    }

    // 2,000 stored skipped keys, then more: the oldest go.
    {
        let (mut writer, mut reader) = (a.clone(), b.clone());
        let mut kept = Vec::new();
        for round in 0..2 {
            for i in 0..996u32 {
                let envelope = writer.send(cid, b"never delivered").unwrap();
                if i == 500 {
                    kept.push(envelope);
                }
            }
            let envelope = writer.send(cid, b"delivered").unwrap();
            reader
                .receive(&bob, &[], &envelope, T + 400 + round)
                .unwrap();
        }
        assert!(reader.conversation(cid).unwrap().missing() >= 2000);
        let ctx = s.snap("bob, 2,000 skipped keys stored", &bob_party, &reader, BITS);
        for _ in 0..999 {
            writer.send(cid, b"never delivered").unwrap();
        }
        let envelope = writer.send(cid, b"past the store").unwrap();
        let note = "1,000 more skipped at 2,000 stored";
        s.authentic(ctx, T + 500, &envelope, "message", note);
        s.authentic(ctx, T + 500, &kept[1], "message", "a stored skipped key");
        let note = "a key the store dropped";
        s.authentic(ctx, T + 500, &m[2], "decryption_failed", note);
    }

    // A request's share in bytes: two of the largest fit, a third doesn't.
    {
        let mut writer = Inbox::new();
        let big = writer.start(&alice, &to_bob, T).unwrap();
        s.cids.push(big.0);
        stamp(&mut writer, big, BITS);
        let most = writer.conversation(big).unwrap().max_text_len();
        let first = writer.send(big, &vec![1u8; most]).unwrap();
        let most = writer.conversation(big).unwrap().max_text_len();
        let second = writer.send(big, &vec![2u8; most]).unwrap();
        assert_eq!(writer.send(big, &[3u8; 600]), Err(Error::RequestFull));
        // A writer that doesn't keep to its share sends a third.
        let mut liar = with_u32(&writer, big, |c| c.sent.unwrap(), 0);
        let third = liar.send(big, &[3u8; 600]).unwrap();
        let mut reader = Inbox::new();
        reader.set_first_contact_bits(BITS);
        reader.receive(&bob, &bob_handles, &first, T + 60).unwrap();
        let ctx = s.snap(
            "bob, a request of one 32 KiB message",
            &bob_party,
            &reader,
            BITS,
        );
        let note = "a second 32 KiB message joins";
        s.authentic(ctx, T + 61, &second, "request", note);
        reader.receive(&bob, &bob_handles, &second, T + 61).unwrap();
        let ctx = s.snap(
            "bob, a request at its share in bytes",
            &bob_party,
            &reader,
            BITS,
        );
        let note = "a third message past the share";
        s.authentic(ctx, T + 62, &third, "request_full", note);
    }

    // Fifty requests, then one more: the oldest goes.
    {
        let mut reader = Inbox::new();
        reader.set_first_contact_bits(BITS);
        let mut firsts = Vec::new();
        for i in 0..51u64 {
            let mut writer = Inbox::new();
            let one = writer.start(&alice, &to_bob, T + i).unwrap();
            stamp(&mut writer, one, BITS);
            firsts.push(writer.send(one, b"one of many").unwrap());
        }
        for envelope in &firsts[..50] {
            reader
                .receive(&bob, &bob_handles, envelope, T + 60)
                .unwrap();
        }
        let ctx = s.snap("bob, fifty requests", &bob_party, &reader, BITS);
        s.authentic(ctx, T + 61, &firsts[50], "request", "a fifty-first request");
        let note = "a request's message again";
        s.authentic(ctx, T + 61, &firsts[7], "key_used_or_deleted", note);
    }

    // Continuations, by either side, read with and without the conversation
    // they continue (docs/protocol.md §6).
    {
        let mut writer = a.clone();
        let next = writer.start_continuing(&alice, cid, T + 1000).unwrap();
        s.cids.push(next.0);
        stamp(&mut writer, next, BITS);
        let envelope = writer.send(next, b"continued").unwrap();
        let note = "a verified continuation";
        s.authentic(held3, T + 1001, &envelope, "request", note);
        let note = "a continuation of nothing held";
        s.authentic(fresh, T + 1001, &envelope, "unverified_continuation", note);
        let mut writer = b.clone();
        let next = writer.start_continuing(&bob, cid, T + 2000).unwrap();
        stamp(&mut writer, next, BITS);
        let envelope = writer.send(next, b"continued by the reader").unwrap();
        let note = "the responder's continuation";
        s.authentic(alice_held, T + 2001, &envelope, "request", note);
    }

    // A deleted conversation, and one the reader never had.
    {
        let mut reader = b.clone();
        assert!(reader.delete(cid));
        let ctx = s.snap("bob, the conversation deleted", &bob_party, &reader, BITS);
        let note = "a session message of a deleted conversation";
        s.authentic(ctx, T + 300, &session[1], "deleted", note);
        let note = "a first message of a deleted conversation";
        s.authentic(ctx, T + 300, &m[0], "deleted", note);
    }
    let note = "a session message, nothing held";
    s.authentic(fresh, T + 300, &session[1], "unknown_conversation", note);

    // The session vectors' first-contact messages, at the full 24 bits.
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(VECTORS);
    let vectors: Value =
        serde_json::from_str(&std::fs::read_to_string(path).expect("reads the vectors")).unwrap();
    let bytes = |v: &Value| hex::decode(v.as_str().unwrap()).unwrap();
    for (i, session) in vectors["sessions"].as_array().unwrap().iter().enumerate() {
        let seedelf = &session["seedelf"];
        if seedelf.is_null() {
            continue;
        }
        // The reader's handle, from the Seedelf the file records.
        let register = Register::from_bytes(
            &bytes(&seedelf["generator"]).try_into().unwrap(),
            &bytes(&seedelf["public_value"]).try_into().unwrap(),
        )
        .unwrap();
        let reader = Party::new(
            bytes(&session["responder_secret_key"]).try_into().unwrap(),
            vec![HandleDef {
                network: u8::try_from(seedelf["network"].as_u64().unwrap()).unwrap(),
                policy: bytes(&seedelf["policy"]).try_into().unwrap(),
                name: bytes(&session["to"]),
                registers: vec![register],
                certificates: Vec::new(),
            }],
        );
        assert_eq!(
            reader.handle_list()[0]
                .register()
                .generator_bytes()
                .to_vec(),
            bytes(&session["handle"]["generator"])
        );
        let now = session["t"].as_u64().unwrap() + 60;
        let firsts: Vec<Vec<u8>> = session["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["send"]["kind"] == "first-contact")
            .map(|e| bytes(&e["send"]["envelope"]))
            .collect();
        let mut inbox = Inbox::new();
        let name = format!("the vectors' session {i}, nothing held");
        let ctx = s.snap(&name, &reader, &inbox, 24);
        for envelope in &firsts {
            s.authentic(
                ctx,
                now,
                envelope,
                "request",
                "a first message of the vectors'",
            );
        }
        inbox
            .receive(&reader.key(), &reader.handle_list(), &firsts[0], now)
            .unwrap();
        let name = format!("the vectors' session {i}, its first message held");
        let ctx = s.snap(&name, &reader, &inbox, 24);
        for (j, envelope) in firsts.iter().enumerate() {
            let expect = if j == 0 {
                "key_used_or_deleted"
            } else {
                "request"
            };
            let note = format!("message {j} of the vectors'");
            s.authentic(ctx, now + 1, envelope, expect, &note);
        }
    }
    s.cids.push([0u8; 16]);
    s.cids.push([0x2a; 16]);
    s
}

// ---------------------------------------------------------------------------
// The mutator
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    Type,
    Cid,
    Time,
    Len,
    Name,
    Point,
    Scalar,
    Stamp,
    Counter,
    Salt,
    Body,
    Tag,
}

#[derive(Clone, Copy, Debug)]
struct Field {
    kind: Kind,
    at: usize,
    len: usize,
}

/// The fields of a valid inner message (docs/protocol.md §3, §4.1).
fn layout(inner: &[u8]) -> Vec<Field> {
    let mut fields = Vec::new();
    let mut at = 0;
    let mut push = |kind, len: usize, at: &mut usize| {
        fields.push(Field { kind, at: *at, len });
        *at += len;
    };
    push(Kind::Type, 1, &mut at);
    push(Kind::Cid, 16, &mut at);
    if inner[0] == 1 {
        push(Kind::Time, 8, &mut at);
        let to_len = usize::from(inner[at]);
        push(Kind::Len, 1, &mut at);
        push(Kind::Name, to_len, &mut at);
        let replaces_len = usize::from(inner[at]);
        push(Kind::Len, 1, &mut at);
        push(Kind::Cid, replaces_len, &mut at);
        for _ in 0..3 {
            push(Kind::Point, 48, &mut at);
        }
        for _ in 0..(if to_len > 0 { 10 } else { 3 }) {
            push(Kind::Scalar, 32, &mut at);
        }
        push(Kind::Stamp, 8, &mut at);
    }
    push(Kind::Point, 48, &mut at);
    push(Kind::Counter, 4, &mut at);
    push(Kind::Counter, 4, &mut at);
    push(Kind::Salt, 16, &mut at);
    let body = inner.len() - at - 16;
    push(Kind::Body, body, &mut at);
    push(Kind::Tag, 16, &mut at);
    assert_eq!(at, inner.len());
    fields.retain(|f| f.len > 0);
    fields
}

/// A valid message's inner message, without its padding.
fn unpadded(padded: &[u8]) -> &[u8] {
    let end = padded.iter().rposition(|&b| b != 0).unwrap();
    assert_eq!(padded[end], 0x80);
    &padded[..end]
}

const COUNTERS: [u32; 16] = [
    0,
    1,
    2,
    15,
    16,
    17,
    999,
    1000,
    1001,
    4096,
    4097,
    65536,
    0x7fff_ffff,
    0x8000_0000,
    0xffff_fffe,
    0xffff_ffff,
];
const TIMES: [u64; 10] = [
    0,
    1,
    T,
    T - H48,
    T - H48 - 1,
    T + 3600 + 60,
    T + 3600 + 61,
    1 << 63,
    u64::MAX - 1,
    u64::MAX,
];

/// A scalar at an edge: 0, 1, q − 1, q, q + 1, all ones, random, or the
/// field's own bytes reversed.
fn special_scalar(rng: &mut Rng, current: &[u8]) -> Vec<u8> {
    let q = hex::decode(GROUP_ORDER).unwrap();
    let mut out = match rng.below(8) {
        0 => vec![0u8; 32],
        1 => {
            let mut one = vec![0u8; 32];
            one[31] = 1;
            one
        }
        2 => {
            let mut below = q.clone();
            below[31] -= 1;
            below
        }
        3 => q.clone(),
        4 => {
            let mut above = q.clone();
            above[31] += 1;
            above
        }
        5 => vec![0xff; 32],
        6 => rng.bytes(32),
        _ => current.iter().rev().copied().collect(),
    };
    out.truncate(current.len());
    out
}

/// One change to `inner`, whose fields were `fields` before any change.
fn change(rng: &mut Rng, inner: &mut Vec<u8>, fields: &[Field], setup: &Setup, others: &[&[u8]]) {
    let field = *rng.pick(fields);
    let range = field.at..(field.at + field.len).min(inner.len());
    if range.start >= inner.len() {
        return;
    }
    match rng.below(12) {
        0 | 1 => {
            let at = range.start + rng.below(range.len());
            inner[at] ^= 1 << rng.below(8);
        }
        2 => {
            let at = range.start + rng.below(range.len());
            inner[at] = rng.byte();
        }
        3..=6 => {
            // A value its kind makes interesting.
            let value: Vec<u8> = match field.kind {
                Kind::Type => vec![*rng.pick(&[0u8, 1, 2, 3, 0x80, 0xff])],
                Kind::Cid => rng.pick(&setup.cids).to_vec(),
                Kind::Time => rng.pick(&TIMES).to_be_bytes().to_vec(),
                Kind::Stamp => rng
                    .pick(&[0u64, 1, u64::MAX, 0x0102_0304_0506_0708])
                    .to_be_bytes()
                    .to_vec(),
                Kind::Len => vec![*rng.pick(&[0u8, 1, 15, 16, 17, 31, 32, 33, 255])],
                Kind::Counter => rng.pick(&COUNTERS).to_be_bytes().to_vec(),
                Kind::Point if rng.chance(15) => {
                    let mut bytes = inner[range.clone()].to_vec();
                    bytes[0] ^= *rng.pick(&[0x80u8, 0x40, 0x20, 0xe0]);
                    bytes
                }
                Kind::Point => rng.pick(&setup.points).to_vec(),
                Kind::Scalar => special_scalar(rng, &inner[range.clone()]),
                Kind::Name | Kind::Salt | Kind::Body | Kind::Tag if rng.chance(50) => {
                    rng.bytes(range.len())
                }
                Kind::Name | Kind::Salt | Kind::Body | Kind::Tag => vec![0u8; range.len()],
            };
            let n = value.len().min(range.len());
            inner[range.start..range.start + n].copy_from_slice(&value[..n]);
        }
        7 => {
            // Cut at the field's edge, a byte to either side of its end, or
            // anywhere.
            let at = match rng.below(4) {
                0 => range.start,
                1 => range.end.saturating_sub(1),
                2 => (range.end + 1).min(inner.len()),
                _ => rng.below(inner.len() + 1),
            };
            inner.truncate(at);
        }
        8 => {
            let extra = rng.below(64) + 1;
            let bytes = rng.bytes(extra);
            inner.extend_from_slice(&bytes);
        }
        9 => {
            // Bytes put in or taken out at the field's start: everything
            // after moves.
            let n = rng.below(48) + 1;
            if rng.chance(50) {
                let bytes = rng.bytes(n);
                inner.splice(range.start..range.start, bytes);
            } else {
                let end = (range.start + n).min(inner.len());
                inner.drain(range.start..end);
            }
        }
        10 => {
            // The same bytes of another valid message.
            let other = *rng.pick(others);
            if other.len() >= range.end {
                let bytes = other[range.clone()].to_vec();
                inner[range].copy_from_slice(&bytes);
            }
        }
        _ => {
            // Another valid message up to here, then this one.
            let other = *rng.pick(others);
            let cut = range.start.min(other.len());
            let mut spliced = other[..cut].to_vec();
            spliced.extend_from_slice(&inner[range.start..]);
            *inner = spliced;
        }
    }
}

/// A first-contact message whose F was changed and still parses gets its
/// stamp solved again, as a stranger would: without it nearly every changed
/// F stops at the stamp, before the proofs.
fn restamp(inner: &mut [u8], valid: &[u8]) {
    if inner.first() != Some(&1) || inner.len() < 27 {
        return;
    }
    let to_len = usize::from(inner[25]);
    let Some(&replaces_len) = inner.get(26 + to_len) else {
        return;
    };
    let proofs = if to_len > 0 { 320 } else { 96 };
    let f_len = 26 + to_len + usize::from(replaces_len) + 144 + proofs;
    if inner.len() < 1 + f_len + 8 || valid.get(..1 + f_len) == Some(&inner[..1 + f_len]) {
        return;
    }
    let Ok(first) = FirstContact::from_bytes(&inner[1..1 + f_len]) else {
        return;
    };
    if let Some(nonce) = find_stamp(&first.stamp_digest(), BITS, 0, 1 << 16) {
        inner[1 + f_len..1 + f_len + 8].copy_from_slice(&nonce.to_be_bytes());
    }
}

/// `inner`, padded as a writer would or not quite, to a plaintext about
/// `like` bytes long.
fn frame(rng: &mut Rng, mut inner: Vec<u8>, like: usize) -> Vec<u8> {
    let fits = |size: usize| inner.len() < size - OVERHEAD;
    let roll = rng.below(100);
    let size = match roll {
        0..=69 if fits(like + OVERHEAD) => like + OVERHEAD,
        0..=84 => SIZES.into_iter().find(|&s| fits(s)).unwrap_or(0),
        85..=89 => *rng.pick(&SIZES),
        _ => 0,
    };
    if size == 0 || !fits(size) {
        // A length that is no size, with a marker or without.
        let len = match rng.below(6) {
            0 => inner.len(),
            1 => inner.len() + 1,
            2 => rng.pick(&SIZES) - OVERHEAD + 1,
            3 => rng.pick(&SIZES) - OVERHEAD - 1,
            4 => rng.below(65537),
            _ => 65536,
        };
        if inner.len() < len && rng.chance(80) {
            inner.push(0x80);
        }
        inner.resize(len.min(65536), 0);
        return inner;
    }
    let end = inner.len();
    inner.push(0x80);
    inner.resize(size - OVERHEAD, 0);
    // Padding that isn't quite 0x80 then zeros, once in eight.
    match rng.below(40) {
        0 => inner[end] = 0,
        1 => inner[end] = *rng.pick(&[0x81u8, 0x40, 0x7f, 0x01, 0xff]),
        2 => {
            let at = end + rng.below(inner.len() - end);
            inner[at] = rng.byte();
        }
        3 => {
            let last = inner.len() - 1;
            inner[last] = 0x80;
        }
        4 => inner.iter_mut().for_each(|b| *b = 0),
        _ => {}
    }
    inner
}

enum Case {
    /// A base's plaintext, changed: the base and the plaintext.
    Mutant(usize, Vec<u8>),
    /// A seed's stream, framed: the context, the clock, the seed, the
    /// plaintext.
    Random(usize, u64, u64, Vec<u8>),
    /// An authentic envelope.
    Keyed(usize),
    /// A reveal's bytes, changed: the context and the bytes.
    Reveal(usize, Vec<u8>),
}

/// Case `index` of `seed`. `rich` is the mix the export takes: more of the
/// authentic envelopes, which cost the most and are the same few each time.
fn make_case(setup: &Setup, seed: u64, index: u64, rich: bool) -> Case {
    let mut rng = Rng::new(seed ^ index.wrapping_mul(0x9e37_79b9_7f4a_7c15));
    let roll = rng.below(100);
    let (mutants, randoms, authentic) = if rich { (66, 90, 95) } else { (70, 94, 95) };
    if roll < mutants {
        let which = rng.below(setup.bases.len());
        let base = &setup.bases[which];
        let inner = unpadded(&base.padded);
        let fields = layout(inner);
        let others: Vec<&[u8]> = (0..4)
            .map(|_| unpadded(&rng.pick(&setup.bases).padded))
            .collect();
        let mut changed = inner.to_vec();
        // One change most often; none sometimes, so only the framing differs.
        let changes = match rng.below(10) {
            0 => 0,
            1..=6 => 1,
            7 | 8 => 2,
            _ => 3,
        };
        for _ in 0..changes {
            if changed.is_empty() {
                break;
            }
            change(&mut rng, &mut changed, &fields, setup, &others);
        }
        if setup.ctxs[base.ctx].bits == BITS && rng.chance(70) {
            restamp(&mut changed, inner);
        }
        Case::Mutant(which, frame(&mut rng, changed, base.padded.len()))
    } else if roll < randoms {
        let ctx = rng.pick(&setup.bases).ctx;
        let now = T + *rng.pick(&[60u64, 181, 300, 1001]);
        let len = match rng.below(100) {
            0..=44 => 512 - OVERHEAD,
            45..=74 => 2048 - OVERHEAD,
            75..=84 => 8192 - OVERHEAD,
            85..=88 => 32768 - OVERHEAD,
            89 => 65536,
            90..=93 => rng.below(400),
            94..=96 => rng.pick(&SIZES) - OVERHEAD + rng.below(3) - 1,
            _ => rng.below(65537),
        };
        let stream_seed = rng.word();
        let mut bytes = stream(stream_seed, len);
        let framing = rng.below(5);
        if framing >= 1 && len > 0 {
            // A valid padding: 0x80 then zeros from somewhere on.
            let end = if rng.chance(50) {
                len - 1 - rng.below(len.min(64))
            } else {
                rng.below(len)
            };
            bytes[end] = 0x80;
            bytes[end + 1..].iter_mut().for_each(|b| *b = 0);
            let other = unpadded(&rng.pick(&setup.bases).padded);
            if framing >= 2 && end >= 1 {
                bytes[0] = if framing == 4 { 1 } else { 2 };
            }
            if framing == 3 && end >= 73 {
                // A session message's frame: a cid, a valid point, counters.
                bytes[1..17].copy_from_slice(rng.pick(&setup.cids));
                bytes[17..65].copy_from_slice(rng.pick(&setup.points[..4]));
                bytes[65..69].copy_from_slice(&rng.pick(&COUNTERS).to_be_bytes());
                bytes[69..73].copy_from_slice(&rng.pick(&COUNTERS).to_be_bytes());
            }
            if framing == 4 && other[0] == 1 {
                // A real message's F, stamp and header, then the stream.
                let fields = layout(other);
                let salt = fields.iter().find(|f| f.kind == Kind::Salt).unwrap().at;
                if end > salt {
                    bytes[..salt].copy_from_slice(&other[..salt]);
                    if rng.chance(50) {
                        let n = rng.below(16) as u32;
                        bytes[salt - 4..salt].copy_from_slice(&n.to_be_bytes());
                    }
                }
            }
        }
        Case::Random(ctx, now, stream_seed, bytes)
    } else if roll < authentic {
        Case::Keyed(rng.below(setup.keyed.len()))
    } else {
        let (ctx, valid) = rng.pick(&setup.reveals);
        let mut bytes = valid.clone();
        let name = usize::from(bytes[0]);
        match rng.below(10) {
            0 => {}
            1 | 2 => {
                let at = rng.below(bytes.len());
                bytes[at] ^= 1 << rng.below(8);
            }
            3 => bytes[0] = *rng.pick(&[0u8, 1, 31, 32, 33, 255]),
            4 => {
                let at = 1 + name + 48 * rng.below(2);
                bytes[at..at + 48].copy_from_slice(rng.pick(&setup.points));
            }
            5 => {
                let at = 1 + name + 96 + 32 * rng.below(4);
                let value = special_scalar(&mut rng, &bytes[at..at + 32]);
                bytes[at..at + 32].copy_from_slice(&value);
            }
            6 => bytes.truncate(rng.below(bytes.len() + 1)),
            7 => {
                let extra = rng.below(40) + 1;
                bytes.extend_from_slice(&rng.bytes(extra));
            }
            8 => {
                let len = *rng.pick(&[0usize, 1, 225, 226, 227, 256, 257, 258, 300]);
                bytes = rng.bytes(len);
            }
            _ => {
                let len = rng.below(400);
                bytes = rng.bytes(len);
            }
        }
        Case::Reveal(*ctx, bytes)
    }
}

// ---------------------------------------------------------------------------
// The reader, as the wallet's bindings drive the crate: the scan, the
// opening, then `receive` on the records
// ---------------------------------------------------------------------------

struct Reader {
    key: SecretKey,
    handles: Vec<Handle>,
    inbox: Inbox,
    /// The records as they were, to see that a refusal changed none.
    conversations: Vec<Vec<u8>>,
    requests: Vec<u8>,
    tombstones: Vec<u8>,
}

impl Reader {
    fn new(ctx: &Ctx) -> Self {
        let inbox = ctx.inbox();
        Reader {
            key: ctx.party.key(),
            handles: ctx.party.handle_list(),
            conversations: inbox
                .conversations()
                .map(|c| c.to_bytes().to_vec())
                .collect(),
            requests: inbox.requests().to_bytes(),
            tombstones: inbox.tombstones().to_bytes(),
            inbox,
        }
    }

    fn unchanged(&self) -> bool {
        self.inbox.requests().to_bytes() == self.requests
            && self.inbox.tombstones().to_bytes() == self.tombstones
            && self
                .inbox
                .conversations()
                .map(|c| c.to_bytes().to_vec())
                .eq(self.conversations.iter().cloned())
    }

    /// `receive`'s answer in words, and whether the envelope was taken. A
    /// taken one's record is written as the bindings write it, and read back;
    /// then the reader is as it was, for the next case.
    fn receive(&mut self, ctx: &Ctx, envelope: &[u8], now: u64) -> (String, bool) {
        let received = match self.inbox.receive(&self.key, &self.handles, envelope, now) {
            Ok(received) => received,
            Err(error) => return (code(error), false),
        };
        let text = match &received {
            Received::Message { cid, plaintext } => {
                // The record's length: its bytes hold a fresh ratchet key
                // after a step.
                let record = self.inbox.conversation(*cid).unwrap().to_bytes();
                assert!(Conversation::from_bytes(&record).is_ok());
                let (cid, text, record) = (hex::encode(cid.0), plaintext.len(), record.len());
                format!("message:{cid}:{text}#{record}")
            }
            Received::Request {
                cid,
                plaintext,
                new,
                evicted,
            } => {
                // The requests' record holds only what arrived: the same
                // bytes anywhere, so its digest too.
                let record = self.inbox.requests().to_bytes();
                assert!(Requests::from_bytes(&record).is_ok());
                let digest = hex::encode(Sha256::digest(&record));
                format!(
                    "request:{}:{}:{new}:{}#{}#{}",
                    hex::encode(cid.0),
                    plaintext.len(),
                    evicted.len(),
                    record.len(),
                    &digest[..16]
                )
            }
        };
        self.inbox = ctx.inbox();
        (text, true)
    }

    /// The scan's digit, then the opening's kind and cid or its refusal.
    fn scan_and_open(&self, envelope: &[u8]) -> String {
        let scan = u8::from(matches_envelope(&self.key, envelope).unwrap_or(false));
        let opened = match open(&self.key, envelope) {
            Ok(opened) => {
                let first = opened.first_contact().is_some();
                let kind = if first { "first-contact" } else { "session" };
                format!("{kind}:{}", hex::encode(opened.cid().0))
            }
            Err(error) => code(error),
        };
        format!("{scan}|{opened}")
    }
}

/// A reveal's check at `conversation`: `ok` and the name, or the refusal.
fn check_reveal(conversation: &Conversation, bytes: &[u8]) -> String {
    let checked = Reveal::from_bytes(&chain(), bytes)
        .and_then(|reveal| conversation.verify_reveal(&reveal).map(|()| reveal));
    match checked {
        Ok(reveal) => format!("ok:{}", hex::encode(reveal.name())),
        Err(error) => code(error),
    }
}

#[derive(Default)]
struct Tally {
    cases: u64,
    by_kind: BTreeMap<&'static str, u64>,
    outcomes: BTreeMap<String, u64>,
    /// Cases by time: the key is the bits of its microseconds.
    times: BTreeMap<u32, u64>,
    slowest: Vec<(u128, String)>,
    findings: Vec<String>,
    unchanged_checks: u64,
}

impl Tally {
    fn time(&mut self, micros: u128, what: impl FnOnce() -> String) {
        *self
            .times
            .entry(128 - micros.max(1).leading_zeros())
            .or_default() += 1;
        if self.slowest.len() < 12 || micros > self.slowest.last().unwrap().0 {
            self.slowest.push((micros, what()));
            self.slowest.sort_by_key(|slow| std::cmp::Reverse(slow.0));
            self.slowest.truncate(12);
        }
    }

    fn merge(&mut self, other: Tally) {
        self.cases += other.cases;
        self.unchanged_checks += other.unchanged_checks;
        for (k, n) in other.by_kind {
            *self.by_kind.entry(k).or_default() += n;
        }
        for (k, n) in other.outcomes {
            *self.outcomes.entry(k).or_default() += n;
        }
        for (k, n) in other.times {
            *self.times.entry(k).or_default() += n;
        }
        self.slowest.extend(other.slowest);
        self.slowest.sort_by_key(|slow| std::cmp::Reverse(slow.0));
        self.slowest.truncate(12);
        self.findings.extend(other.findings);
    }

    fn report(&self, seconds: f64) -> String {
        let slowest: Vec<String> = self
            .slowest
            .iter()
            .map(|(micros, what)| format!("  {micros} us  {what}"))
            .collect();
        format!(
            "cases {} in {seconds:.1}s\nby kind {:?}\nrefusals compared with the records {}\noutcomes {:#?}\ntimes (bits of the microseconds: cases) {:?}\nslowest\n{}\nfindings {}\nresident kB {}\n",
            self.cases,
            self.by_kind,
            self.unchanged_checks,
            self.outcomes,
            self.times,
            slowest.join("\n"),
            self.findings.len(),
            resident_kb()
        )
    }
}

/// The process's resident memory on Linux, 0 elsewhere.
fn resident_kb() -> u64 {
    std::fs::read_to_string("/proc/self/statm")
        .ok()
        .and_then(|s| {
            s.split_whitespace()
                .nth(1)
                .and_then(|p| p.parse::<u64>().ok())
        })
        .map_or(0, |pages| pages * 4)
}

/// The head of an export: what a runner needs before the cases.
///
/// - `X <n> <json>`: context n ([`Ctx::json`]).
/// - `B <n> <hex>`: base n, a padded plaintext.
/// - `K <n> <context> <now> <hex>`: authentic envelope n.
///
/// The cases follow, one file a thread, each line ending in what the crate
/// answered: `<scan>|<opening>|<receive>` for an envelope (`-|-` where the
/// scan and the opening weren't asked), the check's answer for a reveal.
///
/// - `P <context> <now> <base> <length> <patches> <full> <answer>`: the base
///   cut or zero-filled to the length, then the patches (`offset:hex,...`)
///   over it, sealed with the context's `seal` (the header, then AES-256-GCM
///   of the plaintext under the key and nonce with the header as associated
///   data).
/// - `R <context> <now> <seed> <length> <patches> <full> <answer>`: the same
///   over [`stream`]'s bytes for the seed.
/// - `E <envelope> <full> <answer>`: authentic envelope n as it is.
/// - `V <context> <hex> <answer>`: a reveal, checked at the context's first
///   conversation.
fn export(dir: &str, setup: &Setup) {
    let mut head = std::fs::File::create(format!("{dir}/corpus.head.tsv")).unwrap();
    for (i, ctx) in setup.ctxs.iter().enumerate() {
        writeln!(head, "X\t{i}\t{}", ctx.json()).unwrap();
    }
    for (i, base) in setup.bases.iter().enumerate() {
        writeln!(head, "B\t{i}\t{}", hex::encode(&base.padded)).unwrap();
    }
    for (i, keyed) in setup.keyed.iter().enumerate() {
        let envelope = hex::encode(&keyed.envelope);
        writeln!(head, "K\t{i}\t{}\t{}\t{envelope}", keyed.ctx, keyed.now).unwrap();
    }
}

#[test]
fn sealed_plaintext_a_stranger_chose_is_refused_without_a_panic() {
    if let Ok(path) = std::env::var("SOAK_REPLAY") {
        return replay(&path);
    }
    let cases = env_u64("SOAK_CASES", 2_000);
    let seed = env_u64("SOAK_SEED", 1);
    let threads = env_u64("SOAK_THREADS", 2).max(1);
    let out_dir = std::env::var("SOAK_OUT").ok();
    let exported = if out_dir.is_some() {
        env_u64("SOAK_EXPORT", 0)
    } else {
        0
    };
    let started = Instant::now();
    let setup = build();
    println!(
        "seed {seed}, {cases} cases; setup: {} contexts, {} bases, {} authentic envelopes, in {:.1}s",
        setup.ctxs.len(),
        setup.bases.len(),
        setup.keyed.len(),
        started.elapsed().as_secs_f64()
    );

    // Every authentic envelope is answered as written beside it, once,
    // before anything is mutated.
    let mut wrong = Vec::new();
    for keyed in &setup.keyed {
        let ctx = &setup.ctxs[keyed.ctx];
        let (outcome, _) = Reader::new(ctx).receive(ctx, &keyed.envelope, keyed.now);
        if outcome.split([':', '#']).next() != Some(keyed.expect) {
            wrong.push(format!(
                "{} [{}]: {} was expected, {outcome} came\nreplay: {}",
                keyed.note,
                ctx.name,
                keyed.expect,
                replay_line(ctx, keyed.now, Some(&keyed.envelope), None)
            ));
        }
    }
    assert!(
        wrong.is_empty(),
        "authentic envelopes answered otherwise:\n{}",
        wrong.join("\n")
    );

    if let (Some(dir), true) = (&out_dir, exported > 0) {
        export(dir, &setup);
    }
    let total = Mutex::new(Tally::default());
    std::thread::scope(|scope| {
        for worker in 0..threads {
            let (setup, total, out_dir) = (&setup, &total, &out_dir);
            scope.spawn(move || {
                let mut tally = Tally::default();
                let mut readers: Vec<Option<Reader>> = setup.ctxs.iter().map(|_| None).collect();
                let mut corpus = out_dir.as_ref().filter(|_| exported > 0).map(|dir| {
                    let file = std::fs::File::create(format!("{dir}/corpus.w{worker}.tsv"));
                    std::io::BufWriter::new(file.unwrap())
                });
                let mut reported = 0;
                let mut index = worker;
                while index < cases {
                    let export = index < exported;
                    if !export {
                        // The export is whole: a runner can start on it.
                        if let Some(mut done) = corpus.take() {
                            done.flush().unwrap();
                        }
                    }
                    let case = make_case(setup, seed, index, export);
                    // Some cases go through the scan and the opening as well:
                    // one in four of an export's, one in sixteen after.
                    let full = index % if export { 8 } else { 32 } < 2;
                    let (ctx_index, now, envelope, kind) = match &case {
                        Case::Mutant(base, plaintext) => {
                            let base = &setup.bases[*base];
                            let seal = &setup.ctxs[base.ctx].party.seal;
                            (base.ctx, base.now, seal.seal(plaintext), "mutant")
                        }
                        Case::Random(ctx, now, _, plaintext) => {
                            let seal = &setup.ctxs[*ctx].party.seal;
                            (*ctx, *now, seal.seal(plaintext), "random")
                        }
                        Case::Keyed(k) => {
                            let keyed = &setup.keyed[*k];
                            (keyed.ctx, keyed.now, keyed.envelope.clone(), "authentic")
                        }
                        Case::Reveal(ctx, _) => (*ctx, 0, Vec::new(), "reveal"),
                    };
                    let stranger = matches!(case, Case::Mutant(..) | Case::Random(..));
                    let ctx = &setup.ctxs[ctx_index];
                    let reader = readers[ctx_index].get_or_insert_with(|| Reader::new(ctx));
                    let began = Instant::now();
                    let answer = catch_unwind(AssertUnwindSafe(|| {
                        if let Case::Reveal(_, bytes) = &case {
                            let conversation = reader.inbox.conversations().next().unwrap();
                            return (check_reveal(conversation, bytes), false, String::new());
                        }
                        let first = if full {
                            reader.scan_and_open(&envelope)
                        } else {
                            "-|-".to_string()
                        };
                        let (outcome, taken) = reader.receive(ctx, &envelope, now);
                        (outcome, taken, first)
                    }));
                    let micros = began.elapsed().as_micros();
                    // Everything the case read, to read it again.
                    let finding = |what: &str| {
                        let line = match &case {
                            Case::Reveal(_, bytes) => replay_line(ctx, now, None, Some(bytes)),
                            _ => replay_line(ctx, now, Some(&envelope), None),
                        };
                        format!(
                            "{what}: case {index} of seed {seed} ({kind}) in [{}]\nreplay: {line}",
                            ctx.name
                        )
                    };
                    tally.cases += 1;
                    *tally.by_kind.entry(kind).or_default() += 1;
                    let line = match answer {
                        Err(_) => {
                            tally.findings.push(finding("PANIC"));
                            readers[ctx_index] = None;
                            "panic".to_string()
                        }
                        Ok((outcome, taken, first)) => {
                            if stranger && taken {
                                let what = format!("A STRANGER'S ENVELOPE TAKEN ({outcome})");
                                tally.findings.push(finding(&what));
                            }
                            // A refusal changes no record: compared for one
                            // refusal in 32.
                            if !taken && kind != "reveal" && index % 64 < 2 {
                                tally.unchanged_checks += 1;
                                if !reader.unchanged() {
                                    let what = format!("A RECORD CHANGED BY A REFUSAL ({outcome})");
                                    tally.findings.push(finding(&what));
                                    readers[ctx_index] = None;
                                }
                            }
                            let class = outcome.split([':', '#']).next().unwrap();
                            *tally.outcomes.entry(format!("{kind} {class}")).or_default() += 1;
                            if kind == "reveal" {
                                outcome
                            } else {
                                format!("{first}|{outcome}")
                            }
                        }
                    };
                    tally.time(micros, || {
                        format!("{line} (case {index}, {kind}) in [{}]", ctx.name)
                    });
                    if let Some(corpus) = corpus.as_mut() {
                        let full = u8::from(full);
                        match &case {
                            Case::Mutant(base, plaintext) => writeln!(
                                corpus,
                                "P\t{ctx_index}\t{now}\t{base}\t{}\t{}\t{full}\t{line}",
                                plaintext.len(),
                                patches(&setup.bases[*base].padded, plaintext),
                            ),
                            Case::Random(_, _, stream_seed, plaintext) => writeln!(
                                corpus,
                                "R\t{ctx_index}\t{now}\t{stream_seed}\t{}\t{}\t{full}\t{line}",
                                plaintext.len(),
                                patches(&stream(*stream_seed, plaintext.len()), plaintext),
                            ),
                            Case::Keyed(k) => writeln!(corpus, "E\t{k}\t{full}\t{line}"),
                            Case::Reveal(_, bytes) => {
                                writeln!(corpus, "V\t{ctx_index}\t{}\t{line}", hex::encode(bytes))
                            }
                        }
                        .unwrap();
                    }
                    // Findings as they come, and the tallies every 50,000
                    // cases: a run that is stopped still says what it reached.
                    if let Some(dir) = out_dir {
                        if tally.findings.len() > reported {
                            let mut file = std::fs::OpenOptions::new()
                                .create(true)
                                .append(true)
                                .open(format!("{dir}/findings.{seed}.txt"))
                                .unwrap();
                            for finding in &tally.findings[reported..] {
                                writeln!(file, "{finding}").unwrap();
                            }
                            reported = tally.findings.len();
                        }
                        if tally.cases.is_multiple_of(50_000) {
                            let report = tally.report(started.elapsed().as_secs_f64());
                            let path = format!("{dir}/progress.{seed}.w{worker}.txt");
                            std::fs::write(path, report).unwrap();
                        }
                    }
                    index += threads;
                }
                total.lock().unwrap().merge(tally);
            });
        }
    });
    let tally = total.into_inner().unwrap();
    print!("{}", tally.report(started.elapsed().as_secs_f64()));
    assert!(
        tally.findings.is_empty(),
        "{} findings; the first:\n{}",
        tally.findings.len(),
        tally.findings[0]
    );
}

/// Two wallets write to each other for a while, with messages dropped,
/// delayed, repeated, and re-sealed by a stranger with a change. Every
/// record is written and read again after each call, as the wallet does.
/// Nothing panics, and nothing a stranger sealed is taken.
#[test]
fn a_long_conversation_with_a_stranger_in_the_middle() {
    if std::env::var("SOAK_REPLAY").is_ok() {
        return;
    }
    let steps = env_u64("SOAK_WALK", 300);
    let seed = env_u64("SOAK_SEED", 1);
    println!("walk: seed {seed}, {steps} steps");
    let started = Instant::now();
    let mut rng = Rng::new(seed ^ 0x0057_a1e5);
    let name = b"walker".to_vec();
    let bob_x = SecretKey::from_bytes(&key_bytes("walk bob's seedelf key")).unwrap();
    let parties = [
        Party::new(key_bytes("walk alice"), Vec::new()),
        Party::new(
            key_bytes("walk bob"),
            vec![HandleDef::own(&name, vec![bob_x.register()])],
        ),
    ];
    let keys = [parties[0].key(), parties[1].key()];
    let handles = [parties[0].handle_list(), parties[1].handle_list()];
    let mut inboxes = [Inbox::new(), Inbox::new()];
    inboxes[1].set_first_contact_bits(BITS);
    let mut now = T;
    let bobs_seedelf = Seedelf::new(chain(), &name, bob_x.register()).unwrap();
    let to_bob = certified(&bob_x, &keys[1], &bobs_seedelf);
    let cid = inboxes[0].start(&keys[0], &to_bob, now).unwrap();
    stamp(&mut inboxes[0], cid, BITS);
    // What the mutator puts in: this conversation's cid, a valid point, and
    // neither.
    let pool = Setup {
        cids: vec![cid.0, [0u8; 16]],
        points: vec![keys[0].register().public_value_bytes(), [0u8; 48]],
        ..Setup::default()
    };
    // The reader and the envelope of each message on its way.
    let mut network: Vec<(usize, Vec<u8>)> = Vec::new();
    let mut accepted = false;
    let (mut sent, mut taken, mut refused, mut resealed) = (0u64, 0u64, 0u64, 0u64);
    let mut outcomes: BTreeMap<String, u64> = BTreeMap::new();
    // The records written and read again, as the wallet keeps them.
    let stored = |inbox: &Inbox| {
        let conversations = inbox
            .conversations()
            .map(|c| Conversation::from_bytes(&c.to_bytes()).unwrap())
            .collect();
        let requests = Requests::from_bytes(&inbox.requests().to_bytes()).unwrap();
        let tombstones = Tombstones::from_bytes(&inbox.tombstones().to_bytes()).unwrap();
        let mut back = Inbox::from_parts(conversations, requests, tombstones).unwrap();
        back.set_first_contact_bits(BITS);
        back
    };
    // One envelope read by wallet `to`. A panic, or a stranger's envelope
    // taken, fails the test with everything the call read.
    let read = |inbox: &mut Inbox, to: usize, envelope: &[u8], now: u64, step: u64, own: bool| {
        let before = Ctx::of("the walk's reader", &parties[to], inbox, BITS);
        let answer = catch_unwind(AssertUnwindSafe(|| {
            inbox.receive(&keys[to], &handles[to], envelope, now)
        }));
        let replay = || replay_line(&before, now, Some(envelope), None);
        match answer {
            Err(_) => panic!("step {step} of seed {seed}: a panic\nreplay: {}", replay()),
            Ok(Ok(received)) if !own => panic!(
                "step {step} of seed {seed}: a stranger's envelope taken ({received:?})\nreplay: {}",
                replay()
            ),
            Ok(answer) => answer.map(|_| ()),
        }
    };
    for step in 0..steps {
        now += rng.below(40) as u64;
        if rng.chance(1) {
            now += H48 / 4;
        }
        match rng.below(100) {
            // A message, or a run of them of which the last few are kept.
            0..=34 => {
                let from = if accepted { rng.below(2) } else { 0 };
                let run = match rng.below(40) {
                    0 => 1 + rng.below(1100),
                    1..=4 => 1 + rng.below(30),
                    _ => 1,
                };
                for i in 0..run {
                    let len = match rng.below(20) {
                        0 => rng.below(8000),
                        1 => 0,
                        _ => rng.below(200),
                    };
                    match inboxes[from].send(cid, &rng.bytes(len)) {
                        Ok(envelope) => {
                            sent += 1;
                            if run - i <= 3 || rng.chance(2) {
                                network.push((1 - from, envelope));
                            }
                        }
                        Err(error) => {
                            *outcomes.entry(format!("send {}", code(error))).or_default() += 1
                        }
                    }
                }
            }
            // A delivery, in any order, sometimes kept to come again.
            35..=79 if !network.is_empty() => {
                let at = rng.below(network.len());
                let (to, envelope) = if rng.chance(15) {
                    network[at].clone()
                } else {
                    network.swap_remove(at)
                };
                match read(&mut inboxes[to], to, &envelope, now, step, true) {
                    Ok(()) => taken += 1,
                    Err(error) => {
                        refused += 1;
                        *outcomes
                            .entry(format!("refused {}", code(error)))
                            .or_default() += 1;
                    }
                }
                inboxes[to] = stored(&inboxes[to]);
            }
            // A stranger opens nothing, but the other side can: its message
            // with a change, sealed again to the reader.
            80..=93 if !network.is_empty() => {
                let (to, envelope) = network[rng.below(network.len())].clone();
                let padded =
                    decrypt_message(&keys[to], &Envelope::from_bytes(&envelope).unwrap()).unwrap();
                let inner = unpadded(&padded);
                let mut changed = inner.to_vec();
                if rng.chance(85) {
                    change(&mut rng, &mut changed, &layout(inner), &pool, &[inner]);
                }
                let plaintext = frame(&mut rng, changed, padded.len());
                let sealed = parties[to].seal.seal(&plaintext);
                resealed += 1;
                let error = read(&mut inboxes[to], to, &sealed, now, step, false).unwrap_err();
                *outcomes
                    .entry(format!("re-sealed {}", code(error)))
                    .or_default() += 1;
            }
            // The reader replies to the request.
            94..=96 if !accepted && inboxes[1].requests().get(cid).is_some() => {
                inboxes[1].accept(&keys[1], cid).unwrap();
                accepted = true;
            }
            97..=99 => {
                for inbox in &mut inboxes {
                    inbox.expire(now);
                    *inbox = stored(inbox);
                }
            }
            _ => {}
        }
        if network.len() > 400 {
            network.drain(..200);
        }
    }
    println!(
        "walk: {:.1}s, {sent} sent, {taken} taken, {refused} refused, {resealed} re-sealed by a stranger and refused; resident kB {}",
        started.elapsed().as_secs_f64(),
        resident_kb()
    );
    for (outcome, n) in &outcomes {
        println!("  {outcome}\t{n}");
    }
}
