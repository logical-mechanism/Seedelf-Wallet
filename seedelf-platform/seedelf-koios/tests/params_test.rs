//! The protocol parameters as Koios gives them (`ProtocolParameters::from_koios`):
//! the wallet trusts Koios for them, and the ledger takes any overpayment, so
//! a parameter far off the network's is refused.

use seedelf_koios::koios::{
    MAX_COINS_PER_UTXO_SIZE, MAX_KEY_DEPOSIT, MAX_MIN_FEE_A, MAX_MIN_FEE_B, MAX_PRICE_MEM,
    MAX_PRICE_STEP, ProtocolParameters,
};
use serde_json::{Value, json};

/// Preprod's `epoch_params`, as recorded.
fn recorded() -> Value {
    let rows: Value = serde_json::from_str(include_str!(
        "../../seedelf-core/tests/fixtures/epoch_params.json"
    ))
    .unwrap();
    rows[0].clone()
}

#[test]
fn the_networks_parameters_read_as_they_are() {
    let params = ProtocolParameters::from_koios(&recorded()).unwrap();
    assert_eq!((params.min_fee_a, params.min_fee_b), (44, 155_381));
    assert_eq!(params.coins_per_utxo_size, 4_310);
    assert_eq!(params.key_deposit, 2_000_000);
    assert_eq!((params.price_mem, params.price_step), (0.0577, 0.0000721));

    // Up to each limit, they're taken.
    let mut most = recorded();
    most["min_fee_a"] = json!(MAX_MIN_FEE_A);
    most["min_fee_b"] = json!(MAX_MIN_FEE_B.to_string());
    most["coins_per_utxo_size"] = json!(MAX_COINS_PER_UTXO_SIZE.to_string());
    most["key_deposit"] = json!(MAX_KEY_DEPOSIT.to_string());
    most["price_mem"] = json!(MAX_PRICE_MEM);
    most["price_step"] = json!(MAX_PRICE_STEP);
    assert!(ProtocolParameters::from_koios(&most).is_ok());
}

#[test]
fn a_parameter_far_off_the_networks_is_refused() {
    for (field, wrong) in [
        ("min_fee_a", json!(MAX_MIN_FEE_A + 1)),
        ("min_fee_b", json!(40_000_000)),
        ("min_fee_b", json!("40000000")),
        (
            "coins_per_utxo_size",
            json!((MAX_COINS_PER_UTXO_SIZE + 1).to_string()),
        ),
        ("key_deposit", json!((MAX_KEY_DEPOSIT + 1).to_string())),
        ("price_mem", json!(0.6)),
        ("price_mem", json!(-0.0577)),
        ("price_step", json!(0.001)),
    ] {
        let mut params = recorded();
        params[field] = wrong.clone();
        let err = ProtocolParameters::from_koios(&params)
            .unwrap_err()
            .to_string();
        assert!(
            err.contains(&format!("The network's {field} from Koios looks wrong")),
            "{field} {wrong}: {err}"
        );
    }
}
