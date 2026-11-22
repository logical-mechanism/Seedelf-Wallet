//! The relay's copy of what a post must be: seedelf-messaging's `relay`
//! module, which the data layer can't depend on, as its Lovejoin rules are
//! copies too. Both are held to
//! `seedelf-messaging/tests/vectors/messaging_relay_v1.json`, which the
//! crate writes: a change here or there that the other doesn't make fails
//! a test.
//!
//! A post is `nonce (8, big-endian) ‖ envelope`. The envelope must be
//! version 1, one of the session layer's four sizes, and carry three valid
//! points (`p`, `w`, `c`); its stamp's work is the leading zero bits of
//! `SHA-256(digest ‖ nonce)`, where the digest binds the envelope and the
//! pool (docs/protocol.md §17).

use blstrs::G1Affine;
use group::prime::PrimeCurveAffine;
use sha2::{Digest, Sha256};

/// The only envelope version kept.
pub const VERSION: u8 = 1;

/// Every envelope kept is exactly one of these long: the session layer pads
/// every message to one.
pub const SIZES: [usize; 4] = [512, 2048, 8192, 32768];

/// A post's nonce, before its envelope.
pub const NONCE_LEN: usize = 8;

/// The stamp digest's label, before the pool's name.
pub const STAMP_LABEL: &[u8] = b"Seedelf-Messaging|v1|stamp|";

const POINT_LEN: usize = 48;

/// Why an envelope isn't kept, named as the vectors name it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refused {
    UnsupportedVersion,
    InvalidLength,
    InvalidEncoding,
    NotInSubgroup,
    IdentityPoint,
}

impl Refused {
    pub fn name(self) -> &'static str {
        match self {
            Refused::UnsupportedVersion => "unsupported_version",
            Refused::InvalidLength => "invalid_length",
            Refused::InvalidEncoding => "invalid_encoding",
            Refused::NotInSubgroup => "not_in_subgroup",
            Refused::IdentityPoint => "identity_point",
        }
    }

    /// What a 400 says.
    pub fn reason(self) -> &'static str {
        match self {
            Refused::UnsupportedVersion => "not a version 1 envelope",
            Refused::InvalidLength => "not one of the four envelope sizes",
            Refused::InvalidEncoding | Refused::NotInSubgroup | Refused::IdentityPoint => {
                "a point in the envelope isn't valid"
            }
        }
    }
}

/// The version, then the length: the checks that cost nothing, made before
/// the envelope is hashed.
pub fn check_shape(envelope: &[u8]) -> Result<(), Refused> {
    match envelope.first() {
        None => Err(Refused::InvalidLength),
        Some(&version) if version != VERSION => Err(Refused::UnsupportedVersion),
        Some(_) if !SIZES.contains(&envelope.len()) => Err(Refused::InvalidLength),
        Some(_) => Ok(()),
    }
}

/// `p`, `w` and `c`, in that order. The caller has checked the shape.
pub fn check_points(envelope: &[u8]) -> Result<(), Refused> {
    for i in 0..3 {
        let start = 1 + i * POINT_LEN;
        let point: &[u8; POINT_LEN] = envelope
            .get(start..start + POINT_LEN)
            .and_then(|slice| slice.try_into().ok())
            .ok_or(Refused::InvalidLength)?;
        decode_point(point)?;
    }
    Ok(())
}

/// Every check, in the crate's order: the vectors' `error`.
pub fn check_envelope(envelope: &[u8]) -> Result<(), Refused> {
    check_shape(envelope)?;
    check_points(envelope)
}

/// seedelf-messaging's `decode_point`: the canonical compressed encoding of
/// a point in G1's prime-order subgroup, other than the identity.
fn decode_point(bytes: &[u8; POINT_LEN]) -> Result<G1Affine, Refused> {
    // blst checks the flag bits, that x is below the field modulus and that
    // the point is on the curve, but not the subgroup.
    let point: G1Affine =
        Option::from(G1Affine::from_compressed_unchecked(bytes)).ok_or(Refused::InvalidEncoding)?;
    // One encoding per point: stray bits beside the infinity flag are refused.
    if point.to_compressed() != *bytes || !bool::from(point.is_on_curve()) {
        return Err(Refused::InvalidEncoding);
    }
    if bool::from(point.is_identity()) {
        return Err(Refused::IdentityPoint);
    }
    if !bool::from(point.is_torsion_free()) {
        return Err(Refused::NotInSubgroup);
    }
    Ok(point)
}

