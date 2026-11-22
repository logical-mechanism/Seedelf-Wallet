//! The verified reveal (docs/protocol.md §19): who may make and take one, its
//! bytes, every way a reveal fails, the reader's own forgery that keeps it
//! deniable, and the vectors (tests/vectors/messaging_reveal_v1.json).

use std::path::PathBuf;

use blstrs::{G1Projective, Scalar};
use group::Curve;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::support::{Seeded, handle, identity, key, off_curve, opened, outside_g1, start};
use crate::keys::scalar_mod_q;
use crate::register::Register;
use crate::session::conversation::Conversation;
use crate::session::draw::Draw;
use crate::session::first_contact::Handle;
use crate::session::reveal::{
    Commitments, REVEAL_LABEL, REVEAL_MAX_LEN, REVEAL_MIN_LEN, Reveal, RevealProof, Statement,
};
use crate::{Error, SecretKey};

const VECTORS: &str = "tests/vectors/messaging_reveal_v1.json";

/// The kind byte a reveal's plaintext starts with (docs/protocol.md §18).
const KIND_REVEAL: u8 = 0x02;

const NOW: u64 = 1_800_000_000;

/// q, BLS12-381's scalar field order, big-endian: no scalar in a reveal reaches it.
const GROUP_ORDER: &str = "73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001";

fn recording() -> bool {
    std::env::var("RECORD_MESSAGING_REVEAL_VECTORS").as_deref() == Ok("1")
}

fn hex(bytes: impl AsRef<[u8]>) -> String {
    hex::encode(bytes)
}

/// A conversation from `alice` to `bob`'s handle, answered: Alice's first
/// message, Bob's reply, and Alice reading it. Both sides, each as it's kept.
fn answered(
    alice: &SecretKey,
    bob: &SecretKey,
    bob_handle: &Register,
    label: &str,
) -> (Conversation, Conversation) {
    let mut draw = Seeded::new(label);
    let mut a = start(alice, bob_handle, NOW, &mut draw);
    let first = a.send_with(b"hello", &mut draw).unwrap();
    let (mut b, _) =
        Conversation::accept_with(bob, &[(&opened(bob, &first), NOW)], &mut draw).unwrap();
    let reply = b.send_with(b"hi", &mut draw).unwrap();
    a.receive_with(&opened(alice, &reply), NOW + 60, &mut draw)
        .unwrap();
    assert!(!a.sends_first_contact());
    (a, b)
}

/// A Seedelf's 32-byte asset name: the prefix, a tag, an output index and
/// the rest of a transaction ID, here a label's hash.
fn seedelf_name(tag: &str) -> Vec<u8> {
    let mut name = vec![0x5e, 0xed, 0x0e, 0x1f];
    name.extend_from_slice(tag.as_bytes());
    name.push(0);
    let rest = Sha256::digest(format!("{tag}'s seedelf tx").as_bytes());
    name.extend_from_slice(&rest[..32 - name.len()]);
    name
}

fn seedelf(name: &[u8], register: Register) -> Handle {
    Handle::new(name, register).unwrap()
}

/// The register a Seedelf of `key_label`'s holds, under its own generator.
fn seedelf_register(key_label: &str) -> Register {
    handle(key_label, &format!("{key_label}'s seedelf"))
}

/// The reader's own reveal of any Seedelf: branch 2 proved with its key `y`,
/// branch 1 simulated. Draws `k₂`, then `c₁`, then `z₁`. It verifies, which
/// is why a reveal convinces no one but the reader.
fn forge(
    reader: &Conversation,
    y: &Scalar,
    shown: &Handle,
    draw: &mut dyn Draw,
) -> (Reveal, Commitments) {
    let k = draw.scalar();
    let c1 = draw.scalar();
    let z1 = draw.scalar();
    forge_with(reader, y, shown, k, c1, z1)
}

