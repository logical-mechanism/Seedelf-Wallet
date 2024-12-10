use blstrs::Scalar;
use seedelf_cli::schnorr::{fiat_shamir_heuristic, prove, create_register, create_proof, random_scalar, rerandomize, is_owned};
use seedelf_cli::register::Register;

#[test]
fn test_empty_string() {
    let proof = fiat_shamir_heuristic("".to_string(),"".to_string(),"".to_string(),"".to_string());
    let outcome = "836cc68931c2e4e3e838602eca1902591d216837bafddfe6f0c8cb07";
    assert_eq!(proof, outcome);
}

#[test]
fn test_real_example() {
    let proof  = fiat_shamir_heuristic(
          "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb".to_string(),
          "81b223cea171a87feba9b7749a2df7601c5a75ae01155fadc124a2ac49099a514cf1e7d9cdc769dceab14a95bd6cb0bd".to_string(),
          "a09d99e02f7200526dc55ef722cc171e7aa14fc732614c02ac58d59d7026a7eb18d8798f6928ea2b513f3a4feb0c94d1".to_string(),
          "acab".to_string(),
        );
    let outcome = "1b556f7bb6a26d00a7c79468794858ba6aa0e41a2c3af0754ec4a11d";
    assert_eq!(proof, outcome);
}

#[test]
fn valid_schnorr_proof() {
    let generator = "97F1D3A73197D7942695638C4FA9AC0FC3688C4F9774B905A14E3A3F171BAC586C55E83FF97A1AEFFB3AF00ADB22C6BB";
    let public_value = "8AE45D4463406206D4DDD77212FA559FDD26B776B35E238E1ECB2E35ED890797F0CE64C757F70C90E567E81F802352AC";
    let z_b = "6ABFE8229317598960FD20B5A88510EDC4CD03D56D085F82665A01584CF01161";
    let g_r_b = "B8E67784C43E083B7ABCBA10D32066720865105FEFC1F669EF76613E2E4D8BB0D883DA2498C4833B970B949A2C688F81";
    let bound = "ACAB";
    assert!(prove(generator, public_value, z_b, g_r_b, bound))
}

#[test]
fn valid_randomized_schnorr_proof() {
    let generator = "8EC0018F7CDDAFFCF3F2F3E2DFE75C3EE3E4F6FB87D62037416EC3037F20323C6823D289D4F31662969D18F373F95D51";
    let public_value = "A6AE4DA5029996FF5F9B825D8A1A3E6295ED914389E7E7A40EECE2C111984C3EFBA34F8DC97B2FBFEBAC48AA5829E5AC";
    let z_b = "30156C22A3978DDE6462D8DD7C6EB10B125DCCCD44ECD011E9EC3C08C4E8A546";
    let g_r_b = "94F0F8C17140E92D7F4635F2B8A7FF6038A041CD1B04974CAFA6B668BFA0E0C372B540F4684E69F70AC974028BDA5486";
    let bound = "ACABFACE";
    assert!(prove(generator, public_value, z_b, g_r_b, bound))
}

#[test]
fn default_register() {
    let sk: Scalar = Scalar::from(1u64);
    let (generator, public_value) = create_register(sk);
    let generator_hex = "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb";
    assert_eq!(generator, generator_hex);
    assert_eq!(public_value, generator_hex);
}

#[test]
fn random_register() {
    let sk: Scalar = Scalar::from(18446744073709551606u64);
    let (generator, public_value) = create_register(sk);
    let generator_hex = "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb";
    let public_value_hex = "82dcf46570656ca0d6fb143b8e7c2816b20cb1a6434ca4c8c95c624443c22c9e1d40ad0df5de088b19a4b44b685b8475";
    assert_eq!(generator, generator_hex);
    assert_eq!(public_value, public_value_hex);
}

#[test]
fn create_proof_and_test_it() {
    let sk: Scalar = Scalar::from(18446744073709551606u64);
    let datum: Register = Register::create(sk);
    let generator_hex = "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb";
    let public_value_hex = "82dcf46570656ca0d6fb143b8e7c2816b20cb1a6434ca4c8c95c624443c22c9e1d40ad0df5de088b19a4b44b685b8475";
    assert_eq!(datum.generator, generator_hex);
    assert_eq!(datum.public_value, public_value_hex);

    let bound = "acab";
    let (z_b, g_r_b) = create_proof(datum.clone(), sk, bound.to_string());
    assert!(prove(&datum.generator, &datum.public_value, &z_b, &g_r_b, bound))
}

#[test]
fn create_random_proof_and_test_it() {
    let sk: Scalar = random_scalar();
    let datum: Register = Register::create(sk);
    let bound = "acab";
    let (z_b, g_r_b) = create_proof(datum.clone(), sk, bound.to_string());
    assert!(prove(&datum.generator, &datum.public_value, &z_b, &g_r_b, bound))
}

#[test]
fn create_random_proof_rerandomize_it_and_test_it() {
    let sk: Scalar = random_scalar();
    let datum: Register = Register::create(sk).rerandomize();
    let bound = "acab";
    let (z_b, g_r_b) = create_proof(datum.clone(), sk, bound.to_string());
    assert!(prove(&datum.generator, &datum.public_value, &z_b, &g_r_b, bound))
}

#[test]
fn valid_is_owned() {
    let sk: Scalar = random_scalar();
    let (generator, public_value) = create_register(sk);
    let (rgenerator, rpublic_value) = rerandomize(&generator, &public_value);
    assert!(is_owned(&rgenerator, &rpublic_value, sk))
}

#[test]
fn invalid_is_owned() {
    let sk1: Scalar = random_scalar();
    let sk2: Scalar = random_scalar();
    let (generator, public_value) = create_register(sk1);
    let (rgenerator, rpublic_value) = rerandomize(&generator, &public_value);
    assert!(!is_owned(&rgenerator, &rpublic_value, sk2))
}