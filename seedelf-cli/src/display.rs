use crate::constants::{get_config, Config};
use crate::koios::{contains_policy_id, credential_utxos, extract_bytes_with_logging, tip};
use blstrs::Scalar;
use colored::Colorize;

pub async fn block_number_and_time(network_flag: bool) {
    match tip(network_flag).await {
        Ok(tips) => {
            if let Some(tip) = tips.first() {
                println!(
                    "\n{} {}\n{} {}",
                    "Block Number:".bold().bright_blue(),
                    tip.block_no.to_string().yellow(),
                    "Time:".bold().bright_blue(),
                    tip.block_time.to_string().yellow()
                );
            }
        }
        Err(err) => {
            eprintln!(
                "Failed to fetch blockchain tip: {}\nWait a few moments and try again.",
                err
            );
        }
    }
}

pub fn preprod_text(network_flag: bool) {
    if network_flag {
        println!("{}", "\nRunning On The Pre-Production Network".cyan());
    }
}

pub async fn all_seedelfs(sk: Scalar, network_flag: bool, variant: u64) {
    let mut seedelfs: Vec<String> = Vec::new();

    let config: Config = get_config(variant, network_flag).unwrap_or_else(|| {
        eprintln!("Error: Invalid Variant");
        std::process::exit(1);
    });

    match credential_utxos(config.contract.wallet_contract_hash, network_flag).await {
        Ok(utxos) => {
            for utxo in utxos {
                // Extract bytes
                if let Some(inline_datum) = extract_bytes_with_logging(&utxo.inline_datum) {
                    // utxo must be owned by this secret scaler
                    if inline_datum.is_owned(sk) {
                        // its owned but lets not count the seedelf in the balance
                        if contains_policy_id(&utxo.asset_list, config.contract.seedelf_policy_id) {
                            let asset_name: &String = utxo
                                .asset_list
                                .as_ref()
                                .and_then(|vec| {
                                    vec.iter()
                                        .find(|asset| {
                                            asset.policy_id == config.contract.seedelf_policy_id
                                        })
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
            eprintln!(
                "Failed to fetch UTxOs: {}\nWait a few moments and try again.",
                err
            );
        }
    }
    if !seedelfs.is_empty() {
        println!("{}", "\nCurrent Seedelf:\n".bright_green());
        for seedelf in seedelfs {
            println!("\nSeedelf: {}", seedelf.white());
            seedelf_label(seedelf);
        }
    }
}

pub fn seedelf_label(seedelf: String) {
    let substring: String = seedelf[8..38].to_string();
    let label: String = hex_to_ascii(&substring).unwrap();
    if !label.starts_with('.') {
        let cleaned: String = label.chars().filter(|&c| c != '.').collect();
        println!("Label: {}", cleaned.bright_yellow())
    }
}

pub fn hex_to_ascii(hex: &str) -> Result<String, &'static str> {
    // Ensure the length of the hex string is even
    if hex.len() % 2 != 0 {
        return Err("Hex string must have an even length");
    }

    let ascii = (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Invalid hex string")?
        .into_iter()
        .map(|b| {
            if b.is_ascii_graphic() || b.is_ascii_whitespace() {
                char::from(b)
            } else {
                '.'
            }
        })
        .map(|c| {
            if c == '\n' || c == '\r' || c == '\t' {
                '.'
            } else {
                c
            }
        }) // Replace control characters
        .collect::<String>();

    Ok(ascii)
}
