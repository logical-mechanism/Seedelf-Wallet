use clap::Args;
use blstrs::Scalar;
use pallas_addresses::Address;
use pallas_crypto::key::ed25519::{SecretKey, PublicKey};
use pallas_primitives::Hash;
use pallas_traverse::fees;
use pallas_txbuilder::{BuildConway, Input, Output, StagingTransaction, BuiltTransaction};
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_cli::address;
use seedelf_cli::assets::{Asset, Assets};
use seedelf_cli::constants::{
    plutus_v3_cost_model, COLLATERAL_HASH, COLLATERAL_PUBLIC_KEY
};
use seedelf_cli::data_structures;
use seedelf_cli::koios::{
    evaluate_transaction, extract_bytes_with_logging,
    submit_tx, witness_collateral,
};
use seedelf_cli::register::Register;
use seedelf_cli::schnorr::create_proof;
use seedelf_cli::transaction;
use seedelf_cli::utxos;
use seedelf_cli::setup;

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct TransforArgs {
    /// Seedelf to send funds too
    #[arg(short = 's', long, help = "The Seedelf receiving funds.", display_order = 1)]
    seedelf: String,

    /// The amount of ADA to send
    #[arg(short = 'l', long, help = "The amount of ADA being sent to the Seedelf.", display_order = 2)]
    lovelace: Option<u64>,

    /// Optional repeated `policy-id`
    #[arg(long = "policy-id", help = "The policy id for the asset.", display_order = 3)]
    policy_id: Option<Vec<String>>,

    /// Optional repeated `token-name`
    #[arg(long = "token-name", help = "The token name for the asset", display_order = 4)]
    token_name: Option<Vec<String>>,

    /// Optional repeated `amount`
    #[arg(long = "amount", help = "The amount for the asset", display_order = 5)]
    amount: Option<Vec<u64>>,
}

