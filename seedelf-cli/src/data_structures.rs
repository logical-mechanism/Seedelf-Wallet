use hex;
use hex::FromHex;
use pallas_primitives::{
    alonzo::{Constr, MaybeIndefArray, PlutusData},
    BoundedBytes, Fragment,
};


pub fn create_mint_redeemer(label: String) -> Vec<u8> {
    let label_hex = hex::encode(label);
    let lb = Vec::from_hex(&label_hex).expect("Invalid hex string");
    let d = PlutusData::BoundedBytes(BoundedBytes::from(lb));
    d.encode_fragment().unwrap()
}

pub fn create_spend_redeemer(z: String, g_r: String, pkh: String) -> Vec<u8> {
    let zb = Vec::from_hex(z).expect("Invalid hex string");
    let grb = Vec::from_hex(g_r).expect("Invalid hex string");
    let pkhb = Vec::from_hex(pkh).expect("Invalid hex string");
    let d = PlutusData::Constr(Constr {
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
