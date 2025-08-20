use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use anyhow::{Context, Result, anyhow};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use blstrs::{G1Affine, G1Projective, Scalar};
use cryptoxide::hkdf::{hkdf_expand, hkdf_extract};
use cryptoxide::sha3::Sha3_256;
use rand_core::{OsRng, RngCore};

use crate::register::Register; // your type with { generator, public_value }
use crate::schnorr::random_scalar;

const NONCE_LEN: usize = 12;
const DOMAIN: &[u8] = b"ECIES|BLS12-381|AES-GCM|v1|";

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Ecies {
    /// R = g^r as compressed hex (96 hex chars)
    pub r_hex: String,
    /// base64(nonce || ciphertext)
    pub c_b64: String,
}

impl Ecies {
    /// Encrypts `message` to `user` (whose register has g and u = g^x).
    pub fn encrypt(message: &str, user: &Register) -> Result<Self> {
        // Decode & validate inputs
        let g: G1Affine = G1Affine::from_compressed(
            &hex::decode(&user.generator)
                .context("Failed to decode generator hex")?
                .try_into()
                .map_err(|e| anyhow!("{e:?}"))?,
        )
        .into_option()
        .ok_or_else(|| anyhow!("Failed to decompress generator"))?;

        let u: G1Affine = G1Affine::from_compressed(
            &hex::decode(&user.public_value)
                .context("Failed to decode public value hex")?
                .try_into()
                .map_err(|e| anyhow!("{e:?}"))?,
        )
        .into_option()
        .ok_or_else(|| anyhow!("Failed to decompress public value"))?;

        // d ←$ Fr
        let d: Scalar = random_scalar();

        // R = g^d, S = u^d
        let r: G1Projective = G1Projective::from(g) * d;
        let s: G1Projective = G1Projective::from(u) * d;

        let r_bytes = r.to_compressed(); // 48 bytes
        let s_bytes = s.to_compressed(); // 48 bytes

        // HKDF-SHA3-256 with info = DOMAIN || R, salt=None -> zero-salt (HashLen zeros)
        let mut prk = [0u8; 32];
        let zero_salt = [0u8; 32];
        hkdf_extract(Sha3_256::new(), &zero_salt, &s_bytes, &mut prk);

        let info = [DOMAIN, &r_bytes].concat();
        let mut key = [0u8; 32];
        hkdf_expand(Sha3_256::new(), &prk, &info, &mut key);

        // AES-256-GCM
        let cipher = Aes256Gcm::new_from_slice(&key).expect("32-byte key");
        let mut nonce = [0u8; NONCE_LEN];
        OsRng.fill_bytes(&mut nonce);

        // AAD = g || u || R  (all compressed encodings)
        let aad = [
            hex::decode(&user.generator).context("g hex decode failed")?,
            hex::decode(&user.public_value).context("u hex decode failed")?,
            r_bytes.to_vec(),
        ]
        .concat();

        let ct = cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: message.as_bytes(),
                    aad: &aad,
                },
            )
            .map_err(|e| anyhow!("AES-GCM encrypt failed: {e}"))?;

        Ok(Self {
            r_hex: hex::encode(r_bytes),
            c_b64: B64.encode([nonce.as_slice(), ct.as_slice()].concat()),
        })
    }

    /// Attempts to decrypt for owner with secret `sk` and corresponding `user` register.
    /// Returns `Ok(Some(plaintext))` on success, `Ok(None)` if not for this key,
    /// and `Err` for malformed inputs.
    pub fn decrypt(&self, sk: Scalar, user: &Register) -> Result<Option<String>> {
        // Parse inputs
        let _g: G1Affine = G1Affine::from_compressed(
            &hex::decode(&user.generator)
                .context("Failed to decode generator hex")?
                .try_into()
                .map_err(|e| anyhow!("{e:?}"))?,
        )
        .into_option()
        .ok_or_else(|| anyhow!("Failed to decompress generator"))?;

        let _u: G1Affine = G1Affine::from_compressed(
            &hex::decode(&user.public_value)
                .context("Failed to decode public value hex")?
                .try_into()
                .map_err(|e| anyhow!("{e:?}"))?,
        )
        .into_option()
        .ok_or_else(|| anyhow!("Failed to decompress public value"))?;

        let r_aff: G1Affine = G1Affine::from_compressed(
            &hex::decode(&self.r_hex)
                .context("Failed to decode R hex")?
                .try_into()
                .map_err(|e| anyhow!("{e:?}"))?,
        )
        .into_option()
        .ok_or_else(|| anyhow!("Failed to decompress R"))?;

        // Derive S' = R^x
        let s_prime: G1Projective = G1Projective::from(r_aff) * sk;
        let r_bytes = r_aff.to_compressed();
        let s_bytes = s_prime.to_compressed();

        // HKDF-SHA3-256 with info = DOMAIN || R, salt=None -> zero-salt
        let mut prk = [0u8; 32];
        let zero_salt = [0u8; 32];
        hkdf_extract(Sha3_256::new(), &zero_salt, &s_bytes, &mut prk);

        let info = [DOMAIN, &r_bytes].concat();
        let mut key = [0u8; 32];
        hkdf_expand(Sha3_256::new(), &prk, &info, &mut key);

        let cipher = Aes256Gcm::new_from_slice(&key).expect("32-byte key");

        // Split base64 blob
        let blob = B64
            .decode(&self.c_b64)
            .map_err(|e| anyhow!("base64 decode failed: {e}"))?;
        if blob.len() < NONCE_LEN {
            return Err(anyhow!("ciphertext too short"));
        }
        let (nonce, ct) = blob.split_at(NONCE_LEN);

        // AAD = g || u || R
        let aad = [
            hex::decode(&user.generator).context("g hex decode failed")?,
            hex::decode(&user.public_value).context("u hex decode failed")?,
            r_bytes.to_vec(),
        ]
        .concat();

        match cipher.decrypt(Nonce::from_slice(nonce), Payload { msg: ct, aad: &aad }) {
            Ok(pt) => Ok(Some(String::from_utf8(pt).context("plaintext not UTF-8")?)),
            Err(_) => Ok(None), // not owned / wrong key or tampered
        }
    }
}
