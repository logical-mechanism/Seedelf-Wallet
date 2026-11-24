//! Part 6: the 1.10.0 gate review's protocol change (docs/protocol.md §3,
//! §16.2; docs/joint-security.md, use 10). The keys proof, which binds E_A,
//! A and the header key S_A before the reader's key meets them; the base
//! proof's designated verifier; and the rule that every message of a request
//! shares the first's header key. Each probe here was taken, or read, before
//! the change: a reply then told the writer the probed register was the
//! reader's.

use blstrs::{G1Affine, G1Projective, Scalar};
use ff::Field;
use group::Curve;
use group::prime::PrimeCurveAffine;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use super::support::{
    HANDLE_NAME, Seeded, g, handle, handles, key, opened, stamp, start, test_bytes16, test_inbox,
    test_scalar,
};
use crate::keys::scalar_mod_q;
use crate::register::{Register, matches_register, rerandomize_with};
use crate::session::conversation::{Conversation, Origin, Role};
use crate::session::draw::{Draw, hedge};
use crate::session::first_contact::{
    BaseProof, ConversationId, FirstContact, KEYS_NONCE_A_LABEL, KEYS_NONCE_E_LABEL,
    KEYS_NONCE_S_LABEL, KeysCommitments, KeysProof, KeysStatement, base_challenge,
    base_commitments, base_nonce_message, base_scalar, base_scalar_message, head_bytes, prove_base,
    prove_base_with, session_key,
};
use crate::session::inbox::{Inbox, REQUESTS_VERSION, Received, Requests};
use crate::session::ratchet::{Header, KeyPair, Ratchet, kdf_rk};
use crate::session::secret::Secret32;
use crate::session::wire::{Opened, Outer};
use crate::{Error, SecretKey};

const T: u64 = 1_800_000_000;

fn sum(one: &Register, two: &Register) -> Register {
    Register::from_checked(
        (one.generator() + two.generator()).to_affine(),
        (one.public_value() + two.public_value()).to_affine(),
    )
}

