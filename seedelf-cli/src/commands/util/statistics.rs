use colored::Colorize;
use seedelf_cli::display;
use seedelf_cli::utxos::count_lovelace_and_utxos;

pub async fn run(network_flag: bool, variant: u64) -> Result<(), String> {
    display::is_their_an_update().await;
    display::preprod_text(network_flag);
    println!("\n{}", "Seedelf Statistics".bright_blue());
    count_lovelace_and_utxos(network_flag, variant).await;
    // other things can go here
    Ok(())
}
