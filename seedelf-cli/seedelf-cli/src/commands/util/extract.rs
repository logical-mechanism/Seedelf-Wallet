use clap::Args;
use colored::Colorize;
use pallas_addresses::Address;
use pallas_crypto::key::ed25519::SecretKey;
use pallas_traverse::fees;
use pallas_txbuilder::{BuildConway, BuiltTransaction, Input, Output, StagingTransaction};
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_core::data_structures;
use seedelf_koios::koios::{UtxoResponse, address_utxos, evaluate_transaction, utxo_info};

use seedelf_cli::web_server;
use seedelf_core::address;
use seedelf_core::assets::Assets;
use seedelf_core::constants::{Config, get_config, plutus_v3_cost_model};
use seedelf_core::transaction::{
    address_minimum_lovelace_with_assets, extract_budgets, reference_utxo, total_computation_fee,
};
use seedelf_core::utxos;
use seedelf_display::display;

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct ExtractArgs {
    /// The label to search with
    #[arg(short = 'u', long, help = "The UTxO to spend", display_order = 1)]
    utxo: String,

    #[arg(
        short = 'a',
        long,
        help = "The address receiving the funds",
        display_order = 2
    )]
    address: String,
}

pub async fn run(args: ExtractArgs, network_flag: bool, variant: u64) -> Result<(), String> {
    display::is_their_an_update().await;
    display::preprod_text(network_flag);

    let config: Config = get_config(variant, network_flag).unwrap_or_else(|| {
        eprintln!("Error: Invalid Variant");
        std::process::exit(1);
    });

    let collat_addr: Address = address::collateral_address(network_flag);
    // we need to make sure that the network flag and the address provided makes sense here
    let addr: Address = Address::from_bech32(args.address.as_str()).unwrap();
    if !(address::is_not_a_script(addr.clone())
        && address::is_on_correct_network(addr.clone(), network_flag))
    {
        return Err("Supplied Address Is Incorrect".to_string());
    }

    let mut empty_datum_utxo = UtxoResponse::default();
    match utxo_info(&args.utxo, network_flag).await {
        Ok(utxos) => {
            if !utxos.is_empty() {
                empty_datum_utxo = utxos.first().unwrap().clone();
                if empty_datum_utxo.inline_datum.is_some() {
                    return Err("UTxO has datum".to_string());
                }
                let utxo_addr: Address = Address::from_bech32(&empty_datum_utxo.address).unwrap();
                if utxo_addr != address::wallet_contract(network_flag, variant) {
                    return Err("UTxO not in wallet".to_string());
                }
                if empty_datum_utxo.is_spent {
                    return Err("UTxO is spent".to_string());
                }
            } else {
                return Err("No UTxO Found".to_string());
            }
        }
        Err(err) => {
            eprintln!("Failed to fetch UTxO: {err}\nWait a few moments and try again.");
        }
    }
    let (empty_utxo_lovelace, empty_utxo_tokens) = utxos::assets_of(vec![empty_datum_utxo.clone()])
        .unwrap_or_else(|e| {
            eprintln!("{e}");
            std::process::exit(1);
        });
    let minimum_lovelace: u64 =
        address_minimum_lovelace_with_assets(&args.address, empty_utxo_tokens.clone())
            .unwrap_or_else(|e| {
                eprintln!("{e}");
                std::process::exit(1);
            });

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
                let lovelace: u64 = utxo.value.parse::<u64>().expect("Invalid Lovelace");
                if lovelace == 5_000_000 && !found_collateral {
                    draft_tx = draft_tx.collateral_input(Input::new(
                        pallas_crypto::hash::Hash::new(
                            hex::decode(utxo.tx_hash.clone())
                                .expect("Invalid hex string")
                                .try_into()
                                .expect("Failed to convert to 32-byte array"),
                        ),
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
        Err(err) => {
            eprintln!("Failed to fetch UTxOs: {err}");
            std::process::exit(1);
        }
    }
    let usable_utxos: Vec<UtxoResponse> = utxos::select(all_utxos, minimum_lovelace, Assets::new());
    if usable_utxos.is_empty() {
        return Err("Not Enough Lovelace/Tokens".to_string());
    }
    let (addr_lovelace, addr_tokens) = utxos::assets_of(usable_utxos.clone()).unwrap_or_else(|e| {
        eprintln!("{e}");
        std::process::exit(1);
    });

    let total_lovelace: u64 = addr_lovelace + empty_utxo_lovelace;
    let total_tokens: Assets = addr_tokens.merge(empty_utxo_tokens);

    // This is some semi legit fee to be used to estimate it
    let tmp_fee: u64 = 200_000;

    let spend_redeemer_vector =
        data_structures::create_spend_redeemer(String::new(), String::new(), String::new())
            .unwrap_or_else(|e| {
                eprintln!("{e}");
                std::process::exit(1);
            });
    let empty_input: Input = Input::new(
        pallas_crypto::hash::Hash::new(
            hex::decode(empty_datum_utxo.tx_hash.clone())
                .expect("Invalid hex string")
                .try_into()
                .expect("Failed to convert to 32-byte array"),
        ),
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
            pallas_crypto::hash::Hash::new(
                hex::decode(utxo.tx_hash.clone())
                    .expect("Invalid hex string")
                    .try_into()
                    .expect("Failed to convert to 32-byte array"),
            ),
            utxo.tx_index,
        ));
    }

    let mut extract_output: Output = Output::new(addr.clone(), total_lovelace - tmp_fee);
    for asset in total_tokens.items.clone() {
        extract_output = extract_output
            .add_asset(asset.policy_id, asset.token_name, asset.amount)
            .unwrap();
    }

    // build out the rest of the draft tx with the tmp fee
    draft_tx = draft_tx
        .output(extract_output)
        .collateral_output(Output::new(addr.clone(), 5_000_000 - (tmp_fee) * 3 / 2))
        .fee(tmp_fee)
        .reference_input(reference_utxo(config.reference.wallet_reference_utxo))
        .language_view(
            pallas_txbuilder::ScriptKind::PlutusV3,
            plutus_v3_cost_model(),
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
                if let Some(_error) = execution_units.get("error") {
                    println!("{execution_units:?}");
                    std::process::exit(1);
                }
                let budgets: Vec<(u64, u64)> = extract_budgets(&execution_units);
                budgets
            }
            Err(err) => {
                eprintln!("Failed to evaluate transaction: {err}");
                std::process::exit(1);
            }
        };

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

    // This probably should be a function
    let compute_fee: u64 = total_computation_fee(budgets.clone());
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

    // total fee is the sum of everything
    let mut total_fee: u64 = tx_fee + compute_fee + script_reference_fee;
    // total fee needs to be even for the collateral calculation to work
    total_fee = if total_fee % 2 == 1 {
        total_fee + 1
    } else {
        total_fee
    };
    println!(
        "{} {}",
        "Total Fee:".bright_blue(),
        total_fee.to_string().bright_white()
    );

    let mut extract_output: Output = Output::new(addr.clone(), total_lovelace - total_fee);
    for asset in total_tokens.items.clone() {
        extract_output = extract_output
            .add_asset(asset.policy_id, asset.token_name, asset.amount)
            .unwrap();
    }

    raw_tx = raw_tx
        .output(extract_output)
        .collateral_output(Output::new(
            collat_addr.clone(),
            5_000_000 - (total_fee) * 3 / 2,
        ))
        .fee(total_fee);

    let (cpu, mem) = budgets.first().unwrap();
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
    web_server::run_web_server(tx_cbor, network_flag).await;

    Ok(())
}
