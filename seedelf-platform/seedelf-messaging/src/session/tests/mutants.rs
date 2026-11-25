//! Every proof the vectors hold, mutated, through the three verifiers: the
//! base proof ([`FirstContact::proves_base`]), the keys proof
//! ([`FirstContact::proves_keys`]) and the reveal
//! ([`Conversation::verify_reveal`]). None may verify (docs/protocol.md
//! §16.2, §19).
//!
//! **Where the set comes from.** For the 1.10.0 gate an independent verifier,
//! written from the spec, was given these mutations of the 13 distinct proofs
//! in tests/vectors (5 base, 4 keys, 4 reveal), and refused all 749,621
//! (2026-11-23). The same 749,621 then went through the three verifiers here,
//! and the two agreed on every one, on the refusal and on its kind: 711,666
//! fail the proof's equation, and 37,955 don't parse or hold a point that
//! doesn't decode (2026-11-24). This test makes the set again and holds the
//! crate to those counts.
//!
//! **The mutations**, of each proof and of everything it's checked against:
//!
//! - every byte of the proof's scalars, set to each of its 255 other values;
//! - the statement: each byte of F's head (and, for a keys proof, of the
//!   base proof before it), of a reveal's name and its length, and of a
//!   conversation ID, set to each of its 255 other values; each point (F's
//!   p₀, A and E_A, the handle's two, w₀, S_A, a reveal's register, a
//!   conversation's identities) with its first byte set to each of its 255
//!   other values and each other byte with bit 0, then bit 7, flipped;
//! - s + q for each of the proof's scalars;
//! - c₁ + d with c₂ − d, for d from 1 to 32, where a proof has two shares:
//!   the same sum, other commitments.
//!
//! `MUTANTS_EVERY` runs one mutant in that many of the first two kinds, the
//! sweeps, which are nearly all of them: 64 by default. The last two kinds
//! are 441 mutants in all, and each is its own class: one scalar's s + q is
//! the only mutant a verifier that reduced that scalar mod q would take, and
//! one in 64 skipped nearly every one (1.10.0's second review: with
//! `Reveal::from_bytes` reducing its scalars, the default run passed). So
//! every one of them runs whatever `MUTANTS_EVERY` is: 12,150 mutants by
//! default, about 8 s on two threads at the test profile. A gate runs them
//! all and holds the counts above (8 min 14 s there, 2026-11-24):
//!
//! ```text
//! MUTANTS_EVERY=1 cargo test -p seedelf-messaging --lib session::tests::mutants \
//!     -- --nocapture
//! ```

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use blstrs::Scalar;
use serde_json::Value;

use crate::Error;
use crate::register::{Register, decode_point};
use crate::session::conversation::{Conversation, Role};
use crate::session::first_contact::FirstContact;
use crate::session::reveal::Reveal;

const SESSION_VECTORS: &str = "tests/vectors/messaging_session_v1.json";
const REVEAL_VECTORS: &str = "tests/vectors/messaging_reveal_v1.json";

/// q, BLS12-381's scalar field order, big-endian.
const GROUP_ORDER: &str = "73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001";

/// The mutants of the vectors' 13 proofs, and how they fail: what the
/// independent verifier and this crate both counted.
const MUTANTS: usize = 749_621;
const FAIL_THE_EQUATION: usize = 711_666;
const DONT_PARSE: usize = 37_955;

/// The threads the mutants are shared between.
const THREADS: usize = 2;

/// A proof and everything it's checked against, each a field of bytes.
enum Case {
    /// The handle's `g` and `v`, then F.
    Base,
    /// F, then the reader's w₀ and the first ratchet key S_A.
    Keys,
    /// The conversation's ID, p₀, A and w₀, then the reveal.
    Reveal(Box<Conversation>),
}

struct Proof {
    case: Case,
    name: String,
    fields: Vec<Vec<u8>>,
}

/// What a verifier said of one input.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Verdict {
    Verifies,
    /// It parsed, and the proof's equation doesn't hold.
    Equation,
    /// It didn't parse, or a point of it doesn't decode.
    Refused,
}

impl Verdict {
    fn of(verifies: bool) -> Self {
        if verifies {
            Verdict::Verifies
        } else {
            Verdict::Equation
        }
    }
}

