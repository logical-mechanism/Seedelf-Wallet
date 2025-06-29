use anyhow::{Context, Result};
use blake2::Blake2bVar;
use blake2::digest::core_api::RtVariableCoreWrapper;
use blake2::digest::{Update, VariableOutput};
use hex;
use sha3::{Digest, Sha3_256};

/// Computes the BLAKE2b-224 hash of the input data.
///
/// This function accepts a string input, which can be a hex-encoded string or a raw string.
/// If the input is hex-encoded, it is decoded to bytes. Otherwise, the raw bytes of the string are used.
/// The resulting hash is 224 bits (28 bytes) and is returned as a hex-encoded string.
///
/// # Arguments
///
/// * `data` - A string slice representing the input data. It can be a hex-encoded string or plain text.
///
/// # Returns
///
/// * `String` - The BLAKE2b-224 hash of the input data, encoded as a hex string.
///
/// # Panics
///
/// * If creating or finalizing the BLAKE2b hasher fails.
/// * If the input hex string cannot be decoded.
pub fn blake2b_224(data: &str) -> Result<String> {
    // Decode hex string to bytes if needed
    let decoded_data: Vec<u8> = if let Ok(decoded) = hex::decode(data) {
        decoded
    } else {
        data.as_bytes().to_vec()
    };

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
/// This function accepts a string input, which can be a hex-encoded string or a raw string.
/// If the input is hex-encoded, it is decoded to bytes. Otherwise, the raw bytes of the string are used.
/// The resulting hash is 256 bits (32 bytes) and is returned as a hex-encoded string.
///
/// # Arguments
///
/// * `data` - A string slice representing the input data. It can be a hex-encoded string or plain text.
///
/// # Returns
///
/// * `String` - The BLAKE2b-256 hash of the input data, encoded as a hex string.
///
/// # Panics
///
/// * If creating or finalizing the BLAKE2b hasher fails.
/// * If the input hex string cannot be decoded.
pub fn blake2b_256(data: &str) -> Result<String> {
    // Decode hex string to bytes if needed
    let decoded_data: Vec<u8> = if let Ok(decoded) = hex::decode(data) {
        decoded
    } else {
        data.as_bytes().to_vec()
    };

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
