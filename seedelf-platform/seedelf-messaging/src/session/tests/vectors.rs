//! The session layer's test vectors (tests/vectors/messaging_session_v1.json):
//! four conversations with every intermediate value, from fixed draws,
//! through the crate's own functions. The generator checks each value it
//! records against the state it came from.
//!
//! Each conversation's first-contact stamp is the first nonce from 0 with
//! [`FIRST_CONTACT_STAMP_BITS`] of work. Finding it takes 2²⁴ attempts on
//! average, so only recording searches (in a release build:
//! `RECORD_MESSAGING_SESSION_VECTORS=1 cargo test --release`); otherwise the
//! nonce is read back from the file and its work checked.

use std::path::PathBuf;

use blstrs::G1Projective;
use group::Curve;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::support::{Seeded, handle, key, opened, test_scalar};
use crate::SecretKey;
use crate::envelope::ENVELOPE_OVERHEAD;
use crate::keys::scalar_mod_q;
use crate::register::Register;
use crate::relay::{find_stamp, stamp_bits};
use crate::session::conversation::{Conversation, Origin};
use crate::session::draw::hedge_okm;
use crate::session::first_contact::{
    BASE_LABEL, BASE_NONCE_LABEL, BASE_SCALAR_LABEL, FIRST_CONTACT_STAMP_BITS, FIRST_STAMP_LABEL,
    SESSION_INFO, SESSION_SALT, base_challenge, base_nonce_message, base_scalar_message,
    head_bytes, prove_base_with_nonce, session_key,
};
use crate::session::inbox::{Continues, Inbox, Received};
use crate::session::ratchet::{
    MESSAGE_INFO, OUTER_INFO, ROOT_INFO, kdf_ck, kdf_rk, message_key_and_nonce, outer_okm,
    outer_scalar,
};
use crate::session::secret::Secret32;
use crate::session::wire::ENVELOPE_SIZES;

const VECTORS: &str = "tests/vectors/messaging_session_v1.json";

fn recording() -> bool {
    std::env::var("RECORD_MESSAGING_SESSION_VECTORS").as_deref() == Ok("1")
}

/// The stamp of the vectors' session `index`: searched for when recording,
/// read from the file otherwise, and always checked.
fn stamp_of(conversation: &mut Conversation, index: usize) -> Value {
    let digest = conversation.stamp_digest();
    let nonce = if recording() {
        find_stamp(&digest, FIRST_CONTACT_STAMP_BITS, 0, u64::MAX).unwrap()
    } else {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(VECTORS);
        let file: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        file["sessions"][index]["stamp"]["nonce"]
            .as_u64()
            .expect("the file holds a stamp: record the vectors again")
    };
    let work = stamp_bits(&digest, nonce);
    assert!(
        work >= FIRST_CONTACT_STAMP_BITS,
        "the file's stamp no longer fits F: record the vectors again"
    );
    conversation.set_stamp(nonce).unwrap();
    json!({
        "digest": hex(digest),
        "bits": FIRST_CONTACT_STAMP_BITS,
        "nonce": nonce,
        "hash": hex(Sha256::new().chain_update(digest).chain_update(nonce.to_be_bytes()).finalize()),
        "work": work,
    })
}

fn hex(bytes: impl AsRef<[u8]>) -> String {
    hex::encode(bytes)
}

fn register_json(register: &Register) -> Value {
    json!({
        "generator": hex(register.generator_bytes()),
        "public_value": hex(register.public_value_bytes()),
    })
}

/// One side of a conversation, with its key and the draws it makes.
struct Side {
    name: &'static str,
    key: SecretKey,
    conversation: Option<Conversation>,
}

