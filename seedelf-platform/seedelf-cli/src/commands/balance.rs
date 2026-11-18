use crate::commands::rows;
use crate::setup;
use anyhow::Result;
use blstrs::Scalar;
use colored::Colorize;
use seedelf_core::constants::{Config, get_config};
use seedelf_core::utxos;
use seedelf_display::display;
use seedelf_koios::koios::UtxoResponse;

pub async fn run(network_flag: bool, variant: u64) -> Result<()> {
    display::is_there_an_update().await;
    display::preprod_text(network_flag);
    display::block_number_and_time(network_flag).await;

    println!("{}", "\nSeedelf Wallet Information:".bright_white());

    let scalar: Scalar = setup::unlock_wallet_interactive();

    let config: Config = get_config(variant, network_flag)?;

    // The contract read once, for the Seedelfs and the balance both: only its
    // script's rows, never the KEY address Koios lists with them (chunk 51,
    // x2#2).
    let every_utxo: Vec<UtxoResponse> =
        utxos::get_credential_utxos(config.contract.wallet_contract_hash, network_flag).await?;

    let seedelfs = utxos::owned_seedelfs(scalar, &config.contract, &every_utxo);
    if !seedelfs.is_empty() {
        println!("{}", "\nCurrent Seedelf:\n".bright_green());
        display::print_seedelfs(seedelfs);
    }

    let all_utxos: Vec<UtxoResponse> =
        utxos::collect_all_wallet_utxos(scalar, &config.contract, every_utxo)?;

    println!(
        "\nWallet Has {} UTxOs",
        all_utxos.len().to_string().bright_yellow()
    );
    // we may want to hide this behind an optional flag later
    for utxo in &all_utxos {
        println!("UTxO: {}#{}", utxo.tx_hash, utxo.tx_index);
    }

    // Anyone can pay the contract under a re-randomization of your register,
    // so a token's total can pass a u64 (chunk 51, r4#2): it's shown in u128,
    // and nothing is built from it.
    let totals = rows::totals(&all_utxos)?;
    println!(
        "\nBalance: {} ₳",
        format!("{:.6}", totals.lovelace as f64 / 1_000_000.0).bright_yellow()
    );
    rows::print_tokens(&totals);

    Ok(())
}
