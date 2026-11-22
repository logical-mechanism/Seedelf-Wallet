//! Part 3: the versioned state, decryption on a copy, padding and the inner
//! messages' parsing (docs/protocol.md §4.2, §9 and §12).

use super::ratchet::pair;
use super::support::{Seeded, handle, identity, key, opened, outside_g1, skip_sends, start};
use crate::envelope::{ENVELOPE_OVERHEAD, encrypt_message};
use crate::session::conversation::{Conversation, Role, STATE_VERSION};
use crate::session::first_contact::ConversationId;
use crate::session::wire::{
    ENVELOPE_SIZES, MAX_ENVELOPE_LEN, Opened, inner_capacity, open, pad, unpad,
};
use crate::{Error, SecretKey};

const T: u64 = 1_800_000_000;

fn round_trip(conversation: &Conversation) -> Conversation {
    let bytes = conversation.to_bytes();
    let restored = Conversation::from_bytes(&bytes).unwrap();
    assert_eq!(*restored.to_bytes(), *bytes);
    restored
}

/// A whole exchange, both sides stored and restored between every step,
/// behaves as one kept in memory: the same draws give the same envelopes.
#[test]
fn a_conversation_survives_storage_at_every_step() {
    let run = |store: bool| {
        let (alice, bob) = (key("alice"), key("bob"));
        let mut draw = Seeded::new("storage");
        let keep = |c: Conversation| if store { round_trip(&c) } else { c };
        let mut a = keep(start(&alice, &handle("bob", "h"), T, &mut draw));
        let mut out = Vec::new();
        let m0 = a.send_with(b"zero", &mut draw).unwrap();
        a = keep(a);
        let m1 = a.send_with(b"one", &mut draw).unwrap();
        a = keep(a);
        let (mut b, _) =
            Conversation::accept_with(&bob, &[(&opened(&bob, &m1), T)], &mut draw).unwrap();
        b = keep(b);
        out.push(b.receive_with(&opened(&bob, &m0), T, &mut draw).unwrap());
        b = keep(b);
        for i in 0..4 {
            let r = b.send_with(format!("r{i}").as_bytes(), &mut draw).unwrap();
            b = keep(b);
            out.push(a.receive_with(&opened(&alice, &r), T, &mut draw).unwrap());
            a = keep(a);
            let m = a.send_with(format!("m{i}").as_bytes(), &mut draw).unwrap();
            a = keep(a);
            out.push(b.receive_with(&opened(&bob, &m), T, &mut draw).unwrap());
            b = keep(b);
            out.push(m);
        }
        (out, a.to_bytes().to_vec(), b.to_bytes().to_vec())
    };
    assert_eq!(run(true), run(false));
}

/// A state with both chains, skipped keys and a lost count, for the
/// corruption tests.
fn full_state() -> Vec<u8> {
    let mut p = pair("full state");
    skip_sends(&mut p.a, 3);
    let message = opened(&p.bob, &p.a.send_with(b"x", &mut p.draw).unwrap());
    p.b.receive_with(&message, T, &mut p.draw).unwrap();
    p.b.ratchet.lost = 7;
    assert_eq!(p.b.ratchet.skipped.len(), 3);
    p.b.to_bytes().to_vec()
}

/// Every truncation, an extension, another version, and every flipped byte
/// is refused or read as another valid state, never a panic.
#[test]
fn a_stored_state_is_checked_on_reading() {
    let bytes = full_state();
    assert!(Conversation::from_bytes(&bytes).is_ok());
    for cut in 0..bytes.len() {
        assert!(Conversation::from_bytes(&bytes[..cut]).is_err(), "{cut}");
    }
    let mut extended = bytes.clone();
    extended.push(0);
    assert_eq!(
        Conversation::from_bytes(&extended).err(),
        Some(Error::InvalidState)
    );
    for version in [0u8, 2, 255] {
        let mut other = bytes.clone();
        other[0] = version;
        assert_eq!(
            Conversation::from_bytes(&other).err(),
            Some(Error::UnsupportedStateVersion(version))
        );
    }
    assert_eq!(bytes[0], STATE_VERSION);
    let mut role = bytes.clone();
    role[1] = 2;
    assert_eq!(
        Conversation::from_bytes(&role).err(),
        Some(Error::InvalidState)
    );
    for i in 1..bytes.len() {
        let mut flipped = bytes.clone();
        flipped[i] ^= 0xff;
        // Either refused or another state that serializes to what was read.
        if let Ok(read) = Conversation::from_bytes(&flipped) {
            assert_eq!(*read.to_bytes(), flipped, "{i}");
        }
    }
}

