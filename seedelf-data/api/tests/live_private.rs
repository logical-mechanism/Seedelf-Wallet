//! The private index's two sources, the real db-sync and Kupo, through
//! `seedelf-data/.env`. Ignored by default: `cargo test -- --ignored
//! --test-threads=1`, from `seedelf-data/`. What's on chain moves, so each
//! test checks the sources agree with each other and with themselves, not
//! fixed numbers.

use std::collections::{HashMap, HashSet};

use seedelf_data_api::chain::Chain;
use seedelf_data_api::constants::{CONTRACT_HASH, MIXBOX_HASH};
use seedelf_data_api::cursor::{QUANT, stable_slot};
use seedelf_data_api::kupo::Kupo;
use seedelf_data_api::row::Row;
use seedelf_data_api::source::Source;

/// The grid slot whose block is 11,305,804, the one before the contract's first output.
const BEFORE_THE_CONTRACT: i64 = 144_386_200;

/// Kupo's first grid slot: it starts at block 11,305,805, the contract's first output.
const KUPO_FIRST: i64 = 144_386_400;

/// The two credentials, and whether their rows carry a box's making.
const WATCHED: [(&str, bool); 2] = [(CONTRACT_HASH, false), (MIXBOX_HASH, true)];

fn env(name: &str) -> String {
    let _ = dotenvy::from_path(concat!(env!("CARGO_MANIFEST_DIR"), "/../.env"));
    std::env::var(name).expect("seedelf-data/.env")
}

fn db_sync() -> Source {
    Source::DbSync(Chain::connect(&env("MAINNET_DATABASE_URL")).unwrap())
}

fn kupo() -> Source {
    Source::Kupo(Kupo::new(&env("MAINNET_KUPO_URL")).unwrap())
}

/// The older of the two sources' tips, so a cursor below it is in both.
async fn common_tip() -> i64 {
    let Source::DbSync(chain) = db_sync() else {
        unreachable!()
    };
    let Source::Kupo(kupo) = kupo() else {
        unreachable!()
    };
    chain
        .tip()
        .await
        .unwrap()
        .slot
        .min(kupo.tip().await.unwrap().slot)
}

/// Grid slots from the stable cursor back: a day, two days, a month.
fn cursors(tip: i64) -> Vec<i64> {
    let stable = stable_slot(tip);
    [0, 86_400, 172_800, 2_592_000]
        .into_iter()
        .map(|back| (stable - back) / QUANT * QUANT)
        .collect()
}

/// The view a wallet rebuilds from the snapshot at `slot` and "since" it,
/// against the rows unspent now: the two must be the same set.
async fn replays_to_now(source: &Source, cred: &str, provenance: bool, slot: i64) {
    for _ in 0..3 {
        let block = source.block_before(slot).await.unwrap().expect("a block");
        let mut view: HashSet<String> = source
            .unspent_as_of(cred, block.slot, provenance)
            .await
            .unwrap()
            .into_iter()
            .map(|row| row.reference)
            .collect();
        let (created, spent) = source.since(cred, block.slot, provenance).await.unwrap();
        view.extend(
            created
                .into_iter()
                .filter(|row| row.spent.is_none())
                .map(|row| row.reference),
        );
        for spent in spent {
            view.remove(&spent.reference);
        }
        let now: HashSet<String> = source
            .unspent_now(cred, provenance)
            .await
            .unwrap()
            .into_iter()
            .map(|row| row.reference)
            .collect();
        // A block can land between the reads, so they get three tries to agree.
        if view == now {
            return;
        }
    }
    panic!("{cred} didn't replay from slot {slot}");
}

#[tokio::test]
#[ignore = "live db-sync and Kupo"]
async fn every_cursor_replays_to_the_tip() {
    let tip = common_tip().await;
    let (db_sync, kupo) = (db_sync(), kupo());
    for (cred, provenance) in WATCHED {
        for slot in cursors(tip).into_iter().chain([KUPO_FIRST]) {
            replays_to_now(&db_sync, cred, provenance, slot).await;
            replays_to_now(&kupo, cred, provenance, slot).await;
        }
        replays_to_now(&db_sync, cred, provenance, BEFORE_THE_CONTRACT).await;
    }
}

/// The wallet's own step, which can't race: everything at or below the new
/// cursor is settled. The view at cursor `C`, plus the changes `since(C)`
/// up to `C'`, is the view at `C'`.
async fn steps_to(source: &Source, cred: &str, provenance: bool, from: i64, to: i64) {
    let from = source.block_before(from).await.unwrap().unwrap().slot;
    let to = source.block_before(to).await.unwrap().unwrap().slot;
    let mut view: HashSet<String> = source
        .unspent_as_of(cred, from, provenance)
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.reference)
        .collect();
    let (created, spent) = source.since(cred, from, provenance).await.unwrap();
    for row in created {
        let gone = row.spent.as_ref().is_some_and(|spend| spend.at.slot <= to);
        if row.created.slot <= to && !gone {
            view.insert(row.reference);
        }
    }
    for spent in spent {
        if spent.spend.at.slot <= to {
            view.remove(&spent.reference);
        }
    }
    let settled: HashSet<String> = source
        .unspent_as_of(cred, to, provenance)
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.reference)
        .collect();
    assert_eq!(view, settled, "{cred} from {from} to {to}");
}

