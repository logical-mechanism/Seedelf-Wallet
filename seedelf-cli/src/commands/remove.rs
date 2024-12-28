use clap::Args;
use blstrs::Scalar;
use hex;
use pallas_addresses::Address;
use pallas_crypto::key::ed25519::{SecretKey, PublicKey};
use pallas_primitives::Hash;
use pallas_traverse::fees;
use pallas_txbuilder::{BuildConway, Input, Output, StagingTransaction, BuiltTransaction};
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_cli::address;
use seedelf_cli::constants::{
    plutus_v3_cost_model, COLLATERAL_HASH, COLLATERAL_PUBLIC_KEY, SEEDELF_POLICY_ID,
};
use seedelf_cli::data_structures;
use seedelf_cli::koios::{
    evaluate_transaction, extract_bytes_with_logging,
    submit_tx, witness_collateral, UtxoResponse
};
use seedelf_cli::register::Register;
use seedelf_cli::schnorr::create_proof;
use seedelf_cli::transaction;
use seedelf_cli::utxos;
use seedelf_cli::setup;

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct RemoveArgs {
    #[arg(short = 's', long, help = "The Seedelf to remove.", display_order = 1)]
    seedelf: String,

    #[arg(short = 'a', long, help = "The address receiving the leftover ADA.", display_order = 2)]
    address: String,
}

pub async fn run(args: RemoveArgs, network_flag: bool) -> Result<(), String> {
    if network_flag {
        println!("\nRunning In Preprod Environment");
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
    let mut draft_tx: StagingTransaction = StagingTransaction::new();

    // we do this so I can initialize it to the empty vector
    let mut input_vector: Vec<Input> = Vec::new();

    // There is a single register here so we can do this
    let scalar: Scalar = setup::load_wallet();

    let seedelf_utxo: UtxoResponse= utxos::find_seedelf_utxo(args.seedelf.clone(), network_flag).await.ok_or("Seedelf Not Found".to_string()).unwrap();
    let seedelf_datum: Register = extract_bytes_with_logging(&seedelf_utxo.inline_datum).ok_or("Not Register Type".to_string()).unwrap();
    let total_lovelace: u64 = seedelf_utxo.value.parse::<u64>().expect("Invalid Lovelace");
    let seedelf_input: Input = Input::new(
        pallas_crypto::hash::Hash::new(
            hex::decode(seedelf_utxo.tx_hash.clone())
                .expect("Invalid hex string")
                .try_into()
                .expect("Failed to convert to 32-byte array"),
        ),
        seedelf_utxo.tx_index.clone(),
    );
    draft_tx = draft_tx.input(seedelf_input.clone());
    input_vector.push(seedelf_input.clone());

    // This is some semi legit fee to be used to estimate it
    let tmp_fee: u64 = 200_000;

    // we can fake the signature here to get the correct tx size
    let one_time_secret_key: SecretKey = SecretKey::new(&mut OsRng);
    let one_time_private_key: PrivateKey = PrivateKey::from(one_time_secret_key.clone());
    let public_key_hash: Hash<28> =
        pallas_crypto::hash::Hasher::<224>::hash(one_time_private_key.public_key().as_ref());
    let pkh: String = hex::encode(public_key_hash);

    // use the base register to rerandomize for the datum

    let (z, g_r) = create_proof(seedelf_datum, scalar, pkh.clone());
    let spend_redeemer_vector: Vec<u8> = data_structures::create_spend_redeemer(z, g_r, pkh.clone());
    let burn_redeemer_vector: Vec<u8> = data_structures::create_mint_redeemer("".to_string());

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
            input_vector.clone().remove(0),
            spend_redeemer_vector.clone(),
            Some(pallas_txbuilder::ExUnits {
                mem: 14_000_000,
                steps: 10_000_000_000,
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
        .disclosed_signer(pallas_crypto::hash::Hash::new(
            hex::decode(COLLATERAL_HASH)
                .unwrap()
                .try_into()
                .expect("Not Correct Length"),
        ));
    
    // this is what will be signed when the real fee is known
    let mut raw_tx: StagingTransaction = draft_tx
        .clone()
        .clear_fee()
        .clear_collateral_output()
        .remove_output(0)
        .remove_spend_redeemer(input_vector.clone().remove(0))
        .remove_mint_redeemer(pallas_crypto::hash::Hash::new(
            hex::decode(SEEDELF_POLICY_ID)
                .expect("Invalid hex string")
                .try_into()
                .expect("Failed to convert to 32-byte array"),
        ));

    let intermediate_tx: BuiltTransaction = draft_tx.build_conway_raw().unwrap();

    let mut mint_cpu_units: u64 = 0u64;
    let mut mint_mem_units: u64 = 0u64;

    let mut spend_cpu_units: u64 = 0u64;
    let mut spend_mem_units: u64 = 0u64;
    match evaluate_transaction(hex::encode(intermediate_tx.tx_bytes.as_ref()), network_flag).await {
        Ok(execution_units) => {
            if let Some(_error) = execution_units.get("error") {
                println!("Error: {:?}", execution_units);
                std::process::exit(1);
            }
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
        }
        Err(err) => {
            eprintln!("Failed to evaluate transaction: {}", err);
        }
    };

    // we can fake the signature here to get the correct tx size
    let fake_signer_secret_key: SecretKey = SecretKey::new(&mut OsRng);
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
    println!("\nTx Size Fee: {:?}", tx_fee);
    
    // This probably should be a function
    let compute_fee: u64 = transaction::computation_fee(mint_mem_units, mint_cpu_units) + transaction::computation_fee(spend_mem_units, spend_cpu_units);
    println!("Compute Fee: {:?}", compute_fee);

    // 587 for mint, 633 for spend
    let script_reference_fee: u64 = 587 * 15 + 633 * 15;
    println!("Script Reference Fee: {:?}", script_reference_fee);
    
    // total fee is the sum of everything
    let mut total_fee: u64 = tx_fee + compute_fee + script_reference_fee;
    // total fee needs to be even for the collateral calculation to work
    total_fee = if total_fee % 2 == 1 {
        total_fee + 1
    } else {
        total_fee
    };
    println!("Total Fee: {:?}", total_fee);

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
        );

    let tx: BuiltTransaction = raw_tx.build_conway_raw().unwrap();
    // need to witness it now
    let tx_cbor: String = hex::encode(tx.tx_bytes.as_ref());

    let public_key_vector: [u8; 32] = hex::decode(COLLATERAL_PUBLIC_KEY)
        .unwrap()
        .try_into()
        .unwrap();
    let witness_public_key: PublicKey = PublicKey::from(public_key_vector);

    match witness_collateral(tx_cbor.clone(), network_flag).await {
        Ok(witness) => {
            let witness_cbor = witness.get("witness").and_then(|v| v.as_str()).unwrap();
            let witness_sig = &witness_cbor[witness_cbor.len() - 128..];
            let witness_vector: [u8; 64] = hex::decode(witness_sig).unwrap().try_into().unwrap();

            let signed_tx_cbor = tx
                .sign(PrivateKey::from(one_time_secret_key.clone()))
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
            eprintln!("Failed to fetch UTxOs: {}\nWait a few moments and try again.", err);
        }
    }

    Ok(())
}