/// The ratchet key's public half must be its scalar on the base: a state
/// whose two halves disagree is refused.
#[test]
fn a_state_whose_ratchet_key_halves_disagree_is_refused() {
    let p = pair("halves");
    let mut changed = p.b.clone();
    changed.ratchet.dhs.public = p.a.ratchet.dhs.public;
    assert_eq!(
        Conversation::from_bytes(&changed.to_bytes()).err(),
        Some(Error::InvalidState)
    );
    // And a responder with no receiving chain isn't a reachable state.
    let mut changed = p.b.clone();
    changed.ratchet.ckr = None;
    assert_eq!(
        Conversation::from_bytes(&changed.to_bytes()).err(),
        Some(Error::InvalidState)
    );
}

/// Every failed operation leaves the state's bytes as they were.
#[test]
fn a_failed_operation_leaves_the_state_as_it_was() {
    let mut p = pair("unchanged");
    let good = opened(&p.bob, &p.a.send_with(b"good", &mut p.draw).unwrap());
    let before = p.b.to_bytes();
    let mut failures: Vec<(Opened, Error)> = Vec::new();
    let mut bad_tag = good.clone();
    *bad_tag.ciphertext.last_mut().unwrap() ^= 1;
    failures.push((bad_tag, Error::DecryptionFailed));
    let mut bad_header = good.clone();
    bad_header.header.pn ^= 1;
    failures.push((bad_header, Error::DecryptionFailed));
    let mut other_cid = good.clone();
    other_cid.cid = ConversationId([0xee; 16]);
    failures.push((other_cid, Error::UnknownConversation));
    let mut far = good.clone();
    far.header.n = 5000;
    failures.push((far, Error::TooFarAhead));
    for (message, error) in failures {
        assert_eq!(p.b.receive_with(&message, T, &mut p.draw), Err(error));
        assert_eq!(p.b.to_bytes(), before);
    }
    assert_eq!(p.b.receive_with(&good, T, &mut p.draw).unwrap(), b"good");
    let before = p.b.to_bytes();
    assert_eq!(
        p.b.receive_with(&good, T, &mut p.draw),
        Err(Error::KeyUsedOrDeleted)
    );
    assert_eq!(p.b.to_bytes(), before);
    let too_long = vec![0u8; p.b.max_text_len() + 1];
    assert_eq!(
        p.b.send_with(&too_long, &mut p.draw),
        Err(Error::MessageTooLarge)
    );
    assert_eq!(p.b.to_bytes(), before);
}

/// No secret reaches `Debug`, and the responder's stored state never holds
/// its long-term key.
#[test]
fn secrets_stay_out_of_debug_and_x_out_of_the_state() {
    let p = pair("secrets");
    let shown = format!("{:?} {:?}", p.a, p.b);
    for conversation in [&p.a, &p.b] {
        let r = &conversation.ratchet;
        for secret in [
            Some(&r.rk),
            r.cks.as_ref(),
            r.ckr.as_ref(),
            Some(&r.dhs.secret),
        ]
        .into_iter()
        .flatten()
        {
            assert!(!shown.contains(&hex::encode(secret.bytes())));
        }
    }
    let stored = p.b.to_bytes();
    let x = p.bob.scalar().to_bytes_be();
    assert!(!stored.windows(32).any(|w| w == x));
    let stored = p.a.to_bytes();
    let x = p.alice.scalar().to_bytes_be();
    assert!(!stored.windows(32).any(|w| w == x));
}

/// The inner message fills one of the four sizes, with the boundaries §9
/// gives: a session message holds 245 bytes of text in 512 bytes, a
/// first-contact message with an empty `to` and no `replaces` 91.
#[test]
fn messages_fill_the_four_envelope_sizes() {
    assert_eq!(inner_capacity(512), 350);
    let mut p = pair("sizes");
    for (len, size) in [
        (0, 512),
        (245, 512),
        (246, 2048),
        (1781, 2048),
        (1782, 8192),
        (7925, 8192),
        (7926, 32768),
        (32501, 32768),
    ] {
        let envelope = p.a.send_with(&vec![b'z'; len], &mut p.draw).unwrap();
        assert_eq!(envelope.len(), size, "{len}");
        assert_eq!(
            p.b.receive_with(&opened(&p.bob, &envelope), T, &mut p.draw)
                .unwrap()
                .len(),
            len
        );
    }
    assert_eq!(p.a.max_text_len(), 32501);
    assert_eq!(
        p.a.send_with(&[0; 32502], &mut p.draw),
        Err(Error::MessageTooLarge)
    );
}

