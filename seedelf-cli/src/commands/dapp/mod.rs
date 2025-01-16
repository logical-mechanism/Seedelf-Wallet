use clap::{Args, Subcommand};

pub mod balance;
pub mod sweep;
pub mod newm;

#[derive(Subcommand)]
pub enum DappCommands {
    /// View Dapp Wallet Balances
    Balance,
    /// Sweep All Dapp UTxOs Into The Wallet
    Sweep,
}

#[derive(Args)]
pub struct DappArgs {
    #[command(subcommand)]
    pub command: DappCommands,
}

pub async fn run(args: DappArgs, preprod_flag: bool) {
    match args.command {
        DappCommands::Balance => {
            if let Err(err) = balance::run(preprod_flag).await {
                eprintln!("Error: {}", err);
            }
        }
        DappCommands::Sweep => {
            if let Err(err) = sweep::run(preprod_flag).await {
                eprintln!("Error: {}", err);
            }
        }
    }
}
