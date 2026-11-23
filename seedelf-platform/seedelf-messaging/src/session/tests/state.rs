//! Part 3: the versioned state, decryption on a copy, padding and the inner
//! messages' parsing (docs/protocol.md §4.2, §9, §12 and §16.5), with the
//! skipped keys stored as runs in the order stored.

use super::ratchet::pair;
use super::support::{Seeded, handle, identity, key, opened, outside_g1, skip_sends, start};
use crate::envelope::{ENVELOPE_OVERHEAD, encrypt_message};
use crate::session::conversation::{Conversation, Role, STATE_VERSION};
use crate::session::draw::Draw;
use crate::session::first_contact::ConversationId;
use crate::session::ratchet::{MAX_SKIP, MAX_STORED_SKIPPED, skipped_len};
use crate::session::wire::{
    ENVELOPE_SIZES, MAX_ENVELOPE_LEN, Opened, inner_capacity, open, pad, unpad,
};
use crate::{Error, SecretKey};

const T: u64 = 1_800_000_000;

fn round_trip(conversation: &Conversation) -> Conversation {
    let bytes = conversation.to_bytes();
    // Sized exactly: no copy of the secrets is left by the buffer's growth.
    assert_eq!(bytes.capacity(), bytes.len());
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

/// A state with both chains, skipped keys in two runs and a lost count, for
/// the corruption tests.
fn full_state() -> Vec<u8> {
    let mut p = pair("full state");
    skip_sends(&mut p.a, 3);
    let message = opened(&p.bob, &p.a.send_with(b"x", &mut p.draw).unwrap());
    p.b.receive_with(&message, T, &mut p.draw).unwrap();
    // A second run, on Alice's next ratchet key.
    let reply = opened(&p.alice, &p.b.send_with(b"r", &mut p.draw).unwrap());
    p.a.receive_with(&reply, T, &mut p.draw).unwrap();
    skip_sends(&mut p.a, 2);
    let message = opened(&p.bob, &p.a.send_with(b"y", &mut p.draw).unwrap());
    p.b.receive_with(&message, T + 1, &mut p.draw).unwrap();
    p.b.ratchet.lost = 7;
    assert_eq!(p.b.ratchet.skipped.len(), 5);
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
    // Version 1, a development build's, among them.
    for version in [0u8, 1, 3, 255] {
        let mut other = bytes.clone();
        other[0] = version;
        assert_eq!(
            Conversation::from_bytes(&other).err(),
            Some(Error::UnsupportedStateVersion(version))
        );
    }
    assert_eq!((bytes[0], STATE_VERSION), (2, 2));
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
    // Past the bound and forged: refused as a forgery (part 7).
    let mut far = good.clone();
    far.header.n = 5000;
    failures.push((far, Error::DecryptionFailed));
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
/// gives: the smallest envelope holds 366 inner bytes, so a session message
/// holds 261 bytes of text in 512 bytes.
#[test]
fn messages_fill_the_four_envelope_sizes() {
    assert_eq!(inner_capacity(512), 366);
    let mut p = pair("sizes");
    for (len, size) in [
        (0, 512),
        (261, 512),
        (262, 2048),
        (1797, 2048),
        (1798, 8192),
        (7941, 8192),
        (7942, 32768),
        (32517, 32768),
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
    assert_eq!(p.a.max_text_len(), 32517);
    assert_eq!(
        p.a.send_with(&[0; 32518], &mut p.draw),
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
    // A whole size of zeros: no marker.
    assert_eq!(
        unpad(&vec![0u8; 512 - ENVELOPE_OVERHEAD]),
        Err(Error::InvalidPadding)
    );
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
    // The ratchet header's key, after F's two proofs (128 and 192) and the
    // stamp (8): F is 510 bytes under the tests' 20-byte `to`.
    let mut changed = good.clone();
    assert_eq!(a.first_bytes.len(), 510);
    changed[519..567].copy_from_slice(&identity());
    assert_eq!(
        open(&bob, &seal(&changed)).err(),
        Some(Error::IdentityPoint)
    );
}

/// A source whose next scalar is a given one: how the other side uses a
/// ratchet key again, which it may, since it picks its own.
struct Next(blstrs::Scalar);

impl Draw for Next {
    fn scalar(&mut self) -> blstrs::Scalar {
        self.0
    }
    fn bytes16(&mut self) -> [u8; 16] {
        [9; 16]
    }
    fn bytes32(&mut self) -> [u8; 32] {
        [9; 32]
    }
}

/// Bob's skipped keys after Alice uses her first ratchet key, A1, then A2,
/// then A1 again: A1's key 0, A2's key 0, then A1's keys 0 and 1, the key
/// (A1, 0) held twice, from two chains.
fn a_key_used_twice() -> super::ratchet::Pair {
    let mut p = pair("a ratchet key used twice");
    let a1 = crate::keys::scalar_from_bytes(p.a.ratchet.dhs.secret.bytes()).unwrap();
    let a1_public = p.a.ratchet.dhs.public;
    skip_sends(&mut p.a, 1);
    let m = opened(&p.bob, &p.a.send_with(b"a1", &mut p.draw).unwrap());
    p.b.receive_with(&m, T, &mut p.draw).unwrap();
    let r = opened(&p.alice, &p.b.send_with(b"r", &mut p.draw).unwrap());
    p.a.receive_with(&r, T, &mut p.draw).unwrap();
    skip_sends(&mut p.a, 1);
    let m = opened(&p.bob, &p.a.send_with(b"a2", &mut p.draw).unwrap());
    p.b.receive_with(&m, T + 1, &mut p.draw).unwrap();
    let r = opened(&p.alice, &p.b.send_with(b"r", &mut p.draw).unwrap());
    p.a.receive_with(&r, T + 1, &mut Next(a1)).unwrap();
    assert_eq!(p.a.ratchet.dhs.public, a1_public);
    skip_sends(&mut p.a, 2);
    let m = opened(&p.bob, &p.a.send_with(b"a1 again", &mut p.draw).unwrap());
    p.b.receive_with(&m, T + 2, &mut p.draw).unwrap();
    let keys: Vec<(bool, u32)> =
        p.b.ratchet
            .skipped
            .iter()
            .map(|key| (key.dh == a1_public, key.n))
            .collect();
    assert_eq!(keys, [(true, 0), (false, 0), (true, 0), (true, 1)]);
    p
}

/// The skipped keys are stored as runs of the list in the order stored
/// (docs/protocol.md §16.5): a ratchet key used twice heads two runs, and
/// the bytes are exactly `runs | runs × (DH | count | count × (N | mk |
/// stored at))`, each run's key written once. Read back, the list is the
/// same, in the same order, so a lookup takes the same key. Before, each key
/// was stored with its own 48-byte ratchet key.
#[test]
fn skipped_keys_are_stored_as_runs_in_the_order_stored() {
    let p = a_key_used_twice();
    let keys = &p.b.ratchet.skipped;
    let mut runs = vec![0u8, 3];
    for members in [&keys[0..1], &keys[1..2], &keys[2..4]] {
        runs.extend_from_slice(&members[0].dh.to_compressed());
        runs.extend_from_slice(&(members.len() as u16).to_be_bytes());
        for key in members {
            runs.extend_from_slice(&key.n.to_be_bytes());
            runs.extend_from_slice(key.mk.bytes());
            runs.extend_from_slice(&key.stored_at.to_be_bytes());
        }
    }
    assert_eq!(runs.len(), 2 + 3 * 50 + 4 * 44);
    assert_eq!(skipped_len(keys), runs.len());
    let stored = p.b.to_bytes();
    assert!(stored.ends_with(&runs));
    let read = round_trip(&p.b);
    let order = |c: &Conversation| -> Vec<_> {
        c.ratchet
            .skipped
            .iter()
            .map(|key| (key.dh, key.n, key.mk.clone(), key.stored_at))
            .collect()
    };
    assert_eq!(order(&read), order(&p.b));
    // With no skipped keys, the runs' count alone.
    let q = pair("no runs");
    assert!(q.b.ratchet.skipped.is_empty());
    assert!(q.b.to_bytes().ends_with(&[0, 0]));
    round_trip(&q.b);
}

/// A list has one encoding: two adjacent runs on one ratchet key (a run
/// split in two), an empty run, and more than MAX_STORED_SKIPPED keys in
/// all are each refused, and a later run may hold a ratchet key an earlier,
/// non-adjacent one holds.
#[test]
fn the_runs_have_one_encoding() {
    let p = a_key_used_twice();
    let stored = p.b.to_bytes().to_vec();
    let runs_at = stored.len() - skipped_len(&p.b.ratchet.skipped);
    let head = &stored[..runs_at];
    let key_bytes = |i: usize| {
        let key = &p.b.ratchet.skipped[i];
        let mut out = key.n.to_be_bytes().to_vec();
        out.extend_from_slice(key.mk.bytes());
        out.extend_from_slice(&key.stored_at.to_be_bytes());
        out
    };
    let run = |dh: &blstrs::G1Affine, keys: &[usize]| {
        let mut out = dh.to_compressed().to_vec();
        out.extend_from_slice(&(keys.len() as u16).to_be_bytes());
        for i in keys {
            out.extend(key_bytes(*i));
        }
        out
    };
    let with_runs = |runs: &[Vec<u8>]| {
        let mut out = head.to_vec();
        out.extend_from_slice(&(runs.len() as u16).to_be_bytes());
        for run in runs {
            out.extend_from_slice(run);
        }
        out
    };
    let (a1, a2) = (p.b.ratchet.skipped[0].dh, p.b.ratchet.skipped[1].dh);
    // As written: A1 heads the first and the third runs.
    let canonical = with_runs(&[run(&a1, &[0]), run(&a2, &[1]), run(&a1, &[2, 3])]);
    assert_eq!(canonical, stored);
    // The last run split in two.
    let split = with_runs(&[
        run(&a1, &[0]),
        run(&a2, &[1]),
        run(&a1, &[2]),
        run(&a1, &[3]),
    ]);
    // An empty run after the others, on another key than the last's.
    let empty = with_runs(&[
        run(&a1, &[0]),
        run(&a2, &[1]),
        run(&a1, &[2, 3]),
        run(&a2, &[]),
    ]);
    for bytes in [split, empty] {
        assert_eq!(
            Conversation::from_bytes(&bytes).err(),
            Some(Error::InvalidState)
        );
    }

    // At the cap, read; one key more, refused.
    let mut q = pair("runs at the cap");
    for _ in 0..3 {
        skip_sends(&mut q.a, MAX_SKIP - 1);
        let far = opened(&q.bob, &q.a.send_with(b"far", &mut q.draw).unwrap());
        q.b.receive_with(&far, T, &mut q.draw).unwrap();
        let reply = opened(&q.alice, &q.b.send_with(b"r", &mut q.draw).unwrap());
        q.a.receive_with(&reply, T, &mut q.draw).unwrap();
    }
    assert_eq!(q.b.ratchet.skipped.len(), MAX_STORED_SKIPPED);
    let full = round_trip(&q.b).to_bytes().to_vec();
    let mut over = full.clone();
    // The last run's count, one more, and one more key.
    let last_run = full.len() - 44 * (MAX_SKIP as usize - 1) - 2;
    let count = u16::from_be_bytes(full[last_run..last_run + 2].try_into().unwrap());
    assert_eq!(usize::from(count), MAX_SKIP as usize - 1);
    over[last_run..last_run + 2].copy_from_slice(&(count + 1).to_be_bytes());
    over.extend_from_slice(&full[full.len() - 44..]);
    assert_eq!(
        Conversation::from_bytes(&over).err(),
        Some(Error::InvalidState)
    );
}

/// Eviction takes the keys stored first, in the list's order, whatever
/// their times: Bob's clock set back after the first round, so its 999 keys
/// have the latest times and still go first when the next two rounds' 2,000
/// take the list past the cap. Storage between rounds keeps the order, so a
/// stored and restored state evicts the same keys.
#[test]
fn eviction_takes_the_keys_stored_first_through_storage() {
    let run = |store: bool| {
        let mut p = pair("eviction order");
        for (skip, now) in [(MAX_SKIP - 1, T + 3600), (MAX_SKIP, T), (MAX_SKIP, T)] {
            skip_sends(&mut p.a, skip);
            let far = opened(&p.bob, &p.a.send_with(b"far", &mut p.draw).unwrap());
            p.b.receive_with(&far, now, &mut p.draw).unwrap();
            if store {
                p.b = round_trip(&p.b);
            }
            let reply = opened(&p.alice, &p.b.send_with(b"r", &mut p.draw).unwrap());
            p.a.receive_with(&reply, T, &mut p.draw).unwrap();
        }
        p.b
    };
    let (kept, stored) = (run(false), run(true));
    assert_eq!(*kept.to_bytes(), *stored.to_bytes());
    assert_eq!(kept.ratchet.skipped.len(), MAX_STORED_SKIPPED);
    assert_eq!(kept.ratchet.lost, u64::from(MAX_SKIP - 1));
    // The first round's keys, stored at T + 1 h, went; the later rounds',
    // with earlier times, stayed.
    assert!(kept.ratchet.skipped.iter().all(|key| key.stored_at == T));
}
