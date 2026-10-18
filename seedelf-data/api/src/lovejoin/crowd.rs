//! How many deposits a pool's boxes could have come from (web wallet chunk
//! 34's 34c, the owner's call of 2026-10-17): the crowd line's count.
//!
//! A transaction that pays a pool's `mix_box` without spending from it is a
//! **deposit**: whoever made it holds what it paid in. One that spends from
//! it too is a **mix**, and each box it makes could be any of its inputs, so
//! it could have come from any deposit behind any of them. A pool's crowd is
//! every deposit some box in it now could have come from. Once every box a
//! deposit's boxes could have become has left, the deposit is no longer
//! counted: its owner may hold nothing there.
//!
//! Worked backwards: from the transactions that made the boxes in the pool
//! now, through each mix to the transactions that made its inputs, until
//! only deposits are left. Each transaction is visited once.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

/// An output that was ever at a pool's `mix_box`, as of a cursor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Output {
    /// The transaction that made it (db-sync's id).
    pub made_by: i64,
    /// It holds exactly the pool's box value and a box's datum: a box a mix may take.
    pub is_box: bool,
    /// The transaction that spent it, if one did by the cursor.
    pub spent_by: Option<i64>,
}

/// The crowd line's numbers, as of a cursor, the same for everyone: the wallet takes its own out.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Crowd {
    /// Boxes in the pool.
    pub boxes: u64,
    /// The deposits they could have come from.
    pub deposits: u64,
    /// How many of the boxes a mix made.
    pub mixed: u64,
}

/// A pool's crowd, from every output ever at its `mix_box` by the cursor.
pub fn crowd(outputs: &[Output]) -> Crowd {
    // What each mix spent there: the transactions that made its inputs.
    let mut inputs: HashMap<i64, Vec<i64>> = HashMap::new();
    for o in outputs {
        if let Some(by) = o.spent_by {
            inputs.entry(by).or_default().push(o.made_by);
        }
    }
    let live: Vec<&Output> = outputs
        .iter()
        .filter(|o| o.is_box && o.spent_by.is_none())
        .collect();
    let mut seen = HashSet::new();
    let mut next: Vec<i64> = live.iter().map(|o| o.made_by).collect();
    let mut deposits = 0;
    while let Some(tx) = next.pop() {
        if !seen.insert(tx) {
            continue;
        }
        match inputs.get(&tx) {
            Some(made) => next.extend(made),
            None => deposits += 1,
        }
    }
    Crowd {
        boxes: live.len() as u64,
        deposits,
        mixed: live
            .iter()
            .filter(|o| inputs.contains_key(&o.made_by))
            .count() as u64,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn out(made_by: i64, spent_by: Option<i64>) -> Output {
        Output {
            made_by,
            is_box: true,
            spent_by,
        }
    }

    #[test]
    fn before_any_mix_each_deposit_counts() {
        // A Bootstrap of 30 boxes in one transaction: "30 boxes, from 1 deposit, none mixed yet".
        let boot: Vec<Output> = (0..30).map(|_| out(1, None)).collect();
        assert_eq!(
            crowd(&boot),
            Crowd {
                boxes: 30,
                deposits: 1,
                mixed: 0
            }
        );
        let mut two = boot.clone();
        two.extend([out(2, None), out(2, None), out(2, None)]);
        assert_eq!(crowd(&two).deposits, 2);
        assert_eq!(crowd(&[]), Crowd::default());
    }

    #[test]
    fn a_mixs_boxes_could_be_any_of_its_inputs_deposits() {
        // Deposits 1 (three boxes) and 2 (one); mix 3 takes one of each and a second of 1's.
        let outputs = vec![
            out(1, Some(3)),
            out(1, Some(3)),
            out(1, None),
            out(2, Some(3)),
            out(3, None),
            out(3, None),
            out(3, None),
        ];
        assert_eq!(
            crowd(&outputs),
            Crowd {
                boxes: 4,
                deposits: 2,
                mixed: 3
            }
        );
    }

    #[test]
    fn a_deposit_whose_boxes_all_left_no_longer_counts() {
        // Deposit 2's one box went into mix 3, whose boxes have all been brought back
        // (withdraws 4, 5, 6): what's left is deposit 1's.
        let outputs = vec![
            out(1, Some(3)),
            out(1, Some(3)),
            out(1, None),
            out(2, Some(3)),
            out(3, Some(4)),
            out(3, Some(5)),
            out(3, Some(6)),
        ];
        assert_eq!(
            crowd(&outputs),
            Crowd {
                boxes: 1,
                deposits: 1,
                mixed: 0
            }
        );
    }

    #[test]
    fn origins_carry_through_chains_of_mixes() {
        // 1, 2 and 7 deposit; mix 3 takes 1's and 2's; mix 4 takes one of 3's and 7's.
        let outputs = vec![
            out(1, Some(3)),
            out(2, Some(3)),
            out(7, Some(4)),
            out(3, Some(4)),
            out(3, Some(9)),
            out(4, None),
            out(4, None),
        ];
        assert_eq!(crowd(&outputs).deposits, 3);
    }

    #[test]
    fn what_isnt_a_box_isnt_counted_but_its_making_is_followed() {
        // An over-funded output, mixed by someone: its deposit is behind the mix's boxes.
        let mut wrong = out(5, Some(6));
        wrong.is_box = false;
        let outputs = vec![wrong, out(1, Some(6)), out(6, None), out(6, None)];
        assert_eq!(
            crowd(&outputs),
            Crowd {
                boxes: 2,
                deposits: 2,
                mixed: 2
            }
        );
        let mut junk = out(8, None);
        junk.is_box = false;
        assert_eq!(crowd(&[junk]), Crowd::default());
    }
}
