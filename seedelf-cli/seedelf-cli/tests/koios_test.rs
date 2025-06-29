use seedelf_core::address;
use seedelf_core::assets::{Asset, asset_id_to_asset};
use seedelf_core::constants::{ADA_HANDLE_POLICY_ID, Config, get_config};
use seedelf_koios::koios::{ada_handle_address, asset_history, datum_from_datum_hash, nft_utxo};
use serde_json::Value;
#[test]
fn tx_hash_result() {
    let json_value =
        Value::String("1e8740c8eaeae2c97a84893776c301ed8072b6eede61ebb19f36c339".to_string());

    // Extract the string value in one line
    let extracted = json_value.as_str().unwrap_or("default");
    assert_eq!(
        extracted,
        "1e8740c8eaeae2c97a84893776c301ed8072b6eede61ebb19f36c339"
    )
}

#[tokio::test]
async fn find_ada_handle() {
    let config: Config = get_config(1, false).unwrap();
    let name: String = "logic.mech".to_string();
    let wallet_addr: String = address::wallet_contract(false, config.contract.wallet_contract_hash)
        .to_bech32()
        .unwrap();
    let payment_address =
        ada_handle_address(name, false, false, 1, wallet_addr, ADA_HANDLE_POLICY_ID)
            .await
            .unwrap();
    assert_eq!(
        payment_address,
        "addr1q8rdcfvj5a27gmp04q5c4nuly385mseam09y777xa8mjn40ax0z9yaxg2mjj3ctg4uj6ggwsc6nja0kj446w2gv5zcvqjk47zh"
    )
}

#[tokio::test]
async fn find_nft_utxo() {
    let asset_id: String = String::from(
        "b558ea5ecfa2a6e9701dab150248e94104402f789c090426eb60eb60536e656b6b696533363333",
    );
    let asset: Asset = asset_id_to_asset(asset_id).unwrap();
    // println!("{} {}", asset.policy_id.to_string(), hex::encode(asset.token_name));
    let nft_utxo = nft_utxo(
        asset.policy_id.to_string(),
        hex::encode(asset.token_name),
        false,
    )
    .await;
    let utxo = nft_utxo.unwrap().first().unwrap().clone();
    println!("{:?}", utxo.tx_hash);
    if utxo.inline_datum.is_none() {
        if let Some(datum_hash) = utxo.datum_hash {
            println!("Datum Hash: {}", datum_hash);
            let datum = datum_from_datum_hash(datum_hash, false).await;
            println!("Datum: {:?}", datum);
        }
    }
}

#[tokio::test]
async fn find_datum() {
    let datum_hash: String =
        String::from("21eed8a2f7e4298c95ded10c5d2544f3c24ac45396167d1024bb04e6720f5f6b");
    let datum = datum_from_datum_hash(datum_hash, false).await;
    println!("Cant Find Datum: {:?}", datum);
}

#[tokio::test]
async fn test_asset_history() {
    let pid: String = String::from("b3ad6187273d174b586b1c86d4c6c7eeefa7bdca6dd819f125d4dd06");
    let tkn: String = String::from("74494147");
    let history = asset_history(pid, tkn, true, 5).await;
    assert_eq!(history.unwrap().len(), 5)
}
