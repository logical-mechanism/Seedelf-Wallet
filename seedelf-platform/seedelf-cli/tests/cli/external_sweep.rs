//! `external sweep` — pulls every UTxO from the wallet's dApp address back
//! into the wallet contract. No collateral service, no web server: it signs
//! with the wallet key and submits directly.

use serial_test::serial;

use crate::harness::*;

/// A sweep of a pure-ADA UTxO plus a token-bearing UTxO must conserve value
/// and write a single owned, valid-`Register` change output to the contract.
#[tokio::test]
#[serial]
async fn external_sweep_mixed_utxos_is_sound() {
    let mut scenario = Scenario::start().await;
    let dapp = dapp_address_for(scenario.scalar)
        .to_bech32()
        .expect("dapp bech32");
    let token = ("aa".repeat(28), hex::encode("SWEEPTOKEN"), 7);

    scenario
        .mount_address_utxos(vec![
            address_utxo(&dapp, 1, 10_000_000, &[]),
            address_utxo(&dapp, 2, 5_000_000, std::slice::from_ref(&token)),
        ])
        .await;
    scenario.mount_submit().await;

    seedelf_cli::commands::external::sweep::run(PREPROD, VARIANT)
        .await
        .expect("external sweep should succeed");

    let params = protocol_params().await;
    let tx = decode_tx(&scenario.submitted_cbor().await);
    assert_sound_transaction(&tx, &scenario, &params);

    // Both UTxOs are consumed and everything lands in one wallet output.
    assert_eq!(tx.inputs.len(), 2, "both source UTxOs should be spent");
    assert_eq!(tx.outputs.len(), 1, "expected a single change output");
    assert_eq!(
        tx.outputs_to(&wallet_address()).len(),
        1,
        "the change output must go to the wallet contract"
    );
    assert!(tx.mint.is_empty(), "external sweep mints nothing");
}

/// A sweep of only pure-ADA UTxOs exercises the no-token change path.
#[tokio::test]
#[serial]
async fn external_sweep_pure_ada_is_sound() {
    let mut scenario = Scenario::start().await;
    let dapp = dapp_address_for(scenario.scalar)
        .to_bech32()
        .expect("dapp bech32");

    scenario
        .mount_address_utxos(vec![
            address_utxo(&dapp, 10, 8_000_000, &[]),
            address_utxo(&dapp, 11, 12_000_000, &[]),
        ])
        .await;
    scenario.mount_submit().await;

    seedelf_cli::commands::external::sweep::run(PREPROD, VARIANT)
        .await
        .expect("external sweep should succeed");

    let params = protocol_params().await;
    let tx = decode_tx(&scenario.submitted_cbor().await);
    assert_sound_transaction(&tx, &scenario, &params);

    assert_eq!(tx.inputs.len(), 2);
    assert_eq!(tx.outputs.len(), 1);
    assert_eq!(tx.outputs_to(&wallet_address()).len(), 1);
}

/// Runs `external sweep` over `rows` at the wallet's dApp address (each made
/// by `rows` from that address) and returns the scenario and the transaction
/// it submitted, checked sound.
async fn sweep_external(
    rows: impl FnOnce(&str) -> Vec<seedelf_koios::koios::UtxoResponse>,
) -> (Scenario, DecodedTx) {
    let mut scenario = Scenario::start().await;
    let dapp = dapp_address_for(scenario.scalar)
        .to_bech32()
        .expect("dapp bech32");
    scenario.mount_address_utxos(rows(&dapp)).await;
    scenario.mount_submit().await;

    seedelf_cli::commands::external::sweep::run(PREPROD, VARIANT)
        .await
        .expect("external sweep should bring back what it can");

    let params = protocol_params().await;
    let cbor = scenario.submitted_cbor().await;
    assert!(
        cbor.len() / 2 <= 16_384,
        "the sweep is {} bytes, over the network's limit",
        cbor.len() / 2
    );
    let tx = decode_tx(&cbor);
    assert_sound_transaction(&tx, &scenario, &params);
    assert!(
        tx.outputs.iter().all(|o| o.address == wallet_address()),
        "everything swept goes into the wallet contract"
    );
    (scenario, tx)
}

fn sorted_inputs(tx: &DecodedTx) -> Vec<(String, u64)> {
    let mut inputs = tx.inputs.clone();
    inputs.sort();
    inputs
}

/// Anyone can pay the external wallet. Three UTxOs of 2^63 − 1 of one token
/// total past what one output holds (chunk 51, r4#1), which stopped every
/// sweep. The user's own UTxOs still go, with the two of the stranger's that
/// fit; the third waits for the next sweep.
#[tokio::test]
#[serial]
async fn external_sweep_goes_when_a_strangers_tokens_total_past_a_u64() {
    let bought = ("bb".repeat(28), hex::encode("BOUGHT"), 1_000);
    let (_, tx) = sweep_external(|dapp| {
        let mut rows = vec![
            address_utxo(dapp, 1, 300_000_000, &[]),
            address_utxo(dapp, 2, 5_000_000, std::slice::from_ref(&bought)),
        ];
        rows.extend((3..=5).map(|n| address_utxo(dapp, n, 1_500_000, &[junk()])));
        rows
    })
    .await;

    assert_eq!(
        sorted_inputs(&tx),
        vec![
            (tx_hash(1), 0),
            (tx_hash(2), 0),
            (tx_hash(3), 0),
            (tx_hash(4), 0)
        ],
        "the user's two UTxOs and two of the stranger's go; the third stays"
    );
    let swept: u64 = tx
        .outputs
        .iter()
        .filter_map(|o| o.assets.get(&(junk().0, junk().1)))
        .sum();
    assert_eq!(swept, 2 * (i64::MAX as u64));
}

