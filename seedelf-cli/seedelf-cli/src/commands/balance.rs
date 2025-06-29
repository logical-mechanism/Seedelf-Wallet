use blstrs::Scalar;
use colored::Colorize;
use hex;
use reqwest::Error;
use seedelf_cli::setup;
use seedelf_core::constants::{Config, get_config};
use seedelf_core::utxos;
use seedelf_display::display;
use seedelf_koios::koios::UtxoResponse;
pub async fn run(network_flag: bool, variant: u64) -> Result<(), Error> {
    display::is_their_an_update().await;
    display::preprod_text(network_flag);
    display::block_number_and_time(network_flag).await;

    println!("{}", "\nSeedelf Wallet Information:".bright_white());

    let scalar: Scalar = setup::load_wallet();

    let config: Config = get_config(variant, network_flag).unwrap_or_else(|| {
        eprintln!("Error: Invalid Variant");
        std::process::exit(1);
    });

    display::all_seedelfs(
        scalar,
        network_flag,
        hex::encode(config.contract.wallet_contract_hash).as_str(),
        config.contract.seedelf_policy_id,
    )
    .await;

    let all_utxos: Vec<UtxoResponse> =
        utxos::collect_all_wallet_utxos(scalar, network_flag, variant).await;
    let (total_lovelace, tokens) = utxos::assets_of(all_utxos.clone()).unwrap_or_else(|e| {
        eprintln!("{e}");
        std::process::exit(1);
    });

    println!(
        "\nWallet Has {} UTxOs",
        all_utxos.len().to_string().bright_yellow()
    );
    // we may want to hide this behind an optional flag later
    for utxo in all_utxos {
        println!("UTxO: {}#{}", utxo.tx_hash, utxo.tx_index);
    }
    println!(
        "\nBalance: {} ₳",
        format!("{:.6}", total_lovelace as f64 / 1_000_000.0).bright_yellow()
    );

    if !tokens.items.is_empty() {
        println!("{}", "\nTokens:\n".bright_magenta());
        for asset in tokens.items.clone() {
            println!(
                "{} {}.{}",
                asset.amount.to_string().white(),
                hex::encode(asset.policy_id.as_ref()).white(),
                hex::encode(asset.token_name).white()
            );
        }
    }

    Ok(())
}