/// Records a send: the chain step, ENCRYPT's values, the inner message, the
/// outer scalar, and the envelope with its draws (salt, then `r`).
fn send(from: &mut Side, to: &Side, text: &[u8], draw: &mut Seeded) -> (Value, Vec<u8>) {
    let conversation = from.conversation.as_mut().unwrap();
    let chain_key = conversation.ratchet.cks.clone().unwrap();
    let kind = if conversation.sends_first_contact() {
        "first-contact"
    } else {
        "session"
    };
    let envelope = conversation.send_with(text, draw).unwrap();
    let drawn = draw.drain();
    assert_eq!(drawn.len(), 2);
    let (next, mk) = kdf_ck(&chain_key);
    assert_eq!(conversation.ratchet.cks.as_ref(), Some(&next));

    let message = opened(&to.key, &envelope);
    let header = message.header.to_bytes();
    let mut ad = conversation.ad_prefix();
    ad.extend_from_slice(&header);
    let salt: [u8; 16] = drawn[0].clone().try_into().unwrap();
    assert_eq!(&message.ciphertext[..16], &salt);
    let okm = message_key_and_nonce(&mk, &salt);
    let outer = outer_okm(&mk, &salt);
    let o = outer_scalar(&mk, &salt);
    assert_eq!(o, scalar_mod_q(outer.as_ref()));
    // The envelope's generator is the conversation's base times o.
    assert_eq!(
        &envelope[1..49],
        &(G1Projective::from(conversation.first.base) * o).to_compressed()
    );
    assert!(ENVELOPE_SIZES.contains(&envelope.len()));
    assert!(message.bytes.len() < envelope.len() - ENVELOPE_OVERHEAD);
    (
        json!({
            "send": {
                "from": from.name,
                "kind": kind,
                "plaintext": hex(text),
                "chain_key": hex(chain_key.bytes()),
                "message_key": hex(mk.bytes()),
                "next_chain_key": hex(next.bytes()),
                "header": hex(header),
                "associated_data": hex(&ad),
                "salt": hex(salt),
                "aes_key": hex(&okm[..32]),
                "nonce": hex(&okm[32..]),
                "ratchet_ciphertext": hex(&message.ciphertext),
                "inner": hex(&message.bytes),
                "envelope_size": envelope.len(),
                "outer_okm": hex(outer.as_ref()),
                "outer_scalar": hex(o.to_bytes_be()),
                "outer_r": hex(&drawn[1]),
                "envelope": hex(&envelope),
            }
        }),
        envelope,
    )
}

/// The ratchet step a receive made, recomputed from the state before it.
fn step_json(
    rk: &Secret32,
    their: &[u8; 48],
    dh_before: &[u8; 48],
    after: &Conversation,
    drawn: &[Vec<u8>],
) -> Value {
    let (rk1, ckr) = kdf_rk(rk, dh_before);
    assert_eq!(drawn.len(), 1, "one new ratchet key");
    assert_eq!(after.ratchet.dhs.secret.bytes()[..], drawn[0][..]);
    let theirs = blstrs::G1Affine::from_compressed(their).unwrap();
    let dh2 = after.ratchet.dhs.dh(&theirs);
    let (rk2, cks) = kdf_rk(&rk1, &dh2);
    assert_eq!(after.ratchet.rk, rk2);
    assert_eq!(after.ratchet.cks.as_ref(), Some(&cks));
    json!({
        "receiving_dh": hex(dh_before),
        "root_key": hex(rk1.bytes()),
        "receiving_chain_key": hex(ckr.bytes()),
        "new_ratchet_secret": hex(&drawn[0]),
        "new_ratchet_public": hex(after.ratchet.dhs.public.to_compressed()),
        "sending_dh": hex(*dh2),
        "next_root_key": hex(rk2.bytes()),
        "sending_chain_key": hex(cks.bytes()),
    })
}

/// Records a receive on an existing conversation, and its ratchet step if it
/// made one.
fn receive(by: &mut Side, envelope: &[u8], at: u64, draw: &mut Seeded) -> Value {
    let message = opened(&by.key, envelope);
    let conversation = by.conversation.as_mut().unwrap();
    let before = conversation.ratchet.clone();
    let text = conversation.receive_with(&message, at, draw).unwrap();
    let drawn = draw.drain();
    let step = if drawn.is_empty() {
        Value::Null
    } else {
        let their = message.header.dh.to_compressed();
        step_json(
            &before.rk,
            &their,
            &before.dhs.dh(&message.header.dh),
            conversation,
            &drawn,
        )
    };
    json!({
        "receive": {
            "by": by.name,
            "at": at,
            "header": hex(message.header.to_bytes()),
            "ratchet_step": step,
            "plaintext": hex(&text),
        }
    })
}

