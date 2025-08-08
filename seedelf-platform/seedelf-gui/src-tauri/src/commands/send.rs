// core named this transfer, but in the gui it will send
use crate::session;
use seedelf_cli::commands::transfer::{TransferSeedelfOutput, build_transfer_seedelf};
use seedelf_core::assets::Assets;
use seedelf_core::constants::{Config, VARIANT, get_config};

#[tauri::command(async)]
pub async fn send_seedelf(network_flag: bool, seedelf: String, lovelace: u64) -> String {
    let config: Config = match get_config(VARIANT, network_flag) {
        Some(c) => c,
        None => {
            return String::new();
        }
    };
    let TransferSeedelfOutput {
        tx_hash,
        usable_utxos,
        ..
    } = match session::with_key(|sk| {
        build_transfer_seedelf(
            config,
            network_flag,
            seedelf,
            lovelace,
            Assets::new(),
            None,
            *sk,
        )
    }) {
        Ok(v) => v.await,
        _ => return String::new(),
    };
    if usable_utxos.is_empty() {
        return String::new();
    }
    tx_hash
}
