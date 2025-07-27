use pallas_addresses::Address;
use seedelf_core::constants::{Config, VARIANT, get_config};
use seedelf_core::address;

#[tauri::command(async)]
pub async fn create_seedelf(network_flag: bool, addr: String, label: String) -> String {
    let config: Config = match get_config(VARIANT, network_flag) {
        Some(c) => c,
        None => {
            return String::new();
        }
    };

    let addr: Address = Address::from_bech32(addr.as_str()).unwrap();


    String::new()
}