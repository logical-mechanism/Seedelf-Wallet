//! Messages' key, v1 (chunk 55; protocol.md §21.2), against its vectors,
//! and kept apart from the frozen v1 Seedelf key it sits beside.

use seedelf_crypto::derivation::*;
use seedelf_crypto::register::Register;
use std::collections::BTreeSet;

fn doc(raw: &str) -> Vec<serde_json::Value> {
    let doc: serde_json::Value = serde_json::from_str(raw).unwrap();
    doc["vectors"].as_array().unwrap().clone()
}

fn vectors() -> Vec<serde_json::Value> {
    let raw = include_str!("vectors/seedelf_messaging_key_v1.json");
    let parsed: serde_json::Value = serde_json::from_str(raw).unwrap();
    assert_eq!(parsed["spec"], "seedelf-messaging-key-v1");
    doc(raw)
}

fn v1_vectors() -> Vec<serde_json::Value> {
    doc(include_str!("vectors/seedelf_key_v1.json"))
}

/// A vector's phrase, account, network and generation.
fn inputs(v: &serde_json::Value) -> (&str, u32, u8, u8) {
    (
        v["phrase"].as_str().unwrap(),
        v["account"].as_u64().unwrap() as u32,
        v["network"].as_u64().unwrap() as u8,
        v["generation"].as_u64().unwrap() as u8,
    )
}

#[test]
fn messaging_key_v1_vectors() {
    let vectors = vectors();
    assert_eq!(vectors.len(), 22);
    for v in vectors {
        let (phrase, account, network, generation) = inputs(&v);
        let at = format!("{phrase} / {account} / {network} / {generation}");

        let mnemonic = parse_phrase(phrase).unwrap();
        let seed = bip39_seed(&mnemonic);
        assert_eq!(hex::encode(seed), v["seed"], "seed: {at}");

        let okm = messaging_okm_v1(&seed, account, network, generation).unwrap();
        assert_eq!(hex::encode(okm), v["okm_m"], "okm_m: {at}");

        let x_m = scalar_from_okm(&okm).unwrap();
        assert_eq!(hex::encode(x_m.to_bytes_be()), v["x_m"], "x_m: {at}");
        assert_eq!(
            x_m,
            messaging_key_v1(phrase, account, network, generation).unwrap()
        );
        let entropy = phrase_to_entropy(phrase).unwrap();
        assert_eq!(
            x_m,
            messaging_key_v1_from_entropy(&entropy, account, network, generation).unwrap(),
            "from entropy: {at}"
        );

        let register = Register::create(x_m).unwrap();
        assert_eq!(
            register.public_value, v["public_value"],
            "public value: {at}"
        );
    }
}

