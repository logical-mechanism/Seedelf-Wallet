use clap::{Args, Subcommand};
pub mod constants;
pub mod view_sale;
pub mod types;

#[derive(Subcommand)]
pub enum NEWMCommands {
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
        NEWMCommands::View(args) => {
            view_sale::run(args, preprod_flag).await 
        }
        
    }
}
