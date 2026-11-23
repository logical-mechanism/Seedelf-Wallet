//! Part 8: a request's share (docs/protocol.md §3.1, §16.4; the 1.10.0
//! gate's design, §3.5). Before a reply, a writer sends at most 16
//! first-contact messages and 64 KiB of their inner messages, and a reader's
//! request holds no more: a first-contact header has PN 0 and N below 16 or
//! it doesn't parse, and a join past the share, or past the requests' 256
//! KiB, is refused before it's replayed. A join never pushes another request
//! out; only a new request, with its own stamp, pushes the oldest out, never
//! itself. Before, joins pushed strangers' requests out, one request grew
//! past 64 KiB, and a writer's 17th message went out.

use blstrs::G1Projective;
use group::Curve;

use super::support::{
    Seeded, handle, key, opened, own_handles, skip_sends, start, test_inbox, test_scalar,
};
use crate::Error;
use crate::envelope::encrypt_message;
use crate::session::conversation::Conversation;
use crate::session::first_contact::STAMP_LEN;
use crate::session::inbox::{
    MAX_ONE_REQUEST_BYTES, MAX_REQUEST_BYTES, MAX_REQUEST_MESSAGES, REQUESTS_VERSION, Received,
    Requests,
};
use crate::session::ratchet::{KDF_CK_CALLS, KeyPair};
use crate::session::secret::Secret32;
use crate::session::wire::{MAX_ENVELOPE_LEN, Opened, inner_capacity, open, pad};

const T: u64 = 1_800_000_000;

fn calls() -> u64 {
    KDF_CK_CALLS.with(|calls| calls.get())
}

fn reset() {
    KDF_CK_CALLS.with(|calls| calls.set(0));
}

/// A first-contact message's overhead: the type, F, the stamp, the ratchet
/// header, and the ratchet ciphertext's salt and tag.
fn overhead(conversation: &Conversation) -> usize {
    1 + conversation.first_bytes.len() + STAMP_LEN + 56 + 32
}

/// A requests' record (docs/protocol.md §16.5) of one request holding
/// `messages`, each arrived at T.
fn record_of(messages: &[&[u8]]) -> Vec<u8> {
    let mut out = vec![REQUESTS_VERSION];
    out.extend_from_slice(&1u64.to_be_bytes());
    out.extend_from_slice(&1u16.to_be_bytes());
    out.extend_from_slice(&0u64.to_be_bytes());
    out.push(0);
    out.extend_from_slice(&(messages.len() as u16).to_be_bytes());
    for message in messages {
        out.extend_from_slice(&T.to_be_bytes());
        out.extend_from_slice(&(message.len() as u32).to_be_bytes());
        out.extend_from_slice(message);
    }
    out
}

/// A first-contact message's inner bytes with its header's PN and N set.
fn with_counters(conversation: &Conversation, inner: &[u8], pn: u32, n: u32) -> Vec<u8> {
    let at = 1 + conversation.first_bytes.len() + STAMP_LEN + 48;
    let mut out = inner.to_vec();
    out[at..at + 4].copy_from_slice(&pn.to_be_bytes());
    out[at + 4..at + 8].copy_from_slice(&n.to_be_bytes());
    out
}

/// A first-contact message whose header has PN other than 0, or N of 16 or
/// more, doesn't parse, however it comes: opened from an envelope, from its
/// bytes alone, or from a stored request. The initiator's first chain sends
/// every first-contact message, within the share. Before, each parsed.
#[test]
fn a_first_contact_header_past_the_share_does_not_parse() {
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("share, the header");
    let mut a = start(&alice, &handle("bob", "h"), T, &mut draw);
    let honest = opened(&bob, &a.send_with(b"x", &mut draw).unwrap()).bytes;
    for (pn, n, parses) in [
        (0, 0, true),
        (0, 15, true),
        (0, 16, false),
        (0, u32::MAX, false),
        (1, 0, false),
        (u32::MAX, 3, false),
    ] {
        let bytes = with_counters(&a, &honest, pn, n);
        let sealed = encrypt_message(&bob.register(), &pad(&bytes, 2048))
            .unwrap()
            .to_bytes();
        let stored = Requests::from_bytes(&record_of(&[&bytes]));
        if parses {
            assert_eq!(open(&bob, &sealed).unwrap().header.n, n);
            assert!(Opened::from_bytes(&bytes).is_ok());
            assert!(stored.is_ok());
        } else {
            assert_eq!(open(&bob, &sealed).err(), Some(Error::InvalidMessage));
            assert_eq!(
                Opened::from_bytes(&bytes).err(),
                Some(Error::InvalidMessage)
            );
            assert_eq!(stored.err(), Some(Error::InvalidState));
        }
    }
}

