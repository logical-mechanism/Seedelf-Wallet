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

/// Compressed encodings by a small x: a point on the curve, or none.
fn small_x() -> impl Iterator<Item = ([u8; 48], Option<blstrs::G1Affine>)> {
    (1u8..=u8::MAX).map(|x| {
        let mut bytes = [0u8; 48];
        bytes[0] = 0x80;
        bytes[47] = x;
        (
            bytes,
            blstrs::G1Affine::from_compressed_unchecked(&bytes).into_option(),
        )
    })
}

/// A compressed point on the curve but outside the prime-order subgroup:
/// `from_compressed` refuses it, as the wallet contract does.
fn torsion_point() -> String {
    small_x()
        .find_map(|(bytes, point)| {
            (!bool::from(point?.is_torsion_free())).then(|| hex::encode(bytes))
        })
        .expect("a small x off the subgroup")
}

/// A compressed encoding of no point: an x the curve has no y for.
fn off_curve_point() -> String {
    small_x()
        .find_map(|(bytes, point)| point.is_none().then(|| hex::encode(bytes)))
        .expect("a small x off the curve")
}

/// Re-randomizing a register outside the prime-order subgroup would give
/// another one, and a payment under it is locked for good: the validator
/// refuses such points (chunk 51, t1a#2). rerandomize refuses it instead,
/// whichever point is off the subgroup, and an encoding off the curve too.
#[test]
fn rerandomize_refuses_a_register_outside_the_prime_order_subgroup() {
    let good = Register::create(random_scalar())
        .unwrap()
        .rerandomize()
        .unwrap();
    for bad in [torsion_point(), off_curve_point()] {
        for datum in [
            Register::new(bad.clone(), good.public_value.clone()),
            Register::new(good.generator.clone(), bad.clone()),
        ] {
            assert!(datum.clone().rerandomize().is_err(), "{datum:?}");
        }
    }
    assert!(good.rerandomize().is_ok());
}

/// A point that doesn't decompress is named for what it is, the generator or
/// the public value: these words reach the web wallet through WebAssembly
/// (chunk 51, r1#3's sibling).
#[test]
fn a_point_that_doesnt_decompress_is_named() {
    let good = Register::create(random_scalar()).unwrap().generator;
    // Both flag bits set, and more: no point's encoding.
    let bad = "ff".repeat(48);
    for (datum, point) in [
        (Register::new(bad.clone(), good.clone()), "generator"),
        (Register::new(good.clone(), bad.clone()), "public value"),
    ] {
        let said = [
            datum.clone().rerandomize().unwrap_err().to_string(),
            datum.is_valid().unwrap_err().to_string(),
        ];
        assert_eq!(
            said,
            [
                format!("Failed to decompress {point}"),
                format!("Failed to decompress {point}")
            ]
        );
    }
}
