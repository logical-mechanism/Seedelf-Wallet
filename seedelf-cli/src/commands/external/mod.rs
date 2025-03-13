use clap::{Args, Subcommand};

pub mod balance;
pub mod sweep;

#[derive(Subcommand)]
pub enum ExternalCommands {
    /// View external wallet balances
    Balance,
    /// Sweep all external UTxOs into the wallet
    Sweep,
}

#[derive(Args)]
pub struct ExternalArgs {
    #[command(subcommand)]
    pub command: ExternalCommands,
}

pub async fn run(args: ExternalArgs, preprod_flag: bool, variant: u64) {
    match args.command {
        ExternalCommands::Balance => {
            if let Err(err) = balance::run(preprod_flag).await {
                eprintln!("Error: {}", err);
            }
        }
        ExternalCommands::Sweep => {
            if let Err(err) = sweep::run(preprod_flag, variant).await {
                eprintln!("Error: {}", err);
            }
        }
    }
}