pub async fn run(args: TransforArgs, network_flag: bool) -> Result<(), String> {
    if network_flag {
        println!("\nRunning In Preprod Environment");
    }

    if  args.lovelace.is_none() && (args.policy_id.is_none() || args.token_name.is_none() || args.amount.is_none()) {
        return Err("Either --lovelace or a token must be specified.".to_string());
    }

    // lets collect the tokens if they exist
    let mut selected_tokens: Assets = Assets::new();
    if let (Some(policy_id), Some(token_name), Some(amount)) =
        (args.policy_id, args.token_name, args.amount)
    {
        if policy_id.len() != token_name.len() || policy_id.len() != amount.len() {
            return Err(
                "Error: Each --policy-id must have a corresponding --token-name and --amount."
                    .to_string(),
            );
        }

        for ((pid, tkn), amt) in policy_id
            .into_iter()
            .zip(token_name.into_iter())
            .zip(amount.into_iter())
        {
            if amt <= 0 {
                return Err("Error: Token Amount must be positive".to_string());
            }
            selected_tokens = selected_tokens.add(Asset::new(pid, tkn, amt));
        }
    }

    let minimum_lovelace: u64 =
        transaction::wallet_minimum_lovelace_with_assets(selected_tokens.clone());
    
    if args.lovelace.is_some_and(|x| x < minimum_lovelace) {
        return Err("Amount Too Small For Min UTxO".to_string());
    }

    let collat_addr: Address = address::collateral_address(network_flag);
    let wallet_addr: Address = address::wallet_contract(network_flag);

    // this is used to calculate the real fee
    let mut draft_tx: StagingTransaction = StagingTransaction::new();

    let mut input_vector: Vec<Input> = Vec::new();
    let mut register_vector: Vec<Register> = Vec::new();

    let lovelace_goal: u64 = args.lovelace.unwrap_or(minimum_lovelace);

    // if there is change going back then we need this to rerandomize a datum
    let scalar: Scalar = setup::load_wallet();

    let (seedelf_datum, usuable_utxos) = utxos::find_seedelf_and_wallet_utxos(scalar, args.seedelf, network_flag).await;
    // the extra 2.5 ADA should account for the change and fee
    let usuable_utxos = utxos::select(usuable_utxos, lovelace_goal + 2_500_000, Assets::new());
    let (total_lovelace_found, tokens) = utxos::assets_of(usuable_utxos.clone());
    let change_tokens: Assets = tokens.separate(selected_tokens.clone());

    for utxo in usuable_utxos.clone() {
        let this_input: Input = Input::new(
            pallas_crypto::hash::Hash::new(
                hex::decode(utxo.tx_hash.clone())
                    .expect("Invalid hex string")
                    .try_into()
                    .expect("Failed to convert to 32-byte array"),
            ),
            utxo.tx_index.clone(),
        );
        let inline_datum: Register = extract_bytes_with_logging(&utxo.inline_datum).ok_or("Not Register Type".to_string()).unwrap();
        // draft and raw are built the same here
        draft_tx = draft_tx.input(this_input.clone());
        input_vector.push(this_input.clone());
        // do the registers
        register_vector.push(inline_datum.clone());
    }

    // This is some semi legit fee to be used to estimate it
    let tmp_fee: u64 = 200_000;

    // we can fake the signature here to get the correct tx size
    let one_time_secret_key: SecretKey = SecretKey::new(&mut OsRng);
    let one_time_private_key: PrivateKey = PrivateKey::from(one_time_secret_key.clone());
    let public_key_hash: Hash<28> =
        pallas_crypto::hash::Hasher::<224>::hash(one_time_private_key.public_key().as_ref());
    let pkh: String = hex::encode(public_key_hash);

    let mut change_output: Output = Output::new(
        wallet_addr.clone(),
        total_lovelace_found - lovelace_goal - tmp_fee,
    )
    .set_inline_datum(Register::create(scalar).rerandomize().to_vec());
    for asset in change_tokens.items.clone() {
        change_output = change_output.add_asset(asset.policy_id, asset.token_name, asset.amount)
        .unwrap();
    }

    let mut transfer_output: Output = Output::new(
        wallet_addr.clone(),
            lovelace_goal,
    ).set_inline_datum(seedelf_datum.ok_or("Seedelf Not Found").unwrap().clone().rerandomize().to_vec());
    for asset in selected_tokens.items.clone() {
        transfer_output = transfer_output.add_asset(asset.policy_id, asset.token_name, asset.amount)
        .unwrap();
    }

    // build out the rest of the draft tx with the tmp fee
    draft_tx = draft_tx
        .output(transfer_output)
        .output(change_output)
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
    
    // Use zip to pair elements from the two lists
    for (input, datum) in input_vector.clone()
        .into_iter()
        .zip(register_vector.clone().into_iter())
    {
        let (z, g_r) = create_proof(datum, scalar, pkh.clone());
        let spend_redeemer_vector = data_structures::create_spend_redeemer(z, g_r, pkh.clone());
        draft_tx = draft_tx.add_spend_redeemer(
            input,
            spend_redeemer_vector.clone(),
            Some(pallas_txbuilder::ExUnits {
                mem: 14_000_000,
                steps: 10_000_000_000,
            }),
        )
    }

    // this is what will be signed when the real fee is known
    let mut raw_tx: StagingTransaction = draft_tx
        .clone()
        .clear_fee()
        .clear_collateral_output()
        .remove_output(1);

    // Use zip to pair elements from the two lists
    for input in input_vector.clone()
        .into_iter()
    {
        raw_tx = raw_tx.remove_spend_redeemer(
            input,
        );
    }

    let intermediate_tx: BuiltTransaction = draft_tx.build_conway_raw().unwrap();

    let mut budgets: Vec<(u64, u64)> = Vec::new();
    match evaluate_transaction(hex::encode(intermediate_tx.tx_bytes.as_ref()), network_flag).await {
        Ok(execution_units) => {
            if let Some(_error) = execution_units.get("error") {
                println!("{:?}", execution_units);
                std::process::exit(1);
            }
            budgets = transaction::extract_budgets(&execution_units)
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
    let compute_fee: u64 = transaction::total_computation_fee(budgets.clone());
    println!("Compute Fee: {:?}", compute_fee);

    // 587 for mint, 633 for spend
    let script_reference_fee: u64 = 633 * 15;
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

    let mut change_output: Output = Output::new(
        wallet_addr.clone(),
        total_lovelace_found - lovelace_goal - total_fee,
    )
    .set_inline_datum(Register::create(scalar).rerandomize().to_vec());

    for asset in change_tokens.items.clone() {
        change_output = change_output.add_asset(asset.policy_id, asset.token_name, asset.amount)
        .unwrap();
    }

    raw_tx = raw_tx
        .output(change_output)
        .collateral_output(Output::new(
            collat_addr.clone(),
            5_000_000 - (total_fee) * 3 / 2,
        ))
        .fee(total_fee);
    
    for ((input, datum), (cpu, mem)) in input_vector.clone()
        .into_iter()
        .zip(register_vector.clone().into_iter())
        .zip(budgets.clone().into_iter())
    {
        let (z, g_r) = create_proof(datum, scalar, pkh.clone());
        let spend_redeemer_vector = data_structures::create_spend_redeemer(z, g_r, pkh.clone());
        raw_tx = raw_tx.add_spend_redeemer(
            input,
            spend_redeemer_vector.clone(),
            Some(pallas_txbuilder::ExUnits {
                mem: mem,
                steps: cpu,
            }),
        )
    }

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
