//! Part 5: chunk 54's calls 12 and 13 (docs/protocol.md §3, §16.4). The
//! first-contact stamp; the proof that a first message's base re-randomizes
//! the handle its `to` names; and each envelope bound to its conversation
//! identity by the message's outer scalar. Together they keep a writer from
//! learning whether two Seedelfs are one wallet's.

use blstrs::G1Projective;
use group::Curve;

use super::ratchet::pair;
use super::support::{
    HANDLE_NAME, Seeded, TEST_BITS, handle, handles, key, opened, own_handles, stamp, start,
    test_inbox,
};
use crate::envelope::encrypt_message;
use crate::register::Register;
use crate::relay::stamp_bits;
use crate::session::conversation::{Conversation, Role};
use crate::session::first_contact::{FIRST_CONTACT_STAMP_BITS, Handle};
use crate::session::inbox::{Inbox, Received};
use crate::session::wire::{Opened, pad};
use crate::{Error, SecretKey};

const T: u64 = 1_800_000_000;

/// The sum of two registers: a register of their key when both are.
fn sum(one: &Register, two: &Register) -> Register {
    Register::from_checked(
        (one.generator() + two.generator()).to_affine(),
        (one.public_value() + two.public_value()).to_affine(),
    )
}

/// The inner message of `envelope`, padded as it came, sealed again to
/// `register` with a fresh random re-randomization: what a writer does to
/// aim a message at a register of her choosing.
fn reseal(reader: &SecretKey, envelope: &[u8], register: &Register) -> Vec<u8> {
    let inner = opened(reader, envelope).bytes;
    encrypt_message(register, &pad(&inner, envelope.len()))
        .unwrap()
        .to_bytes()
}

/// A nonce whose stamp shows less than `bits` for `digest`.
fn weak_nonce(digest: &[u8; 32], bits: u32) -> u64 {
    (0..).find(|&n| stamp_bits(digest, n) < bits).unwrap()
}

/// The linking attack, through the envelope. Bob holds two Seedelfs, one
/// and two. Alice writes to one, honestly, but aims the envelope at two, or
/// at the sum of both. Bob's scan matches either way, since every register
/// is his key's; without the envelope's binding, his wallet would read it,
/// and his reply would tell Alice both Seedelfs are one wallet's. With it,
/// nothing is read and nothing changes.
#[test]
fn a_first_message_aimed_at_another_handle_is_refused() {
    let (alice, bob) = (key("alice"), key("bob"));
    let (one, two) = (handle("bob", "one"), handle("bob", "two"));
    let bob_handles = handles(&[one, two]);
    let mut draw = Seeded::new("aimed");
    let mut a = start(&alice, &one, T, &mut draw);
    let honest = a.send_with(b"hi", &mut draw).unwrap();
    for register in [two, sum(&one, &two)] {
        let aimed = reseal(&bob, &honest, &register);
        assert!(crate::matches_envelope(&bob, &aimed).unwrap());
        let mut inbox = test_inbox();
        assert_eq!(
            inbox.receive(&bob, &bob_handles, &aimed, T),
            Err(Error::WrongEnvelopeRegister)
        );
        assert!(inbox.requests().is_empty());
    }
    // The honest envelope reads.
    let mut inbox = test_inbox();
    assert!(matches!(
        inbox.receive(&bob, &bob_handles, &honest, T),
        Ok(Received::Request { new: true, .. })
    ));
}

/// The same inside a conversation: a session message to either side, aimed
/// at another of the reader's registers, is refused and changes nothing.
/// Its re-randomization, the outer scalar, comes from the message key, so
/// only the conversation's own register carries it.
#[test]
fn a_session_message_aimed_at_another_register_is_refused() {
    let mut p = pair("aimed session");
    for (from_alice, other) in [
        (true, handle("bob", "two")),
        (false, handle("alice", "two")),
    ] {
        let (writer, reader, reader_key) = if from_alice {
            (&mut p.a, &mut p.b, &p.bob)
        } else {
            (&mut p.b, &mut p.a, &p.alice)
        };
        let honest = writer.send_with(b"m", &mut p.draw).unwrap();
        let aimed = reseal(reader_key, &honest, &other);
        let before = reader.to_bytes();
        assert_eq!(
            reader.receive_with(&opened(reader_key, &aimed), T, &mut p.draw),
            Err(Error::WrongEnvelopeRegister)
        );
        assert_eq!(reader.to_bytes(), before);
        // The honest one still reads: its key wasn't spent.
        reader
            .receive_with(&opened(reader_key, &honest), T, &mut p.draw)
            .unwrap();
    }
}

