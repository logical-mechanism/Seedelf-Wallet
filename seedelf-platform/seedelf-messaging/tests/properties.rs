//! Property tests (Phase 1G). Finite random testing shows the code does what
//! the construction says on the inputs tried; it proves nothing about
//! confidentiality or unlinkability (docs/security.md).

mod common;

use blstrs::Scalar;
use group::Curve;
use proptest::prelude::*;

use common::g1;
use seedelf_messaging::{
    ENVELOPE_OVERHEAD, Envelope, Error, POINT_LEN, Register, SecretKey, decrypt_message,
    encrypt_message, matches_envelope, matches_register, rerandomize_register,
};

/// Any nonzero scalar below 2^254, from 32 random bytes.
fn scalar() -> impl Strategy<Value = Scalar> {
    any::<[u8; 32]>().prop_filter_map("zero", |mut bytes| {
        bytes[0] &= 0x3f;
        let scalar: Scalar = Option::from(Scalar::from_bytes_be(&bytes))?;
        (scalar != Scalar::from(0u64)).then_some(scalar)
    })
}

fn config(cases: u32) -> ProptestConfig {
    ProptestConfig {
        cases,
        ..ProptestConfig::default()
    }
}

proptest! {
    #![proptest_config(config(64))]

    /// Re-randomizing, once or twice, keeps the register its owner's, on any
    /// generator.
    #[test]
    fn rerandomizing_preserves_ownership(y in scalar(), d in scalar()) {
        let key = SecretKey::from_scalar(y).unwrap();
        let generator = g1() * d;
        let register = Register::from_bytes(
            &generator.to_affine().to_compressed(),
            &(generator * y).to_affine().to_compressed(),
        ).unwrap();
        let once = rerandomize_register(&register);
        prop_assert!(matches_register(&key, &once));
        prop_assert!(matches_register(&key, &rerandomize_register(&once)));
    }

    /// Every encryption round trip succeeds, byte for byte.
    #[test]
    fn every_round_trip_succeeds(y in scalar(), plaintext in prop::collection::vec(any::<u8>(), 0..2048)) {
        let key = SecretKey::from_scalar(y).unwrap();
        let bytes = encrypt_message(&key.register(), &plaintext).unwrap().to_bytes();
        prop_assert_eq!(bytes.len(), ENVELOPE_OVERHEAD + plaintext.len());
        let envelope = Envelope::from_bytes(&bytes).unwrap();
        prop_assert_eq!(decrypt_message(&key, &envelope).unwrap(), plaintext);
    }

    /// Another key neither recognizes nor decrypts.
    #[test]
    fn another_key_fails(y in scalar(), other in scalar(), plaintext in prop::collection::vec(any::<u8>(), 0..256)) {
        prop_assume!(y != other);
        let (key, wrong) = (SecretKey::from_scalar(y).unwrap(), SecretKey::from_scalar(other).unwrap());
        let envelope = encrypt_message(&key.register(), &plaintext).unwrap();
        prop_assert!(!envelope.is_for(&wrong));
        prop_assert_eq!(decrypt_message(&wrong, &envelope), Err(Error::NotForThisKey));
    }

    /// The scan of raw bytes agrees with the full parse, for the recipient
    /// and for anyone else.
    #[test]
    fn the_scan_agrees_with_the_parse(y in scalar(), other in scalar(), plaintext in prop::collection::vec(any::<u8>(), 0..256)) {
        prop_assume!(y != other);
        let (key, wrong) = (SecretKey::from_scalar(y).unwrap(), SecretKey::from_scalar(other).unwrap());
        let bytes = encrypt_message(&key.register(), &plaintext).unwrap().to_bytes();
        let envelope = Envelope::from_bytes(&bytes).unwrap();
        prop_assert_eq!(matches_envelope(&key, &bytes), Ok(true));
        prop_assert_eq!(matches_envelope(&wrong, &bytes), Ok(false));
        prop_assert!(envelope.is_for(&key) && !envelope.is_for(&wrong));
    }

    /// No single flipped bit, anywhere in an envelope, gives back a plaintext.
    #[test]
    fn no_flipped_bit_is_accepted(
        plaintext in prop::collection::vec(any::<u8>(), 0..128),
        position in any::<prop::sample::Index>(),
    ) {
        let key = SecretKey::generate();
        let mut bytes = encrypt_message(&key.register(), &plaintext).unwrap().to_bytes();
        let bit = position.index(bytes.len() * 8);
        bytes[bit / 8] ^= 1 << (bit % 8);
        let result = Envelope::from_bytes(&bytes).and_then(|envelope| decrypt_message(&key, &envelope));
        prop_assert!(result.is_err(), "bit {} accepted", bit);
    }
}

proptest! {
    #![proptest_config(config(512))]

    /// Arbitrary bytes parse to a structured error, never a panic; and an
    /// envelope that parses serializes back to the same bytes.
    #[test]
    fn arbitrary_envelope_bytes_never_panic(mut bytes in prop::collection::vec(any::<u8>(), 0..400), versioned in any::<bool>()) {
        if versioned && !bytes.is_empty() {
            bytes[0] = 1;
        }
        let key = SecretKey::generate();
        let scanned = matches_envelope(&key, &bytes);
        if let Ok(envelope) = Envelope::from_bytes(&bytes) {
            prop_assert_eq!(scanned, Ok(envelope.is_for(&key)));
            prop_assert_eq!(envelope.to_bytes(), bytes);
        }
    }

    /// Arbitrary 48-byte strings are refused as points, or are canonical.
    #[test]
    fn arbitrary_points_never_panic(generator in any::<[u8; POINT_LEN]>(), public_value in any::<[u8; POINT_LEN]>()) {
        if let Ok(register) = Register::from_bytes(&generator, &public_value) {
            prop_assert_eq!(register.generator_bytes(), generator);
            prop_assert_eq!(register.public_value_bytes(), public_value);
        }
    }

    /// Arbitrary 32-byte strings are refused as keys, or accepted, without a panic.
    #[test]
    fn arbitrary_scalars_never_panic(bytes in any::<[u8; 32]>()) {
        let _ = SecretKey::from_bytes(&bytes);
    }
}

proptest! {
    #![proptest_config(config(64))]

    /// Serialization is deterministic: parse, write, parse gives the same.
    #[test]
    fn serialization_is_deterministic(plaintext in prop::collection::vec(any::<u8>(), 0..512)) {
        let key = SecretKey::generate();
        let bytes = encrypt_message(&key.register(), &plaintext).unwrap().to_bytes();
        let once = Envelope::from_bytes(&bytes).unwrap();
        let twice = Envelope::from_bytes(&once.to_bytes()).unwrap();
        prop_assert_eq!(&once, &twice);
        prop_assert_eq!(twice.to_bytes(), bytes);
    }

    /// The secret key's bytes never appear in an envelope.
    #[test]
    fn the_key_never_appears_in_an_envelope(y in scalar(), plaintext in prop::collection::vec(any::<u8>(), 0..256)) {
        let key = SecretKey::from_scalar(y).unwrap();
        let bytes = encrypt_message(&key.register(), &plaintext).unwrap().to_bytes();
        for secret in [y.to_bytes_be(), y.to_bytes_le()] {
            prop_assert!(!bytes.windows(32).any(|w| w == secret));
        }
    }
}
