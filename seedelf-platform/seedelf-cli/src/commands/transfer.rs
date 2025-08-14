use crate::setup;
use anyhow::{Result, bail};
use blstrs::Scalar;
use clap::Args;
use colored::Colorize;
use pallas_addresses::Address;
use pallas_crypto::key::ed25519::{PublicKey, SecretKey};
use pallas_primitives::Hash;
use pallas_traverse::fees;
use pallas_txbuilder::{BuildConway, BuiltTransaction, Input, Output, StagingTransaction};
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_core::address;
use seedelf_core::assets::{Asset, Assets};
use seedelf_core::constants::{
    COLLATERAL_HASH, COLLATERAL_PUBLIC_KEY, Config, MAXIMUM_TOKENS_PER_UTXO, get_config,
    plutus_v3_cost_model,
};
use seedelf_core::data_structures;
use seedelf_core::transaction::{
    collateral_input, extract_budgets, reference_utxo, total_computation_fee,
    wallet_minimum_lovelace_with_assets,
};
use seedelf_core::utxos;
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::{create_proof, random_scalar};
use seedelf_display::display;
use seedelf_koios::koios::{
    UtxoResponse, evaluate_transaction, extract_bytes_with_logging, submit_tx, witness_collateral,
};
use serde::Serialize;

#[derive(Serialize)]
pub struct TransferSeedelfOutput {
    pub tx_cbor: String,
    pub tx_hash: String,
    pub tx_fee: u64,
    pub compute_fee: u64,
    pub script_reference_fee: u64,
    pub total_fee: u64,
    pub usable_utxos: Vec<UtxoResponse>,
}

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct TransforArgs {
    /// seedelf to send funds too
    #[arg(
        short = 's',
        long,
        help = "The seedelfs receiving funds.",
        display_order = 1
    )]
    seedelfs: Vec<String>,

    /// The amount of ADA to send
    #[arg(
        short = 'l',
        long,
        help = "The amount of ADA being sent to the seedelfs.",
        display_order = 2
    )]
    lovelaces: Option<Vec<u64>>,

    /// repeated custom token string
    /// "pid1:tkn1=amt1,pid2:tkn2=amt2"
    #[arg(
        short = 't',
        long,
        action = clap::ArgAction::Append,      // collect occurrences
        num_args = 0..=1,                // allow bare flag; see note below
        default_missing_value = ""       // bare `--tokens` becomes ""
    )]
    pub tokens: Vec<String>,

    /// Optional repeated 'txId#txIdx'
    #[arg(long = "utxo", help = "The utxos to spend.", display_order = 6)]
    utxos: Option<Vec<String>>,
}

