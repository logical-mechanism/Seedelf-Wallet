//! Part 7: "too far ahead" is said only of a message that authenticates at
//! the conversation's identity (docs/protocol.md §6, §16.4; the 1.10.0 gate's
//! design, §3.3). Past MAX_SKIP a held conversation steps its chain, storing
//! nothing and drawing nothing, at most MAX_AUTH_STEPS keys, to learn
//! whether a session message authenticates and its envelope checks. Only
//! then is it TooFarAhead, which the wallet shows as a conversation that
//! can't continue; anything else past the bound is refused as a forgery is,
//! silently. Before, any header past the bound was TooFarAhead, so a forger
//! could raise the flag with one envelope.

use blstrs::G1Projective;
use group::Curve;

use super::linking::{ephemeral_on, generator_on};
use super::ratchet::{Pair, pair};
use super::support::{Seeded, handle, key, opened, skip_sends, start, test_scalar};
use crate::envelope::encrypt_message;
use crate::register::Register;
use crate::session::conversation::Conversation;
use crate::session::ratchet::{Header, KDF_CK_CALLS, MAX_AUTH_STEPS, MAX_SKIP};
use crate::session::wire::{Opened, pad};
use crate::{Error, SecretKey};

const T: u64 = 1_800_000_000;

fn calls() -> u64 {
    KDF_CK_CALLS.with(|calls| calls.get())
}

fn reset() {
    KDF_CK_CALLS.with(|calls| calls.set(0));
}

/// A session message made with no key of the conversation: its cid, the
/// header given, and 32 bytes of junk for the ratchet ciphertext, sealed
/// with plain v1 to `to`.
fn forged(reader: &SecretKey, like: &Opened, header: Header, to: &Register) -> Opened {
    let mut inner = vec![0x02];
    inner.extend_from_slice(&like.cid.0);
    inner.extend_from_slice(&header.to_bytes());
    inner.extend_from_slice(&[0u8; 32]);
    let envelope = encrypt_message(to, &pad(&inner, 512)).unwrap().to_bytes();
    opened(reader, &envelope)
}

/// A pair in which Bob has read one message of Alice's second chain, so a
/// message of hers is on his current chain, with Nr = 1.
fn on_the_current_chain(label: &str) -> Pair {
    let mut p = pair(label);
    let m = opened(&p.bob, &p.a.send_with(b"m", &mut p.draw).unwrap());
    p.b.receive_with(&m, T, &mut p.draw).unwrap();
    assert_eq!(p.b.ratchet.nr, 1);
    p
}

/// What Bob makes of `message`: its result, the KDF_CK steps it took, and
/// whether his state and the draws stayed as they were.
fn bob_takes(p: &mut Pair, message: &Opened) -> (Result<Vec<u8>, Error>, u64) {
    let before = p.b.to_bytes();
    p.draw.drain();
    reset();
    let result = p.b.receive_with(message, T, &mut p.draw);
    let steps = calls();
    if result.is_err() {
        assert_eq!(p.b.to_bytes(), before, "a refusal changed nothing");
    }
    assert!(p.draw.drain().is_empty(), "nothing is drawn");
    (result, steps)
}

/// A forged message past the bound, on the current chain or on a new header
/// key, and sealed to another register of the reader's or to its
/// conversation identity, is refused as any forgery is, after its chain is
/// stepped to N on a copy: the flag needs a message that authenticates.
/// Before, each was TooFarAhead.
#[test]
fn a_forged_message_past_the_bound_is_refused_as_a_forgery() {
    let mut p = on_the_current_chain("far, forged");
    let like = opened(
        &p.bob,
        &p.a.clone().send_with(b"like", &mut p.draw).unwrap(),
    );
    let current = p.b.ratchet.dhr.unwrap();
    let fresh = (G1Projective::from(p.b.first.base) * test_scalar("a fresh key")).to_affine();
    for to in [handle("bob", "two"), p.b.responder_register()] {
        for (header, steps) in [
            // N − Nr = MAX_SKIP + 1: stepped, the tag checked, refused.
            (
                Header {
                    dh: current,
                    pn: 0,
                    n: 1 + MAX_SKIP + 1,
                },
                u64::from(MAX_SKIP) + 2,
            ),
            // A new header key: the receiving half of a step, then N.
            (
                Header {
                    dh: fresh,
                    pn: 0,
                    n: MAX_SKIP + 1,
                },
                u64::from(MAX_SKIP) + 2,
            ),
        ] {
            let message = forged(&p.bob, &like, header, &to);
            assert_eq!(
                bob_takes(&mut p, &message),
                (Err(Error::DecryptionFailed), steps)
            );
        }
    }
    // A genuine message's header moved past the bound: its tag fails.
    let mut moved = like.clone();
    moved.header.n = 1 + MAX_SKIP + 1;
    assert_eq!(
        bob_takes(&mut p, &moved),
        (Err(Error::DecryptionFailed), u64::from(MAX_SKIP) + 2)
    );
    // The conversation reads on.
    assert_eq!(p.b.receive_with(&like, T, &mut p.draw).unwrap(), b"like");
}

