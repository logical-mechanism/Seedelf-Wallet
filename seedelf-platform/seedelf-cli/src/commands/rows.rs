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

use anyhow::{Context, Result};
use colored::Colorize;
use seedelf_core::assets::{Asset, Assets, string_to_u64};
use seedelf_core::build::{self, TooLarge};
use seedelf_core::utxos;
use seedelf_koios::koios::UtxoResponse;
use std::collections::BTreeMap;

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
        let unreadable = || format!("UTxO {}#{} can't be read", row.tx_hash, row.tx_index);
        lovelace += u128::from(string_to_u64(row.value.clone()).with_context(unreadable)?);
        for token in row.asset_list.iter().flatten() {
            let quantity = string_to_u64(token.quantity.clone()).with_context(unreadable)?;
            let asset = Asset::new(token.policy_id.clone(), token.asset_name.clone(), quantity)
                .with_context(unreadable)?;
            let key = (hex::encode(asset.policy_id), hex::encode(&asset.token_name));
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
    /// Its tokens need more ADA in their outputs than it holds, and the rest's
    /// ADA can't make up the difference.
    Short,
    /// It holds a reference script the CLI can't measure, so spending it can't
    /// be priced.
    Unpriced,
}

/// What a sweep can spend of `rows` in one transaction, before it's built, in
/// the order given; the rest goes to `stayed`. Left out: a reference script it
/// can't measure; more of a token than one output can hold with the rest's
/// ([`utxos::fitting`]); reference scripts past what one transaction may use,
/// with the `script_bytes` it reads anyway; and anything past `at_most`.
pub(crate) fn sweepable(
    rows: Vec<UtxoResponse>,
    script_bytes: u64,
    at_most: usize,
    stayed: &mut Vec<(UtxoResponse, Stay)>,
) -> Result<Vec<UtxoResponse>> {
    let (priced, unpriced): (Vec<_>, Vec<_>) = rows
        .into_iter()
        .partition(|u| utxos::reference_script_size(u).is_ok());
    stayed.extend(unpriced.into_iter().map(|u| (u, Stay::Unpriced)));
    let (fits, past) = utxos::fitting(&priced, &Assets::new(), |_| false)?;
    stayed.extend(past.into_iter().map(|u| (u, Stay::Tokens)));
    let mut bytes = script_bytes;
    let mut taken = Vec::new();
    for utxo in fits {
        let size = utxos::reference_script_size(&utxo)?;
        if taken.len() == at_most || bytes.saturating_add(size) > build::MAX_REFERENCE_SCRIPT_BYTES
        {
            stayed.push((utxo, Stay::Later));
        } else {
            bytes += size;
            taken.push(utxo);
        }
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

/// `build` of as many of `rows` as one transaction takes, the first first;
/// what stays goes to `stayed`.
///
/// - Over the network's size ([`TooLarge`]), it tries fewer, as far over as
///   the build reads. A UTxO no transaction holds even alone stays, so it
///   never holds back the ones after it.
/// - A build that fails otherwise, when some of the UTxOs it tried hold tokens
///   that need more ADA in their outputs than they hold (`needs`), is tried
///   without them: the rest's ADA couldn't make up the difference.
/// - Any other failure is returned as it is.
pub(crate) fn most_that_fit<T>(
    mut rows: Vec<UtxoResponse>,
    needs: &impl Fn(&Assets) -> Result<u64>,
    stayed: &mut Vec<(UtxoResponse, Stay)>,
    mut build: impl FnMut(&[UtxoResponse]) -> Result<T>,
) -> Result<T> {
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
                let mut short = Vec::new();
                for (i, row) in rows[..n].iter().enumerate() {
                    if worth(row, needs)? < 0 {
                        short.push(i);
                    }
                }
                if short.is_empty() {
                    return Err(error);
                }
                for i in short.into_iter().rev() {
                    stayed.push((rows.remove(i), Stay::Short));
                }
            }
        }
        if rows.is_empty() {
            return Err(error);
        }
        n = rows.len();
    }
}

/// Says how many of a sweep's UTxOs stay where they are, and why, if any do.
/// `command` is the one to run again for those a next run can take.
pub(crate) fn print_stayed(stayed: &[(UtxoResponse, Stay)], command: &str) {
    if stayed.is_empty() {
        return;
    }
    println!(
        "\n{} {}",
        "Not Swept:".bright_yellow(),
        stayed.len().to_string().bright_yellow()
    );
    let reasons = [
        (
            Stay::Later,
            format!("Past what one transaction takes (run {command} again)"),
        ),
        (
            Stay::Tokens,
            format!("More of a token than one output holds with the rest (run {command} again)"),
        ),
        (Stay::TooLarge, "Too large for any transaction".to_string()),
        (
            Stay::Short,
            "Tokens needing more ADA than they bring, which the rest can't make up".to_string(),
        ),
        (
            Stay::Unpriced,
            "A reference script the CLI can't measure, so it can't price spending it".to_string(),
        ),
    ];
    for (stay, why) in reasons {
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