#[test]
fn the_vectors_cover_every_phrase_network_and_generation() {
    let phrases: BTreeSet<String> = v1_vectors()
        .iter()
        .map(|v| v["phrase"].as_str().unwrap().to_string())
        .collect();
    let vectors = vectors();
    for phrase in &phrases {
        for (network, generation) in [(MESSAGING_PREPROD, 0), (MESSAGING_MAINNET, 0)] {
            assert!(
                vectors
                    .iter()
                    .any(|v| inputs(v) == (phrase.as_str(), 0, network, generation)),
                "{phrase} / {network} / {generation}"
            );
        }
        assert!(
            vectors
                .iter()
                .any(|v| inputs(v).0 == phrase && inputs(v).1 == 0 && inputs(v).3 == 1),
            "{phrase} at generation 1"
        );
    }
    let ours: BTreeSet<String> = vectors
        .iter()
        .map(|v| v["phrase"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(ours, phrases, "v1's phrases, every one");
    let networks: BTreeSet<(u8, u8)> = vectors.iter().map(|v| (inputs(v).2, inputs(v).3)).collect();
    assert_eq!(networks, BTreeSet::from([(0, 0), (0, 1), (1, 0), (1, 1)]));
    assert!(
        vectors.iter().any(|v| inputs(v).1 == 1),
        "account's byte order"
    );
}

#[test]
fn spec_constants() {
    assert_eq!(MESSAGING_SALT_V1, b"seedelf-messaging-v1");
    assert_eq!(MESSAGING_INFO_PREFIX_V1, b"seedelf-messaging-key");
    assert_eq!(MESSAGING_PREPROD, 0x00);
    assert_eq!(MESSAGING_MAINNET, 0x01);
    assert_eq!(MESSAGING_GENERATION_V1, 0x00);
    // a sibling of v1, never a change to it
    assert_eq!(SALT_V1, b"seedelf-wallet-v1");
    assert_eq!(INFO_PREFIX_V1, b"seedelf-key");
}

#[test]
fn the_messaging_key_is_never_the_seedelf_key() {
    let v1 = v1_vectors();
    let mut compared = 0;
    for v in vectors() {
        let (phrase, account, network, generation) = inputs(&v);
        let x_m = messaging_key_v1(phrase, account, network, generation).unwrap();
        // the same seed as v1's, and another key from it
        assert_ne!(
            x_m,
            seedelf_key_v1(phrase, account).unwrap(),
            "{phrase} / {account}"
        );
        if let Some(frozen) = v1
            .iter()
            .find(|w| w["phrase"] == phrase && w["account"].as_u64() == Some(account as u64))
        {
            assert_eq!(v["seed"], frozen["seed"], "v1's seed: {phrase}");
            assert_ne!(v["x_m"], frozen["sk"], "{phrase} / {account}");
            assert_ne!(
                v["public_value"], frozen["public_value"],
                "{phrase} / {account}"
            );
            compared += 1;
        }
    }
    // every vector has v1's for its phrase and account
    assert_eq!(compared, vectors().len());
}

#[test]
fn networks_generations_and_accounts_derive_different_keys() {
    for phrase in v1_vectors().iter().map(|v| v["phrase"].as_str().unwrap()) {
        let key = |account, network, generation| {
            messaging_key_v1(phrase, account, network, generation).unwrap()
        };
        let preprod = key(0, MESSAGING_PREPROD, MESSAGING_GENERATION_V1);
        let mainnet = key(0, MESSAGING_MAINNET, MESSAGING_GENERATION_V1);
        assert_ne!(preprod, mainnet, "{phrase}");
        assert_ne!(preprod, key(0, MESSAGING_PREPROD, 1), "{phrase}");
        assert_ne!(mainnet, key(0, MESSAGING_MAINNET, 1), "{phrase}");
        assert_ne!(
            preprod,
            key(1, MESSAGING_PREPROD, MESSAGING_GENERATION_V1),
            "{phrase}"
        );
    }
}

#[test]
fn an_unknown_network_byte_is_refused() {
    let phrase = vectors()[0]["phrase"].as_str().unwrap().to_string();
    let entropy = phrase_to_entropy(&phrase).unwrap();
    let seed = bip39_seed(&parse_phrase(&phrase).unwrap());
    for network in 2..=u8::MAX {
        for generation in [0, 1, u8::MAX] {
            let errors = [
                messaging_key_v1(&phrase, 0, network, generation).unwrap_err(),
                messaging_key_v1_from_entropy(&entropy, 0, network, generation).unwrap_err(),
                messaging_okm_v1(&seed, 0, network, generation).unwrap_err(),
            ];
            for e in errors {
                assert_eq!(
                    e.to_string(),
                    format!(
                        "a messaging key's network byte is 0x00 (preprod) or 0x01 (mainnet), got 0x{network:02x}"
                    )
                );
            }
        }
    }
    // the network is refused before the phrase is read
    assert!(
        messaging_key_v1("abandon abandon", 0, 2, 0)
            .unwrap_err()
            .to_string()
            .contains("network byte")
    );
}

#[test]
fn bad_phrases_and_entropy_are_refused() {
    let mainnet = MESSAGING_MAINNET;
    assert!(
        messaging_key_v1("abandon abandon", 0, mainnet, 0)
            .unwrap_err()
            .to_string()
            .contains("12, 15 or 24 words")
    );
    for len in [0, 15, 24, 64] {
        assert!(
            messaging_key_v1_from_entropy(&vec![0u8; len], 0, mainnet, 0)
                .unwrap_err()
                .to_string()
                .contains("16, 20 or 32 bytes")
        );
    }
}

#[test]
fn typed_phrases_are_normalized() {
    let phrase = vectors()[0]["phrase"].as_str().unwrap().to_string();
    let messy = format!("  {}  ", phrase.to_uppercase().replace(' ', "   \n"));
    for network in [MESSAGING_PREPROD, MESSAGING_MAINNET] {
        assert_eq!(
            messaging_key_v1(&messy, 0, network, 0).unwrap(),
            messaging_key_v1(&phrase, 0, network, 0).unwrap()
        );
    }
}

#[test]
fn messaging_okm_is_cryptoxides_hkdf() {
    // messaging_okm_v1 shares v1's wiped HKDF expand; it must give exactly
    // what cryptoxide's gives, for any seed, account, network and generation
    use cryptoxide::hkdf::{hkdf_expand, hkdf_extract};
    use cryptoxide::sha2::Sha256;
    for n in 0u8..16 {
        let seed: [u8; 64] = std::array::from_fn(|i| (i as u8).wrapping_mul(n).wrapping_add(n));
        for account in [0, 1, n as u32, 0x7fff_ffff, u32::MAX] {
            for network in [MESSAGING_PREPROD, MESSAGING_MAINNET] {
                for generation in [0, 1, n, u8::MAX] {
                    let mut info = MESSAGING_INFO_PREFIX_V1.to_vec();
                    info.extend_from_slice(&account.to_be_bytes());
                    info.extend_from_slice(&[network, generation]);
                    let mut prk = [0u8; 32];
                    hkdf_extract(Sha256::new(), MESSAGING_SALT_V1, &seed, &mut prk);
                    let mut okm = [0u8; 64];
                    hkdf_expand(Sha256::new(), &prk, &info, &mut okm);
                    assert_eq!(
                        messaging_okm_v1(&seed, account, network, generation).unwrap(),
                        okm,
                        "seed {n} / account {account} / network {network} / generation {generation}"
                    );
                }
            }
        }
    }
}
