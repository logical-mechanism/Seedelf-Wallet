use pallas_addresses::Address;
use seedelf_koios::koios;
use seedelf_koios::koios::AddressAssets;

#[tauri::command]
pub fn is_not_a_script(addr: &str) -> bool {
    let addr: Address = Address::from_bech32(addr).unwrap();
    !Address::has_script(&addr)
}


#[tauri::command(async)]
pub async fn address_assets(network_flag: bool, address: String) -> Vec<AddressAssets> {
    koios::address_assets(network_flag, address)
        .await
        .unwrap_or_default()
}