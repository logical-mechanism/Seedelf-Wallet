use crate::setup;
use reqwest::Error;
use seedelf_cli::constants::{SEEDELF_POLICY_ID, WALLET_CONTRACT_HASH};
use seedelf_cli::koios::{contains_policy_id, credential_utxos, extract_bytes_with_logging, tip};

pub async fn run(network_flag: bool) -> Result<(), Error> {
    if network_flag {
        println!("\nRunning In Preprod Environment");
    }

    // Call the asynchronous function
    match tip(network_flag).await {
        Ok(tips) => {
            if let Some(tip) = tips.get(0) {
                println!(
                    "\nBlock Number: {} @ Time: {}",
                    tip.block_no, tip.block_time
                );
            }
        }
        Err(err) => {
            eprintln!("Failed to fetch blockchain tip: {}\nWait a few moments and try again.", err);
        }
    }

    let scalar = setup::load_wallet();
    println!("\nCurrent Seedelf:\n");

    match credential_utxos(WALLET_CONTRACT_HASH, network_flag).await {
        Ok(utxos) => {
            for utxo in utxos {
                // Extract bytes
                if let Some(inline_datum) =
                    extract_bytes_with_logging(&utxo.inline_datum)
                {
                    // utxo must be owned by this secret scaler
                    if inline_datum.is_owned( scalar) {
                        // its owned but lets not count the seedelf in the balance
                        if contains_policy_id(&utxo.asset_list, SEEDELF_POLICY_ID) {
                            let asset_name = utxo
                                .asset_list
                                .as_ref()
                                .and_then(|vec| {
                                    vec.iter()
                                        .find(|asset| asset.policy_id == SEEDELF_POLICY_ID)
                                        .map(|asset| &asset.asset_name)
                                })
                                .unwrap();
                            let lovelace: u64 =
                                utxo.value.parse::<u64>().expect("Invalid Lovelace");
                            println!("Seedelf: {:?} With {:?} Lovelace", asset_name, lovelace);
                        }
                    }
                }
            }
        }
        Err(err) => {
            eprintln!("Failed to fetch UTxOs: {}\nWait a few moments and try again.", err);
        }
    }

    Ok(())
}
