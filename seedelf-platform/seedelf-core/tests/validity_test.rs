//! The validity interval on the Cardano account's transactions (a move-in, a
//! send, a staking transaction, an account-paid mint): the slot it stops
//! being valid at, so one that never landed can't land after the user pays
//! again. Each is decoded and checked: the slot in the body, under the hash
//! the patches put in, and a fee that pays for its bytes. Without a slot, the
//! bytes are what they were before the builders took one.

use std::collections::BTreeSet;

use blstrs::Scalar;
use pallas_addresses::Address;
use pallas_primitives::{Fragment, conway};
use pallas_txbuilder::BuiltTransaction;
use seedelf_core::address::wallet_contract;
use seedelf_core::build::{
    self, AccountAmount, AccountPay, AccountPayment, Budgets, Chain, Payee, fake_signer,
    linear_fee, tx_id,
};
use seedelf_core::constants::get_config;
use seedelf_core::eval::slot_at;
use seedelf_core::note::Note;
use seedelf_core::staking::{StakeAction, StakeKey, StakeState, Staking, parse_pool_id};
use seedelf_crypto::cardano::{CardanoAccount, Role};
use seedelf_crypto::register::Register;
use seedelf_koios::koios::{Asset, ProtocolParameters, UtxoResponse};

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const POLICY: &str = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";
/// LOGIC on preprod.
const LOGIC: &str = "pool1rccstu3l9ty3k0a5cd06fl3szsss9r34dcg5j38fqgq9kvng0tg";
/// 2026-09-27 12:00 UTC, when these were written.
const NOW_MS: u64 = 1_790_510_400_000;
/// Two hours on, as the web wallet asks.
const VALID_FOR_MS: u64 = 2 * 60 * 60_000;

/// Recorded before the builders took a slot: the same requests, without one,
/// must build these exact transactions.
const SEND_BEFORE: &str = "5462f10c2d2d6e9c88fa1c64cb9bd22844e92d5414c1190c9aa1c5c3d1f6de38";
const STAKE_BEFORE: &str = "f66ef4c1aa5b06412dd33fdd4069e8e217fc1e455b2ce6216e6b3b2b763e5ac6";
const MINT_DRAFT_BEFORE: &str = "7e9daac5c90a60c0f3d29f186e6f945b3eb267c14a49842da0b35b166e246dd1";
const MINT_BEFORE: &str = "b640c0d5e0f37be195163b7f6b814009bd9a42b115e5002c78fe0434bdf9b017";

fn params() -> ProtocolParameters {
    let rows: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/epoch_params.json")).unwrap();
    ProtocolParameters::from_koios(&rows[0]).unwrap()
}

fn account() -> CardanoAccount {
    CardanoAccount::from_phrase(PHRASE, 0).unwrap()
}

fn change() -> Address {
    account().base_address(true, Role::Receive, 0).unwrap()
}

fn stake_key() -> StakeKey {
    StakeKey::new(&account().stake_address(true).unwrap()).unwrap()
}

/// A UTxO at the account's receive address `index`.
fn utxo(n: u8, index: u32, lovelace: u64, tokens: &[(&str, u64)]) -> UtxoResponse {
    let account = account();
    UtxoResponse {
        tx_hash: hex::encode([n; 32]),
        tx_index: 0,
        address: account
            .base_address(true, Role::Receive, index)
            .unwrap()
            .to_bech32()
            .unwrap(),
        value: lovelace.to_string(),
        payment_cred: hex::encode(account.key_hash(Role::Receive, index).unwrap()),
        asset_list: Some(
            tokens
                .iter()
                .map(|(name, quantity)| Asset {
                    decimals: 0,
                    quantity: quantity.to_string(),
                    policy_id: POLICY.to_string(),
                    asset_name: hex::encode(name),
                    fingerprint: String::new(),
                })
                .collect(),
        ),
        ..Default::default()
    }
}

/// Two receive addresses, so two payment keys sign.
fn available() -> Vec<UtxoResponse> {
    vec![
        utxo(1, 0, 20_000_000, &[]),
        utxo(2, 1, 5_000_000, &[("tok", 9)]),
    ]
}

