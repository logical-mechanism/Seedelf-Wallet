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
use seedelf_cli::setup;
use seedelf_core::address;
use seedelf_core::assets::Assets;
use seedelf_core::constants::{
    COLLATERAL_HASH, COLLATERAL_PUBLIC_KEY, Config, MAXIMUM_TOKENS_PER_UTXO, get_config,
    plutus_v3_cost_model,
};
use seedelf_core::data_structures;
use seedelf_core::transaction::{
    collateral_input, extract_budgets, reference_utxo, seedelf_minimum_lovelace,
    seedelf_token_name, total_computation_fee, wallet_minimum_lovelace_with_assets,
};
use seedelf_core::utxos;
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::{create_proof, random_scalar};
use seedelf_display::display;
use seedelf_koios::koios::{
    UtxoResponse, evaluate_transaction, extract_bytes_with_logging, submit_tx, witness_collateral,
};
/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct MintArgs {
    #[arg(
        short = 'l',
        long,
        help = "The seedelf label / personal tag.",
        display_order = 1
    )]
    label: Option<String>,

    #[arg(
        short = 'g',
        long,
        help = "A generator point in G1.",
        display_order = 2,
        requires = "public_value"
    )]
    generator: Option<String>,

    #[arg(
        short = 'p',
        long,
        help = "A public value computed as `generator * sk`",
        display_order = 3,
        requires = "generator"
    )]
    public_value: Option<String>,

    /// Optional repeated 'txId#txIdx'
    #[arg(long = "utxo", help = "The utxos to spend.", display_order = 4)]
    utxos: Option<Vec<String>>,
}

