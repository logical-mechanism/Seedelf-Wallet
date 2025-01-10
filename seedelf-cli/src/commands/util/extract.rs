//// Extract some UTxO that has no datum
/// 
/// 
use clap::Args;
use colored::Colorize;
use seedelf_cli::address;
use pallas_addresses::Address;
use seedelf_cli::display::preprod_text;
use seedelf_cli::koios::{utxo_info, UtxoResponse};

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct ExtractArgs {
    /// The label to search with
    #[arg(
        short = 'u',
        long,
        help = "The UTxO to spend",
        display_order = 1
    )]
    utxo: String,

    #[arg(
        short = 'a',
        long,
        help = "The address receiving the funds",
        display_order = 2
    )]
    address: String,
}

pub async fn run(args: ExtractArgs, network_flag: bool) -> Result<(), String> {
    preprod_text(network_flag);

    // we need to make sure that the network flag and the address provided makes sense here
    let addr: Address = Address::from_bech32(args.address.as_str()).unwrap();
    if !(address::is_not_a_script(addr.clone())
        && address::is_on_correct_network(addr.clone(), network_flag))
    {
        return Err("Supplied Address Is Incorrect".to_string());
    }

    let mut empty_datum_utxo = UtxoResponse::default();
    match utxo_info(&args.utxo, network_flag).await {
        Ok(utxos) => {
            if !utxos.is_empty() {
                empty_datum_utxo = utxos.first().unwrap().clone();
            } else {
                return Err("No UTxO Found".to_string());
            }
        }
        Err(err) => {
            eprintln!(
                "Failed to fetch UTxO: {}\nWait a few moments and try again.",
                err
            );
        }
    }
    println!("{:?}", empty_datum_utxo);


    Ok(())
}