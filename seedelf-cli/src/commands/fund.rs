use clap::Args;
use colored::Colorize;
use hex;
use pallas_addresses::Address;
use pallas_crypto::key::ed25519::SecretKey;
use pallas_traverse::fees;
use pallas_txbuilder::{BuildConway, BuiltTransaction, Input, Output, StagingTransaction};
use rand_core::OsRng;
use seedelf_cli::address;
use seedelf_cli::assets::{Asset, Assets};
use seedelf_cli::constants::MAXIMUM_TOKENS_PER_UTXO;
use seedelf_cli::display;
use seedelf_cli::koios::{UtxoResponse, extract_bytes_with_logging};
use seedelf_cli::register::Register;
use seedelf_cli::transaction::wallet_minimum_lovelace_with_assets;
use seedelf_cli::utxos;
use seedelf_cli::web_server;

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct FundArgs {
    /// Seedelf to send funds too
    #[arg(
        short = 'a',
        long,
        help = "The address sending funds to the Seedelf.",
        display_order = 1
    )]
    address: String,

    /// Seedelf to send funds too
    #[arg(
        short = 's',
        long,
        help = "The Seedelf receiving funds.",
        display_order = 2
    )]
    seedelf: String,

    /// The amount of Lovelace to send
    #[arg(
        short = 'l',
        long,
        help = "The amount of Lovelace being sent to the Seedelf.",
        display_order = 3
    )]
    lovelace: Option<u64>,

    /// Optional repeated `policy-id`
    #[arg(
        long = "policy-id",
        help = "The policy id for the asset.",
        display_order = 4
    )]
    policy_id: Option<Vec<String>>,

    /// Optional repeated `token-name`
    #[arg(
        long = "token-name",
        help = "The token name for the asset.",
        display_order = 5
    )]
    token_name: Option<Vec<String>>,

    /// Optional repeated `amount`
    #[arg(long = "amount", help = "The amount for the asset.", display_order = 6)]
    amount: Option<Vec<u64>>,
}

