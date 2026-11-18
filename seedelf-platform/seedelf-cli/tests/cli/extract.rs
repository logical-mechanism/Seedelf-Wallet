//! `util extract` — rescues a wallet-contract UTxO that has an empty datum,
//! paying it (plus address funding) out to an address. Finishes by serving the
//! CIP30 signing site, so the test captures the CBOR at the web-server seam.

use pallas_addresses::{
    Address, Network, ScriptHash, ShelleyAddress, ShelleyDelegationPart, ShelleyPaymentPart,
    StakeAddress, StakeKeyHash,
};
use serial_test::serial;

use seedelf_cli::commands::util::extract::{ExtractArgs, run};
use seedelf_core::constants::PREPROD_STAKE_HASH;
use seedelf_koios::koios::UtxoResponse;

use crate::harness::*;

/// Extracting an empty-datum UTxO must conserve value and pay everything out
/// to one plain-address output with no datum.
#[tokio::test]
#[serial]
async fn extract_rescues_empty_datum_utxo() {
    let mut scenario = Scenario::start().await;

    scenario
        .mount_utxo_info(vec![empty_datum_utxo(50, 2_000_000, &[])])
        .await;
    scenario
        .mount_address_utxos(vec![
            // a clean 5 ADA UTxO the command picks up as collateral
            address_utxo(&external_address_bech32(), 51, 5_000_000, &[]),
            address_utxo(&external_address_bech32(), 52, 10_000_000, &[]),
        ])
        .await;
    scenario.mount_evaluate(1).await;
    scenario.arm_web_capture();

    run(
        ExtractArgs {
            utxo: format!("{}#0", tx_hash(50)),
            address: external_address_bech32(),
        },
        PREPROD,
        VARIANT,
    )
    .await
    .expect("extract should succeed");

    let params = protocol_params().await;
    let tx = decode_tx(&scenario.captured_cbor());
    assert_sound_transaction(&tx, &scenario, &params);

    // The empty-datum UTxO plus the funding UTxO are spent into one output.
    assert_eq!(tx.inputs.len(), 2, "empty-datum UTxO + funding UTxO");
    assert_eq!(tx.outputs.len(), 1);
    assert_eq!(tx.outputs_to(&external_address()).len(), 1);
    assert!(tx.mint.is_empty(), "extract mints nothing");
}

/// The address of `script` on `network` with the [LOGIC] preprod stake key:
/// for the wallet contract on preprod, its staked form, which
/// `address::wallet_contract` gave before 2c67e94c (0.5.0).
fn staked_script_address(network: Network, script: [u8; 28]) -> ShelleyAddress {
    ShelleyAddress::new(
        network,
        ShelleyPaymentPart::Script(ScriptHash::new(script)),
        ShelleyDelegationPart::Key(StakeKeyHash::new(PREPROD_STAKE_HASH)),
    )
}

/// A datum-less UTxO at `address`, as Koios's `utxo_info` lists one: the full
/// bech32, the stake address apart.
fn datum_less_utxo_at(address: &ShelleyAddress) -> UtxoResponse {
    let mut utxo = empty_datum_utxo(50, 2_000_000, &[]);
    utxo.address = address.to_bech32().expect("bech32");
    utxo.stake_address = Some(
        StakeAddress::try_from(address.clone())
            .expect("stake address")
            .to_bech32()
            .expect("stake bech32"),
    );
    utxo
}

/// `util extract` rescues a datum-less UTxO at the contract's staked form,
/// where every CLI up to 0.4.10 paid the contract. The deployed contract
/// (5b82530, `validators/wallet.ak`) lets anyone spend a UTxO with no datum
/// and never reads the delegation part: the payment credential is what makes
/// a UTxO the contract's (chunk 51, r4#7).
#[tokio::test]
#[serial]
async fn extract_rescues_a_datum_less_utxo_at_the_contracts_staked_form() {
    let staked = staked_script_address(Network::Testnet, config().contract.wallet_contract_hash);
    let Address::Shelley(enterprise) = wallet_address() else {
        panic!("the wallet contract is a Shelley address");
    };
    // The same script: only the delegation part differs.
    assert_eq!(staked.payment(), enterprise.payment());
    assert_ne!(Address::from(staked.clone()), wallet_address());

    let mut scenario = Scenario::start().await;
    scenario
        .mount_utxo_info(vec![datum_less_utxo_at(&staked)])
        .await;
    scenario
        .mount_address_utxos(vec![
            // a clean 5 ADA UTxO the command picks up as collateral
            address_utxo(&external_address_bech32(), 51, 5_000_000, &[]),
            address_utxo(&external_address_bech32(), 52, 10_000_000, &[]),
        ])
        .await;
    scenario.mount_evaluate(1).await;
    scenario.arm_web_capture();

    run(
        ExtractArgs {
            utxo: format!("{}#0", tx_hash(50)),
            address: external_address_bech32(),
        },
        PREPROD,
        VARIANT,
    )
    .await
    .expect("a datum-less UTxO at the contract's staked form is the contract's");

    let params = protocol_params().await;
    let tx = decode_tx(&scenario.captured_cbor());
    assert_sound_transaction(&tx, &scenario, &params);

    // The staked-form UTxO plus the funding UTxO are spent into one output.
    let mut inputs = tx.inputs.clone();
    inputs.sort();
    assert_eq!(inputs, vec![(tx_hash(50), 0), (tx_hash(52), 0)]);
    assert_eq!(tx.outputs.len(), 1);
    assert_eq!(tx.outputs_to(&external_address()).len(), 1);
    assert_eq!(tx.collateral, vec![(tx_hash(51), 0)]);
}

