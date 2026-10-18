//! Lovejoin's token pools against the real db-sync, through `seedelf-data/.env`
//! (web wallet chunk 34's 34c). Ignored by default: `cargo test --test
//! live_lovejoin -- --ignored --test-threads=1 --nocapture`, from
//! `seedelf-data/`. No token pool is shown on mainnet yet, so the queries are
//! checked against what they share with the classic pool's, and the holder's
//! candidates are listed with why each isn't shown.

use std::collections::HashSet;

use seedelf_data_api::chain::Chain;
use seedelf_data_api::constants::{MIXBOX_HASH, bytes};
use seedelf_data_api::cursor::stable_slot;
use seedelf_data_api::lovejoin::datum::is_mix_datum;
use seedelf_data_api::lovejoin::discovery::Discovery;
use seedelf_data_api::lovejoin::standard::{self, Listed, Verdict};
use seedelf_data_api::lovejoin::templates::{HOLDER_HASH, NFT_NAME};
use seedelf_data_api::lovejoin::{db, standard::Candidate};

fn chain() -> Chain {
    let _ = dotenvy::from_path(concat!(env!("CARGO_MANIFEST_DIR"), "/../.env"));
    Chain::connect(&std::env::var("MAINNET_DATABASE_URL").expect("seedelf-data/.env")).unwrap()
}

/// The stable cursor's block's slot, as the routes read at.
async fn stable(chain: &Chain) -> i64 {
    let tip = chain.tip().await.unwrap();
    chain
        .block_before(stable_slot(tip.slot))
        .await
        .unwrap()
        .expect("a block")
        .slot
}

/// The combined feed's queries, given the classic pool's mix box alone, give
/// the classic route's rows field for field, each box's `mixed` included.
#[tokio::test]
#[ignore = "live db-sync"]
async fn the_combined_feed_reads_as_the_classic_pools_route() {
    let chain = chain();
    let at = stable(&chain).await;
    let cred = bytes(MIXBOX_HASH);
    let any = chain
        .unspent_as_of_any(std::slice::from_ref(&cred), at)
        .await
        .unwrap();
    let one = chain.unspent_as_of(&cred, at, true).await.unwrap();
    assert!(!one.is_empty());
    assert_eq!(any, one);
    let day = at - 86_400;
    let block = chain.block_before(day).await.unwrap().expect("a block");
    let (created_any, spent_any) = chain
        .since_any(std::slice::from_ref(&cred), block.slot)
        .await
        .unwrap();
    let (created, spent) = chain.since(&cred, block.slot, true).await.unwrap();
    assert_eq!((created_any, spent_any), (created, spent));
    println!(
        "{} boxes at the classic pool's mix box as of slot {at}",
        one.len()
    );
}

/// The classic pool's crowd: its boxes are the route's 10 ₳ boxes, and each
/// count is within what its history allows.
#[tokio::test]
#[ignore = "live db-sync"]
async fn the_classic_pools_crowd_counts_what_the_route_lists() {
    let chain = chain();
    let at = stable(&chain).await;
    let (crowd, none) = Discovery::default().crowds(&chain, &[], at).await.unwrap();
    assert!(none.is_empty());
    let rows = chain
        .unspent_as_of(&bytes(MIXBOX_HASH), at, true)
        .await
        .unwrap();
    let boxes: Vec<_> = rows
        .iter()
        .filter(|r| {
            r.lovelace == standard::CLASSIC_LOVELACE.to_string()
                && r.assets.is_empty()
                && r.datum.as_deref().is_some_and(|d| is_mix_datum(&bytes(d)))
        })
        .collect();
    assert_eq!(crowd.boxes, boxes.len() as u64);
    let mixed = boxes
        .iter()
        .filter(|r| r.made_by.as_ref().is_some_and(|m| m.mixed))
        .count();
    assert_eq!(crowd.mixed, mixed as u64);
    // At least one deposit is behind any box; never more than the transactions that ever paid the mix box.
    let ever = db::ever(&chain, &[bytes(MIXBOX_HASH)], at).await.unwrap();
    let makers: HashSet<i64> = ever.iter().map(|e| e.made_by).collect();
    assert!(crowd.deposits >= u64::from(crowd.boxes > 0));
    assert!(crowd.deposits <= makers.len() as u64);
    println!(
        "the classic pool: {} boxes from {} deposits, {} of them mixed ({} transactions ever paid it)",
        crowd.boxes,
        crowd.deposits,
        crowd.mixed,
        makers.len()
    );
}

/// Every candidate at the holder is read and checked, its launch's facts
/// included, and each says why it is or isn't shown.
#[tokio::test]
#[ignore = "live db-sync"]
async fn every_candidate_at_the_holder_is_checked() {
    let chain = chain();
    let at = stable(&chain).await;
    let holder = bytes(HOLDER_HASH);
    let found = db::found(&chain, &holder, NFT_NAME, at, 0).await.unwrap();
    // Read on from a month back by output id, as the server does between its hourly reads: the same candidates.
    let earlier = at - 2_592_000;
    let before = db::found(&chain, &holder, NFT_NAME, earlier, 0)
        .await
        .unwrap();
    let high = before.iter().map(|f| f.id).max().unwrap_or(0);
    let after = db::found(&chain, &holder, NFT_NAME, at, high)
        .await
        .unwrap();
    let ids = |f: &[db::Found]| f.iter().map(|f| f.id).collect::<Vec<_>>();
    assert_eq!(ids(&[before, after].concat()), ids(&found));
    let refs: Vec<&db::Found> = found.iter().collect();
    let launches = db::launches(&chain, &holder, &refs).await.unwrap();
    let (listed, address) = (Listed::mainnet(), standard::holder_address());
    for f in &found {
        let launch = launches[&f.tx_id].clone();
        println!(
            "{} (block {}, {} inputs, {} scripts at the holder, {} registered): {}",
            f.row.reference,
            f.block,
            launch.inputs.len(),
            launch.scripts.len(),
            launch.registers.len(),
            match standard::check(
                &Candidate {
                    reference: f.row.clone(),
                    launch
                },
                &listed,
                &address
            ) {
                Verdict::Standard(_) => "standard".to_string(),
                Verdict::Unregistered(_) => "standard but for L's registration".to_string(),
                Verdict::Rejected(why) => why.to_string(),
            }
        );
    }
    let shown = Discovery::default().shown(&chain, at).await.unwrap();
    println!("{} candidates, {} shown", found.len(), shown.len());
    // A cred never registered has no first registration.
    assert!(
        db::registered(&chain, &[[0x11; 28]])
            .await
            .unwrap()
            .is_empty()
    );
}
