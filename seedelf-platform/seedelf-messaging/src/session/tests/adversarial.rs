//! Part 4: docs/protocol-review.md §E's adversarial cases, one test each.
//! Cases 4 and 5 are about the worker's order of writes and posts, so they
//! run over a relay in tests/simulation.rs.

use blstrs::{G1Affine, G1Projective, Scalar};
use group::Curve;

use super::ratchet::pair;
use super::support::{Seeded, handle, key, opened, skip_sends, test_scalar};
use crate::register::{Register, rerandomize_with};
use crate::session::conversation::{Conversation, Role};
use crate::session::draw::Draw;
use crate::session::first_contact::{
    ConversationId, FIRST_CONTACT_MAX_AGE, FirstContact, session_key,
};
use crate::session::inbox::{Continues, Inbox, MAX_REQUEST_BYTES, MAX_REQUESTS, Received};
use crate::session::ratchet::{
    KDF_CK_CALLS, KeyPair, MAX_SKIP, Ratchet, kdf_ck, message_key_and_nonce,
};
use crate::{Error, SecretKey};

const T: u64 = 1_800_000_000;

/// What a forger puts in F, and what she can compute for SK.
struct Forgery {
    cid: ConversationId,
    t: u64,
    replaces: Option<ConversationId>,
    base: G1Affine,
    /// The A she names: anyone's.
    initiator: G1Affine,
    /// What she believes w₀ is (tests may hand her the true one).
    responder: G1Affine,
    /// Her guess at the static DH, [x_A]w₀, which she can't compute.
    static_dh: [u8; 48],
}

/// A first-contact envelope built from a forger's values, addressed to
/// (p₀, w₀) as she believes it.
fn forge(forgery: &Forgery, text: &[u8], draw: &mut dyn Draw) -> Vec<u8> {
    let e = draw.scalar();
    let first = FirstContact {
        cid: forgery.cid,
        started_at: forgery.t,
        to: Vec::new(),
        replaces: forgery.replaces,
        base: forgery.base,
        initiator: forgery.initiator,
        ephemeral: (G1Projective::from(forgery.base) * e).to_affine(),
    };
    let first_bytes = first.to_bytes();
    let ephemeral_dh = (G1Projective::from(forgery.responder) * e).to_compressed();
    let sk = session_key(&ephemeral_dh, &forgery.static_dh, &first_bytes);
    let s = KeyPair::generate(&forgery.base, draw);
    let mut conversation = Conversation {
        role: Role::Initiator,
        first,
        first_bytes,
        responder: forgery.responder,
        ratchet: Ratchet::init_alice(&sk, s, forgery.responder),
    };
    conversation.send_with(text, draw).unwrap()
}

fn mul(point: &G1Affine, scalar: &Scalar) -> G1Affine {
    (G1Projective::from(*point) * scalar).to_affine()
}

fn base_and_w0(register: &Register, b: &Scalar) -> (G1Affine, G1Affine) {
    let r = rerandomize_with(register, b);
    (r.generator().to_affine(), r.public_value().to_affine())
}

