//! The withdraw-zero patch (`seedelf_core::withdraw_zero`).

use pallas_codec::minicbor;
use pallas_primitives::Fragment;
use pallas_primitives::conway::{self, ExUnits, RedeemerTag, Redeemers};
use pallas_traverse::MultiEraTx;
use pallas_txbuilder::{BuildConway, Input, Output, ScriptKind, StagingTransaction};
use seedelf_core::withdraw_zero::{WithdrawZero, reward_account, script_data_hash};
use serde_json::Value;

fn cases() -> Vec<Value> {
    let doc: Value =
        serde_json::from_str(include_str!("fixtures/eval-preprod.json")).expect("fixture");
    doc["cases"].as_array().expect("cases").clone()
}

fn cost_model(case: &Value) -> Vec<i64> {
    case["cost_model_v3"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c.as_i64().unwrap())
        .collect()
}

const MIX_LOGIC: [u8; 28] =
    hex_literal::hex!("b7079c65f3b40b6da344bf68840eb0363af17787e8375004387348b8");

#[test]
fn the_script_data_hash_is_the_chains() {
    // Lovejoin's mixes and withdraws on preprod carry a withdraw-zero
    // redeemer; the hash of their redeemers and V3 view is in their bodies.
    for case in cases() {
        let bytes = hex::decode(case["tx"].as_str().unwrap()).unwrap();
        let tx = MultiEraTx::decode(&bytes).unwrap();
        let tx = tx.as_conway().unwrap();
        let redeemers = tx
            .transaction_witness_set
            .redeemer
            .as_ref()
            .expect("redeemers")
            .raw_cbor();
        let expected = tx
            .transaction_body
            .script_data_hash
            .expect("a script data hash");
        let got = script_data_hash(redeemers, None, &cost_model(&case)).unwrap();
        assert_eq!(got, expected, "{}", case["name"]);
    }
}

#[test]
fn the_recorded_withdrawals_are_mix_logics_reward_account() {
    for case in cases()
        .iter()
        .filter(|c| c["name"].as_str().unwrap().starts_with("lovejoin"))
    {
        let bytes = hex::decode(case["tx"].as_str().unwrap()).unwrap();
        let tx = MultiEraTx::decode(&bytes).unwrap();
        let withdrawals = tx.withdrawals_sorted_set();
        assert_eq!(withdrawals.len(), 1);
        assert_eq!(
            withdrawals[0].0,
            reward_account(&MIX_LOGIC, true).as_slice()
        );
        assert_eq!(withdrawals[0].1, 0);
    }
}

fn built() -> pallas_txbuilder::BuiltTransaction {
    // An enterprise key address on a test network.
    let mut raw = vec![0x60];
    raw.extend([9u8; 28]);
    let address = pallas_addresses::Address::from_bytes(&raw).unwrap();
    StagingTransaction::new()
        .input(Input::new([7u8; 32].into(), 0))
        .output(Output::new(address, 5_000_000))
        .fee(200_000)
        .language_view(ScriptKind::PlutusV3, vec![1, 2, 3])
        .build_conway_raw()
        .unwrap()
}

#[test]
fn a_patch_adds_the_withdrawal_and_its_redeemer() {
    let before = built();
    let redeemer = hex::decode("d87980").unwrap();
    let patch = WithdrawZero::new(&MIX_LOGIC, true, &redeemer).unwrap();
    let budget = ExUnits {
        mem: 1_000,
        steps: 2_000,
    };
    let after = patch.patch(before.clone(), budget, &[1, 2, 3]).unwrap();
    assert_ne!(after.tx_hash.0, before.tx_hash.0);

    let tx = conway::Tx::decode_fragment(&after.tx_bytes.0).unwrap();
    let withdrawals = tx.transaction_body.withdrawals.as_ref().unwrap();
    assert_eq!(withdrawals.len(), 1);
    assert_eq!(withdrawals[0].0.to_vec(), reward_account(&MIX_LOGIC, true));
    assert_eq!(withdrawals[0].1, 0);

    let Some(Redeemers::List(list)) = &tx.transaction_witness_set.redeemer else {
        panic!("redeemers as a list");
    };
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].tag, RedeemerTag::Reward);
    assert_eq!(list[0].index, 0);
    assert_eq!(list[0].ex_units, budget);

    // The body's hash covers what the witness set now holds.
    let redeemers =
        minicbor::to_vec(tx.transaction_witness_set.redeemer.as_ref().unwrap()).unwrap();
    assert_eq!(
        tx.transaction_body.script_data_hash,
        Some(script_data_hash(&redeemers, None, &[1, 2, 3]).unwrap())
    );
    assert_eq!(
        after.tx_hash.0,
        *seedelf_core::build::tx_id(&after.tx_bytes.0).unwrap()
    );

    // Patching again with the measured budget replaces the redeemer.
    let measured = ExUnits { mem: 9, steps: 99 };
    let again = patch.patch(after, measured, &[1, 2, 3]).unwrap();
    let tx = conway::Tx::decode_fragment(&again.tx_bytes.0).unwrap();
    let Some(Redeemers::List(list)) = &tx.transaction_witness_set.redeemer else {
        panic!("redeemers as a list");
    };
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].ex_units, measured);
}

#[test]
fn a_signed_transaction_is_not_patched() {
    let mut signed = built();
    signed.signatures = Some(Default::default());
    let patch = WithdrawZero::new(&MIX_LOGIC, true, &hex::decode("d87980").unwrap()).unwrap();
    let err = patch
        .patch(signed, ExUnits { mem: 1, steps: 1 }, &[1])
        .unwrap_err()
        .to_string();
    assert!(err.contains("before it's signed"), "{err}");
}

#[test]
fn mainnet_reward_accounts_have_the_mainnet_header() {
    assert_eq!(reward_account(&MIX_LOGIC, false)[0], 0xf1);
    assert_eq!(reward_account(&MIX_LOGIC, true)[0], 0xf0);
}