/// Records the responder's first message: RatchetInitBob from SK and
/// `(x_B, w₀)`, then the first ratchet step.
fn accept(by: &mut Side, envelope: &[u8], at: u64, sk: &Secret32, draw: &mut Seeded) -> Value {
    let message = opened(&by.key, envelope);
    let (conversation, texts) =
        Conversation::accept_with(&by.key, &[(&message, at)], draw).unwrap();
    let drawn = draw.drain();
    let their = message.header.dh.to_compressed();
    let dh = (G1Projective::from(message.header.dh) * by.key.scalar()).to_compressed();
    let step = step_json(sk, &their, &dh, &conversation, &drawn);
    by.conversation = Some(conversation);
    json!({
        "receive": {
            "by": by.name,
            "at": at,
            "header": hex(message.header.to_bytes()),
            "ratchet_step": step,
            "plaintext": hex(texts[0].as_ref().unwrap()),
        }
    })
}

/// A hedged scalar's HMAC (§16.2): its message, its 64-byte output, and the
/// scalar, the output reduced mod q.
fn hedged_json(key: &blstrs::Scalar, message: &[u8]) -> (blstrs::Scalar, Value) {
    let okm = hedge_okm(key, message);
    let scalar = scalar_mod_q(&okm[..]);
    (
        scalar,
        json!({
            "message": hex(message),
            "hmac": hex(&okm[..]),
            "scalar": hex(scalar.to_bytes_be()),
        }),
    )
}

