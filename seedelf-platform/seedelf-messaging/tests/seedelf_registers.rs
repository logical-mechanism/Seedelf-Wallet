//! A Seedelf's own register as the recipient, read with the wallet's own
//! scalar: the reuse the owner chose for later (docs/security.md, "One key
//! for spending and reading"). Phase 1 makes no wallet change; this shows the
//! formats and the algebra already line up.

mod common;

use seedelf_crypto::register::Register as SeedelfRegister;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_messaging::{Envelope, Register, SecretKey, decrypt_message, encrypt_message};

fn point(hex_str: &str) -> [u8; 48] {
    hex::decode(hex_str).unwrap().try_into().unwrap()
}

fn from_seedelf(register: &SeedelfRegister) -> Register {
    Register::from_bytes(&point(&register.generator), &point(&register.public_value)).unwrap()
}

fn to_seedelf(register: &Register) -> SeedelfRegister {
    SeedelfRegister::new(
        hex::encode(register.generator_bytes()),
        hex::encode(register.public_value_bytes()),
    )
}

#[test]
fn a_seedelf_datum_register_is_a_recipient() {
    for _ in 0..10 {
        let sk = random_scalar();
        // A Seedelf's datum holds a re-randomized register.
        let datum = SeedelfRegister::create(sk).unwrap().rerandomize().unwrap();
        let recipient = from_seedelf(&datum);
        assert_eq!(to_seedelf(&recipient), datum);

        let envelope = encrypt_message(&recipient, b"to a Seedelf").unwrap();
        let received = Envelope::from_bytes(&envelope.to_bytes()).unwrap();

        // The wallet's own check agrees: the envelope's register is the wallet's.
        let theirs = to_seedelf(received.register());
        assert!(theirs.is_valid().unwrap());
        assert!(theirs.is_owned(sk).unwrap());

        let key = SecretKey::from_scalar(sk).unwrap();
        assert!(received.is_for(&key));
        assert_eq!(decrypt_message(&key, &received).unwrap(), b"to a Seedelf");

        // Another wallet's scalar doesn't own it.
        assert!(!theirs.is_owned(random_scalar()).unwrap());
    }
}

/// The root register a messaging key makes is the one seedelf-crypto makes
/// for the same scalar: the same generator, the same encoding.
#[test]
fn root_registers_agree_with_seedelf_crypto() {
    let sk = random_scalar();
    let ours = SecretKey::from_scalar(sk).unwrap().register();
    assert_eq!(to_seedelf(&ours), SeedelfRegister::create(sk).unwrap());
}
