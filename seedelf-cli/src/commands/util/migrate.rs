use clap::Args;
use colored::Colorize;
use seedelf_cli::display::preprod_text;

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct MigrateArgs {
    /// The label to search with
    #[arg(long, help = "The contract variant to migrate from", display_order = 1)]
    from_variant: u64,
}

pub fn run(_args: MigrateArgs, network_flag: bool) -> Result<(), String> {
    preprod_text(network_flag);
    println!(
        "\n{}\n",
        "This command will migrate all existing UTxOs into the current contract version."
            .bright_yellow()
    );
    Ok(())
}