/// A genuine message past the bound is TooFarAhead, with nothing stored and
/// nothing drawn, on every chain it can come on: the current chain, a new
/// header key, a new key whose old chain's remainder is past the bound, and
/// the initiator's first reply. The work is the chain's steps to N and the
/// message key's.
#[test]
fn a_genuine_message_past_the_bound_is_too_far_ahead_on_every_chain() {
    // The current chain: N − Nr = MAX_SKIP + 1.
    let mut p = on_the_current_chain("far, current");
    skip_sends(&mut p.a, MAX_SKIP + 1);
    let far = opened(&p.bob, &p.a.send_with(b"far", &mut p.draw).unwrap());
    assert_eq!(far.header.n, 1 + MAX_SKIP + 1);
    assert_eq!(
        bob_takes(&mut p, &far),
        (Err(Error::TooFarAhead), u64::from(MAX_SKIP) + 2)
    );

    // A new header key, N = MAX_SKIP + 1.
    let mut p = on_the_current_chain("far, new chain");
    let reply = opened(&p.alice, &p.b.send_with(b"r", &mut p.draw).unwrap());
    p.a.receive_with(&reply, T, &mut p.draw).unwrap();
    skip_sends(&mut p.a, MAX_SKIP + 1);
    let far = opened(&p.bob, &p.a.send_with(b"far", &mut p.draw).unwrap());
    assert_ne!(Some(far.header.dh), p.b.ratchet.dhr);
    assert_eq!((far.header.pn, far.header.n), (1, MAX_SKIP + 1));
    assert_eq!(
        bob_takes(&mut p, &far),
        (Err(Error::TooFarAhead), u64::from(MAX_SKIP) + 2)
    );

    // A new header key at N = 0 whose old chain ran MAX_SKIP + 1 past what
    // Bob read: none of the old chain's keys is derived.
    let mut p = on_the_current_chain("far, old chain");
    skip_sends(&mut p.a, MAX_SKIP + 1);
    let reply = opened(&p.alice, &p.b.send_with(b"r", &mut p.draw).unwrap());
    p.a.receive_with(&reply, T, &mut p.draw).unwrap();
    let next = opened(&p.bob, &p.a.send_with(b"new chain", &mut p.draw).unwrap());
    assert_eq!((next.header.pn, next.header.n), (1 + MAX_SKIP + 1, 0));
    assert_eq!(bob_takes(&mut p, &next), (Err(Error::TooFarAhead), 1));

    // The initiator before a reply, on its first reply: no receiving chain
    // yet, so nothing of an old one counts.
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("far, the first reply");
    let mut a = start(&alice, &handle("bob", "h"), T, &mut draw);
    let first = opened(&bob, &a.send_with(b"hi", &mut draw).unwrap());
    let (mut b, _) = Conversation::accept_with(&bob, &[(&first, T)], &mut draw).unwrap();
    skip_sends(&mut b, MAX_SKIP + 1);
    let far = opened(&alice, &b.send_with(b"far", &mut draw).unwrap());
    let before = a.to_bytes();
    draw.drain();
    reset();
    assert_eq!(a.receive_with(&far, T, &mut draw), Err(Error::TooFarAhead));
    assert_eq!(calls(), u64::from(MAX_SKIP) + 2);
    assert_eq!(a.to_bytes(), before);
    assert!(draw.drain().is_empty());
    assert!(a.sends_first_contact());
}

/// The same genuine message, with its envelope anywhere but its own, is
/// refused for its envelope, never as too far ahead: re-sealed to another
/// register of the reader's, its c moved onto one, its p and tag moved onto
/// one with c kept, or re-sealed to the reader's identity with a p the
/// message's outer scalar doesn't give. The flag says nothing about any
/// register but the conversation's.
#[test]
fn a_genuine_message_past_the_bound_with_another_envelope_is_refused_for_it() {
    let mut p = on_the_current_chain("far, re-aimed");
    skip_sends(&mut p.a, MAX_SKIP + 1);
    let envelope = p.a.send_with(b"far", &mut p.draw).unwrap();
    let inner = opened(&p.bob, &envelope).bytes;
    let resealed = |to: &Register| {
        encrypt_message(to, &pad(&inner, envelope.len()))
            .unwrap()
            .to_bytes()
    };
    for aimed in [
        resealed(&handle("bob", "two")),
        ephemeral_on(&p.bob, &envelope, &handle("bob", "three")),
        generator_on(&p.bob, &envelope, &handle("bob", "four")),
        resealed(&p.b.responder_register()),
    ] {
        let message = opened(&p.bob, &aimed);
        let (result, _) = bob_takes(&mut p, &message);
        assert_eq!(result, Err(Error::WrongEnvelopeRegister));
    }
    let genuine = opened(&p.bob, &envelope);
    assert_eq!(bob_takes(&mut p, &genuine).0, Err(Error::TooFarAhead));
}

