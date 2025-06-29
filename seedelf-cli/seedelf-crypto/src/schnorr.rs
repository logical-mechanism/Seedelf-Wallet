use crate::hashing::blake2b_224;
use crate::register::Register;
use blstrs::{G1Affine, G1Projective, Scalar};

use anyhow::{Context, Result, anyhow};
use ff::Field;
use hex;
use rand_core::OsRng;

/// Applies the Fiat-Shamir heuristic using the BLAKE2b-224 hash function.
///
/// This function takes four inputs as hex strings, concatenates them, and hashes
/// the resulting string using the BLAKE2b-224 hash function.
///
/// # Arguments
///
/// * `g_b` - A string representing the generator in its hex-encoded form.
/// * `g_r_b` - A string representing the randomized generator value in hex form.
/// * `u_b` - A string representing the public value in hex form.
/// * `b` - A string representing an additional value or input in hex form.
///
/// # Returns
///
/// * `String` - A hex-encoded BLAKE2b-224 hash of the concatenated input strings.
pub fn fiat_shamir_heuristic(g_b: String, g_r_b: String, u_b: String, b: String) -> Result<String> {
    // Concatenate the strings
    let concatenated: String = format!("{g_b}{g_r_b}{u_b}{b}");

    // Convert to bytes and hash
    blake2b_224(&concatenated)
}

/// Generates a cryptographically secure random scalar.
///
/// This function uses a secure random number generator (`OsRng`) to produce
/// a random `Scalar` suitable for cryptographic operations.
///
/// # Returns
///
/// * `Scalar` - A randomly generated scalar.
pub fn random_scalar() -> Scalar {
    Scalar::random(&mut OsRng)
}

/// Creates a non-interactive Schnorr proof using the Fiat-Shamir heuristic.
///
/// This function generates a proof of knowledge for a secret scalar `sk` associated
/// with a `Register`. It uses a random scalar `r` and applies the Fiat-Shamir heuristic
/// to produce a challenge, which is then used to compute the response.
///
/// # Arguments
///
/// * `datum` - A `Register` containing the generator and public value as hex-encoded strings.
/// * `sk` - A secret scalar representing the private key.
/// * `bound` - A string representing an additional input for the Fiat-Shamir heuristic.
///
/// # Returns
///
/// * `(String, String)` - A tuple containing:
///     - `z` - The response scalar as a hex-encoded string.
///     - `g_r` - The blinded generator (`g^r`) as a hex-encoded compressed point.
pub fn create_proof(
    datum: Register,
    sk: Scalar,
    bound: String,
    r: Scalar,
) -> Result<(String, String)> {
    let g1: G1Affine = G1Affine::from_compressed(
        &hex::decode(&datum.generator)
            .context("Failed to decode generator hex")?
            .try_into()
            .map_err(|e| anyhow::anyhow!("{e:?}"))?,
    )
    .into_option()
    .ok_or_else(|| anyhow!("Failed to decompress generator"))?;

    let g_r: G1Projective = G1Projective::from(g1) * r;

    let c_hex: String = fiat_shamir_heuristic(
        datum.generator,
        hex::encode(g_r.to_compressed()),
        datum.public_value,
        bound,
    )
    .context("Fair Shamir Heuristic Failure")?;
    let c_bytes: Vec<u8> = hex::decode(&c_hex).context("Failed to decode Fiat-Shamir output")?;
    let mut c_array: [u8; 32] = [0u8; 32];
    c_array[(32 - c_bytes.len())..].copy_from_slice(&c_bytes);
    let c: Scalar = Scalar::from_bytes_be(&c_array)
        .into_option()
        .ok_or_else(|| anyhow!("Failed to Convert To Scalar"))?;

    let z: Scalar = r + c * sk;
    Ok((
        hex::encode(z.to_bytes_be()),
        hex::encode(g_r.to_compressed()),
    ))
}

/// Used for testing
pub fn prove(
    generator: &str,
    public_value: &str,
    z_b: &str,
    g_r_b: &str,
    bound: &str,
) -> Result<bool> {
    // Decode and decompress generator
    let g1: G1Affine = G1Affine::from_compressed(
        &hex::decode(generator)
            .context("Failed to decode generator hex")?
            .try_into()
            .map_err(|e| anyhow::anyhow!("{e:?}"))?,
    )
    .into_option()
    .ok_or_else(|| anyhow!("Failed to decompress generator"))?;

    // Decode and decompress public_value
    let u: G1Affine = G1Affine::from_compressed(
        &hex::decode(public_value)
            .context("Failed to decode public value hex")?
            .try_into()
            .map_err(|e| anyhow::anyhow!("{e:?}"))?,
    )
    .into_option()
    .ok_or_else(|| anyhow!("Failed to decompress generator"))?;

    // Decode and decompress g_r_b
    let g_r: G1Affine = G1Affine::from_compressed(
        &hex::decode(g_r_b)
            .context("Failed to decode g_r_b hex")?
            .try_into()
            .map_err(|e| anyhow::anyhow!("{e:?}"))?,
    )
    .into_option()
    .ok_or_else(|| anyhow!("Failed to decompress generator"))?;

    // Convert z_b to Scalar
    let z_bytes: Vec<u8> = hex::decode(z_b).context("Failed to decode z_b hex")?;
    let mut z_array: [u8; 32] = [0u8; 32];
    z_array[(32 - z_bytes.len())..].copy_from_slice(&z_bytes);
    let z: Scalar = Scalar::from_bytes_be(&z_array)
        .into_option()
        .ok_or_else(|| anyhow!("Failed to Convert To Scalar"))?;

    // Compute g^z = g1 * z
    let g_z: G1Projective = g1 * z; // Convert to G1Affine for comparison

    // Calculate challenge `c` using the Fiat-Shamir heuristic
    let c_hex: String = fiat_shamir_heuristic(
        generator.to_string(),
        g_r_b.to_string(),
        public_value.to_string(),
        bound.to_string(),
    )
    .context("Fair Shamir Heuristic Failure")?;
    let c_bytes: Vec<u8> = hex::decode(&c_hex).context("Failed to decode Fiat-Shamir output")?;
    let mut c_array = [0u8; 32];
    c_array[(32 - c_bytes.len())..].copy_from_slice(&c_bytes);
    let c = Scalar::from_bytes_be(&c_array)
        .into_option()
        .ok_or_else(|| anyhow!("Failed to Convert To Scalar"))?;

    // Compute u^c = (g^x)^c = g1^(x * c)
    let u_c: G1Projective = u * c;

    // Verify g^z = g^r * u^c
    Ok(g_z == (G1Projective::from(g_r) + u_c))
}
