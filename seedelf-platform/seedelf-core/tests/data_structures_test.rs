use seedelf_core::data_structures::{create_mint_redeemer, create_spend_redeemer};

// These CBOR strings are the on-chain wire format the contract sees. Locking
// them in stops a subtle refactor (e.g. swapping indefinite for definite
// arrays, changing the Constr tag) from silently making every spend or mint
// fail validation.

#[test]
fn mint_redeemer_encodes_label_as_bounded_bytes() {
    let cbor = hex::encode(create_mint_redeemer("testing".to_string()).unwrap());
    // 47 = bytes(7); 74 65 73 74 69 6e 67 = "testing"
    assert_eq!(cbor, "4774657374696e67");
}

#[test]
fn mint_redeemer_empty_label_is_empty_bytestring() {
    let cbor = hex::encode(create_mint_redeemer("".to_string()).unwrap());
    // 40 = bytes(0)
    assert_eq!(cbor, "40");
}

#[test]
fn mint_redeemer_truncates_label_at_15_bytes() {
    // 20-byte label hex-encodes to 40 chars; the function truncates label_hex
    // at 30, leaving 15 bytes encoded into the redeemer.
    let label = "abcdefghijklmnopqrst";
    let cbor = hex::encode(create_mint_redeemer(label.to_string()).unwrap());
    // 4f = bytes(15); then first 15 bytes of "abcdefghijklmnopqrst"
    assert_eq!(cbor, "4f6162636465666768696a6b6c6d6e6f");
}

#[test]
fn spend_redeemer_wraps_three_bytestrings_in_constr_121() {
    let z = "aa".repeat(32);
    let g_r = "bb".repeat(48);
    let pkh = "cc".repeat(28);
    let cbor = hex::encode(create_spend_redeemer(z, g_r, pkh).unwrap());
    // d8 79 = tag 121; 9f = indef-array; then three byte-strings; ff = end
    assert!(cbor.starts_with("d8799f"));
    assert!(cbor.ends_with("ff"));
    // bytes(32) header for z
    assert!(cbor.contains(&format!("5820{}", "aa".repeat(32))));
    // bytes(48) header for g_r
    assert!(cbor.contains(&format!("5830{}", "bb".repeat(48))));
    // bytes(28) header for pkh
    assert!(cbor.contains(&format!("581c{}", "cc".repeat(28))));
}

#[test]
fn spend_redeemer_rejects_non_hex_input() {
    let bad = "zz".to_string();
    assert!(create_spend_redeemer(bad.clone(), "aa".into(), "bb".into()).is_err());
    assert!(create_spend_redeemer("aa".into(), bad.clone(), "bb".into()).is_err());
    assert!(create_spend_redeemer("aa".into(), "bb".into(), bad).is_err());
}
