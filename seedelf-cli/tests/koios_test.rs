use serde_json::Value;
use seedelf_cli::koios::nft_address;
#[test]
fn tx_hash_result() {
    let json_value = Value::String("1e8740c8eaeae2c97a84893776c301ed8072b6eede61ebb19f36c339".to_string());

    // Extract the string value in one line
    let extracted = json_value.as_str().unwrap_or("default");
    assert_eq!(extracted, "1e8740c8eaeae2c97a84893776c301ed8072b6eede61ebb19f36c339")
}

#[tokio::test]
async fn find_ada_handle() {
    let name: String = "logic.mech".to_string();
    let payment_address = nft_address(name, false, false).await.unwrap();
    assert_eq!(payment_address, "addr1q8rdcfvj5a27gmp04q5c4nuly385mseam09y777xa8mjn40ax0z9yaxg2mjj3ctg4uj6ggwsc6nja0kj446w2gv5zcvqjk47zh")

}

