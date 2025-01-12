use seedelf_cli::convert;
use seedelf_cli::schnorr::random_scalar;
use seedelf_cli::address::dapp_address;

#[test]
fn create_address_from_scalar() {
    let s = random_scalar();
    println!("{:?}", s);
    let vkey = convert::secret_key_to_public_key(s);
    println!("{}", vkey);
    let addr = dapp_address(vkey, true);
    println!("{:?}", addr.to_bech32().unwrap());
}