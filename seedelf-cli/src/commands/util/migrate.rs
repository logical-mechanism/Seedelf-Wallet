use colored::Colorize;
use clap::Args;
use seedelf_cli::display::preprod_text;

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct MigrateArgs {
    /// The label to search with
    #[arg(
        short = 'v',
        long,
        help = "The contract version to migrate from",
        display_order = 1
    )]
    version: String,
}

pub fn run(_args: MigrateArgs, network_flag: bool) -> Result<(), String> {
    preprod_text(network_flag);
    println!(
        "\n{}\n",
        "This command will migrate all existing UTxOs into the current contract version.".bright_yellow()
    );
    Ok(())
}
