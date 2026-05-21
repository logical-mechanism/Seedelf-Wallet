use crate::commands::fee;
use crate::web_server;
use anyhow::{Result, bail};
use clap::Args;
use colored::Colorize;
use pallas_addresses::Address;
use pallas_txbuilder::{BuildConway, BuiltTransaction, Input, Output, StagingTransaction};
use seedelf_core::address;
use seedelf_core::assets::Assets;
use seedelf_core::constants::{Config, MAXIMUM_TOKENS_PER_UTXO, get_config};
use seedelf_core::transaction::wallet_minimum_lovelace_with_assets;
use seedelf_core::utxos;
use seedelf_crypto::register::Register;
use seedelf_display::{display, text_coloring};
use seedelf_koios::koios::{UtxoResponse, epoch_params, extract_bytes_with_logging};

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct FundArgs {
    /// address sending funds
    #[arg(
        short = 'a',
        long,
        help = "The address sending funds to the seedelf.",
        display_order = 1
    )]
    pub address: String,

    /// seedelf to send funds too
    #[arg(
        short = 's',
        long,
        help = "The seedelf receiving funds.",
        display_order = 2
    )]
    pub seedelf: String,

    /// The amount of Lovelace to send
    #[arg(
        short = 'l',
        long,
        help = "The amount of Lovelace being sent to the seedelf.",
        display_order = 3
    )]
    pub lovelace: Option<u64>,

    /// Native tokens to include, repeatable. Format `<policy_id>.<token_name>=<amount>`.
    /// Multiple tokens can also be comma-separated within a single value.
    #[arg(
        long = "asset",
        value_name = "PID.TKN=AMT",
        action = clap::ArgAction::Append,
        help = "Native token to send: <policy_id>.<token_name>=<amount>. Repeat or comma-separate for multiple.",
        display_order = 4
    )]
    pub assets: Vec<String>,
}