/// Case 1. Mallory names a register she doesn't control as R_A. Even handed
/// the true w₀, she can't compute the static DH, so the reader never gets a
/// session or a request, and the register's owner sees only envelopes for a
/// conversation they don't have.
#[test]
fn case_01_an_unowned_r_a_yields_no_session() {
    let (alice, bob, mallory) = (key("alice"), key("bob"), key("mallory"));
    let bob_handle = handle("bob", "bob's handle");
    let alice_handle = handle("alice", "alice's handle");
    let mut draw = Seeded::new("case 1");

    // On Bob's base, so she knows w₀; A claimed as Alice's (she can only
    // re-randomize Alice's register on Alice's own base, not on p₀).
    let (base, w0) = base_and_w0(&bob_handle, &test_scalar("b"));
    let claimed_a = mul(&base, &test_scalar("not x_A"));
    // On Alice's base, so A really is [x_A]p₀; Mallory is handed w₀.
    let (alice_base, alice_a) = base_and_w0(&alice_handle, &test_scalar("b'"));
    let true_w0 = mul(&alice_base, &bob.scalar());
    for (base, initiator, responder) in [(base, claimed_a, w0), (alice_base, alice_a, true_w0)] {
        let forgery = Forgery {
            cid: ConversationId([1; 16]),
            t: T,
            replaces: None,
            base,
            initiator,
            responder,
            // Her best guess: her own key on w₀.
            static_dh: mul(&responder, &mallory.scalar()).to_compressed(),
        };
        let envelope = forge(&forgery, b"reply to Alice's mailbox", &mut draw);
        let mut bob_inbox = Inbox::new();
        assert_eq!(
            bob_inbox.receive(&bob, &envelope, T),
            Err(Error::DecryptionFailed)
        );
        assert!(bob_inbox.requests().is_empty() && bob_inbox.conversations().next().is_none());
    }

    // Control: with her own key as A, she does start a session, as an
    // unknown sender.
    let forgery = Forgery {
        cid: ConversationId([2; 16]),
        t: T,
        replaces: None,
        base,
        initiator: mul(&base, &mallory.scalar()),
        responder: w0,
        static_dh: mul(&w0, &mallory.scalar()).to_compressed(),
    };
    let mut bob_inbox = Inbox::new();
    assert!(matches!(
        bob_inbox.receive(&bob, &forge(&forgery, b"hi", &mut draw), T),
        Ok(Received::Request { .. })
    ));

    // Alice, whose register was named, finds envelopes on it only as a
    // conversation she doesn't have.
    let mut alice_inbox = Inbox::new();
    let mut fake = pair("case 1 fake").a;
    fake.first.base = alice_base;
    fake.first.initiator = alice_a;
    fake.first_bytes = fake.first.to_bytes();
    fake.ratchet.ckr = Some(crate::session::secret::Secret32::from_bytes([9; 32]));
    let envelope = {
        // Mallory writes a session message to R_A.
        let mut as_responder = fake.clone();
        as_responder.role = Role::Responder;
        as_responder
            .send_with(b"to Alice's register", &mut draw)
            .unwrap()
    };
    assert_eq!(
        alice_inbox.receive(&alice, &envelope, T),
        Err(Error::UnknownConversation)
    );
    assert!(alice_inbox.requests().is_empty() && alice_inbox.conversations().next().is_none());
}

/// Case 2. An R_A lifted from another conversation: Alice wrote to Mallory,
/// and Mallory reuses Alice's R_A to write to Carol, on its own base or on
/// Carol's. Neither yields a session.
#[test]
fn case_02_a_lifted_r_a_is_refused() {
    let (alice, mallory, carol) = (key("alice"), key("mallory"), key("carol"));
    let mut draw = Seeded::new("case 2");
    let to_mallory =
        Conversation::start_with(&alice, &handle("mallory", "m"), b"", T, &mut draw).unwrap();
    let lifted = to_mallory.initiator_register();
    let (lifted_base, lifted_a) = (to_mallory.first.base, to_mallory.first.initiator);
    assert!(crate::matches_register(&alice, &lifted));

    let carol_handle = handle("carol", "carol's handle");
    let (carol_base, carol_w0) = base_and_w0(&carol_handle, &test_scalar("b"));
    for (base, responder) in [
        // Its own base: A fits, w₀ handed to her.
        (lifted_base, mul(&lifted_base, &carol.scalar())),
        // Carol's base: A doesn't fit it.
        (carol_base, carol_w0),
    ] {
        let forgery = Forgery {
            cid: ConversationId([3; 16]),
            t: T,
            replaces: None,
            base,
            initiator: lifted_a,
            responder,
            static_dh: mul(&responder, &mallory.scalar()).to_compressed(),
        };
        let mut carol_inbox = Inbox::new();
        let envelope = forge(&forgery, b"I'm Alice", &mut draw);
        assert_eq!(
            carol_inbox.receive(&carol, &envelope, T),
            Err(Error::DecryptionFailed)
        );
        assert!(carol_inbox.requests().is_empty());
    }
}

