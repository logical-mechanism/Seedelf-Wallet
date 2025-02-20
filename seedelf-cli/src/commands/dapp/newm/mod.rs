use clap::{Args, Subcommand};
pub mod constants;
pub mod guide;
pub mod types;
pub mod view_sale;

#[derive(Subcommand)]
pub enum NEWMCommands {
    /// A Basic How-To Guide For dApp Interactions
    Guide,
    /// View Sale Information
    View(view_sale::ViewSaleArgs),
}

#[derive(Args)]
pub struct NEWMArgs {
    #[command(subcommand)]
    pub command: NEWMCommands,
}

pub async fn run(args: NEWMArgs, preprod_flag: bool) -> Result<(), String> {
    match args.command {
        NEWMCommands::View(args) => view_sale::run(args, preprod_flag).await,
        NEWMCommands::Guide => {
            guide::run(preprod_flag);
            Ok(())
        }
    }
}
