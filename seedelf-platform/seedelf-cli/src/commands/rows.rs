//! Rows a stranger can add to. Anyone can pay the external wallet's address,
//! and anyone can pay the contract under a re-randomization of one of your
//! registers, which sit on chain beside each Seedelf. So nothing the CLI shows
//! or sweeps may need every such row to add up, or to fit in one transaction
//! (chunk 51, r4#1 and r4#2). For a few ADA, a stranger can send three UTxOs
//! of 2^63 − 1 of one token, which total past a u64; a pile of tokens whose
//! outputs, 20 tokens to an output, need more ADA than it came with; or more
//! UTxOs than one transaction holds.
//!
//! - A balance is totalled in u128 ([`totals`]): nothing is built from it.
//! - A sweep spends what one transaction can take ([`sweepable`],
//!   [`most_that_fit`]). The rest stays where it is, and the command says so
//!   ([`print_stayed`]).
//! - Which UTxOs a spend may take is never Koios's order, which is the order
//!   of the hashes, and so a payer's to pick ([`window`], [`by_worth`]).

use anyhow::{Context, Result};
use colored::Colorize;
use seedelf_core::assets::{Asset, Assets, string_to_u64};
use seedelf_core::build::{self, TooLarge};
use seedelf_core::utxos;
use seedelf_koios::koios::UtxoResponse;
use std::cmp::Reverse;
use std::collections::{BTreeMap, HashMap};

/// What some rows hold together, for a balance to show.
pub struct Totals {
    pub lovelace: u128,
    /// In the order first seen.
    pub tokens: Vec<Token>,
}

/// One token's total.
pub struct Token {
    /// Hex.
    pub policy_id: String,
    /// Hex.
    pub name: String,
    pub amount: u128,
}

/// The totals of `rows`, in u128: a token's can pass what a u64, and so one
/// output, holds. A row it can't read is named.
pub fn totals(rows: &[UtxoResponse]) -> Result<Totals> {
    let mut lovelace: u128 = 0;
    let mut tokens: Vec<Token> = Vec::new();
    let mut seen: BTreeMap<(String, String), usize> = BTreeMap::new();
    for row in rows {
        let value = string_to_u64(row.value.clone()).with_context(|| unreadable(row))?;
        lovelace += u128::from(value);
        for token in row.asset_list.iter().flatten() {
            let (key, quantity) = token_of(row, token)?;
            let at = *seen.entry(key.clone()).or_insert_with(|| {
                tokens.push(Token {
                    policy_id: key.0,
                    name: key.1,
                    amount: 0,
                });
                tokens.len() - 1
            });
            tokens[at].amount += u128::from(quantity);
        }
    }
    Ok(Totals { lovelace, tokens })
}

fn unreadable(row: &UtxoResponse) -> String {
    format!("UTxO {}#{} can't be read", row.tx_hash, row.tx_index)
}

/// One of `row`'s tokens, as its policy and name in lowercase hex, and its
/// amount.
fn token_of(
    row: &UtxoResponse,
    token: &seedelf_koios::koios::Asset,
) -> Result<((String, String), u64)> {
    let quantity = string_to_u64(token.quantity.clone()).with_context(|| unreadable(row))?;
    let asset = Asset::new(token.policy_id.clone(), token.asset_name.clone(), quantity)
        .with_context(|| unreadable(row))?;
    Ok((
        (hex::encode(asset.policy_id), hex::encode(&asset.token_name)),
        quantity,
    ))
}

/// Prints the tokens of `totals`, if any. One that totals more than one
/// output can hold says so: no single transaction moves all of it.
pub(crate) fn print_tokens(totals: &Totals) {
    if totals.tokens.is_empty() {
        return;
    }
    println!("{}", "\nTokens:\n".bright_magenta());
    for token in &totals.tokens {
        let note = if token.amount > u128::from(u64::MAX) {
            " (more than one output can hold)"
        } else {
            ""
        };
        println!(
            "{} {}.{}{}",
            token.amount.to_string().white(),
            token.policy_id.white(),
            token.name.white(),
            note.bright_yellow()
        );
    }
}

/// Why a UTxO a sweep could spend stays where it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Stay {
    /// One transaction can't take it with the rest: by size, by reference
    /// scripts, or past the UTxOs one spend takes. A next run can.
    Later,
    /// It holds more of a token than one output can hold with the rest's. A
    /// next run can take it.
    Tokens,
    /// No transaction can hold it, even alone.
    TooLarge,
    /// Its tokens need more ADA in their outputs than it holds, and the
    /// transaction couldn't be built with it in: of the UTxOs tried, it
    /// brought the least ([`most_that_fit`]).
    Short,
    /// It holds a reference script the CLI can't measure, so spending it can't
    /// be priced.
    Unpriced,
}

