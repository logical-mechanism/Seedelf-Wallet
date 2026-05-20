use clap::{Args, Subcommand};

pub(crate) mod age;
pub(crate) mod base;
pub(crate) mod expose_key;
pub(crate) mod extract;
pub(crate) mod find;
pub(crate) mod history;
pub(crate) mod migrate;
pub(crate) mod mint;
pub(crate) mod statistics;

#[derive(Subcommand)]
pub(crate) enum UtilCommands {
    /// Exposes the wallets secret key, use with caution!
    ExposeKey,
    /// Find all seedelfs by a label / personal tag
    Find(find::FindArgs),
    /// Calculate the age of a seedelf
    Age(age::AgeArgs),
    /// Display statistics about the Seedelf protocol
    Statistics,
    /// Extracts a UTxO with an empty datum
    Extract(extract::ExtractArgs),
    /// Mint a seedelf from existing UTxOs
    Mint(mint::MintArgs),
    /// Migrate existing UTxOs into the newest version of the contract
    Migrate(migrate::MigrateArgs),
    /// Display spend/receive transaction history for the wallet
    History(history::HistoryArgs),
    /// Display the base register for the wallet
    Base,
}

#[derive(Args)]
pub(crate) struct UtilArgs {
    #[command(subcommand)]
    pub command: UtilCommands,
}

pub(crate) async fn run(args: UtilArgs, preprod_flag: bool, variant: u64) {
    match args.command {
        UtilCommands::ExposeKey => {
            expose_key::run();
        }
        UtilCommands::Find(args) => {
            if let Err(err) = find::run(args, preprod_flag, variant).await {
                eprintln!("Error: {err}");
            }
        }
        UtilCommands::Age(args) => {
            if let Err(err) = age::run(args, preprod_flag, variant).await {
                eprintln!("Error: {err}");
            }
        }
        UtilCommands::Statistics => {
            if let Err(err) = statistics::run(preprod_flag, variant).await {
                eprintln!("Error: {err}");
            }
        }
        UtilCommands::Extract(args) => {
            if let Err(err) = extract::run(args, preprod_flag, variant).await {
                eprintln!("Error: {err}");
            }
        }
        UtilCommands::Mint(args) => {
            if let Err(err) = mint::run(args, preprod_flag, variant).await {
                eprintln!("Error: {err}");
            }
        }
        UtilCommands::Migrate(args) => {
            if let Err(err) = migrate::run(args, preprod_flag).await {
                eprintln!("Error: {err}");
            }
        }
        UtilCommands::History(args) => {
            if let Err(err) = history::run(args, preprod_flag, variant).await {
                eprintln!("Error: {err}");
            }
        }
        UtilCommands::Base => {
            base::run();
        }
    }
}
