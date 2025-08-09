use seedelf_core::constants::{Config, VARIANT, get_config};

#[tauri::command(async)]
pub async fn get_seedelf_policy_id(network_flag: bool) -> String {
    let config: Config = match get_config(VARIANT, network_flag) {
        Some(c) => c,
        None => return String::new(),
    };

    config.contract.seedelf_policy_id
}
