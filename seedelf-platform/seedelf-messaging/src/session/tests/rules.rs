//! Part 3: the rules of docs/protocol.md §3.1, §5 and §6 that the
//! adversarial cases don't already hold: the window, requests' joins,
//! unexpected messages, tombstones on conversations, and the records.

use super::ratchet::pair;
use super::support::{Seeded, handle, key, opened, own_handles, start, test_inbox};
use crate::Error;
use crate::session::conversation::Conversation;
use crate::session::first_contact::ConversationId;
use crate::session::inbox::{Inbox, Received, Requests, Tombstones};
use crate::session::ratchet::KDF_CK_CALLS;

const T: u64 = 1_800_000_000;

/// A first message whose t is more than 48 hours old, or more than an hour
/// ahead, is refused and leaves nothing.
#[test]
fn a_first_message_outside_the_window_leaves_nothing() {
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("window");
    for (t, now, ok) in [
        (T, T + 48 * 3600, true),
        (T, T + 48 * 3600 + 1, false),
        (T + 3600, T, true),
        (T + 3601, T, false),
    ] {
        let mut a = start(&alice, &handle("bob", "h"), t, &mut draw);
        let envelope = a.send_with(b"hi", &mut draw).unwrap();
        let mut inbox = test_inbox();
        let result = inbox.receive(&bob, &own_handles(&bob), &envelope, now);
        if ok {
            assert!(matches!(result, Ok(Received::Request { new: true, .. })));
        } else {
            assert_eq!(result, Err(Error::OutsideWindow));
            assert!(inbox.requests().is_empty());
        }
    }
}

/// Later first-contact messages join their request: authenticated, once per
/// number, and with no window of their own (rule 1).
#[test]
fn later_first_contact_messages_join_their_request() {
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("join");
    let mut a = start(&alice, &handle("bob", "h"), T, &mut draw);
    let m0 = a.send_with(b"zero", &mut draw).unwrap();
    let m1 = a.send_with(b"one", &mut draw).unwrap();
    let mut inbox = test_inbox();
    inbox.receive(&bob, &own_handles(&bob), &m0, T).unwrap();
    // Past the window, it still joins: the cid is known.
    let late = T + 72 * 3600;
    assert_eq!(
        inbox.receive(&bob, &own_handles(&bob), &m1, late).unwrap(),
        Received::Request {
            cid: a.cid(),
            plaintext: b"one".to_vec(),
            new: false,
            evicted: vec![],
        }
    );
    let before = inbox.requests().to_bytes();
    // A duplicate is refused before the request is replayed: a re-post costs
    // the reader no ratchet work, however long the request.
    KDF_CK_CALLS.with(|calls| calls.set(0));
    assert_eq!(
        inbox.receive(&bob, &own_handles(&bob), &m1, late),
        Err(Error::KeyUsedOrDeleted)
    );
    assert_eq!(
        inbox.receive(&bob, &own_handles(&bob), &m0, late),
        Err(Error::KeyUsedOrDeleted)
    );
    assert_eq!(KDF_CK_CALLS.with(|calls| calls.get()), 0);
    // A join that doesn't authenticate isn't kept.
    let mut forged = opened(&bob, &a.send_with(b"two", &mut draw).unwrap());
    *forged.ciphertext.last_mut().unwrap() ^= 1;
    assert_eq!(
        inbox.receive_opened(&bob, &own_handles(&bob), &forged, late, &mut draw),
        Err(Error::DecryptionFailed)
    );
    assert_eq!(inbox.requests().to_bytes(), before);
    let request = inbox.requests().get(a.cid()).unwrap();
    assert_eq!(request.message_count(), 2);
    assert_eq!(
        request.read(&bob).unwrap(),
        vec![Ok(b"zero".to_vec()), Ok(b"one".to_vec())]
    );
    // Each text's arrival, in the same order, and kept across storage.
    assert_eq!(request.arrivals().collect::<Vec<_>>(), [T, late]);
    let stored = Requests::from_bytes(&before).unwrap();
    let stored = stored.get(a.cid()).unwrap();
    assert_eq!(stored.arrivals().collect::<Vec<_>>(), [T, late]);
    // Reading changed nothing.
    assert_eq!(inbox.requests().to_bytes(), before);
}

