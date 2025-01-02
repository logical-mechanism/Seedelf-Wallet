use clap::{Parser, Subcommand};
mod commands;
use seedelf_cli::setup;

#[derive(Parser)]
#[command(name = "seedelf-cli")]
#[command(version = env!("CARGO_PKG_VERSION"))]
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
    /// Displays the seedelf-cli welcome message
    Welcome,
    /// Create a new Seedelf in the wallet
    Create(commands::create::LabelArgs),
    /// Remove a Seedelf from the wallet
    Remove(commands::remove::RemoveArgs),
    /// Displays the current wallet information, seedelfs, and balance
    Balance,
    /// An address sends funds to a Seedelf
    Fund(commands::fund::FundArgs),
    /// A Seedelf sends funds to a Seedelf
    Transfer(commands::transfer::TransforArgs),
    /// A Seedelf sends funds to an address
    Sweep(commands::sweep::SweepArgs),
    /// Update the seedelf-cli with the newest tagged release
    Update
}

#[tokio::main]
async fn main() {
    // Parse the command line arguments
    let cli: Cli = Cli::parse();

    // Run setup only if the command is not `--help` or `--version`
    if cli.command.is_some() {
        setup::check_and_prepare_seedelf();
    }

    match cli.command {
        Some(Commands::Welcome) => {
            commands::welcome::run();
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
        Some(Commands::Create(args)) => {
            if let Err(err) = commands::create::run(args, cli.preprod).await {
                eprintln!("Error: {}", err);
            }
        }
        Some(Commands::Remove(args)) => {
            if let Err(err) = commands::remove::run(args, cli.preprod).await {
                eprintln!("Error: {}", err);
            }
        }
        // catch the no command state
        None => {
            println!("No subcommand provided. Use --help for more information.");
        }
        Some(Commands::Update) => {
            commands::update::run();
        }
    }
}
