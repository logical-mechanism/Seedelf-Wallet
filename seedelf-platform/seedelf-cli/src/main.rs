use clap::{Parser, Subcommand};
mod commands;
use seedelf_cli::setup;
use seedelf_core::constants::VARIANT;
use seedelf_display::text_coloring::{display_blue, display_cyan, display_yellow};
// use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "seedelf-cli")]
#[command(version = env!("CARGO_PKG_VERSION"))]
#[command(about = "A Cardano Stealth Wallet", long_about = None)]
struct Cli {
    /// Use this flag to interact with the pre-production environment
    #[arg(long, global = true, display_order = 98)]
    preprod: bool,

    /// Use this for different variants of the contract, defaults to most recent variant
    #[arg(long, global = true, default_value_t = VARIANT, display_order = 99)]
    variant: u64,

    #[command(subcommand)]
    command: Option<Commands>, // Make command optional
}

#[derive(Subcommand)]
enum Commands {
    /// Displays the seedelf-cli welcome message
    Welcome,
    /// Create a new seedelf in the wallet
    Create(commands::create::LabelArgs),
    /// Remove a seedelf from the wallet
    Remove(commands::remove::RemoveArgs),
    /// Displays the current wallet information, seedelfs, and balance
    Balance,
    /// An address sends funds to a seedelf
    Fund(commands::fund::FundArgs),
    /// A seedelf sends funds to a seedelf
    Transfer(commands::transfer::TransforArgs),
    /// A seedelf sends funds to an address
    Sweep(commands::sweep::SweepArgs),
    /// Utility functions for seedelf-cli
    Util(commands::util::UtilArgs),
    /// External wallet functions for seedelf-cli
    External(commands::external::ExternalArgs),
}

#[tokio::main]
async fn main() {
    // Parse the command line arguments
    let cli: Cli = Cli::parse();

    // Run setup only if the command is not `--help` or `--version`
    if cli.command.is_some() {
        display_blue("Checking For Existing Seedelf Wallet");
        match setup::check_and_prepare_seedelf() {
            None => {
                let wallet_name: String = setup::prompt_wallet_name();
                let password: String = setup::is_valid_password();
                setup::create_wallet(wallet_name.clone(), password);
                display_yellow(format!("Wallet Created: {wallet_name}").as_str());
            }
            Some(wallet_name) => display_cyan(format!("Found Wallet: {wallet_name}").as_str()),
        }
    }

    match cli.command {
        Some(Commands::Welcome) => {
            commands::welcome::run().await;
        }
        Some(Commands::Balance) => {
            if let Err(err) = commands::balance::run(cli.preprod, cli.variant).await {
                eprintln!("Error: {err}");
            }
        }
        Some(Commands::Transfer(args)) => {
            if let Err(err) = commands::transfer::run(args, cli.preprod, cli.variant).await {
                eprintln!("Error: {err}");
            }
        }
        Some(Commands::Sweep(args)) => {
            if let Err(err) = commands::sweep::run(args, cli.preprod, cli.variant).await {
                eprintln!("Error: {err}");
            }
        }
        Some(Commands::Fund(args)) => {
            if let Err(err) = commands::fund::run(args, cli.preprod, cli.variant).await {
                eprintln!("Error: {err}");
            }
        }
        Some(Commands::Create(args)) => {
            if let Err(err) = commands::create::run(args, cli.preprod, cli.variant).await {
                eprintln!("Error: {err}");
            }
        }
        Some(Commands::Remove(args)) => {
            if let Err(err) = commands::remove::run(args, cli.preprod, cli.variant).await {
                eprintln!("Error: {err}");
            }
        }
        Some(Commands::Util(util_command)) => {
            commands::util::run(util_command, cli.preprod, cli.variant).await
        }
        Some(Commands::External(external_command)) => {
            commands::external::run(external_command, cli.preprod, cli.variant).await
        }
        // catch the no command state
        None => {
            println!("No subcommand provided. Use --help for more information.");
        }
    }
}
