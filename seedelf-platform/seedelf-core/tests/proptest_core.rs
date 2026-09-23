//! Property tests for the pure transaction logic — lovelace arithmetic, asset
//! bundle operations, and coin selection. These complement the example-based
//! tests in `transaction_test.rs` / `assets_test.rs` / `utxos_test.rs` with
//! "for all inputs" guarantees, especially around the `u64` underflow class
//! that `checked_lovelace` exists to close.

use proptest::prelude::*;
use seedelf_core::assets::{Asset, Assets};
use seedelf_core::transaction::checked_lovelace;
use seedelf_core::utxos;
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse};

const PID: &str = "11111111111111111111111111111111111111111111111111111111";

fn fixture_params() -> ProtocolParameters {
    ProtocolParameters {
        coins_per_utxo_size: 4_310,
        price_mem: 0.0577,
        price_step: 0.0000721,
        cost_model_v3: Vec::new(),
    }
}

fn one_asset(name: &str, amount: u64) -> Assets {
    Assets::new()
        .add(Asset::new(PID.to_string(), name.to_string(), amount).unwrap())
        .unwrap()
}

fn ada_utxo(byte: u8, lovelace: u64) -> UtxoResponse {
    UtxoResponse {
        tx_hash: hex::encode([byte; 32]),
        value: lovelace.to_string(),
        asset_list: Some(vec![]),
        ..Default::default()
    }
}

proptest! {
    /// `checked_lovelace` must never wrap: it errors exactly when a sequential
    /// checked subtraction would underflow, and otherwise returns the result.
    #[test]
    fn checked_lovelace_matches_sequential_checked_sub(
        available in any::<u64>(),
        deductions in proptest::collection::vec(any::<u64>(), 0..6),
    ) {
        let got = checked_lovelace(available, &deductions);
        let mut acc: Option<u64> = Some(available);
        for d in &deductions {
            acc = acc.and_then(|a| a.checked_sub(*d));
        }
        match acc {
            Some(expected) => prop_assert_eq!(got.unwrap(), expected),
            None => prop_assert!(got.is_err()),
        }
    }

    #[test]
    fn checked_lovelace_no_deductions_is_identity(available in any::<u64>()) {
        prop_assert_eq!(checked_lovelace(available, &[]).unwrap(), available);
    }

    #[test]
    fn checked_lovelace_result_never_exceeds_available(
        available in any::<u64>(),
        deductions in proptest::collection::vec(any::<u64>(), 0..6),
    ) {
        if let Ok(remaining) = checked_lovelace(available, &deductions) {
            prop_assert!(remaining <= available);
        }
    }

    /// Merging two single-asset bundles sums the amounts.
    #[test]
    fn merge_conserves_amount(a in 0u64..(u64::MAX / 2), b in 0u64..(u64::MAX / 2)) {
        let merged = one_asset("aa", a).merge(one_asset("aa", b)).unwrap();
        prop_assert_eq!(merged.items.len(), 1);
        prop_assert_eq!(merged.items[0].amount, a + b);
    }

    /// Separating a sub-amount yields the difference; an exact match removes it.
    #[test]
    fn separate_yields_difference(x in 1u64..u64::MAX, y in 0u64..u64::MAX) {
        prop_assume!(y <= x);
        let result = one_asset("aa", x).separate(one_asset("aa", y)).unwrap();
        if x == y {
            prop_assert!(result.items.is_empty());
        } else {
            prop_assert_eq!(result.items.len(), 1);
            prop_assert_eq!(result.items[0].amount, x - y);
        }
    }

    /// Separating an asset that is not present must error, never fabricate it.
    #[test]
    fn separate_absent_asset_errors(x in 1u64..u64::MAX, y in 1u64..u64::MAX) {
        prop_assert!(one_asset("aa", x).separate(one_asset("bb", y)).is_err());
    }

    /// `split` chunks each hold at most `k` items and lose none of them.
    #[test]
    fn split_chunks_are_bounded_and_total_preserving(n in 0usize..50, k in 1usize..16) {
        let mut assets = Assets::new();
        for i in 0..n {
            assets = assets
                .add(Asset::new(PID.to_string(), format!("{i:04x}"), 1).unwrap())
                .unwrap();
        }
        let chunks = assets.split(k);
        for chunk in &chunks {
            prop_assert!(chunk.items.len() <= k);
        }
        let total: usize = chunks.iter().map(|c| c.items.len()).sum();
        prop_assert_eq!(total, n);
    }

    /// `select` either returns nothing or a set that genuinely covers the goal,
    /// and never panics — the `u64` underflow class would surface as a panic.
    #[test]
    fn select_pure_ada_covers_goal_or_returns_empty(
        values in proptest::collection::vec(1u64..100_000_000u64, 0..12),
        goal in 1u64..150_000_000u64,
    ) {
        let utxos: Vec<UtxoResponse> = values
            .iter()
            .enumerate()
            .map(|(i, v)| ada_utxo(i as u8, *v))
            .collect();
        let selected = utxos::select(&fixture_params(), utxos, goal, Assets::new()).unwrap();
        if !selected.is_empty() {
            let total: u64 = selected
                .iter()
                .map(|u| u.value.parse::<u64>().unwrap())
                .sum();
            prop_assert!(total >= goal, "selected {total} does not cover goal {goal}");
        }
    }
}
