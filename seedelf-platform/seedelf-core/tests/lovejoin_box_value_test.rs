//! How much ADA a box of a token pool the wallet launches must hold (S0d,
//! the owner's ask of 2026-10-13: "a provable test showing what exactly it
//! has to be for this flow"). Proven by building it, not estimated.
//!
//! A box comes back on its own: a withdraw into a Seedelf that the box pays
//! for itself. What comes back is then spent like any other Seedelf UTxO, and
//! on its own, since spending it with another would tie the two histories
//! together and undo the mixing. So a box's ADA must pay for, in turn:
//!
//! 1. the withdraw, its fee and its Seedelf output (the token, a register);
//! 2. from what came back alone, a payment of part of the token, to a
//!    Seedelf or to an address, with the token's change and the fee;
//! 3. or all of it, to a Seedelf or to an address.
//!
//! Each is built and measured by the wallet's own builders, for a token at
//! its worst (a 32-byte name, `Q = 2^64 − 1`) and a typical one, under
//! preprod's and mainnet's parameters, with the pool's scripts by reference
//! (published at the holder, as the wallet's launches do) and inline. The
//! least box value at which all of them build is searched to 0.01 ₳, and so
//! is how far the price of a byte can rise before each candidate value stops
//! covering a shape.
//!
//! What it found (2026-10-17), the same on both networks:
//!
//! | token | scripts | least box value | its withdraw fee |
//! |---|---|---|---|
//! | worst | by reference | 4.11 ₳ | 0.298 ₳ |
//! | worst | inline | 4.23 ₳ | 0.412 ₳ |
//! | typical | by reference | 3.83 ₳ | 0.297 ₳ |
//! | typical | inline | 3.95 ₳ | 0.410 ₳ |
//!
//! Every time the step that binds is paying part of the token to a Seedelf
//! from what came back alone: the recipient's output, the token's change and
//! the fee. Both outputs are sized at the wallet's Seedelf minimum, which
//! sizes against a base address and so runs about 0.12 ₳ an output over the
//! enterprise address the contract really has; sized exactly, each figure
//! would be about 0.24 ₳ lower. And how far the price of a byte (today 4,310
//! lovelace) can rise before a box value stops covering a shape, inline:
//!
//! | box value | worst token | typical token |
//! |---|---|---|
//! | 4.00 ₳ | doesn't cover it today (−6.3%) | +1.7% |
//! | 4.25 ₳ | +0.7% | +9.3% |
//! | 4.50 ₳ | +7.7% | +17.0% |
//! | 5.00 ₳ | +21.7% | +32.0% |
//!
//! So 4 ₳ covers a typical token with almost nothing to spare, and not the
//! worst a launch can name. The figure is the owner's to choose from these.
//!
//! Since chunk 34's 34d the search is core's own (`lovejoin::way_back`,
//! `least_box_lovelace`), which the launch form runs under the live
//! parameters; this test holds it to what was measured, and to the
//! suggestion every token measured gets (4.5 ₳).
//!
//! ```text
//! cargo test -p seedelf-core --test lovejoin_box_value_test -- --nocapture
//! ```

use seedelf_core::lovejoin::{
    BoxToken, BoxValue, Probe, least_box_lovelace, suggested_box_lovelace, way_back,
};
use seedelf_koios::koios::ProtocolParameters;
use serde_json::Value;

/// The least box value each case needs, as measured 2026-10-17 under the
/// bundled parameters (4,310 lovelace a byte on both networks): the same on
/// preprod and mainnet. A change in the builders or the parameters that
/// moves one shows here first.
const MEASURED: [(Shape, bool, u64); 4] = [
    (Shape::Worst, true, 4_110_000),
    (Shape::Worst, false, 4_230_000),
    (Shape::Typical, true, 3_830_000),
    (Shape::Typical, false, 3_950_000),
];

/// An ADA pool's least box value, as measured 2026-10-18, scripts by
/// reference, the same on both networks.
const ADA_MEASURED: u64 = 3_450_000;

fn params(network_flag: bool) -> ProtocolParameters {
    let rows: Value = serde_json::from_str(if network_flag {
        include_str!("fixtures/epoch_params.json")
    } else {
        include_str!("fixtures/epoch_params_mainnet.json")
    })
    .unwrap();
    ProtocolParameters::from_koios(&rows[0]).unwrap()
}

