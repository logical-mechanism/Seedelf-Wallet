use seedelf_crypto::derivation::*;
use seedelf_crypto::register::Register;

const ABANDON_ART: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

fn vectors() -> Vec<serde_json::Value> {
    let raw = include_str!("vectors/seedelf_key_v1.json");
    let doc: serde_json::Value = serde_json::from_str(raw).unwrap();
    assert_eq!(doc["spec"], "seedelf-key-v1");
    doc["vectors"].as_array().unwrap().clone()
}

#[test]
fn frozen_v1_vectors() {
    let vectors = vectors();
    assert_eq!(vectors.len(), 9);
    for v in vectors {
        let phrase = v["phrase"].as_str().unwrap();
        let account = v["account"].as_u64().unwrap() as u32;

        let mnemonic = parse_phrase(phrase).unwrap();
        let seed = bip39_seed(&mnemonic);
        assert_eq!(hex::encode(seed), v["seed"], "seed: {phrase} / {account}");

        let okm = okm_v1(&seed, account);
        assert_eq!(hex::encode(okm), v["okm"], "okm: {phrase} / {account}");

        let sk = scalar_from_okm(&okm).unwrap();
        assert_eq!(
            hex::encode(sk.to_bytes_be()),
            v["sk"],
            "sk: {phrase} / {account}"
        );
        assert_eq!(sk, seedelf_key_v1(phrase, account).unwrap());

        let register = Register::create(sk).unwrap();
        assert_eq!(
            register.public_value, v["public_value"],
            "public value: {phrase} / {account}"
        );
    }
}

#[test]
fn spec_constants_are_frozen() {
    assert_eq!(SALT_V1, b"seedelf-wallet-v1");
    assert_eq!(INFO_PREFIX_V1, b"seedelf-key");
    assert_eq!(NEW_PHRASE_WORDS, 24);
    assert_eq!(RESTORE_PHRASE_WORDS, [12, 15, 24]);
}

#[test]
fn restore_accepts_12_15_and_24_words() {
    for v in vectors() {
        let phrase = v["phrase"].as_str().unwrap();
        assert!(RESTORE_PHRASE_WORDS.contains(&phrase.split(' ').count()));
        assert!(parse_phrase(phrase).is_ok());
    }
    let lengths: std::collections::BTreeSet<usize> = vectors()
        .iter()
        .map(|v| v["phrase"].as_str().unwrap().split(' ').count())
        .collect();
    assert_eq!(lengths.into_iter().collect::<Vec<_>>(), vec![12, 15, 24]);
}

#[test]
fn accounts_derive_different_keys() {
    let a0 = seedelf_key_v1(ABANDON_ART, 0).unwrap();
    let a1 = seedelf_key_v1(ABANDON_ART, 1).unwrap();
    assert_ne!(a0, a1);
}

#[test]
fn typed_phrases_are_normalized() {
    let messy = format!("  {}  ", ABANDON_ART.to_uppercase().replace(' ', "   \n"));
    assert_eq!(
        seedelf_key_v1(&messy, 0).unwrap(),
        seedelf_key_v1(ABANDON_ART, 0).unwrap()
    );
}

#[test]
fn bad_phrases_are_rejected_with_a_reason() {
    let err = |p: &str| parse_phrase(p).unwrap_err().to_string();

    // 18 valid words (a Trezor vector): BIP39 allows it, restore does not
    let eighteen = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon agent";
    assert!(err(eighteen).contains("12, 15 or 24 words"));
    assert!(err("abandon abandon").contains("got 2"));

    // last word swapped: checksum fails
    let bad_checksum = ABANDON_ART.replace(" art", " abandon");
    assert!(err(&bad_checksum).contains("checksum"));

    // word 3 not in the list
    let unknown = ABANDON_ART
        .replacen("abandon", "x", 3)
        .replacen("x", "abandon", 2);
    assert!(err(&unknown).contains("word 3"));
}

#[test]
fn generated_phrases_are_valid_and_distinct() {
    let a = generate_phrase();
    let b = generate_phrase();
    assert_ne!(a, b);
    assert_eq!(a.split(' ').count(), NEW_PHRASE_WORDS);
    assert!(seedelf_key_v1(&a, 0).is_ok());
}

#[test]
fn zero_okm_is_rejected_and_r_reduces_to_zero() {
    assert!(scalar_from_okm(&[0u8; 64]).is_err());

    // okm = r (right-aligned) must reduce to zero and be rejected
    let r =
        hex::decode("73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001").unwrap();
    let mut okm = [0u8; 64];
    okm[32..].copy_from_slice(&r);
    assert!(scalar_from_okm(&okm).is_err());

    // okm = r + 1 reduces to one
    okm[63] = 2;
    assert_eq!(
        hex::encode(scalar_from_okm(&okm).unwrap().to_bytes_be()),
        format!("{:064x}", 1)
    );
}

#[test]
fn entropy_round_trips_on_every_vector() {
    for v in vectors() {
        let phrase = v["phrase"].as_str().unwrap();
        let entropy = phrase_to_entropy(phrase).unwrap();
        let words = phrase.split(' ').count();
        assert_eq!(entropy.len(), words / 3 * 4, "{phrase}");
        assert_eq!(entropy_to_phrase(&entropy).unwrap(), phrase);
    }
}

#[test]
fn entropy_matches_the_bip39_reference() {
    // Trezor vector: 24 words from 0x7f repeated 32 times
    let entropy = phrase_to_entropy(
        "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title",
    )
    .unwrap();
    assert_eq!(entropy, vec![0x7f; 32]);
    assert_eq!(
        entropy_to_phrase(&[0u8; 32]).unwrap(),
        ABANDON_ART,
        "all-zero entropy is the abandon…art phrase"
    );
}

#[test]
fn entropy_is_taken_from_the_normalized_phrase() {
    let messy = format!("  {}  ", ABANDON_ART.to_uppercase().replace(' ', "   \n"));
    assert_eq!(phrase_to_entropy(&messy).unwrap(), vec![0u8; 32]);
    assert!(
        phrase_to_entropy("abandon abandon")
            .unwrap_err()
            .to_string()
            .contains("12, 15 or 24 words")
    );
}

#[test]
fn entropy_lengths_follow_the_restore_policy() {
    for len in [16, 20, 32] {
        let phrase = entropy_to_phrase(&vec![0xa5; len]).unwrap();
        assert_eq!(phrase.split(' ').count(), len / 4 * 3);
        assert_eq!(phrase_to_entropy(&phrase).unwrap(), vec![0xa5; len]);
    }
    // 18 and 21 words are valid BIP39 but not accepted on restore
    for len in [0, 15, 17, 24, 28, 33, 64] {
        assert!(
            entropy_to_phrase(&vec![0u8; len])
                .unwrap_err()
                .to_string()
                .contains("16, 20 or 32 bytes"),
            "{len} bytes"
        );
    }
}

#[test]
fn wordlist_is_bip39_english() {
    let list = wordlist();
    assert_eq!(list.len(), 2048);
    assert_eq!(list[0], "abandon");
    assert_eq!(list[2047], "zoo");
    assert!(list.windows(2).all(|w| w[0] < w[1]), "sorted");
    // every word is unique in its first four letters, which autocomplete relies on
    let prefixes: std::collections::BTreeSet<String> =
        list.iter().map(|w| w.chars().take(4).collect()).collect();
    assert_eq!(prefixes.len(), 2048);
}