/// The writer's 16: each joins at the reader, the 16th included, and its
/// count is the reader's. The 17th is refused before the chain moves, with
/// nothing drawn and the state as it was, stored or not, and
/// `max_text_len` says 0. A reply lifts the share: from then on only the
/// envelope bounds a message. The responder never has one.
#[test]
fn the_writer_sends_sixteen_first_contact_messages_and_no_seventeenth() {
    let (alice, bob) = (key("alice"), key("bob"));
    let mine = own_handles(&bob);
    let mut draw = Seeded::new("share, sixteen");
    let mut a = start(&alice, &handle("bob", "h"), T, &mut draw);
    assert_eq!(
        a.first_contact_left(),
        Some((MAX_REQUEST_MESSAGES as u32, MAX_ONE_REQUEST_BYTES))
    );
    let mut inbox = test_inbox();
    for i in 0..16u32 {
        assert_eq!(a.first_contact_left().unwrap().0, 16 - i);
        let envelope = a.send_with(format!("m{i}").as_bytes(), &mut draw).unwrap();
        match inbox.receive(&bob, &mine, &envelope, T).unwrap() {
            Received::Request { new, evicted, .. } => {
                assert_eq!(new, i == 0);
                assert!(evicted.is_empty());
            }
            other => panic!("{other:?}"),
        }
    }
    let request = inbox.requests().get(a.cid()).unwrap();
    assert_eq!(request.message_count(), 16);
    assert_eq!(
        a.first_contact_left(),
        Some((0, MAX_ONE_REQUEST_BYTES - request.stored_len()))
    );
    assert_eq!(a.max_text_len(), 0);

    let before = a.to_bytes();
    for text in [&b"m16"[..], b""] {
        draw.drain();
        reset();
        assert_eq!(a.send_with(text, &mut draw), Err(Error::RequestFull));
        assert_eq!(calls(), 0, "no chain step");
        assert!(draw.drain().is_empty(), "nothing drawn");
        assert_eq!(a.to_bytes(), before);
    }
    let stored = Conversation::from_bytes(&a.to_bytes()).unwrap();
    assert_eq!(stored.first_contact_left(), a.first_contact_left());
    assert_eq!(
        stored.clone().send_with(b"m16", &mut draw),
        Err(Error::RequestFull)
    );

    // The reply lifts it.
    inbox.accept(&bob, a.cid()).unwrap();
    assert_eq!(
        inbox.conversation(a.cid()).unwrap().first_contact_left(),
        None
    );
    let reply = inbox.send(a.cid(), b"reply").unwrap();
    a.receive_with(&opened(&alice, &reply), T, &mut draw)
        .unwrap();
    assert_eq!(a.first_contact_left(), None);
    assert_eq!(a.first_contact_sent, None);
    assert_eq!(a.max_text_len(), 32_517);
    let next = a.send_with(b"m16, after the reply", &mut draw).unwrap();
    assert!(matches!(
        inbox.receive(&bob, &mine, &next, T),
        Ok(Received::Message { .. })
    ));

    // A continuation's writer has a share of its own.
    let again = Conversation::continue_with(&alice, &a, T, &mut draw).unwrap();
    assert_eq!(
        again.first_contact_left(),
        Some((MAX_REQUEST_MESSAGES as u32, MAX_ONE_REQUEST_BYTES))
    );
}