fn body(tx: &BuiltTransaction) -> conway::TransactionBody {
    conway::Tx::decode_fragment(&tx.tx_bytes.0)
        .unwrap()
        .transaction_body
}

/// How many payment keys sign for `utxos`.
fn keys<'a>(utxos: impl IntoIterator<Item = &'a UtxoResponse>) -> usize {
    utxos
        .into_iter()
        .map(|u| u.payment_cred.as_str())
        .collect::<BTreeSet<_>>()
        .len()
}

/// The transaction's size once `signers` keys have signed.
fn signed_size(tx: &BuiltTransaction, signers: usize) -> u64 {
    let mut signed = tx.clone();
    for _ in 0..signers {
        signed = signed.sign(fake_signer()).unwrap();
    }
    signed.tx_bytes.0.len() as u64
}

/// A send to someone else from both UTxOs: 3 ADA and 2 of a token, with a
/// note and the rewards withdrawn, so both patches go in.
fn send(invalid_hereafter: Option<u64>) -> AccountPayment {
    let to = CardanoAccount::from_phrase(PHRASE, 1)
        .unwrap()
        .base_address(true, Role::Receive, 0)
        .unwrap();
    let rewards = Staking::withdraw(
        &stake_key(),
        &StakeState {
            registered: true,
            deposit: 2_000_000,
            rewards: 1_234_567,
            votes: true,
        },
    )
    .unwrap();
    let note = Note::new("thanks for lunch").unwrap();
    build::account_send_many(
        &params(),
        &available(),
        &[AccountPay::new(
            Payee::Address(&to),
            AccountAmount::Lovelace(3_000_000),
            &[(POLICY.to_string(), hex::encode("tok"), 2)],
        )],
        true,
        &change(),
        &rewards,
        note.as_ref(),
        invalid_hereafter,
    )
    .unwrap()
}

/// The first delegation: registering the stake key and delegating it.
fn stake(invalid_hereafter: Option<u64>) -> AccountPayment {
    let params = params();
    let delegate = Staking::of(
        &stake_key(),
        &StakeAction::Delegate(parse_pool_id(LOGIC).unwrap()),
        &StakeState::default(),
        params.key_deposit,
    )
    .unwrap();
    build::account_staking(
        &params,
        &available(),
        &delegate,
        &change(),
        invalid_hereafter,
    )
    .unwrap()
}

fn move_in(invalid_hereafter: Option<u64>) -> AccountPayment {
    let config = get_config(1, true).unwrap();
    build::move_in(
        &params(),
        &available(),
        AccountAmount::Lovelace(10_000_000),
        &[],
        &Register::create(Scalar::from(7u64)).unwrap(),
        &wallet_contract(true, config.contract.wallet_contract_hash),
        &change(),
        &Staking::none(),
        invalid_hereafter,
    )
    .unwrap()
}

fn mint(invalid_hereafter: Option<u64>) -> build::AccountMint {
    let chain = Chain {
        params: params(),
        network_flag: true,
        config: get_config(1, true).unwrap(),
    };
    build::account_mint(
        &chain,
        &available(),
        None,
        "validity",
        &Register::create(Scalar::from(7u64)).unwrap(),
        &change(),
        &Staking::none(),
        invalid_hereafter,
    )
    .unwrap()
}

/// What Ogmios measured for an account-paid mint on preprod.
fn recorded() -> Budgets {
    let path = format!(
        "{}/tests/fixtures/ogmios/account_mint.json",
        env!("CARGO_MANIFEST_DIR")
    );
    Budgets::from_ogmios(&serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap())
        .unwrap()
}

fn two_hours_on() -> u64 {
    slot_at(true, NOW_MS + VALID_FOR_MS)
}

