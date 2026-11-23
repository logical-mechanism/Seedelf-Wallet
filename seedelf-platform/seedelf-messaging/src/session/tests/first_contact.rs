//! Part 1: the first-contact block F, its base proof, SK with the static
//! DH, and RatchetInitAlice and RatchetInitBob (docs/protocol.md §3). The
//! keys proof's own tests are keys_proof.rs's.

use blstrs::{G1Affine, G1Projective, Scalar};
use ff::Field;
use group::Curve;
use hkdf::Hkdf;
use sha2::{Digest, Sha256};

use super::support::{
    HANDLE_NAME, Seeded, Stuck, handle, identity, key, off_curve, opened, outside_g1, stamp,
    test_scalar,
};
use crate::Error;
use crate::keys::scalar_mod_q;
use crate::register::{POINT_LEN, Register};
use crate::session::conversation::{Conversation, Origin, Role};
use crate::session::draw::hedge_okm;
use crate::session::first_contact::{
    BASE_LABEL, BASE_PROOF_LEN, CONTINUATION_KEYS_PROOF_LEN, ConversationId, FIRST_CONTACT_MAX_LEN,
    FIRST_CONTACT_MIN_LEN, FIRST_STAMP_LABEL, FirstContact, KEYS_PROOF_LEN, KeysProof,
    KeysStatement, SESSION_INFO, SESSION_SALT, base_nonce_message, base_scalar,
    base_scalar_message, head_bytes, prove_base_with, session_key, within_window,
};
use crate::session::ratchet::kdf_rk;

/// The group order q, big-endian.
const GROUP_ORDER: [u8; 32] = [
    0x73, 0xed, 0xa7, 0x53, 0x29, 0x9d, 0x7d, 0x48, 0x33, 0x39, 0xd8, 0x08, 0x09, 0xa1, 0xd8, 0x05,
    0x53, 0xbd, 0xa4, 0x02, 0xff, 0xfe, 0x5b, 0xfe, 0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x01,
];

/// The handle the samples' bases re-randomize, and their `b`.
fn sample_handle() -> (Register, Scalar) {
    (handle("bob", "F handle"), test_scalar("F base"))
}

/// The samples' w₀, the handle's public value re-randomized by `b`.
fn sample_w0() -> G1Affine {
    let (handle, b) = sample_handle();
    (handle.public_value() * b).to_affine()
}

/// The samples' first ratchet key S_A on `base`.
fn sample_ratchet(base: &G1Affine) -> G1Affine {
    (G1Projective::from(*base) * test_scalar("F s")).to_affine()
}

/// An F whose base re-randomizes [`sample_handle`], with its base proof when
/// `to` isn't empty, and its keys proof in the form `to` sets, each from
/// fixed nonces.
fn sample(to: &[u8], replaces: Option<ConversationId>) -> FirstContact {
    let (handle, b) = sample_handle();
    let base = (handle.generator() * b).to_affine();
    let (a, e, s) = (test_scalar("F a"), test_scalar("F e"), test_scalar("F s"));
    let mut first = FirstContact {
        cid: ConversationId(*b"0123456789abcdef"),
        started_at: 0x0102_0304_0506_0708,
        to: to.to_vec(),
        replaces,
        base,
        initiator: (G1Projective::from(base) * a).to_affine(),
        ephemeral: (G1Projective::from(base) * e).to_affine(),
        proof: None,
        keys_proof: None,
    };
    if !to.is_empty() {
        first.proof = Some(prove_base_with(
            &handle,
            &b,
            &test_scalar("F k"),
            (&test_scalar("F c2"), &test_scalar("F z2")),
            &first.prefix_bytes(),
        ));
    }
    let statement = KeysStatement::of(&first, &sample_w0(), &sample_ratchet(&base));
    let (ke, ks) = (test_scalar("F ke"), test_scalar("F ks"));
    first.keys_proof = Some(if to.is_empty() {
        statement.prove_continuation_with(&e, &s, (&ke, &ks))
    } else {
        statement
            .prove_handle_with(
                &a,
                &e,
                &s,
                (&ke, &ks, &test_scalar("F k1")),
                (&test_scalar("F keys c2"), &test_scalar("F keys z2")),
            )
            .unwrap()
    });
    first
}

/// Where F's three points start.
fn points_at(to: &[u8], replaces: Option<ConversationId>) -> usize {
    26 + to.len() + if replaces.is_some() { 16 } else { 0 }
}

