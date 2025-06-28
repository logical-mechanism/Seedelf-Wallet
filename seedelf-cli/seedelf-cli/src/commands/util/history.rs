use blstrs::Scalar;
use clap::Args;
use colored::Colorize;
use pallas_addresses::Address;
use seedelf_cli::display;
use seedelf_cli::koios::TxResponse;
use seedelf_cli::koios::address_transactions;
use seedelf_cli::setup;
use seedelf_core::address;

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct HistoryArgs {
    /// Show spend only in history
    #[arg(long, help = "Show spend only", display_order = 1)]
    spend_only: bool,

    /// Show recieve only in history
    #[arg(long, help = "Show receive only", display_order = 2)]
    receive_only: bool,
}

pub async fn run(args: HistoryArgs, network_flag: bool, variant: u64) -> Result<(), String> {
    display::is_their_an_update().await;
    display::preprod_text(network_flag);

    let scalar: Scalar = setup::load_wallet();

    println!("\n{}\n", "Getting History..".bright_blue(),);
    let wallet_addr: Address = address::wallet_contract(network_flag, variant);
    let txs: Vec<TxResponse> = address_transactions(network_flag, wallet_addr.to_string())
        .await
        .map_err(|e| e.to_string())?;
    // println!("{:?}", txs);
    for tx in &txs {
        let input_match = tx.input_registers.iter().any(|r| r.is_owned(scalar));
        let output_match = tx.output_registers.iter().any(|r| r.is_owned(scalar));

        if (!args.receive_only || args.spend_only) && input_match {
            println!(
                "Spend: {}, block height: {}",
                tx.tx_hash.bright_cyan(),
                tx.block_height.to_string().bright_white()
            );
            continue;
        }

        if (!args.spend_only || args.receive_only) && output_match {
            println!(
                "Receive: {}, block height: {}",
                tx.tx_hash.bright_yellow(),
                tx.block_height.to_string().bright_white()
            );
        }
    }
    Ok(())
}