pub async fn run(args: FundArgs, network_flag: bool, variant: u64) -> Result<()> {
    display::is_there_an_update().await;
    display::preprod_text(network_flag);

    if args.lovelace.is_none() && args.assets.is_empty() {
        bail!("No Lovelace or Assets Provided.");
    }

    let config: Config = get_config(variant, network_flag)?;
    let params = epoch_params(network_flag).await?;

    let mut selected_tokens: Assets = Assets::new();
    for spec in &args.assets {
        selected_tokens = selected_tokens.merge(Assets::parse(spec)?)?;
    }

    let minimum_lovelace: u64 =
        wallet_minimum_lovelace_with_assets(&params, selected_tokens.clone())?;
    if args.lovelace.is_some_and(|l| l < minimum_lovelace) {
        bail!("Not Enough Lovelace On UTxO");
    }

    // we need to make sure that the network flag and the address provided makes sense here
    let addr: Address = Address::from_bech32(args.address.as_str())
        .map_err(|e| anyhow::anyhow!("Supplied Address Is Incorrect: {e}"))?;
    if !(address::is_not_a_script(addr.clone())
        && address::is_on_correct_network(addr.clone(), network_flag))
    {
        bail!("Supplied Address Is Incorrect");
    }

    let lovelace: u64 = args.lovelace.unwrap_or(minimum_lovelace);

    // we need this as the address type and not the shelley
    let wallet_addr: Address =
        address::wallet_contract(network_flag, config.contract.wallet_contract_hash);

    // this is used to calculate the real fee
    let mut draft_tx: StagingTransaction = StagingTransaction::new();

    let every_utxo_at_script: Vec<UtxoResponse> =
        utxos::get_credential_utxos(config.contract.wallet_contract_hash, network_flag).await?;

    let seedelf_utxo: UtxoResponse = match utxos::find_seedelf_utxo(
        args.seedelf.clone(),
        &config.contract.seedelf_policy_id,
        every_utxo_at_script,
    ) {
        Ok(Some(utxo)) => utxo,
        Ok(None) => bail!("Seedelf {} not found on chain", args.seedelf),
        Err(e) => bail!("Failed to look up seedelf {}: {e}", args.seedelf),
    };

    let seedelf_datum: Register = extract_bytes_with_logging(&seedelf_utxo.inline_datum)
        .ok_or_else(|| anyhow::anyhow!("Seedelf datum is not a Register"))?;

    let every_utxo_at_address: Vec<UtxoResponse> =
        utxos::get_address_utxos(&args.address, network_flag).await?;
    // all non collateral utxos, assume 5 ada for collateral
    let every_non_collatreal_utxo: Vec<UtxoResponse> =
        utxos::collect_address_utxos(every_utxo_at_address)?;
    let usable_utxos: Vec<UtxoResponse> = utxos::select(
        &params,
        every_non_collatreal_utxo,
        lovelace,
        selected_tokens.clone(),
    )?;

    if usable_utxos.is_empty() {
        bail!("Not Enough Lovelace/Tokens");
    }

    let (total_lovelace, tokens) = utxos::assets_of(usable_utxos.clone())?;
    let change_tokens: Assets = tokens.separate(selected_tokens.clone())?;

    // add usable wallet utxos as inputs
    for utxo in usable_utxos.clone() {
        // draft and raw are built the same here
        draft_tx = draft_tx.input(Input::new(
            pallas_crypto::hash::Hash::new(seedelf_core::transaction::decode_tx_hash(
                &utxo.tx_hash,
            )?),
            utxo.tx_index,
        ));
    }

    // This is some semi legit fee to be used to estimate it
    let tmp_fee: u64 = 200_000;

    let datum_vector: Vec<u8> = seedelf_datum.rerandomize()?.to_vec()?;
    let mut fund_output: Output =
        Output::new(wallet_addr.clone(), lovelace).set_inline_datum(datum_vector.clone());
    for asset in selected_tokens.items.clone() {
        fund_output = fund_output
            .add_asset(asset.policy_id, asset.token_name, asset.amount)
            .unwrap();
    }

    // build out the rest of the draft tx with the tmp fee
    draft_tx = draft_tx.output(fund_output).fee(tmp_fee);

    // a max tokens per change output here
    let change_token_per_utxo: Vec<Assets> = change_tokens
        .clone()
        .split(MAXIMUM_TOKENS_PER_UTXO.try_into().unwrap());
    let mut number_of_change_utxo: usize = change_token_per_utxo.len();
    let mut lovelace_amount: u64 = total_lovelace;
    for (i, change) in change_token_per_utxo.iter().enumerate() {
        let minimum: u64 = wallet_minimum_lovelace_with_assets(&params, change.clone())?;
        let change_lovelace: u64 = if i == number_of_change_utxo - 1 {
            // this is the last one or the only one
            lovelace_amount =
                seedelf_core::transaction::checked_lovelace(lovelace_amount, &[lovelace, tmp_fee])?;
            lovelace_amount
        } else {
            // its additional tokens going back
            lovelace_amount =
                seedelf_core::transaction::checked_lovelace(lovelace_amount, &[minimum])?;
            minimum
        };

        let mut change_output: Output = Output::new(addr.clone(), change_lovelace);
        for asset in change.items.clone() {
            change_output = change_output
                .add_asset(asset.policy_id, asset.token_name, asset.amount)
                .unwrap();
        }
        draft_tx = draft_tx.output(change_output);
    }

    // need to account for when its only lovelace with no change tokens
    if number_of_change_utxo == 0 {
        // no tokens so we just need to account for the lovelace going back
        let change_lovelace: u64 =
            seedelf_core::transaction::checked_lovelace(lovelace_amount, &[lovelace, tmp_fee])?;
        let change_output: Output = Output::new(addr.clone(), change_lovelace);
        draft_tx = draft_tx.output(change_output);
        number_of_change_utxo += 1;
    }

    let mut raw_tx: StagingTransaction = draft_tx.clone().clear_fee();
    for i in 0..number_of_change_utxo {
        raw_tx = raw_tx.remove_output(number_of_change_utxo - i);
    }

    // let mut raw_tx: StagingTransaction = draft_tx.clone().remove_output(1).clear_fee();
    // build an intermediate tx for fee estimation
    let intermediate_tx: BuiltTransaction = draft_tx.build_conway_raw().unwrap();

    let tx_size: u64 = intermediate_tx
        .sign(fee::fake_signer())
        .unwrap()
        .tx_bytes
        .0
        .len()
        .try_into()
        .unwrap();
    // floor division means its safer to just add 1 lovelace
    let tx_fee: u64 = fee::linear_fee(tx_size) + 1;

    // a max tokens per change output here
    let change_token_per_utxo: Vec<Assets> = change_tokens
        .clone()
        .split(MAXIMUM_TOKENS_PER_UTXO.try_into().unwrap());
    let number_of_change_utxo: usize = change_token_per_utxo.len();
    let mut lovelace_amount: u64 = total_lovelace;
    for (i, change) in change_token_per_utxo.iter().enumerate() {
        let minimum: u64 = wallet_minimum_lovelace_with_assets(&params, change.clone())?;
        let change_lovelace: u64 = if i == number_of_change_utxo - 1 {
            // this is the last one or the only one
            lovelace_amount =
                seedelf_core::transaction::checked_lovelace(lovelace_amount, &[lovelace, tx_fee])?;
            lovelace_amount
        } else {
            // its additional tokens going back
            lovelace_amount =
                seedelf_core::transaction::checked_lovelace(lovelace_amount, &[minimum])?;
            minimum
        };

        let mut change_output: Output = Output::new(addr.clone(), change_lovelace);
        for asset in change.items.clone() {
            change_output = change_output
                .add_asset(asset.policy_id, asset.token_name, asset.amount)
                .unwrap();
        }
        raw_tx = raw_tx.output(change_output);
    }

    // need to account for when its only lovelace with no change tokens
    if number_of_change_utxo == 0 {
        // no tokens so we just need to account for the lovelace going back
        let change_lovelace: u64 =
            seedelf_core::transaction::checked_lovelace(lovelace_amount, &[lovelace, tx_fee])?;
        let change_output: Output = Output::new(addr.clone(), change_lovelace);
        raw_tx = raw_tx.output(change_output);
    }

    raw_tx = raw_tx.fee(tx_fee);

    let tx: BuiltTransaction = raw_tx.build_conway_raw().unwrap();

    let tx_cbor: String = hex::encode(tx.tx_bytes);

    println!(
        "{} {}",
        "\nTx Size Fee:".bright_blue(),
        tx_fee.to_string().bright_white()
    );

    println!("\nTx Cbor: {}", tx_cbor.clone().white());

    // inject the tx cbor into the local webserver to prompt the wallet
    display::webserver_address();
    web_server::run_web_server(tx_cbor, network_flag).await;
    text_coloring::display_purple("Server has stopped.");

    Ok(())
}