/// F is `cid | t | to | replaces | p₀ | A | E_A | base proof | keys proof`,
/// 282 to 538 bytes, with every field where §3 puts it, the base proof
/// exactly when `to` is, and the keys proof in the form `to` sets.
#[test]
fn f_is_laid_out_as_specified() {
    for (to, replaces, len) in [
        (&b"x"[..], None, 491),
        (&[0x5e; 32][..], None, 522),
        (&b""[..], Some(ConversationId([7; 16])), 282),
        (&[0x5e; 32][..], Some(ConversationId([7; 16])), 538),
    ] {
        let first = sample(to, replaces);
        let bytes = first.to_bytes();
        assert_eq!(bytes.len(), len);
        assert_eq!(first.len(), len);
        assert_eq!(&bytes[..16], b"0123456789abcdef");
        assert_eq!(&bytes[16..24], &[1, 2, 3, 4, 5, 6, 7, 8]);
        assert_eq!(usize::from(bytes[24]), to.len());
        assert_eq!(&bytes[25..25 + to.len()], to);
        let at = 25 + to.len();
        match replaces {
            Some(cid) => {
                assert_eq!(bytes[at], 16);
                assert_eq!(&bytes[at + 1..at + 17], &cid.0);
            }
            None => assert_eq!(bytes[at], 0),
        }
        let at = points_at(to, replaces);
        let points = &bytes[at..at + 3 * POINT_LEN];
        assert_eq!(&points[..48], &first.base.to_compressed());
        assert_eq!(&points[48..96], &first.initiator.to_compressed());
        assert_eq!(&points[96..], &first.ephemeral.to_compressed());
        let scalars = |bytes: &[u8]| -> Vec<Scalar> {
            bytes
                .chunks(32)
                .map(|chunk| {
                    Option::from(Scalar::from_bytes_be(&chunk.try_into().unwrap())).unwrap()
                })
                .collect()
        };
        let mut rest = &bytes[at + 3 * POINT_LEN..];
        match &first.proof {
            Some(p) => {
                assert_eq!(
                    scalars(&rest[..BASE_PROOF_LEN]),
                    vec![p.c1, p.c2, p.z1, p.z2]
                );
                rest = &rest[BASE_PROOF_LEN..];
            }
            None => assert!(to.is_empty()),
        }
        assert_eq!(first.proven_bytes(), bytes[..bytes.len() - rest.len()]);
        match first.keys_proof.unwrap() {
            KeysProof::Handle {
                c1,
                c2,
                z1,
                z2,
                ze,
                zs,
            } => {
                assert!(!to.is_empty());
                assert_eq!(rest.len(), KEYS_PROOF_LEN);
                assert_eq!(scalars(rest), vec![c1, c2, z1, z2, ze, zs]);
            }
            KeysProof::Continuation { c, ze, zs } => {
                assert!(to.is_empty());
                assert_eq!(rest.len(), CONTINUATION_KEYS_PROOF_LEN);
                assert_eq!(scalars(rest), vec![c, ze, zs]);
            }
        }
        assert_eq!(first.prefix_bytes(), bytes[..at + 3 * POINT_LEN]);
        assert_eq!(FirstContact::from_bytes(&bytes).unwrap(), first);
    }
    assert_eq!(
        (BASE_PROOF_LEN, KEYS_PROOF_LEN, CONTINUATION_KEYS_PROOF_LEN),
        (128, 192, 96)
    );
    assert_eq!(FIRST_CONTACT_MIN_LEN, 282);
    assert_eq!(FIRST_CONTACT_MAX_LEN, 538);
}