/// The writer's bytes: its inner messages, unpadded, as the reader counts
/// them, at most 64 KiB. `max_text_len` is the smaller of the envelope's
/// room and the share's, and exact: a text of it goes, one byte more is
/// refused, by the share or by the envelope. Two of the largest fit; then
/// even an empty message doesn't.
#[test]
fn the_writers_share_is_64_kib_of_inner_messages() {
    let alice = key("alice");
    let mut draw = Seeded::new("share, bytes");
    let mut a = start(&alice, &handle("bob", "h"), T, &mut draw);
    let envelope_room = inner_capacity(MAX_ENVELOPE_LEN) - overhead(&a);
    assert_eq!(a.max_text_len(), envelope_room);
    // The envelope binds: one byte more is too large for it.
    assert_eq!(
        a.clone().send_with(&vec![0; envelope_room + 1], &mut draw),
        Err(Error::MessageTooLarge)
    );
    a.send_with(&vec![b'z'; envelope_room], &mut draw).unwrap();
    a.send_with(&vec![b'z'; 10_000], &mut draw).unwrap();
    let sent = 2 * overhead(&a) + envelope_room + 10_000;
    assert_eq!(sent, 32_622 + 10_607);
    // Now the share binds.
    let share_room = MAX_ONE_REQUEST_BYTES - sent - overhead(&a);
    assert!(share_room < envelope_room);
    assert_eq!(a.max_text_len(), share_room);
    assert_eq!(
        a.clone().send_with(&vec![0; share_room + 1], &mut draw),
        Err(Error::RequestFull)
    );
    a.send_with(&vec![b'z'; share_room], &mut draw).unwrap();
    assert_eq!(a.first_contact_left(), Some((13, 0)));
    assert_eq!(a.max_text_len(), 0);
    assert_eq!(a.send_with(b"", &mut draw), Err(Error::RequestFull));

    // Two of the largest, then nothing: 292 bytes left, under one message's
    // overhead.
    let mut b = start(&alice, &handle("bob", "h"), T, &mut draw);
    for _ in 0..2 {
        b.send_with(&vec![b'z'; envelope_room], &mut draw).unwrap();
    }
    assert_eq!(b.first_contact_left(), Some((14, 65_536 - 2 * 32_622)));
    assert_eq!(b.max_text_len(), 0);
    let before = b.to_bytes();
    reset();
    assert_eq!(b.send_with(b"", &mut draw), Err(Error::RequestFull));
    assert_eq!(calls(), 0);
    assert_eq!(b.to_bytes(), before);
}

/// The strangers' largest first messages, `count` of them, each a request.
fn strangers(
    inbox: &mut crate::session::inbox::Inbox,
    count: usize,
    label: &str,
) -> Vec<crate::session::ConversationId> {
    let (bob, bob_handle) = (key("bob"), handle("bob", "h"));
    let mut draw = Seeded::new(label);
    (0..count)
        .map(|i| {
            let stranger = key(&format!("{label} {i}"));
            let mut c = start(&stranger, &bob_handle, T, &mut draw);
            let text = vec![b's'; c.max_text_len()];
            let envelope = c.send_with(&text, &mut draw).unwrap();
            assert!(matches!(
                inbox.receive(&bob, &own_handles(&bob), &envelope, T),
                Ok(Received::Request { new: true, .. })
            ));
            c.cid()
        })
        .collect()
}

/// At the reader, a join past its request's 64 KiB, or one that would take
/// the requests past 256 KiB, is refused before its request is replayed
/// (no key derived), with the record as it was and no other request pushed
/// out. The join's earlier checks come first: another F, a header already
/// held, another header key. Before, the first case held 97,866 bytes in one
/// request, and the second pushed two strangers out.
#[test]
fn a_join_past_the_share_or_the_store_is_refused_before_any_replay() {
    let (alice, bob) = (key("alice"), key("bob"));
    let mine = own_handles(&bob);
    let mut draw = Seeded::new("share, the reader");

    // One request's 64 KiB: a writer outside the share, its count cleared,
    // sends a third of the largest.
    let mut inbox = test_inbox();
    let mut a = start(&alice, &handle("bob", "h"), T, &mut draw);
    let largest = a.max_text_len();
    for _ in 0..2 {
        let envelope = a.send_with(&vec![b'a'; largest], &mut draw).unwrap();
        inbox.receive(&bob, &mine, &envelope, T).unwrap();
    }
    a.first_contact_sent = Some(0);
    let third = a.send_with(&vec![b'a'; largest], &mut draw).unwrap();
    let before = inbox.requests().to_bytes();
    reset();
    assert_eq!(
        inbox.receive(&bob, &mine, &third, T),
        Err(Error::RequestFull)
    );
    assert_eq!(calls(), 0, "refused before the replay");
    assert_eq!(inbox.requests().to_bytes(), before);
    assert_eq!(
        inbox.requests().get(a.cid()).unwrap().stored_len(),
        2 * 32_622
    );

    // The requests' 256 KiB: seven strangers' largest and Alice's first
    // largest fill 260,976 of 262,144 bytes.
    let mut inbox = test_inbox();
    let held = strangers(&mut inbox, 7, "share, a stranger");
    let mut a = start(&alice, &handle("bob", "h"), T, &mut draw);
    let first = a.send_with(&vec![b'a'; largest], &mut draw).unwrap();
    inbox.receive(&bob, &mine, &first, T).unwrap();
    assert_eq!(inbox.requests().stored_len(), 8 * 32_622);
    // A short join fits the 1,168 bytes left; a longer one doesn't.
    let short = a.send_with(b"short", &mut draw).unwrap();
    assert!(matches!(
        inbox.receive(&bob, &mine, &short, T),
        Ok(Received::Request { new: false, ref evicted, .. }) if evicted.is_empty()
    ));
    let long = a.send_with(&[b'a'; 1000], &mut draw).unwrap();
    assert!(inbox.requests().stored_len() + 1000 + overhead(&a) > MAX_REQUEST_BYTES);
    let before = inbox.requests().to_bytes();
    reset();
    assert_eq!(
        inbox.receive(&bob, &mine, &long, T),
        Err(Error::RequestFull)
    );
    assert_eq!(calls(), 0);
    assert_eq!(inbox.requests().to_bytes(), before);
    assert!(held.iter().all(|cid| inbox.requests().get(*cid).is_some()));

    // The join's checks before the bounds, each with its own refusal.
    assert_eq!(
        inbox.receive(&bob, &mine, &short, T),
        Err(Error::KeyUsedOrDeleted)
    );
    let mut other_f = a.clone();
    other_f.first.started_at += 1;
    other_f.first_bytes = other_f.first.to_bytes();
    let envelope = other_f.send_with(b"another F", &mut draw).unwrap();
    assert_eq!(
        inbox.receive(&bob, &mine, &envelope, T),
        Err(Error::DifferentFirstContact)
    );
    let mut other_key = a.clone();
    let s = test_scalar("another header key");
    other_key.ratchet.dhs = KeyPair {
        secret: Secret32::from_bytes(s.to_bytes_be()),
        public: (G1Projective::from(a.first.base) * s).to_affine(),
    };
    let envelope = other_key.send_with(b"another key", &mut draw).unwrap();
    assert_eq!(
        inbox.receive(&bob, &mine, &envelope, T),
        Err(Error::InvalidKeysProof)
    );
    assert_eq!(inbox.requests().to_bytes(), before);
}

