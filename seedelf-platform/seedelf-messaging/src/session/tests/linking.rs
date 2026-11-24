//! Part 5: chunk 54's calls 12 and 13 (docs/protocol.md §3, §16.4). The
//! first-contact stamp; the proof that a first message's base re-randomizes
//! the handle its `to` names; and each envelope bound to its conversation
//! identity by the message's outer scalar. Together they keep a writer from
//! learning whether two Seedelfs are one wallet's.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use blstrs::{G1Affine, G1Projective, Scalar};
use group::Curve;
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use super::ratchet::pair;
use super::support::{
    HANDLE_NAME, Seeded, TEST_BITS, handle, handles, key, opened, own_handles, stamp, start,
    test_inbox, test_scalar,
};
use crate::envelope::{derive_key_and_nonce, encrypt_message};
use crate::register::{POINT_LEN, Register};
use crate::relay::stamp_bits;
use crate::session::conversation::{Conversation, Role};
use crate::session::first_contact::{FIRST_CONTACT_STAMP_BITS, Handle};
use crate::session::inbox::{Inbox, Received};
use crate::session::secret::Secret32;
use crate::session::wire::{Opened, pad};
use crate::{Envelope, Error, HEADER_LEN, SecretKey, decrypt_message};

const T: u64 = 1_800_000_000;

/// Where an envelope's ephemeral point c starts: the header's last 48 bytes.
const C_AT: usize = HEADER_LEN - POINT_LEN;

/// The envelope's ephemeral scalar as docs/protocol.md §16.2 defines it,
/// computed here from the definition: HKDF-SHA256(salt = the ratchet salt,
/// ikm = mk, info = `Seedelf-Messaging|v1|ratchet|envelope-ephemeral`), 64
/// bytes, as a big-endian integer mod q.
fn envelope_r(mk: &Secret32, salt: &[u8; 16]) -> Scalar {
    let mut okm = [0u8; 64];
    Hkdf::<Sha256>::new(Some(salt), mk.bytes())
        .expand(b"Seedelf-Messaging|v1|ratchet|envelope-ephemeral", &mut okm)
        .unwrap();
    crate::keys::scalar_mod_q(&okm)
}

/// `honest`, an envelope the writer made, with only its ephemeral point moved
/// onto `other`: c = [r]g′ and the outer key from [r]v′, while everything
/// before c (the version, p and what follows p) and the padded inner message
/// stay as they were. It opens exactly when `other` is a register of the
/// reader's key, so a reader that didn't check c took it then and only then,
/// and its reply told the writer `other` is the reader's (the 1.10.0 gate
/// review's ephemeral-point probes). The writer knows what it sealed; this
/// reads it back with the reader's key only to save rebuilding it.
pub(crate) fn ephemeral_on(reader: &SecretKey, honest: &[u8], other: &Register) -> Vec<u8> {
    let padded = decrypt_message(reader, &Envelope::from_bytes(honest).unwrap()).unwrap();
    let r = test_scalar("an ephemeral point on another register");
    let mut header = [0u8; HEADER_LEN];
    header[..C_AT].copy_from_slice(&honest[..C_AT]);
    header[C_AT..].copy_from_slice(&(other.generator() * r).to_compressed());
    let shared = Zeroizing::new((other.public_value() * r).to_compressed());
    sealed_under(&shared, &header, &padded, honest.len())
}

/// `honest`, an envelope the writer made, with only its generator p and its
/// tag moved onto `other`, re-randomized by d: p′ = [d]g′ and the tag of
/// [d]v′, while c, the honest [r][o]p₀, and the padded inner message stay as
/// they were. The outer key is still from [y]c, which the writer knows as
/// [r][o]V (it sealed `honest`); this reads it with the reader's key only to
/// save rebuilding it. The scan matches exactly when `other` is a register of
/// the reader's key, and c's check still holds, c being [r][o]p₀ for the o and
/// r the message key gives: only p = [o]p₀ refuses it (the 1.10.0 gate's spec
/// review, whose mutant without p's check passed every other test).
pub(crate) fn generator_on(reader: &SecretKey, honest: &[u8], other: &Register) -> Vec<u8> {
    let envelope = Envelope::from_bytes(honest).unwrap();
    let padded = decrypt_message(reader, &envelope).unwrap();
    let d = test_scalar("a generator on another register");
    let mut header = [0u8; HEADER_LEN];
    header[0] = honest[0];
    header[1..1 + POINT_LEN].copy_from_slice(&(other.generator() * d).to_compressed());
    let tag: [u8; 32] = Sha256::new()
        .chain_update(b"Seedelf-Messaging|v1|envelope|tag")
        .chain_update((other.public_value() * d).to_compressed())
        .finalize()
        .into();
    header[1 + POINT_LEN..C_AT].copy_from_slice(&tag);
    header[C_AT..].copy_from_slice(&honest[C_AT..HEADER_LEN]);
    let shared = Zeroizing::new(
        (G1Projective::from(envelope.ephemeral_point()) * reader.scalar()).to_compressed(),
    );
    sealed_under(&shared, &header, &padded, honest.len())
}

