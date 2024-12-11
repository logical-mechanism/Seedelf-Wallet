use crate::setup;
use seedelf_cli::register::Register;

pub fn run() {
    println!("\nSeedelf Wallet Information");
    
    let scalar = setup::load_wallet();
    println!("\nSecret Key:\n");
    println!("{}", scalar);
    
    let datum: Register = Register::create(scalar);
    println!("\nBase Register:\n");
    println!("Generator: {}", datum.generator);
    println!("Public Value: {}", datum.public_value);
}