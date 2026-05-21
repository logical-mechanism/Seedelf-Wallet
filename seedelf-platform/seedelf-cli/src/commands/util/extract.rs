use clap::Args;
use colored::Colorize;
use pallas_addresses::Address;
use pallas_txbuilder::{BuildConway, BuiltTransaction, Input, Output, StagingTransaction};
use seedelf_core::data_structures;
use seedelf_koios::koios::{
    UtxoResponse, address_utxos, epoch_params, evaluate_transaction, utxo_info,
};

use crate::commands::fee;
use crate::web_server;
use anyhow::{Result, bail};
use seedelf_core::address;
use seedelf_core::assets::Assets;
use seedelf_core::constants::{Config, get_config};
use seedelf_core::transaction::{
    address_minimum_lovelace_with_assets, extract_budgets, reference_utxo, total_computation_fee,
};
use seedelf_core::utxos;
use seedelf_display::{display, text_coloring};

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct ExtractArgs {
    /// The UTxO to spend
    #[arg(short = 'u', long, help = "The UTxO to spend", display_order = 1)]
    pub utxo: String,

    #[arg(
        short = 'a',
        long,
        help = "The address receiving the funds",
        display_order = 2
    )]
    pub address: String,
}

pub async fn run(args: ExtractArgs, network_flag: bool, variant: u64) -> Result<()> {
    display::is_there_an_update().await;
    display::preprod_text(network_flag);

    let config: Config = get_config(variant, network_flag)?;
    let params = epoch_params(network_flag).await?;

    let collat_addr: Address = address::collateral_address(network_flag);
    // we need to make sure that the network flag and the address provided makes sense here
    let addr: Address = Address::from_bech32(args.address.as_str())
        .map_err(|e| anyhow::anyhow!("Supplied Address Is Incorrect: {e}"))?;
    if !(address::is_not_a_script(addr.clone())
        && address::is_on_correct_network(addr.clone(), network_flag))
    {
        bail!("Supplied Address Is Incorrect");
    }

    let empty_datum_utxo = match utxo_info(&args.utxo, network_flag).await {
        Ok(utxos) => {
            let utxo = utxos
                .first()
                .ok_or_else(|| anyhow::anyhow!("No UTxO Found"))?
                .clone();
            if utxo.inline_datum.is_some() {
                bail!("UTxO has datum");
            }
            let utxo_addr: Address = Address::from_bech32(&utxo.address)
                .map_err(|e| anyhow::anyhow!("UTxO address is not valid bech32: {e}"))?;
            if utxo_addr
                != address::wallet_contract(network_flag, config.contract.wallet_contract_hash)
            {
                bail!("UTxO not in wallet");
            }
            if utxo.is_spent {
                bail!("UTxO is spent");
            }
            utxo
        }
        Err(err) => {
            bail!("Failed to fetch UTxO: {err}\nWait a few moments and try again.");
        }
    };
    let (empty_utxo_lovelace, empty_utxo_tokens) =
        utxos::assets_of(vec![empty_datum_utxo.clone()])?;
    let minimum_lovelace: u64 =
        address_minimum_lovelace_with_assets(&params, &args.address, empty_utxo_tokens.clone())?;

    // this is used to calculate the real fee
    let mut draft_tx: StagingTransaction = StagingTransaction::new();
    // utxos
    let mut all_utxos: Vec<UtxoResponse> = Vec::new();
    let mut found_collateral: bool = false;

    // This should probably be some generalized function later
    match address_utxos(&args.address, network_flag).await {
        Ok(utxos) => {
            // loop all the utxos found from the address
            for utxo in utxos {
                // get the lovelace on this utxo
                let lovelace: u64 = utxo
                    .value
                    .parse::<u64>()
                    .map_err(|e| anyhow::anyhow!("UTxO has an invalid lovelace value: {e}"))?;
                if lovelace == 5_000_000 && !found_collateral {
                    draft_tx = draft_tx.collateral_input(Input::new(
                        pallas_crypto::hash::Hash::new(seedelf_core::transaction::decode_tx_hash(
                            &utxo.tx_hash,
                        )?),
                        utxo.tx_index,
                    ));
                    // we just want a single collateral here
                    found_collateral = true;
                } else {
                    // its probably not a collateral utxo
                    all_utxos.push(utxo.clone());
                }
            }
        }
        Err(err) => anyhow::bail!("Failed to fetch UTxOs: {err}"),
    }
    let usable_utxos: Vec<UtxoResponse> =
        utxos::select(&params, all_utxos, minimum_lovelace, Assets::new())?;
    if usable_utxos.is_empty() {
        bail!("Not Enough Lovelace/Tokens");
    }
    let (addr_lovelace, addr_tokens) = utxos::assets_of(usable_utxos.clone())?;

    let total_lovelace: u64 = addr_lovelace + empty_utxo_lovelace;
    let total_tokens: Assets = addr_tokens.merge(empty_utxo_tokens)?;

    // This is some semi legit fee to be used to estimate it
    let tmp_fee: u64 = 200_000;

    let spend_redeemer_vector =
        data_structures::create_spend_redeemer(String::new(), String::new(), String::new())?;
    let empty_input: Input = Input::new(
        pallas_crypto::hash::Hash::new(seedelf_core::transaction::decode_tx_hash(
            &empty_datum_utxo.tx_hash,
        )?),
        empty_datum_utxo.clone().tx_index,
    );
    draft_tx = draft_tx.input(empty_input.clone());
    draft_tx = draft_tx.add_spend_redeemer(
        empty_input.clone(),
        spend_redeemer_vector.clone(),
        Some(pallas_txbuilder::ExUnits {
            mem: 14_000_000,
            steps: 10_000_000_000,
        }),
    );

    for utxo in usable_utxos.clone() {
        // draft and raw are built the same here
        draft_tx = draft_tx.input(Input::new(
            pallas_crypto::hash::Hash::new(seedelf_core::transaction::decode_tx_hash(
                &utxo.tx_hash,
            )?),
            utxo.tx_index,
        ));
    }

    let mut extract_output: Output = Output::new(
        addr.clone(),
        seedelf_core::transaction::checked_lovelace(total_lovelace, &[tmp_fee])?,
    );
    for asset in total_tokens.items.clone() {
        extract_output = extract_output
            .add_asset(asset.policy_id, asset.token_name, asset.amount)
            .unwrap();
    }

    // build out the rest of the draft tx with the tmp fee
    draft_tx = draft_tx
        .output(extract_output)
        .collateral_output(fee::collateral_output(addr.clone(), tmp_fee)?)
        .fee(tmp_fee)
        .reference_input(reference_utxo(config.reference.wallet_reference_utxo))
        .language_view(
            pallas_txbuilder::ScriptKind::PlutusV3,
            params.cost_model_v3.clone(),
        );

    let intermediate_tx: BuiltTransaction = draft_tx.clone().build_conway_raw().unwrap();

    let mut raw_tx: StagingTransaction = draft_tx.clone().clear_fee().clear_collateral_output();
    raw_tx = raw_tx.remove_output(0);
    raw_tx = raw_tx.remove_spend_redeemer(empty_input.clone());

    let budgets: Vec<(u64, u64)> =
        match evaluate_transaction(hex::encode(intermediate_tx.tx_bytes.as_ref()), network_flag)
            .await
        {
            Ok(execution_units) => {
                if execution_units.get("error").is_some() {
                    anyhow::bail!("Transaction evaluation failed: {execution_units:?}");
                }
                let budgets: Vec<(u64, u64)> = extract_budgets(&execution_units);
                budgets
            }
            Err(err) => anyhow::bail!("Failed to evaluate transaction: {err}"),
        };

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

    let compute_fee: u64 = total_computation_fee(&params, budgets.clone());
    println!(
        "{} {}",
        "Compute Fee:".bright_blue(),
        compute_fee.to_string().bright_white()
    );

    let script_reference_fee: u64 = config.contract.wallet_contract_size * 15;
    println!(
        "{} {}",
        "Script Reference Fee:".bright_blue(),
        script_reference_fee.to_string().bright_white()
    );

    let total_fee: u64 = fee::total_with_even_rounding(tx_fee, compute_fee, script_reference_fee);
    println!(
        "{} {}",
        "Total Fee:".bright_blue(),
        total_fee.to_string().bright_white()
    );

    let mut extract_output: Output = Output::new(
        addr.clone(),
        seedelf_core::transaction::checked_lovelace(total_lovelace, &[total_fee])?,
    );
    for asset in total_tokens.items.clone() {
        extract_output = extract_output
            .add_asset(asset.policy_id, asset.token_name, asset.amount)
            .unwrap();
    }

    raw_tx = raw_tx
        .output(extract_output)
        .collateral_output(fee::collateral_output(collat_addr.clone(), total_fee)?)
        .fee(total_fee);

    let (cpu, mem) = budgets
        .first()
        .ok_or_else(|| anyhow::anyhow!("transaction evaluation returned no execution budgets"))?;
    raw_tx = raw_tx.add_spend_redeemer(
        empty_input.clone(),
        spend_redeemer_vector.clone(),
        Some(pallas_txbuilder::ExUnits {
            mem: *mem,
            steps: *cpu,
        }),
    );

    let tx: BuiltTransaction = raw_tx.build_conway_raw().unwrap();
    // need to witness it now
    let tx_cbor: String = hex::encode(tx.tx_bytes.as_ref());

    println!("\nTx Cbor: {}", tx_cbor.clone().white());

    // inject the tx cbor into the local webserver to prompt the wallet
    display::webserver_address();
    web_server::run_web_server(tx_cbor, network_flag).await;
    text_coloring::display_purple("Server has stopped.");

    Ok(())
}
