use crate::setup;
use clap::Args;
use hex::encode;
use pallas_addresses::Address;
use pallas_crypto;
use pallas_traverse::fees;
use pallas_txbuilder::{BuildConway, StagingTransaction};
use pallas_txbuilder::{Input, Output};
use pallas_wallet;
use rand_core::OsRng;
use seedelf_cli::address;
use seedelf_cli::constants::{SEEDELF_POLICY_ID, PREPROD_SEEDELF_REFERENCE_UTXO};
use seedelf_cli::data_structures;
use seedelf_cli::koios::address_utxos;
use seedelf_cli::schnorr::{create_register, rerandomize};
use seedelf_cli::transaction;
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
    let addr: Address = pallas_addresses::Address::from_bech32(args.address.as_str()).unwrap();
    if !(address::is_not_a_script(addr.clone())
        && address::is_on_correct_network(addr.clone(), network_flag))
    {
        return Err("Supplied Address Is Incorrect".to_string());
    }

    // we need this as the address type and not the shelley
    let wallet_addr: Address = address::wallet_contract(network_flag);

    // if preprod then print the preprod message
    if network_flag {
        println!("\nRunning In Preprod Environment");
    }

    // this is used to calculate the real fee
    let mut draft_tx = StagingTransaction::new();

    // this is what will be signed when the real fee is known
    let mut raw_tx = StagingTransaction::new();

    // we will assume lovelace only right now
    let mut total_lovelace: u64 = 0;

    // there may be many collateral utxos, we just need one
    let mut found_collateral: bool = false;

    // This should probably be some generalized function later
    match address_utxos(&args.address, network_flag).await {
        Ok(utxos) => {
            // loop all the utxos found from the address
            for utxo in utxos {
                // get the lovelace on this utxo
                let lovelace: u64 = utxo.value.parse::<u64>().expect("Invalid Lovelace");
                if lovelace == 5000000 {
                    // its probably a collateral utxo
                    // println!("Found Potential Collateral: {:?}", utxo);
                    // draft and raw are built the same here
                    if !found_collateral {
                        draft_tx = draft_tx.collateral_input(Input::new(
                            pallas_crypto::hash::Hash::new(
                                hex::decode(utxo.tx_hash.clone())
                                    .expect("Invalid hex string")
                                    .try_into()
                                    .expect("Failed to convert to 32-byte array"),
                            ),
                            utxo.tx_index,
                        ));
                        raw_tx = raw_tx.collateral_input(Input::new(
                            pallas_crypto::hash::Hash::new(
                                hex::decode(utxo.tx_hash)
                                    .expect("Invalid hex string")
                                    .try_into()
                                    .expect("Failed to convert to 32-byte array"),
                            ),
                            utxo.tx_index,
                        ));
                        found_collateral = true;
                    }
                } else {
                    // its probably not a collateral utxo
                    //
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
    // This send amount needs to be the min ada required to hold the token and the datum
    let tmp_fee: u64 = 200000;

    // this is going to be the datum on the seedelf
    let sk = setup::load_wallet();
    // use the base register to rerandomize for the datum
    let (base_generator, base_public_value) = create_register(sk);
    let (generator, public_value) = rerandomize(&base_generator, &base_public_value);
    let datum_vector = data_structures::create_register_datum(generator, public_value);
    let redeemer_vector = data_structures::create_mint_redeemer(args.label.clone());

    // lets build the seelfelf token
    // hex the label
    let label_hex = hex::encode(args.label);
    // find the smallest input, first in lexicogrpahical order
    let smallest_input = draft_tx
        .inputs
        .as_ref()
        .and_then(|inputs| {
            inputs.iter().min_by(|a, b| {
                a.tx_hash
                    .0
                    .cmp(&b.tx_hash.0)
                    .then(a.txo_index.cmp(&b.txo_index))
            })
        })
        .unwrap();
    // format the tx index
    let formatted_index = format!("{:02x}", smallest_input.txo_index);
    let tx_hash_hex = hex::encode(smallest_input.tx_hash.0);
    let prefix = "5eed0e1f";
    let concatenated = format!("{}{}{}{}", prefix, label_hex, formatted_index, tx_hash_hex);
    let token_name = hex::decode(&concatenated[..64.min(concatenated.len())]).unwrap();

    // This is a staging output to calculate what the minimum required lovelace is for this output. Default it to 5 ADA so the bytes get calculated.
    let staging_output: Output = Output::new(wallet_addr.clone(), 5000000)
        .set_inline_datum(datum_vector.clone())
        .add_asset(
            pallas_crypto::hash::Hash::new(
                hex::decode(SEEDELF_POLICY_ID)
                    .unwrap()
                    .try_into()
                    .expect("Not Correct Length"),
            ),
            token_name.clone(),
            1,
        )
        .unwrap();
    let min_utxo: u64 = transaction::calculate_min_required_utxo(staging_output);
    println!("Minimum Required Lovelace: {:?}", min_utxo);

    // build out the rest of the draft tx with the tmp fee
    draft_tx = draft_tx
        .output(
            Output::new(wallet_addr.clone(), min_utxo)
                .set_inline_datum(datum_vector.clone())
                .add_asset(
                    pallas_crypto::hash::Hash::new(
                        hex::decode(SEEDELF_POLICY_ID)
                            .unwrap()
                            .try_into()
                            .expect("Not Correct Length"),
                    ),
                    token_name.clone(),
                    1,
                )
                .unwrap(),
        )
        .output(Output::new(
            addr.clone(),
            total_lovelace - min_utxo - tmp_fee,
        ))
        .collateral_output(Output::new(addr.clone(), 5000000 - (tmp_fee)*3/2))
        .fee(tmp_fee)
        .mint_asset(
            pallas_crypto::hash::Hash::new(
                hex::decode(SEEDELF_POLICY_ID)
                    .unwrap()
                    .try_into()
                    .expect("Not Correct Length"),
            ),
            token_name.clone(),
            1,
        )
        .unwrap()
        .reference_input(Input::new(
            pallas_crypto::hash::Hash::new(
                hex::decode(PREPROD_SEEDELF_REFERENCE_UTXO)
                    .expect("Invalid hex string")
                    .try_into()
                    .expect("Failed to convert to 32-byte array"),
            ),
            1,
        ))
        .add_mint_redeemer(pallas_crypto::hash::Hash::new(
            hex::decode(SEEDELF_POLICY_ID)
                .expect("Invalid hex string")
                .try_into()
                .expect("Failed to convert to 32-byte array"),
        ), redeemer_vector.clone(), Some(pallas_txbuilder::ExUnits { mem: 0, steps: 0 }));

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
        .output(
            Output::new(wallet_addr.clone(), min_utxo)
                .set_inline_datum(datum_vector.clone())
                .add_asset(
                    pallas_crypto::hash::Hash::new(
                        hex::decode(SEEDELF_POLICY_ID)
                            .unwrap()
                            .try_into()
                            .expect("Not Correct Length"),
                    ),
                    token_name.clone(),
                    1,
                )
                .unwrap(),
        )
        .output(Output::new(addr.clone(), total_lovelace - min_utxo - fee))
        .collateral_output(Output::new(addr.clone(), 5000000 - (fee)*3/2))
        .fee(fee)
        .mint_asset(
            pallas_crypto::hash::Hash::new(
                hex::decode(SEEDELF_POLICY_ID)
                    .unwrap()
                    .try_into()
                    .expect("Not Correct Length"),
            ),
            token_name.clone(),
            1,
        )
        .unwrap()
        .reference_input(Input::new(
            pallas_crypto::hash::Hash::new(
                hex::decode(PREPROD_SEEDELF_REFERENCE_UTXO)
                    .expect("Invalid hex string")
                    .try_into()
                    .expect("Failed to convert to 32-byte array"),
            ),
            1,
        ))
        .add_mint_redeemer(pallas_crypto::hash::Hash::new(
            hex::decode(SEEDELF_POLICY_ID)
                .expect("Invalid hex string")
                .try_into()
                .expect("Failed to convert to 32-byte array"),
        ), redeemer_vector.clone(), Some(pallas_txbuilder::ExUnits { mem: 0, steps: 0 }));

    let tx = raw_tx.build_conway_raw().unwrap();
    println!("Estimated Tx Fee: {:?}", fee);

    let tx_cbor = encode(tx.tx_bytes);
    println!("Tx Cbor: {:?}", tx_cbor.clone());

    // we use pallas here to create valid cbor for creating a new seedelf
    web_server::run_web_server(tx_cbor, network_flag).await;
    Ok(())
}
