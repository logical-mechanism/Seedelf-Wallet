use colored::Colorize;
use seedelf_cli::constants::{Config, get_config};
use seedelf_cli::display::preprod_text;

pub async fn run(network_flag: bool, variant: u64) -> Result<(), String> {
    preprod_text(network_flag);
    let _: Config = get_config(variant, network_flag).unwrap_or_else(|| {
        eprintln!("Error: Invalid Variant");
        std::process::exit(1);
    });
    println!("\n{}", "Getting History".bright_blue(),);
    Ok(())
}
