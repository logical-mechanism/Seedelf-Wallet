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
    /// Calculates wallet balance
    Balance,
    /// Send ADA to a Seedelf
    Transfer(commands::transfer::TransforArgs),
    /// Send ADA to an address
    Sweep(commands::sweep::SweepArgs),
    /// Display All Seedelfs
    SeedelfAll,
    /// Create a new Seedelf
    SeedelfNew(commands::seedelf_new::LabelArgs),
    /// Remove a new Seedelf
    SeedelfRemove(commands::seedelf_remove::RemoveArgs),
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
        Commands::Balance => {
            commands::balance::run();
        }
        Commands::Transfer(args) => {
            commands::transfer::run(args);
        }
        Commands::Sweep(args) => {
            commands::sweep::run(args);
        }
        Commands::SeedelfAll => {
            commands::seedelf_all::run();
        }
        Commands::SeedelfNew(args) => {
            commands::seedelf_new::run(args);
        }
        Commands::SeedelfRemove(args) => {
            commands::seedelf_remove::run(args);
        }
    }
}