pub async fn run(args: TransforArgs, network_flag: bool, variant: u64) -> Result<()> {
    display::is_their_an_update().await;
    display::preprod_text(network_flag);

    let config: Config = get_config(variant, network_flag).unwrap_or_else(|| {
        eprintln!("Error: Invalid Variant");
        std::process::exit(1);
    });

    if args.seedelfs.is_empty() {
        bail!("Error: Must be sending to at least 1 seedelf.");
    }

    let mut all_selected_tokens: Vec<Assets> = Vec::new();
    if args.tokens.is_empty() {
        all_selected_tokens = vec![Assets::new(); args.seedelfs.len()];
    } else {
        // "pid1:tkn1=amt1,pid2:tkn2=amt2"
        for token in args.tokens {
            let mut selected_tokens: Assets = Assets::new();
            for part in token.split(',') {
                let part = part.trim();
                if part.is_empty() {
                    continue;
                }

                let (lhs, amt_str) = part.split_once('=').unwrap_or_default();
                let (pid, tkn) = lhs.split_once(':').unwrap_or_default();
                let amt: u64 = amt_str.trim().parse().unwrap_or_default();
                if pid.is_empty() || tkn.is_empty() || amt == 0 {
                    continue;
                }
                let new_asset = Asset::new(pid.to_string(), tkn.to_string(), amt)?;
                selected_tokens = selected_tokens.add(new_asset)?;
            }
            all_selected_tokens.push(selected_tokens);
        }
    }
    // calculate all the required minimums then check the lovelace
    let minimum_lovelaces: Vec<u64> = all_selected_tokens
        .iter()
        .map(|assets| wallet_minimum_lovelace_with_assets(assets.clone()).unwrap_or_default())
        .collect();
    let all_greater = args
        .lovelaces
        .clone()
        .unwrap_or_default()
        .iter()
        .zip(minimum_lovelaces.iter())
        .all(|(l, min)| l >= min);

    if !all_greater {
        bail!("Minimum lovelace not met")
    }

    // if there is change going back then we need this to rerandomize a datum
    let scalar: Scalar = setup::unlock_wallet_interactive();

    let TransferSeedelfOutput {
        tx_cbor,
        tx_hash,
        tx_fee,
        compute_fee,
        script_reference_fee,
        total_fee,
        usable_utxos,
    } = build_transfer_seedelf(
        config,
        network_flag,
        args.seedelfs,
        args.lovelaces.unwrap_or_default(),
        all_selected_tokens,
        args.utxos,
        scalar,
    )
    .await;

    if usable_utxos.is_empty() {
        bail!("No Usuable UTxOs Found");
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

    println!("\nTx Cbor: {}", tx_cbor.clone().white());

    if tx_hash.is_empty() {
        println!("\nTransaction Successfully Failed!");
    } else {
        println!("\nTransaction Successfully Submitted!");
        println!("\nTx Hash: {}", tx_hash.bright_cyan());
        if network_flag {
            println!(
                "{}",
                format!("\nhttps://preprod.cardanoscan.io/transaction/{}", tx_hash).bright_purple()
            );
        } else {
            println!(
                "{}",
                format!("\nhttps://cardanoscan.io/transaction/{}", tx_hash).bright_purple()
            );
        }
    }

    Ok(())
}

pub async fn build_transfer_seedelf(
    config: Config,
    network_flag: bool,
    seedelfs: Vec<String>,
    lovelaces: Vec<u64>,
    selected_tokens: Vec<Assets>,
    selected_utxos: Option<Vec<String>>,
    scalar: Scalar,
) -> TransferSeedelfOutput {
    let collat_addr: Address = address::collateral_address(network_flag);
    let wallet_addr: Address =
        address::wallet_contract(network_flag, config.contract.wallet_contract_hash);

    // this is used to calculate the real fee
    let mut draft_tx: StagingTransaction = StagingTransaction::new();

    let mut input_vector: Vec<Input> = Vec::new();
    let mut register_vector: Vec<Register> = Vec::new();

    let every_utxo_at_script: Vec<UtxoResponse> =
        utxos::get_credential_utxos(config.contract.wallet_contract_hash, network_flag)
            .await
            .unwrap_or_default();

    let usable_utxos = utxos::collect_wallet_utxos(
        scalar,
        &config.contract.seedelf_policy_id,
        every_utxo_at_script.clone(),
    )
    .unwrap_or_default();

    let seedelf_datums: Vec<Option<Register>> = seedelfs
        .iter()
        .map(|s| {
            utxos::find_seedelf_datum(
                s.to_string(),
                &config.contract.seedelf_policy_id,
                every_utxo_at_script.clone(),
            )
            .ok()
            .flatten()
        })
        .collect();

    let total_lovelace: u64 = lovelaces.iter().sum();
    // println!("{:?}", total_lovelace.clone());
    let total_selected_tokens: Assets = selected_tokens
        .clone()
        .into_iter()
        .fold(Assets::new(), |acc, a| acc.merge(a).unwrap_or(acc));
    let usable_utxos: Vec<UtxoResponse> = if selected_utxos.is_none() {
        utxos::select(usable_utxos, total_lovelace, total_selected_tokens.clone())
            .unwrap_or_default()
    } else {
        // assumes the utxos hold the correct tokens else it will error downstream
        match utxos::parse_tx_utxos(selected_utxos.unwrap_or_default()) {
            Ok(parsed) => utxos::filter_utxos(usable_utxos, parsed),
            Err(_) => Vec::new(),
        }
    };

    let (total_lovelace_found, tokens) = utxos::assets_of(usable_utxos.clone()).unwrap_or_default();
    let change_tokens: Assets = tokens
        .separate(total_selected_tokens.clone())
        .unwrap_or_default();

    for utxo in usable_utxos.clone() {
        let this_input: Input = Input::new(
            pallas_crypto::hash::Hash::new(
                hex::decode(utxo.tx_hash.clone())
                    .expect("Invalid hex string")
                    .try_into()
                    .expect("Failed to convert to 32-byte array"),
            ),
            utxo.tx_index,
        );
        let inline_datum: Register = extract_bytes_with_logging(&utxo.inline_datum)
            .ok_or("Not Register Type".to_string())
            .unwrap();
        // draft and raw are built the same here
        draft_tx = draft_tx.input(this_input.clone());
        input_vector.push(this_input.clone());
        // do the registers
        register_vector.push(inline_datum.clone());
    }

    // This is some semi legit fee to be used to estimate it
    let tmp_fee: u64 = 200_000;

    // we can fake the signature here to get the correct tx size
    let one_time_secret_key: SecretKey = SecretKey::new(OsRng);
    let one_time_private_key: PrivateKey = PrivateKey::from(one_time_secret_key.clone());
    let public_key_hash: Hash<28> =
        pallas_crypto::hash::Hasher::<224>::hash(one_time_private_key.public_key().as_ref());
    let pkh: String = hex::encode(public_key_hash);

    // println!("{:?}", lovelaces.len());
    // println!("{:?}", selected_tokens.len());
    // println!("{:?}", seedelf_datums.len());
    for ((lovelace, assets), datum_opt) in lovelaces
        .into_iter()
        .zip(selected_tokens.into_iter())
        .zip(seedelf_datums.into_iter())
    {
        let inline = datum_opt
            .unwrap()
            .rerandomize()
            .unwrap_or_default()
            .to_vec()
            .unwrap_or_default();

        // println!("{:?}", lovelace.clone());
        // println!("{:?}", inline.clone());
        let mut out = Output::new(wallet_addr.clone(), lovelace).set_inline_datum(inline);

        for asset in assets.items {
            out = out
                .add_asset(asset.policy_id, asset.token_name, asset.amount)
                .unwrap();
        }
        draft_tx = draft_tx.output(out); // ← one .output per triplet
    }

    // build out the rest of the draft tx with the tmp fee
    draft_tx = draft_tx
        .collateral_input(collateral_input(network_flag))
        .collateral_output(Output::new(
            collat_addr.clone(),
            5_000_000 - (tmp_fee) * 3 / 2,
        ))
        .fee(tmp_fee)
        .reference_input(reference_utxo(config.reference.wallet_reference_utxo))
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

    // add in the change outputs here
    let change_token_per_utxo: Vec<Assets> = change_tokens
        .clone()
        .split(MAXIMUM_TOKENS_PER_UTXO.try_into().unwrap());
    let mut number_of_change_utxo: usize = change_token_per_utxo.len();
    // a max tokens per change output here
    let mut lovelace_amount: u64 = total_lovelace_found;
    for (i, change) in change_token_per_utxo.iter().enumerate() {
        let datum_vector: Vec<u8> = Register::create(scalar)
            .unwrap_or_default()
            .rerandomize()
            .unwrap_or_default()
            .to_vec()
            .unwrap_or_default();
        let minimum: u64 = wallet_minimum_lovelace_with_assets(change.clone()).unwrap_or_default();
        let change_lovelace: u64 = if i == number_of_change_utxo - 1 {
            // this is the last one or the only one
            lovelace_amount = lovelace_amount - total_lovelace - tmp_fee;
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
        let datum_vector: Vec<u8> = Register::create(scalar)
            .unwrap_or_default()
            .rerandomize()
            .unwrap_or_default()
            .to_vec()
            .unwrap_or_default();
        let change_lovelace: u64 = lovelace_amount - total_lovelace - tmp_fee;
        let change_output: Output = Output::new(wallet_addr.clone(), change_lovelace)
            .set_inline_datum(datum_vector.clone());
        draft_tx = draft_tx.output(change_output);
        number_of_change_utxo += 1;
    }

    // Use zip to pair elements from the two lists
    for (input, datum) in input_vector
        .clone()
        .into_iter()
        .zip(register_vector.clone().into_iter())
    {
        let r: Scalar = random_scalar();
        let (z, g_r) = create_proof(datum, scalar, pkh.clone(), r).unwrap_or_default();
        let spend_redeemer_vector =
            data_structures::create_spend_redeemer(z, g_r, pkh.clone()).unwrap_or_default();
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
    let mut raw_tx: StagingTransaction = draft_tx.clone().clear_fee().clear_collateral_output();
    for i in 0..number_of_change_utxo {
        raw_tx = raw_tx.remove_output(seedelfs.len() - 1 + number_of_change_utxo - i);
    }

    // Use zip to pair elements from the two lists
    for input in input_vector.clone().into_iter() {
        raw_tx = raw_tx.remove_spend_redeemer(input);
    }

    let intermediate_tx: BuiltTransaction = draft_tx.build_conway_raw().unwrap();
    // println!("{:}",hex::encode(intermediate_tx.tx_bytes.as_ref()));

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

    // This probably should be a function
    let compute_fee: u64 = total_computation_fee(budgets.clone());

    let script_reference_fee: u64 = config.contract.wallet_contract_size * 15;

    // total fee is the sum of everything
    let mut total_fee: u64 = tx_fee + compute_fee + script_reference_fee;
    // total fee needs to be even for the collateral calculation to work
    total_fee = if total_fee % 2 == 1 {
        total_fee + 1
    } else {
        total_fee
    };

    raw_tx = raw_tx
        .collateral_output(Output::new(
            collat_addr.clone(),
            5_000_000 - (total_fee) * 3 / 2,
        ))
        .fee(total_fee);

    // add in the change outputs here
    let change_token_per_utxo: Vec<Assets> = change_tokens
        .clone()
        .split(MAXIMUM_TOKENS_PER_UTXO.try_into().unwrap());
    let number_of_change_utxo: usize = change_token_per_utxo.len();
    // a max tokens per change output here
    let mut lovelace_amount: u64 = total_lovelace_found;
    for (i, change) in change_token_per_utxo.iter().enumerate() {
        let datum_vector: Vec<u8> = Register::create(scalar)
            .unwrap_or_default()
            .rerandomize()
            .unwrap_or_default()
            .to_vec()
            .unwrap_or_default();
        let minimum: u64 = wallet_minimum_lovelace_with_assets(change.clone()).unwrap_or_default();
        let change_lovelace: u64 = if i == number_of_change_utxo - 1 {
            // this is the last one or the only one
            lovelace_amount = lovelace_amount - total_lovelace - total_fee;
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
        let datum_vector: Vec<u8> = Register::create(scalar)
            .unwrap_or_default()
            .rerandomize()
            .unwrap_or_default()
            .to_vec()
            .unwrap_or_default();
        let change_lovelace: u64 = lovelace_amount - total_lovelace - total_fee;
        let change_output: Output = Output::new(wallet_addr.clone(), change_lovelace)
            .set_inline_datum(datum_vector.clone());
        raw_tx = raw_tx.output(change_output);
    }

    for ((input, datum), (cpu, mem)) in input_vector
        .clone()
        .into_iter()
        .zip(register_vector.clone().into_iter())
        .zip(budgets.clone().into_iter())
    {
        let r: Scalar = random_scalar();
        let (z, g_r) = create_proof(datum, scalar, pkh.clone(), r).unwrap_or_default();
        let spend_redeemer_vector =
            data_structures::create_spend_redeemer(z, g_r, pkh.clone()).unwrap_or_default();
        raw_tx = raw_tx.add_spend_redeemer(
            input,
            spend_redeemer_vector.clone(),
            Some(pallas_txbuilder::ExUnits { mem, steps: cpu }),
        )
    }

    let tx: BuiltTransaction = raw_tx.build_conway_raw().unwrap();
    // need to witness it now
    let tx_cbor: String = hex::encode(tx.tx_bytes.as_ref());
    // println!("{:}", tx_cbor.clone());

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
        Ok(response) => {
            // println!("{:?}", response.clone());
            response.as_str().unwrap_or("default").to_string()
        }
        Err(_) => String::new(),
    };
    //
    TransferSeedelfOutput {
        tx_cbor,
        tx_hash,
        tx_fee,
        compute_fee,
        script_reference_fee,
        total_fee,
        usable_utxos,
    }
}
