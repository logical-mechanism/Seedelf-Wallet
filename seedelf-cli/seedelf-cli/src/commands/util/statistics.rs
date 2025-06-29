use seedelf_core::utxos::count_lovelace_and_utxos;
use seedelf_display::display;
use seedelf_display::text_coloring::{display_blue, show_lovelace_and_utxos_counts};

pub async fn run(network_flag: bool, variant: u64) -> Result<(), String> {
    display::is_their_an_update().await;
    display::preprod_text(network_flag);
    display_blue("Seedelf Statistics");
    let (total_utxos, total_lovelace, total_seedelfs) =
        count_lovelace_and_utxos(network_flag, variant)
            .await
            .unwrap_or_else(|e| {
                eprintln!("{}", e);
                std::process::exit(1);
            });
    show_lovelace_and_utxos_counts(total_utxos, total_lovelace, total_seedelfs);
    // other things can go here
    Ok(())
}
