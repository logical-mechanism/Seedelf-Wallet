use blstrs::Scalar;
use seedelf_cli::register::Register;
use seedelf_cli::setup;

pub fn run() {
    println!("\nSeedelf Wallet Information");
    
    let scalar: Scalar = setup::load_wallet();
    println!("\nSecret Key:\n");
    println!("{}", scalar);
    
    let datum: Register = Register::create(scalar);
    println!("\nBase Register:\n");
    println!("Generator: {}", datum.generator);
    println!("Public Value: {}", datum.public_value);
}