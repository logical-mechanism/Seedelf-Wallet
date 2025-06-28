use seedelf_crypto::convert;
use seedelf_crypto::schnorr::random_scalar;

#[test]
fn create_address_from_scalar() {
    let s = random_scalar();
    println!("{:?}", s);
    let vkey = convert::secret_key_to_public_key(s);
    println!("{}", vkey);
}
