//! Tests that need the crate's internals: the test vectors (fixed `b` and
//! `r`), the key schedule's binding and domain separation, and decryption
//! forced past the discovery check.

use std::path::PathBuf;

use blstrs::{G1Affine, G1Projective, Scalar};
use group::Curve;
use group::prime::PrimeCurveAffine;
use hkdf::Hkdf;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::envelope::{
    ENVELOPE_TAG_LABEL, KDF_INFO, KDF_SALT, derive_key_and_nonce, envelope_tag, open, seal,
};
use crate::register::{POINT_LEN, Register, rerandomize_with};
use crate::{Envelope, Error, HEADER_LEN, SecretKey, decrypt_message};

/// Where an envelope's tag and its ephemeral point c start.
const TAG_AT: usize = 1 + POINT_LEN;
const C_AT: usize = HEADER_LEN - POINT_LEN;

/// A fixed scalar for tests: SHA-256 of a label with its top two bits
/// cleared, so it's below the group order. Production scalars come from the
/// operating system's generator alone.
pub(crate) fn test_scalar(label: &str) -> Scalar {
    let mut bytes: [u8; 32] = Sha256::digest(label.as_bytes()).into();
    bytes[0] &= 0x3f;
    Option::from(Scalar::from_bytes_be(&bytes)).expect("below the group order")
}

fn g() -> G1Projective {
    G1Projective::from(G1Affine::generator())
}

pub(crate) fn root_register(y: &Scalar, d: Option<&Scalar>) -> Register {
    let generator = match d {
        Some(d) => g() * d,
        None => g(),
    };
    Register::from_checked(generator.to_affine(), (generator * y).to_affine())
}

fn register_json(register: &Register) -> Value {
    json!({
        "generator": hex::encode(register.generator_bytes()),
        "public_value": hex::encode(register.public_value_bytes()),
    })
}

// --- Test 13: deterministic test vectors ------------------------------------

const VECTORS: &str = "tests/vectors/messaging_v1.json";

struct Case {
    name: &'static str,
    /// Re-randomize the root's generator first, as a Seedelf datum's is.
    rerandomized_root: bool,
    plaintext: Vec<u8>,
}

fn cases() -> Vec<Case> {
    vec![
        Case {
            name: "standard generator, empty plaintext",
            rerandomized_root: false,
            plaintext: Vec::new(),
        },
        Case {
            name: "standard generator, ASCII plaintext",
            rerandomized_root: false,
            plaintext: b"Hello from Seedelf Messaging".to_vec(),
        },
        Case {
            name: "re-randomized root generator, every byte value",
            rerandomized_root: true,
            plaintext: (0..=255u8).collect(),
        },
        Case {
            name: "standard generator, UTF-8 plaintext",
            rerandomized_root: false,
            plaintext: "Seedelf ✉ メッセージ 🌱".as_bytes().to_vec(),
        },
    ]
}

/// Every intermediate value, from the fixed scalars, through the crate's own
/// functions.
fn vector(i: usize, case: &Case) -> Value {
    let y = test_scalar(&format!("seedelf-messaging v1 vector {i} y"));
    let d = test_scalar(&format!("seedelf-messaging v1 vector {i} d"));
    let b = test_scalar(&format!("seedelf-messaging v1 vector {i} b"));
    let r = test_scalar(&format!("seedelf-messaging v1 vector {i} r"));

    let root = root_register(&y, case.rerandomized_root.then_some(&d));
    let rerandomized = rerandomize_with(&root, &b);
    let envelope = seal(&root, &b, &r, &case.plaintext).expect("seals");
    let header = envelope.header();
    let tag = envelope_tag(&rerandomized.public_value_bytes()).into_bytes();
    assert_eq!(header[TAG_AT..C_AT], tag[..]);
    let shared = (rerandomized.public_value() * r).to_compressed();
    let okm = derive_key_and_nonce(&shared, &header);

    json!({
        "name": case.name,
        "secret_key": hex::encode(y.to_bytes_be()),
        "root_register": register_json(&root),
        "b": hex::encode(b.to_bytes_be()),
        "r": hex::encode(r.to_bytes_be()),
        "rerandomized_register": register_json(&rerandomized),
        "tag": hex::encode(tag),
        "ephemeral": hex::encode(&header[C_AT..]),
        "shared_point": hex::encode(shared),
        "aes_key": hex::encode(&okm[..32]),
        "nonce": hex::encode(&okm[32..]),
        "header": hex::encode(header),
        "plaintext": hex::encode(&case.plaintext),
        "envelope": hex::encode(envelope.to_bytes()),
    })
}

