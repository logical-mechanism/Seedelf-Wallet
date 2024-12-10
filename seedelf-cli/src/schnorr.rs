use crate::{hashing::blake2b_224, register::Register};
use blstrs::{G1Affine, G1Projective, Scalar};

use ff::Field;
use hex;
use rand_core::OsRng;

pub fn fiat_shamir_heuristic(g_b: String, g_r_b: String, u_b: String, b: String) -> String {
    // Concatenate the strings
    let concatenated = format!("{}{}{}{}", g_b, g_r_b, u_b, b);

    // Convert to bytes and hash
    blake2b_224(&concatenated)
}

pub fn random_scalar() -> Scalar {
    Scalar::random(&mut OsRng)
}

pub fn create_register(sk: Scalar) -> (String, String) {
    // Decode and decompress generator
    let generator = "97F1D3A73197D7942695638C4FA9AC0FC3688C4F9774B905A14E3A3F171BAC586C55E83FF97A1AEFFB3AF00ADB22C6BB";
    let g1 = G1Affine::from_compressed(
        &hex::decode(generator)
            .expect("Failed to decode generator hex")
            .try_into()
            .expect("Invalid generator length"),
    )
    .expect("Failed to decompress generator");

    let public_value = G1Projective::from(g1) * sk;

    // Compress points and return them as hex strings
    (
        hex::encode(g1.to_compressed()),
        hex::encode(public_value.to_compressed()),
    )
}

pub fn is_owned(generator: &str, public_value: &str, sk: Scalar) -> bool {
    let g1 = G1Affine::from_compressed(
        &hex::decode(generator)
            .expect("Failed to decode generator hex")
            .try_into()
            .expect("Invalid generator length"),
    )
    .expect("Failed to decompress generator");

    let g_x = G1Projective::from(g1) * sk;

    hex::encode(g_x.to_compressed()) == public_value
}

pub fn create_proof(datum: Register, sk: Scalar, bound: String) -> (String, String) {
    let r: Scalar = random_scalar();
    let g1: G1Affine = G1Affine::from_compressed(
        &hex::decode(&datum.generator)
            .expect("Failed to decode generator hex")
            .try_into()
            .expect("Invalid generator length"),
    )
    .expect("Failed to decompress generator");

    let g_r: G1Projective = G1Projective::from(g1) * r;

    let c_hex: String = fiat_shamir_heuristic(datum.generator, hex::encode(g_r.to_compressed()),datum.public_value, bound);
    let c_bytes: Vec<u8> = hex::decode(&c_hex).expect("Failed to decode Fiat-Shamir output");
    let mut c_array: [u8; 32] = [0u8; 32];
    c_array[(32 - c_bytes.len())..].copy_from_slice(&c_bytes);
    let c: Scalar = Scalar::from_bytes_be(&c_array).unwrap();
    
    let z: Scalar = r + c * sk;
    (hex::encode(z.to_bytes_be()), hex::encode(g_r.to_compressed()))

}

pub fn rerandomize(generator: &str, public_value: &str) -> (String, String) {
    // Decode and decompress generator
    let g1 = G1Affine::from_compressed(
        &hex::decode(generator)
            .expect("Failed to decode generator hex")
            .try_into()
            .expect("Invalid generator length"),
    )
    .expect("Failed to decompress generator");

    // Decode and decompress public_value
    let u = G1Affine::from_compressed(
        &hex::decode(public_value)
            .expect("Failed to decode public value hex")
            .try_into()
            .expect("Invalid public value length"),
    )
    .expect("Failed to decompress public value");
    let d: Scalar = random_scalar();
    // Multiply points by the scalar in G1Projective
    let g1_randomized = G1Projective::from(g1) * d;
    let u_randomized = G1Projective::from(u) * d;

    // Compress points and return them as hex strings
    (
        hex::encode(g1_randomized.to_compressed()),
        hex::encode(u_randomized.to_compressed()),
    )
}

/// Computes a Schnorr proof.
///
/// # Arguments
/// - `generator`: Hex-encoded compressed G1 point.
/// - `public_value`: Hex-encoded compressed G1 point (g^x).
/// - `z_b`: Hex string of scalar `z`.
/// - `g_r_b`: Hex-encoded compressed G1 point (g^r).
/// - `bound`: Hex string used as part of the Fiat-Shamir heuristic.
///
/// # Returns
/// - `true` if the proof verifies, `false` otherwise.
pub fn prove(generator: &str, public_value: &str, z_b: &str, g_r_b: &str, bound: &str) -> bool {
    // Decode and decompress generator
    let g1 = G1Affine::from_compressed(
        &hex::decode(generator)
            .expect("Failed to decode generator hex")
            .try_into()
            .expect("Invalid generator length"),
    )
    .expect("Failed to decompress generator");

    // Decode and decompress public_value
    let u = G1Affine::from_compressed(
        &hex::decode(public_value)
            .expect("Failed to decode public value hex")
            .try_into()
            .expect("Invalid public value length"),
    )
    .expect("Failed to decompress public value");

    // Decode and decompress g_r_b
    let g_r = G1Affine::from_compressed(
        &hex::decode(g_r_b)
            .expect("Failed to decode g_r_b hex")
            .try_into()
            .expect("Invalid g_r_b length"),
    )
    .expect("Failed to decompress g_r_b");

    // Convert z_b to Scalar
    let z_bytes = hex::decode(z_b).expect("Failed to decode z_b hex");
    let mut z_array = [0u8; 32];
    z_array[(32 - z_bytes.len())..].copy_from_slice(&z_bytes);
    let z = Scalar::from_bytes_be(&z_array).unwrap();

    // Compute g^z = g1 * z
    let g_z: G1Projective = (g1 * z).into(); // Convert to G1Affine for comparison

    // Calculate challenge `c` using the Fiat-Shamir heuristic
    let c_hex = fiat_shamir_heuristic(generator.to_string(), g_r_b.to_string(), public_value.to_string(), bound.to_string());
    let c_bytes = hex::decode(&c_hex).expect("Failed to decode Fiat-Shamir output");
    let mut c_array = [0u8; 32];
    c_array[(32 - c_bytes.len())..].copy_from_slice(&c_bytes);
    let c = Scalar::from_bytes_be(&c_array).unwrap();

    // Compute u^c = (g^x)^c = g1^(x * c)
    let u_c = u * c;

    // Verify g^z = g^r * u^c
    g_z == (G1Projective::from(g_r) + u_c).into()
}