/// The bound is MAX_AUTH_STEPS, counted as MAX_SKIP is: at it a genuine
/// message is stepped to and flagged, with MAX_AUTH_STEPS + 1 KDF_CK calls
/// at most; one past it is refused as a forgery is, with nothing derived,
/// on the current chain and on a new header key, the old chain's remainder
/// counted with N. A forged header past it costs nothing.
#[test]
fn the_bound_is_max_auth_steps_counted_in_kdf_ck_calls() {
    assert_eq!(MAX_AUTH_STEPS, 4096);
    // The current chain: N − Nr at the bound, then one past it.
    let mut p = on_the_current_chain("far, the bound");
    skip_sends(&mut p.a, MAX_AUTH_STEPS);
    let at = opened(&p.bob, &p.a.send_with(b"at", &mut p.draw).unwrap());
    let past = opened(&p.bob, &p.a.send_with(b"past", &mut p.draw).unwrap());
    assert_eq!(at.header.n - p.b.ratchet.nr, MAX_AUTH_STEPS);
    assert_eq!(
        bob_takes(&mut p, &at),
        (Err(Error::TooFarAhead), u64::from(MAX_AUTH_STEPS) + 1)
    );
    assert_eq!(bob_takes(&mut p, &past), (Err(Error::DecryptionFailed), 0));

    // A new header key: the old chain's remainder and N together.
    let mut p = on_the_current_chain("far, the bound, new chain");
    skip_sends(&mut p.a, 2000);
    let reply = opened(&p.alice, &p.b.send_with(b"r", &mut p.draw).unwrap());
    p.a.receive_with(&reply, T, &mut p.draw).unwrap();
    skip_sends(&mut p.a, MAX_AUTH_STEPS - 2000);
    let at = opened(&p.bob, &p.a.send_with(b"at", &mut p.draw).unwrap());
    let past = opened(&p.bob, &p.a.send_with(b"past", &mut p.draw).unwrap());
    assert_eq!(
        (at.header.pn - p.b.ratchet.nr) + at.header.n,
        MAX_AUTH_STEPS
    );
    assert_eq!(
        bob_takes(&mut p, &at),
        (
            Err(Error::TooFarAhead),
            u64::from(MAX_AUTH_STEPS - 2000) + 1
        )
    );
    assert_eq!(bob_takes(&mut p, &past), (Err(Error::DecryptionFailed), 0));

    // Forged headers past the bound: nothing derived at all.
    let mut p = on_the_current_chain("far, forged past the bound");
    let like = opened(
        &p.bob,
        &p.a.clone().send_with(b"like", &mut p.draw).unwrap(),
    );
    let fresh = (G1Projective::from(p.b.first.base) * test_scalar("fresh")).to_affine();
    for header in [
        Header {
            dh: p.b.ratchet.dhr.unwrap(),
            pn: 0,
            n: 1 + MAX_AUTH_STEPS + 1,
        },
        Header {
            dh: fresh,
            pn: 0,
            n: MAX_AUTH_STEPS + 1,
        },
        Header {
            dh: fresh,
            pn: 1 + MAX_AUTH_STEPS + 1,
            n: 0,
        },
        Header {
            dh: fresh,
            pn: 0,
            n: u32::MAX,
        },
    ] {
        let message = forged(&p.bob, &like, header, &p.b.responder_register());
        assert_eq!(
            bob_takes(&mut p, &message),
            (Err(Error::DecryptionFailed), 0)
        );
    }
}

/// No first-contact message is authenticated past the bound, at a held
/// conversation or at a request's scratch state, whose ratchet key is the
/// reader's long-term key: each is refused as a forgery, with nothing
/// derived. A first-contact header past the request's share doesn't parse
/// at all (part 8); these are built past the parser.
#[test]
fn no_first_contact_message_is_authenticated_past_the_bound() {
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("far, first contact");
    let mut a = start(&alice, &handle("bob", "h"), T, &mut draw);
    let first = opened(&bob, &a.send_with(b"hi", &mut draw).unwrap());
    let mut far = opened(&bob, &a.send_with(b"later", &mut draw).unwrap());
    // Past the bound from Nr = 0 and from Nr = 1, the held side's.
    far.header.n = MAX_SKIP + 2;

    // A request's scratch state: x is its ratchet key.
    reset();
    assert_eq!(
        Conversation::accept_with(&bob, &[(&far, T)], &mut draw).err(),
        Some(Error::DecryptionFailed)
    );
    assert_eq!(calls(), 0);

    // A held conversation's late first-contact message.
    let (mut b, _) = Conversation::accept_with(&bob, &[(&first, T)], &mut draw).unwrap();
    let before = b.to_bytes();
    reset();
    assert_eq!(
        b.receive_with(&far, T, &mut draw),
        Err(Error::DecryptionFailed)
    );
    assert_eq!(calls(), 0);
    assert_eq!(b.to_bytes(), before);
}