/// The start's values, and its stamp, which it sets. `handle` is `None` for
/// a continuation. A start from a handle draws `cid`, `b`'s aux, `e_A`,
/// `s_A` and `k`'s aux; a continuation `cid`, `e_A` and `s_A` (§16.3).
fn start_json(
    initiator: &mut Side,
    responder: &Side,
    handle: Option<&Register>,
    drawn: &[Vec<u8>],
    index: usize,
) -> (Value, Secret32) {
    let stamp = stamp_of(initiator.conversation.as_mut().unwrap(), index);
    let conversation = initiator.conversation.as_ref().unwrap();
    let first = &conversation.first;
    // The other draws, cid, e_A and s_A, and from a handle the aux of `b`
    // and of `k`.
    let aux = |i: usize| -> [u8; 32] { drawn[i].clone().try_into().unwrap() };
    let (rest, auxes) = match handle {
        Some(_) => {
            assert_eq!(drawn.len(), 5, "cid, b's aux, e_A, s_A, k's aux");
            ([&drawn[0], &drawn[2], &drawn[3]], Some((aux(1), aux(4))))
        }
        None => {
            assert_eq!(drawn.len(), 3, "cid, e_A, s_A");
            ([&drawn[0], &drawn[1], &drawn[2]], None)
        }
    };
    assert_eq!(rest[0][..], first.cid.0);
    let e = crate::keys::scalar_from_bytes(&rest[1].clone().try_into().unwrap()).unwrap();
    let s = crate::keys::scalar_from_bytes(&rest[2].clone().try_into().unwrap()).unwrap();
    let w0 = G1Projective::from(conversation.responder);
    let ephemeral_dh = (w0 * e).to_compressed();
    let static_dh = (w0 * initiator.key.scalar()).to_compressed();
    let sk = session_key(&ephemeral_dh, &static_dh, &conversation.first_bytes);
    // The responder computes the same from its side.
    let x = responder.key.scalar();
    assert_eq!(
        sk,
        session_key(
            &(G1Projective::from(first.ephemeral) * x).to_compressed(),
            &(G1Projective::from(first.initiator) * x).to_compressed(),
            &conversation.first_bytes,
        )
    );
    let init_dh = (w0 * s).to_compressed();
    let (rk, cks) = kdf_rk(&sk, &init_dh);
    assert_eq!(conversation.ratchet.rk, rk);
    let mut draws = json!({
        "cid": hex(rest[0]),
        "e_A": hex(rest[1]),
        "s_A": hex(rest[2]),
    });
    let mut base_scalar = Value::Null;
    let mut base_proof = Value::Null;
    if let (Some((aux_b, aux_k)), Some(handle)) = (auxes, handle) {
        draws["aux_b"] = json!(hex(aux_b));
        draws["aux_k"] = json!(hex(aux_k));
        // b, recomputed from its definition: the base and w₀ follow from it.
        let head = head_bytes(&first.cid, first.started_at, &first.to, first.replaces);
        let (b, b_json) = hedged_json(
            &initiator.key.scalar(),
            &base_scalar_message(handle, &head, &aux_b),
        );
        assert_eq!((handle.generator() * b).to_affine(), first.base);
        assert_eq!(
            (handle.public_value() * b).to_affine(),
            conversation.responder
        );
        base_scalar = b_json;
        // The proof, recomputed from its definition, k from b.
        let prefix = first.prefix_bytes();
        let (k, nonce) = hedged_json(
            &b,
            &base_nonce_message(handle, &first.base, &prefix, &aux_k),
        );
        assert_ne!(k, b);
        let commitment = (handle.generator() * k).to_affine();
        let challenge = base_challenge(handle, &first.base, &commitment, &prefix);
        let proof = first.proof.unwrap();
        assert_eq!(proof, prove_base_with_nonce(handle, &b, &k, &prefix));
        assert_eq!(proof.challenge, challenge);
        assert_eq!(proof.response, k + scalar_mod_q(&challenge) * b);
        assert!(first.proves_base(handle));
        base_proof = json!({
            "first_contact_prefix": hex(&prefix),
            "nonce": nonce,
            "commitment": hex(commitment.to_compressed()),
            "challenge": hex(challenge),
            "challenge_scalar": hex(scalar_mod_q(&challenge).to_bytes_be()),
            "response": hex(proof.response.to_bytes_be()),
        });
    }
    (
        json!({
            "initiator_secret_key": hex(initiator.key.scalar().to_bytes_be()),
            "responder_secret_key": hex(responder.key.scalar().to_bytes_be()),
            "handle": handle.map(register_json),
            "t": first.started_at,
            "to": hex(&first.to),
            "replaces": first.replaces.map(|cid| hex(cid.0)),
            "draws": draws,
            "base_scalar": base_scalar,
            "base_proof": base_proof,
            "stamp": stamp,
            "base": hex(first.base.to_compressed()),
            "initiator_public": hex(first.initiator.to_compressed()),
            "responder_public": hex(conversation.responder.to_compressed()),
            "ephemeral": hex(first.ephemeral.to_compressed()),
            "ratchet_public": hex(conversation.ratchet.dhs.public.to_compressed()),
            "first_contact": hex(&conversation.first_bytes),
            "ephemeral_dh": hex(ephemeral_dh),
            "static_dh": hex(static_dh),
            "session_key": hex(sk.bytes()),
            "init_dh": hex(init_dh),
            "root_key": hex(rk.bytes()),
            "sending_chain_key": hex(cks.bytes()),
        }),
        sk,
    )
}

fn side(name: &'static str, label: &str) -> Side {
    Side {
        name,
        key: key(label),
        conversation: None,
    }
}

/// Names the session and gives each receive `delivers`: the index of the
/// one send, from the other side, whose header it carries.
fn with_events(mut start: Value, name: &str, mut events: Vec<Value>) -> Value {
    let sends: Vec<(usize, Value, Value)> = events
        .iter()
        .enumerate()
        .filter_map(|(i, e)| {
            e.get("send")
                .map(|s| (i, s["from"].clone(), s["header"].clone()))
        })
        .collect();
    for event in &mut events {
        if let Some(receive) = event.get_mut("receive") {
            let matching: Vec<usize> = sends
                .iter()
                .filter(|(_, from, header)| *from != receive["by"] && *header == receive["header"])
                .map(|(i, _, _)| *i)
                .collect();
            assert_eq!(matching.len(), 1);
            receive["delivers"] = json!(matching[0]);
        }
    }
    start["name"] = json!(name);
    start["events"] = json!(events);
    start
}

/// Whether the base proof's challenge, as F carries it, is below q.
fn challenge_is_canonical(conversation: &Conversation) -> bool {
    let challenge = conversation.first.proof.unwrap().challenge;
    Option::<blstrs::Scalar>::from(blstrs::Scalar::from_bytes_be(&challenge)).is_some()
}

