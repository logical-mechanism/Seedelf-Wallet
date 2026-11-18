//! `util extract` — rescues a wallet-contract UTxO that has an empty datum,
//! paying it (plus address funding) out to an address. Finishes by serving the
//! CIP30 signing site, so the test captures the CBOR at the web-server seam.

use pallas_addresses::{
    Address, Network, ScriptHash, ShelleyAddress, ShelleyDelegationPart, ShelleyPaymentPart,
    StakeAddress, StakeKeyHash,
};
use serde_json::{Value, json};
use serial_test::serial;

use seedelf_cli::commands::util::extract::{ExtractArgs, run};
use seedelf_core::assets::Assets;
use seedelf_core::constants::PREPROD_STAKE_HASH;
use seedelf_core::transaction::{
    address_minimum_lovelace_with_assets, wallet_minimum_lovelace_with_assets,
};
use seedelf_crypto::schnorr::random_scalar;
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

/// `util extract` refuses what isn't a datum-less UTxO of the contract's,
/// before it evaluates or serves anything (chunk 51, t1b#7): a UTxO with a
/// datum (a Seedelf's own, whose empty proof the contract refuses), one at
/// another script, at the contract's script on the other network or at a key
/// address, and one already spent. Everything it needs to go on is mounted,
/// so without its checks it would.
#[tokio::test]
#[serial]
async fn extract_refuses_what_isnt_a_datum_less_utxo_of_the_contracts() {
    let mut with_datum = empty_datum_utxo(50, 2_000_000, &[]);
    with_datum.inline_datum = Some(register_inline_datum(&owned_register(random_scalar())));
    let mut at_a_key = empty_datum_utxo(50, 2_000_000, &[]);
    at_a_key.address = external_address_bech32();
    let mut spent = empty_datum_utxo(50, 2_000_000, &[]);
    spent.is_spent = true;
    let elsewhere = |network, script| datum_less_utxo_at(&staked_script_address(network, script));
    for (utxo, why) in [
        (with_datum, "UTxO has datum"),
        (
            elsewhere(Network::Testnet, [0xab; 28]),
            "UTxO not in wallet",
        ),
        (
            elsewhere(Network::Mainnet, config().contract.wallet_contract_hash),
            "UTxO not in wallet",
        ),
        (at_a_key, "UTxO not in wallet"),
        (spent, "UTxO is spent"),
    ] {
        let mut scenario = Scenario::start().await;
        scenario.mount_utxo_info(vec![utxo]).await;
        scenario.mount_address_utxos(funding_utxos()).await;
        scenario.mount_evaluate(1).await;
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
        .expect_err(why);
        assert!(refused.to_string().contains(why), "{why}: {refused:#}");
        assert_eq!(
            scenario.requests_to("/api/v1/ogmios").await,
            0,
            "{why}: nothing is evaluated"
        );
        assert!(
            seedelf_cli::web_server::take_captured_cbor().is_none(),
            "{why}: nothing is served to sign"
        );
    }
}

/// Run `extract` on `extracted` from an address holding `utxos`, the mock's
/// evaluation answering `budget` (cpu, memory), at the recorded parameters
/// with `change` made to them: what it returned, and the transaction it
/// served to sign, if it served one.
async fn extract_priced(
    extracted: UtxoResponse,
    utxos: Vec<UtxoResponse>,
    budget: (u64, u64),
    change: impl FnOnce(&mut Value),
) -> (anyhow::Result<()>, Option<DecodedTx>) {
    let mut scenario = Scenario::start().await;
    scenario.mount_params(change).await;
    let outpoint = format!("{}#{}", extracted.tx_hash, extracted.tx_index);
    scenario.mount_utxo_info(vec![extracted]).await;
    scenario.mount_address_utxos(utxos).await;
    scenario.mount_evaluate_budgets(&[budget]).await;
    scenario.arm_web_capture();
    let outcome = run(
        ExtractArgs {
            utxo: outpoint,
            address: external_address_bech32(),
        },
        PREPROD,
        VARIANT,
    )
    .await;
    let served = seedelf_cli::web_server::take_captured_cbor().map(|cbor| decode_tx(&cbor));
    (outcome, served)
}

/// The fee is rounded up to even, so the collateral put up, 3/2 of it, is
/// whole and covers the ledger's 150% (chunk 51, t1b#5). Evaluations about a
/// lovelace of compute apart give the fee both parities before it's rounded.
#[tokio::test]
#[serial]
async fn extract_rounds_its_fee_even_so_its_collateral_covers_150_percent() {
    for step in 0..6 {
        let budget = (250_000_000, 800_000 + 18 * step);
        let extracted = empty_datum_utxo(50, 2_000_000, &[]);
        let (outcome, served) = extract_priced(extracted, funding_utxos(), budget, |_| {}).await;
        outcome.expect("extract should succeed");
        assert_collateral_covers_the_fee(&served.expect("a transaction to sign"));
    }
}

/// A fee past what `util extract` pays out is refused in words, never an
/// output that wraps below zero (chunk 51, t1b#6). The fee must stay within
/// what the 5 ADA collateral covers, 3.33 ADA, so the UTxO extracted and the
/// ADA the address's selection takes come to 3.2 ADA, and the script runs to
/// about 1.2 ADA of compute, on a 2 ADA fee floor: about 3.25 ADA.
#[tokio::test]
#[serial]
async fn extract_refuses_a_fee_past_what_it_pays_out() {
    let params = recorded_params();
    // What the selection needs: the output's minimum and a change output's.
    let payer =
        address_minimum_lovelace_with_assets(&params, &external_address_bech32(), Assets::new())
            .expect("the output's minimum")
            + wallet_minimum_lovelace_with_assets(&params, Assets::new())
                .expect("a change minimum")
            + 100_000;
    let extracted = empty_datum_utxo(50, 3_200_000 - payer, &[]);
    let utxos = vec![
        address_utxo(&external_address_bech32(), 51, 5_000_000, &[]),
        address_utxo(&external_address_bech32(), 52, payer, &[]),
    ];
    let (outcome, served) = extract_priced(extracted, utxos, (5_580_000_000, 14_000_000), |p| {
        p["min_fee_b"] = json!(2_000_000);
    })
    .await;
    let refused = outcome.expect_err("a fee past what it pays out is refused");
    assert!(
        refused.to_string().contains("insufficient lovelace"),
        "{refused:#}"
    );
    assert!(served.is_none(), "nothing is served to sign");
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

/// A stranger's piles of tokens at the address paying the fee don't slow
/// `util extract`, which handed core every UTxO there, to add up their tokens
/// in time that grows with the square of the kinds (chunk 51, l3cli#3's
/// sibling): with 40 piles of 1,000 there, the extract is built within 60 s.
#[tokio::test]
#[serial]
async fn a_strangers_piles_at_the_payers_address_dont_slow_extract() {
    let tx = within(std::time::Duration::from_secs(60), || {
        let payer = external_address_bech32();
        let mut utxos = funding_utxos();
        utxos.extend(
            (0..40u16).map(|n| address_utxo(&payer, 100 + u64::from(n), 19_000_000, &big_pile(n))),
        );
        extract_with(empty_datum_utxo(50, 2_000_000, &[]), utxos, None)
    })
    .await;
    let mut inputs = tx.inputs.clone();
    inputs.sort();
    assert_eq!(
        inputs,
        vec![(tx_hash(50), 0), (tx_hash(52), 0)],
        "the extracted UTxO, and the 10 ₳ paying the fee"
    );
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
