use seedelf_cli::commands::fund::{FundSeedelfOutput, build_fund_seedelf};
use seedelf_core::assets::Assets;
use seedelf_core::constants::{Config, VARIANT, get_config};

#[tauri::command(async)]
pub async fn fund_seedelf(
    network_flag: bool,
    user_address: String,
    seedelf: String,
    lovelace: u64,
) -> String {
    let config: Config = match get_config(VARIANT, network_flag) {
        Some(c) => c,
        None => {
            return String::new();
        }
    };

    let FundSeedelfOutput {
        tx_cbor,
        usable_utxos,
        ..
    } = build_fund_seedelf(
        config,
        network_flag,
        user_address,
        seedelf,
        lovelace,
        Assets::new(),
    )
    .await;
    if usable_utxos.is_empty() {
        return String::new();
    }
    tx_cbor
}
