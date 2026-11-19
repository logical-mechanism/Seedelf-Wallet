//! Chunk 51, gap-g8#3: a note longer than 64 characters. The ledger holds
//! each metadata text to 64 bytes and nothing more (cardano-ledger's
//! `validMetadatum`: `S s` at most 64 bytes, a `List` of any length), so
//! CIP-20's `msg` takes as many 64-byte lines as the transaction's 16 KiB
//! holds. Core already cuts a note into such lines (`note.rs` `split`), and
//! `settle` prices every draft with the note patched in. So a 120-character
//! payment reference should go on a send whole, as two lines that fit, with
//! a fee that pays for them. `Note::new` refused it at 64 characters, Lace's
//! limit, not the ledger's. It now takes 500, what Activity keeps of a note
//! (activity.ts `NOTE_MAX`), so a note the wallet writes reads back there.

use pallas_addresses::Address;
use pallas_crypto::hash::Hasher;
use pallas_primitives::{Metadatum, Nullable};
use pallas_traverse::MultiEraTx;
use seedelf_core::build::{
    self, AccountAmount, AccountPay, MAX_TX_SIZE, Payee, fake_signer, tx_id,
};
use seedelf_core::note::{MAX_NOTE_CHARS, NOTE_LABEL, Note};
use seedelf_core::staking::Staking;
use seedelf_crypto::cardano::{CardanoAccount, Role};
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse};

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

/// A payment reference a user might paste: 120 characters, all ASCII.
const REFERENCE: &str = "Invoice 2026-118 for October: 14 hours of design work at 85 EUR, purchase order PO-77341, client ref ACME/NL/042. Thanks";

fn params() -> ProtocolParameters {
    let rows: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/epoch_params.json")).unwrap();
    ProtocolParameters::from_koios(&rows[0]).unwrap()
}

fn utxo(account: &CardanoAccount, lovelace: u64) -> UtxoResponse {
    UtxoResponse {
        tx_hash: hex::encode([7u8; 32]),
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

/// A public Send of 5 ₳ from a 20 ₳ UTxO, carrying `note`.
fn send_with(note: &Note) -> build::AccountPayment {
    let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
    let to: Address = CardanoAccount::from_phrase(PHRASE, 1)
        .unwrap()
        .base_address(true, Role::Receive, 0)
        .unwrap();
    build::account_send_many(
        &params(),
        &[utxo(&account, 20_000_000)],
        &[AccountPay::new(
            Payee::Address(&to),
            AccountAmount::Lovelace(5_000_000),
            &[],
        )],
        true,
        &account.base_address(true, Role::Receive, 0).unwrap(),
        &Staking::none(),
        Some(note),
        None,
    )
    .expect("a send carrying the note builds")
}

#[test]
fn a_120_character_note_goes_on_a_send_whole_in_lines_the_ledger_takes() {
    assert_eq!((REFERENCE.chars().count(), REFERENCE.len()), (120, 120));

    // The ledger takes it: two of CIP-20's lines, each at most 64 bytes.
    let note = Note::new(REFERENCE)
        .expect("a 120-character note fits CIP-20's msg as two 64-byte lines")
        .expect("not empty");
    assert_eq!(
        note.text(),
        REFERENCE,
        "the review shows the whole reference"
    );
    assert!(note.lines().len() >= 2, "{:?}", note.lines());
    assert!(
        note.lines().iter().all(|l| !l.is_empty() && l.len() <= 64),
        "each line within the ledger's 64 bytes: {:?}",
        note.lines()
    );
    assert_eq!(
        note.lines().join(" "),
        REFERENCE,
        "cut only at spaces, so a reader rejoins it whole"
    );

    // On a send: the lines under 674's msg, the body's hash of them, the
    // transaction's hash, a fee that pays for them, and under 16 KiB.
    let params = params();
    let built = send_with(&note);
    let (lines, hash_matches) = message_of(&built.tx.tx_bytes.0);
    assert_eq!(lines, note.lines(), "the transaction carries every line");
    assert!(
        hash_matches,
        "the body carries the hash of the note's bytes"
    );
    assert_eq!(built.tx.tx_hash.0, *tx_id(&built.tx.tx_bytes.0).unwrap());

    let signed = built.tx.clone().sign(fake_signer()).unwrap();
    let size = signed.tx_bytes.0.len() as u64;
    assert!(size <= MAX_TX_SIZE, "{size} bytes");
    let minimum = params.min_fee_a * size + params.min_fee_b;
    assert!(built.fee >= minimum, "fee {} < {minimum}", built.fee);
    assert!(built.fee < minimum + 1_000);
    assert_eq!(built.change_lovelace, 20_000_000 - 5_000_000 - built.fee);
}

#[test]
fn a_note_holds_500_characters_what_activity_keeps_of_one() {
    assert_eq!(MAX_NOTE_CHARS, 500);

    // The most, in characters as core counts them: 500 emoji are 2,000
    // bytes, 32 of CIP-20's lines, and still a send the ledger takes.
    let most = "🌱".repeat(MAX_NOTE_CHARS);
    let note = Note::new(&most).unwrap().unwrap();
    assert_eq!(note.text(), most);
    assert_eq!(note.lines().len(), 32);
    assert!(note.lines().iter().all(|l| l.len() <= 64));
    assert_eq!(
        note.lines().concat(),
        most,
        "cut between characters, never inside one"
    );
    let built = send_with(&note);
    assert_eq!(message_of(&built.tx.tx_bytes.0).0, note.lines());
    let signed = built.tx.clone().sign(fake_signer()).unwrap();
    assert!(signed.tx_bytes.0.len() as u64 <= MAX_TX_SIZE);

    // One more is refused, in words.
    let over = Note::new(&"x".repeat(MAX_NOTE_CHARS + 1)).unwrap_err();
    assert_eq!(
        over.to_string(),
        "A note is at most 500 characters, not 501"
    );
}