/// `padded` sealed as v1 seals it under `shared` and `header`: an envelope
/// of `len` bytes.
fn sealed_under(
    shared: &[u8; POINT_LEN],
    header: &[u8; HEADER_LEN],
    padded: &[u8],
    len: usize,
) -> Vec<u8> {
    let okm = derive_key_and_nonce(shared, header);
    let sealed = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&okm[..32]))
        .encrypt(
            Nonce::from_slice(&okm[32..]),
            Payload {
                msg: padded,
                aad: header,
            },
        )
        .unwrap();
    let mut out = header.to_vec();
    out.extend_from_slice(&sealed);
    assert_eq!(out.len(), len);
    out
}

/// What a probe of `reader`'s key goes on: another register of that key, or
/// the sum of two, whose probes open, and a stranger's, whose doesn't. Each
/// is refused.
fn probes(reader: &str) -> [(Register, Error); 3] {
    [
        (
            handle(reader, "another register of the reader's"),
            Error::WrongEnvelopeRegister,
        ),
        (
            sum(&handle(reader, "one of its own"), &handle(reader, "two")),
            Error::WrongEnvelopeRegister,
        ),
        (
            handle("carol", "a stranger's register"),
            Error::DecryptionFailed,
        ),
    ]
}

/// The envelope's ephemeral point on another register of the reader's key,
/// on every path a message comes with its envelope: a new cid's first
/// message, a join, a held conversation's first-contact message, the
/// initiator's first reply, a new chain, the current chain, and a skipped
/// key's message. Each probe is refused, as one on a stranger's register is,
/// with nothing changed, and the honest envelope still reads after it: c
/// must be [r]p for the r the message key and its salt give (protocol.md
/// §2, §16.2).
#[test]
fn an_envelope_whose_c_is_on_another_register_is_refused_on_every_path() {
    let (alice, bob) = (key("alice"), key("bob"));
    let named = handle("bob", "one");
    let mine = handles(&[named]);
    let mut draw = Seeded::new("c on every path");
    let mut a = start(&alice, &named, T, &mut draw);
    let cid = a.cid();
    let mut inbox = test_inbox();

    // A new cid's first message.
    let honest = a.send_with(b"first", &mut draw).unwrap();
    for (other, refusal) in probes("bob") {
        let probe = ephemeral_on(&bob, &honest, &other);
        assert!(crate::matches_envelope(&bob, &probe).unwrap());
        assert_eq!(
            inbox.receive(&bob, &mine, &probe, T),
            Err(refusal),
            "a first message"
        );
        assert!(inbox.requests().is_empty());
    }
    assert!(matches!(
        inbox.receive(&bob, &mine, &honest, T),
        Ok(Received::Request { new: true, .. })
    ));

    // A join: a later first-contact message of the request.
    let honest = a.send_with(b"second", &mut draw).unwrap();
    let before = inbox.requests().to_bytes();
    for (other, refusal) in probes("bob") {
        let probe = ephemeral_on(&bob, &honest, &other);
        assert_eq!(
            inbox.receive(&bob, &mine, &probe, T),
            Err(refusal),
            "a join"
        );
        assert_eq!(inbox.requests().to_bytes(), before);
    }
    assert!(matches!(
        inbox.receive(&bob, &mine, &honest, T),
        Ok(Received::Request { new: false, .. })
    ));

    // A held conversation's first-contact message, once the reader replied.
    inbox.accept(&bob, cid).unwrap();
    let honest = a.send_with(b"third", &mut draw).unwrap();
    let before = inbox.conversation(cid).unwrap().to_bytes();
    for (other, refusal) in probes("bob") {
        let probe = ephemeral_on(&bob, &honest, &other);
        assert_eq!(
            inbox.receive(&bob, &mine, &probe, T),
            Err(refusal),
            "a held conversation's first-contact message"
        );
        assert_eq!(inbox.conversation(cid).unwrap().to_bytes(), before);
    }
    assert!(matches!(
        inbox.receive(&bob, &mine, &honest, T),
        Ok(Received::Message { .. })
    ));

    // The initiator's first reply: a receiving chain at last.
    let honest = inbox.send(cid, b"reply").unwrap();
    let mut alices = Inbox::from_parts(vec![a], Default::default(), Default::default()).unwrap();
    let before = alices.conversation(cid).unwrap().to_bytes();
    for (other, refusal) in probes("alice") {
        let probe = ephemeral_on(&alice, &honest, &other);
        assert_eq!(
            alices.receive(&alice, &[], &probe, T),
            Err(refusal),
            "the first reply"
        );
        assert_eq!(alices.conversation(cid).unwrap().to_bytes(), before);
        assert!(alices.conversation(cid).unwrap().sends_first_contact());
    }
    assert!(matches!(
        alices.receive(&alice, &[], &honest, T),
        Ok(Received::Message { .. })
    ));
    assert!(!alices.conversation(cid).unwrap().sends_first_contact());

    // Session messages: a new chain's first, the current chain's next, and,
    // past a gap, the skipped key's message.
    let sent: Vec<_> = (0..4)
        .map(|i| alices.send(cid, format!("s{i}").as_bytes()).unwrap())
        .collect();
    for (i, path) in [
        (0, "a new chain"),
        (1, "the current chain"),
        (3, "the current chain, past a gap"),
        (2, "a skipped key's message"),
    ] {
        let before = inbox.conversation(cid).unwrap().to_bytes();
        for (other, refusal) in probes("bob") {
            let probe = ephemeral_on(&bob, &sent[i], &other);
            assert_eq!(
                inbox.receive(&bob, &mine, &probe, T),
                Err(refusal),
                "{path}"
            );
            assert_eq!(inbox.conversation(cid).unwrap().to_bytes(), before);
        }
        assert!(matches!(
            inbox.receive(&bob, &mine, &sent[i], T),
            Ok(Received::Message { .. })
        ));
        assert_eq!(
            inbox.conversation(cid).unwrap().missing(),
            u64::from(i == 3),
            "{path}"
        );
    }
}

