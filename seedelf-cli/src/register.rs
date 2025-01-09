use crate::schnorr::random_scalar;
use blstrs::{G1Affine, G1Projective, Scalar};
use hex;
use hex::FromHex;
use pallas_primitives::{
    alonzo::{Constr, MaybeIndefArray, PlutusData},
    BoundedBytes, Fragment,
};
use serde::{Deserialize, Serialize};

/// Represents a cryptographic register containing a generator and a public value.
///
/// The `Register` struct holds two points in compressed hex string format:
/// - `generator`: A generator point in G1.
/// - `public_value`: A public value computed as `generator * sk` where `sk` is a scalar.
///
/// It provides methods for creating, serializing, rerandomizing, and verifying ownership of the register.
#[derive(Serialize, Deserialize, PartialEq, Eq, Debug, Hash, Clone, Default)]
pub struct Register {
    pub generator: String,
    pub public_value: String,
}

impl Register {
    /// Creates a new `Register` with the specified generator and public value.
    ///
    /// # Arguments
    ///
    /// * `generator` - A compressed hex string representing the generator point.
    /// * `public_value` - A compressed hex string representing the public value point.
    pub fn new(generator: String, public_value: String) -> Self {
        Self {
            generator,
            public_value,
        }
    }

    /// Generates a `Register` using a provided scalar (`sk`).
    ///
    /// This method decompresses a hardcoded generator point, multiplies it by the scalar
    /// to compute the public value, and compresses both points into hex strings.
    ///
    /// # Arguments
    ///
    /// * `sk` - A scalar used to compute the public value.
    ///
    /// # Returns
    ///
    /// * A new `Register` with compressed generator and public value.
    pub fn create(sk: Scalar) -> Self {
        // Decode and decompress generator
        let compressed_g1_generator: &str = "97F1D3A73197D7942695638C4FA9AC0FC3688C4F9774B905A14E3A3F171BAC586C55E83FF97A1AEFFB3AF00ADB22C6BB";

        let g1_generator: G1Affine = G1Affine::from_compressed(
            &hex::decode(compressed_g1_generator)
                .expect("Failed to decode generator hex")
                .try_into()
                .expect("Invalid generator length"),
        )
        .expect("Failed to decompress generator");

        let public_value: G1Projective = G1Projective::from(g1_generator) * sk;

        // Compress points and return them as hex strings
        Self {
            generator: hex::encode(g1_generator.to_compressed()),
            public_value: hex::encode(public_value.to_compressed()),
        }
    }

    /// Converts the `Register` into a serialized vector of bytes using PlutusData encoding.
    ///
    /// # Returns
    ///
    /// * `Vec<u8>` - A serialized byte vector representing the `Register`.
    ///
    /// # Panics
    ///
    /// * If the generator or public value are invalid hex strings.
    pub fn to_vec(&self) -> Vec<u8> {
        // convert the strings into vectors
        let generator_vector: Vec<u8> = Vec::from_hex(&self.generator).expect("Invalid hex string");
        let public_value_vector: Vec<u8> =
            Vec::from_hex(&self.public_value).expect("Invalid hex string");
        // construct the plutus data
        let plutus_data: PlutusData = PlutusData::Constr(Constr {
            tag: 121,
            any_constructor: None,
            fields: MaybeIndefArray::Indef(vec![
                PlutusData::BoundedBytes(BoundedBytes::from(generator_vector)),
                PlutusData::BoundedBytes(BoundedBytes::from(public_value_vector)),
            ]),
        });
        plutus_data.encode_fragment().unwrap()
    }

    /// Rerandomizes the `Register` using a new random scalar.
    ///
    /// This method multiplies both the generator and the public value by a new random scalar,
    /// producing a rerandomized `Register`.
    ///
    /// # Returns
    ///
    /// * A new `Register` instance with rerandomized points.
    pub fn rerandomize(self) -> Self {
        // Decode and decompress generator
        let g1: G1Affine = G1Affine::from_compressed(
            &hex::decode(self.generator)
                .expect("Failed to decode generator hex")
                .try_into()
                .expect("Invalid generator length"),
        )
        .expect("Failed to decompress generator");

        // Decode and decompress public_value
        let u: G1Affine = G1Affine::from_compressed(
            &hex::decode(self.public_value)
                .expect("Failed to decode public value hex")
                .try_into()
                .expect("Invalid public value length"),
        )
        .expect("Failed to decompress public value");

        // get a random scalar
        let d: Scalar = random_scalar();

        // Multiply points by the scalar in G1Projective
        let g1_randomized: G1Projective = G1Projective::from(g1) * d;
        let u_randomized: G1Projective = G1Projective::from(u) * d;

        // Compress points and return them as hex strings
        Self {
            generator: hex::encode(g1_randomized.to_compressed()),
            public_value: hex::encode(u_randomized.to_compressed()),
        }
    }

    /// Verifies ownership of the `Register` using a provided scalar (`sk`).
    ///
    /// This method checks if the public value in the `Register` matches the generator
    /// multiplied by the scalar.
    ///
    /// # Arguments
    ///
    /// * `sk` - The scalar to verify ownership.
    ///
    /// # Returns
    ///
    /// * `true` - If the scalar matches and proves ownership.
    /// * `false` - Otherwise.
    pub fn is_owned(&self, sk: Scalar) -> bool {
        let g1: G1Affine = G1Affine::from_compressed(
            &hex::decode(&self.generator)
                .expect("Failed to decode generator hex")
                .try_into()
                .expect("Invalid generator length"),
        )
        .expect("Failed to decompress generator");

        let g_x: G1Projective = G1Projective::from(g1) * sk;

        hex::encode(g_x.to_compressed()) == self.public_value
    }
}
