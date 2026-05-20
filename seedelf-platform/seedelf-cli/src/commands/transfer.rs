use crate::commands::fee;
use crate::setup;
use anyhow::{Result, bail};
use blstrs::Scalar;
use clap::Args;
use colored::Colorize;
use pallas_addresses::Address;
use pallas_crypto::key::ed25519::{PublicKey, SecretKey};
use pallas_primitives::Hash;
use pallas_txbuilder::{BuildConway, BuiltTransaction, Input, Output, StagingTransaction};
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_core::address;
use seedelf_core::assets::Assets;
use seedelf_core::constants::{
    COLLATERAL_HASH, COLLATERAL_PUBLIC_KEY, Config, MAXIMUM_TOKENS_PER_UTXO, get_config,
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
    UtxoResponse, epoch_params, evaluate_transaction, extract_bytes_with_logging, submit_tx,
    witness_collateral,
};

/// Struct to hold command-specific arguments
#[derive(Args)]
pub(crate) struct TransforArgs {
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

    /// Native tokens for the *n*th seedelf in the same order as `--seedelfs`.
    /// Format `<policy_id>.<token_name>=<amount>`, comma-separated for multiple
    /// tokens going to the same seedelf. Pass an empty value (`--asset ""`)
    /// to skip a recipient.
    #[arg(
        long = "asset",
        value_name = "PID.TKN=AMT",
        action = clap::ArgAction::Append,
        num_args = 0..=1,
        default_missing_value = "",
        help = "Native tokens for the matching seedelf: <policy_id>.<token_name>=<amount>, comma-separated.",
        display_order = 3
    )]
    assets: Vec<String>,

    /// Optional repeated 'txId#txIdx'
    #[arg(long = "utxo", help = "The utxos to spend.", display_order = 6)]
    utxos: Option<Vec<String>>,
}

pub(crate) async fn run(args: TransforArgs, network_flag: bool, variant: u64) -> Result<()> {
    display::is_their_an_update().await;
    display::preprod_text(network_flag);

    let config: Config = get_config(variant, network_flag).unwrap_or_else(|| {
        eprintln!("Error: Invalid Variant");
        std::process::exit(1);
    });
    let params = epoch_params(network_flag).await?;

    if args.seedelfs.is_empty() {
        bail!("Error: Must be sending to at least 1 seedelf.");
    }

    let all_selected_tokens: Vec<Assets> = if args.assets.is_empty() {
        vec![Assets::new(); args.seedelfs.len()]
    } else {
        if args.assets.len() != args.seedelfs.len() {
            bail!(
                "--asset must be supplied once per --seedelfs (got {} assets for {} seedelfs); use empty `--asset \"\"` to skip a recipient",
                args.assets.len(),
                args.seedelfs.len()
            );
        }
        args.assets
            .iter()
            .map(|spec| Assets::parse(spec))
            .collect::<Result<Vec<_>>>()?
    };
    // calculate all the required minimums then check the lovelace
    let minimum_lovelaces: Vec<u64> = all_selected_tokens
        .iter()
        .map(|assets| {
            wallet_minimum_lovelace_with_assets(&params, assets.clone()).unwrap_or_default()
        })
        .collect();
    let lovelaces: Vec<u64> = args.lovelaces.unwrap_or_default();
    if lovelaces.len() != args.seedelfs.len() {
        bail!(
            "--lovelaces must be supplied once per --seedelfs (got {} values for {} seedelfs)",
            lovelaces.len(),
            args.seedelfs.len()
        );
    }
    let all_greater = lovelaces
        .iter()
        .zip(minimum_lovelaces.iter())
        .all(|(l, min)| l >= min);

    if !all_greater {
        bail!("Minimum lovelace not met")
    }

    // if there is change going back then we need this to rerandomize a datum
    let scalar: Scalar = setup::unlock_wallet_interactive();

    let seedelfs: Vec<String> = args.seedelfs;
    let selected_tokens: Vec<Assets> = all_selected_tokens;
    let selected_utxos: Option<Vec<String>> = args.utxos;

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
        utxos::select(
            &params,
            usable_utxos,
            total_lovelace,
            total_selected_tokens.clone(),
        )
        .unwrap_or_default()
    } else {
        // assumes the utxos hold the correct tokens else it will error downstream
        match utxos::parse_tx_utxos(selected_utxos.unwrap_or_default()) {
            Ok(parsed) => utxos::filter_utxos(usable_utxos, parsed),
            Err(_) => Vec::new(),
        }
    };

    if usable_utxos.is_empty() {
        bail!("No Usuable UTxOs Found");
    }

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
            .ok_or_else(|| anyhow::anyhow!("Wallet UTxO datum is not a Register"))?;
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
    for (((lovelace, assets), datum_opt), seedelf_id) in lovelaces
        .clone()
        .into_iter()
        .zip(selected_tokens.into_iter())
        .zip(seedelf_datums.into_iter())
        .zip(seedelfs.iter())
    {
        let datum =
            datum_opt.ok_or_else(|| anyhow::anyhow!("Seedelf {seedelf_id} not found on chain"))?;
        let inline = datum
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
            params.cost_model_v3.clone(),
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
        let minimum: u64 =
            wallet_minimum_lovelace_with_assets(&params, change.clone()).unwrap_or_default();
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
        // println!("{:}", lovelace_amount);
        // println!("{:}", total_lovelace);
        // println!("{:}", tmp_fee);
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

    let tx_size: u64 = intermediate_tx
        .sign(one_time_private_key)
        .unwrap()
        .sign(fee::fake_signer())
        .unwrap()
        .tx_bytes
        .0
        .len()
        .try_into()
        .unwrap();
    let tx_fee: u64 = fee::linear_fee(tx_size);

    let compute_fee: u64 = total_computation_fee(&params, budgets.clone());

    let script_reference_fee: u64 = config.contract.wallet_contract_size * 15;

    let total_fee: u64 = fee::total_with_even_rounding(tx_fee, compute_fee, script_reference_fee);

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
        let minimum: u64 =
            wallet_minimum_lovelace_with_assets(&params, change.clone()).unwrap_or_default();
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

    let signed_tx_cbor: BuiltTransaction =
        match witness_collateral(tx_cbor.clone(), network_flag).await {
            Ok(witness) => {
                let witness_cbor = match witness.get("witness").and_then(|v| v.as_str()) {
                    Some(w) if w.len() >= 128 => w,
                    _ => bail!("Collateral Service Returned Unexpected Response: {witness}"),
                };
                let witness_sig = &witness_cbor[witness_cbor.len() - 128..];
                let witness_vector: [u8; 64] = hex::decode(witness_sig)
                    .map_err(|e| anyhow::anyhow!("Collateral Witness Hex Decode Failed: {e}"))?
                    .try_into()
                    .map_err(|_| anyhow::anyhow!("Collateral Witness Wrong Length"))?;

                tx.sign(PrivateKey::from(one_time_secret_key.clone()))
                    .unwrap()
                    .add_signature(witness_public_key, witness_vector)
                    .unwrap()
            }
            Err(e) => bail!("Collateral Service Request Failed: {e}"),
        };

    let tx_hash = match submit_tx(hex::encode(signed_tx_cbor.clone().tx_bytes), network_flag).await
    {
        Ok(response) => {
            // println!("{:?}", response.clone());
            response.as_str().unwrap_or("default").to_string()
        }
        Err(_) => String::new(),
    };

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
