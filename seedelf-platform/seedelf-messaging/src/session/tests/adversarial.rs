//! Part 4: docs/protocol-review.md §E's adversarial cases, one test each.
//! Cases 4 and 5 are about the worker's order of writes and posts, so they
//! run over a relay in tests/simulation.rs.

use blstrs::{G1Affine, G1Projective, Scalar};
use group::Curve;

use super::ratchet::pair;
use super::support::{
    HANDLE_NAME, Seeded, Stuck, handle, inbox_start, key, opened, own_handles, skip_sends, stamp,
    start, test_inbox, test_scalar,
};
use crate::HEADER_LEN;
use crate::register::{POINT_LEN, Register, rerandomize_with};
use crate::session::conversation::{Conversation, Origin, Role};
use crate::session::draw::Draw;
use crate::session::first_contact::{
    BaseProof, ConversationId, FIRST_CONTACT_MAX_AGE, FirstContact, KeysProof, KeysStatement,
    prove_base, session_key,
};
use crate::session::inbox::{
    Continues, Inbox, MAX_REQUEST_BYTES, MAX_REQUESTS, Received, TOMBSTONE_MARGIN,
};
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
    /// A's key on the base, if she knows it: then her keys proof holds, if
    /// she made the base from a handle. Without it she can't make one.
    initiator_key: Option<Scalar>,
    /// The handle and `b` she made the base from, so her proof holds, if
    /// she made it so. Without one, a forgery with no `replaces` names
    /// [`HANDLE_NAME`] with a proof she can't make, and one with `replaces`
    /// is a continuation, with no `to`.
    from_handle: Option<(Register, Scalar)>,
}

/// A first-contact envelope built from a forger's values, addressed to
/// (p₀, w₀) as she believes it, with its stamp solved. Her keys proof holds
/// when she knows what it needs: in a continuation e_A and s_A, which she
/// drew; from a handle A's key too. Otherwise it's the best she can do,
/// scalars of her choosing, which no reader takes.
fn forge(forgery: &Forgery, text: &[u8], draw: &mut dyn Draw) -> Vec<u8> {
    let e = draw.scalar();
    let s_scalar = draw.scalar();
    let s = KeyPair {
        secret: crate::session::secret::Secret32::from_bytes(s_scalar.to_bytes_be()),
        public: (G1Projective::from(forgery.base) * s_scalar).to_affine(),
    };
    let mut first = FirstContact {
        cid: forgery.cid,
        started_at: forgery.t,
        to: Vec::new(),
        replaces: forgery.replaces,
        base: forgery.base,
        initiator: forgery.initiator,
        ephemeral: (G1Projective::from(forgery.base) * e).to_affine(),
        proof: None,
        keys_proof: None,
    };
    match (&forgery.from_handle, forgery.replaces) {
        (Some((handle, b)), _) => {
            assert_eq!(base_and_w0(handle, b).0, forgery.base);
            first.to = HANDLE_NAME.to_vec();
            first.proof = Some(prove_base(handle, b, &first.prefix_bytes(), draw));
        }
        (None, None) => {
            first.to = HANDLE_NAME.to_vec();
            first.proof = Some(BaseProof {
                c1: draw.scalar(),
                c2: draw.scalar(),
                z1: draw.scalar(),
                z2: draw.scalar(),
            });
        }
        (None, Some(_)) => {}
    }
    let statement = KeysStatement::of(&first, &forgery.responder, &s.public);
    first.keys_proof = Some(match (first.to.is_empty(), forgery.initiator_key) {
        (true, _) => statement.prove_continuation(&e, &s_scalar, draw),
        (false, Some(a)) => statement.prove_handle(&a, &e, &s_scalar, draw).unwrap(),
        (false, None) => KeysProof::Handle {
            c1: draw.scalar(),
            c2: draw.scalar(),
            z1: draw.scalar(),
            z2: draw.scalar(),
            ze: draw.scalar(),
            zs: draw.scalar(),
        },
    });
    let first_bytes = first.to_bytes();
    let ephemeral_dh = (G1Projective::from(forgery.responder) * e).to_compressed();
    let sk = session_key(&ephemeral_dh, &forgery.static_dh, &first_bytes);
    let mut conversation = Conversation {
        role: Role::Initiator,
        first,
        first_bytes,
        responder: forgery.responder,
        ratchet: Ratchet::init_alice(&sk, s, forgery.responder),
        stamp: None,
        first_contact_sent: Some(0),
    };
    stamp(&mut conversation);
    conversation.send_with(text, draw).unwrap()
}

