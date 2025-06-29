use clap::Args;
use colored::Colorize;
use seedelf_core::utxos::find_all_seedelfs;
use seedelf_display::display;

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

pub async fn run(args: FindArgs, network_flag: bool, variant: u64) -> Result<(), String> {
    display::is_their_an_update().await;
    display::preprod_text(network_flag);
    let label: String = args.label.unwrap_or_default();
    println!(
        "\n{} {}",
        "Finding All Seedelfs Containing:".bright_blue(),
        label.bright_green()
    );
    let all_seedelfs = find_all_seedelfs(label, network_flag, variant).await;
    display::print_seedelfs(all_seedelfs);
    Ok(())
}
