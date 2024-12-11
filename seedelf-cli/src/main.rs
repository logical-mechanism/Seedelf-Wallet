use clap::{Parser, Subcommand};

mod commands;
mod setup;

#[derive(Parser)]
#[command(name = "seedelf-cli")]
#[command(version = "0.0.1")]
#[command(about = "A Cardano Stealth Wallet", long_about = None)]
struct Cli {
    /// This forces each command to use the pre-production environment
    #[arg(long, global = true)]
    preprod: bool,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Displays the Seedelf welcome message
    Welcome,
    /// Displays wallet information
    WalletInfo,
    /// Displays the current wallet balance
    Balance,
    /// An address sends ADA to a Seedelf
    Fund(commands::fund::FundArgs),
    /// A Seedelf sends ADA to a Seedelf
    Transfer(commands::transfer::TransforArgs),
    /// A Seedelf sends ADA to an address
    Sweep(commands::sweep::SweepArgs),
    /// Create a new Seedelf
    SeedelfNew(commands::seedelf_new::LabelArgs),
    /// Display all Seedelfs
    SeedelfAll,
    /// Remove a Seedelf
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
            
            if let Err(err) = commands::sweep::run(args, cli.preprod).await {
                eprintln!("Error: {}", err);
            }
        }
        Commands::Fund(args) => {
            if let Err(err) = commands::fund::run(args, cli.preprod).await {
                eprintln!("Error: {}", err);
            }
        }
        Commands::SeedelfAll => {
            if let Err(err) = commands::seedelf_all::run(cli.preprod).await {
                eprintln!("Error: {}", err);
            }
        }
        Commands::SeedelfNew(args) => {
            if let Err(err) = commands::seedelf_new::run(args, cli.preprod).await {
                eprintln!("Error: {}", err);
            }
        }
        Commands::SeedelfRemove(args) => {
            if let Err(err) = commands::seedelf_remove::run(args, cli.preprod).await {
                eprintln!("Error: {}", err);
            }
        }
    }
}