/// A message parsed from bytes alone has no envelope to check, so no
/// conversation takes it; a request's stored messages, checked when they
/// came, replay.
#[test]
fn a_message_without_its_envelope_is_refused() {
    let mut p = pair("no envelope");
    let envelope = p.a.send_with(b"m", &mut p.draw).unwrap();
    let bare = Opened::from_bytes(&opened(&p.bob, &envelope).bytes).unwrap();
    assert_eq!(p.b.receive(&bare, T), Err(Error::WrongEnvelopeRegister));
    p.b.receive(&opened(&p.bob, &envelope), T).unwrap();
}

/// The base proof at the reader: `to` must name one of the reader's handles
/// (else [`Error::UnknownHandle`]), and the proof must verify against one of
/// that name's registers (else [`Error::InvalidBaseProof`]). A name may come
/// with several registers, every one the wallet knows; any of them will do.
#[test]
fn the_reader_checks_the_proof_against_its_named_handles() {
    let (alice, bob) = (key("alice"), key("bob"));
    let (current, earlier) = (handle("bob", "now"), handle("bob", "before"));
    let mut draw = Seeded::new("named");
    let mut a = start(&alice, &earlier, T, &mut draw);
    let envelope = a.send_with(b"hi", &mut draw).unwrap();
    let mut inbox = test_inbox();
    // Not a name Bob has.
    let other_name = [Handle::new(b"another name", earlier).unwrap()];
    assert_eq!(
        inbox.receive(&bob, &other_name, &envelope, T),
        Err(Error::UnknownHandle)
    );
    assert_eq!(
        inbox.receive(&bob, &[], &envelope, T),
        Err(Error::UnknownHandle)
    );
    // His name, but only another register under it.
    assert_eq!(
        inbox.receive(&bob, &handles(&[current]), &envelope, T),
        Err(Error::InvalidBaseProof)
    );
    assert!(inbox.requests().is_empty());
    // The register written to, among others under the name.
    assert!(matches!(
        inbox.receive(&bob, &handles(&[current, earlier]), &envelope, T),
        Ok(Received::Request { new: true, .. })
    ));
}

/// The sum attack, through the base. Alice builds the base on the sum of
/// Bob's two handles and names one. Her proof can show only the sum, so Bob
/// refuses it, before any key.
#[test]
fn a_base_on_the_sum_of_two_handles_is_refused() {
    let (alice, bob) = (key("alice"), key("bob"));
    let (one, two) = (handle("bob", "one"), handle("bob", "two"));
    let mut draw = Seeded::new("sum base");
    // Alice's start to the sum, named as Bob's handle: the proof she can
    // make is the sum's.
    let mut a = start(&alice, &sum(&one, &two), T, &mut draw);
    let envelope = a.send_with(b"are you both?", &mut draw).unwrap();
    let mut inbox = test_inbox();
    assert_eq!(
        inbox.receive(&bob, &handles(&[one, two]), &envelope, T),
        Err(Error::InvalidBaseProof)
    );
    assert!(inbox.requests().is_empty());
}

/// The stamp: a first message for a new cid must show the reader's work,
/// and it's checked before anything else that costs: before the proof, and
/// before any key. Later messages of a known cid, and replies, aren't
/// stamped again.
#[test]
fn the_stamp_is_checked_first_and_only_for_new_conversations() {
    let (alice, bob) = (key("alice"), key("bob"));
    let bob_handle = handle("bob", "h");
    let mut draw = Seeded::new("stamp");
    let mut a = Conversation::start_with(&alice, &bob_handle, HANDLE_NAME, T, &mut draw).unwrap();
    // Nothing goes before the stamp.
    assert_eq!(a.send_with(b"x", &mut draw), Err(Error::Unstamped));
    let weak = weak_nonce(&a.stamp_digest(), TEST_BITS);
    a.set_stamp(weak).unwrap();
    assert_eq!(a.stamp(), Some((weak, stamp_bits(&a.stamp_digest(), weak))));
    let unpaid = a.send_with(b"unpaid", &mut draw).unwrap();
    let mut inbox = test_inbox();
    let mine = own_handles(&bob);
    assert_eq!(
        inbox.receive(&bob, &mine, &unpaid, T),
        Err(Error::StampTooLow)
    );
    // Before the proof: Bob's handles aren't even passed.
    assert_eq!(
        inbox.receive(&bob, &[], &unpaid, T),
        Err(Error::StampTooLow)
    );
    // A reader asking nothing reads it; the default asks the protocol's
    // work, which this nonce doesn't show.
    let mut lenient = test_inbox();
    lenient.set_first_contact_bits(0);
    assert!(lenient.receive(&bob, &mine, &unpaid, T).is_ok());
    assert_eq!(Inbox::new().first_contact_bits(), FIRST_CONTACT_STAMP_BITS);
    assert_eq!(
        Inbox::new().receive(&bob, &mine, &unpaid, T),
        Err(Error::StampTooLow)
    );

    // Paid: a request. A later message of it with a weak stamp joins, since
    // its F is the stored one.
    stamp(&mut a);
    let paid = a.send_with(b"paid", &mut draw).unwrap();
    assert!(inbox.receive(&bob, &mine, &paid, T).is_ok());
    a.set_stamp(weak).unwrap();
    let later = a.send_with(b"later", &mut draw).unwrap();
    assert!(matches!(
        inbox.receive(&bob, &mine, &later, T),
        Ok(Received::Request { new: false, .. })
    ));
}