/// Every refusal is a structured error: lengths out of range, neither a
/// handle nor a continuation, any of the proofs' scalars not below the group
/// order, a truncated or extended block, and every bad point in every
/// position. Any scalar may be 0.
#[test]
fn f_refuses_bad_lengths_and_points() {
    let bytes = sample(&[1; 3], None).to_bytes();
    // `to` longer than 32.
    let mut long = sample(&[], Some(ConversationId([7; 16]))).to_bytes();
    long[24] = 33;
    assert_eq!(FirstContact::from_bytes(&long), Err(Error::InvalidMessage));
    // `replaces` of any length but 0 and 16.
    for len in [1u8, 15, 17, 255] {
        let mut changed = sample(&[1], None).to_bytes();
        changed[26] = len;
        assert_eq!(
            FirstContact::from_bytes(&changed),
            Err(Error::InvalidMessage),
            "{len}"
        );
    }
    // No `to` and no `replaces`: neither a handle nor a continuation.
    let mut neither = sample(&[], Some(ConversationId([7; 16]))).to_bytes();
    neither[25] = 0;
    neither.drain(26..42);
    assert_eq!(
        FirstContact::from_bytes(&neither),
        Err(Error::InvalidMessage)
    );
    // Each scalar of both proofs, from a handle (10) and in a continuation
    // (3): q and 2²⁵⁶ − 1 are refused, 0 and q − 1 read.
    let mut q_less_one = GROUP_ORDER;
    q_less_one[31] -= 1;
    for (f, scalars) in [
        (bytes.clone(), 10),
        (sample(&[], Some(ConversationId([7; 16]))).to_bytes(), 3),
    ] {
        for i in 0..scalars {
            let at = f.len() - 32 * (scalars - i);
            for (value, reads) in [
                (GROUP_ORDER, false),
                ([0xff; 32], false),
                ([0; 32], true),
                (q_less_one, true),
            ] {
                let mut changed = f.clone();
                changed[at..at + 32].copy_from_slice(&value);
                assert_eq!(
                    FirstContact::from_bytes(&changed).is_ok(),
                    reads,
                    "scalar {i} of {scalars}"
                );
                if !reads {
                    assert_eq!(
                        FirstContact::from_bytes(&changed),
                        Err(Error::InvalidMessage)
                    );
                }
            }
        }
    }
    for cut in 0..bytes.len() {
        assert!(FirstContact::from_bytes(&bytes[..cut]).is_err(), "{cut}");
    }
    let mut extended = bytes.clone();
    extended.push(0);
    assert_eq!(
        FirstContact::from_bytes(&extended),
        Err(Error::InvalidMessage)
    );

    let (identity, off_curve) = (identity(), off_curve());
    let start = points_at(&[1; 3], None);
    for i in 0..3 {
        let at = start + i * POINT_LEN;
        let mut with_identity = bytes.clone();
        with_identity[at..at + POINT_LEN].copy_from_slice(&identity);
        assert_eq!(
            FirstContact::from_bytes(&with_identity),
            Err(Error::IdentityPoint)
        );
        let mut garbage = bytes.clone();
        garbage[at..at + POINT_LEN].copy_from_slice(&off_curve);
        assert_eq!(
            FirstContact::from_bytes(&garbage),
            Err(Error::InvalidEncoding)
        );
        let mut uncompressed_flag = bytes.clone();
        uncompressed_flag[at] &= 0x7f;
        assert_eq!(
            FirstContact::from_bytes(&uncompressed_flag),
            Err(Error::InvalidEncoding)
        );
    }
}

/// A point on the curve outside G1 is refused in every one of F's positions,
/// before any key touches it.
#[test]
fn f_refuses_points_outside_the_subgroup() {
    let replaces = Some(ConversationId([7; 16]));
    let bytes = sample(&[], replaces).to_bytes();
    let outside = outside_g1();
    for i in 0..3 {
        let at = points_at(&[], replaces) + i * POINT_LEN;
        let mut changed = bytes.clone();
        changed[at..at + POINT_LEN].copy_from_slice(&outside);
        assert_eq!(
            FirstContact::from_bytes(&changed),
            Err(Error::NotInSubgroup),
            "{i}"
        );
    }
}

/// The base proof is an OR-proof of `b` for `p₀ = [b]g`, or of the handle's
/// own key, its challenge `SHA-256(label ‖ g ‖ v ‖ p₀ ‖ T₁ ‖ T₂ ‖ F′)` read
/// mod q and compared with `c₁ + c₂`: it verifies against its handle, and
/// fails against another handle of the same key, and with any bit of F′ or
/// of the base proof changed. The keys proof's bytes are outside it.
#[test]
fn the_base_proof_shows_the_base_re_randomizes_the_named_handle() {
    let (bob_handle, b) = sample_handle();
    let first = sample(b"bob", None);
    assert!(first.proves_base(&bob_handle));
    // Its challenge, recomputed from its definition.
    let proof = first.proof.unwrap();
    let (k, c2, z2) = (test_scalar("F k"), test_scalar("F c2"), test_scalar("F z2"));
    let t1 = (bob_handle.generator() * k).to_affine();
    let t2 = (bob_handle.generator() * z2 - bob_handle.public_value() * c2).to_affine();
    let c: [u8; 32] = Sha256::new()
        .chain_update(b"Seedelf-Messaging|v1|session|base")
        .chain_update(bob_handle.to_bytes())
        .chain_update(first.base.to_compressed())
        .chain_update(t1.to_compressed())
        .chain_update(t2.to_compressed())
        .chain_update(first.prefix_bytes())
        .finalize()
        .into();
    assert_eq!(BASE_LABEL, b"Seedelf-Messaging|v1|session|base");
    let c = scalar_mod_q(&c);
    assert_eq!((proof.c2, proof.z2), (c2, z2));
    assert_eq!(proof.c1, c - c2, "c₁ = c − c₂, c read mod q");
    assert_eq!(proof.z1, k + proof.c1 * b, "z₁ = k + c₁·b");

    // Another of Bob's handles: same key, another generator.
    assert!(!first.proves_base(&handle("bob", "another handle")));
    // Any change to F′ or the base proof; the keys proof's bytes don't
    // touch it.
    let bytes = first.to_bytes();
    let proven = first.proven_bytes().len();
    for byte in 0..bytes.len() {
        let mut changed = bytes.clone();
        changed[byte] ^= 1;
        if let Ok(parsed) = FirstContact::from_bytes(&changed) {
            assert_eq!(
                parsed.proves_base(&bob_handle),
                byte >= proven,
                "byte {byte}"
            );
        }
    }
    // No proof at all: a continuation's F proves nothing.
    assert!(!sample(&[], Some(ConversationId([7; 16]))).proves_base(&bob_handle));
}

