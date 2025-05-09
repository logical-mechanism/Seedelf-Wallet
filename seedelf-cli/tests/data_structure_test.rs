use hex::FromHex;
use pallas_primitives::{
    BoundedBytes, Fragment, MaybeIndefArray,
    alonzo::{Constr, PlutusData},
};

#[test]
fn test_register_datum() {
    let generator = "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb";
    let public_value = "aafdf5aaed4bae8122d02990b67b9030c8fe352dc40c5823cce4588ed981e89ec7057e1c057a9657a934f310e8c0851a";
    let gb = Vec::from_hex(&generator).expect("Invalid hex string");
    let pvb = Vec::from_hex(&public_value).expect("Invalid hex string");

    let d = PlutusData::Constr(Constr {
        tag: 121,
        any_constructor: None,
        fields: MaybeIndefArray::Indef(vec![
            PlutusData::BoundedBytes(BoundedBytes::from(gb)),
            PlutusData::BoundedBytes(BoundedBytes::from(pvb)),
        ]),
    });
    let x = hex::encode(d.encode_fragment().unwrap());
    assert_eq!(
        x,
        "d8799f583097f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb5830aafdf5aaed4bae8122d02990b67b9030c8fe352dc40c5823cce4588ed981e89ec7057e1c057a9657a934f310e8c0851aff"
    )
}

#[test]
fn test_mint_redeemer() {
    let label = "testing";
    let label_hex = hex::encode(label);
    let lb = Vec::from_hex(&label_hex).expect("Invalid hex string");
    let d = PlutusData::BoundedBytes(BoundedBytes::from(lb));
    let x = hex::encode(d.encode_fragment().unwrap());
    assert_eq!(x, "4774657374696e67")
}

#[test]
fn test_empty_mint_redeemer() {
    let label = "";
    let label_hex = hex::encode(label);
    let lb = Vec::from_hex(&label_hex).expect("Invalid hex string");
    let d = PlutusData::BoundedBytes(BoundedBytes::from(lb));
    let x = hex::encode(d.encode_fragment().unwrap());
    assert_eq!(x, "40")
}
