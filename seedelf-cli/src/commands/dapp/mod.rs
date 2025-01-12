use clap::{Args, Subcommand};

pub mod balance;

#[derive(Subcommand)]
pub enum DappCommands {
    /// View Dapp Wallet Balances
    Balance,
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
    }
}
