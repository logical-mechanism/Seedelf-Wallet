use seedelf_koios::koios;
use seedelf_koios::koios::TxStatus;

#[tauri::command(async)]
pub async fn transaction_status(network_flag: bool, tx_hash: String) -> u64 {
    let status: Vec<TxStatus> = koios::transaction_status(network_flag, tx_hash).await.unwrap_or_default();
    if status.is_empty() {
        0
    } else {
        status.first().and_then(|s| s.num_confirmations).unwrap_or(0)
    }
}
