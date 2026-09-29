use crate::commands::spend::{self, OneTimeKey};
use crate::setup;
use anyhow::{Context, Result, bail};
use blstrs::Scalar;
use clap::Args;
use pallas_addresses::Address;
use seedelf_core::build::{self, Chain};
use seedelf_core::constants::get_config;
use seedelf_core::utxos;
use seedelf_crypto::register::Register;
use seedelf_display::display;
use seedelf_koios::koios::{UtxoResponse, epoch_params, extract_bytes_with_logging};

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct RemoveArgs {
    #[arg(short = 's', long, help = "The seedelf to remove.", display_order = 1)]
    pub seedelf: String,

    #[arg(
        short = 'a',
        long,
        help = "The address receiving the leftover ADA.",
        display_order = 2
    )]
    pub address: String,
}

pub async fn run(args: RemoveArgs, network_flag: bool, variant: u64) -> Result<()> {
    display::is_there_an_update().await;
    display::preprod_text(network_flag);

    let chain = Chain {
        config: get_config(variant, network_flag)?,
        params: epoch_params(network_flag).await?,
        network_flag,
    };

    // Reject a non-hex --seedelf up front rather than panicking mid-build.
    hex::decode(&args.seedelf).context("--seedelf must be a hex-encoded token name")?;

    // we need to make sure that the network flag and the address provided makes sense here
    let addr: Address = Address::from_bech32(args.address.as_str())
        .map_err(|e| anyhow::anyhow!("Supplied Address Is Incorrect: {e}"))?;
    if !build::is_payable_address(&addr, network_flag) {
        bail!("Supplied Address Is Incorrect");
    }

    // proves the seedelf's UTxO
    let scalar: Scalar = setup::unlock_wallet_interactive();

    let every_utxo: Vec<UtxoResponse> =
        utxos::get_credential_utxos(chain.config.contract.wallet_contract_hash, network_flag)
            .await?;
    let seedelf_utxo: UtxoResponse = match utxos::find_seedelf_utxo(
        args.seedelf.clone(),
        &chain.config.contract.seedelf_policy_id,
        every_utxo,
    ) {
        Ok(Some(utxo)) => utxo,
        Ok(None) => bail!("Seedelf {} not found on chain", args.seedelf),
        Err(e) => bail!("Failed to look up seedelf {}: {e}", args.seedelf),
    };

    // Say so here, rather than have the wallet script refuse the proof.
    let owned: bool = extract_bytes_with_logging(&seedelf_utxo.inline_datum)
        .is_some_and(|register| register.is_owned(scalar).unwrap_or(false));
    if !owned {
        bail!("Seedelf {} isn't this wallet's", args.seedelf);
    }

    // the leftover ADA goes to the address
    let key = OneTimeKey::new();
    let spend = build::remove(&chain, &seedelf_utxo, &Register::create(scalar)?, key.hash)?
        .change_to(&addr);

    spend::prove_and_submit(spend, scalar, key, network_flag).await
}
