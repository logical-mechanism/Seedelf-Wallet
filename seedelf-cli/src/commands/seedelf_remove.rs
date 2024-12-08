use crate::setup;
use clap::Args;
use hex;
use pallas_addresses::Address;
use pallas_crypto;
use pallas_txbuilder::{BuildConway, Input, Output, StagingTransaction};
use pallas_wallet;
use rand_core::OsRng;
use seedelf_cli::address;
use seedelf_cli::constants::{plutus_v3_cost_model, COLLATERAL_HASH, SEEDELF_POLICY_ID, WALLET_CONTRACT_HASH, COLLATERAL_PUBLIC_KEY};
use seedelf_cli::data_structures;
use seedelf_cli::koios::{contains_policy_id, credential_utxos, extract_bytes_with_logging, evaluate_transaction, witness_collateral};
use seedelf_cli::schnorr::{create_proof, is_owned};
use seedelf_cli::transaction;
use pallas_traverse::fees;


/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct RemoveArgs {
    #[arg(long, help = "The seedelf to remove.")]
    seedelf: String,

    #[arg(long, help = "The receiving address.")]
    address: String,
}

pub async fn run(args: RemoveArgs, network_flag: bool) -> Result<(), String> {
    if network_flag {
        println!("Running in network_flag environment");
    }

    // we need to make sure that the network flag and the address provided makes sense here
    let addr: Address = Address::from_bech32(args.address.as_str()).unwrap();
    if !(address::is_not_a_script(addr.clone())
        && address::is_on_correct_network(addr.clone(), network_flag))
    {
        return Err("Supplied Address Is Incorrect".to_string());
    }

    // we need this as the address type and not the shelley
    let collat_addr: Address = address::collateral_address(network_flag);

    // this is used to calculate the real fee
    let mut draft_tx = StagingTransaction::new();

    // this is what will be signed when the real fee is known
    let mut raw_tx = StagingTransaction::new();

    let mut draft_vector: Vec<Input> = Vec::new();
    let mut raw_vector: Vec<Input> = Vec::new();

    // we will assume lovelace only right now
    let mut total_lovelace: u64 = 0;

    let mut generator: String = String::new();
    let mut public_value: String = String::new();

    let scalar = setup::load_wallet();

    // we need to make sure we found something to remove else err
    let mut found_seedelf: bool = false;

    match credential_utxos(WALLET_CONTRACT_HASH, network_flag).await {
        Ok(utxos) => {
            for utxo in utxos {
                // Extract bytes
                if let Some((gen, pub_val)) = extract_bytes_with_logging(&utxo.inline_datum) {
                    // utxo must be owned by this secret scaler
                    if is_owned(&gen, &pub_val, scalar) {
                        // its owned but lets not count the seedelf in the balance
                        if contains_policy_id(&utxo.asset_list, SEEDELF_POLICY_ID) {
                            let asset_name = utxo
                                .asset_list
                                .as_ref()
                                .and_then(|vec| {
                                    vec.iter()
                                        .find(|asset| asset.policy_id == SEEDELF_POLICY_ID)
                                        .map(|asset| &asset.asset_name)
                                })
                                .unwrap();
                            if asset_name == &args.seedelf {
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
                                draft_vector.push(Input::new(
                                    pallas_crypto::hash::Hash::new(
                                        hex::decode(utxo.tx_hash.clone())
                                            .expect("Invalid hex string")
                                            .try_into()
                                            .expect("Failed to convert to 32-byte array"),
                                    ),
                                    utxo.tx_index,
                                ));
                                raw_vector.push(Input::new(
                                    pallas_crypto::hash::Hash::new(
                                        hex::decode(utxo.tx_hash.clone())
                                            .expect("Invalid hex string")
                                            .try_into()
                                            .expect("Failed to convert to 32-byte array"),
                                    ),
                                    utxo.tx_index,
                                ));
                                // just sum up all the lovelace of the ada only inputs
                                total_lovelace += lovelace;
                                found_seedelf = true;
                                generator = gen;
                                public_value = pub_val;
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

    if !found_seedelf {
        return Err("Seedelf Not Found".to_string());
    }

    // This is some semi legit fee to be used to estimate it
    let tmp_fee: u64 = 200000;

    // we can fake the signature here to get the correct tx size
    let one_time_secret_key = pallas_crypto::key::ed25519::SecretKey::new(&mut OsRng);
    let one_time_private_key = pallas_wallet::PrivateKey::from(one_time_secret_key);
    let public_key_hash = pallas_crypto::hash::Hasher::<224>::hash(one_time_private_key.public_key().as_ref()).to_ascii_lowercase();
    let pkh = hex::encode(public_key_hash);

    // use the base register to rerandomize for the datum

    let (z, g_r) = create_proof(&generator, &public_value, scalar, &pkh.clone());
    let spend_redeemer_vector = data_structures::create_spend_redeemer(z, g_r, pkh.clone());
    let burn_redeemer_vector = data_structures::create_mint_redeemer("".to_string());

    // This is a staging output to calculate what the minimum required lovelace is for this output. Default it to 5 ADA so the bytes get calculated.
    let staging_output: Output = Output::new(addr.clone(), 5000000);
    let min_utxo: u64 = transaction::calculate_min_required_utxo(staging_output);
    println!("Minimum Required Lovelace: {:?}", min_utxo);

    // build out the rest of the draft tx with the tmp fee
    draft_tx = draft_tx
        .output(Output::new(addr.clone(), total_lovelace - tmp_fee))
        .collateral_input(transaction::collateral_input(network_flag))
        .collateral_output(Output::new(
            collat_addr.clone(),
            5000000 - (tmp_fee) * 3 / 2,
        ))
        .fee(tmp_fee)
        .mint_asset(
            pallas_crypto::hash::Hash::new(
                hex::decode(SEEDELF_POLICY_ID)
                    .unwrap()
                    .try_into()
                    .expect("Not Correct Length"),
            ),
            hex::decode(args.seedelf.clone()).unwrap(),
            -1,
        )
        .unwrap()
        .reference_input(transaction::seedelf_reference_utxo(network_flag))
        .reference_input(transaction::wallet_reference_utxo(network_flag))
        .add_spend_redeemer(
            draft_vector.remove(0),
            spend_redeemer_vector.clone(),
            Some(pallas_txbuilder::ExUnits {
                mem: 14000000,
                steps: 10000000000,
            }),
        )
        .add_mint_redeemer(
            pallas_crypto::hash::Hash::new(
                hex::decode(SEEDELF_POLICY_ID)
                    .expect("Invalid hex string")
                    .try_into()
                    .expect("Failed to convert to 32-byte array"),
            ),
            burn_redeemer_vector.clone(),
            Some(pallas_txbuilder::ExUnits {
                mem: 14000000,
                steps: 10000000000,
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
        .disclosed_signer(pallas_crypto::hash::Hash::new(
            hex::decode(COLLATERAL_HASH)
                .unwrap()
                .try_into()
                .expect("Not Correct Length"),
        ));

    let intermediate_tx = draft_tx.build_conway_raw().unwrap();

    let mut mint_cpu_units = 0u64;
    let mut mint_mem_units = 0u64;

    let mut spend_cpu_units = 0u64;
    let mut spend_mem_units = 0u64;
    match evaluate_transaction(hex::encode(intermediate_tx.tx_bytes.as_ref()), network_flag).await {
        Ok(execution_units) => {
            println!("{:?}", execution_units);
            spend_cpu_units = execution_units
                .pointer("/result/0/budget/cpu")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            spend_mem_units = execution_units
                .pointer("/result/0/budget/memory")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);

            mint_cpu_units = execution_units
                .pointer("/result/1/budget/cpu")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            mint_mem_units = execution_units
                .pointer("/result/1/budget/memory")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            println!("CPU: {}, Memory: {}", spend_cpu_units, spend_mem_units);
            println!("CPU: {}, Memory: {}", mint_cpu_units, mint_mem_units);
        }
        Err(err) => {
            eprintln!("Failed to fetch UTxOs: {}", err);
        }
    };

    // we can fake the signature here to get the correct tx size
    let fake_signer_secret_key = pallas_crypto::key::ed25519::SecretKey::new(&mut OsRng);
    let fake_signer_private_key = pallas_wallet::PrivateKey::from(fake_signer_secret_key);

    let tx_size: u64 = intermediate_tx
        .sign(one_time_private_key).unwrap()
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
    let compute_fee: u64 = (577 * (mint_mem_units + spend_mem_units) / 10000) + (721 * (mint_cpu_units + spend_cpu_units) / 10000000);
    println!("Estimated Compute Fee: {:?}", compute_fee);
    // I need a way to calculate this, its paying for the script data
    // but my calculation seems off. Should be 587*15 = 8805 but that is too small
    let script_reference_fee: u64 = 587*15 + 633*15; // hardcode this to 10k to make it work for now
    let total_fee: u64 = tx_fee + compute_fee + script_reference_fee;
    println!("Total Fee: {:?}", total_fee);

    raw_tx = raw_tx
        .output(Output::new(addr.clone(), total_lovelace - total_fee))
        .collateral_input(transaction::collateral_input(network_flag))
        .collateral_output(Output::new(
            collat_addr.clone(),
            5000000 - (total_fee) * 3 / 2,
        ))
        .fee(total_fee)
        .mint_asset(
            pallas_crypto::hash::Hash::new(
                hex::decode(SEEDELF_POLICY_ID)
                    .unwrap()
                    .try_into()
                    .expect("Not Correct Length"),
            ),
            hex::decode(args.seedelf.clone()).unwrap(),
            -1,
        )
        .unwrap()
        .reference_input(transaction::seedelf_reference_utxo(network_flag))
        .reference_input(transaction::wallet_reference_utxo(network_flag))
        .add_spend_redeemer(
            raw_vector.remove(0),
            spend_redeemer_vector.clone(),
            Some(pallas_txbuilder::ExUnits {
                mem: spend_mem_units,
                steps: spend_cpu_units,
            }),
        )
        .add_mint_redeemer(
            pallas_crypto::hash::Hash::new(
                hex::decode(SEEDELF_POLICY_ID)
                    .expect("Invalid hex string")
                    .try_into()
                    .expect("Failed to convert to 32-byte array"),
            ),
            burn_redeemer_vector.clone(),
            Some(pallas_txbuilder::ExUnits {
                mem: mint_mem_units,
                steps: mint_cpu_units,
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
        .disclosed_signer(pallas_crypto::hash::Hash::new(
            hex::decode(COLLATERAL_HASH)
                .unwrap()
                .try_into()
                .expect("Not Correct Length"),
        ));

        let mut tx = raw_tx.build_conway_raw().unwrap();
        // need to witness it now
        let tx_cbor = hex::encode(tx.tx_bytes.as_ref());

        let public_key_vector: [u8; 32] = hex::decode("COLLATERAL_PUBLIC_KEY")
        .unwrap()
        .try_into()
        .unwrap();
        let witness_public_key = pallas_crypto::key::ed25519::PublicKey::from(public_key_vector);
        match witness_collateral(tx_cbor.clone(), network_flag).await {
            Ok(witness) => {
                println!("Witness: {:?}", witness);
                tx = tx
                .sign(one_time_private_key).unwrap()
            }
            Err(err) => {
                eprintln!("Failed to fetch UTxOs: {}", err);
            }
        }
        

        println!("Tx Cbor: {:?}", tx_cbor.clone());

    Ok(())
}
