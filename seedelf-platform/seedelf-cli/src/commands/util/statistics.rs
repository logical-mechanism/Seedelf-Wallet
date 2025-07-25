use anyhow::Result;
use seedelf_core::constants::{Config, get_config};
use seedelf_core::utxos;
use seedelf_display::display;
use seedelf_display::text_coloring::{display_blue, show_lovelace_and_utxos_counts};
use seedelf_koios::koios::UtxoResponse;

pub async fn run(network_flag: bool, variant: u64) -> Result<()> {
    display::is_their_an_update().await;
    display::preprod_text(network_flag);
    display_blue("Seedelf Statistics");
    let config: Config = get_config(variant, network_flag).unwrap_or_else(|| {
        eprintln!("Error: Invalid Variant");
        std::process::exit(1);
    });
    let every_utxo: Vec<UtxoResponse> =
        utxos::get_credential_utxos(config.contract.wallet_contract_hash, network_flag).await?;
    let (total_utxos, total_lovelace, total_seedelfs) =
        utxos::count_lovelace_and_utxos(&config.contract.seedelf_policy_id, every_utxo)?;
    show_lovelace_and_utxos_counts(total_utxos, total_lovelace, total_seedelfs);
    // other things can go here
    Ok(())
}
