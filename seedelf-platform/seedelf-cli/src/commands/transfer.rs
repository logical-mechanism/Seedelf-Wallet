use crate::commands::fee;
use crate::setup;
use anyhow::{Context, Result, anyhow, bail};
use blstrs::Scalar;
use clap::Args;
use colored::Colorize;
use pallas_crypto::key::ed25519::{PublicKey, SecretKey};
use pallas_primitives::Hash;
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_core::assets::Assets;
use seedelf_core::build::{self, Budgets, Chain, Payment};
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
pub struct TransforArgs {
    /// seedelf to send funds too
    #[arg(
        short = 's',
        long,
        help = "The seedelfs receiving funds.",
        display_order = 1
    )]
    pub seedelfs: Vec<String>,

    /// The amount of lovelace to send
    #[arg(
        short = 'l',
        long,
        help = "The amount of Lovelace being sent to the seedelfs.",
        display_order = 2
    )]
    pub lovelaces: Option<Vec<u64>>,

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
    pub assets: Vec<String>,

    /// Optional repeated 'txId#txIdx'
    #[arg(long = "utxo", help = "The utxos to spend.", display_order = 6)]
    pub utxos: Option<Vec<String>>,
}

pub async fn run(args: TransforArgs, network_flag: bool, variant: u64) -> Result<()> {
    display::is_there_an_update().await;
    display::preprod_text(network_flag);

    let chain = Chain {
        config: get_config(variant, network_flag)?,
        params: epoch_params(network_flag).await?,
        network_flag,
    };

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
    let lovelaces: Vec<u64> = args.lovelaces.unwrap_or_default();
    if lovelaces.len() != args.seedelfs.len() {
        bail!(
            "--lovelaces must be supplied once per --seedelfs (got {} values for {} seedelfs)",
            lovelaces.len(),
            args.seedelfs.len()
        );
    }

    // proves the inputs, and re-randomizes the change
    let scalar: Scalar = setup::unlock_wallet_interactive();
    let owner: Register = Register::create(scalar)?;

    let policy_id: &str = &chain.config.contract.seedelf_policy_id;
    let every_utxo: Vec<UtxoResponse> =
        utxos::get_credential_utxos(chain.config.contract.wallet_contract_hash, network_flag)
            .await?;
    let owned_utxos: Vec<UtxoResponse> =
        utxos::collect_wallet_utxos(scalar, policy_id, every_utxo.clone())?;

    // each recipient's register, found with their seedelf
    let payments: Vec<Payment> = args
        .seedelfs
        .iter()
        .zip(lovelaces)
        .zip(all_selected_tokens)
        .map(|((seedelf, lovelace), tokens)| {
            let register =
                utxos::find_seedelf_datum(seedelf.clone(), policy_id, every_utxo.clone())?
                    .ok_or_else(|| anyhow!("Seedelf {seedelf} not found on chain"))?;
            Ok(Payment {
                register,
                lovelace,
                tokens,
            })
        })
        .collect::<Result<_>>()?;

    // the proofs are bound to this key, and it signs
    let one_time_secret_key: SecretKey = SecretKey::new(OsRng);
    let one_time_private_key: PrivateKey = PrivateKey::from(one_time_secret_key.clone());
    let signer: Hash<28> =
        pallas_crypto::hash::Hasher::<224>::hash(one_time_private_key.public_key().as_ref());

    let spend: build::ScriptSpend = match args.utxos {
        None => build::transfer(&chain, &owned_utxos, &payments, &owner, signer)?,
        Some(selected) => {
            // assumes the utxos hold the correct tokens else it will error downstream
            let usable_utxos: Vec<UtxoResponse> =
                utxos::filter_utxos(owned_utxos, utxos::parse_tx_utxos(selected)?);
            if usable_utxos.is_empty() {
                bail!("No Usuable UTxOs Found");
            }
            build::transfer_from(&chain, &usable_utxos, &payments, &owner, signer)?
        }
    };

    let spend =
        spend.proven(|register, vkh| create_proof(register.clone(), scalar, vkh.to_string()))?;
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
    let witness = witness_collateral(tx_cbor.clone(), network_flag)
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

    println!("\nTx Cbor: {}", tx_cbor.white());

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
