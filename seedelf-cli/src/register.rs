use blstrs::{G1Affine, G1Projective, Scalar};
use hex;
use hex::FromHex;
use pallas_primitives::{
    alonzo::{Constr, MaybeIndefArray, PlutusData},
    BoundedBytes, Fragment,
};
use crate::schnorr::random_scalar;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, PartialEq, Eq, Debug, Hash, Clone)]
pub struct Register {
    pub generator: String,
    pub public_value: String,
}

impl Default for Register {
    fn default() -> Self {
        Self {
            generator: String::new(),
            public_value: String::new(),
        }
    }
}

impl Register {
    pub fn new(generator: String, public_value: String) -> Self {
        Self { generator: generator, public_value: public_value }
    }

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
        Self { generator: hex::encode(g1_generator.to_compressed()), public_value: hex::encode(public_value.to_compressed()) }
    }

    pub fn to_vec(&self) -> Vec<u8> {
        // convert the strings into vectors
        let generator_vector: Vec<u8> = Vec::from_hex(&self.generator).expect("Invalid hex string");
        let public_value_vector: Vec<u8> = Vec::from_hex(&self.public_value).expect("Invalid hex string");
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
        Self { generator: hex::encode(g1_randomized.to_compressed()), public_value: hex::encode(u_randomized.to_compressed()) }
    }

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