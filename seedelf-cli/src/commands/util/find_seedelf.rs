use colored::Colorize;
use clap::Args;
use seedelf_cli::display::preprod_text;
use seedelf_cli::utxos::find_and_print_all_seedelfs;

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct FindArgs {
    /// The label to search with
    #[arg(short = 'l', long, help = "The seedelf label / personal tag.", display_order = 0)]
    label: String,
}

pub async fn run(args: FindArgs, network_flag: bool) -> Result<(), String> {
    preprod_text(network_flag);
    println!("\n{} {}", "Finding All Seedelfs Containing:".bright_blue(), args.label.bright_green());
    find_and_print_all_seedelfs(args.label, network_flag).await;
    Ok(())
}
