use blstrs::Scalar;
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;

#[test]
fn default_register() {
    let sk: Scalar = Scalar::from(1u64);
    let datum: Register = Register::create(sk).unwrap();
    let generator_hex = "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb";
    assert_eq!(datum.generator, generator_hex);
    assert_eq!(datum.public_value, generator_hex);
}

#[test]
fn random_register() {
    let sk: Scalar = Scalar::from(18446744073709551606u64);
    let datum: Register = Register::create(sk).unwrap();
    let generator_hex = "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb";
    let public_value_hex = "82dcf46570656ca0d6fb143b8e7c2816b20cb1a6434ca4c8c95c624443c22c9e1d40ad0df5de088b19a4b44b685b8475";
    assert_eq!(datum.generator, generator_hex);
    assert_eq!(datum.public_value, public_value_hex);
}

#[test]
fn is_random_register_valid_test() {
    let sk: Scalar = random_scalar();
    let datum: Register = Register::create(sk).unwrap();
    println!("{datum:?}");
    assert_eq!(datum.is_valid().unwrap(), true);
}

#[test]
fn valid_is_owned() {
    let sk: Scalar = random_scalar();
    let datum: Register = Register::create(sk).unwrap().rerandomize().unwrap();
    assert!(datum.is_owned(sk).unwrap())
}

#[test]
fn invalid_is_owned() {
    let sk1: Scalar = random_scalar();
    let sk2: Scalar = random_scalar();
    let datum: Register = Register::create(sk1).unwrap().rerandomize().unwrap();
    assert!(!datum.is_owned(sk2).unwrap())
}