/// The sum of two handles of one key is a register of that key, so a first
/// message to it opens only for a wallet holding both. With the proof, a
/// writer who built the base on the sum can't name either handle: the
/// proof she can make shows only the sum. (Its other branch is the named
/// handle's own key, which only its reader holds.)
#[test]
fn a_base_on_the_sum_of_two_handles_proves_neither() {
    let (one, two) = (handle("bob", "one"), handle("bob", "two"));
    let sum = Register::from_checked(
        (one.generator() + two.generator()).to_affine(),
        (one.public_value() + two.public_value()).to_affine(),
    );
    assert!(crate::matches_register(&key("bob"), &sum));
    let b = test_scalar("sum b");
    let base = (sum.generator() * b).to_affine();
    let mut first = sample(b"one", None);
    first.base = base;
    let simulated = (test_scalar("c2"), test_scalar("z2"));
    for named in [&one, &two, &sum] {
        first.proof = Some(prove_base_with(
            named,
            &b,
            &test_scalar("k"),
            (&simulated.0, &simulated.1),
            &first.prefix_bytes(),
        ));
        assert!(!first.proves_base(&one));
        assert!(!first.proves_base(&two));
    }
    // Only the sum's own proof holds, and the sum is no one's handle.
    first.proof = Some(prove_base_with(
        &sum,
        &b,
        &test_scalar("k"),
        (&simulated.0, &simulated.1),
        &first.prefix_bytes(),
    ));
    assert!(first.proves_base(&sum));
}

/// The stamp's digest is `SHA-256(label ‖ F)`, so it covers every byte of
/// F, the proof included.
#[test]
fn the_stamp_digest_covers_f() {
    let first = sample(b"bob", None);
    let mut hash = sha2::Sha256::new();
    sha2::Digest::update(&mut hash, FIRST_STAMP_LABEL);
    sha2::Digest::update(&mut hash, first.to_bytes());
    let expected: [u8; 32] = sha2::Digest::finalize(hash).into();
    assert_eq!(first.stamp_digest(), expected);
    assert_eq!(FIRST_STAMP_LABEL, b"Seedelf-Messaging|v1|session|stamp");
    let bytes = first.to_bytes();
    for byte in [0, 30, bytes.len() - 1] {
        let mut changed = bytes.clone();
        changed[byte] ^= 1;
        if let Ok(parsed) = FirstContact::from_bytes(&changed) {
            assert_ne!(parsed.stamp_digest(), expected);
        }
    }
}

/// Both sides derive the same SK: Alice from `[e_A]w₀ ‖ [x_A]w₀`, Bob from
/// `[x_B]E_A ‖ [x_B]A`.
#[test]
fn both_sides_derive_the_same_session_key() {
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("sk agreement");
    let conversation = Conversation::start_with(
        &alice,
        &handle("bob", "bob's handle"),
        HANDLE_NAME,
        1_800_000_000,
        &mut draw,
    )
    .unwrap();
    let drawn = draw.drain();
    let e = crate::keys::scalar_from_bytes(&drawn[2].clone().try_into().unwrap()).unwrap();
    let first = &conversation.first;
    let w0 = G1Projective::from(conversation.responder);
    assert_eq!(w0, G1Projective::from(first.base) * bob.scalar());

    let alice_sk = session_key(
        &(w0 * e).to_compressed(),
        &(w0 * alice.scalar()).to_compressed(),
        &conversation.first_bytes,
    );
    let bob_sk = session_key(
        &(G1Projective::from(first.ephemeral) * bob.scalar()).to_compressed(),
        &(G1Projective::from(first.initiator) * bob.scalar()).to_compressed(),
        &conversation.first_bytes,
    );
    assert_eq!(alice_sk, bob_sk);
}

