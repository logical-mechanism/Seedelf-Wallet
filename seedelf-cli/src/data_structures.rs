use hex;
use hex::FromHex;
use pallas_primitives::{
    BoundedBytes, Fragment,
    alonzo::{Constr, MaybeIndefArray, PlutusData},
};

/// Creates a mint redeemer for a Plutus script.
///
/// This function encodes a given string label as a hex string, converts it to bytes,
/// and wraps it into `PlutusData` of type `BoundedBytes`. The result is serialized
/// as a fragment.
///
/// # Arguments
///
/// * `label` - A string that represents the label to encode.
///
/// # Returns
///
/// * `Vec<u8>` - The encoded PlutusData fragment as a byte vector.
///
/// # Panics
///
/// * If the label cannot be converted into a valid hex string.
pub fn create_mint_redeemer(label: String) -> Vec<u8> {
    let mut label_hex: String = hex::encode(label);
    label_hex.truncate(30);
    let lb: Vec<u8> = Vec::from_hex(&label_hex).expect("Invalid hex string");
    let d: PlutusData = PlutusData::BoundedBytes(BoundedBytes::from(lb));
    d.encode_fragment().unwrap()
}

/// Creates a spend redeemer for a Plutus script.
///
/// This function takes three hex-encoded strings (`z`, `g_r`, `pkh`), converts them to byte vectors,
/// and constructs a `PlutusData` structure with a custom `Constr` type (tag `121`).
/// The resulting data is serialized as a fragment.
///
/// # Arguments
///
/// * `z` - A hex-encoded string representing the first field.
/// * `g_r` - A hex-encoded string representing the second field.
/// * `pkh` - A hex-encoded string representing the third field.
///
/// # Returns
///
/// * `Vec<u8>` - The encoded PlutusData fragment as a byte vector.
///
/// # Panics
///
/// * If any input string cannot be converted into a valid hex string.
pub fn create_spend_redeemer(z: String, g_r: String, pkh: String) -> Vec<u8> {
    let zb: Vec<u8> = Vec::from_hex(z).expect("Invalid hex string");
    let grb: Vec<u8> = Vec::from_hex(g_r).expect("Invalid hex string");
    let pkhb: Vec<u8> = Vec::from_hex(pkh).expect("Invalid hex string");
    let d: PlutusData = PlutusData::Constr(Constr {
        tag: 121,
        any_constructor: None,
        fields: MaybeIndefArray::Indef(vec![
            PlutusData::BoundedBytes(BoundedBytes::from(zb)),
            PlutusData::BoundedBytes(BoundedBytes::from(grb)),
            PlutusData::BoundedBytes(BoundedBytes::from(pkhb)),
        ]),
    });
    d.encode_fragment().unwrap()
}
