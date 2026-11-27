//! What a post to the relay must be (chunk 54's 54c, docs/protocol.md §17):
//! a v1 envelope of one of the session layer's four sizes whose two points
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
/// [`ENVELOPE_SIZES`] long, and `p` (bytes 1 to 48) and `c` (bytes 81 to
/// 128) each canonical, in G1 and not the identity. The tag between them
/// (bytes 49 to 80) is any 32 bytes: only the recipient can tell it from
/// any other. The checks run in that order, and the first that fails is the
/// error. Nothing here decrypts, and nothing could: only the recipient holds
/// the key.
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

/// SHA-256's label for a certificate post's stamp and its listing digest
/// (docs/protocol.md §21.7). Neither it nor the certificate's challenge
/// label, `…|certificate`, is a prefix of the other, or of [`STAMP_LABEL`].
pub const LISTING_STAMP_LABEL: &[u8] = b"Seedelf-Messaging|v1|listing-stamp|";

/// A certificate's listing digest under `pool`:
/// `SHA-256(LISTING_STAMP_LABEL ‖ len(pool) ‖ pool ‖ certificate)`. Its post's
/// stamp is over it, as an envelope's is over [`stamp_digest`], and a
/// removal entry in the list names a certificate by it (§21.7). A pool's
/// name is at most 255 bytes.
pub fn listing_digest(pool: &str, certificate: &[u8]) -> Result<[u8; 32], Error> {
    let len = u8::try_from(pool.len()).map_err(|_| Error::InvalidLength)?;
    Ok(Sha256::new()
        .chain_update(LISTING_STAMP_LABEL)
        .chain_update([len])
        .chain_update(pool.as_bytes())
        .chain_update(certificate)
        .finalize()
        .into())
}

/// SHA-256's label for a withdrawal post's stamp (docs/protocol.md §21.7).
pub const UNLISTING_STAMP_LABEL: &[u8] = b"Seedelf-Messaging|v1|unlisting-stamp|";