/// What a probe of `reader`'s key goes on: another register of that key, the
/// sum of two, and a stranger's.
fn targets(reader: &str) -> [(&'static str, Register); 3] {
    [
        ("another register of the reader's", handle(reader, "two")),
        (
            "the sum of two of the reader's",
            sum(&handle(reader, "three"), &handle(reader, "four")),
        ),
        ("a stranger's", handle("carol", "c")),
    ]
}

/// `Conversation::begin` from a handle, with one of E_A, A or S_A on
/// `probe`'s generator and its Diffie–Hellman value from `probe`'s public
/// value: right exactly when `probe` is a register of the reader's key. The
/// base and its proof are honest.
///
/// The keys proof is the best the writer can make. She has no discrete log
/// on p₀ of the point she moved: for E_A the prover's own steps with the key
/// she has on the other generator; for A the prover refuses her, so it's the
/// honest A's proof, which F no longer carries; for S_A the honest S_A's,
/// since the header key isn't in F.
fn start_probing(alice: &SecretKey, to: &Register, probe: &Register, which: &str) -> Conversation {
    let mut draw = Seeded::new(&format!("probe {which}"));
    let cid = ConversationId(draw.bytes16());
    let x = alice.scalar();
    let b = base_scalar(&x, to, &head_bytes(&cid, T, HANDLE_NAME, None), &mut draw);
    let rb = rerandomize_with(to, &b);
    let (base, responder) = (rb.generator().to_affine(), rb.public_value().to_affine());
    let (p0, w0) = (G1Projective::from(base), G1Projective::from(responder));
    let (e, s, a) = (
        test_scalar("probe e"),
        test_scalar("probe s"),
        test_scalar("probe a"),
    );
    let honest_ratchet = (p0 * s).to_affine();
    let mut first = FirstContact {
        cid,
        started_at: T,
        to: HANDLE_NAME.to_vec(),
        replaces: None,
        base,
        initiator: (p0 * x).to_affine(),
        ephemeral: (p0 * e).to_affine(),
        proof: None,
        keys_proof: None,
    };
    let mut ratchet_public = honest_ratchet;
    let mut ephemeral_dh = Zeroizing::new((w0 * e).to_compressed());
    let mut static_dh = Zeroizing::new((w0 * x).to_compressed());
    let mut init_dh = Zeroizing::new((w0 * s).to_compressed());
    match which {
        "E_A" => {
            first.ephemeral = (probe.generator() * e).to_affine();
            ephemeral_dh = Zeroizing::new((probe.public_value() * e).to_compressed());
        }
        "A" => {
            first.initiator = (probe.generator() * a).to_affine();
            static_dh = Zeroizing::new((probe.public_value() * a).to_compressed());
        }
        "S_A" => {
            ratchet_public = (probe.generator() * s).to_affine();
            init_dh = Zeroizing::new((probe.public_value() * s).to_compressed());
        }
        _ => unreachable!(),
    }
    first.proof = Some(prove_base(to, &b, &first.prefix_bytes(), &mut draw));
    let statement = KeysStatement::of(&first, &responder, &honest_ratchet);
    first.keys_proof = Some(match statement.prove_handle(&x, &e, &s, &mut draw) {
        Ok(proof) => proof,
        Err(refusal) => {
            assert_eq!((which, refusal), ("A", Error::NotForThisKey));
            let mut honest = first.clone();
            honest.initiator = (p0 * x).to_affine();
            KeysStatement::of(&honest, &responder, &honest_ratchet)
                .prove_handle(&x, &e, &s, &mut draw)
                .unwrap()
        }
    });
    let first_bytes = first.to_bytes();
    let sk = session_key(&ephemeral_dh, &static_dh, &first_bytes);
    let (rk, cks) = kdf_rk(&sk, &init_dh);
    let mut conversation = Conversation {
        role: Role::Initiator,
        first,
        first_bytes,
        responder,
        ratchet: Ratchet {
            rk,
            cks: Some(cks),
            ckr: None,
            dhs: KeyPair {
                secret: Secret32::from_bytes(s.to_bytes_be()),
                public: ratchet_public,
            },
            dhr: Some(responder),
            ns: 0,
            nr: 0,
            pn: 0,
            skipped: Vec::new(),
            lost: 0,
        },
        stamp: None,
        first_contact_sent: Some(0),
    };
    stamp(&mut conversation);
    conversation
}

/// A requests' record (docs/protocol.md §16.5) of one request holding
/// `messages`, each arrived at T: what the wallet's sealed store would hold.
fn request_record(messages: &[&[u8]]) -> Vec<u8> {
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

/// `conversation`, still before a reply, with its next first-contact
/// messages on the header key `[m]g′` for `probe` = (g′, v′) and their chain
/// from `[m]v′`: what its writer sends to learn whether `probe` is the
/// reader's. `e` is its session ephemeral's key.
fn on_another_header_key(
    conversation: &Conversation,
    e: &Scalar,
    x: &Scalar,
    probe: &Register,
) -> Conversation {
    let w0 = G1Projective::from(conversation.responder);
    let sk = session_key(
        &(w0 * e).to_compressed(),
        &(w0 * x).to_compressed(),
        &conversation.first_bytes,
    );
    let m = test_scalar("another header key");
    let mut moved = conversation.clone();
    let (rk, cks) = kdf_rk(&sk, &(probe.public_value() * m).to_compressed());
    moved.ratchet.rk = rk;
    moved.ratchet.cks = Some(cks);
    moved.ratchet.ns = 0;
    moved.ratchet.dhs = KeyPair {
        secret: Secret32::from_bytes(m.to_bytes_be()),
        public: (probe.generator() * m).to_affine(),
    };
    moved
}

/// E_A, A or S_A on another register of the reader's key, or on the sum of
/// two, is refused as one on a stranger's is, with nothing kept and every
/// record as it was, on every path that builds a responder's state: a new
/// cid's first message, a join, `Request::read` and `Inbox::accept` of a
/// stored request. Before the keys proof, the first two targets were taken
/// at a new cid and the stranger's refused: a DDH bit on the reader's key.
#[test]
fn e_a_a_and_s_a_on_another_register_are_refused_on_every_path() {
    let (alice, bob) = (key("alice"), key("bob"));
    let one = handle("bob", "one");
    let mine = handles(&[one]);
    for which in ["E_A", "A", "S_A"] {
        for (label, target) in targets("bob") {
            let path = |p: &str| format!("{which} on {label}, {p}");
            // A new cid's first message.
            let mut probing = start_probing(&alice, &one, &target, which);
            let envelope = probing.send(b"is it you?").unwrap();
            let mut inbox = test_inbox();
            assert_eq!(
                inbox.receive(&bob, &mine, &envelope, T),
                Err(Error::InvalidKeysProof),
                "{}",
                path("a new cid")
            );
            assert!(inbox.requests().is_empty());

            // Stored, alone, as a request: what `Request::read` and
            // `Inbox::accept` replay without its envelope.
            let inner = opened(&bob, &envelope).bytes;
            let record = request_record(&[&inner]);
            let requests = Requests::from_bytes(&record).unwrap();
            let request = requests.iter().next().unwrap();
            assert_eq!(
                request.read(&bob),
                Err(Error::InvalidKeysProof),
                "{}",
                path("Request::read")
            );
            let mut stored =
                Inbox::from_parts(Vec::new(), requests.clone(), Default::default()).unwrap();
            assert_eq!(
                stored.accept(&bob, probing.cid()),
                Err(Error::InvalidKeysProof),
                "{}",
                path("Inbox::accept")
            );
            assert_eq!(stored.requests().to_bytes(), record);
            assert!(stored.conversation(probing.cid()).is_none());
        }
    }

    // A join: a later first-contact message of an honest request. Its F must
    // be the stored one byte for byte, so E_A and A can move only by
    // changing F; S_A moves in the header.
    let mut draw = Seeded::new("probe join");
    let mut honest = start(&alice, &one, T, &mut draw);
    let e = crate::keys::scalar_from_bytes(&draw.drain()[2].clone().try_into().unwrap()).unwrap();
    let first = honest.send_with(b"hello", &mut draw).unwrap();
    for (label, target) in targets("bob") {
        let mut inbox = test_inbox();
        assert!(matches!(
            inbox.receive(&bob, &mine, &first, T),
            Ok(Received::Request { new: true, .. })
        ));
        let before = inbox.requests().to_bytes();
        let mut moved = on_another_header_key(&honest, &e, &alice.scalar(), &target);
        let join = moved.send_with(b"is it you?", &mut draw).unwrap();
        assert_eq!(
            inbox.receive(&bob, &mine, &join, T),
            Err(Error::InvalidKeysProof),
            "S_A on {label}, a join"
        );
        for moved_point in ["E_A", "A"] {
            let mut other = honest.clone();
            let point = (target.generator() * test_scalar("moved")).to_affine();
            match moved_point {
                "E_A" => other.first.ephemeral = point,
                _ => other.first.initiator = point,
            }
            other.first_bytes = other.first.to_bytes();
            let join = other.send_with(b"is it you?", &mut draw).unwrap();
            assert_eq!(
                inbox.receive(&bob, &mine, &join, T),
                Err(Error::DifferentFirstContact),
                "{moved_point} on {label}, a join"
            );
        }
        assert_eq!(inbox.requests().to_bytes(), before);
        // The honest request still takes its own next message.
        let next = honest.clone().send_with(b"still me", &mut draw).unwrap();
        assert!(matches!(
            inbox.receive(&bob, &mine, &next, T),
            Ok(Received::Request { new: false, .. })
        ));
    }
}

/// The gate review's v2-delta probe: a stored request whose first message
/// fails and whose second's header key is on another register. While no
/// message has authenticated, the scratch state's ratchet key is x, so the
/// second would meet it: before this change it read exactly when that
/// register was the reader's. The parser now refuses such a record, and
/// `accept_with` refuses such messages however they come.
#[test]
fn a_stored_request_whose_first_message_fails_never_raises_x_to_another_header_key() {
    let (mallory, bob) = (key("mallory"), key("bob"));
    let hb = handle("bob", "h");
    let mut draw = Seeded::new("stored probe");
    let mut writer = start(&mallory, &hb, T, &mut draw);
    let e = crate::keys::scalar_from_bytes(&draw.drain()[2].clone().try_into().unwrap()).unwrap();
    let honest_inner = opened(&bob, &writer.send_with(b"hello", &mut draw).unwrap()).bytes;
    // messages[0]: the honest F and header, a ciphertext that fails.
    let mut junk = honest_inner.clone();
    let tail = junk.len() - 16;
    junk[tail] ^= 1;
    for (label, target) in [
        ("the reader's root register", bob.register()),
        ("another register of the reader's", handle("bob", "two")),
        ("a stranger's", handle("carol", "c")),
    ] {
        let mut moved = on_another_header_key(&writer, &e, &mallory.scalar(), &target);
        // N = 1 beside the first message's 0, so the record is refused for
        // its header key alone, not for an N held twice.
        moved.ratchet.ns = 1;
        let second = opened(&bob, &moved.send_with(b"you hold it", &mut draw).unwrap()).bytes;
        assert_eq!(
            Requests::from_bytes(&request_record(&[&junk, &second])).err(),
            Some(Error::InvalidState),
            "{label}"
        );
        assert_eq!(
            Requests::from_bytes(&request_record(&[&honest_inner, &second])).err(),
            Some(Error::InvalidState),
            "{label}, after an honest first message"
        );
        // However they reach it, accept_with takes no message on another
        // header key: it refuses before the key meets anything but p₀.
        let parse = |bytes: &[u8]| Opened::parse(bytes, Outer::Checked).unwrap();
        let (m0, m1) = (parse(&junk), parse(&second));
        assert_eq!(
            Conversation::accept_with(&bob, &[(&m0, T), (&m1, T)], &mut draw).err(),
            Some(Error::InvalidKeysProof),
            "{label}"
        );
        // Alone, its keys proof is for another header key.
        assert_eq!(
            Conversation::accept_with(&bob, &[(&m1, T)], &mut draw).err(),
            Some(Error::InvalidKeysProof),
            "{label}"
        );
    }
    // The record of the honest message alone reads.
    let requests = Requests::from_bytes(&request_record(&[&honest_inner])).unwrap();
    assert_eq!(
        requests.iter().next().unwrap().read(&bob).unwrap(),
        vec![Ok(b"hello".to_vec())]
    );
}

/// A first-contact message whose header carries another key than the one
/// its keys proof proves is refused before any key but w₀ is computed, even
/// a key on p₀ whose log the writer knows.
#[test]
fn a_first_contact_message_on_another_header_key_is_refused() {
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("another header key");
    let mut a = start(&alice, &handle("bob", "h"), T, &mut draw);
    let honest = opened(&bob, &a.send_with(b"hi", &mut draw).unwrap());
    let p0 = G1Projective::from(a.first.base);
    for other in [
        (p0 * test_scalar("a key on p0")).to_affine(),
        (g() * test_scalar("a key elsewhere")).to_affine(),
    ] {
        let mut moved = honest.clone();
        moved.header = Header {
            dh: other,
            ..honest.header
        };
        assert_eq!(
            Conversation::accept_with(&bob, &[(&moved, T)], &mut draw).err(),
            Some(Error::InvalidKeysProof)
        );
    }
    assert!(Conversation::accept_with(&bob, &[(&honest, T)], &mut draw).is_ok());
}

/// Use 10 is made only from a handle, by `Conversation::begin` with
/// `Origin::Handle`, and only for the A it computed itself: the prover
/// refuses any other A, since its response would give `[x]p₀` away. A
/// continuation's proof is of e_A and s_A alone.
#[test]
fn the_keys_proof_is_made_only_from_a_handle_and_only_for_begins_a() {
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("made only");
    let a = start(&alice, &handle("bob", "h"), T, &mut draw);
    assert!(matches!(a.first.keys_proof, Some(KeysProof::Handle { .. })));
    let reader_w0 = (G1Projective::from(a.first.base) * bob.scalar()).to_affine();
    assert!(a.first.proves_keys(&reader_w0, &a.ratchet.dhs.public));
    for continuing in [
        Conversation::continue_with(&alice, &a, T, &mut draw).unwrap(),
        Conversation::begin(
            &alice,
            Origin::Base {
                base: a.first.base,
                responder: a.responder,
            },
            b"",
            Some(a.cid()),
            T,
            &mut draw,
        )
        .unwrap(),
    ] {
        assert!(matches!(
            continuing.first.keys_proof,
            Some(KeysProof::Continuation { .. })
        ));
        assert!(
            continuing
                .first
                .proves_keys(&reader_w0, &continuing.ratchet.dhs.public)
        );
    }
    // An A that isn't [x]p₀: refused, with or without its draws.
    let (e, s) = (test_scalar("e"), test_scalar("s"));
    for not_a in [
        (G1Projective::from(a.first.base) * test_scalar("not alice's")).to_affine(),
        a.responder,
        (G1Projective::from(a.first.base) * alice.scalar() + g()).to_affine(),
    ] {
        let mut first = a.first.clone();
        first.initiator = not_a;
        let statement = KeysStatement::of(&first, &a.responder, &a.ratchet.dhs.public);
        assert_eq!(
            statement
                .prove_handle(&alice.scalar(), &e, &s, &mut draw)
                .err(),
            Some(Error::NotForThisKey)
        );
        assert_eq!(
            statement
                .prove_handle_with(&alice.scalar(), &e, &s, (&e, &s, &e), (&s, &e))
                .err(),
            Some(Error::NotForThisKey)
        );
    }
}

/// Both proofs, from a handle and in a continuation, verify as made, and
/// refuse each challenge share or response altered, swapped or negated,
/// each point moved, and the other form: a handle's cut to a
/// continuation's, a continuation's grown to a handle's, in memory and in
/// F's bytes.
#[test]
fn both_proofs_are_sound_and_their_forms_are_not_interchangeable() {
    let (alice, bob) = (key("alice"), key("bob"));
    let bob_handle = handle("bob", "h");
    let mut draw = Seeded::new("sound");
    let a = start(&alice, &bob_handle, T, &mut draw);
    let first = &a.first;
    let w0 = (G1Projective::from(first.base) * bob.scalar()).to_affine();
    let sa = a.ratchet.dhs.public;
    let statement = KeysStatement::of(first, &w0, &sa);
    let proof = first.keys_proof.unwrap();
    assert!(statement.verifies(&proof));
    let KeysProof::Handle {
        c1,
        c2,
        z1,
        z2,
        ze,
        zs,
    } = proof
    else {
        panic!("from a handle")
    };
    let one = Scalar::ONE;
    let handle_form = |c1, c2, z1, z2, ze, zs| KeysProof::Handle {
        c1,
        c2,
        z1,
        z2,
        ze,
        zs,
    };
    for (name, bad) in [
        ("c1 + 1", handle_form(c1 + one, c2, z1, z2, ze, zs)),
        ("c2 + 1", handle_form(c1, c2 + one, z1, z2, ze, zs)),
        ("z1 + 1", handle_form(c1, c2, z1 + one, z2, ze, zs)),
        ("z2 + 1", handle_form(c1, c2, z1, z2 + one, ze, zs)),
        ("ze + 1", handle_form(c1, c2, z1, z2, ze + one, zs)),
        ("zs + 1", handle_form(c1, c2, z1, z2, ze, zs + one)),
        ("c1 and c2 swapped", handle_form(c2, c1, z1, z2, ze, zs)),
        ("the branches swapped", handle_form(c2, c1, z2, z1, ze, zs)),
        ("ze and zs swapped", handle_form(c1, c2, z1, z2, zs, ze)),
        (
            "c1 + 1, c2 - 1",
            handle_form(c1 + one, c2 - one, z1, z2, ze, zs),
        ),
        ("all negated", handle_form(-c1, -c2, -z1, -z2, -ze, -zs)),
        (
            "c2 = 0, c1 the sum",
            handle_form(c1 + c2, Scalar::ZERO, z1, z2, ze, zs),
        ),
        (
            "cut to a continuation's",
            KeysProof::Continuation { c: c1 + c2, ze, zs },
        ),
    ] {
        assert!(!statement.verifies(&bad), "{name}");
    }
    // Each point moved.
    let moved = |change: &dyn Fn(&mut KeysStatement)| {
        let mut other = KeysStatement::of(first, &w0, &sa);
        change(&mut other);
        other.verifies(&proof)
    };
    let elsewhere = (g() * test_scalar("elsewhere")).to_affine();
    assert!(!moved(&|s| std::mem::swap(
        &mut s.ephemeral,
        &mut s.ratchet
    )));
    assert!(!moved(&|s| std::mem::swap(
        &mut s.initiator,
        &mut s.ephemeral
    )));
    assert!(!moved(&|s| std::mem::swap(
        &mut s.initiator,
        &mut s.responder
    )));
    assert!(!moved(&|s| s.ratchet = elsewhere));
    assert!(!moved(&|s| s.ephemeral = elsewhere));
    assert!(!moved(&|s| s.initiator = elsewhere));
    assert!(!moved(&|s| s.base = elsewhere));
    assert!(!moved(&|s| {
        s.responder = (G1Projective::from(first.base) * key("carol").scalar()).to_affine()
    }));
    assert!(!moved(&|s| s.proven[30] ^= 1));
    assert!(moved(&|_| {}));
    // E_A and S_A swapped with their responses.
    let mut swapped = KeysStatement::of(first, &w0, &sa);
    std::mem::swap(&mut swapped.ephemeral, &mut swapped.ratchet);
    assert!(!swapped.verifies(&handle_form(c1, c2, z1, z2, zs, ze)));

    // The continuation form.
    let continuing = Conversation::continue_with(&alice, &a, T, &mut draw).unwrap();
    let cs = KeysStatement::of(
        &continuing.first,
        &continuing.responder,
        &continuing.ratchet.dhs.public,
    );
    let cproof = continuing.first.keys_proof.unwrap();
    assert!(cs.verifies(&cproof));
    let KeysProof::Continuation {
        c,
        ze: cze,
        zs: czs,
    } = cproof
    else {
        panic!("a continuation")
    };
    for (name, bad) in [
        (
            "c + 1",
            KeysProof::Continuation {
                c: c + one,
                ze: cze,
                zs: czs,
            },
        ),
        (
            "ze + 1",
            KeysProof::Continuation {
                c,
                ze: cze + one,
                zs: czs,
            },
        ),
        (
            "zs + 1",
            KeysProof::Continuation {
                c,
                ze: cze,
                zs: czs + one,
            },
        ),
        (
            "ze and zs swapped",
            KeysProof::Continuation {
                c,
                ze: czs,
                zs: cze,
            },
        ),
        (
            "grown to a handle's",
            handle_form(c, Scalar::ZERO, Scalar::ZERO, Scalar::ZERO, cze, czs),
        ),
    ] {
        assert!(!cs.verifies(&bad), "{name}");
    }
    // In F itself: the form is the one `to` sets, in memory and in bytes.
    let mut wrong_form = continuing.first.clone();
    wrong_form.keys_proof = Some(handle_form(
        c,
        Scalar::ZERO,
        Scalar::ZERO,
        Scalar::ZERO,
        cze,
        czs,
    ));
    assert!(!wrong_form.proves_keys(&continuing.responder, &continuing.ratchet.dhs.public));
    let mut wrong_form = first.clone();
    wrong_form.keys_proof = Some(KeysProof::Continuation { c: c1 + c2, ze, zs });
    assert!(!wrong_form.proves_keys(&w0, &sa));
    assert_eq!(
        FirstContact::from_bytes(&wrong_form.to_bytes()).err(),
        Some(Error::InvalidMessage),
        "a handle's F with 96 bytes of keys proof"
    );
    let mut grown = continuing.first_bytes.clone();
    grown.extend_from_slice(&[0; 96]);
    assert_eq!(
        FirstContact::from_bytes(&grown).err(),
        Some(Error::InvalidMessage),
        "a continuation's F with 192 bytes of keys proof"
    );

    // The base proof.
    let base_proof = first.proof.unwrap();
    assert!(first.proves_base(&bob_handle));
    let BaseProof { c1, c2, z1, z2 } = base_proof;
    let base_form = |c1, c2, z1, z2| BaseProof { c1, c2, z1, z2 };
    for (name, bad) in [
        ("c1 + 1", base_form(c1 + one, c2, z1, z2)),
        ("c2 + 1", base_form(c1, c2 + one, z1, z2)),
        ("z1 + 1", base_form(c1, c2, z1 + one, z2)),
        ("z2 + 1", base_form(c1, c2, z1, z2 + one)),
        ("c1 and c2 swapped", base_form(c2, c1, z1, z2)),
        ("the branches swapped", base_form(c2, c1, z2, z1)),
        ("c1 + 1, c2 - 1", base_form(c1 + one, c2 - one, z1, z2)),
        ("all negated", base_form(-c1, -c2, -z1, -z2)),
        (
            "c2 = 0, c1 the sum",
            base_form(c1 + c2, Scalar::ZERO, z1, z2),
        ),
    ] {
        let mut changed = first.clone();
        changed.proof = Some(bad);
        assert!(!changed.proves_base(&bob_handle), "{name}");
    }
    for (name, point) in [
        ("p0 moved", elsewhere),
        ("p0 as A", first.initiator),
        ("p0 as E_A", first.ephemeral),
    ] {
        let mut changed = first.clone();
        changed.base = point;
        assert!(!changed.proves_base(&bob_handle), "{name}");
    }
    let swapped_handle = Register::from_checked(
        bob_handle.public_value().to_affine(),
        bob_handle.generator().to_affine(),
    );
    assert!(
        !first.proves_base(&swapped_handle),
        "the handle's points swapped"
    );
    assert!(
        !first.proves_base(&handle("bob", "another")),
        "another of the key's registers"
    );
}

/// The reader's first message to itself: what Bob can make with his key
/// alone, for any (p₀, A) he likes, to his own handle `(g_S, [x_B]g_S)`. Both
/// proofs prove their reader's branch with x_B and simulate the writer's;
/// SK is [x_B]E_A ‖ [x_B]A, which he computes.
fn readers_own_first_message(
    bob: &SecretKey,
    bobs: &Register,
    p0: G1Affine,
    a: G1Affine,
    label: &str,
) -> Vec<u8> {
    let xb = bob.scalar();
    let base = G1Projective::from(p0);
    let (e, s) = (
        test_scalar(&format!("{label} e")),
        test_scalar(&format!("{label} s")),
    );
    let w0 = (base * xb).to_affine();
    let sa = (base * s).to_affine();
    let mut first = FirstContact {
        cid: ConversationId(test_bytes16(label)),
        started_at: T,
        to: HANDLE_NAME.to_vec(),
        replaces: None,
        base: p0,
        initiator: a,
        ephemeral: (base * e).to_affine(),
        proof: None,
        keys_proof: None,
    };
    // The base proof: b's branch simulated, the handle's key's proved.
    let prefix = first.prefix_bytes();
    let (c1, z1, k2) = (
        test_scalar(&format!("{label} base c1")),
        test_scalar(&format!("{label} base z1")),
        test_scalar(&format!("{label} base k2")),
    );
    let t1 = (bobs.generator() * z1 - base * c1).to_affine();
    let t2 = (bobs.generator() * k2).to_affine();
    let c2 = scalar_mod_q(&base_challenge(bobs, &p0, (&t1, &t2), &prefix)) - c1;
    first.proof = Some(BaseProof {
        c1,
        c2,
        z1,
        z2: k2 + c2 * xb,
    });
    // The keys proof: A's branch simulated, w₀'s proved, E_A and S_A his own.
    let statement = KeysStatement::of(&first, &w0, &sa);
    let (c1, z1) = (
        test_scalar(&format!("{label} keys c1")),
        test_scalar(&format!("{label} keys z1")),
    );
    let (ke, ks, k2) = (
        test_scalar(&format!("{label} ke")),
        test_scalar(&format!("{label} ks")),
        test_scalar(&format!("{label} keys k2")),
    );
    let commitments = KeysCommitments {
        te: (base * ke).to_affine(),
        ts: (base * ks).to_affine(),
        t1: Some((base * z1 - G1Projective::from(a) * c1).to_affine()),
        t2: Some((base * k2).to_affine()),
    };
    let c = scalar_mod_q(&statement.challenge(&commitments));
    let c2 = c - c1;
    first.keys_proof = Some(KeysProof::Handle {
        c1,
        c2,
        z1,
        z2: k2 + c2 * xb,
        ze: ke + c * e,
        zs: ks + c * s,
    });
    assert!(first.proves_base(bobs));
    assert!(first.proves_keys(&w0, &sa));
    let first_bytes = first.to_bytes();
    let sk = session_key(
        &(G1Projective::from(first.ephemeral) * xb).to_compressed(),
        &(G1Projective::from(a) * xb).to_compressed(),
        &first_bytes,
    );
    let mut conversation = Conversation {
        role: Role::Initiator,
        first,
        first_bytes,
        responder: w0,
        ratchet: Ratchet::init_alice(
            &sk,
            KeyPair {
                secret: Secret32::from_bytes(s.to_bytes_be()),
                public: sa,
            },
            w0,
        ),
        stamp: None,
        first_contact_sent: Some(0),
    };
    stamp(&mut conversation);
    conversation
        .send_with(
            b"a message only Bob could have made",
            &mut Seeded::new(label),
        )
        .unwrap()
}

/// Deniability: the reader alone, with its own key and no secret of the
/// writer's, makes a first message its own checks take, both proofs and all,
/// for (p₀, A) any public register of the writer's: one of its Seedelfs
/// re-randomized, its identity from a conversation with someone else, or any
/// point at all. So F shows no third party who wrote it. Before the base
/// proof was designated-verifier, the reader could make one only on a base
/// whose log to its handle's generator it knew.
#[test]
fn the_reader_alone_makes_an_accepted_f_for_any_public_register_of_the_writer() {
    let (alice, bob) = (key("alice"), key("bob"));
    let bobs = handle("bob", "h");
    let alices = handle("alice", "her seedelf");
    let k = test_scalar("bob's multiplier");
    let mut draw = Seeded::new("alice to carol");
    let to_carol = start(&alice, &handle("carol", "carol's handle"), T, &mut draw);
    let random_base = (g() * test_scalar("any base")).to_affine();
    for (label, p0, a) in [
        (
            "a Seedelf of hers, re-randomized",
            (alices.generator() * k).to_affine(),
            (alices.public_value() * k).to_affine(),
        ),
        (
            "her identity in a conversation with Carol",
            to_carol.first.base,
            to_carol.first.initiator,
        ),
        (
            "any point at all",
            random_base,
            (g() * test_scalar("any A")).to_affine(),
        ),
    ] {
        if label != "any point at all" {
            assert!(matches_register(&alice, &Register::from_checked(p0, a)));
        }
        let envelope = readers_own_first_message(&bob, &bobs, p0, a, label);
        let mut inbox = test_inbox();
        let Ok(Received::Request { plaintext, .. }) =
            inbox.receive(&bob, &handles(&[bobs]), &envelope, T)
        else {
            panic!("{label}: the reader's own first message is taken")
        };
        assert_eq!(plaintext, b"a message only Bob could have made", "{label}");
    }
}

/// A first message from Mallory on the base p₀ = g′ of `target` = (g′, v′),
/// its base proof made against `stale`, a register of her own key: its
/// handle's-key branch proved with that key, b's simulated. Its keys proof
/// proves A's branch with a key of hers and simulates w₀'s on the guess
/// w₀ = v′, so it verifies, and SK and the envelope are right, exactly when
/// `target` is a register of the reader's key.
fn unbound_first_message(mallory: &SecretKey, stale: &Register, target: &Register) -> Vec<u8> {
    let mut draw = Seeded::new("unbound");
    let (p0, guess) = (target.generator(), target.public_value().to_affine());
    let (a, e, s) = (
        test_scalar("unbound a"),
        test_scalar("unbound e"),
        test_scalar("unbound s"),
    );
    let mut first = FirstContact {
        cid: ConversationId(draw.bytes16()),
        started_at: T,
        to: HANDLE_NAME.to_vec(),
        replaces: None,
        base: p0.to_affine(),
        initiator: (p0 * a).to_affine(),
        ephemeral: (p0 * e).to_affine(),
        proof: None,
        keys_proof: None,
    };
    let prefix = first.prefix_bytes();
    let (c1, z1, k2) = (
        test_scalar("unbound c1"),
        test_scalar("unbound z1"),
        test_scalar("unbound k2"),
    );
    let t1 = (stale.generator() * z1 - p0 * c1).to_affine();
    let t2 = (stale.generator() * k2).to_affine();
    let c2 = scalar_mod_q(&base_challenge(stale, &first.base, (&t1, &t2), &prefix)) - c1;
    first.proof = Some(BaseProof {
        c1,
        c2,
        z1,
        z2: k2 + c2 * mallory.scalar(),
    });
    assert!(first.proves_base(stale));
    let sa = (p0 * s).to_affine();
    first.keys_proof = Some(
        KeysStatement::of(&first, &guess, &sa)
            .prove_handle(&a, &e, &s, &mut draw)
            .unwrap(),
    );
    let first_bytes = first.to_bytes();
    let w = G1Projective::from(guess);
    let sk = session_key(
        &(w * e).to_compressed(),
        &(w * a).to_compressed(),
        &first_bytes,
    );
    let mut conversation = Conversation {
        role: Role::Initiator,
        first,
        first_bytes,
        responder: guess,
        ratchet: Ratchet::init_alice(
            &sk,
            KeyPair {
                secret: Secret32::from_bytes(s.to_bytes_be()),
                public: sa,
            },
            guess,
        ),
        stamp: None,
        first_contact_sent: Some(0),
    };
    stamp(&mut conversation);
    conversation
        .send_with(b"do you hold it?", &mut draw)
        .unwrap()
}

/// The base proof binds p₀ only against a register of the reader's own key,
/// since its other branch is that register's key: so the reader passes over
/// a register of another key under one of its handles' names, one a Seedelf
/// held before it came to this wallet, say. Before, one such register in the
/// list let its key's holder prove that branch for any p₀, put p₀ on any
/// register and simulate the keys proof's w₀ on its public value, and the
/// reader took her first message exactly when that register was its key's
/// (the 1.10.0 gate's crypto review of the keys). Now both are refused,
/// silently, with nothing kept, and an honest first message still reads
/// with that list.
#[test]
fn a_register_of_another_key_under_the_readers_name_binds_no_base() {
    let (alice, mallory, bob) = (key("alice"), key("mallory"), key("bob"));
    let (bobs, stale) = (handle("bob", "h"), handle("mallory", "stale"));
    let listed = handles(&[bobs, stale]);
    for (label, target, refusal) in [
        (
            "another register of the reader's",
            handle("bob", "two"),
            Error::InvalidBaseProof,
        ),
        ("a stranger's", handle("carol", "c"), Error::NotForThisKey),
    ] {
        let envelope = unbound_first_message(&mallory, &stale, &target);
        let mut inbox = test_inbox();
        assert_eq!(
            inbox.receive(&bob, &listed, &envelope, T),
            Err(refusal),
            "{label}"
        );
        assert!(inbox.requests().is_empty(), "{label}");
    }
    let mut draw = Seeded::new("honest, with a stale register listed");
    let envelope = start(&alice, &bobs, T, &mut draw)
        .send_with(b"hi", &mut draw)
        .unwrap();
    let mut inbox = test_inbox();
    assert!(matches!(
        inbox.receive(&bob, &listed, &envelope, T),
        Ok(Received::Request { new: true, .. })
    ));
}

/// A commitment the reader computes may be O: hashed as O's compressed
/// encoding, 0xc0 then 47 zero bytes, and the proof verifies. For the base
/// proof's T₁ and each of the keys proof's T_e, T_s and T₁, from a nonce of
/// 0, which only the writer can choose and which gives that secret away.
#[test]
fn a_commitment_at_the_identity_is_hashed_as_c0_then_zeros() {
    let mut zero = [0u8; 48];
    zero[0] = 0xc0;
    assert_eq!(G1Affine::identity().to_compressed(), zero);
    let (alice, bob) = (key("alice"), key("bob"));
    let bob_handle = handle("bob", "h");
    let mut draw = Seeded::new("identity");
    let a = start(&alice, &bob_handle, T, &mut draw);
    let first = &a.first;
    let prefix = first.prefix_bytes();

    // The base proof's T₁ at O: k = 0. b from the start's own draws: cid,
    // then b's aux.
    let head = head_bytes(&first.cid, first.started_at, &first.to, first.replaces);
    let mut replay = Seeded::new("identity");
    replay.bytes16();
    let b = base_scalar(&alice.scalar(), &bob_handle, &head, &mut replay);
    assert_eq!((bob_handle.generator() * b).to_affine(), first.base);
    let (c2, z2) = (test_scalar("c2"), test_scalar("z2"));
    let at_o = prove_base_with(&bob_handle, &b, &Scalar::ZERO, (&c2, &z2), &prefix);
    let (t1, t2) = base_commitments(&bob_handle, &first.base, &at_o);
    assert!(bool::from(t1.is_identity()));
    let by_hand: [u8; 32] = Sha256::new()
        .chain_update(b"Seedelf-Messaging|v1|session|base")
        .chain_update(bob_handle.to_bytes())
        .chain_update(first.base.to_compressed())
        .chain_update(zero)
        .chain_update(t2.to_compressed())
        .chain_update(&prefix)
        .finalize()
        .into();
    assert_eq!(at_o.c1 + at_o.c2, scalar_mod_q(&by_hand));
    let mut changed = first.clone();
    changed.proof = Some(at_o);
    assert!(changed.proves_base(&bob_handle));

    // The keys proof's commitments at O, one nonce 0 at a time, on a
    // statement whose E_A and S_A keys are known here.
    let w0 = (G1Projective::from(first.base) * bob.scalar()).to_affine();
    let (e, s) = (test_scalar("e"), test_scalar("s"));
    let mut known = first.clone();
    known.ephemeral = (G1Projective::from(first.base) * e).to_affine();
    let sa = (G1Projective::from(first.base) * s).to_affine();
    let statement = KeysStatement::of(&known, &w0, &sa);
    let n = |label: &str| test_scalar(label);
    for (which, nonces) in [
        ("T_e", (Scalar::ZERO, n("ks"), n("k1"))),
        ("T_s", (n("ke"), Scalar::ZERO, n("k1"))),
        ("T1", (n("ke"), n("ks"), Scalar::ZERO)),
    ] {
        let proof = statement
            .prove_handle_with(
                &alice.scalar(),
                &e,
                &s,
                (&nonces.0, &nonces.1, &nonces.2),
                (&n("keys c2"), &n("keys z2")),
            )
            .unwrap();
        let commitments = statement.commitments_of(&proof);
        let at_o = match which {
            "T_e" => commitments.te,
            "T_s" => commitments.ts,
            _ => commitments.t1.unwrap(),
        };
        assert!(bool::from(at_o.is_identity()), "{which}");
        assert!(statement.verifies(&proof), "{which}");
    }
    let continuation = statement.prove_continuation_with(&e, &s, (&Scalar::ZERO, &n("ks")));
    assert!(bool::from(
        statement.commitments_of(&continuation).te.is_identity()
    ));
    assert!(statement.verifies(&continuation));
}

/// Cross-protocol (docs/joint-security.md, B5): a keys proof's (T₁, z₁) is no
/// spending proof the chain takes, for (p₀, A) or any [d](p₀, A), under any
/// vkh, and no Lovejoin owner proof: seedelf-crypto's verifiers, the chain's
/// blake2b-224 one among them, refuse it.
#[test]
fn no_keys_proof_transcript_passes_the_chain_verifier() {
    use seedelf_crypto::lovejoin::{SchnorrProof, verify_schnorr};
    use seedelf_crypto::schnorr::prove;
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("cross protocol");
    let a = start(&alice, &handle("bob", "h"), T, &mut draw);
    let first = &a.first;
    let w0 = (G1Projective::from(first.base) * bob.scalar()).to_affine();
    let statement = KeysStatement::of(first, &w0, &a.ratchet.dhs.public);
    let proof = first.keys_proof.unwrap();
    let KeysProof::Handle { z1, .. } = proof else {
        panic!("from a handle")
    };
    let t1 = statement.commitments_of(&proof).t1.unwrap();
    let hex_point = |p: &G1Affine| hex::encode(p.to_compressed());
    for d in [Scalar::ONE, test_scalar("d1"), test_scalar("d2")] {
        let scaled = |p: &G1Affine| (G1Projective::from(*p) * d).to_affine();
        let (gd, ud, td) = (scaled(&first.base), scaled(&first.initiator), scaled(&t1));
        for vkh in ["00".repeat(28), "11".repeat(28), "5eed".repeat(14)] {
            assert!(
                !prove(
                    &hex_point(&gd),
                    &hex_point(&ud),
                    &hex::encode(z1.to_bytes_be()),
                    &hex_point(&td),
                    &vkh
                )
                .unwrap()
            );
        }
        let lovejoin = SchnorrProof {
            t: td.to_compressed(),
            z: z1.to_bytes_be(),
        };
        assert!(!verify_schnorr(
            &G1Projective::from(gd),
            &G1Projective::from(ud),
            &lovejoin,
            b"any ctx"
        ));
    }
}

// The nonces (docs/joint-security.md, rule 2).

/// Draws named by their index; those in `vary` give other values, as a
/// source that repeats every draw but those would.
struct Varied {
    label: String,
    vary: u32,
    count: usize,
    log: Vec<Vec<u8>>,
}

impl Varied {
    fn new(label: &str, vary: u32) -> Self {
        Self {
            label: label.to_string(),
            vary,
            count: 0,
            log: Vec::new(),
        }
    }

    fn name(&mut self, kind: &str) -> String {
        let i = self.count;
        self.count += 1;
        if i < 32 && self.vary & (1 << i) != 0 {
            format!("{} {kind} {i} varied", self.label)
        } else {
            format!("{} {kind} {i}", self.label)
        }
    }
}

impl Draw for Varied {
    fn scalar(&mut self) -> Scalar {
        let value = test_scalar(&self.name("scalar"));
        self.log.push(value.to_bytes_be().to_vec());
        value
    }
    fn bytes16(&mut self) -> [u8; 16] {
        let value = test_bytes16(&self.name("bytes16"));
        self.log.push(value.to_vec());
        value
    }
    fn bytes32(&mut self) -> [u8; 32] {
        let value: [u8; 32] = Sha256::digest(self.name("bytes32").as_bytes()).into();
        self.log.push(value.to_vec());
        value
    }
}

/// A start's ten draws, by index: cid, b's aux, e_A, s_A, the base proof's
/// c₂, z₂ and aux, the keys proof's c₂, z₂ and aux.
const DRAWS: [&str; 10] = [
    "cid", "aux_b", "e_A", "s_A", "base c2", "base z2", "aux_k", "keys c2", "keys z2", "aux_keys",
];

/// What a start's proofs rest on: its secrets, its nonces as their
/// definitions give them from the start's own draws, and its proofs.
struct Start {
    b: Scalar,
    e: Scalar,
    s: Scalar,
    k: Scalar,
    ke: Scalar,
    ks: Scalar,
    k1: Scalar,
    base_proof: BaseProof,
    keys_proof: KeysProof,
}

fn scalar_of(bytes: &[u8]) -> Scalar {
    crate::keys::scalar_from_bytes(&bytes.try_into().unwrap()).unwrap()
}

fn start_varied(alice: &SecretKey, bobs: &Register, t: u64, vary: u32) -> Start {
    let mut draw = Varied::new("every subset", vary);
    let conversation = Conversation::start_with(alice, bobs, HANDLE_NAME, t, &mut draw).unwrap();
    let log = draw.log;
    assert_eq!(log.len(), DRAWS.len());
    let first = &conversation.first;
    let aux = |i: usize| -> [u8; 32] { log[i].clone().try_into().unwrap() };
    let head = head_bytes(&first.cid, first.started_at, &first.to, first.replaces);
    let b = hedge(&alice.scalar(), &base_scalar_message(bobs, &head, &aux(1)));
    let (e, s) = (scalar_of(&log[2]), scalar_of(&log[3]));
    let k = hedge(
        &b,
        &base_nonce_message(
            bobs,
            &first.base,
            &first.prefix_bytes(),
            (&scalar_of(&log[4]), &scalar_of(&log[5])),
            &aux(6),
        ),
    );
    let statement = KeysStatement::of(
        first,
        &conversation.responder,
        &conversation.ratchet.dhs.public,
    );
    let parts = [&log[7][..], &log[8][..], &log[9][..]];
    let ke = hedge(&e, &statement.nonce_message(KEYS_NONCE_E_LABEL, &parts));
    let ks = hedge(&s, &statement.nonce_message(KEYS_NONCE_S_LABEL, &parts));
    let p0 = G1Projective::from(first.base);
    let (te, ts) = ((p0 * ke).to_affine(), (p0 * ks).to_affine());
    let k1 = hedge(
        &alice.scalar(),
        &statement.nonce_message(
            KEYS_NONCE_A_LABEL,
            &[
                &te.to_compressed(),
                &ts.to_compressed(),
                parts[0],
                parts[1],
                parts[2],
            ],
        ),
    );
    // The definitions are what the start used.
    let commitments = statement.commitments_of(&first.keys_proof.unwrap());
    assert_eq!(
        (commitments.te, commitments.ts, commitments.t1),
        (te, ts, Some((p0 * k1).to_affine()))
    );
    assert_eq!(
        base_commitments(bobs, &first.base, &first.proof.unwrap()).0,
        (bobs.generator() * k).to_affine()
    );
    Start {
        b,
        e,
        s,
        k,
        ke,
        ks,
        k1,
        base_proof: first.proof.unwrap(),
        keys_proof: first.keys_proof.unwrap(),
    }
}

/// (z − z′)/(c − c′), special soundness's extractor, when the challenges
/// differ.
fn extract(z: Scalar, z_: Scalar, c: Scalar, c_: Scalar) -> Option<Scalar> {
    Option::<Scalar>::from((c - c_).invert()).map(|inverse| (z - z_) * inverse)
}

/// What two starts' proofs give away of x, e, s or b, by the extractor, and
/// any nonce one of them used under two challenges.
fn leaks(one: &Start, two: &Start, x: &Scalar) -> Vec<&'static str> {
    let mut out = Vec::new();
    let (p, q) = (&one.base_proof, &two.base_proof);
    if extract(p.z1, q.z1, p.c1, q.c1).is_some_and(|b| b == one.b || b == two.b) {
        out.push("b");
    }
    if one.k == two.k && p != q {
        out.push("k under two challenges");
    }
    let parts = |proof: &KeysProof| match *proof {
        KeysProof::Handle {
            c1, c2, z1, ze, zs, ..
        } => (c1, c1 + c2, z1, ze, zs),
        KeysProof::Continuation { .. } => unreachable!(),
    };
    let ((c1, c, z1, ze, zs), (c1_, c_, z1_, ze_, zs_)) =
        (parts(&one.keys_proof), parts(&two.keys_proof));
    if extract(z1, z1_, c1, c1_) == Some(*x) {
        out.push("x");
    }
    if extract(ze, ze_, c, c_).is_some_and(|e| e == one.e || e == two.e) {
        out.push("e");
    }
    if extract(zs, zs_, c, c_).is_some_and(|s| s == one.s || s == two.s) {
        out.push("s");
    }
    let same_keys_proof = one.keys_proof == two.keys_proof;
    for (name, mine, theirs) in [
        ("k_e under two challenges", one.ke, two.ke),
        ("k_s under two challenges", one.ks, two.ks),
        ("k1 under two challenges", one.k1, two.k1),
    ] {
        if mine == theirs && !same_keys_proof {
            out.push(name);
        }
    }
    out
}

/// The attack the first draft of the keys proof fell to, run against the
/// code: each of a start's ten draws varied while the others repeat, as a
/// source that fails would give them, then every subset of them, and t with
/// every draw repeated. No pair of starts gives x, e_A, s_A or b, and no
/// nonce meets two challenges; the same draws give the same proofs.
#[test]
fn no_subset_of_a_starts_draws_varied_gives_x_e_s_or_b() {
    let alice = key("alice");
    let x = alice.scalar();
    let bobs = handle("bob", "h");
    let base = start_varied(&alice, &bobs, T, 0);
    let again = start_varied(&alice, &bobs, T, 0);
    assert_eq!(
        (base.base_proof, base.keys_proof),
        (again.base_proof, again.keys_proof)
    );
    let mut single = Vec::new();
    for vary in 1u32..(1 << DRAWS.len()) {
        let other = start_varied(&alice, &bobs, T, vary);
        let got = leaks(&base, &other, &x);
        assert!(got.is_empty(), "varied {vary:#012b}: {got:?}");
        if vary.count_ones() == 1 {
            single.push(DRAWS[vary.trailing_zeros() as usize]);
            assert_ne!(other.keys_proof, base.keys_proof);
        }
    }
    assert_eq!(single, DRAWS);
    let later = start_varied(&alice, &bobs, T + 1, 0);
    assert!(leaks(&base, &later, &x).is_empty());
    assert_ne!(later.b, base.b);

    // A continuation's four draws, cid, e_A, s_A and the keys proof's aux:
    // no subset varied gives e_A or s_A, and the same draws give the same
    // proof.
    let mut draw = Seeded::new("every subset, the old conversation");
    let old = start(&alice, &bobs, T, &mut draw);
    let continuing = |vary: u32| {
        let mut draw = Varied::new("every subset, continuing", vary);
        let c = Conversation::continue_with(&alice, &old, T, &mut draw).unwrap();
        let log = draw.log;
        assert_eq!(log.len(), 4);
        let Some(KeysProof::Continuation {
            c: challenge,
            ze,
            zs,
        }) = c.first.keys_proof
        else {
            panic!("a continuation")
        };
        (scalar_of(&log[1]), scalar_of(&log[2]), challenge, ze, zs)
    };
    let (e, s, c, ze, zs) = continuing(0);
    assert_eq!(continuing(0), (e, s, c, ze, zs));
    for vary in 1u32..16 {
        let (e_, s_, c_, ze_, zs_) = continuing(vary);
        assert_ne!(c_, c, "varied {vary:#06b}");
        for (z, z_, secrets) in [(ze, ze_, [e, e_]), (zs, zs_, [s, s_])] {
            assert!(
                !extract(z, z_, c, c_).is_some_and(|got| secrets.contains(&got)),
                "varied {vary:#06b}"
            );
        }
    }
}

/// Each nonce is HMAC-SHA-512 of exactly §16.2's message, written out here
/// byte by byte from the labels as §16.2 spells them, under its key's 32
/// big-endian bytes: the reader's recomputed commitments are those nonces'
/// points and the responses answer them. From a handle and in a
/// continuation.
#[test]
fn each_nonce_is_hmac_sha512_of_its_specified_message() {
    use hmac::{Hmac, Mac};
    let hmac = |key: &Scalar, message: &[u8]| {
        let mut mac = <Hmac<sha2::Sha512> as Mac>::new_from_slice(&key.to_bytes_be()).unwrap();
        mac.update(message);
        scalar_mod_q(&mac.finalize().into_bytes())
    };
    let (alice, bob) = (key("alice"), key("bob"));
    let x = alice.scalar();
    let bobs = handle("bob", "h");
    let mut draw = Seeded::new("specified");
    let conversation = Conversation::start_with(&alice, &bobs, HANDLE_NAME, T, &mut draw).unwrap();
    let drawn = draw.drain();
    let first = &conversation.first;
    let p0 = G1Projective::from(first.base);
    let w0 = (p0 * bob.scalar()).to_affine();
    let sa = conversation.ratchet.dhs.public;
    let (e, s) = (scalar_of(&drawn[2]), scalar_of(&drawn[3]));
    let m: Vec<u8> = [
        &first.base.to_compressed()[..],
        &first.initiator.to_compressed(),
        &w0.to_compressed(),
        &first.ephemeral.to_compressed(),
        &sa.to_compressed(),
        &first.proven_bytes(),
    ]
    .concat();
    let message =
        |label: &[u8], parts: &[&[u8]]| -> Vec<u8> { [label, &m, &parts.concat()].concat() };
    let (c2, z2, aux) = (&drawn[7][..], &drawn[8][..], &drawn[9][..]);
    let ke = hmac(
        &e,
        &message(b"Seedelf-Messaging|v1|session|keys-nonce|e", &[c2, z2, aux]),
    );
    let ks = hmac(
        &s,
        &message(b"Seedelf-Messaging|v1|session|keys-nonce|s", &[c2, z2, aux]),
    );
    let (te, ts) = ((p0 * ke).to_compressed(), (p0 * ks).to_compressed());
    let k1 = hmac(
        &x,
        &message(
            b"Seedelf-Messaging|v1|session|keys-nonce|a",
            &[&te, &ts, c2, z2, aux],
        ),
    );
    let statement = KeysStatement::of(first, &w0, &sa);
    let proof = first.keys_proof.unwrap();
    let commitments = statement.commitments_of(&proof);
    assert_eq!(commitments.te.to_compressed(), te);
    assert_eq!(commitments.ts.to_compressed(), ts);
    let t1 = (p0 * k1).to_compressed();
    assert_eq!(commitments.t1.unwrap().to_compressed(), t1);
    // T₂ from the simulated branch, and the challenge from its definition.
    let (c2, z2) = (scalar_of(c2), scalar_of(z2));
    let t2 = (p0 * z2 - G1Projective::from(w0) * c2).to_compressed();
    let c = scalar_mod_q(
        &Sha256::new()
            .chain_update(b"Seedelf-Messaging|v1|session|keys|handle")
            .chain_update(&m)
            .chain_update(te)
            .chain_update(ts)
            .chain_update(t1)
            .chain_update(t2)
            .finalize(),
    );
    let KeysProof::Handle {
        c1,
        c2: proof_c2,
        z1,
        z2: proof_z2,
        ze,
        zs,
    } = proof
    else {
        panic!("from a handle")
    };
    assert_eq!((proof_c2, proof_z2), (c2, z2));
    assert_eq!(c1, c - c2, "c₁ = c − c₂, the hash read mod q");
    assert_eq!((z1, ze, zs), (k1 + c1 * x, ke + c * e, ks + c * s));

    // A continuation: k_e and k_s over M and its one aux.
    let mut draw = Seeded::new("specified continuation");
    let continuing = Conversation::continue_with(&alice, &conversation, T, &mut draw).unwrap();
    let drawn = draw.drain();
    let first = &continuing.first;
    let m: Vec<u8> = [
        &first.base.to_compressed()[..],
        &first.initiator.to_compressed(),
        &continuing.responder.to_compressed(),
        &first.ephemeral.to_compressed(),
        &continuing.ratchet.dhs.public.to_compressed(),
        &first.proven_bytes(),
    ]
    .concat();
    let (e, s, aux) = (scalar_of(&drawn[1]), scalar_of(&drawn[2]), &drawn[3][..]);
    let ke = hmac(
        &e,
        &[&b"Seedelf-Messaging|v1|session|keys-nonce|e"[..], &m, aux].concat(),
    );
    let ks = hmac(
        &s,
        &[&b"Seedelf-Messaging|v1|session|keys-nonce|s"[..], &m, aux].concat(),
    );
    let (te, ts) = ((p0 * ke).to_compressed(), (p0 * ks).to_compressed());
    let c = scalar_mod_q(
        &Sha256::new()
            .chain_update(b"Seedelf-Messaging|v1|session|keys|continuation")
            .chain_update(&m)
            .chain_update(te)
            .chain_update(ts)
            .finalize(),
    );
    assert_eq!(
        first.keys_proof,
        Some(KeysProof::Continuation {
            c,
            ze: ke + c * e,
            zs: ks + c * s,
        })
    );
}

/// The keys proof's prover, written out here with each of the design's
/// choices a switch: the design, and three mutants that each drop one. The
/// design is the crate's prover, draw for draw.
#[derive(Clone, Copy)]
struct Shape {
    /// One aux for the three nonces; false draws one for each (after c₂ and
    /// z₂: aux_e, aux_s, aux_a).
    one_aux: bool,
    /// k₁'s message holds T_e and T_s.
    k1_covers_commitments: bool,
    /// k₁'s message holds c₂ and z₂.
    k1_covers_simulated: bool,
    /// k_e's and k_s's messages hold c₂ and z₂.
    ke_covers_simulated: bool,
}

const DESIGN: Shape = Shape {
    one_aux: true,
    k1_covers_commitments: true,
    k1_covers_simulated: true,
    ke_covers_simulated: true,
};

fn prove_shaped(
    statement: &KeysStatement,
    secrets: (&Scalar, &Scalar, &Scalar),
    draw: &mut dyn Draw,
    shape: Shape,
) -> KeysProof {
    let (x, e, s) = secrets;
    let p0 = G1Projective::from(statement.base);
    let c2 = draw.scalar();
    let z2 = draw.scalar();
    let aux_e = draw.bytes32();
    let (aux_s, aux_a) = if shape.one_aux {
        (aux_e, aux_e)
    } else {
        (draw.bytes32(), draw.bytes32())
    };
    let (c2b, z2b) = (c2.to_bytes_be(), z2.to_bytes_be());
    let simulated: Vec<&[u8]> = if shape.ke_covers_simulated {
        vec![&c2b, &z2b]
    } else {
        Vec::new()
    };
    let ke = hedge(
        e,
        &statement.nonce_message(
            KEYS_NONCE_E_LABEL,
            &[&simulated[..], &[&aux_e[..]]].concat(),
        ),
    );
    let ks = hedge(
        s,
        &statement.nonce_message(
            KEYS_NONCE_S_LABEL,
            &[&simulated[..], &[&aux_s[..]]].concat(),
        ),
    );
    let (te, ts) = ((p0 * ke).to_affine(), (p0 * ks).to_affine());
    let (teb, tsb) = (te.to_compressed(), ts.to_compressed());
    let mut parts: Vec<&[u8]> = Vec::new();
    if shape.k1_covers_commitments {
        parts.extend([&teb[..], &tsb[..]]);
    }
    if shape.k1_covers_simulated {
        parts.extend([&c2b[..], &z2b[..]]);
    }
    parts.push(&aux_a);
    let k1 = hedge(x, &statement.nonce_message(KEYS_NONCE_A_LABEL, &parts));
    statement
        .prove_handle_with(x, e, s, (&ke, &ks, &k1), (&c2, &z2))
        .unwrap()
}

/// The nonce rule's three mutants, each caught: with a source that repeats
/// every draw but one, each gives a secret away from two first messages,
/// where the design gives nothing.
/// - An aux each: e or s; and x too when k₁ also leaves out T_e and T_s
///   (the keys proof's first draft, docs/joint-security.md §9).
/// - k₁ over M and aux alone: x, when c₂ or z₂ varies.
/// - k_e and k_s without c₂ and z₂: e and s, when c₂ or z₂ varies.
#[test]
fn the_three_nonce_mutants_each_give_a_secret_away() {
    let alice = key("alice");
    let x = alice.scalar();
    let bobs = handle("bob", "h");
    let mut draw = Seeded::new("mutants");
    let a = Conversation::start_with(&alice, &bobs, HANDLE_NAME, T, &mut draw).unwrap();
    let drawn = draw.drain();
    let (e, s) = (scalar_of(&drawn[2]), scalar_of(&drawn[3]));
    let statement = KeysStatement::of(&a.first, &a.responder, &a.ratchet.dhs.public);
    // The design is the crate's prover, draw for draw.
    let mut replay = Seeded::new("mutants keys");
    let mut again = Seeded::new("mutants keys");
    assert_eq!(
        prove_shaped(&statement, (&x, &e, &s), &mut replay, DESIGN),
        statement.prove_handle(&x, &e, &s, &mut again).unwrap()
    );
    // What a pair of proofs, one draw varied, gives away.
    let gives = |shape: Shape, draws: usize| -> Vec<(usize, Vec<&'static str>)> {
        let base = prove_shaped(&statement, (&x, &e, &s), &mut Varied::new("m", 0), shape);
        (0..draws)
            .filter_map(|i| {
                let other = prove_shaped(
                    &statement,
                    (&x, &e, &s),
                    &mut Varied::new("m", 1 << i),
                    shape,
                );
                let (
                    KeysProof::Handle {
                        c1, c2, z1, ze, zs, ..
                    },
                    KeysProof::Handle {
                        c1: c1_,
                        c2: c2_,
                        z1: z1_,
                        ze: ze_,
                        zs: zs_,
                        ..
                    },
                ) = (base, other)
                else {
                    unreachable!()
                };
                let mut got = Vec::new();
                if extract(z1, z1_, c1, c1_) == Some(x) {
                    got.push("x");
                }
                if extract(ze, ze_, c1 + c2, c1_ + c2_) == Some(e) {
                    got.push("e");
                }
                if extract(zs, zs_, c1 + c2, c1_ + c2_) == Some(s) {
                    got.push("s");
                }
                (!got.is_empty()).then_some((i, got))
            })
            .collect()
    };
    // Draws: c₂, z₂, then one aux (the design) or three.
    assert!(gives(DESIGN, 3).is_empty(), "the design gives nothing");
    let an_aux_each = Shape {
        one_aux: false,
        ..DESIGN
    };
    let found = gives(an_aux_each, 5);
    assert!(
        found.iter().any(|(i, got)| *i == 2 && got.contains(&"s")),
        "{found:?}"
    );
    assert!(
        found.iter().any(|(i, got)| *i == 3 && got.contains(&"e")),
        "{found:?}"
    );
    let first_draft = Shape {
        one_aux: false,
        k1_covers_commitments: false,
        ..DESIGN
    };
    let found = gives(first_draft, 5);
    assert!(
        found.iter().any(|(i, got)| *i == 2 && got.contains(&"x")),
        "{found:?}"
    );
    assert!(
        found.iter().any(|(i, got)| *i == 3 && got.contains(&"x")),
        "{found:?}"
    );
    let m_and_aux = Shape {
        k1_covers_commitments: false,
        k1_covers_simulated: false,
        ..DESIGN
    };
    let found = gives(m_and_aux, 3);
    assert!(
        found.iter().any(|(i, got)| *i == 0 && got.contains(&"x")),
        "{found:?}"
    );
    assert!(
        found.iter().any(|(i, got)| *i == 1 && got.contains(&"x")),
        "{found:?}"
    );
    let without_simulated = Shape {
        ke_covers_simulated: false,
        ..DESIGN
    };
    let found = gives(without_simulated, 3);
    assert!(
        found
            .iter()
            .any(|(i, got)| *i == 0 && got.contains(&"e") && got.contains(&"s")),
        "{found:?}"
    );
    assert!(found.iter().all(|(_, got)| !got.contains(&"x")));
    // T_e and T_s in k₁'s message add nothing once one aux and c₂, z₂ are
    // there: no draw gives anything without them.
    let without_commitments = Shape {
        k1_covers_commitments: false,
        ..DESIGN
    };
    assert!(gives(without_commitments, 3).is_empty());
}

/// An honest first message still reads, from a handle and in a
/// continuation, and the reply reaches its writer: the change refuses only
/// what no honest writer makes.
#[test]
fn honest_first_messages_still_read() {
    let (alice, bob) = (key("alice"), key("bob"));
    let bobs = handle("bob", "h");
    let mut draw = Seeded::new("honest");
    let mut a = start(&alice, &bobs, T, &mut draw);
    let mut inbox = test_inbox();
    for text in [&b"one"[..], b"two", b"three"] {
        let envelope = a.send_with(text, &mut draw).unwrap();
        assert!(inbox.receive(&bob, &handles(&[bobs]), &envelope, T).is_ok());
    }
    assert_eq!(
        inbox.requests().get(a.cid()).unwrap().read(&bob).unwrap(),
        vec![
            Ok(b"one".to_vec()),
            Ok(b"two".to_vec()),
            Ok(b"three".to_vec())
        ]
    );
    inbox.accept(&bob, a.cid()).unwrap();
    let reply = inbox.send(a.cid(), b"hi").unwrap();
    assert_eq!(
        a.receive_with(&opened(&alice, &reply), T, &mut draw)
            .unwrap(),
        b"hi"
    );
    let mut again = Conversation::continue_with(&alice, &a, T, &mut draw).unwrap();
    stamp(&mut again);
    let envelope = again.send_with(b"again", &mut draw).unwrap();
    assert!(matches!(
        inbox.receive(&bob, &[], &envelope, T),
        Ok(Received::Request { .. })
    ));
}
