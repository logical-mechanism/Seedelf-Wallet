use crate::setup;

pub fn run() {
    println!("\nBalance:");
    let scalar = setup::load_wallet();
    println!("\nSecret Key: {}", scalar);
}