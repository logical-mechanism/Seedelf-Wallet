use clap::Args;

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct RemoveArgs {
    #[arg(long, help = "The seedelf to remove.")]
    seedelf: String,
}

pub fn run(args: RemoveArgs) {
    println!("Seedelf: {}", args.seedelf);
}