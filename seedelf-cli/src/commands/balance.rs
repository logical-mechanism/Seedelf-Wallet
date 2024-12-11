use crate::setup;
use reqwest::Error;
use seedelf_cli::constants::{WALLET_CONTRACT_HASH, SEEDELF_POLICY_ID};
use seedelf_cli::koios::{credential_utxos, extract_bytes_with_logging, tip, contains_policy_id};
use blstrs::Scalar;

pub async fn run(network_flag: bool) -> Result<(), Error> {
    if network_flag {
        println!("\nRunning In Preprod Environment");
    }

    match tip(network_flag).await {
        Ok(tips) => {
            if let Some(tip) = tips.get(0) {
                println!("\nBlock Number: {} @ Time: {}", tip.block_no, tip.block_time);
            }
        }
        Err(err) => {
            eprintln!("Failed to fetch blockchain tip: {}\nWait a few moments and try again.", err);
        }
    }

    let scalar: Scalar = setup::load_wallet();
    let mut total_lovelace: u64 = 0;
    let mut total_utxos: u64 = 0;

    match credential_utxos(WALLET_CONTRACT_HASH, network_flag).await {
        Ok(utxos) => {
            for utxo in utxos {
                // Extract bytes
                if let Some(inline_datum) = extract_bytes_with_logging(&utxo.inline_datum) {
                    // utxo must be owned by this secret scaler
                    if inline_datum.is_owned(scalar) {
                        // its owned but lets not count the seedelf in the balance
                        if !contains_policy_id(&utxo.asset_list, SEEDELF_POLICY_ID) {
                            // just count the lovelace for now
                            let lovelace: u64 = utxo.value.parse::<u64>().expect("Invalid Lovelace");
                            total_lovelace += lovelace;
                            total_utxos += 1;
                        }
                    }
                }
            }
        }
        Err(err) => {
            eprintln!("Failed to fetch UTxOs: {}\nWait a few moments and try again.", err);
        }
    }

    println!("\nBalance: {:.6} ₳", total_lovelace as f64 / 1_000_000.0);
    println!("{} UTxOs", total_utxos);

    Ok(())
}
