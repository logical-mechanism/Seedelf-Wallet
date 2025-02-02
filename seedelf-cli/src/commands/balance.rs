use blstrs::Scalar;
use colored::Colorize;
use reqwest::Error;
use seedelf_cli::display;
use seedelf_cli::koios::UtxoResponse;
use seedelf_cli::setup;
use seedelf_cli::utxos;

pub async fn run(network_flag: bool, variant: u64) -> Result<(), Error> {
    display::preprod_text(network_flag);
    display::block_number_and_time(network_flag).await;

    println!("{}", "\nSeedelf Wallet Information:".bright_white());

    let scalar: Scalar = setup::load_wallet();

    display::all_seedelfs(scalar, network_flag, variant).await;

    let all_utxos: Vec<UtxoResponse> =
        utxos::collect_all_wallet_utxos(scalar, network_flag, variant).await;
    let (total_lovelace, tokens) = utxos::assets_of(all_utxos.clone());

    println!(
        "\nWallet Has {} UTxOs",
        all_utxos.len().to_string().bright_yellow()
    );
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
