use clap::Args;
use pallas_addresses::Address;
use seedelf_cli::address;
use pallas_txbuilder::{BuildConway, Input, Output, StagingTransaction};
use pallas_traverse::fees;
use crate::setup;
use seedelf_cli::constants::{plutus_v3_cost_model, SEEDELF_POLICY_ID, WALLET_CONTRACT_HASH, COLLATERAL_HASH, COLLATERAL_PUBLIC_KEY};
use seedelf_cli::koios::{
    contains_policy_id, credential_utxos, evaluate_transaction, extract_bytes_with_logging,
    submit_tx, witness_collateral,
};
use seedelf_cli::schnorr::create_proof;
use rand_core::OsRng;
use seedelf_cli::transaction;
use seedelf_cli::register::Register;
use seedelf_cli::data_structures;

use serde_json::Value;

fn extract_budgets(value: &Value) -> Vec<(u64, u64)> {
    let mut budgets = Vec::new();

    // Ensure the value contains the expected "result" array
    if let Some(result_array) = value.get("result").and_then(|r| r.as_array()) {
        for item in result_array {
            if let Some(budget) = item.get("budget") {
                if let (Some(cpu), Some(memory)) = (
                    budget.get("cpu").and_then(|c| c.as_u64()),
                    budget.get("memory").and_then(|m| m.as_u64()),
                ) {
                    budgets.push((cpu, memory));
                }
            }
        }
    }

    budgets
}

fn total_computation_fee(budgets: Vec<(u64, u64)>) -> u64 {
    let mut fee: u64 = 0;
    for (cpu, mem) in budgets.into_iter() {
        fee += transaction::computation_fee(mem, cpu);
    }
    fee
}

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct SweepArgs {
    /// address that receives the funds
    #[arg(long, help = "The address receiving funds.")]
    address: String,

    /// The amount of ADA to send
    #[arg(long, help = "The amount of ADA being sent. Cannt be used with --all")]
    amount: Option<u64>,

    /// Send all funds if amount is not specified
    #[arg(long, help = "Send all funds. Cannot be used with --amount.")]
    all: bool,
}

