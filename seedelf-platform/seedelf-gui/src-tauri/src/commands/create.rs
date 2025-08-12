use crate::session;
use seedelf_cli::commands::create::{CreateSeedelfOutput, build_create_seedelf};
use seedelf_core::constants::{Config, VARIANT, get_config};
use seedelf_core::transaction;

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
    } = match session::with_key(|sk| build_create_seedelf(config, network_flag, addr, label, *sk))
        .await
    {
        Ok(v) => v,
        _ => return String::new(),
    };

    // prob should be a function that returns this min
    let tmp_fee: u64 = 205_000;
    let lovelace_goal: u64 = transaction::seedelf_minimum_lovelace().unwrap_or_default() + tmp_fee;
    if total_lovelace < lovelace_goal {
        return String::new();
    }
    if cpu_units == 0 || mem_units == 0 {
        return String::new();
    }

    tx_cbor
}
