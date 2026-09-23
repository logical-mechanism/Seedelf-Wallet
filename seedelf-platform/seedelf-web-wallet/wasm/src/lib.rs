//! WebAssembly bindings for the Seedelf web wallet.
//!
//! A thin layer over `seedelf-crypto`: every protocol rule (torsion checks,
//! same-`d` re-randomization, the `vkh`-bound Fiat-Shamir challenge) is
//! enforced there, not here. The secret scalar lives inside a [`SeedelfKey`]
//! and never crosses back into JavaScript; re-randomization scalars are
//! drawn and dropped inside `seedelf-crypto`.
//!
//! Each export is a small wrapper around a plain-Rust function in [`api`] so
//! the logic can be tested natively; the wrappers only convert errors into
//! JavaScript exceptions.

use blstrs::Scalar;
use ff::Field;
use seedelf_crypto::{derivation, register, schnorr};
use wasm_bindgen::prelude::*;

/// Plain-Rust implementations behind the exports, testable off-wasm.
pub mod api {
    use anyhow::{Result, anyhow, bail};
    use blstrs::Scalar;
    use ff::Field;
    use seedelf_crypto::register::Register;
    use seedelf_crypto::schnorr;

    /// Parses a secret scalar from 32 big-endian bytes in hex. Rejects
    /// non-canonical values (`>= r`) and zero.
    pub fn scalar_from_hex(sk_hex: &str) -> Result<Scalar> {
        let bytes: [u8; 32] = hex::decode(sk_hex)
            .map_err(|e| anyhow!("secret key is not valid hex: {e}"))?
            .try_into()
            .map_err(|v: Vec<u8>| anyhow!("secret key must be 32 bytes, got {}", v.len()))?;
        let sk: Scalar = Scalar::from_bytes_be(&bytes)
            .into_option()
            .ok_or_else(|| anyhow!("secret key is not a canonical BLS12-381 scalar"))?;
        if bool::from(sk.is_zero()) {
            bail!("secret key must not be zero");
        }
        Ok(sk)
    }

    /// Re-randomizes a register with a fresh random `d` applied to both points.
    pub fn rerandomize(register: &Register) -> Result<Register> {
        register.clone().rerandomize()
    }

    /// Checks a Schnorr proof the same way the wallet validator does.
    pub fn verify_proof(
        register: &Register,
        z_hex: &str,
        g_r_hex: &str,
        vkh_hex: &str,
    ) -> Result<bool> {
        schnorr::prove(
            &register.generator,
            &register.public_value,
            z_hex,
            g_r_hex,
            vkh_hex,
        )
    }
}

fn js_error(e: anyhow::Error) -> JsError {
    JsError::new(&format!("{e:#}"))
}

/// A register: the datum of every UTxO in the wallet contract. Both points
/// are compressed BLS12-381 G1 points, hex-encoded.
#[wasm_bindgen(js_name = Register, getter_with_clone)]
#[derive(Clone)]
pub struct WasmRegister {
    pub generator: String,
    #[wasm_bindgen(js_name = publicValue)]
    pub public_value: String,
}

#[wasm_bindgen(js_class = Register)]
impl WasmRegister {
    /// Wraps two hex-encoded points, e.g. read from an inline datum. Nothing
    /// is checked here; see [`is_valid_register`].
    #[wasm_bindgen(constructor)]
    pub fn new(generator: String, public_value: String) -> WasmRegister {
        WasmRegister {
            generator,
            public_value,
        }
    }
}

impl From<register::Register> for WasmRegister {
    fn from(r: register::Register) -> Self {
        WasmRegister {
            generator: r.generator,
            public_value: r.public_value,
        }
    }
}

impl From<&WasmRegister> for register::Register {
    fn from(r: &WasmRegister) -> Self {
        register::Register::new(r.generator.clone(), r.public_value.clone())
    }
}

/// A Schnorr proof for one wallet-contract input: `z` is the response scalar
/// (32 bytes, big-endian hex) and `gR` is the blinded generator `g^r`.
#[wasm_bindgen(js_name = Proof, getter_with_clone)]
pub struct WasmProof {
    pub z: String,
    #[wasm_bindgen(js_name = gR)]
    pub g_r: String,
}

/// The wallet's Seedelf secret key `x`. It stays inside WebAssembly memory;
/// call `free()` from JavaScript to drop it (the scalar is overwritten on drop).
#[wasm_bindgen]
pub struct SeedelfKey {
    sk: Scalar,
}