/// The envelope's generator p and its tag on another register of the
/// reader's key, or on the sum of two, with its ephemeral point c the honest
/// one, on every path but one past MAX_SKIP (far.rs has that): a new cid's
/// first message, a join, the initiator's first reply, and a held
/// conversation's session message. The scan matches each probe and c's check
/// can't see it; p = [o]p₀ refuses it, as any envelope aimed elsewhere is,
/// with nothing changed, and the honest envelope still reads after it
/// (protocol.md §16.4).
#[test]
fn an_envelope_whose_p_is_on_another_register_and_c_is_honest_is_refused() {
    let (alice, bob) = (key("alice"), key("bob"));
    let named = handle("bob", "one");
    let mine = handles(&[named]);
    let others = |reader: &str| {
        [
            handle(reader, "another register of the reader's"),
            sum(&handle(reader, "one of its own"), &handle(reader, "two")),
        ]
    };
    let mut draw = Seeded::new("p elsewhere, c kept");
    let mut a = start(&alice, &named, T, &mut draw);
    let cid = a.cid();
    let mut inbox = test_inbox();

    // A new cid's first message.
    let honest = a.send_with(b"first", &mut draw).unwrap();
    for other in others("bob") {
        let probe = generator_on(&bob, &honest, &other);
        assert!(crate::matches_envelope(&bob, &probe).unwrap());
        assert_eq!(probe[C_AT..HEADER_LEN], honest[C_AT..HEADER_LEN], "c kept");
        assert_eq!(
            inbox.receive(&bob, &mine, &probe, T),
            Err(Error::WrongEnvelopeRegister),
            "a first message"
        );
        assert!(inbox.requests().is_empty());
    }
    assert!(matches!(
        inbox.receive(&bob, &mine, &honest, T),
        Ok(Received::Request { new: true, .. })
    ));

    // A join: a later first-contact message of the request.
    let honest = a.send_with(b"second", &mut draw).unwrap();
    let before = inbox.requests().to_bytes();
    for other in others("bob") {
        let probe = generator_on(&bob, &honest, &other);
        assert_eq!(
            inbox.receive(&bob, &mine, &probe, T),
            Err(Error::WrongEnvelopeRegister),
            "a join"
        );
        assert_eq!(inbox.requests().to_bytes(), before);
    }
    assert!(matches!(
        inbox.receive(&bob, &mine, &honest, T),
        Ok(Received::Request { new: false, .. })
    ));

    // The initiator's first reply.
    inbox.accept(&bob, cid).unwrap();
    let reply = inbox.send(cid, b"reply").unwrap();
    let mut alices = Inbox::from_parts(vec![a], Default::default(), Default::default()).unwrap();
    let before = alices.conversation(cid).unwrap().to_bytes();
    for other in others("alice") {
        let probe = generator_on(&alice, &reply, &other);
        assert_eq!(
            alices.receive(&alice, &[], &probe, T),
            Err(Error::WrongEnvelopeRegister),
            "the first reply"
        );
        assert_eq!(alices.conversation(cid).unwrap().to_bytes(), before);
    }
    assert!(matches!(
        alices.receive(&alice, &[], &reply, T),
        Ok(Received::Message { .. })
    ));

    // A held conversation's session message.
    let honest = alices.send(cid, b"s0").unwrap();
    let before = inbox.conversation(cid).unwrap().to_bytes();
    for other in others("bob") {
        let probe = generator_on(&bob, &honest, &other);
        assert_eq!(
            inbox.receive(&bob, &mine, &probe, T),
            Err(Error::WrongEnvelopeRegister),
            "a session message"
        );
        assert_eq!(inbox.conversation(cid).unwrap().to_bytes(), before);
    }
    assert!(matches!(
        inbox.receive(&bob, &mine, &honest, T),
        Ok(Received::Message { .. })
    ));
}

