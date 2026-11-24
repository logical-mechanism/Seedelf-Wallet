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

use super::support::{Seeded, handle, identity, key, off_curve, opened, outside_g1, test_scalar};
use crate::HEADER_LEN;
use crate::SecretKey;
use crate::envelope::ENVELOPE_OVERHEAD;
use crate::keys::scalar_mod_q;
use crate::register::Register;
use crate::relay::{find_stamp, stamp_bits};
use crate::session::conversation::{Conversation, Origin};
use crate::session::draw::hedge_okm;
use crate::session::first_contact::{
    BASE_LABEL, BASE_NONCE_LABEL, BASE_SCALAR_LABEL, FIRST_CONTACT_STAMP_BITS, FIRST_STAMP_LABEL,
    KEYS_CONTINUATION_LABEL, KEYS_HANDLE_LABEL, KEYS_NONCE_A_LABEL, KEYS_NONCE_E_LABEL,
    KEYS_NONCE_S_LABEL, KeysProof, KeysStatement, SESSION_INFO, SESSION_SALT, base_challenge,
    base_commitments, base_nonce_message, base_scalar_message, head_bytes, prove_base_with,
    session_key,
};
use crate::session::inbox::{Continues, Inbox, Received};
use crate::session::ratchet::{
    ENVELOPE_EPHEMERAL_INFO, MESSAGE_INFO, OUTER_INFO, ROOT_INFO, envelope_ephemeral_okm,
    envelope_ephemeral_scalar, kdf_ck, kdf_rk, message_key_and_nonce, outer_okm, outer_scalar,
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
/// outer scalar o and the envelope's r, both derived from the message key
/// and the salt, and the envelope. A send draws its salt alone.
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
    assert_eq!(drawn.len(), 1, "a send draws its salt alone");
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
    let ephemeral = envelope_ephemeral_okm(&mk, &salt);
    let r = envelope_ephemeral_scalar(&mk, &salt);
    assert_eq!(r, scalar_mod_q(ephemeral.as_ref()));
    // The envelope's generator is the conversation's base times o, its tag
    // that of the reader's public value times o, and its ephemeral point
    // the generator times r.
    let p = G1Projective::from(conversation.first.base) * o;
    let reader_value = if from.name == "initiator" {
        conversation.responder
    } else {
        conversation.first.initiator
    };
    let tag: [u8; 32] = Sha256::new()
        .chain_update(b"Seedelf-Messaging|v1|envelope|tag")
        .chain_update((G1Projective::from(reader_value) * o).to_compressed())
        .finalize()
        .into();
    assert_eq!(&envelope[1..49], &p.to_compressed());
    assert_eq!(&envelope[49..81], &tag);
    assert_eq!(&envelope[81..HEADER_LEN], &(p * r).to_compressed());
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
                "envelope_ephemeral_okm": hex(ephemeral.as_ref()),
                "envelope_ephemeral_scalar": hex(r.to_bytes_be()),
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

/// A drawn scalar from its logged bytes.
fn drawn_scalar(drawn: &[u8]) -> blstrs::Scalar {
    crate::keys::scalar_from_bytes(&drawn.try_into().unwrap()).unwrap()
}

fn point_json(point: &blstrs::G1Affine) -> Value {
    json!(hex(point.to_compressed()))
}

fn scalar_json(scalar: &blstrs::Scalar) -> Value {
    json!(hex(scalar.to_bytes_be()))
}

/// The keys proof (§16.2), recomputed from its definition: `M`, each
/// nonce's HMAC, the commitments, the challenge and the responses, checked
/// against the proof F carries.
fn keys_proof_json(
    statement: &KeysStatement,
    proof: &KeysProof,
    secrets: (&blstrs::Scalar, &blstrs::Scalar, &blstrs::Scalar),
    keys_draws: &[Vec<u8>],
) -> Value {
    let (x, e, s) = secrets;
    let p0 = G1Projective::from(statement.base);
    assert!(statement.verifies(proof));
    let commitments = statement.commitments_of(proof);
    let challenge = statement.challenge(&commitments);
    let c = scalar_mod_q(&challenge);
    match *proof {
        KeysProof::Handle {
            c1,
            c2,
            z1,
            z2,
            ze,
            zs,
        } => {
            assert_eq!(keys_draws.len(), 3, "c2, z2, aux");
            let (c2_bytes, z2_bytes, aux) = (&keys_draws[0], &keys_draws[1], &keys_draws[2]);
            assert_eq!((c2, z2), (drawn_scalar(c2_bytes), drawn_scalar(z2_bytes)));
            let parts = [&c2_bytes[..], &z2_bytes[..], &aux[..]];
            let (ke, nonce_e) =
                hedged_json(e, &statement.nonce_message(KEYS_NONCE_E_LABEL, &parts));
            let (ks, nonce_s) =
                hedged_json(s, &statement.nonce_message(KEYS_NONCE_S_LABEL, &parts));
            let (te, ts) = ((p0 * ke).to_affine(), (p0 * ks).to_affine());
            assert_eq!((te, ts), (commitments.te, commitments.ts));
            let (k1, nonce_a) = hedged_json(
                x,
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
            let t1 = (p0 * k1).to_affine();
            assert_eq!(Some(t1), commitments.t1);
            assert_eq!(
                (c1, z1, ze, zs),
                (c - c2, k1 + (c - c2) * x, ke + c * e, ks + c * s)
            );
            json!({
                "form": "handle",
                "message": hex(statement.message()),
                "nonces": { "e": nonce_e, "s": nonce_s, "a": nonce_a },
                "commitments": {
                    "t_e": point_json(&te),
                    "t_s": point_json(&ts),
                    "t1": point_json(&t1),
                    "t2": point_json(&commitments.t2.unwrap()),
                },
                "challenge": hex(challenge),
                "challenge_scalar": scalar_json(&c),
                "proof": {
                    "c1": scalar_json(&c1),
                    "c2": scalar_json(&c2),
                    "z1": scalar_json(&z1),
                    "z2": scalar_json(&z2),
                    "z_e": scalar_json(&ze),
                    "z_s": scalar_json(&zs),
                },
            })
        }
        KeysProof::Continuation { c: claimed, ze, zs } => {
            assert_eq!(keys_draws.len(), 1, "aux");
            let parts = [&keys_draws[0][..]];
            let (ke, nonce_e) =
                hedged_json(e, &statement.nonce_message(KEYS_NONCE_E_LABEL, &parts));
            let (ks, nonce_s) =
                hedged_json(s, &statement.nonce_message(KEYS_NONCE_S_LABEL, &parts));
            let (te, ts) = ((p0 * ke).to_affine(), (p0 * ks).to_affine());
            assert_eq!((te, ts), (commitments.te, commitments.ts));
            assert_eq!((claimed, ze, zs), (c, ke + c * e, ks + c * s));
            json!({
                "form": "continuation",
                "message": hex(statement.message()),
                "nonces": { "e": nonce_e, "s": nonce_s },
                "commitments": { "t_e": point_json(&te), "t_s": point_json(&ts) },
                "challenge": hex(challenge),
                "challenge_scalar": scalar_json(&c),
                "proof": {
                    "c": scalar_json(&claimed),
                    "z_e": scalar_json(&ze),
                    "z_s": scalar_json(&zs),
                },
            })
        }
    }
}

/// The start's values, and its stamp, which it sets. `handle` is `None` for
/// a continuation. A start from a handle draws `cid`, `b`'s aux, `e_A`,
/// `s_A`, the base proof's `c₂`, `z₂` and aux, and the keys proof's `c₂`,
/// `z₂` and aux; a continuation `cid`, `e_A`, `s_A` and the keys proof's aux
/// (§16.3).
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
    let aux = |i: usize| -> [u8; 32] { drawn[i].clone().try_into().unwrap() };
    // cid, e_A and s_A; from a handle b's aux and the base proof's draws;
    // then the keys proof's draws.
    let (rest, base_draws, keys_draws) = match handle {
        Some(_) => {
            assert_eq!(
                drawn.len(),
                10,
                "cid, b's aux, e_A, s_A, the base proof's c2, z2, aux, the keys proof's c2, z2, aux"
            );
            (
                [&drawn[0], &drawn[2], &drawn[3]],
                Some((aux(1), &drawn[4..7])),
                &drawn[7..],
            )
        }
        None => {
            assert_eq!(drawn.len(), 4, "cid, e_A, s_A, the keys proof's aux");
            ([&drawn[0], &drawn[1], &drawn[2]], None, &drawn[3..])
        }
    };
    assert_eq!(rest[0][..], first.cid.0);
    let e = drawn_scalar(rest[1]);
    let s = drawn_scalar(rest[2]);
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
    if let (Some((aux_b, base)), Some(handle)) = (base_draws, handle) {
        draws["aux_b"] = json!(hex(aux_b));
        draws["base_c2"] = json!(hex(&base[0]));
        draws["base_z2"] = json!(hex(&base[1]));
        draws["aux_k"] = json!(hex(&base[2]));
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
        // The base proof, recomputed from its definition, k from b.
        let prefix = first.prefix_bytes();
        let (c2, z2) = (drawn_scalar(&base[0]), drawn_scalar(&base[1]));
        let aux_k: [u8; 32] = base[2].clone().try_into().unwrap();
        let (k, nonce) = hedged_json(
            &b,
            &base_nonce_message(handle, &first.base, &prefix, (&c2, &z2), &aux_k),
        );
        assert_ne!(k, b);
        let proof = first.proof.unwrap();
        assert_eq!(proof, prove_base_with(handle, &b, &k, (&c2, &z2), &prefix));
        let (t1, t2) = base_commitments(handle, &first.base, &proof);
        assert_eq!(t1, (handle.generator() * k).to_affine());
        let challenge = base_challenge(handle, &first.base, (&t1, &t2), &prefix);
        assert_eq!(proof.c1 + proof.c2, scalar_mod_q(&challenge));
        assert!(first.proves_base(handle));
        base_proof = json!({
            "first_contact_prefix": hex(&prefix),
            "nonce": nonce,
            "commitments": { "t1": point_json(&t1), "t2": point_json(&t2) },
            "challenge": hex(challenge),
            "challenge_scalar": scalar_json(&scalar_mod_q(&challenge)),
            "c1": scalar_json(&proof.c1),
            "c2": scalar_json(&proof.c2),
            "z1": scalar_json(&proof.z1),
            "z2": scalar_json(&proof.z2),
        });
    }
    match handle {
        Some(_) => {
            draws["keys_c2"] = json!(hex(&keys_draws[0]));
            draws["keys_z2"] = json!(hex(&keys_draws[1]));
            draws["aux_keys"] = json!(hex(&keys_draws[2]));
        }
        None => draws["aux_keys"] = json!(hex(&keys_draws[0])),
    }
    // The keys proof, as the reader checks it: its w₀ and the header key.
    let statement = KeysStatement::of(
        first,
        &conversation.responder,
        &conversation.ratchet.dhs.public,
    );
    assert!(first.proves_keys(
        &(G1Projective::from(first.base) * x).to_affine(),
        &conversation.ratchet.dhs.public
    ));
    let keys_proof = keys_proof_json(
        &statement,
        &first.keys_proof.unwrap(),
        (&initiator.key.scalar(), &e, &s),
        keys_draws,
    );
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
            "keys_proof": keys_proof,
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

/// The group order q, big-endian.
const GROUP_ORDER: &str = "73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001";

/// What a reader makes of F's proof for `handle` (§16.2, §16.4): `ok`, or
/// the refusal's code, the crate's error in snake case as seedelf-wasm
/// names it. F is parsed first.
fn judge_base_proof(handle: &Register, first_contact: &[u8]) -> &'static str {
    match crate::session::first_contact::FirstContact::from_bytes(first_contact) {
        Err(crate::Error::InvalidMessage) => "invalid_message",
        Err(crate::Error::InvalidEncoding) => "invalid_encoding",
        Err(crate::Error::NotInSubgroup) => "not_in_subgroup",
        Err(crate::Error::IdentityPoint) => "identity_point",
        Err(other) => panic!("no base proof check refuses with {other:?}"),
        Ok(first) if first.proves_base(handle) => "ok",
        Ok(_) => "invalid_base_proof",
    }
}

/// The base proof's checks: what the sessions don't pin of how a reader
/// takes F and its base proof for a handle (§16.1, §16.2), each built from a
/// session's recorded values. Each gives the handle, F and the result.
fn base_proof_checks(sessions: &[&Value]) -> Value {
    use blstrs::Scalar;
    use ff::Field;
    let bytes = |value: &Value| hex::decode(value.as_str().unwrap()).unwrap();
    let scalar = |value: &Value| {
        Option::<Scalar>::from(Scalar::from_bytes_be(&bytes(value).try_into().unwrap())).unwrap()
    };
    let handle_of = |session: &Value| {
        Register::from_bytes(
            &bytes(&session["handle"]["generator"]).try_into().unwrap(),
            &bytes(&session["handle"]["public_value"])
                .try_into()
                .unwrap(),
        )
        .unwrap()
    };
    let q: [u8; 32] = hex::decode(GROUP_ORDER).unwrap().try_into().unwrap();
    // From a handle, F ends with the base proof's 128 bytes, c₁ ‖ c₂ ‖ z₁ ‖
    // z₂, then the keys proof's 192.
    let base_at = |first_contact: &[u8]| first_contact.len() - 192 - 128;
    let with_proof = |first_contact: &[u8], proof: [Scalar; 4]| {
        let at = base_at(first_contact);
        let mut out = first_contact.to_vec();
        for (i, scalar) in proof.iter().enumerate() {
            out[at + 32 * i..at + 32 * (i + 1)].copy_from_slice(&scalar.to_bytes_be());
        }
        out
    };
    let (one, four) = (sessions[0], sessions[3]);
    let f1 = bytes(&one["first_contact"]);
    let f4 = bytes(&four["first_contact"]);
    let proof1 = &one["base_proof"];
    let [c1, c2, z1, z2] = ["c1", "c2", "z1", "z2"].map(|name| scalar(&proof1[name]));
    let handle1 = handle_of(one);
    let b =
        crate::keys::scalar_from_bytes(&bytes(&one["base_scalar"]["scalar"]).try_into().unwrap())
            .unwrap();
    let k = scalar(&proof1["nonce"]["scalar"]);
    let base = blstrs::G1Affine::from_compressed(&bytes(&one["base"]).try_into().unwrap()).unwrap();
    let prefix = &f1[..base_at(&f1)];
    assert_eq!(prefix, bytes(&proof1["first_contact_prefix"]));

    // A proof whose nonce is 0: T₁ = O, z₁ = c₁·b.
    let zero = prove_base_with(&handle1, &b, &Scalar::ZERO, (&c2, &z2), prefix);
    // The reader's own proof: b's branch simulated, the handle's key's
    // proved with x_B, for session 1's p₀.
    let bob =
        SecretKey::from_bytes(&bytes(&one["responder_secret_key"]).try_into().unwrap()).unwrap();
    let (r_c1, r_z1, r_k) = (
        test_scalar("the reader's c1"),
        test_scalar("the reader's z1"),
        test_scalar("the reader's nonce"),
    );
    let r_t1 = (handle1.generator() * r_z1 - G1Projective::from(base) * r_c1).to_affine();
    let r_t2 = (handle1.generator() * r_k).to_affine();
    let r_c2 = scalar_mod_q(&base_challenge(&handle1, &base, (&r_t1, &r_t2), prefix)) - r_c1;
    let readers = [r_c1, r_c2, r_z1, r_k + r_c2 * bob.scalar()];
    // A proof whose challenge leaves F′ out: valid only to a reader that
    // leaves it out too.
    let t1 = (handle1.generator() * k).to_affine();
    let t2 = (handle1.generator() * z2 - handle1.public_value() * c2).to_affine();
    let without_f: [u8; 32] = Sha256::new()
        .chain_update(BASE_LABEL)
        .chain_update(handle1.to_bytes())
        .chain_update(base.to_compressed())
        .chain_update(t1.to_compressed())
        .chain_update(t2.to_compressed())
        .finalize()
        .into();
    let c1_without_f = scalar_mod_q(&without_f) - c2;
    // z₁ + q, as 32 bytes: refused at parsing.
    let plus_q = |value: &[u8]| -> [u8; 32] {
        let mut out = [0u8; 32];
        let mut carry = 0u16;
        for i in (0..32).rev() {
            let sum = u16::from(value[i]) + u16::from(q[i]) + carry;
            out[i] = sum as u8;
            carry = sum >> 8;
        }
        assert_eq!(carry, 0, "session 1's z₁ leaves room for q");
        out
    };
    let z1_at = base_at(&f1) + 64;
    let mut z_plus_q = f1.clone();
    z_plus_q[z1_at..z1_at + 32].copy_from_slice(&plus_q(&z1.to_bytes_be()));

    // F's points, each replaced: p₀, A and E_A follow F's head.
    let to_len = bytes(&one["to"]).len();
    let points = 16 + 8 + 1 + to_len + 1 + if one["replaces"].is_null() { 0 } else { 16 };
    let with_point = |f: &[u8], at: usize, point: [u8; 48]| {
        let mut out = f.to_vec();
        out[points + 48 * at..points + 48 * (at + 1)].copy_from_slice(&point);
        out
    };
    let mut longer = f1.clone();
    longer.push(0);
    // Two faults: p₀ as O, and z₁ + q. Fields are read in order.
    let two_faults = with_point(&z_plus_q, 0, identity());

    let cases: Vec<(String, Register, Vec<u8>)> = vec![
        ("session 1's base proof".into(), handle1, f1.clone()),
        (
            "session 4's base proof, whose challenge hash is at least q: c1 + c2 is the hash reduced mod q"
                .into(),
            handle_of(four),
            f4.clone(),
        ),
        (
            "session 1's base proof with c1 and c2 swapped".into(),
            handle1,
            with_proof(&f1, [c2, c1, z1, z2]),
        ),
        (
            "session 1's base proof with c1 + 1 and c2 - 1: the same sum, other commitments".into(),
            handle1,
            with_proof(&f1, [c1 + Scalar::ONE, c2 - Scalar::ONE, z1, z2]),
        ),
        (
            "a base proof whose nonce is 0: T1 is O, hashed as 0xc0 then 47 zero bytes, and it verifies"
                .into(),
            handle1,
            with_proof(&f1, [zero.c1, zero.c2, zero.z1, zero.z2]),
        ),
        (
            "the reader's own base proof, made with its key alone: it verifies, so it proves nothing to anyone else"
                .into(),
            handle1,
            with_proof(&f1, readers),
        ),
        (
            "session 1's base proof against another register of the same key".into(),
            bob.register(),
            f1.clone(),
        ),
        (
            "a base proof whose challenge leaves out F': the challenge covers F'".into(),
            handle1,
            with_proof(&f1, [c1_without_f, c2, k + c1_without_f * b, z2]),
        ),
        (
            "session 1's base proof with z1 + q: every scalar must be below q, or F doesn't parse"
                .into(),
            handle1,
            z_plus_q,
        ),
        (
            "session 1's F with p0 as O".into(),
            handle1,
            with_point(&f1, 0, identity()),
        ),
        (
            "session 1's F with A outside G1".into(),
            handle1,
            with_point(&f1, 1, outside_g1()),
        ),
        (
            "session 1's F with E_A off the curve".into(),
            handle1,
            with_point(&f1, 2, off_curve()),
        ),
        ("session 1's F with a byte after it".into(), handle1, longer),
        (
            "session 1's F with p0 as O and z1 + q: F is read in order, so p0's fault is the one"
                .into(),
            handle1,
            two_faults,
        ),
    ];
    let checks: Vec<Value> = cases
        .into_iter()
        .map(|(name, handle, first_contact)| {
            json!({
                "name": name,
                "handle": register_json(&handle),
                "first_contact": hex(&first_contact),
                "result": judge_base_proof(&handle, &first_contact),
            })
        })
        .collect();
    let results: Vec<&str> = checks
        .iter()
        .map(|c| c["result"].as_str().unwrap())
        .collect();
    assert_eq!(
        results,
        [
            "ok",
            "ok",
            "invalid_base_proof",
            "invalid_base_proof",
            "ok",
            "ok",
            "invalid_base_proof",
            "invalid_base_proof",
            "invalid_message",
            "identity_point",
            "not_in_subgroup",
            "invalid_encoding",
            "invalid_message",
            "identity_point",
        ]
    );
    json!(checks)
}

/// Whether both proofs' challenge hashes, as SHA-256 gives them, are at
/// least q: a reader that compared them with `c₁ + c₂` or `c` unreduced
/// would refuse them.
fn challenges_are_at_least_q(conversation: &Conversation, handle: &Register) -> bool {
    let first = &conversation.first;
    let proof = first.proof.unwrap();
    let (t1, t2) = base_commitments(handle, &first.base, &proof);
    let base = base_challenge(handle, &first.base, (&t1, &t2), &first.prefix_bytes());
    let statement = KeysStatement::of(
        first,
        &conversation.responder,
        &conversation.ratchet.dhs.public,
    );
    let keys = statement.challenge(&statement.commitments_of(&first.keys_proof.unwrap()));
    [base, keys]
        .iter()
        .all(|hash| Option::<blstrs::Scalar>::from(blstrs::Scalar::from_bytes_be(hash)).is_none())
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
    //    no `replaces`, F of 491 bytes. No first-contact message fits 512
    //    bytes: 1,314 bytes of text fill 2 KiB, 1,315 take 8 KiB, and an
    //    empty one is 2 KiB.
    let mut carol = side("initiator", "seedelf-messaging session v1 carol");
    let mut dave = side("responder", "seedelf-messaging session v1 dave");
    let dave_root = dave.key.register();
    carol.conversation =
        Some(Conversation::start_with(&carol.key, &dave_root, b"d", t + 7, &mut draw).unwrap());
    let drawn = draw.drain();
    let (start, sk) = start_json(&mut carol, &dave, Some(&dave_root), &drawn, 2);
    assert_eq!(carol.conversation.as_ref().unwrap().first_bytes.len(), 491);
    let mut events = Vec::new();
    let (event, d1) = send(&mut carol, &dave, &[b'x'; 1314], &mut draw);
    assert_eq!(d1.len(), 2048);
    events.push(event);
    let (event, d2) = send(&mut carol, &dave, &[b'y'; 1315], &mut draw);
    assert_eq!(d2.len(), 8192);
    events.push(event);
    let (event, d3) = send(&mut carol, &dave, b"", &mut draw);
    assert_eq!(d3.len(), 2048);
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
    //    with a full name and a `replaces` (F at its largest, 538 bytes);
    //    proofs whose challenge hashes are at least q, so a reader must
    //    reduce them before comparing; an 8 KiB envelope; and a ratchet step
    //    that skips the rest of the old receiving chain (PN − Nr = 1), whose
    //    skipped message comes last. Its draws come from the first label
    //    whose two challenge hashes are both at least q.
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
            challenges_are_at_least_q(&c, &frank_handle)
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
        challenges_are_at_least_q(erin.conversation.as_ref().unwrap(), &frank_handle),
        "session 4's challenge hashes are at least q, so a reader reduces them"
    );
    let drawn = draw.drain();
    let (start, sk) = start_json(&mut erin, &frank, Some(&frank_handle), &drawn, 3);
    assert_eq!(erin.conversation.as_ref().unwrap().first_bytes.len(), 538);
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
        "description": "Seedelf Messaging session layer v1 test vectors (docs/protocol.md §3, §4, §9 and §16). Scalars are 32-byte big-endian; points are 48-byte compressed G1. Every random value is given under `draws`, `salt` and `new_ratchet_secret`; b and the proofs' nonces aren't drawn but derived (§16.2): b from `aux_b`, the base proof's k from `base_c2`, `base_z2` and `aux_k`, and the keys proof's k_e, k_s and k1 from `keys_c2`, `keys_z2` and `aux_keys` (a continuation's from `aux_keys` alone), with their HMACs under `base_scalar`, `base_proof.nonce` and `keys_proof.nonces`; the first-contact stamp's nonce is the first from 0 with `bits` of work. The outer envelope is v1 (tests/vectors/messaging_v1.json) with b = outer_scalar and r = envelope_ephemeral_scalar, both derived from the message key and the salt, so a send draws its salt alone; it seals the inner message padded with 0x80 then zeros to envelope_size - 145 bytes. A session with `continues` is a continuation (§16.3), written by the continued session's responder: its `replaces` and `base` are that session's cid and base, and its public values and secret keys are that session's, swapped. `plaintext` is the session layer's bytes, with no kind byte (§18).",
        "version": 1,
        "labels": {
            "session_salt": String::from_utf8(SESSION_SALT.to_vec()).unwrap(),
            "session_info": String::from_utf8(SESSION_INFO.to_vec()).unwrap(),
            "base_scalar_label": String::from_utf8(BASE_SCALAR_LABEL.to_vec()).unwrap(),
            "base_nonce_label": String::from_utf8(BASE_NONCE_LABEL.to_vec()).unwrap(),
            "base_label": String::from_utf8(BASE_LABEL.to_vec()).unwrap(),
            "keys_handle_label": String::from_utf8(KEYS_HANDLE_LABEL.to_vec()).unwrap(),
            "keys_continuation_label": String::from_utf8(KEYS_CONTINUATION_LABEL.to_vec()).unwrap(),
            "keys_nonce_e_label": String::from_utf8(KEYS_NONCE_E_LABEL.to_vec()).unwrap(),
            "keys_nonce_s_label": String::from_utf8(KEYS_NONCE_S_LABEL.to_vec()).unwrap(),
            "keys_nonce_a_label": String::from_utf8(KEYS_NONCE_A_LABEL.to_vec()).unwrap(),
            "stamp_label": String::from_utf8(FIRST_STAMP_LABEL.to_vec()).unwrap(),
            "root_info": String::from_utf8(ROOT_INFO.to_vec()).unwrap(),
            "message_info": String::from_utf8(MESSAGE_INFO.to_vec()).unwrap(),
            "outer_info": String::from_utf8(OUTER_INFO.to_vec()).unwrap(),
            "envelope_ephemeral_info": String::from_utf8(ENVELOPE_EPHEMERAL_INFO.to_vec()).unwrap(),
        },
        "first_contact_stamp_bits": FIRST_CONTACT_STAMP_BITS,
        "envelope_sizes": ENVELOPE_SIZES,
        "base_proof_checks": base_proof_checks(&[&first, &second, &third, &fourth]),
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

/// The file's b and the proofs' nonces are HMAC-SHA-512 of exactly §16.2's
/// messages, built here from the file's other values and the labels as
/// §16.2 spells them, under x_A, b, e_A and s_A: what another implementation
/// is held to, checked without the crate's own builders. So are each proof's
/// commitments and responses.
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
    let label = |name: &str| file["labels"][name].as_str().unwrap().as_bytes().to_vec();
    assert_eq!(
        label("base_scalar_label"),
        b"Seedelf-Messaging|v1|session|base-scalar"
    );
    assert_eq!(
        label("base_nonce_label"),
        b"Seedelf-Messaging|v1|session|base-nonce"
    );
    for (name, value) in [
        (
            "keys_nonce_e_label",
            &b"Seedelf-Messaging|v1|session|keys-nonce|e"[..],
        ),
        (
            "keys_nonce_s_label",
            b"Seedelf-Messaging|v1|session|keys-nonce|s",
        ),
        (
            "keys_nonce_a_label",
            b"Seedelf-Messaging|v1|session|keys-nonce|a",
        ),
        (
            "keys_handle_label",
            b"Seedelf-Messaging|v1|session|keys|handle",
        ),
        (
            "keys_continuation_label",
            b"Seedelf-Messaging|v1|session|keys|continuation",
        ),
    ] {
        assert_eq!(label(name), value);
    }
    let mut from_handles = 0;
    for session in file["sessions"].as_array().unwrap() {
        let draws = &session["draws"];
        let f = bytes(&session["first_contact"]);
        let base = bytes(&session["base"]);
        // The keys proof: M, then each nonce over it under its key.
        let keys = &session["keys_proof"];
        let m: Vec<u8> = [
            &base[..],
            &bytes(&session["initiator_public"]),
            &bytes(&session["responder_public"]),
            &bytes(&session["ephemeral"]),
            &bytes(&session["ratchet_public"]),
            &f[..f.len() - if session["handle"].is_null() { 96 } else { 192 }],
        ]
        .concat();
        assert_eq!(bytes(&keys["message"]), m);
        let nonce = |name: &str, key: &[u8], parts: &[&[u8]]| {
            let message: Vec<u8> = [&label(name)[..], &m, &parts.concat()].concat();
            assert_eq!(bytes(&keys["nonces"][&name[11..12]]["message"]), message);
            let okm = hmac(key, &message);
            assert_eq!(bytes(&keys["nonces"][&name[11..12]]["hmac"]), okm);
            scalar_mod_q(&okm)
        };
        let (e_key, s_key) = (bytes(&draws["e_A"]), bytes(&draws["s_A"]));

        if session["handle"].is_null() {
            assert!(session["base_scalar"].is_null() && session["base_proof"].is_null());
            assert!(draws.get("aux_b").is_none() && draws.get("aux_k").is_none());
            assert_eq!(keys["form"], "continuation");
            let aux = bytes(&draws["aux_keys"]);
            let ke = nonce("keys_nonce_e_label", &e_key, &[&aux]);
            let ks = nonce("keys_nonce_s_label", &s_key, &[&aux]);
            assert_eq!(
                (point(&base) * ke).to_compressed()[..],
                bytes(&keys["commitments"]["t_e"])[..]
            );
            assert_eq!(
                (point(&base) * ks).to_compressed()[..],
                bytes(&keys["commitments"]["t_s"])[..]
            );
            continue;
        }
        let g = bytes(&session["handle"]["generator"]);
        let v = bytes(&session["handle"]["public_value"]);
        let to = bytes(&session["to"]);
        let replaces = if session["replaces"].is_null() { 0 } else { 16 };
        // F's head: cid, t, len, to, len, replaces.
        let head = &f[..16 + 8 + 1 + to.len() + 1 + replaces];

        // b, keyed by x_A's 32 bytes.
        let message: Vec<u8> = [
            &label("base_scalar_label")[..],
            &g,
            &v,
            head,
            &bytes(&draws["aux_b"]),
        ]
        .concat();
        assert_eq!(bytes(&session["base_scalar"]["message"]), message);
        let okm = hmac(&bytes(&session["initiator_secret_key"]), &message);
        assert_eq!(bytes(&session["base_scalar"]["hmac"]), okm);
        let b = scalar_mod_q(&okm);
        assert_eq!(bytes(&session["base_scalar"]["scalar"]), b.to_bytes_be());
        assert_eq!((point(&g) * b).to_compressed()[..], base[..]);
        assert_eq!(
            (point(&v) * b).to_compressed()[..],
            bytes(&session["responder_public"])[..]
        );

        // k, keyed by b's 32 bytes, over everything the challenge covers but
        // T₁: T₂ follows from the simulated branch's c₂ and z₂.
        let proof = &session["base_proof"];
        let prefix = bytes(&proof["first_contact_prefix"]);
        assert_eq!(prefix[..], f[..f.len() - 192 - 128]);
        let (c2, z2) = (bytes(&draws["base_c2"]), bytes(&draws["base_z2"]));
        let message: Vec<u8> = [
            &label("base_nonce_label")[..],
            &g,
            &v,
            &base,
            &prefix,
            &c2,
            &z2,
            &bytes(&draws["aux_k"]),
        ]
        .concat();
        assert_eq!(bytes(&proof["nonce"]["message"]), message);
        let okm = hmac(&b.to_bytes_be(), &message);
        assert_eq!(bytes(&proof["nonce"]["hmac"]), okm);
        let k = scalar_mod_q(&okm);
        assert_eq!(bytes(&proof["nonce"]["scalar"]), k.to_bytes_be());
        assert_ne!(k, b);
        assert_eq!(
            (point(&g) * k).to_compressed()[..],
            bytes(&proof["commitments"]["t1"])[..]
        );
        let c1 = scalar_mod_q(&bytes(&proof["challenge"])) - scalar_mod_q(&c2);
        let z1 = k + c1 * b;
        assert_eq!(bytes(&proof["c1"]), c1.to_bytes_be());
        assert_eq!(bytes(&proof["z1"]), z1.to_bytes_be());
        assert_eq!(
            f[f.len() - 192 - 128..f.len() - 192],
            [
                c1.to_bytes_be().to_vec(),
                c2.clone(),
                z1.to_bytes_be().to_vec(),
                z2.clone()
            ]
            .concat()
        );

        // The keys proof's three nonces, k₁ keyed by x_A.
        assert_eq!(keys["form"], "handle");
        let (kc2, kz2, aux) = (
            bytes(&draws["keys_c2"]),
            bytes(&draws["keys_z2"]),
            bytes(&draws["aux_keys"]),
        );
        let ke = nonce("keys_nonce_e_label", &e_key, &[&kc2, &kz2, &aux]);
        let ks = nonce("keys_nonce_s_label", &s_key, &[&kc2, &kz2, &aux]);
        let (te, ts) = (
            (point(&base) * ke).to_compressed(),
            (point(&base) * ks).to_compressed(),
        );
        assert_eq!(te[..], bytes(&keys["commitments"]["t_e"])[..]);
        assert_eq!(ts[..], bytes(&keys["commitments"]["t_s"])[..]);
        let k1 = nonce(
            "keys_nonce_a_label",
            &bytes(&session["initiator_secret_key"]),
            &[&te, &ts, &kc2, &kz2, &aux],
        );
        assert_eq!(
            (point(&base) * k1).to_compressed()[..],
            bytes(&keys["commitments"]["t1"])[..]
        );
        from_handles += 1;
    }
    assert_eq!(from_handles, 3);
}

