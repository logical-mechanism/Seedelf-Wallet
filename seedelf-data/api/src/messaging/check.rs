//! The relay's copy of what a post must be: seedelf-messaging's `relay`
//! module, which the data layer can't depend on, as its Lovejoin rules are
//! copies too. Both are held to
//! `seedelf-messaging/tests/vectors/messaging_relay_v1.json`, which the
//! crate writes: a change here or there that the other doesn't make fails
//! a test.
//!
//! A post is `nonce (8, big-endian) ‖ envelope`, and an envelope is
//! `version (1) ‖ p (48) ‖ tag (32) ‖ c (48) ‖ ciphertext`. The envelope
//! must be version 1, one of the session layer's four sizes, and carry two
//! valid points, `p` and `c`, with a 32-byte tag between them that isn't
//! checked: only its reader can tell it from any other 32 bytes. Its
//! stamp's work is the leading zero bits of `SHA-256(digest ‖ nonce)`,
//! where the digest binds the envelope and the pool (docs/protocol.md §17).

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

/// Where the envelope's tag starts, after the version and `p`, and how long
/// it is: a hash only the envelope's reader can work out, which nothing
/// here reads.
pub const TAG_AT: usize = 1 + POINT_LEN;
pub const TAG_LEN: usize = 32;

/// Where `p` and `c` start, in the order they're checked.
pub const POINTS_AT: [usize; 2] = [1, TAG_AT + TAG_LEN];

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

/// `p`, then `c`: the first that fails is the error, and the tag between
/// them is never decoded. The caller has checked the shape.
pub fn check_points(envelope: &[u8]) -> Result<(), Refused> {
    for start in POINTS_AT {
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
        // The envelope's layout: `p`, the tag, then `c`.
        assert_eq!(v["points_at"], serde_json::json!(POINTS_AT));
        assert_eq!(v["tag_at"], TAG_AT);
        assert_eq!(v["tag_len"], TAG_LEN);
    }

    /// The layout the vectors give, `version | p | tag | c` (DESIGN-protocol
    /// v3 §3.0): a point at either of `points_at` is checked, and the tag
    /// between them is never read, whatever its bytes, nor is the
    /// ciphertext after `c`.
    #[test]
    fn only_the_points_where_the_vectors_put_them_are_checked() {
        let v = vectors();
        let post = |name: &str| {
            let posts = v["posts"].as_array().unwrap();
            let post = posts.iter().find(|p| p["name"] == name).unwrap();
            bytes(post["envelope"].as_str().unwrap())
        };
        let good = post("512 bytes");
        assert_eq!(check_envelope(&good), Ok(()));
        // The identity's encoding, where each point is, is refused as one.
        let mut identity = [0u8; POINT_LEN];
        identity[0] = 0xc0;
        let points: Vec<usize> = v["points_at"]
            .as_array()
            .unwrap()
            .iter()
            .map(|at| at.as_u64().unwrap() as usize)
            .collect();
        assert_eq!(points.len(), 2);
        for at in points {
            let mut envelope = good.clone();
            envelope[at..at + POINT_LEN].copy_from_slice(&identity);
            assert_eq!(
                check_envelope(&envelope),
                Err(Refused::IdentityPoint),
                "{at}"
            );
        }
        // Each byte of the tag, and of the ciphertext, set to anything: kept.
        let tag_at = v["tag_at"].as_u64().unwrap() as usize;
        let tag_len = v["tag_len"].as_u64().unwrap() as usize;
        let header = tag_at + tag_len + POINT_LEN;
        for i in (tag_at..tag_at + tag_len).chain([header, 300, good.len() - 1]) {
            for byte in [0x00, 0xff, good[i] ^ 0xff] {
                let mut envelope = good.clone();
                envelope[i] = byte;
                assert_eq!(check_envelope(&envelope), Ok(()), "byte {i} = {byte:#04x}");
            }
        }
        // A whole tag that starts as the identity's encoding does, and no
        // point's encoding at all.
        let tags: [&[u8]; 3] = [&identity[..32], &[0x00; 32], &[0xff; 32]];
        for tag in tags {
            let mut envelope = good.clone();
            envelope[tag_at..tag_at + tag_len].copy_from_slice(tag);
            assert_eq!(check_envelope(&envelope), Ok(()));
        }
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

    /// blst, under `check_points`, compiles for the CPU of the machine that
    /// builds it unless it's built `portable`: on a builder with ADX, as the
    /// deploy's runner is, it holds the ADX code alone, and on a server
    /// without ADX the first post to show its work would kill the API with
    /// an illegal instruction (the gate review's relay-server#4). Portable,
    /// it holds both and picks at run time.
    #[test]
    fn the_point_check_is_built_for_any_x86_64_cpu() {
        let manifest = include_str!("../../Cargo.toml");
        let blstrs = manifest
            .lines()
            .find(|line| line.starts_with("blstrs "))
            .expect("blstrs in api/Cargo.toml");
        assert!(blstrs.contains(r#"features = ["portable"]"#), "{blstrs}");
    }
}