/// [`forge`] with its values given: `c₁ = z₁ = 0` puts T₁ and T₁′ at O.
fn forge_with(
    reader: &Conversation,
    y: &Scalar,
    shown: &Handle,
    k: Scalar,
    c1: Scalar,
    z1: Scalar,
) -> (Reveal, Commitments) {
    let statement = Statement::of(reader, shown);
    let simulated = statement.commitments_of(&RevealProof {
        c1,
        c2: Scalar::from(0u64),
        z1,
        z2: Scalar::from(0u64),
    });
    let commitments = Commitments {
        t1: simulated.t1,
        t1_seedelf: simulated.t1_seedelf,
        t2: (G1Projective::from(statement.base) * k).to_affine(),
    };
    let c = scalar_mod_q(&statement.challenge(&commitments));
    let c2 = c - c1;
    let proof = RevealProof {
        c1,
        c2,
        z1,
        z2: k + c2 * y,
    };
    (
        Reveal {
            seedelf: shown.clone(),
            proof,
        },
        commitments,
    )
}

/// The parties of the unit tests: Alice wrote first to Bob's handle, and Bob
/// replied.
struct Parties {
    alice: SecretKey,
    bob: SecretKey,
    a: Conversation,
    b: Conversation,
}

fn parties(label: &str) -> Parties {
    let (alice, bob) = (key("alice"), key("bob"));
    let (a, b) = answered(&alice, &bob, &handle("bob", "bob's handle"), label);
    Parties { alice, bob, a, b }
}

fn alices_seedelf() -> Handle {
    seedelf(&seedelf_name("alice"), seedelf_register("alice"))
}

#[test]
fn the_initiator_reveals_once_answered_and_the_reader_checks_it() {
    let p = parties("reveal round trip");
    let shown = alices_seedelf();
    let reveal = p.a.reveal(&p.alice, &shown).unwrap();
    assert_eq!(reveal.name(), shown.name());
    assert_eq!(reveal.register(), shown.register());
    let bytes = reveal.to_bytes();
    assert_eq!(bytes.len(), REVEAL_MAX_LEN);
    let read = Reveal::from_bytes(&bytes).unwrap();
    assert_eq!(read, reveal);
    assert_eq!(p.b.verify_reveal(&read), Ok(()));
    // A fresh proof each time, each verifying.
    let again = p.a.reveal(&p.alice, &shown).unwrap();
    assert_ne!(again.to_bytes(), bytes);
    assert_eq!(p.b.verify_reveal(&again), Ok(()));
    // Any register of the key: the root one under a 1-byte name, the shortest.
    let root = seedelf(b"a", p.alice.register());
    let short = p.a.reveal(&p.alice, &root).unwrap().to_bytes();
    assert_eq!(short.len(), REVEAL_MIN_LEN);
    assert_eq!(
        p.b.verify_reveal(&Reveal::from_bytes(&short).unwrap()),
        Ok(())
    );
}

#[test]
fn only_the_initiator_reveals_and_only_once_a_reply_has_decrypted() {
    let alice = key("alice");
    let mut draw = Seeded::new("reveal too soon");
    let a = start(&alice, &handle("bob", "bob's handle"), NOW, &mut draw);
    // Before a reply, Alice's messages are first-contact messages: none reveals.
    assert_eq!(
        a.reveal(&alice, &alices_seedelf()).err(),
        Some(Error::RevealNotAllowed)
    );
    let p = parties("reveal by the responder");
    let bobs = seedelf(&seedelf_name("bob"), seedelf_register("bob"));
    assert_eq!(
        p.b.reveal(&p.bob, &bobs).err(),
        Some(Error::RevealNotAllowed)
    );
}

#[test]
fn a_reveal_names_a_seedelf_of_the_key_and_the_key_is_the_conversations() {
    let p = parties("reveal of another's");
    // Bob's Seedelf, which Alice's key doesn't hold.
    let bobs = seedelf(&seedelf_name("bob"), seedelf_register("bob"));
    assert_eq!(
        p.a.reveal(&p.alice, &bobs).err(),
        Some(Error::NotForThisKey)
    );
    // Carol's key, which isn't this conversation's, with Carol's own Seedelf.
    let carol = key("carol");
    let carols = seedelf(&seedelf_name("carol"), seedelf_register("carol"));
    assert_eq!(
        p.a.reveal(&carol, &carols).err(),
        Some(Error::NotForThisKey)
    );
}

