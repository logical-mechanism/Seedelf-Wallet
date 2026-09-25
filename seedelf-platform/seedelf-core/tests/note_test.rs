//! A note on a payment from the Cardano account: CIP-20's message, patched
//! into the built transaction. Each one is decoded and checked: the metadata
//! under label 674, the body's hash of it, the transaction's hash, and a fee
//! that pays for the note's bytes.

use pallas_addresses::Address;
use pallas_crypto::hash::Hasher;
use pallas_primitives::Metadatum;
use pallas_primitives::Nullable;
use pallas_traverse::MultiEraTx;
use seedelf_core::build::{self, AccountAmount, AccountPay, Payee, fake_signer, tx_id};
use seedelf_core::note::{MAX_NOTE_CHARS, NOTE_LABEL, Note};
use seedelf_core::staking::{StakeKey, StakeState, Staking};
use seedelf_crypto::cardano::{CardanoAccount, Role};
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse};

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

fn params() -> ProtocolParameters {
    let rows: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/epoch_params.json")).unwrap();
    ProtocolParameters::from_koios(&rows[0]).unwrap()
}

fn account() -> CardanoAccount {
    CardanoAccount::from_phrase(PHRASE, 0).unwrap()
}

fn elsewhere() -> Address {
    CardanoAccount::from_phrase(PHRASE, 1)
        .unwrap()
        .base_address(true, Role::Receive, 0)
        .unwrap()
}

fn utxo(account: &CardanoAccount, n: u8, lovelace: u64) -> UtxoResponse {
    UtxoResponse {
        tx_hash: hex::encode([n; 32]),
        tx_index: 0,
        address: account
            .base_address(true, Role::Receive, 0)
            .unwrap()
            .to_bech32()
            .unwrap(),
        value: lovelace.to_string(),
        payment_cred: hex::encode(account.key_hash(Role::Receive, 0).unwrap()),
        asset_list: Some(vec![]),
        ..Default::default()
    }
}

fn send(staking: &Staking, note: Option<&Note>) -> build::AccountPayment {
    let account = account();
    let to = elsewhere();
    build::account_send_many(
        &params(),
        &[utxo(&account, 1, 20_000_000)],
        &[AccountPay::new(
            Payee::Address(&to),
            AccountAmount::Lovelace(5_000_000),
            &[],
        )],
        true,
        &account.base_address(true, Role::Receive, 0).unwrap(),
        staking,
        note,
    )
    .unwrap()
}

/// CIP-20's lines under label 674, and whether the body's hash of the
/// auxiliary data matches its bytes.
fn message_of(bytes: &[u8]) -> (Vec<String>, bool) {
    let tx = MultiEraTx::decode(bytes).unwrap();
    let conway = tx.as_conway().unwrap();
    let Nullable::Some(raw) = &conway.auxiliary_data else {
        panic!("no auxiliary data");
    };
    let hash = conway
        .transaction_body
        .auxiliary_data_hash
        .as_ref()
        .unwrap();
    let matches = hash.to_vec() == Hasher::<256>::hash(raw.raw_cbor()).to_vec();
    let Some(Metadatum::Map(message)) = tx.metadata().find(NOTE_LABEL).cloned() else {
        panic!("no message under 674");
    };
    let lines = message
        .iter()
        .find(|(k, _)| *k == Metadatum::Text("msg".to_string()))
        .map(|(_, v)| match v {
            Metadatum::Array(lines) => lines
                .iter()
                .map(|l| match l {
                    Metadatum::Text(t) => t.clone(),
                    other => panic!("a line that isn't text: {other:?}"),
                })
                .collect(),
            other => panic!("msg isn't a list: {other:?}"),
        })
        .unwrap();
    (lines, matches)
}

#[test]
fn a_note_is_one_line_of_at_most_64_characters() {
    assert_eq!(Note::new("").unwrap(), None);
    assert_eq!(Note::new("   ").unwrap(), None);
    let note = Note::new("  Invoice 42  ").unwrap().unwrap();
    assert_eq!(note.lines(), ["Invoice 42"]);
    assert_eq!(note.text(), "Invoice 42");

    let full = "x".repeat(MAX_NOTE_CHARS);
    assert_eq!(Note::new(&full).unwrap().unwrap().lines(), [full.as_str()]);
    let long = Note::new(&"x".repeat(MAX_NOTE_CHARS + 1)).unwrap_err();
    assert_eq!(long.to_string(), "A note is at most 64 characters, not 65");

    for text in ["two\nlines", "a\ttab", "bell\u{7}"] {
        let e = Note::new(text).unwrap_err().to_string();
        assert_eq!(e, "A note is one line of text, with no tabs or line breaks");
    }
}

