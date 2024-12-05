use serde::{Deserialize, Serialize};
use hex;
use hex::FromHex;
use pallas_primitives::{alonzo::{Constr, MaybeIndefArray, PlutusData}, BoundedBytes, Fragment};

#[derive(Serialize, Deserialize, Debug)]
pub struct Data {
    constructor: u64,
    fields: Vec<Field>,
}

#[derive(Serialize, Deserialize, Debug)]
struct Field {
    bytes: String,
}

impl Data {
    /// Constructs a Data object from generator and public_value strings
    pub fn new(generator: &str, public_value: &str) -> Self {
        // Validate inputs are valid hex strings and return the structure
        Data {
            constructor: 0,
            fields: vec![
                Field {
                    bytes: hex::encode(
                        hex::decode(generator).expect("Invalid hex string for generator"),
                    ),
                },
                Field {
                    bytes: hex::encode(
                        hex::decode(public_value).expect("Invalid hex string for public_value"),
                    ),
                },
            ],
        }
    }

    pub fn to_cbor(&self) -> Vec<u8> {
        let gb = Vec::from_hex(&self.fields.get(0).unwrap().bytes).expect("Invalid hex string");
        let pvb = Vec::from_hex(&self.fields.get(1).unwrap().bytes).expect("Invalid hex string");
        let d = PlutusData::Constr(Constr {
            tag: 121,
            any_constructor: None,
            fields: MaybeIndefArray::Indef(vec![PlutusData::BoundedBytes(BoundedBytes::from(gb)), PlutusData::BoundedBytes(BoundedBytes::from(pvb))]),
        });
        d.encode_fragment().unwrap()
    }

}