pub async fn run(args: FundArgs, network_flag: bool, variant: u64) -> Result<(), String> {
    display::is_their_an_update().await;
    display::preprod_text(network_flag);

    // its ok not to define lovelace but in that case an asset has to be define
    if args.lovelace.is_none()
        && (args.policy_id.is_none() || args.token_name.is_none() || args.amount.is_none())
    {
        return Err("No Lovelace or Assets Provided.".to_string());
    }

    // lets collect the tokens if they exist
    let mut selected_tokens: Assets = Assets::new();
    if let (Some(policy_id), Some(token_name), Some(amount)) =
        (args.policy_id, args.token_name, args.amount)
    {
        if policy_id.len() != token_name.len() || policy_id.len() != amount.len() {
            return Err(
                "Error: Each --policy-id must have a corresponding --token-name and --amount."
                    .to_string(),
            );
        }

        for ((pid, tkn), amt) in policy_id
            .into_iter()
            .zip(token_name.into_iter())
            .zip(amount.into_iter())
        {
            if amt == 0 {
                return Err("Error: Token Amount must be positive".to_string());
            }
            selected_tokens = selected_tokens.add(Asset::new(pid, tkn, amt));
        }
    }

    let minimum_lovelace: u64 = wallet_minimum_lovelace_with_assets(selected_tokens.clone());
    if args.lovelace.is_some_and(|l| l < minimum_lovelace) {
        return Err("Not Enough Lovelace On UTxO".to_string());
    }

    // we need to make sure that the network flag and the address provided makes sense here
    let addr: Address = Address::from_bech32(args.address.as_str()).unwrap();
    if !(address::is_not_a_script(addr.clone())
        && address::is_on_correct_network(addr.clone(), network_flag))
    {
        return Err("Supplied Address Is Incorrect".to_string());
    }

    // we need this as the address type and not the shelley
    let wallet_addr: Address = address::wallet_contract(network_flag, variant);

    // this is used to calculate the real fee
    let mut draft_tx: StagingTransaction = StagingTransaction::new();

    // we need about 2 ada for change so just add that to the amount
    let lovelace: u64 = args.lovelace.unwrap_or(minimum_lovelace);
    let lovelace_goal: u64 = lovelace;

    // utxos
    let seedelf_utxo: UtxoResponse =
        utxos::find_seedelf_utxo(args.seedelf.clone(), network_flag, variant)
            .await
            .ok_or("Seedelf Not Found".to_string())
            .unwrap();
    let seedelf_datum: Register = extract_bytes_with_logging(&seedelf_utxo.inline_datum)
        .ok_or("Not Register Type".to_string())
        .unwrap();

    let all_utxos: Vec<UtxoResponse> =
        utxos::collect_address_utxos(&args.address, network_flag).await;
    let usuable_utxos: Vec<UtxoResponse> =
        utxos::select(all_utxos, lovelace_goal, selected_tokens.clone());

    if usuable_utxos.is_empty() {
        return Err("Not Enough Lovelace/Tokens".to_string());
    }

    for utxo in usuable_utxos.clone() {
        // draft and raw are built the same here
        draft_tx = draft_tx.input(Input::new(
            pallas_crypto::hash::Hash::new(
                hex::decode(utxo.tx_hash.clone())
                    .expect("Invalid hex string")
                    .try_into()
                    .expect("Failed to convert to 32-byte array"),
            ),
            utxo.tx_index,
        ));
    }

    let (total_lovelace, tokens) = utxos::assets_of(usuable_utxos);
    // tokens tha need to be put into the change output
    let change_tokens: Assets = tokens.separate(selected_tokens.clone());
    // if the seedelf isn't found then error
    if total_lovelace < lovelace_goal {
        return Err("Not Enough Lovelace/Tokens".to_string());
    }

    // This is some semi legit fee to be used to estimate it
    let tmp_fee: u64 = 200_000;

    let datum_vector: Vec<u8> = seedelf_datum.rerandomize().to_vec();
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
        let minimum: u64 = wallet_minimum_lovelace_with_assets(change.clone());
        let change_lovelace: u64 = if i == number_of_change_utxo - 1 {
            // this is the last one or the only one
            lovelace_amount = lovelace_amount - lovelace - tmp_fee;
            lovelace_amount
        } else {
            // its additional tokens going back
            lovelace_amount -= minimum;
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
        let change_lovelace: u64 = lovelace_amount - lovelace - tmp_fee;
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

    // we can fake the signature here to get the correct tx size
    let fake_signer_secret_key: SecretKey = SecretKey::new(OsRng);

    // we need the script size here
    let tx_size: u64 = intermediate_tx
        .sign(&fake_signer_secret_key)
        .unwrap()
        .tx_bytes
        .0
        .len()
        .try_into()
        .unwrap();
    // floor division means its safer to just add 1 lovelace
    let tx_fee: u64 =
        fees::compute_linear_fee_policy(tx_size, &(fees::PolicyParams::default())) + 1;
    println!(
        "{} {}",
        "\nTx Size Fee:".bright_blue(),
        tx_fee.to_string().bright_white()
    );

    // a max tokens per change output here
    let change_token_per_utxo: Vec<Assets> = change_tokens
        .clone()
        .split(MAXIMUM_TOKENS_PER_UTXO.try_into().unwrap());
    let number_of_change_utxo: usize = change_token_per_utxo.len();
    let mut lovelace_amount: u64 = total_lovelace;
    for (i, change) in change_token_per_utxo.iter().enumerate() {
        let minimum: u64 = wallet_minimum_lovelace_with_assets(change.clone());
        let change_lovelace: u64 = if i == number_of_change_utxo - 1 {
            // this is the last one or the only one
            lovelace_amount = lovelace_amount - lovelace - tx_fee;
            lovelace_amount
        } else {
            // its additional tokens going back
            lovelace_amount -= minimum;
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
        let change_lovelace: u64 = lovelace_amount - lovelace - tx_fee;
        let change_output: Output = Output::new(addr.clone(), change_lovelace);
        raw_tx = raw_tx.output(change_output);
    }

    raw_tx = raw_tx.fee(tx_fee);

    let tx: BuiltTransaction = raw_tx.build_conway_raw().unwrap();

    let tx_cbor: String = hex::encode(tx.tx_bytes);
    println!("\nTx Cbor: {}", tx_cbor.clone().white());

    // inject the tx cbor into the local webserver to prompt the wallet
    web_server::run_web_server(tx_cbor, network_flag).await;

    Ok(())
}