/// A session message for a request not yet replied to, and a first-contact
/// message sent back to its writer, are unexpected and change nothing.
#[test]
fn unexpected_messages_change_nothing() {
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("unexpected");
    let mut a = start(&alice, &handle("bob", "h"), T, &mut draw);
    let first = a.send_with(b"hi", &mut draw).unwrap();
    let mut bob_inbox = test_inbox();
    bob_inbox
        .receive(&bob, &own_handles(&bob), &first, T)
        .unwrap();
    // A 0x02 with the request's cid, as from a reply Bob never made.
    let mut b = bob_inbox.clone();
    b.accept(&bob, a.cid()).unwrap();
    let mut as_alice = a.clone();
    as_alice
        .receive_with(
            &opened(&alice, &b.send(a.cid(), b"r").unwrap()),
            T,
            &mut draw,
        )
        .unwrap();
    let session = as_alice.send_with(b"0x02", &mut draw).unwrap();
    assert_eq!(opened(&bob, &session).bytes[0], 0x02);
    let before = bob_inbox.requests().to_bytes();
    assert_eq!(
        bob_inbox.receive(&bob, &own_handles(&bob), &session, T),
        Err(Error::UnexpectedMessage)
    );
    assert_eq!(bob_inbox.requests().to_bytes(), before);

    // Alice's own first message, re-wrapped to her identity.
    let mut alice_inbox =
        Inbox::from_parts(vec![a.clone()], Requests::new(), Tombstones::new()).unwrap();
    let inner = opened(&bob, &first);
    assert_eq!(
        alice_inbox.receive_opened(&alice, &own_handles(&alice), &inner, T, &mut draw),
        Err(Error::UnexpectedMessage)
    );
    assert_eq!(
        *alice_inbox.conversation(a.cid()).unwrap().to_bytes(),
        *a.to_bytes()
    );
}

/// Alice sends first-contact messages until a reply from Bob decrypts, and a
/// forged reply doesn't switch her.
#[test]
fn the_initiator_switches_to_session_messages_on_a_real_reply() {
    let mut p = pair("switch");
    assert!(!p.a.sends_first_contact());
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("switch 2");
    let mut a = start(&alice, &handle("bob", "h"), T, &mut draw);
    let first = opened(&bob, &a.send_with(b"x", &mut draw).unwrap());
    let (mut b, _) = Conversation::accept_with(&bob, &[(&first, T)], &mut draw).unwrap();
    let mut reply = opened(&alice, &b.send_with(b"y", &mut draw).unwrap());
    let good = reply.clone();
    *reply.ciphertext.last_mut().unwrap() ^= 1;
    assert!(a.receive_with(&reply, T, &mut draw).is_err());
    assert!(a.sends_first_contact());
    assert_eq!(
        opened(&bob, &a.send_with(b"still", &mut draw).unwrap()).bytes[0],
        0x01
    );
    a.receive_with(&good, T, &mut draw).unwrap();
    assert!(!a.sends_first_contact());
    assert_eq!(
        opened(&bob, &a.send_with(b"now", &mut draw).unwrap()).bytes[0],
        0x02
    );
    let _ = p.a.send_with(b"", &mut p.draw).unwrap();
}

/// Deleting a conversation keeps its cid until its t + 48 hours: session
/// messages are refused as deleted, then as a conversation this browser no
/// longer has.
#[test]
fn deleting_a_conversation_tombstones_it_until_t_plus_48_hours() {
    let mut p = pair("delete");
    let cid = p.b.cid();
    let mut inbox =
        Inbox::from_parts(vec![p.b.clone()], Requests::new(), Tombstones::new()).unwrap();
    assert!(inbox.delete(cid));
    assert!(!inbox.delete(cid));
    let envelope = p.a.send_with(b"are you there", &mut p.draw).unwrap();
    assert_eq!(
        inbox.receive(&p.bob, &own_handles(&p.bob), &envelope, T + 48 * 3600),
        Err(Error::Deleted)
    );
    assert!(inbox.tombstones().holds(cid, T + 48 * 3600));
    assert!(!inbox.tombstones().holds(cid, T + 48 * 3600 + 1));
    assert_eq!(
        inbox.receive(&p.bob, &own_handles(&p.bob), &envelope, T + 48 * 3600 + 1),
        Err(Error::UnknownConversation)
    );
    assert_eq!(inbox.tombstones().len(), 1);
    inbox.expire(T + 48 * 3600 + 1);
    assert!(inbox.tombstones().is_empty());
    // Nothing else to accept or send.
    assert_eq!(inbox.accept(&p.bob, cid), Err(Error::UnknownConversation));
    assert_eq!(inbox.send(cid, b"x"), Err(Error::UnknownConversation));
}