#[test]
fn the_initiator_takes_no_reveal() {
    let p = parties("reveal checked by the initiator");
    let reveal = p.a.reveal(&p.alice, &alices_seedelf()).unwrap();
    assert_eq!(p.a.verify_reveal(&reveal), Err(Error::RevealNotAllowed));
    // Bob could make one for any Seedelf with his own key: at Alice's side, it
    // would verify, and prove nothing.
    let mut draw = Seeded::new("forged at the initiator");
    let bobs = seedelf(&seedelf_name("bob"), seedelf_register("bob"));
    let (forged, _) = forge(&p.b, &p.bob.scalar(), &bobs, &mut draw);
    assert_eq!(p.b.verify_reveal(&forged), Ok(()));
    assert_eq!(p.a.verify_reveal(&forged), Err(Error::RevealNotAllowed));
}

#[test]
fn the_reader_can_make_one_itself_so_it_convinces_no_one_else() {
    let p = parties("reveal forged");
    let mut draw = Seeded::new("forged by the reader");
    // Carol's Seedelf, which neither side holds.
    let carols = seedelf(&seedelf_name("carol"), seedelf_register("carol"));
    let (forged, _) = forge(&p.b, &p.bob.scalar(), &carols, &mut draw);
    let read = Reveal::from_bytes(&forged.to_bytes()).unwrap();
    assert_eq!(p.b.verify_reveal(&read), Ok(()));
    // Without the reader's key, the same simulation doesn't verify.
    let (wrong, _) = forge(&p.b, &key("mallory").scalar(), &carols, &mut draw);
    assert_eq!(p.b.verify_reveal(&wrong), Err(Error::InvalidReveal));
}

#[test]
fn a_proof_with_the_wrong_witness_fails() {
    let p = parties("reveal wrong witness");
    let mut draw = Seeded::new("wrong witness");
    // Alice's key for Bob's Seedelf: branch 1's relation doesn't hold.
    let bobs = seedelf(&seedelf_name("bob"), seedelf_register("bob"));
    let (proof, _) = Statement::of(&p.a, &bobs).prove_seedelf(&p.alice.scalar(), &mut draw);
    let reveal = Reveal {
        seedelf: bobs,
        proof,
    };
    assert_eq!(p.b.verify_reveal(&reveal), Err(Error::InvalidReveal));
}

#[test]
fn a_reveal_is_bound_to_its_conversation_name_and_register() {
    let p = parties("reveal bound");
    let shown = alices_seedelf();
    let reveal = p.a.reveal(&p.alice, &shown).unwrap();
    // Another conversation between the same two keys.
    let (_, other) = answered(
        &p.alice,
        &p.bob,
        &handle("bob", "bob's handle"),
        "reveal bound, another",
    );
    assert_eq!(other.verify_reveal(&reveal), Err(Error::InvalidReveal));
    // Another name with the same register.
    let mut renamed = reveal.clone();
    let mut name = shown.name().to_vec();
    name[31] ^= 1;
    renamed.seedelf = seedelf(&name, *shown.register());
    assert_eq!(p.b.verify_reveal(&renamed), Err(Error::InvalidReveal));
    // Another register of the same key, under the same name.
    let mut moved = reveal.clone();
    let two = Scalar::from(2u64);
    moved.seedelf = seedelf(
        shown.name(),
        Register::from_checked(
            (shown.register().generator() * two).to_affine(),
            (shown.register().public_value() * two).to_affine(),
        ),
    );
    assert_eq!(p.b.verify_reveal(&moved), Err(Error::InvalidReveal));
    // Each share and response moved.
    let one = Scalar::from(1u64);
    let changes: [fn(&mut RevealProof, Scalar); 6] = [
        |r: &mut RevealProof, one: Scalar| r.c1 += one,
        |r: &mut RevealProof, one: Scalar| r.c2 += one,
        |r: &mut RevealProof, one: Scalar| r.z1 += one,
        |r: &mut RevealProof, one: Scalar| r.z2 += one,
        |r: &mut RevealProof, _| std::mem::swap(&mut r.c1, &mut r.c2),
        |r: &mut RevealProof, _| std::mem::swap(&mut r.z1, &mut r.z2),
    ];
    for change in changes {
        let mut changed = reveal.clone();
        change(&mut changed.proof, one);
        assert_eq!(p.b.verify_reveal(&changed), Err(Error::InvalidReveal));
    }
}

