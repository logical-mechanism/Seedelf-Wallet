pub mod address;
mod commands;
pub mod session;
pub mod setup;
pub mod types;
pub mod wallet;
pub mod webserver;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .manage(webserver::AppState::default())
        .invoke_handler(tauri::generate_handler![
            // setup.rs
            setup::check_if_wallet_exists,
            setup::check_password_complexity,
            setup::create_new_wallet,
            setup::load_wallet_session,
            setup::lock_wallet_session,
            // wallet.rs
            wallet::get_every_utxo,
            wallet::get_owned_utxo,
            wallet::get_owned_seedelfs,
            wallet::get_lovelace_balance,
            wallet::get_wallet_history,
            // address.rs
            address::is_not_a_script,
            // commands
            commands::create::create_seedelf,
            commands::remove::remove_seedelf,
            // webserver.rs
            webserver::open_web_server,
            webserver::close_web_server
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