#[wasm_bindgen]
impl SeedelfKey {
    /// A fresh random key. For development and tests only: wallets use
    /// `fromPhrase`.
    pub fn random() -> SeedelfKey {
        SeedelfKey {
            sk: schnorr::random_scalar(),
        }
    }

    /// The wallet's key: v1 derivation from a 24-word recovery phrase
    /// (see `seedelf_crypto::derivation`). Case and extra whitespace are
    /// ignored; invalid phrases throw with a reason.
    #[wasm_bindgen(js_name = fromPhrase)]
    pub fn from_phrase(phrase: &str, account: u32) -> Result<SeedelfKey, JsError> {
        derivation::seedelf_key_v1(phrase, account)
            .map(|sk| SeedelfKey { sk })
            .map_err(js_error)
    }

    /// Imports a key from 32 big-endian bytes in hex. For development and
    /// tests only.
    #[wasm_bindgen(js_name = fromHex)]
    pub fn from_hex(sk_hex: &str) -> Result<SeedelfKey, JsError> {
        api::scalar_from_hex(sk_hex)
            .map(|sk| SeedelfKey { sk })
            .map_err(js_error)
    }

    /// The base register `(G1, G1^x)`. Senders re-randomize a copy of it;
    /// it is never written to chain as-is.
    #[wasm_bindgen(js_name = baseRegister)]
    pub fn base_register(&self) -> Result<WasmRegister, JsError> {
        register::Register::create(self.sk)
            .map(WasmRegister::from)
            .map_err(js_error)
    }

    /// Whether this key can spend a UTxO holding `register`.
    #[wasm_bindgen(js_name = isOwned)]
    pub fn is_owned(&self, register: &WasmRegister) -> Result<bool, JsError> {
        register::Register::from(register)
            .is_owned(self.sk)
            .map_err(js_error)
    }

    /// Proves ownership of `register`, binding the proof to `vkh`: the
    /// blake2b-224 hash (28 bytes, hex) of the transaction's one-time signing key.
    #[wasm_bindgen(js_name = createProof)]
    pub fn create_proof(&self, register: &WasmRegister, vkh: &str) -> Result<WasmProof, JsError> {
        schnorr::create_proof(register.into(), self.sk, vkh.to_string())
            .map(|(z, g_r)| WasmProof { z, g_r })
            .map_err(js_error)
    }
}

impl Drop for SeedelfKey {
    fn drop(&mut self) {
        // Best effort: overwrite the scalar before the memory is released.
        self.sk = Scalar::ZERO;
        std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
    }
}

/// A new 24-word recovery phrase from the browser's secure random source.
#[wasm_bindgen(js_name = generatePhrase)]
pub fn generate_phrase() -> String {
    derivation::generate_phrase()
}

/// Checks a typed recovery phrase: 24 BIP39 English words with a valid
/// checksum (case and extra whitespace ignored). Throws with a reason
/// suitable for showing to the user.
#[wasm_bindgen(js_name = validatePhrase)]
pub fn validate_phrase(phrase: &str) -> Result<(), JsError> {
    derivation::parse_phrase(phrase)
        .map(|_| ())
        .map_err(js_error)
}

/// Re-randomizes `register` for a new output: `(g^d, u^d)` with a fresh,
/// discarded `d`. Fails on points outside the prime-order subgroup.
#[wasm_bindgen]
pub fn rerandomize(register: &WasmRegister) -> Result<WasmRegister, JsError> {
    api::rerandomize(&register.into())
        .map(WasmRegister::from)
        .map_err(js_error)
}

/// Whether both points are on the curve and torsion-free. A register that
/// fails this locks funds forever if written to chain.
#[wasm_bindgen(js_name = isValidRegister)]
pub fn is_valid_register(register: &WasmRegister) -> Result<bool, JsError> {
    register::Register::from(register)
        .is_valid()
        .map_err(js_error)
}

/// The register as inline-datum bytes (PlutusData CBOR).
#[wasm_bindgen(js_name = registerToDatum)]
pub fn register_to_datum(register: &WasmRegister) -> Result<Vec<u8>, JsError> {
    register::Register::from(register)
        .to_vec()
        .map_err(js_error)
}

/// Checks a Schnorr proof off-chain, mirroring the wallet validator.
#[wasm_bindgen(js_name = verifyProof)]
pub fn verify_proof(
    register: &WasmRegister,
    z: &str,
    g_r: &str,
    vkh: &str,
) -> Result<bool, JsError> {
    api::verify_proof(&register.into(), z, g_r, vkh).map_err(js_error)
}