/// Case 3. Sends through the one queue get distinct counters and message
/// keys. Two sends racing on copies of one state (what the queue prevents)
/// share a counter and a message key, yet the salt still gives them
/// different AES-GCM keys and nonces, and the reader takes only one.
#[test]
fn case_03_racing_sends() {
    let mut p = pair("case 3");
    let mut keys = Vec::new();
    let mut numbers = Vec::new();
    for i in 0..100 {
        let ck = p.a.ratchet.cks.clone().unwrap();
        keys.push(kdf_ck(&ck).1);
        let m = opened(
            &p.bob,
            &p.a.send_with(format!("{i}").as_bytes(), &mut p.draw)
                .unwrap(),
        );
        numbers.push((m.header.dh.to_compressed(), m.header.n));
    }
    for i in 0..keys.len() {
        for j in 0..i {
            assert_ne!(keys[i], keys[j]);
            assert_ne!(numbers[i], numbers[j]);
        }
    }

    let (mut one, mut two) = (p.a.clone(), p.a.clone());
    let first = opened(&p.bob, &one.send_with(b"first", &mut p.draw).unwrap());
    let second = opened(&p.bob, &two.send_with(b"second", &mut p.draw).unwrap());
    assert_eq!(first.header, second.header);
    let mk = kdf_ck(p.a.ratchet.cks.as_ref().unwrap()).1;
    let salt =
        |m: &crate::session::wire::Opened| -> [u8; 16] { m.ciphertext[..16].try_into().unwrap() };
    let (k1, k2) = (
        message_key_and_nonce(&mk, &salt(&first)),
        message_key_and_nonce(&mk, &salt(&second)),
    );
    assert_ne!(k1[..32], k2[..32]);
    assert_ne!(k1[32..], k2[32..]);
    // Messages 0..100 in the chain were never delivered; deliver the racing pair.
    p.b.receive_with(&first, T, &mut p.draw).unwrap();
    assert_eq!(
        p.b.receive_with(&second, T, &mut p.draw),
        Err(Error::KeyUsedOrDeleted)
    );
}

/// Case 6. A deleted request's first message replayed: at t + 47 h 59 m with
/// t an hour ahead of the reader's clock, the tombstone refuses it (one
/// timed from the deletion would have expired an hour before); at
/// t + 48 h + 1 s the window refuses it, with or without the tombstone.
#[test]
fn case_06_replaying_a_deleted_request() {
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("case 6");
    let reader_now = T;
    let t = reader_now + 3600;
    let mut a = Conversation::start_with(&alice, &handle("bob", "h"), b"", t, &mut draw).unwrap();
    let first = a.send_with(b"hello", &mut draw).unwrap();
    let mut inbox = Inbox::new();
    let Received::Request { cid, .. } = inbox.receive(&bob, &first, reader_now).unwrap() else {
        panic!("a request")
    };
    assert!(inbox.delete(cid));
    let replay_at = t + 47 * 3600 + 59 * 60;
    // Deleted at t − 1 h: a tombstone from the deletion would end at t + 47 h.
    assert!(replay_at > reader_now + FIRST_CONTACT_MAX_AGE);
    assert_eq!(inbox.receive(&bob, &first, replay_at), Err(Error::Deleted));
    assert_eq!(
        inbox.receive(&bob, &first, t + FIRST_CONTACT_MAX_AGE),
        Err(Error::Deleted)
    );
    let past = t + FIRST_CONTACT_MAX_AGE + 1;
    assert_eq!(inbox.receive(&bob, &first, past), Err(Error::OutsideWindow));
    inbox.expire(past);
    assert!(inbox.tombstones().is_empty());
    assert_eq!(inbox.receive(&bob, &first, past), Err(Error::OutsideWindow));
    assert!(inbox.requests().is_empty());
}

/// Case 7. A `0x01` under a known cid with another F, even a valid one from
/// the same writer, is dropped: for a conversation and for a request, with
/// nothing changed.
#[test]
fn case_07_a_known_cid_with_another_f() {
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("case 7");
    let mut a = Conversation::start_with(&alice, &handle("bob", "h"), b"", T, &mut draw).unwrap();
    let first = a.send_with(b"one", &mut draw).unwrap();
    // A second, genuine conversation of Alice's, forced to the same cid.
    let mut again = Conversation::begin(
        &alice,
        a.first.base,
        a.responder,
        b"",
        None,
        T + 5,
        &mut Fixed(a.cid().0, Seeded::new("case 7 again")),
    )
    .unwrap();
    assert_eq!(again.cid(), a.cid());
    assert_ne!(again.first_bytes, a.first_bytes);
    let other = again.send_with(b"other F", &mut draw).unwrap();

    let mut inbox = Inbox::new();
    inbox.receive(&bob, &first, T).unwrap();
    let requests = inbox.requests().to_bytes();
    // Refused on F alone, before the request is replayed.
    KDF_CK_CALLS.with(|calls| calls.set(0));
    assert_eq!(
        inbox.receive(&bob, &other, T),
        Err(Error::DifferentFirstContact)
    );
    assert_eq!(KDF_CK_CALLS.with(|calls| calls.get()), 0);
    assert_eq!(inbox.requests().to_bytes(), requests);

    inbox.accept(&bob, a.cid()).unwrap();
    let state = inbox.conversation(a.cid()).unwrap().to_bytes();
    assert_eq!(
        inbox.receive(&bob, &other, T),
        Err(Error::DifferentFirstContact)
    );
    assert_eq!(inbox.conversation(a.cid()).unwrap().to_bytes(), state);
}

