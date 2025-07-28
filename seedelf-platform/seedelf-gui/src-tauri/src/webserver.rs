use seedelf_cli::web_server::{WebServer, run_web_server_non_blocking};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct AppState {
    pub server: Mutex<Option<WebServer>>,
}

// start (non‑blocking) and store in state
#[tauri::command]
pub async fn open_web_server(
    state: tauri::State<'_, AppState>,
    tx_cbor: String,
    network_flag: bool,
) -> Result<(), String> {
    let mut guard = state.server.lock().await;
    if guard.is_some() {
        return Err("Server already running".into());
    }
    let ws = run_web_server_non_blocking(tx_cbor, network_flag).await;
    *guard = Some(ws);
    Ok(())
}

// stop and clear from state
#[tauri::command]
pub async fn close_web_server(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.server.lock().await;
    if let Some(server) = guard.as_mut() {
        server.stop().await; // graceful: signal + await
        *guard = None;
        Ok(())
    } else {
        Err("No server running".into())
    }
}
