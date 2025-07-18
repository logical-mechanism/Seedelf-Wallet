use seedelf_cli::setup::check_and_prepare_seedelf;

#[tauri::command]
fn check_if_wallet_exists() -> Option<String> {
    return check_and_prepare_seedelf()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![check_if_wallet_exists])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
