//! What a post to the relay must be (chunk 54's 54c, docs/protocol.md §17):
//! a v1 envelope of one of the session layer's four sizes whose three points
//! are valid, and proof of work over its bytes.
//!
//! **The stamp.** A post is `nonce (8, big-endian) ‖ envelope`. Its work is
//! the number of leading zero bits of
//!
//! ```text
//! SHA-256(digest ‖ nonce)   with   digest = SHA-256(STAMP_LABEL ‖ len(pool) (1) ‖ pool ‖ envelope)
//! ```
//!
//! The digest binds the work to the envelope's bytes and to the pool, so it
//! can't be reused for another envelope or moved to another network's pool.
//! Each attempt is one SHA-256 block (40 bytes), whatever the envelope's size.
//!
//! The relay keeps its own copy of these checks (seedelf-data's `messaging`
//! module), held to tests/vectors/messaging_relay_v1.json, which this
//! module's tests write. No network and no clock here: what a post costs is
//! the relay's to say.

use sha2::{Digest, Sha256};

use crate::session::ENVELOPE_SIZES;
use crate::{Envelope, Error, VERSION};

/// The stamp's label, before the pool's name.
pub const STAMP_LABEL: &[u8] = b"Seedelf-Messaging|v1|stamp|";

/// A post's nonce: 8 bytes, big-endian, before the envelope.
pub const NONCE_LEN: usize = 8;

/// The most work [`solve_stamp`] takes on: 2³² attempts on average, about
/// half an hour of WebAssembly. A relay asks for far less (docs/protocol.md
/// §17).
pub const MAX_STAMP_BITS: u32 = 32;

/// Whether the relay keeps `envelope`: version 1, exactly one of
/// [`ENVELOPE_SIZES`] long, and `p`, `w` and `c` each canonical, in G1 and
/// not the identity. The checks run in that order, and the first that fails
/// is the error. Nothing here decrypts, and nothing could: only the
/// recipient holds the key.
pub fn check_envelope(envelope: &[u8]) -> Result<(), Error> {
    match envelope.first() {
        None => return Err(Error::InvalidLength),
        Some(&version) if version != VERSION => return Err(Error::UnsupportedVersion(version)),
        Some(_) => {}
    }
    if !ENVELOPE_SIZES.contains(&envelope.len()) {
        return Err(Error::InvalidLength);
    }
    Envelope::from_bytes(envelope).map(|_| ())
}

/// `SHA-256(STAMP_LABEL ‖ len(pool) ‖ pool ‖ envelope)`. A pool's name is at
/// most 255 bytes.
pub fn stamp_digest(pool: &str, envelope: &[u8]) -> Result<[u8; 32], Error> {
    let len = u8::try_from(pool.len()).map_err(|_| Error::InvalidLength)?;
    Ok(Sha256::new()
        .chain_update(STAMP_LABEL)
        .chain_update([len])
        .chain_update(pool.as_bytes())
        .chain_update(envelope)
        .finalize()
        .into())
}

/// The work `nonce` shows for `digest`: the leading zero bits of
/// `SHA-256(digest ‖ nonce)`, the most significant bit of the first byte
/// first.
pub fn stamp_bits(digest: &[u8; 32], nonce: u64) -> u32 {
    let hash = Sha256::new()
        .chain_update(digest)
        .chain_update(nonce.to_be_bytes())
        .finalize();
    leading_zero_bits(&hash)
}

/// The first nonce in `from..from + attempts` that shows at least `bits`, if
/// one does: [`solve_stamp`] in slices, so a caller can yield between them.
pub fn find_stamp(digest: &[u8; 32], bits: u32, from: u64, attempts: u64) -> Option<u64> {
    (from..from.saturating_add(attempts)).find(|&nonce| stamp_bits(digest, nonce) >= bits)
}

/// The first nonce from 0 that shows at least `bits` for `envelope` in
/// `pool`. Each attempt is one SHA-256 block; `bits` takes 2^bits attempts on
/// average. [`Error::StampTooHard`] past [`MAX_STAMP_BITS`].
pub fn solve_stamp(pool: &str, envelope: &[u8], bits: u32) -> Result<u64, Error> {
    if bits > MAX_STAMP_BITS {
        return Err(Error::StampTooHard);
    }
    let digest = stamp_digest(pool, envelope)?;
    find_stamp(&digest, bits, 0, u64::MAX).ok_or(Error::StampTooHard)
}

