use crate::session;
use blstrs::Scalar;
use seedelf_cli::setup::{
    check_and_prepare_seedelf, create_wallet, load_wallet, password_complexity_check,
};

#[tauri::command(async)]
pub fn check_if_wallet_exists() -> Option<String> {
    check_and_prepare_seedelf()
}

#[tauri::command]
pub fn check_password_complexity(password: String) -> bool {
    password_complexity_check(password)
}

#[tauri::command(async)]
pub fn create_new_wallet(wallet_name: String, password: String) {
    create_wallet(wallet_name, password)
}

#[tauri::command]
pub async fn load_wallet_session(password: String) -> Result<(), String> {
    let key: Scalar = load_wallet(password)?;
    session::unlock(key);
    Ok(())
}

#[tauri::command]
pub fn lock_wallet_session() -> Result<(), String> {
    session::lock();
    Ok(())
}
