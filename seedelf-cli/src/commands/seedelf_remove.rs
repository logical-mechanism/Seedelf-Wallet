use clap::Args;

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct RemoveArgs {
    #[arg(long, help = "The seedelf to remove.")]
    seedelf: String,

    #[arg(long, help = "The receiving address.")]
    address: String,
}

pub fn run(args: RemoveArgs, network_flag: bool) {
    println!("Seedelf: {}", args.seedelf);
    if network_flag {
        println!("Running in network_flag environment");
    } else {
        println!("Running in mainnet environment");
    }
}