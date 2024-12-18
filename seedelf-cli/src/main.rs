use clap::{Parser, Subcommand};
mod commands;
mod setup;

#[derive(Parser)]
#[command(name = "seedelf-cli")]
#[command(version = "0.2.1")]
#[command(about = "A Cardano Stealth Wallet", long_about = None)]
struct Cli {
    /// Use this flag to interact with the pre-production environment
    #[arg(long, global = true)]
    preprod: bool,

    #[command(subcommand)]
    command: Option<Commands>, // Make command optional
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
    // Parse the command line arguments
    let cli = Cli::parse();

    // Run setup only if the command is not `--help` or `--version`
    if cli.command.is_some() {
        setup::check_and_prepare_seedelf();
    }

    match cli.command {
        Some(Commands::Welcome) => {
            commands::welcome::run();
        }
        Some(Commands::WalletInfo) => {
            commands::wallet_info::run();
        }
        Some(Commands::Balance) => {
            if let Err(err) = commands::balance::run(cli.preprod).await {
                eprintln!("Error: {}", err);
            }
        }
        Some(Commands::Transfer(args)) => {
            if let Err(err) = commands::transfer::run(args, cli.preprod).await {
                eprintln!("Error: {}", err);
            }
        }
        Some(Commands::Sweep(args)) => {
            if let Err(err) = commands::sweep::run(args, cli.preprod).await {
                eprintln!("Error: {}", err);
            }
        }
        Some(Commands::Fund(args)) => {
            if let Err(err) = commands::fund::run(args, cli.preprod).await {
                eprintln!("Error: {}", err);
            }
        }
        Some(Commands::SeedelfAll) => {
            if let Err(err) = commands::seedelf_all::run(cli.preprod).await {
                eprintln!("Error: {}", err);
            }
        }
        Some(Commands::SeedelfNew(args)) => {
            if let Err(err) = commands::seedelf_new::run(args, cli.preprod).await {
                eprintln!("Error: {}", err);
            }
        }
        Some(Commands::SeedelfRemove(args)) => {
            if let Err(err) = commands::seedelf_remove::run(args, cli.preprod).await {
                eprintln!("Error: {}", err);
            }
        }
        None => {
            println!("No subcommand provided. Use --help for more information.");
        }
    }
}
