use anyhow::{Context, Result};
use blake2::Blake2bVar;
use blake2::digest::core_api::RtVariableCoreWrapper;
use blake2::digest::{Update, VariableOutput};
use hex;
use sha3::{Digest, Sha3_256};

/// Computes the BLAKE2b-224 hash of the input data.
///
/// The input MUST be a hex-encoded string. The on-chain verifier hashes raw
/// bytes via `bytearray.concat`; we hash the decoded bytes here so the two
/// sides agree byte-for-byte. A non-hex input is an error — an earlier
/// version silently fell back to hashing the UTF-8 bytes, which could
/// produce off-chain proofs the on-chain validator rejects.
///
/// # Arguments
///
/// * `data` - A hex-encoded string slice.
///
/// # Returns
///
/// * `String` - The BLAKE2b-224 hash, hex-encoded.
pub fn blake2b_224(data: &str) -> Result<String> {
    let decoded_data: Vec<u8> = hex::decode(data).context("blake2b_224: input must be hex")?;

    // Create a BLAKE2b hasher with a 224-bit output
    let mut hasher: RtVariableCoreWrapper<blake2::Blake2bVarCore> =
        Blake2bVar::new(28).context("Failed to create BLAKE2b hasher")?;
    hasher.update(&decoded_data);

    // Retrieve the hash result
    let mut result: [u8; 28] = [0u8; 28];
    hasher
        .finalize_variable(&mut result)
        .context("Failed to finalize hash")?;

    // Convert to hex string
    Ok(hex::encode(result))
}

/// Computes the BLAKE2b-256 hash of the input data.
///
/// The input MUST be a hex-encoded string. See [`blake2b_224`] for the
/// rationale — silently falling back to UTF-8 bytes risks divergence from
/// the on-chain hasher.
///
/// # Arguments
///
/// * `data` - A hex-encoded string slice.
///
/// # Returns
///
/// * `String` - The BLAKE2b-256 hash, hex-encoded.
pub fn blake2b_256(data: &str) -> Result<String> {
    let decoded_data: Vec<u8> = hex::decode(data).context("blake2b_256: input must be hex")?;

    // Create a BLAKE2b hasher with a 256-bit output
    let mut hasher: RtVariableCoreWrapper<blake2::Blake2bVarCore> =
        Blake2bVar::new(32).context("Failed to create BLAKE2b hasher")?;
    hasher.update(&decoded_data);

    // Retrieve the hash result
    let mut result: [u8; 32] = [0u8; 32];
    hasher
        .finalize_variable(&mut result)
        .context("Failed to finalize hash")?;

    // Convert to hex string
    Ok(hex::encode(result))
}

/// Computes the SHA3-256 hash of the input data.
///
/// This function accepts a string input, which is expected to be hex-encoded.
/// If the input is not a valid hex string, it falls back to hashing an empty byte array.
/// The resulting hash is 256 bits (32 bytes) and is returned as a hex-encoded string.
///
/// # Arguments
///
/// * `data` - A string slice representing the input data, expected to be hex-encoded.
///
/// # Returns
///
/// * `String` - The SHA3-256 hash of the input data, encoded as a hex string.
///
/// # Panics
///
/// * This function will not panic, but if `data` is not a valid hex string,
///   it will hash an empty byte array.
pub fn sha3_256(data: &str) -> Result<String> {
    let mut sha3_hasher = Sha3_256::new();
    Digest::update(
        &mut sha3_hasher,
        hex::decode(data).context("Invalid Input")?,
    );
    // Retrieve the hash result
    let result = sha3_hasher.finalize();

    // Convert to hex string
    Ok(hex::encode(result))
}
