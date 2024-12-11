use blake2::Blake2bVar;
use blake2::digest::{Update, VariableOutput};
use hex;

pub fn blake2b_224(data: &str) -> String {
    // Decode hex string to bytes if needed
    let decoded_data: Vec<u8> = if let Ok(decoded) = hex::decode(data) {
        decoded
    } else {
        data.as_bytes().to_vec()
    };

    // Create a BLAKE2b hasher with a 224-bit output
    let mut hasher = Blake2bVar::new(28).expect("Failed to create BLAKE2b hasher");
    hasher.update(&decoded_data);

    // Retrieve the hash result
    let mut result: [u8; 28] = [0u8; 28];
    hasher.finalize_variable(&mut result).expect("Failed to finalize hash");

    // Convert to hex string
    hex::encode(result)
}
