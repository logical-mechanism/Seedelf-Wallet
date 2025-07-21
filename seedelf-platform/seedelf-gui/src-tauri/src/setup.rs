use seedelf_cli::setup::{check_and_prepare_seedelf, create_wallet, password_complexity_check, load_wallet};
use std::panic::{catch_unwind, AssertUnwindSafe};
use blstrs::Scalar;
use crate::session;

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
    let key: Scalar = catch_unwind(AssertUnwindSafe(|| load_wallet(password)))
        .map_err(|_| "Failed to load or decrypt wallet".to_string())?;

    session::unlock(key);
    Ok(())
}

#[tauri::command]
pub fn lock_wallet_session() -> Result<(), String> {
    session::lock();
    Ok(())
}