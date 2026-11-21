//! Part 2: the ratchet. KDF_RK, KDF_CK, ENCRYPT with its salt, skipped keys,
//! MAX_SKIP and the 48-hour lifetime (docs/protocol.md §4.1).

use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use sha2::Sha256;

use super::support::{Seeded, handle, key, opened, skip_sends, start};
use crate::Error;
use crate::SecretKey;
use crate::session::conversation::Conversation;
use crate::session::ratchet::{
    KDF_CK_CALLS, MAX_SKIP, MAX_STORED_SKIPPED, ROOT_INFO, SKIPPED_KEY_LIFETIME, decrypt, encrypt,
    kdf_ck, kdf_rk, message_key_and_nonce,
};
use crate::session::secret::Secret32;

const T: u64 = 1_800_000_000;

/// KDF_RK is HKDF-SHA256 with the root key as salt and the DH as input, 64
/// bytes split in two.
#[test]
fn kdf_rk_is_hkdf_split_in_two() {
    let rk = Secret32::from_bytes([7; 32]);
    let dh = [9u8; 48];
    let mut okm = [0u8; 64];
    Hkdf::<Sha256>::new(Some(&[7; 32]), &dh)
        .expand(ROOT_INFO, &mut okm)
        .unwrap();
    let (root, chain) = kdf_rk(&rk, &dh);
    assert_eq!(root.bytes()[..], okm[..32]);
    assert_eq!(chain.bytes()[..], okm[32..]);
    assert_ne!(root, chain);
}

/// KDF_CK: HMAC-SHA256 of the chain key over 0x01 is the message key, over
/// 0x02 the next chain key.
#[test]
fn kdf_ck_is_two_hmacs() {
    let ck = Secret32::from_bytes([5; 32]);
    let hmac = |byte: u8| {
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&[5; 32]).unwrap();
        mac.update(&[byte]);
        <[u8; 32]>::from(mac.finalize().into_bytes())
    };
    let (next, mk) = kdf_ck(&ck);
    assert_eq!(mk.bytes(), &hmac(1));
    assert_eq!(next.bytes(), &hmac(2));
    assert_ne!(next, ck);
}

/// ENCRYPT draws a fresh salt each time, so one message key used twice still
/// gives two unrelated AES-GCM keys and nonces (docs/protocol.md §4.2).
#[test]
fn encrypt_derives_a_fresh_key_and_nonce_from_each_salt() {
    let mk = Secret32::from_bytes([3; 32]);
    let (one, two) = ([1u8; 16], [2u8; 16]);
    let k1 = message_key_and_nonce(&mk, &one);
    let k2 = message_key_and_nonce(&mk, &two);
    assert_ne!(k1[..32], k2[..32]);
    assert_ne!(k1[32..], k2[32..]);
    let c1 = encrypt(&mk, &one, b"same", b"ad").unwrap();
    let c2 = encrypt(&mk, &two, b"same", b"ad").unwrap();
    assert_ne!(c1, c2);
    assert_eq!(&c1[..16], &one);
    assert_eq!(c1.len(), 16 + 4 + 16);
    assert_eq!(decrypt(&mk, &c1, b"ad").unwrap(), b"same");
    assert_eq!(decrypt(&mk, &c2, b"ad").unwrap(), b"same");
}

/// Every bit of the salt, the ciphertext, the tag and the associated data
/// is authenticated; a short ciphertext is malformed, not a panic.
#[test]
fn decrypt_refuses_every_change() {
    let mk = Secret32::from_bytes([4; 32]);
    let ad = b"cid R_A R_B header".to_vec();
    let sealed = encrypt(&mk, &[8; 16], b"authenticated", &ad).unwrap();
    for byte in 0..sealed.len() {
        let mut changed = sealed.clone();
        changed[byte] ^= 1;
        assert_eq!(
            decrypt(&mk, &changed, &ad),
            Err(Error::DecryptionFailed),
            "{byte}"
        );
    }
    for byte in 0..ad.len() {
        let mut changed = ad.clone();
        changed[byte] ^= 1;
        assert_eq!(
            decrypt(&mk, &sealed, &changed),
            Err(Error::DecryptionFailed)
        );
    }
    for len in 0..32 {
        assert_eq!(
            decrypt(&mk, &sealed[..len], &ad),
            Err(Error::InvalidMessage)
        );
    }
    assert_eq!(
        decrypt(&Secret32::from_bytes([5; 32]), &sealed, &ad),
        Err(Error::DecryptionFailed)
    );
}

/// Two sides, each with a conversation, started and accepted.
pub(crate) struct Pair {
    pub(crate) alice: SecretKey,
    pub(crate) bob: SecretKey,
    pub(crate) a: Conversation,
    pub(crate) b: Conversation,
    pub(crate) draw: Seeded,
}

