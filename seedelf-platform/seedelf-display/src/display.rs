use crate::text_coloring::{display_cyan, display_white, display_yellow};
use crate::version_control::{compare_versions, get_latest_version};
use blstrs::Scalar;
use colored::Colorize;
use seedelf_koios::koios::{
    UtxoResponse, contains_policy_id, credential_utxos, extract_bytes_with_logging, tip,
};

pub fn webserver_address() {
    display_cyan("Starting Web Server At:");
    display_white("http://127.0.0.1:44203/");
    display_yellow("Hit Ctrl-C To Stop Web Server");
}

pub async fn is_their_an_update() {
    match get_latest_version().await {
        Ok(tag) => {
            if !compare_versions(env!("CARGO_PKG_VERSION"), &tag) {
                println!(
                    "\n{} {}\n{}",
                    "A new version is available:".bold().bright_blue(),
                    tag.yellow(),
                    "Please update to the newest version of Seedelf"
                        .bold()
                        .bright_blue(),
                );
            }
        }
        Err(err) => {
            // Non-fatal — GitHub downtime should not block CLI usage.
            eprintln!("Warning: failed to fetch newest version: {err}");
        }
    }
}

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
            // Non-fatal — informational display only.
            eprintln!("Warning: failed to fetch blockchain tip: {err}");
        }
    }
}

pub fn preprod_text(network_flag: bool) {
    if network_flag {
        println!("{}", "\nRunning On The Pre-Production Network".cyan());
    }
}

fn extract_all_owned_seedelfs(
    sk: Scalar,
    seedelf_policy_id: &str,
    utxos: Vec<UtxoResponse>,
) -> Vec<String> {
    let mut seedelfs: Vec<String> = Vec::new();
    for utxo in utxos {
        // Extract bytes
        if let Some(inline_datum) = extract_bytes_with_logging(&utxo.inline_datum) {
            // utxo must be owned by this secret scalar; malformed Koios datum is "not owned"
            if inline_datum.is_owned(sk).unwrap_or(false) {
                // its owned but lets not count the seedelf in the balance
                if contains_policy_id(&utxo.asset_list, seedelf_policy_id)
                    && let Some(asset_name) = utxo.asset_list.as_ref().and_then(|vec| {
                        vec.iter()
                            .find(|asset| asset.policy_id == seedelf_policy_id)
                            .map(|asset| asset.asset_name.clone())
                    })
                {
                    seedelfs.push(asset_name);
                }
            }
        }
    }
    seedelfs
}

pub async fn all_seedelfs(
    sk: Scalar,
    network_flag: bool,
    wallet_contract_hash: &str,
    seedelf_policy_id: &str,
) -> Vec<String> {
    match credential_utxos(wallet_contract_hash, network_flag).await {
        Ok(utxos) => extract_all_owned_seedelfs(sk, seedelf_policy_id, utxos),
        Err(_) => Vec::new(),
    }
}

/// Print each seedelf name in bright yellow.
pub fn print_seedelfs(items: Vec<String>) {
    for item in items {
        println!("Seedelf: {}", item.white());
        seedelf_label(item)
    }
}

fn seedelf_label(seedelf: String) {
    // Seedelf asset names are 32 bytes (64 hex chars) with the label embedded at
    // offset 8..38. Skip silently if Koios hands us a shorter or non-hex name.
    if seedelf.len() < 38 {
        return;
    }
    let Ok(label) = hex_to_ascii(&seedelf[8..38]) else {
        return;
    };
    if !label.starts_with('.') {
        let cleaned: String = label.chars().filter(|&c| c != '.').collect();
        println!("Label: {}", cleaned.bright_yellow())
    }
}

pub fn hex_to_ascii(hex: &str) -> Result<String, &'static str> {
    // Ensure the length of the hex string is even
    if !hex.len().is_multiple_of(2) {
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
