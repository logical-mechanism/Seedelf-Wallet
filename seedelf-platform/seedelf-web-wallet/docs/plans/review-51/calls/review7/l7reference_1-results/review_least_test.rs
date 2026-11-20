//! Review scratch (l7reference#1): the change's least for the token sets the finding names, from the fixture's params.

use seedelf_core::assets::{Asset, Assets};
use seedelf_core::build;
use seedelf_core::transaction::wallet_minimum_lovelace_with_assets;
use seedelf_koios::koios::ProtocolParameters;
use serde_json::Value;

const POLICY: &str = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";

#[test]
fn print_the_least() {
    let rows: Value = serde_json::from_str(include_str!("fixtures/epoch_params.json")).unwrap();
    let params = ProtocolParameters::from_koios(&rows[0]).unwrap();
    let token = |name: &str, q: u64| Asset::new(POLICY.into(), hex::encode(name), q).unwrap();
    let sets = [
        ("none", Assets::new()),
        ("poolA", Assets::new().add(token("poolA", 1)).unwrap()),
        ("2 poolA", Assets::new().add(token("poolA", 2)).unwrap()),
        (
            "poolA+poolB",
            Assets::new()
                .add(token("poolA", 1))
                .unwrap()
                .add(token("poolB", 1))
                .unwrap(),
        ),
        (
            "2 poolA+poolB",
            Assets::new()
                .add(token("poolA", 2))
                .unwrap()
                .add(token("poolB", 1))
                .unwrap(),
        ),
    ];
    for (name, set) in sets {
        let least = wallet_minimum_lovelace_with_assets(&params, set.clone()).unwrap();
        let deposit = build::minimum_deposit(&params, &set).unwrap();
        println!("LEAST {name}: wallet_minimum_lovelace_with_assets {least}, minimum_deposit {deposit}");
    }
}
