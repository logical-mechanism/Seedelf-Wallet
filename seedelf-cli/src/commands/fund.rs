use clap::Args;

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct FundArgs {
    /// Seedelf to send funds too
    #[arg(long, help = "The Seedelf receiving funds.")]
    seedelf: String,

    /// The amount of ADA to send
    #[arg(long, help = "The amount of ADA being sent.")]
    amount: i32,
}

pub fn run(args: FundArgs, network_flag: bool) {
    println!("Seedelf: {}", args.seedelf);
    println!("Amount: {}", args.amount);
    if network_flag {
        println!("Running in network_flag environment");
    } else {
        println!("Running in mainnet environment");
    }
}