/// The requests and tombstones records round-trip, and refuse every
/// truncation, an extension and another version.
#[test]
fn the_records_round_trip_and_are_checked() {
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("records, the strangers");
    let mut inbox =
        Inbox::from_parts(vec![pair("records").b], Requests::new(), Tombstones::new()).unwrap();
    inbox.set_first_contact_bits(super::support::TEST_BITS);
    for i in 0..3u64 {
        let mut a = start(&alice, &handle("bob", "h"), T + i, &mut draw);
        for j in 0..=i {
            inbox
                .receive(
                    &bob,
                    &own_handles(&bob),
                    &a.send_with(format!("{i}{j}").as_bytes(), &mut draw)
                        .unwrap(),
                    T,
                )
                .unwrap();
        }
    }
    let gone = inbox.requests().iter().next().unwrap().cid();
    inbox.delete(gone);
    let requests = inbox.requests().to_bytes();
    let tombstones = inbox.tombstones().to_bytes();
    let read = Requests::from_bytes(&requests).unwrap();
    assert_eq!(read.to_bytes(), requests);
    assert_eq!(read.len(), 2);
    assert_eq!(
        Tombstones::from_bytes(&tombstones).unwrap(),
        *inbox.tombstones()
    );
    for (bytes, reader) in [
        (
            &requests,
            &(|b: &[u8]| Requests::from_bytes(b).map(|_| ()))
                as &dyn Fn(&[u8]) -> Result<(), Error>,
        ),
        (&tombstones, &|b: &[u8]| {
            Tombstones::from_bytes(b).map(|_| ())
        }),
    ] {
        for cut in 0..bytes.len() {
            assert!(reader(&bytes[..cut]).is_err(), "{cut}");
        }
        let mut extended = bytes.clone();
        extended.push(0);
        assert_eq!(reader(&extended), Err(Error::InvalidState));
        let mut other = bytes.clone();
        other[0] = 2;
        assert_eq!(reader(&other), Err(Error::UnsupportedStateVersion(2)));
    }
    assert!(
        Requests::from_bytes(&Requests::new().to_bytes())
            .unwrap()
            .is_empty()
    );
    assert!(
        Tombstones::from_bytes(&Tombstones::new().to_bytes())
            .unwrap()
            .is_empty()
    );
    // A request record whose messages disagree on F is refused: change t in
    // the last message's F, found by its cid.
    let last = read.iter().last().unwrap();
    assert!(last.message_count() > 1);
    let cid = last.cid().0;
    let at = requests.windows(16).rposition(|w| w == cid).unwrap();
    let mut two_fs = requests.clone();
    two_fs[at + 16 + 7] ^= 1;
    assert_eq!(
        Requests::from_bytes(&two_fs).err(),
        Some(Error::InvalidState)
    );
}

/// Parts with one cid twice, or a cid both a conversation and a request,
/// are refused.
#[test]
fn an_inbox_holds_each_cid_once() {
    let p = pair("once");
    assert_eq!(
        Inbox::from_parts(
            vec![p.b.clone(), p.b.clone()],
            Requests::new(),
            Tombstones::new()
        )
        .err(),
        Some(Error::InvalidState)
    );
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("once 2");
    let mut a = start(&alice, &handle("bob", "h"), T, &mut draw);
    let mut inbox = test_inbox();
    inbox
        .receive(
            &bob,
            &own_handles(&bob),
            &a.send_with(b"x", &mut draw).unwrap(),
            T,
        )
        .unwrap();
    let mut accepted = inbox.clone();
    accepted.accept(&bob, a.cid()).unwrap();
    let conversation = accepted.conversation(a.cid()).unwrap().clone();
    assert_eq!(
        Inbox::from_parts(
            vec![conversation],
            inbox.requests().clone(),
            Tombstones::new()
        )
        .err(),
        Some(Error::InvalidState)
    );
}

/// A continuation can only be started by a side of the old conversation.
#[test]
fn only_a_side_can_continue() {
    let p = pair("sides");
    let mallory = key("mallory");
    assert_eq!(
        Conversation::continue_with(&mallory, &p.a, T, &mut Seeded::new("m")).err(),
        Some(Error::NotForThisKey)
    );
    let mut inbox =
        Inbox::from_parts(vec![p.a.clone()], Requests::new(), Tombstones::new()).unwrap();
    assert_eq!(
        inbox.start_continuing(&p.alice, ConversationId([0; 16]), T),
        Err(Error::UnknownConversation)
    );
    let next = inbox.start_continuing(&p.alice, p.a.cid(), T).unwrap();
    assert_eq!(
        inbox.conversation(next).unwrap().first_contact().replaces(),
        Some(p.a.cid())
    );
}
