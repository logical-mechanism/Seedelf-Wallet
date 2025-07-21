pub mod session;
pub mod setup;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            // setup.rs
            setup::check_if_wallet_exists,
            setup::check_password_complexity,
            setup::create_new_wallet,
            setup::load_wallet_session,
            setup::lock_wallet_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
