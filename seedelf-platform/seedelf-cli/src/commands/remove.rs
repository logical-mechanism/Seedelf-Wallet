use crate::setup;
use anyhow::{Result, bail};
use blstrs::Scalar;
use clap::Args;
use colored::Colorize;
use hex;
use pallas_addresses::Address;
use pallas_crypto::key::ed25519::{PublicKey, SecretKey};
use pallas_primitives::Hash;
use pallas_traverse::fees;
use pallas_txbuilder::{BuildConway, BuiltTransaction, Input, Output, StagingTransaction};
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_core::address;
use seedelf_core::constants::{
    COLLATERAL_HASH, COLLATERAL_PUBLIC_KEY, Config, get_config, plutus_v3_cost_model,
};
use seedelf_core::data_structures;
use seedelf_core::transaction;
use seedelf_core::utxos;
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::{create_proof, random_scalar};
use seedelf_display::display;
use seedelf_koios::koios::{
    UtxoResponse, evaluate_transaction, extract_bytes_with_logging, submit_tx, witness_collateral,
};
use serde::Serialize;

#[derive(Serialize)]
pub struct RemoveSeedelfOutput {
    pub tx_cbor: String,
    pub tx_hash: String,
    pub tx_fee: u64,
    pub compute_fee: u64,
    pub script_reference_fee: u64,
    pub total_fee: u64,
    pub mint_cpu_units: u64,
    pub mint_mem_units: u64,
    pub spend_cpu_units: u64,
    pub spend_mem_units: u64,
}

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct RemoveArgs {
    #[arg(short = 's', long, help = "The seedelf to remove.", display_order = 1)]
    seedelf: String,

    #[arg(
        short = 'a',
        long,
        help = "The address receiving the leftover ADA.",
        display_order = 2
    )]
    address: String,
}

