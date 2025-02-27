use colored::Colorize;
use seedelf_cli::display::preprod_text;
use seedelf_cli::utxos::count_lovelace_and_utxos;

pub async fn run(network_flag: bool, variant: u64) -> Result<(), String> {
    preprod_text(network_flag);
    println!("\n{}", "Seedelf Statistics".bright_blue());
    count_lovelace_and_utxos(network_flag, variant).await;
    // other things can go here
    Ok(())
}
