use crate::setup;
use clap::Args;
use hex;
use pallas_addresses::Address;
use pallas_crypto;
use pallas_traverse::fees;
use pallas_txbuilder::{BuildConway, Input, Output, StagingTransaction};
use pallas_wallet;
use rand_core::OsRng;
use seedelf_cli::address;
use seedelf_cli::constants::{plutus_v3_cost_model, SEEDELF_POLICY_ID};
use seedelf_cli::data_structures;
use seedelf_cli::koios::{address_utxos, evaluate_transaction};
use seedelf_cli::transaction;
use seedelf_cli::web_server;
use seedelf_cli::register::Register;

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct LabelArgs {
    #[arg(long, help = "The address paying for the seedelf.")]
    address: String,

    #[arg(long, help = "The seedelf label / personal tag.")]
    label: String,
}

pub async fn run(args: LabelArgs, network_flag: bool) -> Result<(), String> {
    // we need to make sure that the network flag and the address provided makes sense here
    let addr: Address = Address::from_bech32(args.address.as_str()).unwrap();
    if !(address::is_not_a_script(addr.clone())
        && address::is_on_correct_network(addr.clone(), network_flag))
    {
        return Err("Supplied Address Is Incorrect".to_string());
    }

    // we need this as the address type and not the shelley
    let wallet_addr: Address = address::wallet_contract(network_flag);

    // if preprod then print the preprod message
    if network_flag {
        println!("\nRunning In Preprod Environment");
    }

    // this is used to calculate the real fee
    let mut draft_tx: StagingTransaction = StagingTransaction::new();

    // this is what will be signed when the real fee is known
    let mut raw_tx: StagingTransaction = StagingTransaction::new();

    // we will assume lovelace only right now
    let mut total_lovelace: u64 = 0;
    // we need about 2 ada for the utxo and another 2 for change so make it 5
    let lovelace_goal: u64 = 5_000_000;

    // there may be many collateral utxos, we just need one
    let mut found_collateral: bool = false;

    // This should probably be some generalized function later
    match address_utxos(&args.address, network_flag).await {
        Ok(utxos) => {
            // loop all the utxos found from the address
            for utxo in utxos {
                // get the lovelace on this utxo
                let lovelace: u64 = utxo.value.parse::<u64>().expect("Invalid Lovelace");
                if lovelace == 5_000_000 {
                    // its probably a collateral utxo
                    // draft and raw are built the same here
                    if !found_collateral {
                        draft_tx = draft_tx.collateral_input(Input::new(
                            pallas_crypto::hash::Hash::new(
                                hex::decode(utxo.tx_hash.clone())
                                    .expect("Invalid hex string")
                                    .try_into()
                                    .expect("Failed to convert to 32-byte array"),
                            ),
                            utxo.tx_index,
                        ));
                        raw_tx = raw_tx.collateral_input(Input::new(
                            pallas_crypto::hash::Hash::new(
                                hex::decode(utxo.tx_hash)
                                    .expect("Invalid hex string")
                                    .try_into()
                                    .expect("Failed to convert to 32-byte array"),
                            ),
                            utxo.tx_index,
                        ));
                        // we just want a single collateral here
                        found_collateral = true;
                    }
                } else {
                    // its probably not a collateral utxo
                    //
                    // for now lets just pick up ada only UTxOs for now
                    if let Some(assets) = &utxo.asset_list {
                        if assets.is_empty() {
                            if total_lovelace < lovelace_goal {
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
                                        hex::decode(utxo.tx_hash)
                                            .expect("Invalid hex string")
                                            .try_into()
                                            .expect("Failed to convert to 32-byte array"),
                                    ),
                                    utxo.tx_index,
                                ));
                                // just sum up all the lovelace of the ada only inputs
                                total_lovelace += lovelace;
                            } else {
                                // we have met our lovelace goal
                                break;
                            }
                        }
                    }
                }
            }
        }
        Err(err) => {
            eprintln!("Failed to fetch UTxOs: {}", err);
        }
    }

    // if the seedelf isn't found then error
    if total_lovelace < lovelace_goal {
        return Err("Not Enough Lovelace".to_string());
    }
    
    // This is some semi legit fee to be used to estimate it
    let tmp_fee: u64 = 200_000;

    // this is going to be the datum on the seedelf
    let sk = setup::load_wallet();
    let datum_vector = Register::create(sk).rerandomize().to_vec();
    let redeemer_vector = data_structures::create_mint_redeemer(args.label.clone());

    // lets build the seelfelf token
    let token_name: Vec<u8> = transaction::seedelf_token_name(args.label.clone(), draft_tx.inputs.as_ref());

    // This is a staging output to calculate what the minimum required lovelace is for the seedelf output.
    // Default it to 5 ADA so the bytes get calculated.
    let staging_output: Output = Output::new(wallet_addr.clone(), 5_000_000)
        .set_inline_datum(datum_vector.clone())
        .add_asset(
            pallas_crypto::hash::Hash::new(
                hex::decode(SEEDELF_POLICY_ID)
                    .unwrap()
                    .try_into()
                    .expect("Not Correct Length"),
            ),
            token_name.clone(),
            1,
        )
        .unwrap();
    
    // use the staging output to calculate the minimum required lovelace
    let min_utxo: u64 = transaction::calculate_min_required_utxo(staging_output);
    println!("Minimum Required Lovelace: {:?}", min_utxo);

    // build out the rest of the draft tx with the tmp fee
    draft_tx = draft_tx
        .output(
            Output::new(wallet_addr.clone(), min_utxo)
                .set_inline_datum(datum_vector.clone())
                .add_asset(
                    pallas_crypto::hash::Hash::new(
                        hex::decode(SEEDELF_POLICY_ID)
                            .unwrap()
                            .try_into()
                            .expect("Not Correct Length"),
                    ),
                    token_name.clone(),
                    1,
                )
                .unwrap(),
        )
        .output(Output::new(
            addr.clone(),
            total_lovelace - min_utxo - tmp_fee,
        ))
        .collateral_output(Output::new(addr.clone(), 5_000_000 - (tmp_fee) * 3 / 2))
        .fee(tmp_fee)
        .mint_asset(
            pallas_crypto::hash::Hash::new(
                hex::decode(SEEDELF_POLICY_ID)
                    .unwrap()
                    .try_into()
                    .expect("Not Correct Length"),
            ),
            token_name.clone(),
            1,
        )
        .unwrap()
        .reference_input(transaction::seedelf_reference_utxo(network_flag))
        .add_mint_redeemer(
            pallas_crypto::hash::Hash::new(
                hex::decode(SEEDELF_POLICY_ID)
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

    // build an intermediate tx for fee estimation
    let intermediate_tx = draft_tx.build_conway_raw().unwrap();
    
    // Lets evaluate the transaction to get the execution units
    let mut cpu_units = 0u64;
    let mut mem_units = 0u64;
    match evaluate_transaction(hex::encode(intermediate_tx.tx_bytes.as_ref()), network_flag).await {
        Ok(execution_units) => {
            cpu_units = execution_units
                .pointer("/result/0/budget/cpu")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            mem_units = execution_units
                .pointer("/result/0/budget/memory")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            println!("CPU: {}, Memory: {}", cpu_units, mem_units);
        }
        Err(err) => {
            eprintln!("Failed to fetch UTxOs: {}", err);
        }
    };

    // we can fake the signature here to get the correct tx size
    let fake_signer_secret_key = pallas_crypto::key::ed25519::SecretKey::new(&mut OsRng);
    let fake_signer_private_key = pallas_wallet::PrivateKey::from(fake_signer_secret_key);

    // we need the script size here
    let tx_size: u64 = intermediate_tx
        .sign(fake_signer_private_key)
        .unwrap()
        .tx_bytes
        .0
        .len()
        .try_into()
        .unwrap();
    let tx_fee = fees::compute_linear_fee_policy(tx_size, &(fees::PolicyParams::default()));
    println!("Tx Size Fee: {:?}", tx_fee);
    
    // This probably should be a function
    let compute_fee: u64 = transaction::computation_fee(mem_units, cpu_units);
    println!("Compute Fee: {:?}", compute_fee);
    
    // minting script size is 587
    let script_reference_fee: u64 = 587 * 15;
    println!("Script Reference Fee: {:?}", script_reference_fee);

    // total fee is the sum
    let mut total_fee: u64 = tx_fee + compute_fee + script_reference_fee;
    // we add a single lovelace so the 3/2 * fee has no rounding issues during the collateral calculation
    total_fee = if total_fee % 2 == 1 {
        total_fee + 1
    } else {
        total_fee
    };
    println!("Total Fee: {:?}", total_fee);

    // build of the rest of the raw tx with the correct fee
    raw_tx = raw_tx
        .output(
            Output::new(wallet_addr.clone(), min_utxo)
                .set_inline_datum(datum_vector.clone())
                .add_asset(
                    pallas_crypto::hash::Hash::new(
                        hex::decode(SEEDELF_POLICY_ID)
                            .unwrap()
                            .try_into()
                            .expect("Not Correct Length"),
                    ),
                    token_name.clone(),
                    1,
                )
                .unwrap(),
        )
        .output(Output::new(
            addr.clone(),
            total_lovelace - min_utxo - total_fee,
        ))
        .collateral_output(Output::new(addr.clone(), 5_000_000 - (total_fee) * 3 / 2))
        .fee(total_fee)
        .mint_asset(
            pallas_crypto::hash::Hash::new(
                hex::decode(SEEDELF_POLICY_ID)
                    .unwrap()
                    .try_into()
                    .expect("Not Correct Length"),
            ),
            token_name.clone(),
            1,
        )
        .unwrap()
        .reference_input(transaction::seedelf_reference_utxo(network_flag))
        .add_mint_redeemer(
            pallas_crypto::hash::Hash::new(
                hex::decode(SEEDELF_POLICY_ID)
                    .expect("Invalid hex string")
                    .try_into()
                    .expect("Failed to convert to 32-byte array"),
            ),
            redeemer_vector.clone(),
            Some(pallas_txbuilder::ExUnits {
                mem: mem_units,
                steps: cpu_units,
            }),
        )
        .language_view(
            pallas_txbuilder::ScriptKind::PlutusV3,
            plutus_v3_cost_model(),
        );

    let tx = raw_tx.build_conway_raw().unwrap();

    let tx_cbor = hex::encode(tx.tx_bytes);
    println!("Tx Cbor: {:?}", tx_cbor.clone());

    // inject the tx cbor into the local webserver to prompt the wallet
    web_server::run_web_server(tx_cbor, network_flag).await;
    Ok(())
}
