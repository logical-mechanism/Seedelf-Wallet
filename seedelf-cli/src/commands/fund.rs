use clap::Args;
use hex;
use pallas_addresses::Address;
use pallas_crypto::key::ed25519::SecretKey;
use pallas_traverse::fees;
use pallas_txbuilder::{BuildConway, Input, Output, StagingTransaction, BuiltTransaction};
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_cli::address;
use seedelf_cli::assets::Assets;
use seedelf_cli::constants::{SEEDELF_POLICY_ID, WALLET_CONTRACT_HASH};
use seedelf_cli::koios::{
    contains_policy_id, credential_utxos, extract_bytes_with_logging, UtxoResponse
};
use seedelf_cli::register::Register;
use seedelf_cli::transaction;
use seedelf_cli::utxos;
use seedelf_cli::web_server;

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct FundArgs {
    /// Seedelf to send funds too
    #[arg(long, help = "The address sending funds to the Seedelf.")]
    address: String,

    /// Seedelf to send funds too
    #[arg(long, help = "The Seedelf receiving funds.")]
    seedelf: String,

    /// The amount of Lovelace to send
    #[arg(long, help = "The amount of Lovelace being sent to the Seedelf.")]
    lovelace: u64,
}

pub async fn run(args: FundArgs, network_flag: bool) -> Result<(), String> {
    if network_flag {
        println!("\nRunning In Preprod Environment");
    }

    if args.lovelace < transaction::wallet_minimum_lovelace() {
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
    let wallet_addr: Address = address::wallet_contract(network_flag);

    // this is used to calculate the real fee
    let mut draft_tx: StagingTransaction = StagingTransaction::new();

    let mut datum: Register = Register::default();

    // we need to make sure we found something to remove else err
    let mut found_seedelf: bool = false;

    // we need about 2 ada for change so just add that to the amount
    let lovelace_goal: u64 = 2_000_000 + args.lovelace;

    // utxos
    match credential_utxos(WALLET_CONTRACT_HASH, network_flag).await {
        Ok(utxos) => {
            for utxo in utxos {
                // Extract bytes
                if let Some(inline_datum) = extract_bytes_with_logging(&utxo.inline_datum) {
                    // its owned but lets not count the seedelf in the balance
                    if contains_policy_id(&utxo.asset_list, SEEDELF_POLICY_ID) {
                        let asset_name = utxo
                            .asset_list
                            .as_ref()
                            .and_then(|vec| {
                                vec.iter()
                                    .find(|asset| asset.policy_id == SEEDELF_POLICY_ID)
                                    .map(|asset| &asset.asset_name)
                            })
                            .unwrap();
                        if asset_name == &args.seedelf {
                            // just sum up all the lovelace of the ada only inputs
                            found_seedelf = true;
                            datum = inline_datum;
                            // we found it so stop searching
                            break;
                        }
                    }
                }
            }
        }
        Err(err) => {
            eprintln!("Failed to fetch UTxOs: {}\nWait a few moments and try again.", err);
        }
    }
    // if the seedelf isn't found then error
    if !found_seedelf {
        return Err("Seedelf Not Found".to_string());
    }

    let all_utxos: Vec<UtxoResponse> = utxos::collect_address_utxos(&args.address, network_flag).await;
    let selected_utxos: Vec<UtxoResponse> = utxos::select(all_utxos, lovelace_goal, Assets::new());
    for utxo in selected_utxos.clone() {
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

    let (total_lovelace, tokens) = utxos::assets_of(selected_utxos);

    // if the seedelf isn't found then error
    if total_lovelace < lovelace_goal {
        return Err("Not Enough Lovelace".to_string());
    }

    // This is some semi legit fee to be used to estimate it
    let tmp_fee: u64 = 200_000;

    let datum_vector: Vec<u8> = datum.rerandomize().to_vec();

    let mut change_output: Output = Output::new(
        addr.clone(),
        total_lovelace - args.lovelace - tmp_fee,
    );
    for asset in tokens.items.clone() {
        change_output = change_output.add_asset(asset.policy_id, asset.token_name, asset.amount)
        .unwrap();
    }

    // build out the rest of the draft tx with the tmp fee
    draft_tx = draft_tx
        .output(
            Output::new(wallet_addr.clone(), args.lovelace).set_inline_datum(datum_vector.clone()),
        )
        .output(change_output)
        .fee(tmp_fee);
    
    let mut raw_tx: StagingTransaction = draft_tx.clone().remove_output(1).clear_fee();
    // build an intermediate tx for fee estimation
    let intermediate_tx: BuiltTransaction = draft_tx.build_conway_raw().unwrap();

    // we can fake the signature here to get the correct tx size
    let fake_signer_secret_key: SecretKey = SecretKey::new(&mut OsRng);
    let fake_signer_private_key: PrivateKey = PrivateKey::from(fake_signer_secret_key);

    // we need the script size here
    let tx_size: u64 = intermediate_tx
        .sign(fake_signer_private_key)
        .unwrap()
        .tx_bytes
        .0
        .len()
        .try_into()
        .unwrap();
    let tx_fee: u64 = fees::compute_linear_fee_policy(tx_size, &(fees::PolicyParams::default()));
    println!("\nTx Size Fee: {:?}", tx_fee);
    
    let mut change_output: Output = Output::new(
        addr.clone(),
        total_lovelace - args.lovelace - tx_size,
    );
    for asset in tokens.items.clone() {
        change_output = change_output.add_asset(asset.policy_id, asset.token_name, asset.amount)
        .unwrap();
    }
    // build out the rest of the draft tx with the tmp fee
    raw_tx = raw_tx
        .output(change_output)
        .fee(tx_fee);

    let tx: BuiltTransaction = raw_tx.build_conway_raw().unwrap();

    let tx_cbor: String = hex::encode(tx.tx_bytes);
    println!("\nTx Cbor: {:?}", tx_cbor.clone());

    // inject the tx cbor into the local webserver to prompt the wallet
    web_server::run_web_server(tx_cbor, network_flag).await;

    Ok(())
}