/// A token, at its worst or as it typically is.
#[derive(Clone, Copy, Debug)]
enum Shape {
    /// A 32-byte name and `Q = 2^64 − 1`: the largest a box's token can be.
    Worst,
    /// A five-letter name and 100 of a six-decimal token (as NIGHT is).
    Typical,
}

impl Shape {
    fn token(self) -> BoxToken {
        match self {
            Shape::Worst => BoxToken {
                policy: [0xfe; 28],
                name: vec![0xee; 32],
                quantity: u64::MAX,
            },
            Shape::Typical => BoxToken {
                policy: [0x1a; 28],
                name: b"NIGHT".to_vec(),
                quantity: 100_000_000,
            },
        }
    }
}

fn value(lovelace: u64, shape: Shape) -> BoxValue {
    BoxValue {
        lovelace,
        token: Some(shape.token()),
    }
}

fn ada(lovelace: u64) -> String {
    format!("{}.{:06} ₳", lovelace / 1_000_000, lovelace % 1_000_000)
}

/// The proof: the least box value each case needs, as recorded in
/// [`MEASURED`], and how far the price of a byte can rise before each
/// candidate value stops covering a shape.
#[test]
fn a_token_pools_box_value_is_proven() {
    for network_flag in [true, false] {
        let params = params(network_flag);
        let network = if network_flag { "preprod" } else { "mainnet" };
        for (shape, by_reference, expected) in MEASURED {
            let probe = Probe::new(network_flag, by_reference).unwrap();
            let least = least_box_lovelace(&probe, &params, Some(&shape.token())).unwrap();
            let back = way_back(&probe, &params, &value(least, shape)).unwrap();
            println!(
                "{network:<8} {shape:<8?} scripts {:<6} | least box value {} | its withdraw fee {} | back {}",
                if by_reference { "by ref" } else { "inline" },
                ada(least),
                ada(back.withdraw_fee),
                ada(back.back),
            );
            assert_eq!(
                least, expected,
                "{network} {shape:?} by reference {by_reference}"
            );
            // A hundredth less, and it's paying part of the token to a
            // Seedelf that can't be built.
            let short = way_back(&probe, &params, &value(least - 10_000, shape)).unwrap_err();
            assert!(short.starts_with("part of it to a Seedelf"), "{short}");
            // Every token measured is suggested 4.5 ₳.
            assert_eq!(suggested_box_lovelace(least), 4_500_000);
        }
        // An ADA pool's box: its way back, from what came back alone too.
        let probe = Probe::new(network_flag, true).unwrap();
        let least = least_box_lovelace(&probe, &params, None).unwrap();
        println!(
            "{network:<8} ADA pool scripts by ref | least box value {}",
            ada(least)
        );
        assert_eq!(least, ADA_MEASURED, "{network} ADA pool");
    }

    // How far the price of a byte can rise before each candidate value stops
    // covering a shape, its scripts inline (the dearer): in steps of 10.
    let base = params(false);
    let probe = Probe::new(false, false).unwrap();
    for shape in [Shape::Worst, Shape::Typical] {
        for candidate in [4_000_000u64, 4_250_000, 4_500_000, 5_000_000] {
            let at = |price: u64| ProtocolParameters {
                coins_per_utxo_size: price,
                ..base.clone()
            };
            let (mut low, mut high) = (base.coins_per_utxo_size / 2, base.coins_per_utxo_size * 4);
            if way_back(&probe, &at(low), &value(candidate, shape)).is_err() {
                println!(
                    "{shape:?} at {}: not even at half today's price",
                    ada(candidate)
                );
                continue;
            }
            while high - low > 10 {
                let mid = (low + high) / 2;
                if way_back(&probe, &at(mid), &value(candidate, shape)).is_ok() {
                    low = mid;
                } else {
                    high = mid;
                }
            }
            println!(
                "{shape:?} at {}: covered up to {low} lovelace a byte, {:+.1}% on today's {}",
                ada(candidate),
                (low as f64 / base.coins_per_utxo_size as f64 - 1.0) * 100.0,
                base.coins_per_utxo_size
            );
        }
    }
}
