use seedelf_cli::setup::{check_and_prepare_seedelf, password_complexity_check, create_wallet};

#[tauri::command(async)]
pub fn check_if_wallet_exists() -> Option<String> {
    return check_and_prepare_seedelf()
}

#[tauri::command]
pub fn check_password_complexity(password: String) -> bool {
    return password_complexity_check(password)
}

#[tauri::command(async)]
pub fn create_new_wallet(wallet_name: String, password: String) {
    return create_wallet(wallet_name, password)
}