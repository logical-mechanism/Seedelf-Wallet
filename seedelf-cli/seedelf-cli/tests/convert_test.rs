use seedelf_cli::address::dapp_address;
use seedelf_cli::convert;
use seedelf_crypto::schnorr::random_scalar;

#[test]
fn create_address_from_scalar() {
    let s = random_scalar();
    println!("{:?}", s);
    let vkey = convert::secret_key_to_public_key(s);
    println!("{}", vkey);
    let addr = dapp_address(vkey, true);
    println!("{:?}", addr.to_bech32().unwrap());
}