/// A withdrawal's stamp digest under `pool`:
/// `SHA-256(UNLISTING_STAMP_LABEL ‖ len(pool) ‖ pool ‖ withdrawal)`, what its
/// post's stamp is solved over (§21.7). A pool's name is at most 255 bytes.
pub fn unlisting_digest(pool: &str, withdrawal: &[u8]) -> Result<[u8; 32], Error> {
    let len = u8::try_from(pool.len()).map_err(|_| Error::InvalidLength)?;
    Ok(Sha256::new()
        .chain_update(UNLISTING_STAMP_LABEL)
        .chain_update([len])
        .chain_update(pool.as_bytes())
        .chain_update(withdrawal)
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

    /// Where `p`, the tag and `c` start: `version (1) | p (48) | tag (32) |
    /// c (48)`.
    const P_AT: usize = 1;
    const TAG_AT: usize = 49;
    const C_AT: usize = 81;

    fn with_bytes(envelope: &[u8], at: usize, bytes: &[u8]) -> Vec<u8> {
        let mut out = envelope.to_vec();
        out[at..at + bytes.len()].copy_from_slice(bytes);
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
            ("145 bytes, an empty v1 envelope", envelope(145, "145")),
            (
                "1,024 bytes, a v1 envelope of no session size",
                envelope(1024, "1024"),
            ),
            ("p is the identity", with_bytes(&small, P_AT, &identity())),
            (
                "p is off the curve",
                with_bytes(&small, P_AT, &off_the_curve()),
            ),
            (
                "p is outside G1",
                with_bytes(&small, P_AT, &outside_the_subgroup()),
            ),
            (
                "p's x is the field modulus",
                with_bytes(&small, P_AT, &the_modulus()),
            ),
            // The tag is no point: any 32 bytes are kept.
            (
                "the tag is 32 zero bytes",
                with_bytes(&small, TAG_AT, &[0; 32]),
            ),
            (
                "the tag is 32 bytes of 0xff",
                with_bytes(&small, TAG_AT, &[0xff; 32]),
            ),
            ("c is the identity", with_bytes(&small, C_AT, &identity())),
            (
                "c is off the curve",
                with_bytes(&small, C_AT, &off_the_curve()),
            ),
            (
                "c is outside G1",
                with_bytes(&small, C_AT, &outside_the_subgroup()),
            ),
            (
                "c's x is the field modulus",
                with_bytes(&small, C_AT, &the_modulus()),
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
            "description": "What the relay checks of a post (docs/protocol.md §17). A post is nonce (8, big-endian) || envelope, and an envelope is version (1) || p (48) || tag (32) || c (48) || ciphertext. The relay keeps an envelope only if its version is 1, its length is one of sizes, and p and c (bytes 1-48 and 81-128) are each canonical compressed G1 points in the prime-order subgroup and not the identity, checked in that order; the tag (bytes 49-80) is any 32 bytes, and isn't checked. error names the first check that fails, or is null. digest = SHA-256(stamp_label || len(pool) (1 byte) || pool || envelope); a stamp's work is the leading zero bits of SHA-256(digest || nonce (8, big-endian)), and nonce is the first from 0 with at least bits. post is the post's first 8 bytes. A stamp's envelope is the name of one of posts, zeros is its work, and nonce is a JSON number.",
            "version": 1,
            "stamp_label": String::from_utf8(STAMP_LABEL.to_vec()).unwrap(),
            "nonce_len": NONCE_LEN,
            "max_stamp_bits": MAX_STAMP_BITS,
            "sizes": ENVELOPE_SIZES,
            "points_at": [P_AT, C_AT],
            "tag_at": TAG_AT,
            "tag_len": C_AT - TAG_AT,
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

    /// The layout the vectors name is the envelope's: p, then the tag, then
    /// c, then the ciphertext, the header ending at `HEADER_LEN`.
    #[test]
    fn the_layout_is_the_envelopes() {
        assert_eq!(TAG_AT, P_AT + 48);
        assert_eq!(C_AT, TAG_AT + 32);
        assert_eq!(C_AT + 48, crate::HEADER_LEN);
    }

    /// The tag is never judged: every one of its bits flipped, the envelope
    /// is still kept, and a point's bytes moved into p's or c's place are
    /// what's refused.
    #[test]
    fn the_tag_is_any_32_bytes() {
        let small = envelope(512, "512");
        for bit in 0..32 * 8 {
            let mut changed = small.clone();
            changed[TAG_AT + bit / 8] ^= 1 << (bit % 8);
            assert_eq!(check_envelope(&changed), Ok(()), "bit {bit}");
        }
        for at in [P_AT, C_AT] {
            assert_eq!(
                check_envelope(&with_bytes(&small, at, &identity())),
                Err(Error::IdentityPoint)
            );
        }
    }

    #[test]
    fn a_session_envelope_is_kept() {
        use crate::SecretKey;
        use crate::session::Inbox;
        let (alice, bob) = (SecretKey::generate(), SecretKey::generate());
        let mut inbox = Inbox::new();
        // Below the handle layer: the relay reads no handle, so any register.
        let cid = inbox
            .start_on(&alice, &bob.register(), b"bob", 1_800_000_000)
            .unwrap();
        // The relay doesn't read the first-contact stamp: any nonce sends.
        inbox.set_stamp(cid, 0).unwrap();
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
    /// A certificate's listing digest is §21.7's SHA-256, over its own label,
    /// the pool's name and length, and the certificate's bytes; never an
    /// envelope's stamp digest of the same bytes.
    #[test]
    fn a_listing_digest_is_its_own_label_over_the_pool_and_the_certificate() {
        let certificate = [0x5a; 273];
        let mut expected = Sha256::new();
        expected.update(b"Seedelf-Messaging|v1|listing-stamp|");
        expected.update([7u8]);
        expected.update(b"preprod");
        expected.update(certificate);
        let expected: [u8; 32] = expected.finalize().into();
        assert_eq!(listing_digest("preprod", &certificate).unwrap(), expected);
        assert_ne!(
            listing_digest("preprod", &certificate).unwrap(),
            stamp_digest("preprod", &certificate).unwrap()
        );
        assert_ne!(
            listing_digest("preprod", &certificate).unwrap(),
            listing_digest("mainnet", &certificate).unwrap()
        );
        assert_eq!(
            listing_digest(&"x".repeat(256), b""),
            Err(Error::InvalidLength)
        );
    }

    /// The raw SHA-256 labels a certificate meets are prefix-free among
    /// themselves and against the envelope's stamp (joint-security.md, rule 3).
    #[test]
    fn the_certificate_labels_are_prefix_free() {
        let labels: [&[u8]; 5] = [
            LISTING_STAMP_LABEL,
            UNLISTING_STAMP_LABEL,
            STAMP_LABEL,
            b"Seedelf-Messaging|v1|certificate",
            b"Seedelf-Messaging|v1|withdrawal",
        ];
        for (i, a) in labels.iter().enumerate() {
            for (j, b) in labels.iter().enumerate() {
                assert!(i == j || !b.starts_with(a), "{a:?} is a prefix of {b:?}");
            }
        }
    }
}
