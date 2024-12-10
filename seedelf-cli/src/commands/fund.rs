use clap::Args;
use pallas_addresses::Address;
use pallas_traverse::fees;
use pallas_txbuilder::{BuildConway, Input, Output, StagingTransaction};
use rand_core::OsRng;
use seedelf_cli::address;
use seedelf_cli::constants::{SEEDELF_POLICY_ID, WALLET_CONTRACT_HASH};
use seedelf_cli::data_structures;
use seedelf_cli::koios::{
    address_utxos, contains_policy_id, credential_utxos, extract_bytes_with_logging,
};
use seedelf_cli::schnorr::rerandomize;
use seedelf_cli::web_server;
use hex;


/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct FundArgs {
    /// Seedelf to send funds too
    #[arg(long, help = "The address sending funds.")]
    address: String,

    /// Seedelf to send funds too
    #[arg(long, help = "The Seedelf receiving funds.")]
    seedelf: String,

    /// The amount of ADA to send
    #[arg(long, help = "The amount of ADA being sent.")]
    amount: u64,
}

pub async fn run(args: FundArgs, network_flag: bool) -> Result<(), String> {
    if network_flag {
        println!("Running In Preprod Environment");
    }

    if args.amount < 2000000 {
        return Err("Not Enough Lovelace".to_string());
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
    let mut draft_tx = StagingTransaction::new();

    // this is what will be signed when the real fee is known
    let mut raw_tx = StagingTransaction::new();

    // we will assume lovelace only right now
    let mut total_lovelace: u64 = 0;

    let mut base_generator: String = String::new();
    let mut base_public_value: String = String::new();

    // we need to make sure we found something to remove else err
    let mut found_seedelf: bool = false;

    // we need about 2 ada for the utxo and another 2 for change so make it 5
    let lovelace_goal: u64 = 2000000 + args.amount;

    match credential_utxos(WALLET_CONTRACT_HASH, network_flag).await {
        Ok(utxos) => {
            for utxo in utxos {
                // Extract bytes
                if let Some((gen, pub_val)) = extract_bytes_with_logging(&utxo.inline_datum) {
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
                            base_generator = gen;
                            base_public_value = pub_val;
                        }
                    }
                }
            }
        }
        Err(err) => {
            eprintln!("Failed to fetch UTxOs: {}", err);
        }
    }
    // if the seedelf isn't found then error
    if !found_seedelf {
        return Err("Seedelf Not Found".to_string());
    }

    // This should probably be some generalized function later
    match address_utxos(&args.address, network_flag).await {
        Ok(utxos) => {
            // loop all the utxos found from the address
            for utxo in utxos {
                // get the lovelace on this utxo
                let lovelace: u64 = utxo.value.parse::<u64>().expect("Invalid Lovelace");
                if lovelace == 5000000 {
                    // its probably a collateral utxo
                    // draft and raw are built the same here
                } else {
                    // its probably not a collateral utxo
                    //
                    // for now lets just pick up ada only UTxOs for now
                    if let Some(assets) = &utxo.asset_list {
                        if assets.is_empty() && total_lovelace < lovelace_goal {
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
                            raw_tx = raw_tx.input(Input::new(
                                pallas_crypto::hash::Hash::new(
                                    hex::decode(utxo.tx_hash)
                                        .expect("Invalid hex string")
                                        .try_into()
                                        .expect("Failed to convert to 32-byte array"),
                                ),
                                utxo.tx_index,
                            ));
                            // just sum up all the lovelace of the ada only inputs
                            total_lovelace += lovelace;
                        }
                    }
                }
            }
        }
        Err(err) => {
            eprintln!("Failed to fetch UTxOs: {}", err);
        }
    }

    // This is some semi legit fee to be used to estimate it
    let tmp_fee: u64 = 200000;

    let (generator, public_value) = rerandomize(&base_generator, &base_public_value);
    let datum_vector = data_structures::create_register_datum(generator, public_value);

    // build out the rest of the draft tx with the tmp fee
    draft_tx = draft_tx
        .output(
            Output::new(wallet_addr.clone(), args.amount).set_inline_datum(datum_vector.clone()),
        )
        .output(Output::new(
            addr.clone(),
            total_lovelace - args.amount - tmp_fee,
        ))
        .fee(tmp_fee);

    // build an intermediate tx for fee estimation
    let intermediate_tx = draft_tx.build_conway_raw().unwrap();

    // we can fake the signature here to get the correct tx size
    let fake_signer_secret_key = pallas_crypto::key::ed25519::SecretKey::new(&mut OsRng);
    let fake_signer_private_key = pallas_wallet::PrivateKey::from(fake_signer_secret_key);

    // we need the script size here
    let tx_size: u64 = intermediate_tx
        .sign(fake_signer_private_key)
        .unwrap()
        .tx_bytes
        .0
        .len()
        .try_into()
        .unwrap();
    let tx_fee = fees::compute_linear_fee_policy(tx_size, &(fees::PolicyParams::default()));
    println!("Estimated Tx Fee: {:?}", tx_fee);

    // build out the rest of the draft tx with the tmp fee
    raw_tx = raw_tx
        .output(
            Output::new(wallet_addr.clone(), args.amount).set_inline_datum(datum_vector.clone()),
        )
        .output(Output::new(
            addr.clone(),
            total_lovelace - args.amount - tx_fee,
        ))
        .fee(tx_fee);

        let tx = raw_tx.build_conway_raw().unwrap();

        let tx_cbor = hex::encode(tx.tx_bytes);
        println!("Tx Cbor: {:?}", tx_cbor.clone());
    
        // inject the tx cbor into the local webserver to prompt the wallet
        web_server::run_web_server(tx_cbor, network_flag).await;

    Ok(())
}
