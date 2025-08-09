// core named this sweep, but in the gui it will be extract
use crate::session;
use seedelf_cli::commands::sweep::{SweepSeedelfOutput, build_sweep_seedelf};
use seedelf_core::assets::Assets;
use seedelf_core::constants::{Config, VARIANT, get_config};

#[tauri::command(async)]
pub async fn extract_seedelf(network_flag: bool, address: String, lovelace: u64) -> String {
    let config: Config = match get_config(VARIANT, network_flag) {
        Some(c) => c,
        None => {
            return String::new();
        }
    };
    let SweepSeedelfOutput {
        tx_hash,
        ..
    } = match session::with_key(|sk| {
        build_sweep_seedelf(
            config,
            network_flag,
            address,
            lovelace,
            Assets::new(),
            None,
            *sk,
        )
    }) {
        Ok(v) => v.await,
        _ => return String::new(),
    };

    tx_hash
}
