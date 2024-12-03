use clap::Args;

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct LabelArgs {
    #[arg(long, help = "The seedelf label / personal tag.")]
    label: String,
}

pub fn run(args: LabelArgs, network_flag: bool) {
    println!("Label: {}", args.label);
    if network_flag {
        println!("Running in network_flag environment");
    } else {
        println!("Running in mainnet environment");
    }
}