/// More kinds of token than one transaction can carry, with room to spare.
/// Each takes at least 3 bytes in an output: an amount, and a name of a byte
/// or more (one a policy may go without). Every 20 take an output of over 60
/// bytes more, so 16 KiB holds about 2,500. A sweep that would take more is
/// too large anyway, and adding them up costs time for nothing: core's token
/// sums grow with the square of the kinds, and anyone can send thousands.
const MOST_KINDS: usize = 4_000;

/// What a sweep can spend of `rows` in one transaction, before it's built:
/// the first that can go together, in the order given; the rest goes to
/// `stayed`. Left out: a reference script it can't measure; more of a token
/// than one output can hold with the rest's; reference scripts past what one
/// transaction may use, with the `script_bytes` it reads anyway; more kinds of
/// token than one transaction carries ([`MOST_KINDS`]); and anything past
/// `at_most`. The tokens are added up once, in a sorted map.
pub(crate) fn sweepable(
    rows: Vec<UtxoResponse>,
    script_bytes: u64,
    at_most: usize,
    stayed: &mut Vec<(UtxoResponse, Stay)>,
) -> Result<Vec<UtxoResponse>> {
    let mut total: BTreeMap<(String, String), u64> = BTreeMap::new();
    let mut bytes = script_bytes;
    let mut taken = Vec::new();
    for utxo in rows {
        let Ok(size) = utxos::reference_script_size(&utxo) else {
            stayed.push((utxo, Stay::Unpriced));
            continue;
        };
        if taken.len() == at_most || bytes.saturating_add(size) > build::MAX_REFERENCE_SCRIPT_BYTES
        {
            stayed.push((utxo, Stay::Later));
            continue;
        }
        // Its tokens with the rest's, unless one would pass a u64.
        let mut sums: BTreeMap<(String, String), u64> = BTreeMap::new();
        let mut fits = true;
        for token in utxo.asset_list.iter().flatten() {
            let (key, quantity) = token_of(&utxo, token)?;
            let before = match sums.get(&key) {
                Some(sum) => *sum,
                None => total.get(&key).copied().unwrap_or(0),
            };
            match before.checked_add(quantity) {
                Some(sum) => {
                    sums.insert(key, sum);
                }
                None => {
                    fits = false;
                    break;
                }
            }
        }
        if !fits {
            stayed.push((utxo, Stay::Tokens));
            continue;
        }
        let kinds = sums.keys().filter(|key| !total.contains_key(*key)).count();
        if total.len() + kinds > MOST_KINDS {
            stayed.push((utxo, Stay::Later));
            continue;
        }
        total.extend(sums);
        bytes += size;
        taken.push(utxo);
    }
    Ok(taken)
}

/// What `row` brings to a sweep beyond the least ADA its own tokens' outputs
/// need (`needs`): below zero for a pile of tokens holding less than that.
fn worth(row: &UtxoResponse, needs: &impl Fn(&Assets) -> Result<u64>) -> Result<i128> {
    let (lovelace, tokens) = utxos::assets_of(vec![row.clone()])?;
    let needed = if tokens.is_empty() {
        0
    } else {
        needs(&tokens)?
    };
    Ok(i128::from(lovelace) - i128::from(needed))
}

/// `rows` in the order a sweep takes them: ADA alone first, then those
/// holding tokens; each the most it brings first ([`worth`]), ties by
/// outpoint. When fewer go, the last stay: piles of tokens that bring least.
pub(crate) fn by_worth(
    rows: Vec<UtxoResponse>,
    needs: &impl Fn(&Assets) -> Result<u64>,
) -> Result<Vec<UtxoResponse>> {
    let mut keyed = rows
        .into_iter()
        .map(|u| {
            let holds_tokens = u.asset_list.as_ref().is_some_and(|a| !a.is_empty());
            Ok(((holds_tokens, std::cmp::Reverse(worth(&u, needs)?)), u))
        })
        .collect::<Result<Vec<_>>>()?;
    keyed.sort_by(|(a_key, a), (b_key, b)| {
        a_key
            .cmp(b_key)
            .then_with(|| (&a.tx_hash, a.tx_index).cmp(&(&b.tx_hash, b.tx_index)))
    });
    Ok(keyed.into_iter().map(|(_, u)| u).collect())
}

