use crate::setup;
use anyhow::Result;
use blstrs::Scalar;
use clap::Args;
use colored::Colorize;
use pallas_addresses::Address;
use seedelf_core::address;
use seedelf_core::constants::{Config, get_config};
use seedelf_display::display;
use seedelf_koios::koios::TxResponse;
use seedelf_koios::koios::address_transactions;

/// Struct to hold command-specific arguments
#[derive(Args)]
pub(crate) struct HistoryArgs {
    /// Show spend only in history
    #[arg(long, help = "Show spend only", display_order = 1)]
    spend_only: bool,

    /// Show receive only in history
    #[arg(long, help = "Show receive only", display_order = 2)]
    receive_only: bool,
}

pub(crate) async fn run(args: HistoryArgs, network_flag: bool, variant: u64) -> Result<()> {
    display::is_there_an_update().await;
    display::preprod_text(network_flag);

    let scalar: Scalar = setup::unlock_wallet_interactive();
    let config: Config = get_config(variant, network_flag)?;

    println!("\n{}\n", "Getting History..".bright_blue(),);
    let wallet_addr: Address =
        address::wallet_contract(network_flag, config.contract.wallet_contract_hash);
    let txs: Vec<TxResponse> = address_transactions(network_flag, wallet_addr.to_string()).await?;
    // println!("{:?}", txs);
    for tx in &txs {
        let input_match = tx
            .input_registers
            .iter()
            .any(|r| r.is_owned(scalar).unwrap_or(false));
        let output_match = tx
            .output_registers
            .iter()
            .any(|r| r.is_owned(scalar).unwrap_or(false));

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
