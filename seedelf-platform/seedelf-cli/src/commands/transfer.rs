use crate::commands::spend::{self, OneTimeKey};
use crate::setup;
use anyhow::{Result, anyhow, bail};
use blstrs::Scalar;
use clap::Args;
use seedelf_core::assets::Assets;
use seedelf_core::build::{self, Chain, Payment};
use seedelf_core::constants::get_config;
use seedelf_core::utxos;
use seedelf_crypto::register::Register;
use seedelf_display::display;
use seedelf_koios::koios::{UtxoResponse, epoch_params};

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

    let key = OneTimeKey::new();
    let spend: build::ScriptSpend = match args.utxos {
        None => build::transfer(&chain, &owned_utxos, &payments, &owner, key.hash)?,
        Some(selected) => {
            // assumes the utxos hold the correct tokens else it will error downstream
            let usable_utxos: Vec<UtxoResponse> =
                utxos::filter_utxos(owned_utxos, utxos::parse_tx_utxos(selected)?);
            if usable_utxos.is_empty() {
                bail!("No Usuable UTxOs Found");
            }
            build::transfer_from(&chain, &usable_utxos, &payments, &owner, key.hash)?
        }
    };

    spend::prove_and_submit(spend, scalar, key, network_flag).await
}
