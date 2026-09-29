//! How every Seedelf script spend the CLI makes ends: prove the inputs, have
//! Ogmios measure the draft, finish it, get giveme.my's collateral witness,
//! sign with the one-time key, and submit.

use crate::commands::fee;
use anyhow::{Context, Result};
use blstrs::Scalar;
use colored::Colorize;
use pallas_crypto::key::ed25519::{PublicKey, SecretKey};
use pallas_primitives::Hash;
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_core::build::{self, Budgets, ScriptSpend};
use seedelf_core::constants::COLLATERAL_PUBLIC_KEY;
use seedelf_crypto::schnorr::create_proof;
use seedelf_koios::koios::{evaluate_transaction, submit_tx, witness_collateral};

/// A new one-time signing key: every proof in the spend is bound to its hash.
pub(crate) struct OneTimeKey {
    secret: SecretKey,
    pub hash: Hash<28>,
}

impl OneTimeKey {
    pub fn new() -> Self {
        let secret = SecretKey::new(OsRng);
        let hash = pallas_crypto::hash::Hasher::<224>::hash(
            PrivateKey::from(secret.clone()).public_key().as_ref(),
        );
        OneTimeKey { secret, hash }
    }
}

/// Proves `spend` with `scalar`, has Ogmios measure it, finishes it, signs it
/// with `key` and giveme.my's witness, and submits it.
pub(crate) async fn prove_and_submit(
    spend: ScriptSpend,
    scalar: Scalar,
    key: OneTimeKey,
    network_flag: bool,
) -> Result<()> {
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
    let witness = witness_collateral(tx_cbor, network_flag)
        .await
        .context("Collateral Service Request Failed")?;
    let signed_tx_cbor = built
        .tx
        .sign(PrivateKey::from(key.secret))
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
