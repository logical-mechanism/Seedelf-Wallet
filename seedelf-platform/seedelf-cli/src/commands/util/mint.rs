use crate::commands::spend::{self, OneTimeKey};
use crate::setup;
use anyhow::{Result, bail};
use blstrs::Scalar;
use clap::Args;
use colored::Colorize;
use seedelf_core::build::{self, Chain};
use seedelf_core::constants::get_config;
use seedelf_core::utxos;
use seedelf_crypto::register::Register;
use seedelf_display::display;
use seedelf_koios::koios::{UtxoResponse, epoch_params};
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
    let key = OneTimeKey::new();
    let signer = key.hash;

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

    spend::prove_and_submit(minted.spend, scalar, key, network_flag).await
}