/// Alice starts, Bob accepts her first message, and Bob replies once so both
/// have both chains.
pub(crate) fn pair(label: &str) -> Pair {
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new(label);
    let mut a = start(&alice, &handle("bob", "bob's handle"), T, &mut draw);
    let first = opened(&bob, &a.send_with(b"first", &mut draw).unwrap());
    let (mut b, _) = Conversation::accept_with(&bob, &[(&first, T)], &mut draw).unwrap();
    let reply = opened(&alice, &b.send_with(b"reply", &mut draw).unwrap());
    a.receive_with(&reply, T, &mut draw).unwrap();
    Pair {
        alice,
        bob,
        a,
        b,
        draw,
    }
}

/// Messages within a chain and across chains arrive in any order; each skip
/// stores keys, and each late message uses one.
#[test]
fn out_of_order_within_and_across_chains() {
    let mut p = pair("order");
    let mut sent = Vec::new();
    for i in 0..3 {
        sent.push(
            p.a.send_with(format!("a{i}").as_bytes(), &mut p.draw)
                .unwrap(),
        );
    }
    // Bob gets the last first: two keys skipped.
    let last = opened(&p.bob, &sent[2]);
    assert_eq!(p.b.receive_with(&last, T, &mut p.draw).unwrap(), b"a2");
    assert_eq!(p.b.missing(), 2);
    // Bob replies; Alice ratchets; Alice's next chain says PN = 3.
    let reply = opened(&p.alice, &p.b.send_with(b"r", &mut p.draw).unwrap());
    p.a.receive_with(&reply, T, &mut p.draw).unwrap();
    let next = p.a.send_with(b"new chain", &mut p.draw).unwrap();
    let next = opened(&p.bob, &next);
    assert_eq!(next.header.pn, 3);
    assert_eq!(
        p.b.receive_with(&next, T, &mut p.draw).unwrap(),
        b"new chain"
    );
    // The old chain's skipped keys still open the late ones, once. A replay
    // from an earlier chain can't be told from a forgery without keeping
    // old chain keys, so it runs as a new chain on a copy, fails to
    // authenticate, and changes nothing (§5 rule 4).
    for i in [1, 0] {
        let late = opened(&p.bob, &sent[i]);
        assert_eq!(
            p.b.receive_with(&late, T, &mut p.draw).unwrap(),
            format!("a{i}").as_bytes()
        );
        let before = p.b.to_bytes();
        assert_eq!(
            p.b.receive_with(&late, T, &mut p.draw),
            Err(Error::DecryptionFailed)
        );
        assert_eq!(p.b.to_bytes(), before);
    }
    assert_eq!(p.b.missing(), 0);
    // In the current chain, a replay is known for what it is.
    assert_eq!(
        p.b.receive_with(&next, T, &mut p.draw),
        Err(Error::KeyUsedOrDeleted)
    );
}

/// A new chain's message whose header says the old chain ran on stores the
/// old chain's remaining keys first: PN counts against MAX_SKIP too, so no
/// one message skips more than MAX_SKIP keys in all.
#[test]
fn one_message_skips_at_most_max_skip_across_both_chains() {
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("both chains");
    let mut a = start(&alice, &handle("bob", "bob's handle"), T, &mut draw);
    let first = opened(&bob, &a.send_with(b"first", &mut draw).unwrap());
    let (mut b, _) = Conversation::accept_with(&bob, &[(&first, T)], &mut draw).unwrap();
    // Alice's first chain runs to 601 messages; Bob has seen one.
    skip_sends(&mut a, 600);
    let reply = opened(&alice, &b.send_with(b"r", &mut draw).unwrap());
    a.receive_with(&reply, T, &mut draw).unwrap();
    // Alice's second chain: PN = 601. Its message 400 makes Bob skip
    // 600 + 400 = 1,000 keys: the bound, allowed.
    skip_sends(&mut a, 400);
    let ok = opened(&bob, &a.send_with(b"at the bound", &mut draw).unwrap());
    assert_eq!((ok.header.pn, ok.header.n), (601, 400));
    let mut copy = b.clone();
    assert_eq!(
        copy.receive_with(&ok, T, &mut draw).unwrap(),
        b"at the bound"
    );
    assert_eq!(copy.missing(), 1000);
    // Its message 401 would skip 1,001: refused before any key is derived.
    let over = opened(&bob, &a.send_with(b"past it", &mut draw).unwrap());
    assert_eq!(over.header.n, 401);
    let before = b.to_bytes();
    KDF_CK_CALLS.with(|calls| calls.set(0));
    assert_eq!(b.receive_with(&over, T, &mut draw), Err(Error::TooFarAhead));
    assert_eq!(KDF_CK_CALLS.with(|calls| calls.get()), 0);
    assert_eq!(b.to_bytes(), before);
}

