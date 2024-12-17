use seedelf_cli::hashing::blake2b_224;

#[test]
fn test_empty_string() {
    let input = "";
    let proof = blake2b_224(input);
    let outcome = "836cc68931c2e4e3e838602eca1902591d216837bafddfe6f0c8cb07";
    assert_eq!(proof, outcome);
}

#[test]
fn test_random_hash() {
    let input = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    let proof = blake2b_224(input);
    let outcome = "0c97d8d889acb1d65d23e44212b0a4e16a57fc0ebcfea8f5f965f8ba";
    assert_eq!(proof, outcome);
}