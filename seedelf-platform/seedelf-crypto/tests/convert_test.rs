use blstrs::Scalar;
use seedelf_crypto::convert;
use seedelf_crypto::schnorr::random_scalar;

#[test]
fn create_address_from_scalar() {
    let s = random_scalar();
    println!("{s:?}");
    let vkey = convert::secret_key_to_public_key(s);
    println!("{vkey}");
}

/// Lock the BLS-scalar → ed25519-pkh derivation in `convert::scalar_to_secret_key`.
/// See the doc comment there for the (intentional, but unusual) chain. If this
/// test ever changes, every existing seedelf wallet stops working — refuse the
/// change and investigate.
#[test]
fn pinned_scalar_to_pkh_two() {
    let s = Scalar::from(2u64);
    let pkh = convert::secret_key_to_public_key(s);
    assert_eq!(
        pkh, "ce0c199f6b448920d129d590a8bea04f37f5e7545175bf02a3ac588a",
        "convert::scalar_to_secret_key derivation drifted"
    );
}