/// An inbox from conversations, asking the tests' stamp work.
fn test_parts(conversations: Vec<Conversation>) -> Inbox {
    let mut inbox =
        Inbox::from_parts(conversations, Default::default(), Default::default()).unwrap();
    inbox.set_first_contact_bits(super::support::TEST_BITS);
    inbox
}

fn mul(point: &G1Affine, scalar: &Scalar) -> G1Affine {
    (G1Projective::from(*point) * scalar).to_affine()
}

fn base_and_w0(register: &Register, b: &Scalar) -> (G1Affine, G1Affine) {
    let r = rerandomize_with(register, b);
    (r.generator().to_affine(), r.public_value().to_affine())
}

/// Case 1. Mallory names a register she doesn't control as R_A. On Bob's
/// base, even handed the true w₀, she can't make the keys proof, which needs
/// A's key or w₀'s, so Bob refuses before his key meets A, and she couldn't
/// have computed the static DH anyway: the reader never gets a session or a
/// request. On Alice's base, where A really is [x_A]p₀, her proof can only
/// show Alice's handle, so Bob refuses before any key. And the register's
/// owner sees only envelopes for a conversation they don't have.
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
    for (base, initiator, responder, from_handle, refusal) in [
        (
            base,
            claimed_a,
            w0,
            (bob_handle, test_scalar("b")),
            Error::InvalidKeysProof,
        ),
        (
            alice_base,
            alice_a,
            true_w0,
            (alice_handle, test_scalar("b'")),
            Error::InvalidBaseProof,
        ),
    ] {
        let forgery = Forgery {
            cid: ConversationId([1; 16]),
            t: T,
            replaces: None,
            base,
            initiator,
            responder,
            // Her best guess: her own key on w₀.
            static_dh: mul(&responder, &mallory.scalar()).to_compressed(),
            initiator_key: None,
            from_handle: Some(from_handle),
        };
        let envelope = forge(&forgery, b"reply to Alice's mailbox", &mut draw);
        let mut bob_inbox = test_inbox();
        assert_eq!(
            bob_inbox.receive(&bob, &own_handles(&bob), &envelope, T),
            Err(refusal)
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
        initiator_key: Some(mallory.scalar()),
        from_handle: Some((bob_handle, test_scalar("b"))),
    };
    let mut bob_inbox = test_inbox();
    assert!(matches!(
        bob_inbox.receive(
            &bob,
            &own_handles(&bob),
            &forge(&forgery, b"hi", &mut draw),
            T
        ),
        Ok(Received::Request { .. })
    ));

    // Alice, whose register was named, finds envelopes on it only as a
    // conversation she doesn't have.
    let mut alice_inbox = test_inbox();
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
        alice_inbox.receive(&alice, &own_handles(&alice), &envelope, T),
        Err(Error::UnknownConversation)
    );
    assert!(alice_inbox.requests().is_empty() && alice_inbox.conversations().next().is_none());
}