/// Past MAX_STORED_SKIPPED, the oldest skipped keys go first, and their
/// messages count as missing.
#[test]
fn stored_skipped_keys_are_capped_oldest_first() {
    let mut p = pair("cap");
    let mut late = Vec::new();
    // Three rounds, each leaving 1,000 skipped keys in a new chain of
    // Alice's: 3,000 in all, past the cap of 2,000.
    for round in 0..3 {
        late.push(
            p.a.send_with(format!("lost {round}").as_bytes(), &mut p.draw)
                .unwrap(),
        );
        skip_sends(&mut p.a, MAX_SKIP - 1);
        let message = opened(&p.bob, &p.a.send_with(b"far", &mut p.draw).unwrap());
        p.b.receive_with(&message, T + round, &mut p.draw).unwrap();
        let reply = opened(&p.alice, &p.b.send_with(b"r", &mut p.draw).unwrap());
        p.a.receive_with(&reply, T, &mut p.draw).unwrap();
    }
    assert_eq!(p.b.ratchet.skipped.len(), MAX_STORED_SKIPPED);
    assert_eq!(p.b.ratchet.lost, u64::from(MAX_SKIP));
    assert_eq!(p.b.missing(), 3 * u64::from(MAX_SKIP));
    // The first round's message lost its key; the last round's didn't.
    let first = opened(&p.bob, &late[0]);
    assert!(p.b.clone().receive_with(&first, T, &mut p.draw).is_err());
    let last = opened(&p.bob, &late[2]);
    assert_eq!(p.b.receive_with(&last, T, &mut p.draw).unwrap(), b"lost 2");
}

/// A skipped key is usable until 48 hours after it was stored, and not a
/// second later; `expire` deletes it and counts its message missing.
#[test]
fn skipped_keys_live_48_hours() {
    let mut p = pair("lifetime");
    let early = p.a.send_with(b"early", &mut p.draw).unwrap();
    let later = opened(&p.bob, &p.a.send_with(b"later", &mut p.draw).unwrap());
    p.b.receive_with(&later, T, &mut p.draw).unwrap();
    let early = opened(&p.bob, &early);
    let edge = T + SKIPPED_KEY_LIFETIME;
    assert_eq!(
        p.b.clone().receive_with(&early, edge, &mut p.draw).unwrap(),
        b"early"
    );
    let before = p.b.to_bytes();
    assert_eq!(
        p.b.receive_with(&early, edge + 1, &mut p.draw),
        Err(Error::KeyUsedOrDeleted)
    );
    assert_eq!(p.b.to_bytes(), before);
    p.b.expire(edge);
    assert_eq!(p.b.ratchet.skipped.len(), 1);
    p.b.expire(edge + 1);
    assert_eq!((p.b.ratchet.skipped.len(), p.b.missing()), (0, 1));
    assert_eq!(
        p.b.receive_with(&early, edge + 1, &mut p.draw),
        Err(Error::KeyUsedOrDeleted)
    );
}

/// Before Bob's first reply, Alice has no receiving chain: a message on w₀,
/// or one whose header claims a previous chain, derives nothing and panics
/// nowhere.
#[test]
fn alice_before_the_first_reply_derives_nothing_from_a_forged_header() {
    let (alice, bob) = (key("alice"), key("bob"));
    let mut draw = Seeded::new("forged");
    let mut a = start(&alice, &handle("bob", "h"), T, &mut draw);
    let first = opened(&bob, &a.send_with(b"x", &mut draw).unwrap());
    let (mut b, _) = Conversation::accept_with(&bob, &[(&first, T)], &mut draw).unwrap();
    let mut reply = opened(&alice, &b.send_with(b"y", &mut draw).unwrap());
    let before = a.to_bytes();
    // On w₀ itself.
    let mut on_w0 = reply.clone();
    on_w0.header.dh = a.responder;
    assert_eq!(
        a.receive_with(&on_w0, T, &mut draw),
        Err(Error::DecryptionFailed)
    );
    // A new key with PN claiming a chain Alice never had.
    reply.header.pn = 500;
    KDF_CK_CALLS.with(|calls| calls.set(0));
    assert_eq!(
        a.receive_with(&reply, T, &mut draw),
        Err(Error::DecryptionFailed)
    );
    // Only the new chain's own key: no skipped keys for a chain that wasn't.
    assert_eq!(KDF_CK_CALLS.with(|calls| calls.get()), 1);
    assert_eq!(a.to_bytes(), before);
}

/// N = u32::MAX is refused rather than wrapping Nr, and so is a send past
/// the counter's range.
#[test]
fn counters_never_wrap() {
    let mut p = pair("wrap");
    let message = opened(&p.bob, &p.a.send_with(b"m", &mut p.draw).unwrap());
    p.b.receive_with(&message, T, &mut p.draw).unwrap();
    // In the current chain, ten ahead, but at the top of the range.
    let mut forged = message.clone();
    forged.header.n = u32::MAX;
    p.b.ratchet.nr = u32::MAX - 10;
    let before = p.b.to_bytes();
    assert_eq!(
        p.b.receive_with(&forged, T, &mut p.draw),
        Err(Error::TooFarAhead)
    );
    assert_eq!(p.b.to_bytes(), before);
    p.a.ratchet.ns = u32::MAX;
    let before = p.a.to_bytes();
    assert_eq!(p.a.send_with(b"m", &mut p.draw), Err(Error::ChainExhausted));
    assert_eq!(p.a.to_bytes(), before);
}
