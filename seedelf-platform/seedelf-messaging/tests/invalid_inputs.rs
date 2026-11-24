//! Invalid points and scalars (Test 11): every one is a structured error,
//! raised while parsing, before any decryption.

mod common;

use blstrs::{G1Affine, Scalar};
use group::Curve;

use common::{random_nonzero, with_point, with_tag};
use seedelf_messaging::{Envelope, Error, Register, SecretKey, encrypt_message, matches_envelope};

/// BLS12-381's base field modulus.
const FIELD_MODULUS: &str = "1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab";

/// The order of G1, the scalars' modulus.
const GROUP_ORDER: &str = "73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001";

fn point_bytes(hex_str: &str) -> [u8; 48] {
    hex::decode(hex_str).unwrap().try_into().unwrap()
}

fn identity() -> [u8; 48] {
    let mut bytes = [0u8; 48];
    bytes[0] = 0xc0;
    bytes
}

/// A compressed encoding of `x`, with the compression flag set.
fn compressed_x(x: u64) -> [u8; 48] {
    let mut bytes = [0u8; 48];
    bytes[40..].copy_from_slice(&x.to_be_bytes());
    bytes[0] |= 0x80;
    bytes
}

/// A point on the curve outside the prime-order subgroup: most points of
/// E(Fp) are, as G1's cofactor is about 2^126.
fn outside_the_subgroup() -> [u8; 48] {
    (1u64..)
        .map(compressed_x)
        .find(|bytes| {
            Option::<G1Affine>::from(G1Affine::from_compressed_unchecked(bytes))
                .is_some_and(|p| bool::from(p.is_on_curve()) && !bool::from(p.is_torsion_free()))
        })
        .unwrap()
}

/// An x with no point on the curve: x³ + 4 is not a square.
fn off_the_curve() -> [u8; 48] {
    (1u64..)
        .map(compressed_x)
        .find(|bytes| {
            Option::<G1Affine>::from(G1Affine::from_compressed_unchecked(bytes)).is_none()
        })
        .unwrap()
}

fn valid() -> [u8; 48] {
    (common::g1() * random_nonzero())
        .to_affine()
        .to_compressed()
}

/// Every bad encoding with the error it must give.
fn bad_points() -> Vec<(&'static str, [u8; 48], Error)> {
    let mut stray = identity();
    stray[47] = 1;
    let mut signed_identity = identity();
    signed_identity[0] = 0xe0;
    let mut uncompressed_flag = valid();
    uncompressed_flag[0] &= 0x7f;
    let mut modulus = point_bytes(FIELD_MODULUS);
    modulus[0] |= 0x80;
    let mut all_ones = [0xffu8; 48];
    all_ones[0] = 0x9f;
    vec![
        ("identity", identity(), Error::IdentityPoint),
        ("identity with a stray bit", stray, Error::InvalidEncoding),
        (
            "identity with the sign flag",
            signed_identity,
            Error::InvalidEncoding,
        ),
        (
            "compression flag clear",
            uncompressed_flag,
            Error::InvalidEncoding,
        ),
        (
            "x equal to the field modulus",
            modulus,
            Error::InvalidEncoding,
        ),
        (
            "x above the field modulus",
            all_ones,
            Error::InvalidEncoding,
        ),
        ("x off the curve", off_the_curve(), Error::InvalidEncoding),
        ("all zero bytes", [0u8; 48], Error::InvalidEncoding),
        (
            "outside the subgroup",
            outside_the_subgroup(),
            Error::NotInSubgroup,
        ),
    ]
}

#[test]
fn the_test_points_are_what_they_claim() {
    let raw = outside_the_subgroup();
    let point: G1Affine = Option::from(G1Affine::from_compressed_unchecked(&raw)).unwrap();
    assert!(bool::from(point.is_on_curve()));
    assert!(!bool::from(point.is_torsion_free()));
    assert!(Option::<G1Affine>::from(G1Affine::from_compressed(&raw)).is_none());
}

#[test]
fn a_register_refuses_every_bad_point_in_either_place() {
    for (name, bad, error) in bad_points() {
        assert_eq!(
            Register::from_bytes(&bad, &valid()),
            Err(error),
            "{name} as generator"
        );
        assert_eq!(
            Register::from_bytes(&valid(), &bad),
            Err(error),
            "{name} as public value"
        );
    }
}

