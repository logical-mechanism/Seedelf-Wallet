use crate::setup;
use seedelf_cli::register::Register;

pub fn run(network_flag: bool) {
    if network_flag {
        println!("\nRunning In Preprod Environment");
    }

    println!("\nWallet Information");
    
    let scalar = setup::load_wallet();
    println!("\nSecret Key: {}", scalar);
    
    let datum: Register = Register::create(scalar);
    println!("\nBase Register:");
    println!("Generator: {}", datum.generator);
    println!("Public Value: {}", datum.public_value);
}