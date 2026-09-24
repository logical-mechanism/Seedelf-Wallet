//! WebAssembly bindings for the Seedelf web wallet.
//!
//! A thin layer over `seedelf-crypto`: every protocol rule (torsion checks,
//! same-`d` re-randomization, the `vkh`-bound Fiat-Shamir challenge) is
//! enforced there, not here. Secrets stay inside WebAssembly: the Seedelf
//! scalar in a [`SeedelfKey`] and the Cardano HD keys in a
//! [`WasmCardanoAccount`] never cross back into JavaScript; re-randomization
//! scalars are drawn and dropped inside `seedelf-crypto`.
//!
//! Each export is a small wrapper around a plain-Rust function in [`api`] so
//! the logic can be tested natively; the wrappers only convert errors into
//! JavaScript exceptions.

use blstrs::Scalar;
use ff::Field;
use seedelf_crypto::{cardano, derivation, register, schnorr};
use wasm_bindgen::prelude::*;

/// Plain-Rust implementations behind the exports, testable off-wasm.
pub mod api {
    use anyhow::{Result, anyhow, bail};
    use blstrs::Scalar;
    use ff::Field;
    use seedelf_crypto::derivation;
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

    /// Rebuilds the recovery phrase from vault entropy, hands it to `f`, then
    /// overwrites it. The phrase never leaves WebAssembly.
    pub fn with_phrase<T>(entropy: &[u8], f: impl FnOnce(&str) -> Result<T>) -> Result<T> {
        let phrase = derivation::entropy_to_phrase(entropy)?;
        let result = f(&phrase);
        let mut bytes = phrase.into_bytes();
        bytes.fill(0);
        std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
        result
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

    /// The wallet's key: v1 derivation from a 12-, 15- or 24-word recovery
    /// phrase (see `seedelf_crypto::derivation`). Case and extra whitespace
    /// are ignored; invalid phrases throw with a reason.
    #[wasm_bindgen(js_name = fromPhrase)]
    pub fn from_phrase(phrase: &str, account: u32) -> Result<SeedelfKey, JsError> {
        derivation::seedelf_key_v1(phrase, account)
            .map(|sk| SeedelfKey { sk })
            .map_err(js_error)
    }

    /// The wallet's key from the recovery phrase's BIP39 entropy, as the
    /// vault stores it: the same key `fromPhrase` gives for that phrase. The
    /// phrase is rebuilt inside WebAssembly and never reaches JavaScript.
    #[wasm_bindgen(js_name = fromEntropy)]
    pub fn from_entropy(entropy: &[u8], account: u32) -> Result<SeedelfKey, JsError> {
        api::with_phrase(entropy, |phrase| {
            derivation::seedelf_key_v1(phrase, account)
        })
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

/// Which Cardano network an address is for.
#[wasm_bindgen]
#[derive(Clone, Copy)]
pub enum Network {
    Preprod = 0,
    Mainnet = 1,
}

impl Network {
    /// The CLI's convention: `true` means preprod.
    fn flag(self) -> bool {
        matches!(self, Network::Preprod)
    }
}

/// The wallet's Cardano account: standard CIP-1852 keys from the recovery
/// phrase, so the same phrase shows the same account in Lace, Eternl or
/// Yoroi. The private keys stay inside WebAssembly memory; call `free()` to
/// drop them.
#[wasm_bindgen(js_name = CardanoAccount)]
pub struct WasmCardanoAccount {
    inner: cardano::CardanoAccount,
}

#[wasm_bindgen(js_class = CardanoAccount)]
impl WasmCardanoAccount {
    /// Account `account` (`m/1852'/1815'/account'`) of a 12-, 15- or 24-word
    /// phrase. v1 of the wallet uses account 0.
    #[wasm_bindgen(js_name = fromPhrase)]
    pub fn from_phrase(phrase: &str, account: u32) -> Result<WasmCardanoAccount, JsError> {
        cardano::CardanoAccount::from_phrase(phrase, account)
            .map(|inner| WasmCardanoAccount { inner })
            .map_err(js_error)
    }

    /// Account `account` from the recovery phrase's BIP39 entropy, as the
    /// vault stores it. The phrase never reaches JavaScript.
    #[wasm_bindgen(js_name = fromEntropy)]
    pub fn from_entropy(entropy: &[u8], account: u32) -> Result<WasmCardanoAccount, JsError> {
        api::with_phrase(entropy, |phrase| {
            cardano::CardanoAccount::from_phrase(phrase, account)
        })
        .map(|inner| WasmCardanoAccount { inner })
        .map_err(js_error)
    }

    /// The account public key (public key || chain code), hex. Enough to
    /// derive every address without the private key.
    #[wasm_bindgen(js_name = accountPublicKey)]
    pub fn account_public_key(&self) -> String {
        hex::encode(self.inner.account_public_key().as_bytes())
    }

    /// The receive address `0/index`, delegated to the account's staking key.
    #[wasm_bindgen(js_name = receiveAddress)]
    pub fn receive_address(&self, network: Network, index: u32) -> Result<String, JsError> {
        self.address(network, cardano::Role::Receive, index)
    }

    /// The change address `1/index`, delegated to the account's staking key.
    #[wasm_bindgen(js_name = changeAddress)]
    pub fn change_address(&self, network: Network, index: u32) -> Result<String, JsError> {
        self.address(network, cardano::Role::Change, index)
    }

    /// The account's reward (stake) address.
    #[wasm_bindgen(js_name = stakeAddress)]
    pub fn stake_address(&self, network: Network) -> Result<String, JsError> {
        self.inner
            .stake_address(network.flag())
            .and_then(|a| a.to_bech32().map_err(anyhow::Error::from))
            .map_err(js_error)
    }

    fn address(
        &self,
        network: Network,
        role: cardano::Role,
        index: u32,
    ) -> Result<String, JsError> {
        self.inner
            .base_address(network.flag(), role, index)
            .and_then(|a| a.to_bech32().map_err(anyhow::Error::from))
            .map_err(js_error)
    }
}

/// A new 24-word recovery phrase from the browser's secure random source.
#[wasm_bindgen(js_name = generatePhrase)]
pub fn generate_phrase() -> String {
    derivation::generate_phrase()
}

/// Checks a typed recovery phrase: 12, 15 or 24 BIP39 English words with a
/// valid checksum (case and extra whitespace ignored), the lengths Lace
/// accepts. Throws with a reason suitable for showing to the user.
#[wasm_bindgen(js_name = validatePhrase)]
pub fn validate_phrase(phrase: &str) -> Result<(), JsError> {
    derivation::parse_phrase(phrase)
        .map(|_| ())
        .map_err(js_error)
}

/// The BIP39 entropy of a recovery phrase (16, 20 or 32 bytes for 12, 15
/// or 24 words), checked and normalized like `validatePhrase`. The vault
/// stores this rather than the words.
#[wasm_bindgen(js_name = phraseToEntropy)]
pub fn phrase_to_entropy(phrase: &str) -> Result<Vec<u8>, JsError> {
    derivation::phrase_to_entropy(phrase).map_err(js_error)
}

/// The recovery phrase for 16, 20 or 32 bytes of BIP39 entropy.
#[wasm_bindgen(js_name = entropyToPhrase)]
pub fn entropy_to_phrase(entropy: &[u8]) -> Result<String, JsError> {
    derivation::entropy_to_phrase(entropy).map_err(js_error)
}

/// The 2048-word BIP39 English list, for autocomplete while typing a phrase.
#[wasm_bindgen(js_name = bip39Wordlist)]
pub fn bip39_wordlist() -> Vec<String> {
    derivation::wordlist()
        .iter()
        .map(|w| w.to_string())
        .collect()
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