/// Only a new request pushes others out, the oldest first and never itself:
/// the 51st pushes out the first, and a largest one past 256 KiB pushes out
/// the oldest, while a join at 50 requests pushes out none.
#[test]
fn a_new_request_pushes_out_the_oldest_and_never_itself() {
    let bob = key("bob");
    let mine = own_handles(&bob);
    // 50 small requests; a join of the first; then a 51st.
    let mut inbox = test_inbox();
    let mut draw = Seeded::new("share, fifty");
    let mut writers: Vec<Conversation> = (0..50)
        .map(|i| {
            let mut c = start(
                &key(&format!("writer {i}")),
                &handle("bob", "h"),
                T,
                &mut draw,
            );
            let envelope = c.send_with(b"hi", &mut draw).unwrap();
            inbox.receive(&bob, &mine, &envelope, T).unwrap();
            c
        })
        .collect();
    let join = writers[0].send_with(b"again", &mut draw).unwrap();
    assert!(matches!(
        inbox.receive(&bob, &mine, &join, T),
        Ok(Received::Request { new: false, ref evicted, .. }) if evicted.is_empty()
    ));
    let mut last = start(&key("writer 50"), &handle("bob", "h"), T, &mut draw);
    let envelope = last.send_with(b"hi", &mut draw).unwrap();
    match inbox.receive(&bob, &mine, &envelope, T).unwrap() {
        Received::Request {
            cid, new, evicted, ..
        } => {
            assert!(new);
            assert_eq!(evicted, vec![writers[0].cid()]);
            assert!(!evicted.contains(&cid));
        }
        other => panic!("{other:?}"),
    }
    assert!(inbox.requests().get(last.cid()).is_some());

    // By bytes: eight of the largest, then a ninth.
    let mut inbox = test_inbox();
    let held = strangers(&mut inbox, 9, "share, nine");
    assert_eq!(inbox.requests().len(), 8);
    assert!(inbox.requests().get(held[0]).is_none());
    assert!(inbox.requests().get(held[8]).is_some());
    assert!(inbox.requests().stored_len() <= MAX_REQUEST_BYTES);
}