#[test]
fn no_single_bit_changed_reads_as_a_reveal() {
    let p = parties("reveal bits");
    let bytes = p.a.reveal(&p.alice, &alices_seedelf()).unwrap().to_bytes();
    for i in 0..bytes.len() * 8 {
        let mut changed = bytes.clone();
        changed[i / 8] ^= 1 << (i % 8);
        let verdict = Reveal::from_bytes(&changed).and_then(|r| p.b.verify_reveal(&r));
        assert!(verdict.is_err(), "bit {i} changed still verifies");
    }
}

#[test]
fn reveals_that_dont_parse_are_refused() {
    let p = parties("reveal parse");
    let bytes = p.a.reveal(&p.alice, &alices_seedelf()).unwrap().to_bytes();
    for (case, expected) in malformed(&bytes) {
        assert_eq!(
            Reveal::from_bytes(&case.1).err(),
            Some(expected),
            "{}",
            case.0
        );
    }
    assert_eq!(Reveal::from_bytes(&[]).err(), Some(Error::InvalidMessage));
}

/// A reveal's bytes broken each way parsing refuses, with what it's refused
/// as. `bytes` names a 32-byte Seedelf.
fn malformed(bytes: &[u8]) -> Vec<((&'static str, Vec<u8>), Error)> {
    let name_end = 1 + 32;
    let (g_at, u_at) = (name_end, name_end + 48);
    let proof_at = u_at + 48;
    let q: [u8; 32] = hex::decode(GROUP_ORDER).unwrap().try_into().unwrap();
    let with = |at: usize, value: &[u8]| {
        let mut out = bytes.to_vec();
        out[at..at + value.len()].copy_from_slice(value);
        out
    };
    let mut empty_name = vec![0u8];
    empty_name.extend_from_slice(&bytes[name_end..]);
    // The length is read first: an empty name is refused as one before g_S is read, here off the curve.
    let mut empty_then_off = empty_name.clone();
    empty_then_off[1..49].copy_from_slice(&off_curve());
    let mut long_name = vec![33u8];
    long_name.extend_from_slice(&bytes[1..name_end]);
    long_name.push(0);
    long_name.extend_from_slice(&bytes[name_end..]);
    let mut longer = bytes.to_vec();
    longer.push(0);
    vec![
        (
            ("c₁ not below the group order", with(proof_at, &q)),
            Error::InvalidMessage,
        ),
        (
            ("z₂ all ones", with(proof_at + 96, &[0xff; 32])),
            Error::InvalidMessage,
        ),
        (
            ("g_S outside G1", with(g_at, &outside_g1())),
            Error::NotInSubgroup,
        ),
        (
            ("u_S the identity", with(u_at, &identity())),
            Error::IdentityPoint,
        ),
        (
            ("g_S off the curve", with(g_at, &off_curve())),
            Error::InvalidEncoding,
        ),
        (("an empty name", empty_name), Error::InvalidMessage),
        (
            (
                "an empty name, then g_S off the curve: the name is read first",
                empty_then_off,
            ),
            Error::InvalidMessage,
        ),
        (("a 33-byte name", long_name), Error::InvalidMessage),
        (("one byte more", longer), Error::InvalidMessage),
        (
            ("one byte less", bytes[..bytes.len() - 1].to_vec()),
            Error::InvalidMessage,
        ),
    ]
}

#[test]
fn checking_changes_nothing() {
    let p = parties("reveal changes nothing");
    let reveal = p.a.reveal(&p.alice, &alices_seedelf()).unwrap();
    let (a_before, b_before) = (p.a.to_bytes(), p.b.to_bytes());
    p.b.verify_reveal(&reveal).unwrap();
    assert_eq!(p.a.to_bytes(), a_before);
    assert_eq!(p.b.to_bytes(), b_before);
}

#[test]
fn a_reveal_fits_a_session_message() {
    let p = parties("reveal fits");
    let mut a = p.a.clone();
    let plaintext_len = 1 + REVEAL_MAX_LEN;
    assert!(plaintext_len <= a.max_text_len());
    let mut plaintext = vec![KIND_REVEAL];
    plaintext.extend_from_slice(&a.reveal(&p.alice, &alices_seedelf()).unwrap().to_bytes());
    let envelope = a.send(&plaintext).unwrap();
    // 257 bytes and the kind byte: a 2 KiB envelope, as every reply of 246 bytes or more.
    assert_eq!(envelope.len(), 2048);
    let mut b = p.b.clone();
    let read = b.receive(&opened(&p.bob, &envelope), NOW + 120).unwrap();
    assert_eq!(read, plaintext);
    assert_eq!(
        b.verify_reveal(&Reveal::from_bytes(&read[1..]).unwrap()),
        Ok(())
    );
}

// ---------------------------------------------------------------------------
// The vectors
// ---------------------------------------------------------------------------

/// The code a refusal goes by in the vectors: the variant's name in snake
/// case, as seedelf-wasm names it.
pub(crate) fn code(error: Error) -> &'static str {
    match error {
        Error::InvalidReveal => "invalid_reveal",
        Error::RevealNotAllowed => "reveal_not_allowed",
        Error::InvalidMessage => "invalid_message",
        Error::InvalidEncoding => "invalid_encoding",
        Error::NotInSubgroup => "not_in_subgroup",
        Error::IdentityPoint => "identity_point",
        other => panic!("no vector refuses with {other:?}"),
    }
}

