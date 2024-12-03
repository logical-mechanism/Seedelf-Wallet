use clap::{Parser, Subcommand};

mod commands;
mod setup;

#[derive(Parser)]
#[command(name = "seedelf-cli")]
#[command(version = "0.0.1")]
#[command(about = "A Cardano Stealth Wallet", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Displays a welcome message
    Welcome,
    /// Displays wallet information
    WalletInfo,
}

fn main() {
    // Pre-run checks for `.seedelf`
    setup::check_and_prepare_seedelf();

    let cli = Cli::parse();

    match cli.command {
        Commands::Welcome => {
            commands::welcome::run();
        }
        Commands::WalletInfo => {
            commands::wallet_info::run();
        }
    }
}
