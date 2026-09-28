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
    assert!(datum.is_valid().unwrap());
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

/// The compressed identity point: `c0` then 47 zero bytes.
fn identity() -> String {
    format!("c0{}", "00".repeat(47))
}

/// Keys to try: zero, one, a fixed one and random ones.
fn keys() -> Vec<Scalar> {
    let mut keys = vec![
        Scalar::from(0u64),
        Scalar::from(1u64),
        Scalar::from(18446744073709551606u64),
    ];
    keys.extend((0..8).map(|_| random_scalar()));
    keys
}

#[test]
fn identity_register_is_owned_by_no_key() {
    // identity · sk is the identity for every sk, and the validator lets
    // anyone spend (identity, identity): a stranger's UTxO under it is nobody's
    let datum = Register::new(identity(), identity());
    for sk in keys() {
        assert!(!datum.is_owned(sk).unwrap());
    }
}

#[test]
fn identity_public_value_is_owned_by_no_key() {
    // (G, identity) is G^0: the zero key would own it, and anyone can prove that
    let generator = Register::create(Scalar::from(1u64)).unwrap().generator;
    let datum = Register::new(generator, identity());
    for sk in keys() {
        assert!(!datum.is_owned(sk).unwrap());
    }
}

#[test]
fn identity_generator_is_owned_by_no_key() {
    for sk in keys() {
        let public_value = Register::create(sk).unwrap().public_value;
        let datum = Register::new(identity(), public_value);
        assert!(!datum.is_owned(sk).unwrap());
    }
}
