use crate::setup;

pub fn run() {
    println!("\nSeedelf:");
    let scalar = setup::load_wallet();
    println!("\nSecret Key: {}", scalar);
}