//! Chunk 51, r2a#1 (also r2b#1 and w1b#1): which addresses a payment can go
//! to. The ledger takes an output at any Shelley address on its network, and
//! only the payment part says who spends it.
//!
//! - A key address whose stake part is a script (CIP-19 header type 2:
//!   `addr1y…`, `addr_test1y…`) is an ordinary payee: only its payment key
//!   spends what's paid there, with no datum. `build::is_payable_address`
//!   refused it, because `address::is_not_a_script` uses Pallas's
//!   `has_script`, which counts the stake part too.
//! - A script's address (its payment part a script: a multisig's, a
//!   contract's) is payable too, by the owner's call of 2026-11-18 (B16):
//!   the wallet warns rather than refuses, since the ledger takes it. Its
//!   output carries no datum, which some scripts can never spend and some let
//!   anyone take, the Seedelf contract's own address among them; that's the
//!   warning's to say.
//! - A stake address, a Byron address and another network's stay refused.

use pallas_addresses::{
    Address, ByronAddress, Network, ScriptHash, ShelleyAddress, ShelleyDelegationPart,
    ShelleyPaymentPart,
};
use pallas_traverse::MultiEraTx;
use seedelf_core::build::{self, AccountAmount};
use seedelf_core::staking::Staking;
use seedelf_crypto::cardano::{CardanoAccount, Role};
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse};

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

/// A testnet Byron address (Pallas's own vector), as base58.
const BYRON: &str = "37btjrVyb4KDXBNC4haBVPCrro8AQPHwvCMp3RFhhSVWwfFmZ6wwzSK6JK1hY6wHNmtrpTf1kdbva8TCneM2YsiXT7mrzT21EacHnPpz5YyUdj64na";

/// Someone else's payment key (account 1 of the phrase), staked by a script
/// (a multisig's native stake script, say), read back from bech32 as a user
/// pastes it.
fn key_staked_by_a_script(network: Network) -> Address {
    let payee = CardanoAccount::from_phrase(PHRASE, 1).unwrap();
    let text = Address::from(ShelleyAddress::new(
        network,
        ShelleyPaymentPart::Key(payee.key_hash(Role::Receive, 0).unwrap()),
        ShelleyDelegationPart::Script(ScriptHash::new([9; 28])),
    ))
    .to_bech32()
    .unwrap();
    Address::from_bech32(&text).unwrap()
}

/// A native script's address, a multisig's say, with no stake part
/// (`addr_test1w…`), read back from bech32.
fn a_multisig(network: Network) -> Address {
    let text = Address::from(ShelleyAddress::new(
        network,
        ShelleyPaymentPart::Script(ScriptHash::new([7; 28])),
        ShelleyDelegationPart::Null,
    ))
    .to_bech32()
    .unwrap();
    Address::from_bech32(&text).unwrap()
}

/// The Seedelf contract's own address on preprod, with no stake part.
fn the_seedelf_contract() -> Address {
    let config = seedelf_core::constants::get_config(1, true).unwrap();
    seedelf_core::address::wallet_contract(true, config.contract.wallet_contract_hash)
}

fn params() -> ProtocolParameters {
    let rows: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/epoch_params.json")).unwrap();
    ProtocolParameters::from_koios(&rows[0]).unwrap()
}

/// Public Send (`account_send`) of `lovelace` to `to`, from a 30 ₳ UTxO at
/// the phrase's account 0's `0/0`.
fn send(to: &Address, lovelace: u64) -> anyhow::Result<build::AccountPayment> {
    let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
    let change = account.base_address(true, Role::Receive, 0).unwrap();
    let available = vec![UtxoResponse {
        tx_hash: hex::encode([1u8; 32]),
        tx_index: 0,
        address: change.to_bech32().unwrap(),
        value: "30000000".to_string(),
        payment_cred: hex::encode(account.key_hash(Role::Receive, 0).unwrap()),
        asset_list: Some(Vec::new()),
        ..Default::default()
    }];
    build::account_send(
        &params(),
        &available,
        AccountAmount::Lovelace(lovelace),
        &[],
        to,
        true,
        &change,
        &Staking::none(),
        None,
    )
}

/// What the transaction pays `to`: each output's lovelace, and whether it
/// carries a datum.
fn paid_to(built: &build::AccountPayment, to: &Address) -> Vec<(u64, bool)> {
    let tx = MultiEraTx::decode(&built.tx.tx_bytes.0).unwrap();
    tx.outputs()
        .into_iter()
        .filter(|o| o.address().unwrap() == *to)
        .map(|o| (o.value().coin(), o.datum().is_some()))
        .collect()
}

