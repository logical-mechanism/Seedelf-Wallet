//! Every label, sorted by the function it goes into, and prefix-free within
//! each (joint-security.md rule 3; docs/protocol.md §16.2, §21.4, §21.7).
//!
//! Two inputs to one function under two labels can't be one input when
//! neither label is a prefix of the other. Across functions they needn't
//! be apart: `…|certificate` (SHA-256) is a prefix of
//! `…|certificate-nonce|m` (HMAC-SHA-512), which is another function.
//!
//! A scan of the crate's own source holds the lists to the code: every
//! `Seedelf-Messaging|` label literal outside the tests is in exactly one
//! list, and every raw SHA-256 the crate computes starts with a listed
//! label, or is a stamp's 40 bytes. A new label or hash fails here until
//! it's sorted.

use std::path::{Path, PathBuf};

use crate::envelope::{ENVELOPE_TAG_LABEL, KDF_INFO, KDF_SALT};
use crate::relay::{LISTING_STAMP_LABEL, STAMP_LABEL, UNLISTING_STAMP_LABEL};
use crate::session::certificate::{
    CERTIFICATE_LABEL, CERTIFICATE_NONCE_M_LABEL, CERTIFICATE_NONCE_X_LABEL, WITHDRAWAL_LABEL,
    WITHDRAWAL_NONCE_LABEL,
};
use crate::session::first_contact::{
    BASE_LABEL, BASE_NONCE_LABEL, BASE_SCALAR_LABEL, FIRST_STAMP_LABEL, KEYS_CONTINUATION_LABEL,
    KEYS_HANDLE_LABEL, KEYS_NONCE_A_LABEL, KEYS_NONCE_E_LABEL, KEYS_NONCE_S_LABEL, SESSION_INFO,
    SESSION_SALT,
};
use crate::session::ratchet::{ENVELOPE_EPHEMERAL_INFO, MESSAGE_INFO, OUTER_INFO, ROOT_INFO};
use crate::session::reveal::{REVEAL_LABEL, REVEAL_NONCE_LABEL};
use crate::session::seedelf::HANDLE_BASE_DST;

/// seedelf-crypto's spending proof's nonce tag, HMAC-SHA-512 keyed by x
/// (schnorr.rs `NONCE_TAG`), private there: held to its source below.
const SCHNORR_NONCE_TAG: &[u8] = b"seedelf/schnorr/nonce/v1";

/// seedelf-crypto's Lovejoin domain tag, raw SHA-256 (lovejoin.rs
/// `DOMAIN_TAG_V1`), the one other raw SHA-256 label a key's proofs use.
const LOVEJOIN_TAG: &[u8] = b"lovejoin/sigmajoin/v1/";

/// HMAC-SHA-512's labels keyed by the Seedelf key x or the messaging key
/// x_m, with the key each is keyed by.
fn hmac_keyed_by_x_or_x_m() -> [(&'static [u8], &'static str); 7] {
    [
        (SCHNORR_NONCE_TAG, "x: a spend's nonce"),
        (CERTIFICATE_NONCE_X_LABEL, "x: the certificate's k_x"),
        (REVEAL_NONCE_LABEL, "x_m: the reveal's nonce"),
        (BASE_SCALAR_LABEL, "x_m: the writer's b"),
        (KEYS_NONCE_A_LABEL, "x_m: the keys proof's k₁"),
        (CERTIFICATE_NONCE_M_LABEL, "x_m: the certificate's k_m"),
        (WITHDRAWAL_NONCE_LABEL, "x_m: a withdrawal's k"),
    ]
}

/// Every HMAC-SHA-512 label in the crate: those keyed by x_m, and those
/// keyed by b, e_A and s_A.
fn hmac_sha512() -> Vec<&'static [u8]> {
    let mut labels: Vec<&[u8]> = hmac_keyed_by_x_or_x_m()
        .iter()
        .map(|(label, _)| *label)
        .filter(|label| *label != SCHNORR_NONCE_TAG)
        .collect();
    labels.extend([BASE_NONCE_LABEL, KEYS_NONCE_E_LABEL, KEYS_NONCE_S_LABEL]);
    labels
}

/// Every raw SHA-256 label in the crate.
fn raw_sha256() -> [&'static [u8]; 11] {
    [
        ENVELOPE_TAG_LABEL,
        STAMP_LABEL,
        LISTING_STAMP_LABEL,
        UNLISTING_STAMP_LABEL,
        FIRST_STAMP_LABEL,
        BASE_LABEL,
        KEYS_HANDLE_LABEL,
        KEYS_CONTINUATION_LABEL,
        REVEAL_LABEL,
        CERTIFICATE_LABEL,
        WITHDRAWAL_LABEL,
    ]
}

/// HKDF-SHA256's salts and infos.
fn hkdf_sha256() -> [&'static [u8]; 8] {
    [
        KDF_SALT,
        KDF_INFO,
        SESSION_SALT,
        SESSION_INFO,
        ROOT_INFO,
        MESSAGE_INFO,
        OUTER_INFO,
        ENVELOPE_EPHEMERAL_INFO,
    ]
}

fn assert_prefix_free(labels: &[&[u8]]) {
    for (i, one) in labels.iter().enumerate() {
        for (j, other) in labels.iter().enumerate() {
            assert!(
                i == j || !other.starts_with(one),
                "{} is a prefix of {}",
                String::from_utf8_lossy(one),
                String::from_utf8_lossy(other)
            );
        }
    }
}

/// The source of a file in the workspace, from this crate's root.
fn source(relative: &str) -> String {
    std::fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative)).unwrap()
}

