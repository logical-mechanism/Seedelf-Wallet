//! Against the real db-sync, through `seedelf-data/.env`. Ignored by default:
//! `cargo test -- --ignored`, from `seedelf-data/`. What's on chain moves, so
//! each test checks the queries agree with each other, not fixed numbers.

use std::collections::HashSet;

use seedelf_data_api::chain::Chain;
use seedelf_data_api::constants::{CONTRACT_HASH, MIXBOX_HASH, bytes};
use seedelf_data_api::cursor::{QUANT, stable_height};

fn chain() -> Chain {
    let _ = dotenvy::from_path(concat!(env!("CARGO_MANIFEST_DIR"), "/../.env"));
    Chain::connect(&std::env::var("MAINNET_DATABASE_URL").expect("seedelf-data/.env")).unwrap()
}

/// The view a wallet rebuilds from the snapshot at `height` and "since" it,
/// against the rows unspent now: the two must be the same set.
async fn replays_to_now(chain: &Chain, cred: &[u8], provenance: bool, height: i64) {
    let block = chain
        .block_at(height)
        .await
        .unwrap()
        .expect("a block there");
    let mut view: HashSet<String> = chain
        .unspent_as_of(cred, block.id, provenance)
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.reference)
        .collect();
    for row in chain
        .created_since(cred, block.id, provenance)
        .await
        .unwrap()
    {
        if row.spent.is_none() {
            view.insert(row.reference);
        }
    }
    for spent in chain.spent_since(cred, block.id).await.unwrap() {
        view.remove(&spent.reference);
    }
    let now: HashSet<String> = chain
        .unspent_now(cred, provenance)
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.reference)
        .collect();
    assert_eq!(view, now, "replayed from height {height}");
}

#[tokio::test]
#[ignore = "live db-sync"]
async fn every_cursor_replays_to_the_tip() {
    let chain = chain();
    let tip = chain.tip().await.unwrap();
    let stable = stable_height(tip.height);
    // The stable cursor, a day, two days and a month back, and before the contract existed.
    for back in [0, 4320, 8640, 129_600, stable - 11_305_800] {
        let height = (stable - back) / QUANT * QUANT;
        for (cred, provenance) in [(CONTRACT_HASH, false), (MIXBOX_HASH, true)] {
            replays_to_now(&chain, &bytes(cred), provenance, height).await;
        }
    }
}

#[tokio::test]
#[ignore = "live db-sync"]
async fn every_box_knows_who_made_it() {
    let chain = chain();
    let boxes = chain.unspent_now(&bytes(MIXBOX_HASH), true).await.unwrap();
    assert!(!boxes.is_empty());
    for row in boxes {
        let made_by = row.made_by.expect("a box's making");
        assert!(!made_by.inputs.is_empty(), "{}", row.reference);
    }
    let rows = chain
        .unspent_now(&bytes(CONTRACT_HASH), false)
        .await
        .unwrap();
    assert!(rows.iter().all(|row| row.made_by.is_none()));
    assert!(rows.iter().any(|row| row.seedelf_name().is_some()));
}

#[tokio::test]
#[ignore = "live db-sync"]
async fn the_tip_is_the_block_at_its_height() {
    let chain = chain();
    let tip = chain.tip().await.unwrap();
    let block = chain.block_at(tip.height).await.unwrap().unwrap();
    assert_eq!(block.hash, tip.hash);
}