/// SK takes F whole: every bit of F changes it, as does the static DH. The
/// static DH is what only R_A's key holder can compute.
#[test]
fn sk_binds_f_and_the_static_dh() {
    let (eph, stat) = ([0x11; POINT_LEN], [0x22; POINT_LEN]);
    let first = sample(&[9; 4], Some(ConversationId([3; 16]))).to_bytes();
    let sk = session_key(&eph, &stat, &first);
    for byte in 0..first.len() {
        for bit in 0..8 {
            let mut changed = first.clone();
            changed[byte] ^= 1 << bit;
            assert_ne!(
                session_key(&eph, &stat, &changed),
                sk,
                "byte {byte} bit {bit}"
            );
        }
    }
    assert_ne!(session_key(&eph, &[0x23; POINT_LEN], &first), sk);
    assert_ne!(session_key(&[0x12; POINT_LEN], &stat, &first), sk);
    // The order of the halves matters: ikm is ephemeral then static.
    assert_ne!(session_key(&stat, &eph, &first), sk);
    // Its labels are its own.
    let mut other = [0u8; 32];
    let mut ikm = eph.to_vec();
    ikm.extend_from_slice(&stat);
    Hkdf::<Sha256>::new(Some(b"Seedelf-Messaging|v2|session|salt"), &ikm)
        .expand_multi_info(&[SESSION_INFO, &first], &mut other)
        .unwrap();
    assert_ne!(&other, sk.bytes());
    Hkdf::<Sha256>::new(Some(SESSION_SALT), &ikm)
        .expand_multi_info(&[b"Seedelf-Messaging|v1|session|SK", &first], &mut other)
        .unwrap();
    assert_eq!(&other, sk.bytes());
}

/// RatchetInitAlice: `(RK, CKs) = KDF_RK(SK, [s_A]w₀)`. Bob's first ratchet
/// step computes the same pair as his `(RK, CKr)` from `[x_B]S_A`.
#[test]
fn ratchet_init_alice_and_bob_agree() {
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("init agreement");
    let mut conversation = Conversation::start_with(
        &alice,
        &handle("bob", "bob's handle"),
        HANDLE_NAME,
        1_800_000_000,
        &mut draw,
    )
    .unwrap();
    let drawn = draw.drain();
    let e = crate::keys::scalar_from_bytes(&drawn[2].clone().try_into().unwrap()).unwrap();
    let s = crate::keys::scalar_from_bytes(&drawn[3].clone().try_into().unwrap()).unwrap();
    let w0 = G1Projective::from(conversation.responder);
    let sk = session_key(
        &(w0 * e).to_compressed(),
        &(w0 * alice.scalar()).to_compressed(),
        &conversation.first_bytes,
    );
    let (rk, cks) = kdf_rk(&sk, &(w0 * s).to_compressed());
    assert_eq!(conversation.ratchet.rk, rk);
    assert_eq!(conversation.ratchet.cks.as_ref(), Some(&cks));
    assert_eq!(conversation.ratchet.dhr, Some(conversation.responder));
    assert_eq!(
        conversation.ratchet.dhs.public,
        (G1Projective::from(conversation.first.base) * s).to_affine()
    );
    assert_eq!(
        (
            conversation.ratchet.ns,
            conversation.ratchet.nr,
            conversation.ratchet.pn
        ),
        (0, 0, 0)
    );
    assert!(conversation.ratchet.ckr.is_none());
    assert!(conversation.sends_first_contact());

    // Bob's side: from [x_B]S_A he reaches the same root and chain.
    let sa = G1Projective::from(conversation.ratchet.dhs.public);
    let (bob_rk, bob_ckr) = kdf_rk(&sk, &(sa * bob.scalar()).to_compressed());
    assert_eq!((bob_rk, bob_ckr), (rk, cks));

    stamp(&mut conversation);
    let envelope = conversation.send_with(b"hi", &mut draw).unwrap();
    let message = opened(&bob, &envelope);
    let (bob_side, texts) =
        Conversation::accept_with(&bob, &[(&message, 1_800_000_000)], &mut draw).unwrap();
    assert_eq!(texts, vec![Ok(b"hi".to_vec())]);
    assert_eq!(bob_side.role, Role::Responder);
    // Bob's state never keeps x_B: the first ratchet step replaced it.
    assert_ne!(bob_side.ratchet.dhs.public, bob_side.responder);
    assert_ne!(
        bob_side.ratchet.dhs.secret.bytes(),
        &bob.scalar().to_bytes_be()
    );
    assert_eq!(bob_side.ratchet.nr, 1);
}

/// R_B is a re-randomization of Bob's handle, R_A is Alice's key on R_B's
/// base, and both share p₀. Alice's own scan finds R_A; Bob's finds R_B.
#[test]
fn identities_share_a_base_and_belong_to_their_sides() {
    let (alice, bob) = (key("alice"), key("bob"));
    let conversation = Conversation::start_with(
        &alice,
        &handle("bob", "bob's handle"),
        HANDLE_NAME,
        0,
        &mut Seeded::new("identities"),
    )
    .unwrap();
    let ra = conversation.initiator_register();
    let rb = conversation.responder_register();
    assert_eq!(ra.generator_bytes(), rb.generator_bytes());
    assert!(crate::matches_register(&alice, &ra));
    assert!(crate::matches_register(&bob, &rb));
    assert!(!crate::matches_register(&bob, &ra));
    assert!(!crate::matches_register(&alice, &rb));
}

