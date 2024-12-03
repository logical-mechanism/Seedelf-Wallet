use clap::{Parser, Subcommand};

mod commands;
mod setup;

#[derive(Parser)]
#[command(name = "seedelf-cli")]
#[command(version = "0.0.1")]
#[command(about = "A Cardano Stealth Wallet", long_about = None)]
struct Cli {
    /// preprod flag, defaults to mainnet
    #[arg(long, global = true)]
    preprod: bool,

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

#[tokio::main]
async fn main() {
    // Pre-run checks for `.seedelf`
    setup::check_and_prepare_seedelf();

    let cli = Cli::parse();

    match cli.command {
        Commands::Welcome => {
            commands::welcome::run();
        }
        Commands::WalletInfo => {
            commands::wallet_info::run(cli.preprod);
        }
        Commands::Balance => {
            if let Err(err) = commands::balance::run(cli.preprod).await {
                eprintln!("Error: {}", err);
            }
        }
        Commands::Transfer(args) => {
            commands::transfer::run(args, cli.preprod);
        }
        Commands::Sweep(args) => {
            commands::sweep::run(args, cli.preprod);
        }
        Commands::SeedelfAll => {
            commands::seedelf_all::run(cli.preprod);
        }
        Commands::SeedelfNew(args) => {
            commands::seedelf_new::run(args, cli.preprod);
        }
        Commands::SeedelfRemove(args) => {
            commands::seedelf_remove::run(args, cli.preprod);
        }
    }
}
