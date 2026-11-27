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
//!
//! Messages' key, v1: recovery phrase → Seedelf Messaging's own secret
//! scalar x_m (chunk 55; `seedelf-messaging/docs/protocol.md` §21.2).
//!
//! A sibling of v1, never a change to it: v1's steps, outputs and vectors
//! stay as they are. It takes v1's seed under its own salt and info, so
//! neither key says anything about the other, and it's per network. It's
//! frozen in its turn when Messages opens on mainnet. The vectors in
//! `tests/vectors/seedelf_messaging_key_v1.json` pin every intermediate value.
//!
//! ```text
//! seed  = BIP39 seed of the phrase     the same seed v1 takes
//! okm_m = HKDF-SHA-256(ikm  = seed,
//!                      salt = "seedelf-messaging-v1",
//!                      info = "seedelf-messaging-key" || u32_be(account)
//!                             || network || generation,
//!                      L    = 64)
//! x_m   = int_be(okm_m) mod r          rejected if zero
//! ```
//!
//! `network` is one byte, 0x00 for preprod and 0x01 for mainnet, and any
//! other is refused. `generation` is one byte, 0x00 until a rotation.
//!
//! Every copy of the phrase, the entropy and the key material made here is
//! in a buffer that's wiped when it's dropped (`zeroize`). Copies inside the
//! libraries and on the stack can outlive a call, so this is best effort.

use anyhow::{Result, bail};
use bip39::{Language, Mnemonic};
use blstrs::Scalar;
use cryptoxide::digest::Digest;
use cryptoxide::hkdf::hkdf_extract;
use cryptoxide::sha2::Sha256;
use ff::Field;
use rand_core::{OsRng, RngCore};
use zeroize::{Zeroize, Zeroizing};

/// HKDF salt for v1.
pub const SALT_V1: &[u8] = b"seedelf-wallet-v1";

/// HKDF info prefix for v1; the account index follows as a big-endian u32.
pub const INFO_PREFIX_V1: &[u8] = b"seedelf-key";

/// New wallets get 24 English BIP39 words (256 bits of entropy).
pub const NEW_PHRASE_WORDS: usize = 24;

/// Restore accepts the same lengths as Lace: 12, 15 or 24 words. This is
/// wallet policy checked before the derivation, which itself works for any
/// valid mnemonic; allowing another length would not change existing keys.
pub const RESTORE_PHRASE_WORDS: [usize; 3] = [12, 15, 24];

/// HKDF salt for Messages' key, v1.
pub const MESSAGING_SALT_V1: &[u8] = b"seedelf-messaging-v1";

/// HKDF info prefix for Messages' key, v1; the account index follows as a
/// big-endian u32, then the network byte, then the generation byte.
pub const MESSAGING_INFO_PREFIX_V1: &[u8] = b"seedelf-messaging-key";

/// Messages' key's network byte for preprod.
pub const MESSAGING_PREPROD: u8 = 0x00;

/// Messages' key's network byte for mainnet.
pub const MESSAGING_MAINNET: u8 = 0x01;

/// Messages' key's generation byte in v1; a rotation takes the next byte.
pub const MESSAGING_GENERATION_V1: u8 = 0x00;

/// Generates a new 24-word recovery phrase from the OS random source, in a
/// buffer that's wiped when it's dropped.
pub fn generate_phrase() -> Zeroizing<String> {
    let mut entropy = Zeroizing::new([0u8; 32]);
    OsRng.fill_bytes(&mut entropy[..]);
    let mnemonic = Mnemonic::from_entropy_in(Language::English, &entropy[..])
        .expect("32 bytes is valid BIP39 entropy");
    phrase_of(&mnemonic)
}

/// A mnemonic's words, one space apart as its `Display` writes them. The
/// buffer is sized first: a `String` that grows leaves copies of the phrase
/// behind in the memory it frees.
fn phrase_of(mnemonic: &Mnemonic) -> Zeroizing<String> {
    let len = mnemonic.words().map(|word| word.len() + 1).sum::<usize>();
    let mut phrase = Zeroizing::new(String::with_capacity(len));
    for (i, word) in mnemonic.words().enumerate() {
        if i > 0 {
            phrase.push(' ');
        }
        phrase.push_str(word);
    }
    phrase
}