/// What isn't the contract's stays refused: a datum-less UTxO under another
/// script, or under the contract's script on the other network.
#[tokio::test]
#[serial]
async fn extract_refuses_a_utxo_that_isnt_the_contracts() {
    for not_ours in [
        staked_script_address(Network::Testnet, [0xab; 28]),
        staked_script_address(Network::Mainnet, config().contract.wallet_contract_hash),
    ] {
        let mut scenario = Scenario::start().await;
        scenario
            .mount_utxo_info(vec![datum_less_utxo_at(&not_ours)])
            .await;
        scenario.arm_web_capture();
        let refused = run(
            ExtractArgs {
                utxo: format!("{}#0", tx_hash(50)),
                address: external_address_bech32(),
            },
            PREPROD,
            VARIANT,
        )
        .await
        .expect_err("not the contract's UTxO");
        assert!(
            refused.to_string().contains("UTxO not in wallet"),
            "refused, as not the contract's: {refused:#}"
        );
    }
}

/// Run `extract` on `extracted` from an address holding `utxos`, at the
/// network's reference-script price `per_byte` (the recorded 15 when `None`),
/// and return the transaction it built.
async fn extract_with(
    extracted: UtxoResponse,
    utxos: Vec<UtxoResponse>,
    per_byte: Option<u64>,
) -> DecodedTx {
    let mut scenario = Scenario::start().await;
    if let Some(per_byte) = per_byte {
        scenario.mount_reference_script_price(per_byte).await;
    }
    let outpoint = format!("{}#{}", extracted.tx_hash, extracted.tx_index);
    scenario.mount_utxo_info(vec![extracted]).await;
    scenario.mount_address_utxos(utxos).await;
    scenario.mount_evaluate(1).await;
    scenario.arm_web_capture();

    run(
        ExtractArgs {
            utxo: outpoint,
            address: external_address_bech32(),
        },
        PREPROD,
        VARIANT,
    )
    .await
    .expect("extract should succeed");

    let params = protocol_params().await;
    let tx = decode_tx(&scenario.captured_cbor());
    assert_sound_transaction(&tx, &scenario, &params);
    tx
}

/// A 5 ADA UTxO the command picks up as collateral, and one to fund with.
fn funding_utxos() -> Vec<UtxoResponse> {
    vec![
        address_utxo(&external_address_bech32(), 51, 5_000_000, &[]),
        address_utxo(&external_address_bech32(), 52, 10_000_000, &[]),
    ]
}

/// An address UTxO holding a reference script is never spent: it would cost
/// Conway's reference-script fee, and the script may be deployed there on
/// purpose.
#[tokio::test]
#[serial]
async fn extract_never_spends_an_address_utxo_holding_a_reference_script() {
    let mut utxos = funding_utxos();
    // The most ADA, which selection would take first.
    utxos.push(with_reference_script(
        address_utxo(&external_address_bech32(), 53, 50_000_000, &[]),
        519,
    ));
    let tx = extract_with(empty_datum_utxo(50, 2_000_000, &[]), utxos, None).await;
    let mut inputs = tx.inputs.clone();
    inputs.sort();
    assert_eq!(inputs, vec![(tx_hash(50), 0), (tx_hash(52), 0)]);
}

/// The wallet contract, by reference, is priced at the network's
/// reference-script price, not a fixed 15 lovelace a byte.
#[tokio::test]
#[serial]
async fn extract_prices_the_contract_at_the_networks_reference_script_price() {
    let extracted = || empty_datum_utxo(50, 2_000_000, &[]);
    let recorded = extract_with(extracted(), funding_utxos(), None).await.fee;
    let raised = extract_with(extracted(), funding_utxos(), Some(115))
        .await
        .fee;
    // The same transaction, with the contract's bytes 100 lovelace dearer.
    assert_eq!(
        raised - recorded,
        config().contract.wallet_contract_size * 100
    );
}

