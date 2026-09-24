use seedelf_crypto::register::Register;
use seedelf_wasm::api;

// Same vector as seedelf-crypto's `random_register` test: sk = 18446744073709551606.
const VECTOR_SK: &str = "000000000000000000000000000000000000000000000000fffffffffffffff6";
const G1: &str = "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb";
const VECTOR_PUBLIC_VALUE: &str = "82dcf46570656ca0d6fb143b8e7c2816b20cb1a6434ca4c8c95c624443c22c9e1d40ad0df5de088b19a4b44b685b8475";
// The BLS12-381 scalar field order r, big-endian.
const R: &str = "73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001";

#[test]
fn scalar_from_hex_matches_known_vector() {
    let sk = api::scalar_from_hex(VECTOR_SK).unwrap();
    let register = Register::create(sk).unwrap();
    assert_eq!(register.generator, G1);
    assert_eq!(register.public_value, VECTOR_PUBLIC_VALUE);
}

#[test]
fn scalar_from_hex_rejects_bad_input() {
    assert!(api::scalar_from_hex(&"00".repeat(32)).is_err(), "zero");
    assert!(api::scalar_from_hex(R).is_err(), "equal to r");
    assert!(api::scalar_from_hex(&"ff".repeat(32)).is_err(), "above r");
    assert!(api::scalar_from_hex(&"01".repeat(31)).is_err(), "31 bytes");
    assert!(api::scalar_from_hex("zz").is_err(), "not hex");
}

#[test]
fn rerandomized_register_stays_owned_and_proves() {
    let sk = api::scalar_from_hex(VECTOR_SK).unwrap();
    let register = api::rerandomize(&Register::create(sk).unwrap()).unwrap();
    assert_ne!(register.generator, G1);
    assert!(register.is_valid().unwrap());
    assert!(register.is_owned(sk).unwrap());

    let vkh = "ab".repeat(28);
    let (z, g_r) =
        seedelf_crypto::schnorr::create_proof(register.clone(), sk, vkh.clone()).unwrap();
    assert!(api::verify_proof(&register, &z, &g_r, &vkh).unwrap());
    assert!(!api::verify_proof(&register, &z, &g_r, &"cd".repeat(28)).unwrap());
}

#[test]
fn with_phrase_rebuilds_the_vault_phrase() {
    let entropy = [0u8; 32];
    let words = api::with_phrase(&entropy, |p| Ok(p.split(' ').count())).unwrap();
    assert_eq!(words, 24);
    assert!(
        api::with_phrase(&[0u8; 24], |_| Ok(())).is_err(),
        "18 words"
    );
    let failed: anyhow::Result<()> = api::with_phrase(&entropy, |_| anyhow::bail!("inner"));
    assert_eq!(failed.unwrap_err().to_string(), "inner");
}