#[tokio::test]
#[ignore = "live db-sync and Kupo"]
async fn a_wallets_step_lands_on_the_next_cursor() {
    let tip = common_tip().await;
    let (db_sync, kupo) = (db_sync(), kupo());
    let to = stable_slot(tip);
    for (cred, provenance) in WATCHED {
        for from in cursors(tip).into_iter().skip(1).chain([KUPO_FIRST]) {
            steps_to(&db_sync, cred, provenance, from, to).await;
            steps_to(&kupo, cred, provenance, from, to).await;
        }
    }
}

#[tokio::test]
#[ignore = "live db-sync and Kupo"]
async fn both_sources_name_the_same_blocks() {
    let tip = common_tip().await;
    let (db_sync, kupo) = (db_sync(), kupo());
    for slot in cursors(tip).into_iter().chain([KUPO_FIRST, 168_416_400]) {
        let block = db_sync.block_before(slot).await.unwrap();
        assert!(block.is_some());
        assert_eq!(block, kupo.block_before(slot).await.unwrap(), "{slot}");
    }
    assert_eq!(kupo.block_before(BEFORE_THE_CONTRACT).await.unwrap(), None);
}

/// db-sync's rows as Kupo gives them: a box's making without who paid.
fn as_kupo(rows: Vec<Row>) -> Vec<Row> {
    rows.into_iter()
        .map(|mut row| {
            if let Some(made_by) = &mut row.made_by {
                made_by.inputs = None;
            }
            row
        })
        .collect()
}

#[tokio::test]
#[ignore = "live db-sync and Kupo"]
async fn both_sources_give_the_same_rows() {
    let tip = common_tip().await;
    let (db_sync, kupo) = (db_sync(), kupo());
    for (cred, provenance) in WATCHED {
        for slot in cursors(tip).into_iter().chain([KUPO_FIRST]) {
            let at = db_sync.block_before(slot).await.unwrap().unwrap().slot;
            // A settled snapshot: the same whenever it's read.
            assert_eq!(
                as_kupo(db_sync.unspent_as_of(cred, at, provenance).await.unwrap()),
                kupo.unspent_as_of(cred, at, provenance).await.unwrap(),
                "{cred} as of {at}"
            );
            // "Since" reaches the tip, which may move between the reads.
            let mut agreed = false;
            for _ in 0..3 {
                let (created, spent) = db_sync.since(cred, at, provenance).await.unwrap();
                let theirs = kupo.since(cred, at, provenance).await.unwrap();
                if (as_kupo(created), spent) == theirs {
                    agreed = true;
                    break;
                }
            }
            assert!(agreed, "{cred} since {at}");
        }
    }
}

#[tokio::test]
#[ignore = "live db-sync and Kupo"]
async fn a_box_mixed_by_one_is_mixed_by_both() {
    let (db_sync, kupo) = (db_sync(), kupo());
    let at = db_sync
        .block_before(stable_slot(common_tip().await) - 2_592_000)
        .await
        .unwrap()
        .unwrap()
        .slot;
    let mixed = |rows: Vec<Row>| -> HashMap<String, bool> {
        rows.into_iter()
            .map(|row| (row.reference, row.made_by.expect("a box's making").mixed))
            .collect()
    };
    let (ours, _) = db_sync.since(MIXBOX_HASH, at, true).await.unwrap();
    let (theirs, _) = kupo.since(MIXBOX_HASH, at, true).await.unwrap();
    let (ours, theirs) = (mixed(ours), mixed(theirs));
    // Boxes both mixed and not, so the check means something.
    assert!(ours.values().any(|&m| m) && ours.values().any(|&m| !m));
    // A box made between the two reads is in one only.
    for (reference, mixed) in &ours {
        if let Some(theirs) = theirs.get(reference) {
            assert_eq!(mixed, theirs, "{reference}");
        }
    }
    assert!(theirs.len() + 3 >= ours.len());
}

#[tokio::test]
#[ignore = "live db-sync"]
async fn every_box_knows_who_made_it() {
    let db_sync = db_sync();
    let boxes = db_sync.unspent_now(MIXBOX_HASH, true).await.unwrap();
    assert!(!boxes.is_empty());
    for row in boxes {
        let made_by = row.made_by.expect("a box's making");
        assert!(
            made_by.inputs.is_some_and(|inputs| !inputs.is_empty()),
            "{}",
            row.reference
        );
    }
    let rows = db_sync.unspent_now(CONTRACT_HASH, false).await.unwrap();
    assert!(rows.iter().all(|row| row.made_by.is_none()));
    assert!(rows.iter().any(|row| row.seedelf_name().is_some()));
}

#[tokio::test]
#[ignore = "live db-sync and Kupo"]
async fn each_tip_is_the_block_at_its_slot() {
    let Source::DbSync(chain) = db_sync() else {
        unreachable!()
    };
    let tip = chain.tip().await.unwrap();
    let block = chain.block_before(tip.slot).await.unwrap().unwrap();
    assert_eq!((block.slot, block.hash), (tip.slot, tip.hash));

    let Source::Kupo(kupo) = kupo() else {
        unreachable!()
    };
    let tip = kupo.tip().await.unwrap();
    assert_eq!(kupo.block_before(tip.slot).await.unwrap(), Some(tip));
}
