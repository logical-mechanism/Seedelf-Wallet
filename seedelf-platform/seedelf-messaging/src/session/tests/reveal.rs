//! The verified reveal (docs/protocol.md §19, as §21.9 makes it): who may
//! make and take one, its bytes, every way a reveal fails, the reader's own
//! forgery that keeps it deniable, and the vectors
//! (tests/vectors/messaging_reveal_v1.json).
//!
//! A reveal shows a Seedelf (its chain, name and datum register (g_S, u_S),
//! the Seedelf key x's) and proves its messaging register M_S = (h_S, m_S),
//! the messaging key x_m's, on the base h_S the reader computes from the
//! Seedelf under its own chain. x makes no part of it.

use std::path::PathBuf;

use blstrs::{G1Projective, Scalar};
use group::Curve;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::support::{
    Seeded, Stuck, datum_register, handle, identity, key, off_curve, opened, outside_g1, spend_key,
    start, test_chain, test_policy,
};
use crate::keys::scalar_mod_q;
use crate::register::{Register, matches_register};
use crate::session::conversation::Conversation;
use crate::session::draw::{Draw, hedge_okm};
use crate::session::reveal::{
    BRANCH_READER, BRANCH_SEEDELF, Commitments, REVEAL_LABEL, REVEAL_MAX_LEN, REVEAL_MIN_LEN,
    REVEAL_NONCE_LABEL, Reveal, RevealProof, Statement,
};
use crate::session::seedelf::{Chain, HANDLE_BASE_DST, Handle, NETWORK_MAINNET, Seedelf};
use crate::{Error, SecretKey};

const VECTORS: &str = "tests/vectors/messaging_reveal_v1.json";

/// The kind byte a reveal's plaintext starts with (docs/protocol.md §18).
const KIND_REVEAL: u8 = 0x02;

const NOW: u64 = 1_800_000_000;

/// q, BLS12-381's scalar field order, big-endian: no scalar in a reveal reaches it.
const GROUP_ORDER: &str = "73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001";

/// p, BLS12-381's base field modulus, big-endian: no point's x reaches it.
const FIELD_MODULUS: &str = "1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab";

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

/// A Seedelf under the tests' chain.
fn seedelf(name: &[u8], register: Register) -> Seedelf {
    Seedelf::new(test_chain(), name, register).unwrap()
}

/// The datum register a Seedelf of `key_label`'s holds, under its own
/// generator: its Seedelf key's, never its messaging key's.
fn seedelf_register(key_label: &str) -> Register {
    datum_register(key_label, &format!("{key_label}'s seedelf"))
}

/// `key_label`'s Seedelf under its full name, and its handle, M_S with
/// `key_label`'s messaging key: what that wallet reveals.
fn seedelf_handle(key_label: &str) -> Handle {
    seedelf(&seedelf_name(key_label), seedelf_register(key_label))
        .handle(&key(key_label))
        .unwrap()
}

/// A reveal from its bytes, read under the tests' chain.
fn read(bytes: &[u8]) -> Result<Reveal, Error> {
    Reveal::from_bytes(&test_chain(), bytes)
}

/// `bytes` with `value` written at `at`.
fn with_bytes(bytes: &[u8], at: usize, value: &[u8]) -> Vec<u8> {
    let mut out = bytes.to_vec();
    out[at..at + value.len()].copy_from_slice(value);
    out
}

/// Where a reveal of a 32-byte name holds g_S, u_S, m_S and the proof.
const G_AT: usize = 1 + 32;
const U_AT: usize = G_AT + 48;
const M_AT: usize = U_AT + 48;
const PROOF_AT: usize = M_AT + 48;

/// The reader's own reveal of any Seedelf: branch 2 proved with its key `y`,
/// branch 1 simulated. Draws `c₁`, then `z₁`, then `aux`, and derives `k₂`
/// from them, `y` and the statement, as the writer's `k₁` is (§19.2). It
/// verifies, which is why a reveal convinces no one but the reader.
fn forge(
    reader: &Conversation,
    y: &Scalar,
    shown: &Handle,
    draw: &mut dyn Draw,
) -> (Reveal, Commitments) {
    let (k, c1, z1) = Statement::of(reader, shown).hedged_nonce(y, BRANCH_READER, draw);
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
    seedelf_handle("alice")
}

#[test]
fn the_initiator_reveals_once_answered_and_the_reader_checks_it() {
    let p = parties("reveal round trip");
    let shown = alices_seedelf();
    let reveal = p.a.reveal(&p.alice, &shown).unwrap();
    assert_eq!(reveal.name(), shown.name());
    assert_eq!(reveal.handle(), &shown);
    assert_eq!(reveal.register(), shown.seedelf().register());
    assert_eq!(reveal.messaging_register(), shown.register());
    // Two keys: the Seedelf's register is the Seedelf key's, the messaging
    // register the messaging key's, and neither is the other's.
    assert!(matches_register(&spend_key("alice"), reveal.register()));
    assert!(matches_register(&p.alice, reveal.messaging_register()));
    assert!(!matches_register(&p.alice, reveal.register()));
    assert!(!matches_register(
        &spend_key("alice"),
        reveal.messaging_register()
    ));
    let bytes = reveal.to_bytes();
    assert_eq!(bytes.len(), REVEAL_MAX_LEN);
    let read_back = read(&bytes).unwrap();
    assert_eq!(read_back, reveal);
    assert_eq!(p.b.verify_reveal(&read_back), Ok(()));
    // A fresh proof each time, each verifying.
    let again = p.a.reveal(&p.alice, &shown).unwrap();
    assert_ne!(again.to_bytes(), bytes);
    assert_eq!(p.b.verify_reveal(&again), Ok(()));
    // Any Seedelf of the wallet's: one at the Seedelf key's root register
    // under a 1-byte name, the shortest.
    let root = seedelf(b"a", spend_key("alice").register())
        .handle(&p.alice)
        .unwrap();
    let short = p.a.reveal(&p.alice, &root).unwrap().to_bytes();
    assert_eq!(short.len(), REVEAL_MIN_LEN);
    assert_eq!(p.b.verify_reveal(&read(&short).unwrap()), Ok(()));
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
    let bobs = seedelf_handle("bob");
    assert_eq!(
        p.b.reveal(&p.bob, &bobs).err(),
        Some(Error::RevealNotAllowed)
    );
}