/// A mutant: one field of its proof, with bytes written over it at offsets,
/// and whether it's one of the rare kinds ([`scalar_tricks`]), which every
/// run takes.
type Mutant<'a> = (usize, &'a [(usize, &'a [u8])], bool);

fn point(bytes: &[u8]) -> &[u8; 48] {
    bytes.try_into().expect("a point's 48 bytes")
}

/// The base proof of F for the handle `(g, v)`.
fn base_proof(g: &[u8], v: &[u8], f: &[u8]) -> Result<Verdict, Error> {
    let first = FirstContact::from_bytes(f)?;
    let handle = Register::from_bytes(point(g), point(v))?;
    Ok(Verdict::of(first.proves_base(&handle)))
}

/// The keys proof of F for the reader's w₀ and the first ratchet key S_A.
fn keys_proof(f: &[u8], w0: &[u8], s: &[u8]) -> Result<Verdict, Error> {
    let first = FirstContact::from_bytes(f)?;
    let responder = decode_point(point(w0))?;
    let ratchet = decode_point(point(s))?;
    Ok(Verdict::of(first.proves_keys(&responder, &ratchet)))
}

/// A reveal at the reader's conversation, with the identities given.
fn reveal_proof(reader: &Conversation, fields: &[Vec<u8>]) -> Result<Verdict, Error> {
    let mut reader = reader.clone();
    reader.first.cid.0 = fields[0].as_slice().try_into().expect("a cid's 16 bytes");
    reader.first.base = decode_point(point(&fields[1]))?;
    reader.first.initiator = decode_point(point(&fields[2]))?;
    reader.responder = decode_point(point(&fields[3]))?;
    let reveal = Reveal::from_bytes(&fields[4])?;
    match reader.verify_reveal(&reveal) {
        Ok(()) => Ok(Verdict::Verifies),
        Err(Error::InvalidReveal) => Ok(Verdict::Equation),
        Err(error) => Err(error),
    }
}

impl Proof {
    /// The verifier's verdict on `fields`: this proof's, or a mutant's.
    fn verdict(&self, fields: &[Vec<u8>]) -> Verdict {
        let checked = match &self.case {
            Case::Base => base_proof(&fields[0], &fields[1], &fields[2]),
            Case::Keys => keys_proof(&fields[0], &fields[1], &fields[2]),
            Case::Reveal(reader) => reveal_proof(reader, fields),
        };
        checked.unwrap_or(Verdict::Refused)
    }

    /// Every mutant of this proof, in a fixed order.
    fn mutants(&self, emit: &mut dyn FnMut(Mutant)) {
        match self.case {
            Case::Base => {
                let (g, v, f) = (&self.fields[0], &self.fields[1], &self.fields[2]);
                let (head, _) = head(f);
                let proof = head + 3 * 48;
                for k in 0..4 {
                    sweep(emit, 2, f, proof + 32 * k, 32, true);
                }
                sweep(emit, 2, f, 0, head, true);
                for k in 0..3 {
                    sweep(emit, 2, f, head + 48 * k, 48, false);
                }
                sweep(emit, 0, g, 0, 48, false);
                sweep(emit, 1, v, 0, 48, false);
                let scalars: Vec<usize> = (0..4).map(|k| proof + 32 * k).collect();
                scalar_tricks(emit, 2, f, &scalars, true);
            }
            Case::Keys => {
                let (f, w0, s) = (&self.fields[0], &self.fields[1], &self.fields[2]);
                let (head, from_handle) = head(f);
                let base_proof = head + 3 * 48;
                let (proof, count) = if from_handle {
                    (base_proof + 4 * 32, 6)
                } else {
                    (base_proof, 3)
                };
                for k in 0..count {
                    sweep(emit, 0, f, proof + 32 * k, 32, true);
                }
                sweep(emit, 0, f, 0, head, true);
                for k in 0..3 {
                    sweep(emit, 0, f, head + 48 * k, 48, false);
                }
                if from_handle {
                    sweep(emit, 0, f, base_proof, 4 * 32, true);
                }
                sweep(emit, 1, w0, 0, 48, false);
                sweep(emit, 2, s, 0, 48, false);
                let scalars: Vec<usize> = (0..count).map(|k| proof + 32 * k).collect();
                scalar_tricks(emit, 0, f, &scalars, from_handle);
            }
            Case::Reveal(_) => {
                let reveal = &self.fields[4];
                let name = usize::from(reveal[0]);
                let proof = reveal.len() - 4 * 32;
                for k in 0..4 {
                    sweep(emit, 4, reveal, proof + 32 * k, 32, true);
                }
                sweep(emit, 4, reveal, 0, 1, true);
                sweep(emit, 4, reveal, 1, name, true);
                sweep(emit, 4, reveal, 1 + name, 48, false);
                sweep(emit, 4, reveal, 1 + name + 48, 48, false);
                sweep(emit, 0, &self.fields[0], 0, 16, true);
                for (field, identity) in self.fields.iter().enumerate().take(4).skip(1) {
                    sweep(emit, field, identity, 0, 48, false);
                }
                let scalars: Vec<usize> = (0..4).map(|k| proof + 32 * k).collect();
                scalar_tricks(emit, 4, reveal, &scalars, true);
            }
        }
    }
}

/// The length of F's head, `cid (16) | t (8) | len | to | len | replaces`,
/// and whether it names a handle.
fn head(f: &[u8]) -> (usize, bool) {
    let to = usize::from(f[24]);
    let replaces = usize::from(f[25 + to]);
    (26 + to + replaces, to > 0)
}

/// `len` bytes of field `field` from `start`, one changed at a time: to each
/// of its 255 other values (`all`, and a point's first byte), or with bit 0,
/// then bit 7, flipped (a point's other bytes).
fn sweep(
    emit: &mut dyn FnMut(Mutant),
    field: usize,
    bytes: &[u8],
    start: usize,
    len: usize,
    all: bool,
) {
    for (at, &original) in bytes.iter().enumerate().skip(start).take(len) {
        if all || at == start {
            for value in (0..=255u8).filter(|&value| value != original) {
                emit((field, &[(at, &[value])], false));
            }
        } else {
            emit((field, &[(at, &[original ^ 0x01])], false));
            emit((field, &[(at, &[original ^ 0x80])], false));
        }
    }
}

/// s + q for each scalar of field `field` at `scalars`, 32 bytes still; then,
/// for a proof with two shares, c₁ + d with c₂ − d for d from 1 to 32. The
/// rare kinds: a few dozen a proof, each one run by every run.
fn scalar_tricks(
    emit: &mut dyn FnMut(Mutant),
    field: usize,
    bytes: &[u8],
    scalars: &[usize],
    shares: bool,
) {
    let q = hex::decode(GROUP_ORDER).unwrap();
    for &at in scalars {
        let mut sum = [0u8; 32];
        let mut carry = 0u16;
        for i in (0..32).rev() {
            let digit = u16::from(bytes[at + i]) + u16::from(q[i]) + carry;
            sum[i] = digit as u8;
            carry = digit >> 8;
        }
        assert_eq!(carry, 0, "s + q is below 2²⁵⁶");
        emit((field, &[(at, &sum)], true));
    }
    if shares {
        let (c1, c2) = (scalars[0], scalars[1]);
        let scalar = |at: usize| -> Scalar {
            let bytes: &[u8; 32] = bytes[at..at + 32].try_into().unwrap();
            Option::from(Scalar::from_bytes_be(bytes)).expect("a proof's scalar")
        };
        for d in 1..=32u64 {
            let up = (scalar(c1) + Scalar::from(d)).to_bytes_be();
            let down = (scalar(c2) - Scalar::from(d)).to_bytes_be();
            emit((field, &[(c1, &up), (c2, &down)], true));
        }
    }
}

fn vectors(file: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(file);
    serde_json::from_str(&std::fs::read_to_string(path).expect("reads the vectors")).unwrap()
}

fn bytes(value: &Value) -> Vec<u8> {
    hex::decode(value.as_str().unwrap()).unwrap()
}

/// The vectors' distinct proofs: each (handle, F) whose base proof verifies,
/// each session's keys proof with its reader's w₀ and its first ratchet key,
/// and each (conversation, reveal) that verifies at the reader.
fn proofs() -> Vec<Proof> {
    let sessions = vectors(SESSION_VECTORS);
    let reveals = vectors(REVEAL_VECTORS);
    let mut proofs: Vec<Proof> = Vec::new();
    let mut add = |case: Case, name: String, fields: Vec<Vec<u8>>| {
        if !proofs.iter().any(|held| held.fields == fields) {
            proofs.push(Proof { case, name, fields });
        }
    };
    let base = |x: &Value| {
        vec![
            bytes(&x["handle"]["generator"]),
            bytes(&x["handle"]["public_value"]),
            bytes(&x["first_contact"]),
        ]
    };
    let list = sessions["sessions"].as_array().unwrap();
    for (i, session) in list.iter().enumerate() {
        if !session["handle"].is_null() {
            add(
                Case::Base,
                format!("session {i}'s base proof"),
                base(session),
            );
        }
    }
    let checks = sessions["base_proof_checks"].as_array().unwrap();
    for (i, check) in checks.iter().enumerate() {
        if check["result"] == "ok" {
            add(Case::Base, format!("base check {i}"), base(check));
        }
    }
    for (i, session) in list.iter().enumerate() {
        let fields = vec![
            bytes(&session["first_contact"]),
            bytes(&session["responder_public"]),
            bytes(&session["ratchet_public"]),
        ];
        add(Case::Keys, format!("session {i}'s keys proof"), fields);
    }
    let conversations = reveals["conversations"].as_array().unwrap();
    let reveal = |x: &Value| {
        let held = &conversations[x["conversation"].as_u64().unwrap() as usize];
        // The reader's side, as its vector stores it.
        let reader = Conversation::from_bytes(&bytes(&held["responder_state"])).unwrap();
        assert_eq!(reader.role, Role::Responder);
        let fields = vec![
            bytes(&held["cid"]),
            bytes(&held["base"]),
            bytes(&held["initiator_public"]),
            bytes(&held["responder_public"]),
            bytes(&x["reveal"]),
        ];
        (Case::Reveal(Box::new(reader)), fields)
    };
    for (i, x) in reveals["reveals"].as_array().unwrap().iter().enumerate() {
        let (case, fields) = reveal(x);
        add(case, format!("reveal {i}"), fields);
    }
    for (i, x) in reveals["checks"].as_array().unwrap().iter().enumerate() {
        if x["result"] == "ok" && x["side"] == "responder" {
            let (case, fields) = reveal(x);
            add(case, format!("reveal check {i}"), fields);
        }
    }
    proofs
}

#[test]
fn no_mutant_of_a_vector_proof_verifies() {
    let every: usize = std::env::var("MUTANTS_EVERY")
        .ok()
        .and_then(|every| every.parse().ok())
        .filter(|&every| every > 0)
        .unwrap_or(64);
    let proofs = proofs();
    // Every mutant, and those this run takes: one sweep mutant in `every`,
    // and each of the rare kinds.
    let (mut total, mut taken, mut rare) = (0usize, 0usize, 0usize);
    for proof in &proofs {
        // Each proof verifies as the vectors hold it. For a reveal that's
        // with the stored conversation's own identities, which are the
        // vector's, so a mutant's are the only ones that differ.
        assert_eq!(
            proof.verdict(&proof.fields),
            Verdict::Verifies,
            "{}",
            proof.name
        );
        if let Case::Reveal(reader) = &proof.case {
            assert_eq!(reader.first.cid.0, proof.fields[0][..]);
            assert_eq!(reader.first.base.to_compressed(), proof.fields[1][..]);
            assert_eq!(reader.first.initiator.to_compressed(), proof.fields[2][..]);
            assert_eq!(reader.responder.to_compressed(), proof.fields[3][..]);
        }
        let before = (total, rare);
        proof.mutants(&mut |(_, _, is_rare)| {
            taken += usize::from(is_rare || total.is_multiple_of(every));
            rare += usize::from(is_rare);
            total += 1;
        });
        println!(
            "{}: {} mutants, {} of them s + q or a share moved",
            proof.name,
            total - before.0,
            rare - before.1
        );
        // No proof is without its rare kinds: an s + q for each scalar.
        assert!(rare - before.1 >= 3, "{}", proof.name);
    }
    println!(
        "{} proofs, {total} mutants: one in {every} run, and each of the {rare} rare ones, {taken} in all",
        proofs.len()
    );

    let (equation, refused) = (AtomicUsize::new(0), AtomicUsize::new(0));
    std::thread::scope(|scope| {
        for thread in 0..THREADS {
            let (proofs, equation, refused) = (&proofs, &equation, &refused);
            scope.spawn(move || {
                // Each thread walks every mutant and runs its share of those
                // the run takes.
                let (mut index, mut chosen) = (0usize, 0usize);
                for proof in proofs {
                    proof.mutants(&mut |(field, patches, is_rare)| {
                        let takes = is_rare || index.is_multiple_of(every);
                        let mine = takes && chosen % THREADS == thread;
                        index += 1;
                        chosen += usize::from(takes);
                        if !mine {
                            return;
                        }
                        let mut fields = proof.fields.clone();
                        for (at, bytes) in patches {
                            fields[field][*at..*at + bytes.len()].copy_from_slice(bytes);
                        }
                        let count = match proof.verdict(&fields) {
                            Verdict::Verifies => panic!(
                                "a mutant of {} verifies: field {field} with {:?}",
                                proof.name,
                                patches
                                    .iter()
                                    .map(|(at, bytes)| (at, hex::encode(bytes)))
                                    .collect::<Vec<_>>()
                            ),
                            Verdict::Equation => equation,
                            Verdict::Refused => refused,
                        };
                        count.fetch_add(1, Ordering::Relaxed);
                    });
                }
            });
        }
    });
    let (equation, refused) = (equation.into_inner(), refused.into_inner());
    println!("{equation} fail the equation, {refused} don't parse, none verifies");
    assert_eq!(equation + refused, taken);
    assert!(taken >= rare && rare > 0);
    if every == 1 {
        assert_eq!(proofs.len(), 13);
        assert_eq!((total, taken), (MUTANTS, MUTANTS));
        assert_eq!((equation, refused), (FAIL_THE_EQUATION, DONT_PARSE));
    }
}