fn all_vectors() -> Value {
    let t = 1_800_000_000;
    let mut draw = Seeded::new("seedelf-messaging session v1 vectors");

    // 1. A first contact to a Seedelf's handle, with `to`, and replies both
    //    ways, one pair delivered out of order.
    let mut alice = side("initiator", "seedelf-messaging session v1 alice");
    let mut bob = side("responder", "seedelf-messaging session v1 bob");
    let bob_handle = handle(
        "seedelf-messaging session v1 bob",
        "seedelf-messaging session v1 bob's seedelf",
    );
    let mut to = hex::decode("5eed0e1f").unwrap();
    to.extend((0u8..28).map(|i| i.wrapping_mul(37)));
    alice.conversation =
        Some(Conversation::start_with(&alice.key, &bob_handle, &to, t, &mut draw).unwrap());
    let drawn = draw.drain();
    let (start, sk) = start_json(&mut alice, &bob, Some(&bob_handle), &drawn, 0);
    let mut events = Vec::new();
    let (event, m1) = send(
        &mut alice,
        &bob,
        b"Hello from someone you don't know yet.",
        &mut draw,
    );
    assert_eq!(m1.len(), 2048);
    events.push(event);
    let long = "To a Seedelf's full name, F with its proof and the stamp leave \
                no room in 512 bytes: every first message is at least 2 KiB."
        .as_bytes();
    let (event, m2) = send(&mut alice, &bob, long, &mut draw);
    events.push(event);
    events.push(accept(&mut bob, &m1, t + 60, &sk, &mut draw));
    events.push(receive(&mut bob, &m2, t + 61, &mut draw));
    let (event, r1) = send(&mut bob, &alice, b"Hi. Who is this?", &mut draw);
    events.push(event);
    events.push(receive(&mut alice, &r1, t + 120, &mut draw));
    let (event, m3) = send(&mut alice, &bob, "A friend 🌱".as_bytes(), &mut draw);
    events.push(event);
    events.push(receive(&mut bob, &m3, t + 180, &mut draw));
    let (event, r2) = send(&mut bob, &alice, b"Good to hear.", &mut draw);
    events.push(event);
    let (event, r3) = send(&mut bob, &alice, b"This one arrives first.", &mut draw);
    events.push(event);
    events.push(receive(&mut alice, &r3, t + 240, &mut draw));
    events.push(receive(&mut alice, &r2, t + 241, &mut draw));
    let first = with_events(
        start,
        "a first contact to a handle, then replies both ways",
        events,
    );

    // 2. The responder continues that conversation with its identities.
    let old_alice = alice.conversation.take().unwrap();
    let old_bob = bob.conversation.take().unwrap();
    let mut bob2 = Side {
        name: "initiator",
        key: key("seedelf-messaging session v1 bob"),
        conversation: Some(
            Conversation::continue_with(&bob.key, &old_bob, t + 86_400, &mut draw).unwrap(),
        ),
    };
    let mut alice2 = side("responder", "seedelf-messaging session v1 alice");
    let drawn = draw.drain();
    let (start, sk) = start_json(&mut bob2, &alice2, None, &drawn, 1);
    let mut events = Vec::new();
    let (event, c1) = send(
        &mut bob2,
        &alice2,
        b"Starting again, same identities.",
        &mut draw,
    );
    events.push(event);
    // Alice's rules call it a verified continuation.
    let mut inbox =
        Inbox::from_parts(vec![old_alice], Default::default(), Default::default()).unwrap();
    let received = inbox
        .receive_opened(
            &alice2.key,
            &[],
            &opened(&alice2.key, &c1),
            t + 86_460,
            &mut Seeded::new("judge"),
        )
        .unwrap();
    assert!(matches!(received, Received::Request { .. }));
    let request = inbox.requests().get(opened(&alice2.key, &c1).cid).unwrap();
    assert_eq!(
        request.continues(),
        Some(Continues::Verified(old_bob.cid()))
    );
    events.push(accept(&mut alice2, &c1, t + 86_460, &sk, &mut draw));
    let (event, c2) = send(&mut alice2, &bob2, b"Fine by me.", &mut draw);
    events.push(event);
    events.push(receive(&mut bob2, &c2, t + 86_520, &mut draw));
    let mut second = with_events(start, "the responder continues the conversation", events);
    second["continues"] = json!("a first contact to a handle, then replies both ways");

    // 3. The smallest first contact: a root register under a 1-byte `to`,
    //    no `replaces`; 18 bytes of text fill 512 bytes, 19 don't.
    let mut carol = side("initiator", "seedelf-messaging session v1 carol");
    let mut dave = side("responder", "seedelf-messaging session v1 dave");
    let dave_root = dave.key.register();
    carol.conversation =
        Some(Conversation::start_with(&carol.key, &dave_root, b"d", t + 7, &mut draw).unwrap());
    let drawn = draw.drain();
    let (start, sk) = start_json(&mut carol, &dave, Some(&dave_root), &drawn, 2);
    let mut events = Vec::new();
    let (event, d1) = send(&mut carol, &dave, &[b'x'; 18], &mut draw);
    assert_eq!(d1.len(), 512);
    events.push(event);
    let (event, d2) = send(&mut carol, &dave, &[b'y'; 19], &mut draw);
    assert_eq!(d2.len(), 2048);
    events.push(event);
    let (event, d3) = send(&mut carol, &dave, b"", &mut draw);
    events.push(event);
    events.push(accept(&mut dave, &d3, t + 8, &sk, &mut draw));
    events.push(receive(&mut dave, &d1, t + 9, &mut draw));
    events.push(receive(&mut dave, &d2, t + 10, &mut draw));
    let third = with_events(
        start,
        "the smallest first contact, received last first",
        events,
    );

    // 4. What the first three leave unpinned: a first message from a handle
    //    with a full name and a `replaces` (F at its largest, 282 bytes); a
    //    proof whose challenge is at least q, so F must carry it unreduced;
    //    an 8 KiB envelope; and a ratchet step that skips the rest of the
    //    old receiving chain (PN − Nr = 1), whose skipped message comes last.
    //    Its draws come from the first label whose challenge is at least q.
    let mut erin = side("initiator", "seedelf-messaging session v1 erin");
    let mut frank = side("responder", "seedelf-messaging session v1 frank");
    let frank_handle = handle(
        "seedelf-messaging session v1 frank",
        "seedelf-messaging session v1 frank's seedelf",
    );
    let mut name = hex::decode("5eed0e1f").unwrap();
    name.extend((0u8..28).map(|i| i.wrapping_mul(53).wrapping_add(11)));
    let replaces = crate::session::first_contact::ConversationId([0x2a; 16]);
    let mut draw = (0..)
        .map(|i| {
            Seeded::new(&format!(
                "seedelf-messaging session v1 vectors, session 4, try {i}"
            ))
        })
        .find(|draw| {
            let mut trial = Seeded::new(&draw.label);
            let c = Conversation::begin(
                &erin.key,
                Origin::Handle(&frank_handle),
                &name,
                Some(replaces),
                t + 3600,
                &mut trial,
            )
            .unwrap();
            !challenge_is_canonical(&c)
        })
        .unwrap();
    erin.conversation = Some(
        Conversation::begin(
            &erin.key,
            Origin::Handle(&frank_handle),
            &name,
            Some(replaces),
            t + 3600,
            &mut draw,
        )
        .unwrap(),
    );
    assert!(
        !challenge_is_canonical(erin.conversation.as_ref().unwrap()),
        "session 4's challenge is at least q, so F carries it unreduced"
    );
    let drawn = draw.drain();
    let (start, sk) = start_json(&mut erin, &frank, Some(&frank_handle), &drawn, 3);
    assert_eq!(erin.conversation.as_ref().unwrap().first_bytes.len(), 282);
    let mut events = Vec::new();
    let (event, e1) = send(
        &mut erin,
        &frank,
        b"Starting fresh: I lost the old one.",
        &mut draw,
    );
    assert_eq!(e1.len(), 2048);
    events.push(event);
    let (event, e2) = send(&mut erin, &frank, &[b'z'; 3000], &mut draw);
    assert_eq!(e2.len(), 8192);
    events.push(event);
    events.push(accept(&mut frank, &e1, t + 3610, &sk, &mut draw));
    events.push(receive(&mut frank, &e2, t + 3611, &mut draw));
    let (event, f1) = send(&mut frank, &erin, b"one", &mut draw);
    events.push(event);
    let (event, f2) = send(&mut frank, &erin, b"two, read last", &mut draw);
    events.push(event);
    events.push(receive(&mut erin, &f1, t + 3620, &mut draw));
    let (event, e3) = send(&mut erin, &frank, b"got one", &mut draw);
    events.push(event);
    events.push(receive(&mut frank, &e3, t + 3630, &mut draw));
    let (event, f3) = send(&mut frank, &erin, b"three, after a step", &mut draw);
    events.push(event);
    // PN = 2 against Erin's Nr = 1: the step stores two's key.
    events.push(receive(&mut erin, &f3, t + 3640, &mut draw));
    assert_eq!(erin.conversation.as_ref().unwrap().missing(), 1);
    events.push(receive(&mut erin, &f2, t + 3650, &mut draw));
    assert_eq!(erin.conversation.as_ref().unwrap().missing(), 0);
    let fourth = with_events(
        start,
        "a fresh start from a handle with replaces, an 8 KiB message, and a step past an unread message",
        events,
    );

    json!({
        "description": "Seedelf Messaging session layer v1 test vectors (docs/protocol.md §3, §4, §9 and §16). Scalars are 32-byte big-endian; points are 48-byte compressed G1. Every random value is given under `draws`, `salt`, `outer_r` and `new_ratchet_secret`; b and the base proof's k aren't drawn but derived from `aux_b` and `aux_k` (§16.2), with their HMACs under `base_scalar` and `base_proof.nonce`; the first-contact stamp's nonce is the first from 0 with `bits` of work. The outer envelope is v1 (tests/vectors/messaging_v1.json) with b = outer_scalar and the given r, sealing the inner message padded with 0x80 then zeros to envelope_size - 161 bytes.",
        "version": 1,
        "labels": {
            "session_salt": String::from_utf8(SESSION_SALT.to_vec()).unwrap(),
            "session_info": String::from_utf8(SESSION_INFO.to_vec()).unwrap(),
            "base_scalar_label": String::from_utf8(BASE_SCALAR_LABEL.to_vec()).unwrap(),
            "base_nonce_label": String::from_utf8(BASE_NONCE_LABEL.to_vec()).unwrap(),
            "base_label": String::from_utf8(BASE_LABEL.to_vec()).unwrap(),
            "stamp_label": String::from_utf8(FIRST_STAMP_LABEL.to_vec()).unwrap(),
            "root_info": String::from_utf8(ROOT_INFO.to_vec()).unwrap(),
            "message_info": String::from_utf8(MESSAGE_INFO.to_vec()).unwrap(),
            "outer_info": String::from_utf8(OUTER_INFO.to_vec()).unwrap(),
        },
        "first_contact_stamp_bits": FIRST_CONTACT_STAMP_BITS,
        "envelope_sizes": ENVELOPE_SIZES,
        "sessions": [first, second, third, fourth],
    })
}