fn all_vectors() -> Value {
    json!({
        "description": "Seedelf Messaging v1 test vectors. Scalars are 32-byte big-endian; points are 48-byte compressed G1. (p, w) = ([b]g, [b]v) is rerandomized_register; tag = SHA-256(tag_label || w), 32 bytes; ephemeral = [r]p; shared_point = [r]w = [y]ephemeral; header = 0x01 || p || tag || ephemeral, 129 bytes, w itself not in it; aes_key || nonce = HKDF-SHA256(salt = kdf_salt, ikm = shared_point, info = kdf_info || header, 44 bytes); envelope = header || AES-256-GCM(aes_key, nonce, aad = header, plaintext). A reader with y tests whether SHA-256(tag_label || [y]p) is the tag.",
        "version": 1,
        "kdf_salt": String::from_utf8(KDF_SALT.to_vec()).expect("ASCII"),
        "kdf_info": String::from_utf8(KDF_INFO.to_vec()).expect("ASCII"),
        "tag_label": String::from_utf8(ENVELOPE_TAG_LABEL.to_vec()).expect("ASCII"),
        "vectors": cases().iter().enumerate().map(|(i, case)| vector(i, case)).collect::<Vec<_>>(),
    })
}

/// The vectors file is what the code computes. `RECORD_MESSAGING_VECTORS=1`
/// rewrites it, for a deliberate change of format only: another
/// implementation is held to these bytes.
#[test]
fn test_vectors_match_the_file() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(VECTORS);
    let computed = all_vectors();
    if std::env::var("RECORD_MESSAGING_VECTORS").as_deref() == Ok("1") {
        let text = serde_json::to_string_pretty(&computed).expect("serializes") + "\n";
        std::fs::write(&path, text).expect("writes the vectors");
    }
    let recorded: Value =
        serde_json::from_str(&std::fs::read_to_string(&path).expect("reads the vectors"))
            .expect("parses the vectors");
    assert_eq!(computed, recorded);
}

/// The same scalars give the same envelope; production never fixes them.
#[test]
fn sealing_is_deterministic_in_b_and_r() {
    let root = root_register(&test_scalar("y"), None);
    let (b, r) = (test_scalar("b"), test_scalar("r"));
    let one = seal(&root, &b, &r, b"same").unwrap().to_bytes();
    let two = seal(&root, &b, &r, b"same").unwrap().to_bytes();
    assert_eq!(one, two);
}

// --- Test 15: binding and domain separation ---------------------------------

fn sealed() -> (Scalar, Envelope, [u8; 48]) {
    let y = test_scalar("binding y");
    let root = root_register(&y, None);
    let (b, r) = (test_scalar("binding b"), test_scalar("binding r"));
    let envelope = seal(&root, &b, &r, b"bound to its header").unwrap();
    let shared = (rerandomize_with(&root, &b).public_value() * r).to_compressed();
    (y, envelope, shared)
}

/// Every bit of the header changes the key and nonce.
#[test]
fn every_header_bit_changes_the_key_schedule() {
    let (_, envelope, shared) = sealed();
    let header = envelope.header();
    let original = derive_key_and_nonce(&shared, &header);
    for byte in 0..HEADER_LEN {
        for bit in 0..8 {
            let mut changed = header;
            changed[byte] ^= 1 << bit;
            assert_ne!(
                *derive_key_and_nonce(&shared, &changed),
                *original,
                "byte {byte} bit {bit}"
            );
        }
    }
}

