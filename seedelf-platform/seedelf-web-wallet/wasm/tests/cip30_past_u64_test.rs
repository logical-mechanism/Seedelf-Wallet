//! Chunk 51, w2#5: a token the account holds past a u64 in all, which a
//! stranger makes with three mints of 2^63 − 1 (the most one transaction
//! mints, Conway's `mint = multiasset<nonZeroInt64>`) paid to the account.
//! Each output holds a u64 at most, as the ledger keeps one; together they
//! don't. getBalance (`value_cbor`) failed for every site on the account,
//! and a site's transaction spending all three, which the ledger takes, was
//! refused ("a token amount overflows"). Both run on code that was there.

use pallas_codec::utils::{Bytes, NonEmptyKeyValuePairs, Nullable, Set};
use pallas_crypto::hash::Hash;
use pallas_primitives::{Fragment, PositiveCoin, TransactionInput, conway};
use seedelf_crypto::cardano::{CardanoAccount, Role};
use seedelf_wasm::cip30::{self, KeyPath, KoiosRow, Token, TxRequest};

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const TX_A: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const JUNK: &str = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const NAME: &str = "6a756e6b";
/// The most one transaction mints of a token.
const MOST_ONE_MINT: u64 = 9_223_372_036_854_775_807;

fn token(policy: &str, quantity: &str) -> Token {
    Token {
        policy_id: policy.into(),
        asset_name: NAME.into(),
        quantity: quantity.into(),
    }
}

/// getBalance's total past a u64 is written as u64::MAX, CIP-30's own ceiling, the account's other tokens as they
/// are; one that isn't a whole number is still refused.
#[test]
fn a_balance_past_a_u64_is_written_at_cip30s_ceiling() {
    let three = (3 * u128::from(MOST_ONE_MINT)).to_string();
    assert_eq!(three, "27670116110564327421");
    let own = "84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255";
    let read = |tokens: &[Token]| -> Result<(u64, Vec<Token>), String> {
        let bytes = cip30::value_cbor("4500000", tokens).map_err(|e| e.to_string())?;
        cip30::read_value(&hex::encode(bytes)).map_err(|e| e.to_string())
    };
    assert_eq!(
        read(&[token(JUNK, &three), token(own, "5")]),
        Ok((
            4_500_000,
            vec![token(own, "5"), token(JUNK, &u64::MAX.to_string())]
        ))
    );
    // Past even a u128: as far past what a Value holds.
    assert_eq!(
        read(&[token(JUNK, &"9".repeat(40))]),
        Ok((4_500_000, vec![token(JUNK, &u64::MAX.to_string())]))
    );
    for malformed in ["12a", "-5", ""] {
        let refused = read(&[token(JUNK, malformed)]).unwrap_err();
        assert!(
            refused.contains("isn't a whole number"),
            "{malformed:?}: {refused}"
        );
    }
}

fn account() -> CardanoAccount {
    CardanoAccount::from_phrase(PHRASE, 0).unwrap()
}

/// One of the account's UTxOs at `0/0`: 2 ₳ and the most one mint makes of the stranger's token.
fn junk_row(index: u64) -> KoiosRow {
    serde_json::from_value(serde_json::json!({
        "tx_hash": TX_A,
        "tx_index": index,
        "address": account().base_address(true, Role::Receive, 0).unwrap().to_bech32().unwrap(),
        "value": "2000000",
        "asset_list": [{ "policy_id": JUNK, "asset_name": NAME, "quantity": MOST_ONE_MINT.to_string() }],
    }))
    .unwrap()
}

/// An output to the account's `1/0` of `lovelace` and `quantity` of the stranger's token.
fn change(lovelace: u64, quantity: u64) -> conway::TransactionOutput {
    let names = NonEmptyKeyValuePairs::try_from(vec![(
        Bytes::from(hex::decode(NAME).unwrap()),
        PositiveCoin::try_from(quantity).unwrap(),
    )])
    .unwrap();
    let policy: Hash<28> = Hash::new(hex::decode(JUNK).unwrap().try_into().unwrap());
    conway::PseudoTransactionOutput::PostAlonzo(conway::PostAlonzoTransactionOutput {
        address: Bytes::from(
            account()
                .base_address(true, Role::Change, 0)
                .unwrap()
                .to_vec(),
        ),
        value: conway::Value::Multiasset(
            lovelace,
            NonEmptyKeyValuePairs::try_from(vec![(policy, names)]).unwrap(),
        ),
        datum_option: None,
        script_ref: None,
    })
}

/// A site's transaction spending the three, and paying all of the token back to the account in two outputs, each
/// within a u64, as the ledger takes it: read, its figures exact, never refused.
#[test]
fn a_sites_transaction_spending_a_strangers_mints_is_read_not_refused() {
    let first = u64::MAX;
    let rest = u64::try_from(3 * u128::from(MOST_ONE_MINT) - u128::from(first)).unwrap();
    let body = conway::TransactionBody {
        inputs: Set::from(
            (0..3)
                .map(|index| TransactionInput {
                    transaction_id: Hash::new(hex::decode(TX_A).unwrap().try_into().unwrap()),
                    index,
                })
                .collect::<Vec<_>>(),
        ),
        outputs: vec![change(2_000_000, first), change(3_800_000, rest)],
        fee: 200_000,
        ttl: None,
        certificates: None,
        withdrawals: None,
        auxiliary_data_hash: None,
        validity_interval_start: None,
        mint: None,
        script_data_hash: None,
        collateral: None,
        required_signers: None,
        network_id: None,
        collateral_return: None,
        total_collateral: None,
        reference_inputs: None,
        voting_procedures: None,
        proposal_procedures: None,
        treasury_value: None,
        donation: None,
    };
    let tx = conway::Tx {
        transaction_body: body,
        transaction_witness_set: conway::WitnessSet {
            vkeywitness: None,
            native_script: None,
            bootstrap_witness: None,
            plutus_v1_script: None,
            plutus_data: None,
            redeemer: None,
            plutus_v2_script: None,
            plutus_v3_script: None,
        },
        success: true,
        auxiliary_data: Nullable::Null,
    };
    let request = TxRequest {
        network: "preprod".into(),
        tx_cbor: hex::encode(tx.encode_fragment().unwrap()),
        keys: (0..3)
            .flat_map(|index| [KeyPath { role: 0, index }, KeyPath { role: 1, index }])
            .collect(),
        inputs: (0..3).map(junk_row).collect(),
        partial_sign: false,
        stake_index: 0,
        stake_deposit: None,
        governance: false,
    };
    let summary = cip30::inspect_tx(&account(), &request).map_err(|e| e.to_string());
    let read = summary.map(|s| {
        (
            s.net_lovelace,
            s.net_tokens,
            s.own_outputs
                .iter()
                .flat_map(|o| o.tokens.iter().map(|t| t.quantity.clone()))
                .collect::<Vec<_>>(),
        )
    });
    // All of it comes back: the account's net is the fee alone, and no token.
    assert_eq!(
        read,
        Ok((
            "-200000".to_string(),
            vec![],
            vec![first.to_string(), rest.to_string()]
        ))
    );
}
