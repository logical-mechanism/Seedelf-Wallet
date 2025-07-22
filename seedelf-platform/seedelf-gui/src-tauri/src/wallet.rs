use crate::session;
use seedelf_core::constants::{Config, get_config};
use seedelf_core::utxos;
use seedelf_koios::koios::UtxoResponse;

#[tauri::command(async)]
pub async fn get_lovelace_balance(network_flag: bool) -> u64 {
    let config: Config = match get_config(1, network_flag) {
        Some(c) => c,
        None => {
            return 0;
        }
    };

    let every_utxo: Vec<UtxoResponse> =
        match utxos::get_credential_utxos(config.contract.wallet_contract_hash, network_flag).await
        {
            Ok(v) => v,
            Err(_) => {
                return 0;
            }
        };

    let all_utxos: Vec<UtxoResponse> = match session::with_key(|sk| {
        utxos::collect_all_wallet_utxos(*sk, config.contract.seedelf_policy_id, every_utxo)
    }) {
        Ok(Ok(v)) => v,
        Ok(Err(_)) => {
            return 0;
        }
        Err(_) => {
            return 0;
        }
    };

    match utxos::assets_of(all_utxos) {
        Ok((lovelace, _)) => lovelace,
        Err(_) => 0,
    }
}