/// Draws that return a fixed cid, then defer to another source.
struct Fixed([u8; 16], Seeded);

impl Draw for Fixed {
    fn scalar(&mut self) -> Scalar {
        self.1.scalar()
    }
    fn bytes16(&mut self) -> [u8; 16] {
        self.0
    }
}

/// Case 8. A message at Nr + MAX_SKIP is read; at Nr + MAX_SKIP + 1 it's
/// refused before any key is derived. A forged huge counter with a bad tag
/// is refused the same way, and one at the bound costs at most MAX_SKIP + 1
/// chain steps on a copy. No state changes.
#[test]
fn case_08_counters_at_the_bound() {
    let mut p = pair("case 8");
    let m = opened(&p.bob, &p.a.send_with(b"m", &mut p.draw).unwrap());
    p.b.receive_with(&m, T, &mut p.draw).unwrap();
    let nr = p.b.ratchet.nr;
    skip_sends(&mut p.a, MAX_SKIP);
    let at_bound = opened(&p.bob, &p.a.send_with(b"at", &mut p.draw).unwrap());
    let over = opened(&p.bob, &p.a.send_with(b"over", &mut p.draw).unwrap());
    assert_eq!(at_bound.header.n, nr + MAX_SKIP);
    assert_eq!(over.header.n, nr + MAX_SKIP + 1);
    let before = p.b.to_bytes();

    let calls = || KDF_CK_CALLS.with(|c| c.get());
    KDF_CK_CALLS.with(|c| c.set(0));
    assert_eq!(
        p.b.receive_with(&over, T, &mut p.draw),
        Err(Error::TooFarAhead)
    );
    assert_eq!(calls(), 0);
    let mut huge = over.clone();
    huge.header.n = 4_000_000_000;
    *huge.ciphertext.last_mut().unwrap() ^= 1;
    assert_eq!(
        p.b.receive_with(&huge, T, &mut p.draw),
        Err(Error::TooFarAhead)
    );
    assert_eq!(calls(), 0);
    let mut forged = at_bound.clone();
    *forged.ciphertext.last_mut().unwrap() ^= 1;
    assert_eq!(
        p.b.receive_with(&forged, T, &mut p.draw),
        Err(Error::DecryptionFailed)
    );
    assert_eq!(calls(), u64::from(MAX_SKIP) + 1);
    assert_eq!(p.b.to_bytes(), before);

    assert_eq!(p.b.receive_with(&at_bound, T, &mut p.draw).unwrap(), b"at");
    assert_eq!(p.b.missing(), u64::from(MAX_SKIP));
}

/// Case 9. A skipped key used after its 48 hours: the message is dropped and
/// counts as missing, before and after the key is deleted.
#[test]
fn case_09_a_skipped_key_past_48_hours() {
    let mut p = pair("case 9");
    let late = p.a.send_with(b"late", &mut p.draw).unwrap();
    let next = opened(&p.bob, &p.a.send_with(b"next", &mut p.draw).unwrap());
    let mut inbox =
        Inbox::from_parts(vec![p.b.clone()], Default::default(), Default::default()).unwrap();
    let cid = p.b.cid();
    inbox.receive_opened(&p.bob, &next, T, &mut p.draw).unwrap();
    assert_eq!(inbox.conversation(cid).unwrap().missing(), 1);
    let after = T + 48 * 3600 + 1;
    assert_eq!(
        inbox.receive(&p.bob, &late, after),
        Err(Error::KeyUsedOrDeleted)
    );
    assert_eq!(inbox.conversation(cid).unwrap().missing(), 1);
    inbox.expire(after);
    assert_eq!(inbox.conversation(cid).unwrap().missing(), 1);
    assert_eq!(
        inbox.receive(&p.bob, &late, after),
        Err(Error::KeyUsedOrDeleted)
    );
}

