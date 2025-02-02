use blstrs::Scalar;
use colored::Colorize;
use pallas_addresses::Address;
use pallas_crypto::key::ed25519::SecretKey;
use pallas_traverse::fees;
use pallas_txbuilder::{BuildConway, BuiltTransaction, Input, Output, StagingTransaction};
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_cli::address;
use seedelf_cli::assets::Assets;
use seedelf_cli::constants::MAXIMUM_TOKENS_PER_UTXO;
use seedelf_cli::convert;
use seedelf_cli::display::preprod_text;
use seedelf_cli::koios::{submit_tx, UtxoResponse};
use seedelf_cli::register::Register;
use seedelf_cli::setup;
use seedelf_cli::transaction::wallet_minimum_lovelace_with_assets;
use seedelf_cli::utxos;

pub async fn run(network_flag: bool, variant: u64) -> Result<(), String> {
    preprod_text(network_flag);
    println!("\n{}", "Sweeping All dApp UTxOs".bright_blue(),);

    let wallet_addr: Address = address::wallet_contract(network_flag, variant);

    // this is used to calculate the real fee
    let mut draft_tx: StagingTransaction = StagingTransaction::new();

    // if there is change going back then we need this to rerandomize a datum
    let scalar: Scalar = setup::load_wallet();

    let vkey = convert::secret_key_to_public_key(scalar);
    let addr = address::dapp_address(vkey.clone(), network_flag);
    let addr_bech32 = addr.to_bech32().unwrap();

    let all_utxos: Vec<UtxoResponse> =
        utxos::collect_all_address_utxos(&addr_bech32, network_flag).await;
    if all_utxos.is_empty() {
        return Err("Not Enough Lovelace/Tokens".to_string());
    }
    let (total_lovelace, tokens) = utxos::assets_of(all_utxos.clone());

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
        let datum_vector: Vec<u8> = Register::create(scalar).rerandomize().to_vec();
        let minimum: u64 = wallet_minimum_lovelace_with_assets(change.clone());
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
        let datum_vector: Vec<u8> = Register::create(scalar).rerandomize().to_vec();
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

    // we can fake the signature here to get the correct tx size
    let fake_signer_secret_key: SecretKey = SecretKey::new(OsRng);
    let fake_signer_private_key: PrivateKey = PrivateKey::from(fake_signer_secret_key);

    let tx_size: u64 = intermediate_tx
        .sign(fake_signer_private_key)
        .unwrap()
        .tx_bytes
        .0
        .len()
        .try_into()
        .unwrap();
    let tx_fee = fees::compute_linear_fee_policy(tx_size, &(fees::PolicyParams::default()));
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
        let datum_vector: Vec<u8> = Register::create(scalar).rerandomize().to_vec();
        let minimum: u64 = wallet_minimum_lovelace_with_assets(change.clone());
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
        let datum_vector: Vec<u8> = Register::create(scalar).rerandomize().to_vec();
        let change_lovelace: u64 = lovelace_amount - tx_fee;
        let change_output: Output = Output::new(wallet_addr.clone(), change_lovelace)
            .set_inline_datum(datum_vector.clone());
        raw_tx = raw_tx.output(change_output);
    }

    let tx: BuiltTransaction = raw_tx.build_conway_raw().unwrap();

    let signed_tx_cbor = tx.sign(convert::secret_key_to_private_key(scalar)).unwrap();

    println!(
        "\nTx Cbor: {}",
        hex::encode(signed_tx_cbor.tx_bytes.clone()).white()
    );

    match submit_tx(hex::encode(signed_tx_cbor.tx_bytes), network_flag).await {
        Ok(response) => {
            if let Some(_error) = response.get("contents") {
                println!("\nError: {}", response);
                std::process::exit(1);
            }
            println!("\nTransaction Successfully Submitted!");
            println!(
                "\nTx Hash: {}",
                response.as_str().unwrap_or("default").bright_cyan()
            );
            if network_flag {
                println!(
                    "{}",
                    format!(
                        "\nhttps://preprod.cardanoscan.io/transaction/{}",
                        response.as_str().unwrap_or("default")
                    )
                    .bright_purple()
                );
            } else {
                println!(
                    "{}",
                    format!(
                        "\nhttps://cardanoscan.io/transaction/{}",
                        response.as_str().unwrap_or("default")
                    )
                    .bright_purple()
                );
            }
        }
        Err(err) => {
            eprintln!("Failed to submit tx: {}", err);
        }
    }

    Ok(())
}