/// Starting a conversation with one's own handle is refused: R_A would be
/// R_B, and the protocol can't carry it. So is a start without a handle's
/// name, or with one longer than 32 bytes.
#[test]
fn a_conversation_with_ones_own_handle_is_refused() {
    let alice = key("alice");
    assert_eq!(
        Conversation::start_with(
            &alice,
            &handle("alice", "her handle"),
            HANDLE_NAME,
            0,
            &mut Seeded::new("own")
        )
        .err(),
        Some(Error::OwnRegister)
    );
    for to in [&[][..], &[0; 33][..]] {
        assert_eq!(
            Conversation::start_with(&alice, &handle("bob", "h"), to, 0, &mut Seeded::new("to"))
                .err(),
            Some(Error::InvalidMessage)
        );
    }
}

/// The window: `now ∈ [t − 1 h, t + 48 h]`, both ends included.
#[test]
fn the_window_is_minus_an_hour_to_plus_48_hours() {
    let t = 1_800_000_000;
    assert!(within_window(t, t));
    assert!(within_window(t, t + 48 * 3600));
    assert!(!within_window(t, t + 48 * 3600 + 1));
    assert!(within_window(t, t - 3600));
    assert!(!within_window(t, t - 3601));
    // No overflow at the ends of the range.
    assert!(within_window(u64::MAX, u64::MAX));
    assert!(!within_window(u64::MAX, 0));
    assert!(!within_window(0, u64::MAX));
}

/// `b` and the base proof's `k` from their definitions (§16.2): HMAC-SHA-512
/// keyed by `x` and by `b`, over the handle and F's head, and over the
/// handle, `p₀`, F′ and the simulated branch's `c₂` and `z₂`, each with its
/// aux. Checks the start used them.
fn b_and_k(
    x: &Scalar,
    handle: &Register,
    conversation: &Conversation,
    aux_b: &[u8; 32],
    simulated: (&Scalar, &Scalar),
    aux_k: &[u8; 32],
) -> (Scalar, Scalar) {
    let first = &conversation.first;
    let head = head_bytes(&first.cid, first.started_at, &first.to, first.replaces);
    let b = scalar_mod_q(&hedge_okm(x, &base_scalar_message(handle, &head, aux_b))[..]);
    let prefix = first.prefix_bytes();
    let k = scalar_mod_q(
        &hedge_okm(
            &b,
            &base_nonce_message(handle, &first.base, &prefix, simulated, aux_k),
        )[..],
    );
    assert_eq!((handle.generator() * b).to_affine(), first.base);
    assert_eq!(
        (handle.public_value() * b).to_affine(),
        conversation.responder
    );
    assert_eq!(
        first.proof,
        Some(prove_base_with(handle, &b, &k, simulated, &prefix))
    );
    (b, k)
}

/// A drawn scalar from its logged bytes.
fn drawn_scalar(drawn: &[Vec<u8>], i: usize) -> Scalar {
    crate::keys::scalar_from_bytes(&drawn[i].clone().try_into().unwrap()).unwrap()
}

/// A start from a handle draws `cid`, `b`'s aux, `e_A`, `s_A`, the base
/// proof's `c₂`, `z₂` and aux, then the keys proof's `c₂`, `z₂` and aux, in
/// that order; a continuation draws `cid`, `e_A`, `s_A` and the keys proof's
/// aux, with no `b` and no base proof.
#[test]
fn the_start_draws_in_the_documented_order() {
    let alice = key("alice");
    let bob_handle = handle("bob", "h");
    let mut draw = Seeded::new("order");
    let conversation =
        Conversation::start_with(&alice, &bob_handle, HANDLE_NAME, 0, &mut draw).unwrap();
    let drawn = draw.drain();
    assert_eq!(drawn.len(), 10);
    assert_eq!(drawn[0], conversation.cid().0);
    let aux = |i: usize| -> [u8; 32] { drawn[i].clone().try_into().unwrap() };
    let (c2, z2) = (drawn_scalar(&drawn, 4), drawn_scalar(&drawn, 5));
    b_and_k(
        &alice.scalar(),
        &bob_handle,
        &conversation,
        &aux(1),
        (&c2, &z2),
        &aux(6),
    );
    let p0 = G1Projective::from(conversation.first.base);
    assert_eq!(
        (p0 * drawn_scalar(&drawn, 2)).to_affine(),
        conversation.first.ephemeral
    );
    assert_eq!(
        (p0 * drawn_scalar(&drawn, 3)).to_affine(),
        conversation.ratchet.dhs.public
    );
    let Some(KeysProof::Handle { c2, z2, .. }) = conversation.first.keys_proof else {
        panic!("from a handle, the handle form")
    };
    assert_eq!((c2, z2), (drawn_scalar(&drawn, 7), drawn_scalar(&drawn, 8)));

    let mut draw = Seeded::new("order 2");
    let next = Conversation::continue_with(&alice, &conversation, 0, &mut draw).unwrap();
    let drawn = draw.drain();
    assert_eq!(drawn.len(), 4);
    assert_eq!(drawn[0], next.cid().0);
    assert!(next.first.to.is_empty() && next.first.proof.is_none());
    assert!(matches!(
        next.first.keys_proof,
        Some(KeysProof::Continuation { .. })
    ));
    assert_eq!(next.first.base, conversation.first.base);
    assert_eq!(next.first.replaces, Some(conversation.cid()));
}