/// The UTxOs a spend from the contract picks among (`transfer`, `sweep`,
/// `util mint`): at most `at_most` of `rows`, every owned one. First those
/// holding the tokens `needed`, as few as hold them; then the rest in the
/// order a sweep takes them ([`by_worth`], with `needs` the least a UTxO's
/// own tokens need back in the contract). What the spend would never pick
/// takes no place (core's [`build::max_inputs_by`]: a reference script, or
/// tokens past what one output holds with the rest's).
///
/// Never Koios's order, nor any other a payer picks: anyone can pay the
/// contract under one of your registers and grind the hash its transaction
/// gets, so 20 piles of tokens that bring less than their outputs need came
/// first, and no spend could pay (chunk 51, r2cli#1).
pub(crate) fn window(
    rows: Vec<UtxoResponse>,
    needed: &Assets,
    needs: &impl Fn(&Assets) -> Result<u64>,
    at_most: usize,
) -> Result<Vec<UtxoResponse>> {
    let ranked = by_worth(rows, needs)?;
    let place: HashMap<(&str, u64), usize> = ranked
        .iter()
        .enumerate()
        .map(|(i, u)| ((u.tx_hash.as_str(), u.tx_index), i))
        .collect();
    // max_inputs_by takes the most first: here, the first by worth.
    let (window, _) = build::max_inputs_by(&ranked, needed, at_most, |u| {
        Reverse(
            place
                .get(&(u.tx_hash.as_str(), u.tx_index))
                .copied()
                .unwrap_or(usize::MAX),
        )
    })?;
    Ok(window)
}

/// `build` of as many of `rows` as one transaction takes, the first first;
/// what stays goes to `stayed`.
///
/// - Over the network's size ([`TooLarge`]), it tries fewer, as far over as
///   the build reads. A UTxO no transaction holds even alone stays, so it
///   never holds back the ones after it.
/// - A build that fails otherwise, when some of the UTxOs it tried bring less
///   ADA than their own tokens' outputs need (`needs`), is tried again without
///   the one of them that brings least, then the next, until it builds. So a
///   token UTxO received with a key address's least ADA, short of its deposit
///   by the register's bytes, still goes whenever the rest can carry it. Those
///   left go to `stayed`, whether the rest goes or nothing does: when nothing
///   does, they're what stopped it (chunk 51, r2cli#1).
/// - Any other failure is returned as it is.
pub(crate) fn most_that_fit<T>(
    mut rows: Vec<UtxoResponse>,
    needs: &impl Fn(&Assets) -> Result<u64>,
    stayed: &mut Vec<(UtxoResponse, Stay)>,
    mut build: impl FnMut(&[UtxoResponse]) -> Result<T>,
) -> Result<T> {
    let mut short: Vec<UtxoResponse> = Vec::new();
    let mut n = rows.len();
    loop {
        let error = match build(&rows[..n]) {
            Ok(built) => {
                if n < rows.len() && build(&rows[n..=n]).is_err_and(|e| build::is_too_large(&e)) {
                    stayed.push((rows.remove(n), Stay::TooLarge));
                    n = rows.len();
                    continue;
                }
                stayed.extend(rows.drain(n..).map(|u| (u, Stay::Later)));
                stayed.extend(short.drain(..).map(|u| (u, Stay::Short)));
                return Ok(built);
            }
            Err(e) => e,
        };
        match error.downcast_ref::<TooLarge>() {
            Some(large) if n > 1 => {
                n = large.fewer(n);
                continue;
            }
            Some(_) => stayed.push((rows.remove(0), Stay::TooLarge)),
            None => {
                let mut least: Option<(usize, i128)> = None;
                for (i, row) in rows[..n].iter().enumerate() {
                    let brings = worth(row, needs)?;
                    if brings < 0 && least.is_none_or(|(_, so_far)| brings <= so_far) {
                        least = Some((i, brings));
                    }
                }
                let Some((i, _)) = least else {
                    stayed.extend(short.drain(..).map(|u| (u, Stay::Short)));
                    return Err(error);
                };
                short.push(rows.remove(i));
            }
        }
        if rows.is_empty() {
            stayed.extend(short.drain(..).map(|u| (u, Stay::Short)));
            return Err(error);
        }
        n = rows.len();
    }
}

