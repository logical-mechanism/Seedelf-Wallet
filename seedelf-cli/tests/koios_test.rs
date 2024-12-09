use serde_json::Value;

#[test]
fn tx_hash_result() {
    let json_value = Value::String("1e8740c8eaeae2c97a84893776c301ed8072b6eede61ebb19f36c339".to_string());

    // Extract the string value in one line
    let extracted = json_value.as_str().unwrap_or("default");
    assert_eq!(extracted, "1e8740c8eaeae2c97a84893776c301ed8072b6eede61ebb19f36c339")
}