/// The vectors file is what the code computes. `RECORD_MESSAGING_SESSION_VECTORS=1`
/// rewrites it, for a deliberate change of format only: other
/// implementations are held to these bytes.
#[test]
fn session_vectors_match_the_file() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(VECTORS);
    let computed = all_vectors();
    if recording() {
        let text = serde_json::to_string_pretty(&computed).expect("serializes") + "\n";
        std::fs::write(&path, text).expect("writes the vectors");
    }
    let recorded: Value =
        serde_json::from_str(&std::fs::read_to_string(&path).expect("reads the vectors"))
            .expect("parses the vectors");
    assert_eq!(computed, recorded);
}

/// The file's b and k are HMAC-SHA-512 of exactly §16.2's messages, built
/// here from the file's other values and the labels as §16.2 spells them,
/// under x_A and b: what another implementation is held to, checked without
/// the crate's own builders.
#[test]
fn the_files_b_and_k_are_the_hmacs_of_their_specified_messages() {
    use hmac::{Hmac, Mac};
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(VECTORS);
    let file: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let bytes = |value: &Value| hex::decode(value.as_str().unwrap()).unwrap();
    let hmac = |key: &[u8], message: &[u8]| {
        let mut mac = <Hmac<sha2::Sha512> as Mac>::new_from_slice(key).unwrap();
        mac.update(message);
        mac.finalize().into_bytes().to_vec()
    };
    let point = |compressed: &[u8]| {
        G1Projective::from(
            blstrs::G1Affine::from_compressed(&compressed.try_into().unwrap()).unwrap(),
        )
    };
    let scalar_label = b"Seedelf-Messaging|v1|session|base-scalar";
    let nonce_label = b"Seedelf-Messaging|v1|session|base-nonce";
    assert_eq!(
        file["labels"]["base_scalar_label"]
            .as_str()
            .unwrap()
            .as_bytes(),
        scalar_label
    );
    assert_eq!(
        file["labels"]["base_nonce_label"]
            .as_str()
            .unwrap()
            .as_bytes(),
        nonce_label
    );
    let mut from_handles = 0;
    for session in file["sessions"].as_array().unwrap() {
        let draws = &session["draws"];
        if session["handle"].is_null() {
            assert!(session["base_scalar"].is_null() && session["base_proof"].is_null());
            assert!(draws.get("aux_b").is_none() && draws.get("aux_k").is_none());
            continue;
        }
        let g = bytes(&session["handle"]["generator"]);
        let v = bytes(&session["handle"]["public_value"]);
        let f = bytes(&session["first_contact"]);
        let to = bytes(&session["to"]);
        let replaces = if session["replaces"].is_null() { 0 } else { 16 };
        // F's head: cid, t, len, to, len, replaces.
        let head = &f[..16 + 8 + 1 + to.len() + 1 + replaces];

        // b, keyed by x_A's 32 bytes.
        let mut message = scalar_label.to_vec();
        for part in [&g, &v, &head.to_vec(), &bytes(&draws["aux_b"])] {
            message.extend_from_slice(part);
        }
        assert_eq!(bytes(&session["base_scalar"]["message"]), message);
        let okm = hmac(&bytes(&session["initiator_secret_key"]), &message);
        assert_eq!(bytes(&session["base_scalar"]["hmac"]), okm);
        let b = scalar_mod_q(&okm);
        assert_eq!(bytes(&session["base_scalar"]["scalar"]), b.to_bytes_be());
        let base = bytes(&session["base"]);
        assert_eq!((point(&g) * b).to_compressed()[..], base[..]);
        assert_eq!(
            (point(&v) * b).to_compressed()[..],
            bytes(&session["responder_public"])[..]
        );

        // k, keyed by b's 32 bytes, over everything the challenge covers but T.
        let proof = &session["base_proof"];
        let prefix = bytes(&proof["first_contact_prefix"]);
        assert_eq!(prefix[..], f[..f.len() - 64]);
        let mut message = nonce_label.to_vec();
        for part in [&g, &v, &base, &prefix, &bytes(&draws["aux_k"])] {
            message.extend_from_slice(part);
        }
        assert_eq!(bytes(&proof["nonce"]["message"]), message);
        let okm = hmac(&b.to_bytes_be(), &message);
        assert_eq!(bytes(&proof["nonce"]["hmac"]), okm);
        let k = scalar_mod_q(&okm);
        assert_eq!(bytes(&proof["nonce"]["scalar"]), k.to_bytes_be());
        assert_ne!(k, b);
        assert_eq!(
            (point(&g) * k).to_compressed()[..],
            bytes(&proof["commitment"])[..]
        );
        let challenge = bytes(&proof["challenge"]);
        let z = k + scalar_mod_q(&challenge) * b;
        assert_eq!(bytes(&proof["response"]), z.to_bytes_be());
        assert_eq!(
            f[f.len() - 64..],
            [challenge, z.to_bytes_be().to_vec()].concat()
        );
        from_handles += 1;
    }
    assert_eq!(from_handles, 3);
}

/// The generator's keys are what their labels say: a check on the helper,
/// so the file's keys can be rebuilt from their labels too.
#[test]
fn the_vector_keys_come_from_their_labels() {
    let alice = key("seedelf-messaging session v1 alice");
    assert_eq!(
        alice.scalar(),
        test_scalar("seedelf-messaging session v1 alice")
    );
}
