//! Encryption and decryption through the public API: round trips (Test 6),
//! the wrong recipient (Tests 4 and 7), tampering (Tests 8–10), recipients
//! side by side (Test 12), serialization (Test 14) and versions (Test 15).

mod common;

use group::Curve;

use common::{C_AT, header_points, point, random_nonzero, tag, tag_of, with_point, with_tag};
use seedelf_messaging::{
    ENVELOPE_OVERHEAD, Envelope, Error, HEADER_LEN, MAX_PLAINTEXT_LEN, Register, SecretKey,
    decrypt_message, encrypt_message, matches_envelope, rerandomize_register,
};

/// Encrypt, serialize, parse, discover, decrypt.
fn round_trip(key: &SecretKey, plaintext: &[u8]) -> Vec<u8> {
    let bytes = encrypt_message(&key.register(), plaintext)
        .unwrap()
        .to_bytes();
    assert_eq!(bytes.len(), ENVELOPE_OVERHEAD + plaintext.len());
    let envelope = Envelope::from_bytes(&bytes).unwrap();
    assert!(envelope.is_for(key));
    decrypt_message(key, &envelope).unwrap()
}

/// Parse and decrypt, as a recipient would, from bytes.
fn receive(key: &SecretKey, bytes: &[u8]) -> Result<Vec<u8>, Error> {
    decrypt_message(key, &Envelope::from_bytes(bytes)?)
}

fn sample(key: &SecretKey) -> Vec<u8> {
    encrypt_message(&key.register(), b"a message worth tampering with")
        .unwrap()
        .to_bytes()
}

// --- Test 6: full round trips -------------------------------------------------

#[test]
fn every_kind_of_plaintext_round_trips() {
    let key = SecretKey::generate();
    let binary: Vec<u8> = (0..=255u8).cycle().take(1000).collect();
    let largest: Vec<u8> = (0..MAX_PLAINTEXT_LEN)
        .map(|i| (i * 31 % 251) as u8)
        .collect();
    for plaintext in [
        &b""[..],
        &b"x"[..],
        &b"short message"[..],
        &binary[..],
        "Unicode: Seedelf ✉ メッセージ 🌱 مرحبا".as_bytes(),
        &largest[..],
    ] {
        assert_eq!(round_trip(&key, plaintext), plaintext);
    }
}

#[test]
fn a_plaintext_over_the_limit_is_refused() {
    let key = SecretKey::generate();
    let too_long = vec![0u8; MAX_PLAINTEXT_LEN + 1];
    assert_eq!(
        encrypt_message(&key.register(), &too_long),
        Err(Error::PlaintextTooLarge)
    );
}

/// A fresh `b` and `r` each time: the same plaintext to the same register
/// never gives the same envelope, or the same `p`, tag or `c`.
#[test]
fn the_same_message_twice_gives_unrelated_envelopes() {
    let key = SecretKey::generate();
    let one = encrypt_message(&key.register(), b"same")
        .unwrap()
        .to_bytes();
    let two = encrypt_message(&key.register(), b"same")
        .unwrap()
        .to_bytes();
    assert_ne!(one, two);
    let (a, b) = (header_points(&one), header_points(&two));
    for i in 0..2 {
        assert_ne!(a[i], b[i]);
    }
    assert_ne!(tag(&one), tag(&two));
}

// --- Tests 4 and 7: the wrong recipient ----------------------------------------

#[test]
fn only_the_recipient_recognizes_and_decrypts() {
    let (alice, bob) = (SecretKey::generate(), SecretKey::generate());
    for i in 0..20 {
        let plaintext = format!("for Alice, {i}").into_bytes();
        let envelope = encrypt_message(&alice.register(), &plaintext).unwrap();
        assert!(envelope.is_for(&alice));
        assert_eq!(decrypt_message(&alice, &envelope).unwrap(), plaintext);
        assert!(!envelope.is_for(&bob));
        assert_eq!(matches_envelope(&bob, &envelope.to_bytes()), Ok(false));
        assert_eq!(decrypt_message(&bob, &envelope), Err(Error::NotForThisKey));
    }
}

// --- Test 8: a tampered capsule ------------------------------------------------

#[test]
fn a_changed_ephemeral_point_fails_authentication() {
    let alice = SecretKey::generate();
    let bytes = sample(&alice);
    let [p, c] = header_points(&bytes);
    let (p, c) = (point(&p), point(&c));
    for changed in [
        // c + [s]p: the recipient derives z + [s]w, which no one can undo.
        c + p * random_nonzero(),
        // -c: the sign bit flipped, still a valid point.
        -c,
        // A valid point unrelated to the envelope.
        common::g1() * random_nonzero(),
    ] {
        let tampered = with_point(&bytes, 1, &changed.to_affine().to_compressed());
        assert_eq!(receive(&alice, &tampered), Err(Error::DecryptionFailed));
    }
}