/// Padding is `0x80` then zeros to an exact size; anything else is refused.
#[test]
fn padding_is_exact() {
    for size in ENVELOPE_SIZES {
        let inner = vec![0u8; 10];
        let padded = pad(&inner, size);
        assert_eq!(padded.len() + ENVELOPE_OVERHEAD, size);
        assert_eq!(unpad(&padded).unwrap(), &inner[..]);
        // An inner message ending in zeros keeps them.
        assert_eq!(unpad(&padded).unwrap().len(), 10);
    }
    let padded = pad(b"abc", 512);
    assert_eq!(
        unpad(&padded[..padded.len() - 1]),
        Err(Error::InvalidPadding)
    );
    let mut longer = padded.clone();
    longer.push(0);
    assert_eq!(unpad(&longer), Err(Error::InvalidPadding));
    assert_eq!(unpad(&vec![0u8; 351]), Err(Error::InvalidPadding));
    let mut stray = padded.clone();
    stray[10] = 1;
    assert_eq!(unpad(&stray), Err(Error::InvalidPadding));
    let mut other_marker = padded.clone();
    other_marker[3] = 0x81;
    assert_eq!(unpad(&other_marker), Err(Error::InvalidPadding));
    // Any of the four sizes is read, not only the smallest that fits.
    let roomy = pad(b"abc", MAX_ENVELOPE_LEN);
    assert_eq!(unpad(&roomy).unwrap(), b"abc");
}

/// An envelope that opens but holds a badly padded or malformed inner
/// message, or a bad point in its header or F, is refused with a structured
/// error.
#[test]
fn opening_refuses_bad_inner_messages() {
    let bob = key("bob");
    let p = pair("inner");
    let seal = |inner: &[u8]| {
        encrypt_message(&bob.register(), &pad(inner, 512))
            .unwrap()
            .to_bytes()
    };
    let mut valid = p.a.clone();
    let good = opened(
        &bob,
        &valid.send_with(b"ok", &mut Seeded::new("x")).unwrap(),
    )
    .bytes;
    assert_eq!(good[0], 0x02);
    assert!(open(&bob, &seal(&good)).is_ok());

    // Not padded to a size.
    let unpadded = encrypt_message(&bob.register(), &good).unwrap().to_bytes();
    assert_eq!(open(&bob, &unpadded).err(), Some(Error::InvalidPadding));
    // Another type byte.
    for kind in [0x00, 0x03, 0xff] {
        let mut other = good.clone();
        other[0] = kind;
        assert_eq!(open(&bob, &seal(&other)).err(), Some(Error::InvalidMessage));
    }
    // Too short for a ratchet ciphertext, at every length.
    for cut in 0..1 + 16 + 56 + 32 {
        assert!(open(&bob, &seal(&good[..cut])).is_err(), "{cut}");
    }
    // A bad header point.
    let mut with_identity = good.clone();
    with_identity[17..65].copy_from_slice(&identity());
    assert_eq!(
        open(&bob, &seal(&with_identity)).err(),
        Some(Error::IdentityPoint)
    );
    let mut outside = good.clone();
    outside[17..65].copy_from_slice(&outside_g1());
    assert_eq!(
        open(&bob, &seal(&outside)).err(),
        Some(Error::NotInSubgroup)
    );
    // Another key's envelope isn't opened at all.
    let carol = SecretKey::generate();
    assert_eq!(open(&carol, &seal(&good)).err(), Some(Error::NotForThisKey));
}

/// A first-contact message's F is parsed and checked like any other.
#[test]
fn opening_checks_f_in_a_first_contact_message() {
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("f check");
    let mut a = start(&alice, &handle("bob", "h"), T, &mut draw);
    let good = opened(&bob, &a.send_with(b"hi", &mut draw).unwrap()).bytes;
    assert_eq!((good[0], a.role()), (0x01, Role::Initiator));
    let seal = |inner: &[u8]| {
        encrypt_message(&bob.register(), &pad(inner, 2048))
            .unwrap()
            .to_bytes()
    };
    // p₀, A, E_A sit at 47, 95 and 143: the type, cid, t, `to`'s length
    // and 20 bytes, and the empty `replaces`.
    assert_eq!(super::support::HANDLE_NAME.len(), 20);
    for at in [47, 95, 143] {
        let mut changed = good.clone();
        changed[at..at + 48].copy_from_slice(&outside_g1());
        assert_eq!(
            open(&bob, &seal(&changed)).err(),
            Some(Error::NotInSubgroup),
            "{at}"
        );
    }
    // The ratchet header's key, after F's proof (64) and the stamp (8).
    let mut changed = good.clone();
    changed[263..311].copy_from_slice(&identity());
    assert_eq!(
        open(&bob, &seal(&changed)).err(),
        Some(Error::IdentityPoint)
    );
}