pub async fn run(args: SweepArgs, network_flag: bool) -> Result<(), String>  {
    if network_flag {
        println!("Running In Preprod Environment");
    }

    if args.amount.is_none() && !args.all {
        return Err("Either --amount u64 or --all must be specified.".to_string());
    }

    if args.amount.is_some() && args.all {
        return Err("--amount u64 and --all cannot be used together.".to_string());
    }

    if args.amount.is_some_and(|x| x < 1_000_000) {
        return Err("Amount Too Small For Min UTxO".to_string());
    }

    // we need to make sure that the network flag and the address provided makes sense here
    let addr: Address = Address::from_bech32(args.address.as_str()).unwrap();
    if !(address::is_not_a_script(addr.clone())
        && address::is_on_correct_network(addr.clone(), network_flag))
    {
        return Err("Supplied Address Is Incorrect".to_string());
    }

    let collat_addr: Address = address::collateral_address(network_flag);
    let wallet_addr: Address = address::wallet_contract(network_flag);

    // this is used to calculate the real fee
    let mut draft_tx = StagingTransaction::new();

    // this is what will be signed when the real fee is known
    let mut raw_tx = StagingTransaction::new();

    let mut draft_input_vector: Vec<Input> = Vec::new();
    let mut draft_register_vector: Vec<Register> = Vec::new();
    let mut raw_input_vector: Vec<Input> = Vec::new();
    let mut raw_register_vector: Vec<Register> = Vec::new();

    // we will assume lovelace only right now
    let mut total_lovelace_found: u64 = 0;
    let mut number_of_utxos: u64 = 0;
    let max_utxos: u64 = 20;
    let lovelace_goal: u64 = args.amount.unwrap_or(0);

    // if there is change going back then we need this to rerandomize a datum
    let scalar = setup::load_wallet();

    match credential_utxos(WALLET_CONTRACT_HASH, network_flag).await {
        Ok(utxos) => {
            for utxo in utxos {
                // Extract bytes
                if let Some(inline_datum) = extract_bytes_with_logging(&utxo.inline_datum) {
                    // utxo must be owned by this secret scaler
                    if inline_datum.is_owned(scalar) {
                        // its owned but it can't hold a seedelf
                        if !contains_policy_id(&utxo.asset_list, SEEDELF_POLICY_ID) {
                            if args.all && number_of_utxos >= max_utxos {
                                // all is set and we hit the max utxos allowed in a single tx
                                println!("Hitting max utxos on send all");
                                break;
                            }
                            if !args.all && total_lovelace_found >= (lovelace_goal + 2_000_000) {
                                println!("found all the required lovelace");
                                // an amount implies changes so find another 2 ada
                                break;
                            }
                            if number_of_utxos >= max_utxos {
                                println!("too many utxos");
                                // if this ever happens then break
                                break;
                            }
                                let lovelace: u64 =
                                    utxo.value.parse::<u64>().expect("Invalid Lovelace");
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
                                raw_tx = raw_tx.input(Input::new(
                                    pallas_crypto::hash::Hash::new(
                                        hex::decode(utxo.tx_hash.clone())
                                            .expect("Invalid hex string")
                                            .try_into()
                                            .expect("Failed to convert to 32-byte array"),
                                    ),
                                    utxo.tx_index,
                                ));
                                draft_input_vector.push(Input::new(
                                    pallas_crypto::hash::Hash::new(
                                        hex::decode(utxo.tx_hash.clone())
                                            .expect("Invalid hex string")
                                            .try_into()
                                            .expect("Failed to convert to 32-byte array"),
                                    ),
                                    utxo.tx_index,
                                ));
                                raw_input_vector.push(Input::new(
                                    pallas_crypto::hash::Hash::new(
                                        hex::decode(utxo.tx_hash.clone())
                                            .expect("Invalid hex string")
                                            .try_into()
                                            .expect("Failed to convert to 32-byte array"),
                                    ),
                                    utxo.tx_index,
                                ));
                                // do the registers
                                draft_register_vector.push(inline_datum.clone());
                                raw_register_vector.push(inline_datum);
                                // just sum up all the lovelace of the ada only inputs
                                total_lovelace_found += lovelace;
                                number_of_utxos += 1;
                        }
                    }
                }
            }
        }
        Err(err) => {
            eprintln!("Failed to fetch UTxOs: {}", err);
        }
    }

    if !args.all && total_lovelace_found < (lovelace_goal + 2_000_000) {
        return Err("Not Enough Lovelace".to_string());
    }

    // This is some semi legit fee to be used to estimate it
    let tmp_fee: u64 = 200_000;

    // we can fake the signature here to get the correct tx size
    let one_time_secret_key = pallas_crypto::key::ed25519::SecretKey::new(&mut OsRng);
    let one_time_private_key = pallas_wallet::PrivateKey::from(one_time_secret_key.clone());
    let public_key_hash =
        pallas_crypto::hash::Hasher::<224>::hash(one_time_private_key.public_key().as_ref());
    let pkh = hex::encode(public_key_hash);

    // build out the rest of the draft tx with the tmp fee
    draft_tx = draft_tx
        .output(Output::new(addr.clone(), if lovelace_goal == 0 { total_lovelace_found - tmp_fee } else { lovelace_goal }))
        .collateral_input(transaction::collateral_input(network_flag))
        .collateral_output(Output::new(
            collat_addr.clone(),
            5_000_000 - (tmp_fee) * 3 / 2,
        ))
        .fee(tmp_fee)
        .reference_input(transaction::wallet_reference_utxo(network_flag))
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
        .disclosed_signer(pallas_crypto::hash::Hash::new(
            hex::decode(COLLATERAL_HASH)
                .unwrap()
                .try_into()
                .expect("Not Correct Length"),
        ));
    
    // need to check if there is change going back here
    if lovelace_goal != 0 {
        let datum_vector: Vec<u8> = Register::create(scalar).rerandomize().to_vec();
        let change_output: Output = Output::new(wallet_addr.clone(), total_lovelace_found - lovelace_goal - tmp_fee)
            .set_inline_datum(datum_vector.clone());
        draft_tx = draft_tx.output(change_output)
    }
    
    // Use zip to pair elements from the two lists
    for (input, datum) in draft_input_vector.into_iter().zip(draft_register_vector.into_iter()) {
        let (z, g_r) = create_proof(datum, scalar, pkh.clone());
        let spend_redeemer_vector = data_structures::create_spend_redeemer(z, g_r, pkh.clone());
        draft_tx = draft_tx.add_spend_redeemer(
                input,
                spend_redeemer_vector.clone(),
                Some(pallas_txbuilder::ExUnits {
                    mem: 14_000_000,
                    steps: 10_000_000_000,
                })
            )
    }
    let intermediate_tx = draft_tx.build_conway_raw().unwrap();

    let mut budgets = Vec::new();
    match evaluate_transaction(hex::encode(intermediate_tx.tx_bytes.as_ref()), network_flag).await {
        Ok(execution_units) => {
            if let Some(_error) = execution_units.get("error") {
                println!("{:?}", execution_units);
                std::process::exit(1);
            }
            budgets = extract_budgets(&execution_units)
        }
        Err(err) => {
            eprintln!("Failed to evaluate transaction: {}", err);
        }
    };
    // println!("{:?}", budgets);

    // we can fake the signature here to get the correct tx size
    let fake_signer_secret_key = pallas_crypto::key::ed25519::SecretKey::new(&mut OsRng);
    let fake_signer_private_key = pallas_wallet::PrivateKey::from(fake_signer_secret_key);

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
    let tx_fee = fees::compute_linear_fee_policy(tx_size, &(fees::PolicyParams::default()));
    println!("Estimated Tx Fee: {:?}", tx_fee);
    
    // This probably should be a function
    let compute_fee: u64 = total_computation_fee(budgets.clone()) ;
    println!("Estimated Compute Fee: {:?}", compute_fee);

    // 587 for mint, 633 for spend
    let script_reference_fee: u64 = 633 * 15;
    
    // total fee is the sum of everything
    let mut total_fee: u64 = tx_fee + compute_fee + script_reference_fee;
    // total fee needs to be even for the collateral calculation to work
    total_fee = if total_fee % 2 == 1 {
        total_fee + 1
    } else {
        total_fee
    };
    println!("Total Fee: {:?}", total_fee);

    // build out the rest of the draft tx with the tmp fee
    raw_tx = raw_tx
        .output(Output::new(addr.clone(), if lovelace_goal == 0 { total_lovelace_found - total_fee } else { lovelace_goal }))
        .collateral_input(transaction::collateral_input(network_flag))
        .collateral_output(Output::new(
            collat_addr.clone(),
            5_000_000 - (total_fee) * 3 / 2,
        ))
        .fee(total_fee)
        .reference_input(transaction::wallet_reference_utxo(network_flag))
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
        .disclosed_signer(pallas_crypto::hash::Hash::new(
            hex::decode(COLLATERAL_HASH)
                .unwrap()
                .try_into()
                .expect("Not Correct Length"),
        ));

    // need to check if there is change going back here
    if lovelace_goal != 0 {
        let datum_vector: Vec<u8> = Register::create(scalar).rerandomize().to_vec();
        let change_output: Output = Output::new(wallet_addr.clone(), total_lovelace_found - lovelace_goal - total_fee)
            .set_inline_datum(datum_vector.clone());
        raw_tx = raw_tx.output(change_output)
    }

    for ((input, datum), (cpu, mem)) in raw_input_vector.into_iter().zip(raw_register_vector.into_iter()).zip(budgets.into_iter()) {
        let (z, g_r) = create_proof(datum, scalar, pkh.clone());
        let spend_redeemer_vector = data_structures::create_spend_redeemer(z, g_r, pkh.clone());
        raw_tx = raw_tx.add_spend_redeemer(
                input,
                spend_redeemer_vector.clone(),
                Some(pallas_txbuilder::ExUnits {
                    mem: mem,
                    steps: cpu,
                })
            )
    }

    let tx = raw_tx.build_conway_raw().unwrap();
    // need to witness it now
    let tx_cbor = hex::encode(tx.tx_bytes.as_ref());

    let public_key_vector: [u8; 32] = hex::decode(COLLATERAL_PUBLIC_KEY)
        .unwrap()
        .try_into()
        .unwrap();
    let witness_public_key = pallas_crypto::key::ed25519::PublicKey::from(public_key_vector);

    match witness_collateral(tx_cbor.clone(), network_flag).await {
        Ok(witness) => {
            let witness_cbor = witness.get("witness").and_then(|v| v.as_str()).unwrap();
            let witness_sig = &witness_cbor[witness_cbor.len() - 128..];
            let witness_vector: [u8; 64] = hex::decode(witness_sig).unwrap().try_into().unwrap();

            let signed_tx_cbor = tx
                .sign(pallas_wallet::PrivateKey::from(one_time_secret_key.clone()))
                .unwrap()
                .add_signature(witness_public_key, witness_vector)
                .unwrap();

            println!(
                "\nTx Cbor: {:?}",
                hex::encode(signed_tx_cbor.tx_bytes.clone())
            );

            match submit_tx(hex::encode(signed_tx_cbor.tx_bytes), network_flag).await {
                Ok(response) => {
                    if let Some(_error) = response.get("contents") {
                        println!("\nError: {}", response);
                        std::process::exit(1);
                    }
                    println!("\nTransaction Successfully Submitted!");
                    println!("\nTx Hash: {}", response.as_str().unwrap_or("default"));
                    if network_flag {
                        println!(
                            "\nhttps://preprod.cardanoscan.io/transaction/{}",
                            response.as_str().unwrap_or("default")
                        );
                    } else {
                        println!(
                            "\nhttps://cardanoscan.io/transaction/{}",
                            response.as_str().unwrap_or("default")
                        );
                    }
                }
                Err(err) => {
                    eprintln!("Failed to submit tx: {}", err);
                }
            }
        }
        Err(err) => {
            eprintln!("Failed to fetch UTxOs: {}", err);
        }
    }

    Ok(())
}