#[test]
fn a_note_over_64_bytes_is_split_into_lines_that_fit() {
    // 59 characters, 81 bytes, with spaces: cut at the last space that fits.
    let text = "ünïcödé wörds ünïcödé wörds ünïcödé wörds ünïcödé wörds ünï";
    assert_eq!((text.chars().count(), text.len()), (59, 81));
    let note = Note::new(text).unwrap().unwrap();
    assert!(note.lines().len() > 1);
    assert!(note.lines().iter().all(|l| l.len() <= 64));
    assert_eq!(note.text(), text, "rejoined at the spaces it was cut at");

    // No spaces: cut between characters, never inside one.
    let dense = "é".repeat(MAX_NOTE_CHARS);
    let note = Note::new(&dense).unwrap().unwrap();
    let half = "é".repeat(32);
    assert_eq!(note.lines(), [half.as_str(), half.as_str()]);
}

#[test]
fn a_send_carries_its_note_and_its_fee_pays_for_it() {
    let note = Note::new("Rent for September · flat 3").unwrap().unwrap();
    let plain = send(&Staking::none(), None);
    let noted = send(&Staking::none(), Some(&note));

    let (lines, hash_matches) = message_of(&noted.tx.tx_bytes.0);
    assert_eq!(lines, ["Rent for September · flat 3"]);
    assert!(
        hash_matches,
        "the body carries the hash of the note's bytes"
    );
    assert_eq!(
        noted.tx.tx_hash.0,
        *tx_id(&noted.tx.tx_bytes.0).unwrap(),
        "the transaction's hash is the patched body's"
    );
    assert!(
        MultiEraTx::decode(&plain.tx.tx_bytes.0)
            .unwrap()
            .metadata()
            .find(NOTE_LABEL)
            .is_none()
    );

    // The note's bytes are paid for, by the ledger's formula, once signed.
    assert!(noted.fee > plain.fee);
    let signed = noted.tx.clone().sign(fake_signer()).unwrap();
    let size = signed.tx_bytes.0.len() as u64;
    let params = params();
    let minimum = params.min_fee_a * size + params.min_fee_b;
    assert!(noted.fee >= minimum, "fee {} < {minimum}", noted.fee);
    assert!(noted.fee < minimum + 1_000);
    assert_eq!(noted.change_lovelace, 20_000_000 - 5_000_000 - noted.fee);
}

#[test]
fn a_note_and_a_reward_withdrawal_go_together() {
    let account = account();
    let key = StakeKey::new(&account.stake_address(true).unwrap()).unwrap();
    let state = StakeState {
        registered: true,
        deposit: 2_000_000,
        rewards: 3_000_000,
        votes: true,
    };
    let rewards = Staking::withdraw(&key, &state).unwrap();
    let note = Note::new("with rewards").unwrap().unwrap();
    let built = send(&rewards, Some(&note));

    let (lines, hash_matches) = message_of(&built.tx.tx_bytes.0);
    assert_eq!(lines, ["with rewards"]);
    assert!(hash_matches);
    let tx = MultiEraTx::decode(&built.tx.tx_bytes.0).unwrap();
    let withdrawn: u64 = tx.withdrawals_sorted_set().iter().map(|(_, l)| *l).sum();
    assert_eq!(withdrawn, 3_000_000);
    assert_eq!(built.change_lovelace, 23_000_000 - 5_000_000 - built.fee);
    assert_eq!(built.tx.tx_hash.0, *tx_id(&built.tx.tx_bytes.0).unwrap());

    // Patching twice is refused: a transaction has one set of metadata.
    let again = note.patch(built.tx.clone()).unwrap_err().to_string();
    assert_eq!(again, "The transaction already has metadata");
    // And it's patched before it's signed.
    let signed = built.tx.clone().sign(fake_signer()).unwrap();
    assert!(note.patch(signed).is_err());
}
