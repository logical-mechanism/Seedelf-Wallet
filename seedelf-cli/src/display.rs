use blstrs::Scalar;
use crate::constants::{SEEDELF_POLICY_ID, WALLET_CONTRACT_HASH};
use crate::koios::{tip, credential_utxos, extract_bytes_with_logging, contains_policy_id};

pub async fn block_number_and_time(network_flag: bool) {
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

}

pub fn preprod_text(network_flag: bool) {
    if network_flag {
        println!("\nRunning In Preprod Environment");
    }
}

pub async fn all_seedelfs(sk: Scalar, network_flag: bool) {
    let mut seedelfs: Vec<String> = Vec::new();

    match credential_utxos(WALLET_CONTRACT_HASH, network_flag).await {
        Ok(utxos) => {
            for utxo in utxos {
                // Extract bytes
                if let Some(inline_datum) =
                    extract_bytes_with_logging(&utxo.inline_datum)
                {
                    // utxo must be owned by this secret scaler
                    if inline_datum.is_owned( sk) {
                        // its owned but lets not count the seedelf in the balance
                        if contains_policy_id(&utxo.asset_list, SEEDELF_POLICY_ID) {
                            let asset_name: &String = utxo
                                .asset_list
                                .as_ref()
                                .and_then(|vec| {
                                    vec.iter()
                                        .find(|asset| asset.policy_id == SEEDELF_POLICY_ID)
                                        .map(|asset| &asset.asset_name)
                                })
                                .unwrap();
                            seedelfs.push(asset_name.to_string());
                        }
                    }
                }
            }
        }
        Err(err) => {
            eprintln!("Failed to fetch UTxOs: {}\nWait a few moments and try again.", err);
        }
    }
    if !seedelfs.is_empty() {
        println!("\nCurrent Seedelf:\n");
        for seedelf in seedelfs {
            println!("Seedelf: {}", seedelf);
    
        }

    }
}