#[test]
fn a_flipped_bit_in_the_ephemeral_point_is_refused_or_fails() {
    let alice = SecretKey::generate();
    let bytes = sample(&alice);
    for bit in 0..48 * 8 {
        let mut tampered = bytes.clone();
        tampered[C_AT + bit / 8] ^= 1 << (bit % 8);
        let result = receive(&alice, &tampered);
        assert!(
            matches!(
                result,
                Err(Error::InvalidEncoding
                    | Error::NotInSubgroup
                    | Error::IdentityPoint
                    | Error::DecryptionFailed)
            ),
            "bit {bit}: {result:?}"
        );
    }
}

// --- Test 9: tampered ciphertext -----------------------------------------------

#[test]
fn every_flipped_ciphertext_bit_fails_authentication() {
    let alice = SecretKey::generate();
    let bytes = sample(&alice);
    for bit in 0..(bytes.len() - HEADER_LEN) * 8 {
        let mut tampered = bytes.clone();
        tampered[HEADER_LEN + bit / 8] ^= 1 << (bit % 8);
        assert_eq!(
            receive(&alice, &tampered),
            Err(Error::DecryptionFailed),
            "bit {bit}"
        );
    }
}

#[test]
fn a_truncated_or_extended_ciphertext_fails() {
    let alice = SecretKey::generate();
    let bytes = sample(&alice);
    assert_eq!(
        receive(&alice, &bytes[..bytes.len() - 1]),
        Err(Error::DecryptionFailed)
    );
    let mut longer = bytes.clone();
    longer.push(0);
    assert_eq!(receive(&alice, &longer), Err(Error::DecryptionFailed));
    assert_eq!(
        receive(&alice, &bytes[..ENVELOPE_OVERHEAD - 1]),
        Err(Error::InvalidLength)
    );
}

// --- Test 10: a tampered register ----------------------------------------------

/// `([k]p, the tag of [k]w)` is still Alice's, and her shared point `[y]c` is
/// unchanged: only the header's binding stops the swap. Making the swap takes
/// w, which the envelope doesn't carry: the sender has it, and here the test
/// computes it from y.
#[test]
fn a_rescaled_register_is_still_hers_but_fails_authentication() {
    let y = random_nonzero();
    let alice = SecretKey::from_scalar(y).unwrap();
    let bytes = sample(&alice);
    let [p, _] = header_points(&bytes);
    let rescaled = point(&p) * random_nonzero();
    let tampered = with_tag(
        &with_point(&bytes, 0, &rescaled.to_affine().to_compressed()),
        &tag_of(&(rescaled * y)),
    );
    let envelope = Envelope::from_bytes(&tampered).unwrap();
    assert!(envelope.is_for(&alice));
    assert_eq!(
        decrypt_message(&alice, &envelope),
        Err(Error::DecryptionFailed)
    );
}

/// Another re-randomization of Alice's register, swapped in: hers, and refused.
#[test]
fn a_swapped_register_of_hers_fails_authentication() {
    let alice = SecretKey::generate();
    let bytes = sample(&alice);
    let other: Register = rerandomize_register(&alice.register());
    let tampered = with_tag(
        &with_point(&bytes, 0, &other.generator_bytes()),
        &tag_of(&point(&other.public_value_bytes())),
    );
    assert!(Envelope::from_bytes(&tampered).unwrap().is_for(&alice));
    assert_eq!(receive(&alice, &tampered), Err(Error::DecryptionFailed));
}

/// p changed alone, the tag changed alone (to the tag of another of her
/// points), or one bit of the tag flipped: no longer hers.
#[test]
fn one_changed_register_part_is_no_longer_hers() {
    let y = random_nonzero();
    let alice = SecretKey::from_scalar(y).unwrap();
    let bytes = sample(&alice);
    let [p, _] = header_points(&bytes);
    let k = random_nonzero();
    let p_only = with_point(&bytes, 0, &(point(&p) * k).to_affine().to_compressed());
    let tag_only = with_tag(&bytes, &tag_of(&(point(&p) * k * y)));
    let mut flipped = tag(&bytes);
    flipped[31] ^= 1;
    let one_bit = with_tag(&bytes, &flipped);
    for tampered in [p_only, tag_only, one_bit] {
        assert_eq!(receive(&alice, &tampered), Err(Error::NotForThisKey));
    }
}

