use pallas_addresses::Address;

#[tauri::command]
pub fn is_not_a_script(addr: &str) -> bool {
    let addr: Address = Address::from_bech32(addr).unwrap();
    !Address::has_script(&addr)
}