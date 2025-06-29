use anyhow::Result;
use clap::Args;
use colored::Colorize;
use seedelf_core::constants::{Config, get_config};
use seedelf_core::utxos;
use seedelf_display::display;
use seedelf_koios::koios::UtxoResponse;

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct FindArgs {
    /// The label to search with
    #[arg(
        short = 'l',
        long,
        help = "The seedelf label / personal tag.",
        display_order = 1
    )]
    label: Option<String>,
}

pub async fn run(args: FindArgs, network_flag: bool, variant: u64) -> Result<()> {
    display::is_their_an_update().await;
    display::preprod_text(network_flag);
    let label: String = args.label.unwrap_or_default();
    println!(
        "\n{} {}",
        "Finding All Seedelfs Containing:".bright_blue(),
        label.bright_green()
    );

    let config: Config = get_config(variant, network_flag).unwrap_or_else(|| {
        eprintln!("Error: Invalid Variant");
        std::process::exit(1);
    });

    let every_utxo: Vec<UtxoResponse> =
        utxos::get_credential_utxos(config.contract.wallet_contract_hash, network_flag).await?;
    let all_seedelfs =
        utxos::find_all_seedelfs(label, config.contract.seedelf_policy_id, every_utxo)?;
    display::print_seedelfs(all_seedelfs);
    Ok(())
}