/// No session envelope holds a register of either side's key on its own
/// points: not (p, [x]p), the envelope's register before the tag replaced w,
/// nor (c, [x]c), for the reader's x or the writer's (the 1.10.0 gate
/// review's chain-reaction#1: anyone reading the pool could pay under one and
/// watch who spends it). The 32 bytes after p are the tag of the reader's
/// [x]p.
#[test]
fn no_session_envelope_holds_a_register_of_either_sides_key() {
    let holds_no_register = |envelope: &[u8], reader: &SecretKey, writer: &SecretKey| {
        let point = |at: usize| {
            G1Projective::from(
                G1Affine::from_compressed(&envelope[at..at + POINT_LEN].try_into().unwrap())
                    .unwrap(),
            )
        };
        let (p, c) = (point(1), point(C_AT));
        let tag: [u8; 32] = Sha256::new()
            .chain_update(b"Seedelf-Messaging|v1|envelope|tag")
            .chain_update((p * reader.scalar()).to_compressed())
            .finalize()
            .into();
        assert_eq!(&envelope[1 + POINT_LEN..1 + POINT_LEN + 32], &tag[..]);
        for key in [reader, writer] {
            for point in [p, c] {
                let owned = (point * key.scalar()).to_compressed();
                assert!(!envelope.windows(POINT_LEN).any(|window| window == owned));
            }
        }
    };
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("no register");
    let mut a = start(&alice, &handle("bob", "h"), T, &mut draw);
    let first = a.send_with(b"to Bob, first", &mut draw).unwrap();
    holds_no_register(&first, &bob, &alice);
    let (mut b, _) =
        Conversation::accept_with(&bob, &[(&opened(&bob, &first), T)], &mut draw).unwrap();
    let reply = b.send_with(&[7; 300], &mut draw).unwrap();
    holds_no_register(&reply, &alice, &bob);
    a.receive_with(&opened(&alice, &reply), T, &mut draw)
        .unwrap();
    let message = a.send_with(b"to Bob, in session", &mut draw).unwrap();
    holds_no_register(&message, &bob, &alice);
    let mut again = Conversation::continue_with(&bob, &b, T, &mut draw).unwrap();
    stamp(&mut again);
    let continuing = again.send_with(b"to Alice, again", &mut draw).unwrap();
    holds_no_register(&continuing, &alice, &bob);
}

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
    // goes, before Ns, Nr, PN, lost and the runs' count (22 bytes, with no
    // skipped keys), and before an initiator's count of what it sent before
    // a reply (4 more), is refused; the same edit on an initiator's reads.
    assert_eq!(p.b.ratchet.skipped.len(), 0);
    let with_stamp = |conversation: &Conversation| {
        let mut bytes = conversation.to_bytes().to_vec();
        let flags_at = 1 + 1 + 2 + conversation.first_bytes.len() + 48 + 32;
        bytes[flags_at] |= 8;
        let at = bytes.len() - 22 - 4 * usize::from(conversation.first_contact_sent.is_some());
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
/// scalar, and its ephemeral point is that generator times the envelope's
/// r, for every message either side sends. Both come from the message key
/// and the salt, so a send draws the salt and nothing else (protocol.md
/// §16.2, §16.3).
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
        p.draw.drain();
        let envelope = writer.send_with(&[i], &mut p.draw).unwrap();
        assert_eq!(p.draw.drain().len(), 1, "a send draws its salt alone");
        let message = opened(reader_key, &envelope);
        let salt: [u8; 16] = message.ciphertext[..16].try_into().unwrap();
        let o = crate::session::ratchet::outer_scalar(&mk, &salt);
        let generator = G1Projective::from(writer.first.base) * o;
        assert_eq!(&envelope[1..49], &generator.to_compressed());
        assert_eq!(
            &envelope[C_AT..HEADER_LEN],
            &(generator * envelope_r(&mk, &salt)).to_compressed()
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