/// The UTxO extracted is spent too, and anyone can send one to the contract
/// holding a reference script: its bytes are priced as well.
#[tokio::test]
#[serial]
async fn extract_prices_a_reference_script_on_the_utxo_it_extracts() {
    let plain = extract_with(empty_datum_utxo(50, 2_000_000, &[]), funding_utxos(), None)
        .await
        .fee;
    let scripted = extract_with(
        with_reference_script(empty_datum_utxo(50, 2_000_000, &[]), 520),
        funding_utxos(),
        None,
    )
    .await
    .fee;
    // The same transaction, with 520 more bytes at the recorded 15 a byte.
    assert_eq!(scripted - plain, 520 * 15);
}

/// The collateral is the address's own 5 ADA UTxO, not giveme.my's: if the
/// script fails, what's left of it goes back to that address.
#[tokio::test]
#[serial]
async fn extract_returns_the_collateral_to_the_address_it_came_from() {
    let tx = extract_with(empty_datum_utxo(50, 2_000_000, &[]), funding_utxos(), None).await;
    assert_eq!(tx.collateral, vec![(tx_hash(51), 0)]);
    let back = tx.collateral_return.as_ref().expect("a collateral return");
    assert_eq!(back.address, external_address());
    assert_eq!(back.lovelace, 5_000_000 - tx.fee * 3 / 2);
}

/// A 5 ADA UTxO that also holds a token is never the collateral: the return
/// is ADA alone, so the ledger would refuse it (CollateralContainsNonADA).
#[tokio::test]
#[serial]
async fn extract_never_puts_up_a_collateral_holding_a_token() {
    let token = ("dd".repeat(28), hex::encode("COLLAT"), 1);
    let mut utxos = vec![address_utxo(
        &external_address_bech32(),
        53,
        5_000_000,
        &[token],
    )];
    utxos.extend(funding_utxos());
    let tx = extract_with(empty_datum_utxo(50, 2_000_000, &[]), utxos, None).await;
    assert_eq!(tx.collateral, vec![(tx_hash(51), 0)]);
}

/// With no ADA-only UTxO of exactly 5 ADA to put up as collateral, the extract
/// is refused, rather than built with a collateral return and no collateral,
/// which the node refuses.
#[tokio::test]
#[serial]
async fn extract_refuses_without_a_collateral() {
    let mut scenario = Scenario::start().await;
    let token = ("dd".repeat(28), hex::encode("COLLAT"), 1);
    scenario
        .mount_utxo_info(vec![empty_datum_utxo(50, 2_000_000, &[])])
        .await;
    scenario
        .mount_address_utxos(vec![
            address_utxo(&external_address_bech32(), 52, 10_000_000, &[]),
            // 5 ADA, but holding a token: never the collateral
            address_utxo(&external_address_bech32(), 53, 5_000_000, &[token]),
        ])
        .await;
    scenario.mount_evaluate(1).await;
    // Armed so that, without the check, the run ends at the signing site
    // rather than waiting there for a browser.
    scenario.arm_web_capture();

    let refused = run(
        ExtractArgs {
            utxo: format!("{}#0", tx_hash(50)),
            address: external_address_bech32(),
        },
        PREPROD,
        VARIANT,
    )
    .await
    .expect_err("an extract with no collateral must be refused");
    assert!(
        refused.to_string().contains("No Collateral Found"),
        "{refused}"
    );
}

/// Anyone can pay the address paying the fee too: three UTxOs of 2^63 − 1 of
/// one token there stopped `util extract` whenever its selection reached all
/// three (chunk 51). It leaves the third out and pays from the rest.
#[tokio::test]
#[serial]
async fn extract_goes_when_a_strangers_tokens_at_the_address_total_past_a_u64() {
    let bought = ("bb".repeat(28), hex::encode("BOUGHT"), 1);
    let payer = external_address_bech32();
    let mut utxos = vec![address_utxo(&payer, 51, 5_000_000, &[])];
    utxos.extend((2..=4).map(|n| address_utxo(&payer, n, 1_200_000, &[junk()])));
    // Less ADA than the junk, so selection reaches all three of it first.
    utxos.push(address_utxo(
        &payer,
        5,
        1_150_000,
        std::slice::from_ref(&bought),
    ));
    let tx = extract_with(empty_datum_utxo(50, 2_000_000, &[]), utxos, None).await;
    let mut inputs = tx.inputs.clone();
    inputs.sort();
    assert_eq!(
        inputs,
        vec![
            (tx_hash(2), 0),
            (tx_hash(3), 0),
            (tx_hash(5), 0),
            (tx_hash(50), 0)
        ]
    );
}
