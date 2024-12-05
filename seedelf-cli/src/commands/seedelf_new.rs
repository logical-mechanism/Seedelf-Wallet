use crate::setup;
use clap::Args;
use hex::encode;
use pallas_addresses;
use pallas_crypto;
use pallas_traverse::fees;
use pallas_txbuilder::{BuildConway, StagingTransaction};
use pallas_txbuilder::{Input, Output};
use pallas_wallet;
use rand_core::OsRng;
use seedelf_cli::constants::WALLET_CONTRACT_HASH;
use seedelf_cli::data_structures::Data;
use seedelf_cli::koios::address_utxos;
use seedelf_cli::schnorr::{create_register, rerandomize};
use seedelf_cli::web_server;

/// Struct to hold command-specific arguments
#[derive(Args)]
pub struct LabelArgs {
    #[arg(long, help = "The payee address.")]
    address: String,

    #[arg(long, help = "The seedelf label / personal tag.")]
    label: String,
}

pub async fn run(args: LabelArgs, network_flag: bool) -> Result<(), String> {
    // we need to make sure that the network flag and the address provided makes sense here
    let addr = pallas_addresses::Address::from_bech32(args.address.as_str()).unwrap();

    // wallet script address
    let shelly_wallet_address = if network_flag {
        pallas_addresses::ShelleyAddress::new(
            pallas_addresses::Network::Testnet,
            pallas_addresses::ShelleyPaymentPart::Script(pallas_addresses::ScriptHash::new(
                hex::decode(WALLET_CONTRACT_HASH)
                    .unwrap()
                    .try_into()
                    .expect("Not Correct Length"),
            )),
            pallas_addresses::ShelleyDelegationPart::Null,
        )
    } else {
        pallas_addresses::ShelleyAddress::new(
            pallas_addresses::Network::Mainnet,
            pallas_addresses::ShelleyPaymentPart::Script(pallas_addresses::ScriptHash::new(
                hex::decode(WALLET_CONTRACT_HASH)
                    .unwrap()
                    .try_into()
                    .expect("Not Correct Length"),
            )),
            pallas_addresses::ShelleyDelegationPart::Null,
        )
    };
    // we need this as the address type and not the shelley
    let wallet_addr = pallas_addresses::Address::from(shelly_wallet_address.clone());
    println!("Wallet Address {:?}", shelly_wallet_address.to_bech32().unwrap());

    // no address can be apart of a script
    // if preprod then it must be a testnet address
    if network_flag
        && pallas_addresses::Address::network(&addr) == Some(pallas_addresses::Network::Testnet)
        && !pallas_addresses::Address::has_script(&addr)
    {
        println!("\nRunning In Preprod Environment");
    } else if !network_flag
        && pallas_addresses::Address::network(&addr) == Some(pallas_addresses::Network::Mainnet)
        && !pallas_addresses::Address::has_script(&addr)
    {
        // this is mainnet
    } else {
        // this is some mix so error here
        return Err("Network Flag and Address Do Not Agree".to_string());
    }

    // this is used to calculate the real fee
    let mut draft_tx = StagingTransaction::new();

    // this is what will be signed when the real fee is known
    let mut raw_tx = StagingTransaction::new();

    // we will assume lovelace only right now
    let mut total_lovelace: u64 = 0;

    match address_utxos(&args.address, network_flag).await {
        Ok(utxos) => {
            for utxo in utxos {
                let lovelace: u64 = utxo.value.parse::<u64>().expect("Invalid Lovelace");
                if lovelace == 5000000 {
                    // println!("Found Potential Collateral");
                    // will need to add in the collateral input here
                    // the output will be added later to account for the fee correctly
                } else {
                    // its not the assumed collateral
                    // for now lets just pick up ada only UTxOs for now
                    if let Some(assets) = &utxo.asset_list {
                        if assets.is_empty() {
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
    // some test amounts to send
    // This send amount needs to be the min ada required to hold the token and the datum
    let send_amount = 2345678;
    let tmp_fee: u64 = 200000;

    // this is going to be the datum on the seedelf
    let sk = setup::load_wallet();
    let (base_generator, base_public_value) = create_register(sk);
    let (generator, public_value) = rerandomize(&base_generator, &base_public_value);
    let datum_vector = Data::new(&generator, &public_value).to_cbor();

    // build out the rest of the draft tx with the tmp fee
    draft_tx = draft_tx
        .output(Output::new(wallet_addr.clone(), send_amount).set_inline_datum(datum_vector.clone()))
        .output(Output::new(
            addr.clone(),
            total_lovelace - send_amount - tmp_fee,
        ))
        .change_address(addr.clone())
        .fee(tmp_fee);

    // build an intermediate tx for fee estimation
    let intermediate_tx = draft_tx.build_conway_raw().unwrap();
    // we can fake the signature here to get the correct tx size
    let fake_signer_secret_key = pallas_crypto::key::ed25519::SecretKey::new(&mut OsRng);
    let fake_signer_private_key = pallas_wallet::PrivateKey::from(fake_signer_secret_key);

    let tx_size: u64 = intermediate_tx
        .sign(fake_signer_private_key)
        .unwrap()
        .tx_bytes
        .0
        .len()
        .try_into()
        .unwrap();
    let fee = fees::compute_linear_fee_policy(tx_size, &(fees::PolicyParams::default()));

    // build of the rest of the raw tx with the correct fee
    raw_tx = raw_tx
        .output(Output::new(wallet_addr.clone(), send_amount).set_inline_datum(datum_vector.clone()))
        .output(Output::new(
            addr.clone(),
            total_lovelace - send_amount - fee,
        ))
        .change_address(addr)
        .fee(fee);

    let tx = raw_tx.build_conway_raw().unwrap();
    println!("Estimated Tx Fee: {:?}", fee);

    let tx_cbor = encode(tx.tx_bytes);
    println!("Tx: {:?}", tx_cbor.clone());

    // we use pallas here to create valid cbor for creating a new seedelf
    web_server::run_web_server(tx_cbor, network_flag).await;
    Ok(())
}
