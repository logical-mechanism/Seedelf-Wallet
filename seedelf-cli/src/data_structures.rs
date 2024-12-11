use pallas_primitives::{
    alonzo::{Constr, MaybeIndefArray, PlutusData},
    BoundedBytes, Fragment,
};
use hex;
use hex::FromHex;


pub fn create_mint_redeemer(label: String) -> Vec<u8> {
    let label_hex: String = hex::encode(label);
    let lb: Vec<u8> = Vec::from_hex(&label_hex).expect("Invalid hex string");
    let d: PlutusData = PlutusData::BoundedBytes(BoundedBytes::from(lb));
    d.encode_fragment().unwrap()
}
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
