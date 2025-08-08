use crate::session;
use seedelf_cli::commands::remove::{RemoveSeedelfOutput, build_remove_seedelf};
use seedelf_core::constants::{Config, VARIANT, get_config};

#[tauri::command(async)]
pub async fn remove_seedelf(network_flag: bool, addr: String, seedelf: String) -> String {
    let config: Config = match get_config(VARIANT, network_flag) {
        Some(c) => c,
        None => {
            return String::new();
        }
    };

    let RemoveSeedelfOutput {
        tx_hash,
        mint_cpu_units,
        mint_mem_units,
        spend_cpu_units,
        spend_mem_units,
        ..
    } = match session::with_key(|sk| build_remove_seedelf(config, network_flag, addr, seedelf, *sk))
    {
        Ok(v) => v.await,
        _ => return String::new(),
    };

    if mint_cpu_units == 0 || mint_mem_units == 0 || spend_cpu_units == 0 || spend_mem_units == 0 {
        return String::new();
    }

    tx_hash
}