fn stranger_writes(
    bob_handle: &Register,
    label: &str,
    text_len: usize,
    now: u64,
) -> (ConversationId, Vec<u8>) {
    let stranger = SecretKey::from_scalar(test_scalar(label)).unwrap();
    let mut draw = Seeded::new(label);
    let mut c = Conversation::start_with(&stranger, bob_handle, b"", now, &mut draw).unwrap();
    let envelope = c.send_with(&vec![b's'; text_len], &mut draw).unwrap();
    (c.cid(), envelope)
}

/// Case 10. Requests are bounded: the 51st stranger pushes out the first;
/// 256 KiB is kept and a byte more pushes out the oldest. Replying to a
/// request builds exactly the state eager processing would have.
#[test]
fn case_10_requests_are_bounded_and_replying_is_eager_processing() {
    let bob = key("bob");
    let bob_handle = handle("bob", "h");
    let mut inbox = Inbox::new();
    let mut cids = Vec::new();
    for i in 0..=MAX_REQUESTS {
        let (cid, envelope) = stranger_writes(&bob_handle, &format!("stranger {i}"), 10, T);
        let Received::Request { evicted, .. } =
            inbox.receive(&bob, &envelope, T + i as u64).unwrap()
        else {
            panic!("a request")
        };
        cids.push(cid);
        if i < MAX_REQUESTS {
            assert!(evicted.is_empty());
        } else {
            assert_eq!(evicted, vec![cids[0]]);
        }
    }
    assert_eq!(inbox.requests().len(), MAX_REQUESTS);
    assert!(inbox.requests().get(cids[0]).is_none());
    assert!(inbox.requests().get(cids[1]).is_some());

    // Bytes: eight of the largest first-contact messages and one of 1,296
    // inner bytes fill 256 KiB exactly; 1,297 is a byte over.
    let largest = 32768 - 161 - 1 - 259;
    for (last, kept) in [(1296 - 259, true), (1297 - 259, false)] {
        let mut inbox = Inbox::new();
        let mut first = None;
        for i in 0..8 {
            let (cid, envelope) = stranger_writes(&bob_handle, &format!("big {i}"), largest, T);
            inbox.receive(&bob, &envelope, T).unwrap();
            first.get_or_insert(cid);
        }
        let (_, envelope) = stranger_writes(&bob_handle, "the last", last, T);
        let Received::Request { evicted, .. } = inbox.receive(&bob, &envelope, T).unwrap() else {
            panic!("a request")
        };
        assert!(inbox.requests().stored_len() <= MAX_REQUEST_BYTES);
        if kept {
            assert_eq!(inbox.requests().stored_len(), MAX_REQUEST_BYTES);
            assert!(evicted.is_empty());
        } else {
            assert_eq!(evicted, vec![first.unwrap()]);
        }
    }

    // One request whose messages arrive out of order, one of them more
    // than 48 hours after the message that skipped its key, and one never.
    let alice = key("alice");
    let mut draw = Seeded::new("case 10 alice");
    let mut a = Conversation::start_with(&alice, &bob_handle, b"", T, &mut draw).unwrap();
    let sent: Vec<_> = (0..5)
        .map(|i| a.send_with(format!("m{i}").as_bytes(), &mut draw).unwrap())
        .collect();
    let late = T + 49 * 3600;
    let arrivals = [(3, T), (0, T + 10), (4, T + 20), (1, late)];

    let mut eager_draw = Seeded::new("case 10 same");
    let first = opened(&bob, &sent[arrivals[0].0]);
    let (mut eager, _) =
        Conversation::accept_with(&bob, &[(&first, arrivals[0].1)], &mut eager_draw).unwrap();
    let eager_results: Vec<_> = arrivals[1..]
        .iter()
        .map(|(i, at)| {
            eager
                .receive_with(&opened(&bob, &sent[*i]), *at, &mut eager_draw)
                .map(|_| ())
        })
        .collect();
    assert_eq!(
        eager_results,
        vec![Ok(()), Ok(()), Err(Error::KeyUsedOrDeleted)]
    );

    let mut inbox = Inbox::new();
    let mut auth_draw = Seeded::new("case 10 authenticate");
    let joined: Vec<_> = arrivals
        .iter()
        .map(|(i, at)| {
            inbox
                .receive_opened(&bob, &opened(&bob, &sent[*i]), *at, &mut auth_draw)
                .map(|_| ())
        })
        .collect();
    // The request refuses what the conversation would: it shows no more.
    assert_eq!(
        joined,
        vec![Ok(()), Ok(()), Ok(()), Err(Error::KeyUsedOrDeleted)]
    );
    assert_eq!(inbox.requests().get(a.cid()).unwrap().message_count(), 3);
    inbox
        .accept_with(&bob, a.cid(), &mut Seeded::new("case 10 same"))
        .unwrap();
    let lazy = inbox.conversation(a.cid()).unwrap();
    assert_eq!(*lazy.to_bytes(), *eager.to_bytes());
    // Messages 1 and 2 are missing: one came too late, one never.
    assert_eq!(lazy.missing(), 2);
}

