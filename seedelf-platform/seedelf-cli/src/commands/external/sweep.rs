use crate::commands::fee;
use crate::setup;
use anyhow::Result;
use blstrs::Scalar;
use colored::Colorize;
use pallas_addresses::Address;
use pallas_txbuilder::BuiltTransaction;
use seedelf_core::constants::{Config, get_config};
use seedelf_core::{address, build, utxos};
use seedelf_crypto::convert;
use seedelf_crypto::register::Register;
use seedelf_display::display;
use seedelf_koios::koios::{UtxoResponse, epoch_params, submit_tx};

pub async fn run(network_flag: bool, variant: u64) -> Result<()> {
    display::is_there_an_update().await;
    display::preprod_text(network_flag);
    println!("\n{}", "Sweeping All External UTxOs".bright_blue(),);

    let config: Config = get_config(variant, network_flag)?;
    let params = epoch_params(network_flag).await?;

    let wallet_addr: Address =
        address::wallet_contract(network_flag, config.contract.wallet_contract_hash);

    let scalar: Scalar = setup::unlock_wallet_interactive();

    let vkey: String = convert::secret_key_to_public_key(scalar);
    let addr: Address = address::dapp_address(vkey.clone(), network_flag)?;
    let addr_bech32: String = addr
        .to_bech32()
        .map_err(|e| anyhow::anyhow!("Failed to encode address: {e}"))?;

    let all_utxos: Vec<UtxoResponse> = utxos::get_address_utxos(&addr_bech32, network_flag).await?;
    let signer = pallas_crypto::hash::Hash::new(
        hex::decode(&vkey)?
            .try_into()
            .map_err(|_| anyhow::anyhow!("The dApp key hash must be 28 bytes"))?,
    );
    let (tx, tx_fee): (BuiltTransaction, u64) = build::external_sweep(
        &params,
        &all_utxos,
        &Register::create(scalar)?,
        &wallet_addr,
        signer,
    )?;
    println!(
        "{} {}",
        "\nTx Fee:".bright_blue(),
        tx_fee.to_string().bright_white()
    );

    let signed_tx_cbor: BuiltTransaction =
        tx.sign(convert::secret_key_to_private_key(scalar)).unwrap();

    println!(
        "\nTx Cbor: {}",
        hex::encode(signed_tx_cbor.tx_bytes.clone()).white()
    );

    let response = submit_tx(hex::encode(signed_tx_cbor.tx_bytes), network_flag).await?;
    let tx_hash = fee::parse_submit_response(&response)?;
    println!("\nTransaction Successfully Submitted!");
    println!("\nTx Hash: {}", tx_hash.bright_cyan());
    if network_flag {
        println!(
            "{}",
            format!("\nhttps://preprod.cardanoscan.io/transaction/{tx_hash}").bright_purple()
        );
    } else {
        println!(
            "{}",
            format!("\nhttps://cardanoscan.io/transaction/{tx_hash}").bright_purple()
        );
    }

    Ok(())
}