#[test]
fn a_key_address_whose_stake_part_is_a_script_is_paid() {
    let preprod = key_staked_by_a_script(Network::Testnet);
    let mainnet = key_staked_by_a_script(Network::Mainnet);
    assert!(preprod.to_bech32().unwrap().starts_with("addr_test1y"));
    assert!(mainnet.to_bech32().unwrap().starts_with("addr1y"));

    // The control: the same payee's key, staked by a key, is paid.
    let plain = CardanoAccount::from_phrase(PHRASE, 1)
        .unwrap()
        .base_address(true, Role::Receive, 0)
        .unwrap();
    assert!(build::is_payable_address(&plain, true));
    assert!(
        send(&plain, 3_000_000).is_ok(),
        "the fixture pays a plain key address"
    );

    // Only the stake part differs.
    let payable = (
        build::is_payable_address(&preprod, true),
        build::is_payable_address(&mainnet, false),
    );
    let sent = send(&preprod, 3_000_000);
    assert!(
        payable == (true, true) && sent.is_ok(),
        "is_payable_address (preprod, mainnet): {payable:?}; public Send of 3 ₳: {:?}",
        sent.as_ref().err().map(|e| e.to_string())
    );
    assert_eq!(
        paid_to(&sent.unwrap(), &preprod),
        vec![(3_000_000, false)],
        "one output pays it exactly, with no datum: a key address needs none"
    );
}

#[test]
fn a_scripts_address_is_paid_as_the_ledger_takes_it_with_no_datum() {
    for script in [a_multisig(Network::Testnet), the_seedelf_contract()] {
        assert!(script.to_bech32().unwrap().starts_with("addr_test1w"));
        assert!(
            build::is_payable_address(&script, true),
            "{script:?}: the ledger takes a payment to a script's address"
        );
        let sent = send(&script, 3_000_000).unwrap_or_else(|e| panic!("{script:?}: {e}"));
        assert_eq!(
            paid_to(&sent, &script),
            vec![(3_000_000, false)],
            "paid exactly what was asked, with no datum: the wallet warns of that"
        );
    }
    // Another network's script is still another network's.
    assert!(!build::is_payable_address(
        &a_multisig(Network::Mainnet),
        true
    ));
}

#[test]
fn a_stake_byron_or_other_networks_address_stays_refused_in_words() {
    let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
    let stake: Address = account.stake_address(true).unwrap();
    let byron: Address = ByronAddress::from_base58(BYRON).unwrap().into();
    let mainnet = account.base_address(false, Role::Receive, 0).unwrap();
    for refused in [&stake, &byron, &mainnet] {
        assert!(!build::is_payable_address(refused, true), "{refused:?}");
        let e = send(refused, 3_000_000).err().map(|e| e.to_string());
        assert_eq!(
            e.as_deref(),
            Some(
                "Payments go to an address on preprod: not a stake, Byron or other network's address"
            ),
            "{refused:?}"
        );
    }
}

/// Whose an address is, by its payment part alone, for each of CIP-19's
/// eight Shelley types: a key spends from types 0, 2, 4 and 6 (the CLI's
/// payer checks ask `is_key_address`), and types 1, 3, 5 and 7 are a
/// script's (what `sweep`, `remove` and the extension warn of). Neither is
/// a stake address or a Byron one.
#[test]
fn the_payment_part_alone_says_whose_an_address_is() {
    use pallas_addresses::{Pointer, StakeKeyHash};
    use seedelf_core::address::{is_key_address, is_script_address};
    let key = || ShelleyPaymentPart::Key([1; 28].into());
    let script = || ShelleyPaymentPart::Script(ScriptHash::new([2; 28]));
    let stake_key = || ShelleyDelegationPart::Key(StakeKeyHash::new([3; 28]));
    let stake_script = || ShelleyDelegationPart::Script(ScriptHash::new([4; 28]));
    let pointer = || ShelleyDelegationPart::Pointer(Pointer::new(1, 2, 3));
    let shapes = [
        ("type 0", key(), stake_key(), true),
        ("type 1", script(), stake_key(), false),
        ("type 2", key(), stake_script(), true),
        ("type 3", script(), stake_script(), false),
        ("type 4", key(), pointer(), true),
        ("type 5", script(), pointer(), false),
        ("type 6", key(), ShelleyDelegationPart::Null, true),
        ("type 7", script(), ShelleyDelegationPart::Null, false),
    ];
    for (name, payment, delegation, keyed) in shapes {
        let addr: Address = ShelleyAddress::new(Network::Testnet, payment, delegation).into();
        assert_eq!(is_key_address(&addr), keyed, "{name}");
        assert_eq!(is_script_address(&addr), !keyed, "{name}");
        assert!(build::is_payable_address(&addr, true), "{name}");
    }
    let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
    let byron: Address = ByronAddress::from_base58(BYRON).unwrap().into();
    for neither in [account.stake_address(true).unwrap(), byron] {
        assert!(!is_key_address(&neither) && !is_script_address(&neither));
    }
}