pub async fn run(args: MintArgs, network_flag: bool, variant: u64) -> Result<()> {
    display::is_their_an_update().await;
    display::preprod_text(network_flag);

    let config: Config = get_config(variant, network_flag).unwrap_or_else(|| {
        eprintln!("Error: Invalid Variant");
        std::process::exit(1);
    });

    // we need this as the address type and not the shelley
    let wallet_addr: Address =
        address::wallet_contract(network_flag, config.contract.wallet_contract_hash);
    let collat_addr: Address = address::collateral_address(network_flag);

    // this is used to calculate the real fee
    let mut draft_tx: StagingTransaction = StagingTransaction::new();

    let mut input_vector: Vec<Input> = Vec::new();
    let mut register_vector: Vec<Register> = Vec::new();

    // we need about 2 ada for the utxo
    let tmp_fee: u64 = 205_000;
    let lovelace_goal: u64 = seedelf_minimum_lovelace()? + tmp_fee;

    // if the label is none then just use the empty string
    let label: String = args.label.unwrap_or_default();

    // if there is change going back then we need this to rerandomize a datum
    let scalar: Scalar = setup::unlock_wallet_interactive();

    let every_utxo: Vec<UtxoResponse> =
        utxos::get_credential_utxos(config.contract.wallet_contract_hash, network_flag).await?;
    let owned_utxos: Vec<UtxoResponse> =
        utxos::collect_wallet_utxos(scalar, config.contract.seedelf_policy_id, every_utxo)?;

    let usable_utxos: Vec<UtxoResponse> = if args.utxos.is_none() {
        utxos::select(owned_utxos, lovelace_goal, Assets::default())?
    } else {
        // assumes the utxos hold the correct tokens else it will error downstream
        match utxos::parse_tx_utxos(args.utxos.unwrap_or_default()) {
            Ok(parsed) => utxos::filter_utxos(owned_utxos, parsed),
            Err(e) => {
                eprintln!("Unable To Parse UTxOs Error: {e}");
                // nothing works if you are not spending anything, this could be an exit
                Vec::new()
            }
        }
    };

    if usable_utxos.is_empty() {
        bail!("No Usuable UTxOs Found");
    }
    let (total_lovelace, change_tokens) = utxos::assets_of(usable_utxos.clone())?;

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
        draft_tx = draft_tx.input(this_input.clone());
        input_vector.push(this_input.clone());
        // do the registers
        register_vector.push(inline_datum.clone());
    }

    // lets build the seelfelf token
    let token_name: Vec<u8> = seedelf_token_name(label.clone(), draft_tx.inputs.as_ref())?;
    println!(
        "{} {}",
        "\nCreating Seedelf:".bright_blue(),
        hex::encode(token_name.clone()).bright_white()
    );

    let min_utxo: u64 = seedelf_minimum_lovelace()?;
    println!(
        "{} {}",
        "\nMinimum Required Lovelace:".bright_blue(),
        min_utxo.to_string().bright_white()
    );

    // this is the new seedelf datum
    let datum_vector: Vec<u8> = if args.generator.is_none() && args.public_value.is_none() {
        Register::create(scalar)?.rerandomize()?.to_vec()?
    } else {
        // both have to be some to get to this point
        // requires should catch the mix cases
        let new_register: Register = Register::new(
            args.generator.unwrap_or_default(),
            args.public_value.unwrap_or_default(),
        );
        if new_register.is_valid()? {
            new_register.to_vec()?
        } else {
            bail!("Provided Register Is Invalid");
        }
    };
    let redeemer_vector: Vec<u8> = data_structures::create_mint_redeemer(label.clone())?;

    let seedelf_output: Output = Output::new(wallet_addr.clone(), min_utxo)
        .set_inline_datum(datum_vector.clone())
        .add_asset(
            pallas_crypto::hash::Hash::new(
                hex::decode(config.contract.seedelf_policy_id)
                    .unwrap()
                    .try_into()
                    .expect("Not Correct Length"),
            ),
            token_name.clone(),
            1,
        )
        .unwrap();

    // we can fake the signature here to get the correct tx size
    let one_time_secret_key: SecretKey = SecretKey::new(OsRng);
    let one_time_private_key: PrivateKey = PrivateKey::from(one_time_secret_key.clone());
    let public_key_hash: Hash<28> =
        pallas_crypto::hash::Hasher::<224>::hash(one_time_private_key.public_key().as_ref());
    let pkh: String = hex::encode(public_key_hash);

    // build out the rest of the draft tx with the tmp fee
    draft_tx = draft_tx
        .output(seedelf_output)
        .collateral_input(collateral_input(network_flag))
        .collateral_output(Output::new(
            collat_addr.clone(),
            5_000_000 - (tmp_fee) * 3 / 2,
        ))
        .fee(tmp_fee)
        .mint_asset(
            pallas_crypto::hash::Hash::new(
                hex::decode(config.contract.seedelf_policy_id)
                    .unwrap()
                    .try_into()
                    .expect("Not Correct Length"),
            ),
            token_name.clone(),
            1,
        )
        .unwrap()
        .reference_input(reference_utxo(config.reference.seedelf_reference_utxo))
        .add_mint_redeemer(
            pallas_crypto::hash::Hash::new(
                hex::decode(config.contract.seedelf_policy_id)
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

    // need to check if there is change going back here
    let change_token_per_utxo: Vec<Assets> = change_tokens
        .clone()
        .split(MAXIMUM_TOKENS_PER_UTXO.try_into().unwrap());
    let mut number_of_change_utxo: usize = change_token_per_utxo.len();
    let mut lovelace_amount: u64 = total_lovelace;
    // a max tokens per change output here
    for (i, change) in change_token_per_utxo.iter().enumerate() {
        let datum_vector: Vec<u8> = Register::create(scalar)?.rerandomize()?.to_vec()?;
        let minimum: u64 = wallet_minimum_lovelace_with_assets(change.clone())?;
        let change_lovelace: u64 = if i == number_of_change_utxo - 1 {
            // this is the last one or the only one
            lovelace_amount = lovelace_amount - min_utxo - tmp_fee;
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
        let datum_vector: Vec<u8> = Register::create(scalar)?.rerandomize()?.to_vec()?;
        let change_lovelace: u64 = lovelace_amount - min_utxo - tmp_fee;
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
        let (z, g_r) = create_proof(datum, scalar, pkh.clone(), r)?;
        let spend_redeemer_vector = data_structures::create_spend_redeemer(z, g_r, pkh.clone());
        draft_tx = draft_tx.add_spend_redeemer(
            input,
            spend_redeemer_vector?.clone(),
            Some(pallas_txbuilder::ExUnits {
                mem: 14_000_000,
                steps: 10_000_000_000,
            }),
        )
    }

    let mut raw_tx: StagingTransaction = draft_tx
        .clone()
        .clear_fee()
        .clear_collateral_output()
        .remove_mint_redeemer(pallas_crypto::hash::Hash::new(
            hex::decode(config.contract.seedelf_policy_id)
                .expect("Invalid hex string")
                .try_into()
                .expect("Failed to convert to 32-byte array"),
        ));

    for i in 0..number_of_change_utxo {
        raw_tx = raw_tx.remove_output(number_of_change_utxo - i);
    }

    for input in input_vector.clone().into_iter() {
        raw_tx = raw_tx.remove_spend_redeemer(input);
    }

    let intermediate_tx: BuiltTransaction = draft_tx.build_conway_raw().unwrap();

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

    let tx_fee = fees::compute_linear_fee_policy(tx_size, &(fees::PolicyParams::default()));
    println!(
        "{} {}",
        "\nTx Size Fee:".bright_blue(),
        tx_fee.to_string().bright_white()
    );

    let compute_fee: u64 = total_computation_fee(budgets.clone());
    println!(
        "{} {}",
        "Compute Fee:".bright_blue(),
        compute_fee.to_string().bright_white()
    );

    let script_reference_fee: u64 =
        config.contract.seedelf_contract_size * 15 + config.contract.wallet_contract_size * 15;
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

    raw_tx = raw_tx
        .collateral_output(Output::new(
            collat_addr.clone(),
            5_000_000 - (total_fee) * 3 / 2,
        ))
        .fee(total_fee);

    // need to check if there is change going back here
    let change_token_per_utxo: Vec<Assets> = change_tokens
        .clone()
        .split(MAXIMUM_TOKENS_PER_UTXO.try_into().unwrap());
    let number_of_change_utxo: usize = change_token_per_utxo.len();
    // a max tokens per change output here
    let mut lovelace_amount: u64 = total_lovelace;
    for (i, change) in change_token_per_utxo.iter().enumerate() {
        let datum_vector: Vec<u8> = Register::create(scalar)?.rerandomize()?.to_vec()?;
        let minimum: u64 = wallet_minimum_lovelace_with_assets(change.clone())?;
        let change_lovelace: u64 = if i == number_of_change_utxo - 1 {
            // this is the last one or the only one
            lovelace_amount = lovelace_amount - min_utxo - total_fee;
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
        let datum_vector: Vec<u8> = Register::create(scalar)?.rerandomize()?.to_vec()?;
        let change_lovelace: u64 = lovelace_amount - min_utxo - total_fee;
        let change_output: Output = Output::new(wallet_addr.clone(), change_lovelace)
            .set_inline_datum(datum_vector.clone());
        raw_tx = raw_tx.output(change_output);
    }

    // split the budgets up into the spending and the minting.
    let (minting, spending) = budgets.split_last().unwrap();
    for ((input, datum), (cpu, mem)) in input_vector
        .clone()
        .into_iter()
        .zip(register_vector.clone().into_iter())
        .zip(spending.iter())
    {
        let r: Scalar = random_scalar();
        let (z, g_r) = create_proof(datum, scalar, pkh.clone(), r)?;
        let spend_redeemer_vector = data_structures::create_spend_redeemer(z, g_r, pkh.clone());
        raw_tx = raw_tx.add_spend_redeemer(
            input,
            spend_redeemer_vector?.clone(),
            Some(pallas_txbuilder::ExUnits {
                mem: *mem,
                steps: *cpu,
            }),
        )
    }

    raw_tx = raw_tx.add_mint_redeemer(
        pallas_crypto::hash::Hash::new(
            hex::decode(config.contract.seedelf_policy_id)
                .expect("Invalid hex string")
                .try_into()
                .expect("Failed to convert to 32-byte array"),
        ),
        redeemer_vector.clone(),
        Some(pallas_txbuilder::ExUnits {
            mem: minting.1,
            steps: minting.0,
        }),
    );

    let tx: BuiltTransaction = raw_tx.build_conway_raw().unwrap();
    let tx_cbor: String = hex::encode(tx.tx_bytes.as_ref());

    // need to witness it now
    let witness_public_key: PublicKey = PublicKey::from(COLLATERAL_PUBLIC_KEY);

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
                "\nTx Cbor: {}",
                hex::encode(signed_tx_cbor.tx_bytes.clone()).white()
            );

            match submit_tx(hex::encode(signed_tx_cbor.tx_bytes), network_flag).await {
                Ok(response) => {
                    if let Some(_error) = response.get("contents") {
                        println!("\nError: {response}");
                        std::process::exit(1);
                    }
                    println!("\nTransaction Successfully Submitted!");
                    println!(
                        "\nTx Hash: {}",
                        response.as_str().unwrap_or("default").bright_cyan()
                    );
                    if network_flag {
                        println!(
                            "{}",
                            format!(
                                "\nhttps://preprod.cardanoscan.io/transaction/{}",
                                response.as_str().unwrap_or("default")
                            )
                            .bright_purple()
                        );
                    } else {
                        println!(
                            "{}",
                            format!(
                                "\nhttps://cardanoscan.io/transaction/{}",
                                response.as_str().unwrap_or("default")
                            )
                            .bright_purple()
                        );
                    }
                }
                Err(err) => {
                    eprintln!("Failed to submit tx: {err}");
                    std::process::exit(1);
                }
            }
        }
        Err(err) => {
            eprintln!("Failed to fetch UTxOs: {err}");
            std::process::exit(1);
        }
    }

    Ok(())
}