/// Case 11. A conversation restarted with the old identities shows as
/// continuing, from either side. A fresh base with the right cid, or a
/// reader who lost the old conversation, shows only "says it continues".
/// Someone who knows the cid but not a key gets nothing at all.
#[test]
fn case_11_continuations() {
    let mut p = pair("case 11");
    let old = p.a.cid();
    let alice_inbox =
        Inbox::from_parts(vec![p.a.clone()], Default::default(), Default::default()).unwrap();
    let bob_inbox =
        Inbox::from_parts(vec![p.b.clone()], Default::default(), Default::default()).unwrap();
    let continues = |inbox: &Inbox, cid| inbox.requests().get(cid).unwrap().continues();

    // Alice restarts; Bob restarts.
    let mut by_alice = Conversation::continue_with(&p.alice, &p.a, b"", T, &mut p.draw).unwrap();
    let mut inbox = bob_inbox.clone();
    inbox
        .receive(
            &p.bob,
            &by_alice.send_with(b"again", &mut p.draw).unwrap(),
            T,
        )
        .unwrap();
    assert_eq!(
        continues(&inbox, by_alice.cid()),
        Some(Continues::Verified(old))
    );
    let mut by_bob = Conversation::continue_with(&p.bob, &p.b, b"", T, &mut p.draw).unwrap();
    let mut inbox = alice_inbox.clone();
    inbox
        .receive(
            &p.alice,
            &by_bob.send_with(b"again", &mut p.draw).unwrap(),
            T,
        )
        .unwrap();
    assert_eq!(
        continues(&inbox, by_bob.cid()),
        Some(Continues::Verified(old))
    );

    // A fresh base, the right cid: Alice wrote fresh to Bob's handle.
    let (base, w0) = base_and_w0(&handle("bob", "bob's handle"), &test_scalar("fresh"));
    let mut fresh =
        Conversation::begin(&p.alice, base, w0, b"", Some(old), T, &mut p.draw).unwrap();
    let mut inbox = bob_inbox.clone();
    inbox
        .receive(
            &p.bob,
            &fresh.send_with(b"it's me", &mut p.draw).unwrap(),
            T,
        )
        .unwrap();
    assert_eq!(
        continues(&inbox, fresh.cid()),
        Some(Continues::Unverified(old))
    );

    // Bob lost the old conversation: nothing to verify against.
    let mut inbox = Inbox::new();
    let mut again = Conversation::continue_with(&p.alice, &p.a, b"", T, &mut p.draw).unwrap();
    inbox
        .receive(&p.bob, &again.send_with(b"again", &mut p.draw).unwrap(), T)
        .unwrap();
    assert_eq!(
        continues(&inbox, again.cid()),
        Some(Continues::Unverified(old))
    );

    // Mallory learned the cid and the base, and writes on that base with her
    // own key: it reads, but the public values aren't the old ones.
    let mallory = key("mallory");
    let mut on_the_base = Conversation::begin(
        &mallory,
        p.a.first.base,
        p.a.responder,
        b"",
        Some(old),
        T,
        &mut p.draw,
    )
    .unwrap();
    let mut inbox = bob_inbox.clone();
    inbox
        .receive(
            &p.bob,
            &on_the_base.send_with(b"it's Alice", &mut p.draw).unwrap(),
            T,
        )
        .unwrap();
    assert_eq!(
        continues(&inbox, on_the_base.cid()),
        Some(Continues::Unverified(old))
    );

    // Mallory knows the cid and both identities, but neither key.
    let forgery = Forgery {
        cid: ConversationId([4; 16]),
        t: T,
        replaces: Some(old),
        base: p.a.first.base,
        initiator: p.a.first.initiator,
        responder: p.a.responder,
        static_dh: mul(&p.a.responder, &mallory.scalar()).to_compressed(),
    };
    let mut inbox = bob_inbox.clone();
    let envelope = forge(&forgery, b"continuing", &mut p.draw);
    assert_eq!(
        inbox.receive(&p.bob, &envelope, T),
        Err(Error::DecryptionFailed)
    );
    assert!(inbox.requests().is_empty());
}