fn conversation_json(
    name: &str,
    alice: &SecretKey,
    bob: &SecretKey,
    a: &Conversation,
    b: &Conversation,
) -> Value {
    json!({
        "name": name,
        "initiator_secret_key": hex(alice.scalar().to_bytes_be()),
        "responder_secret_key": hex(bob.scalar().to_bytes_be()),
        "cid": hex(a.cid().0),
        "base": hex(a.first.base.to_compressed()),
        "initiator_public": hex(a.first.initiator.to_compressed()),
        "responder_public": hex(a.responder.to_compressed()),
        "initiator_state": hex(&*a.to_bytes()),
        "responder_state": hex(&*b.to_bytes()),
    })
}

fn reveal_json(
    name: &str,
    conversation: usize,
    made_by: &str,
    draws: Value,
    statement: &Statement<'_>,
    commitments: &Commitments,
    reveal: &Reveal,
) -> Value {
    let challenge = statement.challenge(commitments);
    assert_eq!(
        scalar_mod_q(&challenge),
        reveal.proof.c1 + reveal.proof.c2,
        "the shares add up to the challenge"
    );
    let bytes = reveal.to_bytes();
    let mut plaintext = vec![KIND_REVEAL];
    plaintext.extend_from_slice(&bytes);
    json!({
        "name": name,
        "conversation": conversation,
        "made_by": made_by,
        "seedelf": {
            "name": hex(reveal.name()),
            "generator": hex(reveal.register().generator_bytes()),
            "public_value": hex(reveal.register().public_value_bytes()),
        },
        "draws": draws,
        "commitments": {
            "t1": hex(commitments.t1.to_compressed()),
            "t1_seedelf": hex(commitments.t1_seedelf.to_compressed()),
            "t2": hex(commitments.t2.to_compressed()),
        },
        "challenge": hex(challenge),
        "challenge_scalar": hex(scalar_mod_q(&challenge).to_bytes_be()),
        "proof": {
            "c1": hex(reveal.proof.c1.to_bytes_be()),
            "c2": hex(reveal.proof.c2.to_bytes_be()),
            "z1": hex(reveal.proof.z1.to_bytes_be()),
            "z2": hex(reveal.proof.z2.to_bytes_be()),
        },
        "reveal": hex(&bytes),
        "plaintext": hex(&plaintext),
    })
}

fn draws_json(names: [&str; 3], drawn: Vec<Vec<u8>>) -> Value {
    assert_eq!(drawn.len(), 3);
    json!({ names[0]: hex(&drawn[0]), names[1]: hex(&drawn[1]), names[2]: hex(&drawn[2]) })
}

fn check(
    name: &str,
    conversation: usize,
    side: &str,
    reveal: &[u8],
    sides: &[(&Conversation, &Conversation)],
) -> Value {
    let (a, b) = sides[conversation];
    let at = if side == "initiator" { a } else { b };
    let result = match Reveal::from_bytes(reveal).and_then(|r| at.verify_reveal(&r)) {
        Ok(()) => "ok",
        Err(error) => code(error),
    };
    json!({ "name": name, "conversation": conversation, "side": side, "reveal": hex(reveal), "result": result })
}