#[test]
fn a_slot_is_counted_from_each_network_s_first_shelley_slot() {
    // Mainnet's Chang hard fork: epoch 507's first slot, 2024-09-01 21:44:51 UTC.
    assert_eq!(slot_at(false, 1_725_227_091_000), 133_660_800);
    // A slot is a second: the time within it doesn't count.
    assert_eq!(slot_at(false, 1_725_227_091_999), 133_660_800);
    assert_eq!(slot_at(false, 1_725_227_092_000), 133_660_801);
    // Preprod's Shelley era starts at slot 86,400, 2022-06-21 00:00 UTC.
    assert_eq!(slot_at(true, 1_655_769_600_000), 86_400);
    assert_eq!(
        slot_at(true, 1_655_769_600_000 + VALID_FOR_MS),
        86_400 + 7_200
    );
    // A time before either gives the first.
    assert_eq!(slot_at(true, 0), 86_400);
    assert_eq!(slot_at(false, 0), 4_492_800);
    assert_eq!(two_hours_on(), 134_834_400);
}

#[test]
fn account_payments_stop_being_valid_at_the_slot_and_pay_for_its_bytes() {
    let slot = two_hours_on();
    let a = params().min_fee_a;
    // The stake key signs too when staking goes in.
    for (what, without, with, stake_key) in [
        ("move-in", move_in(None), move_in(Some(slot)), 0),
        ("send", send(None), send(Some(slot)), 1),
        ("staking", stake(None), stake(Some(slot)), 1),
    ] {
        let staged = body(&with.tx);
        assert_eq!(staged.ttl, Some(slot), "{what}");
        assert_eq!(staged.validity_interval_start, None, "{what}");
        assert_eq!(body(&without.tx).ttl, None, "{what}");
        // The patches hashed a body that holds the slot.
        assert_eq!(*tx_id(&with.tx.tx_bytes.0).unwrap(), with.tx.tx_hash.0);

        // Six bytes more (key 3, and the slot as a 4-byte number), and the
        // fee pays for exactly them.
        let signers = keys(&with.inputs) + stake_key;
        let size = signed_size(&with.tx, signers);
        assert_eq!(size, signed_size(&without.tx, signers) + 6, "{what}");
        assert_eq!(with.fee, without.fee + 6 * a, "{what}");
        assert!(with.fee >= linear_fee(&params(), size), "{what}");
        assert_eq!(
            with.change_lovelace + 6 * a,
            without.change_lovelace,
            "{what}: the change pays it"
        );
        assert_eq!(with.inputs.len(), without.inputs.len(), "{what}");
    }
}

#[test]
fn an_account_mint_is_measured_and_finished_with_the_slot() {
    let slot = two_hours_on();
    let (without, with) = (mint(None), mint(Some(slot)));
    // Ogmios measures a draft that holds it, so the budget is the final one's.
    assert_eq!(body(&with.draft().unwrap()).ttl, Some(slot));
    assert_eq!(body(&without.draft().unwrap()).ttl, None);

    // The inputs' keys sign, and the collateral's.
    let signers = keys(with.inputs().iter().chain([with.collateral()]));
    let (without, with) = (
        without.finalize(&recorded()).unwrap(),
        with.finalize(&recorded()).unwrap(),
    );
    assert_eq!(body(&with.tx).ttl, Some(slot));
    assert_eq!(body(&without.tx).ttl, None);
    let size = signed_size(&with.tx, signers);
    assert_eq!(size, signed_size(&without.tx, signers) + 6);
    assert!(with.fee.size >= linear_fee(&params(), size));
    assert_eq!(with.fee.compute, without.fee.compute);
    assert!(with.fee.total > without.fee.total);
    assert_eq!(
        with.change_lovelace + with.fee.total,
        without.change_lovelace + without.fee.total
    );
}

#[test]
fn without_a_slot_the_transactions_are_byte_for_byte_as_before() {
    assert_eq!(hex::encode(send(None).tx.tx_hash.0), SEND_BEFORE);
    assert_eq!(hex::encode(stake(None).tx.tx_hash.0), STAKE_BEFORE);
    let mint = mint(None);
    assert_eq!(
        hex::encode(mint.draft().unwrap().tx_hash.0),
        MINT_DRAFT_BEFORE
    );
    assert_eq!(
        hex::encode(mint.finalize(&recorded()).unwrap().tx.tx_hash.0),
        MINT_BEFORE
    );
}
