use crate::commands::fee;
use crate::setup;
use anyhow::{Context, Result, bail};
use blstrs::Scalar;
use clap::Args;
use colored::Colorize;
use pallas_crypto::key::ed25519::{PublicKey, SecretKey};
use pallas_primitives::Hash;
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_core::build::{self, Budgets, Chain};
use seedelf_core::constants::{COLLATERAL_PUBLIC_KEY, get_config};
use seedelf_core::utxos;
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::create_proof;
use seedelf_display::display;
use seedelf_koios::koios::{
    UtxoResponse, epoch_params, evaluate_transaction, submit_tx, witness_collateral,
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
    pub label: Option<String>,

    #[arg(
        short = 'g',
        long,
        help = "A generator point in G1.",
        display_order = 2,
        requires = "public_value"
    )]
    pub generator: Option<String>,

    #[arg(
        short = 'p',
        long,
        help = "A public value computed as `generator * sk`",
        display_order = 3,
        requires = "generator"
    )]
    pub public_value: Option<String>,

    /// Optional repeated 'txId#txIdx'
    #[arg(long = "utxo", help = "The utxos to spend.", display_order = 4)]
    pub utxos: Option<Vec<String>>,
}

pub async fn run(args: MintArgs, network_flag: bool, variant: u64) -> Result<()> {
    display::is_there_an_update().await;
    display::preprod_text(network_flag);

    let chain = Chain {
        config: get_config(variant, network_flag)?,
        params: epoch_params(network_flag).await?,
        network_flag,
    };

    // if the label is none then just use the empty string
    let label: String = args.label.unwrap_or_default();

    // proves the inputs, and re-randomizes the change
    let scalar: Scalar = setup::unlock_wallet_interactive();
    let owner: Register = Register::create(scalar)?;

    let every_utxo: Vec<UtxoResponse> =
        utxos::get_credential_utxos(chain.config.contract.wallet_contract_hash, network_flag)
            .await?;
    let owned_utxos: Vec<UtxoResponse> =
        utxos::collect_wallet_utxos(scalar, &chain.config.contract.seedelf_policy_id, every_utxo)?;

    // this is the new seedelf datum
    let seedelf: Register = if args.generator.is_none() && args.public_value.is_none() {
        owner.clone().rerandomize()?
    } else {
        // both have to be some to get to this point
        // requires should catch the mix cases
        let new_register: Register = Register::new(
            args.generator.unwrap_or_default(),
            args.public_value.unwrap_or_default(),
        );
        if !new_register.is_valid()? {
            bail!("Provided Register Is Invalid");
        }
        new_register
    };

    // the proofs are bound to this key, and it signs
    let one_time_secret_key: SecretKey = SecretKey::new(OsRng);
    let one_time_private_key: PrivateKey = PrivateKey::from(one_time_secret_key.clone());
    let signer: Hash<28> =
        pallas_crypto::hash::Hasher::<224>::hash(one_time_private_key.public_key().as_ref());

    let minted: build::SeedelfMint = match args.utxos {
        None => build::mint(&chain, &owned_utxos, &label, &seedelf, &owner, signer)?,
        Some(selected) => {
            // assumes the utxos hold the correct tokens else it will error downstream
            let usable_utxos: Vec<UtxoResponse> =
                utxos::filter_utxos(owned_utxos, utxos::parse_tx_utxos(selected)?);
            if usable_utxos.is_empty() {
                bail!("No Usuable UTxOs Found");
            }
            build::mint_from(&chain, &usable_utxos, &label, &seedelf, &owner, signer)?
        }
    };
    println!(
        "{} {}",
        "\nCreating Seedelf:".bright_blue(),
        hex::encode(&minted.token_name).bright_white()
    );
    println!(
        "{} {}",
        "\nMinimum Required Lovelace:".bright_blue(),
        minted.lovelace.to_string().bright_white()
    );

    let spend = minted
        .spend
        .proven(|register, vkh| create_proof(register.clone(), scalar, vkh.to_string()))?;
    let draft = spend.draft()?;
    let evaluation = evaluate_transaction(hex::encode(draft.tx_bytes.as_ref()), network_flag)
        .await
        .context("Failed to evaluate transaction")?;
    let built = spend.finalize(&Budgets::from_ogmios(&evaluation)?)?;

    println!(
        "{} {}",
        "\nTx Size Fee:".bright_blue(),
        built.fee.size.to_string().bright_white()
    );
    println!(
        "{} {}",
        "Compute Fee:".bright_blue(),
        built.fee.compute.to_string().bright_white()
    );
    println!(
        "{} {}",
        "Script Reference Fee:".bright_blue(),
        built.fee.script_reference.to_string().bright_white()
    );
    println!(
        "{} {}",
        "Total Fee:".bright_blue(),
        built.fee.total.to_string().bright_white()
    );

    // need to witness it now
    let tx_cbor: String = hex::encode(built.tx.tx_bytes.as_ref());
    let witness = witness_collateral(tx_cbor, network_flag)
        .await
        .context("Collateral Service Request Failed")?;
    let signed_tx_cbor = built
        .tx
        .sign(PrivateKey::from(one_time_secret_key))
        .context("Failed To Sign The Transaction")?
        .add_signature(
            PublicKey::from(COLLATERAL_PUBLIC_KEY),
            build::collateral_signature(&witness)?,
        )
        .context("Failed To Add The Collateral Witness")?;

    println!(
        "\nTx Cbor: {}",
        hex::encode(signed_tx_cbor.tx_bytes.clone()).white()
    );

    let response = submit_tx(hex::encode(signed_tx_cbor.tx_bytes), network_flag).await?;
    let tx_hash = fee::parse_submit_response(&response)?;
    println!("\nTransaction Successfully Submitted!");
    println!("\nTx Hash: {}", tx_hash.bright_cyan());
    if network_flag {
        println!(
            "{}",
            format!("\nhttps://preprod.cardanoscan.io/transaction/{tx_hash}").bright_purple()
        );
    } else {
        println!(
            "{}",
            format!("\nhttps://cardanoscan.io/transaction/{tx_hash}").bright_purple()
        );
    }

    Ok(())
}
