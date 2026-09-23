//! Seedelf key derivation, v1: recovery phrase → Seedelf secret scalar.
//!
//! This is permanent. Once web wallets exist, changing any step below makes
//! their phrases stop restoring funds. The frozen vectors in
//! `tests/vectors/seedelf_key_v1.json` pin every intermediate value.
//!
//! ```text
//! seed = BIP39 seed of the phrase     PBKDF2-HMAC-SHA512, 2048 rounds, empty passphrase
//! okm  = HKDF-SHA-256(ikm  = seed,
//!                     salt = "seedelf-wallet-v1",
//!                     info = "seedelf-key" || u32_be(account),
//!                     L    = 64)
//! x    = int_be(okm) mod r            rejected if zero
//! ```
//!
//! The web wallet uses this; the CLI keeps its random, file-stored scalar.

use anyhow::{Result, bail};
use bip39::{Language, Mnemonic};
use blstrs::Scalar;
use cryptoxide::hkdf::{hkdf_expand, hkdf_extract};
use cryptoxide::sha2::Sha256;
use ff::Field;
use rand_core::{OsRng, RngCore};

/// HKDF salt for v1.
pub const SALT_V1: &[u8] = b"seedelf-wallet-v1";

/// HKDF info prefix for v1; the account index follows as a big-endian u32.
pub const INFO_PREFIX_V1: &[u8] = b"seedelf-key";

/// A Seedelf recovery phrase is always 24 English BIP39 words (256 bits of
/// entropy). This is wallet policy; the derivation itself only needs a
/// valid mnemonic.
pub const PHRASE_WORDS: usize = 24;

/// Generates a new 24-word recovery phrase from the OS random source.
pub fn generate_phrase() -> String {
    let mut entropy = [0u8; 32];
    OsRng.fill_bytes(&mut entropy);
    let mnemonic = Mnemonic::from_entropy_in(Language::English, &entropy)
        .expect("32 bytes is valid BIP39 entropy");
    entropy.fill(0);
    mnemonic.to_string()
}

/// Parses a recovery phrase typed by a user: case and extra whitespace are
/// ignored, the words and checksum must be valid BIP39 English, and there
/// must be exactly 24 of them.
pub fn parse_phrase(phrase: &str) -> Result<Mnemonic> {
    let normalized: String = phrase
        .split_whitespace()
        .map(str::to_lowercase)
        .collect::<Vec<_>>()
        .join(" ");
    let words = normalized.split(' ').filter(|w| !w.is_empty()).count();
    if words != PHRASE_WORDS {
        bail!("a recovery phrase has {PHRASE_WORDS} words, got {words}");
    }
    Mnemonic::parse_in_normalized(Language::English, &normalized).map_err(|e| match e {
        bip39::Error::UnknownWord(i) => {
            anyhow::anyhow!("word {} is not in the BIP39 English word list", i + 1)
        }
        bip39::Error::InvalidChecksum => {
            anyhow::anyhow!("the phrase checksum is wrong; check the words and their order")
        }
        other => anyhow::anyhow!("invalid recovery phrase: {other}"),
    })
}

/// The BIP39 seed of a mnemonic with an empty passphrase.
pub fn bip39_seed(mnemonic: &Mnemonic) -> [u8; 64] {
    mnemonic.to_seed_normalized("")
}

/// HKDF-SHA-256 output keying material for `account`, 64 bytes.
pub fn okm_v1(seed: &[u8; 64], account: u32) -> [u8; 64] {
    let mut info = Vec::with_capacity(INFO_PREFIX_V1.len() + 4);
    info.extend_from_slice(INFO_PREFIX_V1);
    info.extend_from_slice(&account.to_be_bytes());

    let mut prk = [0u8; 32];
    hkdf_extract(Sha256::new(), SALT_V1, seed, &mut prk);
    let mut okm = [0u8; 64];
    hkdf_expand(Sha256::new(), &prk, &info, &mut okm);
    prk.fill(0);
    okm
}

/// Reduces 64 big-endian bytes mod r. Horner's rule over u64 limbs keeps
/// every step inside the field, so no big-integer arithmetic is needed.
pub fn scalar_from_okm(okm: &[u8; 64]) -> Result<Scalar> {
    let two_pow_64 = Scalar::from(u64::MAX) + Scalar::ONE;
    let mut x = Scalar::ZERO;
    let (limbs, _) = okm.as_chunks::<8>();
    for limb in limbs {
        x = x * two_pow_64 + Scalar::from(u64::from_be_bytes(*limb));
    }
    if bool::from(x.is_zero()) {
        bail!("derived a zero key");
    }
    Ok(x)
}

/// The v1 Seedelf secret key for `account` of a recovery phrase.
pub fn seedelf_key_v1(phrase: &str, account: u32) -> Result<Scalar> {
    let mnemonic = parse_phrase(phrase)?;
    let mut seed = bip39_seed(&mnemonic);
    let mut okm = okm_v1(&seed, account);
    seed.fill(0);
    let x = scalar_from_okm(&okm);
    okm.fill(0);
    x
}
