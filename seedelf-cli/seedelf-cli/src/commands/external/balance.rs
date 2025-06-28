use blstrs::Scalar;
use colored::Colorize;
use pallas_addresses::Address;
use reqwest::Error;
use seedelf_cli::address;
use seedelf_cli::display;
use seedelf_cli::koios::UtxoResponse;
use seedelf_cli::setup;
use seedelf_cli::utxos;
use seedelf_crypto::convert;

pub async fn run(network_flag: bool) -> Result<(), Error> {
    display::is_their_an_update().await;
    display::preprod_text(network_flag);
    display::block_number_and_time(network_flag).await;

    println!(
        "{}: {}",
        "\nThe External Wallet".bright_white(),
        "This wallet may receive funds without using the wallet contract.".bright_yellow()
    );

    let scalar: Scalar = setup::load_wallet();

    let vkey: String = convert::secret_key_to_public_key(scalar);
    println!("Public Key Hash: {}", vkey.bright_blue());
    println!(
        "Stake Key Hash: {}",
        address::stake_key(network_flag).bright_blue()
    );
    let addr: Address = address::dapp_address(vkey, network_flag);
    let addr_bech32: String = addr.to_bech32().unwrap();
    println!("\nAddress: {}", addr_bech32.bright_blue());

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