/// The crate's own source files outside its tests, each with any trailing
/// test module cut off: `src/` but `src/session/tests/` and `src/tests.rs`.
fn crate_sources() -> Vec<(String, String)> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                if path.file_name().unwrap() != "tests" {
                    walk(&path, out);
                }
            } else if path.extension().is_some_and(|e| e == "rs")
                && path.file_name().unwrap() != "tests.rs"
            {
                out.push(path);
            }
        }
    }
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut paths = Vec::new();
    walk(&root, &mut paths);
    paths.sort();
    paths
        .into_iter()
        .map(|path| {
            let text = std::fs::read_to_string(&path).unwrap();
            let code = match text.find("#[cfg(test)]\nmod tests") {
                Some(at) => text[..at].to_string(),
                None => text,
            };
            let name = path.strip_prefix(&root).unwrap().display().to_string();
            (name, code)
        })
        .collect()
}

/// The labels keyed by x or x_m, the ones whose collision would put a key's
/// nonce under another proof's challenge: none is a prefix of another. The
/// spending proof's tag is held to seedelf-crypto's source.
#[test]
fn every_hmac_sha512_label_keyed_by_x_or_x_m_is_prefix_free() {
    assert!(
        source("../seedelf-crypto/src/schnorr.rs")
            .contains("const NONCE_TAG: &[u8] = b\"seedelf/schnorr/nonce/v1\";")
    );
    let labels: Vec<&[u8]> = hmac_keyed_by_x_or_x_m().iter().map(|(l, _)| *l).collect();
    assert_eq!(labels.len(), 7);
    assert_prefix_free(&labels);
    let mut with_crypto = hmac_sha512();
    with_crypto.push(SCHNORR_NONCE_TAG);
    assert_prefix_free(&with_crypto);
}

/// Every raw SHA-256 label in the crate, Lovejoin's beside them: prefix
/// free, ASCII, and at least 21 bytes, so no input to the hash under one
/// starts like an input under another or like a stamp's 40 bytes.
#[test]
fn every_raw_sha256_label_is_prefix_free_ascii_and_at_least_21_bytes() {
    assert!(
        source("../seedelf-crypto/src/lovejoin.rs")
            .contains("pub const DOMAIN_TAG_V1: &[u8] = b\"lovejoin/sigmajoin/v1/\";")
    );
    let mut labels = raw_sha256().to_vec();
    labels.push(LOVEJOIN_TAG);
    assert_prefix_free(&labels);
    for label in labels {
        assert!(label.is_ascii() && label.len() >= 21, "{label:?}");
    }
    assert_prefix_free(&hkdf_sha256());
}

/// Every `Seedelf-Messaging|` literal in the crate's source outside its
/// tests is one of the listed labels, in exactly one function's list, or
/// the hash to the curve's DST.
#[test]
fn every_label_in_the_source_is_in_exactly_one_list() {
    let lists: [(&str, Vec<&[u8]>); 4] = [
        ("HMAC-SHA-512", hmac_sha512()),
        ("raw SHA-256", raw_sha256().to_vec()),
        ("HKDF-SHA256", hkdf_sha256().to_vec()),
        ("hash to G1", vec![HANDLE_BASE_DST]),
    ];
    let mut found = 0;
    for (file, code) in crate_sources() {
        for piece in code.split("b\"Seedelf-Messaging|").skip(1) {
            let literal = format!("Seedelf-Messaging|{}", &piece[..piece.find('"').unwrap()]);
            let homes: Vec<&str> = lists
                .iter()
                .filter(|(_, labels)| labels.contains(&literal.as_bytes()))
                .map(|(name, _)| *name)
                .collect();
            assert_eq!(homes.len(), 1, "{file}: {literal} is in {homes:?}");
            found += 1;
        }
    }
    let listed: usize = lists.iter().map(|(_, labels)| labels.len()).sum();
    assert_eq!(found, listed, "every listed label is in the source once");
}

/// Every raw SHA-256 the crate computes starts with one of the listed
/// labels, or is `stamp_bits`'s 40 bytes, a digest and a nonce: the scan
/// reads what each `Sha256::new()` is first updated with.
#[test]
fn every_raw_sha256_starts_with_a_listed_label_or_is_a_stamp() {
    let names = [
        "ENVELOPE_TAG_LABEL",
        "STAMP_LABEL",
        "LISTING_STAMP_LABEL",
        "UNLISTING_STAMP_LABEL",
        "FIRST_STAMP_LABEL",
        "BASE_LABEL",
        "REVEAL_LABEL",
        "CERTIFICATE_LABEL",
        "WITHDRAWAL_LABEL",
    ];
    let mut sites = Vec::new();
    for (file, code) in crate_sources() {
        for piece in code.split("Sha256::new()").skip(1) {
            let after = &piece[piece.find(".chain_update(").expect("updated") + 14..];
            let first = after[..after.find(')').unwrap()].trim().to_string();
            // The keys proof's challenge takes its label from a choice of
            // two, both listed: the one `label` the scan allows.
            let ok = names.contains(&first.as_str())
                || (first == "label"
                    && file == "session/first_contact.rs"
                    && piece.contains("hash.finalize()")
                    && code.contains("let label = if commitments.t1.is_some() {"))
                || (first == "digest" && file == "relay.rs");
            assert!(ok, "{file}: a SHA-256 first updated with {first}");
            sites.push((file.clone(), first));
        }
        assert!(
            !code.contains("Sha256::digest("),
            "{file}: an unlabelled SHA-256"
        );
    }
    assert_eq!(sites.len(), 11, "{sites:?}");
    let stamp = [0u8; 32].len() + 0u64.to_be_bytes().len();
    assert_eq!(stamp, 40);
}
