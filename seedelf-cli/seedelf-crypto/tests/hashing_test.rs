use seedelf_crypto::hashing::{blake2b_224, blake2b_256, sha3_256};

#[test]
fn test_empty_string_blake2b_224() {
    let input = "";
    let proof = blake2b_224(input).unwrap();
    let outcome = "836cc68931c2e4e3e838602eca1902591d216837bafddfe6f0c8cb07";
    assert_eq!(proof, outcome);
}

#[test]
fn test_random_hash_blake2b_224() {
    let input = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    let proof = blake2b_224(input).unwrap();
    let outcome = "0c97d8d889acb1d65d23e44212b0a4e16a57fc0ebcfea8f5f965f8ba";
    assert_eq!(proof, outcome);
}

#[test]
fn test_empty_string_blake2b_256() {
    let input = "";
    let proof = blake2b_256(input).unwrap();
    let outcome = "0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8";
    assert_eq!(proof, outcome);
}

#[test]
fn test_random_hash_blake2b_256() {
    let input = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    let proof = blake2b_256(input).unwrap();
    let outcome = "667f1e9b75c8eac1cccf77a2f82526a478b01ec0f26dd938b5b5b4ad0d856368";
    assert_eq!(proof, outcome);
}

#[test]
fn test_empty_string_sha3_256() {
    let input = "";
    let proof = sha3_256(input).unwrap();
    let outcome = "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a";
    assert_eq!(proof, outcome);
}

#[test]
fn test_string_sha3_256() {
    let input = "29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c64d494e";
    let proof = sha3_256(input).unwrap();
    let outcome = "f42353fee9441b7e225b5fd147fcffb6cc4245124c888640c0c6a88bba8fbec5";
    assert_eq!(proof, outcome);
}

#[test]
fn test_complex_string_sha3_256() {
    // this is a good test for minswap
    let asset_a_policy_id: &str = "";
    let asset_a_asset_name: &str = "";
    let asset_b_policy_id: &str = "29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6";
    let asset_b_asset_name: &str = "4d494e";
    let a: String = sha3_256(&format!("{}{}", asset_a_policy_id, asset_a_asset_name)).unwrap();
    let b: String = sha3_256(&format!("{}{}", asset_b_policy_id, asset_b_asset_name)).unwrap();
    let proof: String = sha3_256(&format!("{}{}", a, b)).unwrap();
    let outcome: &str = "82e2b1fd27a7712a1a9cf750dfbea1a5778611b20e06dd6a611df7a643f8cb75";
    assert_eq!(proof, outcome);
}
