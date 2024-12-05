use seedelf_cli::data_structures::Data;
use serde_json::json;
use pallas_primitives::{alonzo::{Constr, MaybeIndefArray, PlutusData}, BoundedBytes, Fragment};
use hex::FromHex;
#[test]
fn test_simple_data() {
    // Input strings (hexadecimal)
    let generator = "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb";
    let public_value = "aafdf5aaed4bae8122d02990b67b9030c8fe352dc40c5823cce4588ed981e89ec7057e1c057a9657a934f310e8c0851a";

    // Create Data structure
    let data = Data::new(generator, public_value);

    // Expected JSON structure
    let expected_json = json!({
        "constructor": 0,
        "fields": [
            {
                "bytes": "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb"
            },
            {
                "bytes": "aafdf5aaed4bae8122d02990b67b9030c8fe352dc40c5823cce4588ed981e89ec7057e1c057a9657a934f310e8c0851a"
            }
        ]
    });

    // / Serialize the Data struct to JSON
    let actual_json = serde_json::to_value(&data).unwrap();

    // Compare the actual JSON with the expected JSON
    assert_eq!(actual_json, expected_json);
}

#[test]
fn test_plutus_data() {
    let generator = "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb";
    let public_value = "aafdf5aaed4bae8122d02990b67b9030c8fe352dc40c5823cce4588ed981e89ec7057e1c057a9657a934f310e8c0851a";
    let gb = Vec::from_hex(&generator).expect("Invalid hex string");
    let pvb = Vec::from_hex(&public_value).expect("Invalid hex string");
            
    let d = PlutusData::Constr(Constr {
        tag: 121,
        any_constructor: None,
        fields: MaybeIndefArray::Indef(vec![PlutusData::BoundedBytes(BoundedBytes::from(gb)), PlutusData::BoundedBytes(BoundedBytes::from(pvb))]),
    });
    let x = hex::encode(d.encode_fragment().unwrap());
    assert_eq!(x, "d8799f583097f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb5830aafdf5aaed4bae8122d02990b67b9030c8fe352dc40c5823cce4588ed981e89ec7057e1c057a9657a934f310e8c0851aff")
}