/// Case 2. An R_A lifted from another conversation: Alice wrote to Mallory,
/// and Mallory reuses Alice's R_A to write to Carol, on its own base or on
/// Carol's. Neither yields a session: on its own base, Mallory can't show
/// the base is one of Carol's handles, and on Carol's, A doesn't fit: its
/// key on that base is no one's she has, so there's no keys proof.
#[test]
fn case_02_a_lifted_r_a_is_refused() {
    let (alice, mallory, carol) = (key("alice"), key("mallory"), key("carol"));
    let mut draw = Seeded::new("case 2");
    let to_mallory = start(&alice, &handle("mallory", "m"), T, &mut draw);
    let lifted = to_mallory.initiator_register();
    let (lifted_base, lifted_a) = (to_mallory.first.base, to_mallory.first.initiator);
    assert!(crate::matches_register(&alice, &lifted));

    let carol_handle = handle("carol", "carol's handle");
    let (carol_base, carol_w0) = base_and_w0(&carol_handle, &test_scalar("b"));
    for (base, responder, from_handle, refusal) in [
        // Its own base: A fits, w₀ handed to her, but no proof she can make.
        (
            lifted_base,
            mul(&lifted_base, &carol.scalar()),
            None,
            Error::InvalidBaseProof,
        ),
        // Carol's base: A doesn't fit it.
        (
            carol_base,
            carol_w0,
            Some((carol_handle, test_scalar("b"))),
            Error::InvalidKeysProof,
        ),
    ] {
        let forgery = Forgery {
            cid: ConversationId([3; 16]),
            t: T,
            replaces: None,
            base,
            initiator: lifted_a,
            responder,
            static_dh: mul(&responder, &mallory.scalar()).to_compressed(),
            initiator_key: None,
            from_handle,
        };
        let mut carol_inbox = test_inbox();
        let envelope = forge(&forgery, b"I'm Alice", &mut draw);
        assert_eq!(
            carol_inbox.receive(&carol, &own_handles(&carol), &envelope, T),
            Err(refusal)
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
/// timed from the deletion would have expired an hour before); past t + 48 h
/// the tombstone still does, until an expiry past its 7-day margin deletes
/// it, and then the window refuses it.
#[test]
fn case_06_replaying_a_deleted_request() {
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("case 6");
    let reader_now = T;
    let t = reader_now + 3600;
    let mut a = start(&alice, &handle("bob", "h"), t, &mut draw);
    let first = a.send_with(b"hello", &mut draw).unwrap();
    let mut inbox = test_inbox();
    let Received::Request { cid, .. } = inbox
        .receive(&bob, &own_handles(&bob), &first, reader_now)
        .unwrap()
    else {
        panic!("a request")
    };
    assert!(inbox.delete(cid));
    let replay_at = t + 47 * 3600 + 59 * 60;
    // Deleted at t − 1 h: a tombstone from the deletion would end at t + 47 h.
    assert!(replay_at > reader_now + FIRST_CONTACT_MAX_AGE);
    assert_eq!(
        inbox.receive(&bob, &own_handles(&bob), &first, replay_at),
        Err(Error::Deleted)
    );
    assert_eq!(
        inbox.receive(&bob, &own_handles(&bob), &first, t + FIRST_CONTACT_MAX_AGE),
        Err(Error::Deleted)
    );
    let past = t + FIRST_CONTACT_MAX_AGE + 1;
    assert_eq!(
        inbox.receive(&bob, &own_handles(&bob), &first, past),
        Err(Error::Deleted)
    );
    inbox.expire(past);
    assert_eq!(inbox.tombstones().len(), 1);
    inbox.expire(past + TOMBSTONE_MARGIN);
    assert!(inbox.tombstones().is_empty());
    assert_eq!(
        inbox.receive(&bob, &own_handles(&bob), &first, past),
        Err(Error::OutsideWindow)
    );
    assert!(inbox.requests().is_empty());
}

/// Case 7. A `0x01` under a known cid with another F, even a valid one from
/// the same writer, is dropped: for a conversation and for a request, with
/// nothing changed.
#[test]
fn case_07_a_known_cid_with_another_f() {
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("case 7");
    let mut a = start(&alice, &handle("bob", "h"), T, &mut draw);
    let first = a.send_with(b"one", &mut draw).unwrap();
    // A second, genuine conversation of Alice's, forced to the same cid.
    let bob_handle = handle("bob", "h");
    let mut again = Conversation::begin(
        &alice,
        Origin::Handle(&bob_handle),
        HANDLE_NAME,
        None,
        T + 5,
        &mut Fixed(a.cid().0, Seeded::new("case 7 again")),
    )
    .unwrap();
    stamp(&mut again);
    assert_eq!(again.cid(), a.cid());
    assert_ne!(again.first_bytes, a.first_bytes);
    let other = again.send_with(b"other F", &mut draw).unwrap();

    let mut inbox = test_inbox();
    inbox.receive(&bob, &own_handles(&bob), &first, T).unwrap();
    let requests = inbox.requests().to_bytes();
    // Refused on F alone, before the request is replayed.
    KDF_CK_CALLS.with(|calls| calls.set(0));
    assert_eq!(
        inbox.receive(&bob, &own_handles(&bob), &other, T),
        Err(Error::DifferentFirstContact)
    );
    assert_eq!(KDF_CK_CALLS.with(|calls| calls.get()), 0);
    assert_eq!(inbox.requests().to_bytes(), requests);

    inbox.accept(&bob, a.cid()).unwrap();
    let state = inbox.conversation(a.cid()).unwrap().to_bytes();
    assert_eq!(
        inbox.receive(&bob, &own_handles(&bob), &other, T),
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
    fn bytes32(&mut self) -> [u8; 32] {
        self.1.bytes32()
    }
}

/// Case 8. A message at Nr + MAX_SKIP is read; at Nr + MAX_SKIP + 1 it's
/// refused as too far ahead, after its chain is stepped on a copy to show it
/// authenticates, with nothing stored (part 7). A forged huge counter is
/// refused as a forgery with nothing derived, and a forgery at the bound
/// costs at most MAX_SKIP + 1 chain steps on a copy. No state changes.
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
    let reset = || KDF_CK_CALLS.with(|c| c.set(0));
    reset();
    assert_eq!(
        p.b.receive_with(&over, T, &mut p.draw),
        Err(Error::TooFarAhead)
    );
    assert_eq!(calls(), u64::from(MAX_SKIP) + 2);
    let mut huge = over.clone();
    huge.header.n = 4_000_000_000;
    *huge.ciphertext.last_mut().unwrap() ^= 1;
    reset();
    assert_eq!(
        p.b.receive_with(&huge, T, &mut p.draw),
        Err(Error::DecryptionFailed)
    );
    assert_eq!(calls(), 0);
    let mut forged = at_bound.clone();
    *forged.ciphertext.last_mut().unwrap() ^= 1;
    reset();
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
    let mut inbox = test_parts(vec![p.b.clone()]);
    let cid = p.b.cid();
    inbox
        .receive_opened(&p.bob, &own_handles(&p.bob), &next, T, &mut p.draw)
        .unwrap();
    assert_eq!(inbox.conversation(cid).unwrap().missing(), 1);
    let after = T + 48 * 3600 + 1;
    assert_eq!(
        inbox.receive(&p.bob, &own_handles(&p.bob), &late, after),
        Err(Error::KeyUsedOrDeleted)
    );
    assert_eq!(inbox.conversation(cid).unwrap().missing(), 1);
    inbox.expire(after);
    assert_eq!(inbox.conversation(cid).unwrap().missing(), 1);
    assert_eq!(
        inbox.receive(&p.bob, &own_handles(&p.bob), &late, after),
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
    let mut c = start(&stranger, bob_handle, now, &mut draw);
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
    let mut inbox = test_inbox();
    let mut cids = Vec::new();
    for i in 0..=MAX_REQUESTS {
        let (cid, envelope) = stranger_writes(&bob_handle, &format!("stranger {i}"), 10, T);
        let Received::Request { evicted, .. } = inbox
            .receive(&bob, &own_handles(&bob), &envelope, T + i as u64)
            .unwrap()
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

    // Bytes: eight of the largest first-contact messages, 32,622 inner bytes
    // each, and one of 1,168 inner bytes fill 256 KiB exactly; 1,169 is a
    // byte over. A first-contact message here adds 607 bytes to its text: the
    // type, F (510, with the tests' 20-byte `to` and both proofs), the stamp,
    // the header, the salt and the tag.
    let overhead = 1 + 510 + 8 + 56 + 32;
    let largest_inner = 32768 - crate::ENVELOPE_OVERHEAD - 1;
    assert_eq!(largest_inner, 32_622);
    let largest = largest_inner - overhead;
    let room = MAX_REQUEST_BYTES - 8 * largest_inner;
    assert_eq!(room, 1168);
    for (last, kept) in [(room - overhead, true), (room + 1 - overhead, false)] {
        let mut inbox = test_inbox();
        let mut first = None;
        for i in 0..8 {
            let (cid, envelope) = stranger_writes(&bob_handle, &format!("big {i}"), largest, T);
            inbox
                .receive(&bob, &own_handles(&bob), &envelope, T)
                .unwrap();
            first.get_or_insert(cid);
        }
        let (_, envelope) = stranger_writes(&bob_handle, "the last", last, T);
        let Received::Request { evicted, .. } = inbox
            .receive(&bob, &own_handles(&bob), &envelope, T)
            .unwrap()
        else {
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
    let mut a = start(&alice, &bob_handle, T, &mut draw);
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

    let mut inbox = test_inbox();
    let mut auth_draw = Seeded::new("case 10 authenticate");
    let joined: Vec<_> = arrivals
        .iter()
        .map(|(i, at)| {
            inbox
                .receive_opened(
                    &bob,
                    &own_handles(&bob),
                    &opened(&bob, &sent[*i]),
                    *at,
                    &mut auth_draw,
                )
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
/// continuing, from either side. A fresh start from the handle with the
/// right cid shows only "says it continues". Without a handle, a reader who
/// lost the old conversation, or anyone with the cid and the base but other
/// keys, gets nothing: only a verified continuation may come without a
/// handle. Someone who knows the cid and both identities but no key gets
/// nothing either.
#[test]
fn case_11_continuations() {
    let mut p = pair("case 11");
    let old = p.a.cid();
    let alice_inbox = test_parts(vec![p.a.clone()]);
    let bob_inbox = test_parts(vec![p.b.clone()]);
    let continues = |inbox: &Inbox, cid| inbox.requests().get(cid).unwrap().continues();

    // Alice restarts; Bob restarts.
    let mut by_alice = Conversation::continue_with(&p.alice, &p.a, T, &mut p.draw).unwrap();
    stamp(&mut by_alice);
    let mut inbox = bob_inbox.clone();
    inbox
        .receive(
            &p.bob,
            &own_handles(&p.bob),
            &by_alice.send_with(b"again", &mut p.draw).unwrap(),
            T,
        )
        .unwrap();
    assert_eq!(
        continues(&inbox, by_alice.cid()),
        Some(Continues::Verified(old))
    );
    let mut by_bob = Conversation::continue_with(&p.bob, &p.b, T, &mut p.draw).unwrap();
    stamp(&mut by_bob);
    let mut inbox = alice_inbox.clone();
    inbox
        .receive(
            &p.alice,
            &own_handles(&p.alice),
            &by_bob.send_with(b"again", &mut p.draw).unwrap(),
            T,
        )
        .unwrap();
    assert_eq!(
        continues(&inbox, by_bob.cid()),
        Some(Continues::Verified(old))
    );

    // A fresh base, the right cid: Alice wrote fresh to Bob's handle.
    let bob_handle = handle("bob", "bob's handle");
    let mut fresh = Conversation::begin(
        &p.alice,
        Origin::Handle(&bob_handle),
        HANDLE_NAME,
        Some(old),
        T,
        &mut p.draw,
    )
    .unwrap();
    stamp(&mut fresh);
    let mut inbox = bob_inbox.clone();
    inbox
        .receive(
            &p.bob,
            &own_handles(&p.bob),
            &fresh.send_with(b"it's me", &mut p.draw).unwrap(),
            T,
        )
        .unwrap();
    assert_eq!(
        continues(&inbox, fresh.cid()),
        Some(Continues::Unverified(old))
    );

    // Bob lost the old conversation: nothing to verify against, and no
    // handle, so nothing at all.
    let mut inbox = test_inbox();
    let mut again = Conversation::continue_with(&p.alice, &p.a, T, &mut p.draw).unwrap();
    stamp(&mut again);
    assert_eq!(
        inbox.receive(
            &p.bob,
            &own_handles(&p.bob),
            &again.send_with(b"again", &mut p.draw).unwrap(),
            T
        ),
        Err(Error::UnverifiedContinuation)
    );
    assert!(inbox.requests().is_empty());

    // Mallory learned the cid and the base, and writes on that base with her
    // own key: the public values aren't the old ones, and she has no proof
    // that the base is one of Bob's handles.
    let mallory = key("mallory");
    let mut on_the_base = Conversation::begin(
        &mallory,
        Origin::Base {
            base: p.a.first.base,
            responder: p.a.responder,
        },
        b"",
        Some(old),
        T,
        &mut p.draw,
    )
    .unwrap();
    stamp(&mut on_the_base);
    let mut inbox = bob_inbox.clone();
    assert_eq!(
        inbox.receive(
            &p.bob,
            &own_handles(&p.bob),
            &on_the_base.send_with(b"it's Alice", &mut p.draw).unwrap(),
            T
        ),
        Err(Error::UnverifiedContinuation)
    );
    assert!(inbox.requests().is_empty());

    // Mallory knows the cid and both identities, but neither key.
    let forgery = Forgery {
        cid: ConversationId([4; 16]),
        t: T,
        replaces: Some(old),
        base: p.a.first.base,
        initiator: p.a.first.initiator,
        responder: p.a.responder,
        static_dh: mul(&p.a.responder, &mallory.scalar()).to_compressed(),
        initiator_key: None,
        from_handle: None,
    };
    let mut inbox = bob_inbox.clone();
    let envelope = forge(&forgery, b"continuing", &mut p.draw);
    assert_eq!(
        inbox.receive(&p.bob, &own_handles(&p.bob), &envelope, T),
        Err(Error::DecryptionFailed)
    );
    assert!(inbox.requests().is_empty());
}

/// Case 11, the base on its own. The same two public values on another base
/// are possible only for keys x and −x, on bases p₀ and −p₀; §6 still asks
/// for the old base, so that's not a verified continuation, and without a
/// handle it's refused.
#[test]
fn case_11_a_continuation_needs_the_old_base_itself() {
    let x = test_scalar("x");
    let (alice, bob) = (
        SecretKey::from_scalar(x).unwrap(),
        SecretKey::from_scalar(-x).unwrap(),
    );
    let mut draw = Seeded::new("case 11 base");
    let mut a = start(&alice, &handle_of(&bob, "h"), T, &mut draw);
    let first = opened(&bob, &a.send_with(b"hi", &mut draw).unwrap());
    let (b, _) = Conversation::accept_with(&bob, &[(&first, T)], &mut draw).unwrap();
    let old = a.cid();
    let negated = (-G1Projective::from(a.first.base)).to_affine();
    // Bob's value on −p₀ is [−x](−p₀) = [x]p₀ = A.
    let mut other_base = Conversation::begin(
        &alice,
        Origin::Base {
            base: negated,
            responder: a.first.initiator,
        },
        b"",
        Some(old),
        T,
        &mut draw,
    )
    .unwrap();
    stamp(&mut other_base);
    assert_eq!(other_base.first.initiator, b.responder);
    let mut inbox = Inbox::from_parts(vec![b], Default::default(), Default::default()).unwrap();
    inbox.set_first_contact_bits(super::support::TEST_BITS);
    assert_eq!(
        inbox.receive(
            &bob,
            &own_handles(&bob),
            &other_base.send_with(b"again", &mut draw).unwrap(),
            T
        ),
        Err(Error::UnverifiedContinuation)
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
/// repeats, though the message keys do: not the ratchet's, and not the
/// envelope's, whose p and c come from the message key and the fresh salt.
/// The salt is a send's only fresh value, so a source that repeats it too (a
/// second fault) repeats the whole envelope header (protocol.md §4.2).
#[test]
fn case_12_rollback() {
    let mut p = pair("case 12");
    let saved = p.a.clone();
    let mk = kdf_ck(saved.ratchet.cks.as_ref().unwrap()).1;
    let e1 = p.a.send_with(b"one", &mut p.draw).unwrap();
    let m1 = opened(&p.bob, &e1);
    let m2 = opened(&p.bob, &p.a.send_with(b"two", &mut p.draw).unwrap());
    p.b.receive_with(&m1, T, &mut p.draw).unwrap();
    p.b.receive_with(&m2, T, &mut p.draw).unwrap();

    let mut restored = saved.clone();
    let e_again = restored.send_with(b"one, again", &mut p.draw).unwrap();
    let again = opened(&p.bob, &e_again);
    assert_eq!(again.header, m1.header);
    let salt =
        |m: &crate::session::wire::Opened| -> [u8; 16] { m.ciphertext[..16].try_into().unwrap() };
    let (k1, k2) = (
        message_key_and_nonce(&mk, &salt(&m1)),
        message_key_and_nonce(&mk, &salt(&again)),
    );
    assert_ne!(k1[..32], k2[..32]);
    assert_ne!(k1[32..], k2[32..]);
    // The envelope: another p, another c, so another outer key.
    let c_at = HEADER_LEN - POINT_LEN;
    assert_ne!(e1[1..1 + POINT_LEN], e_again[1..1 + POINT_LEN]);
    assert_ne!(e1[c_at..HEADER_LEN], e_again[c_at..HEADER_LEN]);
    // The second fault: the same message key and the same salt give the same
    // p, tag and c, a limit protocol.md §4.2 states, not a property to keep.
    let mut aux = [0u8; 32];
    aux[..16].copy_from_slice(&salt(&m1));
    let mut stuck = Stuck {
        scalar: test_scalar("case 12 stuck"),
        aux,
    };
    let mut twice = saved;
    let e_twice = twice.send_with(b"one, twice", &mut stuck).unwrap();
    assert_eq!(e_twice[..HEADER_LEN], e1[..HEADER_LEN]);
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
    let mut a = start(&alice, &handle("bob", "h"), T, &mut draw);
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

/// Case 13. Sizes (docs/protocol.md §9). No first-contact message fits 512
/// bytes, a continuation's included: F's two proofs leave no room. In 2,048
/// bytes one from a handle under a 1-byte `to` holds 1,314 bytes of text and
/// not 1,315; one to a Seedelf's 32-byte name with a `replaces` (F at its
/// largest, 538) holds 1,267 and not 1,268; a continuation (F of 282) holds
/// 1,523 and not 1,524. No session message is 512 bytes either: each side's
/// is padded to its first-contact form's size, so where F is 510 bytes,
/// 1,295 bytes of text fill 2,048 bytes and 1,296 don't.
#[test]
fn case_13_sizes() {
    let alice = key("alice");
    let bob_handle = handle("bob", "h");
    let mut draw = Seeded::new("case 13");
    let mut a = Conversation::start_with(&alice, &bob_handle, b"b", T, &mut draw).unwrap();
    stamp(&mut a);
    assert_eq!(a.first_bytes.len(), 491);
    assert_eq!(a.send_with(b"", &mut draw).unwrap().len(), 2048);
    assert_eq!(a.send_with(&[0; 1314], &mut draw).unwrap().len(), 2048);
    assert_eq!(a.send_with(&[0; 1315], &mut draw).unwrap().len(), 8192);
    let mut full = Conversation::begin(
        &alice,
        Origin::Handle(&bob_handle),
        &[0x5e; 32],
        Some(ConversationId([5; 16])),
        T,
        &mut draw,
    )
    .unwrap();
    stamp(&mut full);
    assert_eq!(full.first_bytes.len(), 538);
    assert_eq!(full.send_with(b"", &mut draw).unwrap().len(), 2048);
    assert_eq!(full.send_with(&[0; 1267], &mut draw).unwrap().len(), 2048);
    assert_eq!(full.send_with(&[0; 1268], &mut draw).unwrap().len(), 8192);
    let mut p = pair("case 13 session");
    let mut again = Conversation::continue_with(&p.alice, &p.a, T, &mut draw).unwrap();
    stamp(&mut again);
    assert_eq!(again.first_bytes.len(), 282);
    assert_eq!(again.send_with(b"", &mut draw).unwrap().len(), 2048);
    assert_eq!(again.send_with(&[0; 1523], &mut draw).unwrap().len(), 2048);
    assert_eq!(again.send_with(&[0; 1524], &mut draw).unwrap().len(), 8192);
    assert_eq!(p.a.first_bytes.len(), 510);
    for side in [&mut p.a, &mut p.b] {
        assert_eq!(side.send_with(b"", &mut p.draw).unwrap().len(), 2048);
        assert_eq!(side.send_with(&[0; 1295], &mut p.draw).unwrap().len(), 2048);
        assert_eq!(side.send_with(&[0; 1296], &mut p.draw).unwrap().len(), 8192);
    }
}

/// Case 14. Both sides write first at once: two conversations, each valid,
/// each going on without the other.
#[test]
fn case_14_both_sides_write_first() {
    let (alice, bob) = (key("alice"), key("bob"));
    let (alice_handle, bob_handle) = (handle("alice", "a"), handle("bob", "b"));
    let (mut alice_inbox, mut bob_inbox) = (test_inbox(), test_inbox());
    let to_bob = inbox_start(&mut alice_inbox, &alice, &bob_handle, T);
    let to_alice = inbox_start(&mut bob_inbox, &bob, &alice_handle, T);
    assert_ne!(to_bob, to_alice);
    let from_alice = alice_inbox.send(to_bob, b"hi Bob").unwrap();
    let from_bob = bob_inbox.send(to_alice, b"hi Alice").unwrap();
    assert!(matches!(
        bob_inbox.receive(&bob, &own_handles(&bob), &from_alice, T),
        Ok(Received::Request { .. })
    ));
    assert!(matches!(
        alice_inbox.receive(&alice, &own_handles(&alice), &from_bob, T),
        Ok(Received::Request { .. })
    ));
    bob_inbox.accept(&bob, to_bob).unwrap();
    alice_inbox.accept(&alice, to_alice).unwrap();
    // Each reader replies in the conversation written to them.
    let reply = bob_inbox.send(to_bob, b"reply").unwrap();
    assert_eq!(
        alice_inbox
            .receive(&alice, &own_handles(&alice), &reply, T)
            .unwrap(),
        Received::Message {
            cid: to_bob,
            plaintext: b"reply".to_vec()
        }
    );
    let reply = alice_inbox.send(to_alice, b"reply").unwrap();
    assert_eq!(
        bob_inbox
            .receive(&bob, &own_handles(&bob), &reply, T)
            .unwrap(),
        Received::Message {
            cid: to_alice,
            plaintext: b"reply".to_vec()
        }
    );
    assert_eq!(alice_inbox.conversations().count(), 2);
    assert_eq!(bob_inbox.conversations().count(), 2);
}