/// The writer's count is stored exactly while it sends first-contact
/// messages (docs/protocol.md §16.5, flags bit 4, before Ns), within the
/// share; any other state is refused: without it before a reply, with it
/// after one or at the responder, past 64 KiB, or with Ns past 16.
#[test]
fn the_writers_count_is_stored_for_an_initiator_before_a_reply() {
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("share, stored");
    let mut a = start(&alice, &handle("bob", "h"), T, &mut draw);
    let first = a.send_with(b"one", &mut draw).unwrap();
    let sent = (overhead(&a) + 3) as u32;
    assert_eq!(a.first_contact_sent, Some(sent));
    let bytes = a.to_bytes().to_vec();
    let flags_at = 1 + 1 + 2 + a.first_bytes.len() + 48 + 32;
    assert_eq!(bytes[flags_at] & 0x10, 0x10);
    // No skipped keys: Ns, Nr, PN, lost and the runs' count end it.
    let count_at = bytes.len() - 22 - 4;
    assert_eq!(
        bytes[count_at..count_at + 4],
        sent.to_be_bytes(),
        "the count, before Ns"
    );
    assert_eq!(bytes[count_at + 4..count_at + 8], 1u32.to_be_bytes());
    assert_eq!(*Conversation::from_bytes(&bytes).unwrap().to_bytes(), bytes);

    let refused = |bytes: &[u8]| Conversation::from_bytes(bytes).err() == Some(Error::InvalidState);
    // Without the count before a reply.
    let mut without = bytes.clone();
    without[flags_at] &= !0x10;
    without.drain(count_at..count_at + 4);
    assert!(refused(&without));
    // Past 64 KiB, and at the share's edge.
    for (value, ok) in [(65_536u32, true), (65_537, false), (u32::MAX, false)] {
        let mut over = bytes.clone();
        over[count_at..count_at + 4].copy_from_slice(&value.to_be_bytes());
        assert_eq!(!refused(&over), ok, "{value}");
    }
    // Ns past 16 with it.
    let mut many = a.clone();
    skip_sends(&mut many, 16);
    assert!(refused(&many.to_bytes()));
    let mut sixteen = a.clone();
    skip_sends(&mut sixteen, 15);
    assert!(!refused(&sixteen.to_bytes()));

    // At the responder, and at the initiator after a reply: with the bit
    // and a count inserted where it goes, refused.
    let (mut b, _) =
        Conversation::accept_with(&bob, &[(&opened(&bob, &first), T)], &mut draw).unwrap();
    let reply = b.send_with(b"reply", &mut draw).unwrap();
    a.receive_with(&opened(&alice, &reply), T, &mut draw)
        .unwrap();
    for conversation in [&a, &b] {
        assert_eq!(conversation.first_contact_sent, None);
        let mut bytes = conversation.to_bytes().to_vec();
        let flags_at = 1 + 1 + 2 + conversation.first_bytes.len() + 48 + 32;
        assert_eq!(bytes[flags_at] & 0x10, 0);
        bytes[flags_at] |= 0x10;
        let at = bytes.len() - 22;
        bytes.splice(at..at, 0u32.to_be_bytes());
        assert!(refused(&bytes));
    }
}

/// A stored request is held to the share as an arriving one is: 17 messages,
/// one N held twice, or more than 64 KiB are each refused; the 16 the
/// writer may send read.
#[test]
fn a_stored_request_past_the_share_is_refused() {
    let (alice, bob) = (key("alice"), key("bob"));
    let mine = own_handles(&bob);
    let mut draw = Seeded::new("share, the record");
    let mut a = start(&alice, &handle("bob", "h"), T, &mut draw);
    let mut inbox = test_inbox();
    let mut inners = Vec::new();
    for i in 0..16 {
        let envelope = a.send_with(format!("m{i}").as_bytes(), &mut draw).unwrap();
        inners.push(opened(&bob, &envelope).bytes);
        inbox.receive(&bob, &mine, &envelope, T).unwrap();
    }
    let record = inbox.requests().to_bytes();
    let read = Requests::from_bytes(&record).unwrap();
    assert_eq!(read.to_bytes(), record);
    assert_eq!(read.get(a.cid()).unwrap().message_count(), 16);
    let all: Vec<&[u8]> = inners.iter().map(Vec::as_slice).collect();
    assert!(Requests::from_bytes(&record_of(&all)).is_ok());

    let mut seventeen = all.clone();
    seventeen.push(all[3]);
    assert_eq!(
        Requests::from_bytes(&record_of(&seventeen)).err(),
        Some(Error::InvalidState)
    );
    assert_eq!(
        Requests::from_bytes(&record_of(&[all[0], all[1], all[1]])).err(),
        Some(Error::InvalidState)
    );
    // More than 64 KiB: a writer outside the share's three largest.
    let mut big = start(&alice, &handle("bob", "h"), T, &mut draw);
    let largest = big.max_text_len();
    let three: Vec<Vec<u8>> = (0..3)
        .map(|_| {
            big.first_contact_sent = Some(0);
            let envelope = big.send_with(&vec![b'b'; largest], &mut draw).unwrap();
            opened(&bob, &envelope).bytes
        })
        .collect();
    assert!(Requests::from_bytes(&record_of(&[&three[0], &three[1]])).is_ok());
    assert_eq!(
        Requests::from_bytes(&record_of(&[&three[0], &three[1], &three[2]])).err(),
        Some(Error::InvalidState)
    );
}
