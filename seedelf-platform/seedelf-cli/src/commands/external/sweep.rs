use crate::commands::fee;
use crate::setup;
use anyhow::{Result, bail};
use blstrs::Scalar;
use colored::Colorize;
use pallas_addresses::Address;
use pallas_txbuilder::{BuildConway, BuiltTransaction, Input, Output, StagingTransaction};
use seedelf_core::address;
use seedelf_core::assets::Assets;
use seedelf_core::constants::{Config, MAXIMUM_TOKENS_PER_UTXO, get_config};
use seedelf_core::transaction::wallet_minimum_lovelace_with_assets;
use seedelf_core::utxos;
use seedelf_crypto::convert;
use seedelf_crypto::register::Register;
use seedelf_display::display;
use seedelf_koios::koios::{UtxoResponse, epoch_params, submit_tx};

pub(crate) async fn run(network_flag: bool, variant: u64) -> Result<()> {
    display::is_their_an_update().await;
    display::preprod_text(network_flag);
    println!("\n{}", "Sweeping All External UTxOs".bright_blue(),);

    let config: Config =
        get_config(variant, network_flag).ok_or_else(|| anyhow::anyhow!("Invalid Variant"))?;
    let params = epoch_params(network_flag).await?;

    let wallet_addr: Address =
        address::wallet_contract(network_flag, config.contract.wallet_contract_hash);

    // this is used to calculate the real fee
    let mut draft_tx: StagingTransaction = StagingTransaction::new();

    let scalar: Scalar = setup::unlock_wallet_interactive();

    let vkey: String = convert::secret_key_to_public_key(scalar);
    let addr: Address = address::dapp_address(vkey.clone(), network_flag)?;
    let addr_bech32: String = addr.to_bech32().unwrap();

    let all_utxos: Vec<UtxoResponse> = utxos::get_address_utxos(&addr_bech32, network_flag).await?;
    if all_utxos.is_empty() {
        bail!("Not Enough Lovelace/Tokens");
    }
    let (total_lovelace, tokens) = utxos::assets_of(all_utxos.clone())?;

    for utxo in all_utxos.clone() {
        let this_input: Input = Input::new(
            pallas_crypto::hash::Hash::new(
                hex::decode(utxo.tx_hash.clone())
                    .expect("Invalid hex string")
                    .try_into()
                    .expect("Failed to convert to 32-byte array"),
            ),
            utxo.tx_index,
        );
        draft_tx = draft_tx.input(this_input.clone());
    }

    // This is some semi legit fee to be used to estimate it
    let tmp_fee: u64 = 200_000;

    // build out the rest of the draft tx with the tmp fee
    draft_tx = draft_tx
        .fee(tmp_fee)
        .disclosed_signer(pallas_crypto::hash::Hash::new(
            hex::decode(vkey.clone())
                .unwrap()
                .try_into()
                .expect("Not Correct Length"),
        ));

    // need to check if there is change going back here
    let change_token_per_utxo: Vec<Assets> = tokens
        .clone()
        .split(MAXIMUM_TOKENS_PER_UTXO.try_into().unwrap());
    let number_of_change_utxo: usize = change_token_per_utxo.len();
    let mut lovelace_amount: u64 = total_lovelace;
    // a max tokens per change output here
    for (i, change) in change_token_per_utxo.iter().enumerate() {
        let datum_vector: Vec<u8> = Register::create(scalar)?.rerandomize()?.to_vec()?;
        let minimum: u64 = wallet_minimum_lovelace_with_assets(&params, change.clone())?;
        let change_lovelace: u64 = if i == number_of_change_utxo - 1 {
            // this is the last one or the only one
            lovelace_amount -= tmp_fee;
            lovelace_amount
        } else {
            // its additional tokens going back
            lovelace_amount -= minimum;
            minimum
        };

        let mut change_output: Output = Output::new(wallet_addr.clone(), change_lovelace)
            .set_inline_datum(datum_vector.clone());
        for asset in change.items.clone() {
            change_output = change_output
                .add_asset(asset.policy_id, asset.token_name, asset.amount)
                .unwrap();
        }
        draft_tx = draft_tx.output(change_output);
    }

    if number_of_change_utxo == 0 {
        // no tokens so we just need to account for the lovelace going back
        let datum_vector: Vec<u8> = Register::create(scalar)?.rerandomize()?.to_vec()?;
        let change_lovelace: u64 = lovelace_amount - tmp_fee;
        let change_output: Output = Output::new(wallet_addr.clone(), change_lovelace)
            .set_inline_datum(datum_vector.clone());
        draft_tx = draft_tx.output(change_output);
    }

    let mut raw_tx: StagingTransaction = draft_tx.clone().clear_fee();
    for i in 0..number_of_change_utxo + 1 {
        raw_tx = raw_tx.remove_output(number_of_change_utxo - i);
    }
    let intermediate_tx: BuiltTransaction = draft_tx.build_conway_raw().unwrap();

    let tx_size: u64 = intermediate_tx
        .sign(fee::fake_signer())
        .unwrap()
        .tx_bytes
        .0
        .len()
        .try_into()
        .unwrap();
    let tx_fee = fee::linear_fee(tx_size);
    println!(
        "{} {}",
        "\nTx Size Fee:".bright_blue(),
        tx_fee.to_string().bright_white()
    );

    raw_tx = raw_tx.fee(tx_fee);

    // need to check if there is change going back here
    let change_token_per_utxo: Vec<Assets> = tokens
        .clone()
        .split(MAXIMUM_TOKENS_PER_UTXO.try_into().unwrap());
    let number_of_change_utxo: usize = change_token_per_utxo.len();
    // a max tokens per change output here
    let mut lovelace_amount: u64 = total_lovelace;
    for (i, change) in change_token_per_utxo.iter().enumerate() {
        let datum_vector: Vec<u8> = Register::create(scalar)?.rerandomize()?.to_vec()?;
        let minimum: u64 = wallet_minimum_lovelace_with_assets(&params, change.clone())?;
        let change_lovelace: u64 = if i == number_of_change_utxo - 1 {
            // this is the last one or the only one
            lovelace_amount -= tx_fee;
            lovelace_amount
        } else {
            // its additional tokens going back
            lovelace_amount -= minimum;
            minimum
        };

        let mut change_output: Output = Output::new(wallet_addr.clone(), change_lovelace)
            .set_inline_datum(datum_vector.clone());
        for asset in change.items.clone() {
            change_output = change_output
                .add_asset(asset.policy_id, asset.token_name, asset.amount)
                .unwrap();
        }
        raw_tx = raw_tx.output(change_output);
    }

    if number_of_change_utxo == 0 {
        // no tokens so we just need to account for the lovelace going back
        let datum_vector: Vec<u8> = Register::create(scalar)?.rerandomize()?.to_vec()?;
        let change_lovelace: u64 = lovelace_amount - tx_fee;
        let change_output: Output = Output::new(wallet_addr.clone(), change_lovelace)
            .set_inline_datum(datum_vector.clone());
        raw_tx = raw_tx.output(change_output);
    }

    let tx: BuiltTransaction = raw_tx.build_conway_raw().unwrap();

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