/// More UTxOs than one transaction holds (the README invites piling them up
/// there, and anyone can add more) can't stop the sweep: it takes as many as
/// fit, the most ADA first, and leaves the rest for the next.
#[tokio::test]
#[serial]
async fn external_sweep_takes_what_one_transaction_holds() {
    let (_, tx) = sweep_external(|dapp| {
        (1..=500)
            .map(|n| address_utxo(dapp, n, 2_000_000 + n, &[]))
            .collect()
    })
    .await;

    let taken = tx.inputs.len() as u64;
    assert!((400..500).contains(&taken), "{taken} of 500 UTxOs taken");
    // tx_hash(n) is n in fixed-width hex, so sorted inputs run in n's order.
    let largest: Vec<(String, u64)> = (500 - taken + 1..=500).map(|n| (tx_hash(n), 0)).collect();
    assert_eq!(sorted_inputs(&tx), largest, "the most ADA goes first");
}

/// A UTxO no transaction can hold even alone stays, and never holds back
/// what comes after it: here 1,500 tokens, whose outputs (20 tokens to an
/// output, each with a register) pass 16 KiB.
#[tokio::test]
#[serial]
async fn external_sweep_leaves_a_utxo_no_transaction_can_hold() {
    let bought = ("bb".repeat(28), hex::encode("BOUGHT"), 1_000);
    let (_, tx) = sweep_external(|dapp| {
        vec![
            address_utxo(dapp, 1, 300_000_000, &[]),
            address_utxo(dapp, 2, 200_000_000, &pile(0xa0, 1_500)),
            address_utxo(dapp, 3, 2_000_000, std::slice::from_ref(&bought)),
        ]
    })
    .await;

    assert_eq!(sorted_inputs(&tx), vec![(tx_hash(1), 0), (tx_hash(3), 0)]);
}

/// A stranger's pile of tokens holding too little ADA for the outputs a sweep
/// splits it into (20 tokens to an output, each with a register: 600 tokens
/// need about 56 ADA here, and came with 10) can't stop the sweep of the
/// rest's ADA, which can't make up the difference: it stays.
#[tokio::test]
#[serial]
async fn external_sweep_leaves_tokens_the_rest_cant_carry() {
    let (_, tx) = sweep_external(|dapp| {
        vec![
            address_utxo(dapp, 1, 20_000_000, &[]),
            address_utxo(dapp, 2, 10_000_000, &pile(0xb0, 600)),
        ]
    })
    .await;

    assert_eq!(tx.inputs, vec![(tx_hash(1), 0)]);
    assert!(tx.outputs.iter().all(|o| o.assets.is_empty()));
}

/// Reference scripts past what one transaction may use together (204,800
/// bytes) can't stop the sweep: it takes as many as fit, and the rest wait.
#[tokio::test]
#[serial]
async fn external_sweep_takes_the_reference_scripts_one_transaction_may_use() {
    let (_, tx) = sweep_external(|dapp| {
        let mut rows = vec![address_utxo(dapp, 1, 100_000_000, &[])];
        rows.extend(
            (2..=15).map(|n| with_reference_script(address_utxo(dapp, n, 70_000_000, &[]), 15_000)),
        );
        rows
    })
    .await;

    let expected: Vec<(String, u64)> = (1..=14).map(|n| (tx_hash(n), 0)).collect();
    assert_eq!(
        sorted_inputs(&tx),
        expected,
        "13 scripts of 15,000 bytes fit"
    );
}

/// A UTxO holding a reference script the CLI can't measure can't be priced,
/// so it stays, rather than stop the sweep of the rest.
#[tokio::test]
#[serial]
async fn external_sweep_leaves_a_reference_script_it_cant_measure() {
    let (_, tx) = sweep_external(|dapp| {
        let mut unmeasured = with_reference_script(address_utxo(dapp, 2, 3_000_000, &[]), 100);
        if let Some(script) = unmeasured.reference_script.as_mut() {
            script.bytes = None;
        }
        vec![address_utxo(dapp, 1, 10_000_000, &[]), unmeasured]
    })
    .await;

    assert_eq!(tx.inputs, vec![(tx_hash(1), 0)]);
}

/// A token UTxO received with a key address's least ADA brings less than its
/// deposit needs (the contract output's register costs about 0.43 ADA more),
/// as a stranger's pile of tokens does. Only what the rest can't carry stays:
/// the pile, while the user's NFT goes with the 20 ADA, which makes up its
/// difference (chunk 51's review of r4#1's fix).
#[tokio::test]
#[serial]
async fn external_sweep_takes_a_token_utxo_the_rest_can_carry_beside_a_pile() {
    let nft = ("dd".repeat(28), hex::encode("NFT"), 1);
    let (_, tx) = sweep_external(|dapp| {
        vec![
            address_utxo(dapp, 1, 20_000_000, &[]),
            address_utxo(dapp, 2, 1_200_000, std::slice::from_ref(&nft)),
            address_utxo(dapp, 3, 10_000_000, &pile(0xb0, 600)),
        ]
    })
    .await;

    assert_eq!(
        sorted_inputs(&tx),
        vec![(tx_hash(1), 0), (tx_hash(2), 0)],
        "the NFT goes with the ADA; only the pile stays"
    );
    let swept: u64 = tx
        .outputs
        .iter()
        .filter_map(|o| o.assets.get(&(nft.0.clone(), nft.1.clone())))
        .sum();
    assert_eq!(swept, 1);
}