/// A post's body: `nonce (8, big-endian) ‖ envelope`.
pub fn post_body(nonce: u64, envelope: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(NONCE_LEN + envelope.len());
    body.extend_from_slice(&nonce.to_be_bytes());
    body.extend_from_slice(envelope);
    body
}

fn leading_zero_bits(hash: &[u8]) -> u32 {
    let mut bits = 0;
    for &byte in hash {
        if byte != 0 {
            return bits + byte.leading_zeros();
        }
        bits += 8;
    }
    bits
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use blstrs::G1Affine;
    use serde_json::{Value, json};

    use super::*;
    use crate::ENVELOPE_OVERHEAD;
    use crate::envelope::seal;
    use crate::tests::{root_register, test_scalar};

    const VECTORS: &str = "tests/vectors/messaging_relay_v1.json";

    /// A v1 envelope `len` bytes long, from fixed scalars. The relay reads
    /// only its header, so the plaintext is any bytes of the right length.
    fn envelope(len: usize, label: &str) -> Vec<u8> {
        let root = root_register(&test_scalar("relay vectors y"), None);
        let b = test_scalar(&format!("relay vectors {label} b"));
        let r = test_scalar(&format!("relay vectors {label} r"));
        let plaintext: Vec<u8> = (0..len - ENVELOPE_OVERHEAD)
            .map(|i| (i * 31 + len) as u8)
            .collect();
        seal(&root, &b, &r, &plaintext).unwrap().to_bytes()
    }

    fn compressed_x(x: u64) -> [u8; 48] {
        let mut bytes = [0u8; 48];
        bytes[40..].copy_from_slice(&x.to_be_bytes());
        bytes[0] |= 0x80;
        bytes
    }

    fn decoded(bytes: &[u8; 48]) -> Option<G1Affine> {
        Option::from(G1Affine::from_compressed_unchecked(bytes))
    }

    /// A point on the curve outside G1: most are, the cofactor being about 2¹²⁶.
    fn outside_the_subgroup() -> [u8; 48] {
        (1u64..)
            .map(compressed_x)
            .find(|bytes| {
                decoded(bytes).is_some_and(|p| {
                    bool::from(p.is_on_curve()) && !bool::from(p.is_torsion_free())
                })
            })
            .unwrap()
    }

    /// An x with no point on the curve.
    fn off_the_curve() -> [u8; 48] {
        (1u64..)
            .map(compressed_x)
            .find(|bytes| decoded(bytes).is_none())
            .unwrap()
    }

    fn identity() -> [u8; 48] {
        let mut bytes = [0u8; 48];
        bytes[0] = 0xc0;
        bytes
    }

    /// BLS12-381's base field modulus, with the compression flag: not canonical.
    fn the_modulus() -> [u8; 48] {
        let mut bytes: [u8; 48] = hex::decode("1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab").unwrap().try_into().unwrap();
        bytes[0] |= 0x80;
        bytes
    }

    fn with_point(envelope: &[u8], index: usize, point: [u8; 48]) -> Vec<u8> {
        let mut out = envelope.to_vec();
        out[1 + 48 * index..1 + 48 * (index + 1)].copy_from_slice(&point);
        out
    }

    /// The error's name in the vectors: what the relay's copy must answer.
    fn error_name(error: Error) -> &'static str {
        match error {
            Error::UnsupportedVersion(_) => "unsupported_version",
            Error::InvalidLength => "invalid_length",
            Error::InvalidEncoding => "invalid_encoding",
            Error::NotInSubgroup => "not_in_subgroup",
            Error::IdentityPoint => "identity_point",
            other => panic!("check_envelope gave {other:?}"),
        }
    }

    /// Every envelope the vectors hold, by name.
    fn envelopes() -> Vec<(&'static str, Vec<u8>)> {
        let small = envelope(512, "512");
        let mut version_0 = small.clone();
        version_0[0] = 0;
        let mut version_2 = small.clone();
        version_2[0] = 2;
        let mut longer = small.clone();
        longer.push(0);
        vec![
            ("512 bytes", small.clone()),
            ("2,048 bytes", envelope(2048, "2048")),
            ("8,192 bytes", envelope(8192, "8192")),
            ("32,768 bytes", envelope(32768, "32768")),
            ("version 0", version_0),
            ("version 2", version_2),
            ("empty", Vec::new()),
            ("511 bytes", small[..511].to_vec()),
            ("513 bytes", longer),
            ("161 bytes, an empty v1 envelope", envelope(161, "161")),
            (
                "1,024 bytes, a v1 envelope of no session size",
                envelope(1024, "1024"),
            ),
            ("p is the identity", with_point(&small, 0, identity())),
            ("p is off the curve", with_point(&small, 0, off_the_curve())),
            (
                "p is outside G1",
                with_point(&small, 0, outside_the_subgroup()),
            ),
            (
                "p's x is the field modulus",
                with_point(&small, 0, the_modulus()),
            ),
            ("w is the identity", with_point(&small, 1, identity())),
            (
                "w is outside G1",
                with_point(&small, 1, outside_the_subgroup()),
            ),
            ("c is the identity", with_point(&small, 2, identity())),
            ("c is off the curve", with_point(&small, 2, off_the_curve())),
            (
                "c is outside G1",
                with_point(&small, 2, outside_the_subgroup()),
            ),
        ]
    }

    /// Stamps to solve: (the envelope's name, the pool, the bits).
    const STAMPS: [(&str, &str, u32); 6] = [
        ("512 bytes", "mainnet", 0),
        ("512 bytes", "mainnet", 8),
        ("512 bytes", "mainnet", 16),
        ("512 bytes", "preprod", 16),
        ("512 bytes", "mainnet", 20),
        ("32,768 bytes", "mainnet", 12),
    ];

    fn all_vectors() -> Value {
        let envelopes = envelopes();
        let posts: Vec<Value> = envelopes
            .iter()
            .map(|(name, bytes)| {
                json!({
                    "name": name,
                    "envelope": hex::encode(bytes),
                    "error": check_envelope(bytes).err().map(error_name),
                })
            })
            .collect();
        let stamps: Vec<Value> = STAMPS
            .iter()
            .map(|&(name, pool, bits)| {
                let bytes = &envelopes.iter().find(|(n, _)| *n == name).unwrap().1;
                let digest = stamp_digest(pool, bytes).unwrap();
                let nonce = solve_stamp(pool, bytes, bits).unwrap();
                let hash = Sha256::new()
                    .chain_update(digest)
                    .chain_update(nonce.to_be_bytes())
                    .finalize();
                json!({
                    "envelope": name,
                    "pool": pool,
                    "bits": bits,
                    "digest": hex::encode(digest),
                    "nonce": nonce,
                    "hash": hex::encode(hash),
                    "zeros": stamp_bits(&digest, nonce),
                    "post": hex::encode(&post_body(nonce, bytes)[..NONCE_LEN]),
                })
            })
            .collect();
        json!({
            "description": "What the relay checks of a post (docs/protocol.md §17). A post is nonce (8, big-endian) || envelope. The relay keeps an envelope only if its version is 1, its length is one of sizes, and p, w and c (bytes 1-48, 49-96, 97-144) are each canonical compressed G1 points in the prime-order subgroup and not the identity, checked in that order; error names the first check that fails, or is null. digest = SHA-256(stamp_label || len(pool) (1 byte) || pool || envelope); a stamp's work is the leading zero bits of SHA-256(digest || nonce (8, big-endian)), and nonce is the first from 0 with at least bits. post is the post's first 8 bytes.",
            "version": 1,
            "stamp_label": String::from_utf8(STAMP_LABEL.to_vec()).unwrap(),
            "nonce_len": NONCE_LEN,
            "max_stamp_bits": MAX_STAMP_BITS,
            "sizes": ENVELOPE_SIZES,
            "posts": posts,
            "stamps": stamps,
        })
    }

    /// The vectors file is what the code computes.
    /// `RECORD_MESSAGING_RELAY_VECTORS=1` rewrites it, for a deliberate
    /// change of format only: the relay's copy is held to these bytes.
    #[test]
    fn relay_vectors_match_the_file() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(VECTORS);
        let computed = all_vectors();
        if std::env::var("RECORD_MESSAGING_RELAY_VECTORS").as_deref() == Ok("1") {
            let text = serde_json::to_string_pretty(&computed).unwrap() + "\n";
            std::fs::write(&path, text).unwrap();
        }
        let recorded: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(computed, recorded);
    }

    #[test]
    fn the_vectors_cover_every_refusal() {
        let names: Vec<Option<&str>> = envelopes()
            .iter()
            .map(|(_, bytes)| check_envelope(bytes).err().map(error_name))
            .collect();
        for expected in [
            None,
            Some("unsupported_version"),
            Some("invalid_length"),
            Some("invalid_encoding"),
            Some("not_in_subgroup"),
            Some("identity_point"),
        ] {
            assert!(names.contains(&expected), "{expected:?}");
        }
        // Each of the four sizes is kept.
        for size in ENVELOPE_SIZES {
            assert_eq!(check_envelope(&envelope(size, "any")), Ok(()), "{size}");
        }
    }

    #[test]
    fn a_session_envelope_is_kept() {
        use crate::SecretKey;
        use crate::session::Inbox;
        let (alice, bob) = (SecretKey::generate(), SecretKey::generate());
        let mut inbox = Inbox::new();
        let cid = inbox
            .start(&alice, &bob.register(), b"", 1_800_000_000)
            .unwrap();
        for text in [&b"hi"[..], &[7u8; 1000], &[7u8; 5000], &[7u8; 20_000]] {
            assert_eq!(check_envelope(&inbox.send(cid, text).unwrap()), Ok(()));
        }
    }

    #[test]
    fn a_stamp_shows_its_work_and_no_more() {
        let bytes = envelope(512, "512");
        let digest = stamp_digest("mainnet", &bytes).unwrap();
        let nonce = solve_stamp("mainnet", &bytes, 12).unwrap();
        assert!(stamp_bits(&digest, nonce) >= 12);
        // The first: every nonce before it shows less.
        assert!((0..nonce).all(|n| stamp_bits(&digest, n) < 12));
        assert_eq!(find_stamp(&digest, 12, 0, nonce + 1), Some(nonce));
        assert_eq!(find_stamp(&digest, 12, 0, nonce), None);
        assert_eq!(find_stamp(&digest, 12, nonce, 1), Some(nonce));
        // Bound to the envelope's bytes and to the pool.
        let mut other = bytes.clone();
        other[300] ^= 1;
        assert_ne!(stamp_digest("mainnet", &other).unwrap(), digest);
        assert_ne!(stamp_digest("preprod", &bytes).unwrap(), digest);
        // The pool's length is bound too: "a" + "bc…" isn't "ab" + "c…".
        assert_ne!(
            stamp_digest("a", b"bc").unwrap(),
            stamp_digest("ab", b"c").unwrap()
        );
    }

    #[test]
    fn a_stamp_past_the_most_is_refused() {
        assert_eq!(
            solve_stamp("mainnet", b"", MAX_STAMP_BITS + 1),
            Err(Error::StampTooHard)
        );
        assert_eq!(
            stamp_digest(&"x".repeat(256), b""),
            Err(Error::InvalidLength)
        );
        assert!(stamp_digest(&"x".repeat(255), b"").is_ok());
    }

    #[test]
    fn zero_bits_count_from_the_first_byte() {
        assert_eq!(leading_zero_bits(&[0x80, 0]), 0);
        assert_eq!(leading_zero_bits(&[0x01, 0xff]), 7);
        assert_eq!(leading_zero_bits(&[0, 0x40]), 9);
        assert_eq!(leading_zero_bits(&[0, 0]), 16);
    }

    #[test]
    fn a_post_is_its_nonce_then_its_envelope() {
        assert_eq!(
            post_body(0x0102_0304_0506_0708, b"env"),
            [1, 2, 3, 4, 5, 6, 7, 8, b'e', b'n', b'v']
        );
    }
}
