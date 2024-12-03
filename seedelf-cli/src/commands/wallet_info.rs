use crate::setup;

pub fn run() {
    println!("\nWallet Information");
    let scalar = setup::load_wallet();
    println!("\nSecret Key: {:?}", scalar);
}