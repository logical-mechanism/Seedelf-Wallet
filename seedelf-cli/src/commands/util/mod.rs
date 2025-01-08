use clap::{Args, Subcommand};

pub mod expose_key;
pub mod find_seedelf;

#[derive(Subcommand)]
pub enum UtilCommands {
    /// Exposes the wallets secret key, use with caution!
    ExposeKey,
    /// Find all Seedelfs by a label / personal tag
    FindSeedelf(find_seedelf::FindArgs),
}

#[derive(Args)]
pub struct UtilArgs {
    #[command(subcommand)]
    pub command: UtilCommands,
}

pub async fn run(args: UtilArgs, preprod_flag: bool) {
    match args.command {
        UtilCommands::ExposeKey => {
            expose_key::run();
        }
        UtilCommands::FindSeedelf(args) => {
            if let Err(err) = find_seedelf::run(args, preprod_flag).await {
                eprintln!("Error: {}", err);
            }
        }
    }
}