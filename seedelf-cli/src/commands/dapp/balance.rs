use blstrs::Scalar;
use colored::Colorize;
use reqwest::Error;
use seedelf_cli::address;
use seedelf_cli::convert;
use seedelf_cli::display;
use seedelf_cli::koios::UtxoResponse;
use seedelf_cli::setup;
use seedelf_cli::utxos;

pub async fn run(network_flag: bool) -> Result<(), Error> {
    display::preprod_text(network_flag);
    display::block_number_and_time(network_flag).await;

    println!("{}", "\ndApp Wallet:".bright_white());
    println!(
        "{}",
        "\nThis wallet should only receive funds from smart contracts. This address should not be public.".bright_yellow()
    );

    let scalar: Scalar = setup::load_wallet();

    let vkey = convert::secret_key_to_public_key(scalar);
    println!("Public Key Hash: {}", vkey.bright_blue());
    let addr = address::dapp_address(vkey, network_flag);
    let addr_bech32 = addr.to_bech32().unwrap();
    println!("Address: {}", addr_bech32.bright_blue());

    let all_utxos: Vec<UtxoResponse> =
        utxos::collect_all_address_utxos(&addr_bech32, network_flag).await;
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