/// With the right shared point, a header changed in any byte still fails:
/// the header is bound twice, in the key schedule and as associated data.
#[test]
fn the_right_shared_point_with_a_changed_header_fails() {
    let (_, envelope, shared) = sealed();
    let header = envelope.header();
    let ciphertext = &envelope.to_bytes()[HEADER_LEN..];
    assert_eq!(
        open(&shared, &header, ciphertext).unwrap(),
        b"bound to its header"
    );
    for byte in 0..HEADER_LEN {
        let mut changed = header;
        changed[byte] ^= 0x01;
        assert_eq!(
            open(&shared, &changed, ciphertext),
            Err(Error::DecryptionFailed)
        );
    }
}

/// Another protocol's labels, or another version's, give other keys; and the
/// key is never the raw shared point.
#[test]
fn labels_separate_the_keys() {
    let (_, envelope, shared) = sealed();
    let header = envelope.header();
    let ours = derive_key_and_nonce(&shared, &header);
    for (salt, info) in [
        (&b"Seedelf-Messaging|v2|HKDF-SHA256|salt"[..], KDF_INFO),
        (KDF_SALT, &b"Seedelf-Messaging|v2|AES-256-GCM|key|nonce"[..]),
        (&b"SLT|ECIES|AES-GCM|v1|"[..], &b"KEM|ECIES|AES-GCM|v1|"[..]),
    ] {
        let mut other = [0u8; 44];
        Hkdf::<Sha256>::new(Some(salt), &shared)
            .expand_multi_info(&[info, &header], &mut other)
            .unwrap();
        assert_ne!(other, *ours);
    }
    assert_ne!(&ours[..32], &shared[..32]);
    assert_ne!(&ours[..32], &shared[16..]);
}

// --- Tests 4 and 7, past the discovery check ---------------------------------

/// Bob's key, forced past the register check, derives another key and fails
/// authentication: the discovery check is a shortcut, not the protection.
#[test]
fn another_key_forced_past_discovery_fails_authentication() {
    let (y, envelope, _) = sealed();
    let bob = test_scalar("bob");
    assert_ne!(y, bob);
    let bytes = envelope.to_bytes();
    let ephemeral =
        G1Affine::from_compressed(&bytes[C_AT..HEADER_LEN].try_into().unwrap()).unwrap();
    let bob_shared = (G1Projective::from(ephemeral) * bob).to_compressed();
    assert_eq!(
        open(&bob_shared, &envelope.header(), &bytes[HEADER_LEN..]),
        Err(Error::DecryptionFailed)
    );
}

// --- Secrets never reach the envelope ----------------------------------------

#[test]
fn no_secret_appears_in_the_envelope() {
    let y = test_scalar("secret y");
    let root = root_register(&y, None);
    let (b, r) = (test_scalar("secret b"), test_scalar("secret r"));
    let rerandomized = rerandomize_with(&root, &b);
    let envelope = seal(&root, &b, &r, &[0u8; 64]).unwrap();
    let bytes = envelope.to_bytes();
    let shared = (rerandomized.public_value() * r).to_compressed();
    let okm = derive_key_and_nonce(&shared, &envelope.header());

    let contains = |needle: &[u8]| bytes.windows(needle.len()).any(|w| w == needle);
    for secret in [y, b, r] {
        assert!(!contains(&secret.to_bytes_be()));
        assert!(!contains(&secret.to_bytes_le()));
    }
    assert!(!contains(&shared));
    assert!(!contains(&okm[..32]));
    // The recipient still reads it.
    let key = SecretKey::from_scalar(y).unwrap();
    assert!(envelope.is_for(&key));
    assert_eq!(decrypt_message(&key, &envelope).unwrap(), [0u8; 64]);
}