fn all_vectors() -> Value {
    let alice = key("seedelf-messaging reveal v1 alice");
    let bob = key("seedelf-messaging reveal v1 bob");
    let bob_handle = handle("seedelf-messaging reveal v1 bob", "bob's handle");
    let (a0, b0) = answered(&alice, &bob, &bob_handle, "reveal v1 conversation 0");
    let (a1, b1) = answered(&alice, &bob, &bob_handle, "reveal v1 conversation 1");
    let sides = [(&a0, &b0), (&a1, &b1)];

    // 0: Alice's Seedelf, under its full 32-byte name.
    let alices = seedelf(
        &seedelf_name("alice"),
        handle("seedelf-messaging reveal v1 alice", "alice's seedelf"),
    );
    let mut draw = Seeded::new("reveal v1 reveal 0");
    let statement = Statement::of(&a0, &alices);
    let (proof, commitments) = statement.prove_seedelf(&alice.scalar(), &mut draw);
    let full = Reveal {
        seedelf: alices.clone(),
        proof,
    };
    assert_eq!(
        a0.reveal_with(&alice, &alices, &mut Seeded::new("reveal v1 reveal 0")),
        Ok(full.clone())
    );
    let first = reveal_json(
        "Alice's Seedelf under its full 32-byte name",
        0,
        "initiator",
        draws_json(["k1", "c2", "z2"], draw.drain()),
        &statement,
        &commitments,
        &full,
    );

    // 1: the root register, under a 1-byte name.
    let root = seedelf(b"a", alice.register());
    let mut draw = Seeded::new("reveal v1 reveal 1");
    let statement = Statement::of(&a0, &root);
    let (proof, commitments) = statement.prove_seedelf(&alice.scalar(), &mut draw);
    let short = Reveal {
        seedelf: root.clone(),
        proof,
    };
    let second = reveal_json(
        "Alice's root register under a 1-byte name",
        0,
        "initiator",
        draws_json(["k1", "c2", "z2"], draw.drain()),
        &statement,
        &commitments,
        &short,
    );

    // 2: Carol's Seedelf, made by the reader with its own key.
    let carols = seedelf(
        &seedelf_name("carol"),
        handle("seedelf-messaging reveal v1 carol", "carol's seedelf"),
    );
    let mut draw = Seeded::new("reveal v1 reveal 2");
    let (forged, commitments) = forge(&b0, &bob.scalar(), &carols, &mut draw);
    let third = reveal_json(
        "Carol's Seedelf, made by the reader with its own key",
        0,
        "responder",
        draws_json(["k2", "c1", "z1"], draw.drain()),
        &Statement::of(&b0, &carols),
        &commitments,
        &forged,
    );

    let bytes = full.to_bytes();
    let changed = |f: &dyn Fn(&mut Reveal)| {
        let mut r = full.clone();
        f(&mut r);
        r.to_bytes()
    };
    let mut checks = vec![
        check("reveal 0, at the reader", 0, "responder", &bytes, &sides),
        check(
            "reveal 1, at the reader",
            0,
            "responder",
            &short.to_bytes(),
            &sides,
        ),
        check(
            "reveal 2, made by the reader, at the reader",
            0,
            "responder",
            &forged.to_bytes(),
            &sides,
        ),
        check(
            "reveal 0, at the side that wrote first",
            0,
            "initiator",
            &bytes,
            &sides,
        ),
        check(
            "reveal 2, at the side that wrote first",
            0,
            "initiator",
            &forged.to_bytes(),
            &sides,
        ),
        check(
            "reveal 0, in another conversation of the same two keys",
            1,
            "responder",
            &bytes,
            &sides,
        ),
        check(
            "reveal 0 under another name",
            0,
            "responder",
            &changed(&|r| {
                let mut name = r.seedelf.name().to_vec();
                name[31] ^= 1;
                r.seedelf = seedelf(&name, *r.seedelf.register());
            }),
            &sides,
        ),
        check(
            "reveal 0 for another register of the same key, [2](g_S, u_S)",
            0,
            "responder",
            &changed(&|r| {
                let two = Scalar::from(2u64);
                let register = *r.seedelf.register();
                r.seedelf = seedelf(
                    r.seedelf.name(),
                    Register::from_checked(
                        (register.generator() * two).to_affine(),
                        (register.public_value() * two).to_affine(),
                    ),
                );
            }),
            &sides,
        ),
        check(
            "reveal 0 with c₁ + 1",
            0,
            "responder",
            &changed(&|r| r.proof.c1 += Scalar::from(1u64)),
            &sides,
        ),
        check(
            "reveal 0 with c₁ and c₂ swapped",
            0,
            "responder",
            &changed(&|r| std::mem::swap(&mut r.proof.c1, &mut r.proof.c2)),
            &sides,
        ),
        check(
            "reveal 0 with z₁ and z₂ swapped",
            0,
            "responder",
            &changed(&|r| std::mem::swap(&mut r.proof.z1, &mut r.proof.z2)),
            &sides,
        ),
    ];
    // Bob's Seedelf, proved with Alice's key: branch 1's relation doesn't hold.
    let bobs = seedelf(
        &seedelf_name("bob"),
        handle("seedelf-messaging reveal v1 bob", "bob's seedelf"),
    );
    let (wrong, _) = Statement::of(&a0, &bobs)
        .prove_seedelf(&alice.scalar(), &mut Seeded::new("reveal v1 wrong"));
    checks.push(check(
        "Bob's Seedelf, proved with Alice's key",
        0,
        "responder",
        &Reveal {
            seedelf: bobs,
            proof: wrong,
        }
        .to_bytes(),
        &sides,
    ));
    // The reader's own, with c₁ = z₁ = 0: T₁ and T₁′ are O, hashed as O's compressed encoding.
    let zero = Scalar::from(0u64);
    let (at_identity, commitments) =
        forge_with(&b0, &bob.scalar(), &alices, Scalar::from(7u64), zero, zero);
    assert_eq!(commitments.t1, blstrs::G1Affine::default());
    checks.push(check(
        "made by the reader with c₁ = z₁ = 0, so T₁ and T₁′ are O",
        0,
        "responder",
        &at_identity.to_bytes(),
        &sides,
    ));
    for ((name, case), _) in malformed(&bytes) {
        checks.push(check(name, 0, "responder", &case, &sides));
    }

    json!({
        "version": 1,
        "description": "Seedelf Messaging's verified reveal (docs/protocol.md §19): an OR-proof that the Seedelf's register and the initiator's identity share a key, or that the prover knows the responder's. The conversations' states are this crate's own (§16.5), for its public-API test; another implementation needn't read them.",
        "label": String::from_utf8(REVEAL_LABEL.to_vec()).unwrap(),
        "kind": KIND_REVEAL,
        "group_order": GROUP_ORDER,
        "conversations": [
            conversation_json("Alice wrote first to Bob's handle, and has his reply", &alice, &bob, &a0, &b0),
            conversation_json("another conversation of the same two keys", &alice, &bob, &a1, &b1),
        ],
        "reveals": [first, second, third],
        "checks": checks,
    })
}

/// The vectors file is what the code computes. `RECORD_MESSAGING_REVEAL_VECTORS=1`
/// rewrites it, for a deliberate change of format only: other
/// implementations are held to these bytes. It never touches the other
/// vectors files.
#[test]
fn reveal_vectors_match_the_file() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(VECTORS);
    let computed = all_vectors();
    if recording() {
        let text = serde_json::to_string_pretty(&computed).expect("serializes") + "\n";
        std::fs::write(&path, text).expect("writes the vectors");
    }
    let recorded: Value =
        serde_json::from_str(&std::fs::read_to_string(&path).expect("reads the vectors"))
            .expect("parses the vectors");
    assert_eq!(computed, recorded);
}

#[test]
fn the_seedelf_names_are_whole_names() {
    for tag in ["alice", "bob", "carol"] {
        let name = seedelf_name(tag);
        assert_eq!(name.len(), 32);
        assert_eq!(&name[..4], &[0x5e, 0xed, 0x0e, 0x1f]);
    }
    assert_eq!(
        scalar_mod_q(&hex::decode(GROUP_ORDER).unwrap()),
        Scalar::from(0u64)
    );
}
