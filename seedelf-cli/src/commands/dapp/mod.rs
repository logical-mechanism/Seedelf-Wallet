use clap::{Args, Subcommand};

#[derive(Subcommand)]
pub enum DappCommands {
}

#[derive(Args)]
pub struct DappArgs {
    #[command(subcommand)]
    pub command: DappCommands,
}

pub async fn run(args: DappArgs, preprod_flag: bool) {
    match args.command {
        
    }
}