/// The scan's tag is all of SHA-256(label ‖ [y]p): another key's, a tag off
/// in any one bit, or p with the tag of another point's w, isn't the
/// reader's.
#[test]
fn the_scan_takes_only_the_tag_of_its_own_w() {
    let (y, envelope, _) = sealed();
    let key = SecretKey::from_scalar(y).unwrap();
    let bytes = envelope.to_bytes();
    assert!(crate::matches_envelope(&key, &bytes).unwrap());
    let other = SecretKey::from_scalar(test_scalar("another reader")).unwrap();
    assert!(!crate::matches_envelope(&other, &bytes).unwrap());
    for bit in 0..32 * 8 {
        let mut changed = bytes.clone();
        changed[TAG_AT + bit / 8] ^= 1 << (bit % 8);
        assert!(
            !crate::matches_envelope(&key, &changed).unwrap(),
            "bit {bit}"
        );
        assert!(!Envelope::from_bytes(&changed).unwrap().is_for(&key));
    }
    // The tag of [y]p for another p, under this envelope's p.
    let p2 = (g() * test_scalar("another p")).to_affine();
    let mut moved = bytes.clone();
    let tag = envelope_tag(&(G1Projective::from(p2) * y).to_compressed()).into_bytes();
    moved[TAG_AT..C_AT].copy_from_slice(&tag);
    assert!(!crate::matches_envelope(&key, &moved).unwrap());
    moved[1..TAG_AT].copy_from_slice(&p2.to_compressed());
    assert!(crate::matches_envelope(&key, &moved).unwrap());
}

// --- Nothing in an envelope is a register -----------------------------------

/// The envelope carries p and a tag of w, never w (the 1.10.0 gate review's
/// chain-reaction#1): anyone who reads the pool could otherwise pay a UTxO,
/// or a Lovejoin box, under (p, w), or under its sum with a Seedelf's
/// register, and learn from the reader's wallet spending it whom the
/// envelope was for. So neither [y]p nor [y]c, the points that would make a
/// register of the reader's key on the envelope's own points, is in its
/// bytes, and bytes 49 to 80 are SHA-256(label ‖ w).
#[test]
fn the_bytes_after_p_are_a_tag_of_w_and_no_register_is_in_the_envelope() {
    let y = test_scalar("tag y");
    for root in [
        root_register(&y, None),
        root_register(&y, Some(&test_scalar("tag d"))),
    ] {
        let (b, r) = (test_scalar("tag b"), test_scalar("tag r"));
        let bytes = seal(&root, &b, &r, &[0x42; 64]).unwrap().to_bytes();
        let (p, w) = {
            let rerandomized = rerandomize_with(&root, &b);
            (rerandomized.generator(), rerandomized.public_value())
        };
        assert_eq!(&bytes[1..49], &p.to_compressed()[..]);
        let tag: [u8; 32] = Sha256::new()
            .chain_update(b"Seedelf-Messaging|v1|envelope|tag")
            .chain_update(w.to_compressed())
            .finalize()
            .into();
        assert_eq!(&bytes[49..81], &tag[..]);
        let c = G1Projective::from(
            G1Affine::from_compressed(&bytes[HEADER_LEN - 48..HEADER_LEN].try_into().unwrap())
                .unwrap(),
        );
        for point in [p * y, c * y] {
            let point = point.to_compressed();
            assert!(!bytes.windows(48).any(|window| window == point));
        }
        let key = SecretKey::from_scalar(y).unwrap();
        assert!(Envelope::from_bytes(&bytes).unwrap().is_for(&key));
    }
}

#[test]
fn a_secret_keys_debug_shows_nothing_of_it() {
    let y = test_scalar("debug y");
    let key = SecretKey::from_scalar(y).unwrap();
    let shown = format!("{key:?}");
    assert_eq!(shown, "SecretKey(..)");
    assert!(!shown.contains(&hex::encode(y.to_bytes_be())));
}