/// Why a UTxO stays, for each [`Stay`], as [`print_stayed`] says it. `again`
/// is the command to run again for those a next run can take, once this run
/// has sent; when it sent nothing, a next run takes the same UTxOs, so that
/// would be no advice (chunk 51, r2cli#1).
fn reasons(again: Option<&str>) -> [(Stay, String); 5] {
    let next = |why: &str| match again {
        Some(command) => format!("{why} (run {command} again)"),
        None => why.to_string(),
    };
    [
        (Stay::Later, next("Past what one transaction takes")),
        (
            Stay::Tokens,
            next("More of a token than one output holds with the rest"),
        ),
        (Stay::TooLarge, "Too large for any transaction".to_string()),
        (
            Stay::Short,
            "Tokens needing more ADA than they bring, more than the rest can make up".to_string(),
        ),
        (
            Stay::Unpriced,
            "A reference script the CLI can't measure, so it can't price spending it".to_string(),
        ),
    ]
}

/// Says how many of a sweep's UTxOs stay where they are, and why, if any do.
/// `again` is the command to run again for those a next run can take: `None`
/// when this run sent nothing ([`reasons`]).
pub(crate) fn print_stayed(stayed: &[(UtxoResponse, Stay)], again: Option<&str>) {
    if stayed.is_empty() {
        return;
    }
    println!(
        "\n{} {}",
        "Not Swept:".bright_yellow(),
        stayed.len().to_string().bright_yellow()
    );
    for (stay, why) in reasons(again) {
        let these: Vec<&UtxoResponse> = stayed
            .iter()
            .filter(|(_, s)| *s == stay)
            .map(|(u, _)| u)
            .collect();
        if these.is_empty() {
            continue;
        }
        println!("{why}: {}", these.len());
        // A next run won't take these, so they're named.
        if !matches!(stay, Stay::Later | Stay::Tokens) {
            for utxo in these {
                println!("  UTxO: {}#{}", utxo.tx_hash, utxo.tx_index);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use seedelf_koios::koios::Asset as KoiosAsset;

    /// A UTxO at outpoint `n` of `lovelace` and `tokens` tokens, one of each.
    fn row(n: u8, lovelace: u64, tokens: u8) -> UtxoResponse {
        UtxoResponse {
            tx_hash: hex::encode([n; 32]),
            value: lovelace.to_string(),
            asset_list: Some(
                (0..tokens)
                    .map(|i| KoiosAsset {
                        policy_id: hex::encode([0x40 + i; 28]),
                        asset_name: "01".to_string(),
                        quantity: "1".to_string(),
                        ..Default::default()
                    })
                    .collect(),
            ),
            ..Default::default()
        }
    }

    /// Each token's output needs 1 ₳.
    fn needs(tokens: &Assets) -> Result<u64> {
        Ok(tokens.len() * 1_000_000)
    }

    /// A sweep that builds with none of what it was given says which UTxOs
    /// stopped it: those that bring less than their tokens need, each named
    /// by outpoint where it said nothing of them (chunk 51, r2cli#1).
    #[test]
    fn a_sweep_that_cant_build_names_what_stopped_it() {
        let piles = vec![row(1, 1_000_000, 3), row(2, 1_000_000, 2)];
        // With ADA of the user's too little to pay a fee, or none.
        for rows in [
            piles.clone(),
            [piles.clone(), vec![row(3, 500_000, 0)]].concat(),
        ] {
            let mut stayed = Vec::new();
            let built: Result<()> = most_that_fit(rows.clone(), &needs, &mut stayed, |_| {
                Err(anyhow::anyhow!("Not enough ADA"))
            });
            assert!(built.is_err(), "nothing builds");
            let short: Vec<&str> = stayed
                .iter()
                .filter(|(_, stay)| *stay == Stay::Short)
                .map(|(u, _)| u.tx_hash.as_str())
                .collect();
            assert_eq!(
                short,
                vec![piles[0].tx_hash.as_str(), piles[1].tx_hash.as_str()],
                "the two piles, the one that brings least first, of {} UTxOs",
                rows.len()
            );
        }
    }

    /// "Run it again" is said only once a run has sent: one that sent nothing
    /// takes the same UTxOs the next time (chunk 51, r2cli#1).
    #[test]
    fn run_it_again_is_said_only_once_something_went() {
        let said = |again| reasons(again).map(|(_, why)| why);
        assert!(
            said(None).iter().all(|why| !why.contains("again")),
            "{:?}",
            said(None)
        );
        let went = said(Some("sweep --all"));
        assert!(
            went[..2]
                .iter()
                .all(|why| why.ends_with("(run sweep --all again)")),
            "{went:?}"
        );
    }
}
