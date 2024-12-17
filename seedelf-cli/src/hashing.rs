use blake2::Blake2bVar;
use blake2::digest::{Update, VariableOutput};
use blake2::digest::core_api::RtVariableCoreWrapper;
use hex;

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
pub fn blake2b_224(data: &str) -> String {
    // Decode hex string to bytes if needed
    let decoded_data: Vec<u8> = if let Ok(decoded) = hex::decode(data) {
        decoded
    } else {
        data.as_bytes().to_vec()
    };

    // Create a BLAKE2b hasher with a 224-bit output
    let mut hasher: RtVariableCoreWrapper<blake2::Blake2bVarCore> = Blake2bVar::new(28).expect("Failed to create BLAKE2b hasher");
    hasher.update(&decoded_data);

    // Retrieve the hash result
    let mut result: [u8; 28] = [0u8; 28];
    hasher.finalize_variable(&mut result).expect("Failed to finalize hash");

    // Convert to hex string
    hex::encode(result)
}
