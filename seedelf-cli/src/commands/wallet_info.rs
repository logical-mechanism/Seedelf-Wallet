use crate::setup;
use seedelf_cli::schnorr;

pub fn run(network_flag: bool) {
    println!("\nWallet Information");
    let scalar = setup::load_wallet();
    println!("\nSecret Key: {}", scalar);
    let (generator, public_value) = schnorr::create_register(scalar);
    println!("\nBase Register");
    println!("Generator: {}", generator);
    println!("Public Value: {}", public_value);
    println!("\nTransfer Address");
    if network_flag {
        println!("Running in network_flag environment");
    } else {
        println!("Running in mainnet environment");
    }
}