/// Each send's outer scalar o and envelope scalar r are HKDF-SHA256 of its
/// message key under its salt, with the infos the file gives, as §16.2
/// spells them, and the envelope's p and c are [o]p₀ and [r]p: rebuilt from
/// the file alone. Nothing of the envelope is drawn but the salt.
#[test]
fn the_files_envelope_scalars_are_hkdf_of_the_message_key_and_the_salt() {
    use hkdf::Hkdf;
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(VECTORS);
    let file: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let bytes = |value: &Value| hex::decode(value.as_str().unwrap()).unwrap();
    let info = |name: &str| file["labels"][name].as_str().unwrap().as_bytes().to_vec();
    assert_eq!(info("outer_info"), b"Seedelf-Messaging|v1|ratchet|outer");
    assert_eq!(
        info("envelope_ephemeral_info"),
        b"Seedelf-Messaging|v1|ratchet|envelope-ephemeral"
    );
    let mut sends = 0;
    for session in file["sessions"].as_array().unwrap() {
        let base = G1Projective::from(
            blstrs::G1Affine::from_compressed(&bytes(&session["base"]).try_into().unwrap())
                .unwrap(),
        );
        for event in session["events"].as_array().unwrap() {
            let Some(send) = event.get("send") else {
                continue;
            };
            let (mk, salt) = (bytes(&send["message_key"]), bytes(&send["salt"]));
            let hkdf = |name: &str| {
                let mut okm = [0u8; 64];
                Hkdf::<Sha256>::new(Some(&salt), &mk)
                    .expand(&info(name), &mut okm)
                    .unwrap();
                okm
            };
            let (outer, ephemeral) = (hkdf("outer_info"), hkdf("envelope_ephemeral_info"));
            assert_eq!(bytes(&send["outer_okm"]), outer);
            assert_eq!(bytes(&send["envelope_ephemeral_okm"]), ephemeral);
            let (o, r) = (scalar_mod_q(&outer), scalar_mod_q(&ephemeral));
            assert_eq!(bytes(&send["outer_scalar"]), o.to_bytes_be());
            assert_eq!(bytes(&send["envelope_ephemeral_scalar"]), r.to_bytes_be());
            let envelope = bytes(&send["envelope"]);
            let p = base * o;
            assert_eq!(envelope[1..49], p.to_compressed());
            assert_eq!(envelope[81..HEADER_LEN], (p * r).to_compressed());
            assert!(send.get("outer_r").is_none());
            sends += 1;
        }
    }
    assert_eq!(sends, 17);
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