#[test]
fn a_reveal_names_a_seedelf_of_the_key_and_the_key_is_the_conversations() {
    let p = parties("reveal of another's");
    // Bob's Seedelf, which Alice's key doesn't hold.
    let bobs = seedelf_handle("bob");
    assert_eq!(
        p.a.reveal(&p.alice, &bobs).err(),
        Some(Error::NotForThisKey)
    );
    // Carol's key, which isn't this conversation's, with Carol's own Seedelf.
    let carol = key("carol");
    let carols = seedelf_handle("carol");
    assert_eq!(
        p.a.reveal(&carol, &carols).err(),
        Some(Error::NotForThisKey)
    );
    // Alice's own Seedelf, with a messaging register that isn't her
    // messaging key's: taken with her Seedelf key, the wrong one of her two.
    let alice_spend = spend_key("alice");
    let on_the_seedelf_key = seedelf(&seedelf_name("alice"), seedelf_register("alice"))
        .handle(&alice_spend)
        .unwrap();
    assert_eq!(
        p.a.reveal(&p.alice, &on_the_seedelf_key).err(),
        Some(Error::NotForThisKey)
    );
    // And the Seedelf key in the messaging key's place: A isn't its.
    assert_eq!(
        p.a.reveal(&alice_spend, &on_the_seedelf_key).err(),
        Some(Error::NotForThisKey)
    );
    assert_eq!(
        p.a.reveal(&alice_spend, &alices_seedelf()).err(),
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
    let bobs = seedelf_handle("bob");
    let (forged, _) = forge(&p.b, &p.bob.scalar(), &bobs, &mut draw);
    assert_eq!(p.b.verify_reveal(&forged), Ok(()));
    assert_eq!(p.a.verify_reveal(&forged), Err(Error::RevealNotAllowed));
}

#[test]
fn the_reader_can_make_one_itself_so_it_convinces_no_one_else() {
    let p = parties("reveal forged");
    let mut draw = Seeded::new("forged by the reader");
    // Carol's Seedelf, which neither side holds.
    let carols = seedelf_handle("carol");
    let (forged, _) = forge(&p.b, &p.bob.scalar(), &carols, &mut draw);
    let read_back = read(&forged.to_bytes()).unwrap();
    assert_eq!(p.b.verify_reveal(&read_back), Ok(()));
    // Without the reader's key, the same simulation doesn't verify.
    let (wrong, _) = forge(&p.b, &key("mallory").scalar(), &carols, &mut draw);
    assert_eq!(p.b.verify_reveal(&wrong), Err(Error::InvalidReveal));
}

#[test]
fn a_proof_with_the_wrong_witness_fails() {
    let p = parties("reveal wrong witness");
    let mut draw = Seeded::new("wrong witness");
    // Alice's key for Bob's Seedelf: branch 1's relation doesn't hold.
    let bobs = seedelf_handle("bob");
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
    let bytes = reveal.to_bytes();
    // Another name with the same registers, as the reader reads it: h_S is
    // the new name's, so m_S is on no base the proof is for.
    let mut name = shown.name().to_vec();
    name[31] ^= 1;
    let renamed = read(&with_bytes(&bytes, 1 + 31, &name[31..])).unwrap();
    assert_eq!(renamed.name(), &name[..]);
    assert_eq!(renamed.register(), reveal.register());
    assert_ne!(
        renamed.messaging_register().generator_bytes(),
        reveal.messaging_register().generator_bytes()
    );
    assert_eq!(p.b.verify_reveal(&renamed), Err(Error::InvalidReveal));
    // The renamed Seedelf with its own messaging register, the key's: the
    // proof is another statement's.
    let renamed_own = Reveal {
        seedelf: seedelf(&name, *shown.seedelf().register())
            .handle(&p.alice)
            .unwrap(),
        proof: reveal.proof,
    };
    assert_eq!(p.b.verify_reveal(&renamed_own), Err(Error::InvalidReveal));
    // Another register of the same key, under the same name: [2](g_S, u_S),
    // with m_S kept, and with the moved Seedelf's own.
    let two = Scalar::from(2u64);
    let datum = shown.seedelf().register();
    let moved_register = Register::from_checked(
        (datum.generator() * two).to_affine(),
        (datum.public_value() * two).to_affine(),
    );
    let moved = read(&with_bytes(&bytes, G_AT, &moved_register.to_bytes())).unwrap();
    assert_eq!(moved.register(), &moved_register);
    assert_eq!(p.b.verify_reveal(&moved), Err(Error::InvalidReveal));
    let moved_own = Reveal {
        seedelf: seedelf(shown.name(), moved_register)
            .handle(&p.alice)
            .unwrap(),
        proof: reveal.proof,
    };
    assert_eq!(p.b.verify_reveal(&moved_own), Err(Error::InvalidReveal));
    // Another m_S on the same h_S: [2]m_S, whose log isn't A's.
    let doubled = (shown.register().public_value() * two).to_compressed();
    let other_m = read(&with_bytes(&bytes, M_AT, &doubled)).unwrap();
    assert_eq!(p.b.verify_reveal(&other_m), Err(Error::InvalidReveal));
    // Read under another chain: another h_S.
    let mut policy = test_policy();
    policy[0] ^= 1;
    for chain in [
        Chain::new(NETWORK_MAINNET, test_policy()).unwrap(),
        Chain::new(test_chain().network(), policy).unwrap(),
    ] {
        let elsewhere = Reveal::from_bytes(&chain, &bytes).unwrap();
        assert_eq!(p.b.verify_reveal(&elsewhere), Err(Error::InvalidReveal));
    }
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

/// Cross-protocol (docs/joint-security.md, B5). A reveal holds two Schnorr
/// transcripts under the messaging key x_m, with one share c₁ and one
/// response z₁: (T₁, c₁, z₁) on (p₀, A), and (T₁′, c₁, z₁) on the Seedelf's
/// messaging register (h_S, m_S). x makes none (docs/protocol.md §21.9), but
/// a register of x_m can still be paid by another tool, so each must pass a
/// spending verifier only if that verifier's own challenge is c₁. What this shows, of three reveals
/// (the initiator's, made with x, and two the reader makes itself, whose
/// branch 1 is simulated, of the same Seedelf and of one neither side holds):
///
/// - **The share's shape**, which is what keeps them apart. c₁ = c − c₂ with
///   c₂ not 0, so the share isn't the reveal's challenge itself; and as an
///   integer it's 2²²⁴ or more, where the chain's challenge, a blake2b-224,
///   is below it: so for these reveals no vkh and no [d] of the register
///   makes the chain's challenge c₁. (One reveal in 2³⁰ has a share below
///   2²²⁴, and then each try is one chance in 2²²⁴: B5's count.) A reveal
///   whose share were the chain's challenge, a spending proof handed over as
///   a reveal, fails here.
/// - **The verifiers, run:** seedelf-crypto's, the chain's among them and
///   Lovejoin's owner proof, refuse each transcript for its register and for
///   two [d] of it with [d]T, under three vkhs, while taking a spending proof
///   made with x_m for the same registers.
///
/// What it doesn't show: anything of the reveal's own challenge, its hash,
/// label or what it covers. With that hash changed this still passes, as it
/// should (1.10.0's second review tried SHA-256 of one byte): c₁ stays a
/// share spread over the whole field. The reveal's challenge is held by
/// `a_reveal_is_bound_to_its_conversation_name_and_register` and by the
/// vectors (`reveal_vectors_match_the_file`).
#[test]
fn the_spending_verifiers_refuse_a_reveals_transcripts_and_its_share_is_none_of_their_challenges() {
    use super::support::test_scalar;
    use seedelf_crypto::lovejoin::{SchnorrProof, verify_schnorr};
    use seedelf_crypto::schnorr::{create_proof, fiat_shamir_heuristic, prove};
    let p = parties("reveal cross protocol");
    let mut draw = Seeded::new("reveal cross protocol, the reader's own");
    let shown = alices_seedelf();
    let carols = seedelf_handle("carol");
    let hex_point = |point: &G1Projective| hex(point.to_compressed());
    let vkhs = ["00".repeat(28), "11".repeat(28), "5eed".repeat(14)];

    // The chain's verifier is asked as a spend asks it: a spending proof
    // made with x_m for either register passes.
    let (base, initiator) = (p.a.first.base.into(), p.a.first.initiator.into());
    let (h_s, m_s) = (
        shown.register().generator(),
        shown.register().public_value(),
    );
    for (g, u) in [(h_s, m_s), (base, initiator)] {
        let register = seedelf_crypto::register::Register::new(hex_point(&g), hex_point(&u));
        let (z, t) = create_proof(register, p.alice.scalar(), vkhs[0].clone()).unwrap();
        assert!(prove(&hex_point(&g), &hex_point(&u), &z, &t, &vkhs[0]).unwrap());
    }

    // Drawn from the test's own source, so the shares are the same every run.
    let reveals = [
        p.a.reveal_with(&p.alice, &shown, &mut draw).unwrap(),
        forge(&p.b, &p.bob.scalar(), &shown, &mut draw).0,
        forge(&p.b, &p.bob.scalar(), &carols, &mut draw).0,
    ];
    // The chain's challenges are below this: 2²²⁴, big-endian.
    let mut chain_space = [0u8; 32];
    chain_space[3] = 1;
    for reveal in reveals {
        assert_eq!(p.b.verify_reveal(&reveal), Ok(()));
        // The commitments as anyone holding the reveal works them out:
        // T₁ = [z₁]p₀ − [c₁]A and T₁′ = [z₁]h_S − [c₁]m_S.
        let statement = Statement::of(&p.b, reveal.handle());
        let commitments = statement.commitments_of(&reveal.proof);
        let (c1, z1) = (reveal.proof.c1, reveal.proof.z1);
        // The share: part of the reveal's challenge, never all of it, and
        // outside the chain's challenge space.
        let c = scalar_mod_q(&statement.challenge(&commitments));
        assert_eq!(c1 + reveal.proof.c2, c);
        assert_ne!(reveal.proof.c2, Scalar::from(0u64));
        assert_ne!(c1, c);
        assert!(
            c1.to_bytes_be() >= chain_space,
            "a share below 2²²⁴: one reveal in 2³⁰ has one, so draw under another label"
        );
        let register = reveal.messaging_register();
        let transcripts = [
            (
                register.generator(),
                register.public_value(),
                commitments.t1_seedelf,
            ),
            (base, initiator, commitments.t1),
        ];
        for (g, u, t) in transcripts {
            let t = G1Projective::from(t);
            // A transcript under the share c₁: all a verifier's own
            // challenge would have to be for (T, z₁) to pass it.
            assert_eq!(g * z1, t + u * c1);
            for d in [Scalar::from(1u64), test_scalar("d1"), test_scalar("d2")] {
                let (gd, ud, td) = (g * d, u * d, t * d);
                for vkh in &vkhs {
                    // The chain's challenge: blake2b-224 of g ‖ T ‖ u ‖ vkh,
                    // as an integer.
                    let challenge = fiat_shamir_heuristic(
                        hex_point(&gd),
                        hex_point(&td),
                        hex_point(&ud),
                        vkh.clone(),
                    );
                    assert_ne!(
                        format!("{:0>64}", challenge.unwrap()),
                        hex(c1.to_bytes_be())
                    );
                    let spends = prove(
                        &hex_point(&gd),
                        &hex_point(&ud),
                        &hex(z1.to_bytes_be()),
                        &hex_point(&td),
                        vkh,
                    );
                    assert!(!spends.unwrap());
                }
                let lovejoin = SchnorrProof {
                    t: td.to_compressed(),
                    z: z1.to_bytes_be(),
                };
                assert!(!verify_schnorr(&gd, &ud, &lovejoin, b"any ctx"));
            }
        }
    }
}

#[test]
fn no_single_bit_changed_reads_as_a_reveal() {
    let p = parties("reveal bits");
    let bytes = p.a.reveal(&p.alice, &alices_seedelf()).unwrap().to_bytes();
    for i in 0..bytes.len() * 8 {
        let mut changed = bytes.clone();
        changed[i / 8] ^= 1 << (i % 8);
        let verdict = read(&changed).and_then(|r| p.b.verify_reveal(&r));
        assert!(verdict.is_err(), "bit {i} changed still verifies");
    }
}

#[test]
fn reveals_that_dont_parse_are_refused() {
    let p = parties("reveal parse");
    let bytes = p.a.reveal(&p.alice, &alices_seedelf()).unwrap().to_bytes();
    for (case, expected) in malformed(&bytes) {
        assert_eq!(read(&case.1).err(), Some(expected), "{}", case.0);
    }
    assert_eq!(read(&[]).err(), Some(Error::InvalidMessage));
}

/// A reveal's bytes broken each way parsing refuses, with what it's refused
/// as. `bytes` names a 32-byte Seedelf.
fn malformed(bytes: &[u8]) -> Vec<((&'static str, Vec<u8>), Error)> {
    let name_end = 1 + 32;
    let (g_at, u_at, m_at, proof_at) = (G_AT, U_AT, M_AT, PROOF_AT);
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
    // O's flags with a stray bit of x: one encoding per point, so refused.
    let mut stray = identity();
    stray[47] = 0x01;
    // x = p, the field's modulus, with the compression flag.
    let mut x_is_p: [u8; 48] = hex::decode(FIELD_MODULUS).unwrap().try_into().unwrap();
    x_is_p[0] |= 0x80;
    // Two faults: each field is refused as it's read, so the earlier one names it.
    let u_off_then_c1 = {
        let mut out = with(u_at, &off_curve());
        out[proof_at..proof_at + 32].copy_from_slice(&q);
        out
    };
    let mut u_off_then_longer = with(u_at, &off_curve());
    u_off_then_longer.push(0);
    let m_off_then_c1 = {
        let mut out = with(m_at, &off_curve());
        out[proof_at..proof_at + 32].copy_from_slice(&q);
        out
    };
    // g_S as it is, but without the compression flag.
    let mut uncompressed_flag = bytes.to_vec();
    uncompressed_flag[g_at] &= 0x7f;
    // O's flags with the sign flag too.
    let mut signed_identity = identity();
    signed_identity[0] |= 0x20;
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
        (
            ("m_S outside G1", with(m_at, &outside_g1())),
            Error::NotInSubgroup,
        ),
        (
            ("m_S the identity", with(m_at, &identity())),
            Error::IdentityPoint,
        ),
        (
            ("m_S off the curve", with(m_at, &off_curve())),
            Error::InvalidEncoding,
        ),
        (
            ("m_S with x not below p", with(m_at, &x_is_p)),
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
        (
            (
                "g_S with O's flags and a stray bit of x",
                with(g_at, &stray),
            ),
            Error::InvalidEncoding,
        ),
        (
            ("g_S with x not below p", with(g_at, &x_is_p)),
            Error::InvalidEncoding,
        ),
        (
            ("g_S without the compression flag", uncompressed_flag),
            Error::InvalidEncoding,
        ),
        (
            (
                "g_S with O's flags and the sign flag",
                with(g_at, &signed_identity),
            ),
            Error::InvalidEncoding,
        ),
        (
            (
                "u_S off the curve and c₁ not below q: the points are read first",
                u_off_then_c1,
            ),
            Error::InvalidEncoding,
        ),
        (
            (
                "u_S off the curve and a byte left over: what's left is read last",
                u_off_then_longer,
            ),
            Error::InvalidEncoding,
        ),
        (
            (
                "m_S off the curve and c₁ not below q: m_S is read before the proof",
                m_off_then_c1,
            ),
            Error::InvalidEncoding,
        ),
    ]
}

/// The nonce's hedge (joint-security.md, rule 2). With every draw held
/// still, two reveals of one statement are one proof, and anything the
/// challenge covers that changes, changes the nonce. Two challenges on one
/// nonce would give x away: z₁ − z₁′ = (c₁ − c₁′)·x.
#[test]
fn a_stuck_random_source_still_gives_each_statement_its_own_nonce() {
    let p = parties("reveal stuck");
    let shown = alices_seedelf();
    let stuck = || Stuck {
        scalar: Scalar::from(5u64),
        aux: [0x5a; 32],
    };
    let x = p.alice.scalar();
    let nonce = |conversation: &Conversation, seedelf: &Handle, key: &Scalar, draw: &mut Stuck| {
        Statement::of(conversation, seedelf)
            .hedged_nonce(key, BRANCH_SEEDELF, draw)
            .0
    };
    let k = nonce(&p.a, &shown, &x, &mut stuck());

    // One key, one statement, one draw: one proof, byte for byte.
    let once = p.a.reveal_with(&p.alice, &shown, &mut stuck()).unwrap();
    let again = p.a.reveal_with(&p.alice, &shown, &mut stuck()).unwrap();
    assert_eq!(once, again);
    assert_eq!(k, nonce(&p.a, &shown, &x, &mut stuck()));

    // Another Seedelf, another register of it, another conversation: each
    // another nonce.
    let root = seedelf(b"a", spend_key("alice").register())
        .handle(&p.alice)
        .unwrap();
    assert_ne!(k, nonce(&p.a, &root, &x, &mut stuck()), "another Seedelf");
    let mut renamed_name = shown.name().to_vec();
    renamed_name[31] ^= 1;
    let renamed = seedelf(&renamed_name, *shown.seedelf().register())
        .handle(&p.alice)
        .unwrap();
    assert_ne!(k, nonce(&p.a, &renamed, &x, &mut stuck()), "another name");
    // The same Seedelf read under another chain: another h_S and m_S.
    let mainnet = Seedelf::new(
        Chain::new(NETWORK_MAINNET, test_policy()).unwrap(),
        shown.name(),
        *shown.seedelf().register(),
    )
    .unwrap()
    .handle(&p.alice)
    .unwrap();
    assert_ne!(k, nonce(&p.a, &mainnet, &x, &mut stuck()), "another chain");
    let (other, _) = answered(
        &p.alice,
        &p.bob,
        &handle("bob", "bob's handle"),
        "reveal stuck, another",
    );
    assert_ne!(
        k,
        nonce(&other, &shown, &x, &mut stuck()),
        "another conversation"
    );

    // The simulated branch's share and response are in the challenge, through
    // T₂: the nonce covers them, so a source that repeats aux but not them
    // can't put one nonce under two challenges.
    let statement = Statement::of(&p.a, &shown);
    let okm = |c: u64, z: u64, aux: [u8; 32]| {
        let message =
            statement.nonce_message(BRANCH_SEEDELF, (&Scalar::from(c), &Scalar::from(z)), &aux);
        *hedge_okm(&x, &message)
    };
    let base = okm(5, 5, [0x5a; 32]);
    assert_eq!(scalar_mod_q(&base), k);
    assert_ne!(base, okm(6, 5, [0x5a; 32]), "another c₂");
    assert_ne!(base, okm(5, 6, [0x5a; 32]), "another z₂");
    assert_ne!(base, okm(5, 5, [0xa5; 32]), "another aux");
    // Another key: another nonce, so a draw anyone can predict doesn't make
    // the nonce theirs.
    assert_ne!(
        k,
        nonce(&p.a, &shown, &p.bob.scalar(), &mut stuck()),
        "another key"
    );
    // And the branch: the reader's own reveal of the same statement with the
    // same key and draws isn't the writer's nonce.
    assert_ne!(
        k,
        statement.hedged_nonce(&x, BRANCH_READER, &mut stuck()).0,
        "another branch"
    );
}

/// The nonce is the HMAC's 64 bytes reduced mod q, keyed by the messaging
/// key, and the message is exactly the label, the branch, the statement
/// (cid ‖ p₀ ‖ A ‖ w₀ ‖ len ‖ N ‖ g_S ‖ u_S ‖ h_S ‖ m_S, §21.9), c, z and aux: the
/// commitments the proof publishes are [k₁]p₀ and [k₁]h_S for that k₁, with
/// h_S the hash of the Seedelf, never g_S.
#[test]
fn the_nonce_is_hmac_sha512_of_the_statement_under_the_key() {
    let p = parties("reveal nonce");
    let shown = alices_seedelf();
    let statement = Statement::of(&p.a, &shown);
    let mut draw = Seeded::new("reveal nonce draws");
    let (_, commitments) = statement.prove_seedelf(&p.alice.scalar(), &mut draw);
    let drawn = draw.drain();
    let scalar = |bytes: &[u8]| Scalar::from_bytes_be(&bytes.try_into().unwrap()).unwrap();
    let (c2, z2) = (scalar(&drawn[0]), scalar(&drawn[1]));
    let aux: [u8; 32] = drawn[2].clone().try_into().unwrap();
    let mut expected = REVEAL_NONCE_LABEL.to_vec();
    expected.push(BRANCH_SEEDELF);
    expected.extend_from_slice(&p.a.cid().0);
    for point in [p.a.first.base, p.a.first.initiator, p.a.responder] {
        expected.extend_from_slice(&point.to_compressed());
    }
    expected.push(shown.name().len() as u8);
    expected.extend_from_slice(shown.name());
    expected.extend_from_slice(&shown.seedelf().register().to_bytes());
    expected.extend_from_slice(&shown.register().generator_bytes());
    expected.extend_from_slice(&shown.register().public_value_bytes());
    expected.extend_from_slice(&c2.to_bytes_be());
    expected.extend_from_slice(&z2.to_bytes_be());
    expected.extend_from_slice(&aux);
    let message = statement.nonce_message(BRANCH_SEEDELF, (&c2, &z2), &aux);
    assert_eq!(message, expected);
    let k = scalar_mod_q(&*hedge_okm(&p.alice.scalar(), &message));
    assert_eq!(
        commitments.t1,
        (G1Projective::from(p.a.first.base) * k).to_affine()
    );
    // h_S from the hash, its message built here from §21.3.
    let mut base_message = vec![test_chain().network()];
    base_message.extend_from_slice(&test_policy());
    base_message.push(shown.name().len() as u8);
    base_message.extend_from_slice(shown.name());
    base_message.extend_from_slice(&shown.seedelf().register().to_bytes());
    let h_s = G1Projective::hash_to_curve(&base_message, HANDLE_BASE_DST, &[]);
    assert_eq!(shown.register().generator(), h_s);
    assert_eq!(commitments.t1_seedelf, (h_s * k).to_affine());
    assert_ne!(
        commitments.t1_seedelf,
        (shown.seedelf().register().generator() * k).to_affine()
    );
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
    // 305 bytes and the kind byte, padded as every message is to its
    // first-contact form, F and 97 bytes more: 913 inner bytes, a 2 KiB
    // envelope. Every reveal is: 275 to 306 bytes with F + 97's 379 to 635
    // is 654 to 941, over 512 bytes' 366 and within 2 KiB's 1,902.
    assert_eq!(a.first_bytes.len(), 510);
    assert_eq!(envelope.len(), 2048);
    let mut b = p.b.clone();
    let read = b.receive(&opened(&p.bob, &envelope), NOW + 120).unwrap();
    assert_eq!(read, plaintext);
    assert_eq!(b.verify_reveal(&self::read(&read[1..]).unwrap()), Ok(()));
}

/// A reveal is read under the reader's chain, which h_S comes from: one
/// made for a Seedelf on one chain doesn't verify read under another, by
/// network or by policy, though its bytes parse.
#[test]
fn a_reveal_made_under_one_chain_doesnt_verify_under_another() {
    let p = parties("reveal chains");
    let mut policy = test_policy();
    policy[27] ^= 0x80;
    let chains = [
        test_chain(),
        Chain::new(NETWORK_MAINNET, test_policy()).unwrap(),
        Chain::new(test_chain().network(), policy).unwrap(),
    ];
    for (i, made) in chains.iter().enumerate() {
        let shown = Seedelf::new(*made, &seedelf_name("alice"), seedelf_register("alice"))
            .unwrap()
            .handle(&p.alice)
            .unwrap();
        let bytes = p.a.reveal(&p.alice, &shown).unwrap().to_bytes();
        for (j, reader) in chains.iter().enumerate() {
            let reveal = Reveal::from_bytes(reader, &bytes).unwrap();
            assert_eq!(reveal.handle().seedelf().chain(), reader);
            let verdict = p.b.verify_reveal(&reveal);
            if i == j {
                assert_eq!(verdict, Ok(()), "made and read under chain {i}");
                assert_eq!(reveal.handle(), &shown);
            } else {
                assert_eq!(
                    verdict,
                    Err(Error::InvalidReveal),
                    "made under chain {i}, read under {j}"
                );
            }
        }
    }
}

/// A reveal is `len ‖ N ‖ g_S ‖ u_S ‖ m_S ‖ c₁ ‖ c₂ ‖ z₁ ‖ z₂`: 273 bytes
/// and its name's, 274 to 305 (docs/protocol.md §21.9).
#[test]
fn a_reveals_bytes_are_its_seedelf_its_messaging_value_and_its_proof() {
    assert_eq!((REVEAL_MIN_LEN, REVEAL_MAX_LEN), (274, 305));
    let p = parties("reveal lengths");
    for len in [1usize, 2, 16, 31, 32] {
        let name = &seedelf_name("alice")[..len];
        let shown = seedelf(name, seedelf_register("alice"))
            .handle(&p.alice)
            .unwrap();
        let reveal = p.a.reveal(&p.alice, &shown).unwrap();
        let bytes = reveal.to_bytes();
        assert_eq!(bytes.len(), 273 + len);
        let mut expected = vec![len as u8];
        expected.extend_from_slice(name);
        expected.extend_from_slice(&shown.seedelf().register().to_bytes());
        expected.extend_from_slice(&shown.register().public_value_bytes());
        for scalar in [
            reveal.proof.c1,
            reveal.proof.c2,
            reveal.proof.z1,
            reveal.proof.z2,
        ] {
            expected.extend_from_slice(&scalar.to_bytes_be());
        }
        assert_eq!(bytes, expected);
        assert_eq!(p.b.verify_reveal(&read(&bytes).unwrap()), Ok(()));
    }
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

fn chain_json(chain: &Chain) -> Value {
    json!({ "network": chain.network(), "policy": hex(chain.policy()) })
}

/// A Seedelf and its messaging register as a reveal names it, with the
/// messaging key of the wallet whose handle it is: the datum register
/// (g_S, u_S), h_S as the hash gives it and m_S = [x_m]h_S.
fn seedelf_json(shown: &Handle, owner: &SecretKey) -> Value {
    let seedelf = shown.seedelf();
    assert_eq!(&seedelf.handle(owner).unwrap(), shown);
    json!({
        "network": seedelf.chain().network(),
        "policy": hex(seedelf.chain().policy()),
        "name": hex(seedelf.name()),
        "generator": hex(seedelf.register().generator_bytes()),
        "public_value": hex(seedelf.register().public_value_bytes()),
        "base_message": hex(seedelf.base_message()),
        "base": hex(shown.register().generator_bytes()),
        "messaging_value": hex(shown.register().public_value_bytes()),
        "messaging_secret_key": hex(owner.scalar().to_bytes_be()),
    })
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

/// The nonce of a reveal made with `drawn` (the simulated branch's c and z,
/// then aux): the HMAC's message and output, and the scalar, which must be
/// the discrete log of the real branch's commitment on p₀.
fn nonce_json(
    statement: &Statement<'_>,
    key: &Scalar,
    branch: u8,
    drawn: &[Vec<u8>],
    commitment: &blstrs::G1Affine,
) -> Value {
    let scalar = |bytes: &[u8]| Scalar::from_bytes_be(&bytes.try_into().unwrap()).unwrap();
    let (c, z) = (scalar(&drawn[0]), scalar(&drawn[1]));
    let aux: [u8; 32] = drawn[2].clone().try_into().unwrap();
    let message = statement.nonce_message(branch, (&c, &z), &aux);
    let okm = hedge_okm(key, &message);
    let k = scalar_mod_q(&okm[..]);
    assert_eq!(
        *commitment,
        (G1Projective::from(statement.base) * k).to_affine(),
        "the real branch's commitment is [k]p₀"
    );
    json!({
        "branch": branch,
        "message": hex(&message),
        "hmac": hex(&okm[..]),
        "scalar": hex(k.to_bytes_be()),
    })
}

#[allow(clippy::too_many_arguments)]
fn reveal_json(
    name: &str,
    conversation: usize,
    made_by: &str,
    owner: &SecretKey,
    draws: Value,
    nonce: Value,
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
        "seedelf": seedelf_json(reveal.handle(), owner),
        "statement": hex(statement.to_bytes()),
        "draws": draws,
        "nonce": nonce,
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

/// A check: the reveal read under `chain` at `side` of `conversation`.
fn check(
    name: &str,
    conversation: usize,
    side: &str,
    chain: &Chain,
    reveal: &[u8],
    sides: &[(&Conversation, &Conversation)],
) -> Value {
    let (a, b) = sides[conversation];
    let at = if side == "initiator" { a } else { b };
    let result = match Reveal::from_bytes(chain, reveal).and_then(|r| at.verify_reveal(&r)) {
        Ok(()) => "ok",
        Err(error) => code(error),
    };
    json!({
        "name": name,
        "conversation": conversation,
        "side": side,
        "network": chain.network(),
        "policy": hex(chain.policy()),
        "reveal": hex(reveal),
        "result": result,
    })
}

fn all_vectors() -> Value {
    let alice = key("seedelf-messaging reveal v1 alice");
    let bob = key("seedelf-messaging reveal v1 bob");
    let carol = key("seedelf-messaging reveal v1 carol");
    let chain = test_chain();
    let bob_handle = handle("seedelf-messaging reveal v1 bob", "bob's handle");
    let (a0, b0) = answered(&alice, &bob, &bob_handle, "reveal v1 conversation 0");
    let (a1, b1) = answered(&alice, &bob, &bob_handle, "reveal v1 conversation 1");
    let sides = [(&a0, &b0), (&a1, &b1)];
    // A Seedelf of `label`'s wallet: its datum register is its Seedelf key's,
    // and its handle its messaging key's.
    let shown = |label: &str, name: &[u8], generator: &str, owner: &SecretKey| {
        seedelf(name, datum_register(label, generator))
            .handle(owner)
            .unwrap()
    };

    // 0: Alice's Seedelf, under its full 32-byte name.
    let alices = shown(
        "seedelf-messaging reveal v1 alice",
        &seedelf_name("alice"),
        "alice's seedelf",
        &alice,
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
    let drawn = draw.drain();
    let first = reveal_json(
        "Alice's Seedelf under its full 32-byte name",
        0,
        "initiator",
        &alice,
        draws_json(["c2", "z2", "aux"], drawn.clone()),
        nonce_json(
            &statement,
            &alice.scalar(),
            BRANCH_SEEDELF,
            &drawn,
            &commitments.t1,
        ),
        &statement,
        &commitments,
        &full,
    );

    // 1: a Seedelf at the Seedelf key's root register, under a 1-byte name.
    let root = seedelf(
        b"a",
        spend_key("seedelf-messaging reveal v1 alice").register(),
    )
    .handle(&alice)
    .unwrap();
    let mut draw = Seeded::new("reveal v1 reveal 1");
    let statement = Statement::of(&a0, &root);
    let (proof, commitments) = statement.prove_seedelf(&alice.scalar(), &mut draw);
    let short = Reveal {
        seedelf: root.clone(),
        proof,
    };
    let drawn = draw.drain();
    let second = reveal_json(
        "a Seedelf of Alice's at her Seedelf key's root register, under a 1-byte name",
        0,
        "initiator",
        &alice,
        draws_json(["c2", "z2", "aux"], drawn.clone()),
        nonce_json(
            &statement,
            &alice.scalar(),
            BRANCH_SEEDELF,
            &drawn,
            &commitments.t1,
        ),
        &statement,
        &commitments,
        &short,
    );

    // 2: Carol's Seedelf, made by the reader with its own key.
    let carols = shown(
        "seedelf-messaging reveal v1 carol",
        &seedelf_name("carol"),
        "carol's seedelf",
        &carol,
    );
    // The first draws whose challenge is at least q, so an implementation
    // that doesn't reduce it gets this one wrong.
    let at_least_q = |forged: &Reveal| {
        let c = forged.proof.c1 + forged.proof.c2;
        let hashed = Statement::of(&b0, &carols)
            .challenge(&Statement::of(&b0, &carols).commitments_of(&forged.proof));
        assert_eq!(scalar_mod_q(&hashed), c);
        Option::<Scalar>::from(Scalar::from_bytes_be(&hashed)).is_none()
    };
    let mut draw = (0..)
        .map(|i| Seeded::new(&format!("reveal v1 reveal 2, try {i}")))
        .find(|draw| {
            let mut trial = Seeded::new(&draw.label);
            at_least_q(&forge(&b0, &bob.scalar(), &carols, &mut trial).0)
        })
        .unwrap();
    let (forged, commitments) = forge(&b0, &bob.scalar(), &carols, &mut draw);
    assert!(at_least_q(&forged));
    let drawn = draw.drain();
    let statement = Statement::of(&b0, &carols);
    let third = reveal_json(
        "Carol's Seedelf, made by the reader with its own key",
        0,
        "responder",
        &carol,
        draws_json(["c1", "z1", "aux"], drawn.clone()),
        nonce_json(
            &statement,
            &bob.scalar(),
            BRANCH_READER,
            &drawn,
            &commitments.t2,
        ),
        &statement,
        &commitments,
        &forged,
    );

    let bytes = full.to_bytes();
    let with = |at: usize, value: &[u8]| with_bytes(&bytes, at, value);
    let changed = |f: &dyn Fn(&mut Reveal)| {
        let mut r = full.clone();
        f(&mut r);
        r.to_bytes()
    };
    let two = Scalar::from(2u64);
    let datum = *alices.seedelf().register();
    let moved_register = Register::from_checked(
        (datum.generator() * two).to_affine(),
        (datum.public_value() * two).to_affine(),
    );
    let mut renamed = alices.name().to_vec();
    renamed[31] ^= 1;
    // The renamed Seedelf's own m_S, which is Alice's messaging key's on
    // its h_S: a reveal of a Seedelf she could hold, with reveal 0's proof.
    let renamed_own = seedelf(&renamed, datum).handle(&alice).unwrap();
    let mut renamed_with_own = with(1, &renamed);
    renamed_with_own[M_AT..M_AT + 48].copy_from_slice(&renamed_own.register().public_value_bytes());
    let moved_own = seedelf(alices.name(), moved_register)
        .handle(&alice)
        .unwrap();
    let mut moved_with_own = with(G_AT, &moved_register.to_bytes());
    moved_with_own[M_AT..M_AT + 48].copy_from_slice(&moved_own.register().public_value_bytes());
    let mainnet = Chain::new(NETWORK_MAINNET, *chain.policy()).unwrap();
    let mut policy = *chain.policy();
    policy[0] ^= 1;
    let other_policy = Chain::new(chain.network(), policy).unwrap();
    let mut checks = vec![
        check(
            "reveal 0, at the reader",
            0,
            "responder",
            &chain,
            &bytes,
            &sides,
        ),
        check(
            "reveal 1, at the reader",
            0,
            "responder",
            &chain,
            &short.to_bytes(),
            &sides,
        ),
        check(
            "reveal 2, made by the reader, at the reader",
            0,
            "responder",
            &chain,
            &forged.to_bytes(),
            &sides,
        ),
        check(
            "reveal 0, at the side that wrote first",
            0,
            "initiator",
            &chain,
            &bytes,
            &sides,
        ),
        check(
            "reveal 2, at the side that wrote first",
            0,
            "initiator",
            &chain,
            &forged.to_bytes(),
            &sides,
        ),
        check(
            "reveal 0, in another conversation of the same two keys",
            1,
            "responder",
            &chain,
            &bytes,
            &sides,
        ),
        check(
            "reveal 0 read under mainnet: h_S is another network's",
            0,
            "responder",
            &mainnet,
            &bytes,
            &sides,
        ),
        check(
            "reveal 0 read under another policy: h_S is another policy's",
            0,
            "responder",
            &other_policy,
            &bytes,
            &sides,
        ),
        check(
            "reveal 0 under another name: another h_S",
            0,
            "responder",
            &chain,
            &with(1, &renamed),
            &sides,
        ),
        check(
            "reveal 0 under another name, with that Seedelf's own m_S",
            0,
            "responder",
            &chain,
            &renamed_with_own,
            &sides,
        ),
        check(
            "reveal 0 for another register of the same key, [2](g_S, u_S)",
            0,
            "responder",
            &chain,
            &with(G_AT, &moved_register.to_bytes()),
            &sides,
        ),
        check(
            "reveal 0 for [2](g_S, u_S), with that Seedelf's own m_S",
            0,
            "responder",
            &chain,
            &moved_with_own,
            &sides,
        ),
        check(
            "reveal 0 with another m_S, [2]m_S",
            0,
            "responder",
            &chain,
            &with(
                M_AT,
                &(alices.register().public_value() * two).to_compressed(),
            ),
            &sides,
        ),
        check(
            "reveal 0 with c₁ + 1",
            0,
            "responder",
            &chain,
            &changed(&|r| r.proof.c1 += Scalar::from(1u64)),
            &sides,
        ),
        check(
            "reveal 0 with c₁ and c₂ swapped",
            0,
            "responder",
            &chain,
            &changed(&|r| std::mem::swap(&mut r.proof.c1, &mut r.proof.c2)),
            &sides,
        ),
        check(
            "reveal 0 with z₁ and z₂ swapped",
            0,
            "responder",
            &chain,
            &changed(&|r| std::mem::swap(&mut r.proof.z1, &mut r.proof.z2)),
            &sides,
        ),
    ];
    // Bob's Seedelf, proved with Alice's key: branch 1's relation doesn't hold.
    let bobs = shown(
        "seedelf-messaging reveal v1 bob",
        &seedelf_name("bob"),
        "bob's seedelf",
        &bob,
    );
    let (wrong, _) = Statement::of(&a0, &bobs)
        .prove_seedelf(&alice.scalar(), &mut Seeded::new("reveal v1 wrong"));
    checks.push(check(
        "Bob's Seedelf, proved with Alice's key",
        0,
        "responder",
        &chain,
        &Reveal {
            seedelf: bobs,
            proof: wrong,
        }
        .to_bytes(),
        &sides,
    ));
    // Alice's Seedelf with the m_S of her Seedelf key, not her messaging key,
    // proved with the Seedelf key: A isn't that key's.
    let alice_spend = spend_key("seedelf-messaging reveal v1 alice");
    let on_the_seedelf_key = alices.seedelf().handle(&alice_spend).unwrap();
    let (wrong_key, _) = Statement::of(&a0, &on_the_seedelf_key).prove_seedelf(
        &alice_spend.scalar(),
        &mut Seeded::new("reveal v1 the Seedelf key"),
    );
    checks.push(check(
        "Alice's Seedelf with the Seedelf key's m_S, proved with that key",
        0,
        "responder",
        &chain,
        &Reveal {
            seedelf: on_the_seedelf_key,
            proof: wrong_key,
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
        &chain,
        &at_identity.to_bytes(),
        &sides,
    ));
    for ((name, case), _) in malformed(&bytes) {
        checks.push(check(name, 0, "responder", &chain, &case, &sides));
    }
    // At the side that wrote first, a reveal that doesn't parse is refused as
    // such: parsing comes before the side.
    let mut empty_name = vec![0u8];
    empty_name.extend_from_slice(&bytes[1 + 32..]);
    checks.push(check(
        "an empty name, at the side that wrote first: parsed before the side is checked",
        0,
        "initiator",
        &chain,
        &empty_name,
        &sides,
    ));
    // And one that parses but doesn't verify: the side is checked before the
    // proof, which is never checked there.
    checks.push(check(
        "reveal 0 with c₁ + 1, at the side that wrote first: the side before the proof",
        0,
        "initiator",
        &chain,
        &changed(&|r| r.proof.c1 += Scalar::from(1u64)),
        &sides,
    ));

    json!({
        "version": 1,
        "description": "Seedelf Messaging's verified reveal (docs/protocol.md §19, as §21.9 makes it): an OR-proof that the Seedelf's messaging register (h_S, m_S) and the initiator's identity A share a key, the messaging key x_m, or that the prover knows the responder's. Every secret key here is a messaging key; a Seedelf's datum register (g_S, u_S) is its Seedelf key's, which makes no part of a reveal. h_S is RFC 9380's hash to G1 of base_message (network ‖ policy ‖ len(N) ‖ N ‖ g_S ‖ u_S) under handle_base_dst (§21.3): a reader computes it from the reveal's Seedelf under its own chain, the check's network and policy. The statement is cid ‖ p₀ ‖ A ‖ w₀ ‖ len(N) ‖ N ‖ g_S ‖ u_S ‖ h_S ‖ m_S, so its challenge binds the reader's chain through h_S, and the challenge is SHA-256 of the label, the statement, T₁, T₁′ and T₂. A reveal's bytes carry no h_S: the reader computes it. The conversations' states are this crate's own (§16.5), for its public-API test; another implementation needn't read them.",
        "label": String::from_utf8(REVEAL_LABEL.to_vec()).unwrap(),
        "nonce_label": String::from_utf8(REVEAL_NONCE_LABEL.to_vec()).unwrap(),
        "handle_base_dst": String::from_utf8(HANDLE_BASE_DST.to_vec()).unwrap(),
        "kind": KIND_REVEAL,
        "group_order": GROUP_ORDER,
        "chain": chain_json(&chain),
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
