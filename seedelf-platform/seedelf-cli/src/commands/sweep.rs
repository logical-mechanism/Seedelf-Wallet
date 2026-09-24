use crate::commands::spend::{self, OneTimeKey};
use crate::setup;
use anyhow::{Result, bail};
use blstrs::Scalar;
use clap::Args;
use pallas_addresses::Address;
use seedelf_core::address;
use seedelf_core::assets::Assets;
use seedelf_core::build::{self, Chain};
use seedelf_core::constants::{ADA_HANDLE_POLICY_ID, get_config};
use seedelf_core::transaction::address_minimum_lovelace_with_assets;
use seedelf_core::utxos;
use seedelf_crypto::register::Register;
use seedelf_display::display;
use seedelf_koios::koios::{UtxoResponse, ada_handle_address, epoch_params};

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct SweepArgs {
    /// address that receives the funds
    #[arg(
        short = 'a',
        long,
        help = "The address receiving funds.",
        display_order = 1
    )]
    pub address: Option<String>,

    /// The amount of lovelace to send
    #[arg(
        short = 'l',
        long,
        help = "The amount of Lovelace being sent to the address. Cannot be used with --all",
        display_order = 2
    )]
    pub lovelace: Option<u64>,

    /// Send all funds; cannot be combined with --lovelace or --asset
    #[arg(
        long,
        help = "Send all funds. Cannot be used with --lovelace or --asset.",
        display_order = 3
    )]
    pub all: bool,

    /// Native tokens to include, repeatable. Format `<policy_id>.<token_name>=<amount>`.
    #[arg(
        long = "asset",
        value_name = "PID.TKN=AMT",
        action = clap::ArgAction::Append,
        help = "Native token to send: <policy_id>.<token_name>=<amount>. Repeat or comma-separate for multiple.",
        display_order = 4
    )]
    pub assets: Vec<String>,

    /// Optional ADA Handle
    #[arg(
        long = "ada-handle",
        help = "ADA handle without the $.",
        display_order = 5
    )]
    pub ada_handle: Option<String>,

    /// Optional repeated 'txId#txIdx'
    #[arg(long = "utxo", help = "The utxos to spend.", display_order = 6)]
    pub utxos: Option<Vec<String>>,
}

pub async fn run(args: SweepArgs, network_flag: bool, variant: u64) -> Result<()> {
    display::is_there_an_update().await;
    display::preprod_text(network_flag);

    let chain = Chain {
        config: get_config(variant, network_flag)?,
        params: epoch_params(network_flag).await?,
        network_flag,
    };

    // address or ada handle must be found
    if args.address.is_none() && args.ada_handle.is_none() {
        bail!("Either --address or --ada-handle must be specified.");
    }

    if args.address.is_some() && args.ada_handle.is_some() {
        bail!("--address and --ada-handle cannot be used together.");
    }

    if args.ada_handle.clone().is_some_and(|x| x.is_empty()) {
        bail!("ADA Handle cannot be empty");
    }

    let outbound_address: String = if let Some(addr) = args.address {
        addr
    } else {
        let wallet_addr: String =
            address::wallet_contract(network_flag, chain.config.contract.wallet_contract_hash)
                .to_bech32()
                .map_err(|e| anyhow::anyhow!("Failed to encode wallet address: {e}"))?;
        match ada_handle_address(
            args.ada_handle.unwrap(),
            network_flag,
            false,
            variant,
            wallet_addr,
            ADA_HANDLE_POLICY_ID,
        )
        .await
        {
            Err(err) => bail!(err),
            Ok(potential_addr) => potential_addr,
        }
    };
    let addr: Address = Address::from_bech32(outbound_address.as_str())
        .map_err(|e| anyhow::anyhow!("Supplied Address Is Incorrect: {e}"))?;

    if !args.all && args.lovelace.is_none() && args.assets.is_empty() {
        bail!("Either --lovelace, --asset, or --all must be specified.");
    }

    if args.all && (args.lovelace.is_some() || !args.assets.is_empty()) {
        bail!("--all cannot be combined with --lovelace or --asset.");
    }

    let mut selected_tokens: Assets = Assets::new();
    for spec in &args.assets {
        selected_tokens = selected_tokens.merge(Assets::parse(spec)?)?;
    }

    let address_minimum_lovelace: u64 = address_minimum_lovelace_with_assets(
        &chain.params,
        &outbound_address,
        selected_tokens.clone(),
    )?;
    if args.lovelace.is_some_and(|x| x < address_minimum_lovelace) {
        bail!("lovelace Too Small For Min UTxO");
    }

    // we need to make sure that the network flag and the address provided makes sense here
    if !build::is_payable_address(&addr, network_flag) {
        bail!("Supplied Address Is Incorrect");
    }

    // proves the inputs, and re-randomizes the change
    let scalar: Scalar = setup::unlock_wallet_interactive();
    let owner: Register = Register::create(scalar)?;

    let every_utxo: Vec<UtxoResponse> =
        utxos::get_credential_utxos(chain.config.contract.wallet_contract_hash, network_flag)
            .await?;
    let owned_utxos: Vec<UtxoResponse> =
        utxos::collect_wallet_utxos(scalar, &chain.config.contract.seedelf_policy_id, every_utxo)?;

    let key = OneTimeKey::new();
    let spend: build::ScriptSpend = if args.all {
        if owned_utxos.is_empty() {
            bail!("No Usuable UTxOs Found");
        }
        build::sweep_all(&chain, &owned_utxos, &addr, &owner, key.hash)?
    } else {
        let lovelace: u64 = args.lovelace.unwrap_or(address_minimum_lovelace);
        match args.utxos {
            None => build::sweep(
                &chain,
                &owned_utxos,
                &addr,
                lovelace,
                &selected_tokens,
                &owner,
                key.hash,
            )?,
            Some(selected) => {
                // assumes the utxos hold the correct tokens else it will error downstream
                let usable_utxos: Vec<UtxoResponse> =
                    utxos::filter_utxos(owned_utxos, utxos::parse_tx_utxos(selected)?);
                if usable_utxos.is_empty() {
                    bail!("No Usuable UTxOs Found");
                }
                build::sweep_from(
                    &chain,
                    &usable_utxos,
                    &addr,
                    lovelace,
                    &selected_tokens,
                    &owner,
                    key.hash,
                )?
            }
        }
    };

    spend::prove_and_submit(spend, scalar, key, network_flag).await
}
