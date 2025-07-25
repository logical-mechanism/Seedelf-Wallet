use anyhow::{Result, bail};
use blstrs::Scalar;
use clap::Args;
use colored::Colorize;
use hex;
use pallas_addresses::Address;
use pallas_crypto::key::ed25519::SecretKey;
use pallas_traverse::fees;
use pallas_txbuilder::{BuildConway, BuiltTransaction, Input, Output, StagingTransaction};
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_cli::setup;
use seedelf_cli::web_server;
use seedelf_core::address;
use seedelf_core::assets::Assets;
use seedelf_core::constants::{Config, get_config, plutus_v3_cost_model};
use seedelf_core::data_structures;
use seedelf_core::transaction;
use seedelf_core::utxos;
use seedelf_crypto::register::Register;
use seedelf_display::display;
use seedelf_koios::koios::{UtxoResponse, address_utxos, evaluate_transaction};

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct LabelArgs {
    #[arg(
        short = 'a',
        long,
        help = "The address paying for the seedelf.",
        display_order = 1
    )]
    address: String,

    #[arg(
        short = 'l',
        long,
        help = "The seedelf label / personal tag.",
        display_order = 2
    )]
    label: Option<String>,
}

pub async fn run(args: LabelArgs, network_flag: bool, variant: u64) -> Result<()> {
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

    // we need this as the address type and not the shelley
    let wallet_addr: Address =
        address::wallet_contract(network_flag, config.contract.wallet_contract_hash);

    // this is used to calculate the real fee
    let mut draft_tx: StagingTransaction = StagingTransaction::new();

    // we need about 2 ada for the utxo
    let tmp_fee: u64 = 205_000;
    let lovelace_goal: u64 = transaction::seedelf_minimum_lovelace()? + tmp_fee;

    // there may be many collateral utxos, we just need one
    let mut found_collateral: bool = false;

    // if the label is none then just use the empty string
    let label: String = args.label.unwrap_or_default();

    // utxos
    let mut all_utxos: Vec<UtxoResponse> = Vec::new();

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
    // lovelace goal here should account for the estimated fee
    let selected_utxos: Vec<UtxoResponse> = utxos::select(all_utxos, lovelace_goal, Assets::new())?;
    for utxo in selected_utxos.clone() {
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

    let (total_lovelace, tokens) = utxos::assets_of(selected_utxos)?;

    // if the seedelf isn't found then error
    if total_lovelace < lovelace_goal {
        bail!("Not Enough Lovelace");
    }

    // this is going to be the datum on the seedelf
    let scalar: Scalar = setup::unlock_wallet_interactive();
    let datum_vector: Vec<u8> = Register::create(scalar)?.rerandomize()?.to_vec()?;
    let redeemer_vector: Vec<u8> = data_structures::create_mint_redeemer(label.clone())?;

    // lets build the seelfelf token
    let token_name: Vec<u8> =
        transaction::seedelf_token_name(label.clone(), draft_tx.inputs.as_ref())?;
    println!(
        "{} {}",
        "\nCreating Seedelf:".bright_blue(),
        hex::encode(token_name.clone()).bright_white()
    );

    let min_utxo: u64 = transaction::seedelf_minimum_lovelace()?;
    println!(
        "{} {}",
        "\nMinimum Required Lovelace:".bright_blue(),
        min_utxo.to_string().bright_white()
    );

    let mut change_output: Output = Output::new(addr.clone(), total_lovelace - min_utxo - tmp_fee);
    for asset in tokens.items.clone() {
        change_output = change_output
            .add_asset(asset.policy_id, asset.token_name, asset.amount)
            .unwrap();
    }

    // build out the rest of the draft tx with the tmp fee
    draft_tx = draft_tx
        .output(
            Output::new(wallet_addr.clone(), min_utxo)
                .set_inline_datum(datum_vector.clone())
                .add_asset(
                    pallas_crypto::hash::Hash::new(
                        hex::decode(&config.contract.seedelf_policy_id)
                            .unwrap()
                            .try_into()
                            .expect("Not Correct Length"),
                    ),
                    token_name.clone(),
                    1,
                )
                .unwrap(),
        )
        .output(change_output)
        .collateral_output(Output::new(addr.clone(), 5_000_000 - (tmp_fee) * 3 / 2))
        .fee(tmp_fee)
        .mint_asset(
            pallas_crypto::hash::Hash::new(
                hex::decode(&config.contract.seedelf_policy_id)
                    .unwrap()
                    .try_into()
                    .expect("Not Correct Length"),
            ),
            token_name.clone(),
            1,
        )
        .unwrap()
        .reference_input(transaction::reference_utxo(
            config.reference.seedelf_reference_utxo,
        ))
        .add_mint_redeemer(
            pallas_crypto::hash::Hash::new(
                hex::decode(&config.contract.seedelf_policy_id)
                    .expect("Invalid hex string")
                    .try_into()
                    .expect("Failed to convert to 32-byte array"),
            ),
            redeemer_vector.clone(),
            Some(pallas_txbuilder::ExUnits {
                mem: 14_000_000,
                steps: 10_000_000_000,
            }),
        )
        .language_view(
            pallas_txbuilder::ScriptKind::PlutusV3,
            plutus_v3_cost_model(),
        );

    // clone the tx but remove the tmp fee, collateral, change output, and fake redeemer
    let mut raw_tx: StagingTransaction = draft_tx
        .clone()
        .clear_fee()
        .clear_collateral_output()
        .remove_output(1)
        .remove_mint_redeemer(pallas_crypto::hash::Hash::new(
            hex::decode(&config.contract.seedelf_policy_id)
                .expect("Invalid hex string")
                .try_into()
                .expect("Failed to convert to 32-byte array"),
        ));

    // build an intermediate tx for fee estimation
    let intermediate_tx: BuiltTransaction = draft_tx.build_conway_raw().unwrap();

    // Lets evaluate the transaction to get the execution units
    let (cpu_units, mem_units) =
        match evaluate_transaction(hex::encode(intermediate_tx.tx_bytes.as_ref()), network_flag)
            .await
        {
            Ok(execution_units) => {
                if let Some(_error) = execution_units.get("error") {
                    println!("Error: {execution_units:?}");
                    std::process::exit(1);
                }
                let cpu_units: u64 = execution_units
                    .pointer("/result/0/budget/cpu")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let mem_units: u64 = execution_units
                    .pointer("/result/0/budget/memory")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                (cpu_units, mem_units)
            }
            Err(err) => {
                eprintln!("Failed to evaluate transaction: {err}");
                std::process::exit(1);
            }
        };

    // we can fake the signature here to get the correct tx size
    let fake_signer_secret_key: SecretKey = SecretKey::new(OsRng);
    let fake_signer_private_key: PrivateKey = PrivateKey::from(fake_signer_secret_key);

    // we need the script size here
    let tx_size: u64 = intermediate_tx
        .sign(fake_signer_private_key)
        .unwrap()
        .tx_bytes
        .0
        .len()
        .try_into()
        .unwrap();
    let tx_fee: u64 = fees::compute_linear_fee_policy(tx_size, &(fees::PolicyParams::default()));
    println!(
        "{} {}",
        "\nTx Size Fee:".bright_blue(),
        tx_fee.to_string().bright_white()
    );

    // This probably should be a function
    let compute_fee: u64 = transaction::computation_fee(mem_units, cpu_units);
    println!(
        "{} {}",
        "Compute Fee:".bright_blue(),
        compute_fee.to_string().bright_white()
    );

    let script_reference_fee: u64 = config.contract.seedelf_contract_size * 15;
    println!(
        "{} {}",
        "Script Reference Fee:".bright_blue(),
        script_reference_fee.to_string().bright_white()
    );

    // total fee is the sum
    let mut total_fee: u64 = tx_fee + compute_fee + script_reference_fee;
    // we add a single lovelace so the 3/2 * fee has no rounding issues during the collateral calculation
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

    let mut change_output: Output =
        Output::new(addr.clone(), total_lovelace - min_utxo - total_fee);
    for asset in tokens.items.clone() {
        change_output = change_output
            .add_asset(asset.policy_id, asset.token_name, asset.amount)
            .unwrap();
    }

    // build of the rest of the raw tx with the correct fee
    raw_tx = raw_tx
        .output(change_output)
        .collateral_output(Output::new(addr.clone(), 5_000_000 - (total_fee) * 3 / 2))
        .fee(total_fee)
        .add_mint_redeemer(
            pallas_crypto::hash::Hash::new(
                hex::decode(&config.contract.seedelf_policy_id)
                    .expect("Invalid hex string")
                    .try_into()
                    .expect("Failed to convert to 32-byte array"),
            ),
            redeemer_vector.clone(),
            Some(pallas_txbuilder::ExUnits {
                mem: mem_units,
                steps: cpu_units,
            }),
        );

    let tx: BuiltTransaction = raw_tx.build_conway_raw().unwrap();

    let tx_cbor: String = hex::encode(tx.tx_bytes);
    println!("\nTx Cbor: {}", tx_cbor.clone().white());

    // inject the tx cbor into the local webserver to prompt the wallet
    web_server::run_web_server(tx_cbor, network_flag).await;

    Ok(())
}
