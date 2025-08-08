use seedelf_core::constants::{Config, VARIANT, get_config};
use seedelf_core::utxos;
use seedelf_koios::koios::UtxoResponse;

#[tauri::command(async)]
pub async fn get_every_seedelf(
    network_flag: bool,
    all_utxos: Vec<UtxoResponse>,
) -> Vec<String> {
    let config: Config = match get_config(VARIANT, network_flag) {
        Some(c) => c,
        None => {
            return Vec::new();
        }
    };

    match utxos::find_all_seedelfs(String::new(), &config.contract.seedelf_policy_id, all_utxos)
    {
        Ok(v) => v,
        Err(_) => {
            return Vec::new();
        }
    }
}
