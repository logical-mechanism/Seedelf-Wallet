use crate::commands::dapp::newm::constants::{
    MAINNET_POINTER_POLICY_ID, PREPROD_POINTER_POLICY_ID, USE_USD_FLAG,
};
use crate::commands::dapp::newm::types::extract_token;
use clap::Args;
use colored::Colorize;
use seedelf_cli::display::preprod_text;
use seedelf_cli::utxos;

use seedelf_cli::koios::{nft_utxo, UtxoResponse};
/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct ViewSaleArgs {
    #[arg(
        short = 'p',
        long,
        help = "The pointer token name for locating a sale.",
        display_order = 1
    )]
    pointer: String,
}

pub async fn run(args: ViewSaleArgs, network_flag: bool) -> Result<(), String> {
    preprod_text(network_flag);
    let policy_id = if network_flag {
        PREPROD_POINTER_POLICY_ID
    } else {
        MAINNET_POINTER_POLICY_ID
    }
    .to_string();
    let token_name = args.pointer;
    println!(
        "\n{} {}",
        "Viewing Sale Information For:".bright_blue(),
        token_name.bright_green()
    );
    match nft_utxo(policy_id, token_name, network_flag).await {
        Ok(utxos) => {
            if utxos.is_empty() {
                return Err("No Sale Found".to_string());
            }
            let utxo: UtxoResponse = utxos.first().unwrap().clone();
            let sale_datum = utxo.clone().inline_datum;
            let bundle = extract_token(&sale_datum, true).unwrap();
            let cost = extract_token(&sale_datum, false).unwrap();

            let (_sale_lovelace, tokens) = utxos::assets_of(vec![utxo.clone()]);
            println!(
                "{} {}",
                "\nTokens Left On Sale:".bright_magenta(),
                tokens.quantity_of(bundle.pid, bundle.tkn).unwrap()
            );
            if cost.pid == USE_USD_FLAG {
                // Convert to f64 for floating-point division
                let result = cost.amt as f64 / 1_000_000.0 / 1_000_000.0;
                println!(
                    "{} {} {}",
                    "Each Stream Token is".yellow(),
                    result,
                    "USD".yellow()
                )
            } else {
                println!(
                    "{} {} {}",
                    "Each Stream Token is".yellow(),
                    format_args!("{:.6}", cost.amt as f64 / 1_000_000.0),
                    "NEWM".yellow()
                )
            }
        }
        Err(err) => {
            eprintln!("Failed to fetch UTxOs: {}", err);
        }
    }

    Ok(())
}
