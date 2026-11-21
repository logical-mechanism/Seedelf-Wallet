//! Part 1: the first-contact block F, SK with the static DH, and
//! RatchetInitAlice and RatchetInitBob (docs/protocol.md §3).

use blstrs::{G1Affine, G1Projective};
use group::Curve;
use hkdf::Hkdf;
use sha2::Sha256;

use super::support::{Seeded, handle, identity, key, off_curve, opened, outside_g1, test_scalar};
use crate::Error;
use crate::register::POINT_LEN;
use crate::session::conversation::{Conversation, Role};
use crate::session::draw::Draw;
use crate::session::first_contact::{
    ConversationId, FIRST_CONTACT_MAX_LEN, FIRST_CONTACT_MIN_LEN, FirstContact, SESSION_INFO,
    SESSION_SALT, session_key, within_window,
};
use crate::session::ratchet::kdf_rk;

fn sample(to: &[u8], replaces: Option<ConversationId>) -> FirstContact {
    let base = (super::support::g() * test_scalar("F base")).to_affine();
    FirstContact {
        cid: ConversationId(*b"0123456789abcdef"),
        started_at: 0x0102_0304_0506_0708,
        to: to.to_vec(),
        replaces,
        base,
        initiator: (G1Projective::from(base) * test_scalar("F a")).to_affine(),
        ephemeral: (G1Projective::from(base) * test_scalar("F e")).to_affine(),
    }
}

/// F is `cid | t | to | replaces | p₀ | A | E_A`, 170 to 218 bytes, with
/// every field where §3 puts it.
#[test]
fn f_is_laid_out_as_specified() {
    for (to, replaces, len) in [
        (&b""[..], None, 170),
        (&[0x5e; 32][..], None, 202),
        (&b""[..], Some(ConversationId([7; 16])), 186),
        (&[0x5e; 32][..], Some(ConversationId([7; 16])), 218),
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
        let points = &bytes[len - 3 * POINT_LEN..];
        assert_eq!(&points[..48], &first.base.to_compressed());
        assert_eq!(&points[48..96], &first.initiator.to_compressed());
        assert_eq!(&points[96..], &first.ephemeral.to_compressed());
        assert_eq!(FirstContact::from_bytes(&bytes).unwrap(), first);
    }
    assert_eq!(FIRST_CONTACT_MIN_LEN, 170);
    assert_eq!(FIRST_CONTACT_MAX_LEN, 218);
}

/// Every refusal is a structured error: lengths out of range, a truncated or
/// extended block, and every bad point in every position.
#[test]
fn f_refuses_bad_lengths_and_points() {
    let bytes = sample(&[1; 3], None).to_bytes();
    // `to` longer than 32.
    let mut long = sample(&[], None).to_bytes();
    long[24] = 33;
    assert_eq!(FirstContact::from_bytes(&long), Err(Error::InvalidMessage));
    // `replaces` of any length but 0 and 16.
    for len in [1u8, 15, 17, 255] {
        let mut changed = sample(&[], None).to_bytes();
        changed[25] = len;
        assert_eq!(
            FirstContact::from_bytes(&changed),
            Err(Error::InvalidMessage),
            "{len}"
        );
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
    let start = bytes.len() - 3 * POINT_LEN;
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
    let bytes = sample(&[], None).to_bytes();
    let outside = outside_g1();
    for i in 0..3 {
        let at = 26 + i * POINT_LEN;
        let mut changed = bytes.clone();
        changed[at..at + POINT_LEN].copy_from_slice(&outside);
        assert_eq!(
            FirstContact::from_bytes(&changed),
            Err(Error::NotInSubgroup),
            "{i}"
        );
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
        b"",
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
        b"",
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
        b"",
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
/// R_B, and the protocol can't carry it.
#[test]
fn a_conversation_with_ones_own_handle_is_refused() {
    let alice = key("alice");
    assert_eq!(
        Conversation::start_with(
            &alice,
            &handle("alice", "her handle"),
            b"",
            0,
            &mut Seeded::new("own")
        )
        .err(),
        Some(Error::OwnRegister)
    );
    assert_eq!(
        Conversation::start_with(
            &alice,
            &handle("bob", "h"),
            &[0; 33],
            0,
            &mut Seeded::new("to")
        )
        .err(),
        Some(Error::InvalidMessage)
    );
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

/// The start draws `b`, `cid`, `e_A`, `s_A`, in that order; a continuation
/// draws no `b`.
#[test]
fn the_start_draws_in_the_documented_order() {
    let alice = key("alice");
    let mut draw = Seeded::new("order");
    let conversation =
        Conversation::start_with(&alice, &handle("bob", "h"), b"", 0, &mut draw).unwrap();
    let drawn = draw.drain();
    assert_eq!(drawn.len(), 4);
    assert_eq!(drawn[1], conversation.cid().0);
    let mut replay = Seeded::new("order");
    let b = replay.scalar();
    let generator = G1Projective::from(
        G1Affine::from_compressed(&handle("bob", "h").generator_bytes()).unwrap(),
    );
    assert_eq!((generator * b).to_affine(), conversation.first.base);

    let mut draw = Seeded::new("order 2");
    let next = Conversation::continue_with(&alice, &conversation, b"", 0, &mut draw).unwrap();
    assert_eq!(draw.drain().len(), 3);
    assert_eq!(next.first.base, conversation.first.base);
    assert_eq!(next.first.replaces, Some(conversation.cid()));
}
