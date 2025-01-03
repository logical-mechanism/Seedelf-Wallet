use clap::{Args, Subcommand};

pub mod expose_key;

#[derive(Subcommand)]
pub enum UtilCommands {
    /// Exposes the wallets secret key, use with caution!
    ExposeKey,
}

#[derive(Args)]
pub struct UtilArgs {
    #[command(subcommand)]
    pub command: UtilCommands,
}

pub fn run(args: UtilArgs) {
    match args.command {
        UtilCommands::ExposeKey => {
            expose_key::run();
        }
    }
}