pub async fn run(args: RemoveArgs, network_flag: bool, variant: u64) -> Result<()> {
    display::is_their_an_update().await;
    display::preprod_text(network_flag);

    let config: Config = get_config(variant, network_flag).unwrap_or_else(|| {
        eprintln!("Error: Invalid Variant");
        std::process::exit(1);
    });

    // we need to make sure that the network flag and the address provided makes sense here
    let addr: Address = Address::from_bech32(args.address.as_str()).unwrap();
    if !(address::is_not_a_script(addr.clone())
        && address::is_on_correct_network(addr.clone(), network_flag))
    {
        bail!("Supplied Address Is Incorrect");
    }

    // There is a single register here so we can do this
    let scalar: Scalar = setup::unlock_wallet_interactive();

    let RemoveSeedelfOutput {
        tx_cbor,
        tx_hash,
        tx_fee,
        compute_fee,
        script_reference_fee,
        total_fee,
        mint_cpu_units,
        mint_mem_units,
        spend_cpu_units,
        spend_mem_units,
    } = build_remove_seedelf(config, network_flag, args.address, args.seedelf, scalar).await;

    if mint_cpu_units == 0 || mint_mem_units == 0 || spend_cpu_units == 0 || spend_mem_units == 0 {
        bail!("Invalid Transaction");
    }

    println!(
        "{} {}",
        "\nTx Size Fee:".bright_blue(),
        tx_fee.to_string().bright_white()
    );

    println!(
        "{} {}",
        "Compute Fee:".bright_blue(),
        compute_fee.to_string().bright_white()
    );

    println!(
        "{} {}",
        "Script Reference Fee:".bright_blue(),
        script_reference_fee.to_string().bright_white()
    );

    println!(
        "{} {}",
        "Total Fee:".bright_blue(),
        total_fee.to_string().bright_white()
    );

    println!("\nTx Cbor: {}", tx_cbor.white());

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

pub async fn build_remove_seedelf(
    config: Config,
    network_flag: bool,
    user_address: String,
    seedelf: String,
    scalar: Scalar,
) -> RemoveSeedelfOutput {
    let addr: Address = Address::from_bech32(&user_address).unwrap();

    // we need this as the address type and not the shelley
    let collat_addr: Address = address::collateral_address(network_flag);

    // this is used to calculate the real fee
    let mut draft_tx: StagingTransaction = StagingTransaction::new();

    // we do this so I can initialize it to the empty vector
    let mut input_vector: Vec<Input> = Vec::new();

    let every_utxo: Vec<UtxoResponse> =
        utxos::get_credential_utxos(config.contract.wallet_contract_hash, network_flag)
            .await
            .unwrap_or_default();
    let seedelf_utxo: UtxoResponse = match utxos::find_seedelf_utxo(
        seedelf.clone(),
        &config.contract.seedelf_policy_id,
        every_utxo,
    ) {
        Ok(Some(utxo)) => utxo,
        _ => UtxoResponse::default(),
    };

    let seedelf_datum: Register = extract_bytes_with_logging(&seedelf_utxo.inline_datum)
        .ok_or("Not Register Type".to_string())
        .unwrap_or_default();

    let total_lovelace: u64 = seedelf_utxo.value.parse::<u64>().unwrap_or_default();
    let seedelf_input: Input = Input::new(
        pallas_crypto::hash::Hash::new(
            hex::decode(seedelf_utxo.tx_hash.clone())
                .expect("Invalid hex string")
                .try_into()
                .expect("Failed to convert to 32-byte array"),
        ),
        seedelf_utxo.tx_index,
    );
    draft_tx = draft_tx.input(seedelf_input.clone());
    input_vector.push(seedelf_input.clone());

    // This is some semi legit fee to be used to estimate it
    let tmp_fee: u64 = 200_000;

    // generate a one time key pad
    let one_time_secret_key: SecretKey = SecretKey::new(OsRng);
    let one_time_private_key: PrivateKey = PrivateKey::from(one_time_secret_key.clone());
    let public_key_hash: Hash<28> =
        pallas_crypto::hash::Hasher::<224>::hash(one_time_private_key.public_key().as_ref());
    let pkh: String = hex::encode(public_key_hash);

    // use the base register to rerandomize for the datum

    let r: Scalar = random_scalar();
    let (z, g_r) = create_proof(seedelf_datum, scalar, pkh.clone(), r).unwrap_or_default();
    let spend_redeemer_vector: Vec<u8> =
        data_structures::create_spend_redeemer(z, g_r, pkh.clone()).unwrap_or_default();
    let burn_redeemer_vector: Vec<u8> =
        data_structures::create_mint_redeemer("".to_string()).unwrap_or_default();

    // build out the rest of the draft tx with the tmp fee
    draft_tx = draft_tx
        .output(Output::new(addr.clone(), total_lovelace - tmp_fee))
        .collateral_input(transaction::collateral_input(network_flag))
        .collateral_output(Output::new(
            collat_addr.clone(),
            5_000_000 - (tmp_fee) * 3 / 2,
        ))
        .fee(tmp_fee)
        .mint_asset(
            pallas_crypto::hash::Hash::new(
                hex::decode(&config.contract.seedelf_policy_id)
                    .unwrap()
                    .try_into()
                    .expect("Not Correct Length"),
            ),
            hex::decode(seedelf.clone()).unwrap(),
            -1,
        )
        .unwrap()
        .reference_input(transaction::reference_utxo(
            config.reference.seedelf_reference_utxo,
        ))
        .reference_input(transaction::reference_utxo(
            config.reference.wallet_reference_utxo,
        ))
        .add_spend_redeemer(
            input_vector.clone().remove(0),
            spend_redeemer_vector.clone(),
            Some(pallas_txbuilder::ExUnits {
                mem: 14_000_000,
                steps: 10_000_000_000,
            }),
        )
        .add_mint_redeemer(
            pallas_crypto::hash::Hash::new(
                hex::decode(&config.contract.seedelf_policy_id)
                    .expect("Invalid hex string")
                    .try_into()
                    .expect("Failed to convert to 32-byte array"),
            ),
            burn_redeemer_vector.clone(),
            Some(pallas_txbuilder::ExUnits {
                mem: 14_000_000,
                steps: 10_000_000_000,
            }),
        )
        .language_view(
            pallas_txbuilder::ScriptKind::PlutusV3,
            plutus_v3_cost_model(),
        )
        .disclosed_signer(pallas_crypto::hash::Hash::new(
            hex::decode(&pkh)
                .unwrap()
                .try_into()
                .expect("Not Correct Length"),
        ))
        .disclosed_signer(pallas_crypto::hash::Hash::new(COLLATERAL_HASH));

    // this is what will be signed when the real fee is known
    let mut raw_tx: StagingTransaction = draft_tx
        .clone()
        .clear_fee()
        .clear_collateral_output()
        .remove_output(0)
        .remove_spend_redeemer(input_vector.clone().remove(0))
        .remove_mint_redeemer(pallas_crypto::hash::Hash::new(
            hex::decode(&config.contract.seedelf_policy_id)
                .expect("Invalid hex string")
                .try_into()
                .expect("Failed to convert to 32-byte array"),
        ));

    let intermediate_tx: BuiltTransaction = draft_tx.build_conway_raw().unwrap();

    let (mint_cpu_units, mint_mem_units, spend_cpu_units, spend_mem_units) =
        match evaluate_transaction(hex::encode(intermediate_tx.tx_bytes.as_ref()), network_flag)
            .await
        {
            Ok(execution_units) => {
                if let Some(_error) = execution_units.get("error") {
                    println!("Error: {execution_units:?}");
                    std::process::exit(1);
                }
                let spend_cpu_units: u64 = execution_units
                    .pointer("/result/0/budget/cpu")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let spend_mem_units: u64 = execution_units
                    .pointer("/result/0/budget/memory")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);

                let mint_cpu_units: u64 = execution_units
                    .pointer("/result/1/budget/cpu")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let mint_mem_units: u64 = execution_units
                    .pointer("/result/1/budget/memory")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                (
                    mint_cpu_units,
                    mint_mem_units,
                    spend_cpu_units,
                    spend_mem_units,
                )
            }
            Err(_) => (0, 0, 0, 0),
        };

    // we can fake the signature here to get the correct tx size
    let fake_signer_secret_key: SecretKey = SecretKey::new(OsRng);
    let fake_signer_private_key: PrivateKey = PrivateKey::from(fake_signer_secret_key);

    let tx_size: u64 = intermediate_tx
        .sign(one_time_private_key)
        .unwrap()
        .sign(fake_signer_private_key)
        .unwrap()
        .tx_bytes
        .0
        .len()
        .try_into()
        .unwrap();
    let tx_fee: u64 = fees::compute_linear_fee_policy(tx_size, &(fees::PolicyParams::default()));
    let compute_fee: u64 = transaction::computation_fee(mint_mem_units, mint_cpu_units)
        + transaction::computation_fee(spend_mem_units, spend_cpu_units);
    let script_reference_fee: u64 =
        config.contract.seedelf_contract_size * 15 + config.contract.wallet_contract_size * 15;

    let mut total_fee: u64 = tx_fee + compute_fee + script_reference_fee;
    // total fee needs to be even for the collateral calculation to work
    total_fee = if total_fee % 2 == 1 {
        total_fee + 1
    } else {
        total_fee
    };

    raw_tx = raw_tx
        .output(Output::new(addr.clone(), total_lovelace - total_fee))
        .collateral_output(Output::new(
            collat_addr.clone(),
            5_000_000 - (total_fee) * 3 / 2,
        ))
        .fee(total_fee)
        .add_spend_redeemer(
            input_vector.clone().remove(0),
            spend_redeemer_vector.clone(),
            Some(pallas_txbuilder::ExUnits {
                mem: spend_mem_units,
                steps: spend_cpu_units,
            }),
        )
        .add_mint_redeemer(
            pallas_crypto::hash::Hash::new(
                hex::decode(&config.contract.seedelf_policy_id)
                    .expect("Invalid hex string")
                    .try_into()
                    .expect("Failed to convert to 32-byte array"),
            ),
            burn_redeemer_vector.clone(),
            Some(pallas_txbuilder::ExUnits {
                mem: mint_mem_units,
                steps: mint_cpu_units,
            }),
        );

    let tx: BuiltTransaction = raw_tx.build_conway_raw().unwrap();
    // need to witness it now
    let tx_cbor: String = hex::encode(tx.tx_bytes.as_ref());

    let witness_public_key: PublicKey = PublicKey::from(COLLATERAL_PUBLIC_KEY);

    let signed_tx_cbor: BuiltTransaction = match witness_collateral(tx_cbor.clone(), network_flag)
        .await
    {
        Ok(witness) => {
            let witness_cbor = witness.get("witness").and_then(|v| v.as_str()).unwrap();
            let witness_sig = &witness_cbor[witness_cbor.len() - 128..];
            let witness_vector: [u8; 64] = hex::decode(witness_sig).unwrap().try_into().unwrap();

            tx.sign(PrivateKey::from(one_time_secret_key.clone()))
                .unwrap()
                .add_signature(witness_public_key, witness_vector)
                .unwrap()
        }
        _ => tx,
    };

    let tx_hash = match submit_tx(hex::encode(signed_tx_cbor.clone().tx_bytes), network_flag).await
    {
        Ok(response) => response.as_str().unwrap_or("default").to_string(),
        Err(_) => String::new(),
    };

    RemoveSeedelfOutput {
        tx_cbor: hex::encode(signed_tx_cbor.clone().tx_bytes),
        tx_hash,
        tx_fee,
        compute_fee,
        script_reference_fee,
        total_fee,
        mint_cpu_units,
        mint_mem_units,
        spend_cpu_units,
        spend_mem_units,
    }
}