/// Only the initiator sets a stamp; a responder's stored state never holds
/// one, and the stamp survives storage.
#[test]
fn only_the_initiator_holds_a_stamp() {
    let mut p = pair("stamps");
    assert_eq!(p.b.role(), Role::Responder);
    assert_eq!(p.b.set_stamp(1), Err(Error::UnexpectedMessage));
    assert!(p.b.stamp().is_none());
    let alice = key("alice");
    let mut draw = Seeded::new("stamp state");
    let a = start(&alice, &handle("bob", "h"), T, &mut draw);
    let stored = Conversation::from_bytes(&a.to_bytes()).unwrap();
    assert_eq!(stored.stamp(), a.stamp());
    assert!(a.stamp().is_some());
    // A responder's record with the stamp flag set and a stamp where it
    // goes, before Ns, Nr, PN, lost and the count (22 bytes, with no
    // skipped keys), is refused; the same edit on an initiator's reads.
    assert_eq!(p.b.ratchet.skipped.len(), 0);
    let with_stamp = |conversation: &Conversation| {
        let mut bytes = conversation.to_bytes().to_vec();
        let flags_at = 1 + 1 + 2 + conversation.first_bytes.len() + 48 + 32;
        bytes[flags_at] |= 8;
        let at = bytes.len() - 22;
        bytes.splice(at..at, 7u64.to_be_bytes());
        bytes
    };
    assert_eq!(
        Conversation::from_bytes(&with_stamp(&p.b)).err(),
        Some(Error::InvalidState)
    );
    let mut unstamped =
        Conversation::start_with(&alice, &handle("bob", "h"), HANDLE_NAME, T, &mut draw).unwrap();
    assert_eq!(unstamped.stamp(), None);
    let read = Conversation::from_bytes(&with_stamp(&unstamped)).unwrap();
    unstamped.set_stamp(7).unwrap();
    assert_eq!(read.stamp(), unstamped.stamp());
}

/// The envelope's generator is the conversation's base times the outer
/// scalar, for every message either side sends.
#[test]
fn every_envelope_goes_to_its_identity_times_the_outer_scalar() {
    let mut p = pair("outer");
    for i in 0..4u8 {
        let (writer, reader_key) = if i % 2 == 0 {
            (&mut p.a, &p.bob)
        } else {
            (&mut p.b, &p.alice)
        };
        let mk = crate::session::ratchet::kdf_ck(writer.ratchet.cks.as_ref().unwrap()).1;
        let envelope = writer.send_with(&[i], &mut p.draw).unwrap();
        let message = opened(reader_key, &envelope);
        let salt: [u8; 16] = message.ciphertext[..16].try_into().unwrap();
        let o = crate::session::ratchet::outer_scalar(&mk, &salt);
        assert_eq!(
            &envelope[1..49],
            &(G1Projective::from(writer.first.base) * o).to_compressed()
        );
    }
}

/// A request's messages, checked against their envelopes when they came,
/// are stored without them. Read back from its record, the request still
/// reads, takes a later message, and becomes a conversation, as the worker
/// does after a restart.
#[test]
fn a_stored_request_replays_without_its_envelopes() {
    let (alice, bob) = (key("alice"), key("bob"));
    let mine = own_handles(&bob);
    let mut draw = Seeded::new("stored request");
    let mut a = start(&alice, &handle("bob", "h"), T, &mut draw);
    let first = a.send_with(b"one", &mut draw).unwrap();
    let second = a.send_with(b"two", &mut draw).unwrap();
    let mut inbox = test_inbox();
    inbox.receive(&bob, &mine, &first, T).unwrap();

    let stored = crate::session::inbox::Requests::from_bytes(&inbox.requests().to_bytes()).unwrap();
    let mut restarted = Inbox::from_parts(Vec::new(), stored, Default::default()).unwrap();
    restarted.set_first_contact_bits(TEST_BITS);
    let request = restarted.requests().get(a.cid()).unwrap();
    assert_eq!(request.read(&bob).unwrap(), vec![Ok(b"one".to_vec())]);
    assert!(matches!(
        restarted.receive(&bob, &mine, &second, T + 1),
        Ok(Received::Request { new: false, .. })
    ));
    restarted.accept(&bob, a.cid()).unwrap();
    let reply = restarted.send(a.cid(), b"hi").unwrap();
    a.receive_with(&opened(&alice, &reply), T + 2, &mut draw)
        .unwrap();
    assert!(!a.sends_first_contact());
}
