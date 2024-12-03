use blake2::Blake2bVar;
use blake2::digest::{Update, VariableOutput};
use hex;

/// Computes the BLAKE2b-224 hash of the input data.
/// 
/// # Arguments
/// 
/// * `data` - A byte slice containing the data to hash.
///
/// # Returns
/// 
/// A hexadecimal string representing the BLAKE2b-224 hash.
pub fn blake2b_224(data: &str) -> String {
    // Decode hex string to bytes if needed
    let decoded_data = if let Ok(decoded) = hex::decode(data) {
        decoded
    } else {
        data.as_bytes().to_vec()
    };

    // Create a BLAKE2b hasher with a 224-bit output
    let mut hasher = Blake2bVar::new(28).expect("Failed to create BLAKE2b hasher");
    hasher.update(&decoded_data);

    // Retrieve the hash result
    let mut result = [0u8; 28];
    hasher.finalize_variable(&mut result).expect("Failed to finalize hash");

    // Convert to hex string
    hex::encode(result)
}