/// Case 11, the base on its own. The same two public values on another base
/// are possible only for keys x and −x, on bases p₀ and −p₀; §6 still asks
/// for the old base, so that's "says it continues".
#[test]
fn case_11_a_continuation_needs_the_old_base_itself() {
    let x = test_scalar("x");
    let (alice, bob) = (
        SecretKey::from_scalar(x).unwrap(),
        SecretKey::from_scalar(-x).unwrap(),
    );
    let mut draw = Seeded::new("case 11 base");
    let mut a = Conversation::start_with(&alice, &handle_of(&bob, "h"), b"", T, &mut draw).unwrap();
    let first = opened(&bob, &a.send_with(b"hi", &mut draw).unwrap());
    let (b, _) = Conversation::accept_with(&bob, &[(&first, T)], &mut draw).unwrap();
    let old = a.cid();
    let negated = (-G1Projective::from(a.first.base)).to_affine();
    // Bob's value on −p₀ is [−x](−p₀) = [x]p₀ = A.
    let mut other_base = Conversation::begin(
        &alice,
        negated,
        a.first.initiator,
        b"",
        Some(old),
        T,
        &mut draw,
    )
    .unwrap();
    assert_eq!(other_base.first.initiator, b.responder);
    let mut inbox = Inbox::from_parts(vec![b], Default::default(), Default::default()).unwrap();
    inbox
        .receive(&bob, &other_base.send_with(b"again", &mut draw).unwrap(), T)
        .unwrap();
    assert_eq!(
        inbox.requests().get(other_base.cid()).unwrap().continues(),
        Some(Continues::Unverified(old))
    );
}

fn handle_of(key: &SecretKey, label: &str) -> Register {
    let generator = super::support::g() * test_scalar(label);
    Register::from_checked(
        generator.to_affine(),
        (generator * key.scalar()).to_affine(),
    )
}

/// Case 12. Rollback: an older copy of Alice's state sends again under
/// counters Bob already used. He drops them, and no AES-GCM key and nonce
/// repeats, though the message keys do.
#[test]
fn case_12_rollback() {
    let mut p = pair("case 12");
    let saved = p.a.clone();
    let mk = kdf_ck(saved.ratchet.cks.as_ref().unwrap()).1;
    let m1 = opened(&p.bob, &p.a.send_with(b"one", &mut p.draw).unwrap());
    let m2 = opened(&p.bob, &p.a.send_with(b"two", &mut p.draw).unwrap());
    p.b.receive_with(&m1, T, &mut p.draw).unwrap();
    p.b.receive_with(&m2, T, &mut p.draw).unwrap();

    let mut restored = saved;
    let again = opened(
        &p.bob,
        &restored.send_with(b"one, again", &mut p.draw).unwrap(),
    );
    assert_eq!(again.header, m1.header);
    let salt =
        |m: &crate::session::wire::Opened| -> [u8; 16] { m.ciphertext[..16].try_into().unwrap() };
    let (k1, k2) = (
        message_key_and_nonce(&mk, &salt(&m1)),
        message_key_and_nonce(&mk, &salt(&again)),
    );
    assert_ne!(k1[..32], k2[..32]);
    assert_ne!(k1[32..], k2[32..]);
    let before = p.b.to_bytes();
    assert_eq!(
        p.b.receive_with(&again, T, &mut p.draw),
        Err(Error::KeyUsedOrDeleted)
    );
    assert_eq!(p.b.to_bytes(), before);

    // Rolled back past a ratchet step: Alice is again before Bob's reply,
    // sending first-contact messages Bob has already read.
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("case 12 step");
    let mut a = Conversation::start_with(&alice, &handle("bob", "h"), b"", T, &mut draw).unwrap();
    let before_reply = a.clone();
    let first = opened(&bob, &a.send_with(b"hi", &mut draw).unwrap());
    let (mut b, _) = Conversation::accept_with(&bob, &[(&first, T)], &mut draw).unwrap();
    a.receive_with(
        &opened(&alice, &b.send_with(b"yo", &mut draw).unwrap()),
        T,
        &mut draw,
    )
    .unwrap();
    let mut rolled = before_reply;
    let replayed = opened(&bob, &rolled.send_with(b"hi again", &mut draw).unwrap());
    assert!(rolled.sends_first_contact());
    assert_eq!(
        b.receive_with(&replayed, T, &mut draw),
        Err(Error::KeyUsedOrDeleted)
    );
}