/// Parses a recovery phrase typed by a user: case and extra whitespace are
/// ignored, the words and checksum must be valid BIP39 English, and there
/// must be 12, 15 or 24 of them.
pub fn parse_phrase(phrase: &str) -> Result<Mnemonic> {
    // Lowercasing never doubles a word's length, so this never grows.
    let mut normalized = Zeroizing::new(String::with_capacity(2 * phrase.len()));
    let mut words = 0;
    for word in phrase.split_whitespace() {
        if words > 0 {
            normalized.push(' ');
        }
        normalized.push_str(&Zeroizing::new(word.to_lowercase()));
        words += 1;
    }
    if !RESTORE_PHRASE_WORDS.contains(&words) {
        bail!("a recovery phrase has 12, 15 or 24 words, got {words}");
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

/// The BIP39 entropy of a recovery phrase: 16, 20 or 32 bytes for 12, 15 or
/// 24 words. The phrase is checked and normalized as in [`parse_phrase`].
/// The web wallet's vault stores this rather than the words.
pub fn phrase_to_entropy(phrase: &str) -> Result<Zeroizing<Vec<u8>>> {
    Ok(Zeroizing::new(parse_phrase(phrase)?.to_entropy()))
}

/// The recovery phrase for BIP39 entropy, the inverse of
/// [`phrase_to_entropy`]. Only the entropy of a 12-, 15- or 24-word phrase
/// (16, 20 or 32 bytes) is accepted.
pub fn entropy_to_phrase(entropy: &[u8]) -> Result<Zeroizing<String>> {
    Ok(phrase_of(&mnemonic_from_entropy(entropy)?))
}

/// The mnemonic of a 12-, 15- or 24-word phrase's entropy (16, 20 or 32
/// bytes), without writing the phrase out.
pub fn mnemonic_from_entropy(entropy: &[u8]) -> Result<Mnemonic> {
    check_entropy(entropy)?;
    Ok(Mnemonic::from_entropy_in(Language::English, entropy)?)
}

/// Refuses entropy that isn't a 12-, 15- or 24-word phrase's.
pub(crate) fn check_entropy(entropy: &[u8]) -> Result<()> {
    // Every 4 bytes of entropy is 3 words.
    let words = entropy.len() / 4 * 3;
    if !entropy.len().is_multiple_of(4) || !RESTORE_PHRASE_WORDS.contains(&words) {
        bail!(
            "recovery phrase entropy is 16, 20 or 32 bytes, got {}",
            entropy.len()
        );
    }
    Ok(())
}

/// The BIP39 English word list, for autocomplete while typing a phrase.
pub fn wordlist() -> &'static [&'static str; 2048] {
    Language::English.word_list()
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

    // Extract's HMAC is keyed by the salt, which isn't secret.
    let mut prk = Zeroizing::new([0u8; 32]);
    hkdf_extract(Sha256::new(), SALT_V1, seed, &mut prk[..]);
    let mut okm = [0u8; 64];
    expand_64(&prk, &info, &mut okm);
    okm
}

/// HKDF-SHA-256's expand (RFC 5869) for 64 bytes: `T(1) = HMAC(prk, info ||
/// 1)`, `T(2) = HMAC(prk, T(1) || info || 2)`. It gives what cryptoxide's
/// `hkdf_expand` gives, but that one's HMAC keeps the key, which is enough
/// to derive every account's key, in vectors it frees unwiped.
fn expand_64(prk: &[u8; 32], info: &[u8], okm: &mut [u8; 64]) {
    let (first, second) = okm.split_at_mut(32);
    hmac_sha256(prk, &[info, &[1]], first);
    hmac_sha256(prk, &[&*first, info, &[2]], second);
}

/// HMAC-SHA-256 (RFC 2104) of `message`'s parts in order, under a 32-byte
/// key, with the padded key and the inner hash in buffers that are wiped.
fn hmac_sha256(key: &[u8; 32], message: &[&[u8]], out: &mut [u8]) {
    let mut pad = Zeroizing::new([0x36u8; 64]);
    pad.iter_mut().zip(key).for_each(|(p, k)| *p ^= k);
    let mut inner = Sha256::new();
    inner.input(&pad[..]);
    message.iter().for_each(|part| inner.input(part));
    let mut inner_hash = Zeroizing::new([0u8; 32]);
    inner.result(&mut inner_hash[..]);
    // the outer pad: the same key under 0x5c
    pad.iter_mut().for_each(|p| *p ^= 0x36 ^ 0x5c);
    let mut outer = Sha256::new();
    outer.input(&pad[..]);
    outer.input(&inner_hash[..]);
    outer.result(out);
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
    key_v1(&parse_phrase(phrase)?, account)
}

/// The v1 Seedelf secret key for `account` of a recovery phrase's entropy,
/// as the web wallet's vault stores it: the key [`seedelf_key_v1`] gives
/// for that phrase, without the phrase ever being written out.
pub fn seedelf_key_v1_from_entropy(entropy: &[u8], account: u32) -> Result<Scalar> {
    key_v1(&mnemonic_from_entropy(entropy)?, account)
}

fn key_v1(mnemonic: &Mnemonic, account: u32) -> Result<Scalar> {
    let mut seed = bip39_seed(mnemonic);
    let mut okm = okm_v1(&seed, account);
    seed.zeroize();
    let x = scalar_from_okm(&okm);
    okm.zeroize();
    x
}

/// Refuses a network byte Messages' key has no network for, so a typo can't
/// derive a key for a network that doesn't exist.
fn check_messaging_network(network: u8) -> Result<()> {
    if network != MESSAGING_PREPROD && network != MESSAGING_MAINNET {
        bail!(
            "a messaging key's network byte is 0x00 (preprod) or 0x01 (mainnet), got 0x{network:02x}"
        );
    }
    Ok(())
}

/// HKDF-SHA-256 output keying material of Messages' key for `account`,
/// `network` and `generation`, 64 bytes. A network byte other than
/// [`MESSAGING_PREPROD`] or [`MESSAGING_MAINNET`] is refused.
pub fn messaging_okm_v1(
    seed: &[u8; 64],
    account: u32,
    network: u8,
    generation: u8,
) -> Result<[u8; 64]> {
    check_messaging_network(network)?;
    Ok(messaging_okm(seed, account, network, generation))
}

fn messaging_okm(seed: &[u8; 64], account: u32, network: u8, generation: u8) -> [u8; 64] {
    let mut info = Vec::with_capacity(MESSAGING_INFO_PREFIX_V1.len() + 6);
    info.extend_from_slice(MESSAGING_INFO_PREFIX_V1);
    info.extend_from_slice(&account.to_be_bytes());
    info.push(network);
    info.push(generation);

    // Extract's HMAC is keyed by the salt, which isn't secret.
    let mut prk = Zeroizing::new([0u8; 32]);
    hkdf_extract(Sha256::new(), MESSAGING_SALT_V1, seed, &mut prk[..]);
    let mut okm = [0u8; 64];
    expand_64(&prk, &info, &mut okm);
    okm
}

/// Messages' key, v1, for `account`, `network` and `generation` of a
/// recovery phrase: the web wallet's x_m, never its Seedelf key. A network
/// byte other than [`MESSAGING_PREPROD`] or [`MESSAGING_MAINNET`] is refused.
pub fn messaging_key_v1(phrase: &str, account: u32, network: u8, generation: u8) -> Result<Scalar> {
    check_messaging_network(network)?;
    messaging_key(&parse_phrase(phrase)?, account, network, generation)
}

/// Messages' key, v1, for `account`, `network` and `generation` of a
/// recovery phrase's entropy, as the web wallet's vault stores it: the key
/// [`messaging_key_v1`] gives for that phrase, without the phrase ever
/// being written out.
pub fn messaging_key_v1_from_entropy(
    entropy: &[u8],
    account: u32,
    network: u8,
    generation: u8,
) -> Result<Scalar> {
    check_messaging_network(network)?;
    messaging_key(
        &mnemonic_from_entropy(entropy)?,
        account,
        network,
        generation,
    )
}

fn messaging_key(mnemonic: &Mnemonic, account: u32, network: u8, generation: u8) -> Result<Scalar> {
    let mut seed = bip39_seed(mnemonic);
    let mut okm = messaging_okm(&seed, account, network, generation);
    seed.zeroize();
    let x_m = scalar_from_okm(&okm);
    okm.zeroize();
    x_m
}
