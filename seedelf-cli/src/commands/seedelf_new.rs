use clap::Args;

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct LabelArgs {
    #[arg(long, help = "The seedelf label / personal tag.")]
    label: String,
}

pub fn run(args: LabelArgs) {
    println!("Label: {}", args.label);
}