/// Case 13. Sizes: a first-contact message with 91 bytes of text fits 512
/// bytes and 92 don't; a session message holds 245 and not 246.
#[test]
fn case_13_sizes() {
    let alice = key("alice");
    let mut draw = Seeded::new("case 13");
    let mut a = Conversation::start_with(&alice, &handle("bob", "h"), b"", T, &mut draw).unwrap();
    assert_eq!(a.send_with(&[0; 91], &mut draw).unwrap().len(), 512);
    assert_eq!(a.send_with(&[0; 92], &mut draw).unwrap().len(), 2048);
    let mut full = Conversation::begin(
        &alice,
        a.first.base,
        a.responder,
        &[0x5e; 32],
        Some(ConversationId([5; 16])),
        T,
        &mut draw,
    )
    .unwrap();
    assert_eq!(full.send_with(&[0; 43], &mut draw).unwrap().len(), 512);
    assert_eq!(full.send_with(&[0; 44], &mut draw).unwrap().len(), 2048);
    let mut p = pair("case 13 session");
    assert_eq!(p.a.send_with(&[0; 245], &mut p.draw).unwrap().len(), 512);
    assert_eq!(p.a.send_with(&[0; 246], &mut p.draw).unwrap().len(), 2048);
    assert_eq!(p.b.send_with(&[0; 245], &mut p.draw).unwrap().len(), 512);
}

/// Case 14. Both sides write first at once: two conversations, each valid,
/// each going on without the other.
#[test]
fn case_14_both_sides_write_first() {
    let (alice, bob) = (key("alice"), key("bob"));
    let (alice_handle, bob_handle) = (handle("alice", "a"), handle("bob", "b"));
    let (mut alice_inbox, mut bob_inbox) = (Inbox::new(), Inbox::new());
    let to_bob = alice_inbox.start(&alice, &bob_handle, b"", T).unwrap();
    let to_alice = bob_inbox.start(&bob, &alice_handle, b"", T).unwrap();
    assert_ne!(to_bob, to_alice);
    let from_alice = alice_inbox.send(to_bob, b"hi Bob").unwrap();
    let from_bob = bob_inbox.send(to_alice, b"hi Alice").unwrap();
    assert!(matches!(
        bob_inbox.receive(&bob, &from_alice, T),
        Ok(Received::Request { .. })
    ));
    assert!(matches!(
        alice_inbox.receive(&alice, &from_bob, T),
        Ok(Received::Request { .. })
    ));
    bob_inbox.accept(&bob, to_bob).unwrap();
    alice_inbox.accept(&alice, to_alice).unwrap();
    // Each reader replies in the conversation written to them.
    let reply = bob_inbox.send(to_bob, b"reply").unwrap();
    assert_eq!(
        alice_inbox.receive(&alice, &reply, T).unwrap(),
        Received::Message {
            cid: to_bob,
            plaintext: b"reply".to_vec()
        }
    );
    let reply = alice_inbox.send(to_alice, b"reply").unwrap();
    assert_eq!(
        bob_inbox.receive(&bob, &reply, T).unwrap(),
        Received::Message {
            cid: to_alice,
            plaintext: b"reply".to_vec()
        }
    );
    assert_eq!(alice_inbox.conversations().count(), 2);
    assert_eq!(bob_inbox.conversations().count(), 2);
}
