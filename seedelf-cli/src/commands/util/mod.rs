use clap::{Args, Subcommand};

pub mod expose_key;
pub mod extract;
pub mod find_seedelf;
pub mod migrate;
pub mod mint;
pub mod statistics;

#[derive(Subcommand)]
pub enum UtilCommands {
    /// Exposes the wallets secret key, use with caution!
    ExposeKey,
    /// Find all Seedelfs by a label / personal tag
    FindSeedelf(find_seedelf::FindArgs),
    /// Display statistics about seedelf
    Statistics,
    /// Extracts a UTxO with an empty datum
    Extract(extract::ExtractArgs),
    /// Mint a seedelf from existing UTxOs
    Mint(mint::MintArgs),
    /// Migrate existing UTxOs into the newest version of the contract
    Migrate(migrate::MigrateArgs),
}

#[derive(Args)]
pub struct UtilArgs {
    #[command(subcommand)]
    pub command: UtilCommands,
}

pub async fn run(args: UtilArgs, preprod_flag: bool, variant: u64) {
    match args.command {
        UtilCommands::ExposeKey => {
            expose_key::run();
        }
        UtilCommands::FindSeedelf(args) => {
            if let Err(err) = find_seedelf::run(args, preprod_flag, variant).await {
                eprintln!("Error: {}", err);
            }
        }
        UtilCommands::Statistics => {
            if let Err(err) = statistics::run(preprod_flag, variant).await {
                eprintln!("Error: {}", err);
            }
        }
        UtilCommands::Extract(args) => {
            if let Err(err) = extract::run(args, preprod_flag, variant).await {
                eprintln!("Error: {}", err);
            }
        }
        UtilCommands::Mint(args) => {
            if let Err(err) = mint::run(args, preprod_flag, variant).await {
                eprintln!("Error: {}", err);
            }
        }
        UtilCommands::Migrate(args) => {
            if let Err(err) = migrate::run(args, preprod_flag) {
                eprintln!("Error: {}", err);
            }
        }
    }
}
