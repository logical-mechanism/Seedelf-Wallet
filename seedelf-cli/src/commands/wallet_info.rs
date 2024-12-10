use crate::setup;
use seedelf_cli::schnorr;

pub fn run(network_flag: bool) {
    if network_flag {
        println!("\nRunning In Preprod Environment");
    }

    println!("\nWallet Information");
    
    let scalar = setup::load_wallet();
    println!("\nSecret Key: {}", scalar);
    
    let (generator, public_value) = schnorr::create_register(scalar);
    println!("\nBase Register:");
    println!("Generator: {}", generator);
    println!("Public Value: {}", public_value);
}