/// b and k are hedged (joint-security.md, rule 2). With every draw held
/// still, as a failed or repeating source gives them, b stays the writer's
/// secret and each k meets one challenge. When both were drawn, in the order
/// b, cid, e_A, s_A, k, a stuck source gave k = b, and z = b(1 + c) gave b
/// away from one F; b unblinds A into [x]g_S.
#[test]
fn a_stuck_random_source_still_keeps_b_secret_and_gives_each_proof_its_own_k() {
    let (alice, carol) = (key("alice"), key("carol"));
    let bob_handle = handle("bob", "h");
    let aux = [0x5a; 32];
    let stuck = |scalar: u64| Stuck {
        scalar: Scalar::from(scalar),
        aux,
    };
    let start = |key: &crate::SecretKey, draw: &mut Stuck| {
        Conversation::start_with(key, &bob_handle, HANDLE_NAME, 0, draw).unwrap()
    };
    let five = Scalar::from(5u64);
    let one = start(&alice, &mut stuck(5));
    let (b, k) = b_and_k(
        &alice.scalar(),
        &bob_handle,
        &one,
        &aux,
        (&five, &five),
        &aux,
    );
    let proof = one.first.proof.unwrap();

    // k isn't b, and the one-F recovery the drawn order allowed fails.
    assert_ne!(k, b);
    assert_ne!(proof.z1 * (Scalar::ONE + proof.c1).invert().unwrap(), b);

    // The same key, handle, time and draws: the same F, proofs and all.
    assert_eq!(start(&alice, &mut stuck(5)).first_bytes, one.first_bytes);

    // The same aux under another F′ (here another E_A, and other c₂, z₂):
    // the same b, another k, and the two-F recovery fails too.
    let two = start(&alice, &mut stuck(6));
    assert_ne!(two.first.prefix_bytes(), one.first.prefix_bytes());
    let six = Scalar::from(6u64);
    let (b2, k2) = b_and_k(&alice.scalar(), &bob_handle, &two, &aux, (&six, &six), &aux);
    assert_eq!(b2, b);
    assert_ne!(k2, k);
    let proof2 = two.first.proof.unwrap();
    assert_ne!(proof2.c1, proof.c1);
    assert_ne!(
        (proof.z1 - proof2.z1) * (proof.c1 - proof2.c1).invert().unwrap(),
        b
    );

    // Another key under the same draws: another b, so a source anyone can
    // predict doesn't make b theirs.
    let carols = start(&carol, &mut stuck(5));
    assert_ne!(carols.first.base, one.first.base);
    let (b3, _) = b_and_k(
        &carol.scalar(),
        &bob_handle,
        &carols,
        &aux,
        (&five, &five),
        &aux,
    );
    assert_ne!(b3, b);

    // Each part of b's message changes b: the handle, cid, t, the name,
    // replaces, aux.
    let x = alice.scalar();
    let cid = ConversationId(aux[..16].try_into().unwrap());
    let b_of = |handle: &Register, head: Vec<u8>, aux: [u8; 32]| {
        base_scalar(
            &x,
            handle,
            &head,
            &mut Stuck {
                scalar: Scalar::from(5u64),
                aux,
            },
        )
    };
    let head = |cid: ConversationId, t: u64, to: &[u8], replaces: Option<ConversationId>| {
        head_bytes(&cid, t, to, replaces)
    };
    assert_eq!(b_of(&bob_handle, head(cid, 0, HANDLE_NAME, None), aux), b);
    let others = [
        b_of(
            &handle("bob", "another"),
            head(cid, 0, HANDLE_NAME, None),
            aux,
        ),
        b_of(
            &bob_handle,
            head(ConversationId([1; 16]), 0, HANDLE_NAME, None),
            aux,
        ),
        b_of(&bob_handle, head(cid, 1, HANDLE_NAME, None), aux),
        b_of(&bob_handle, head(cid, 0, b"another name", None), aux),
        b_of(&bob_handle, head(cid, 0, HANDLE_NAME, Some(cid)), aux),
        b_of(&bob_handle, head(cid, 0, HANDLE_NAME, None), [0xa5; 32]),
    ];
    for (i, other) in others.iter().enumerate() {
        assert_ne!(*other, b, "part {i} of b's message");
    }

    // Each part of k's message changes k: the handle, p₀, F′, c₂, z₂, aux,
    // and the key, b.
    let prefix = one.first.prefix_bytes();
    let k_of = |key: &Scalar,
                handle: &Register,
                base: &G1Affine,
                prefix: &[u8],
                simulated: (&Scalar, &Scalar),
                aux: [u8; 32]| {
        scalar_mod_q(
            &hedge_okm(
                key,
                &base_nonce_message(handle, base, prefix, simulated, &aux),
            )[..],
        )
    };
    let base = one.first.base;
    let mut changed = prefix.clone();
    changed[20] ^= 1;
    let sim = (&five, &five);
    assert_eq!(k_of(&b, &bob_handle, &base, &prefix, sim, aux), k);
    let others = [
        k_of(&b, &handle("bob", "another"), &base, &prefix, sim, aux),
        k_of(&b, &bob_handle, &two.first.ephemeral, &prefix, sim, aux),
        k_of(&b, &bob_handle, &base, &changed, sim, aux),
        k_of(&b, &bob_handle, &base, &prefix, (&six, &five), aux),
        k_of(&b, &bob_handle, &base, &prefix, (&five, &six), aux),
        k_of(&b, &bob_handle, &base, &prefix, sim, [0xa5; 32]),
        k_of(&x, &bob_handle, &base, &prefix, sim, aux),
    ];
    for (i, other) in others.iter().enumerate() {
        assert_ne!(*other, k, "part {i} of k's message");
    }
}

