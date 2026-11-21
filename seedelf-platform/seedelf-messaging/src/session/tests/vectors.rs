//! The session layer's test vectors (tests/vectors/messaging_session_v1.json):
//! three conversations with every intermediate value, from fixed draws,
//! through the crate's own functions. The generator checks each value it
//! records against the state it came from.

use std::path::PathBuf;

use blstrs::G1Projective;
use serde_json::{Value, json};

use super::support::{Seeded, handle, key, opened, test_scalar};
use crate::SecretKey;
use crate::envelope::ENVELOPE_OVERHEAD;
use crate::register::Register;
use crate::session::conversation::Conversation;
use crate::session::first_contact::{SESSION_INFO, SESSION_SALT, session_key};
use crate::session::inbox::{Continues, Inbox, Received};
use crate::session::ratchet::{MESSAGE_INFO, ROOT_INFO, kdf_ck, kdf_rk, message_key_and_nonce};
use crate::session::secret::Secret32;
use crate::session::wire::ENVELOPE_SIZES;

const VECTORS: &str = "tests/vectors/messaging_session_v1.json";

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

/// Records a send: the chain step, ENCRYPT's values, the inner message, and
/// the envelope with its draws (salt, then `b`, then `r`).
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
    assert_eq!(drawn.len(), 3);
    let (next, mk) = kdf_ck(&chain_key);
    assert_eq!(conversation.ratchet.cks.as_ref(), Some(&next));

    let message = opened(&to.key, &envelope);
    let header = message.header.to_bytes();
    let mut ad = conversation.ad_prefix();
    ad.extend_from_slice(&header);
    let salt: [u8; 16] = drawn[0].clone().try_into().unwrap();
    assert_eq!(&message.ciphertext[..16], &salt);
    let okm = message_key_and_nonce(&mk, &salt);
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
                "outer_b": hex(&drawn[1]),
                "outer_r": hex(&drawn[2]),
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

/// The start's values. `handle` is `None` for a continuation.
fn start_json(
    initiator: &Side,
    responder: &Side,
    handle: Option<&Register>,
    drawn: &[Vec<u8>],
) -> (Value, Secret32) {
    let conversation = initiator.conversation.as_ref().unwrap();
    let first = &conversation.first;
    let (b, rest) = match handle {
        Some(_) => (Some(&drawn[0]), &drawn[1..]),
        None => (None, drawn),
    };
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
        "cid": hex(&rest[0]),
        "e_A": hex(&rest[1]),
        "s_A": hex(&rest[2]),
    });
    if let Some(b) = b {
        draws["b"] = json!(hex(b));
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
    let (start, sk) = start_json(&alice, &bob, Some(&bob_handle), &draw.drain());
    let mut events = Vec::new();
    let (event, m1) = send(
        &mut alice,
        &bob,
        b"Hello from someone you don't know yet.",
        &mut draw,
    );
    events.push(event);
    let long = "A first message long enough for the second envelope size: \
                it carries F, so 92 bytes of text no longer fit 512 bytes."
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
            Conversation::continue_with(&bob.key, &old_bob, b"", t + 86_400, &mut draw).unwrap(),
        ),
    };
    let mut alice2 = side("responder", "seedelf-messaging session v1 alice");
    let (start, sk) = start_json(&bob2, &alice2, None, &draw.drain());
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

    // 3. The smallest first contact: a root register, no `to`, no
    //    `replaces`; 91 bytes of text fill 512 bytes, 92 don't.
    let mut carol = side("initiator", "seedelf-messaging session v1 carol");
    let mut dave = side("responder", "seedelf-messaging session v1 dave");
    let dave_root = dave.key.register();
    carol.conversation =
        Some(Conversation::start_with(&carol.key, &dave_root, b"", t + 7, &mut draw).unwrap());
    let (start, sk) = start_json(&carol, &dave, Some(&dave_root), &draw.drain());
    let mut events = Vec::new();
    let (event, d1) = send(&mut carol, &dave, &[b'x'; 91], &mut draw);
    assert_eq!(d1.len(), 512);
    events.push(event);
    let (event, d2) = send(&mut carol, &dave, &[b'y'; 92], &mut draw);
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

    json!({
        "description": "Seedelf Messaging session layer v1 test vectors (docs/protocol.md §3, §4, §9 and §16). Scalars are 32-byte big-endian; points are 48-byte compressed G1. Every random value is given under `draws`, `salt`, `outer_b`, `outer_r` and `new_ratchet_secret`. The outer envelope is v1 (tests/vectors/messaging_v1.json) with the given b and r, sealing the inner message padded with 0x80 then zeros to envelope_size - 161 bytes.",
        "version": 1,
        "labels": {
            "session_salt": String::from_utf8(SESSION_SALT.to_vec()).unwrap(),
            "session_info": String::from_utf8(SESSION_INFO.to_vec()).unwrap(),
            "root_info": String::from_utf8(ROOT_INFO.to_vec()).unwrap(),
            "message_info": String::from_utf8(MESSAGE_INFO.to_vec()).unwrap(),
        },
        "envelope_sizes": ENVELOPE_SIZES,
        "sessions": [first, second, third],
    })
}

/// The vectors file is what the code computes. `RECORD_MESSAGING_SESSION_VECTORS=1`
/// rewrites it, for a deliberate change of format only: other
/// implementations are held to these bytes.
#[test]
fn session_vectors_match_the_file() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(VECTORS);
    let computed = all_vectors();
    if std::env::var("RECORD_MESSAGING_SESSION_VECTORS").as_deref() == Ok("1") {
        let text = serde_json::to_string_pretty(&computed).expect("serializes") + "\n";
        std::fs::write(&path, text).expect("writes the vectors");
    }
    let recorded: Value =
        serde_json::from_str(&std::fs::read_to_string(&path).expect("reads the vectors"))
            .expect("parses the vectors");
    assert_eq!(computed, recorded);
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