/// Every bad point is refused as `p` and as `c`. The tag between them is no
/// point: a bad point's first 32 bytes there are bytes like any other, which
/// parse, and match no one.
#[test]
fn an_envelope_refuses_every_bad_point_in_every_place() {
    let key = SecretKey::generate();
    let bytes = encrypt_message(&key.register(), b"payload")
        .unwrap()
        .to_bytes();
    for (name, bad, error) in bad_points() {
        for place in 0..2 {
            assert_eq!(
                Envelope::from_bytes(&with_point(&bytes, place, &bad)),
                Err(error),
                "{name} at point {place}"
            );
        }
        let as_tag = with_tag(&bytes, &bad[..32].try_into().unwrap());
        let parsed = Envelope::from_bytes(&as_tag).unwrap();
        assert!(!parsed.is_for(&key), "{name} as the tag");
    }
}

/// The scan refuses what parsing refuses in `p`, and leaves `c` to the full
/// parse: a bad `c` still matches its owner, and only its owner, and is
/// refused before the owner's key touches it.
#[test]
fn the_scan_checks_the_register_and_leaves_c_to_the_parse() {
    let (key, other) = (SecretKey::generate(), SecretKey::generate());
    let bytes = encrypt_message(&key.register(), b"payload")
        .unwrap()
        .to_bytes();
    for (name, bad, error) in bad_points() {
        assert_eq!(
            matches_envelope(&key, &with_point(&bytes, 0, &bad)),
            Err(error),
            "{name} as p"
        );
        let bad_c = with_point(&bytes, 1, &bad);
        assert_eq!(matches_envelope(&key, &bad_c), Ok(true), "{name} as c");
        assert_eq!(matches_envelope(&other, &bad_c), Ok(false), "{name} as c");
        assert_eq!(Envelope::from_bytes(&bad_c), Err(error), "{name} as c");
    }
    assert_eq!(matches_envelope(&key, &[]), Err(Error::InvalidLength));
    assert_eq!(
        matches_envelope(&key, &bytes[..bytes.len() - 24]),
        Err(Error::InvalidLength)
    );
    let mut other_version = bytes.clone();
    other_version[0] = 2;
    assert_eq!(
        matches_envelope(&key, &other_version),
        Err(Error::UnsupportedVersion(2))
    );
}

/// A negated point is a different valid point, not an error.
#[test]
fn the_sign_flag_names_the_other_point() {
    let point = common::g1() * random_nonzero();
    let mut flipped = point.to_affine().to_compressed();
    flipped[0] ^= 0x20;
    let parsed = G1Affine::from_compressed(&flipped).unwrap();
    assert_eq!(parsed, (-point).to_affine());
}

#[test]
fn bad_scalars_are_refused() {
    let order: [u8; 32] = hex::decode(GROUP_ORDER).unwrap().try_into().unwrap();
    let mut order_plus_one = order;
    order_plus_one[31] += 1;
    for (name, bytes) in [
        ("zero", [0u8; 32]),
        ("the group order", order),
        ("the group order plus one", order_plus_one),
        ("all ones", [0xffu8; 32]),
    ] {
        assert_eq!(
            SecretKey::from_bytes(&bytes).map(|_| ()),
            Err(Error::InvalidScalar),
            "{name}"
        );
    }
    assert_eq!(
        SecretKey::from_scalar(Scalar::from(0u64)).map(|_| ()),
        Err(Error::InvalidScalar)
    );

    let mut below_order = order;
    below_order[31] -= 1;
    assert!(SecretKey::from_bytes(&below_order).is_ok());
    let mut one = [0u8; 32];
    one[31] = 1;
    assert!(SecretKey::from_bytes(&one).is_ok());
}

/// Every prefix of an envelope, and garbage, is an error, never a panic.
#[test]
fn short_and_garbage_input_is_an_error() {
    let key = SecretKey::generate();
    let bytes = encrypt_message(&key.register(), b"payload")
        .unwrap()
        .to_bytes();
    for length in 0..bytes.len() - 7 {
        assert!(
            Envelope::from_bytes(&bytes[..length]).is_err(),
            "prefix of {length}"
        );
    }
    let mut garbage = vec![0xa5u8; 300];
    garbage[0] = 1;
    assert!(Envelope::from_bytes(&garbage).is_err());
}
