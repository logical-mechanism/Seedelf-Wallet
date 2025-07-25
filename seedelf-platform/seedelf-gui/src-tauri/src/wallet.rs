use crate::session;
use crate::types::{TxResponseWithSide, UTxOSide};
use blstrs::Scalar;
use pallas_addresses::Address;
use seedelf_core::address;
use seedelf_core::constants::{Config, VARIANT, get_config};
use seedelf_core::utxos;
use seedelf_crypto::register::Register;
use seedelf_display::display;
use seedelf_koios::koios;
use seedelf_koios::koios::{TxResponse, UtxoResponse};

fn any_owned(regs: &[Register], scalar: &Scalar) -> bool {
    regs.iter().any(|r| matches!(r.is_owned(*scalar), Ok(true)))
}

#[tauri::command(async)]
pub async fn get_wallet_history(network_flag: bool) -> Vec<TxResponseWithSide> {
    let config: Config = match get_config(VARIANT, network_flag) {
        Some(c) => c,
        None => {
            return Vec::new();
        }
    };

    let wallet_addr: Address =
        address::wallet_contract(network_flag, config.contract.wallet_contract_hash);

    let all_txs: Vec<TxResponse> =
        match koios::address_transactions(network_flag, wallet_addr.to_string()).await {
            Ok(v) => v,
            Err(_) => {
                return Vec::new();
            }
        };

    session::with_key(|sk| {
        let filtered: Vec<TxResponseWithSide> = all_txs
            .into_iter()
            .filter_map(|tx| {
                if any_owned(&tx.input_registers, sk) {
                    Some(TxResponseWithSide {
                        side: UTxOSide::Input,
                        tx,
                    })
                } else if any_owned(&tx.output_registers, sk) {
                    Some(TxResponseWithSide {
                        side: UTxOSide::Output,
                        tx,
                    })
                } else {
                    None
                }
            })
            .collect();
        filtered
    })
    .unwrap_or_default()
}

#[tauri::command(async)]
pub async fn get_every_utxo(network_flag: bool) -> Vec<UtxoResponse> {
    let config: Config = match get_config(VARIANT, network_flag) {
        Some(c) => c,
        None => {
            return Vec::new();
        }
    };

    // this is all the utxos in the contract
    utxos::get_credential_utxos(config.contract.wallet_contract_hash, network_flag)
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_owned_utxo(network_flag: bool, every_utxo: Vec<UtxoResponse>) -> Vec<UtxoResponse> {
    let config: Config = match get_config(VARIANT, network_flag) {
        Some(c) => c,
        None => {
            return Vec::new();
        }
    };

    match session::with_key(|sk| {
        utxos::collect_all_wallet_utxos(*sk, &config.contract.seedelf_policy_id, every_utxo)
    }) {
        Ok(Ok(v)) => v,
        _ => Vec::new(),
    }
}

#[tauri::command]
pub fn get_lovelace_balance(owned_utxos: Vec<UtxoResponse>) -> u64 {
    match utxos::assets_of(owned_utxos) {
        Ok((lovelace, _)) => lovelace,
        Err(_) => 0,
    }
}

#[tauri::command]
pub fn get_owned_seedelfs(network_flag: bool, every_utxo: Vec<UtxoResponse>) -> Vec<String> {
    let config: Config = match get_config(VARIANT, network_flag) {
        Some(c) => c,
        None => {
            return Vec::new();
        }
    };

    session::with_key(|sk| {
        display::extract_all_owned_seedelfs(*sk, &config.contract.seedelf_policy_id, every_utxo)
    })
    .unwrap_or_default()
}
