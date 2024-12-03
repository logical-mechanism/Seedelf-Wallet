use crate::setup;
use reqwest::Error;
use seedelf_cli::koios::tip;
pub async fn run(network_flag: bool) -> Result<(), Error> {
    if network_flag {
        println!("\nRunning In Preprod Environment");
    }

    // Call the asynchronous function
    match tip(network_flag).await {
        Ok(tips) => {
            if let Some(tip) = tips.get(0) {
                println!("\nBlock Number: {}", tip.block_no);
                println!("Block Time: {}", tip.block_time);
                println!("Absolute Slot: {}", tip.abs_slot);
            }
        }
        Err(err) => {
            eprintln!("Failed to fetch blockchain tip: {}", err);
        }
    }

    println!("\nBalance: TODO");
    let scalar = setup::load_wallet();
    println!("\nSecret Key: {}", scalar);

    Ok(())
}