/// b and k are HMAC-SHA-512 of exactly §16.2's messages, written out here
/// byte by byte, under x's and b's 32 big-endian bytes: with a `replaces`
/// and without.
#[test]
fn b_and_k_are_hmac_sha512_of_their_specified_messages() {
    use hmac::{Hmac, Mac};
    let hmac = |key: &Scalar, message: &[u8]| {
        let mut mac = <Hmac<sha2::Sha512> as Mac>::new_from_slice(&key.to_bytes_be()).unwrap();
        mac.update(message);
        scalar_mod_q(&mac.finalize().into_bytes())
    };
    let alice = key("alice");
    let bob_handle = handle("bob", "h");
    for replaces in [None, Some(ConversationId([9; 16]))] {
        let mut draw = Seeded::new("hmac messages");
        let conversation = Conversation::begin(
            &alice,
            Origin::Handle(&bob_handle),
            HANDLE_NAME,
            replaces,
            0x0102_0304_0506_0708,
            &mut draw,
        )
        .unwrap();
        let drawn = draw.drain();
        let first = &conversation.first;

        let mut expected = b"Seedelf-Messaging|v1|session|base-scalar".to_vec();
        expected.extend_from_slice(&bob_handle.generator_bytes());
        expected.extend_from_slice(&bob_handle.public_value_bytes());
        expected.extend_from_slice(&drawn[0]);
        expected.extend_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8]);
        expected.push(HANDLE_NAME.len() as u8);
        expected.extend_from_slice(HANDLE_NAME);
        match replaces {
            Some(cid) => {
                expected.push(16);
                expected.extend_from_slice(&cid.0);
            }
            None => expected.push(0),
        }
        expected.extend_from_slice(&drawn[1]);
        let head = head_bytes(&first.cid, first.started_at, &first.to, first.replaces);
        let aux_b: [u8; 32] = drawn[1].clone().try_into().unwrap();
        assert_eq!(base_scalar_message(&bob_handle, &head, &aux_b), expected);
        let b = hmac(&alice.scalar(), &expected);
        assert_eq!((bob_handle.generator() * b).to_affine(), first.base);

        let mut expected = b"Seedelf-Messaging|v1|session|base-nonce".to_vec();
        expected.extend_from_slice(&bob_handle.generator_bytes());
        expected.extend_from_slice(&bob_handle.public_value_bytes());
        expected.extend_from_slice(&first.base.to_compressed());
        expected.extend_from_slice(&first.prefix_bytes());
        expected.extend_from_slice(&drawn[4]);
        expected.extend_from_slice(&drawn[5]);
        expected.extend_from_slice(&drawn[6]);
        let (c2, z2) = (drawn_scalar(&drawn, 4), drawn_scalar(&drawn, 5));
        let aux_k: [u8; 32] = drawn[6].clone().try_into().unwrap();
        assert_eq!(
            base_nonce_message(
                &bob_handle,
                &first.base,
                &first.prefix_bytes(),
                (&c2, &z2),
                &aux_k
            ),
            expected
        );
        let k = hmac(&b, &expected);
        let proof = first.proof.unwrap();
        assert_eq!((proof.c2, proof.z2), (c2, z2));
        assert_eq!(
            (bob_handle.generator() * proof.z1 - G1Projective::from(first.base) * proof.c1)
                .to_affine(),
            (bob_handle.generator() * k).to_affine(),
            "T₁ is [k]g_S"
        );
        assert_eq!(proof.z1, k + proof.c1 * b);
    }
}
