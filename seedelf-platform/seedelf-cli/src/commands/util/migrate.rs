use anyhow::{Result, bail};
use clap::Args;
use colored::Colorize;
use seedelf_core::constants::VARIANT;
use seedelf_display::display;

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct MigrateArgs {
    /// The label to search with
    #[arg(long, help = "The contract variant to migrate from", display_order = 1)]
    from_variant: u64,
}

pub async fn run(args: MigrateArgs, network_flag: bool) -> Result<()> {
    // starts a variant 1
    if args.from_variant == 0 || args.from_variant >= VARIANT {
        bail!("Incorrect Migration Variant");
    }

    display::is_their_an_update().await;
    display::preprod_text(network_flag);

    println!(
        "{}",
        format!(
            "\nMigrating Variant: {} to Variant: {}",
            args.from_variant, VARIANT
        )
        .bright_cyan()
    );

    // implement this when required
    //
    // its basically sweep
    // spend all that we can in one go into the newest variant
    Ok(())
}
