use crate::setup;

pub fn run(network_flag: bool) {
    println!("\nSeedelf:");
    let scalar = setup::load_wallet();
    println!("\nSecret Key: {}", scalar);
    if network_flag {
        println!("Running in network_flag environment");
    } else {
        println!("Running in mainnet environment");
    }
}