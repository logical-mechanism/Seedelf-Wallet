use seedelf_cli::commands::create::{build_create_seedelf, CreateSeedelfOutput};
use seedelf_core::constants::{Config, VARIANT, get_config};
use crate::session;


#[tauri::command(async)]
pub async fn create_seedelf(network_flag: bool, addr: String, label: String) -> String {
    let config: Config = match get_config(VARIANT, network_flag) {
        Some(c) => c,
        None => {
            return String::new();
        }
    };

    let CreateSeedelfOutput {
        tx_cbor,
        total_lovelace,
        cpu_units,
        mem_units,
        ..
    } = match session::with_key(|sk| {
        build_create_seedelf(
        config,
        network_flag,
        addr,
        label,
        *sk,
    )
    }) {
        Ok(v) => v.await,
        _ => return String::new(),
    };

    if total_lovelace < 1_954_860 {
        return String::new();
    }
    if cpu_units == 0 || mem_units == 0 {
        return String::new();
    }

    tx_cbor
}