// --- Test 12: recipients side by side ------------------------------------------

#[test]
fn recipients_in_one_collection_each_find_only_theirs() {
    let keys: Vec<SecretKey> = (0..5).map(|_| SecretKey::generate()).collect();
    let mut pool = Vec::new();
    for round in 0..20 {
        for (who, key) in keys.iter().enumerate() {
            let plaintext = format!("{round} to {who}").into_bytes();
            pool.push((
                who,
                plaintext.clone(),
                encrypt_message(&key.register(), &plaintext).unwrap(),
            ));
        }
    }
    for (who, key) in keys.iter().enumerate() {
        for (to, plaintext, envelope) in &pool {
            assert_eq!(envelope.is_for(key), *to == who);
            match decrypt_message(key, envelope) {
                Ok(read) => {
                    assert_eq!(*to, who);
                    assert_eq!(&read, plaintext);
                }
                Err(e) => {
                    assert_ne!(*to, who);
                    assert_eq!(e, Error::NotForThisKey);
                }
            }
        }
    }
}

// --- Test 14: serialization ----------------------------------------------------

#[test]
fn envelopes_and_registers_serialize_exactly() {
    let key = SecretKey::generate();
    for plaintext in [&b""[..], &b"some bytes"[..]] {
        let envelope = encrypt_message(&key.register(), plaintext).unwrap();
        let bytes = envelope.to_bytes();
        let parsed = Envelope::from_bytes(&bytes).unwrap();
        assert_eq!(parsed, envelope);
        assert_eq!(parsed.to_bytes(), bytes);
        assert_eq!(bytes.len(), HEADER_LEN + plaintext.len() + 16);
        // p and c re-encode to the bytes they were read from.
        for at in header_points(&bytes) {
            assert_eq!(point(&at).to_compressed(), at);
        }
    }
    let register = key.register();
    let again =
        Register::from_bytes(&register.generator_bytes(), &register.public_value_bytes()).unwrap();
    assert_eq!(again, register);
    assert_eq!(&again.to_bytes()[..48], &register.generator_bytes()[..]);
}

// --- Nothing in an envelope is a register ---------------------------------------

/// An envelope's bytes hold no register of its reader's key on its own points
/// (the 1.10.0 gate review's chain-reaction#1): not (p, [y]p), which the
/// bytes after p were before they became its tag, nor (c, [y]c). Anyone who
/// reads a pool could pay under either and learn, from the reader's wallet
/// spending it, whom the envelope was for. The 32 bytes after p are
/// SHA-256(`Seedelf-Messaging|v1|envelope|tag` ‖ [y]p).
#[test]
fn no_envelope_holds_a_register_of_its_readers_key() {
    for _ in 0..8 {
        let y = random_nonzero();
        let key = SecretKey::from_scalar(y).unwrap();
        let bytes = encrypt_message(&rerandomize_register(&key.register()), b"no register")
            .unwrap()
            .to_bytes();
        let [p, c] = header_points(&bytes).map(|at| point(&at));
        assert_eq!(tag(&bytes), tag_of(&(p * y)));
        for owned in [p * y, c * y] {
            let owned = owned.to_compressed();
            assert!(!bytes.windows(48).any(|window| window == owned));
        }
    }
}

// --- Test 15: versions and lengths ---------------------------------------------

#[test]
fn other_versions_are_refused() {
    let key = SecretKey::generate();
    let bytes = sample(&key);
    for version in [0u8, 2, 0x80, 0xff] {
        let mut other = bytes.clone();
        other[0] = version;
        assert_eq!(
            Envelope::from_bytes(&other),
            Err(Error::UnsupportedVersion(version))
        );
    }
}

#[test]
fn lengths_outside_the_format_are_refused() {
    assert_eq!(Envelope::from_bytes(&[]), Err(Error::InvalidLength));
    let key = SecretKey::generate();
    let bytes = sample(&key);
    for length in [1, HEADER_LEN - 1, HEADER_LEN, ENVELOPE_OVERHEAD - 1] {
        assert_eq!(
            Envelope::from_bytes(&bytes[..length]),
            Err(Error::InvalidLength)
        );
    }
    let mut too_long = bytes[..HEADER_LEN].to_vec();
    too_long.resize(ENVELOPE_OVERHEAD + MAX_PLAINTEXT_LEN + 1, 0);
    assert_eq!(Envelope::from_bytes(&too_long), Err(Error::InvalidLength));
}