/// `SHA-256(STAMP_LABEL ‖ len(pool) ‖ pool ‖ envelope)`. Pools are named
/// here, so a name is never longer than a byte counts.
pub fn stamp_digest(pool: &str, envelope: &[u8]) -> [u8; 32] {
    let len = u8::try_from(pool.len()).expect("a pool's name is short");
    Sha256::new()
        .chain_update(STAMP_LABEL)
        .chain_update([len])
        .chain_update(pool.as_bytes())
        .chain_update(envelope)
        .finalize()
        .into()
}

/// The leading zero bits of `SHA-256(digest ‖ nonce)`.
pub fn stamp_bits(digest: &[u8; 32], nonce: u64) -> u32 {
    let hash = Sha256::new()
        .chain_update(digest)
        .chain_update(nonce.to_be_bytes())
        .finalize();
    let mut bits = 0;
    for &byte in hash.iter() {
        if byte != 0 {
            return bits + byte.leading_zeros();
        }
        bits += 8;
    }
    bits
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::Value;

    pub(crate) fn vectors() -> Value {
        serde_json::from_str(include_str!(
            "../../../../seedelf-platform/seedelf-messaging/tests/vectors/messaging_relay_v1.json"
        ))
        .unwrap()
    }

    fn bytes(hex: &str) -> Vec<u8> {
        (0..hex.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
            .collect()
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn the_constants_are_the_crates() {
        let v = vectors();
        assert_eq!(v["version"], 1);
        assert_eq!(v["stamp_label"], std::str::from_utf8(STAMP_LABEL).unwrap());
        assert_eq!(v["nonce_len"], NONCE_LEN);
        assert_eq!(v["sizes"], serde_json::json!(SIZES));
    }

    #[test]
    fn every_envelope_is_judged_as_the_crate_judges_it() {
        let v = vectors();
        let posts = v["posts"].as_array().unwrap();
        assert!(posts.len() >= 20);
        for post in posts {
            let envelope = bytes(post["envelope"].as_str().unwrap());
            let got = check_envelope(&envelope).err().map(Refused::name);
            assert_eq!(got, post["error"].as_str(), "{}", post["name"]);
            // The two halves the relay runs apart agree with the whole.
            let halves = check_shape(&envelope).and_then(|()| check_points(&envelope));
            assert_eq!(halves.err().map(Refused::name), got, "{}", post["name"]);
        }
    }

    #[test]
    fn every_stamp_shows_the_crates_work() {
        let v = vectors();
        let posts = v["posts"].as_array().unwrap();
        let stamps = v["stamps"].as_array().unwrap();
        assert!(stamps.len() >= 6);
        for stamp in stamps {
            let name = stamp["envelope"].as_str().unwrap();
            let post = posts.iter().find(|p| p["name"] == name).unwrap();
            let envelope = bytes(post["envelope"].as_str().unwrap());
            let pool = stamp["pool"].as_str().unwrap();
            let digest = stamp_digest(pool, &envelope);
            assert_eq!(hex(&digest), stamp["digest"], "{stamp}");
            let nonce = stamp["nonce"].as_u64().unwrap();
            let bits = stamp["bits"].as_u64().unwrap() as u32;
            let zeros = stamp_bits(&digest, nonce);
            assert_eq!(
                u64::from(zeros),
                stamp["zeros"].as_u64().unwrap(),
                "{stamp}"
            );
            assert!(zeros >= bits);
            // The first from 0: every nonce before it shows less.
            assert!((0..nonce).all(|n| stamp_bits(&digest, n) < bits), "{stamp}");
            assert_eq!(hex(&nonce.to_be_bytes()), stamp["post"]);
        }
    }
}
